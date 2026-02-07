/**
 * VARS - Google Chat Completion
 * Chat and AI response using Gemini
 */

const { getGoogleClient, getGenAIClient } = require('./client');
const { getPromptForLanguage } = require('../../config');
const { executeWithFallback } = require('../shared/retry');

/**
 * Get chat completion response from Google Gemini
 */
async function getChatCompletionGoogle(message, apiKey, model, systemPrompt, language = 'en', history = [], tierConfig = {}, briefMode = false) {
    const genAI = getGoogleClient(apiKey);
    const langInstructions = getPromptForLanguage('language.responseInstruction', language);
    const fullSystemPrompt = (systemPrompt || 'You are a helpful assistant.') + langInstructions + (briefMode ? getPromptForLanguage('knowledgeBase.briefMode', language) : '');

    const generationConfig = {
        temperature: tierConfig.temperature ?? 0.7,
        maxOutputTokens: tierConfig.maxOutputTokens ?? 1500,
        topK: tierConfig.topK ?? 40,
        topP: tierConfig.topP ?? 0.95
    };

    const geminiModel = genAI.getGenerativeModel({
        model,
        systemInstruction: fullSystemPrompt,
        generationConfig
    });

    const geminiHistory = (history || []).map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));

    const chat = geminiModel.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(message);
    const response = await result.response;

    return response.text();
}

/**
 * Get AI response using File Search (REST API)
 */
async function getChatCompletionWithFileSearch(message, apiKey, model, systemPrompt, language = 'en', history = [], tierConfig = {}, briefMode = false, fileSearchStoreName) {
    const ai = getGenAIClient(apiKey);
    const langInstructions = getPromptForLanguage('language.responseInstruction', language);
    const briefModeInstruction = briefMode ? getPromptForLanguage('knowledgeBase.briefMode', language) : '';
    const fullSystemPrompt = (systemPrompt || 'You are a helpful assistant.') + langInstructions + briefModeInstruction;

    const geminiHistory = (history || []).map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));

    try {
        const result = await ai.models.generateContent({
            model: model,
            contents: [
                ...geminiHistory,
                { role: 'user', parts: [{ text: message }] }
            ],
            config: {
                systemInstruction: fullSystemPrompt,
                temperature: tierConfig.temperature ?? 0.7,
                maxOutputTokens: tierConfig.maxOutputTokens ?? 1500,
                topK: tierConfig.topK ?? 40,
                topP: tierConfig.topP ?? 0.95,
                tools: [{ fileSearch: { fileSearchStoreNames: [fileSearchStoreName] } }]
            }
        });

        if (!result || !result.candidates) {
            throw new Error('Received empty response from Gemini API');
        }

        if (result.candidates.length === 0) {
            return "I couldn't find relevant information in the knowledge base to answer your question.";
        }

        let text = '';
        try {
            text = result.text();
        } catch (e) {
            text = result.candidates[0]?.content?.parts?.[0]?.text || '';
        }

        if (!text) {
            return "I found some sources but couldn't generate a text response.";
        }

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
 */
async function getGoogleAIResponse({ transcription, params }) {
    const { apiKey, model, models, systemPrompt, language, history, tierConfig, retryConfig, onProgress, fileSearchStoreName } = params;
    const modelList = models || (Array.isArray(model) ? model : [model]);

    try {
        if (fileSearchStoreName) {
            console.log('[File Search] Using knowledge base for response');
            const response = await getChatCompletionWithFileSearch(
                transcription, apiKey, modelList[0], systemPrompt, language,
                history, tierConfig || {}, params.briefMode || false, fileSearchStoreName
            );
            return { response, threadId: null };
        }

        if (modelList.length > 1 && retryConfig) {
            const response = await executeWithFallback(
                async (modelName) => {
                    return await getChatCompletionGoogle(
                        transcription, apiKey, modelName, systemPrompt,
                        language, history, tierConfig || {}, params.briefMode || false
                    );
                },
                modelList, retryConfig, onProgress
            );
            return { response, threadId: null };
        } else {
            const response = await getChatCompletionGoogle(
                transcription, apiKey, modelList[0], systemPrompt,
                language, history, tierConfig || {}, params.briefMode || false
            );
            return { response, threadId: null };
        }
    } catch (error) {
        console.error('[ERROR] Google AI Response failed:', error);
        throw error;
    }
}

module.exports = { getChatCompletionGoogle, getGoogleAIResponse };
