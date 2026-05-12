/**
 * VARS - Local Whisper Transcription
 * Uses @kutalia/whisper-node-addon (whisper.cpp with prebuilt cross-platform binaries).
 *
 * Ships native .node + accompanying shared libraries for:
 *   mac-arm64, mac-x64, linux-x64, win32-x64
 *
 * NOTE: The published package@1.1.0 has a broken JS loader (looks for
 * "darwin-arm64" instead of "mac-arm64") and macOS binaries with a hardcoded
 * CI server rpath. We bypass the loader entirely by requiring the .node file
 * directly with our own platform mapping, and a postinstall script
 * (scripts/postinstall-whisper.js) fixes the macOS rpath with install_name_tool.
 * Linux and Windows resolve the sibling .so/.dll via env vars set below.
 *
 * Runs entirely offline once the GGML model is downloaded — no API key needed.
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { getModelPath, isModelDownloaded, DEFAULT_MODEL } = require('./model-manager');

// process.platform / process.arch → published directory name in the addon.
// Anything not in this map means "no prebuilt binary for this platform".
const PLATFORM_DIR = {
    'darwin-arm64': 'mac-arm64',
    'darwin-x64':   'mac-x64',
    'linux-x64':    'linux-x64',
    'win32-x64':    'win32-x64',
};

let whisperTranscribe = null;     // promisified addon.whisper function
let lastLoadedModelPath = null;

function resolveAddonDir() {
    const key = `${process.platform}-${process.arch}`;
    const subdir = PLATFORM_DIR[key];
    if (!subdir) {
        throw new Error(
            `Local Whisper has no prebuilt binary for ${key}. ` +
            `Supported: ${Object.keys(PLATFORM_DIR).join(', ')}. ` +
            `Use cloud transcription in Settings > Audio instead.`
        );
    }
    return path.resolve(__dirname, '..', '..', '..', '..', 'node_modules', '@kutalia', 'whisper-node-addon', 'dist', subdir);
}

/**
 * Prepend the addon's directory to the OS's dynamic library search path so
 * the .node can locate its sibling .so / .dll at dlopen time. macOS uses an
 * LC_RPATH patched at postinstall, so no env var is needed there.
 */
function prepareDynamicLibraryPath(addonDir) {
    if (process.platform === 'linux') {
        const cur = process.env.LD_LIBRARY_PATH || '';
        if (!cur.split(':').includes(addonDir)) {
            process.env.LD_LIBRARY_PATH = addonDir + (cur ? ':' + cur : '');
        }
    } else if (process.platform === 'win32') {
        const cur = process.env.PATH || '';
        if (!cur.split(';').includes(addonDir)) {
            process.env.PATH = addonDir + (cur ? ';' + cur : '');
        }
    }
}

function getWhisperFn() {
    if (whisperTranscribe) return whisperTranscribe;

    let addonDir;
    try {
        addonDir = resolveAddonDir();
    } catch (err) {
        throw err;
    }

    const addonFile = path.join(addonDir, 'whisper.node');
    if (!fs.existsSync(addonFile)) {
        throw new Error(
            `Local Whisper binary not found at ${addonFile}. ` +
            `Run \`npm install\` from the project root and restart VARS.`
        );
    }

    prepareDynamicLibraryPath(addonDir);

    let addon;
    try {
        addon = require(addonFile);
    } catch (err) {
        throw new Error(
            `Local Whisper failed to load (${process.platform}/${process.arch}): ${err.message}. ` +
            `If you just ran npm install, the postinstall script may have failed — ` +
            `try \`node scripts/postinstall-whisper.js\` manually.`
        );
    }

    if (typeof addon.whisper !== 'function') {
        throw new Error('Local Whisper addon loaded but does not export a "whisper" function');
    }

    whisperTranscribe = promisify(addon.whisper);
    return whisperTranscribe;
}

function isLocalWhisperAvailable() {
    try {
        getWhisperFn();
        return true;
    } catch {
        return false;
    }
}

/**
 * Pre-warm the native addon with a chosen model. With this addon transcription
 * is per-call, but we still track the "active" model for status reporting and
 * to surface errors early when a user picks a not-yet-downloaded model.
 */
async function loadModel(modelName = DEFAULT_MODEL) {
    getWhisperFn();

    const downloaded = await isModelDownloaded(modelName);
    if (!downloaded) {
        throw new Error(`Model "${modelName}" not downloaded. Download it first in Settings > Audio.`);
    }

    const modelPath = getModelPath(modelName);
    if (lastLoadedModelPath !== modelPath) {
        console.log(`[LocalWhisper] Active model set to: ${modelName} (${modelPath})`);
        lastLoadedModelPath = modelPath;
    }
}

function unloadModel() {
    lastLoadedModelPath = null;
    console.log('[LocalWhisper] Active model cleared');
}

/**
 * Convert audio to 16kHz mono WAV using bundled ffmpeg-static.
 * Used as fallback when input isn't already PCM-decodable.
 */
