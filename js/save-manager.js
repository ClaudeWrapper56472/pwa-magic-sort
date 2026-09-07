import * as Ladder from "./puzzle/ladder.js";
import * as Migration from "./save-migration.js";
import { Emitter } from "./util/emitter.js";

/**
 * Reads and writes the save document in localStorage.
 *
 * Two jobs, kept together because they share a document: the level in progress,
 * and lifetime figures.
 *
 * Saving is driven by an event rather than a direct call. SaveManager announces
 * "I am about to write", whoever owns live state hands it over, and the write
 * happens. That keeps this file free of any knowledge of GameState, and it means
 * a second system with state to persist only has to listen.
 *
 * localStorage.setItem is already all-or-nothing, so there is no torn write to
 * defend against. What does need care is *when* we write: a browser tab can be
 * discarded without warning, so every hook that might be the last one flushes.
 *
 * Emits: saveRequested(), statsChanged(), sessionAvailable(available)
 */
export class SaveManager extends Emitter {
	static STORAGE_KEY = "pour.save";

	/** How many past boards to remember at the current colour count. */
	static SEEN_LIMIT = 300;

	constructor(settings) {
		super();
		this._settings = settings;
		this._document = Migration.emptyDocument();
		this._loaded = false;
	}

	/**
	 * Browsers give no warning before a background tab is discarded, so every
	 * hook that might be the last one we get writes the document.
	 *
	 *   visibilitychange -> hidden   backgrounded, or the screen locked
	 *   pagehide                     navigating away or being unloaded
	 *   freeze                       the browser is suspending the tab entirely
	 */
	installSuspendHooks() {
		const flush = () => this.flush();
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") flush();
		});
		window.addEventListener("pagehide", flush);
		window.addEventListener("freeze", flush);
	}

	/** Collects live state from whoever is listening, then writes. */
	flush() {
		if (!this._loaded) return;
		this.emit("saveRequested");
		this._settings?.save();
		this._write();
	}

	/** Called from a saveRequested handler. */
	submitSession(session) {
		this._document.session = session;
	}

	clearSession() {
		this._document.session = {};
		this._write();
		this.emit("sessionAvailable", false);
	}

	hasSession() {
		const session = this._document.session;
		return isObject(session) && Object.keys(session).length > 0;
	}

	session() {
		return this._document.session ?? {};
	}

	/**
	 * The live stats block, created if a hand-edited document is missing it. Every
	 * accessor below hands back the real object rather than a copy, so a caller
	 * that changes one has changed the document -- there is no separate write-back
	 * step to forget.
	 */
	stats() {
		if (!isObject(this._document.stats)) this._document.stats = Migration.emptyStats();
		return this._document.stats;
	}

	progress() {
		return this._block("progress", Migration.emptyProgress);
	}

	totals() {
		return this._block("totals", Migration.emptyTotals);
	}

	streak() {
		return this._block("streak", Migration.emptyStreak);
	}

	_block(name, empty) {
		const stats = this.stats();
		if (!isObject(stats[name])) stats[name] = empty();
		return stats[name];
	}

	/** The level the player is on now, which the menu can send backwards. */
	playingLevel() {
		return Math.max(Number(this.progress().playing ?? Ladder.FIRST_LEVEL), Ladder.FIRST_LEVEL);
	}

	/**
	 * The furthest level they have reached, which only ever climbs. Never behind
	 * the level being played, whatever a hand-edited save says.
	 */
	furthestLevel() {
		return Math.max(Number(this.progress().level ?? Ladder.FIRST_LEVEL),
			Ladder.FIRST_LEVEL, this.playingLevel());
	}

	levelsCompleted() {
		return Number(this.progress().completed ?? 0);
	}

	/**
	 * Fingerprints of boards already served at this colour count, as a Set for
	 * quick lookup.
	 *
	 * Rebuilt from the stored array on each read, and coerced with Number: JSON
	 * round trips are forgiving about numeric types, and a set of strings compared
	 * against a numeric fingerprint would silently never match, leaving the whole
	 * mechanism quietly doing nothing while looking correct.
	 */
	seenFingerprints(colours) {
		const known = new Set();
		const seen = this.stats().seen ?? Migration.emptySeen();
		if (Number(seen.colours ?? 0) !== colours) return known;
		for (const value of seen.prints ?? []) known.add(Number(value));
		return known;
	}

	/**
	 * Records a board as served. Moving up a colour throws the previous colour
	 * count's list away wholesale, since none of it can come round again.
	 */
	recordSeen(colours, fingerprint) {
		const seen = this._block("seen", Migration.emptySeen);
		let prints = [];
		if (Number(seen.colours ?? 0) === colours) {
			prints = (seen.prints ?? []).map(Number);
			if (prints.includes(fingerprint)) return;
		}
		prints.push(fingerprint);
		if (prints.length > SaveManager.SEEN_LIMIT) {
			prints = prints.slice(prints.length - SaveManager.SEEN_LIMIT);
		}
		this.stats().seen = { colours, prints };
		this._write();
	}

	load() {
		this._loaded = true;
		let text = null;
		try {
			text = localStorage.getItem(SaveManager.STORAGE_KEY);
		} catch {
			// Private mode, or storage disabled. The game still plays; it just
			// cannot remember anything between visits.
			this._document = Migration.emptyDocument();
			return;
		}
		if (text === null) {
			this._document = Migration.emptyDocument();
			return;
		}

		let parsed = null;
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = null;
		}
		if (!isObject(parsed)) {
			console.warn("Save document is not valid JSON; starting fresh.");
			this._document = Migration.emptyDocument();
			return;
		}
		this._document = Migration.migrate(parsed);
		this.emit("sessionAvailable", this.hasSession());
		this.emit("statsChanged");
	}

	/**
	 * Records a level being started. Starting one is what moves the player to it,
	 * so both progress numbers are written here: the level being played, and the
	 * furthest reached when this is a new best.
	 */
	recordStarted(level) {
		const progress = this.progress();
		progress.playing = level;
		progress.level = Math.max(Number(progress.level ?? level), level);
		this._write();
		this.emit("statsChanged");
	}

	/**
	 * Records a finished level and moves the player up one.
	 *
	 * The level number advances here rather than in GameState so that it cannot
	 * get out of step with the document: the same write that records the win is
	 * the one that says which level comes next. A win on a level below the
	 * furthest reached carries on from where it was played and leaves the furthest
	 * alone.
	 */
	recordWin(level, seconds, moves, clean) {
		const progress = this.progress();
		progress.level = Math.max(Number(progress.level ?? level), level + 1);
		progress.playing = level + 1;
		progress.completed = Number(progress.completed ?? 0) + 1;

		const totals = this.totals();
		totals.moves = Number(totals.moves ?? 0) + moves;
		totals.seconds = Number(totals.seconds ?? 0) + seconds;
		if (clean) totals.clean = Number(totals.clean ?? 0) + 1;

		const streak = this.streak();
		streak.current = clean ? Number(streak.current ?? 0) + 1 : 0;
		streak.best = Math.max(Number(streak.best ?? 0), streak.current);

		this._document.session = {};
		this._write();
		this.emit("statsChanged");
		this.emit("sessionAvailable", false);
	}

	_write() {
		this._document.version = Migration.CURRENT_VERSION;
		try {
			localStorage.setItem(SaveManager.STORAGE_KEY, JSON.stringify(this._document));
		} catch (error) {
			// Out of quota, or storage blocked. Losing the write is bad; taking the
			// running game down with it would be worse.
			console.warn("Could not write the save document.", error);
		}
	}
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
