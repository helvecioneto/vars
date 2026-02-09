/**
 * VARS - Local Whisper Transcription
 * Uses @napi-rs/whisper for local speech-to-text via whisper.cpp
 * Runs entirely offline after initial model download — no API key needed.
 */

const fs = require('fs');
const path = require('path');
const { getModelPath, isModelDownloaded, DEFAULT_MODEL } = require('./model-manager');

// Lazy-loaded references
let whisperModule = null;
let whisperInstance = null;
let loadedModelName = null;

/**
 * Lazy-load the @napi-rs/whisper module
 * This avoids startup failures on platforms where the native module isn't available
 */
function getWhisperModule() {
    if (!whisperModule) {
        try {
            whisperModule = require('@napi-rs/whisper');
        } catch (err) {
            throw new Error(`Local Whisper not available on this platform: ${err.message}`);
        }
    }
    return whisperModule;
}

/**
 * Check if local Whisper is available (native module can be loaded)
 * @returns {boolean}
 */
function isLocalWhisperAvailable() {
    try {
        getWhisperModule();
        return true;
    } catch {
        return false;
    }
}

/**
 * Load a Whisper model into memory
 * @param {string} [modelName] - Model name (default: 'base')
 * @returns {Promise<void>}
 */
async function loadModel(modelName = DEFAULT_MODEL) {
    // Already loaded this model
    if (whisperInstance && loadedModelName === modelName) {
        return;
    }

    const { Whisper } = getWhisperModule();

    const downloaded = await isModelDownloaded(modelName);
    if (!downloaded) {
        throw new Error(`Model "${modelName}" not downloaded. Download it first in Settings > Audio.`);
    }

    const modelPath = getModelPath(modelName);
    console.log(`[LocalWhisper] Loading model: ${modelName} from ${modelPath}`);

    const startTime = Date.now();

    // Load model from file path (string) — @napi-rs/whisper accepts string or Uint8Array
    whisperInstance = new Whisper(modelPath, {
        useGpu: false,  // CPU-only for maximum compatibility
    });

    loadedModelName = modelName;
    console.log(`[LocalWhisper] Model loaded in ${Date.now() - startTime}ms`);
}

/**
 * Unload the current model from memory
 */
function unloadModel() {
    whisperInstance = null;
    loadedModelName = null;
    console.log('[LocalWhisper] Model unloaded');
}

/**
 * Convert audio to WAV using the bundled ffmpeg-static binary.
 * Works cross-platform (macOS, Windows, Linux) via npm package.
 * @param {Uint8Array} audioData - Input audio data (webm, opus, etc.)
 * @returns {Promise<Uint8Array>} WAV file data (16kHz, mono, 16-bit PCM)
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
        // Write input audio to temp file
        fs.writeFileSync(tempInput, audioData);

        // Convert to 16kHz mono WAV using bundled ffmpeg
        await execFileAsync(ffmpegPath, [
            '-i', tempInput,
            '-ar', '16000',
            '-ac', '1',
            '-sample_fmt', 's16',
            '-f', 'wav',
            '-y',
            tempOutput
        ], { timeout: 30000 });

        // Read the converted WAV
        const wavData = fs.readFileSync(tempOutput);
        console.log(`[LocalWhisper] ffmpeg converted ${audioData.length} bytes → ${wavData.length} bytes WAV`);
        return new Uint8Array(wavData);

    } finally {
        // Always clean up temp files
        try { fs.unlinkSync(tempInput); } catch (_) {}
        try { fs.unlinkSync(tempOutput); } catch (_) {}
    }
}

/**
 * Parse a 16-bit PCM WAV file into Float32Array samples.
 * Bypasses @napi-rs/whisper's decodeAudioAsync entirely for maximum reliability.
 * @param {Uint8Array} wavData - WAV file data
 * @returns {Float32Array} PCM samples normalized to [-1, 1]
 */
function wavToFloat32(wavData) {
    const view = new DataView(wavData.buffer, wavData.byteOffset, wavData.byteLength);

    // Verify RIFF header
    if (wavData.length < 44) {
        throw new Error('WAV file too short');
    }

    // Find the 'data' chunk (skip past header and any extra chunks)
    let dataOffset = 12; // Skip RIFF header (12 bytes)
    let dataSize = 0;

    while (dataOffset < wavData.length - 8) {
        const chunkId = String.fromCharCode(wavData[dataOffset], wavData[dataOffset+1], wavData[dataOffset+2], wavData[dataOffset+3]);
        const chunkSize = view.getUint32(dataOffset + 4, true);

        if (chunkId === 'data') {
            dataOffset += 8; // Skip chunk header
            dataSize = chunkSize;
            break;
        }

        // Skip this chunk (header + data, aligned to 2 bytes)
        dataOffset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) dataOffset++; // padding byte
    }

    if (dataSize === 0) {
        throw new Error('No data chunk found in WAV');
    }

    // Convert Int16 PCM to Float32
    const numSamples = Math.min(dataSize / 2, (wavData.length - dataOffset) / 2);
    const pcm = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
        const int16 = view.getInt16(dataOffset + i * 2, true);
        pcm[i] = int16 / 32768.0;
    }

    return pcm;
}

