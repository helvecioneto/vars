/**
 * VARS - Event Listeners Module
 * Sets up global event listeners
 */

import { state, setConfig, INPUT_MODES } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { toggleSettings, setupSettingsTabs, applyConfigToUI } from '../settings/index.js';
import { toggleVisibilityMode } from '../ui/visibility.js';
import { handleFileSelection, handleTrainKB, handleResetKB, updateFileList } from '../settings/knowledge-base.js';
import { testAPIKey } from '../settings/api-key.js';
import { handleKeyboardSubmit, handleInputModeChange, handleInputSubmit } from '../input/index.js';
import { handleRecordingToggle, startRecording, stopRecording } from '../recording/index.js';
import { zoomIn, zoomOut, resetZoom, handleZoomShortcut } from '../ui/zoom.js';
import { navigateHistory, clearHistory } from '../history/index.js';
import { captureAndAnalyzeScreen, processScreenshotAction } from '../screenshot/index.js';
import { nextOnboardingStep, skipOnboarding } from '../onboarding/index.js';
import { updateButtonTooltips } from '../ui/tooltips.js';
import { autoSaveConfig, setupAutoSave } from '../settings/auto-save.js';
import { populateModelOptions, updateModelDisplay, handleFreeTierRetry } from '../settings/model-selection.js';
import { populateDevices, populateSystemAudioDevices } from '../settings/devices.js';

/**
 * Setup all application event listeners
 */
export function setupEventListeners() {
    // Window controls
    if (elements.minimizeBtn) {
        elements.minimizeBtn.addEventListener('click', () => {
            window.electronAPI.minimizeWindow();
        });
    }

    // Global Context Menu (Right-click anywhere shows Hide/Exit)
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.electronAPI.showContextMenu();
    });

    // Drag Logic
    setupDragHandlers();

    // Settings toggle
    if (elements.settingsBtn) {
        elements.settingsBtn.addEventListener('click', toggleSettings);
    }

    // Back button in settings (mobile-like view or just semantic)
    if (elements.backBtn) {
        elements.backBtn.addEventListener('click', toggleSettings);
    }

    // Settings tabs
    setupSettingsTabs();

    // Visibility toggle
    const visibilityToggle = document.getElementById('visibility-toggle');
    if (visibilityToggle) {
        visibilityToggle.addEventListener('click', toggleVisibilityMode);
    }

    // External Links
    setupExternalLinks();

    // Knowledge Base
    if (elements.addFileBtn) {
        elements.addFileBtn.addEventListener('click', () => {
            elements.fileInput.click();
        });
    }
    if (elements.fileInput) {
        elements.fileInput.addEventListener('change', handleFileSelection);
    }
    if (elements.trainBtn) {
        elements.trainBtn.addEventListener('click', handleTrainKB);
    }
    if (elements.resetKbBtn) {
        elements.resetKbBtn.addEventListener('click', handleResetKB);
    }

    // API Key Testing
    const testApiBtn = document.getElementById('test-api-btn');
    if (testApiBtn) {
        testApiBtn.addEventListener('click', testAPIKey);
    }
    const testGoogleApiBtn = document.getElementById('test-google-api-btn');
    if (testGoogleApiBtn) {
        testGoogleApiBtn.addEventListener('click', testAPIKey);
    }

    // Input Handling
    if (elements.submitKeyboardBtn) {
        elements.submitKeyboardBtn.addEventListener('click', handleKeyboardSubmit);
    }
    if (elements.keyboardInput) {
        elements.keyboardInput.addEventListener('keydown', (e) => {
            const isMac = window.electronAPI.platform === 'darwin';
            const modifierKey = isMac ? e.altKey : (e.ctrlKey || e.metaKey);

            if (e.key === 'Enter' && modifierKey) {
                handleKeyboardSubmit();
            }
        });
    }
    if (elements.inputField) {
        elements.inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleInputSubmit();
            }
        });
    }

    // Settings Inputs Change Handlers (for immediate update without auto-save delay if needed)
    if (elements.systemPromptInput) {
        elements.systemPromptInput.addEventListener('change', (e) => {
            state.config.systemPrompt = e.target.value;
            window.electronAPI.saveConfig(state.config);
        });
    }
    if (elements.briefModeCheckbox) {
        elements.briefModeCheckbox.addEventListener('change', (e) => {
            state.config.briefMode = e.target.checked;
            window.electronAPI.saveConfig(state.config);
        });
    }

    // Prompt Optimizer
    setupPromptOptimizer();

    // Recording Controls
    if (elements.recBtn) {
        elements.recBtn.addEventListener('click', () => {
            window.electronAPI.toggleRecording();
        });
    }

    // Mode Switching
    if (elements.modeBtn) {
        elements.modeBtn.addEventListener('click', () => {
            const modes = Object.keys(INPUT_MODES);
            const currentIndex = modes.indexOf(state.currentInputMode);
            const nextIndex = (currentIndex + 1) % modes.length;
            handleInputModeChange(modes[nextIndex]);
        });
    }
    // Legacy support
    if (elements.modeBadge) {
        elements.modeBadge.addEventListener('click', () => {
            const modes = Object.keys(INPUT_MODES);
            const currentIndex = modes.indexOf(state.currentInputMode);
            const nextIndex = (currentIndex + 1) % modes.length;
            handleInputModeChange(modes[nextIndex]);
        });
    }

    // History Navigation
    if (elements.historyBtn) {
        elements.historyBtn.addEventListener('click', () => {
            navigateHistory('up');
        });
    }

    // Delegated listener for dynamic content in status bar (Clear History)
    if (elements.statusBar) {
        elements.statusBar.addEventListener('click', (e) => {
            if (e.target.id === 'clear-history-btn' || e.target.closest('#clear-history-btn')) {
                clearHistory();
            }
        });
    }

    // Screenshot
    if (elements.screenshotBtn) {
        elements.screenshotBtn.addEventListener('click', () => {
            captureAndAnalyzeScreen();
        });
    }
    setupScreenshotActionListeners();

    // Zoom Controls
    if (elements.zoomInBtn) {
        elements.zoomInBtn.addEventListener('click', zoomIn);
    }
    if (elements.zoomOutBtn) {
        elements.zoomOutBtn.addEventListener('click', zoomOut);
    }

    // Onboarding
    const onboardNextBtn = document.getElementById('onboarding-next-btn');
    if (onboardNextBtn) {
        onboardNextBtn.addEventListener('click', nextOnboardingStep);
    }
    const onboardSkipBtn = document.getElementById('onboarding-skip-btn');
    if (onboardSkipBtn) {
        onboardSkipBtn.addEventListener('click', skipOnboarding);
    }

    // IPC Events
    setupIPCEvents();
}

