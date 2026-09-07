/**
 * Self-check for the puzzle layer.
 *
 *     node tests/verify.mjs
 *
 * Nothing here touches the DOM, so the whole layer runs under plain Node. Plain
 * assertions rather than a framework, so it runs with nothing installed.
 *
 * The fixture is a two-colour board with room to work in. Written as tubes of
 * four units, bottom of the tube first:
 *
 *     A B A B   |   A B A B   |   . . . .
 *
 * Small enough to work out by hand, and mixed up enough that every rule in the
 * game shows up somewhere in it.
 */
import * as Tubes from "../js/puzzle/tubes.js";
import * as Solver from "../js/puzzle/solver.js";
import * as Ladder from "../js/puzzle/ladder.js";
import * as Generator from "../js/puzzle/generator.js";
import * as Migration from "../js/save-migration.js";
import { PourLevel } from "../js/puzzle/level.js";
import { PuzzleState } from "../js/puzzle-state.js";
import { UndoStack } from "../js/commands/undo-stack.js";
import { PourCommand } from "../js/commands/pour-command.js";
import { Rng } from "../js/util/rng.js";

const CAPACITY = 4;
const MIXED = "12121212....";

let passed = 0;
const failures = [];
let suite = "";

function group(name) {
	suite = name;
	process.stdout.write(`\n${name}\n`);
}

function check(message, condition) {
	if (condition) {
		passed += 1;
		return;
	}
	failures.push(`${suite}: ${message}`);
	process.stdout.write(`  FAIL  ${message}\n`);
}

function eq(message, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) {
		process.stdout.write(
			`         got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}\n`);
	}
	check(message, ok);
}

const cells = (text) => Tubes.cellsFromString(text);
const text = (values) => Tubes.cellsToString(values);

// --- The rules --------------------------------------------------------------

group("Tubes and the rules");
{
	const board = cells(MIXED);
	eq("three tubes", Tubes.tubeCount(board, CAPACITY), 3);
	eq("a full tube is full", Tubes.heightOf(board, CAPACITY, 0), CAPACITY);
	eq("an empty tube is empty", Tubes.heightOf(board, CAPACITY, 2), 0);
	eq("room is what is left", Tubes.roomIn(board, CAPACITY, 2), CAPACITY);
	eq("the top colour is the last unit in", Tubes.topColourOf(board, CAPACITY, 0), 2);
	eq("an empty tube has no top colour", Tubes.topColourOf(board, CAPACITY, 2), Tubes.EMPTY);
	eq("a lone unit on top is a run of one", Tubes.topRunOf(board, CAPACITY, 0), 1);
	eq("stacked units run together", Tubes.topRunOf(cells("1122"), CAPACITY, 0), 2);
	eq("an empty tube has no run", Tubes.topRunOf(board, CAPACITY, 2), 0);

	check("a full tube of one colour is sorted", Tubes.isSorted(cells("1111"), CAPACITY, 0));
	check("a part-filled tube of one colour is not",
		!Tubes.isSorted(cells("11.."), CAPACITY, 0));
	check("but it is single-coloured", Tubes.isSingleColour(cells("11.."), CAPACITY, 0));

	eq("a pour into an empty tube takes the whole run",
		Tubes.pourAmount(cells("1122....") , CAPACITY, 0, 1), 2);
	eq("a pour onto the same colour is allowed",
		Tubes.pourAmount(cells("11222..."), CAPACITY, 0, 1), 2);
	eq("a pour onto a different colour is not",
		Tubes.pourAmount(cells("11121..."), CAPACITY, 0, 1), 0);
	eq("a pour into a full tube is not",
		Tubes.pourAmount(cells("11111111"), CAPACITY, 0, 1), 0);
	eq("a tube cannot pour into itself", Tubes.pourAmount(cells("1..."), CAPACITY, 0, 0), 0);
	eq("an empty tube has nothing to pour",
		Tubes.pourAmount(cells("....1111"), CAPACITY, 0, 1), 0);
	eq("only as much as fits goes across",
		Tubes.pourAmount(cells("111.2211"), CAPACITY, 1, 0), 1);

	// The part-pour: a run of three, into a tube with room for two. Two move and
	// the third stays where it is, because the destination filled up on the way.
	const partial = cells("11..2111");
	eq("a part-pour moves what fits", Tubes.applyPour(partial, CAPACITY, 1, 0),
		{ colour: 1, amount: 2 });
	eq("and leaves the rest behind", text(partial), "111121..");

	const board2 = cells("1122....");
	eq("a pour reports what moved", Tubes.applyPour(board2, CAPACITY, 0, 1),
		{ colour: 2, amount: 2 });
	eq("and moves it", text(board2), "11..22..");
	eq("an illegal pour moves nothing",
		Tubes.applyPour(cells("11121..."), CAPACITY, 0, 1), null);

	Tubes.transfer(board2, CAPACITY, 1, 0, 2);
	eq("an unchecked transfer puts it back", text(board2), "1122....");
}

