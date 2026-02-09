/**
 * VARS - Audio IPC Handlers
 * Handles audio transcription, realtime transcription, and system audio
 */

const { ipcMain } = require('electron');
const { getModelForTier, getModelListForTier, getRetryConfig } = require('../config');
const { transcribeAudio } = require('../providers/openai');
const { transcribeAudioGoogle } = require('../providers/google');
const { isOAuthToken } = require('../providers/openai/client');
const { RealtimeTranscription } = require('../providers/openai/realtime');
const { GeminiRealtimeTranscription } = require('../providers/google/realtime');
const systemAudio = require('../system-audio');
const { getValidAccessToken } = require('../providers/openai/codex-auth');
const { transcribeLocal, isLocalWhisperAvailable, isModelDownloaded, getModelsStatus, downloadModel, deleteModel, getLoadedModelInfo, DEFAULT_MODEL } = require('../providers/local');

// Active realtime transcription session
let activeRealtimeSession = null;

/**
 * Setup audio-related IPC handlers
 * @param {object} context - Context with getMainWindow, getConfig, toggleRecording
 */
function setupAudioHandlers(context) {
    const { getMainWindow, getConfig, toggleRecording } = context;

    // Toggle recording
    ipcMain.on('toggle-recording', () => {
        toggleRecording();
    });

    // Transcribe audio
    ipcMain.handle('transcribe-audio', async (event, audioBuffer) => {
        const config = getConfig();
        const transcriptionPreset = config.transcriptionPreset || 'local';

        // Local Whisper transcription — no API key needed
        if (transcriptionPreset === 'local') {
            try {
                const buffer = Array.isArray(audioBuffer) ? Buffer.from(audioBuffer) : audioBuffer;
                const language = config.language || 'auto';
                const modelName = config.whisperModel || DEFAULT_MODEL;
                const text = await transcribeLocal(buffer, language, modelName);
                return { text };
            } catch (error) {
                console.error('[Audio] Local Whisper error:', error.message);
                return { error: error.message };
            }
        }

        // Determine transcription provider and API key from preset
        let transcriptionProvider, apiKey;

        if (transcriptionPreset === 'openai-api') {
            // Use OpenAI Whisper with API key
            transcriptionProvider = 'openai';
            apiKey = config.apiKey;
        } else if (transcriptionPreset === 'google-api') {
            // Use Google Gemini for transcription
            transcriptionProvider = 'google';
            apiKey = config.googleApiKey;
        } else {
            // Fallback: legacy config support
            transcriptionProvider = config.provider || 'openai';
            apiKey = transcriptionProvider === 'google' ? config.googleApiKey : config.apiKey;
        }

        if (!apiKey) {
            return { error: `${transcriptionProvider === 'google' ? 'Google' : 'OpenAI'} API key not configured for transcription` };
        }

        try {
            const tier = config.tier || 'balanced';
            const buffer = Array.isArray(audioBuffer) ? Buffer.from(audioBuffer) : audioBuffer;

            let transcription;
            if (transcriptionProvider === 'google') {
                if (tier === 'free') {
                    const modelList = getModelListForTier('google', 'free', 'transcribe');
                    const retryConfig = getRetryConfig('google', 'free');
                    const onProgress = (data) => {
                        const mainWindow = getMainWindow();
                        if (mainWindow) {
                            mainWindow.webContents.send('free-tier-retry', { type: 'transcribe', ...data });
                        }
                    };
                    transcription = await transcribeAudioGoogle(buffer, apiKey, modelList, retryConfig, onProgress);
                } else {
                    const transcribeModel = getModelForTier('google', 'balanced', 'transcribe');
                    transcription = await transcribeAudioGoogle(buffer, apiKey, transcribeModel);
                }
            } else if (isOAuthToken(apiKey)) {
                // OAuth tokens can't use Whisper API — fall back
                const googleKey = config.googleApiKey;
                if (googleKey) {
                    console.log('[Audio] OAuth active — using Google Gemini for transcription');
                    transcription = await transcribeAudioGoogle(buffer, googleKey, 'gemini-2.0-flash-lite');
                } else if (isLocalWhisperAvailable() && await isModelDownloaded(DEFAULT_MODEL)) {
                    console.log('[Audio] OAuth active, no Google key — using Local Whisper');
                    transcription = await transcribeLocal(buffer, config.language || 'auto');
                } else {
                    throw new Error('OAuth transcription requires a Google API key, or download a Local Whisper model.');
                }
            } else {
                const transcribeModel = getModelForTier('openai', 'balanced', 'transcribe');
                transcription = await transcribeAudio(buffer, apiKey, transcribeModel);
            }

            return { text: transcription };
        } catch (error) {
            if (error.isQuotaError) {
                return { error: error.userMessage, isQuotaError: true };
            }
            return { error: error.message };
        }
    });

    // Realtime transcription - start
    ipcMain.handle('realtime-start', async () => {
        const config = getConfig();
        const provider = config.provider || 'openai';
        let apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

        // Try Codex auth for OpenAI if enabled
        if (provider !== 'google' && config.useCodexAuth) {
            let oauthToken = null;
            try {
                const tokenData = await getValidAccessToken();
                if (tokenData && tokenData.accessToken) {
                    oauthToken = tokenData.accessToken;
                }
            } catch (err) {
                console.warn('[Realtime] Codex auth failed:', err.message);
            }
            if (oauthToken) {
                apiKey = oauthToken;
            } else {
                // OAuth mode active but no valid token — do NOT fall back to API key
                console.warn('[Realtime] OAuth required but not authenticated.');
                apiKey = null;
            }
        }

        console.log('[Realtime] Provider:', provider);

        if (!apiKey) {
            return { error: `${provider === 'google' ? 'Google' : 'OpenAI'} API key not configured` };
        }

        try {
            if (activeRealtimeSession) {
                activeRealtimeSession.disconnect();
            }

            if (provider === 'google') {
                console.log('[Realtime] Using Google Gemini Live API');
                activeRealtimeSession = new GeminiRealtimeTranscription(apiKey);
            } else {
                console.log('[Realtime] Using OpenAI Realtime API');
                activeRealtimeSession = new RealtimeTranscription(apiKey);
            }

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

    // Realtime transcription - send audio
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

    // Realtime transcription - stop
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

    // System audio - list devices
    ipcMain.handle('system-audio:list-devices', async () => {
        try {
            const devices = await systemAudio.listAudioDevices();
            return { devices };
        } catch (error) {
            console.error('[System Audio] Error listing devices:', error);
            return { error: error.message };
        }
    });

    // System audio - start capture
    ipcMain.handle('system-audio:start-capture', async (event, { deviceName, sampleRate = 16000 }) => {
        try {
            const success = systemAudio.startCapture(deviceName, sampleRate);
            return success ? { success: true } : { error: 'Failed to start capture' };
        } catch (error) {
            console.error('[System Audio] Error starting capture:', error);
            return { error: error.message };
        }
    });

    // System audio - stop capture
    ipcMain.handle('system-audio:stop-capture', async () => {
        try {
            systemAudio.stopCapture();
            return { success: true };
        } catch (error) {
            console.error('[System Audio] Error stopping capture:', error);
            return { error: error.message };
        }
    });

    // System audio - get audio data
    ipcMain.handle('system-audio:get-audio', async () => {
        try {
            const audioData = systemAudio.getAudioData();
            return { audio: audioData };
        } catch (error) {
            return { error: error.message };
        }
    });

    // System audio - get final audio and clear
    ipcMain.handle('system-audio:get-audio-final', async () => {
        try {
            const audioData = systemAudio.getAudioDataAndClear();
            return { audio: audioData };
        } catch (error) {
            return { error: error.message };
        }
    });

    // System audio - buffer size
    ipcMain.handle('system-audio:get-buffer-size', async () => {
        return { size: systemAudio.getBufferSize() };
    });

    // System audio - is capturing
    ipcMain.handle('system-audio:is-capturing', async () => {
        return { capturing: systemAudio.isCapturing() };
    });

    // ======== Local Whisper Model Management ========

    // Check if local whisper is available on this platform
    ipcMain.handle('whisper:available', async () => {
        return { available: isLocalWhisperAvailable() };
    });

    // Get status of all whisper models
    ipcMain.handle('whisper:models-status', async () => {
        try {
            const models = await getModelsStatus();
            return { models };
        } catch (error) {
            return { error: error.message };
        }
    });

    // Download a whisper model
    ipcMain.handle('whisper:download-model', async (event, modelName) => {
        try {
            const mainWindow = getMainWindow();
            const onProgress = (progress) => {
                if (mainWindow) {
                    mainWindow.webContents.send('whisper:download-progress', {
                        model: modelName,
                        ...progress,
                    });
                }
            };
            const modelPath = await downloadModel(modelName, onProgress);
            return { success: true, path: modelPath };
        } catch (error) {
            return { error: error.message };
        }
    });

    // Delete a whisper model
    ipcMain.handle('whisper:delete-model', async (event, modelName) => {
        try {
            await deleteModel(modelName);
            return { success: true };
        } catch (error) {
            return { error: error.message };
        }
    });

    // Get loaded model info
    ipcMain.handle('whisper:loaded-model', async () => {
        return getLoadedModelInfo();
    });
}

module.exports = { setupAudioHandlers };
