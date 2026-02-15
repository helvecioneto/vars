
const { ipcRenderer } = require('electron');

const stepEl = document.getElementById('onboarding-step');
const messageEl = document.getElementById('onboarding-message');
const nextBtn = document.getElementById('onboarding-next-btn');
const skipBtn = document.getElementById('onboarding-skip-btn');
const skipBtnHeader = document.getElementById('onboarding-skip-btn-header');
const tooltipEl = document.getElementById('onboarding-tooltip');
const arrowEl = document.querySelector('.onboarding-arrow');
const dontShowCheckbox = document.getElementById('dont-show-checkbox');

function getDontShowAgain() {
    return dontShowCheckbox ? dontShowCheckbox.checked : false;
}

if (dontShowCheckbox) {
    dontShowCheckbox.addEventListener('change', (e) => {
        ipcRenderer.send('set-dont-show-again', e.target.checked);
    });
}

// Handle IPC events from Main
ipcRenderer.on('update-step', (event, data) => {
    const { stepIndex, totalSteps, message, showNext, isLastStep, position } = data;

    stepEl.textContent = `Step ${stepIndex} of ${totalSteps} `;
    messageEl.textContent = message;

    if (showNext) {
        nextBtn.style.display = 'block';
        nextBtn.textContent = isLastStep ? 'Done' : 'Next';
    } else {
        nextBtn.style.display = 'none';
    }

    // Handle arrow positioning (top or bottom)
    tooltipEl.classList.remove('position-top', 'position-bottom');
    if (position === 'bottom') {
        tooltipEl.classList.add('position-bottom'); // Arrow at top
    } else {
        tooltipEl.classList.add('position-top'); // Arrow at bottom
    }
});

// UI Event Listeners
nextBtn.addEventListener('click', () => {
    ipcRenderer.send('onboarding-next');
});

const skipHandler = () => {
    ipcRenderer.send('onboarding-skip');
};

skipBtn.addEventListener('click', skipHandler);
skipBtnHeader.addEventListener('click', skipHandler);

// allow closing via escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        skipHandler();
    }
});
