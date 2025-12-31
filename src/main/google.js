const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');
const { getPromptForLanguage } = require('./config');

// Helper to get initialized client
function getGoogleClient(apiKey) {
    return new GoogleGenerativeAI(apiKey);
}

// ==========================================
// Transcription (Gemini Audio Understanding)
// ==========================================

/**
 * Transcribe audio using Google Gemini
 * Gemini processes audio as multimodal input
 * @param {Buffer|Uint8Array} audioBuffer - Audio data
 * @param {string} apiKey - Google API key
 * @param {string} model - Gemini model to use
 * @returns {string} Transcribed text
 */
async function transcribeAudioGoogle(audioBuffer, apiKey, model = 'gemini-2.0-flash-lite') {
    const genAI = getGoogleClient(apiKey);

    const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
    console.log('[Google] Transcribing audio, buffer size:', buffer.length, 'bytes');
    
    // Detect audio format from header
    let mimeType = 'audio/webm';
    let fileExt = 'webm';
    
    // Check for WAV header (RIFF....WAVE)
    if (buffer.length > 12 && 
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
        mimeType = 'audio/wav';
        fileExt = 'wav';
        
        // Parse WAV header to get audio duration
        const dataSize = buffer.readUInt32LE(40);
        const sampleRate = buffer.readUInt32LE(24);
        const channels = buffer.readUInt16LE(22);
        const bitsPerSample = buffer.readUInt16LE(34);
        const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
        const durationSeconds = dataSize / bytesPerSecond;
        console.log('[Google] WAV audio: duration =', durationSeconds.toFixed(2), 'seconds, sampleRate =', sampleRate);
    } else {
        console.log('[Google] Assuming WebM format');
    }

    // Write buffer to a temporary file
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `vars-${Date.now()}.${fileExt}`);

    try {
        await fsPromises.writeFile(tempFile, buffer);

        // Read the file as base64
        const audioData = await fsPromises.readFile(tempFile);
        const base64Audio = audioData.toString('base64');

        // Get the model
        const geminiModel = genAI.getGenerativeModel({ model });

        // Create the request with audio data
        // Use a more explicit prompt to get complete transcription
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
        const transcription = response.text().trim();
        console.log('[Google] Transcription result length:', transcription.length, 'chars');
        console.log('[Google] Transcription preview:', transcription.substring(0, 100) + (transcription.length > 100 ? '...' : ''));
        return transcription;

    } finally {
        try {
            await fsPromises.unlink(tempFile);
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

// ==========================================
// Chat Completion (Gemini)
// ==========================================

/**
 * Get chat completion response from Google Gemini
 * @param {string} message - User message
 * @param {string} apiKey - Google API key
 * @param {string} model - Gemini model to use
 * @param {string} systemPrompt - System instructions
 * @param {string} language - Response language
 * @param {Array} history - Conversation history
 * @param {object} tierConfig - Tier-specific parameters
 * @returns {string} AI response
 */
async function getChatCompletionGoogle(message, apiKey, model, systemPrompt, language = 'en', history = [], tierConfig = {}, briefMode = false) {
    const genAI = getGoogleClient(apiKey);

    // Get language instruction from configuration
    const langInstructions = getPromptForLanguage('language.responseInstruction', language);

    // Build system instruction
    const fullSystemPrompt = (systemPrompt || 'You are a helpful assistant.') + langInstructions + (briefMode ? getPromptForLanguage('knowledgeBase.briefMode', language) : '');

    // Configure generation parameters from tier config
    const generationConfig = {
        temperature: tierConfig.temperature ?? 0.7,
        maxOutputTokens: tierConfig.maxOutputTokens ?? 1500,
        topK: tierConfig.topK ?? 40,
        topP: tierConfig.topP ?? 0.95
    };

    // Get the model with system instruction
    const geminiModel = genAI.getGenerativeModel({
        model,
        systemInstruction: fullSystemPrompt,
        generationConfig
    });

    // Convert OpenAI-style history to Gemini format
    const geminiHistory = (history || []).map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));

    // Start chat with history
    const chat = geminiModel.startChat({
        history: geminiHistory
    });

    // Send message and get response
    const result = await chat.sendMessage(message);
    const response = await result.response;

    return response.text();
}

// ==========================================
// Smart Response (similar to OpenAI's getSmartAIResponse)
// ==========================================

/**
 * Get AI response from Google Gemini
 * @param {object} params - Parameters including message, apiKey, model, etc.
 * @returns {object} Response object with response text
 */
async function getGoogleAIResponse({ transcription, params }) {
    const { apiKey, model, systemPrompt, language, history, tierConfig } = params;

    console.log('[DEBUG] Google AI Response - Model:', model, 'TierConfig:', tierConfig);

    try {
        const response = await getChatCompletionGoogle(
            transcription,
            apiKey,
            model,
            systemPrompt,
            language,
            history,
            tierConfig || {},
            params.briefMode || false
        );

        return { response, threadId: null };
    } catch (error) {
        console.error('[ERROR] Google AI Response failed:', error);
        throw error;
    }
}

module.exports = {
    transcribeAudioGoogle,
    getChatCompletionGoogle,
    getGoogleAIResponse
};
