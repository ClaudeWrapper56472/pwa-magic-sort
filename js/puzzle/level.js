import * as Tubes from "./tubes.js";

/**
 * One puzzle: how many colours, how many tubes, and where the liquid starts.
 *
 * There is no separate answer to store. Every colour ends up gathered in a tube
 * of its own, so the finished board is the same whatever route was taken to it --
 * which is why this holds only the opening position.
 */
export class PourLevel {
	constructor() {
		this.capacity = Tubes.DEFAULT_CAPACITY;
		this.colours = 0;
		this.cells = new Uint8Array(0); // the opening position, never mutated
		this.seed = 0;
		this.attempts = 0;
	}

	tubes() {
		return Tubes.tubeCount(this.cells, this.capacity);
	}

	/** Tubes with nothing in them at the start: the room the player has to work in. */
	spareTubes() {
		return this.tubes() - this.colours;
	}

	/**
	 * How mixed up the opening position is, from 0 to 1.
	 *
	 * 0 is every colour already stacked in its own tube, and 1 is a board where no
	 * unit of liquid touches its own colour anywhere. It is the generator's handle
	 * on difficulty within a colour count: the same ten colours can open as a
	 * twenty-move tidy-up or an eighty-move knot.
	 */
	scramble() {
		const span = this.colours * (this.capacity - 1);
		if (span <= 0) return 0;
		return (Tubes.runCount(this.cells, this.capacity) - this.colours) / span;
	}

	/**
	 * Stable identity, used to avoid serving a board the player has already had.
	 *
	 * Hashed rather than stored whole: a few hundred forty-character strings would
	 * bloat the save for nothing, and a collision costs exactly one skipped puzzle.
	 */
	fingerprint() {
		return Tubes.hashString(
			`${this.capacity}:${this.colours}:${Tubes.cellsToString(this.cells)}`);
	}

	isValid() {
		if (this.capacity < 2 || this.colours < 1 || this.colours > Tubes.MAX_COLOURS) return false;
		if (this.cells.length !== this.tubes() * this.capacity) return false;
		if (this.tubes() <= this.colours) return false;
		if (!Tubes.isPacked(this.cells, this.capacity, this.colours)) return false;
		// Every colour has to fill exactly one tube, or the level cannot be
		// finished however well it is played.
		const counts = Tubes.colourCounts(this.cells, this.colours);
		for (let colour = 1; colour <= this.colours; colour += 1) {
			if (counts[colour] !== this.capacity) return false;
		}
		return true;
	}

	describe() {
		return `${this.colours} colours, ${this.tubes()} tubes, seed ${this.seed}`;
	}

	toJSON() {
		return {
			capacity: this.capacity,
			colours: this.colours,
			cells: Tubes.cellsToString(this.cells),
			seed: this.seed,
		};
	}

	static fromJSON(data) {
		if (!data || typeof data !== "object") return null;
		const level = new PourLevel();
		level.capacity = Number(data.capacity ?? Tubes.DEFAULT_CAPACITY);
		level.colours = Number(data.colours ?? 0);
		level.cells = Tubes.cellsFromString(String(data.cells ?? ""));
		level.seed = Number(data.seed ?? 0);
		return level.isValid() ? level : null;
	}
}
