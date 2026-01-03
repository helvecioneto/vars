/**
 * VARS - IPC Handlers Module
 * Handles all inter-process communication between main and renderer processes
 */

const { ipcMain, Menu, desktopCapturer } = require('electron');
const { saveConfig, getModels, getTierConfig, getModelForTier, getModelListForTier, getRetryConfig } = require('./config');
const {
    transcribeAudio,
    getSmartAIResponse,
    initializeAssistant,
    createKnowledgeBase,
    updateAssistantVectorStore,
    resetKnowledgeBase,
    analyzeImageOpenAI
} = require('./openai');
const { transcribeAudioGoogle, getGoogleAIResponse, analyzeImageGoogle } = require('./google');
const { RealtimeTranscription } = require('./realtime');
const { GeminiRealtimeTranscription } = require('./gemini-realtime');
const systemAudio = require('./system-audio');
const screenCapture = require('./screen-capture');

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

            // Convert to Buffer if it's an array
            const buffer = Array.isArray(audioBuffer) ? Buffer.from(audioBuffer) : audioBuffer;

            let transcription;
            if (provider === 'google') {
                // For free tier, use model list with fallback
                if (tier === 'free') {
                    const modelList = getModelListForTier(provider, tier, 'transcribe');
                    const retryConfig = getRetryConfig(provider, tier);

                    // Create progress callback to notify renderer
                    const onProgress = (data) => {
                        const mainWindow = getMainWindow();
                        if (mainWindow) {
                            mainWindow.webContents.send('free-tier-retry', { type: 'transcribe', ...data });
                        }
                    };

                    transcription = await transcribeAudioGoogle(buffer, apiKey, modelList, retryConfig, onProgress);
                } else {
                    const transcribeModel = getModelForTier(provider, tier, 'transcribe');
                    transcription = await transcribeAudioGoogle(buffer, apiKey, transcribeModel);
                }
            } else {
                const transcribeModel = getModelForTier(provider, tier, 'transcribe');
                transcription = await transcribeAudio(buffer, apiKey, transcribeModel);
            }

            return { text: transcription };
        } catch (error) {
            // Check for quota exhaustion error
            if (error.isQuotaError) {
                return {
                    error: error.userMessage,
                    isQuotaError: true
                };
            }
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
            const tierConfig = getTierConfig(provider, tier);

            let result;

            if (provider === 'google') {
                // For free tier, use model list with fallback
                if (tier === 'free') {
                    const modelList = getModelListForTier(provider, tier, 'analyze');
                    const retryConfig = getRetryConfig(provider, tier);

                    // Create progress callback to notify renderer
                    const onProgress = (data) => {
                        const mainWindow = getMainWindow();
                        if (mainWindow) {
                            mainWindow.webContents.send('free-tier-retry', { type: 'analyze', ...data });
                        }
                    };

                    result = await getGoogleAIResponse({
                        transcription,
                        params: {
                            apiKey: apiKey,
                            models: modelList,
                            retryConfig: retryConfig,
                            onProgress: onProgress,
                            systemPrompt: config.systemPrompt,
                            language: config.language || 'en',
                            history: config.conversationHistory || [],
                            tierConfig: tierConfig,
                            briefMode: config.briefMode || false
                        }
                    });
                } else {
                    const analyzeModel = getModelForTier(provider, tier, 'analyze');
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
                }
            } else {
                const analyzeModel = getModelForTier(provider, tier, 'analyze');
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
            // Check for quota exhaustion error
            if (error.isQuotaError) {
                return {
                    error: error.userMessage,
                    isQuotaError: true
                };
            }
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

    // ==========================================
    // Desktop Capturer Handlers (for System Audio)
    // ==========================================

    ipcMain.handle('get-desktop-sources', async () => {
        try {
            const sources = await desktopCapturer.getSources({
                types: ['window', 'screen'],
                thumbnailSize: { width: 160, height: 100 },
                fetchWindowIcons: false
            });

            return sources.map(source => ({
                id: source.id,
                name: source.name,
                displayId: source.display_id || '',
                thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null
            }));
        } catch (error) {
            console.error('Failed to get desktop sources:', error);
            return [];
        }
    });

    // ==========================================
    // System Audio Capture Handlers (Linux PulseAudio/PipeWire)
    // ==========================================

    ipcMain.handle('system-audio:list-devices', async () => {
        try {
            const devices = await systemAudio.listAudioDevices();
            return { devices };
        } catch (error) {
            console.error('[System Audio] Error listing devices:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('system-audio:start-capture', async (event, { deviceName, sampleRate = 16000 }) => {
        try {
            // Start capture - audio is stored in internal buffer
            const success = systemAudio.startCapture(deviceName, sampleRate);

            if (success) {
                return { success: true };
            } else {
                return { error: 'Failed to start capture' };
            }
        } catch (error) {
            console.error('[System Audio] Error starting capture:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('system-audio:stop-capture', async () => {
        try {
            systemAudio.stopCapture();
            return { success: true };
        } catch (error) {
            console.error('[System Audio] Error stopping capture:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('system-audio:get-audio', async () => {
        try {
            const audioData = systemAudio.getAudioData();
            return { audio: audioData };
        } catch (error) {
            console.error('[System Audio] Error getting audio:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('system-audio:get-audio-final', async () => {
        try {
            const audioData = systemAudio.getAudioDataAndClear();
            return { audio: audioData };
        } catch (error) {
            console.error('[System Audio] Error getting final audio:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('system-audio:get-buffer-size', async () => {
        return { size: systemAudio.getBufferSize() };
    });

    ipcMain.handle('system-audio:is-capturing', async () => {
        return { capturing: systemAudio.isCapturing() };
    });

    // ==========================================
    // Screen Capture and Image Analysis Handlers
    // ==========================================

    ipcMain.handle('capture-screen', async () => {
        try {
            const result = await screenCapture.captureForegroundWindow();
            return result;
        } catch (error) {
            console.error('[Screen Capture] Error:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('analyze-image', async (event, { imageData, prompt, windowTitle }) => {
        const config = getConfig();
        const provider = config.provider || 'openai';
        const apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

        if (!apiKey) {
            return { error: `${provider === 'google' ? 'Google' : 'OpenAI'} API key not configured` };
        }

        try {
            const tier = config.tier || 'balanced';
            const tierConfig = getTierConfig(provider, tier);
            
            // Build the analysis prompt
            // If user provided a specific question, use it with context
            // Otherwise, use a smart default that analyzes and answers what's visible
            let contextualPrompt;
            
            if (prompt && prompt.trim()) {
                // User has a specific question
                contextualPrompt = windowTitle 
                    ? `[Screenshot: ${windowTitle}]\n\n${prompt}`
                    : prompt;
            } else {
                // No specific question - analyze everything visible and provide useful information
                contextualPrompt = `Analyze this screenshot${windowTitle ? ` from "${windowTitle}"` : ''}.

Look at everything visible and:
1. If there are questions, exercises, or problems visible, provide the answers or solutions
2. If there's code, explain what it does and identify any issues
3. If there's an error message, explain what it means and how to fix it
4. If there's text content, summarize the key information
5. If there's a form or interface, describe what actions can be taken

Be direct and helpful. Focus on actionable information.`;
            }

            let response;
            
            if (provider === 'google') {
                const analyzeModel = getModelForTier(provider, tier, 'analyze');
                response = await analyzeImageGoogle({
                    imageData,
                    prompt: contextualPrompt,
                    apiKey,
                    model: analyzeModel,
                    systemPrompt: config.systemPrompt,
                    language: config.language || 'en',
                    history: config.conversationHistory || [],
                    tierConfig,
                    briefMode: config.briefMode || false
                });
            } else {
                const analyzeModel = getModelForTier(provider, tier, 'analyze');
                response = await analyzeImageOpenAI({
                    imageData,
                    prompt: contextualPrompt,
                    apiKey,
                    model: analyzeModel,
                    systemPrompt: config.systemPrompt,
                    language: config.language || 'en',
                    history: config.conversationHistory || [],
                    tierConfig,
                    briefMode: config.briefMode || false
                });
            }

            return { response };
        } catch (error) {
            console.error('[Image Analysis] Error:', error);
            return { error: error.message };
        }
    });

    // ==========================================
    // Permission Check Handlers (macOS)
    // ==========================================

    ipcMain.handle('check-screen-permission', async () => {
        const { systemPreferences } = require('electron');
        
        if (process.platform !== 'darwin') {
            return { granted: true, status: 'granted' };
        }

        const status = systemPreferences.getMediaAccessStatus('screen');
        return { 
            granted: status === 'granted',
            status: status 
        };
    });

    ipcMain.handle('check-microphone-permission', async () => {
        const { systemPreferences } = require('electron');
        
        if (process.platform !== 'darwin') {
            return { granted: true, status: 'granted' };
        }

        const status = systemPreferences.getMediaAccessStatus('microphone');
        return { 
            granted: status === 'granted',
            status: status 
        };
    });

    ipcMain.handle('request-microphone-permission', async () => {
        const { systemPreferences } = require('electron');
        
        if (process.platform !== 'darwin') {
            return { granted: true };
        }

        try {
            const granted = await systemPreferences.askForMediaAccess('microphone');
            return { granted };
        } catch (error) {
            console.error('[Permission] Error requesting microphone:', error);
            return { granted: false, error: error.message };
        }
    });

    ipcMain.handle('open-system-preferences', async (event, panel) => {
        const { shell } = require('electron');
        
        if (process.platform === 'darwin') {
            // Open System Preferences to the appropriate panel
            if (panel === 'screen') {
                // Screen Recording is in Privacy & Security
                shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
            } else if (panel === 'microphone') {
                shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
            } else {
                shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy');
            }
            return { success: true };
        }
        
        return { success: false, error: 'Not macOS' };
    });
}

module.exports = { setupIPCHandlers };
