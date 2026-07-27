/**
 * VARS - Codex Model Discovery
 *
 * Resolves which models the signed-in ChatGPT account (OAuth) can actually serve,
 * so OAuth mode always talks to the newest available model instead of a name that
 * was hardcoded when the release shipped.
 *
 * Strategy (each step degrades gracefully into the next):
 *   1. Ask the account-aware endpoint chatgpt.com/backend-api/codex/models.
 *   2. Union that with the offline seed list from config/models.json.
 *   3. Rank the union: newest version first, then by variant (flagship > mini > nano).
 *   4. Anything the backend rejects with "model is not supported" is remembered as
 *      unsupported for a while, so the next call skips straight to the next best.
 *
 * The result is cached in ~/.vars/codex-models.json (with a TTL) so we don't hit
 * the network on every prompt, and re-discovered after login / on demand.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getCodexDiscoveryConfig, getCodexFallbackModels } = require('../../config');

const CACHE_DIR = path.join(os.homedir(), '.vars');
const CACHE_FILE = path.join(CACHE_DIR, 'codex-models.json');
const CACHE_VERSION = 1;

// Used only if config/models.json is missing the discovery block entirely.
const DISCOVERY_DEFAULTS = {
    endpoint: 'https://chatgpt.com/backend-api/codex/models',
    originator: 'vars',
    clientVersion: '',
    timeoutMs: 8000,
    cacheTtlMinutes: 360,
    failureBackoffMinutes: 10,
    unsupportedTtlHours: 24,
    exclude: [],
    variantPriority: { quality: {}, speed: {} },
};

function discoveryConfig() {
    return { ...DISCOVERY_DEFAULTS, ...getCodexDiscoveryConfig() };
}

// ============================================================================
// Cache
// ============================================================================

let cache = null;          // { version, fetchedAt, models, unsupported, lastGood, source }
let inFlightFetch = null;  // Dedupes concurrent discovery requests
let lastFailureAt = 0;     // Backoff timestamp for a failed discovery attempt

function emptyCache() {
    return {
        version: CACHE_VERSION,
        fetchedAt: 0,
        source: 'none',
        models: [],
        unsupported: {},
        lastGood: {},
    };
}

function loadCache() {
    if (cache) return cache;

    try {
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === CACHE_VERSION && Array.isArray(parsed.models)) {
            cache = {
                ...emptyCache(),
                ...parsed,
                unsupported: parsed.unsupported || {},
                lastGood: parsed.lastGood || {},
            };
            return cache;
        }
    } catch {
        // No cache yet, or it's unreadable/stale-format — start fresh.
    }

    cache = emptyCache();
    return cache;
}

function saveCache() {
    if (!cache) return;
    try {
        if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    } catch (err) {
        console.warn('[Codex Models] Could not persist model cache:', err.message);
    }
}

/**
 * Drop every cached model fact. Called on logout so the next account starts clean.
 */
function invalidateCodexModelCache() {
    cache = emptyCache();
    inFlightFetch = null;
    lastFailureAt = 0;
    try {
        if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
    } catch (err) {
        console.warn('[Codex Models] Could not delete model cache:', err.message);
    }
}

// ============================================================================
// Ranking
// ============================================================================

/**
 * Parse the version out of a model id as a comparable array of numbers.
 * 'gpt-5.6-sol' -> [5, 6]   'gpt-5.10' -> [5, 10]   'gpt-4o' -> [4]
 */
function parseVersion(id) {
    const match = String(id).match(/(\d+(?:\.\d+)*)/);
    if (!match) return [0];
    return match[1].split('.').map(n => parseInt(n, 10) || 0);
}

