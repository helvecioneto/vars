/**
 * VARS - Window IPC Handlers
 * Handles window control, resize, drag, and opacity
 */

const { ipcMain, Menu } = require('electron');

/**
 * Setup window-related IPC handlers
 * @param {object} context - Context with getMainWindow
 */
function setupWindowHandlers(context) {
    const { getMainWindow } = context;

    // Minimize window
    ipcMain.on('minimize-window', () => {
        const mainWindow = getMainWindow();
        if (mainWindow) mainWindow.hide();
    });

    // Close window (actually hides)
    ipcMain.on('close-window', () => {
        const mainWindow = getMainWindow();
        if (mainWindow) mainWindow.hide();
    });

    // Context menu
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

    // Window resize with cooldown
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

    // Explicit window height control (bypasses cooldown)
    ipcMain.on('set-window-height', (event, height) => {
        const mainWindow = getMainWindow();
        if (mainWindow && height > 0) {
            const currentBounds = mainWindow.getBounds();
            mainWindow.setSize(currentBounds.width, Math.ceil(height));
            lastResizeTime = 0;
        }
    });

    // Force resize to content bounds
    ipcMain.on('force-resize-to-content', (event, bounds) => {
        const mainWindow = getMainWindow();
        if (mainWindow && bounds.height > 0) {
            const currentBounds = mainWindow.getBounds();
            mainWindow.setSize(currentBounds.width, Math.ceil(bounds.height));
            lastResizeTime = 0;
        }
    });

    // Get current window size
    ipcMain.handle('get-window-size', async () => {
        const mainWindow = getMainWindow();
        if (mainWindow) {
            const bounds = mainWindow.getBounds();
            return { width: bounds.width, height: bounds.height };
        }
        return { width: 450, height: 60 };
    });

    // Window dragging
    let isDragging = false;
    let dragStartPos = { x: 0, y: 0 };

    ipcMain.on('set-dragging', (event, dragging) => {
        const mainWindow = getMainWindow();
        if (!mainWindow) return;

        if (dragging && !isDragging) {
            isDragging = true;
            const { screen } = require('electron');
            const cursorPos = screen.getCursorScreenPoint();
            const windowPos = mainWindow.getPosition();
            dragStartPos = {
                x: cursorPos.x - windowPos[0],
                y: cursorPos.y - windowPos[1]
            };

            const trackMouse = () => {
                if (!isDragging) return;
                const currentPos = screen.getCursorScreenPoint();
                const newX = currentPos.x - dragStartPos.x;
                const newY = currentPos.y - dragStartPos.y;
                mainWindow.setPosition(newX, newY);
                setTimeout(trackMouse, 10);
            };
            trackMouse();
        } else if (!dragging) {
            isDragging = false;
        }
    });

    // Window opacity
    ipcMain.on('set-opacity', (event, opacity) => {
        const mainWindow = getMainWindow();
        if (mainWindow) {
            mainWindow.setOpacity(opacity);
        }
    });
}

module.exports = { setupWindowHandlers };