group("Finishing and getting stuck");
{
	check("every tube full of one colour is solved",
		Tubes.isSolvedBoard(cells("11112222...."), CAPACITY));
	check("a colour split across two tubes is not solved, however tidy it looks",
		!Tubes.isSolvedBoard(cells("11..11..2222"), CAPACITY));
	check("an empty board counts as solved", Tubes.isSolvedBoard(cells("........"), CAPACITY));
	eq("finished tubes are counted", Tubes.sortedCount(cells("11112222.212"), CAPACITY), 2);

	check("a board with a pour to make has a move",
		Tubes.hasUsefulMove(cells("1212212112.."), CAPACITY));
	check("a solved board has none", !Tubes.hasUsefulMove(cells("11112222...."), CAPACITY));
	// The one legal pour is a whole single-coloured tube into an empty one, which
	// hands back the same board with two tubes swapped.
	check("shuffling a tube into an empty one is not a move",
		!Tubes.hasUsefulMove(cells("11..2222...."), CAPACITY));
	check("a wedged board reports itself stuck",
		!Tubes.hasUsefulMove(cells("12121212"), CAPACITY));
}

group("Reading a board");
{
	eq("a sorted board is all one run per tube",
		Tubes.runCount(cells("11112222...."), CAPACITY), 2);
	eq("a mixed board is one run per unit", Tubes.runCount(cells(MIXED), CAPACITY), 8);
	eq("bands gather the units that touch", Tubes.bandsOf(cells("1122"), CAPACITY, 0),
		[{ colour: 1, size: 2, base: 0 }, { colour: 2, size: 2, base: 2 }]);
	eq("an empty tube has no bands", Tubes.bandsOf(cells("...."), CAPACITY, 0), []);

	eq("cells round trip through text", text(cells(MIXED)), MIXED);
	eq("colours past nine keep one character each",
		text(cells("9abc")), "9abc");
	check("a packed board is packed", Tubes.isPacked(cells(MIXED), CAPACITY, 2));
	check("liquid floating above a gap is not", !Tubes.isPacked(cells("1.1."), CAPACITY, 2));
	check("nor is a colour outside the palette", !Tubes.isPacked(cells("13.."), CAPACITY, 2));

	eq("tube order does not change a position",
		Tubes.canonicalKey(cells("1122..33"), CAPACITY),
		Tubes.canonicalKey(cells("..331122"), CAPACITY));
	check("but the contents do",
		Tubes.canonicalKey(cells("1122...."), CAPACITY)
		!== Tubes.canonicalKey(cells("2211...."), CAPACITY));
}

// --- Levels -----------------------------------------------------------------

