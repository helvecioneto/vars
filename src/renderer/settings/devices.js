/**
 * VARS - Device Enumeration Module
 * Handles audio device listing and selection
 */

import { state } from '../state/index.js';
import { elements } from '../ui/elements.js';

/**
 * Populate microphone device list
 */
export async function populateDevices() {
    try {
        // Note: Modern browsers allow enumerateDevices() without prior getUserMedia
        // Permission will be requested when actually starting recording
        const devices = await navigator.mediaDevices.enumerateDevices();

        const audioInputs = devices.filter(d => d.kind === 'audioinput');

        // Populate input devices
        if (elements.inputDeviceSelect) {
            elements.inputDeviceSelect.innerHTML = '<option value="default">Default</option>';
            audioInputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Microphone ${device.deviceId.slice(0, 8)}`;
                elements.inputDeviceSelect.appendChild(option);
            });

            if (state.config.inputDeviceId) {
                elements.inputDeviceSelect.value = state.config.inputDeviceId;
            }
        }

    } catch (error) {
        console.error('Failed to enumerate devices:', error);
    }
}

/**
 * Populate system audio device list
 */
export async function populateSystemAudioDevices() {
    if (!elements.systemAudioDeviceSelect) return;

    elements.systemAudioDeviceSelect.innerHTML = '<option value="">Loading...</option>';

    const platform = window.electronAPI.platform;

    try {
        let devices = [];

        if (platform === 'linux') {
            // Linux: Use PulseAudio/PipeWire API
            const result = await window.electronAPI.systemAudio.listDevices();

            if (result.error) {
                console.error('[Settings] Error from system audio API:', result.error);
                elements.systemAudioDeviceSelect.innerHTML = '<option value="">Error: ' + result.error + '</option>';
                return;
            }

            devices = result.devices || [];

            // Filter to monitors only for Linux
            devices = devices.filter(d => d.isMonitor);

        } else {
            // macOS/Windows: Use desktopCapturer to list screen sources
            const sources = await window.electronAPI.getDesktopSources();

            if (sources && sources.length > 0) {
                // Create virtual device entries for screen sources
                devices = sources
                    .filter(s => s.id.startsWith('screen:'))
                    .map(s => ({
                        id: s.id,
                        name: s.id,
                        displayName: s.name + ' (System Audio)',
                        isMonitor: true
                    }));
            }
        }

        elements.systemAudioDeviceSelect.innerHTML = '';

        if (devices.length === 0) {
            const noDeviceMsg = platform === 'linux'
                ? 'No monitor devices found - is PulseAudio running?'
                : 'No screen sources found';
            elements.systemAudioDeviceSelect.innerHTML = '<option value="">' + noDeviceMsg + '</option>';
            return;
        }

        // Add a default option
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- Select a source --';
        elements.systemAudioDeviceSelect.appendChild(defaultOpt);

        // Add devices/sources
        const optgroup = document.createElement('optgroup');
        optgroup.label = platform === 'linux' ? '🔊 System Audio (Monitors)' : '🖥️ Screen Audio Sources';

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.name;
            option.textContent = device.displayName;
            optgroup.appendChild(option);
        });
        elements.systemAudioDeviceSelect.appendChild(optgroup);

        // Restore saved selection
        if (state.config.systemAudioDeviceId) {
            elements.systemAudioDeviceSelect.value = state.config.systemAudioDeviceId;
        }

        // Update hint
        const hintEl = document.getElementById('audio-hint');
        if (hintEl) {
            if (devices.length > 0) {
                const sourceType = platform === 'linux' ? 'monitor device(s)' : 'screen source(s)';
                hintEl.innerHTML = `
                    <strong>Microphone:</strong> Used in Microphone mode.<br>
                    <strong>System Audio:</strong> ✅ ${devices.length} ${sourceType} found. Select one to capture system audio.
                `;
            } else {
                const helpMsg = platform === 'linux'
                    ? 'Make sure PulseAudio/PipeWire is running.'
                    : 'Grant screen recording permission in System Preferences.';
                hintEl.innerHTML = `
                    <strong>Microphone:</strong> Used in Microphone mode.<br>
                    <strong>System Audio:</strong> ⚠️ No sources found. ${helpMsg}
                `;
            }
        }

    } catch (error) {
        console.error('[Settings] Failed to enumerate devices:', error);
        elements.systemAudioDeviceSelect.innerHTML = '<option value="">Error - click refresh</option>';
    }
}
