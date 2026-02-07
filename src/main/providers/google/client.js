/**
 * VARS - Google AI Client
 * Client initialization for Google Generative AI
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai');

/**
 * Get initialized GoogleGenerativeAI client (v1 SDK)
 * @param {string} apiKey - Google API key
 */
function getGoogleClient(apiKey) {
    return new GoogleGenerativeAI(apiKey);
}

/**
 * Get initialized GoogleGenAI client (v2 SDK for File Search)
 * @param {string} apiKey - Google API key
 */
function getGenAIClient(apiKey) {
    return new GoogleGenAI({ apiKey });
}

module.exports = { getGoogleClient, getGenAIClient };
