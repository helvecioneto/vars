/**
 * VARS - Update Manager
 * Handles checking for updates and displaying notifications
 */

import { elements } from '../ui/elements.js';

export function initUpdates() {
    if (!elements.checkUpdateBtn) return;

    // Manual check button
    elements.checkUpdateBtn.addEventListener('click', async () => {
        const btn = elements.checkUpdateBtn;
        const originalText = btn.textContent;

        btn.textContent = 'Checking...';
        btn.disabled = true;

        try {
            await checkForUpdates(true);
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });

    // View update button
    if (elements.updateBtn) {
        elements.updateBtn.addEventListener('click', () => {
            // The URL is stored in the button's dataset or we can just use the latest release URL
            // For now, let's use the standard releases page if we don't have a specific one, 
            // but `checkForUpdates` should fetch the specific one.
            const url = elements.updateBtn.dataset.url || 'https://github.com/helvecioneto/vars/releases';
            window.electronAPI.openExternal(url);
        });
    }

    // Auto-check on startup (silent)
    checkForUpdates(false);
}

/**
 * Check for updates
 * @param {boolean} showNoUpdateMessage - Whether to show a message if no update is found (manual check)
 */
async function checkForUpdates(showNoUpdateMessage = false) {
    try {
        const result = await window.electronAPI.checkForUpdates();

        if (result.error) {
            console.error('Update check failed:', result.error);
            if (showNoUpdateMessage && elements.updateMessage) {
                elements.updateSection.classList.remove('hidden');
                elements.updateMessage.textContent = 'Error checking for updates.';
                elements.updateMessage.style.color = 'var(--error)';
                elements.updateBtn.classList.add('hidden');
            }
            return;
        }

        if (result.updateAvailable) {
            // Update available!
            if (elements.updateSection) {
                elements.updateSection.classList.remove('hidden');
                elements.updateMessage.textContent = `New version ${result.latestVersion} available!`;
                elements.updateMessage.style.color = 'var(--accent-light)';

                elements.updateBtn.classList.remove('hidden');
                elements.updateBtn.dataset.url = result.releaseUrl;
            }

            // Note: We could also show a toast notification here if we had a toast system
        } else {
            // No update
            if (showNoUpdateMessage && elements.updateSection) {
                elements.updateSection.classList.remove('hidden');
                elements.updateMessage.textContent = 'You are on the latest version.';
                elements.updateMessage.style.color = 'var(--success)';
                elements.updateBtn.classList.add('hidden');
            } else {
                // Hide section if silent check and no update
                // But only if we are sure user didn't leave it open from a previous manual check?
                // Actually, if it's a silent check (startup), we probably want to keep it hidden if no update.
                if (!showNoUpdateMessage && elements.updateSection) {
                    elements.updateSection.classList.add('hidden');
                }
            }
        }

    } catch (error) {
        console.error('Error in checkForUpdates:', error);
    }
}
