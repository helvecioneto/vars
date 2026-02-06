/**
 * VARS - Quiz Solver Module (Enhanced Intelligence Version)
 * Automated quiz detection and answering using AI vision and mouse control
 * 
 * Features:
 * - State machine for quiz progression
 * - Screenshot comparison to detect changes
 * - Automatic button discovery (Submit, Next, Scroll)
 * - Learning mechanism from successful interactions
 * - Stuck detection and recovery
 */

const screenCapture = require('./screen-capture');
const mouseControl = require('./mouse-control');
const quizMemory = require('./quiz-memory');
const crypto = require('crypto');
const { QuizType, LayoutType } = quizMemory;

// ==========================================
// STATE MACHINE
// ==========================================

const QuizState = {
    IDLE: 'IDLE',
    SCANNING: 'SCANNING',
    CLASSIFYING: 'CLASSIFYING',
    LEARNING_LAYOUT: 'LEARNING_LAYOUT',
    ANSWERING: 'ANSWERING',
    WAITING_FOR_CHANGE: 'WAITING_FOR_CHANGE',
    CLICKING_SUBMIT: 'CLICKING_SUBMIT',
    CLICKING_NEXT: 'CLICKING_NEXT',
    CLICKING_FINISH: 'CLICKING_FINISH',
    QUIZ_COMPLETED: 'QUIZ_COMPLETED',
    SCROLLING: 'SCROLLING',
    WAITING_FOR_VIDEO: 'WAITING_FOR_VIDEO',
    STUCK_RECOVERY: 'STUCK_RECOVERY',
    ERROR: 'ERROR'
};

// ==========================================
// QUIZ SOLVER STATE
// ==========================================

let isActive = false;
let isBusy = false;  // Lock to prevent concurrent cycles
let cycleInterval = null;
let resumeTimeout = null;
let mainWindow = null;
let getConfig = null;
let analyzeImageFn = null;

// State machine
let currentState = QuizState.IDLE;
let previousState = null;

// Screenshot tracking
let lastScreenshotHash = null;
let lastScreenshotData = null;
let unchangedScreenCount = 0;
const MAX_UNCHANGED_BEFORE_STUCK = 3;

// Quiz context (learned from first analysis)
let quizContext = {
    type: null,
    layout: null,
    optionCount: 0,
    // Learned positions (cached for reuse)
    learnedPositions: {
        options: [],           // Array of option positions
        submitButton: null,    // Submit/Confirm button
        nextButton: null,      // Next question button
        finishButton: null,    // Finish/Complete button (end of quiz)
        skipButton: null,      // Skip button
        scrollArea: null,      // Where to scroll
        questionArea: null,    // Question text area
        textInputField: null   // For text input quizzes
    },
    // State tracking
    questionsAnswered: 0,
    lastQuestion: null,
    currentQuestion: null,
    pendingActions: [],        // Queue of actions to perform
    confidence: 0.5
};

// Statistics
let stats = {
    totalAnswered: 0,
    cacheHits: 0,
    cacheMisses: 0,
    aiCalls: 0,
    positionReuses: 0,
    stuckRecoveries: 0
};

// Configuration
const DEFAULT_CYCLE_INTERVAL = 2000;
const CLICK_DELAY = 400;
const POST_ACTION_DELAY = 1500;
const SCROLL_AMOUNT = 300;
const TYPE_DELAY = 30;

// Video wait configuration
const VIDEO_CHECK_INTERVAL = 15000;     // Check video progress every 15 seconds
const VIDEO_JIGGLE_INTERVAL = 10000;    // Jiggle mouse every 10 seconds during video wait
const VIDEO_MIN_WAIT = 5000;            // Minimum wait before first check

// Position validation configuration
const POSITION_VALIDATION_ENABLED = true;
const MAX_POSITION_DRIFT = 15;          // Max % drift before re-analyzing

// Mouse jiggle throttle - minimum time between jiggles (ms)
const JIGGLE_MIN_INTERVAL = 5000;       // Only jiggle every 5 seconds max
let lastJiggleTime = 0;                 // Track last jiggle timestamp

// ==========================================
// INITIALIZATION
// ==========================================

function initialize(context) {
    mainWindow = context.getMainWindow;
    getConfig = context.getConfig;
    analyzeImageFn = context.analyzeImage;
}

// ==========================================
// MOUSE JIGGLE (RELATIVE ONLY)
// ==========================================

/**
 * Perform a small relative mouse movement to reveal video controls
 * Uses ONLY relative movement - does NOT return to any fixed position
 * This prevents "trapping" the mouse effect
 * @param {boolean} force - Skip throttle check if true
 * @returns {Promise<boolean>} true if jiggle was performed
 */
async function doMouseJiggle(force = false) {
    const now = Date.now();

    // Throttle: don't jiggle too frequently unless forced
    if (!force && (now - lastJiggleTime) < JIGGLE_MIN_INTERVAL) {
        return false;
    }

    try {
        // Small random movement (2-3 pixels in random direction)
        // Using ONLY moveRelative - no absolute positioning
        const dx = Math.random() > 0.5 ? 3 : -3;
        const dy = Math.random() > 0.5 ? 2 : -2;

        await mouseControl.moveRelative(dx, dy);

        // Update last jiggle time
        lastJiggleTime = now;

        // Short wait for controls to appear
        await new Promise(r => setTimeout(r, 50));

        return true;
    } catch (e) {
        // Jiggle errors should not interrupt quiz solving
        // console.log('[QuizSolver] Jiggle error (ignored):', e.message);
        return false;
    }
}

/**
 * Convert named region to percentage coordinates
 * Regions format: "row-column" e.g., "bottom-center", "middle-left"
 * Rows: top (10%), upper (30%), middle (50%), lower (70%), bottom (90%)
 * Columns: left (12%), center-left (32%), center (50%), center-right (68%), right (88%)
 */
function regionToCoordinates(region, optionIndex = 0) {
    if (!region || typeof region !== 'string') {
        // Default fallback positions
        return { xPercent: 15, yPercent: 35 + (optionIndex * 10) };
    }

    const parts = region.toLowerCase().split('-');

    // Y-axis (rows)
    const rowMap = {
        'top': 10,
        'upper': 30,
        'middle': 50,
        'lower': 70,
        'bottom': 92
    };

    // X-axis (columns)
    const colMap = {
        'left': 12,
        'center': 50,
        'right': 88
    };

    // Handle compound column names like "center-left"
    let yPercent = 50;
    let xPercent = 50;

    // Parse row (first part usually)
    for (const part of parts) {
        if (rowMap[part] !== undefined) {
            yPercent = rowMap[part];
            break;
        }
    }

    // Parse column
    if (region.includes('center-left')) {
        xPercent = 32;
    } else if (region.includes('center-right')) {
        xPercent = 68;
    } else {
        for (const part of parts) {
            if (colMap[part] !== undefined) {
                xPercent = colMap[part];
            }
        }
    }

    // For options, adjust Y based on option index (spaced ~10% apart from row position)
    // e.g., if row is "middle" (50%) and we have 4 options, spread from 35% to 65%

    return { xPercent, yPercent };
}

/**
 * Process AI response and convert regions to coordinates if needed
 */
function normalizeAIResponse(data) {
    if (!data) return data;

    // Check if response uses regions instead of xPercent/yPercent
    if (data.quiz?.options) {
        data.quiz.options = data.quiz.options.map((opt, index) => {
            if (opt.region && (opt.xPercent === undefined || opt.yPercent === undefined)) {
                const coords = regionToCoordinates(opt.region, index);
                // Adjust Y position based on option index for proper spacing
                const yOffset = index * 10; // 10% apart
                return {
                    ...opt,
                    xPercent: coords.xPercent,
                    yPercent: Math.min(25 + yOffset, 75) // Start at 25%, max 75%
                };
            }
            return opt;
        });
    }

    // Normalize buttons
    if (data.buttons) {
        for (const [key, btn] of Object.entries(data.buttons)) {
            if (btn && btn.exists && btn.region && (btn.xPercent === undefined || btn.yPercent === undefined)) {
                const coords = regionToCoordinates(btn.region);
                data.buttons[key] = {
                    ...btn,
                    xPercent: coords.xPercent,
                    yPercent: coords.yPercent
                };
            }
        }
    }

    return data;
}

/**
 * Validate that a button is still at the expected position
 * Returns updated position if moved, null if not found
 * @param {object} expectedPos - {xPercent, yPercent}
 * @param {string} buttonType - 'submit', 'next', 'finish', etc.
 * @param {object} screenshot - Current screenshot  
 * @param {object} screenSize - {width, height}
 * @returns {Promise<object|null>} Updated position or null
 */
