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
 * Get AI response using File Search (REST API)
 * @param {string} message - User message
 * @param {string} apiKey - Google API key
 * @param {string} model - Model to use
 * @param {string} systemPrompt - System prompt
 * @param {string} language - Language code
 * @param {Array} history - Conversation history
 * @param {object} tierConfig - Tier configuration
 * @param {boolean} briefMode - Whether to use brief mode
 * @param {string} fileSearchStoreName - File Search Store name
 * @returns {Promise<string>} AI response
 */
async function getChatCompletionWithFileSearch(message, apiKey, model, systemPrompt, language = 'en', history = [], tierConfig = {}, briefMode = false, fileSearchStoreName) {
    const ai = getGenAIClient(apiKey);

    // Get language instruction from configuration
    const langInstructions = getPromptForLanguage('language.responseInstruction', language);
    const briefModeInstruction = briefMode ? getPromptForLanguage('knowledgeBase.briefMode', language) : '';
    const fullSystemPrompt = (systemPrompt || 'You are a helpful assistant.') + langInstructions + briefModeInstruction;

    // Convert OpenAI-style history to Gemini format (user/model)
    // SDK expects: [{ role: 'user', parts: [{ text: '...' }] }]
    const geminiHistory = (history || []).map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));

    try {
        const result = await ai.models.generateContent({
            model: model,
            contents: [
                ...geminiHistory,
                {
                    role: 'user',
                    parts: [{ text: message }]
                }
            ],
            config: {
                systemInstruction: fullSystemPrompt,
                temperature: tierConfig.temperature ?? 0.7,
                maxOutputTokens: tierConfig.maxOutputTokens ?? 1500,
                topK: tierConfig.topK ?? 40,
                topP: tierConfig.topP ?? 0.95,
                tools: [
                    {
                        fileSearch: {
                            fileSearchStoreNames: [fileSearchStoreName]
                        }
                    }
                ]
            }
        });

        // Check if response is valid (structure for @google/genai SDK)
        if (!result || !result.candidates) {
            console.error('[File Search] Invalid response from SDK:', result);
            throw new Error('Received empty response from Gemini API');
        }

        // Check for safety blocks or empty content
        if (result.candidates.length === 0) {
            console.warn('[File Search] No candidates returned (possibly blocked or empty retrieval). Prompt feedback:', result.promptFeedback);
            return "I couldn't find relevant information in the knowledge base to answer your question.";
        }

        // Try to get text safely
        let text = '';
        try {
            // SDK v2 usually has .text() on the response object
            text = result.text();
        } catch (e) {
            // Fallback for manual access if helper fails
            text = result.candidates[0]?.content?.parts?.[0]?.text || '';
        }

        if (!text) {
            // Might be a pure citation response or blocked
            return "I found some sources but couldn't generate a text response.";
        }

        // Log grounding metadata if available (for debugging)
        const grounding = result.candidates?.[0]?.groundingMetadata;
        if (grounding?.groundingChunks) {
            console.log(`[File Search] Cited ${grounding.groundingChunks.length} sources.`);
        }

        return text;
    } catch (error) {
        console.error('[File Search] Generation error:', error);
        throw new Error(`File Search generation failed: ${error.message}`);
    }
}

/**
 * Get AI response from Google Gemini with fallback support
 * @param {object} params - Parameters including message, apiKey, model/models, etc.
 * @returns {object} Response object with response text
 */
