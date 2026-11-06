// Tasks already finished before their issues existed. apply.mjs creates these issues and closes them
// with a note, so the roadmap history stays complete. Keys must match tasks in ROADMAP.md.

export const DONE = {};

/**
 * Roadmap items that moved to the theme project (ADR 0009). The old roadmap's items were closed as superseded
 * when the v0.1.0 roadmap replaced it, so nothing is left to move.
 */
export const MOVED_TO_THEME = [];
