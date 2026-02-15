/**
 * VARS - Onboarding Module
 * Handles new user onboarding tutorial
 * Flow: Toolbar items first → Settings tabs
 */

import { state, setOnboardingActive, setCurrentOnboardingStep, setConfig } from '../state/index.js';
import { autoSaveConfig } from '../settings/auto-save.js';
import { toggleSmartListener } from '../smart-listener/index.js';
import { toggleSettings } from '../settings/index.js';

/**
 * Onboarding Steps
 * Phase 1: Main toolbar buttons (window will expand content area to show tooltip)
 * Phase 2: Settings tabs (settings panel opens automatically)
 */
export const ONBOARDING_STEPS = [
    // === PHASE 1: Main Toolbar ===
    // Step 1: AI / Record button
    {
        id: 'rec-btn',
        targetSelector: '#rec-btn',
        message: 'Press this button or use Alt+Space to start recording. VARS will listen and generate AI answers.',
        waitForClick: false,
        showTooltip: true,
        phase: 'toolbar'
    },
    // Step 2: Text input field
    {
        id: 'input-field',
        targetSelector: '#input-field',
        message: 'Type your questions here and press Enter to get instant AI answers, no recording needed.',
        waitForClick: false,
        showTooltip: true,
        phase: 'toolbar'
    },
    // Step 3: Audio mode toggle
    {
        id: 'mode-btn',
        targetSelector: '#mode-btn',
        message: 'Switch between Computer Audio (system sound) and Microphone input. Shortcut: Alt+M.',
        waitForClick: false,
        showTooltip: true,
        phase: 'toolbar'
    },
    // Step 4: Screenshot capture
    {
        id: 'screenshot-btn',
        targetSelector: '#screenshot-btn',
        message: 'Capture your screen and ask AI to analyze it — find answers, explain code, or summarize content.',
        waitForClick: false,
        showTooltip: true,
        phase: 'toolbar'
    },
    // Step 5: Smart Listener
    {
        id: 'smart-listener',
        targetSelector: '#smart-listener-btn',
        message: 'Smart Listener detects questions in real-time and auto-generates answers. Navigate with Alt+← / Alt+→.',
        waitForClick: false,
        showTooltip: true,
        phase: 'toolbar'
    },
    // Step 6: Clickthrough
    {
        id: 'clickthrough',
        targetSelector: '#clickthrough-btn',
        message: 'Toggle Click Through mode to interact with windows behind VARS while keeping it visible. Shortcut: Alt+T.',
        waitForClick: false,
        showTooltip: true,
        phase: 'toolbar'
    },
    // === PHASE 2: Settings (click settings to open) ===
    // Step 7: Settings button (highlight, show tooltip with Next, also allow click)
    {
        id: 'settings-btn',
        targetSelector: '#settings-btn',
        message: 'Now let\'s configure VARS. Click Next to open Settings.',
        waitForClick: false,
        advanceOnTargetClick: true,
        showTooltip: true,
        phase: 'toolbar'
    },
    // Step 8: Connection type (IA tab)
    {
        id: 'connection',
        targetSelector: '.form-group:has(#connection-type)',
        message: 'Choose how to connect: OpenAI Login (free) or API Keys.',
        waitForClick: false,
        showTooltip: true,
        tab: 'ai',
        phase: 'settings'
    },
    // Step 9: Model preset (IA tab)
    {
        id: 'quality',
        targetSelector: '.form-group:has(#quality-preset)',
        message: 'Select the AI model quality preset.',
        waitForClick: false,
        showTooltip: true,
        tab: 'ai',
        phase: 'settings'
    },
    // Step 10: Transcription (IA tab)
    {
        id: 'transcription',
        targetSelector: '.form-group:has(#transcription-preset)',
        message: 'Choose transcription: Local Whisper (free, offline) or Cloud API.',
        waitForClick: false,
        showTooltip: true,
        tab: 'ai',
        phase: 'settings'
    },
    // Step 11: Language (Behavior tab)
    {
        id: 'language',
        targetSelector: '.form-group:has(#language-select)',
        message: 'Select the language for AI responses.',
        waitForClick: false,
        showTooltip: true,
        tab: 'behavior',
        phase: 'settings'
    },
    // Step 12: System prompt (Behavior tab)
    {
        id: 'system-prompt',
        targetSelector: '.form-group:has(#system-prompt)',
        message: 'Customize how the AI responds with a system prompt.',
        waitForClick: false,
        showTooltip: true,
        tab: 'behavior',
        phase: 'settings'
    },
    // Step 13: Knowledge Base (Knowledge tab)
    {
        id: 'knowledge',
        targetSelector: '.kb-toolbar',
        message: 'Add files for AI context. Click "Fit" to process them.',
        waitForClick: false,
        showTooltip: true,
        tab: 'knowledge',
        phase: 'settings'
    },
    // Step 14: Audio (Audio tab)
    {
        id: 'audio',
        targetSelector: '#tab-audio .settings-grid',
        message: 'Select microphone and system audio sources.',
        waitForClick: false,
        showTooltip: true,
        tab: 'audio',
        phase: 'settings'
    },
    // Step 15: Context Menu (Right-click)
    {
        id: 'finish',
        targetSelector: '#app-container',
        message: 'Right-click anywhere to Minimize or Quit VARS.',
        waitForClick: false,
        showTooltip: true,
        phase: 'toolbar',
        isLastStep: true
    }
];

