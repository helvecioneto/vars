/**
 * VARS - Google Provider Index
 * Re-exports all Google AI functions for backward compatibility
 */

const { transcribeAudioGoogle } = require('./transcription');
const { getChatCompletionGoogle, getGoogleAIResponse } = require('./chat');
const { analyzeImageGoogle } = require('./vision');
const {
    createFileSearchStore,
    getFileSearchStore,
    uploadToFileSearchStore,
    deleteFileSearchStore,
    createGoogleKnowledgeBase,
    resetGoogleKnowledgeBase
} = require('./knowledge-base');

module.exports = {
    transcribeAudioGoogle,
    getChatCompletionGoogle,
    getGoogleAIResponse,
    analyzeImageGoogle,
    createFileSearchStore,
    getFileSearchStore,
    uploadToFileSearchStore,
    deleteFileSearchStore,
    createGoogleKnowledgeBase,
    resetGoogleKnowledgeBase
};
