import { BoardCommand } from "./command.js";

/**
 * One pour: this many units of this colour, from here to there.
 *
 * The amount is recorded rather than recomputed. A pour takes as much of the
 * source's top run as the destination has room for, and by the time it is undone
 * the destination may have been filled further or the source drained -- so asking
 * the rules again would give a different answer. What actually moved is the only
 * thing that can be moved back.
 *
 * The colour is recorded too, and only for reading back: a saved history is
 * legible as a list of moves without replaying the board to find out what each
 * one carried.
 */
export class PourCommand extends BoardCommand {
	static TYPE = "pour";

	constructor(from, to, colour, amount) {
		super();
		this.from = from;
		this.to = to;
		this.colour = colour;
		this.amount = amount;
	}

	apply(state) {
		state.transfer(this.from, this.to, this.amount);
	}

	revert(state) {
		state.transfer(this.to, this.from, this.amount);
	}

	touched() {
		return [this.from, this.to];
	}

	toJSON() {
		return { t: PourCommand.TYPE, f: this.from, o: this.to, c: this.colour, n: this.amount };
	}

	static fromJSON(data) {
		const from = Number(data.f ?? -1);
		const to = Number(data.o ?? -1);
		const amount = Number(data.n ?? 0);
		if (from < 0 || to < 0 || from === to || amount <= 0) return null;
		return new PourCommand(from, to, Number(data.c ?? 0), amount);
	}
}
