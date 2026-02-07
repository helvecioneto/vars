/**
 * VARS - Configuration IPC Handlers
 * Handles configuration, models, and API key testing
 */

const { ipcMain } = require('electron');
const { saveConfig, getModels, getModelForTier } = require('../config');

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
}

module.exports = { setupConfigHandlers };
