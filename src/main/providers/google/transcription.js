/**
 * VARS - Google Transcription
 * Audio transcription using Gemini
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');
const { getGoogleClient } = require('./client');
const { executeWithFallback } = require('../shared/retry');

/**
 * Internal function to transcribe audio with a single model
 */
async function transcribeAudioWithModel(audioBuffer, apiKey, model, base64Audio, mimeType) {
    const genAI = getGoogleClient(apiKey);
    const geminiModel = genAI.getGenerativeModel({ model });

    const transcriptionPrompt = `Transcribe ALL the spoken words in this audio file COMPLETELY, word for word.
Do NOT summarize or shorten the content.
Do NOT skip any parts of the audio.
Include everything that is said from beginning to end.
Return ONLY the transcription text, nothing else.`;

    const result = await geminiModel.generateContent([
        {
            inlineData: {
                mimeType: mimeType,
                data: base64Audio
            }
        },
        { text: transcriptionPrompt }
    ]);

    const response = await result.response;
    return response.text().trim();
}

/**
 * Transcribe audio using Google Gemini with fallback support
 * @param {Buffer|Uint8Array} audioBuffer - Audio data
 * @param {string} apiKey - Google API key
 * @param {string|string[]} modelOrModels - Single model or array of models to try
 * @param {object} retryConfig - Optional retry configuration for fallback
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {string} Transcribed text
 */
async function transcribeAudioGoogle(audioBuffer, apiKey, modelOrModels = 'gemini-2.0-flash-lite', retryConfig = null, onProgress = null) {
    const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

    // Detect audio format from header
    let mimeType = 'audio/webm';
    let fileExt = 'webm';

    // Check for WAV header (RIFF....WAVE)
    if (buffer.length > 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
        mimeType = 'audio/wav';
        fileExt = 'wav';
    }

    // Write buffer to a temporary file
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `vars-${Date.now()}.${fileExt}`);

    try {
        await fsPromises.writeFile(tempFile, buffer);
        const audioData = await fsPromises.readFile(tempFile);
        const base64Audio = audioData.toString('base64');

        const models = Array.isArray(modelOrModels) ? modelOrModels : [modelOrModels];

        if (models.length > 1 && retryConfig) {
            return await executeWithFallback(
                (model) => transcribeAudioWithModel(audioBuffer, apiKey, model, base64Audio, mimeType),
                models,
                retryConfig,
                onProgress
            );
        } else {
            return await transcribeAudioWithModel(audioBuffer, apiKey, models[0], base64Audio, mimeType);
        }
    } finally {
        try {
            await fsPromises.unlink(tempFile);
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

module.exports = { transcribeAudioGoogle };
