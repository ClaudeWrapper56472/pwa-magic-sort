import * as Tubes from "./tubes.js";

/**
 * Proves a board can be finished, or gives up.
 *
 * This is what makes "guaranteed solvable" a fact rather than a hope. The
 * generator deals liquid at random -- which is what gives boards their variety --
 * and then every deal has to pass through here before it is offered to anyone. A
 * deal that cannot be proved solvable is thrown away, so nothing unwinnable is
 * ever served.
 *
 * Depth-first, because any solution will do: there is no score for finishing in
 * few moves, so the first order the search stumbles on is as good as the shortest
 * one and costs a fraction of the search to find.
 *
 * Two things do the real work.
 *
 * Tube order is thrown away when recording a visited position (see
 * Tubes.canonicalKey). Nothing in the rules cares which tube is which, so the
 * search would otherwise re-refute the same position once per rearrangement of
 * the tubes -- a factor of twelve factorial on a full board.
 *
 * Moves are tried best-first. Finishing a colour or emptying a tube almost never
 * needs taking back, so trying those first turns most searches into something
 * close to a straight walk to the answer.
 */

/**
 * Positions to look at before giving up.
 *
 * Generous, because the cost of stopping early is a good level thrown away, and
 * bounded, because proving a board unsolvable means exhausting every position
 * reachable from it -- which on a ten-colour board is far more than anybody is
 * willing to wait for. A board that needs more than this is simply not offered.
 */
export const DEFAULT_BUDGET = 120000;

/**
 * Attempts `cells`, which is left exactly as it was found.
 *
 * Returns { solved, moves, nodes, exhausted }. `exhausted` says the search ran
 * out of budget, so `solved: false` means "not proved" rather than "proved
 * impossible" -- a distinction the generator does not care about and a test
 * asserting unsolvability very much does.
 */
export function solve(cells, capacity, budget = DEFAULT_BUDGET) {
	const work = Uint8Array.from(cells);
	const seen = new Set();
	const moves = [];
	const state = { nodes: 0, budget, exhausted: false };
	const solved = descend(work, capacity, seen, moves, state);
	return { solved, moves, nodes: state.nodes, exhausted: state.exhausted };
}

/** Whether the board can be finished. The shorthand the generator uses. */
export function isSolvable(cells, capacity, budget = DEFAULT_BUDGET) {
	return solve(cells, capacity, budget).solved;
}

function descend(cells, capacity, seen, moves, state) {
	if (Tubes.isSolvedBoard(cells, capacity)) return true;
	if (state.nodes >= state.budget) {
		state.exhausted = true;
		return false;
	}
	state.nodes += 1;

	const key = Tubes.canonicalKey(cells, capacity);
	if (seen.has(key)) return false;
	seen.add(key);

	for (const move of candidates(cells, capacity)) {
		const poured = Tubes.applyPour(cells, capacity, move.from, move.to);
		moves.push([move.from, move.to]);
		if (descend(cells, capacity, seen, moves, state)) return true;
		moves.pop();
		Tubes.transfer(cells, capacity, move.to, move.from, poured.amount);
		if (state.exhausted) return false;
	}
	return false;
}

/**
 * Every pour worth trying from this position, best first.
 *
 * Two kinds are left out entirely rather than ranked low.
 *
 * A finished tube is never disturbed. Any board reachable by unpacking one is
 * also reachable without doing so, since the liquid would have to come back to
 * exactly where it is now.
 *
 * Tipping a single-coloured tube into an empty one is skipped: it produces the
 * same board with two tubes exchanged, which canonical keys already treat as the
 * position it came from. Leaving it in the list would spend a node per empty tube
 * on every branch to discover that.
 */
function candidates(cells, capacity) {
	const tubes = Tubes.tubeCount(cells, capacity);
	const out = [];
	for (let from = 0; from < tubes; from += 1) {
		if (Tubes.isEmpty(cells, capacity, from)) continue;
		if (Tubes.isSorted(cells, capacity, from)) continue;
		const wholeTube = Tubes.isSingleColour(cells, capacity, from);
		const run = Tubes.topRunOf(cells, capacity, from);
		for (let to = 0; to < tubes; to += 1) {
			const amount = Tubes.pourAmount(cells, capacity, from, to);
			if (amount === 0) continue;
			const intoEmpty = Tubes.isEmpty(cells, capacity, to);
			if (wholeTube && intoEmpty) continue;
			out.push({ from, to, score: scoreOf(cells, capacity, to, amount, run, intoEmpty) });
		}
	}
	out.sort((a, b) => b.score - a.score);
	return out;
}

/**
 * How promising a pour looks. Ordering only -- the search is still exhaustive
 * within its budget, so a bad guess costs time and never correctness.
 */
function scoreOf(cells, capacity, to, amount, run, intoEmpty) {
	const height = Tubes.heightOf(cells, capacity, to);
	// Completes a colour: almost always right, and it takes a tube out of play.
	if (!intoEmpty && height + amount === capacity && Tubes.isSingleColour(cells, capacity, to)) {
		return 100;
	}
	// Empties the source, which is the other way to gain a free tube.
	if (amount === run) return 60 + (intoEmpty ? 0 : 20);
	// Merging onto its own colour beats scattering into an empty tube.
	return intoEmpty ? 10 : 30;
}