async function convertToWavWithFfmpeg(audioData) {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const os = require('os');
    const execFileAsync = promisify(execFile);

    let ffmpegPath;
    try {
        ffmpegPath = require('ffmpeg-static');
    } catch (err) {
        throw new Error('ffmpeg-static not available: ' + err.message);
    }

    const tempInput = path.join(os.tmpdir(), `whisper-in-${Date.now()}.webm`);
    const tempOutput = path.join(os.tmpdir(), `whisper-out-${Date.now()}.wav`);

    try {
        fs.writeFileSync(tempInput, audioData);
        await execFileAsync(ffmpegPath, [
            '-i', tempInput,
            '-ar', '16000',
            '-ac', '1',
            '-sample_fmt', 's16',
            '-f', 'wav',
            '-y',
            tempOutput
        ], { timeout: 30000 });

        const wavData = fs.readFileSync(tempOutput);
        console.log(`[LocalWhisper] ffmpeg converted ${audioData.length} bytes → ${wavData.length} bytes WAV`);
        return new Uint8Array(wavData);
    } finally {
        try { fs.unlinkSync(tempInput); } catch (_) {}
        try { fs.unlinkSync(tempOutput); } catch (_) {}
    }
}

/**
 * Parse a 16-bit PCM WAV file into Float32Array samples at the file's sample rate.
 * The caller is responsible for ensuring the WAV is already 16kHz mono.
 */
function wavToFloat32(wavData) {
    const view = new DataView(wavData.buffer, wavData.byteOffset, wavData.byteLength);

    if (wavData.length < 44) {
        throw new Error('WAV file too short');
    }

    let dataOffset = 12;
    let dataSize = 0;

    while (dataOffset < wavData.length - 8) {
        const chunkId = String.fromCharCode(wavData[dataOffset], wavData[dataOffset+1], wavData[dataOffset+2], wavData[dataOffset+3]);
        const chunkSize = view.getUint32(dataOffset + 4, true);

        if (chunkId === 'data') {
            dataOffset += 8;
            dataSize = chunkSize;
            break;
        }

        dataOffset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) dataOffset++;
    }

    if (dataSize === 0) {
        throw new Error('No data chunk found in WAV');
    }

    const numSamples = Math.min(dataSize / 2, (wavData.length - dataOffset) / 2);
    const pcm = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
        const int16 = view.getInt16(dataOffset + i * 2, true);
        pcm[i] = int16 / 32768.0;
    }

    return pcm;
}

/**
 * Decode arbitrary input bytes to Float32Array PCM at 16kHz.
 * - If input is already a WAV with RIFF header → parse manually
 * - Otherwise → convert via ffmpeg-static → parse the resulting WAV
 */
async function decodeAudioToPcm(audioData) {
    const isWav = audioData.length >= 12 &&
                  audioData[0] === 0x52 && audioData[1] === 0x49 &&
                  audioData[2] === 0x46 && audioData[3] === 0x46;

    if (isWav) {
        console.log('[LocalWhisper] Detected WAV format');
        return wavToFloat32(audioData);
    }

    console.log('[LocalWhisper] Converting via ffmpeg-static...');
    const wavData = await convertToWavWithFfmpeg(audioData);
    return wavToFloat32(wavData);
}

function mapLanguage(lang) {
    if (!lang || lang === 'auto') return null;
    return lang.split('-')[0].toLowerCase();
}

function flattenTranscription(result) {
    // The addon returns { transcription: string[][] | string[] }.
    // The nested shape carries per-segment metadata (timestamps, etc); we just want text.
    const t = result?.transcription;
    if (!t) return '';
    if (Array.isArray(t) && t.length > 0 && Array.isArray(t[0])) {
        return t.map(seg => seg[seg.length - 1]).join('').trim();
    }
    if (Array.isArray(t)) {
        return t.join('').trim();
    }
    return String(t).trim();
}

/**
 * Transcribe audio with local Whisper.
 * @param {Buffer|Uint8Array} audioBuffer - WAV, webm, mp3, etc.
 * @param {string} [language='auto']
 * @param {string} [modelName]
 * @returns {Promise<string>}
 */
async function transcribeLocal(audioBuffer, language = 'auto', modelName) {
    const transcribe = getWhisperFn();
    const targetModel = modelName || DEFAULT_MODEL;

    await loadModel(targetModel);
    const modelPath = getModelPath(targetModel);

    console.log(`[LocalWhisper] Transcribing ${audioBuffer.length} bytes, lang: ${language}`);
    const startTime = Date.now();

    const uint8 = audioBuffer instanceof Uint8Array ? audioBuffer : new Uint8Array(audioBuffer);
    const pcm = await decodeAudioToPcm(uint8);

    console.log(`[LocalWhisper] Audio decoded: ${pcm.length} samples (${(pcm.length / 16000).toFixed(1)}s) in ${Date.now() - startTime}ms`);

    const whisperLang = mapLanguage(language);
    const transcribeStart = Date.now();

    // The native addon expects every documented option to be present, so we pass
    // the full param set explicitly instead of relying on the package's JS wrapper.
    const result = await transcribe({
        model: modelPath,
        pcmf32: pcm,
        language: whisperLang || 'auto',
        use_gpu: false,            // CPU-only for maximum compatibility across user hardware
        no_prints: true,
        no_timestamps: true,
        translate: false,          // Transcribe in source language; do not translate to English
        flash_attn: false,
        comma_in_time: false,
        detect_language: !whisperLang,
        audio_ctx: 0,
        max_len: 0,
    });

    const text = flattenTranscription(result);
    const transcribeTime = Date.now() - transcribeStart;
    console.log(`[LocalWhisper] Transcription done in ${transcribeTime}ms — "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

    return text;
}

function getLoadedModelInfo() {
    return {
        modelName: lastLoadedModelPath ? path.basename(lastLoadedModelPath).replace(/^ggml-|\.bin$/g, '') : null,
        isLoaded: !!lastLoadedModelPath,
    };
}

module.exports = {
    isLocalWhisperAvailable,
    loadModel,
    unloadModel,
    transcribeLocal,
    getLoadedModelInfo,
};
