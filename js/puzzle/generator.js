import * as Tubes from "./tubes.js";
import * as Solver from "./solver.js";
import { PourLevel } from "./level.js";
import { Rng } from "../util/rng.js";

/**
 * Builds a level to a spec from the ladder.
 *
 * Deal at random, then prove it. Liquid is dealt into the tubes with no thought
 * for whether the result can be finished, and the deal is only offered to a
 * player once the solver has actually played it through to the end. Boards that
 * cannot be proved solvable are thrown away and another is dealt.
 *
 * The other way round -- scrambling a finished board with legal pours run
 * backwards -- would make every board solvable by construction and need no solver
 * at all. It is not used here because those boards give themselves away: a
 * backwards walk leaves the liquid in the shapes a forwards walk would have
 * produced, and the openings come out visibly tamer than a straight deal. Dealing
 * blind and proving afterwards costs a few milliseconds and gives the full range
 * of openings the rules allow.
 *
 * Attempts are cheap, so the checks run cheapest first: the shape of the deal
 * rules out most of them long before the solver is asked.
 */

export const DEFAULT_MAX_ATTEMPTS = 300;

/**
 * Builds one level, or returns null if nothing came out in `maxAttempts`.
 *
 * `seen` is a set of fingerprints already served to this player, so the same
 * board does not come round twice.
 */
export function generate(spec, seed = 0, maxAttempts = DEFAULT_MAX_ATTEMPTS, seen = new Set()) {
	const actualSeed = seed !== 0 ? seed : Rng.randomSeed();
	const rng = new Rng(actualSeed);

	// A board that met the spec but has been played before. Kept as a last
	// resort: repeating one is a small annoyance, failing to produce one at all
	// is a broken game.
	let repeat = null;
	// A solvable board that missed the difficulty window. Kept for the same
	// reason, and preferring the one that missed by least.
	let nearest = null;

	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const level = deal(spec, rng);
		level.seed = actualSeed;
		level.attempts = attempt + 1;

		if (!spec.allowFreeColours && hasFinishedTube(level)) continue;
		const missBy = missesWindow(level, spec);
		// The solver is the expensive part, so nothing reaches it until the deal
		// has earned it -- except a near miss, which is only worth keeping if it
		// can actually be finished.
		if (missBy > 0 && nearest !== null && missBy >= nearest.miss) continue;
		if (!Solver.isSolvable(level.cells, level.capacity)) continue;

		if (missBy > 0) {
			nearest = { level, miss: missBy };
			continue;
		}
		if (!seen.has(level.fingerprint())) return level;
		if (repeat === null) repeat = level;
	}

	if (repeat !== null) return repeat;
	return nearest?.level ?? null;
}

/**
 * One random deal: every colour `capacity` times over, shuffled, poured into the
 * first tubes until they are full. The spare tubes are left empty at the end,
 * where they read as the room to work in rather than as part of the puzzle.
 */
function deal(spec, rng) {
	const units = [];
	for (let colour = 1; colour <= spec.colours; colour += 1) {
		for (let unit = 0; unit < spec.capacity; unit += 1) units.push(colour);
	}
	rng.shuffle(units);

	const level = new PourLevel();
	level.capacity = spec.capacity;
	level.colours = spec.colours;
	level.cells = new Uint8Array((spec.colours + spec.spareTubes) * spec.capacity);
	level.cells.set(units);
	return level;
}

/** How far outside the difficulty window a deal falls, or 0 when it is inside. */
function missesWindow(level, spec) {
	const scramble = level.scramble();
	if (scramble < spec.minScramble) return spec.minScramble - scramble;
	if (scramble > spec.maxScramble) return scramble - spec.maxScramble;
	return 0;
}

/** A tube that opens full of a single colour: that colour solved for free. */
function hasFinishedTube(level) {
	for (let tube = 0; tube < level.tubes(); tube += 1) {
		if (Tubes.isSorted(level.cells, level.capacity, tube)) return true;
	}
	return false;
}
