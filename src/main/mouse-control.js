/**
 * VARS - Mouse Control Module
 * Universal Mouse Control Service
 * Supports: Windows, macOS, Linux (X11 & Wayland via dotool/ydotool)
 */

const { execSync, exec } = require('child_process');
const { mouse, Point, Button } = require('@nut-tree-fork/nut-js');
const os = require('os');

// Configuration
const YDOTOOL_SOCKET = process.env.YDOTOOL_SOCKET || '/tmp/.ydotool_socket';
const DISPLAY = process.env.DISPLAY && process.env.DISPLAY !== ':0' ? process.env.DISPLAY : ':1';

// Detect Wayland session
const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' ||
    process.env.WAYLAND_DISPLAY !== undefined;

// State
let activeDriver = null;

// ==========================================
// HELPER FUNCTIONS (needed before drivers)
// ==========================================

/**
 * Internal function to get screen size (used by drivers during init)
 */
async function getScreenSizeInternal() {
    const platform = os.platform();

    if (platform === 'linux') {
        try {
            // For KDE Wayland: Use kscreen-doctor
            if (isWayland) {
                try {
                    const output = execSync('kscreen-doctor -o 2>/dev/null | head -20', { encoding: 'utf8', timeout: 2000 });
                    const match = output.match(/(\d+)x(\d+)@/);
                    if (match) {
                        return { width: parseInt(match[1]), height: parseInt(match[2]) };
                    }
                } catch (e) { }

                // Try wlr-randr (for wlroots compositors)
                try {
                    const output = execSync('wlr-randr 2>/dev/null | head -10', { encoding: 'utf8', timeout: 2000 });
                    const match = output.match(/(\d+)x(\d+)/);
                    if (match) {
                        return { width: parseInt(match[1]), height: parseInt(match[2]) };
                    }
                } catch (e) { }
            }

            // For X11: Use xdpyinfo
            try {
                const output = execSync(`DISPLAY=${DISPLAY} xdpyinfo 2>/dev/null | grep dimensions`, { encoding: 'utf8', timeout: 2000 });
                const match = output.match(/(\d+)x(\d+)/);
                if (match) {
                    return { width: parseInt(match[1]), height: parseInt(match[2]) };
                }
            } catch (e) { }
        } catch (e) {
            console.warn('[MouseControl] Could not detect screen size:', e.message);
        }
    }

    // Fallback to common resolution
    return { width: 1920, height: 1080 };
}

// ==========================================
// DRIVERS
// ==========================================

