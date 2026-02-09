/**
 * VARS - Local Providers Index
 * Exports local speech-to-text providers (whisper.cpp via @napi-rs/whisper)
 */

const { isLocalWhisperAvailable, loadModel, unloadModel, transcribeLocal, getLoadedModelInfo } = require('./whisper');
const { AVAILABLE_MODELS, DEFAULT_MODEL, getModelPath, isModelDownloaded, getModelsStatus, downloadModel, deleteModel } = require('./model-manager');

module.exports = {
    // Whisper transcription
    isLocalWhisperAvailable,
    loadModel,
    unloadModel,
    transcribeLocal,
    getLoadedModelInfo,

    // Model management
    AVAILABLE_MODELS,
    DEFAULT_MODEL,
    getModelPath,
    isModelDownloaded,
    getModelsStatus,
    downloadModel,
    deleteModel,
};
