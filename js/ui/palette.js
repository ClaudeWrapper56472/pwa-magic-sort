/**
 * The liquids.
 *
 * This is the part of the colour work a stylesheet cannot express: which colour a
 * given liquid is, and what to call it. Everything else -- the glass, the bench,
 * the buttons -- lives in the stylesheet as custom properties, which is what CSS
 * is for.
 *
 * Ten hues, spread far enough apart to stay apart at tube width, all bright
 * enough to hold their own against a dark bench. The last is a neutral: by the
 * tenth liquid every hue family is already taken, and two near neighbours would
 * read as one colour halfway through a level.
 *
 * The names are not decoration. They are what a screen reader says when it reads
 * out a tube, so they have to be the words someone would use to tell two of these
 * apart out loud.
 */

const LIQUIDS = [
	{ colour: "#ff5f6d", name: "red" },
	{ colour: "#ff9a3c", name: "orange" },
	{ colour: "#f4d35e", name: "yellow" },
	{ colour: "#8ede5a", name: "lime" },
	{ colour: "#19c39a", name: "green" },
	{ colour: "#3ec8e8", name: "cyan" },
	{ colour: "#5b8dfa", name: "blue" },
	{ colour: "#a780f3", name: "purple" },
	{ colour: "#f279cc", name: "pink" },
	{ colour: "#b9c2d6", name: "grey" },
];

/**
 * The order the liquids are brought into play, as indexes into the list above.
 *
 * A level uses colours 1 upward, so without this a three-colour board would be
 * red, orange and yellow -- three neighbours, and the worst three to tell apart
 * in the whole set. Each entry here is instead the colour furthest in hue from
 * everything already in play, so the small boards get the cleanest contrasts and
 * the near neighbours only ever meet on the ten-colour boards, where the player
 * has had forty levels of practice at reading them.
 */
const ORDER = [0, 4, 7, 2, 6, 3, 8, 5, 1, 9];

/** Colours are 1-based, so liquid 1 is the first one brought into play. */
export function liquidColour(colour) {
	return LIQUIDS[pick(colour)].colour;
}

export function liquidName(colour) {
	return LIQUIDS[pick(colour)].name;
}

function pick(colour) {
	const index = colour - 1;
	return ORDER[((index % ORDER.length) + ORDER.length) % ORDER.length];
}
