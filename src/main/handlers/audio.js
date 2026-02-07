/**
 * VARS - Audio IPC Handlers
 * Handles audio transcription, realtime transcription, and system audio
 */

const { ipcMain } = require('electron');
const { getModelForTier, getModelListForTier, getRetryConfig } = require('../config');
const { transcribeAudio } = require('../providers/openai');
const { transcribeAudioGoogle } = require('../providers/google');
const { RealtimeTranscription } = require('../providers/openai/realtime');
const { GeminiRealtimeTranscription } = require('../providers/google/realtime');
const systemAudio = require('../system-audio');

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
        const provider = config.provider || 'openai';
        const apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

        if (!apiKey) {
            return { error: `${provider === 'google' ? 'Google' : 'OpenAI'} API key not configured` };
        }

        try {
            const tier = config.tier || 'balanced';
            const buffer = Array.isArray(audioBuffer) ? Buffer.from(audioBuffer) : audioBuffer;

            let transcription;
            if (provider === 'google') {
                if (tier === 'free') {
                    const modelList = getModelListForTier(provider, tier, 'transcribe');
                    const retryConfig = getRetryConfig(provider, tier);
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
        const apiKey = provider === 'google' ? config.googleApiKey : config.apiKey;

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
}

module.exports = { setupAudioHandlers };