const drivers = {
    // Dotool Driver (Best for Wayland - uses uinput, no root needed if in input group)
    dotool: {
        name: 'dotool',
        screenSize: null,
        async init() {
            try {
                // Check if dotool is available
                execSync('which dotool', { stdio: 'ignore' });
                // Test a simple command
                execSync('echo "" | dotool', { stdio: 'ignore', timeout: 2000 });

                // Cache screen size for coordinate conversion
                this.screenSize = await getScreenSizeInternal();
                console.log(`[MouseControl] dotool screen size: ${this.screenSize.width}x${this.screenSize.height}`);

                return true;
            } catch (e) {
                console.log('[MouseControl] dotool not available:', e.message);
                return false;
            }
        },
        async move(x, y) {
            // dotool uses percentages (0.0 to 1.0), not pixels!
            const xPercent = Math.max(0, Math.min(1, x / this.screenSize.width));
            const yPercent = Math.max(0, Math.min(1, y / this.screenSize.height));

            return new Promise((resolve) => {
                exec(`echo "mouseto ${xPercent.toFixed(6)} ${yPercent.toFixed(6)}" | dotool`, (err) => {
                    if (err) console.error('[MouseControl] dotool move error:', err.message);
                    resolve(!err);
                });
            });
        },
        async moveRelative(dx, dy) {
            // dotool uses "mousemove dx dy" for relative movement
            // dx/dy are also relative to screen size? Or pixels?
            // "mousemove" in dotool usually takes relative vales like 0.1, -0.1
            // But we have pixels. We need to convert pixels to relative fraction.

            const dxPercent = dx / this.screenSize.width;
            const dyPercent = dy / this.screenSize.height;

            return new Promise((resolve) => {
                exec(`echo "mousemove ${dxPercent.toFixed(6)} ${dyPercent.toFixed(6)}" | dotool`, (err) => {
                    if (err) console.error('[MouseControl] dotool moveRelative error:', err.message);
                    resolve(!err);
                });
            });
        },
        async click() {
            return new Promise((resolve) => {
                // dotool uses "click left" for left click
                exec('echo "click left" | dotool', (err) => {
                    if (err) console.error('[MouseControl] dotool click error:', err.message);
                    resolve(!err);
                });
            });
        },
        async getPos() {
            // dotool doesn't have a getpos command, fallback to nut-js
            try {
                const pos = await mouse.getPosition();
                return { x: pos.x, y: pos.y };
            } catch (e) {
                console.warn('[MouseControl] getPos fallback failed:', e.message);
                return { x: 0, y: 0 };
            }
        }
    },

    // XDotool Driver (Best for Linux X11 and Wayland via XWayland)
    xdotool: {
        name: 'xdotool',
        async init() {
            try {
                execSync(`DISPLAY=${DISPLAY} xdotool --version`, { stdio: 'ignore' });
                return true;
            } catch (e) {
                return false;
            }
        },
        async move(x, y) {
            return new Promise((resolve) => {
                exec(`DISPLAY=${DISPLAY} xdotool mousemove ${Math.round(x)} ${Math.round(y)}`, (err) => resolve(!err));
            });
        },
        async moveRelative(dx, dy) {
            return new Promise((resolve) => {
                // xdotool mousemove_relative -- dx dy
                // The -- is important for negative numbers
                exec(`DISPLAY=${DISPLAY} xdotool mousemove_relative -- ${Math.round(dx)} ${Math.round(dy)}`, (err) => resolve(!err));
            });
        },
        async click() {
            return new Promise((resolve) => {
                exec(`DISPLAY=${DISPLAY} xdotool click 1`, (err) => resolve(!err));
            });
        },
        async getPos() {
            try {
                // Parse output: "x:1280 y:540 ..."
                const stdout = execSync(`DISPLAY=${DISPLAY} xdotool getmouselocation`).toString();
                const xMatch = stdout.match(/x:(\d+)/);
                const yMatch = stdout.match(/y:(\d+)/);
                if (xMatch && yMatch) {
                    return { x: parseInt(xMatch[1]), y: parseInt(yMatch[1]) };
                }
            } catch (e) { }
            // Fallback to nut-js for reading
            const pos = await mouse.getPosition();
            return { x: pos.x, y: pos.y };
        }
    },

    // Ydotool driver (Fallback for Wayland without dotool)
    ydotool: {
        name: 'ydotool',
        async init() {
            try {
                execSync(`YDOTOOL_SOCKET=${YDOTOOL_SOCKET} ydotool mousemove --help`, { stdio: 'ignore' });
                return true;
            } catch (e) {
                return false;
            }
        },
        async move(x, y) {
            return new Promise((resolve) => {
                exec(`YDOTOOL_SOCKET=${YDOTOOL_SOCKET} ydotool mousemove --absolute -x ${Math.round(x)} -y ${Math.round(y)}`, (err) => resolve(!err));
            });
        },
        async moveRelative(dx, dy) {
            return new Promise((resolve) => {
                exec(`YDOTOOL_SOCKET=${YDOTOOL_SOCKET} ydotool mousemove -x ${Math.round(dx)} -y ${Math.round(dy)}`, (err) => resolve(!err));
            });
        },
        async click() {
            return new Promise((resolve) => {
                exec(`YDOTOOL_SOCKET=${YDOTOOL_SOCKET} ydotool click 0xC000`, (err) => resolve(!err));
            });
        },
        async getPos() {
            const pos = await mouse.getPosition();
            return { x: pos.x, y: pos.y };
        }
    },

    // Standard nut-js driver (Windows, macOS)
    nutjs: {
        name: 'nut-js',
        async init() {
            mouse.config.autoDelayMs = 0;
            mouse.config.mouseSpeed = 2000;
            return true;
        },
        async move(x, y) {
            await mouse.setPosition(new Point(Math.round(x), Math.round(y)));
        },
        async moveRelative(dx, dy) {
            const current = await mouse.getPosition();
            await mouse.setPosition(new Point(Math.round(current.x + dx), Math.round(current.y + dy)));
        },
        async click() {
            await mouse.click(Button.LEFT);
        },
        async getPos() {
            const pos = await mouse.getPosition();
            return { x: pos.x, y: pos.y };
        }
    }
};

