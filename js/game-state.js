import * as Ladder from "./puzzle/ladder.js";
import * as Generator from "./puzzle/generator.js";
import { PuzzleState } from "./puzzle-state.js";
import { UndoStack } from "./commands/undo-stack.js";
import { PourCommand } from "./commands/pour-command.js";
import { Emitter } from "./util/emitter.js";

/**
 * The running game.
 *
 * Everything the UI needs to know lives here, and everything it needs to say
 * comes back as an event. No view reaches into another view's DOM -- the rack,
 * the toolbar and the header each listen for the events they care about and know
 * nothing about each other.
 *
 * The player is on a level, the level decides the board, and finishing one moves
 * them up. Ladder owns that mapping; SaveManager owns the number. The menu's
 * difficulty buttons only choose a level to start on -- nothing else picks a
 * board.
 *
 * Generation runs inline. Dealing a board and proving it solvable takes a
 * fraction of a millisecond and a few milliseconds at worst, which is well inside
 * a frame -- so there is no worker, no bank of precomputed levels, and no spinner
 * to cover the wait.
 */

/** Extra tubes on offer per level. */
export const HELPERS_PER_LEVEL = 1;

/** How often the clock is sampled. Whole seconds are all the UI ever shows. */
const TICK_MS = 200;

export class GameState extends Emitter {
	constructor(saveManager) {
		super();
		this.save = saveManager;
		this.board = new PuzzleState();
		this.history = new UndoStack();

		this.levelNumber = Ladder.FIRST_LEVEL;
		this.seed = 0;
		this.selected = -1;
		this.moves = 0;
		this.helpersUsed = 0;
		this.elapsed = 0;
		this.playing = false;
		this.finished = false;
		/** Whether undo or an extra tube has been used on this level. */
		this.assisted = false;

		this._lastWholeSecond = -1;
		this._tickStamp = 0;

		this.board.on("tubesChanged", () => this._onTubesChanged());
		this.history.on("changed", (canUndo) => this.emit("historyChanged", canUndo));
		this.save.on("saveRequested", () => this._onSaveRequested());
		this._startClock();
	}

	capacity() {
		return this.board.capacity();
	}

	tubes() {
		return this.board.tubes();
	}

	helpersLeft() {
		return Math.max(HELPERS_PER_LEVEL - this.helpersUsed, 0);
	}

	canUndo() {
		return this.history.canUndo();
	}

	// --- Starting, restarting and resuming ----------------------------------

	/** Builds and starts a level: the one asked for, or the one the player is on. */
	startLevel(requestedLevel = 0) {
		this.levelNumber = requestedLevel > 0 ? requestedLevel : this.save.playingLevel();
		const spec = Ladder.specFor(this.levelNumber);
		const seen = this.save.seenFingerprints(spec.colours);
		const level = Generator.generate(spec, 0, Generator.DEFAULT_MAX_ATTEMPTS, seen);
		if (level === null) {
			this.emit("levelUnavailable");
			return false;
		}
		this._resetFor(level);
		// Whatever was suspended is gone the moment a new level starts. It is
		// already cleared after a win, so this only bites when a saved level failed
		// to load and the menu would otherwise go on offering to continue it.
		this.save.clearSession();
		this.save.recordSeen(spec.colours, level.fingerprint());
		this.save.recordStarted(this.levelNumber);
		return true;
	}

	/**
	 * Puts the same board back the way it started, extra tube and all.
	 *
	 * Restarting is starting this level over, not being handed a different one --
	 * the point is to solve *this* puzzle, and swapping it out would let a player
	 * reroll their way past anything awkward. The extra tube comes back with it,
	 * because a fresh attempt that begins already short of help is not a fresh
	 * attempt.
	 */
	restartLevel() {
		if (this.board.level === null) return;
		this._resetFor(this.board.level);
	}

	_resetFor(level) {
		this.board.setup(level);
		this.history.clear();
		this.seed = level.seed;
		this.selected = -1;
		this.moves = 0;
		this.helpersUsed = 0;
		this.elapsed = 0;
		this._lastWholeSecond = -1;
		this.assisted = false;
		this.finished = false;
		this.playing = true;
		this._announce();
	}

	resumeSavedGame() {
		const session = this.save.session();
		if (Object.keys(session).length === 0) return false;
		const restored = new PuzzleState();
		if (!restored.fromJSON(session.board ?? {})) return false;

		this.board.setup(restored.level);
		this.board.cells = restored.cells;
		this.history.clear();
		this.history.fromJSON(session.history ?? {});

		this.levelNumber = Math.max(Number(session.level ?? Ladder.FIRST_LEVEL), Ladder.FIRST_LEVEL);
		this.seed = Number(session.seed ?? 0);
		this.moves = Number(session.moves ?? 0);
		this.helpersUsed = Number(session.helpers ?? 0);
		this.elapsed = Number(session.elapsed ?? 0);
		this.selected = -1;
		this._lastWholeSecond = -1;
		this.assisted = Boolean(session.assisted ?? false);
		this.finished = false;
		this.playing = true;
		this._announce();
		return true;
	}

	_announce() {
		this.emit("levelLoaded", this.levelNumber);
		this.emit("selectionChanged", this.selected);
		this.emit("movesChanged", this.moves);
		this.emit("progressChanged", this.board.sortedCount(), this.board.colours());
		this.emit("helpersChanged", this.helpersLeft());
		this.emit("historyChanged", this.history.canUndo());
		this.emit("timeChanged", Math.floor(this.elapsed));
	}

