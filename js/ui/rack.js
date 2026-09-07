import { liquidColour, liquidName } from "./palette.js";
import { Emitter } from "../util/emitter.js";

/**
 * The row of tubes, and the pour.
 *
 * The rack owns the tube elements and nothing else. It listens to GameState and
 * pushes what it hears into the tubes; it sends taps back up as events rather
 * than calling GameState itself, so the same rack could be driven by a replay or
 * a tutorial with a different controller behind it.
 *
 * A tube is a button. That is not a styling accident: tapping a tube is the whole
 * of the game, and a button is the one element that already answers to a tap, a
 * click, a keyboard and a screen reader without any of it being reimplemented
 * here.
 *
 * Liquid is drawn as bands rather than as units, because a band is what the
 * player sees -- three units of one colour are one block of liquid, not three --
 * and because a band is the thing that moves. Each tube keeps exactly `capacity`
 * band elements for its whole life, most of them at zero height; a pour changes
 * two of those heights and CSS carries the liquid between them. Nothing is
 * created or destroyed mid-pour, so there is no half-built element for an
 * interrupted animation to leave behind.
 *
 * Only the top band of a tube can ever change size, so only `height` is
 * transitioned. A band's distance from the bottom of its tube is fixed for as
 * long as the band exists, which is what keeps a growing band growing from the
 * right place instead of sliding into it.
 *
 * Emits: tubeTapped(index)
 */
export class RackView extends Emitter {
	/** Rows to consider. Four is past the point where the tubes stop growing. */
	static MAX_ROWS = 4;

	/** One unit of liquid, as a fraction of the tube's width. */
	static SEG_RATIO = 0.72;

	/** A ceiling on that unit, so tubes on a tablet stay tubes rather than vats. */
	static MAX_SEG = 64;

	/** Headroom above the liquid, in units. Enough to read as an open tube. */
	static RIM_UNITS = 0.38;

	/** Share of the rack's height kept clear so a tilted tube has somewhere to go. */
	static TILT_ROOM = 0.12;

	/** Travel to the destination, pour, and come back. */
	static LIFT_MS = 170;
	static POUR_MS = 280;
	static RETURN_MS = 160;

	/** The full lean, and the least a pour will settle for when space is short. */
	static TILT_DEGREES = 62;
	static MIN_TILT_DEGREES = 36;

	/** The twitch a tube gives when it cannot take the pour. */
	static REFUSE_MS = 240;

	/** How far above the destination's rim the spout hovers, in tube heights. */
	static MOUTH_GAP = 0.16;

	constructor(root, game, settings) {
		super();
		this.root = root;
		this.game = game;
		this.settings = settings;
		this._tubes = [];
		this._rows = [];
		this._selected = -1;
		/** Animations run one after another; this is the tail of that chain. */
		this._queue = Promise.resolve();
		this._busy = 0;
		/** Bumped whenever the tubes are rebuilt, so queued pours know to stand down. */
		this._generation = 0;

		this._stream = document.createElement("div");
		this._stream.className = "stream";

		this.root.addEventListener("click", (event) => this._onClick(event));
		new ResizeObserver(() => this._relayout()).observe(this.root);

		game.on("levelLoaded", () => this._rebuild());
		game.on("tubeAdded", () => this._rebuild(true));
		game.on("boardChanged", () => this.render());
		game.on("poured", (from, to, colour) => this.playPour(from, to, colour));
		game.on("selectionChanged", (index) => {
			this._selected = index;
			this._refreshTubes();
		});
		game.on("pourRefused", (index) => this._refuse(index));
	}

	isBusy() {
		return this._busy > 0;
	}

	/** Resolves once every queued animation has finished. */
	whenIdle() {
		return this._queue;
	}

	// --- Building and measuring ---------------------------------------------

	_rebuild(highlightLast = false) {
		this._generation += 1;
		this.root.replaceChildren();
		this._tubes = [];
		this._rows = [];

		const count = this.game.tubes();
		if (count === 0) return;

		for (let index = 0; index < count; index += 1) {
			const tube = this._buildTube(index);
			// A fresh rack assembles itself tube by tube. A rack that has just gained
			// one only animates that one: replaying the whole entrance would say the
			// board had been rebuilt, when a single tube arrived.
			const arriving = highlightLast && index === count - 1;
			tube.style.setProperty("--order", String(index));
			tube.classList.toggle("is-new", arriving);
			tube.classList.toggle("is-entering", !highlightLast);
			this._tubes.push(tube);
		}

		this.root.append(this._stream);
		this._relayout();
		this._renderInstantly();
	}

