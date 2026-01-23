/**
 * VARS - Screenshot Module
 * Handles screen capture and analysis
 */

import { state, setPendingScreenshot } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { updateStatus } from '../ui/status.js';
import { showTranscription, showResponse } from '../ui/response.js';
import { updateHistory } from '../history/index.js';
import { handleApiError } from '../utils/api-errors.js';

/**
 * Capture the foreground window/application and show action options
 */
export async function captureAndAnalyzeScreen() {
    // Visual feedback
    if (elements.screenshotBtn) {
        elements.screenshotBtn.classList.add('capturing');
    }

    updateStatus('📸 Capturing screen...', 'processing');

    try {
        // Call main process to capture the foreground window
        const result = await window.electronAPI.captureScreen();

        if (result.error) {
            throw new Error(result.error);
        }

        if (!result.imageData) {
            throw new Error('No image data returned');
        }

        // Store the screenshot for later use
        const screenshot = {
            imageData: result.imageData,
            windowTitle: result.windowTitle || 'Captured screen'
        };
        setPendingScreenshot(screenshot);

        // Show the action panel
        showScreenshotActions(screenshot.windowTitle);

        updateStatus('Select an action', 'ready');

    } catch (error) {
        console.error('Screen capture error:', error);
        updateStatus('Error: ' + error.message, 'error');
        showResponse(`Error capturing screen: ${error.message}`);
    } finally {
        // Remove visual feedback
        if (elements.screenshotBtn) {
            elements.screenshotBtn.classList.remove('capturing');
        }
    }
}

/**
 * Show the screenshot action panel
 * @param {string} title - Window title
 */
export function showScreenshotActions(title) {
    // Show content area if hidden
    elements.contentArea?.classList.remove('hidden');

    // Hide transcription and response sections
    elements.transcriptionSection?.classList.add('hidden');
    elements.responseSection?.classList.add('hidden');

    // Update title and show actions panel
    if (elements.screenshotTitle) {
        elements.screenshotTitle.textContent = title;
    }
    if (elements.screenshotAskInput) {
        elements.screenshotAskInput.value = '';
    }
    elements.screenshotActions?.classList.remove('hidden');
}

/**
 * Hide the screenshot action panel
 */
export function hideScreenshotActions() {
    elements.screenshotActions?.classList.add('hidden');
}

/**
 * Process the screenshot with a specific action
 * @param {string} actionType - 'answers', 'code', 'summary', 'ask'
 * @param {string} customPrompt - Custom prompt for 'ask' action
 */
export async function processScreenshotAction(actionType, customPrompt = '') {
    if (!state.pendingScreenshot) {
        updateStatus('No screenshot to process', 'error');
        return;
    }

    // Hide action panel
    hideScreenshotActions();

    // Show processing state
    updateStatus('🔍 Analyzing...', 'processing');
    showTranscription(`📸 ${state.pendingScreenshot.windowTitle}`);
    showResponse('');

    // Build prompt based on action
    let prompt;
    switch (actionType) {
        case 'answers':
            prompt = 'FOCUS: Find all questions, exercises, problems, or quizzes visible on the screen. For each one found, provide the correct answer or solution. Be direct and comprehensive.';
            break;
        case 'code':
            prompt = 'FOCUS: Analyze any code visible on the screen. Explain what it does, identify bugs or issues, suggest improvements, and provide corrected versions if needed.';
            break;
        case 'summary':
            prompt = 'FOCUS: Provide a concise summary of all content visible on the screen. Highlight the most important information, key points, and any actionable items.';
            break;
        case 'ask':
            prompt = customPrompt || 'Describe what you see on the screen.';
            break;
        default:
            prompt = '';
    }

    try {
        const aiResult = await window.electronAPI.analyzeImage({
            imageData: state.pendingScreenshot.imageData,
            prompt: prompt,
            windowTitle: state.pendingScreenshot.windowTitle
        });

        if (handleApiError(aiResult)) return;

        showResponse(aiResult.response);
        updateStatus('Ready', 'ready');

        // Update History
        const actionLabel = actionType === 'ask' ? customPrompt : actionType.charAt(0).toUpperCase() + actionType.slice(1);
        const historyEntry = `📸 [${state.pendingScreenshot.windowTitle}] ${actionLabel}`;
        updateHistory(historyEntry, aiResult.response);

    } catch (error) {
        console.error('Screenshot analysis error:', error);
        updateStatus('Error: ' + error.message, 'error');
        showResponse(`Error: ${error.message}`);
    } finally {
        // Clear pending screenshot
        setPendingScreenshot(null);
    }
}
