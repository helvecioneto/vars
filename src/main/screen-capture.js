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
 * Target resolution for AI analysis (smaller = fewer tokens)
 * The original screen dimensions are preserved for coordinate mapping
 */
const TARGET_WIDTH = 1280;  // Target width for resized image
const TARGET_HEIGHT = 720;  // Target height (maintains aspect ratio)
const JPEG_QUALITY = 75;    // JPEG quality (0-100)

/**
 * Linux native screenshot tools in order of preference
 * Works across Ubuntu, Arch, Fedora, OpenSUSE, etc.
 * Note: spectacle requires -b -n -o flags for silent operation on KDE
 */
const LINUX_SCREENSHOT_TOOLS = [
    { cmd: 'gnome-screenshot', args: ['-f'], name: 'GNOME Screenshot' },
    { cmd: 'spectacle', args: ['-b', '-n', '-o'], name: 'KDE Spectacle' },
    { cmd: 'scrot', args: [], name: 'Scrot' },
    { cmd: 'maim', args: [], name: 'Maim' },
    { cmd: 'import', args: ['-window', 'root'], name: 'ImageMagick' }
];

// Cache detected screenshot tool
let detectedScreenshotTool = null;
let screenshotToolChecked = false;


/**
 * Detect available screenshot tool on Linux
 * @returns {object|null} Tool configuration or null if none found
 */
function detectLinuxScreenshotTool() {
    if (screenshotToolChecked) {
        return detectedScreenshotTool;
    }

    screenshotToolChecked = true;

    for (const tool of LINUX_SCREENSHOT_TOOLS) {
        try {
            execSync(`which ${tool.cmd}`, { stdio: 'ignore' });
            console.log(`[ScreenCapture] Found Linux screenshot tool: ${tool.name}`);
            detectedScreenshotTool = tool;
            return tool;
        } catch (e) {
            // Tool not found, try next
        }
    }

    console.warn('[ScreenCapture] No native screenshot tool found on Linux');
    return null;
}

/**
 * Resize image using ImageMagick convert
 * @param {string} inputPath - Path to input image
 * @param {string} outputPath - Path to save resized image
 * @param {number} targetWidth - Target width
 * @param {number} quality - JPEG quality (0-100)
 * @returns {Promise<boolean>} true if successful
 */