	_buildTube(index) {
		const tube = document.createElement("button");
		tube.type = "button";
		tube.className = "tube";
		tube.dataset.index = String(index);

		const liquid = document.createElement("div");
		liquid.className = "liquid";
		for (let slot = 0; slot < this.game.capacity(); slot += 1) {
			const band = document.createElement("div");
			band.className = "band";
			band.style.setProperty("--size", "0");
			band.style.setProperty("--base", "0");
			liquid.append(band);
		}

		const glass = document.createElement("div");
		glass.className = "glass";
		const shine = document.createElement("div");
		shine.className = "shine";
		glass.append(shine);

		tube.append(liquid, glass);
		return tube;
	}

	/**
	 * Fits the tubes to the space, and publishes the one number everything else is
	 * measured from.
	 *
	 * How many rows to use is not a constant, because the answer depends on the
	 * screen as much as on the number of tubes: six tubes across one row of a phone
	 * are thin and wasteful when the same six make two rows of three at nearly
	 * twice the size. So every row count is tried and the one that makes the
	 * biggest tube wins, which is the same rule a person laying them out by hand
	 * would use.
	 *
	 * Rebuilding the rows only when the count changes is what lets this run on
	 * every resize -- a rack that already has the right number of rows just moves
	 * its tubes into them, keeping whatever state each one is carrying.
	 */
	_relayout() {
		if (this._tubes.length === 0) return;
		const width = this.root.clientWidth;
		const height = this.root.clientHeight;
		if (width === 0 || height === 0) return;

		const count = this._tubes.length;
		const gap = Math.round(Math.min(14, Math.max(6, width * 0.022)));
		const rowGap = Math.round(gap * 1.5);
		const unitsTall = this.game.capacity() + RackView.RIM_UNITS;
		const usableHeight = height * (1 - RackView.TILT_ROOM);

		let best = { rows: 1, seg: 0 };
		for (let rows = 1; rows <= Math.min(RackView.MAX_ROWS, count); rows += 1) {
			const perRow = Math.ceil(count / rows);
			const fromWidth = ((width - (perRow - 1) * gap) / perRow) * RackView.SEG_RATIO;
			const fromHeight = (usableHeight - (rows - 1) * rowGap) / (rows * unitsTall);
			const seg = Math.min(fromWidth, fromHeight, RackView.MAX_SEG);
			// A hair's difference is not worth an extra row, so ties keep the flatter
			// rack.
			if (seg > best.seg + 0.5) best = { rows, seg };
		}
		const seg = Math.max(6, Math.floor(best.seg));

		const rows = RackView.rowsFor(count, best.rows);
		if (rows.join() !== this._rows.join()) this._seat(rows);

		const style = this.root.style;
		style.setProperty("--seg", `${seg}px`);
		style.setProperty("--tube-w", `${Math.round(seg / RackView.SEG_RATIO)}px`);
		style.setProperty("--rim", `${seg * RackView.RIM_UNITS}px`);
		style.setProperty("--tube-gap", `${gap}px`);
		style.setProperty("--row-gap", `${rowGap}px`);
		style.setProperty("--tilt-room", `${Math.round(height * RackView.TILT_ROOM)}px`);
		style.setProperty("--capacity", String(this.game.capacity()));
		style.setProperty("--lift-ms", `${RackView.LIFT_MS}ms`);
		style.setProperty("--pour-ms", `${RackView.POUR_MS}ms`);
		style.setProperty("--return-ms", `${RackView.RETURN_MS}ms`);
		style.setProperty("--refuse-ms", `${RackView.REFUSE_MS}ms`);
	}

	/** How many tubes go on each row, with the leftovers spread from the top. */
	static rowsFor(count, rows) {
		const base = Math.floor(count / rows);
		const extra = count % rows;
		return Array.from({ length: rows }, (_, row) => base + (row < extra ? 1 : 0));
	}

	/** Moves the existing tubes into a fresh set of rows. */
	_seat(rows) {
		this._rows = rows;
		const seated = [];
		let index = 0;
		for (const length of rows) {
			const row = document.createElement("div");
			row.className = "rack-row";
			for (let seat = 0; seat < length; seat += 1) {
				row.append(this._tubes[index]);
				index += 1;
			}
			seated.push(row);
		}
		this.root.replaceChildren(...seated, this._stream);
	}

