const WebSocket = require('ws');
const { getModels, getPrompts, getSpecialModel } = require('../../config');

class RealtimeTranscription {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.ws = null;
        this.isConnected = false;
        this.transcriptionCallback = null;
        this.errorCallback = null;
        this.fullTranscript = '';
    }

    async connect() {
        return new Promise((resolve, reject) => {
            const prompts = getPrompts();
            // Use realtime model from provider config
            const realtimeModel = getSpecialModel('openai', 'realtime') || 'gpt-4o-transcribe';
            const url = `wss://api.openai.com/v1/realtime?model=${realtimeModel}`;

            this.ws = new WebSocket(url, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'OpenAI-Beta': 'realtime=v1'
                }
            });

            this.ws.on('open', () => {
                console.log('Realtime API connected');
                this.isConnected = true;

                // Configure TRANSCRIPTION session (different from conversation session!)
                // Using the correct structure from the documentation
                const transcriptionLanguage = prompts.realtime.transcriptionLanguage;
                this.ws.send(JSON.stringify({
                    type: 'session.update',
                    session: {
                        type: 'transcription',
                        audio: {
                            input: {
                                format: {
                                    type: 'audio/pcm',
                                    rate: 24000
                                },
                                transcription: {
                                    model: realtimeModel,
                                    language: transcriptionLanguage
                                },
                                turn_detection: {
                                    type: 'server_vad',
                                    threshold: 0.5,
                                    prefix_padding_ms: 300,
                                    silence_duration_ms: 500
                                }
                            }
                        }
                    }
                }));

                resolve();
            });

            this.ws.on('message', (data) => {
                try {
                    const event = JSON.parse(data.toString());
                    this.handleEvent(event);
                } catch (error) {
                    console.error('Failed to parse realtime event:', error);
                }
            });

            this.ws.on('error', (error) => {
                console.error('Realtime API WebSocket error:', error);
                this.isConnected = false;
                if (this.errorCallback) {
                    this.errorCallback(error);
                }
                reject(error);
            });

            this.ws.on('close', () => {
                console.log('Realtime API disconnected');
                this.isConnected = false;
            });
        });
    }

    handleEvent(event) {
        console.log('Realtime event:', event.type);

        switch (event.type) {
            // Transcription delta - incremental text
            case 'conversation.item.input_audio_transcription.delta':
                console.log('Transcription delta:', event.delta);
                if (event.delta) {
                    this.fullTranscript += event.delta;
                    if (this.transcriptionCallback) {
                        this.transcriptionCallback(this.fullTranscript, false);
                    }
                }
                break;

            // Transcription completed
            case 'conversation.item.input_audio_transcription.completed':
                console.log('Transcription completed:', event.transcript);
                if (event.transcript) {
                    // For whisper-1, delta contains full transcript
                    // For gpt-4o-transcribe, this is the final
                    this.fullTranscript = event.transcript;
                    if (this.transcriptionCallback) {
                        this.transcriptionCallback(this.fullTranscript, true);
                    }
                }
                break;

            // VAD events
            case 'input_audio_buffer.speech_started':
                console.log('>>> Speech detected');
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log('<<< Speech ended');
                break;

            case 'input_audio_buffer.committed':
                console.log('Audio buffer committed, item_id:', event.item_id);
                break;

            case 'error':
                console.error('Realtime API error:', event.error);
                if (this.errorCallback) {
                    this.errorCallback(new Error(event.error?.message || 'Unknown error'));
                }
                break;

            case 'session.created':
                console.log('Session created:', event.session?.type || 'conversation');
                break;

            case 'session.updated':
                console.log('Session updated to type:', event.session?.type);
                break;

            default:
                console.log('Other event:', event.type);
        }
    }

    sendAudio(audioBuffer) {
        if (!this.isConnected || !this.ws) {
            return;
        }

        const base64Audio = Buffer.from(audioBuffer).toString('base64');

        this.ws.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64Audio
        }));
    }

    commitAudio() {
        if (!this.isConnected || !this.ws) {
            return;
        }

        this.ws.send(JSON.stringify({
            type: 'input_audio_buffer.commit'
        }));
    }

    clearAudio() {
        if (!this.isConnected || !this.ws) {
            return;
        }

        this.fullTranscript = '';

        this.ws.send(JSON.stringify({
            type: 'input_audio_buffer.clear'
        }));
    }

    onTranscription(callback) {
        this.transcriptionCallback = callback;
    }

    onError(callback) {
        this.errorCallback = callback;
    }

    getFullTranscript() {
        return this.fullTranscript.trim();
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.isConnected = false;
        }
    }
}

module.exports = { RealtimeTranscription };
