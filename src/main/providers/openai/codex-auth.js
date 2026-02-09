/**
 * VARS - Codex CLI Authentication
 * OAuth PKCE login flow for OpenAI, allowing users to use their ChatGPT Plus/Pro credits.
 * 
 * Supports:
 * - Full OAuth PKCE login via browser (same flow as Codex CLI / OpenClaw)
 * - Reading existing credentials from ~/.codex/auth.json
 * - Reading from macOS Keychain ("Codex Auth" entry)
 * - Token refresh via OpenAI's OAuth token endpoint
 * 
 * Based on the approach used by OpenClaw (https://github.com/openclaw/openclaw)
 * and @mariozechner/pi-ai loginOpenAICodex
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const { execSync } = require('child_process');

const CODEX_AUTH_FILENAME = 'auth.json';
const CODEX_HOME_ENV = 'CODEX_HOME';

// OAuth constants (matching Codex CLI / pi-ai)
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const OAUTH_SCOPE = 'openid profile email offline_access';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';
const CALLBACK_PORT = 1455;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authentication successful</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0; }
    .container { text-align: center; }
    h1 { color: #10b981; font-size: 1.5rem; }
    p { color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <h1>\u2713 Authentication successful</h1>
    <p>You can close this tab and return to VARS.</p>
  </div>
</body>
</html>`;

/**
 * Resolve the path to the Codex CLI home directory
 */
function resolveCodexHomePath() {
    if (process.env[CODEX_HOME_ENV]) {
        return process.env[CODEX_HOME_ENV];
    }
    return path.join(os.homedir(), '.codex');
}

/**
 * Resolve the path to the Codex CLI auth.json file
 */
function resolveCodexAuthPath() {
    return path.join(resolveCodexHomePath(), CODEX_AUTH_FILENAME);
}

/**
 * Compute the Keychain account name (hash of codex home path)
 * Matches how Codex CLI stores credentials on macOS
 */
function computeKeychainAccount(codexHome) {
    return crypto.createHash('sha256').update(codexHome).digest('hex').slice(0, 16);
}

/**
 * Read credentials from macOS Keychain
 * @returns {object|null} Credentials object or null
 */
function readKeychainCredentials() {
    if (process.platform !== 'darwin') {
        return null;
    }

    try {
        const codexHome = resolveCodexHomePath();
        const account = computeKeychainAccount(codexHome);

        const secret = execSync(
            `security find-generic-password -s "Codex Auth" -a "${account}" -w`,
            {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe']
            }
        ).trim();

        const parsed = JSON.parse(secret);
        const tokens = parsed.tokens;

        if (!tokens || typeof tokens !== 'object') {
            return null;
        }

        const accessToken = tokens.access_token;
        const refreshToken = tokens.refresh_token;

        if (typeof accessToken !== 'string' || !accessToken) {
            return null;
        }
        if (typeof refreshToken !== 'string' || !refreshToken) {
            return null;
        }

        // Extract accountId from JWT if possible
        const accountId = extractAccountIdFromToken(accessToken);

        // Estimate expiry from last_refresh or default to 1 hour from now
        let expires;
        if (parsed.last_refresh) {
            expires = new Date(parsed.last_refresh).getTime() + 60 * 60 * 1000;
        } else {
            expires = Date.now() + 60 * 60 * 1000;
        }

        return {
            type: 'oauth',
            provider: 'openai-codex',
            accessToken,
            refreshToken,
            expires,
            accountId,
            source: 'keychain'
        };
    } catch {
        return null;
    }
}

/**
 * Read credentials from ~/.codex/auth.json
 * @returns {object|null} Credentials object or null
 */
function readFileCredentials() {
    try {
        const authPath = resolveCodexAuthPath();

        if (!fs.existsSync(authPath)) {
            return null;
        }

        const raw = fs.readFileSync(authPath, 'utf8');
        const data = JSON.parse(raw);
        const tokens = data.tokens;

        if (!tokens || typeof tokens !== 'object') {
            return null;
        }

        const accessToken = tokens.access_token;
        const refreshToken = tokens.refresh_token;

        if (typeof accessToken !== 'string' || !accessToken) {
            return null;
        }
        if (typeof refreshToken !== 'string' || !refreshToken) {
            return null;
        }

        // Extract accountId from JWT if possible
        const accountId = tokens.account_id || extractAccountIdFromToken(accessToken);

        // Estimate expiry from file mtime + 1 hour
        let expires;
        try {
            const stat = fs.statSync(authPath);
            expires = stat.mtimeMs + 60 * 60 * 1000;
        } catch {
            expires = Date.now() + 60 * 60 * 1000;
        }

        return {
            type: 'oauth',
            provider: 'openai-codex',
            accessToken,
            refreshToken,
            expires,
            accountId,
            source: 'file'
        };
    } catch {
        return null;
    }
}

