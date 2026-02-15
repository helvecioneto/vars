const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('responseAPI', {
    // Receive response content from main process
    onDisplayResponse: (callback) => {
        ipcRenderer.on('display-response', (event, data) => callback(data));
    },

    // Window controls
    closeWindow: () => ipcRenderer.send('close-response-window'),
    minimizeWindow: () => ipcRenderer.send('minimize-response-window'),
    setOpacity: (opacity) => ipcRenderer.send('set-response-opacity', opacity),
    getOpacity: () => ipcRenderer.invoke('get-response-opacity'),

    // Dragging
    setDragging: (dragging) => ipcRenderer.send('set-response-dragging', dragging),

    // Clickthrough support
    setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
    onClickthroughChanged: (callback) => {
        ipcRenderer.on('clickthrough-changed', (event, enabled) => callback(enabled));
    },

    // Bounds tracking for auto-height
    sendContentBounds: (bounds) => ipcRenderer.send('update-response-bounds', bounds),

    // Receive height result (whether content was capped)
    onContentHeightResult: (callback) => {
        ipcRenderer.on('content-height-result', (event, data) => callback(data));
    },

    // AI regeneration (proxied through main process to reuse existing handler)
    getAIResponse: (transcription) => ipcRenderer.invoke('get-ai-response', transcription),

    // Context menu
    showContextMenu: () => ipcRenderer.invoke('show-context-menu'),

    // Smart Listener
    smartListener: {
        getQueue: () => ipcRenderer.invoke('smart-listener:get-queue'),
        markViewed: (questionId) => ipcRenderer.invoke('smart-listener:mark-viewed', questionId),
        markAllViewed: () => ipcRenderer.invoke('smart-listener:mark-all-viewed'),
        getUnviewedCount: () => ipcRenderer.invoke('smart-listener:unviewed-count'),
        onNewQuestion: (callback) => {
            ipcRenderer.on('smart-listener:new-question', (event, data) => callback(data));
        },
        onResponseReady: (callback) => {
            ipcRenderer.on('smart-listener:response-ready', (event, data) => callback(data));
        },
        onNavigate: (callback) => {
            ipcRenderer.on('smart-listener:navigate', (event, direction) => callback(direction));
        }
    }
});