group("Levels");
{
	const level = new PourLevel();
	level.capacity = CAPACITY;
	level.colours = 2;
	level.cells = cells(MIXED);
	check("a level with every colour accounted for is valid", level.isValid());
	eq("its spare tubes are the ones with nothing in them", level.spareTubes(), 1);
	eq("a fully mixed board scrambles to one", level.scramble(), 1);

	const tidy = new PourLevel();
	tidy.capacity = CAPACITY;
	tidy.colours = 2;
	tidy.cells = cells("11112222....");
	eq("an already sorted board scrambles to zero", tidy.scramble(), 0);

	const short = new PourLevel();
	short.capacity = CAPACITY;
	short.colours = 2;
	short.cells = cells("1112....");
	check("a level missing a unit of a colour is not valid", !short.isValid());

	const noRoom = new PourLevel();
	noRoom.capacity = CAPACITY;
	noRoom.colours = 2;
	noRoom.cells = cells("11112222");
	check("nor is one with no spare tube at all", !noRoom.isValid());

	const restored = PourLevel.fromJSON(level.toJSON());
	check("a level survives a round trip through JSON", restored !== null);
	eq("with the same board", text(restored.cells), text(level.cells));
	eq("and the same fingerprint", restored.fingerprint(), level.fingerprint());
	check("a fingerprint tells two boards apart",
		level.fingerprint() !== tidy.fingerprint());
	eq("nonsense does not load as a level", PourLevel.fromJSON({ cells: "zz" }), null);
}

// --- Solving ----------------------------------------------------------------

group("Solver");
{
	const start = cells(MIXED);
	const result = Solver.solve(start, CAPACITY);
	check("the fixture can be solved", result.solved);
	check("and the search did not run out of budget", !result.exhausted);
	eq("the board it was handed is left alone", text(start), MIXED);

	const replay = cells(MIXED);
	let legal = true;
	for (const [from, to] of result.moves) {
		if (Tubes.applyPour(replay, CAPACITY, from, to) === null) legal = false;
	}
	check("every move it found is a legal pour", legal);
	check("and playing them through finishes the board",
		Tubes.isSolvedBoard(replay, CAPACITY));

	// Two full tubes, alternating, with nowhere to put anything.
	const wedged = Solver.solve(cells("12121212"), CAPACITY);
	check("a board with no legal pour is refused", !wedged.solved);
	check("and refused as proved, not as given up on", !wedged.exhausted);

	const tiny = Solver.solve(cells(MIXED), CAPACITY, 1);
	check("a search cut short says so", tiny.exhausted && !tiny.solved);
}

// --- The ladder -------------------------------------------------------------

