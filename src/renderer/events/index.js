/**
 * VARS - Event Listeners Module
 * Sets up global event listeners
 */

import { state, setConfig, INPUT_MODES } from '../state/index.js';
import { elements } from '../ui/elements.js';
import { toggleSettings, setupSettingsTabs, applyConfigToUI } from '../settings/index.js';
import { toggleVisibilityMode } from '../ui/visibility.js';
import { handleFileSelection, handleTrainKB, handleResetKB, updateFileList } from '../settings/knowledge-base.js';
import { handleKeyboardSubmit, handleInputModeChange, handleInputSubmit } from '../input/index.js';
import { handleRecordingToggle, startRecording, stopRecording } from '../recording/index.js';
import { zoomIn, zoomOut, resetZoom, handleZoomShortcut } from '../ui/zoom.js';
import { navigateHistory, clearHistory } from '../history/index.js';
import { captureAndAnalyzeScreen, processScreenshotAction } from '../screenshot/index.js';
import { nextOnboardingStep, skipOnboarding } from '../onboarding/index.js';
import { updateButtonTooltips } from '../ui/tooltips.js';
import { autoSaveConfig, setupAutoSave } from '../settings/auto-save.js';
import { updateModelDisplay, handleFreeTierRetry } from '../settings/model-selection.js';
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

    // API Key Testing — handled by initCodexAuth() in api-key.js

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
                // Hide input field after submit, show pills
                elements.inputField.style.display = 'none';
                const toolbarPills = document.getElementById('toolbar-pills');
                if (toolbarPills) toolbarPills.style.display = 'flex';
            }
            if (e.key === 'Escape') {
                elements.inputField.style.display = 'none';
                const toolbarPills = document.getElementById('toolbar-pills');
                if (toolbarPills) toolbarPills.style.display = 'flex';
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

    // History Navigation / Chat toggle
    if (elements.historyBtn) {
        elements.historyBtn.addEventListener('click', () => {
            // Toggle input field visibility
            const inputField = document.getElementById('input-field');
            const toolbarPills = document.getElementById('toolbar-pills');
            if (inputField && toolbarPills) {
                const isHidden = inputField.style.display === 'none' || inputField.style.display === '';
                if (isHidden) {
                    inputField.style.display = 'block';
                    toolbarPills.style.display = 'none';
                    inputField.focus();
                } else {
                    inputField.style.display = 'none';
                    toolbarPills.style.display = 'flex';
                }
            }
        });
    }

    // Card navigation (prev/next in content card)
    const cardPrevBtn = document.getElementById('card-prev-btn');
    const cardNextBtn = document.getElementById('card-next-btn');
    if (cardPrevBtn) {
        cardPrevBtn.addEventListener('click', () => navigateHistory('up'));
    }
    if (cardNextBtn) {
        cardNextBtn.addEventListener('click', () => navigateHistory('down'));
    }

    // Card close button
    const cardCloseBtn = document.getElementById('card-close-btn');
    if (cardCloseBtn) {
        cardCloseBtn.addEventListener('click', () => {
            const contentArea = document.getElementById('content-area');
            if (contentArea) contentArea.classList.add('hidden');
        });
    }

    // Card delete button
    const cardDeleteBtn = document.getElementById('card-delete-btn');
    if (cardDeleteBtn) {
        cardDeleteBtn.addEventListener('click', () => {
            clearHistory();
        });
    }

    // AI Answer pill button (triggers same as rec-btn)
    const aiAnswerBtn = document.getElementById('ai-answer-btn');
    if (aiAnswerBtn) {
        aiAnswerBtn.addEventListener('click', () => {
            window.electronAPI.toggleRecording();
        });
    }

    // Toast bar actions
    const toastDeleteBtn = document.getElementById('toast-delete-btn');
    if (toastDeleteBtn) {
        toastDeleteBtn.addEventListener('click', () => {
            clearHistory();
        });
    }
    const toastCloseBtn = document.getElementById('toast-close-btn');
    if (toastCloseBtn) {
        toastCloseBtn.addEventListener('click', () => {
            const toastBar = document.getElementById('toast-bar');
            if (toastBar) toastBar.classList.add('hidden');
        });
    }
    const toastExpandBtn = document.getElementById('toast-expand-btn');
    if (toastExpandBtn) {
        toastExpandBtn.addEventListener('click', () => {
            const contentArea = document.getElementById('content-area');
            if (contentArea) contentArea.classList.toggle('hidden');
        });
    }

    // Stop recording icon
    const stopRecIcon = document.getElementById('stop-rec-icon');
    if (stopRecIcon) {
        stopRecIcon.addEventListener('click', () => {
            if (state.isRecording) {
                window.electronAPI.toggleRecording();
            }
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
 * Setup per-component dragging (each floating element is independently draggable)
 * and click-through toggle for the transparent overlay.
 */
let isAnyDragging = false;

function setupDragHandlers() {
    const DRAG_THRESHOLD = 5;

    // Floating components that can be dragged independently
    const floatingComponents = [
        document.getElementById('toolbar'),
        document.getElementById('toast-bar'),
        document.getElementById('content-area'),
        document.getElementById('settings-panel')
    ].filter(Boolean);

    // Set initial centered positions for floating components
    initFloatingPositions();

    // Setup drag for each component
    floatingComponents.forEach(el => setupComponentDrag(el, DRAG_THRESHOLD));

    // Setup click-through toggle for transparent overlay
    setupClickThrough(floatingComponents);
}

/**
 * Set initial centered positions for floating components
 */
function initFloatingPositions() {
    const vw = window.innerWidth;

    const toolbar = document.getElementById('toolbar');
    const toastBar = document.getElementById('toast-bar');
    const contentArea = document.getElementById('content-area');
    const settingsPanel = document.getElementById('settings-panel');

    // We need to measure the toolbar after render
    requestAnimationFrame(() => {
        // Center toolbar near top
        if (toolbar) {
            const tw = toolbar.offsetWidth || 450;
            toolbar.style.left = Math.max(0, (vw - tw) / 2) + 'px';
            toolbar.style.top = '20px';
        }

        // Center toast below toolbar (use 400 as default width for hidden elements)
        if (toastBar) {
            toastBar.style.left = Math.max(0, (vw - 400) / 2) + 'px';
            toastBar.style.top = '76px';
        }

        // Center content card below toast
        if (contentArea) {
            contentArea.style.left = Math.max(0, (vw - 440) / 2) + 'px';
            contentArea.style.top = '120px';
        }

        // Settings panel overlaps content area position
        if (settingsPanel) {
            settingsPanel.style.left = Math.max(0, (vw - 440) / 2) + 'px';
            settingsPanel.style.top = '76px';
        }
    });
}

/**
 * Setup drag behavior for a single floating component
 */
function setupComponentDrag(element, threshold) {
    let isDragging = false;
    let hasMoved = false;
    let startX, startY, origLeft, origTop;

    element.addEventListener('mousedown', (e) => {
        // Skip interactive elements
        if (e.target.closest('button, input, select, textarea, a, .slider-container, .no-drag') ||
            e.target.type === 'range') {
            return;
        }
        // Skip scrollable inner content (allow text selection and scrolling)
        if (e.target.closest('.response-content, .user-query, .settings-tab-content, .screenshot-actions, .form-group')) {
            return;
        }
        if (e.button !== 0) return;

        isDragging = true;
        hasMoved = false;
        isAnyDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        origLeft = element.offsetLeft;
        origTop = element.offsetTop;
        element.classList.add('is-dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!hasMoved && (Math.abs(dx) > threshold || Math.abs(dy) > threshold)) {
            hasMoved = true;
        }

        if (hasMoved) {
            element.style.left = (origLeft + dx) + 'px';
            element.style.top = (origTop + dy) + 'px';
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (!isDragging) return;
        isDragging = false;
        isAnyDragging = false;
        element.classList.remove('is-dragging');

        if (hasMoved) {
            hasMoved = false;
        }

        // Re-enable click-through if mouse is not over any floating component
        const overComponent = e.target.closest('.toolbar, .toast-bar, .content-area, .settings-panel');
        if (!overComponent) {
            window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
        }
    });

    // Suppress click events after drag
    element.addEventListener('click', (e) => {
        if (hasMoved) {
            e.stopPropagation();
            e.preventDefault();
            hasMoved = false;
        }
    }, true);
}

/**
 * Setup click-through for transparent overlay
 * Components capture mouse on enter, release on leave
 */
function setupClickThrough(floatingComponents) {
    // Enable click-through by default
    window.electronAPI.setIgnoreMouseEvents(true, { forward: true });

    // Each floating component toggles click-through on hover
    floatingComponents.forEach(el => {
        el.addEventListener('mouseenter', () => {
            window.electronAPI.setIgnoreMouseEvents(false);
        });
        el.addEventListener('mouseleave', () => {
            if (!isAnyDragging) {
                window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
            }
        });
    });
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