async function validateButtonPosition(expectedPos, buttonType, screenshot, screenSize) {
    if (!POSITION_VALIDATION_ENABLED || !expectedPos) {
        return expectedPos;
    }

    const config = getConfig();
    const language = config.language || 'en';

    const prompts = {
        'en': `Quick check: Is there a ${buttonType} button visible? Look for buttons labeled: Submit, Next, Continue, Confirm, Finish, Send, Enviar, Próximo, Continuar.
Return ONLY JSON: {"found": true/false, "xPercent": X, "yPercent": Y, "text": "button text"}`,
        'pt-br': `Verificação rápida: Existe um botão de ${buttonType} visível? Procure botões como: Enviar, Próximo, Continuar, Confirmar, Finalizar.
Retorne APENAS JSON: {"found": true/false, "xPercent": X, "yPercent": Y, "text": "texto do botão"}`
    };

    try {
        const result = await analyzeScreen(screenshot, prompts[language] || prompts['en']);

        if (result?.found && result.xPercent !== undefined && result.yPercent !== undefined) {
            // Check if position drifted significantly
            const drift = Math.abs(result.xPercent - expectedPos.xPercent) +
                Math.abs(result.yPercent - expectedPos.yPercent);

            if (drift > MAX_POSITION_DRIFT) {
                console.log(`[QuizSolver] Button ${buttonType} moved: (${expectedPos.xPercent}%,${expectedPos.yPercent}%) -> (${result.xPercent}%,${result.yPercent}%)`);
            }

            return {
                xPercent: result.xPercent,
                yPercent: result.yPercent,
                text: result.text || expectedPos.text
            };
        }

        console.log(`[QuizSolver] Button ${buttonType} not found during validation`);
        return null;

    } catch (e) {
        console.log(`[QuizSolver] Button validation error: ${e.message}`);
        // On error, assume position is still valid
        return expectedPos;
    }
}

// ==========================================
// SCREENSHOT COMPARISON
// ==========================================

// Track last screenshot data for comparison
let lastScreenshotSize = 0;
const SCREEN_CHANGE_THRESHOLD = 0.02;  // 2% size difference = screen changed

/**
 * Generate a hash of screenshot for comparison
 * Uses size + sample hash for efficient comparison
 */
function generateScreenshotHash(imageData) {
    // Use size as primary comparison (faster)
    const size = imageData.length;
    // Sample from multiple regions for hash
    const sampleSize = 2000;
    const samples = [
        imageData.substring(0, sampleSize),
        imageData.substring(Math.floor(imageData.length / 2) - sampleSize / 2, Math.floor(imageData.length / 2) + sampleSize / 2),
        imageData.substring(imageData.length - sampleSize)
    ].join('');
    const hash = crypto.createHash('md5').update(samples).digest('hex');
    return { hash, size };
}

/**
 * Check if screen has changed since last capture
 * Uses size-based comparison with threshold for efficiency
 */
function hasScreenChanged(currentHashObj) {
    if (!lastScreenshotHash || lastScreenshotSize === 0) {
        return true;  // First screenshot, always process
    }

    // Size-based comparison (fast)
    const sizeDiff = Math.abs(currentHashObj.size - lastScreenshotSize) / lastScreenshotSize;
    if (sizeDiff > SCREEN_CHANGE_THRESHOLD) {
        console.log(`[QuizSolver] Screen size changed by ${(sizeDiff * 100).toFixed(1)}%`);
        return true;
    }

    // Hash comparison as backup
    if (currentHashObj.hash !== lastScreenshotHash) {
        console.log('[QuizSolver] Screen hash changed');
        return true;
    }

    return false;
}

/**
 * Update screenshot tracking
 */
function updateScreenshotTracking(hashObj, imageData) {
    const changed = hasScreenChanged(hashObj);

    if (changed) {
        unchangedScreenCount = 0;
    } else {
        unchangedScreenCount++;
    }

    lastScreenshotHash = hashObj.hash;
    lastScreenshotSize = hashObj.size;
    lastScreenshotData = imageData;

    return changed;
}

// ==========================================
// STATE MANAGEMENT
// ==========================================

function setState(newState) {
    previousState = currentState;
    currentState = newState;
    console.log(`[QuizSolver] State: ${previousState} → ${newState}`);
    sendStatus('state-change', { state: newState, previousState });
}

function sendStatus(status, data = {}) {
    const window = typeof mainWindow === 'function' ? mainWindow() : mainWindow;
    if (window && window.webContents) {
        window.webContents.send('quiz-solver:status', {
            status,
            state: currentState,
            ...data,
            stats,
            context: {
                type: quizContext.type,
                questionsAnswered: quizContext.questionsAnswered,
                hasLearnedPositions: !!(quizContext.learnedPositions.submitButton || quizContext.learnedPositions.nextButton)
            }
        });
    }
}

// ==========================================
// PROMPTS
// ==========================================

function getUnifiedAnalysisPrompt(language = 'en') {
    const prompts = {
        'en': `SCREEN ANALYSIS - Identify what's on screen and where elements are located.

Look at this screenshot and tell me:
1. What type of screen is this (quiz, video, instructions, results, other)?
2. If it's a quiz, what is the question and what are the answer options?
3. What buttons are visible and where are they located?

IMPORTANT: For positions, describe the location in the image using these REGION CODES:
- Position format: "row-column" 
- Rows: "top" (0-20%), "upper" (20-40%), "middle" (40-60%), "lower" (60-80%), "bottom" (80-100%)
- Columns: "left" (0-25%), "center-left" (25-40%), "center" (40-60%), "center-right" (60-75%), "right" (75-100%)

Examples: "bottom-center", "middle-left", "upper-center", "lower-center-left"

Return this JSON:
{
    "screenType": "quiz" | "video" | "instructions" | "results" | "other",
    "confidence": 0.0 to 1.0,
    
    "quiz": {
        "question": "The question text you see",
        "quizType": "multipleChoice" | "trueFalse" | "textInput",
        "options": [
            {"text": "option text", "letter": "A", "region": "upper-left", "isCorrect": true},
            {"text": "option text", "letter": "B", "region": "middle-left", "isCorrect": false}
        ],
        "correctAnswer": "A",
        "explanation": "why this is correct"
    },
    
    "buttons": {
        "submit": {"exists": true, "text": "Submit", "region": "bottom-center"},
        "next": {"exists": false, "text": "", "region": ""},
        "continue": {"exists": false, "text": "", "region": ""},
        "finish": {"exists": false, "text": "", "region": ""},
        "play": {"exists": false, "text": "", "region": ""}
    },
    
    "video": {
        "isPlaying": false,
        "timeRemaining": 0,
        "hasControls": false
    }
}

RULES:
1. For options: Look at where the radio button/checkbox is, not the text
2. Options are usually on the left side (left or center-left)
3. Submit/Next buttons are usually at the bottom (bottom-center or bottom-right)
4. Use the ACTUAL position you see in the image
5. Mark isCorrect: true only for the factually correct answer`,

        'pt-br': `ANALISE ESTA TELA - Observe a IMAGEM REAL e identifique as posições dos elementos.

IMPORTANTE: Você DEVE analisar a captura de tela real. NÃO use valores de exemplo.

SISTEMA DE COORDENADAS:
- xPercent: 0 = esquerda, 50 = centro, 100 = direita
- yPercent: 0 = topo, 50 = centro, 100 = base
- Meça a partir da imagem para encontrar o CENTRO EXATO de cada elemento clicável

Retorne esta estrutura JSON (preencha com coordenadas REAIS da imagem):
{
    "screenType": "quiz" | "video" | "instructions" | "results" | "other",
    "confidence": 0.0 a 1.0,
    
    "quiz": {
        "question": "O texto real da pergunta que você vê",
        "quizType": "multipleChoice" | "trueFalse" | "textInput" | null,
        "options": [
            {"text": "texto real da opção", "letter": "A", "xPercent": <MEDIR_X>, "yPercent": <MEDIR_Y>, "isCorrect": <true_ou_false>}
        ],
        "correctAnswer": "letra da resposta correta",
        "explanation": "por que está correta"
    },
    
    "buttons": {
        "submit": {"exists": <true_ou_false>, "text": "texto do botão", "xPercent": <MEDIR_X>, "yPercent": <MEDIR_Y>},
        "next": {"exists": <true_ou_false>, "text": "texto do botão", "xPercent": <MEDIR_X>, "yPercent": <MEDIR_Y>},
        "continue": {"exists": <true_ou_false>, "text": "", "xPercent": 0, "yPercent": 0},
        "finish": {"exists": <true_ou_false>, "text": "", "xPercent": 0, "yPercent": 0},
        "play": {"exists": <true_ou_false>, "text": "", "xPercent": 0, "yPercent": 0}
    },
    
    "video": {
        "isPlaying": false,
        "timeRemaining": 0,
        "hasControls": false
    }
}

TIPOS DE TELA:
- "quiz": Pergunta com opções de resposta visíveis
- "video": Player de vídeo é conteúdo principal  
- "instructions": Texto/material de leitura (sem perguntas)
- "results": Exibição de pontuação, mensagem de conclusão
- "other": Nenhum acima

CRÍTICO - COMO MEDIR COORDENADAS:
1. Olhe para a IMAGEM REAL que você está analisando
2. Para CADA opção: encontre o círculo do radio button/checkbox, meça sua posição CENTRAL como porcentagem
3. Para CADA botão: encontre o retângulo do botão, meça sua posição CENTRAL como porcentagem
4. NÃO use valores de exemplo - MEÇA a partir da captura de tela real

Substitua <MEDIR_X> e <MEDIR_Y> por valores REAIS de porcentagem da imagem.`
    };

    return prompts[language] || prompts['en'];
}

