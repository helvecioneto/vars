/**
 * VARS - Local Whisper Model Manager
 * Downloads, stores, and manages whisper.cpp GGML model files
 * Models are stored in ~/.vars/models/
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const https = require('https');

const MODELS_DIR = path.join(os.homedir(), '.vars', 'models');

// Hugging Face model URLs (ggerganov/whisper.cpp official repo)
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

const AVAILABLE_MODELS = {
    'tiny': { file: 'ggml-tiny.bin', size: '75 MB', sizeBytes: 75_000_000 },
    'tiny.en': { file: 'ggml-tiny.en.bin', size: '75 MB', sizeBytes: 75_000_000 },
    'base': { file: 'ggml-base.bin', size: '142 MB', sizeBytes: 142_000_000 },
    'base.en': { file: 'ggml-base.en.bin', size: '142 MB', sizeBytes: 142_000_000 },
    'small': { file: 'ggml-small.bin', size: '466 MB', sizeBytes: 466_000_000 },
    'small.en': { file: 'ggml-small.en.bin', size: '466 MB', sizeBytes: 466_000_000 },
    'medium': { file: 'ggml-medium.bin', size: '1.5 GB', sizeBytes: 1_500_000_000 },
    'medium.en': { file: 'ggml-medium.en.bin', size: '1.5 GB', sizeBytes: 1_500_000_000 },
    'large-v3-turbo': { file: 'ggml-large-v3-turbo.bin', size: '809 MB', sizeBytes: 809_000_000 },
};

// Default model for VARS — good balance of speed vs quality
const DEFAULT_MODEL = 'small';

/**
 * Ensure the models directory exists
 */
async function ensureModelsDir() {
    await fsp.mkdir(MODELS_DIR, { recursive: true });
}

/**
 * Get the file path for a model
 * @param {string} modelName - e.g. 'base', 'tiny', 'small'
 * @returns {string} Absolute path to the model file
 */
function getModelPath(modelName) {
    const model = AVAILABLE_MODELS[modelName];
    if (!model) {
        throw new Error(`Unknown model: ${modelName}. Available: ${Object.keys(AVAILABLE_MODELS).join(', ')}`);
    }
    return path.join(MODELS_DIR, model.file);
}

/**
 * Check if a model is already downloaded
 * @param {string} modelName
 * @returns {Promise<boolean>}
 */
async function isModelDownloaded(modelName) {
    const modelPath = getModelPath(modelName);
    try {
        const stat = await fsp.stat(modelPath);
        // Verify file isn't empty or corrupted (at least 1MB)
        return stat.size > 1_000_000;
    } catch {
        return false;
    }
}

/**
 * Get status of all available models
 * @returns {Promise<Array>} Array of { name, file, size, downloaded }
 */
async function getModelsStatus() {
    await ensureModelsDir();
    const results = [];
    for (const [name, info] of Object.entries(AVAILABLE_MODELS)) {
        const downloaded = await isModelDownloaded(name);
        results.push({
            name,
            file: info.file,
            size: info.size,
            sizeBytes: info.sizeBytes,
            downloaded,
            isDefault: name === DEFAULT_MODEL,
        });
    }
    return results;
}

/**
 * Download a model from Hugging Face
 * @param {string} modelName - Model name to download
 * @param {function} onProgress - Callback with { downloaded, total, percent }
 * @returns {Promise<string>} Path to the downloaded model
 */
async function downloadModel(modelName, onProgress) {
    const model = AVAILABLE_MODELS[modelName];
    if (!model) {
        throw new Error(`Unknown model: ${modelName}`);
    }

    await ensureModelsDir();
    const modelPath = getModelPath(modelName);
    const tempPath = modelPath + '.downloading';

    const url = `${MODEL_BASE_URL}/${model.file}`;
    console.log(`[ModelManager] Downloading ${modelName} from ${url}`);

    return new Promise((resolve, reject) => {
        const download = (downloadUrl, redirectCount = 0) => {
            if (redirectCount > 5) {
                reject(new Error('Too many redirects'));
                return;
            }

            const protocol = downloadUrl.startsWith('https') ? https : require('http');
            protocol.get(downloadUrl, { headers: { 'User-Agent': 'VARS-App/1.0' } }, (response) => {
                // Handle redirects (Hugging Face uses 302)
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    download(response.headers.location, redirectCount + 1);
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`Download failed: HTTP ${response.statusCode}`));
                    return;
                }

                const totalSize = parseInt(response.headers['content-length'], 10) || model.sizeBytes;
                let downloadedSize = 0;

                const fileStream = fs.createWriteStream(tempPath);

                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (onProgress) {
                        onProgress({
                            downloaded: downloadedSize,
                            total: totalSize,
                            percent: Math.round((downloadedSize / totalSize) * 100),
                        });
                    }
                });

                response.pipe(fileStream);

                fileStream.on('finish', async () => {
                    fileStream.close();
                    try {
                        // Rename temp file to final path
                        await fsp.rename(tempPath, modelPath);
                        console.log(`[ModelManager] Downloaded ${modelName} to ${modelPath}`);
                        resolve(modelPath);
                    } catch (err) {
                        reject(err);
                    }
                });

                fileStream.on('error', async (err) => {
                    // Clean up temp file on error
                    try { await fsp.unlink(tempPath); } catch {}
                    reject(err);
                });
            }).on('error', async (err) => {
                try { await fsp.unlink(tempPath); } catch {}
                reject(err);
            });
        };

        download(url);
    });
}

/**
 * Delete a downloaded model
 * @param {string} modelName
 */
async function deleteModel(modelName) {
    const modelPath = getModelPath(modelName);
    try {
        await fsp.unlink(modelPath);
        console.log(`[ModelManager] Deleted model ${modelName}`);
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
}

module.exports = {
    AVAILABLE_MODELS,
    DEFAULT_MODEL,
    MODELS_DIR,
    getModelPath,
    isModelDownloaded,
    getModelsStatus,
    downloadModel,
    deleteModel,
    ensureModelsDir,
};