	// --- Painting -----------------------------------------------------------

	render() {
		for (let index = 0; index < this._tubes.length; index += 1) this._renderTube(index);
	}

	/** A repaint with the liquid already where it belongs, for a board arriving whole. */
	_renderInstantly() {
		this.root.classList.add("is-still");
		this.render();
		// Read a layout property so the browser commits the new heights before the
		// transitions are switched back on, rather than animating from the old ones.
		void this.root.offsetWidth;
		this.root.classList.remove("is-still");
	}

	_renderTube(index) {
		const tube = this._tubes[index];
		const bands = this.game.board.bandsOf(index);
		const slots = tube.firstElementChild.children;
		for (let slot = 0; slot < slots.length; slot += 1) {
			const band = bands[slot];
			const element = slots[slot];
			if (band === undefined) {
				element.style.setProperty("--size", "0");
				element.classList.remove("is-top");
				continue;
			}
			element.style.setProperty("--colour", liquidColour(band.colour));
			element.style.setProperty("--base", String(band.base));
			element.style.setProperty("--size", String(band.size));
			element.classList.toggle("is-top", slot === bands.length - 1);
		}
		this._refreshTube(index);
	}

	_refreshTubes() {
		for (let index = 0; index < this._tubes.length; index += 1) this._refreshTube(index);
	}

	_refreshTube(index) {
		const tube = this._tubes[index];
		const picked = index === this._selected;
		const done = this.game.board.isSorted(index);
		tube.classList.toggle("is-picked", picked);
		tube.classList.toggle("is-done", done);
		tube.setAttribute("aria-pressed", String(picked));
		tube.setAttribute("aria-label", this._describe(index, picked, done));
	}

	/** What a screen reader reads out for a tube, bottom of the tube first. */
	_describe(index, picked, done) {
		const bands = this.game.board.bandsOf(index);
		const parts = [`Tube ${index + 1}`];
		if (bands.length === 0) {
			parts.push("empty");
		} else {
			const contents = bands.map((band) => {
				const name = liquidName(band.colour);
				return band.size === 1 ? name : `${band.size} ${name}`;
			});
			parts.push(contents.join(", then "));
		}
		if (done) parts.push("finished");
		if (picked) parts.push("picked up");
		return parts.join(", ");
	}

	// --- The pour -----------------------------------------------------------

	/**
	 * Lifts the source tube over the destination, pours, and sends it home.
	 *
	 * The board has already moved the liquid by the time this runs -- the rules and
	 * the undo history cannot wait on an animation -- so this is catching the
	 * picture up with a move that has happened. Everything it needs is in the
	 * arguments, so a pour that arrives while another is still running simply waits
	 * its turn on the queue.
	 *
	 * The tube goes home without being waited on. It has nothing left to say about
	 * the board, so holding the next tap for another sixth of a second would cost
	 * the player pace and buy nothing.
	 */
	playPour(from, to, colour) {
		const generation = this._generation;
		return this._run(async () => {
			// Restarting the level, or taking an extra tube, replaces every tube on
			// screen. A pour still waiting its turn when that happens is about a board
			// that is no longer there, and the rack has already been repainted from
			// the one that is.
			if (generation !== this._generation) return;
			const source = this._tubes[from];
			const target = this._tubes[to];
			if (source === undefined || target === undefined || !this._animated()) {
				this.render();
				return;
			}

			const spout = this._tiltOver(source, target);
			source.classList.add("is-pouring");
			await wait(RackView.LIFT_MS);

			this._startStream(spout, target, colour);
			this.render();
			await wait(RackView.POUR_MS);

			this._stopStream();
			this._sendHome(source);
		});
	}

