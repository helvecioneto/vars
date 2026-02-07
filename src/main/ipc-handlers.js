/**
 * VARS - IPC Handlers Module
 * Main entry point - delegates to modular handlers
 * 
 * This file has been refactored. The actual handlers are now in:
 * - handlers/config.js  - Configuration and API key testing
 * - handlers/audio.js   - Audio transcription and realtime
 * - handlers/ai.js      - AI responses and knowledge base
 * - handlers/window.js  - Window control and resize
 * - handlers/media.js   - Screen capture and desktop sources
 * - handlers/misc.js    - External URLs, updates, permissions
 */

const { setupAllHandlers } = require('./handlers');

/**
 * Setup all IPC handlers
 * @param {object} context - Context object containing mainWindow, config, and saveConfig
 */
function setupIPCHandlers(context) {
    setupAllHandlers(context);
}

module.exports = { setupIPCHandlers };
