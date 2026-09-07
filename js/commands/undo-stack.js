import { Emitter } from "../util/emitter.js";
import { PourCommand } from "./pour-command.js";

/**
 * A stack of commands and the rules for moving back down it.
 *
 * There is no redo. In a sorting puzzle the only thing undo is for is taking back
 * a pour that turned out badly, and putting one back is a single tap on the two
 * tubes -- so a redo button would spend a quarter of the toolbar on something a
 * player can already do faster by hand.
 *
 * Commands write to the board silently; the stack fires the board's change event
 * once per move, after the command has finished.
 *
 * The whole stack serializes, so closing the app mid-level and coming back does
 * not cost the undo history. Depth is capped because history is written to
 * storage on every suspend and an unbounded stack would grow the document without
 * limit.
 *
 * Emits: changed(canUndo)
 */
export class UndoStack extends Emitter {
	/** Comfortably more than a full level's worth of pours. */
	static MAX_DEPTH = 300;

	constructor() {
		super();
		this._moves = [];
	}

	/** Applies `command` and records it. Returns the tubes it touched. */
	push(command, state) {
		command.apply(state);
		this._moves.push(command);
		if (this._moves.length > UndoStack.MAX_DEPTH) this._moves.shift();
		const touched = command.touched();
		state.notify(touched);
		this._emitChanged();
		return touched;
	}

	undo(state) {
		if (this._moves.length === 0) return [];
		const command = this._moves.pop();
		command.revert(state);
		const touched = command.touched();
		state.notify(touched);
		this._emitChanged();
		return touched;
	}

	canUndo() {
		return this._moves.length > 0;
	}

	depth() {
		return this._moves.length;
	}

	clear() {
		this._moves = [];
		this._emitChanged();
	}

	toJSON() {
		return { moves: this._moves.map((command) => command.toJSON()) };
	}

	fromJSON(data) {
		this._moves = deserialize(data?.moves);
		this._emitChanged();
	}

	_emitChanged() {
		this.emit("changed", this.canUndo());
	}
}

/**
 * Rebuilds commands from saved objects. Unknown or malformed entries are dropped
 * rather than faulted, so a document written by a newer build with extra command
 * types still loads -- just with a shorter history.
 */
function deserialize(raw) {
	const moves = [];
	if (!Array.isArray(raw)) return moves;
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const command = build(entry);
		if (command !== null) moves.push(command);
	}
	return moves;
}

/**
 * Command factory. Lives here rather than on BoardCommand so the base class does
 * not have to name its own subclasses.
 */
export function build(data) {
	switch (String(data.t ?? "")) {
		case PourCommand.TYPE:
			return PourCommand.fromJSON(data);
		default:
			return null;
	}
}