// Keep old function name as alias for compatibility
function getScreenClassificationPrompt(language = 'en') {
    return getUnifiedAnalysisPrompt(language);
}

/**
 * Initial layout learning prompt - comprehensive analysis with precise button detection
 */
function getLayoutLearningPrompt(language = 'en') {
    const prompts = {
        'en': `You are analyzing a quiz/test interface screenshot. Your task is to identify ALL interactive elements with PRECISE coordinates.

COORDINATE SYSTEM:
- xPercent: 0 = left edge, 50 = center, 100 = right edge
- yPercent: 0 = top edge, 50 = center, 100 = bottom edge
- Coordinates point to the CLICKABLE CENTER of each element

Return ONLY this JSON:
{
    "isQuiz": true,
    "quizType": "trueFalse" | "multipleChoice" | "textInput",
    "question": "The complete question text",
    
    "options": [
        {
            "text": "Full option text",
            "letter": "A",
            "xPercent": 15,
            "yPercent": 40,
            "width": 70,
            "height": 5,
            "isCorrect": false,
            "clickTarget": "radio button on the left of the text"
        }
    ],
    "correctAnswer": "B",
    "explanation": "Brief explanation",
    
    "buttons": {
        "submit": {
            "exists": true,
            "text": "Submit",
            "xPercent": 50,
            "yPercent": 90,
            "width": 15,
            "height": 4,
            "color": "blue/green/primary",
            "position": "bottom center"
        },
        "next": {
            "exists": true,
            "text": "Next",
            "xPercent": 85,
            "yPercent": 90,
            "width": 10,
            "height": 4,
            "color": "gray/secondary",
            "position": "bottom right"
        },
        "confirm": {"exists": false},
        "continue": {"exists": false},
        "skip": {"exists": false},
        "finish": {"exists": false}
    },
    
    "textInput": {
        "exists": false,
        "xPercent": 50,
        "yPercent": 55,
        "width": 60,
        "height": 5
    },
    
    "scroll": {
        "needed": false,
        "direction": "down",
        "indicator": "scrollbar visible on right"
    }
}

BUTTON DETECTION - Look for these common labels:
- Submit buttons: "Submit", "Send", "Confirm", "Check", "Verify", "Done", "OK", "Enviar", "Confirmar", "Verificar"
- Next buttons: "Next", "Continue", "Forward", "→", "Próximo", "Continuar", "Avançar", "Seguinte"
- Skip buttons: "Skip", "Pass", "Later", "Pular", "Ignorar"
- Finish buttons: "Finish", "Complete", "End", "Finalizar", "Concluir", "Terminar"

CRITICAL RULES:
1. For OPTIONS: xPercent should point to the radio button/checkbox, NOT the text
2. For BUTTONS: coordinates must point to the button CENTER
3. If unsure about position, estimate based on visual layout (buttons usually at bottom)
4. Include ALL visible buttons, even if partially visible
5. Mark ONLY the factually correct answer as isCorrect: true`,

        'pt-br': `Você está analisando uma captura de tela de interface de quiz/teste. Sua tarefa é identificar TODOS os elementos interativos com coordenadas PRECISAS.

SISTEMA DE COORDENADAS:
- xPercent: 0 = borda esquerda, 50 = centro, 100 = borda direita
- yPercent: 0 = topo, 50 = centro, 100 = base
- Coordenadas apontam para o CENTRO CLICÁVEL de cada elemento

Retorne APENAS este JSON:
{
    "isQuiz": true,
    "quizType": "trueFalse" | "multipleChoice" | "textInput",
    "question": "Texto completo da pergunta",
    
    "options": [
        {
            "text": "Texto completo da opção",
            "letter": "A",
            "xPercent": 15,
            "yPercent": 40,
            "width": 70,
            "height": 5,
            "isCorrect": false,
            "clickTarget": "botão de rádio à esquerda do texto"
        }
    ],
    "correctAnswer": "B",
    "explanation": "Breve explicação",
    
    "buttons": {
        "submit": {
            "exists": true,
            "text": "Enviar",
            "xPercent": 50,
            "yPercent": 90,
            "width": 15,
            "height": 4,
            "color": "azul/verde/primário",
            "position": "centro inferior"
        },
        "next": {
            "exists": true,
            "text": "Próximo",
            "xPercent": 85,
            "yPercent": 90,
            "width": 10,
            "height": 4,
            "color": "cinza/secundário",
            "position": "direita inferior"
        },
        "confirm": {"exists": false},
        "continue": {"exists": false},
        "skip": {"exists": false},
        "finish": {"exists": false}
    },
    
    "textInput": {
        "exists": false,
        "xPercent": 50,
        "yPercent": 55,
        "width": 60,
        "height": 5
    },
    
    "scroll": {
        "needed": false,
        "direction": "down",
        "indicator": "scrollbar visível à direita"
    }
}

DETECÇÃO DE BOTÕES - Procure estes rótulos comuns:
- Botões enviar: "Enviar", "Confirmar", "Verificar", "Checar", "OK", "Salvar", "Submit", "Send"
- Botões próximo: "Próximo", "Próxima", "Continuar", "Avançar", "Seguinte", "→", "Next", "Continue"
- Botões pular: "Pular", "Ignorar", "Depois", "Skip", "Pass"
- Botões finalizar: "Finalizar", "Concluir", "Terminar", "Encerrar", "Finish", "Complete"

REGRAS CRÍTICAS:
1. Para OPÇÕES: xPercent deve apontar para o botão de rádio/checkbox, NÃO para o texto
2. Para BOTÕES: coordenadas devem apontar para o CENTRO do botão
3. Se não tiver certeza da posição, estime baseado no layout visual (botões geralmente na parte inferior)
4. Inclua TODOS os botões visíveis, mesmo parcialmente visíveis
5. Marque APENAS a resposta factualmente correta como isCorrect: true`,

        'es': `Estás analizando una captura de pantalla de interfaz de quiz/examen. Tu tarea es identificar TODOS los elementos interactivos con coordenadas PRECISAS.

SISTEMA DE COORDENADAS:
- xPercent: 0 = borde izquierdo, 50 = centro, 100 = borde derecho
- yPercent: 0 = arriba, 50 = centro, 100 = abajo
- Las coordenadas apuntan al CENTRO CLICKEABLE de cada elemento

Devuelve SOLO este JSON:
{
    "isQuiz": true,
    "quizType": "trueFalse" | "multipleChoice" | "textInput",
    "question": "Texto completo de la pregunta",
    
    "options": [
        {
            "text": "Texto completo de la opción",
            "letter": "A",
            "xPercent": 15,
            "yPercent": 40,
            "isCorrect": false
        }
    ],
    "correctAnswer": "B",
    "explanation": "Breve explicación",
    
    "buttons": {
        "submit": {"exists": true, "text": "Enviar", "xPercent": 50, "yPercent": 90},
        "next": {"exists": true, "text": "Siguiente", "xPercent": 85, "yPercent": 90},
        "confirm": {"exists": false},
        "skip": {"exists": false}
    }
}

DETECCIÓN DE BOTONES - Busca estas etiquetas:
- Enviar: "Enviar", "Confirmar", "Verificar", "Aceptar", "Submit"
- Siguiente: "Siguiente", "Continuar", "Avanzar", "→", "Next"
- Saltar: "Saltar", "Omitir", "Skip"
- Finalizar: "Finalizar", "Terminar", "Completar", "Finish"`
    };

    return prompts[language] || prompts['en'];
}

