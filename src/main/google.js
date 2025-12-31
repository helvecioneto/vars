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

    // Write buffer to a temporary file
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `vars-${Date.now()}.webm`);

    try {
        const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
        await fsPromises.writeFile(tempFile, buffer);

        // Read the file as base64
        const audioData = await fsPromises.readFile(tempFile);
        const base64Audio = audioData.toString('base64');

        // Get the model
        const geminiModel = genAI.getGenerativeModel({ model });

        // Create the request with audio data
        const result = await geminiModel.generateContent([
            {
                inlineData: {
                    mimeType: 'audio/webm',
                    data: base64Audio
                }
            },
            { text: 'Transcribe this audio to text. Return only the transcription, no additional commentary.' }
        ]);

        const response = await result.response;
        return response.text().trim();

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
async function getChatCompletionGoogle(message, apiKey, model, systemPrompt, language = 'en', history = [], tierConfig = {}) {
    const genAI = getGoogleClient(apiKey);

    // Get language instruction from configuration
    const langInstructions = getPromptForLanguage('language.responseInstruction', language);

    // Build system instruction
    const fullSystemPrompt = (systemPrompt || 'You are a helpful assistant.') + langInstructions;

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
            tierConfig || {}
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