group("Ladder");
{
	eq("level 1 opens with three colours", Ladder.colourCountFor(1), Ladder.FIRST_COLOURS);
	eq("and six tubes to put them in", Ladder.tubeCountFor(1), 6);

	let climbing = true;
	let previous = 0;
	for (let level = 1; level <= 200; level += 1) {
		const colours = Ladder.colourCountFor(level);
		if (colours < previous) climbing = false;
		previous = colours;
	}
	check("colours never go backwards", climbing);
	eq("and stop at the palette's limit", Ladder.colourCountFor(500), Ladder.LAST_COLOURS);
	eq("the largest board is reached where the ladder says",
		Ladder.colourCountFor(Ladder.finalColourLevel()), Ladder.LAST_COLOURS);
	check("a step up is the first level of its colour count",
		Ladder.isStepUp(Ladder.finalColourLevel()) && !Ladder.isStepUp(Ladder.finalColourLevel() + 1));
	eq("the next step up is found from below", Ladder.nextStepUp(1), 3);
	eq("and there is none once the colours run out",
		Ladder.nextStepUp(Ladder.finalColourLevel()), 0);

	let sane = true;
	let rising = true;
	let lastFloor = -1;
	for (let level = 1; level <= 120; level += 1) {
		const spec = Ladder.specFor(level);
		if (spec.minScramble <= 0 || spec.maxScramble > 1) sane = false;
		if (spec.minScramble >= spec.maxScramble) sane = false;
		if (Ladder.isStepUp(level)) lastFloor = -1;
		else if (spec.minScramble < lastFloor - 1e-9) rising = false;
		lastFloor = spec.minScramble;
	}
	check("every difficulty window is a window", sane);
	check("and it tightens with every level inside a colour count", rising);
	check("the opening levels get a third spare tube",
		Ladder.spareTubesFor(1) === 3 && Ladder.spareTubesFor(120) === 2);
	check("free colours are only given away early",
		Ladder.specFor(1).allowFreeColours
		&& !Ladder.specFor(Ladder.NO_FREE_COLOURS_FROM).allowFreeColours);

	eq("the first level with three colours is level 1",
		Ladder.firstLevelWithColours(Ladder.FIRST_COLOURS), Ladder.FIRST_LEVEL);
	eq("and the first with ten is where the ladder says",
		Ladder.firstLevelWithColours(Ladder.LAST_COLOURS), Ladder.finalColourLevel());
	eq("a colour count past the palette is clamped to it",
		Ladder.firstLevelWithColours(99), Ladder.finalColourLevel());
	let ascending = true;
	for (let index = 1; index < Ladder.DIFFICULTIES.length; index += 1) {
		if (Ladder.DIFFICULTIES[index].colours <= Ladder.DIFFICULTIES[index - 1].colours) {
			ascending = false;
		}
	}
	check("the difficulties climb the ladder in order", ascending);
	for (const entry of Ladder.DIFFICULTIES) {
		const level = Ladder.firstLevelWithColours(entry.colours);
		eq(`${entry.name} opens with ${entry.colours} colours`,
			Ladder.colourCountFor(level), entry.colours);
		check(`${entry.name} opens at the gentle end of its colour count`,
			level === Ladder.FIRST_LEVEL || Ladder.isStepUp(level));
	}
}

// --- Generating -------------------------------------------------------------

group("Generator");
{
	// The whole ladder, every level at which anything about the spec changes,
	// plus a sample of the rest.
	const levels = [];
	for (let level = 1; level <= 80; level += 1) levels.push(level);
	for (const level of [120, 200, 400]) levels.push(level);

	let valid = 0;
	let solvable = 0;
	let inWindow = 0;
	let freeColours = 0;
	for (const level of levels) {
		const spec = Ladder.specFor(level);
		const built = Generator.generate(spec);
		if (built === null) continue;
		if (built.isValid() && built.colours === spec.colours
			&& built.spareTubes() === spec.spareTubes) valid += 1;
		if (Solver.isSolvable(built.cells, built.capacity)) solvable += 1;
		const scramble = built.scramble();
		if (scramble >= spec.minScramble - 1e-9 && scramble <= spec.maxScramble + 1e-9) {
			inWindow += 1;
		}
		if (!spec.allowFreeColours) {
			for (let tube = 0; tube < built.tubes(); tube += 1) {
				if (Tubes.isSorted(built.cells, built.capacity, tube)) freeColours += 1;
			}
		}
	}
	eq("every level built matches the spec it was asked for", valid, levels.length);
	eq("and every one of them can be finished", solvable, levels.length);
	eq("and lands inside its difficulty window", inWindow, levels.length);
	eq("no colour is given away once the ladder stops allowing it", freeColours, 0);

	const spec = Ladder.specFor(30);
	const first = Generator.generate(spec, 12345);
	const again = Generator.generate(spec, 12345);
	eq("the same seed builds the same level", text(first.cells), text(again.cells));
	eq("down to the number of attempts it took", first.attempts, again.attempts);
	check("a different seed builds a different one",
		text(Generator.generate(spec, 999).cells) !== text(first.cells));

	const seen = new Set([first.fingerprint()]);
	const fresh = Generator.generate(spec, 12345, Generator.DEFAULT_MAX_ATTEMPTS, seen);
	check("a board the player has already had is skipped",
		fresh !== null && fresh.fingerprint() !== first.fingerprint());
}

// --- The board and its history ----------------------------------------------

