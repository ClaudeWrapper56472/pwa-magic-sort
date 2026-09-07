/**
 * The rules of the game, and the layout every board is stored in.
 *
 * A board is a row of tubes, each holding up to `capacity` units of coloured
 * liquid. It is kept as one flat Uint8Array of `tubeCount * capacity`, indexed
 * `tube * capacity + slot` with slot 0 at the bottom. 0 means empty; a colour is
 * 1 upwards, so a cell is truthy exactly when there is liquid in it.
 *
 * Liquid settles, so a tube is always packed from the bottom with no gaps. Every
 * function here counts on that; `isPacked` is what checks it for a board arriving
 * from storage.
 *
 * One rule drives all of them: a pour moves the source's whole top run of a
 * single colour, or as much of that run as the destination has room for.
 */

export const EMPTY = 0;

/** Units per tube. Four is the shape the puzzle is tuned around. */
export const DEFAULT_CAPACITY = 4;

/** Ten flat colours is about as many as anyone can tell apart at tube width. */
export const MAX_COLOURS = 10;

export function tubeCount(cells, capacity) {
	return Math.floor(cells.length / capacity);
}

/** How much liquid is in a tube. */
export function heightOf(cells, capacity, tube) {
	const base = tube * capacity;
	let filled = 0;
	while (filled < capacity && cells[base + filled] !== EMPTY) filled += 1;
	return filled;
}

export function roomIn(cells, capacity, tube) {
	return capacity - heightOf(cells, capacity, tube);
}

export function isEmpty(cells, capacity, tube) {
	return cells[tube * capacity] === EMPTY;
}

/** The colour a pour would take from this tube, or EMPTY from an empty one. */
export function topColourOf(cells, capacity, tube) {
	const filled = heightOf(cells, capacity, tube);
	return filled === 0 ? EMPTY : cells[tube * capacity + filled - 1];
}

/** How many units of that colour sit on top of each other. */
export function topRunOf(cells, capacity, tube) {
	const base = tube * capacity;
	const filled = heightOf(cells, capacity, tube);
	if (filled === 0) return 0;
	const colour = cells[base + filled - 1];
	let run = 1;
	while (run < filled && cells[base + filled - 1 - run] === colour) run += 1;
	return run;
}

/** A finished tube: full, and all one colour. */
export function isSorted(cells, capacity, tube) {
	return heightOf(cells, capacity, tube) === capacity && topRunOf(cells, capacity, tube) === capacity;
}

/** True when a tube holds one colour and nothing else, however little of it. */
export function isSingleColour(cells, capacity, tube) {
	const filled = heightOf(cells, capacity, tube);
	return filled > 0 && topRunOf(cells, capacity, tube) === filled;
}

/**
 * How much would move, or 0 when the pour is against the rules.
 *
 * The destination has to be empty or already showing the same colour, and it has
 * to have room. A part-pour into a tube that fills up on the way is legal and
 * normal -- the rest of the run stays where it is.
 */
export function pourAmount(cells, capacity, from, to) {
	if (from === to) return 0;
	const run = topRunOf(cells, capacity, from);
	if (run === 0) return 0;
	const room = roomIn(cells, capacity, to);
	if (room === 0) return 0;
	const target = topColourOf(cells, capacity, to);
	if (target !== EMPTY && target !== topColourOf(cells, capacity, from)) return 0;
	return Math.min(run, room);
}

export function canPour(cells, capacity, from, to) {
	return pourAmount(cells, capacity, from, to) > 0;
}

/**
 * Moves units off the top of one tube onto another, with no rule check.
 *
 * The unchecked form is what undo needs: putting liquid back is not itself a
 * legal pour, and asking the rules about it would refuse a move that only exists
 * to unwind one they already allowed.
 */
export function transfer(cells, capacity, from, to, amount) {
	let source = from * capacity + heightOf(cells, capacity, from) - 1;
	let target = to * capacity + heightOf(cells, capacity, to);
	for (let moved = 0; moved < amount; moved += 1) {
		cells[target] = cells[source];
		cells[source] = EMPTY;
		source -= 1;
		target += 1;
	}
}

/** Pours if the rules allow it. Returns what moved, or null. */
export function applyPour(cells, capacity, from, to) {
	const amount = pourAmount(cells, capacity, from, to);
	if (amount === 0) return null;
	const colour = topColourOf(cells, capacity, from);
	transfer(cells, capacity, from, to, amount);
	return { colour, amount };
}

/**
 * Solved when every tube is empty or holds one colour filling it to the top.
 *
 * "All one colour" on its own is not enough: two tubes holding half a colour each
 * are both single-coloured and the level is plainly not finished. Requiring a
 * full tube is what says the colour has been gathered in one place.
 */
export function isSolvedBoard(cells, capacity) {
	const tubes = tubeCount(cells, capacity);
	for (let tube = 0; tube < tubes; tube += 1) {
		if (isEmpty(cells, capacity, tube)) continue;
		if (!isSorted(cells, capacity, tube)) return false;
	}
	return true;
}