/**
 * Check if onboarding should be shown for first-time user
 */
export function checkFirstRunOnboarding() {
    if (!state.config.hasCompletedOnboarding) {
        setTimeout(() => {
            startOnboarding();
        }, 800);
    }
}

/**
 * Start the onboarding process
 */
export function startOnboarding() {
    setOnboardingActive(true);
    setCurrentOnboardingStep(0);
    showOnboardingStep(state.currentOnboardingStep);
}

/**
 * Show a specific onboarding step
 * @param {number} stepIndex - Step index
 */
export function showOnboardingStep(stepIndex) {
    const step = ONBOARDING_STEPS[stepIndex];
    if (!step) {
        completeOnboarding();
        return;
    }

    const tooltip = document.getElementById('onboarding-tooltip');
    const stepEl = document.getElementById('onboarding-step');
    const messageEl = document.getElementById('onboarding-message');
    const nextBtn = document.getElementById('onboarding-next-btn');
    const contentArea = document.getElementById('content-area');

    // --- Phase handling ---
    if (step.phase === 'toolbar') {
        // Ensure settings panel is closed so toolbar buttons are visible
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel && settingsPanel.classList.contains('visible')) {
            toggleSettings();
        }
    } else if (step.phase === 'settings') {
        // Ensure settings panel is open and switch to correct tab
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel && !settingsPanel.classList.contains('visible')) {
            toggleSettings();
        }
        if (step.tab) {
            const tabBtn = document.querySelector(`.settings-tab[data-tab="${step.tab}"]`);
            if (tabBtn) {
                tabBtn.click();
            }
        }
    }

    // Update content - count only visible tooltip steps
    const visibleSteps = ONBOARDING_STEPS.filter(s => s.showTooltip !== false);
    const visibleIndex = visibleSteps.findIndex(s => s.id === step.id) + 1;

    // Remove previous highlight
    document.querySelectorAll('.onboarding-highlight').forEach(el => {
        el.classList.remove('onboarding-highlight');
    });

    // Small delay to let UI transitions complete
    const delay = step.phase === 'settings' ? 150 : 50;
    setTimeout(() => {
        const target = document.querySelector(step.targetSelector);
        if (target) {
            target.classList.add('onboarding-highlight');
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            // Auto-download Whisper Base model on Transcription Step
            if (step.id === 'transcription') {
                if (window.electronAPI?.whisper) {
                    window.electronAPI.whisper.getModelsStatus().then(status => {
                        const baseModel = status.models?.find(m => m.name === 'base');
                        if (baseModel && !baseModel.downloaded) {
                            console.log('[Onboarding] Auto-downloading Whisper Base model...');
                            window.electronAPI.whisper.downloadModel('base');
                        }
                    }).catch(err => console.error('[Onboarding] Failed to check whisper status:', err));
                }
            }

            // Auto-enable Smart Listener on Step 5
            if (step.id === 'smart-listener') {
                if (!state.smartListenerEnabled) {
                    console.log('[Onboarding] Auto-enabling Smart Listener...');
                    toggleSmartListener();
                }
            }

            // Add click listener for waitForClick steps or explicit advanceOnTargetClick
            if (step.waitForClick || step.advanceOnTargetClick) {
                const clickHandler = () => {
                    target.removeEventListener('click', clickHandler);

                    // Special handling for Settings button (Step 7)
                    // The button toggles the panel. We need to ensure it ends up OPEN for Step 8.
                    if (step.id === 'settings-btn') {
                        // Allow the toggle animation to start (native listener runs first)
                        setTimeout(() => {
                            const settingsPanel = document.getElementById('settings-panel');
                            // If panel is closed (because user clicked button and it toggled off, or it was off), open it.
                            // Actually, if it was closed, clicking opens it. If it was open, clicking closes it.
                            // We want it OPEN.
                            if (settingsPanel && !settingsPanel.classList.contains('visible')) {
                                toggleSettings(); // Re-open if it closed
                            }
                            nextOnboardingStep();
                        }, 300);
                    } else {
                        setTimeout(() => nextOnboardingStep(), 300);
                    }
                };
                target.addEventListener('click', clickHandler);
            }

            // Calculate absolute bounds
            const rect = target.getBoundingClientRect();
            // Get window position to calculate absolute screen coordinates
            // Since we can't easily get window position synchronously in renderer without IPC (and we want to avoid extra round trips),
            // we will send the client coordinates and let Main (which knows window position) calculate the rest?
            // actually Main knows window position. But client coordinates are relative to the webview.

            // Wait, we need to send screen coordinates. 
            // In a framed window, client (0,0) is not screen (0,0).
            // But checking main/index.js: `useContentSize: true` and `frame: false`.
            // So for a frameless window, the webview covers the whole window (usually).
            // However, `getPosition` in main returns the window position.
            // So: ScreenX = WindowX + RectX. ScreenY = WindowY + RectY.
            // We can send RectX, RectY, Width, Height to Main, and Main adds WindowX, WindowY.

            // But we need to use `ipcRenderer.send` with data.
            if (step.showTooltip !== false) {
                window.electronAPI.showOnboarding({
                    x: rect.x, // Relative to window content area
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    stepIndex: visibleIndex,
                    totalSteps: visibleSteps.length,
                    message: step.message,
                    showNext: !step.waitForClick,
                    isLastStep: step.isLastStep,
                    position: (rect.top + rect.height / 2) < (window.innerHeight / 2) ? 'bottom' : 'top'
                });
            } else {
                window.electronAPI.hideOnboarding();
            }

        } else {
            // Target not found? skip or hide?
            window.electronAPI.hideOnboarding();
        }
    }, delay);
}