/**
 * Extract accountId from a JWT access token (without verification)
 * @param {string} token - JWT token
 * @returns {string|undefined} Account ID if found
 */
function extractAccountIdFromToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return undefined;

        const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf8')
        );

        return payload.account_id ||
            payload[JWT_CLAIM_PATH]?.chatgpt_account_id ||
            payload[JWT_CLAIM_PATH]?.account_id ||
            undefined;
    } catch {
        return undefined;
    }
}

// ============================================================================
// OAuth PKCE Login Flow
// ============================================================================

/**
 * Generate PKCE code verifier and challenge
 */
async function generatePKCE() {
    const verifierBytes = crypto.randomBytes(32);
    const verifier = verifierBytes.toString('base64url');
    const challengeBuffer = crypto.createHash('sha256').update(verifier).digest();
    const challenge = Buffer.from(challengeBuffer).toString('base64url');
    return { verifier, challenge };
}

/**
 * Build the OAuth authorization URL
 */
function buildAuthorizationUrl(challenge, state) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', OAUTH_SCOPE);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('id_token_add_organizations', 'true');
    url.searchParams.set('codex_cli_simplified_flow', 'true');
    url.searchParams.set('originator', 'vars');
    return url.toString();
}

/**
 * Start a local HTTP server to capture the OAuth callback
 */
function startCallbackServer(expectedState) {
    return new Promise((resolve, reject) => {
        let resolved = false;
        let codeResolve;
        let codeReject;

        const codePromise = new Promise((res, rej) => {
            codeResolve = res;
            codeReject = rej;
        });

        const server = http.createServer((req, res) => {
            try {
                const url = new URL(req.url || '', 'http://localhost');

                if (url.pathname !== '/auth/callback') {
                    res.statusCode = 404;
                    res.end('Not found');
                    return;
                }

                const state = url.searchParams.get('state');
                if (state !== expectedState) {
                    res.statusCode = 400;
                    res.end('State mismatch');
                    return;
                }

                const code = url.searchParams.get('code');
                if (!code) {
                    res.statusCode = 400;
                    res.end('Missing authorization code');
                    return;
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end(SUCCESS_HTML);

                codeResolve({ code });
            } catch (err) {
                res.statusCode = 500;
                res.end('Server error');
            }
        });

        server.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                reject(new Error(`Failed to start callback server on port ${CALLBACK_PORT}: ${err.message}`));
            }
        });

        server.listen(CALLBACK_PORT, '127.0.0.1', () => {
            resolved = true;
            const timeoutId = setTimeout(() => {
                codeResolve(null);
            }, LOGIN_TIMEOUT_MS);

            resolve({
                waitForCode: () => codePromise,
                close: () => {
                    clearTimeout(timeoutId);
                    server.close();
                },
                cancelWait: () => {
                    codeResolve(null);
                },
            });
        });
    });
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code, verifier) {
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code,
            code_verifier: verifier,
            redirect_uri: REDIRECT_URI,
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    const json = await response.json();

    if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
        throw new Error('Token response missing required fields');
    }

    return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expires: Date.now() + json.expires_in * 1000,
    };
}

/**
 * Save OAuth credentials to ~/.codex/auth.json
 * This makes them available to Codex CLI as well
 */