async function getGoogleAIResponse({ transcription, params }) {
    const { apiKey, model, models, systemPrompt, language, history, tierConfig, retryConfig, onProgress, fileSearchStoreName } = params;

    // Support both single model and model array
    const modelList = models || (Array.isArray(model) ? model : [model]);

    try {
        // If File Search Store is available, use it
        if (fileSearchStoreName) {
            console.log('[File Search] Using knowledge base for response');
            const response = await getChatCompletionWithFileSearch(
                transcription,
                apiKey,
                modelList[0],
                systemPrompt,
                language,
                history,
                tierConfig || {},
                params.briefMode || false,
                fileSearchStoreName
            );
            return { response, threadId: null };
        }

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

// ==========================================
// File Search Store (Knowledge Base) - SDK Implementation (@google/genai)
// ==========================================

const { GoogleGenAI } = require('@google/genai');

/**
 * Helper to get initialized GenAI V2 client
 * @param {string} apiKey 
 */
function getGenAIClient(apiKey) {
    return new GoogleGenAI({ apiKey });
}

/**
 * Create a new File Search Store
 * @param {string} apiKey - Google API key
 * @param {string} displayName - Display name for the store
 * @returns {Promise<string>} File Search Store name (ID)
 */
async function createFileSearchStore(apiKey, displayName = 'VARS Knowledge Base') {
    const ai = getGenAIClient(apiKey);

    try {
        const store = await ai.fileSearchStores.create({
            config: {
                displayName: displayName
            }
        });

        console.log('[File Search] Created store:', store.name);
        return store.name;
    } catch (error) {
        throw new Error(`Failed to create File Search Store: ${error.message}`);
    }
}

/**
 * Get existing File Search Store by name
 * @param {string} apiKey - Google API key
 * @param {string} storeName - File Search Store name
 * @returns {Promise<object|null>} Store object or null if not found
 */
async function getFileSearchStore(apiKey, storeName) {
    const ai = getGenAIClient(apiKey);

    try {
        const store = await ai.fileSearchStores.get({
            name: storeName
        });
        return store;
    } catch (error) {
        console.warn('[File Search] Store not found:', storeName);
        return null;
    }
}

/**
 * Upload a file to a File Search Store
 * @param {string} apiKey - Google API key
 * @param {string} storeName - File Search Store name (e.g., "fileSearchStores/abc123")
 * @param {string} filePath - Path to the file to upload
 * @returns {Promise<object>} Operation object
 */
async function uploadToFileSearchStore(apiKey, storeName, filePath) {
    const ai = getGenAIClient(apiKey);
    const originalFileName = path.basename(filePath);

    // SDK (or Node's http client) fails if the FILE PATH contains non-ascii characters in headers.
    // Solution: Copy to a temp file with pure ASCII name, upload, then delete.
    const tempDir = require('os').tmpdir();
    // Generate a safe name: 'upload_' + timestamp + random + '.ext'
    const safeName = `upload_${Date.now()}_${Math.floor(Math.random() * 1000)}${path.extname(filePath)}`;
    const tempFilePath = path.join(tempDir, safeName);

    // Sanitize display name for the store (API metadata)
    const sanitizedDisplayName = originalFileName.replace(/[^\x00-\x7F]/g, '_');

    console.log(`[File Search] Staging ${originalFileName} to ${safeName} for safe upload...`);

    try {
        // Copy file to temp location
        await fsPromises.copyFile(filePath, tempFilePath);

        console.log(`[File Search] Uploading staged file to ${storeName}...`);

        // Upload the temp file
        let operation = await ai.fileSearchStores.uploadToFileSearchStore({
            file: tempFilePath,
            fileSearchStoreName: storeName,
            config: {
                displayName: sanitizedDisplayName,
            }
        });

        // Loop wait for completion (Best Effort)
        if (operation.name) {
            console.log(`[File Search] Upload initiated:`, operation.name);
            const opName = operation.name;
            let pollErrors = 0;

            // Poll safely
            while (true) {
                // If operation object says done, we are good
                if (operation.done) break;

                await new Promise(resolve => setTimeout(resolve, 1000));

                try {
                    const updatedOp = await ai.operations.get({ name: opName });
                    if (updatedOp) {
                        operation = updatedOp;
                    }
                } catch (e) {
                    console.warn('[File Search] Polling warning:', e.message);
                    pollErrors++;
                    // If we fail to check status multiple times, assume SDK issue and break to let flow continue
                    // The upload likely continues on server side
                    if (pollErrors >= 3) {
                        console.log('[File Search] Stopping status check due to SDK errors. Upload continues in background.');
                        break;
                    }
                }
            }
            console.log(`[File Search] File upload sequence completed.`);
        }

        return operation;
    } catch (error) {
        throw new Error(`Failed to upload file ${originalFileName}: ${error.message}`);
    } finally {
        // Clean up temp file
        try {
            await fsPromises.unlink(tempFilePath);
        } catch (e) {
            console.warn('Failed to cleanup temp file:', tempFilePath);
        }
    }
}

/**
 * Delete a File Search Store
 * @param {string} apiKey - Google API key
 * @param {string} storeName - File Search Store name
 * @param {boolean} force - Force delete even if store has documents
 * @returns {Promise<void>}
 */
async function deleteFileSearchStore(apiKey, storeName, force = true) {
    if (!storeName) return;

    const ai = getGenAIClient(apiKey);

    try {
        await ai.fileSearchStores.delete({
            name: storeName,
            config: {
                force: force
            }
        });
        console.log('[File Search] Deleted store:', storeName);
    } catch (error) {
        console.warn(`[File Search] Failed to delete store (might be already deleted): ${error.message}`);
    }
}

/**
 * Create knowledge base for Google (File Search Store)
 * @param {string} apiKey - Google API key
 * @param {string[]} filePaths - Array of file paths to upload
 * @param {string|null} existingStoreName - Existing store name to reuse
 * @returns {Promise<string>} File Search Store name
 */
async function createGoogleKnowledgeBase(apiKey, filePaths, existingStoreName = null) {
    let storeName = existingStoreName;

    // Check if existing store is still valid
    if (storeName) {
        const existing = await getFileSearchStore(apiKey, storeName);
        if (!existing) {
            console.log('[File Search] Existing store not found, creating new one');
            storeName = null;
        }
    }

    // Create new store if needed
    if (!storeName) {
        storeName = await createFileSearchStore(apiKey, 'VARS Knowledge Base');
    }

    // Upload all files
    // Use sequential upload to avoid rate limits and ensuring files exist
    for (const filePath of filePaths) {
        try {
            await fsPromises.access(filePath);
            await uploadToFileSearchStore(apiKey, storeName, filePath);
            // Small delay
            await sleep(500);
        } catch (error) {
            console.error(`[File Search] Error uploading ${filePath}:`, error.message);
        }
    }

    return storeName;
}

/**
 * Reset (delete) Google knowledge base
 * @param {string} apiKey - Google API key
 * @param {string} storeName - File Search Store name
 */
async function resetGoogleKnowledgeBase(apiKey, storeName) {
    await deleteFileSearchStore(apiKey, storeName, true);
}

module.exports = {
    transcribeAudioGoogle,
    getChatCompletionGoogle,
    getGoogleAIResponse,
    analyzeImageGoogle,
    // File Search (Knowledge Base)
    createFileSearchStore,
    getFileSearchStore,
    uploadToFileSearchStore,
    deleteFileSearchStore,
    createGoogleKnowledgeBase,
    resetGoogleKnowledgeBase
};
