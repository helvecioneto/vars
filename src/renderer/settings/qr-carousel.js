/**
 * VARS - QR Code Carousel Module
 * Handles donation QR code carousel in settings
 */

import { state, setQRCodeInterval, setCurrentQRIndex, QR_CODES } from '../state/index.js';

/**
 * Start the QR code carousel - alternates between PayPal and Pix every 5 seconds
 */
export function startQRCodeCarousel() {
    // Clear any existing interval
    stopQRCodeCarousel();

    // Reset to first QR code
    setCurrentQRIndex(0);
    updateQRCodeDisplay();

    // Setup navigation buttons
    setupQRNavButtons();

    // Start the interval
    const interval = setInterval(() => {
        setCurrentQRIndex((state.currentQRIndex + 1) % QR_CODES.length);
        updateQRCodeDisplay();
    }, 5000);
    setQRCodeInterval(interval);
}

/**
 * Stop the QR code carousel
 */
export function stopQRCodeCarousel() {
    if (state.qrCodeInterval) {
        clearInterval(state.qrCodeInterval);
        setQRCodeInterval(null);
    }
}

/**
 * Setup navigation buttons for QR code carousel
 */
export function setupQRNavButtons() {
    const prevBtn = document.getElementById('qr-prev-btn');
    const nextBtn = document.getElementById('qr-next-btn');

    if (prevBtn) {
        prevBtn.onclick = () => navigateQRCode(-1);
    }
    if (nextBtn) {
        nextBtn.onclick = () => navigateQRCode(1);
    }
}

/**
 * Navigate QR code carousel manually
 * @param {number} direction - -1 for previous, 1 for next
 */
export function navigateQRCode(direction) {
    // Stop auto-carousel temporarily
    stopQRCodeCarousel();

    // Update index
    setCurrentQRIndex((state.currentQRIndex + direction + QR_CODES.length) % QR_CODES.length);
    updateQRCodeDisplay();

    // Restart carousel after 10 seconds of inactivity
    const interval = setInterval(() => {
        setCurrentQRIndex((state.currentQRIndex + 1) % QR_CODES.length);
        updateQRCodeDisplay();
    }, 5000);
    setQRCodeInterval(interval);
}

/**
 * Update the QR code display based on current index
 */
export function updateQRCodeDisplay() {
    const qrPaypal = document.getElementById('qr-paypal');
    const qrPix = document.getElementById('qr-pix');
    const qrLabel = document.getElementById('qr-label');
    const indicatorPaypal = document.getElementById('indicator-paypal');
    const indicatorPix = document.getElementById('indicator-pix');
    const donationMessage = document.getElementById('donation-message');

    if (!qrPaypal || !qrPix || !qrLabel) return;

    const current = QR_CODES[state.currentQRIndex];

    // Update QR code visibility
    if (current.id === 'paypal') {
        qrPaypal.classList.remove('hidden');
        qrPaypal.classList.add('visible');
        qrPix.classList.add('hidden');
        qrPix.classList.remove('visible');
        indicatorPaypal?.classList.add('active');
        indicatorPix?.classList.remove('active');
        if (donationMessage) {
            donationMessage.textContent = '💜 Support this project with a donation!';
        }
    } else {
        qrPix.classList.remove('hidden');
        qrPix.classList.add('visible');
        qrPaypal.classList.add('hidden');
        qrPaypal.classList.remove('visible');
        indicatorPix?.classList.add('active');
        indicatorPaypal?.classList.remove('active');
        if (donationMessage) {
            donationMessage.textContent = '💚 Apoie este projeto com uma doação via Pix!';
        }
    }

    // Update label
    qrLabel.textContent = current.label;
}
