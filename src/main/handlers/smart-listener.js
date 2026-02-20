/**
 * VARS - Smart Listener IPC Handlers
 * Handles smart listener question detection and response queue
 */

const { ipcMain } = require('electron');
const smartListener = require('../smart-listener');

/**
 * Setup Smart Listener IPC handlers
 * @param {object} context - Context with getMainWindow, getResponseWindow, getConfig, setConfig
 */
function setupSmartListenerHandlers(context) {
    const { getMainWindow, getResponseWindow, getConfig, showResponseWindow } = context;

    // Analyze transcription for questions (called from renderer periodically)
    ipcMain.handle('smart-listener:analyze', async (event, transcriptionText) => {
        const config = getConfig();

        try {
            await smartListener.analyzeTranscription(
                transcriptionText,
                config,
                // onNewQuestion callback
                (queueItem) => {
                    const mainWindow = getMainWindow();
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('smart-listener:new-question', queueItem);
                    }
                    // Show response window (and re-apply clickthrough) if hidden
                    if (showResponseWindow) showResponseWindow();
                    const responseWindow = getResponseWindow();
                    if (responseWindow && !responseWindow.isDestroyed()) {
                        responseWindow.webContents.send('smart-listener:new-question', queueItem);
                    }
                },
                // onResponseReady callback
                (queueItem) => {
                    const mainWindow = getMainWindow();
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('smart-listener:response-ready', queueItem);
                    }
                    const responseWindow = getResponseWindow();
                    if (responseWindow && !responseWindow.isDestroyed()) {
                        responseWindow.webContents.send('smart-listener:response-ready', queueItem);
                    }
                }
            );

            return { success: true };
        } catch (error) {
            console.error('[SmartListener Handler] Error:', error.message);
            return { error: error.message };
        }
    });

    // Get current queue
    ipcMain.handle('smart-listener:get-queue', () => {
        return smartListener.getQueue();
    });

    // Mark question as viewed
    ipcMain.handle('smart-listener:mark-viewed', (event, questionId) => {
        smartListener.markViewed(questionId);
        return { success: true };
    });

    // Mark all as viewed
    ipcMain.handle('smart-listener:mark-all-viewed', () => {
        smartListener.markAllViewed();
        return { success: true };
    });

    // Get unviewed count
    ipcMain.handle('smart-listener:unviewed-count', () => {
        return smartListener.getUnviewedCount();
    });

    // Clear queue
    ipcMain.handle('smart-listener:clear', () => {
        smartListener.clearQueue();
        return { success: true };
    });

    // Reset analysis state
    ipcMain.handle('smart-listener:reset', () => {
        smartListener.resetAnalysis();
        return { success: true };
    });
}

module.exports = { setupSmartListenerHandlers };