function saveCredentials(accessToken, refreshToken, accountId) {
    const codexHome = resolveCodexHomePath();
    const authPath = resolveCodexAuthPath();

    // Ensure directory exists
    if (!fs.existsSync(codexHome)) {
        fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    }

    const data = {
        tokens: {
            access_token: accessToken,
            refresh_token: refreshToken,
            ...(accountId ? { account_id: accountId } : {}),
        },
    };

    fs.writeFileSync(authPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    console.log('[Codex Auth] Credentials saved to', authPath);
}

/**
 * Full OAuth PKCE login flow:
 * 1. Generate PKCE verifier/challenge + state
 * 2. Start local callback server on port 1455
 * 3. Open browser to OpenAI authorize URL
 * 4. Wait for callback with authorization code
 * 5. Exchange code for tokens
 * 6. Save credentials
 * 
 * @param {Function} openUrl - Function to open URL in browser (e.g., shell.openExternal)
 * @returns {Promise<object>} Login result
 */
async function loginWithOAuth(openUrl) {
    console.log('[Codex Auth] Starting OAuth PKCE login flow...');

    const { verifier, challenge } = await generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = buildAuthorizationUrl(challenge, state);

    // Start local server to capture callback
    let server;
    try {
        server = await startCallbackServer(state);
    } catch (err) {
        throw new Error(`Could not start OAuth callback server: ${err.message}. ` +
            'Make sure port 1455 is not in use.');
    }

    try {
        // Open browser for authentication
        await openUrl(authUrl);
        console.log('[Codex Auth] Browser opened for OpenAI authentication');

        // Wait for the callback
        const result = await server.waitForCode();

        if (!result || !result.code) {
            throw new Error('Authentication timed out. Please try again.');
        }

        console.log('[Codex Auth] Authorization code received, exchanging for tokens...');

        // Exchange code for tokens
        const tokens = await exchangeCodeForTokens(result.code, verifier);
        const accountId = extractAccountIdFromToken(tokens.accessToken);

        if (!accountId) {
            console.warn('[Codex Auth] Could not extract accountId from token');
        }

        // Save credentials to ~/.codex/auth.json
        saveCredentials(tokens.accessToken, tokens.refreshToken, accountId);

        console.log('[Codex Auth] OAuth login successful!');

        return {
            success: true,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expires: tokens.expires,
            accountId,
        };
    } finally {
        server.close();
    }
}

/**
 * Read Codex CLI credentials from all available sources
 * Priority: macOS Keychain > File
 * @returns {object|null} Credentials object or null
 */
function readCodexCredentials() {
    // Try macOS Keychain first (most secure)
    const keychainCreds = readKeychainCredentials();
    if (keychainCreds) {
        console.log('[Codex Auth] Found credentials in macOS Keychain');
        return keychainCreds;
    }

    // Fall back to file
    const fileCreds = readFileCredentials();
    if (fileCreds) {
        console.log('[Codex Auth] Found credentials in ~/.codex/auth.json');
        return fileCreds;
    }

    console.log('[Codex Auth] No Codex CLI credentials found');
    return null;
}

/**
 * Refresh an expired access token using the refresh token
 * @param {string} refreshToken - The refresh token
 * @returns {Promise<object|null>} New credentials or null on failure
 */
async function refreshAccessToken(refreshToken) {
    try {
        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: CLIENT_ID,
            }).toString(),
        });

        if (!response.ok) {
            console.error('[Codex Auth] Token refresh failed:', response.status);
            return null;
        }

        const data = await response.json();

        if (!data.access_token) {
            console.error('[Codex Auth] No access_token in refresh response');
            return null;
        }

        const accountId = extractAccountIdFromToken(data.access_token);

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            expires: Date.now() + (data.expires_in || 3600) * 1000,
            accountId,
        };
    } catch (error) {
        console.error('[Codex Auth] Token refresh error:', error.message);
        return null;
    }
}

/**
 * Get a valid access token, refreshing if needed
 * @returns {Promise<object>} Object with { accessToken, accountId } or throws
 */
async function getValidAccessToken() {
    const creds = readCodexCredentials();

    if (!creds) {
        throw new Error('No Codex CLI credentials found. Please install and authenticate with Codex CLI first.');
    }

    // Check if token is likely expired (with 5 min buffer)
    const isExpired = creds.expires < (Date.now() + 5 * 60 * 1000);

    if (!isExpired) {
        return {
            accessToken: creds.accessToken,
            accountId: creds.accountId,
            source: creds.source,
        };
    }

    console.log('[Codex Auth] Token appears expired, attempting refresh...');
    const refreshed = await refreshAccessToken(creds.refreshToken);

    if (!refreshed) {
        // Token might still work even if we think it's expired
        console.log('[Codex Auth] Refresh failed, using existing token');
        return {
            accessToken: creds.accessToken,
            accountId: creds.accountId,
            source: creds.source,
        };
    }

    // Update the auth.json file with refreshed tokens
    try {
        const authPath = resolveCodexAuthPath();
        if (fs.existsSync(authPath)) {
            const raw = fs.readFileSync(authPath, 'utf8');
            const data = JSON.parse(raw);
            data.tokens = {
                ...data.tokens,
                access_token: refreshed.accessToken,
                refresh_token: refreshed.refreshToken,
            };
            fs.writeFileSync(authPath, JSON.stringify(data, null, 2), 'utf8');
            console.log('[Codex Auth] Updated auth.json with refreshed token');
        }
    } catch (err) {
        console.warn('[Codex Auth] Failed to update auth.json:', err.message);
    }

    return {
        accessToken: refreshed.accessToken,
        accountId: refreshed.accountId,
        source: 'refreshed',
    };
}

