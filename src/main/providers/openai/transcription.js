/**
 * VARS - OpenAI Transcription
 * Audio transcription using Whisper/GPT-4o
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');
const { getClient } = require('./client');

/**
 * Transcribe audio using OpenAI
 */
async function transcribeAudio(audioBuffer, apiKey, model = 'gpt-4o-mini-transcribe') {
    const openai = getClient(apiKey);

    const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

    // Detect audio format from header
    let fileExt = 'webm';

    // Check for WAV header (RIFF....WAVE)
    if (buffer.length > 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
        fileExt = 'wav';
    }

    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `vars-${Date.now()}.${fileExt}`);

    try {
        await fsPromises.writeFile(tempFile, buffer);
        const fileStream = fs.createReadStream(tempFile);

        const transcription = await openai.audio.transcriptions.create({
            file: fileStream,
            model: model,
            language: 'pt'
        });

        return transcription.text;
    } finally {
        try {
            await fsPromises.unlink(tempFile);
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

module.exports = { transcribeAudio };