	/** Leaves the level running in the save so the menu can offer Continue. */
	suspend() {
		this.playing = false;
		this.save.flush();
	}

	// --- Player input -------------------------------------------------------

	/**
	 * The whole of play: tap a tube to pick it up, tap another to pour into it.
	 *
	 * One entry point rather than separate pick and pour calls, because which of
	 * those a tap means depends on what is already picked up -- and deciding that
	 * in the view would put a rule of the game somewhere the rules do not live.
	 *
	 * Tapping a tube that cannot take the pour picks *it* up instead, when it has
	 * something to pour. Changing your mind is by far the likelier reading of that
	 * tap, and the alternative -- refusing it -- would cost two taps to do the same
	 * thing.
	 */
	selectTube(index) {
		if (!this._canPlay() || index < 0 || index >= this.tubes()) return;

		if (index === this.selected) {
			this._select(-1);
			return;
		}
		if (this.selected < 0) {
			if (this._canLift(index)) this._select(index);
			return;
		}
		if (this.board.pourAmount(this.selected, index) > 0) {
			this._pour(this.selected, index);
			return;
		}
		if (this._canLift(index)) this._select(index);
		else this.emit("pourRefused", index);
	}

	/**
	 * A tube worth picking up. An empty one has nothing to give, and a finished one
	 * has nowhere useful to give it -- every board reachable by unpacking a sorted
	 * tube is reachable without doing so, so refusing is never in the player's way.
	 */
	_canLift(index) {
		return !this.board.isEmpty(index) && !this.board.isSorted(index);
	}

	_select(index) {
		if (index === this.selected) return;
		this.selected = index;
		this.emit("selectionChanged", this.selected);
	}

	_pour(from, to) {
		const amount = this.board.pourAmount(from, to);
		if (amount === 0) return;
		const colour = this.board.topColourOf(from);
		this._select(-1);
		this.history.push(new PourCommand(from, to, colour, amount), this.board);
		this.moves += 1;
		this.emit("movesChanged", this.moves);
		this.emit("poured", from, to, colour, amount);
		this._checkCompletion();
		// A board with no useful pour left is one the player has wedged. There is
		// always a way back -- undo, or start the level again -- but nothing says so
		// on its own, and hunting for a move that is not there is a miserable way to
		// spend five minutes.
		if (!this.finished && !this.board.hasUsefulMove()) this.emit("stuck");
	}

	undo() {
		if (!this._canPlay() || !this.history.canUndo()) return;
		this._select(-1);
		this.history.undo(this.board);
		this.moves = Math.max(this.moves - 1, 0);
		this.assisted = true;
		this.emit("movesChanged", this.moves);
		this.emit("boardChanged");
	}

	/**
	 * The extra tube: one more place to put liquid, once per level.
	 *
	 * It is spent rather than borrowed, and it is deliberately kept off the undo
	 * stack. Undoing it back would turn the one piece of help in the game into a
	 * free look at what an extra tube would buy, and the board it is trying to
	 * rescue is exactly the one where that matters. Starting the level over is what
	 * gives it back.
	 */
	addTube() {
		if (!this._canPlay() || this.helpersLeft() <= 0) return;
		this.helpersUsed += 1;
		this.assisted = true;
		const index = this.board.addTube();
		this.emit("helpersChanged", this.helpersLeft());
		this.emit("tubeAdded", index);
	}

	_canPlay() {
		return this.playing && !this.finished && this.board.level !== null;
	}

	_checkCompletion() {
		if (this.finished || !this.board.isSolved()) return;
		this.finished = true;
		this.playing = false;
		const seconds = Math.floor(this.elapsed);
		const clean = !this.assisted;
		this.save.recordWin(this.levelNumber, seconds, this.moves, clean);
		this.emit("levelCompleted", this.levelNumber, this.moves, seconds, clean);
	}

	// --- Plumbing -----------------------------------------------------------

	_startClock() {
		this._tickStamp = performance.now();
		setInterval(() => this._tick(), TICK_MS);
	}

	_tick() {
		const now = performance.now();
		const delta = (now - this._tickStamp) / 1000;
		this._tickStamp = now;
		if (!this.playing || this.finished) return;
		this.elapsed += delta;
		const whole = Math.floor(this.elapsed);
		if (whole !== this._lastWholeSecond) {
			this._lastWholeSecond = whole;
			this.emit("timeChanged", whole);
		}
	}

	_onTubesChanged() {
		this.emit("progressChanged", this.board.sortedCount(), this.board.colours());
	}

	/**
	 * Deliberately not gated on `playing`. suspend() stops the clock before asking
	 * for a save, and a paused level is exactly the one worth writing.
	 */
	_onSaveRequested() {
		if (this.finished || this.board.level === null) return;
		this.save.submitSession(this.toJSON());
	}

	toJSON() {
		return {
			level: this.levelNumber,
			seed: this.seed,
			board: this.board.toJSON(),
			elapsed: this.elapsed,
			moves: this.moves,
			helpers: this.helpersUsed,
			assisted: this.assisted,
			history: this.history.toJSON(),
		};
	}
}
