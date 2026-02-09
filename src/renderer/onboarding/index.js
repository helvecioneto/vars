/**
 * VARS - Onboarding Module
 * Handles new user onboarding tutorial
 */

import { state, setOnboardingActive, setCurrentOnboardingStep, setConfig } from '../state/index.js';
import { autoSaveConfig } from '../settings/auto-save.js';

/**
 * Onboarding Steps - Simplified flow with auto-tab-switching
 * Step 0: Click Settings to open
 * Steps 1-7: Guide through all settings with automatic tab navigation
 */
export const ONBOARDING_STEPS = [
    // Step 0: Settings button (just highlight, no tooltip)
    {
        id: 'settings-btn',
        targetSelector: '#settings-btn',
        message: '',
        waitForClick: true,
        showTooltip: false,
        tab: null
    },
    // Step 1: Connection type (IA tab)
    {
        id: 'connection',
        targetSelector: '.form-group:has(#connection-type)',
        message: 'Choose how to connect: OpenAI Login (free) or API Keys.',
        waitForClick: false,
        showTooltip: true,
        tab: 'ai'
    },
    // Step 2: Model preset (IA tab)
    {
        id: 'quality',
        targetSelector: '.form-group:has(#quality-preset)',
        message: 'Select the AI model.',
        waitForClick: false,
        showTooltip: true,
        tab: 'ai'
    },
    // Step 3: Transcription (IA tab)
    {
        id: 'transcription',
        targetSelector: '.form-group:has(#transcription-preset)',
        message: 'Choose transcription: Local Whisper (free) or Cloud API.',
        waitForClick: false,
        showTooltip: true,
        tab: 'ai'
    },
    // Step 4: Language (Behavior tab - auto switches)
    {
        id: 'language',
        targetSelector: '.form-group:has(#language-select)',
        message: 'Select your language.',
        waitForClick: false,
        showTooltip: true,
        tab: 'behavior'
    },
    // Step 5: System prompt (Behavior tab)
    {
        id: 'system-prompt',
        targetSelector: '.form-group:has(#system-prompt)',
        message: 'Customize how the AI responds.',
        waitForClick: false,
        showTooltip: true,
        tab: 'behavior'
    },
    // Step 6: Knowledge Base (Knowledge tab - target toolbar buttons)
    {
        id: 'knowledge',
        targetSelector: '.kb-toolbar',
        message: 'Add files for AI context. Click "Fit" to process.',
        waitForClick: false,
        showTooltip: true,
        tab: 'knowledge'
    },
    // Step 7: Audio (Audio tab - target settings grid)
    {
        id: 'audio',
        targetSelector: '#tab-audio .settings-grid',
        message: 'Select microphone and system audio sources.',
        waitForClick: false,
        showTooltip: true,
        tab: 'audio',
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

    // Auto-switch to correct tab if specified
    if (step.tab) {
        const tabBtn = document.querySelector(`.settings-tab[data-tab="${step.tab}"]`);
        if (tabBtn) {
            tabBtn.click();
        }
    }

    // Update content - count only visible steps (exclude step 0)
    const visibleSteps = ONBOARDING_STEPS.filter(s => s.showTooltip !== false);
    const visibleIndex = visibleSteps.findIndex(s => s.id === step.id) + 1;

    if (step.showTooltip !== false) {
        stepEl.textContent = `Step ${visibleIndex} of ${visibleSteps.length}`;
        messageEl.textContent = step.message;
    }

    // Show/hide Next button
    if (step.waitForClick) {
        nextBtn.style.display = 'none';
    } else {
        nextBtn.style.display = '';
        nextBtn.textContent = step.isLastStep ? 'Done' : 'Next';
    }

    // Remove previous highlight
    document.querySelectorAll('.onboarding-highlight').forEach(el => {
        el.classList.remove('onboarding-highlight');
    });

    // Small delay to let tab switch complete
    setTimeout(() => {
        const target = document.querySelector(step.targetSelector);
        if (target) {
            target.classList.add('onboarding-highlight');
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            // Position tooltip opposite to target (never overlap)
            positionTooltipOpposite(tooltip, target);

            // Add click listener for waitForClick steps
            if (step.waitForClick) {
                const clickHandler = () => {
                    target.removeEventListener('click', clickHandler);
                    setTimeout(() => nextOnboardingStep(), 300);
                };
                target.addEventListener('click', clickHandler);
            }
        }

        // Show/hide tooltip
        if (step.showTooltip === false) {
            tooltip.classList.add('hidden');
        } else {
            tooltip.classList.remove('hidden');
        }
    }, step.tab ? 150 : 0);
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
export function completeOnboarding() {
    setOnboardingActive(false);

    const tooltip = document.getElementById('onboarding-tooltip');
    tooltip.classList.add('hidden');

    document.querySelectorAll('.onboarding-highlight').forEach(el => {
        el.classList.remove('onboarding-highlight');
    });

    // Mark as completed in config
    state.config.hasCompletedOnboarding = true;
    autoSaveConfig();
}

/**
 * Skip onboarding
 */
export function skipOnboarding() {
    completeOnboarding();
}

/**
 * Position tooltip opposite to target element
 * If target is in upper half of screen -> tooltip at bottom
 * If target is in lower half of screen -> tooltip at top
 */
export function positionTooltipOpposite(tooltip, target) {
    const targetRect = target.getBoundingClientRect();
    const windowHeight = window.innerHeight;
    const targetCenter = targetRect.top + targetRect.height / 2;

    // Reset position classes
    tooltip.classList.remove('position-top', 'position-bottom');

    if (targetCenter < windowHeight / 2) {
        // Target is in upper half -> put tooltip at bottom
        tooltip.classList.add('position-bottom');
        tooltip.style.top = 'auto';
        tooltip.style.bottom = '10px';
    } else {
        // Target is in lower half -> put tooltip at top
        tooltip.classList.add('position-top');
        tooltip.style.bottom = 'auto';
        tooltip.style.top = '50px';
    }
}
