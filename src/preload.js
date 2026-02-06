const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Zoom state
let currentZoomFactor = 1.0;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.3;
const ZOOM_STEP = 0.1;

// Zoom functions using webFrame
function setZoom(factor) {
    currentZoomFactor = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, factor));
    webFrame.setZoomFactor(currentZoomFactor);
    return currentZoomFactor;
}

contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    // Configuration
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config) => ipcRenderer.invoke('save-config', config),
    getModels: () => ipcRenderer.invoke('get-models'),
    // NOTE: requestMicrophoneAccess removed - permission is now managed at app startup

    // Zoom controls
    zoomIn: () => setZoom(currentZoomFactor + ZOOM_STEP),
    zoomOut: () => setZoom(currentZoomFactor - ZOOM_STEP),
    resetZoom: () => setZoom(1.0),
    getZoomFactor: () => currentZoomFactor,

    // Audio processing (batch mode)
    transcribeAudio: (audioBuffer) => ipcRenderer.invoke('transcribe-audio', audioBuffer),
    getAIResponse: (transcription) => ipcRenderer.invoke('get-ai-response', transcription),

    // Realtime transcription (streaming mode)
    realtimeStart: () => ipcRenderer.invoke('realtime-start'),
    realtimeAudio: (audioBuffer) => ipcRenderer.invoke('realtime-audio', audioBuffer),
    realtimeStop: () => ipcRenderer.invoke('realtime-stop'),
    onRealtimeTranscription: (callback) => {
        ipcRenderer.on('realtime-transcription', (event, data) => callback(data));
    },
    onRealtimeError: (callback) => {
        ipcRenderer.on('realtime-error', (event, data) => callback(data));
    },

    // Recording state
    toggleRecording: () => ipcRenderer.send('toggle-recording'),
    onRecordingToggle: (callback) => {
        ipcRenderer.on('recording-toggle', (event, isRecording) => callback(isRecording));
    },

    // Input mode changes
    onInputModeChanged: (callback) => {
        ipcRenderer.on('input-mode-changed', (event, mode) => callback(mode));
    },

    // Zoom shortcuts from main process
    onZoomShortcut: (callback) => {
        ipcRenderer.on('zoom-shortcut', (event, key) => callback(key));
    },

    // Free tier retry notifications
    onFreeTierRetry: (callback) => {
        ipcRenderer.on('free-tier-retry', (event, data) => callback(data));
    },

    // Window controls
    closeWindow: () => ipcRenderer.send('close-window'),
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    showContextMenu: () => ipcRenderer.invoke('show-context-menu'),

    // Knowledge Base
    createKnowledgeBase: () => ipcRenderer.invoke('knowledge-base:create'),
    resetKnowledgeBase: () => ipcRenderer.invoke('knowledge-base:reset'),

    // API Key Testing
    testAPIKey: (provider, apiKey, tier) => ipcRenderer.invoke('test-api-key', provider, apiKey, tier),

    setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
    sendContentBounds: (bounds) => ipcRenderer.send('update-content-bounds', bounds),
    setDragging: (dragging) => ipcRenderer.send('set-dragging', dragging),

    // Content Protection (visibility mode toggle)
    setContentProtection: (enabled) => ipcRenderer.send('set-content-protection', enabled),


    // Desktop Capturer for System Audio
    getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

    // Screen Capture and Image Analysis
    captureScreen: () => ipcRenderer.invoke('capture-screen'),
    analyzeImage: (params) => ipcRenderer.invoke('analyze-image', params),
    onScreenshotCapture: (callback) => {
        ipcRenderer.on('screenshot-capture', () => callback());
    },

    // System Audio Capture (Linux PulseAudio/PipeWire)
    systemAudio: {
        listDevices: () => ipcRenderer.invoke('system-audio:list-devices'),
        startCapture: (deviceName, sampleRate) => ipcRenderer.invoke('system-audio:start-capture', { deviceName, sampleRate }),
        stopCapture: () => ipcRenderer.invoke('system-audio:stop-capture'),
        getAudio: () => ipcRenderer.invoke('system-audio:get-audio'),
        getAudioFinal: () => ipcRenderer.invoke('system-audio:get-audio-final'),
        getBufferSize: () => ipcRenderer.invoke('system-audio:get-buffer-size'),
        isCapturing: () => ipcRenderer.invoke('system-audio:is-capturing')
    },

    // Permission handling (macOS)
    permissions: {
        checkScreen: () => ipcRenderer.invoke('check-screen-permission'),
        checkMicrophone: () => ipcRenderer.invoke('check-microphone-permission'),
        requestMicrophone: () => ipcRenderer.invoke('request-microphone-permission'),
        openSystemPreferences: (panel) => ipcRenderer.invoke('open-system-preferences', panel)
    },

    // Quiz Solver
    quizSolver: {
        start: () => ipcRenderer.invoke('quiz-solver:start'),
        stop: () => ipcRenderer.invoke('quiz-solver:stop'),
        isActive: () => ipcRenderer.invoke('quiz-solver:is-active'),
        onStatus: (callback) => {
            ipcRenderer.on('quiz-solver:status', (event, data) => callback(data));
        }
    },

    // Toggle quiz solver from hotkey
    onToggleQuizSolver: (callback) => {
        ipcRenderer.on('toggle-quiz-solver', () => callback());
    }
});
