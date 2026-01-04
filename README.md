<div align="center">

<img src="docs/img/icon-readme.png" alt="VARS Logo" width="100" height="100">

# VARS (Virtual Agent for Real-time Support)

[![GitHub release](https://img.shields.io/github/v/release/helvecioneto/vars?style=flat-square)](https://github.com/helvecioneto/vars/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](https://www.gnu.org/licenses/gpl-3.0)
[![Electron](https://img.shields.io/badge/Electron-28.0-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-❤️-ea4aaa?style=flat-square)](https://github.com/sponsors/helvecioneto)

**AI-powered assistant that listens to your calls and provides intelligent, knowledge-based answers — completely invisible to screen sharing.**

🌐 **[Visit our Website](https://helvecioneto.github.io/vars/)** • [Download](#-download) • [Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Donate](#-support-the-project)

<img src="docs/img/main.png" alt="VARS Application Screenshot" width="480">

</div>

---

## 💡 Motivation / Motivação

The motivation behind this project came from observing the growing popularity of Desktop Virtual Agents designed to assist candidates during job interviews. However, most of these tools are either paid or have limited features. This inspired me to create a free and accessible solution, recognizing that many job seekers—especially in developing countries like Brazil—may not have the financial means to afford expensive services while searching for employment.

Additionally, this project aims to accelerate changes in recruitment processes. Current selection methodologies often suffer from structural flaws, eliminating excellent candidates while selecting those who merely fit a "non-human" or artificial standard. By leveling the playing field, we hope to encourage a shift towards more authentic and effective evaluation methods.

---

A motivação para criar este projeto surgiu ao observar a crescente popularização de Agentes Virtuais de Desktop projetados para auxiliar candidatos em entrevistas de emprego. No entanto, a maioria dessas ferramentas é paga ou possui recursos limitados. Isso me inspirou a desenvolver uma solução gratuita e acessível, pois entendo que muitos candidatos, especialmente em países em desenvolvimento como o Brasil, podem não ter condições financeiras para arcar com custos elevados enquanto buscam uma oportunidade no mercado de trabalho.

Além disso, este projeto visa acelerar mudanças nos processos seletivos. As metodologias de seleção atuais muitas vezes sofrem de falhas estruturais, eliminando excelentes candidatos enquanto selecionam aqueles que apenas se encaixam em um padrão "não humano" ou artificial. Ao nivelar o campo de jogo, esperamos incentivar uma mudança em direção a métodos de avaliação mais autênticos e eficazes.

---

## �📥 Download

### Pre-built Binaries

Download the latest version for your operating system from the [Releases page](https://github.com/helvecioneto/vars/releases):

| Platform | Architecture | Download |
|----------|-------------|----------|
| **Windows** | x64 | [VARS-win-x64.exe](https://github.com/helvecioneto/vars/releases/latest) |
| **macOS** | Apple Silicon (M1/M2/M3) | [VARS-mac-arm64.dmg](https://github.com/helvecioneto/vars/releases/latest) |
| **macOS** | Intel | [VARS-mac-x64.dmg](https://github.com/helvecioneto/vars/releases/latest) |
| **Linux** | x64 | [VARS-linux-x64.AppImage](https://github.com/helvecioneto/vars/releases/latest) |

---

## ✨ Features

### 🎙️ Multi-Provider AI Support
- **OpenAI Integration**: GPT-4o, GPT-4o-mini, GPT-5.2, Whisper transcription
- **Google Gemini Integration**: Gemini 2.5/3.0 Flash & Pro models with free tier support
- **Configurable Quality Tiers**: Free, Fast, Balanced, and Quality modes
- **Automatic Fallback**: Smart retry with model fallback for free tier

### 🎧 Audio Capture Modes
- **System Audio**: Capture audio from calls, meetings, and any application (uses PulseAudio/PipeWire on Linux)
- **Microphone Input**: Direct microphone recording for voice questions
- **Real-time Transcription**: Live audio streaming with OpenAI Realtime API or Gemini Live API

### 📸 Screen Capture & Analysis
- Capture the **foreground application window** (not the VARS window)
- AI-powered image analysis with custom questions
- Quick actions: Summarize, Extract Code, Answer Questions

### 📚 Knowledge Base
- Upload custom documents (`.txt`, `.md`, `.json`)
- AI uses your knowledge base to provide contextual answers
- Powered by OpenAI Assistants API with Vector Store

### 👻 Privacy & Stealth
- **Invisible to Screen Sharing**: Window protected from capture on macOS and Windows
- **Always-on-Top**: Floats above other windows without interfering
- **System Tray Integration**: Runs quietly in background
- **Frameless Design**: Minimal, non-intrusive interface

### 🌍 Multi-Language Support
- Interface and responses in English, Portuguese (BR), and Spanish
- Configurable transcription and response language

### ⌨️ Keyboard-First Design
- Global hotkeys work even when VARS is in background
- Text input for keyboard-only workflow
- Conversation history navigation

---

## 🛠️ Installation

### Prerequisites

- **Node.js** 18.0 or higher ([Download](https://nodejs.org/))
- **npm** (comes with Node.js)
- **API Key** from one of the providers:
  - [OpenAI API Key](https://platform.openai.com/api-keys)
  - [Google AI Studio API Key](https://aistudio.google.com/app/apikey) (free tier available)

### Install from Source

```bash
# Clone the repository
git clone https://github.com/helvecioneto/vars.git
cd vars

# Install dependencies
npm install

# Start the application
npm start

# Or start in development mode (with DevTools)
npm run dev
```

### Platform-Specific Requirements

<details>
<summary><b>🍎 macOS</b></summary>

- macOS 10.15 (Catalina) or later
- Microphone permission required (system will prompt)
- Screen Recording permission required for screen capture

</details>

<details>
<summary><b>🪟 Windows</b></summary>

- Windows 10 or later
- No additional permissions required

</details>

<details>
<summary><b>🐧 Linux</b></summary>

- X11 or Wayland with XWayland
- **Screen capture** requires one of: `xdotool`, `wmctrl`, or `xprop`
- **System audio** requires PulseAudio or PipeWire with `parec`

```bash
# Ubuntu/Debian
sudo apt install xdotool pulseaudio-utils

# Fedora
sudo dnf install xdotool pulseaudio-utils

# Arch
sudo pacman -S xdotool pulseaudio
```

> ⚠️ **Note**: Screen protection (invisible to screen sharing) does not work on Linux.

</details>

---

## 📖 Usage

### First Launch

1. Launch VARS (`npm start` or double-click the app)
2. Click the ⚙️ **Settings** button
3. Enter your **API Key** (OpenAI or Google)
4. Select your preferred **Provider** and **Quality Tier**
5. (Optional) Add knowledge base files
6. Click **Save**

### Keyboard Shortcuts

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| **Start/Stop Recording** | `⌥ + Space` | `Ctrl + Space` |
| **Switch Audio Mode** | `⌥ + M` | `Ctrl + M` |
| **Screenshot Capture** | `⌥ + Shift + S` | `Ctrl + Shift + S` |
| **History Navigation** | `⌥ + ↑/↓` | `Ctrl + ↑/↓` |
| **Zoom In** | `⌥ + +` | `Ctrl + +` |
| **Zoom Out** | `⌥ + -` | `Ctrl + -` |
| **Reset Zoom** | `⌥ + 0` | `Ctrl + 0` |

### Audio Recording Workflow

1. Press `Ctrl+Space` (or `⌥+Space` on Mac) to **start recording**
2. Speak or let the system audio play
3. Press the same shortcut to **stop recording**
4. VARS will transcribe and send to AI for analysis
5. View the response in the floating window

### Screen Capture Workflow

1. Focus the application you want to capture
2. Press `Ctrl+Shift+S` (or `⌥+Shift+S` on Mac)
3. Select an action: **Summarize**, **Extract Code**, or **Ask Question**
4. VARS captures the window and analyzes it with AI

### Text Input

- Type directly in the input field at the top
- Press **Enter** to send to AI
- Use `Ctrl+↑/↓` to navigate conversation history

---

## 🏗️ Building from Source

### Quick Build

```bash
# Install dependencies first
npm install

# Build for your current platform
npm run build
```

### Platform-Specific Builds

#### Windows
```bash
# Using npm script
npm run build:win

# Or using the batch script
.\scripts\build_win.bat
```

#### macOS
```bash
# Build for both Intel and Apple Silicon
npm run build:mac

# Or using the shell script
./scripts/build_all.sh mac
```

#### Linux
```bash
npm run build:linux

# Or using the shell script
./scripts/build_all.sh linux
```

### Build Output

Built applications are saved in the `dist/` folder:

| Platform | Output Format |
|----------|--------------|
| Windows | `.exe` (NSIS installer) |
| macOS | `.dmg` (separate builds for arm64 and x64) |
| Linux | `.AppImage` |

### Build Configuration

The build is configured in `package.json` using [electron-builder](https://www.electron.build/). Key configurations:

- **App ID**: `com.vars.app`
- **Product Name**: `VARS`
- **macOS**: Hardened runtime, microphone entitlements
- **Windows**: NSIS installer with desktop shortcut
- **Linux**: AppImage with Utility category

---

## ⚙️ Configuration

### Providers & Models

| Provider | Free Tier | Paid Tiers | Features |
|----------|-----------|------------|----------|
| **Google Gemini** | ✅ Gemini 2.5/3.0 Flash | Fast, Balanced, Quality | Free API usage, automatic fallback |
| **OpenAI** | ❌ | Fast (4o-mini), Balanced (4o), Quality (5.2) | Assistants API, Vector Store |

### Quality Tiers

| Tier | Speed | Cost | Best For |
|------|-------|------|----------|
| **Free** | Medium | Free | Testing, light usage (Google only) |
| **Fast** | Fastest | Low | Quick responses, simple questions |
| **Balanced** | Medium | Medium | General usage (recommended) |
| **Quality** | Slower | Higher | Complex analysis, long context |

### Configuration Files

Configuration is stored in `~/.vars/config.json` and includes:

- API keys (encrypted storage)
- Provider and tier preferences
- System prompt customization
- Knowledge base file paths
- Audio device preferences
- Language settings

---

## 🗂️ Project Structure

```
vars/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── index.js          # App entry point, window management
│   │   ├── config.js         # Configuration management
│   │   ├── ipc-handlers.js   # IPC communication handlers
│   │   ├── openai.js         # OpenAI API integration
│   │   ├── google.js         # Google Gemini integration
│   │   ├── realtime.js       # OpenAI Realtime API
│   │   ├── gemini-realtime.js# Gemini Live API
│   │   ├── screen-capture.js # Cross-platform screen capture
│   │   └── system-audio.js   # Linux system audio capture
│   ├── renderer/             # Electron renderer process
│   │   ├── index.html        # Main UI
│   │   ├── renderer.js       # UI logic
│   │   └── styles.css        # Styling
│   ├── config/               # Configuration files
│   │   ├── models.json       # AI model definitions
│   │   └── prompts.json      # System prompts (i18n)
│   ├── assets/               # Icons and images
│   └── preload.js            # Preload script for IPC
├── scripts/                  # Build scripts
│   ├── build_all.sh          # macOS/Linux build
│   └── build_win.bat         # Windows build
├── build/                    # Build resources
│   └── entitlements.mac.plist# macOS entitlements
├── package.json              # Dependencies & build config
└── README.md
```

---

## 🔧 Troubleshooting

<details>
<summary><b>Recording doesn't work</b></summary>

- **macOS**: Grant microphone permission in System Preferences → Privacy & Security → Microphone
- **Linux**: Ensure PulseAudio/PipeWire is running: `pulseaudio --check`
- Check the audio device selection in Settings

</details>

<details>
<summary><b>Screen capture shows wrong window</b></summary>

- VARS captures the **foreground window**, not the window under cursor
- Make sure the target window is focused before pressing the shortcut
- On Linux, ensure `xdotool` is installed

</details>

<details>
<summary><b>AI responses are slow</b></summary>

- Try switching to a faster tier (Fast instead of Quality)
- Google Gemini free tier may have rate limits; consider upgrading
- Check your internet connection

</details>

<details>
<summary><b>"API key not configured" error</b></summary>

- Open Settings (⚙️) and enter your API key
- Make sure you selected the correct provider (OpenAI or Google)
- Verify your API key is valid at the provider's dashboard

</details>

---

## 💖 Support the Project

If VARS helps you in your daily work, consider supporting its development!

### GitHub Sponsors

[![Sponsor](https://img.shields.io/badge/Sponsor_on_GitHub-❤️-ea4aaa?style=for-the-badge&logo=github)](https://github.com/sponsors/helvecioneto)

Your sponsorship helps:
- 🚀 Develop new features
- 🐛 Fix bugs faster
- 📚 Improve documentation
- ☕ Keep the developer caffeinated

### Other Ways to Support

- ⭐ **Star this repository** to help others discover VARS
- 🐛 **Report bugs** and suggest features via [Issues](https://github.com/helvecioneto/vars/issues)
- 🔀 **Contribute code** via [Pull Requests](https://github.com/helvecioneto/vars/pulls)
- 📢 **Share** VARS with your colleagues and friends

---

## 🤝 Contributing

Contributions are welcome! Please read the contributing guidelines before submitting a PR.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPLv3)**.

This license guarantees your freedom to share and change the software, ensuring it remains free software for all its users.

**Key Permissions:**
- ✅ Commercial use
- ✅ Modification
- ✅ Distribution
- ✅ Private use

**Conditions:**
- ℹ️ Disclose source
- ℹ️ License and copyright notice
- ℹ️ Same license (Copyleft)

**Disclaimer:**
This software is provided "as is", without warranty of any kind. Please see the [LICENSE](LICENSE) file for the full license text and important legal disclaimers regarding the use of recording features.

**Privacy & Open Source Transparency:**
Since this tool is Open Source, all privacy-related logic (audio and screen capture) can be verified directly in the source code. We encourage users to audit the code to ensure transparency and trust regarding how their data is handled.

---

<div align="center">

**Made with ❤️ for productive meetings**

[⬆ Back to Top](#-vars-virtual-agent-for-real-time-support)

</div>
