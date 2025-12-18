# Hearing Agent

AI assistant that listens to calls and provides knowledge-based answers, invisible to screen sharing.

## Features

- 🎧 **Audio Capture**: Capture system audio from calls using CTRL+Space hotkey
- 📝 **Real-time Transcription**: Transcribe audio using OpenAI Whisper API
- 🤖 **AI-Powered Responses**: Get intelligent answers based on your knowledge base
- 👻 **Invisible to Screen Sharing**: Window is protected from screen capture (macOS/Windows)
- ⚙️ **Configurable**: Set API key, model, system prompt, and knowledge base files

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

### Hotkeys

- **CTRL + Space**: Start/Stop audio recording

### Configuration

1. Click the ⚙️ settings button
2. Enter your OpenAI API key
3. Select the GPT model
4. Customize the system prompt
5. Add knowledge base files (txt, md, json)
6. Save settings

## Requirements

- Node.js 18+
- OpenAI API key
- macOS 10.15+ / Windows 10+ / Linux (note: screen protection doesn't work on Linux)

## Development

```bash
npm run dev
```

## License

MIT
