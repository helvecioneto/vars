/**
 * VARS - IPC Handlers Index
 * Aggregates all modular IPC handlers
 */

const { setupConfigHandlers } = require('./config');
const { setupAudioHandlers } = require('./audio');
const { setupAIHandlers } = require('./ai');
const { setupWindowHandlers } = require('./window');
const { setupMediaHandlers } = require('./media');
const { setupMiscHandlers } = require('./misc');
const { setupSmartListenerHandlers } = require('./smart-listener');
const { setupOnboardingHandlers } = require('./onboarding');

/**
 * Setup all IPC handlers by delegating to modular handlers
 * @param {object} context - Context with mainWindow, config, etc.
 */
function setupAllHandlers(context) {
    setupConfigHandlers(context);
    setupAudioHandlers(context);
    setupAIHandlers(context);
    setupWindowHandlers(context);
    setupMediaHandlers(context);
    setupMiscHandlers(context);
    setupSmartListenerHandlers(context);
    setupOnboardingHandlers(context);
}

module.exports = { setupAllHandlers };
