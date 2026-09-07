import * as Tubes from "./tubes.js";

/**
 * Turns a level number into the board to build for it.
 *
 * Level 1 is three colours in six tubes and every level after it is a little
 * harder, so each new idea arrives once the last one has had some practice. The
 * menu's Easy, Medium and Hard are three entry points onto this one ladder (see
 * DIFFICULTIES), not three separate settings.
 *
 * Difficulty climbs on two axes. Colours are added, and within each colour count
 * the opening position gets progressively more churned up. Adding a colour resets
 * how churned up it may be, so the curve rises steadily and dips on the level
 * where the board grows -- which is the breather that pays for the extra tube.
 *
 * Each colour count lasts longer than the one before it. Three colours are
 * understood in a couple of goes; ten deserve a dozen. It also means the colours,
 * which run out, take much longer to do so than a player does.
 */

export const FIRST_LEVEL = 1;
export const FIRST_COLOURS = 3;
export const LAST_COLOURS = Tubes.MAX_COLOURS;

/**
 * How many levels are spent on each colour count, from FIRST_COLOURS upward.
 * The first seven total forty, so the ten-colour boards begin at level 41.
 */
export const LEVELS_PER_COLOUR = [2, 3, 4, 5, 7, 9, 10, 10];

/**
 * Extra levels the last colour count keeps ramping over. The boards stop growing
 * at ten colours, so how tangled they open is the only difficulty left to give.
 */
const FINAL_RAMP = 20;

/**
 * Empty tubes to start with, which is the room the player has to work in.
 *
 * Two is the standard, and the number the scramble windows are tuned against. The
 * opening levels get a third: the rules are being learned there, and an extra
 * tube is the difference between a puzzle and a demonstration.
 */
const SPARE_TUBES = 2;
const OPENING_SPARE_TUBES = 3;
const OPENING_COLOURS = 4;

/**
 * The scramble window, as a fraction of the most mixed-up opening possible (see
 * PourLevel.scramble).
 *
 * A window rather than a floor. The floor keeps a level worth playing -- a deal
 * that falls out nearly sorted is a tap-through, not a puzzle -- and the ceiling
 * is what keeps the early levels gentle, since an unlucky deal at three colours
 * can otherwise be knottier than a careful one at six.
 *
 * Each end of the window is two interpolations: where the colour count sits in
 * the ladder decides the window's range, and where the level sits inside that
 * colour count decides where in the range it lands.
 */
const FLOOR_FIRST = [0.30, 0.52]; // three colours, from its first level to its last
const FLOOR_LAST = [0.62, 0.80]; // ten colours, likewise
const CEILING_FIRST = [0.58, 0.78];
const CEILING_LAST = [0.86, 1];

/**
 * From this level on, no tube may start already finished.
 *
 * A tube that opens full of one colour is a colour solved for free, which is the
 * easiest possible foothold. Taking it away means the player has to make their
 * own room before they can start gathering.
 */
export const NO_FREE_COLOURS_FROM = 12;

export function colourCountFor(level) {
	let remaining = Math.max(level, FIRST_LEVEL) - FIRST_LEVEL;
	for (let step = 0; step < LEVELS_PER_COLOUR.length; step += 1) {
		if (remaining < LEVELS_PER_COLOUR[step]) return FIRST_COLOURS + step;
		remaining -= LEVELS_PER_COLOUR[step];
	}
	return LAST_COLOURS;
}

export function spareTubesFor(level) {
	return colourCountFor(level) <= OPENING_COLOURS ? OPENING_SPARE_TUBES : SPARE_TUBES;
}

export function tubeCountFor(level) {
	return colourCountFor(level) + spareTubesFor(level);
}

/** How far through its colour count a level is, from 0 to 1. */
export function rampFor(level) {
	let remaining = Math.max(level, FIRST_LEVEL) - FIRST_LEVEL;
	const last = LEVELS_PER_COLOUR.length - 1;
	for (let step = 0; step <= last; step += 1) {
		const span = LEVELS_PER_COLOUR[step] + (step === last ? FINAL_RAMP : 0);
		if (remaining < span) return span <= 1 ? 1 : remaining / (span - 1);
		remaining -= span;
	}
	return 1;
}

/** Everything the generator needs for a level number. */
export function specFor(level) {
	const ramp = rampFor(level);
	const share = (colourCountFor(level) - FIRST_COLOURS) / (LAST_COLOURS - FIRST_COLOURS);
	return {
		capacity: Tubes.DEFAULT_CAPACITY,
		colours: colourCountFor(level),
		spareTubes: spareTubesFor(level),
		minScramble: window(FLOOR_FIRST, FLOOR_LAST, share, ramp),
		maxScramble: window(CEILING_FIRST, CEILING_LAST, share, ramp),
		allowFreeColours: level < NO_FREE_COLOURS_FROM,
	};
}

function window(first, last, share, ramp) {
	return mix(mix(first[0], last[0], share), mix(first[1], last[1], share), ramp);
}

function mix(from, to, amount) {
	return from + (to - from) * amount;
}

/**
 * The entry points the menu offers, in order, as the colour count each opens on.
 *
 * Each one opens on the first level of its colour count, where the scramble
 * window starts again at its gentlest: somebody picking Hard wants more colours,
 * not to be dropped into the most tangled opening of a count they have never
 * played. Picking one is starting that stretch of the ladder over, whatever the
 * player has done since -- the way back to where they were is the menu's own
 * button.
 */
export const DIFFICULTIES = [
	{ name: "Easy", colours: FIRST_COLOURS },
	{ name: "Medium", colours: 6 },
	{ name: "Hard", colours: 9 },
];

/** The first level played with this many colours. */
export function firstLevelWithColours(colours) {
	const wanted = Math.min(Math.max(colours, FIRST_COLOURS), LAST_COLOURS);
	let level = FIRST_LEVEL;
	for (let step = 0; step < LEVELS_PER_COLOUR.length; step += 1) {
		if (FIRST_COLOURS + step >= wanted) break;
		level += LEVELS_PER_COLOUR[step];
	}
	return level;
}

/** Short caption for the header: "Level 7 · 5 colours". */
export function describe(level) {
	return `Level ${level}  ·  ${colourCountFor(level)} colours`;
}

/** True when this level is the first with an extra colour, so the UI can say so. */
export function isStepUp(level) {
	return level > FIRST_LEVEL && colourCountFor(level) !== colourCountFor(level - 1);
}

/** First level at the largest colour count. Past it the boards stop growing. */
export function finalColourLevel() {
	let total = FIRST_LEVEL;
	for (let step = 0; step < LEVELS_PER_COLOUR.length - 1; step += 1) {
		total += LEVELS_PER_COLOUR[step];
	}
	return total;
}

/** The next level that adds a colour, or 0 when there are none left to add. */
export function nextStepUp(level) {
	let next = Math.max(level, FIRST_LEVEL) + 1;
	const limit = finalColourLevel();
	while (next <= limit) {
		if (isStepUp(next)) return next;
		next += 1;
	}
	return 0;
}