// ==========================================
// PUBLIC API
// ==========================================

async function initialize() {
    if (activeDriver) return activeDriver;

    const platform = os.platform();

    console.log(`[MouseControl] Platform: ${platform}, Wayland: ${isWayland}, DISPLAY: ${DISPLAY}`);

    // Linux: Choose driver based on environment
    if (platform === 'linux') {
        // 1. Wayland: Try dotool first (most reliable for KDE/GNOME Wayland)
        if (isWayland) {
            console.log('[MouseControl] Wayland detected, trying dotool...');
            if (await drivers.dotool.init()) {
                activeDriver = drivers.dotool;
                console.log('[MouseControl] Selected: dotool (Wayland)');
                return activeDriver;
            }

            // 2. Wayland: Try ydotool as fallback
            console.log('[MouseControl] dotool not available, trying ydotool...');
            if (await drivers.ydotool.init()) {
                activeDriver = drivers.ydotool;
                console.log('[MouseControl] Selected: ydotool (Wayland fallback)');
                return activeDriver;
            }
        }

        // 3. X11 or XWayland: Try xdotool
        console.log(`[MouseControl] Trying xdotool (DISPLAY=${DISPLAY})...`);
        if (await drivers.xdotool.init()) {
            activeDriver = drivers.xdotool;
            console.log('[MouseControl] Selected: xdotool');
            return activeDriver;
        }

        // 4. Linux fallback: Try dotool even on X11 (it works there too)
        if (!isWayland && await drivers.dotool.init()) {
            activeDriver = drivers.dotool;
            console.log('[MouseControl] Selected: dotool (X11 fallback)');
            return activeDriver;
        }
    }

    // 5. Final fallback / Windows / macOS: nut-js
    activeDriver = drivers.nutjs;
    await activeDriver.init();
    console.log('[MouseControl] Selected: nut-js');
    return activeDriver;
}

async function checkAvailability() {
    try {
        const driver = await initialize();
        return { available: true, tool: driver.name };
    } catch (e) {
        console.error('[MouseControl] Initialization failed:', e);
        return {
            available: false,
            error: `Mouse control unavailable. On Wayland, install dotool: yay -S dotool-git && sudo usermod -aG input $USER`
        };
    }
}

async function getMousePosition() {
    const driver = await initialize();
    return driver.getPos();
}

async function moveMouse(x, y) {
    const driver = await initialize();
    console.log(`[MouseControl] Moving to ${x},${y} using ${driver.name}`);
    return driver.move(x, y);
}

async function moveRelative(dx, dy) {
    const driver = await initialize();
    // console.log(`[MouseControl] Moving relative ${dx},${dy} using ${driver.name}`);
    if (driver.moveRelative) {
        return driver.moveRelative(dx, dy);
    } else {
        // Fallback for drivers missing implementation (shouldn't happen)
        const current = await driver.getPos();
        return driver.move(current.x + dx, current.y + dy);
    }
}

async function click(x, y) {
    const driver = await initialize();
    if (x !== undefined && y !== undefined) {
        await driver.move(x, y);
        await new Promise(r => setTimeout(r, 100));
    }
    console.log(`[MouseControl] Clicking using ${driver.name}`);
    return driver.click();
}

async function getScreenSize() {
    return getScreenSizeInternal();
}

module.exports = {
    getMousePosition,
    moveMouse,
    moveRelative,
    click,
    getScreenSize,
    checkAvailability,
    smoothMove: moveMouse,
    doubleClick: async (x, y) => {
        await click(x, y);
        await new Promise(r => setTimeout(r, 100));
        await click();
    }
};
