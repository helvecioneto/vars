/**
 * VARS - OpenAI Client
 * Client initialization for OpenAI
 */

const OpenAI = require('openai');

/**
 * Get initialized OpenAI client
 * @param {string} apiKey - OpenAI API key
 */
function getClient(apiKey) {
    return new OpenAI({ apiKey });
}

module.exports = { getClient };