/**
 * Decode audio data to PCM Float32Array at 16kHz.
 * Strategy:
 *   1. Try @napi-rs/whisper's decodeAudioAsync (handles WAV, OGG, MP3, FLAC natively)
 *   2. If that fails (e.g. webm without duration metadata),
 *      convert via bundled ffmpeg-static → WAV → parse PCM manually
 * @param {Uint8Array} audioData - Audio data in any format
 * @returns {Promise<Float32Array>} PCM samples at 16kHz
 */
async function decodeWithFallback(audioData) {
    const { decodeAudioAsync } = getWhisperModule();

    // Check if it's already a WAV file (RIFF header)
    const isWav = audioData.length >= 12 &&
                  audioData[0] === 0x52 && audioData[1] === 0x49 &&
                  audioData[2] === 0x46 && audioData[3] === 0x46;

    if (isWav) {
        // Try native decoding first, fall back to manual parsing
        try {
            console.log('[LocalWhisper] Detected WAV format');
            return await decodeAudioAsync(audioData, 'audio.wav');
        } catch (err) {
            console.warn(`[LocalWhisper] Native WAV decode failed, parsing manually: ${err.message}`);
            return wavToFloat32(audioData);
        }
    }

    // For non-WAV formats, try native decoding first
    try {
        return await decodeAudioAsync(audioData);
    } catch (err) {
        console.warn(`[LocalWhisper] Native decode failed: ${err.message}`);
    }

    // Native decoding failed (e.g. webm without duration) → convert with ffmpeg-static
    console.log('[LocalWhisper] Converting via ffmpeg-static...');
    const wavData = await convertToWavWithFfmpeg(audioData);

    // Parse the WAV manually (bypasses decodeAudioAsync completely)
    return wavToFloat32(wavData);
}

/**
 * Transcribe audio buffer using local Whisper
 * @param {Buffer|Uint8Array} audioBuffer - Audio data (wav preferred, also supports webm/opus, mp3, etc.)
 * @param {string} [language='auto'] - Language code (e.g. 'en', 'pt', 'es', or 'auto')
 * @param {string} [modelName] - Model to use (auto-loads if needed)
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeLocal(audioBuffer, language = 'auto', modelName) {
    const { WhisperFullParams, WhisperSamplingStrategy } = getWhisperModule();

    // Use configured model or default
    const targetModel = modelName || DEFAULT_MODEL;

    // Load model if needed
    await loadModel(targetModel);

    console.log(`[LocalWhisper] Transcribing ${audioBuffer.length} bytes, lang: ${language}`);
    const startTime = Date.now();

    // Convert audio to PCM Float32Array at 16kHz
    const uint8 = audioBuffer instanceof Uint8Array ? audioBuffer : new Uint8Array(audioBuffer);
    
    // Use decodeWithFallback which handles WAV, OGG, and other formats
    const pcmSamples = await decodeWithFallback(uint8);

    console.log(`[LocalWhisper] Audio decoded: ${pcmSamples.length} samples (${(pcmSamples.length / 16000).toFixed(1)}s) in ${Date.now() - startTime}ms`);

    // Configure whisper params
    const params = new WhisperFullParams(WhisperSamplingStrategy.Greedy);
    params.printProgress = false;
    params.printRealtime = false;
    params.printTimestamps = false;
    params.printSpecial = false;
    params.singleSegment = false;
    params.noTimestamps = true;
    params.suppressBlank = true;
    params.suppressNonSpeechTokens = true;

    // Map app language codes to Whisper-compatible ISO 639-1 codes
    const mapLanguage = (lang) => {
        if (!lang || lang === 'auto') return null;
        // Strip region codes: 'pt-br' → 'pt', 'en-us' → 'en', etc.
        return lang.split('-')[0].toLowerCase();
    };

    const whisperLang = mapLanguage(language);
    if (whisperLang) {
        params.language = whisperLang;
        params.detectLanguage = false;
        console.log(`[LocalWhisper] Language set to: ${whisperLang} (from config: ${language})`);
    } else {
        params.detectLanguage = true;
        console.log(`[LocalWhisper] Language: auto-detect`);
    }

    // Run transcription
    const transcribeStart = Date.now();
    const text = whisperInstance.full(params, pcmSamples);
    const transcribeTime = Date.now() - transcribeStart;

    console.log(`[LocalWhisper] Transcription done in ${transcribeTime}ms — "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

    return text.trim();
}

/**
 * Get info about the currently loaded model
 * @returns {{ modelName: string|null, isLoaded: boolean }}
 */
function getLoadedModelInfo() {
    return {
        modelName: loadedModelName,
        isLoaded: !!whisperInstance,
    };
}

module.exports = {
    isLocalWhisperAvailable,
    loadModel,
    unloadModel,
    transcribeLocal,
    getLoadedModelInfo,
};
