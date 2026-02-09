/**
 * VARS - API Key & Authentication Module
 * Handles connection type selection, API key inputs, testing, and Codex CLI authentication
 */

import { elements } from '../ui/elements.js';
import { state } from '../state/index.js';
import { autoSaveConfig } from './auto-save.js';

/**
 * Initialize connection type selector and apply current config
 */
export function initConnectionType() {
    const connectionSelect = document.getElementById('connection-type');

    if (connectionSelect) {
        connectionSelect.addEventListener('change', () => {
            updateConnectionUI(connectionSelect.value);
            autoSaveConfig();
        });
    }

    // Apply saved connection type
    const savedType = state.config.connectionType || 'oauth';
    if (connectionSelect) connectionSelect.value = savedType;
    updateConnectionUI(savedType);
}

/**
 * Update the connection UI based on the selected type
 * Shows the relevant content section (OAuth login, OpenAI key, or Gemini key)
 */
export function updateConnectionUI(type) {
    const oauthContent = document.getElementById('connection-oauth-content');
    const openaiContent = document.getElementById('connection-openai-api-content');
    const googleContent = document.getElementById('connection-google-api-content');

    // Hide all
    oauthContent?.classList.add('hidden');
    openaiContent?.classList.add('hidden');
    googleContent?.classList.add('hidden');

    // Show the relevant section
    if (type === 'oauth') {
        oauthContent?.classList.remove('hidden');
        checkCodexAuthStatus();
    } else if (type === 'openai-api') {
        openaiContent?.classList.remove('hidden');
    } else if (type === 'google-api') {
        googleContent?.classList.remove('hidden');
    }
}

/**
 * Tests the API Key connectivity for the given provider.
 * Shows visual feedback for success/failure.
 */
export async function testAPIKey(providerType) {
    // Determine provider from the connection type or argument
    const provider = providerType === 'google' ? 'google' : 'openai';

    const testBtn = provider === 'google'
        ? document.getElementById('test-google-api-btn')
        : document.getElementById('test-api-btn');

    const testStatus = provider === 'google'
        ? document.getElementById('google-api-test-status')
        : document.getElementById('api-test-status');

    if (!testStatus) return;

    const apiKey = provider === 'google'
        ? elements.googleApiKeyInput?.value?.trim()
        : elements.apiKeyInput?.value?.trim();

    if (!apiKey) {
        testStatus.textContent = 'Please enter an API key first';
        testStatus.className = 'api-test-status error';
        return;
    }

    // Show loading state
    if (testBtn) {
        testBtn.disabled = true;
        testBtn.classList.add('testing');
    }
    testStatus.textContent = 'Testing...';
    testStatus.className = 'api-test-status testing';

    const tier = 'balanced';

    try {
        const result = await window.electronAPI.testAPIKey(provider, apiKey, tier);

        if (result.success) {
            testStatus.textContent = '✓ Connection successful';
            testStatus.className = 'api-test-status success';
            if (testBtn) testBtn.classList.add('success');
        } else {
            testStatus.textContent = result.error || 'Connection failed';
            testStatus.className = 'api-test-status error';
        }
    } catch (error) {
        testStatus.textContent = 'Test failed: ' + error.message;
        testStatus.className = 'api-test-status error';
    } finally {
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.classList.remove('testing');
        }

        // Clear status after 5 seconds
        setTimeout(() => {
            testStatus.textContent = '';
            testStatus.className = 'api-test-status';
            if (testBtn) testBtn.classList.remove('success');
        }, 5000);
    }
}

// --- Codex CLI Authentication ---

/**
 * Check and display Codex CLI authentication status
 */
