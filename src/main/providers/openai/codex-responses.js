/**
 * VARS - Codex Responses API
 * 
 * Handles communication with the ChatGPT Codex backend API.
 * Used when authenticating via Codex CLI OAuth (ChatGPT Plus/Pro subscription).
 * 
 * Codex OAuth tokens CANNOT use the standard OpenAI Chat Completions API at api.openai.com.
 * They must use the Codex Responses API at chatgpt.com/backend-api/codex/responses.
 * 
 * Reference: pi-ai openai-codex-responses.ts
 */

const os = require('os');

const CODEX_URL = 'https://chatgpt.com/backend-api/codex/responses';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

// Model mapping: any model name → currently accepted ChatGPT/Codex OAuth model.
// As of 2026-05, the ChatGPT subscription backend only accepts the gpt-5.4 family
// (universal) and gpt-5.5 (OAuth-exclusive default). Older 5.x and 4.x names are
// remapped here so existing user configs continue to work after the gpt-5.1
// removal in March 2026.
const MODEL_MAP = {
    // Legacy GPT-4 family (pre-gpt-5 rollout)
    'gpt-4o-mini': 'gpt-5.4-mini',
    'gpt-4o': 'gpt-5.4',
    'gpt-4': 'gpt-5.4',
    'gpt-4-turbo': 'gpt-5.4',
    'gpt-4-turbo-preview': 'gpt-5.4',
    'gpt-4o-2024-05-13': 'gpt-5.4',
    'gpt-4o-2024-08-06': 'gpt-5.4',
    'gpt-4o-2024-11-20': 'gpt-5.4',
    'gpt-4o-mini-2024-07-18': 'gpt-5.4-mini',
    // GPT-5.x names that the ChatGPT backend now rejects
    'gpt-5.1': 'gpt-5.5',
    'gpt-5.1-codex-mini': 'gpt-5.4-mini',
    'gpt-5.1-codex-max': 'gpt-5.5',
    'gpt-5.2': 'gpt-5.5',
    'gpt-5.2-codex': 'gpt-5.5',
    'gpt-5.3-codex': 'gpt-5.5',
    'gpt-5.3-codex-spark': 'gpt-5.5',
};

/**
 * Extract ChatGPT Account ID from a JWT token
 * @param {string} token - JWT access token
 * @returns {string|null} Account ID or null
 */
function extractAccountId(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return payload[JWT_CLAIM_PATH]?.chatgpt_account_id ||
            payload[JWT_CLAIM_PATH]?.account_id ||
            null;
    } catch {
        return null;
    }
}

/**
 * Map standard model names to Codex-compatible equivalents
 * @param {string} model - Model name
 * @returns {string} Codex-compatible model name
 */
function resolveCodexModel(model) {
    return MODEL_MAP[model] || model;
}

/**
 * Ordered fallback list used when the configured model is rejected with
 * "model is not supported". Ordered best → safest so newer accounts that
 * have access to gpt-5.5 try it first, but anyone falls through to the
 * universally-accepted gpt-5.4 family. Update when OpenAI ships new models.
 */
const CODEX_FALLBACK_CHAIN = [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
];

// Same chain biased toward speed (used by audio transcription).
const CODEX_TRANSCRIPTION_FALLBACK_CHAIN = [
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.4',
    'gpt-5.5',
];

/**
 * Detect whether a backend error message indicates the model is no longer
 * accepted by the ChatGPT/Codex backend (vs. a transient/auth/server error).
 */
function isModelNotSupportedError(text) {
    if (!text || typeof text !== 'string') return false;
    return /model is not supported when using Codex/i.test(text)
        || /not supported.*ChatGPT account/i.test(text)
        || /model.*not (yet )?available/i.test(text)
        || /unknown model/i.test(text)
        || /invalid model/i.test(text);
}

/**
 * Build the ordered list of models to attempt: the requested model first,
 * then every fallback that hasn't been requested yet.
 */
function buildAttemptList(requestedModel, chain) {
    const seen = new Set();
    const attempts = [];
    for (const m of [requestedModel, ...chain]) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        attempts.push(m);
    }
    return attempts;
}

/**
 * Parse a Codex backend error response (best-effort JSON, falls back to raw).
 */
function parseCodexError(errorText) {
    try {
        const errorJson = JSON.parse(errorText);
        return errorJson.detail?.message || errorJson.detail || errorJson.message || errorText;
    } catch {
        return errorText;
    }
}

/**
 * Build request headers for Codex API
 * Headers are based on pi-ai's buildHeaders() in openai-codex-responses.ts
 * @param {string} accountId - ChatGPT account ID
 * @param {string} token - OAuth access token
 * @returns {object} Headers object
 */
function buildHeaders(accountId, token) {
    return {
        'Authorization': `Bearer ${token}`,
        'chatgpt-account-id': accountId,
        'OpenAI-Beta': 'responses=experimental',
        'originator': 'vars',
        'User-Agent': `vars (${os.platform()} ${os.release()}; ${os.arch()})`,
        'accept': 'text/event-stream',
        'content-type': 'application/json',
    };
}

