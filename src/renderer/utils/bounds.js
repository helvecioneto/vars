/**
 * VARS - Bounds Tracking Module
 * With the full-screen transparent overlay, bounds tracking is no longer needed.
 * The window covers the entire screen and click-through is managed per-component.
 */

/**
 * Start tracking bounds (no-op for overlay mode)
 */
export function startBoundsTracking() {
    // No-op: window is now a full-screen transparent overlay
    // Click-through is managed by mouseenter/mouseleave on each component
    console.log('[Bounds] Skipped — overlay mode');
}
