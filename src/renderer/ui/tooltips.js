/**
 * VARS - Tooltips Module
 * Custom tooltip system for screen sharing protection
 */

import { state, INPUT_MODES } from '../state/index.js';
import { elements } from './elements.js';

/**
 * Updates button tooltips with OS-appropriate keyboard shortcuts
 * Uses custom data-tooltip attribute instead of native title
 * The custom tooltip is rendered inside the protected window,
 * making it invisible to screen sharing while visible to the user
 * 
 * macOS uses ⌥ (Option) for shortcuts
 * Windows/Linux uses Ctrl for shortcuts
 */
export function updateButtonTooltips() {
    const isMac = window.electronAPI.platform === 'darwin';
    // Shortcuts: macOS uses Option (⌥), others use Ctrl
    const mod = isMac ? '⌥' : 'Ctrl';

    // Record button (global shortcut)
    if (elements.recBtn) {
        elements.recBtn.setAttribute('data-tooltip', `${mod}+Space: Record`);
        elements.recBtn.removeAttribute('title');
    }

    // Mode switch button (handled by updateInputModeUI for dynamic text)

    // History button (uses same modifier as other shortcuts)
    if (elements.historyBtn) {
        elements.historyBtn.setAttribute('data-tooltip', `${mod}+↑/↓: History`);
        elements.historyBtn.removeAttribute('title');
    }

    // Screenshot button
    if (elements.screenshotBtn) {
        elements.screenshotBtn.setAttribute('data-tooltip', `${mod}+Shift+S: Capture Screen`);
        elements.screenshotBtn.removeAttribute('title');
    }

    // Settings button
    if (elements.settingsBtn) {
        elements.settingsBtn.setAttribute('data-tooltip', 'Settings');
        elements.settingsBtn.removeAttribute('title');
    }

    // Drag button
    if (elements.dragBtn) {
        elements.dragBtn.setAttribute('data-tooltip', 'Move / Right-click: Menu');
        elements.dragBtn.removeAttribute('title');
    }

    // Mode button
    if (elements.modeBtn) {
        const modeConfig = INPUT_MODES[state.currentInputMode];
        if (modeConfig) {
            elements.modeBtn.setAttribute('data-tooltip', `${mod}+M: ${modeConfig.text}`);
            elements.modeBtn.removeAttribute('title');
        }
    }

    // Knowledge Base buttons (in settings)
    const addFileBtn = document.getElementById('add-file-btn');
    if (addFileBtn) {
        addFileBtn.setAttribute('data-tooltip', 'Add Files');
        addFileBtn.removeAttribute('title');
    }

    const trainBtn = document.getElementById('train-btn');
    if (trainBtn) {
        trainBtn.setAttribute('data-tooltip', 'Train KB');
        trainBtn.removeAttribute('title');
    }

    const resetKbBtn = document.getElementById('reset-kb-btn');
    if (resetKbBtn) {
        resetKbBtn.setAttribute('data-tooltip', 'Clear KB');
        resetKbBtn.removeAttribute('title');
    }

    // Visibility toggle button
    const visibilityToggle = document.getElementById('visibility-toggle');
    if (visibilityToggle) {
        const tooltipText = state.isVisibleMode
            ? 'App is VISIBLE (click to hide)'
            : 'App is HIDDEN (click to show)';
        visibilityToggle.setAttribute('data-tooltip', tooltipText);
        visibilityToggle.removeAttribute('title');
    }

    // Remove all native title attributes to prevent system tooltips
    removeAllNativeTitles();
}

/**
 * Remove all native title attributes to ensure system tooltips don't appear
 */
export function removeAllNativeTitles() {
    const elementsWithTitles = document.querySelectorAll('[title]');
    elementsWithTitles.forEach(el => {
        // Convert title to data-tooltip if not already set
        if (!el.hasAttribute('data-tooltip') && el.title) {
            el.setAttribute('data-tooltip', el.title);
        }
        el.removeAttribute('title');
    });
}

/**
 * Initialize custom tooltip system
 * Shows tooltips on hover that are rendered inside the protected window
 */
export function initCustomTooltips() {
    const tooltip = document.getElementById('custom-tooltip');
    if (!tooltip) return;

    let hideTimeout = null;
    let showTimeout = null;

    // Show tooltip on mouseenter for elements with data-tooltip
    document.addEventListener('mouseenter', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;

        const text = target.getAttribute('data-tooltip');
        if (!text) return;

        // Clear any pending hide/show
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
        if (showTimeout) {
            clearTimeout(showTimeout);
            showTimeout = null;
        }

        // Set text first to calculate size
        tooltip.textContent = text;
        tooltip.classList.remove('visible');

        // Use setTimeout to allow browser to calculate tooltip dimensions
        showTimeout = setTimeout(() => {
            // Position tooltip smartly within viewport
            const rect = target.getBoundingClientRect();
            const tooltipWidth = tooltip.offsetWidth || 100;
            const tooltipHeight = tooltip.offsetHeight || 24;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const padding = 8; // Minimum padding from edges

            let top, left;
            let transformX = '-50%';

            // Calculate horizontal center position
            left = rect.left + (rect.width / 2);

            // Check if centered tooltip would overflow horizontally
            const halfWidth = tooltipWidth / 2;
            if (left - halfWidth < padding) {
                // Too far left, align to left edge
                left = padding;
                transformX = '0';
            } else if (left + halfWidth > viewportWidth - padding) {
                // Too far right, align to right edge
                left = viewportWidth - padding;
                transformX = '-100%';
            }

            // Prefer showing above the element
            top = rect.top - tooltipHeight - 8;

            // If would go above viewport, show below
            if (top < padding) {
                top = rect.bottom + 8;
            }

            // If would go below viewport, show beside the element
            if (top + tooltipHeight > viewportHeight - padding) {
                // Show to the right or left of the element
                top = Math.max(padding, Math.min(rect.top, viewportHeight - tooltipHeight - padding));

                // Prefer right side
                if (rect.right + tooltipWidth + padding < viewportWidth) {
                    left = rect.right + 8;
                    transformX = '0';
                } else {
                    // Show on left side
                    left = rect.left - 8;
                    transformX = '-100%';
                }
            }

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            tooltip.style.transform = `translateX(${transformX})`;

            tooltip.classList.add('visible');
        }, 300);

    }, true);

    // Hide tooltip on mouseleave
    document.addEventListener('mouseleave', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;

        if (showTimeout) {
            clearTimeout(showTimeout);
            showTimeout = null;
        }

        hideTimeout = setTimeout(() => {
            tooltip.classList.remove('visible');
        }, 100);
    }, true);

    // Also hide on scroll or window resize
    window.addEventListener('scroll', () => {
        if (showTimeout) clearTimeout(showTimeout);
        tooltip.classList.remove('visible');
    }, true);

    window.addEventListener('resize', () => {
        if (showTimeout) clearTimeout(showTimeout);
        tooltip.classList.remove('visible');
    });
}
