const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, session, systemPreferences } = require('electron');
const path = require('path');
const { loadConfig, saveConfig, getDefaultConfig } = require('./config');
const {
    transcribeAudio,
    getSmartAIResponse,
    initializeAssistant,
    createKnowledgeBase,
    updateAssistantVectorStore,
    resetKnowledgeBase
} = require('./openai');
const { RealtimeTranscription } = require('./realtime');


// Set App Name explicitly for dev mode
app.setName('VARS');
if (process.platform === 'win32') {
    app.setAppUserModelId('com.vars.app');
}

let mainWindow = null;
let tray = null;
let isRecording = false;
let config = null;
let realtimeClient = null; // Realtime transcription instance
let microphonePermissionGranted = false; // Cache permission state to prevent loops

function createWindow() {
    const windowOptions = {
        width: 450,
        height: 60,  // Start small, will expand when settings/content opens
        title: 'VARS',
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        maximizable: false,
        minWidth: 350,
        minHeight: 50,
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

    // Position window in bottom-right corner
    const { screen } = require('electron');
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow.setPosition(width - 470, height - 620);

    // Dev tools in development mode
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

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

// IPC Handlers
function setupIPC() {
    // Toggle recording from renderer
    ipcMain.on('toggle-recording', () => {
        toggleRecordingState();
    });
    // Get configuration
    ipcMain.handle('get-config', async () => {
        return config;
    });

    // NOTE: 'request-microphone-access' handler removed - permission is now managed
    // entirely at app startup via systemPreferences.askForMediaAccess()

    // Save configuration
    ipcMain.handle('save-config', async (event, newConfig) => {
        config = { ...config, ...newConfig };
        await saveConfig(config);
        return config;
    });

    // Transcribe audio
    ipcMain.handle('transcribe-audio', async (event, audioBuffer) => {
        if (!config.apiKey) {
            return { error: 'API key not configured' };
        }

        try {
            const transcription = await transcribeAudio(audioBuffer, config.apiKey, config.whisperModel || 'whisper-1');
            return { text: transcription };
        } catch (error) {
            return { error: error.message };
        }
    });

    // Get AI response
    ipcMain.handle('get-ai-response', async (event, transcription) => {
        if (!config.apiKey) {
            return { error: 'API key not configured' };
        }

        try {
            const result = await getSmartAIResponse({
                transcription,
                params: {
                    apiKey: config.apiKey,
                    model: config.model || 'gpt-4o-mini',
                    systemPrompt: config.systemPrompt,
                    language: config.language || 'en',
                    history: config.conversationHistory || [],
                    assistantId: config.assistantId,
                    vectorStoreId: config.vectorStoreId,
                    threadId: config.threadId,
                    knowledgeBasePaths: config.knowledgeBasePaths || [],
                    briefMode: config.briefMode || false
                }
            });

            // If a threadId was returned (Assistant used), save it
            if (result.threadId && result.threadId !== config.threadId) {
                config.threadId = result.threadId;
                saveConfig(config); // Save asynchronously
            }

            return { response: result.response };
        } catch (error) {
            console.error('AI Response Error:', error);
            return { error: error.message };
        }
    });

    // Knowledge Base Management
    ipcMain.handle('knowledge-base:create', async () => {
        if (!config.apiKey) return { error: 'API key not configured' };
        if (!config.knowledgeBasePaths || config.knowledgeBasePaths.length === 0) {
            return { error: 'No files to process' };
        }

        try {
            // 1. Ensure Assistant
            const assistant = await initializeAssistant(config.apiKey, config.assistantId);
            config.assistantId = assistant.id;

            // 2. Create/Update Vector Store and Upload Files
            const vectorStoreId = await createKnowledgeBase(
                config.apiKey,
                config.knowledgeBasePaths,
                config.vectorStoreId
            );
            config.vectorStoreId = vectorStoreId;

            // 3. Link Vector Store to Assistant
            await updateAssistantVectorStore(config.apiKey, config.assistantId, vectorStoreId);

            // Save updated IDs
            await saveConfig(config);

            return { success: true, count: config.knowledgeBasePaths.length };
        } catch (error) {
            console.error('KB Create Error:', error);
            return { error: error.message };
        }
    });

    ipcMain.handle('knowledge-base:reset', async () => {
        if (!config.apiKey) return { error: 'API key not configured' };

        try {
            await resetKnowledgeBase(config.apiKey, config.vectorStoreId);
            config.vectorStoreId = null;
            config.threadId = null; // Reset thread when KB is reset? Maybe optionally.
            await saveConfig(config);
            return { success: true };
        } catch (error) {
            console.error('KB Reset Error:', error);
            return { error: error.message };
        }
    });

    // Realtime transcription - Start session
    ipcMain.handle('realtime-start', async () => {
        if (!config.apiKey) {
            return { error: 'API key not configured' };
        }

        try {
            // Disconnect existing client if any
            if (realtimeClient) {
                realtimeClient.disconnect();
            }

            realtimeClient = new RealtimeTranscription(config.apiKey);

            // Set up transcription callback to send to renderer
            realtimeClient.onTranscription((text, isFinal) => {
                if (mainWindow) {
                    mainWindow.webContents.send('realtime-transcription', { text, isFinal });
                }
            });

            realtimeClient.onError((error) => {
                if (mainWindow) {
                    mainWindow.webContents.send('realtime-error', { error: error.message });
                }
            });

            await realtimeClient.connect();
            return { success: true };
        } catch (error) {
            console.error('Realtime start error:', error);
            return { error: error.message };
        }
    });

    // Realtime transcription - Send audio chunk
    ipcMain.handle('realtime-audio', async (event, audioBuffer) => {
        if (!realtimeClient || !realtimeClient.isConnected) {
            return { error: 'Realtime session not started' };
        }

        try {
            const buffer = Buffer.from(audioBuffer);
            realtimeClient.sendAudio(buffer);
            return { success: true };
        } catch (error) {
            return { error: error.message };
        }
    });

    // Realtime transcription - Stop and get final transcript
    ipcMain.handle('realtime-stop', async () => {
        if (!realtimeClient) {
            return { text: '' };
        }

        try {
            realtimeClient.commitAudio();
            const text = realtimeClient.getFullTranscript();
            realtimeClient.disconnect();
            realtimeClient = null;
            return { text };
        } catch (error) {
            return { error: error.message };
        }
    });

    // Window controls
    ipcMain.on('minimize-window', () => {
        if (mainWindow) mainWindow.hide();
    });

    ipcMain.on('close-window', () => {
        if (mainWindow) mainWindow.hide();
    });

    // Context Menu
    ipcMain.handle('show-context-menu', () => {
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

    // Dynamic window size - resize to match content
    let lastResizeTime = 0;
    const RESIZE_COOLDOWN = 1000; // 1 second cooldown to prevent loops

    ipcMain.on('update-content-bounds', (event, bounds) => {
        const now = Date.now();
        if (now - lastResizeTime < RESIZE_COOLDOWN) return;

        if (mainWindow && bounds.width > 0 && bounds.height > 0) {
            const currentBounds = mainWindow.getBounds();
            // const newWidth = Math.ceil(bounds.width); // Ignore content width to prevent loops
            const newHeight = Math.ceil(bounds.height);

            // Only resize if height changed significantly
            // We ignore width changes to prevent the resize loop bug
            if (Math.abs(currentBounds.height - newHeight) > 20) {
                lastResizeTime = now;
                mainWindow.setSize(currentBounds.width, newHeight);
            }
        }
    });

    ipcMain.on('set-dragging', (event, dragging) => {
        // Keep for compatibility
    });
}

// App lifecycle
app.whenReady().then(async () => {
    // PERMISSION HANDLING
    // Permission is requested ONCE when user starts recording (via getUserMedia)
    // These handlers manage the flow to ensure only one dialog appears

    // Permission check handler - allows check, returns cached or queries system
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
        const mediaPermissions = ['media', 'audioCapture', 'microphone'];
        if (mediaPermissions.includes(permission)) {
            // If already cached as granted, return true
            if (microphonePermissionGranted) {
                return true;
            }
            // Check system status - maybe user granted it via system preferences
            if (process.platform === 'darwin') {
                const status = systemPreferences.getMediaAccessStatus('microphone');
                if (status === 'granted') {
                    microphonePermissionGranted = true;
                    return true;
                }
            }
            // Return true to allow the request to proceed (dialog will appear)
            return true;
        }
        return true;
    });

    // Permission request handler - grants and updates cache after success
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const mediaPermissions = ['media', 'audioCapture', 'microphone'];
        if (mediaPermissions.includes(permission)) {
            // If already cached as granted, return immediately
            if (microphonePermissionGranted) {
                console.log(`Permission ${permission}: granted (cached)`);
                callback(true);
                return;
            }

            // On macOS, check current system status
            if (process.platform === 'darwin') {
                const status = systemPreferences.getMediaAccessStatus('microphone');
                console.log(`Permission ${permission}: system status = ${status}`);

                if (status === 'granted') {
                    microphonePermissionGranted = true;
                    callback(true);
                    return;
                } else if (status === 'denied' || status === 'restricted') {
                    callback(false);
                    return;
                }
                // For 'not-determined', grant permission - this allows the native dialog to appear
                // After user clicks Allow, the next check will see 'granted'
                console.log(`Permission ${permission}: granting to trigger native dialog`);
                callback(true);
                return;
            }

            // Non-macOS: grant by default
            microphonePermissionGranted = true;
            callback(true);
        } else {
            callback(true);
        }
    });

    // Check microphone permission status at startup (macOS only)
    // We DON'T request permission here - let getUserMedia trigger the dialog once
    // This way we only get ONE permission dialog when user actually starts recording
    if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('microphone');
        console.log('Initial microphone permission status:', status);

        if (status === 'granted') {
            microphonePermissionGranted = true;
            console.log('Microphone permission already granted');
        } else {
            console.log('Microphone permission will be requested when recording starts');
            // microphonePermissionGranted stays false - will be updated when getUserMedia succeeds
        }
    } else {
        microphonePermissionGranted = true;
    }

    // Load config
    config = await loadConfig();

    createWindow();
    createTray();
    registerGlobalShortcut();
    setupIPC();

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
});