/**
 * Quick change detection prompt - minimal tokens
 */
function getQuickCheckPrompt(language = 'en') {
    const prompts = {
        'en': `Quick check of this screen. Return ONLY JSON:
{
    "questionChanged": true/false,
    "newQuestion": "question text if changed",
    "correctAnswer": "A/B/C/D or answer text",
    "quizEnded": true/false,
    "isVideo": true/false,
    "buttonsVisible": {
        "submit": true/false,
        "next": true/false,
        "finish": true/false,
        "continueWatching": true/false
    },
    "continueButton": {"xPercent": 50, "yPercent": 50} or null
}

BUTTONS TO DETECT:
- continueWatching: "Continue Watching", "Resume", "Keep Watching", "Play", "Continue"
- finish: "Finish", "Complete", "Done", "End Quiz"

Set quizEnded=true if you see results/score screen with no more questions.
Set isVideo=true if video player is visible.`,

        'pt-br': `Verificação rápida desta tela. Retorne APENAS JSON:
{
    "questionChanged": true/false,
    "newQuestion": "texto da pergunta se mudou",
    "correctAnswer": "A/B/C/D ou texto da resposta",
    "quizEnded": true/false,
    "isVideo": true/false,
    "buttonsVisible": {
        "submit": true/false,
        "next": true/false,
        "finish": true/false,
        "continueWatching": true/false
    },
    "continueButton": {"xPercent": 50, "yPercent": 50} or null
}

BOTÕES PARA DETECTAR:
- continueWatching: "Continuar Assistindo", "Retomar", "Continuar", "Play", "Reproduzir"
- finish: "Finalizar", "Concluir", "Terminar", "Encerrar Quiz"

Defina quizEnded=true se você ver tela de resultados/pontuação sem mais perguntas.
Defina isVideo=true se um player de vídeo estiver visível.`
    };
    return prompts[language] || prompts['en'];
}

/**
 * Answer-only prompt when we know the layout
 */
function getAnswerOnlyPrompt(language = 'en', optionCount = 4) {
    const prompts = {
        'en': `This is a quiz with ${optionCount} options. 
Read the question and tell me the correct answer.
Return ONLY: {"answer": "A", "explanation": "why"}`,
        'pt-br': `Este é um quiz com ${optionCount} opções.
Leia a pergunta e me diga a resposta correta.
Retorne APENAS: {"answer": "A", "explanation": "porque"}`
    };
    return prompts[language] || prompts['en'];
}

// ==========================================
// AI ANALYSIS
// ==========================================

function parseAIResponse(response) {
    let data = null;
    try {
        data = JSON.parse(response);
    } catch (e) {
        const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            try { data = JSON.parse(jsonMatch[1]); } catch (e2) { }
        }
        if (!data) {
            const objectMatch = response.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                try { data = JSON.parse(objectMatch[0]); } catch (e3) { }
            }
        }
    }

    // Normalize response: convert regions to coordinates if needed
    if (data) {
        data = normalizeAIResponse(data);
    }

    return data;
}

async function analyzeScreen(screenshot, prompt) {
    stats.aiCalls++;
    const result = await analyzeImageFn({
        imageData: screenshot.imageData,
        prompt: prompt + `\n\nResolution: ${screenshot.screenWidth}x${screenshot.screenHeight}`,
        windowTitle: screenshot.windowTitle
    });

    if (result.error) {
        throw new Error(result.error);
    }

    return parseAIResponse(result.response);
}

// ==========================================
// ACTIONS
// ==========================================

function calculateCoordinates(position, screenSize) {
    if (!position) return null;

    const coords = {
        x: Math.round((position.xPercent / 100) * screenSize.width),
        y: Math.round((position.yPercent / 100) * screenSize.height)
    };

    console.log(`[QuizSolver] Calculated: ${position.xPercent}% x ${position.yPercent}% → (${coords.x}, ${coords.y}) on ${screenSize.width}x${screenSize.height}`);

    return coords;
}

async function clickAt(coords, description = 'element') {
    if (!coords) {
        console.log(`[QuizSolver] Cannot click ${description} - no coordinates`);
        return;
    }

    // CHECK PROVIDER - If OpenAI, run in READ-ONLY mode (no clicks)
    const config = getConfig ? getConfig() : {};
    const provider = config.provider || 'openai';

    if (provider !== 'google') {
        console.log(`[QuizSolver] READ-ONLY MODE (OpenAI): Would click ${description} at (${coords.x}, ${coords.y})`);
        return;
    }

    console.log(`[QuizSolver] Clicking ${description} at (${coords.x}, ${coords.y})`);
    await mouseControl.moveMouse(coords.x, coords.y);
    await new Promise(r => setTimeout(r, CLICK_DELAY));
    await mouseControl.click();
    await new Promise(r => setTimeout(r, 200));
}

async function scrollPage(direction = 'down', amount = SCROLL_AMOUNT) {
    const { exec } = require('child_process');
    const scrollCmd = direction === 'down'
        ? `xdotool click 5` // Scroll down
        : `xdotool click 4`; // Scroll up

    return new Promise((resolve) => {
        exec(scrollCmd, () => {
            setTimeout(resolve, 500);
        });
    });
}