/**
 * Decode JWT payload to check token validity (without signature verification)
 * @param {string} token - JWT token
 * @returns {object|null} Decoded payload or null
 */
function decodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

/**
 * Check the status of Codex CLI authentication.
 * 
 * NOTE: Codex OAuth tokens (ChatGPT subscription) do NOT have access to the
 * standard OpenAI API endpoints like /v1/models (returns 403). They only work
 * with the Codex-specific API. So we validate by decoding the JWT and checking
 * its structure/expiry instead of making an HTTP call.
 * 
 * @returns {Promise<object>} Status object
 */
async function checkCodexAuthStatus() {
    const creds = readCodexCredentials();

    if (!creds) {
        return {
            authenticated: false,
            source: null,
            message: 'Not authenticated. Click "Login with OpenAI" to sign in.',
        };
    }

    const isExpired = creds.expires < Date.now();
    const isExpiringSoon = creds.expires < (Date.now() + 5 * 60 * 1000);

    // Validate token by decoding its JWT payload
    const payload = decodeJwtPayload(creds.accessToken);

    if (!payload) {
        return {
            authenticated: false,
            source: creds.source,
            message: 'Invalid token format. Please log in again.',
        };
    }

    // Check JWT expiry (exp claim is in seconds)
    const jwtExpired = payload.exp ? (payload.exp * 1000) < Date.now() : isExpired;

    if (jwtExpired) {
        // Try to refresh the token
        if (creds.refreshToken) {
            console.log('[Codex Auth] Token expired, attempting refresh...');
            const refreshed = await refreshAccessToken(creds.refreshToken);
            if (refreshed) {
                // Update saved credentials
                try {
                    saveCredentials(refreshed.accessToken, refreshed.refreshToken, refreshed.accountId);
                } catch (e) {
                    console.warn('[Codex Auth] Failed to save refreshed token:', e.message);
                }
                return {
                    authenticated: true,
                    source: 'refreshed',
                    accountId: refreshed.accountId,
                    message: 'Connected to OpenAI (token refreshed)',
                    expires: refreshed.expires,
                    expiringSoon: false,
                };
            }
        }

        return {
            authenticated: false,
            source: creds.source,
            message: 'Token expired. Please log in again.',
        };
    }

    // Token is valid — extract account info for display
    const accountId = creds.accountId || extractAccountIdFromToken(creds.accessToken);
    const email = payload.email || payload.preferred_username || null;

    return {
        authenticated: true,
        source: creds.source,
        accountId,
        email,
        message: email ? `Connected as ${email}` : 'Connected to OpenAI',
        expires: payload.exp ? payload.exp * 1000 : creds.expires,
        expiringSoon: isExpiringSoon,
    };
}

/**
 * Disconnect Codex auth — clear credentials from ~/.codex/auth.json and keychain
 * @returns {object} Result of disconnect
 */
function disconnectCodexAuth() {
    try {
        // Delete ~/.codex/auth.json
        const authPath = resolveCodexAuthPath();
        if (fs.existsSync(authPath)) {
            fs.unlinkSync(authPath);
            console.log('[Codex Auth] Deleted', authPath);
        }

        // Remove from macOS Keychain
        if (process.platform === 'darwin') {
            try {
                const codexHome = resolveCodexHomePath();
                const account = computeKeychainAccount(codexHome);
                execSync(
                    `security delete-generic-password -s "Codex Auth" -a "${account}"`,
                    { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
                );
                console.log('[Codex Auth] Removed Keychain entry');
            } catch {
                // Keychain entry may not exist, that's fine
            }
        }
    } catch (error) {
        console.error('[Codex Auth] Error clearing credentials:', error.message);
    }

    return {
        success: true,
        message: 'Codex authentication disconnected and credentials cleared.',
    };
}

module.exports = {
    readCodexCredentials,
    getValidAccessToken,
    checkCodexAuthStatus,
    disconnectCodexAuth,
    loginWithOAuth,
    resolveCodexHomePath,
    resolveCodexAuthPath,
};
