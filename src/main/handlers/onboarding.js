const { ipcMain, screen } = require('electron');
const { saveConfig } = require('../config');

function setupOnboardingHandlers(context) {
    const { getOnboardingWindow, getMainWindow, getConfig, setConfig } = context;

    // Handle "Don't show again" checkbox toggle
    ipcMain.on('set-dont-show-again', (event, value) => {
        console.log('[Onboarding] Setting hasCompletedOnboarding:', value);
        const config = getConfig();
        if (config.hasCompletedOnboarding !== value) {
            config.hasCompletedOnboarding = value;
            setConfig(config);
            // Save immediately to persist choice
            saveConfig(config).catch(err => console.error('[Onboarding] Failed to save config:', err));
        }
    });

    // Show and position the onboarding tooltip
    ipcMain.on('show-onboarding-tooltip', (event, data) => {
        const onboardingWindow = getOnboardingWindow();
        const mainWindow = getMainWindow();
        if (!onboardingWindow || onboardingWindow.isDestroyed()) return;
        if (!mainWindow || mainWindow.isDestroyed()) return;

        const { x, y, width, height, stepIndex, totalSteps, message, showNext, isLastStep, position } = data;
        const mainBounds = mainWindow.getContentBounds(); // Use content bounds to match renderer coordinates

        // Update content first
        onboardingWindow.webContents.send('update-step', {
            stepIndex,
            totalSteps,
            message,
            showNext,
            isLastStep,
            position // 'top' or 'bottom'
        });

        // Resize window based on content? 
        // For now, we use fixed size defined in index.js or let CSS handle it
        // and rely on 'useContentSize: true' in BrowserWindow creation.
        // We might need to adjust size if message is long.

        // Position window
        // The x, y received should be the absolute coordinates of the TARGET element
        // We need to calculate where to put the tooltip window relative to that.

        const tooltipWidth = 300; // Match width in index.js/CSS
        const tooltipHeight = 180; // Approximate height, or send strictly from renderer if dynamic
        const padding = 20; // Increased padding to prevent overlap

        // Calculate absolute coordinates
        // data.x/y are relative to the webview content
        // mainBounds.x/y are the screen coordinates of the content area
        let tooltipX = Math.round(mainBounds.x + x + (width / 2) - (tooltipWidth / 2));
        let tooltipY;

        if (position === 'bottom') {
            // Tooltip BELOW the target
            tooltipY = Math.round(mainBounds.y + y + height + padding);
        } else {
            // Tooltip ABOVE the target (position === 'top')
            tooltipY = Math.round(mainBounds.y + y - tooltipHeight - padding);
        }

        // Ensure within screen bounds
        const display = screen.getDisplayNearestPoint({ x: tooltipX, y: tooltipY });
        const bounds = display.bounds;

        // Horizontal clamp
        if (tooltipX < bounds.x + 10) tooltipX = bounds.x + 10;
        if (tooltipX + tooltipWidth > bounds.x + bounds.width - 10) tooltipX = bounds.x + bounds.width - tooltipWidth - 10;

        onboardingWindow.setPosition(tooltipX, tooltipY);

        if (!onboardingWindow.isVisible()) {
            onboardingWindow.showInactive(); // Show without stealing focus
        }
    });

    // Hide the tooltip
    ipcMain.on('hide-onboarding-tooltip', () => {
        const onboardingWindow = getOnboardingWindow();
        if (onboardingWindow && !onboardingWindow.isDestroyed()) {
            onboardingWindow.hide();
        }
    });

    // Handle "Next" click from onboarding window -> forward to Main Window to advance state
    ipcMain.on('onboarding-next', () => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('onboarding-next-step');
        }
    });

    // Handle "Complete" (Done button)
    ipcMain.on('onboarding-complete', (event, data) => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('onboarding-complete', data);
        }

        const onboardingWindow = getOnboardingWindow();
        if (onboardingWindow && !onboardingWindow.isDestroyed()) {
            onboardingWindow.hide();
        }
    });

    // Handle "Skip" click -> forward to Main Window
    ipcMain.on('onboarding-skip', (event, data) => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('onboarding-skip-tutorial', data);
        }

        const onboardingWindow = getOnboardingWindow();
        if (onboardingWindow && !onboardingWindow.isDestroyed()) {
            onboardingWindow.hide();
        }
    });
}

module.exports = { setupOnboardingHandlers };
