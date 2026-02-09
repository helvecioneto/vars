/**
 * VARS - OpenAI Chat
 * Chat completion using GPT models
 */

const { getClient, isOAuthToken } = require('./client');
const { getPromptForLanguage } = require('../../config');
const { getAssistantResponse } = require('./assistants');
const { getCodexResponse } = require('./codex-responses');

/**
 * Get chat completion response
 * Automatically routes through Codex Responses API when using OAuth tokens
 */
async function getChatCompletionResponse(transcription, apiKey, model, systemPrompt, language = 'en', history = [], tierConfig = {}, briefMode = false) {
    const langInstructions = getPromptForLanguage('language.responseInstruction', language);
    const fullSystemPrompt = (systemPrompt || 'You are a helpful assistant.') + langInstructions + (briefMode ? getPromptForLanguage('knowledgeBase.briefMode', language) : '');

    const messages = [
        { role: 'system', content: fullSystemPrompt },
        ...(history || []),
        { role: 'user', content: transcription }
    ];

    const maxOutputTokens = tierConfig.maxOutputTokens ?? 1000;

    // If using Codex OAuth token, route through the Codex Responses API
    // Codex tokens cannot use api.openai.com - they must use chatgpt.com/backend-api
    if (isOAuthToken(apiKey)) {
        console.log('[DEBUG] Using Codex Responses API (chatgpt.com/backend-api)');
        return await getCodexResponse(apiKey, model, fullSystemPrompt, messages, maxOutputTokens);
    }

    // Standard API key flow (sk-...)
    console.log('[DEBUG] Using Chat Completion API');
    const openai = getClient(apiKey);
    const temperature = tierConfig.temperature ?? 0.7;
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
