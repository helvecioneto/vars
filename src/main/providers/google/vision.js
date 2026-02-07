/**
 * VARS - Google Vision
 * Image analysis using Gemini Vision
 */

const { getGoogleClient } = require('./client');
const { getPromptForLanguage } = require('../../config');

/**
 * Analyze an image using Google's Gemini Vision API
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
    const langInstructions = getPromptForLanguage('language.responseInstruction', language);
    const briefModeInstruction = briefMode ? '\n\nPlease keep your response brief and concise.' : '';

    const visionModel = model.includes('gemini') ? model : 'gemini-1.5-flash';

    const genModel = genAI.getGenerativeModel({
        model: visionModel,
        generationConfig: {
            temperature: tierConfig.temperature ?? 0.7,
            maxOutputTokens: tierConfig.maxOutputTokens ?? 1500,
        }
    });

    // Parse the base64 image data
    let mimeType = 'image/png';
    let base64Data = imageData;

    if (imageData.startsWith('data:')) {
        const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
            mimeType = matches[1];
            base64Data = matches[2];
        }
    }

    const systemInstruction = (systemPrompt || 'You are a helpful assistant that analyzes images and provides detailed descriptions.') + langInstructions + briefModeInstruction;

    const geminiHistory = history.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: msg.content }]
    }));

    console.log(`[Vision] Analyzing image with Gemini model: ${visionModel}`);

    const imagePart = {
        inlineData: { mimeType: mimeType, data: base64Data }
    };

    const textPart = { text: prompt };

    const result = await genModel.generateContent({
        contents: [
            ...geminiHistory.map(h => ({ role: h.role, parts: h.parts })),
            { role: 'user', parts: [textPart, imagePart] }
        ],
        systemInstruction: systemInstruction
    });

    const response = result.response;
    return response.text();
}

module.exports = { analyzeImageGoogle };