/**
 * Move to next onboarding step
 */
export function nextOnboardingStep() {
    setCurrentOnboardingStep(state.currentOnboardingStep + 1);
    showOnboardingStep(state.currentOnboardingStep);
}

/**
 * Complete onboarding
 */
/**
 * Complete onboarding
 * @param {boolean} dontShowAgain - If true, mark as permanently completed
 */
export function completeOnboarding(dontShowAgain = false) {
    setOnboardingActive(false);
    window.electronAPI.hideOnboarding();

    document.querySelectorAll('.onboarding-highlight').forEach(el => {
        el.classList.remove('onboarding-highlight');
    });

    // Mark as completed in config ONLY if user checked "Don't show again"
    console.log('[Onboarding] Completing. dontShowAgain:', dontShowAgain);
    if (dontShowAgain) {
        state.config.hasCompletedOnboarding = true;
        console.log('[Onboarding] Setting hasCompletedOnboarding = true');
        autoSaveConfig().then(() => {
            console.log('[Onboarding] Config saved.');
        });
    }
}

/**
 * Skip onboarding
 * @param {boolean} dontShowAgain - If true, mark as permanently completed
 */
export function skipOnboarding(dontShowAgain = false) {
    completeOnboarding(dontShowAgain);
}

// Initial setup for listeners
if (window.electronAPI) {
    window.electronAPI.onOnboardingNext(() => {
        nextOnboardingStep();
    });

    window.electronAPI.onOnboardingComplete((data) => {
        const dontShowAgain = data ? data.dontShowAgain : false;
        completeOnboarding(dontShowAgain);
    });

    window.electronAPI.onOnboardingSkip((data) => {
        const dontShowAgain = data ? data.dontShowAgain : false;
        skipOnboarding(dontShowAgain);
    });
}