async function typeText(text) {
    const { exec } = require('child_process');
    const escapedText = text.replace(/'/g, "'\\''");
    return new Promise((resolve, reject) => {
        exec(`xdotool type --delay ${TYPE_DELAY} '${escapedText}'`, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// ==========================================
// MAIN CYCLE - STATE MACHINE
// ==========================================

async function performCycle() {
    // Prevent concurrent cycles - only one cycle at a time
    if (!isActive || isBusy) {
        if (isBusy) console.log('[QuizSolver] Cycle skipped - already busy');
        return;
    }

    // Set busy lock
    isBusy = true;

    try {
        // MOUSE JIGGLE before capture - reveals video controls if on video
        // Uses throttled relative movement only - does NOT return to any position
        await doMouseJiggle();

        if (!isActive) return;

        // Capture screen (ONLY ONCE per cycle)
        const screenshot = await screenCapture.captureFullScreen();
        if (screenshot.error) {
            sendStatus('error', { message: screenshot.error });
            return;
        }

        const screenSize = { width: screenshot.screenWidth, height: screenshot.screenHeight };
        const config = getConfig();
        const language = config.language || 'en';

        // Generate hash for comparison
        const currentHash = generateScreenshotHash(screenshot.imageData);
        const screenChanged = updateScreenshotTracking(currentHash, screenshot.imageData);

        // State machine execution
        switch (currentState) {
            case QuizState.SCANNING:
                await handleScanning(screenshot, screenSize, language, screenChanged);
                break;

            case QuizState.CLASSIFYING:
                await handleClassifying(screenshot, screenSize, language, screenChanged);
                break;

            case QuizState.LEARNING_LAYOUT:
                await handleLearningLayout(screenshot, screenSize, language);
                break;

            case QuizState.ANSWERING:
                await handleAnswering(screenshot, screenSize, language);
                break;

            case QuizState.WAITING_FOR_CHANGE:
                await handleWaitingForChange(screenshot, screenSize, language, screenChanged);
                break;

            case QuizState.CLICKING_SUBMIT:
                await handleClickingSubmit(screenSize);
                break;

            case QuizState.CLICKING_NEXT:
                await handleClickingNext(screenSize);
                break;

            case QuizState.CLICKING_FINISH:
                await handleClickingFinish(screenSize);
                break;

            case QuizState.QUIZ_COMPLETED:
                await handleQuizCompleted(screenshot, screenSize, language);
                break;

            case QuizState.SCROLLING:
                await handleScrolling();
                break;

            case QuizState.STUCK_RECOVERY:
                await handleStuckRecovery(screenshot, screenSize, language);
                break;

            case QuizState.WAITING_FOR_VIDEO:
                // Handled separately with timeout
                break;

            default:
                setState(QuizState.SCANNING);
        }

    } catch (error) {
        console.error('[QuizSolver] Cycle error:', error);
        sendStatus('error', { message: error.message });
        setState(QuizState.ERROR);
    } finally {
        // Always release the busy lock
        isBusy = false;
    }
}

// ==========================================
// STATE HANDLERS
// ==========================================

async function handleScanning(screenshot, screenSize, language, screenChanged) {
    if (!isActive) return;
    sendStatus('scanning');

    // First time or context lost - FIRST classify what's on screen
    if (!quizContext.type) {
        console.log('[QuizSolver] No context - going to CLASSIFYING to detect screen type');
        setState(QuizState.CLASSIFYING);
        return;
    }

    // We have context - check if screen changed
    if (screenChanged) {
        // Screen changed significantly - re-classify to be safe
        console.log('[QuizSolver] Screen changed, checking if still a quiz');
        setState(QuizState.CLASSIFYING);
    } else {
        // Screen unchanged - might be stuck
        if (unchangedScreenCount >= MAX_UNCHANGED_BEFORE_STUCK) {
            console.log('[QuizSolver] Screen unchanged multiple times, attempting recovery');
            setState(QuizState.STUCK_RECOVERY);
        }
    }
}

/**
 * Handle CLASSIFYING state - Initial screen classification
 * Determines if screen shows quiz, video, instructions, or other content
 * SKIPS AI analysis if screen unchanged and we have valid context
 */
async function handleClassifying(screenshot, screenSize, language, screenChanged) {
    if (!isActive) return;

    // OPTIMIZATION: Skip AI if screen unchanged and we have valid quiz context
    if (!screenChanged && quizContext.type) {
        console.log(`[QuizSolver] Screen unchanged, keeping context: ${quizContext.type}`);
        // Move to appropriate next state based on existing context
        if (quizContext.type === 'quiz') {
            if (quizContext.learnedPositions.options?.length > 0) {
                setState(QuizState.ANSWERING);
            } else {
                setState(QuizState.LEARNING_LAYOUT);
            }
        } else if (quizContext.type === 'video') {
            setState(QuizState.SCANNING);  // Keep scanning during video
        } else {
            setState(QuizState.SCANNING);
        }
        return;
    }

    sendStatus('classifying');
    console.log('[QuizSolver] Classifying screen content...');

    try {
        const prompt = getScreenClassificationPrompt(language);
        const data = await analyzeScreen(screenshot, prompt);

        // Check if still active after AI call
        if (!isActive) return;

        if (!data) {
            console.log('[QuizSolver] Classification failed, waiting');
            setState(QuizState.SCANNING);
            return;
        }

        console.log(`[QuizSolver] Screen classified as: ${data.screenType} (${Math.round((data.confidence || 0) * 100)}% confidence)`);
        sendStatus('classified', {
            type: data.screenType,
            description: data.description,
            confidence: data.confidence
        });

        switch (data.screenType) {
            case 'quiz':
                // UNIFIED: Apply positions directly from this response
                console.log('[QuizSolver] Quiz detected, applying layout from unified response');
                quizContext.type = 'quiz';
                quizContext.layout = data.quiz?.quizType || 'multipleChoice';
                quizContext.currentQuestion = data.quiz?.question || '';

                // Apply button positions directly
                if (data.buttons) {
                    if (data.buttons.submit?.exists) {
                        quizContext.learnedPositions.submitButton = {
                            xPercent: data.buttons.submit.xPercent,
                            yPercent: data.buttons.submit.yPercent,
                            text: data.buttons.submit.text
                        };
                        console.log(`[QuizSolver] Submit button at: ${data.buttons.submit.xPercent}%, ${data.buttons.submit.yPercent}%`);
                    }
                    if (data.buttons.next?.exists) {
                        quizContext.learnedPositions.nextButton = {
                            xPercent: data.buttons.next.xPercent,
                            yPercent: data.buttons.next.yPercent,
                            text: data.buttons.next.text
                        };
                    }
                    if (data.buttons.finish?.exists) {
                        quizContext.learnedPositions.finishButton = {
                            xPercent: data.buttons.finish.xPercent,
                            yPercent: data.buttons.finish.yPercent,
                            text: data.buttons.finish.text
                        };
                    }
                    if (data.buttons.continue?.exists) {
                        quizContext.learnedPositions.nextButton = {
                            xPercent: data.buttons.continue.xPercent,
                            yPercent: data.buttons.continue.yPercent,
                            text: data.buttons.continue.text
                        };
                    }
                }

                // Apply option positions directly
                if (data.quiz?.options && data.quiz.options.length > 0) {
                    quizContext.learnedPositions.options = data.quiz.options.map(opt => ({
                        letter: opt.letter,
                        text: opt.text,
                        xPercent: opt.xPercent,
                        yPercent: opt.yPercent,
                        isCorrect: opt.isCorrect
                    }));
                    quizContext.optionCount = data.quiz.options.length;
                    console.log(`[QuizSolver] ${data.quiz.options.length} options mapped`);
                }

                // Store correct answer
                if (data.quiz?.correctAnswer) {
                    quizContext.pendingActions = {
                        correctAnswer: data.quiz.correctAnswer,
                        explanation: data.quiz.explanation
                    };
                }

                sendStatus('layout-learned', {
                    quizType: quizContext.layout,
                    optionCount: quizContext.optionCount,
                    hasSubmit: !!quizContext.learnedPositions.submitButton,
                    correctAnswer: data.quiz?.correctAnswer
                });

                // CHECK PROVIDER - If OpenAI, STOP HERE (One-shot mode)
                const config = getConfig ? getConfig() : {};
                const provider = config.provider || 'openai';

                if (provider !== 'google') {
                    const answer = data.quiz?.correctAnswer || 'Unknown';
                    const explanation = data.quiz?.explanation || '';
                    console.log(`[QuizSolver] OpenAI One-Shot Mode: Answer is ${answer}. Stopping.`);

                    // Send specific status about the answer
                    sendStatus('openai-result', {
                        answer,
                        explanation,
                        message: `Answer: ${answer} (Auto-stopped for OpenAI)`
                    });

                    // Stop the solver
                    setTimeout(() => stop(), 500);
                    return;
                }

                // Go directly to ANSWERING (skip LEARNING_LAYOUT)
                setState(QuizState.ANSWERING);
                break;

            case 'video':
                // Video detected
                console.log('[QuizSolver] Video detected');
                quizContext.type = 'video';

                // Check for play/continue buttons using new format
                if (data.buttons?.play?.exists) {
                    console.log('[QuizSolver] Play button found, clicking');
                    const coords = calculateCoordinates(data.buttons.play, screenSize);
                    if (coords) {
                        await clickAt(coords, 'play button');
                    }
                    await new Promise(r => setTimeout(r, 2000));
                    setState(QuizState.SCANNING);
                } else if (data.buttons?.continue?.exists) {
                    console.log('[QuizSolver] Continue button found, clicking');
                    const coords = calculateCoordinates(data.buttons.continue, screenSize);
                    if (coords) {
                        await clickAt(coords, 'continue button');
                    }
                    await new Promise(r => setTimeout(r, 2000));
                    setState(QuizState.SCANNING);
                } else {
                    // Video playing - enter wait mode
                    const timeRemaining = data.video?.timeRemaining || 60;
                    console.log(`[QuizSolver] Video playing, entering wait for ${timeRemaining} seconds`);
                    await handleVideoWait(timeRemaining, '');
                }
                break;

            case 'instructions':
                // Instructions/reading material - look for next button
                console.log('[QuizSolver] Instructions detected');
                if (data.actionButtons?.next?.visible) {
                    console.log('[QuizSolver] Next button found, clicking');
                    const coords = calculateCoordinates(data.actionButtons.next, screenSize);
                    if (coords) {
                        await clickAt(coords, 'next button');
                    }
                    await new Promise(r => setTimeout(r, 1500));
                    setState(QuizState.SCANNING);
                } else if (data.actionButtons?.startQuiz?.visible) {
                    console.log('[QuizSolver] Start Quiz button found, clicking');
                    const coords = calculateCoordinates(data.actionButtons.startQuiz, screenSize);
                    if (coords) {
                        await clickAt(coords, 'start quiz button');
                    }
                    await new Promise(r => setTimeout(r, 1500));
                    setState(QuizState.SCANNING);
                } else {
                    sendStatus('waiting', { reason: 'Reading instructions, no action needed' });
                    // Wait and scan again
                }
                break;

            case 'results':
                // Quiz results - go to completed
                console.log('[QuizSolver] Results screen detected');
                setState(QuizState.QUIZ_COMPLETED);
                break;

            default:
                // Unknown content - just wait
                console.log('[QuizSolver] Unknown content, waiting');
                sendStatus('waiting', { reason: data.description || 'Analyzing screen' });
            // Stay in scanning to try again
        }

    } catch (error) {
        console.error('[QuizSolver] Classification error:', error);
        if (isActive) setState(QuizState.SCANNING);
    }
}

async function handleLearningLayout(screenshot, screenSize, language) {
    if (!isActive) return;
    sendStatus('learning-layout');
    console.log('[QuizSolver] Learning quiz layout...');

    try {
        const prompt = getLayoutLearningPrompt(language);
        const data = await analyzeScreen(screenshot, prompt);

        // Check if still active after AI call
        if (!isActive) return;

        if (!data || !data.isQuiz) {
            // Not a quiz, check for video or other content
            if (data?.isVideo || screenshot.windowTitle?.toLowerCase().includes('video')) {
                setState(QuizState.WAITING_FOR_VIDEO);
                return;
            }

            sendStatus('no-quiz', { reason: 'Not a quiz page' });
            quizContext.type = null;
            setState(QuizState.SCANNING);
            return;
        }

        // Learn the layout
        quizContext.type = data.quizType || 'multipleChoice';
        quizContext.optionCount = data.options?.length || 4;
        quizContext.currentQuestion = data.question;
        quizContext.confidence = 0.8;

        // Save learned positions
        if (data.options) {
            quizContext.learnedPositions.options = data.options.map(opt => ({
                letter: opt.letter,
                xPercent: opt.xPercent,
                yPercent: opt.yPercent
            }));
        }

        // Extract buttons with fallback for different naming conventions
        const extractButton = (buttonData) => {
            if (!buttonData?.exists) return null;
            return {
                xPercent: buttonData.xPercent,
                yPercent: buttonData.yPercent,
                text: buttonData.text || 'Unknown',
                width: buttonData.width,
                height: buttonData.height
            };
        };

        // Submit button (or confirm as fallback)
        if (data.buttons?.submit?.exists) {
            quizContext.learnedPositions.submitButton = extractButton(data.buttons.submit);
            console.log(`[QuizSolver] Learned SUBMIT button: "${data.buttons.submit.text}" at (${data.buttons.submit.xPercent}%, ${data.buttons.submit.yPercent}%)`);
        } else if (data.buttons?.confirm?.exists) {
            quizContext.learnedPositions.submitButton = extractButton(data.buttons.confirm);
            console.log(`[QuizSolver] Using CONFIRM button as submit: "${data.buttons.confirm.text}"`);
        }

        // Next button (or continue/finish as fallback)
        if (data.buttons?.next?.exists) {
            quizContext.learnedPositions.nextButton = extractButton(data.buttons.next);
            console.log(`[QuizSolver] Learned NEXT button: "${data.buttons.next.text}" at (${data.buttons.next.xPercent}%, ${data.buttons.next.yPercent}%)`);
        } else if (data.buttons?.continue?.exists) {
            quizContext.learnedPositions.nextButton = extractButton(data.buttons.continue);
            console.log(`[QuizSolver] Using CONTINUE button as next: "${data.buttons.continue.text}"`);
        } else if (data.buttons?.finish?.exists) {
            quizContext.learnedPositions.nextButton = extractButton(data.buttons.finish);
            console.log(`[QuizSolver] Using FINISH button as next: "${data.buttons.finish.text}"`);
        }

        // Skip button (optional)
        if (data.buttons?.skip?.exists) {
            quizContext.learnedPositions.skipButton = extractButton(data.buttons.skip);
            console.log(`[QuizSolver] Learned SKIP button: "${data.buttons.skip.text}"`);
        }

        // Log button summary
        console.log('[QuizSolver] Button summary:', {
            hasSubmit: !!quizContext.learnedPositions.submitButton,
            hasNext: !!quizContext.learnedPositions.nextButton,
            hasSkip: !!quizContext.learnedPositions.skipButton
        });

        if (data.textInput?.exists) {
            quizContext.learnedPositions.textInputField = {
                xPercent: data.textInput.xPercent,
                yPercent: data.textInput.yPercent,
                width: data.textInput.width,
                height: data.textInput.height
            };
            console.log('[QuizSolver] Learned text input field');
        }

        if (data.scroll?.needed) {
            quizContext.learnedPositions.scrollArea = {
                direction: data.scroll.direction || 'down'
            };
            console.log('[QuizSolver] Scrolling may be needed:', data.scroll.direction);
        }

        // Save to memory for future sessions
        quizMemory.saveSection({
            type: quizContext.type,
            optionCount: quizContext.optionCount,
            layout: data.layout?.optionsArea ? 'vertical' : 'horizontal',
            options: quizContext.learnedPositions.options,
            submitButton: quizContext.learnedPositions.submitButton,
            nextButton: quizContext.learnedPositions.nextButton,
            confidence: 0.8
        });

        stats.cacheMisses++;

        // Now answer the question
        sendStatus('quiz-detected', {
            type: quizContext.type,
            question: data.question,
            correctAnswer: data.correctAnswer,
            optionCount: quizContext.optionCount,
            hasSubmitButton: !!quizContext.learnedPositions.submitButton,
            hasNextButton: !!quizContext.learnedPositions.nextButton
        });

        // Find and click the correct answer
        const correctOption = data.options?.find(o => o.isCorrect);
        if (correctOption) {
            const coords = calculateCoordinates(correctOption, screenSize);
            if (coords) {
                await clickAt(coords, `answer ${correctOption.letter}`);
                quizContext.lastQuestion = data.question;
                quizContext.questionsAnswered++;
                stats.totalAnswered++;

                // Queue next actions
                if (quizContext.learnedPositions.submitButton) {
                    setState(QuizState.CLICKING_SUBMIT);
                } else if (quizContext.learnedPositions.nextButton) {
                    setState(QuizState.CLICKING_NEXT);
                } else {
                    setState(QuizState.WAITING_FOR_CHANGE);
                }
            }
        } else if (data.textInput?.exists && data.correctAnswer) {
            // Text input quiz
            const coords = calculateCoordinates(data.textInput, screenSize);
            if (coords) {
                await clickAt(coords, 'text input field');
                await typeText(data.correctAnswer);

                if (quizContext.learnedPositions.submitButton) {
                    setState(QuizState.CLICKING_SUBMIT);
                } else {
                    setState(QuizState.WAITING_FOR_CHANGE);
                }
            }
        }

    } catch (error) {
        console.error('[QuizSolver] Layout learning failed:', error);
        sendStatus('error', { message: error.message });
        setState(QuizState.SCANNING);
    }
}

async function handleAnswering(screenshot, screenSize, language) {
    if (!isActive) return;
    sendStatus('answering');

    // Use positions and answer already saved from unified analysis - NO AI CALL NEEDED
    if (quizContext.learnedPositions.options?.length > 0 && quizContext.pendingActions?.correctAnswer) {
        console.log('[QuizSolver] Using saved positions and answer - NO AI call');
        stats.cacheHits++;
        stats.positionReuses++;

        const correctAnswer = quizContext.pendingActions.correctAnswer;
        const explanation = quizContext.pendingActions.explanation || '';

        // Find option by letter (A, B, C, D) or by isCorrect flag
        let position = null;

        // First try to find by isCorrect flag
        position = quizContext.learnedPositions.options.find(opt => opt.isCorrect);

        // Fallback to finding by letter
        if (!position && correctAnswer) {
            position = quizContext.learnedPositions.options.find(
                opt => opt.letter?.toUpperCase() === correctAnswer.toUpperCase()
            );
        }

        // Fallback to index
        if (!position && correctAnswer) {
            const optionIndex = correctAnswer.toUpperCase().charCodeAt(0) - 65; // A=0, B=1, etc.
            if (optionIndex >= 0 && optionIndex < quizContext.learnedPositions.options.length) {
                position = quizContext.learnedPositions.options[optionIndex];
            }
        }

        if (position) {
            const coords = calculateCoordinates(position, screenSize);
            if (coords) {
                sendStatus('quiz-detected', {
                    type: quizContext.type,
                    correctAnswer: correctAnswer,
                    explanation: explanation,
                    usingCache: true
                });

                await clickAt(coords, `answer ${correctAnswer}`);
                quizContext.questionsAnswered++;
                stats.totalAnswered++;

                // Store answered question to avoid re-answering
                if (quizContext.currentQuestion) {
                    quizContext.answeredQuestions = quizContext.answeredQuestions || [];
                    quizContext.answeredQuestions.push(quizContext.currentQuestion);
                }

                // Proceed to submit or next - use saved positions, NO AI call
                if (quizContext.learnedPositions.submitButton) {
                    setState(QuizState.CLICKING_SUBMIT);
                } else if (quizContext.learnedPositions.nextButton) {
                    setState(QuizState.CLICKING_NEXT);
                } else {
                    setState(QuizState.WAITING_FOR_CHANGE);
                }
                return;
            }
        }

        console.log('[QuizSolver] Could not find position for answer:', correctAnswer);
    }

    // No saved data - need to go back to classification (this shouldn't happen normally)
    console.log('[QuizSolver] No saved positions/answer, re-classifying');
    stats.cacheMisses++;
    setState(QuizState.CLASSIFYING);
}

async function handleWaitingForChange(screenshot, screenSize, language, screenChanged) {
    // Check if still active before proceeding
    if (!isActive) {
        console.log('[QuizSolver] Inactive, stopping wait handler');
        return;
    }

    if (screenChanged) {
        console.log('[QuizSolver] Screen changed, checking new content');

        // Quick check what changed
        try {
            const prompt = getQuickCheckPrompt(language);
            const data = await analyzeScreen(screenshot, prompt);

            // Check if still active after AI call
            if (!isActive) return;

            // Handle Continue Watching button (for videos)
            if (data?.buttonsVisible?.continueWatching && data?.continueButton) {
                console.log('[QuizSolver] Continue Watching button detected, clicking');
                sendStatus('clicking-continue', { reason: 'Resuming video' });
                const coords = calculateCoordinates(data.continueButton, screenSize);
                if (coords) {
                    await clickAt(coords, 'continue watching button');
                }
                setState(QuizState.WAITING_FOR_CHANGE);
                return;
            }

            // Handle video detected
            if (data?.isVideo) {
                console.log('[QuizSolver] Video detected, going to scanning');
                setState(QuizState.SCANNING);
                return;
            }

            if (data?.quizEnded) {
                console.log('[QuizSolver] Quiz ended detected!');
                if (data.buttonsVisible?.finish) {
                    // Need to click finish button first
                    setState(QuizState.CLICKING_FINISH);
                } else {
                    // Quiz already completed, go directly to reset
                    setState(QuizState.QUIZ_COMPLETED);
                }
            } else if (data?.questionChanged) {
                console.log('[QuizSolver] New question detected');
                quizContext.currentQuestion = data.newQuestion;
                setState(QuizState.ANSWERING);
            } else if (data?.buttonsVisible?.finish) {
                // Finish button visible but quiz not explicitly ended - might be last question
                console.log('[QuizSolver] Finish button detected, clicking to complete quiz');
                setState(QuizState.CLICKING_FINISH);
            } else if (data?.buttonsVisible?.submit) {
                setState(QuizState.CLICKING_SUBMIT);
            } else if (data?.buttonsVisible?.next) {
                setState(QuizState.CLICKING_NEXT);
            } else {
                setState(QuizState.SCANNING);
            }
        } catch (error) {
            if (isActive) setState(QuizState.SCANNING);
        }
    } else {
        sendStatus('waiting', { reason: 'Waiting for page change' });

        // Check if stuck
        if (unchangedScreenCount >= MAX_UNCHANGED_BEFORE_STUCK) {
            setState(QuizState.STUCK_RECOVERY);
        }
    }
}

async function handleClickingSubmit(screenSize) {
    if (!isActive) return;

    // Use saved position directly - NO AI CALL for validation
    if (quizContext.learnedPositions.submitButton) {
        sendStatus('clicking-submit');
        console.log('[QuizSolver] Using saved submit button position - NO AI call');

        const coords = calculateCoordinates(quizContext.learnedPositions.submitButton, screenSize);
        if (coords) {
            await clickAt(coords, 'submit button');
        }
    }

    await new Promise(r => setTimeout(r, POST_ACTION_DELAY));

    // Clear pending actions since we submitted the answer
    quizContext.pendingActions = null;

    // After submit, check if we have a next button saved - click it
    if (quizContext.learnedPositions.nextButton) {
        console.log('[QuizSolver] Next button position saved, clicking it');
        setState(QuizState.CLICKING_NEXT);
    } else {
        // No next button - wait for screen to change
        setState(QuizState.WAITING_FOR_CHANGE);
    }
}

async function handleClickingNext(screenSize) {
    if (!isActive) return;

    // Use saved position directly - NO AI CALL for validation
    if (quizContext.learnedPositions.nextButton) {
        sendStatus('clicking-next');
        console.log('[QuizSolver] Using saved next button position - NO AI call');

        const coords = calculateCoordinates(quizContext.learnedPositions.nextButton, screenSize);
        if (coords) {
            await clickAt(coords, 'next button');
        }
    }

    await new Promise(r => setTimeout(r, POST_ACTION_DELAY));

    // Clear context for new question
    quizContext.pendingActions = null;

    setState(QuizState.WAITING_FOR_CHANGE);
}

/**
 * Handle clicking the finish/complete button at the end of a quiz
 */
async function handleClickingFinish(screenSize) {
    if (!isActive) return;

    if (quizContext.learnedPositions.finishButton) {
        sendStatus('clicking-finish');
        console.log('[QuizSolver] Clicking finish button to complete quiz');

        // Take a fresh screenshot for validation
        const screenshot = await screenCapture.captureFullScreen();
        if (screenshot.error) {
            console.log('[QuizSolver] Screenshot error, using cached position');
        } else {
            // Validate button position before clicking
            const validatedPos = await validateButtonPosition(
                quizContext.learnedPositions.finishButton,
                'finish',
                screenshot,
                screenSize
            );

            if (validatedPos) {
                quizContext.learnedPositions.finishButton = validatedPos;
            }
            // For finish, we continue even if not found (might already be done)
        }

        const coords = calculateCoordinates(quizContext.learnedPositions.finishButton, screenSize);
        if (coords) {
            await clickAt(coords, 'finish button');
        }
    }

    await new Promise(r => setTimeout(r, POST_ACTION_DELAY));
    setState(QuizState.QUIZ_COMPLETED);
}

/**
 * Handle quiz completion - reset context and go back to scanning
 */
async function handleQuizCompleted(screenshot, screenSize, language) {
    console.log('[QuizSolver] Quiz completed! Resetting context and scanning for new content');
    sendStatus('quiz-completed', {
        questionsAnswered: quizContext.questionsAnswered,
        totalAnswered: stats.totalAnswered
    });

    // Reset quiz context for next quiz
    quizContext.type = null;
    quizContext.layout = null;
    quizContext.optionCount = 0;
    quizContext.learnedPositions = {
        options: [],
        submitButton: null,
        nextButton: null,
        finishButton: null,
        skipButton: null,
        scrollArea: null,
        questionArea: null,
        textInputField: null
    };
    quizContext.questionsAnswered = 0;
    quizContext.lastQuestion = null;
    quizContext.currentQuestion = null;
    quizContext.pendingActions = [];
    quizContext.confidence = 0.5;

    // Reset screenshot tracking to force fresh analysis
    lastScreenshotHash = null;
    unchangedScreenCount = 0;

    // Wait a moment then go back to scanning
    await new Promise(r => setTimeout(r, 2000));
    setState(QuizState.SCANNING);
}

async function handleScrolling() {
    sendStatus('scrolling');
    const direction = quizContext.learnedPositions.scrollArea?.direction || 'down';
    await scrollPage(direction);
    setState(QuizState.SCANNING);
}

async function handleStuckRecovery(screenshot, screenSize, language) {
    stats.stuckRecoveries++;
    sendStatus('stuck-recovery');
    console.log('[QuizSolver] Attempting stuck recovery');

    // Try various recovery strategies

    // 1. Try clicking submit button if we have it
    if (quizContext.learnedPositions.submitButton) {
        const coords = calculateCoordinates(quizContext.learnedPositions.submitButton, screenSize);
        if (coords) {
            console.log('[QuizSolver] Recovery: clicking submit');
            await clickAt(coords, 'submit button (recovery)');
            await new Promise(r => setTimeout(r, 1000));
            unchangedScreenCount = 0;
            setState(QuizState.WAITING_FOR_CHANGE);
            return;
        }
    }

    // 2. Try clicking next button
    if (quizContext.learnedPositions.nextButton) {
        const coords = calculateCoordinates(quizContext.learnedPositions.nextButton, screenSize);
        if (coords) {
            console.log('[QuizSolver] Recovery: clicking next');
            await clickAt(coords, 'next button (recovery)');
            await new Promise(r => setTimeout(r, 1000));
            unchangedScreenCount = 0;
            setState(QuizState.WAITING_FOR_CHANGE);
            return;
        }
    }

    // 3. Try scrolling
    console.log('[QuizSolver] Recovery: scrolling');
    await scrollPage('down');
    await new Promise(r => setTimeout(r, 500));

    // 4. Do a fresh analysis
    console.log('[QuizSolver] Recovery: fresh analysis');
    quizContext.type = null;
    unchangedScreenCount = 0;
    setState(QuizState.LEARNING_LAYOUT);
}

// ==========================================
// VIDEO HANDLING - SILENT WAIT MODE
// ==========================================

/**
 * Handle video wait - INTELLIGENT MONITORING
 * Periodically jiggles mouse to reveal controls and checks for quiz appearance
 * Uses safe jiggle that returns mouse to original position
 */
async function handleVideoWait(seconds, timerText) {
    setState(QuizState.WAITING_FOR_VIDEO);

    // Stop the regular cycle
    if (cycleInterval) {
        clearInterval(cycleInterval);
        cycleInterval = null;
    }

    console.log(`[QuizSolver] Entering VIDEO WAIT (estimated ${seconds}s)`);
    sendStatus('waiting-for-video', {
        seconds: seconds,
        timerText: timerText || '',
        monitoring: true
    });

    const startTime = Date.now();
    const estimatedEndTime = startTime + (seconds * 1000) + 2000; // Add 2 second buffer
    let lastJiggleTime = startTime;
    let lastCheckTime = startTime;
    let checkCount = 0;

    const videoMonitorLoop = async () => {
        if (!isActive) {
            console.log('[QuizSolver] Inactive during video wait, stopping');
            return;
        }

        const now = Date.now();
        const elapsed = now - startTime;
        const remaining = Math.ceil((estimatedEndTime - now) / 1000);

        // Periodic mouse jiggle to reveal video controls (every VIDEO_JIGGLE_INTERVAL)
        if (now - lastJiggleTime >= VIDEO_JIGGLE_INTERVAL) {
            lastJiggleTime = now;
            await doMouseJiggle(true); // Force jiggle during video wait
        }

        // Periodic check if quiz appeared or video ended (every VIDEO_CHECK_INTERVAL)
        // Skip first check if we just started (give video time to play)
        if (elapsed >= VIDEO_MIN_WAIT && now - lastCheckTime >= VIDEO_CHECK_INTERVAL) {
            lastCheckTime = now;
            checkCount++;

            console.log(`[QuizSolver] Video check #${checkCount}, ${remaining}s estimated remaining`);

            try {
                const screenshot = await screenCapture.captureFullScreen();

                if (!screenshot.error) {
                    const config = getConfig();
                    const language = config.language || 'en';

                    const checkPrompt = language === 'pt-br'
                        ? `Verifique o estado atual da tela. Retorne APENAS JSON:
{
    "screenType": "video" | "quiz" | "instructions" | "other",
    "videoPlaying": true/false,
    "videoEnded": true/false,
    "timeRemaining": número em segundos ou null,
    "hasQuizNow": true/false,
    "continueButton": {"xPercent": X, "yPercent": Y, "text": "texto"} ou null,
    "playButton": {"xPercent": X, "yPercent": Y} ou null
}`
                        : `Check current screen state. Return ONLY JSON:
{
    "screenType": "video" | "quiz" | "instructions" | "other",
    "videoPlaying": true/false,
    "videoEnded": true/false,
    "timeRemaining": seconds or null,
    "hasQuizNow": true/false,
    "continueButton": {"xPercent": X, "yPercent": Y, "text": "text"} or null,
    "playButton": {"xPercent": X, "yPercent": Y} or null
}`;

                    const result = await analyzeScreen(screenshot, checkPrompt);

                    if (!isActive) return; // Check again after AI call

                    // Quiz detected! Resume immediately
                    if (result?.hasQuizNow || result?.screenType === 'quiz') {
                        console.log('[QuizSolver] Quiz detected during video wait!');
                        resumeFromVideoWait('Quiz detected');
                        return;
                    }

                    // Video ended - click continue if available
                    if (result?.videoEnded || result?.continueButton) {
                        console.log('[QuizSolver] Video ended, resuming');

                        if (result.continueButton) {
                            const screenSize = { width: screenshot.screenWidth, height: screenshot.screenHeight };
                            const coords = calculateCoordinates(result.continueButton, screenSize);
                            if (coords) {
                                await clickAt(coords, 'continue button');
                                await new Promise(r => setTimeout(r, 1500));
                            }
                        }

                        resumeFromVideoWait('Video completed');
                        return;
                    }

                    // Update time remaining if available
                    if (result?.timeRemaining && result.timeRemaining > 0) {
                        sendStatus('waiting-for-video', {
                            seconds: result.timeRemaining,
                            timerText: '',
                            checking: true,
                            checkCount: checkCount
                        });
                    }

                    // If video is paused and play button visible, click it
                    if (result?.videoPlaying === false && result?.playButton) {
                        console.log('[QuizSolver] Video paused, clicking play');
                        const screenSize = { width: screenshot.screenWidth, height: screenshot.screenHeight };
                        const coords = calculateCoordinates(result.playButton, screenSize);
                        if (coords) {
                            await clickAt(coords, 'play button');
                        }
                    }
                }
            } catch (e) {
                console.log('[QuizSolver] Video check error:', e.message);
            }
        }

        // Timer finished - resume scanning
        if (now >= estimatedEndTime) {
            console.log('[QuizSolver] Estimated video time complete, resuming');
            resumeFromVideoWait('Timer completed');
            return;
        }

        // Log progress every 30 seconds
        if (remaining > 0 && remaining % 30 === 0) {
            console.log(`[QuizSolver] Video wait: ${remaining}s remaining (check #${checkCount})`);
        }

        // Continue monitoring - check every 5 seconds
        resumeTimeout = setTimeout(videoMonitorLoop, 5000);
    };

    // Start the monitoring loop
    videoMonitorLoop();
}

/**
 * Resume quiz solving after video wait
 */
function resumeFromVideoWait(reason) {
    console.log(`[QuizSolver] Resuming from video wait: ${reason}`);
    sendStatus('video-complete', { message: reason });

    // Reset context to force fresh classification
    quizContext.type = null;
    lastScreenshotHash = null;
    unchangedScreenCount = 0;

    setState(QuizState.SCANNING);
    cycleInterval = setInterval(performCycle, DEFAULT_CYCLE_INTERVAL);
    performCycle();
}

// ==========================================
// PUBLIC API
// ==========================================

async function start(interval = DEFAULT_CYCLE_INTERVAL) {
    if (isActive) {
        return { success: false, error: 'Already active' };
    }

    const mouseCheck = await mouseControl.checkAvailability();
    if (!mouseCheck.available) {
        return { success: false, error: mouseCheck.error };
    }

    console.log(`[QuizSolver] Starting with ${interval}ms interval`);

    // Reset state
    isActive = true;
    currentState = QuizState.SCANNING;
    previousState = null;
    lastScreenshotHash = null;
    unchangedScreenCount = 0;

    // Reset context - COMPLETE reset of all learned positions
    quizContext = {
        type: null,
        layout: null,
        optionCount: 0,
        learnedPositions: {
            options: [],
            submitButton: null,
            nextButton: null,
            finishButton: null,
            skipButton: null,
            scrollArea: null,
            questionArea: null,
            textInputField: null
        },
        questionsAnswered: 0,
        lastQuestion: null,
        currentQuestion: null,
        pendingActions: [],
        confidence: 0.5
    };

    console.log('[QuizSolver] Context fully reset - all button positions cleared');

    // Reset stats
    stats = {
        totalAnswered: 0,
        cacheHits: 0,
        cacheMisses: 0,
        aiCalls: 0,
        positionReuses: 0,
        stuckRecoveries: 0
    };

    sendStatus('started', { tool: mouseCheck.tool });

    cycleInterval = setInterval(performCycle, interval);
    performCycle();

    // Get current provider to warn user if not using Gemini
    const config = getConfig ? getConfig() : {};
    const provider = config.provider || 'openai';

    return { success: true, tool: mouseCheck.tool, provider };
}

function stop() {
    if (!isActive) {
        return { success: false, error: 'Not active' };
    }

    console.log('[QuizSolver] Stopping');
    console.log(`[QuizSolver] Stats: ${stats.totalAnswered} answered, ${stats.aiCalls} AI calls, ${stats.positionReuses} position reuses`);

    isActive = false;
    isBusy = false;  // Release busy lock
    currentState = QuizState.IDLE;

    if (cycleInterval) {
        clearInterval(cycleInterval);
        cycleInterval = null;
    }

    if (resumeTimeout) {
        clearTimeout(resumeTimeout);
        resumeTimeout = null;
    }

    sendStatus('stopped', {
        stats,
        questionsAnswered: quizContext.questionsAnswered
    });

    return { success: true };
}

function getIsActive() {
    return isActive;
}

function getStats() {
    return { ...stats, questionsAnswered: quizContext.questionsAnswered };
}

function getContext() {
    return { ...quizContext };
}

module.exports = {
    initialize,
    start,
    stop,
    isActive: getIsActive,
    getStats,
    getContext,
    QuizState
};
