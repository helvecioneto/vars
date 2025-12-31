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
    setDragging: (dragging) => ipcRenderer.send('set-dragging', dragging)
});