async function resizeImage(inputPath, outputPath, targetWidth = TARGET_WIDTH, quality = JPEG_QUALITY) {
    return new Promise((resolve) => {
        // Use ImageMagick convert to resize maintaining aspect ratio
        const cmd = `convert "${inputPath}" -resize ${targetWidth}x -quality ${quality} "${outputPath}"`;

        exec(cmd, { timeout: 5000 }, (error) => {
            if (error) {
                console.log('[ScreenCapture] Resize failed, using original:', error.message);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

/**
 * Capture screen using native Linux tools
 * @returns {Promise<{imageData: string, windowTitle: string}|null>}
 */
async function captureScreenLinuxNative() {
    const tool = detectLinuxScreenshotTool();

    if (!tool) {
        return null;
    }

    const tempFile = path.join(os.tmpdir(), `vars-screenshot-${Date.now()}.png`);

    try {
        // Build command based on tool
        let command;
        switch (tool.cmd) {
            case 'scrot':
                command = `scrot \"${tempFile}\"`;
                break;
            case 'maim':
                command = `maim \"${tempFile}\"`;
                break;
            case 'import':
                command = `import -window root \"${tempFile}\"`;
                break;
            case 'gnome-screenshot':
                command = `gnome-screenshot -f \"${tempFile}\"`;
                break;
            case 'spectacle':
                // -b (background), -n (no notification), -o (output)
                command = `spectacle -b -n -o \"${tempFile}\"`;
                break;
            default:
                return null;
        }

        console.log(`[ScreenCapture] Using native Linux tool: ${tool.name}`);

        // Execute screenshot command
        await new Promise((resolve, reject) => {
            exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });

        // Wait a bit for file to be written
        await new Promise(resolve => setTimeout(resolve, 200));

        // Check if file exists
        if (!fs.existsSync(tempFile)) {
            throw new Error('Screenshot file not created');
        }

        // Resize image to reduce tokens (uses ImageMagick convert)
        const resizedFile = tempFile.replace('.png', '-resized.jpg');
        const didResize = await resizeImage(tempFile, resizedFile);

        // Use resized file if resize succeeded, otherwise use original
        const fileToRead = didResize && fs.existsSync(resizedFile) ? resizedFile : tempFile;
        const mimeType = didResize ? 'image/jpeg' : 'image/png';

        // Read and convert to base64
        const imageBuffer = await fsPromises.readFile(fileToRead);
        const base64Image = imageBuffer.toString('base64');
        const imageData = `data:${mimeType};base64,${base64Image}`;

        // Cleanup resized file
        if (didResize && fs.existsSync(resizedFile)) {
            try { fs.unlinkSync(resizedFile); } catch (e) { }
        }

        // Get window info for title
        const windowInfo = await getForegroundWindowInfo();
        const windowTitle = windowInfo.title !== 'Unknown' ? windowInfo.title : 'Desktop Screen';

        console.log(`[ScreenCapture] Native capture completed (resized: ${didResize})`);

        return {
            imageData,
            windowTitle
        };

    } catch (error) {
        console.error('[ScreenCapture] Native capture error:', error.message);
        return null;
    } finally {
        // Cleanup temp file
        try {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

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
 * Uses PowerShell to iterate through Z-order and find the first visible window that is NOT VARS
 * This is necessary because VARS is always-on-top and would be returned by GetForegroundWindow
 */
async function getWindowInfoWindows() {
    return new Promise((resolve, reject) => {
        // PowerShell script that iterates through windows in Z-order,
        // skipping VARS window to find the actual application window
        const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    
    public const uint GW_HWNDNEXT = 2;
    
    public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

$hwnd = [Win32]::GetForegroundWindow()
$found = $false
$maxIterations = 50

while ($hwnd -ne [IntPtr]::Zero -and -not $found -and $maxIterations -gt 0) {
    $maxIterations--
    
    if ([Win32]::IsWindowVisible($hwnd)) {
        $textLen = [Win32]::GetWindowTextLength($hwnd)
        if ($textLen -gt 0) {
            $sb = New-Object System.Text.StringBuilder ($textLen + 1)
            [void][Win32]::GetWindowText($hwnd, $sb, $sb.Capacity)
            $title = $sb.ToString()
            
            # Skip VARS window - check for exact match or prefix
            if ($title -and $title -ne "VARS" -and -not $title.StartsWith("VARS")) {
                $found = $true
                $rect = New-Object Win32+RECT
                [void][Win32]::GetWindowRect($hwnd, [ref]$rect)
                $width = $rect.Right - $rect.Left
                $height = $rect.Bottom - $rect.Top
                
                # Skip windows that are too small (likely system windows)
                if ($width -gt 100 -and $height -gt 100) {
                    Write-Output "$title|$($rect.Left)|$($rect.Top)|$width|$height"
                } else {
                    $found = $false
                }
            }
        }
    }
    
    if (-not $found) {
        $hwnd = [Win32]::GetWindow($hwnd, [Win32]::GW_HWNDNEXT)
    }
}

if (-not $found) {
    Write-Output "Desktop|0|0|1920|1080"
}
`;

        // Write script to temp file and execute
        const tempScript = path.join(os.tmpdir(), `vars-capture-${Date.now()}.ps1`);

        fs.writeFileSync(tempScript, script, 'utf8');

        exec(`powershell -ExecutionPolicy Bypass -File "${tempScript}"`, { timeout: 5000 }, (error, stdout, stderr) => {
            // Clean up temp file
            try { fs.unlinkSync(tempScript); } catch (e) { }

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
 * Uses AppleScript to find the first visible window that is NOT VARS
 * This iterates through visible application processes to skip our own window
 */
async function getWindowInfoMacOS() {
    return new Promise((resolve, reject) => {
        // AppleScript that iterates through visible processes, skipping VARS
        const script = `
            tell application "System Events"
                set visibleProcesses to application processes whose visible is true
                repeat with proc in visibleProcesses
                    set procName to name of proc
                    -- Skip VARS application
                    if procName is not "VARS" and procName is not "Electron" then
                        try
                            tell proc
                                if (count of windows) > 0 then
                                    set frontWindow to first window
                                    set winName to name of frontWindow
                                    set winPos to position of frontWindow
                                    set winSize to size of frontWindow
                                    return procName & "|" & winName & "|" & (item 1 of winPos) & "|" & (item 2 of winPos) & "|" & (item 1 of winSize) & "|" & (item 2 of winSize)
                                end if
                            end tell
                        end try
                    end if
                end repeat
                return "Desktop|Desktop|0|0|1920|1080"
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
 * Searches for visible windows and skips VARS window
 */
async function getWindowInfoLinuxXdotool() {
    return new Promise((resolve, reject) => {
        // First get the active window
        exec('xdotool getactivewindow getwindowname', (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }

            const title = stdout.trim();

            // If the active window is VARS, search for another window
            if (title === 'VARS' || title.startsWith('VARS')) {
                // Use xdotool to search for all visible windows and find one that's not VARS
                exec('xdotool search --onlyvisible --name "." 2>/dev/null', (searchError, searchStdout) => {
                    if (searchError || !searchStdout.trim()) {
                        resolve({ title: 'Desktop', bounds: null });
                        return;
                    }

                    const windowIds = searchStdout.trim().split('\n');

                    // Find first window that's not VARS
                    const checkNextWindow = (index) => {
                        if (index >= windowIds.length) {
                            resolve({ title: 'Desktop', bounds: null });
                            return;
                        }

                        const wid = windowIds[index];
                        exec(`xdotool getwindowname ${wid}`, (nameError, nameStdout) => {
                            const winTitle = nameStdout ? nameStdout.trim() : '';

                            if (winTitle && winTitle !== 'VARS' && !winTitle.startsWith('VARS')) {
                                // Get geometry for this window
                                exec(`xdotool getwindowgeometry --shell ${wid}`, (geoError, geoStdout) => {
                                    if (geoError) {
                                        resolve({ title: winTitle, bounds: null });
                                        return;
                                    }

                                    const lines = geoStdout.split('\n');
                                    const geo = {};
                                    lines.forEach(line => {
                                        const [key, value] = line.split('=');
                                        if (key && value) {
                                            geo[key.trim()] = parseInt(value.trim());
                                        }
                                    });

                                    resolve({
                                        title: winTitle,
                                        bounds: {
                                            x: geo.X || 0,
                                            y: geo.Y || 0,
                                            width: geo.WIDTH || 0,
                                            height: geo.HEIGHT || 0
                                        }
                                    });
                                });
                            } else {
                                checkNextWindow(index + 1);
                            }
                        });
                    };

                    checkNextWindow(0);
                });
            } else {
                // Active window is not VARS, use it directly
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
            }
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
        // On Linux, prefer native screenshot tools to avoid PipeWire issues
        if (process.platform === 'linux') {
            try {
                const result = await captureScreenLinuxNative();
                if (result && result.imageData) {
                    return result;
                }
            } catch (error) {
                console.log('[ScreenCapture] Native capture failed, trying desktopCapturer:', error.message);
            }
        }

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

/**
 * Capture the entire primary screen (for quiz solver)
 * Returns image data and screen dimensions for accurate coordinate mapping
 * @returns {Promise<{imageData: string, screenWidth: number, screenHeight: number, error?: string}>}
 */
async function captureFullScreen() {
    try {
        // Get primary display info
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.size;
        const scaleFactor = primaryDisplay.scaleFactor || 1;

        console.log(`[ScreenCapture] Primary display: ${screenWidth}x${screenHeight}, scale: ${scaleFactor}`);

        // On Linux, ONLY use native screenshot tools - DO NOT fall back to desktopCapturer
        // desktopCapturer triggers screen sharing dialogs on Wayland/KDE
        if (process.platform === 'linux') {
            try {
                const result = await captureScreenLinuxNative();
                if (result && result.imageData) {
                    return {
                        imageData: result.imageData,
                        screenWidth,
                        screenHeight,
                        windowTitle: 'Full Screen'
                    };
                }
            } catch (error) {
                console.log('[ScreenCapture] Native capture failed:', error.message);
            }

            // On Linux, if native tools fail, return error - DO NOT use desktopCapturer
            return {
                error: 'Native screenshot tools not available. Install scrot, maim, or import (ImageMagick).'
            };
        }

        // Use desktopCapturer for screen capture
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
                width: Math.round(screenWidth * scaleFactor),
                height: Math.round(screenHeight * scaleFactor)
            },
            fetchWindowIcons: false
        });

        // Find primary screen
        const screenSource = sources.find(s => s.id.startsWith('screen:')) || sources[0];

        if (!screenSource) {
            return { error: 'Could not find screen source' };
        }

        console.log('[ScreenCapture] Using screen source:', screenSource.name);

        let imageData;
        if (screenSource.thumbnail && !screenSource.thumbnail.isEmpty()) {
            // Do NOT resize to 1024px. Use full resolution for better AI accuracy.
            // OpenAI and Google verify resize automatically if needed, but we want max detail.
            // Use JPEG with 80% quality to keep size manageable but high resolution.
            const buffer = screenSource.thumbnail.toJPEG(80);
            imageData = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        } else {
            return { error: 'Screen thumbnail is empty' };
        }

        return {
            imageData,
            screenWidth,
            screenHeight,
            windowTitle: 'Full Screen'
        };

    } catch (error) {
        console.error('[ScreenCapture] Full screen capture error:', error);
        return { error: error.message };
    }
}

module.exports = {
    captureForegroundWindow,
    captureFullScreen,
    getForegroundWindowInfo
};

