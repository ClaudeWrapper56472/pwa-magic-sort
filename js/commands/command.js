/**
 * Base class for one undoable move.
 *
 * A command carries everything needed to put the board back exactly as it was,
 * which means it records what moved as well as where. That is what lets undo work
 * without keeping a copy of the whole board per move -- and it is why the undo
 * history is small enough to write into the save document.
 *
 * Subclasses implement apply/revert as exact mirrors of each other, and
 * toJSON/fromJSON so history survives a restart.
 */
export class BoardCommand {
	apply(_state) {}

	revert(_state) {}

	/** Tubes this command touches. The rack repaints these and nothing else. */
	touched() {
		return [];
	}

	toJSON() {
		return {};
	}
}
