#!/usr/bin/env node
/**
 * Postinstall: fix @kutalia/whisper-node-addon's broken shipping rpaths.
 *
 * The published package@1.1.0 has two issues out of the box:
 *   1. The JS loader looks for `${platform}-${arch}` (e.g. "darwin-arm64") but
 *      the prebuilt directories are named "mac-arm64", "mac-x64", "linux-x64",
 *      "win32-x64". We bypass the loader in our own code, so this script only
 *      needs to handle #2.
 *   2. The macOS .dylibs + whisper.node only have one LC_RPATH, hardcoded to
 *      the CI server's build path (`/Users/runner/work/.../Release`). dlopen
 *      cannot find the sibling libs at runtime. We add `@loader_path` so they
 *      resolve next to the addon.
 *
 * Linux and Windows binaries already work without patching, because we set
 * LD_LIBRARY_PATH / PATH at runtime (see src/main/providers/local/whisper.js).
 *
 * This script is idempotent — running it twice is a no-op.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function log(msg) { console.log(`[postinstall-whisper] ${msg}`); }

function tryPatchMac(addonDir) {
    if (!fs.existsSync(addonDir)) return;

    let installNameTool;
    try {
        installNameTool = execFileSync('xcrun', ['--find', 'install_name_tool'], { encoding: 'utf8' }).trim();
    } catch {
        installNameTool = 'install_name_tool';
    }

    const files = fs.readdirSync(addonDir).filter(f => /\.(node|dylib)$/.test(f));
    for (const file of files) {
        const filePath = path.join(addonDir, file);
        // Check existing LC_RPATHs to keep this idempotent.
        let alreadyPatched = false;
        try {
            const rpaths = execFileSync('otool', ['-l', filePath], { encoding: 'utf8' });
            alreadyPatched = /\bpath\s+@loader_path\b/.test(rpaths);
        } catch (err) {
            log(`Could not inspect ${file} (otool missing?): ${err.message}`);
        }
        if (alreadyPatched) continue;
        try {
            execFileSync(installNameTool, ['-add_rpath', '@loader_path', filePath]);
            log(`Added @loader_path rpath to ${path.relative(process.cwd(), filePath)}`);
        } catch (err) {
            log(`Could not patch ${file}: ${err.message}`);
        }
    }
}

function main() {
    const addonRoot = path.resolve(__dirname, '..', 'node_modules', '@kutalia', 'whisper-node-addon', 'dist');
    if (!fs.existsSync(addonRoot)) {
        // Package not installed (e.g. fresh clone, npm install skipped optional). Nothing to do.
        return;
    }

    if (process.platform === 'darwin') {
        tryPatchMac(path.join(addonRoot, 'mac-arm64'));
        tryPatchMac(path.join(addonRoot, 'mac-x64'));
    }
    // Linux and Windows: handled at runtime via env vars in whisper.js.
}

main();
