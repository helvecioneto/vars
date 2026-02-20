const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, session, systemPreferences, desktopCapturer, ipcMain, screen } = require('electron');
const path = require('path');
const { loadConfig, saveConfig } = require('./config');
const { setupIPCHandlers } = require('./ipc-handlers');


// Set App Name explicitly for dev mode
app.setName('VARS');
if (process.platform === 'win32') {
    app.setAppUserModelId('com.vars.app');
}

let mainWindow = null;
let responseWindow = null;
let onboardingWindow = null;
let tray = null;
let isRecording = false;
let isClickthroughEnabled = false;
let config = null;
let microphonePermissionGranted = false; // Cache permission state to prevent loops
let screenPermissionGranted = false; // Cache screen recording permission state

function createWindow() {
    // Calculate window size based on primary monitor
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workAreaSize;
    const windowWidth = Math.round(workArea.width * 0.35);

    const windowOptions = {
        width: windowWidth,
        height: 110,  // Start small, will expand when settings/content opens
        title: 'VARS',
        frame: false,
        transparent: true,
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        maximizable: false,
        minWidth: Math.round(windowWidth * 0.75),
        minHeight: 90,
        useContentSize: true,  // Window size = content size, not including frame
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png')
    };

    mainWindow = new BrowserWindow(windowOptions);

    // Make window invisible to screen sharing (macOS/Windows only)
    if (process.platform === 'darwin' || process.platform === 'win32') {
        mainWindow.setContentProtection(true);
    }


    // Load the renderer
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    // Prevent default Electron zoom shortcuts and let preload handle them via IPC
    mainWindow.webContents.on('before-input-event', (event, input) => {
        const isMac = process.platform === 'darwin';
        const modifierKey = isMac ? input.alt : (input.control || input.meta);

        if (modifierKey &&
            (input.key === '+' || input.key === '=' || input.key === '-' || input.key === '0')) {
            // Don't prevent - let it bubble to renderer's keydown listener
        }
    });

    // Allow window to be moved by dragging
    mainWindow.setMovable(true);

    // Position window at top-center of the screen
    const x = Math.round((workArea.width - windowWidth) / 2);
    const y = 0;
    mainWindow.setPosition(x, y);

    // Dev tools in development mode
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    // DEBUG: Disabled to test if DevTools causes crash
    // mainWindow.webContents.openDevTools({ mode: 'detach' });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Handle renderer process crashes — reload instead of leaving blank window
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('[MAIN] Renderer process gone:', details.reason, details.exitCode);
        // Temporarily disable auto-reload for debugging
        // if (mainWindow && !mainWindow.isDestroyed()) {
        //     setTimeout(() => {
        //         if (mainWindow && !mainWindow.isDestroyed()) {
        //             console.log('[MAIN] Reloading renderer...');
        //             mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
        //         }
        //     }, 1000);
        // }
    });
}

function createResponseWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workAreaSize;
    const windowWidth = Math.round(workArea.width * 0.30);
    const initialHeight = 200;

    responseWindow = new BrowserWindow({
        width: windowWidth,
        height: initialHeight,
        title: 'VARS Response',
        frame: false,
        transparent: true,
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        maximizable: false,
        minWidth: Math.round(windowWidth * 0.55),
        minHeight: 80,
        show: false,  // Hidden until a response arrives
        useContentSize: true,
        opacity: config?.responseWindowOpacity || 1.0,
        webPreferences: {
            preload: path.join(__dirname, '..', 'renderer', 'response-window', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png')
    });

    // Make response window invisible to screen sharing
    if (process.platform === 'darwin' || process.platform === 'win32') {
        responseWindow.setContentProtection(true);
    }

    responseWindow.loadFile(path.join(__dirname, '..', 'renderer', 'response-window', 'index.html'));
    responseWindow.setMovable(true);

    // Always position below the main window, horizontally centered
    const GAP = 36; // Increased to ensure it doesn't overlap the main window due to CSS padding
    if (mainWindow && !mainWindow.isDestroyed()) {
        const mb = mainWindow.getBounds();
        const x = mb.x + Math.round((mb.width - windowWidth) / 2);
        const y = mb.y + mb.height + GAP;
        const clampedX = Math.max(0, Math.min(x, workArea.width - windowWidth));
        const clampedY = Math.max(0, Math.min(y, workArea.height - initialHeight));
        responseWindow.setPosition(clampedX, clampedY);
    } else {
        // Fallback: top-center
        responseWindow.setPosition(Math.round((workArea.width - windowWidth) / 2), 80);
    }

    responseWindow.on('closed', () => {
        responseWindow = null;
    });
}

function createOnboardingWindow() {
    const windowWidth = 300; // Constrained width for tooltip
    const initialHeight = 150;

    onboardingWindow = new BrowserWindow({
        width: windowWidth,
        height: initialHeight,
        title: 'VARS Onboarding',
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        type: 'toolbar', // Helps with staying on top on some WMs
        skipTaskbar: true,
        resizable: false,
        maximizable: false,
        show: false,
        useContentSize: true,
        webPreferences: {
            nodeIntegration: true, // For now, based on window.js using require
            contextIsolation: false // For now, consistent with window.js
            // preload: path.join(__dirname, '..', 'renderer', 'onboarding', 'preload.js'), // If we wanted strict isolation
        },
        icon: path.join(__dirname, '..', 'assets', 'icon.png')
    });

    if (process.platform === 'darwin' || process.platform === 'win32') {
        onboardingWindow.setContentProtection(true);
    }

    // Ensure it stays on top of the main window (which is also alwaysOnTop)
    onboardingWindow.setAlwaysOnTop(true, 'screen-saver');

    onboardingWindow.loadFile(path.join(__dirname, '..', 'renderer', 'onboarding', 'window.html'));

    // Allow dragging? Maybe not for a tooltip that follows elements.
    // onboardingWindow.setMovable(true);

    onboardingWindow.on('closed', () => {
        onboardingWindow = null;
    });
}

// IPC: receive response from hover renderer, forward to response window
// Registered once at module level to avoid duplicate listeners
ipcMain.on('show-in-response-window', (event, data) => {
    if (!responseWindow || responseWindow.isDestroyed()) {
        createResponseWindow();
    }
    // Show the window
    responseWindow.show();
    // Apply clickthrough state if currently enabled
    if (isClickthroughEnabled) {
        if (process.platform === 'linux') {
            responseWindow.setIgnoreMouseEvents(true);
        } else {
            responseWindow.setIgnoreMouseEvents(true, { forward: true });
        }
    }
    // Wait for window to be ready before sending
    if (responseWindow.webContents.isLoading()) {
        responseWindow.webContents.once('did-finish-load', () => {
            responseWindow.webContents.send('display-response', data);
            if (isClickthroughEnabled) {
                responseWindow.webContents.send('clickthrough-changed', true);
            }
        });
    } else {
        responseWindow.webContents.send('display-response', data);
        if (isClickthroughEnabled) {
            responseWindow.webContents.send('clickthrough-changed', true);
        }
    }
});

function createTray() {
    // Create a simple tray icon
    const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
    let icon;

    try {
        icon = nativeImage.createFromPath(iconPath);
        if (icon.isEmpty()) {
            // Create a simple colored icon if file doesn't exist
            icon = createDefaultIcon();
        } else {
            // Resize to 16x16 for tray (macOS standard)
            icon = icon.resize({ width: 16, height: 16 });

            // Enable template mode for macOS (adapts to light/dark mode)
            if (process.platform === 'darwin') {
                icon.setTemplateImage(true);
            }
        }
    } catch (e) {
        icon = createDefaultIcon();
    }

    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show/Hide',
            click: () => {
                if (mainWindow) {
                    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setToolTip('VARS');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        }
    });
}

function createDefaultIcon() {
    // Create a 16x16 icon programmatically
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);

    for (let i = 0; i < size * size; i++) {
        const offset = i * 4;
        canvas[offset] = 100;     // R
        canvas[offset + 1] = 200; // G
        canvas[offset + 2] = 255; // B
        canvas[offset + 3] = 255; // A
    }

    return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

// Input modes: 'system', 'microphone', 'keyboard'
const INPUT_MODES = ['system', 'microphone'];
let currentInputMode = 'system';