/** Compare two parsed versions, newest first. */
function compareVersionDesc(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const diff = (b[i] || 0) - (a[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/**
 * Everything after the version number: 'gpt-5.6-sol' -> 'sol', 'gpt-5.5' -> ''.
 */
function parseVariant(id) {
    const str = String(id).toLowerCase();
    const match = str.match(/(\d+(?:\.\d+)*)/);
    if (!match) return str;
    const rest = str.slice(match.index + match[1].length);
    return rest.replace(/^[-_.]+/, '');
}

/**
 * Score a variant. Unknown variants get the table's `default`, so a model family
 * we've never seen still ranks on version alone instead of being discarded.
 */
function variantWeight(variant, table) {
    const fallback = table.default ?? 50;
    if (Object.prototype.hasOwnProperty.call(table, variant)) return table[variant];

    const segments = variant.split('-').filter(Boolean);
    for (const segment of [segments[segments.length - 1], segments[0]]) {
        if (segment && Object.prototype.hasOwnProperty.call(table, segment)) {
            return table[segment];
        }
    }
    return fallback;
}

function isExcluded(id, patterns) {
    const lower = String(id).toLowerCase();
    return (patterns || []).some(pattern => pattern && lower.includes(String(pattern).toLowerCase()));
}

/**
 * Filter out ids that clearly aren't chat-capable model slugs.
 */
function looksLikeModelId(id) {
    if (typeof id !== 'string') return false;
    const trimmed = id.trim();
    if (!trimmed || trimmed.length > 64) return false;
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(trimmed)) return false;
    return /^(gpt|o\d|chatgpt|codex)/i.test(trimmed);
}

/**
 * Rank model ids best-first for a given purpose.
 * @param {string[]} ids
 * @param {string} purpose - 'analyze' (quality-biased) or 'transcribe' (speed-biased)
 * @returns {string[]}
 */
function rankModels(ids, purpose = 'analyze') {
    const cfg = discoveryConfig();
    const priorities = cfg.variantPriority || {};
    const table = (purpose === 'transcribe' ? priorities.speed : priorities.quality) || {};

    const seen = new Set();
    const entries = [];

    for (const id of ids) {
        if (!looksLikeModelId(id)) continue;
        const normalized = id.trim();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        entries.push({
            id: normalized,
            version: parseVersion(normalized),
            weight: variantWeight(parseVariant(normalized), table),
        });
    }

    entries.sort((a, b) => {
        const byVersion = compareVersionDesc(a.version, b.version);
        if (byVersion !== 0) return byVersion;
        if (b.weight !== a.weight) return b.weight - a.weight;
        return a.id.localeCompare(b.id);
    });

    return entries.map(e => e.id);
}

// ============================================================================
// Discovery
// ============================================================================

const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

function extractAccountId(token) {
    try {
        const parts = String(token).split('.');
        if (parts.length !== 3) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return payload[JWT_CLAIM_PATH]?.chatgpt_account_id ||
            payload[JWT_CLAIM_PATH]?.account_id ||
            payload.account_id ||
            null;
    } catch {
        return null;
    }
}

/**
 * Pull model ids out of the response without assuming a single schema —
 * the endpoint is undocumented and has changed shape before.
 * Handles: ["gpt-5.6"], {models:[...]}, {data:[{id}]}, {models:[{slug}]}, ...
 */
function extractModelIds(payload, depth = 0, out = []) {
    if (!payload || depth > 4) return out;

    if (typeof payload === 'string') {
        out.push(payload);
        return out;
    }

    if (Array.isArray(payload)) {
        for (const item of payload) extractModelIds(item, depth + 1, out);
        return out;
    }

    if (typeof payload === 'object') {
        const id = payload.id || payload.slug || payload.model || payload.name;
        if (typeof id === 'string') out.push(id);

        for (const key of ['models', 'data', 'items', 'available_models', 'supported_models']) {
            if (payload[key]) extractModelIds(payload[key], depth + 1, out);
        }
    }

    return out;
}

/**
 * Query the account-aware model endpoint.
 * @param {string} token - OAuth access token (JWT)
 * @returns {Promise<string[]>} Model ids the account can serve
 */
async function fetchModelsFromBackend(token) {
    const cfg = discoveryConfig();
    const accountId = extractAccountId(token);

    const url = new URL(cfg.endpoint);
    if (cfg.clientVersion) {
        url.searchParams.set('client_version', cfg.clientVersion);
    }

    const headers = {
        'Authorization': `Bearer ${token}`,
        'accept': 'application/json',
        'originator': cfg.originator,
        'User-Agent': `vars (${os.platform()} ${os.release()}; ${os.arch()})`,
    };
    if (accountId) headers['chatgpt-account-id'] = accountId;
    if (cfg.clientVersion) headers['version'] = cfg.clientVersion;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
        const response = await fetch(url.toString(), { headers, signal: controller.signal });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        const ids = extractModelIds(payload).filter(looksLikeModelId);

        if (ids.length === 0) {
            throw new Error('no model ids in response');
        }

        return ids;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Get the discovered model list, refreshing it when the cache is stale.
 * Never throws — falls back to the (possibly stale) cache, then to nothing.
 *
 * @param {string} token - OAuth access token
 * @param {object} [options]
 * @param {boolean} [options.force] - Ignore the TTL and re-query the backend
 * @returns {Promise<{models: string[], source: string, fetchedAt: number}>}
 */
async function getCodexModels(token, options = {}) {
    const cfg = discoveryConfig();
    const current = loadCache();
    const now = Date.now();
    const ttlMs = cfg.cacheTtlMinutes * 60 * 1000;
    const isFresh = current.models.length > 0 && (now - current.fetchedAt) < ttlMs;

    if (!options.force && isFresh) {
        return { models: current.models, source: current.source, fetchedAt: current.fetchedAt };
    }

    if (!token) {
        return { models: current.models, source: current.source, fetchedAt: current.fetchedAt };
    }

    // Don't hammer a failing endpoint — reuse whatever we already know.
    const backoffMs = cfg.failureBackoffMinutes * 60 * 1000;
    if (!options.force && lastFailureAt && (now - lastFailureAt) < backoffMs) {
        return { models: current.models, source: current.source, fetchedAt: current.fetchedAt };
    }

    if (!inFlightFetch) {
        inFlightFetch = fetchModelsFromBackend(token)
            .then(ids => {
                const store = loadCache();
                store.models = ids;
                store.fetchedAt = Date.now();
                store.source = 'discovery';
                saveCache();
                lastFailureAt = 0;
                console.log(`[Codex Models] Discovered ${ids.length} models for this account: ${ids.join(', ')}`);
                return { models: store.models, source: store.source, fetchedAt: store.fetchedAt };
            })
            .catch(err => {
                lastFailureAt = Date.now();
                const store = loadCache();
                console.warn(`[Codex Models] Discovery failed (${err.message}) — using ${store.models.length ? 'cached list' : 'offline fallback list'}`);
                return { models: store.models, source: store.source, fetchedAt: store.fetchedAt };
            })
            .finally(() => {
                inFlightFetch = null;
            });
    }

    return inFlightFetch;
}

// ============================================================================
// Selection
// ============================================================================

function unsupportedSet() {
    const cfg = discoveryConfig();
    const store = loadCache();
    const ttlMs = cfg.unsupportedTtlHours * 60 * 60 * 1000;
    const now = Date.now();
    const active = new Set();
    let changed = false;

    for (const [model, markedAt] of Object.entries(store.unsupported)) {
        if (now - markedAt < ttlMs) {
            active.add(model);
        } else {
            delete store.unsupported[model];
            changed = true;
        }
    }

    if (changed) saveCache();
    return active;
}

/**
 * Order the models to try, newest first.
 *
 * When the account list came from the backend we trust it and rank only those,
 * appending the offline seed models as a tail — the account list is authoritative
 * about plan gating (e.g. a flagship the plan doesn't include), so putting seeds
 * first would burn a rejected request on every call. If discovery never ran, the
 * seeds are all we have and they are ranked on their own.
 *
 * @param {string[]} discovered - Models reported for this account
 * @param {string} source - 'discovery' when the list came from the backend
 * @param {string} purpose - 'analyze' or 'transcribe'
 * @returns {string[]}
 */
function buildChain(discovered, source, purpose) {
    const cfg = discoveryConfig();
    const fallback = getCodexFallbackModels(purpose);
    const rejected = unsupportedSet();
    const usable = id => !isExcluded(id, cfg.exclude) && !rejected.has(id);

    if (source === 'discovery' && discovered.length > 0) {
        const primary = rankModels(discovered.filter(usable), purpose);
        const known = new Set(primary);
        const tail = rankModels(fallback.filter(id => usable(id) && !known.has(id)), purpose);
        return [...primary, ...tail];
    }

    return rankModels([...discovered, ...fallback].filter(usable), purpose);
}

/**
 * Build the ordered list of models to try for a request.
 * Index 0 is always the newest model this account is believed to support.
 *
 * @param {string} token - OAuth access token
 * @param {string} purpose - 'analyze' or 'transcribe'
 * @returns {Promise<string[]>}
 */
async function getCodexModelChain(token, purpose = 'analyze') {
    const { models: discovered, source } = await getCodexModels(token);
    const chain = buildChain(discovered, source, purpose);

    if (chain.length === 0) {
        // Everything is blacklisted or filtered out — fall back to whatever
        // answered last, else the raw seed list, so we never end up with nothing.
        const store = loadCache();
        const lastGood = store.lastGood[purpose];
        return lastGood ? [lastGood] : getCodexFallbackModels(purpose);
    }

    return chain;
}

/**
 * Newest model available to this account for the given purpose.
 * @param {string} token - OAuth access token
 * @param {string} purpose - 'analyze' or 'transcribe'
 * @returns {Promise<string>}
 */
async function getLatestCodexModel(token, purpose = 'analyze') {
    const chain = await getCodexModelChain(token, purpose);
    return chain[0];
}

/**
 * Remember that the backend refused this model, so it drops out of the chain.
 * @param {string} model
 */
function markCodexModelUnsupported(model) {
    if (!model) return;
    const store = loadCache();
    if (store.unsupported[model]) return;
    store.unsupported[model] = Date.now();
    saveCache();
}

/**
 * Remember the model that actually answered, for UI display and as a last-resort
 * fallback when discovery is unavailable.
 * @param {string} model
 * @param {string} purpose
 */
function markCodexModelWorking(model, purpose = 'analyze') {
    if (!model) return;
    const store = loadCache();
    const wasUnsupported = Boolean(store.unsupported[model]);
    if (store.lastGood[purpose] === model && !wasUnsupported) return;
    delete store.unsupported[model];
    store.lastGood[purpose] = model;
    saveCache();
}

/**
 * Synchronous snapshot for the UI / IPC — never triggers a network call.
 * @returns {object} { model, models, source, fetchedAt, lastGood }
 */
function getCodexModelSnapshot(purpose = 'analyze') {
    const store = loadCache();
    const chain = buildChain(store.models, store.source, purpose);

    return {
        model: chain[0] || store.lastGood[purpose] || null,
        models: chain,
        source: store.source,
        fetchedAt: store.fetchedAt,
        lastGood: store.lastGood[purpose] || null,
    };
}

/**
 * Kick off a discovery refresh without blocking the caller.
 * @param {string} token - OAuth access token
 */
function refreshCodexModelsInBackground(token) {
    if (!token) return;
    getCodexModels(token, { force: true }).catch(() => { /* already logged */ });
}

module.exports = {
    getCodexModels,
    getCodexModelChain,
    getLatestCodexModel,
    getCodexModelSnapshot,
    markCodexModelUnsupported,
    markCodexModelWorking,
    invalidateCodexModelCache,
    refreshCodexModelsInBackground,
    // Exported for testing / reuse
    rankModels,
    parseVersion,
    parseVariant,
    extractModelIds,
    CACHE_FILE,
};
