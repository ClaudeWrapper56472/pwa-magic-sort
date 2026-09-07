import * as Tubes from "./puzzle/tubes.js";
import { PourLevel } from "./puzzle/level.js";
import { Emitter } from "./util/emitter.js";

/**
 * The board the player is working on: the level, and where the liquid is now.
 *
 * Deliberately separate from GameState. Commands act on this, so the undo system
 * has no dependency on the running game and can be built and tested on its own.
 * GameState owns one of these and relays its event outward.
 *
 * The board can hold more tubes than the level it came from, because the extra
 * tube the player is given adds one. Nothing else about the level changes, so the
 * board's own length is the only record needed of a tube having been added.
 *
 * Emits: tubesChanged(indices)
 */
export class PuzzleState extends Emitter {
	constructor() {
		super();
		this.level = null;
		this.cells = new Uint8Array(0);
	}

	setup(level) {
		this.level = level;
		// Copied, so the level keeps its opening position for a restart to go back
		// to however far the board has moved on.
		this.cells = Uint8Array.from(level.cells);
	}

	capacity() {
		return this.level !== null ? this.level.capacity : Tubes.DEFAULT_CAPACITY;
	}

	tubes() {
		return Tubes.tubeCount(this.cells, this.capacity());
	}

	colours() {
		return this.level !== null ? this.level.colours : 0;
	}

	bandsOf(tube) {
		return Tubes.bandsOf(this.cells, this.capacity(), tube);
	}

	isEmpty(tube) {
		return Tubes.isEmpty(this.cells, this.capacity(), tube);
	}

	isSorted(tube) {
		return Tubes.isSorted(this.cells, this.capacity(), tube);
	}

	topColourOf(tube) {
		return Tubes.topColourOf(this.cells, this.capacity(), tube);
	}

	pourAmount(from, to) {
		return Tubes.pourAmount(this.cells, this.capacity(), from, to);
	}

	/**
	 * Silent writes used by commands. They move the liquid and say nothing; the
	 * undo stack fires the change event once, after the command has finished.
	 */
	transfer(from, to, amount) {
		Tubes.transfer(this.cells, this.capacity(), from, to, amount);
	}

	notify(indices) {
		this.emit("tubesChanged", indices);
	}

	/** Appends an empty tube and returns its index. */
	addTube() {
		const grown = new Uint8Array(this.cells.length + this.capacity());
		grown.set(this.cells);
		this.cells = grown;
		return this.tubes() - 1;
	}

	sortedCount() {
		return Tubes.sortedCount(this.cells, this.capacity());
	}

	isSolved() {
		return this.level !== null && Tubes.isSolvedBoard(this.cells, this.capacity());
	}

	/** False when the board is finished or wedged: see Tubes.hasUsefulMove. */
	hasUsefulMove() {
		return Tubes.hasUsefulMove(this.cells, this.capacity());
	}

	toJSON() {
		return { level: this.level.toJSON(), cells: Tubes.cellsToString(this.cells) };
	}

	fromJSON(data) {
		const level = PourLevel.fromJSON(data?.level ?? {});
		if (level === null) return false;
		this.setup(level);

		const cells = Tubes.cellsFromString(String(data?.cells ?? ""));
		// A board with more tubes than its level is one the player was given an
		// extra tube on. Anything else -- a short board, a ragged one, liquid
		// floating above a gap -- is not a board this game could have produced, so
		// the opening position stands rather than a repaired guess at it.
		if (cells.length < level.cells.length) return true;
		if (cells.length % level.capacity !== 0) return true;
		if (!Tubes.isPacked(cells, level.capacity, level.colours)) return true;
		const counts = Tubes.colourCounts(cells, level.colours);
		for (let colour = 1; colour <= level.colours; colour += 1) {
			if (counts[colour] !== level.capacity) return true;
		}
		this.cells = cells;
		return true;
	}
}