function registerGlobalShortcut() {
    const isMac = process.platform === 'darwin';
    // macOS: Option+Space, Others: CTRL+Space
    const shortcutKey = isMac ? 'Alt+Space' : 'CommandOrControl+Space';

    // Start/Stop recording
    const recRet = globalShortcut.register(shortcutKey, () => {
        toggleRecordingState();
    });

    if (!recRet) {
        console.error('Failed to register global shortcut CTRL+Space');
    }

    // Switch input mode
    // macOS: Option+M, Others: CTRL+M
    const modeKey = isMac ? 'Alt+M' : 'CommandOrControl+M';

    const modeRet = globalShortcut.register(modeKey, () => {
        // Cycle through input modes
        const currentIndex = INPUT_MODES.indexOf(currentInputMode);
        const nextIndex = (currentIndex + 1) % INPUT_MODES.length;
        currentInputMode = INPUT_MODES[nextIndex];

        console.log(`Input mode switched to: ${currentInputMode}`);

        if (mainWindow) {
            mainWindow.webContents.send('input-mode-changed', currentInputMode);

            // Show window to indicate mode change
            if (!mainWindow.isVisible()) {
                mainWindow.show();
            }
        }
    });

    if (!modeRet) {
        console.error('Failed to register global shortcut CTRL+M');
    }

    // Screenshot capture shortcut
    // macOS: Option+Shift+S, Others: CTRL+Shift+S
    const screenshotKey = isMac ? 'Alt+Shift+S' : 'CommandOrControl+Shift+S';

    const screenshotRet = globalShortcut.register(screenshotKey, () => {
        console.log('Screenshot shortcut triggered');

        if (mainWindow) {
            // Send event to renderer to capture screenshot
            mainWindow.webContents.send('screenshot-capture');

            // Show window if hidden
            if (!mainWindow.isVisible()) {
                mainWindow.show();
            }
        }
    });

    if (!screenshotRet) {
        console.error('Failed to register global shortcut for screenshot');
    }

    // Transparency Shortcuts

    // Increase Opacity
    let incKey;
    if (isMac) {
        incKey = 'Alt+]';
    } else {
        incKey = 'CommandOrControl+Alt+]';
    }

    globalShortcut.register(incKey, () => {
        if (mainWindow) {
            let opacity = mainWindow.getOpacity();
            opacity = Math.min(opacity + 0.1, 1.0);
            mainWindow.setOpacity(opacity);
            // Notify renderer to update slider
            mainWindow.webContents.send('opacity-changed', opacity);
        }
    });

    // Decrease Opacity
    let decKey;
    if (isMac) {
        decKey = 'Alt+[';
    } else {
        decKey = 'CommandOrControl+Alt+[';
    }

    globalShortcut.register(decKey, () => {
        if (mainWindow) {
            let opacity = mainWindow.getOpacity();
            opacity = Math.max(opacity - 0.1, 0.2); // Min 20% opacity
            mainWindow.setOpacity(opacity);
            // Notify renderer to update slider
            mainWindow.webContents.send('opacity-changed', opacity);
        }
    });

    // Click-through toggle
    // macOS: Option+T, Others: Ctrl+Alt+T
    const clickthroughKey = isMac ? 'Alt+T' : 'CommandOrControl+Alt+T';

    const clickthroughRet = globalShortcut.register(clickthroughKey, () => {
        toggleClickthrough();
    });

    if (!clickthroughRet) {
        console.error('Failed to register global shortcut for clickthrough');
    }

    // Smart Listener navigation shortcuts
    // macOS: Option+Left/Right, Others: Ctrl+Alt+Left/Right
    const slPrevKey = isMac ? 'Alt+Left' : 'CommandOrControl+Alt+Left';
    const slNextKey = isMac ? 'Alt+Right' : 'CommandOrControl+Alt+Right';

    globalShortcut.register(slPrevKey, () => {
        if (responseWindow && !responseWindow.isDestroyed()) {
            responseWindow.webContents.send('smart-listener:navigate', 'prev');
        }
    });

    globalShortcut.register(slNextKey, () => {
        if (responseWindow && !responseWindow.isDestroyed()) {
            responseWindow.webContents.send('smart-listener:navigate', 'next');
        }
    });
}



function toggleRecordingState() {
    isRecording = !isRecording;

    if (mainWindow) {
        mainWindow.webContents.send('recording-toggle', isRecording);

        // Show window if hidden when starting recording
        if (isRecording && !mainWindow.isVisible()) {
            mainWindow.show();
        }
    }
}

function toggleClickthrough() {
    isClickthroughEnabled = !isClickthroughEnabled;
    applyClickthrough();
    if (mainWindow) {
        mainWindow.webContents.send('clickthrough-changed', isClickthroughEnabled);
    }
    if (responseWindow && !responseWindow.isDestroyed()) {
        responseWindow.webContents.send('clickthrough-changed', isClickthroughEnabled);
    }
}

function applyClickthrough() {
    const windows = [mainWindow];
    if (responseWindow && !responseWindow.isDestroyed()) {
        windows.push(responseWindow);
    }
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
        windows.push(onboardingWindow);
    }
    for (const win of windows) {
        if (!win) continue;
        if (isClickthroughEnabled) {
            if (process.platform === 'linux') {
                win.setIgnoreMouseEvents(true);
            } else {
                win.setIgnoreMouseEvents(true, { forward: true });
            }
        } else {
            win.setIgnoreMouseEvents(false);
        }
    }
}