/**
 * Convert Chat Completions messages to Responses API input format
 * System messages are excluded (they go in the 'instructions' field)
 * @param {Array} messages - Chat Completions format messages
 * @returns {Array} Responses API input array
 */
function convertToResponsesInput(messages) {
    return messages
        .filter(m => m.role !== 'system')
        .map(m => {
            // Handle multimodal content (images)
            if (Array.isArray(m.content)) {
                const parts = m.content.map(part => {
                    if (part.type === 'text') {
                        return { type: 'input_text', text: part.text };
                    }
                    if (part.type === 'image_url') {
                        return { type: 'input_image', image_url: part.image_url?.url || part.image_url };
                    }
                    return { type: 'input_text', text: JSON.stringify(part) };
                });
                return { role: m.role, content: parts };
            }
            // Simple text content
            return { role: m.role, content: m.content };
        });
}

/**
 * Build the request body for Codex Responses API
 * Body format based on pi-ai's buildRequestBody() in openai-codex-responses.ts
 * @param {string} model - Model name (already resolved)
 * @param {string} systemPrompt - System prompt / instructions
 * @param {Array} input - Converted input messages
 * @param {number} maxOutputTokens - Maximum output tokens
 * @returns {object} Request body
 */
function buildRequestBody(model, systemPrompt, input, maxOutputTokens) {
    const body = {
        model: model,
        store: false,
        stream: true,
        instructions: systemPrompt || 'You are a helpful assistant.',
        input: input,
    };

    return body;
}

/**
 * Parse SSE (Server-Sent Events) response and extract text content
 * SSE parsing based on pi-ai's parseSSE() in openai-codex-responses.ts
 * @param {Response} response - Fetch Response with SSE body
 * @returns {Promise<string>} Extracted text content
 */
async function parseSSEResponse(response) {
    const text = await response.text();
    let result = '';

    // SSE events are separated by double newlines
    const events = text.split('\n\n');
    for (const event of events) {
        const dataLines = event.split('\n')
            .filter(l => l.startsWith('data:'))
            .map(l => l.slice(5).trim());

        if (dataLines.length === 0) continue;
        const data = dataLines.join('\n').trim();
        if (!data || data === '[DONE]') continue;

        try {
            const parsed = JSON.parse(data);

            // Collect text deltas
            if (parsed.type === 'response.output_text.delta') {
                result += parsed.delta || '';
            }

            // Handle errors from Codex backend
            if (parsed.type === 'error') {
                const msg = parsed.message || parsed.code || JSON.stringify(parsed);
                throw new Error(`Codex API error: ${msg}`);
            }

            if (parsed.type === 'response.failed') {
                const msg = parsed.response?.error?.message || 'Codex response failed';
                throw new Error(msg);
            }
        } catch (e) {
            // Re-throw Codex/application errors, ignore JSON parse errors from partial data
            if (e.message && (e.message.startsWith('Codex') || e.message === 'Codex response failed')) {
                throw e;
            }
        }
    }

    return result;
}

/**
 * Get a response from the Codex Responses API
 * 
 * This function handles the full flow:
 * 1. Extract account ID from JWT token
 * 2. Map model name to Codex-compatible equivalent
 * 3. Convert messages to Responses API format
 * 4. Call chatgpt.com/backend-api/codex/responses
 * 5. Parse SSE response stream
 * 6. Return text content
 * 
 * @param {string} token - OAuth access token (JWT)
 * @param {string} model - Model name (will be auto-mapped if not Codex compatible)
 * @param {string} systemPrompt - System prompt / instructions
 * @param {Array} messages - Chat messages in Chat Completions format
 * @param {number} maxOutputTokens - Maximum output tokens
 * @returns {Promise<string>} Response text
 */