/**
 * Setup window dragging logic
 */
function setupDragHandlers() {
    // Helper for buttons
    function setupDragButton(btn) {
        if (!btn) return;
        btn.addEventListener('mousedown', () => {
            window.electronAPI.setDragging(true);
        });
    }

    setupDragButton(elements.dragBtn);
    setupDragButton(elements.settingsDragBtn);

    // Global drag: Allow dragging the window from anywhere except text inputs
    let dragStartPos = null;
    let hasDragged = false;
    const DRAG_THRESHOLD = 5;

    elements.appContainer.addEventListener('mousedown', (e) => {
        // Ignore sliders to allow value adjustment
        // We allow dragging on INPUT/TEXTAREA as requested, preventing mouse text selection but allowing window move
        if (e.target.type === 'range' ||
            e.target.closest('.slider-container') ||
            e.target.closest('.no-drag')) {
            return;
        }

        if (e.button !== 0) return;
        dragStartPos = { x: e.screenX, y: e.screenY };
        hasDragged = false;
        window.electronAPI.setDragging(true);
    });

    window.addEventListener('mousemove', (e) => {
        if (dragStartPos && !hasDragged) {
            const dx = Math.abs(e.screenX - dragStartPos.x);
            const dy = Math.abs(e.screenY - dragStartPos.y);
            if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
                hasDragged = true;
            }
        }
    });

    window.addEventListener('mouseup', () => {
        window.electronAPI.setDragging(false);
        dragStartPos = null;
    });

    elements.appContainer.addEventListener('click', (e) => {
        if (hasDragged) {
            e.stopPropagation();
            e.preventDefault();
            hasDragged = false;
        }
    }, true);
}

/**
 * Setup external link handlers
 */
function setupExternalLinks() {
    const apiKeyHelp = document.getElementById('api-key-help');
    if (apiKeyHelp) {
        apiKeyHelp.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Opening OpenAI API Key page...');
            window.electronAPI.openExternal('https://platform.openai.com/api-keys');
        });
    }

    const googleApiKeyHelp = document.getElementById('google-api-key-help');
    if (googleApiKeyHelp) {
        googleApiKeyHelp.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Opening Google AI Studio page...');
            window.electronAPI.openExternal('https://aistudio.google.com/app/apikey');
        });
    }

    const githubLink = document.getElementById('github-link');
    if (githubLink) {
        githubLink.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Opening GitHub profile...');
            window.electronAPI.openExternal('https://github.com/helvecioneto/');
        });
    }
}

/**
 * Setup screenshot action buttons and shortcuts
 */
