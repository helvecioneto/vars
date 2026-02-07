/**
 * VARS - OpenAI Chat
 * Chat completion using GPT models
 */

const { getClient } = require('./client');
const { getPromptForLanguage } = require('../../config');
const { getAssistantResponse } = require('./assistants');

/**
 * Get chat completion response
 */
async function getChatCompletionResponse(transcription, apiKey, model, systemPrompt, language = 'en', history = [], tierConfig = {}, briefMode = false) {
    const openai = getClient(apiKey);
    const langInstructions = getPromptForLanguage('language.responseInstruction', language);

    const messages = [
        {
            role: 'system',
            content: (systemPrompt || 'You are a helpful assistant.') + langInstructions + (briefMode ? getPromptForLanguage('knowledgeBase.briefMode', language) : '')
        },
        ...(history || []),
        { role: 'user', content: transcription }
    ];

    const temperature = tierConfig.temperature ?? 0.7;
    const maxOutputTokens = tierConfig.maxOutputTokens ?? 1000;

    const params = { model: model, messages: messages };

    if (model.startsWith('gpt-5') || model.startsWith('o1') || model.includes('thinking')) {
        params.max_completion_tokens = maxOutputTokens;
        params.temperature = 1;
    } else {
        params.max_tokens = maxOutputTokens;
        params.temperature = temperature;
    }

    const completion = await openai.chat.completions.create(params);
    return completion.choices[0].message.content;
}

/**
 * Smart AI response - chooses between Assistant or Chat Completion
 */
async function getSmartAIResponse({ transcription, params }) {
    const { apiKey, model, systemPrompt, language, history,
        assistantId, vectorStoreId, threadId, knowledgeBasePaths, briefMode, tierConfig } = params;

    console.log('[DEBUG] SmartAI Params:', { assistantId, vectorStoreId, model, briefMode, tierConfig });

    if (assistantId && vectorStoreId) {
        console.log('[DEBUG] Using Assistant API');
        return await getAssistantResponse(apiKey, assistantId, threadId, transcription, model, systemPrompt, knowledgeBasePaths, briefMode, language);
    } else {
        console.log('[DEBUG] Using Chat Completion API');
        const response = await getChatCompletionResponse(transcription, apiKey, model, systemPrompt, language, history, tierConfig || {}, briefMode);
        return { response, threadId: null };
    }
}

module.exports = { getChatCompletionResponse, getSmartAIResponse };
