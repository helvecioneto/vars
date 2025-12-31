/**
 * VARS - IPC Handlers Module
 * Handles all inter-process communication between main and renderer processes
 */

const { ipcMain, Menu } = require('electron');
const { saveConfig, getModels, getTierConfig, getModelForTier } = require('./config');
const {
    transcribeAudio,
    getSmartAIResponse,
    initializeAssistant,
    createKnowledgeBase,
    updateAssistantVectorStore,
    resetKnowledgeBase
} = require('./openai');
const { transcribeAudioGoogle, getGoogleAIResponse } = require('./google');
const { RealtimeTranscription } = require('./realtime');
const { GeminiRealtimeTranscription } = require('./gemini-realtime');

/**
 * Active realtime transcription session
 * @type {RealtimeTranscription|GeminiRealtimeTranscription|null}
 */
let activeRealtimeSession = null;

/**
 * Setup all IPC handlers
 * @param {object} context - Context object containing mainWindow, config, and saveConfig
 */
function setupIPCHandlers(context) {
    const { getMainWindow, getConfig, setConfig, toggleRecording } = context;

    // ==========================================
    // Recording Control
    // ==========================================

    ipcMain.on('toggle-recording', () => {
        toggleRecording();
    });

    // ==========================================
    // Configuration Handlers
    // ==========================================

    ipcMain.handle('get-config', async () => {
        return getConfig();
    });

    ipcMain.handle('save-config', async (event, newConfig) => {
        const config = getConfig();
        const updatedConfig = { ...config, ...newConfig };
        setConfig(updatedConfig);
        await saveConfig(updatedConfig);
        return updatedConfig;
    });

    ipcMain.handle('get-models', async () => {
        return getModels();
    });

    // ==========================================
    // Audio Transcription Handlers
    // ==========================================

    ipcMain.handle('transcribe-audio', async (event, audioBuffer) => {
        const config = getConfig();
        const provider = config.provider || 'openai';
        const apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

        if (!apiKey) {
            return { error: `${provider === 'google' ? 'Google' : 'OpenAI'} API key not configured` };
        }

        try {
            const tier = config.tier || 'balanced';
            const transcribeModel = getModelForTier(provider, tier, 'transcribe');

            let transcription;
            if (provider === 'google') {
                transcription = await transcribeAudioGoogle(audioBuffer, apiKey, transcribeModel);
            } else {
                transcription = await transcribeAudio(audioBuffer, apiKey, transcribeModel);
            }

            return { text: transcription };
        } catch (error) {
            return { error: error.message };
        }
    });

    // ==========================================
    // AI Response Handlers
    // ==========================================

    ipcMain.handle('get-ai-response', async (event, transcription) => {
        const config = getConfig();
        const provider = config.provider || 'openai';
        const apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

        if (!apiKey) {
            return { error: `${provider === 'google' ? 'Google' : 'OpenAI'} API key not configured` };
        }

        try {
            const tier = config.tier || 'balanced';
            const analyzeModel = getModelForTier(provider, tier, 'analyze');
            const tierConfig = getTierConfig(provider, tier);

            let result;

            if (provider === 'google') {
                result = await getGoogleAIResponse({
                    transcription,
                    params: {
                        apiKey: apiKey,
                        model: analyzeModel,
                        systemPrompt: config.systemPrompt,
                        language: config.language || 'en',
                        history: config.conversationHistory || [],
                        tierConfig: tierConfig,
                        briefMode: config.briefMode || false
                    }
                });
            } else {
                result = await getSmartAIResponse({
                    transcription,
                    params: {
                        apiKey: apiKey,
                        model: analyzeModel,
                        systemPrompt: config.systemPrompt,
                        language: config.language || 'en',
                        history: config.conversationHistory || [],
                        assistantId: config.assistantId,
                        vectorStoreId: config.vectorStoreId,
                        threadId: config.threadId,
                        knowledgeBasePaths: config.knowledgeBasePaths || [],
                        briefMode: config.briefMode || false,
                        tierConfig: tierConfig
                    }
                });

                // Save threadId if Assistant API was used
                if (result.threadId && result.threadId !== config.threadId) {
                    config.threadId = result.threadId;
                    setConfig(config);
                    saveConfig(config);
                }
            }

            return { response: result.response };
        } catch (error) {
            console.error('AI Response Error:', error);
            return { error: error.message };
        }
    });

    // ==========================================
    // API Key Test Handler
    // ==========================================

    ipcMain.handle('test-api-key', async (event, provider, apiKey, tier) => {
        if (!apiKey) {
            return { success: false, error: 'API key is required' };
        }

        try {
            if (provider === 'google') {
                // Test Google API with a simple model list request
                const { GoogleGenerativeAI } = require('@google/generative-ai');
                const genAI = new GoogleGenerativeAI(apiKey);

                // Get the specific model for the selected tier to test availability
                // Default to 'gemini-pro' if resolution fails, but prefer the configured model
                let modelName = 'gemini-pro';
                try {
                    modelName = getModelForTier(provider, tier || 'balanced', 'analyze');
                } catch (e) {
                    console.warn('Failed to resolve model for tier in test, falling back to gemini-pro');
                }

                console.log(`Testing Google API with model: ${modelName}`);
                const model = genAI.getGenerativeModel({ model: modelName });

                // Simple test - just try to get model info
                await model.generateContent('test');
                return { success: true };
            } else {
                // Test OpenAI API with a simple models list request
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

    // ==========================================
    // Knowledge Base Handlers
    // ==========================================

    ipcMain.handle('knowledge-base:create', async () => {
        const config = getConfig();
        if (!config.apiKey) return { error: 'API key not configured' };
        if (!config.knowledgeBasePaths || config.knowledgeBasePaths.length === 0) {
            return { error: 'No files to process' };
        }

        try {
            // Initialize or retrieve Assistant
            const assistant = await initializeAssistant(config.apiKey, config.assistantId);
            config.assistantId = assistant.id;

            // Create/Update Vector Store and upload files
            const vectorStoreId = await createKnowledgeBase(
                config.apiKey,
                config.knowledgeBasePaths,
                config.vectorStoreId
            );
            config.vectorStoreId = vectorStoreId;

            // Link Vector Store to Assistant
            await updateAssistantVectorStore(config.apiKey, config.assistantId, vectorStoreId);

            // Persist updated config
            setConfig(config);
            await saveConfig(config);

            return { success: true, count: config.knowledgeBasePaths.length };
        } catch (error) {
            console.error('KB Create Error:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('knowledge-base:reset', async () => {
        const config = getConfig();
        if (!config.apiKey) return { error: 'API key not configured' };

        try {
            await resetKnowledgeBase(config.apiKey, config.vectorStoreId);
            config.vectorStoreId = null;
            config.threadId = null;
            setConfig(config);
            await saveConfig(config);
            return { success: true };
        } catch (error) {
            console.error('KB Reset Error:', error);
            return { error: error.message };
        }
    });

    // ==========================================
    // Realtime Transcription Handlers
    // ==========================================

    ipcMain.handle('realtime-start', async () => {
        const config = getConfig();
        const provider = config.provider || 'openai';
        const apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

        console.log('[Realtime] Provider:', provider);
        console.log('[Realtime] API Key prefix:', apiKey ? apiKey.substring(0, 10) + '...' : 'NOT SET');

        if (!apiKey) {
            return { error: `${provider === 'google' ? 'Google' : 'OpenAI'} API key not configured` };
        }

        try {
            // Disconnect existing session if any
            if (activeRealtimeSession) {
                activeRealtimeSession.disconnect();
            }

            // Create appropriate realtime client based on provider
            if (provider === 'google') {
                console.log('[Realtime] Using Google Gemini Live API');
                activeRealtimeSession = new GeminiRealtimeTranscription(apiKey);
            } else {
                console.log('[Realtime] Using OpenAI Realtime API');
                activeRealtimeSession = new RealtimeTranscription(apiKey);
            }

            // Set up transcription callback
            activeRealtimeSession.onTranscription((text, isFinal) => {
                const mainWindow = getMainWindow();
                if (mainWindow) {
                    mainWindow.webContents.send('realtime-transcription', { text, isFinal });
                }
            });

            activeRealtimeSession.onError((error) => {
                const mainWindow = getMainWindow();
                if (mainWindow) {
                    mainWindow.webContents.send('realtime-error', { error: error.message });
                }
            });

            await activeRealtimeSession.connect();
            return { success: true, provider };
        } catch (error) {
            console.error('Realtime start error:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('realtime-audio', async (event, audioBuffer) => {
        if (!activeRealtimeSession || !activeRealtimeSession.isConnected) {
            return { error: 'Realtime session not started' };
        }

        try {
            const buffer = Buffer.from(audioBuffer);
            activeRealtimeSession.sendAudio(buffer);
            return { success: true };
        } catch (error) {
            return { error: error.message };
        }
    });

    ipcMain.handle('realtime-stop', async () => {
        if (!activeRealtimeSession) {
            return { text: '' };
        }

        try {
            activeRealtimeSession.commitAudio();
            const text = activeRealtimeSession.getFullTranscript();
            activeRealtimeSession.disconnect();
            activeRealtimeSession = null;
            return { text };
        } catch (error) {
            return { error: error.message };
        }
    });

    // ==========================================
    // External URL Handler
    // ==========================================

    ipcMain.handle('open-external', async (event, url) => {
        const { shell } = require('electron');
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Failed to open external URL:', error);
            return { success: false, error: error.message };
        }
    });

    // ==========================================
    // Window Control Handlers
    // ==========================================

    ipcMain.on('minimize-window', () => {
        const mainWindow = getMainWindow();
        if (mainWindow) mainWindow.hide();
    });

    ipcMain.on('close-window', () => {
        const mainWindow = getMainWindow();
        if (mainWindow) mainWindow.hide();
    });

    ipcMain.handle('show-context-menu', () => {
        const mainWindow = getMainWindow();
        const { app } = require('electron');

        const menu = Menu.buildFromTemplate([
            {
                label: 'Hide',
                click: () => {
                    if (mainWindow) mainWindow.hide();
                }
            },
            { type: 'separator' },
            {
                label: 'Exit',
                click: () => {
                    app.quit();
                }
            }
        ]);

        if (mainWindow) {
            menu.popup({ window: mainWindow });
        }
    });

    // ==========================================
    // Window Resize Handler
    // ==========================================

    let lastResizeTime = 0;
    const RESIZE_COOLDOWN = 1000;

    ipcMain.on('update-content-bounds', (event, bounds) => {
        const now = Date.now();
        if (now - lastResizeTime < RESIZE_COOLDOWN) return;

        const mainWindow = getMainWindow();
        if (mainWindow && bounds.width > 0 && bounds.height > 0) {
            const currentBounds = mainWindow.getBounds();
            const newHeight = Math.ceil(bounds.height);

            if (Math.abs(currentBounds.height - newHeight) > 20) {
                lastResizeTime = now;
                mainWindow.setSize(currentBounds.width, newHeight);
            }
        }
    });

    ipcMain.on('set-dragging', (event, dragging) => {
        // Kept for compatibility
    });
}

module.exports = { setupIPCHandlers };
