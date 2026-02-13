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
});
