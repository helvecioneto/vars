/**
 * VARS - Screen Capture Module
 * Captures the foreground window/application for image analysis
 * Supports Windows, macOS, and Linux (with various distributions)
 */

const { desktopCapturer, screen, BrowserWindow } = require('electron');
const { exec, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsPromises = require('fs').promises;

/**
 * Get the foreground window information
 * @returns {Promise<{title: string, bounds: object|null}>}
 */
async function getForegroundWindowInfo() {
    const platform = process.platform;
    
    try {
        if (platform === 'win32') {
            return await getWindowInfoWindows();
        } else if (platform === 'darwin') {
            return await getWindowInfoMacOS();
        } else {
            return await getWindowInfoLinux();
        }
    } catch (error) {
        console.error('[ScreenCapture] Error getting foreground window info:', error);
        return { title: 'Unknown', bounds: null };
    }
}

/**
 * Get foreground window info on Windows
 * Uses PowerShell to get window title and bounds
 */
async function getWindowInfoWindows() {
    return new Promise((resolve, reject) => {
        // Simpler PowerShell command using Get-Process
        const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
$hwnd = [Win32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][Win32]::GetWindowText($hwnd, $sb, 256)
$rect = New-Object Win32+RECT
[void][Win32]::GetWindowRect($hwnd, [ref]$rect)
Write-Output "$($sb.ToString())|$($rect.Left)|$($rect.Top)|$($rect.Right - $rect.Left)|$($rect.Bottom - $rect.Top)"
`;
        
        // Write script to temp file and execute
        const tempScript = path.join(os.tmpdir(), `vars-capture-${Date.now()}.ps1`);
        
        fs.writeFileSync(tempScript, script, 'utf8');
        
        exec(`powershell -ExecutionPolicy Bypass -File "${tempScript}"`, { timeout: 5000 }, (error, stdout, stderr) => {
            // Clean up temp file
            try { fs.unlinkSync(tempScript); } catch (e) {}
            
            if (error) {
                console.error('[ScreenCapture] PowerShell error:', stderr || error.message);
                resolve({ title: 'Active Window', bounds: null });
                return;
            }
            
            const parts = stdout.trim().split('|');
            if (parts.length >= 5 && parts[0]) {
                resolve({
                    title: parts[0] || 'Active Window',
                    bounds: {
                        x: parseInt(parts[1]) || 0,
                        y: parseInt(parts[2]) || 0,
                        width: parseInt(parts[3]) || 0,
                        height: parseInt(parts[4]) || 0
                    }
                });
            } else {
                resolve({ title: 'Active Window', bounds: null });
            }
        });
    });
}

/**
 * Get foreground window info on macOS
 * Uses AppleScript to get window title and bounds
 */
async function getWindowInfoMacOS() {
    return new Promise((resolve, reject) => {
        const script = `
            tell application "System Events"
                set frontApp to first application process whose frontmost is true
                set appName to name of frontApp
                try
                    tell frontApp
                        set frontWindow to first window
                        set winName to name of frontWindow
                        set winPos to position of frontWindow
                        set winSize to size of frontWindow
                        return appName & "|" & winName & "|" & (item 1 of winPos) & "|" & (item 2 of winPos) & "|" & (item 1 of winSize) & "|" & (item 2 of winSize)
                    end tell
                on error
                    return appName & "|" & appName & "|0|0|0|0"
                end try
            end tell
        `;
        
        exec(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, (error, stdout, stderr) => {
            if (error) {
                console.error('[ScreenCapture] AppleScript error:', stderr);
                resolve({ title: 'Unknown', bounds: null });
                return;
            }
            
            const parts = stdout.trim().split('|');
            if (parts.length >= 6) {
                const width = parseInt(parts[4]);
                const height = parseInt(parts[5]);
                resolve({
                    title: parts[1] || parts[0],
                    bounds: width && height ? {
                        x: parseInt(parts[2]),
                        y: parseInt(parts[3]),
                        width: width,
                        height: height
                    } : null
                });
            } else {
                resolve({ title: stdout.trim() || 'Unknown', bounds: null });
            }
        });
    });
}

/**
 * Get foreground window info on Linux
 * Tries multiple methods for compatibility across distros
 */
async function getWindowInfoLinux() {
    // Try different methods in order of preference
    const methods = [
        getWindowInfoLinuxXdotool,
        getWindowInfoLinuxWmctrl,
        getWindowInfoLinuxXprop
    ];
    
    for (const method of methods) {
        try {
            const result = await method();
            if (result.title !== 'Unknown') {
                return result;
            }
        } catch (e) {
            // Try next method
        }
    }
    
    return { title: 'Unknown', bounds: null };
}

/**
 * Get window info using xdotool (most common)
 */
async function getWindowInfoLinuxXdotool() {
    return new Promise((resolve, reject) => {
        exec('xdotool getactivewindow getwindowname', (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            
            const title = stdout.trim();
            
            // Try to get geometry
            exec('xdotool getactivewindow getwindowgeometry --shell', (geoError, geoStdout) => {
                if (geoError) {
                    resolve({ title, bounds: null });
                    return;
                }
                
                // Parse geometry output
                const lines = geoStdout.split('\n');
                const geo = {};
                lines.forEach(line => {
                    const [key, value] = line.split('=');
                    if (key && value) {
                        geo[key.trim()] = parseInt(value.trim());
                    }
                });
                
                resolve({
                    title,
                    bounds: {
                        x: geo.X || 0,
                        y: geo.Y || 0,
                        width: geo.WIDTH || 0,
                        height: geo.HEIGHT || 0
                    }
                });
            });
        });
    });
}

/**
 * Get window info using wmctrl
 */
async function getWindowInfoLinuxWmctrl() {
    return new Promise((resolve, reject) => {
        exec('wmctrl -a :ACTIVE: -v 2>&1 | head -1', (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            
            // Parse wmctrl output
            const match = stdout.match(/Using window: (0x[0-9a-f]+)\s+(.+)/i);
            if (match) {
                resolve({ title: match[2].trim(), bounds: null });
            } else {
                reject(new Error('Could not parse wmctrl output'));
            }
        });
    });
}

/**
 * Get window info using xprop
 */
async function getWindowInfoLinuxXprop() {
    return new Promise((resolve, reject) => {
        exec('xprop -root _NET_ACTIVE_WINDOW', (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            
            const match = stdout.match(/window id # (0x[0-9a-f]+)/i);
            if (!match) {
                reject(new Error('Could not get active window ID'));
                return;
            }
            
            const windowId = match[1];
            
            exec(`xprop -id ${windowId} WM_NAME`, (nameError, nameStdout) => {
                if (nameError) {
                    resolve({ title: 'Unknown', bounds: null });
                    return;
                }
                
                const nameMatch = nameStdout.match(/WM_NAME\([^)]+\)\s*=\s*"(.+)"/);
                resolve({
                    title: nameMatch ? nameMatch[1] : 'Unknown',
                    bounds: null
                });
            });
        });
    });
}

/**
 * Capture the foreground window
 * @returns {Promise<{imageData: string, windowTitle: string, error?: string}>}
 */
async function captureForegroundWindow() {
    try {
        // Get info about the foreground window
        const windowInfo = await getForegroundWindowInfo();
        console.log('[ScreenCapture] Foreground window:', windowInfo);
        
        // Get all available sources
        const sources = await desktopCapturer.getSources({
            types: ['window', 'screen'],
            thumbnailSize: { width: 1920, height: 1080 },
            fetchWindowIcons: false
        });
        
        // Check if VARS window is in focus - if so, capture the screen instead
        const isVarsInFocus = windowInfo.title && windowInfo.title.toLowerCase().includes('vars');
        
        // Try to find the matching window source (skip if VARS is in focus)
        let targetSource = null;
        
        if (!isVarsInFocus && windowInfo.title && windowInfo.title !== 'Unknown' && windowInfo.title !== 'Active Window') {
            // Try exact match first
            targetSource = sources.find(s => 
                s.name === windowInfo.title || 
                s.name.includes(windowInfo.title) ||
                windowInfo.title.includes(s.name)
            );
            
            // Try partial match
            if (!targetSource) {
                const titleWords = windowInfo.title.toLowerCase().split(/[\s\-–—|:]+/);
                targetSource = sources.find(s => {
                    const sourceName = s.name.toLowerCase();
                    // Skip VARS window in source matching too
                    if (sourceName.includes('vars')) return false;
                    return titleWords.some(word => word.length > 3 && sourceName.includes(word));
                });
            }
        }
        
        // If VARS is in focus or no window match found, capture the primary screen
        if (!targetSource) {
            console.log('[ScreenCapture] Capturing screen (VARS in focus or no window match)');
            targetSource = sources.find(s => s.id.startsWith('screen:'));
            
            // Update window info title for screen capture
            if (targetSource && isVarsInFocus) {
                windowInfo.title = 'Desktop Screen';
            }
        }
        
        if (!targetSource) {
            return { error: 'Could not find a valid capture source' };
        }
        
        console.log('[ScreenCapture] Using source:', targetSource.name);
        
        // Get the thumbnail from desktopCapturer
        let imageData;
        
        if (targetSource.thumbnail && !targetSource.thumbnail.isEmpty()) {
            // Use the thumbnail directly (already captured)
            const dataUrl = targetSource.thumbnail.toDataURL();
            imageData = dataUrl;
        } else {
            // Need to capture the screen/window using getUserMedia
            // This is a fallback when thumbnail is not available
            imageData = await captureWithMediaStream(targetSource.id, windowInfo.bounds);
        }
        
        // Determine the best title to use
        let finalTitle = 'Screen';
        
        if (windowInfo.title && windowInfo.title !== 'Unknown') {
            finalTitle = windowInfo.title;
        } else if (targetSource.name && targetSource.name !== 'Unknown') {
            // Clean up source name (remove technical prefixes)
            finalTitle = targetSource.name;
            // If it's a screen source, give it a friendly name
            if (targetSource.id.startsWith('screen:')) {
                finalTitle = 'Desktop Screen';
            }
        }
        
        return {
            imageData,
            windowTitle: finalTitle
        };
        
    } catch (error) {
        console.error('[ScreenCapture] Error:', error);
        return { error: error.message };
    }
}

/**
 * Capture using MediaStream (fallback method)
 * @param {string} sourceId - The source ID for capture
 * @param {object|null} bounds - Optional bounds for cropping
 * @returns {Promise<string>} Base64 encoded image data
 */
async function captureWithMediaStream(sourceId, bounds) {
    // Create a hidden window for capture
    const captureWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    
    try {
        // Load a simple HTML page that will capture
        const captureScript = `
            <!DOCTYPE html>
            <html>
            <body>
                <video id="video" autoplay style="display:none;"></video>
                <canvas id="canvas"></canvas>
                <script>
                    async function capture() {
                        try {
                            const stream = await navigator.mediaDevices.getUserMedia({
                                audio: false,
                                video: {
                                    mandatory: {
                                        chromeMediaSource: 'desktop',
                                        chromeMediaSourceId: '${sourceId}'
                                    }
                                }
                            });
                            
                            const video = document.getElementById('video');
                            video.srcObject = stream;
                            
                            await new Promise(resolve => {
                                video.onloadedmetadata = resolve;
                            });
                            
                            const canvas = document.getElementById('canvas');
                            canvas.width = video.videoWidth;
                            canvas.height = video.videoHeight;
                            
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(video, 0, 0);
                            
                            stream.getTracks().forEach(track => track.stop());
                            
                            return canvas.toDataURL('image/png');
                        } catch (e) {
                            return { error: e.message };
                        }
                    }
                    
                    capture().then(result => {
                        window.captureResult = result;
                    });
                </script>
            </body>
            </html>
        `;
        
        await captureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(captureScript)}`);
        
        // Wait for capture to complete
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const result = await captureWindow.webContents.executeJavaScript('window.captureResult');
        
        if (result && result.error) {
            throw new Error(result.error);
        }
        
        return result;
        
    } finally {
        captureWindow.destroy();
    }
}

module.exports = {
    captureForegroundWindow,
    getForegroundWindowInfo
};
