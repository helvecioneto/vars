/**
 * VARS - OpenAI Vision
 * Image analysis using GPT Vision
 */

const { getClient, isOAuthToken } = require('./client');
const { getPromptForLanguage } = require('../../config');
const { getCodexResponse } = require('./codex-responses');

/**
 * Analyze an image using OpenAI's Vision API
 * Automatically routes through Codex Responses API when using OAuth tokens
 */
async function analyzeImageOpenAI({
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
    const langInstructions = getPromptForLanguage('language.responseInstruction', language);
    const briefModeInstruction = briefMode ? getPromptForLanguage('knowledgeBase.briefMode', language) : '';
    const fullSystemPrompt = (systemPrompt || 'You are a helpful assistant that analyzes images and provides detailed descriptions.') + langInstructions + briefModeInstruction;

    const visionModel = model.includes('gpt-4') || model.includes('gpt-5') || model.includes('o1')
        ? model
        : 'gpt-4o-mini';

    const messages = [
        { role: 'system', content: fullSystemPrompt },
        ...history,
        {
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageData, detail: 'high' } }
            ]
        }
    ];

    const maxOutputTokens = tierConfig.maxOutputTokens ?? 1500;

    // If using Codex OAuth token, route through the Codex Responses API
    if (isOAuthToken(apiKey)) {
        console.log(`[Vision] Using Codex Responses API for image analysis`);
        return await getCodexResponse(apiKey, visionModel, fullSystemPrompt, messages, maxOutputTokens);
    }

    // Standard API key flow
    console.log(`[Vision] Analyzing image with model: ${visionModel}`);
    const openai = getClient(apiKey);

    const params = {
        model: visionModel,
        messages: messages,
        max_tokens: maxOutputTokens
    };

    if (visionModel.startsWith('o1') || visionModel.includes('thinking')) {
        params.temperature = 1;
    } else {
        params.temperature = tierConfig.temperature ?? 0.7;
    }

    const completion = await openai.chat.completions.create(params);
    return completion.choices[0].message.content;
}

module.exports = { analyzeImageOpenAI };