// App lifecycle
app.whenReady().then(async () => {
    // Microphone permission handling
    // - macOS: Requires explicit user consent via system dialog
    // - Windows/Linux: No special permissions needed, getUserMedia just works

    const checkMicPermission = () => {
        if (microphonePermissionGranted) return true;
        if (process.platform === 'darwin') {
            const status = systemPreferences.getMediaAccessStatus('microphone');
            if (status === 'granted') {
                microphonePermissionGranted = true;
                return true;
            }
            return status;
        }
        // Windows/Linux: Always grant
        microphonePermissionGranted = true;
        return true;
    };

    // Screen Recording permission handling (macOS only)
    // Required for system audio capture via desktopCapturer
    const checkScreenPermission = () => {
        if (screenPermissionGranted) return true;
        if (process.platform === 'darwin') {
            const status = systemPreferences.getMediaAccessStatus('screen');
            if (status === 'granted') {
                screenPermissionGranted = true;
                return true;
            }
            return status;
        }
        // Windows/Linux: Always grant
        screenPermissionGranted = true;
        return true;
    };

    // Permission handlers for getUserMedia and getDisplayMedia
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        // Allow audio, screen capture, and display capture
        if (['media', 'audioCapture', 'microphone'].includes(permission)) {
            checkMicPermission();
        }
        if (['display-capture', 'screen'].includes(permission)) {
            checkScreenPermission();
        }
        return true;
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        // Allow audio capture permissions
        if (['media', 'audioCapture', 'microphone'].includes(permission)) {
            const result = checkMicPermission();
            callback(result !== 'denied' && result !== 'restricted');
        }
        // Allow display/screen capture permissions (for system audio)
        else if (['display-capture', 'screen'].includes(permission)) {
            const result = checkScreenPermission();
            callback(result !== 'denied' && result !== 'restricted');
        }
        else {
            callback(true);
        }
    });

    // Handle getDisplayMedia requests (for system audio capture on macOS 13+)
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
        console.log('[DisplayMedia] Request received:', request);
        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: 1, height: 1 }
            });

            console.log('[DisplayMedia] Available sources:', sources.map(s => s.id));

            // Find the first screen source
            const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];

            if (screenSource) {
                console.log('[DisplayMedia] Using source:', screenSource.id, 'with loopback audio');
                // 'loopback' tells Electron to capture system audio
                callback({ video: screenSource, audio: 'loopback' });
            } else {
                console.log('[DisplayMedia] No source found');
                callback({ video: null, audio: null });
            }
        } catch (error) {
            console.error('[DisplayMedia] Error:', error);
            callback({ video: null, audio: null });
        }
    });

    checkMicPermission();
    checkScreenPermission();

    // Load config
    config = await loadConfig();

    createWindow();
    createResponseWindow();
    createOnboardingWindow();
    createTray();
    registerGlobalShortcut();
    // Setup IPC handlers with context
    setupIPCHandlers({
        getMainWindow: () => mainWindow,
        getResponseWindow: () => responseWindow,
        getOnboardingWindow: () => onboardingWindow,
        getConfig: () => config,
        setConfig: (newConfig) => { config = newConfig; },
        toggleRecording: toggleRecordingState,
        // Shows the response window the first time Smart Listener detects a question.
        // No-op when the window is already visible — never disturbs an active drag or
        // the current clickthrough/interaction state.
        showResponseWindow: () => {
            if (!responseWindow || responseWindow.isDestroyed()) return;
            if (responseWindow.isVisible()) return; // already visible — do nothing
            responseWindow.show();
            if (isClickthroughEnabled) {
                if (process.platform === 'linux') {
                    responseWindow.setIgnoreMouseEvents(true);
                } else {
                    responseWindow.setIgnoreMouseEvents(true, { forward: true });
                }
                responseWindow.webContents.send('clickthrough-changed', true);
            }
        }
    });

    // Handle content protection toggle (visibility mode)
    ipcMain.on('set-content-protection', (event, enabled) => {
        if (mainWindow && (process.platform === 'darwin' || process.platform === 'win32')) {
            mainWindow.setContentProtection(enabled);
            console.log(`Content protection set to: ${enabled}`);
        }
    });

    // Handle clickthrough toggle from renderer
    ipcMain.handle('toggle-clickthrough', () => {
        toggleClickthrough();
        return isClickthroughEnabled;
    });

    // Handle set-ignore-mouse-events from renderer (CTRL key during clickthrough)
    ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
        // Find which window sent the event and apply to that window
        const senderContents = event.sender;
        if (mainWindow && mainWindow.webContents === senderContents) {
            mainWindow.setIgnoreMouseEvents(ignore, options || {});
        } else if (responseWindow && !responseWindow.isDestroyed() && responseWindow.webContents === senderContents) {
            responseWindow.setIgnoreMouseEvents(ignore, options || {});
        } else if (onboardingWindow && !onboardingWindow.isDestroyed() && onboardingWindow.webContents === senderContents) {
            onboardingWindow.setIgnoreMouseEvents(ignore, options || {});
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // Don't quit on window close, keep running in tray
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
    app.isQuitting = true;
    // Terminate whisper worker thread on quit
    try {
        const { terminateWorker } = require('./providers/local');
        terminateWorker();
    } catch { /* ignore */ }
});

// Protect main process from crashing on unexpected errors
process.on('uncaughtException', (error) => {
    console.error('[MAIN] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('[MAIN] Unhandled rejection:', reason);
});
