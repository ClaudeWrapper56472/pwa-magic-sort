import { Emitter } from "./util/emitter.js";

/**
 * Player preferences.
 *
 * Kept apart from SaveManager because settings and progress have different
 * lifetimes -- wiping a stuck save should not reset the player's preferences, and
 * settings must be readable before any game exists.
 *
 * Emits: changed()
 */
export class Settings extends Emitter {
	static STORAGE_KEY = "pour.settings";

	/**
	 * Every option and its default.
	 *
	 * `motion` is the one thing worth a switch: the pour animation is most of the
	 * game's character and a real cost to anyone who wants to move quickly, and
	 * the system-wide reduced-motion setting is all-or-nothing across every app.
	 */
	static DEFAULTS = { motion: true };

	constructor() {
		super();
		this._values = { ...Settings.DEFAULTS };
	}

	load() {
		let stored = null;
		try {
			stored = JSON.parse(localStorage.getItem(Settings.STORAGE_KEY) ?? "null");
		} catch {
			stored = null;
		}
		if (stored !== null && typeof stored === "object") {
			for (const option of Object.keys(Settings.DEFAULTS)) {
				if (option in stored) this._values[option] = Boolean(stored[option]);
			}
		}
		this.emit("changed");
	}

	save() {
		try {
			localStorage.setItem(Settings.STORAGE_KEY, JSON.stringify(this._values));
		} catch {
			// Nothing to do about it, and nothing here is worth failing a save for.
		}
	}

	/**
	 * Named access so a settings screen can drive every option through one path
	 * instead of a branch per toggle. Writes through immediately: settings changes
	 * are rare and losing one is more annoying than the write.
	 */
	set(option, value) {
		if (!this.has(option)) {
			console.warn(`Unknown setting: ${option}`);
			return;
		}
		if (this._values[option] === value) return;
		this._values[option] = value;
		this.save();
		this.emit("changed");
	}

	get(option) {
		return this.has(option) ? this._values[option] : false;
	}

	has(option) {
		return Object.hasOwn(Settings.DEFAULTS, option);
	}
}
