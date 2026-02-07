/**
 * VARS - Media IPC Handlers
 * Handles screen capture and desktop sources
 */

const { ipcMain, desktopCapturer } = require('electron');
const screenCapture = require('../screen-capture');

/**
 * Setup media-related IPC handlers
 * @param {object} context - Context object
 */
function setupMediaHandlers(context) {
    // Get desktop sources for screen/window capture
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

    // Capture foreground window
    ipcMain.handle('capture-screen', async () => {
        try {
            const result = await screenCapture.captureForegroundWindow();
            return result;
        } catch (error) {
            console.error('[Screen Capture] Error:', error);
            return { error: error.message };
        }
    });
}

module.exports = { setupMediaHandlers };
