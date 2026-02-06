/**
 * VARS - Quiz Memory Module
 * Stores and retrieves quiz section characteristics for intelligent caching
 * and reduced token usage during quiz solving.
 */

const crypto = require('crypto');

// In-memory storage for quiz sections
const quizSections = new Map();

// Configuration
const MAX_SECTIONS = 50; // Maximum number of sections to cache
const POSITION_TOLERANCE = 5; // Percentage tolerance for position matching
const SECTION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Quiz types supported by the system
 */
const QuizType = {
    TRUE_FALSE: 'trueFalse',
    MULTIPLE_CHOICE: 'multipleChoice',
    TEXT_INPUT: 'textInput',
    EVALUATION: 'evaluation',
    VIDEO: 'video',
    UNKNOWN: 'unknown'
};

/**
 * Layout types for quiz display
 */
const LayoutType = {
    VERTICAL: 'vertical',
    HORIZONTAL: 'horizontal',
    GRID: 'grid'
};

/**
 * Generate a unique hash for a quiz section based on its visual characteristics
 * @param {object} characteristics - Section visual characteristics
 * @returns {string} Hash identifier
 */
function generateSectionHash(characteristics) {
    const data = JSON.stringify({
        type: characteristics.type,
        optionCount: characteristics.optionCount,
        layout: characteristics.layout,
        // Use rounded position data for fuzzy matching
        questionAreaTop: Math.round((characteristics.questionArea?.yPercent || 0) / 10) * 10,
        optionAreaTop: Math.round((characteristics.optionArea?.yPercent || 0) / 10) * 10
    });
    return crypto.createHash('md5').update(data).digest('hex').substring(0, 12);
}

/**
 * Create a new quiz section object
 * @param {object} data - Section data from AI analysis
 * @returns {object} QuizSection object
 */
function createSection(data) {
    return {
        id: generateSectionHash(data),
        type: data.type || QuizType.UNKNOWN,
        optionCount: data.optionCount || 0,
        layout: data.layout || LayoutType.VERTICAL,

        // Cached positions (percentages)
        positions: {
            options: data.options || [],
            submitButton: data.submitButton || null,
            nextButton: data.nextButton || null,
            scrollArea: data.scrollArea || null,
            questionArea: data.questionArea || null,
            textInputField: data.textInputField || null
        },

        // Metadata
        createdAt: Date.now(),
        lastUsed: Date.now(),
        successCount: 0,
        failureCount: 0,
        confidence: data.confidence || 0.5
    };
}

/**
 * Find a matching cached section based on current screen characteristics
 * @param {object} screenContext - Current screen visual characteristics
 * @returns {object|null} Matching section or null
 */
function findMatchingSection(screenContext) {
    const hash = generateSectionHash(screenContext);

    // Direct hash match
    if (quizSections.has(hash)) {
        const section = quizSections.get(hash);

        // Check if section is expired
        if (Date.now() - section.lastUsed > SECTION_EXPIRY_MS) {
            quizSections.delete(hash);
            console.log(`[QuizMemory] Section ${hash} expired, removed from cache`);
            return null;
        }

        section.lastUsed = Date.now();
        console.log(`[QuizMemory] Cache HIT for section ${hash}`);
        return section;
    }

    // Fuzzy matching - find similar sections
    for (const [id, section] of quizSections) {
        if (section.type === screenContext.type &&
            section.optionCount === screenContext.optionCount &&
            section.layout === screenContext.layout) {

            // Check if positions are within tolerance
            if (arePositionsSimilar(section.positions, screenContext.positions)) {
                section.lastUsed = Date.now();
                console.log(`[QuizMemory] Fuzzy match found for section ${id}`);
                return section;
            }
        }
    }

    console.log(`[QuizMemory] Cache MISS - no matching section found`);
    return null;
}

/**
 * Check if two position sets are similar within tolerance
 * @param {object} cached - Cached positions
 * @param {object} current - Current positions
 * @returns {boolean}
 */
function arePositionsSimilar(cached, current) {
    if (!cached || !current) return false;

    // Check question area position
    if (cached.questionArea && current.questionArea) {
        const yDiff = Math.abs((cached.questionArea.yPercent || 0) - (current.questionArea.yPercent || 0));
        if (yDiff > POSITION_TOLERANCE) return false;
    }

    // Check first option position as reference
    if (cached.options?.[0] && current.options?.[0]) {
        const xDiff = Math.abs(cached.options[0].xPercent - current.options[0].xPercent);
        const yDiff = Math.abs(cached.options[0].yPercent - current.options[0].yPercent);
        if (xDiff > POSITION_TOLERANCE || yDiff > POSITION_TOLERANCE) return false;
    }

    return true;
}