	/**
	 * Points the source tube's spout at the destination's mouth.
	 *
	 * The tube pivots about its own base, so the transform is worked out from where
	 * that pivot puts the spout: rotate first, see where the mouth has ended up,
	 * and translate by whatever is left over. Doing it the other way round -- move
	 * then rotate -- would swing the spout back off the destination by the length
	 * of the tube.
	 *
	 * Which way it leans is decided by the screen, not by where it came from. A
	 * leaning tube's body reaches most of a tube-length sideways from its spout,
	 * which on a phone is well over half the width of the rack -- so it goes to
	 * whichever side of the destination has the room, and leans less when even that
	 * side is short of it. Leaning towards the destination instead sends a tube
	 * pouring into the column below it clean off the edge of the screen.
	 *
	 * Offsets rather than bounding boxes, because a tube may already be part way
	 * through a transform of its own and offsetLeft answers about the layout rather
	 * than about the picture.
	 */
	_tiltOver(source, target) {
		const width = source.offsetWidth;
		const height = source.offsetHeight;
		const from = this._placeOf(source);
		const to = this._placeOf(target);
		const across = to.x - from.x;
		const down = to.y - from.y;

		const spoutAt = to.x + width / 2;
		const roomRight = this.root.clientWidth - spoutAt - width / 2;
		const roomLeft = spoutAt - width / 2;
		const bodyRight = roomRight >= roomLeft;
		const room = Math.max(bodyRight ? roomRight : roomLeft, 0);
		const fits = (Math.asin(Math.min(room / height, 1)) * 180) / Math.PI;
		const lean = Math.min(RackView.TILT_DEGREES, Math.max(RackView.MIN_TILT_DEGREES, fits));
		// A negative angle leans the mouth left, which puts the body on the right.
		const degrees = bodyRight ? -lean : lean;
		const radians = (degrees * Math.PI) / 180;
		const mouthX = width / 2 + height * Math.sin(radians);
		const mouthY = height - height * Math.cos(radians);
		const spoutX = across + width / 2;
		const spoutY = down - height * RackView.MOUTH_GAP;

		source.style.transform =
			`translate(${spoutX - mouthX}px, ${spoutY - mouthY}px) rotate(${degrees}deg)`;
		return { x: from.x + spoutX, y: from.y + spoutY };
	}

	/**
	 * Where a tube sits in the rack, whatever it is currently transformed to.
	 *
	 * Summed up through the row rather than read off the tube, because a row is a
	 * positioned element -- it carries the shelf -- and so offsetTop on a tube only
	 * says where it is in its row. Two tubes in different rows would otherwise look
	 * level with each other.
	 */
	_placeOf(tube) {
		let x = 0;
		let y = 0;
		for (let node = tube; node !== null && node !== this.root; node = node.offsetParent) {
			x += node.offsetLeft;
			y += node.offsetTop;
		}
		return { x, y };
	}

	_sendHome(source) {
		source.style.transform = "";
		source.classList.remove("is-pouring");
		source.classList.add("is-returning");
		setTimeout(() => source.classList.remove("is-returning"), RackView.RETURN_MS);
	}

	/**
	 * The falling liquid, drawn behind the tubes so it disappears into the
	 * destination rather than down its front.
	 */
	_startStream(spout, target, colour) {
		const stream = this._stream;
		const bottom = this._placeOf(target).y + target.offsetHeight * 0.5;
		stream.style.left = `${spout.x}px`;
		stream.style.top = `${spout.y}px`;
		stream.style.height = `${Math.max(bottom - spout.y, 0)}px`;
		stream.style.setProperty("--colour", liquidColour(colour));
		stream.classList.add("is-flowing");
	}

	_stopStream() {
		this._stream.classList.remove("is-flowing");
	}

	/**
	 * A tube that cannot take the pour twitches and stays where it is.
	 *
	 * The refusal is the whole message, so it is delivered where the player is
	 * already looking rather than as a line of text at the bottom of the screen.
	 */
	_refuse(index) {
		const tube = this._tubes[index];
		if (tube === undefined) return;
		tube.classList.remove("is-refused");
		void tube.offsetWidth;
		tube.classList.add("is-refused");
		// Cleared on a timer rather than on animationend, which never arrives when
		// the player -- or the system -- has asked for no animation at all.
		setTimeout(() => tube.classList.remove("is-refused"), RackView.REFUSE_MS);
	}

	/** Queues an animation behind whatever is already running. */
	_run(task) {
		this._busy += 1;
		this._queue = this._queue
			.then(task)
			.catch((error) => console.warn("Pour animation failed.", error))
			.finally(() => {
				this._busy -= 1;
			});
		return this._queue;
	}

	/**
	 * The system-wide reduced-motion setting is all-or-nothing across every app, so
	 * the game keeps a switch of its own as well. Either one turns the pour into a
	 * straight cut.
	 */
	_animated() {
		if (!this.settings.get("motion")) return false;
		return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}

	_onClick(event) {
		const tube = event.target.closest(".tube");
		if (tube === null || !this.root.contains(tube)) return;
		if (this.isBusy()) return;
		this.emit("tubeTapped", Number(tube.dataset.index));
	}
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
