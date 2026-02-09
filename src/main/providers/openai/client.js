/**
 * VARS - OpenAI Client
 * Client initialization for OpenAI
 * Supports both API key and Codex CLI OAuth token authentication.
 * 
 * When a Codex OAuth token is used, the ChatGPT-Account-Id header is
 * automatically extracted from the JWT and sent with every request.
 */

const OpenAI = require('openai');
const { getValidAccessToken, readCodexCredentials } = require('./codex-auth');

const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

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
            payload.account_id ||
            null;
    } catch {
        return null;
    }
}

/**
 * Detect if a key looks like a Codex OAuth JWT (not a standard sk-... API key)
 * @param {string} apiKey
 * @returns {boolean}
 */
function isOAuthToken(apiKey) {
    return apiKey && !apiKey.startsWith('sk-') && apiKey.includes('.');
}

/**
 * Get initialized OpenAI client.
 * 
 * If the apiKey is a Codex OAuth JWT token (detected automatically),
 * the ChatGPT-Account-Id header is extracted and added to all requests.
 * 
 * @param {string} apiKey - OpenAI API key or OAuth access token
 * @returns {OpenAI} OpenAI client instance
 */
function getClient(apiKey) {
    const clientOpts = { apiKey };

    // Automatically detect OAuth tokens and add the required header
    if (isOAuthToken(apiKey)) {
        const accountId = extractAccountId(apiKey);
        if (accountId) {
            clientOpts.defaultHeaders = {
                'ChatGPT-Account-Id': accountId,
            };
            console.log('[OpenAI Client] Using OAuth token with ChatGPT-Account-Id');
        }
    }

    return new OpenAI(clientOpts);
}

/**
 * Get OpenAI client using Codex CLI OAuth token
 * Falls back to API key if Codex auth is not available
 * @param {string} apiKey - Fallback API key
 * @param {boolean} useCodexAuth - Whether to try Codex auth first
 * @returns {Promise<OpenAI>} OpenAI client instance
 */
async function getClientWithCodexAuth(apiKey, useCodexAuth = false) {
    if (useCodexAuth) {
        try {
            const tokenData = await getValidAccessToken();
            if (tokenData && tokenData.accessToken) {
                console.log('[OpenAI Client] Using Codex CLI OAuth token');
                return getClient(tokenData.accessToken);
            }
        } catch (err) {
            console.warn('[OpenAI Client] Codex auth failed, falling back to API key:', err.message);
        }
    }

    return getClient(apiKey);
}

/**
 * Check if Codex CLI credentials are available (sync, no validation)
 * @returns {boolean}
 */
function hasCodexCredentials() {
    const creds = readCodexCredentials();
    return creds !== null;
}

module.exports = { getClient, getClientWithCodexAuth, hasCodexCredentials, isOAuthToken };