group("Board and undo");
{
	const level = PourLevel.fromJSON({ capacity: CAPACITY, colours: 2, cells: MIXED, seed: 7 });
	const board = new PuzzleState();
	board.setup(level);
	eq("the board starts where the level says", text(board.cells), MIXED);
	board.transfer(0, 2, 1);
	eq("the level keeps its opening position", text(level.cells), MIXED);

	board.setup(level);
	const history = new UndoStack();
	check("nothing to undo yet", !history.canUndo());

	const amount = board.pourAmount(0, 2);
	history.push(new PourCommand(0, 2, board.topColourOf(0), amount), board);
	eq("a pour goes through the history", text(board.cells), "121.12122...");
	check("and can be taken back", history.canUndo());
	history.undo(board);
	eq("undo puts the board back exactly", text(board.cells), MIXED);
	check("and empties the history", !history.canUndo());
	eq("undoing an empty history does nothing", history.undo(board), []);

	// Ten pours and ten undos, checked against the board they started from.
	board.setup(level);
	const start = text(board.cells);
	const stack = new UndoStack();
	let moves = 0;
	for (let step = 0; step < 10; step += 1) {
		let done = false;
		for (let from = 0; from < board.tubes() && !done; from += 1) {
			for (let to = 0; to < board.tubes() && !done; to += 1) {
				const size = board.pourAmount(from, to);
				if (size === 0) continue;
				stack.push(new PourCommand(from, to, board.topColourOf(from), size), board);
				moves += 1;
				done = true;
			}
		}
	}
	while (stack.canUndo()) stack.undo(board);
	eq("ten pours undo back to the opening position", text(board.cells), start);
	check("and there were ten of them to undo", moves === 10);

	board.setup(level);
	const added = board.addTube();
	eq("an extra tube goes on the end", added, 3);
	eq("and it is empty", text(board.cells), `${MIXED}....`);
	const grown = new UndoStack();
	grown.push(new PourCommand(0, 3, board.topColourOf(0), board.pourAmount(0, 3)), board);
	grown.undo(board);
	eq("a pour into it undoes like any other", text(board.cells), `${MIXED}....`);

	const saved = new UndoStack();
	saved.push(new PourCommand(0, 2, 2, 1), board);
	const reloaded = new UndoStack();
	reloaded.fromJSON(JSON.parse(JSON.stringify(saved.toJSON())));
	eq("history survives a round trip through storage", reloaded.depth(), 1);
	reloaded.fromJSON({ moves: [{ t: "pour" }, { t: "future-move" }, 7] });
	eq("and entries it cannot read are dropped rather than faulted",
		reloaded.depth(), 0);

	// Empty pours, because what is under test is the stack's own bookkeeping
	// rather than anything they would do to the board.
	const deep = new UndoStack();
	board.setup(level);
	for (let step = 0; step < UndoStack.MAX_DEPTH + 20; step += 1) {
		deep.push(new PourCommand(0, 1, 1, 0), board);
	}
	eq("history is capped", deep.depth(), UndoStack.MAX_DEPTH);
}

group("Saving a board");
{
	const level = PourLevel.fromJSON({ capacity: CAPACITY, colours: 2, cells: MIXED, seed: 7 });
	const board = new PuzzleState();
	board.setup(level);
	board.addTube();
	board.transfer(0, 3, 1);

	const restored = new PuzzleState();
	check("a board loads back", restored.fromJSON(JSON.parse(JSON.stringify(board.toJSON()))));
	eq("with the extra tube still on it", restored.tubes(), 4);
	eq("and the liquid where it was left", text(restored.cells), text(board.cells));

	const tampered = new PuzzleState();
	tampered.fromJSON({ level: level.toJSON(), cells: "111111111111" });
	eq("a board that could not have come from this level falls back to the opening one",
		text(tampered.cells), MIXED);

	const truncated = new PuzzleState();
	truncated.fromJSON({ level: level.toJSON(), cells: "12" });
	eq("so does a truncated one", text(truncated.cells), MIXED);
	check("and a level that will not load is refused outright",
		!new PuzzleState().fromJSON({ level: { cells: "" } }));
}

