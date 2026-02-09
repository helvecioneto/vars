/**
 * VARS - Configuration IPC Handlers
 * Handles configuration, models, and API key testing
 */

const { ipcMain, shell } = require('electron');
const { saveConfig, getModels, getModelForTier } = require('../config');
const { checkCodexAuthStatus, disconnectCodexAuth, readCodexCredentials, getValidAccessToken, loginWithOAuth } = require('../providers/openai/codex-auth');

/**
 * Setup configuration-related IPC handlers
 * @param {object} context - Context with getConfig, setConfig
 */
function setupConfigHandlers(context) {
    const { getConfig, setConfig } = context;

    // Get current configuration
    ipcMain.handle('get-config', async () => {
        return getConfig();
    });

    // Save configuration
    ipcMain.handle('save-config', async (event, newConfig) => {
        const config = getConfig();
        const updatedConfig = { ...config, ...newConfig };
        setConfig(updatedConfig);
        await saveConfig(updatedConfig);
        return updatedConfig;
    });

    // Get available models
    ipcMain.handle('get-models', async () => {
        return getModels();
    });

    // Test API key validity
    ipcMain.handle('test-api-key', async (event, provider, apiKey, tier) => {
        if (!apiKey) {
            return { success: false, error: 'API key is required' };
        }

        try {
            if (provider === 'google') {
                const { GoogleGenerativeAI } = require('@google/generative-ai');
                const genAI = new GoogleGenerativeAI(apiKey);

                let modelName = 'gemini-pro';
                try {
                    modelName = getModelForTier(provider, tier || 'balanced', 'analyze');
                } catch (e) {
                    console.warn('Failed to resolve model for tier in test, falling back to gemini-pro');
                }

                console.log(`Testing Google API with model: ${modelName}`);
                const model = genAI.getGenerativeModel({ model: modelName });
                await model.generateContent('test');
                return { success: true };
            } else {
                const OpenAI = require('openai');
                const openai = new OpenAI({ apiKey });
                await openai.models.list();
                return { success: true };
            }
        } catch (error) {
            console.error('API Key test error:', error.message);
            return {
                success: false,
                error: error.message.includes('401') || error.message.includes('invalid')
                    ? 'Invalid API key'
                    : error.message
            };
        }
    });

    // --- Codex CLI Authentication Handlers ---

    // Check Codex CLI auth status
    ipcMain.handle('codex-auth:status', async () => {
        try {
            return await checkCodexAuthStatus();
        } catch (error) {
            return {
                authenticated: false,
                source: null,
                message: error.message,
            };
        }
    });

    // Login with OpenAI OAuth (PKCE flow via browser)
    ipcMain.handle('codex-auth:login', async () => {
        try {
            // First check if credentials already exist and are valid
            const creds = readCodexCredentials();
            if (creds) {
                const status = await checkCodexAuthStatus();
                if (status.authenticated) {
                    // Already authenticated — just enable codex auth mode
                    const config = getConfig();
                    config.useCodexAuth = true;
                    setConfig(config);
                    await saveConfig(config);
                    return {
                        success: true,
                        message: 'Connected! Using your OpenAI credits.',
                        status,
                    };
                }
            }

            // Run the full OAuth PKCE login flow
            const result = await loginWithOAuth((url) => shell.openExternal(url));

            if (result.success) {
                // Enable codex auth mode in config
                const config = getConfig();
                config.useCodexAuth = true;
                setConfig(config);
                await saveConfig(config);
                return {
                    success: true,
                    message: 'Successfully logged in! Using your OpenAI credits.',
                    status: {
                        authenticated: true,
                        accountId: result.accountId,
                    },
                };
            }

            return { success: false, message: 'Login failed. Please try again.' };
        } catch (error) {
            return {
                success: false,
                message: error.message,
            };
        }
    });

    // Disconnect Codex CLI auth
    ipcMain.handle('codex-auth:disconnect', async () => {
        try {
            const config = getConfig();
            config.useCodexAuth = false;
            setConfig(config);
            await saveConfig(config);
            return disconnectCodexAuth();
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    // Get a valid access token for API calls
    ipcMain.handle('codex-auth:get-token', async () => {
        try {
            const tokenData = await getValidAccessToken();
            return { success: true, ...tokenData };
        } catch (error) {
            return { success: false, message: error.message };
        }
    });
}

module.exports = { setupConfigHandlers };
