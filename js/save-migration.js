import * as Ladder from "./puzzle/ladder.js";

/**
 * Save-format versioning.
 *
 * Pure functions, no storage access, so migration can be checked without
 * touching localStorage -- which matters, because a migration bug corrupts real
 * players' progress and is the one thing you cannot hotfix after the fact.
 *
 * The rule: every save carries a version, migration only ever moves forward one
 * step at a time, and an unrecognised or newer version is discarded rather than
 * guessed at. There is one version so far and so nothing to step through yet; the
 * loop is here because the first document written in the wild is the one that has
 * to be readable by every build after it.
 *
 * Version history
 *   1  Progress, lifetime totals, the clean-run streak, and the level in
 *      progress with its undo history.
 */

export const CURRENT_VERSION = 1;

export function migrate(data) {
	const version = Number(data?.version ?? 0);
	if (version <= 0 || version > CURRENT_VERSION) {
		// Either not one of ours, or written by a build newer than this one. A
		// newer save may use fields we would silently drop, so start clean rather
		// than corrupt it.
		return emptyDocument();
	}
	return normalize(clone(data));
}

export function emptyDocument() {
	return { version: CURRENT_VERSION, session: {}, stats: emptyStats() };
}

export function emptyStats() {
	return {
		progress: emptyProgress(),
		totals: emptyTotals(),
		streak: emptyStreak(),
		seen: emptySeen(),
	};
}

/**
 * `level` is the furthest the player has reached and only ever climbs. `playing`
 * is the level they are on now, which a difficulty button can move backwards.
 */
export function emptyProgress() {
	return { level: Ladder.FIRST_LEVEL, playing: Ladder.FIRST_LEVEL, completed: 0 };
}

export function emptyTotals() {
	return { moves: 0, seconds: 0, clean: 0 };
}

/**
 * Levels finished in a row without undoing a pour or taking an extra tube.
 *
 * It counts levels rather than days, which is a thing the player can feel while
 * playing, and it needs no date handling at all -- no timezone edge cases, no
 * clock to trust.
 */
export function emptyStreak() {
	return { current: 0, best: 0 };
}

/**
 * Fingerprints of boards already served, and the colour count they belong to.
 *
 * Only one colour count is ever tracked. The ladder never sends a player back to
 * fewer colours, so the moment a colour is added every fingerprint below it is
 * unreachable and gets dropped.
 */
export function emptySeen() {
	return { colours: 0, prints: [] };
}

/**
 * Fills in anything a partially written or hand-edited save is missing, so the
 * rest of the game can read fields without guarding every one.
 */
export function normalize(document) {
	document.version = CURRENT_VERSION;
	if (!isObject(document.session)) document.session = {};
	if (!isObject(document.stats)) document.stats = emptyStats();

	const stats = document.stats;
	// A save from before the two levels were separate has only the furthest one,
	// which is also where its player left off.
	if (isObject(stats.progress) && !("playing" in stats.progress) && "level" in stats.progress) {
		stats.progress.playing = stats.progress.level;
	}
	fill(stats, "progress", emptyProgress());
	fill(stats, "totals", emptyTotals());
	fill(stats, "streak", emptyStreak());
	fill(stats, "seen", emptySeen());
	if (!Array.isArray(stats.seen.prints)) stats.seen.prints = [];
	stats.progress.level = Math.max(Number(stats.progress.level), Ladder.FIRST_LEVEL);
	stats.progress.playing = Math.max(Number(stats.progress.playing), Ladder.FIRST_LEVEL);
	// Starting a level is what puts it in reach, so the furthest reached can never
	// be behind the one being played.
	stats.progress.level = Math.max(stats.progress.level, stats.progress.playing);
	return document;
}

/** Replaces a missing or broken block wholesale, and tops up a partial one. */
function fill(stats, name, defaults) {
	if (!isObject(stats[name])) {
		stats[name] = defaults;
		return;
	}
	for (const field of Object.keys(defaults)) {
		if (!(field in stats[name])) stats[name][field] = defaults[field];
	}
}

/**
 * A save document is plain JSON by construction, so a round trip through it is an
 * exact copy -- and unlike structuredClone it works on every runtime the
 * self-check might run under.
 */
function clone(data) {
	return JSON.parse(JSON.stringify(data));
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
