/**
 * VARS - Miscellaneous IPC Handlers
 * Handles external URLs, updates, and permissions
 */

const { ipcMain, app, net, shell, systemPreferences } = require('electron');

/**
 * Setup miscellaneous IPC handlers
 * @param {object} context - Context object
 */
function setupMiscHandlers(context) {
    // Open external URL
    ipcMain.handle('open-external', async (event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Failed to open external URL:', error);
            return { success: false, error: error.message };
        }
    });

    // Check for updates
    ipcMain.handle('check-for-updates', async () => {
        const currentVersion = app.getVersion();

        const versionCompare = (v1, v2) => {
            const p1 = v1.replace(/^v/, '').split('.').map(Number);
            const p2 = v2.replace(/^v/, '').split('.').map(Number);
            for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
                const n1 = p1[i] || 0;
                const n2 = p2[i] || 0;
                if (n1 > n2) return 1;
                if (n1 < n2) return -1;
            }
            return 0;
        };

        return new Promise((resolve) => {
            const request = net.request('https://api.github.com/repos/helvecioneto/vars/releases/latest');
            request.on('response', (response) => {
                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => {
                    try {
                        const release = JSON.parse(data);
                        const latestVersion = release.tag_name;
                        const hasUpdate = versionCompare(latestVersion, currentVersion) > 0;
                        resolve({
                            hasUpdate,
                            currentVersion,
                            latestVersion,
                            releaseUrl: release.html_url
                        });
                    } catch (error) {
                        resolve({ error: 'Failed to parse update info' });
                    }
                });
            });
            request.on('error', (error) => {
                resolve({ error: error.message });
            });
            request.end();
        });
    });

    // Permission check - screen (macOS)
    ipcMain.handle('check-screen-permission', async () => {
        if (process.platform !== 'darwin') {
            return { granted: true, status: 'granted' };
        }
        const status = systemPreferences.getMediaAccessStatus('screen');
        return { granted: status === 'granted', status };
    });

    // Permission check - microphone (macOS)
    ipcMain.handle('check-microphone-permission', async () => {
        if (process.platform !== 'darwin') {
            return { granted: true, status: 'granted' };
        }
        const status = systemPreferences.getMediaAccessStatus('microphone');
        return { granted: status === 'granted', status };
    });

    // Request microphone permission (macOS)
    ipcMain.handle('request-microphone-permission', async () => {
        if (process.platform !== 'darwin') {
            return { granted: true };
        }
        try {
            const granted = await systemPreferences.askForMediaAccess('microphone');
            return { granted };
        } catch (error) {
            console.error('[Permission] Error requesting microphone:', error);
            return { granted: false, error: error.message };
        }
    });

    // Open system preferences (macOS)
    ipcMain.handle('open-system-preferences', async (event, panel) => {
        if (process.platform === 'darwin') {
            if (panel === 'screen') {
                shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
            } else if (panel === 'microphone') {
                shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
            } else {
                shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy');
            }
            return { success: true };
        }
        return { success: false, error: 'Not macOS' };
    });
}

module.exports = { setupMiscHandlers };
