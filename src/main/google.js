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
// Retry and Fallback Utilities
// ==========================================

/**
 * Sleep utility for retry delays
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable (rate limit, temporary failure)
 */
function isRetryableError(error) {
    const message = error?.message?.toLowerCase() || '';
    const status = error?.status || error?.statusCode || error?.code;

    return (
        status === 429 ||
        status === 503 ||
        status === 'RESOURCE_EXHAUSTED' ||
        message.includes('rate limit') ||
        message.includes('quota') ||
        message.includes('resource_exhausted') ||
        message.includes('temporarily unavailable') ||
        message.includes('429') ||
        message.includes('too many requests')
    );
}

/**
 * Execute an operation with retry and model fallback
 * @param {Function} operation - Async function that takes a model name and returns result
 * @param {string[]} models - Array of model names to try in order
 * @param {object} retryConfig - Retry configuration
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {*} Result from the first successful operation
 */
async function executeWithFallback(operation, models, retryConfig, onProgress = null) {
    const { maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier } = retryConfig;
    let lastError;

    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
        const model = models[modelIndex];
        // Extract short model name for display
        const shortName = model.replace('gemini-', '').replace('-preview', '');

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[FREE-TIER] Trying model: ${model} (attempt ${attempt + 1}/${maxRetries + 1})`);

                // Notify UI of attempt
                if (onProgress) {
                    onProgress({
                        status: 'trying',
                        model: shortName,
                        modelIndex: modelIndex + 1,
                        totalModels: models.length,
                        attempt: attempt + 1,
                        maxAttempts: maxRetries + 1
                    });
                }

                const result = await operation(model);
                console.log(`[FREE-TIER] Success with model: ${model}`);

                // Notify UI of success
                if (onProgress) {
                    onProgress({
                        status: 'success',
                        model: shortName
                    });
                }

                return result;
            } catch (error) {
                lastError = error;
                console.error(`[FREE-TIER] Error on ${model}:`, error.message);

                if (!isRetryableError(error)) {
                    console.log(`[FREE-TIER] Non-retryable error, trying next model...`);
                    break; // Try next model
                }

                if (attempt < maxRetries) {
                    const delay = Math.min(
                        initialDelayMs * Math.pow(backoffMultiplier, attempt),
                        maxDelayMs
                    );
                    console.log(`[FREE-TIER] Rate limited on ${model}, retrying in ${delay}ms...`);

                    // Notify UI of retry
                    if (onProgress) {
                        onProgress({
                            status: 'retrying',
                            model: shortName,
                            attempt: attempt + 1,
                            maxAttempts: maxRetries + 1,
                            delayMs: delay
                        });
                    }

                    await sleep(delay);
                } else {
                    console.log(`[FREE-TIER] Max retries reached for ${model}, trying next model...`);

                    // Notify UI of model switch
                    if (onProgress && modelIndex < models.length - 1) {
                        onProgress({
                            status: 'switching',
                            model: shortName,
                            nextModel: models[modelIndex + 1].replace('gemini-', '').replace('-preview', '')
                        });
                    }
                }
            }
        }
    }

    // All models exhausted - create a user-friendly error
    const quotaError = new Error('FREE_QUOTA_EXHAUSTED');
    quotaError.isQuotaError = true;
    quotaError.userMessage = 'Quota do plano gratuito atingida. Tente novamente mais tarde ou considere usar um plano pago para mais requisições.';
    throw quotaError;
}

// ==========================================
// Transcription (Gemini Audio Understanding)
// ==========================================

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
 * @param {string|string[]} modelOrModels - Single model or array of models to try in order
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

        // Read the file as base64
        const audioData = await fsPromises.readFile(tempFile);
        const base64Audio = audioData.toString('base64');

        // Handle array of models with fallback
        const models = Array.isArray(modelOrModels) ? modelOrModels : [modelOrModels];

        if (models.length > 1 && retryConfig) {
            // Use fallback logic for multiple models
            return await executeWithFallback(
                (model) => transcribeAudioWithModel(audioBuffer, apiKey, model, base64Audio, mimeType),
                models,
                retryConfig,
                onProgress
            );
        } else {
            // Single model, direct call
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
 * Get AI response from Google Gemini with fallback support
 * @param {object} params - Parameters including message, apiKey, model/models, etc.
 * @returns {object} Response object with response text
 */
async function getGoogleAIResponse({ transcription, params }) {
    const { apiKey, model, models, systemPrompt, language, history, tierConfig, retryConfig, onProgress } = params;

    // Support both single model and model array
    const modelList = models || (Array.isArray(model) ? model : [model]);

    try {
        if (modelList.length > 1 && retryConfig) {
            // Use fallback logic for multiple models
            const response = await executeWithFallback(
                async (modelName) => {
                    return await getChatCompletionGoogle(
                        transcription,
                        apiKey,
                        modelName,
                        systemPrompt,
                        language,
                        history,
                        tierConfig || {},
                        params.briefMode || false
                    );
                },
                modelList,
                retryConfig,
                onProgress
            );
            return { response, threadId: null };
        } else {
            // Single model, direct call
            const response = await getChatCompletionGoogle(
                transcription,
                apiKey,
                modelList[0],
                systemPrompt,
                language,
                history,
                tierConfig || {},
                params.briefMode || false
            );
            return { response, threadId: null };
        }
    } catch (error) {
        console.error('[ERROR] Google AI Response failed:', error);
        throw error;
    }
}

// ==========================================
// Image Analysis (Gemini Vision)
// ==========================================

/**
 * Analyze an image using Google's Gemini Vision API
 * @param {object} params - Parameters for image analysis
 * @param {string} params.imageData - Base64 encoded image data (with data URL prefix)
 * @param {string} params.prompt - User prompt for the analysis
 * @param {string} params.apiKey - Google API key
 * @param {string} params.model - Model to use
 * @param {string} params.systemPrompt - System prompt
 * @param {string} params.language - Response language
 * @param {Array} params.history - Conversation history
 * @param {object} params.tierConfig - Tier configuration for parameters
 * @param {boolean} params.briefMode - Whether to use brief mode
 * @returns {Promise<string>} AI response
 */
async function analyzeImageGoogle({
    imageData,
    prompt,
    apiKey,
    model,
    systemPrompt,
    language = 'en',
    history = [],
    tierConfig = {},
    briefMode = false
}) {
    const genAI = getGoogleClient(apiKey);

    // Get language instruction from configuration
    const langInstructions = getPromptForLanguage('language.responseInstruction', language);
    const briefModeInstruction = briefMode ? '\n\nPlease keep your response brief and concise.' : '';

    // Gemini models that support vision
    // Most Gemini models (gemini-pro-vision, gemini-1.5-pro, gemini-1.5-flash, etc.) support vision
    const visionModel = model.includes('gemini') ? model : 'gemini-1.5-flash';

    const genModel = genAI.getGenerativeModel({ 
        model: visionModel,
        generationConfig: {
            temperature: tierConfig.temperature ?? 0.7,
            maxOutputTokens: tierConfig.maxOutputTokens ?? 1500,
        }
    });

    // Parse the base64 image data
    // Expected format: "data:image/png;base64,..." or "data:image/jpeg;base64,..."
    let mimeType = 'image/png';
    let base64Data = imageData;

    if (imageData.startsWith('data:')) {
        const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
            mimeType = matches[1];
            base64Data = matches[2];
        }
    }

    // Build system instruction
    const systemInstruction = (systemPrompt || 'You are a helpful assistant that analyzes images and provides detailed descriptions.') + langInstructions + briefModeInstruction;

    // Build chat history (convert from OpenAI format to Gemini format)
    const geminiHistory = history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: msg.content }]
    }));

    console.log(`[Vision] Analyzing image with Gemini model: ${visionModel}`);

    // Create the content with image
    const imagePart = {
        inlineData: {
            mimeType: mimeType,
            data: base64Data
        }
    };

    const textPart = { text: prompt };

    // Use generateContent for multimodal input
    const result = await genModel.generateContent({
        contents: [
            ...geminiHistory.map(h => ({ role: h.role, parts: h.parts })),
            {
                role: 'user',
                parts: [textPart, imagePart]
            }
        ],
        systemInstruction: systemInstruction
    });

    const response = result.response;
    return response.text();
}

module.exports = {
    transcribeAudioGoogle,
    getChatCompletionGoogle,
    getGoogleAIResponse,
    analyzeImageGoogle
};