export function sortedCount(cells, capacity) {
	const tubes = tubeCount(cells, capacity);
	let done = 0;
	for (let tube = 0; tube < tubes; tube += 1) {
		if (isSorted(cells, capacity, tube)) done += 1;
	}
	return done;
}

/**
 * Whether any pour is left that could change the board.
 *
 * Tipping a single-coloured tube into an empty one is legal but pointless: it
 * hands back exactly the board it started from with two tubes swapped. Counting
 * those as moves would mean a board nobody can finish never reports itself stuck,
 * and the player would keep shuffling liquid between empties looking for the
 * progress that is not there.
 */
export function hasUsefulMove(cells, capacity) {
	const tubes = tubeCount(cells, capacity);
	for (let from = 0; from < tubes; from += 1) {
		if (isEmpty(cells, capacity, from)) continue;
		if (isSorted(cells, capacity, from)) continue;
		const wholeTube = isSingleColour(cells, capacity, from);
		for (let to = 0; to < tubes; to += 1) {
			if (!canPour(cells, capacity, from, to)) continue;
			if (wholeTube && isEmpty(cells, capacity, to)) continue;
			return true;
		}
	}
	return false;
}

/**
 * Contiguous colour runs across the whole board, which is how mixed up it is.
 *
 * A board of N colours is at its tidiest at N runs -- one per tube, already
 * sorted -- and at its most broken up when no unit touches its own colour. The
 * generator uses the number to keep early levels gentle and later ones properly
 * churned.
 */
export function runCount(cells, capacity) {
	const tubes = tubeCount(cells, capacity);
	let runs = 0;
	for (let tube = 0; tube < tubes; tube += 1) {
		const base = tube * capacity;
		let previous = EMPTY;
		for (let slot = 0; slot < capacity; slot += 1) {
			const colour = cells[base + slot];
			if (colour === EMPTY) break;
			if (colour !== previous) runs += 1;
			previous = colour;
		}
	}
	return runs;
}

/**
 * The colour bands in a tube, bottom first, as {colour, size, base}.
 *
 * A band is what the player actually sees -- three units of one colour read as a
 * single block of liquid, not three -- and it is what the view animates: a pour
 * shrinks a band at one end of the board and grows one at the other.
 */
export function bandsOf(cells, capacity, tube) {
	const base = tube * capacity;
	const bands = [];
	for (let slot = 0; slot < capacity; slot += 1) {
		const colour = cells[base + slot];
		if (colour === EMPTY) break;
		const last = bands[bands.length - 1];
		if (last !== undefined && last.colour === colour) last.size += 1;
		else bands.push({ colour, size: 1, base: slot });
	}
	return bands;
}

/** Colours present, by count of units. Index 0 is unused, so colours read 1..N. */
export function colourCounts(cells, colours) {
	const counts = new Int32Array(colours + 1);
	for (const colour of cells) counts[colour] += 1;
	return counts;
}

/** No liquid floating above a gap, and no colour outside the level's palette. */
export function isPacked(cells, capacity, colours) {
	const tubes = tubeCount(cells, capacity);
	for (let tube = 0; tube < tubes; tube += 1) {
		const base = tube * capacity;
		let ended = false;
		for (let slot = 0; slot < capacity; slot += 1) {
			const colour = cells[base + slot];
			if (colour === EMPTY) ended = true;
			else if (ended || colour > colours) return false;
		}
	}
	return true;
}

/**
 * A board identity that ignores which tube is which.
 *
 * Two boards holding the same tubes in a different order are the same puzzle:
 * nothing in the rules cares where a tube sits. Sorting the tubes before hashing
 * is what lets the solver recognise a position it has already refuted, and it
 * collapses the search space by a factor of tubeCount factorial.
 */
export function canonicalKey(cells, capacity) {
	const tubes = tubeCount(cells, capacity);
	const parts = new Array(tubes);
	for (let tube = 0; tube < tubes; tube += 1) {
		parts[tube] = tubeToString(cells, capacity, tube);
	}
	parts.sort();
	return parts.join("|");
}

export function tubeToString(cells, capacity, tube) {
	let out = "";
	for (let slot = 0; slot < capacity; slot += 1) out += digit(cells[tube * capacity + slot]);
	return out;
}

export function cellsToString(cells) {
	let out = "";
	for (const colour of cells) out += digit(colour);
	return out;
}

export function cellsFromString(text) {
	const cells = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		cells[i] = char === "." ? EMPTY : Number.parseInt(char, 36);
	}
	return cells;
}

/** One character per unit: "." for empty, else the colour in base 36. */
function digit(colour) {
	return colour === EMPTY ? "." : colour.toString(36);
}

export function hashString(text) {
	let hash = 5381;
	for (let i = 0; i < text.length; i += 1) {
		hash = (Math.imul(hash, 33) + text.charCodeAt(i)) | 0;
	}
	return hash >>> 0;
}