function setupScreenshotActionListeners() {
    if (elements.actionAnswers) {
        elements.actionAnswers.addEventListener('click', () => processScreenshotAction('answers'));
    }
    if (elements.actionCode) {
        elements.actionCode.addEventListener('click', () => processScreenshotAction('code'));
    }
    if (elements.actionSummary) {
        elements.actionSummary.addEventListener('click', () => processScreenshotAction('summary'));
    }
    if (elements.actionAsk) {
        elements.actionAsk.addEventListener('click', () => {
            const customPrompt = elements.screenshotAskInput?.value?.trim() || '';
            processScreenshotAction('ask', customPrompt);
        });
    }
    if (elements.screenshotAskInput) {
        elements.screenshotAskInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const customPrompt = elements.screenshotAskInput.value.trim();
                processScreenshotAction('ask', customPrompt);
            }
        });
    }

    // Shortcuts 1, 2, 3
    document.addEventListener('keydown', (e) => {
        if (!state.pendingScreenshot) return;
        if (elements.screenshotActions?.classList.contains('hidden')) return;
        if (document.activeElement === elements.screenshotAskInput) return;
        if (document.activeElement === elements.inputField) return;

        switch (e.key) {
            case '1':
                e.preventDefault();
                processScreenshotAction('answers');
                break;
            case '2':
                e.preventDefault();
                processScreenshotAction('code');
                break;
            case '3':
                e.preventDefault();
                processScreenshotAction('summary');
                break;
        }
    });
}

/**
 * Setup IPC event listeners (messages from main process)
 */
function setupIPCEvents() {
    // Listen for recording toggle from main process
    window.electronAPI.onRecordingToggle(handleRecordingToggle);

    // Listen for input mode changes from main process
    window.electronAPI.onInputModeChanged(handleInputModeChange);

    // Listen for zoom shortcuts from main process
    window.electronAPI.onZoomShortcut(handleZoomShortcut);

    // Listen for free-tier-retry events (only for free tier)
    window.electronAPI.onFreeTierRetry(handleFreeTierRetry);

    // Listen for screenshot capture shortcut
    window.electronAPI.onScreenshotCapture(() => {
        captureAndAnalyzeScreen();
    });
}

/**
 * Setup Prompt Optimizer functionality
 */
let originalPrompt = ''; // Store original prompt for reverting

function setupPromptOptimizer() {
    const { optimizePromptBtn, revertPromptBtn, systemPromptInput } = elements;

    if (!optimizePromptBtn || !systemPromptInput) return;

    // Optimize button - generates optimized prompt
    optimizePromptBtn.addEventListener('click', async () => {
        const currentPrompt = systemPromptInput.value.trim();

        if (!currentPrompt) {
            systemPromptInput.focus();
            systemPromptInput.classList.add('error');
            setTimeout(() => systemPromptInput.classList.remove('error'), 500);
            return;
        }

        // Store original if first time
        if (!originalPrompt) {
            originalPrompt = currentPrompt;
        }

        await generateOptimizedPrompt();
    });

    // Back button - revert to original
    if (revertPromptBtn) {
        revertPromptBtn.addEventListener('click', () => {
            if (originalPrompt) {
                systemPromptInput.value = originalPrompt;
                systemPromptInput.classList.remove('optimized');
                state.config.systemPrompt = originalPrompt;
                window.electronAPI.saveConfig(state.config);
            }
            resetOptimizerUI();
        });
    }

    async function generateOptimizedPrompt() {
        const userInput = originalPrompt || systemPromptInput.value.trim();
        if (!userInput) return;

        // Show loading state
        optimizePromptBtn.disabled = true;
        optimizePromptBtn.classList.add('loading');
        optimizePromptBtn.innerHTML = '<span class="icon">⏳</span> Optimizing...';

        try {
            const result = await window.electronAPI.optimizePrompt(userInput);

            if (result.error) {
                console.error('[Optimizer]', result.error);
                optimizePromptBtn.innerHTML = '<span class="icon">❌</span> Error';
                setTimeout(() => resetOptimizerUI(), 2000);
                return;
            }

            if (result.optimizedPrompt) {
                systemPromptInput.value = result.optimizedPrompt;
                systemPromptInput.classList.add('optimized');
                state.config.systemPrompt = result.optimizedPrompt;
                window.electronAPI.saveConfig(state.config);

                // Show Back button and update Optimize text
                if (revertPromptBtn) {
                    revertPromptBtn.classList.remove('hidden');
                }
                optimizePromptBtn.innerHTML = '<span class="icon">✨</span> Re-optimize';
            }
        } catch (error) {
            console.error('[Optimizer] Error:', error);
            optimizePromptBtn.innerHTML = '<span class="icon">❌</span> Error';
            setTimeout(() => resetOptimizerUI(), 2000);
        } finally {
            optimizePromptBtn.disabled = false;
            optimizePromptBtn.classList.remove('loading');
        }
    }

    function resetOptimizerUI() {
        if (revertPromptBtn) {
            revertPromptBtn.classList.add('hidden');
        }
        optimizePromptBtn.innerHTML = '<span class="icon">✨</span> Optimize';
        optimizePromptBtn.disabled = false;
        optimizePromptBtn.classList.remove('loading');
        originalPrompt = '';
        systemPromptInput.classList.remove('optimized');
    }
}