// --- Saved documents --------------------------------------------------------

group("Save documents");
{
	const empty = Migration.emptyDocument();
	eq("a fresh document is at the current version", empty.version, Migration.CURRENT_VERSION);
	eq("with nothing in progress", Object.keys(empty.session).length, 0);
	eq("and the player on the first level", empty.stats.progress.level, Ladder.FIRST_LEVEL);

	const kept = Migration.migrate({
		version: 1,
		session: { level: 4 },
		stats: { progress: { level: 4, completed: 3 } },
	});
	eq("a document of this version keeps its progress", kept.stats.progress.level, 4);
	eq("and its session", kept.session.level, 4);
	check("and gains the blocks it was missing",
		"totals" in kept.stats && "streak" in kept.stats && "seen" in kept.stats);

	eq("a document with no version is discarded",
		Object.keys(Migration.migrate({ stats: { progress: { level: 9 } } }).session).length, 0);
	eq("so is one from a newer build",
		Migration.migrate({ version: 99, stats: { progress: { level: 9 } } }).stats.progress.level,
		Ladder.FIRST_LEVEL);
	eq("migrating does not touch the document it was given",
		Migration.migrate({ version: 1, stats: {} }).stats.progress.level, Ladder.FIRST_LEVEL);

	const patched = Migration.normalize({ version: 1, session: {}, stats: { totals: { moves: 5 } } });
	eq("normalize keeps what a partial document does have", patched.stats.totals.moves, 5);
	eq("and fills in what it does not", patched.stats.totals.clean, 0);
	eq("a level number below the first is lifted to it",
		Migration.normalize({ version: 1, stats: { progress: { level: -3 } } }).stats.progress.level,
		Ladder.FIRST_LEVEL);

	eq("an old save carries on from the level it left off on",
		Migration.normalize({ stats: { progress: { level: 42, completed: 41 } } })
			.stats.progress.playing, 42);
	eq("a save that names both keeps them apart",
		Migration.normalize({ stats: { progress: { level: 40, playing: 4 } } })
			.stats.progress.playing, 4);
	eq("and the furthest reached is never behind the level being played",
		Migration.normalize({ stats: { progress: { level: 3, playing: 30 } } })
			.stats.progress.level, 30);
	eq("a fresh document starts both levels at the first",
		Migration.emptyProgress().playing, Ladder.FIRST_LEVEL);
}

// --- Seeded randomness ------------------------------------------------------

group("Seeded randomness");
{
	const a = new Rng(42);
	const b = new Rng(42);
	const first = [a.nextUint32(), a.nextUint32(), a.nextUint32()];
	eq("the same seed gives the same stream",
		first, [b.nextUint32(), b.nextUint32(), b.nextUint32()]);
	check("and the values are 32-bit unsigned",
		first.every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff));
	check("a different seed gives a different stream", new Rng(43).nextUint32() !== first[0]);

	const spread = new Rng(7);
	const counts = new Int32Array(5);
	for (let draw = 0; draw < 5000; draw += 1) counts[spread.randiRange(0, 4)] += 1;
	check("randiRange covers its whole inclusive span",
		[...counts].every((count) => count > 800));

	const order = new Rng(11).shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
	eq("a shuffle keeps every item exactly once", [...order].sort((x, y) => x - y),
		[0, 1, 2, 3, 4, 5, 6, 7]);
	check("a seed still reaches the platform when asked for one",
		Number.isFinite(Rng.randomSeed()));
}

// --- Result -----------------------------------------------------------------

process.stdout.write(`\n${passed} checks passed`);
if (failures.length > 0) {
	process.stdout.write(`, ${failures.length} FAILED\n`);
	for (const failure of failures) process.stdout.write(`  ${failure}\n`);
	process.exit(1);
}
process.stdout.write(".\n");