async function getCodexResponse(token, model, systemPrompt, messages, maxOutputTokens) {
    const accountId = extractAccountId(token);
    if (!accountId) {
        throw new Error('Failed to extract account ID from OAuth token. Please re-login with Codex CLI.');
    }

    const resolvedModel = resolveCodexModel(model);
    const input = convertToResponsesInput(messages);
    const headers = buildHeaders(accountId, token);
    const attempts = buildAttemptList(resolvedModel, CODEX_FALLBACK_CHAIN);

    if (model !== resolvedModel) {
        console.log(`[Codex Responses] Model mapped: ${model} → ${resolvedModel}`);
    }

    let lastError;
    for (let i = 0; i < attempts.length; i++) {
        const attemptModel = attempts[i];
        const body = buildRequestBody(attemptModel, systemPrompt, input, maxOutputTokens);

        if (i === 0) {
            console.log(`[Codex Responses] Calling ${CODEX_URL} with model ${attemptModel}`);
        } else {
            console.warn(`[Codex Responses] Retrying with fallback model: ${attemptModel}`);
        }

        const response = await fetch(CODEX_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (response.ok) {
            const result = await parseSSEResponse(response);
            if (!result) throw new Error('Codex API returned empty response');
            console.log(`[Codex Responses] Success with ${attemptModel}, response length: ${result.length} chars`);
            return result;
        }

        const errorText = await response.text();
        const errorMessage = parseCodexError(errorText);
        lastError = new Error(`Codex API error (${response.status}): ${errorMessage}`);

        // Only roll forward in the chain on "model not supported" 400s.
        // Auth/quota/network/server errors abort immediately so we don't mask them.
        if (response.status === 400 && isModelNotSupportedError(errorMessage)) {
            console.warn(`[Codex Responses] Model ${attemptModel} rejected: ${errorMessage}`);
            continue;
        }

        console.error(`[Codex Responses] Error ${response.status}:`, errorText);
        throw lastError;
    }

    throw new Error(
        `Codex backend rejected every model in the fallback chain (tried: ${attempts.join(', ')}). ` +
        `Last error: ${lastError?.message || 'unknown'}. ` +
        `The available model list may have changed — please update VARS.`
    );
}

/**
 * Models currently accepted by chatgpt.com/backend-api/codex/responses
 * when authenticated via a ChatGPT subscription (May 2026).
 * gpt-5.5 is OAuth-exclusive; the gpt-5.4 family works on both OAuth and API keys.
 */
const CODEX_MODELS = [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
];

function isCodexCompatibleModel(model) {
    return CODEX_MODELS.includes(model);
}

/**
 * Transcribe audio using the Codex Responses API
 * Instead of Whisper (which requires an API key), this uses GPT-5.x
 * multimodal capabilities to transcribe audio via the ChatGPT backend.
 * 
 * @param {string} token - OAuth access token (JWT)
 * @param {Buffer} audioBuffer - Audio data buffer
 * @param {string} language - Language code (default: 'pt')
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeWithCodex(token, audioBuffer, language = 'pt') {
    const accountId = extractAccountId(token);
    if (!accountId) {
        throw new Error('Failed to extract account ID from OAuth token. Please re-login with Codex CLI.');
    }

    const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

    // Detect audio format from header
    let format = 'webm';
    if (buffer.length > 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
        format = 'wav';
    }

    const base64Audio = buffer.toString('base64');

    const languageNames = {
        'pt': 'Portuguese',
        'en': 'English',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'it': 'Italian',
        'ja': 'Japanese',
        'ko': 'Korean',
        'zh': 'Chinese',
    };
    const langName = languageNames[language] || language;

    const mimeType = format === 'wav' ? 'audio/wav' : 'audio/webm';

    const input = [
        {
            role: 'user',
            content: [
                {
                    type: 'input_file',
                    file_data: `data:${mimeType};base64,${base64Audio}`,
                },
                {
                    type: 'input_text',
                    text: `Transcribe ALL the spoken words in this audio COMPLETELY, word for word in ${langName}. Do NOT summarize or shorten. Return ONLY the transcription text, nothing else.`,
                },
            ],
        },
    ];

    const headers = buildHeaders(accountId, token);
    const instructions = 'You are a transcription assistant. Output only the exact transcribed text from the audio, nothing else.';
    const attempts = buildAttemptList(null, CODEX_TRANSCRIPTION_FALLBACK_CHAIN);

    console.log(`[Codex Transcription] Transcribing audio (${buffer.length} bytes, format: ${format})`);

    let lastError;
    for (let i = 0; i < attempts.length; i++) {
        const attemptModel = attempts[i];
        const body = {
            model: attemptModel,
            store: false,
            stream: true,
            instructions,
            input,
        };

        if (i === 0) {
            console.log(`[Codex Transcription] Using model ${attemptModel}`);
        } else {
            console.warn(`[Codex Transcription] Retrying with fallback model: ${attemptModel}`);
        }

        const response = await fetch(CODEX_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (response.ok) {
            const result = await parseSSEResponse(response);
            if (!result) throw new Error('Codex transcription returned empty response');
            console.log(`[Codex Transcription] Success with ${attemptModel}, length: ${result.length} chars`);
            return result;
        }

        const errorText = await response.text();
        const errorMessage = parseCodexError(errorText);
        lastError = new Error(`Codex transcription error (${response.status}): ${errorMessage}`);

        if (response.status === 400 && isModelNotSupportedError(errorMessage)) {
            console.warn(`[Codex Transcription] Model ${attemptModel} rejected: ${errorMessage}`);
            continue;
        }

        console.error(`[Codex Transcription] Error ${response.status}:`, errorText);
        throw lastError;
    }

    throw new Error(
        `Codex backend rejected every transcription model in the fallback chain (tried: ${attempts.join(', ')}). ` +
        `Last error: ${lastError?.message || 'unknown'}.`
    );
}

module.exports = {
    getCodexResponse,
    transcribeWithCodex,
    resolveCodexModel,
    extractAccountId,
    isCodexCompatibleModel,
    CODEX_MODELS,
};