export async function checkCodexAuthStatus() {
    const statusDot = document.getElementById('codex-status-dot');
    const statusText = document.getElementById('codex-status-text');
    const loginBtn = document.getElementById('codex-login-btn');
    const logoutBtn = document.getElementById('codex-logout-btn');
    const apiKeyInput = elements.apiKeyInput;

    if (!statusDot || !statusText) return;

    // Show loading state
    statusDot.className = 'codex-status-dot checking';
    statusText.textContent = 'Checking...';

    try {
        const status = await window.electronAPI.codexAuth.status();

        if (status.authenticated) {
            statusDot.className = 'codex-status-dot connected';
            statusText.textContent = status.message || 'Connected via Codex CLI';
            statusText.title = status.accountId ? `Account: ${status.accountId}` : '';

            // Show logout, hide login
            if (loginBtn) loginBtn.classList.add('hidden');
            if (logoutBtn) logoutBtn.classList.remove('hidden');

            // If useCodexAuth is enabled in config, dim the API key input
            if (state.config.useCodexAuth) {
                if (apiKeyInput) {
                    apiKeyInput.placeholder = 'Using Codex CLI credentials';
                    apiKeyInput.classList.add('codex-active');
                }
            }
        } else {
            statusDot.className = 'codex-status-dot disconnected';
            statusText.textContent = status.message || 'Not connected';

            // Show login, hide logout
            if (loginBtn) loginBtn.classList.remove('hidden');
            if (logoutBtn) logoutBtn.classList.add('hidden');

            // Reset API key input state
            if (apiKeyInput) {
                apiKeyInput.placeholder = 'sk-...';
                apiKeyInput.classList.remove('codex-active');
            }
        }
    } catch (error) {
        statusDot.className = 'codex-status-dot error';
        statusText.textContent = 'Error checking status';
        console.error('[Codex Auth] Status check error:', error);
    }
}

/**
 * Handle Codex CLI login button click
 */
export async function handleCodexLogin() {
    const loginBtn = document.getElementById('codex-login-btn');
    const statusText = document.getElementById('codex-status-text');
    const statusDot = document.getElementById('codex-status-dot');

    if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.classList.add('loading');
    }

    if (statusDot) statusDot.className = 'codex-status-dot checking';
    if (statusText) statusText.textContent = 'Connecting...';

    try {
        const result = await window.electronAPI.codexAuth.login();

        if (result.success) {
            if (statusText) statusText.textContent = result.message || 'Connected!';
            if (statusDot) statusDot.className = 'codex-status-dot connected';

            // Update config
            state.config.useCodexAuth = true;
            await autoSaveConfig();

            // Refresh full status
            await checkCodexAuthStatus();
        } else if (result.needsSetup) {
            if (statusText) statusText.textContent = 'Install Codex CLI first (see browser)';
            if (statusDot) statusDot.className = 'codex-status-dot disconnected';
        } else {
            if (statusText) statusText.textContent = result.message || 'Connection failed';
            if (statusDot) statusDot.className = 'codex-status-dot error';
        }
    } catch (error) {
        if (statusText) statusText.textContent = 'Login failed: ' + error.message;
        if (statusDot) statusDot.className = 'codex-status-dot error';
    } finally {
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.classList.remove('loading');
        }
    }
}

/**
 * Handle Codex CLI disconnect button click
 */
export async function handleCodexDisconnect() {
    const logoutBtn = document.getElementById('codex-logout-btn');

    if (logoutBtn) {
        logoutBtn.disabled = true;
    }

    try {
        await window.electronAPI.codexAuth.disconnect();

        // Update config
        state.config.useCodexAuth = false;
        await autoSaveConfig();

        // Refresh status
        await checkCodexAuthStatus();
    } catch (error) {
        console.error('[Codex Auth] Disconnect error:', error);
    } finally {
        if (logoutBtn) {
            logoutBtn.disabled = false;
        }
    }
}

/**
 * Initialize Codex auth UI event listeners and API key test buttons
 */
export function initCodexAuth() {
    const loginBtn = document.getElementById('codex-login-btn');
    const logoutBtn = document.getElementById('codex-logout-btn');

    if (loginBtn) {
        loginBtn.addEventListener('click', handleCodexLogin);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleCodexDisconnect);
    }

    // OpenAI API test button
    const testApiBtn = document.getElementById('test-api-btn');
    if (testApiBtn) {
        testApiBtn.addEventListener('click', () => testAPIKey('openai'));
    }

    // Gemini API test button
    const testGoogleBtn = document.getElementById('test-google-api-btn');
    if (testGoogleBtn) {
        testGoogleBtn.addEventListener('click', () => testAPIKey('google'));
    }

    // Initial status check if OAuth is the connection type
    const connectionType = state.config.connectionType || 'oauth';
    if (connectionType === 'oauth') {
        checkCodexAuthStatus();
    }
}