/**
 * Save a new quiz section to memory
 * @param {object} sectionData - Section data from AI analysis
 * @returns {object} Saved section
 */
function saveSection(sectionData) {
    // Enforce max sections limit
    if (quizSections.size >= MAX_SECTIONS) {
        evictOldestSection();
    }

    const section = createSection(sectionData);
    quizSections.set(section.id, section);

    console.log(`[QuizMemory] Saved section ${section.id} (type: ${section.type}, options: ${section.optionCount})`);
    return section;
}

/**
 * Update positions for an existing section after successful interaction
 * @param {string} sectionId - Section ID
 * @param {object} positions - Updated positions
 */
function updatePositions(sectionId, positions) {
    const section = quizSections.get(sectionId);
    if (section) {
        section.positions = { ...section.positions, ...positions };
        section.lastUsed = Date.now();
        console.log(`[QuizMemory] Updated positions for section ${sectionId}`);
    }
}

/**
 * Record a successful interaction with a section
 * @param {string} sectionId - Section ID
 */
function recordSuccess(sectionId) {
    const section = quizSections.get(sectionId);
    if (section) {
        section.successCount++;
        section.lastUsed = Date.now();
        // Increase confidence on success
        section.confidence = Math.min(1.0, section.confidence + 0.1);
        console.log(`[QuizMemory] Success recorded for ${sectionId} (total: ${section.successCount})`);
    }
}

/**
 * Record a failed interaction with a section
 * @param {string} sectionId - Section ID
 */
function recordFailure(sectionId) {
    const section = quizSections.get(sectionId);
    if (section) {
        section.failureCount++;
        // Decrease confidence on failure
        section.confidence = Math.max(0.1, section.confidence - 0.2);

        // Invalidate section if too many failures
        if (section.failureCount >= 3) {
            quizSections.delete(sectionId);
            console.log(`[QuizMemory] Section ${sectionId} invalidated due to failures`);
        } else {
            console.log(`[QuizMemory] Failure recorded for ${sectionId} (total: ${section.failureCount})`);
        }
    }
}

/**
 * Invalidate a section, forcing re-analysis on next encounter
 * @param {string} sectionId - Section ID
 */
function invalidateSection(sectionId) {
    if (quizSections.has(sectionId)) {
        quizSections.delete(sectionId);
        console.log(`[QuizMemory] Section ${sectionId} invalidated`);
    }
}

/**
 * Evict the oldest/least used section to make room for new ones
 */
function evictOldestSection() {
    let oldestId = null;
    let oldestTime = Date.now();

    for (const [id, section] of quizSections) {
        if (section.lastUsed < oldestTime) {
            oldestTime = section.lastUsed;
            oldestId = id;
        }
    }

    if (oldestId) {
        quizSections.delete(oldestId);
        console.log(`[QuizMemory] Evicted oldest section ${oldestId}`);
    }
}

/**
 * Clear all cached sections
 */
function clearAll() {
    const count = quizSections.size;
    quizSections.clear();
    console.log(`[QuizMemory] Cleared ${count} sections from cache`);
}

/**
 * Get statistics about the cache
 * @returns {object} Cache statistics
 */
function getStats() {
    let totalSuccesses = 0;
    let totalFailures = 0;
    const typeCount = {};

    for (const section of quizSections.values()) {
        totalSuccesses += section.successCount;
        totalFailures += section.failureCount;
        typeCount[section.type] = (typeCount[section.type] || 0) + 1;
    }

    return {
        sectionCount: quizSections.size,
        maxSections: MAX_SECTIONS,
        totalSuccesses,
        totalFailures,
        typeCount,
        hitRate: totalSuccesses / (totalSuccesses + totalFailures) || 0
    };
}

/**
 * Get section by ID
 * @param {string} sectionId - Section ID
 * @returns {object|null} Section or null
 */
function getSection(sectionId) {
    return quizSections.get(sectionId) || null;
}

/**
 * Check if section has high confidence (reliable cached positions)
 * @param {string} sectionId - Section ID
 * @returns {boolean}
 */
function hasHighConfidence(sectionId) {
    const section = quizSections.get(sectionId);
    return section ? section.confidence >= 0.7 && section.successCount >= 2 : false;
}

module.exports = {
    QuizType,
    LayoutType,
    findMatchingSection,
    saveSection,
    updatePositions,
    recordSuccess,
    recordFailure,
    invalidateSection,
    clearAll,
    getStats,
    getSection,
    hasHighConfidence,
    generateSectionHash
};
