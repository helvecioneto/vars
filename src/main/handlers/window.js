/**
 * VARS - Window IPC Handlers
 * Handles window control, resize, drag, and opacity
 */

const { ipcMain, Menu } = require('electron');
const { saveConfig } = require('../config');

/**
 * Setup window-related IPC handlers
 * @param {object} context - Context with getMainWindow
 */
function setupWindowHandlers(context) {
    const { getMainWindow, getResponseWindow, getConfig, setConfig } = context;

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
    // Larger threshold on Linux to prevent resize loops due to WM variations
    const RESIZE_THRESHOLD = process.platform === 'linux' ? 80 : 20;

    ipcMain.on('update-content-bounds', (event, bounds) => {
        const now = Date.now();
        if (now - lastResizeTime < RESIZE_COOLDOWN) return;

        const mainWindow = getMainWindow();
        if (mainWindow && bounds.width > 0 && bounds.height > 0) {
            const currentBounds = mainWindow.getBounds();
            const newHeight = Math.ceil(bounds.height);

            if (Math.abs(currentBounds.height - newHeight) > RESIZE_THRESHOLD) {
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
        // Fallback: use 40% of primary display width
        const { screen } = require('electron');
        const workArea = screen.getPrimaryDisplay().workAreaSize;
        return { width: Math.round(workArea.width * 0.4), height: 60 };
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

    // ==========================================
    // Response Window Handlers
    // ==========================================

    // Close response window (hides it)
    ipcMain.on('close-response-window', () => {
        const responseWindow = getResponseWindow();
        if (responseWindow) responseWindow.hide();
    });

    // Minimize response window
    ipcMain.on('minimize-response-window', () => {
        const responseWindow = getResponseWindow();
        if (responseWindow) responseWindow.minimize();
    });

    // Response window bounds (auto-height)
    ipcMain.on('update-response-bounds', (event, bounds) => {
        const responseWindow = getResponseWindow();
        if (responseWindow && bounds.height > 0) {
            const { screen } = require('electron');
            const workArea = screen.getPrimaryDisplay().workAreaSize;
            const windowPos = responseWindow.getPosition();
            const maxHeight = workArea.height - windowPos[1] - 20; // Leave 20px margin at bottom
            const currentBounds = responseWindow.getBounds();
            const requestedHeight = Math.ceil(bounds.height);
            const newHeight = Math.max(120, Math.min(requestedHeight, maxHeight));
            responseWindow.setSize(currentBounds.width, newHeight);

            // Tell renderer if content was capped so it can enable scrolling
            if (responseWindow.webContents) {
                responseWindow.webContents.send('content-height-result', {
                    capped: requestedHeight > maxHeight,
                    windowHeight: newHeight
                });
            }
        }
    });

    // Response window dragging
    let isResponseDragging = false;
    let responseDragStartPos = { x: 0, y: 0 };

    ipcMain.on('set-response-dragging', (event, dragging) => {
        const responseWindow = getResponseWindow();
        if (!responseWindow) return;

        if (dragging && !isResponseDragging) {
            isResponseDragging = true;
            const { screen } = require('electron');
            const cursorPos = screen.getCursorScreenPoint();
            const windowPos = responseWindow.getPosition();
            responseDragStartPos = {
                x: cursorPos.x - windowPos[0],
                y: cursorPos.y - windowPos[1]
            };

            const trackMouse = () => {
                if (!isResponseDragging) return;
                const currentPos = screen.getCursorScreenPoint();
                const newX = currentPos.x - responseDragStartPos.x;
                const newY = currentPos.y - responseDragStartPos.y;
                responseWindow.setPosition(newX, newY);
                setTimeout(trackMouse, 10);
            };
            trackMouse();
        } else if (!dragging) {
            isResponseDragging = false;
            // Save position to config for persistence
            const pos = responseWindow.getPosition();
            const currentConfig = getConfig();
            if (currentConfig) {
                currentConfig.responseWindowPosition = { x: pos[0], y: pos[1] };
                setConfig(currentConfig);
                saveConfig(currentConfig);
            }
        }
    });

    // Response window opacity
    ipcMain.on('set-response-opacity', (event, opacity) => {
        const responseWindow = getResponseWindow();
        if (responseWindow) {
            responseWindow.setOpacity(opacity);

            // Save to config
            const currentConfig = getConfig();
            if (currentConfig) {
                currentConfig.responseWindowOpacity = opacity;
                setConfig(currentConfig);
                saveConfig(currentConfig);
            }
        }
    });

    // Get response window opacity
    ipcMain.handle('get-response-opacity', () => {
        const responseWindow = getResponseWindow();
        if (responseWindow) {
            return responseWindow.getOpacity();
        }
        const currentConfig = getConfig();
        return currentConfig?.responseWindowOpacity || 1.0;
    });
}

module.exports = { setupWindowHandlers };
