/**
 * Draws the app icons.
 *
 *     node tools/make-icons.mjs
 *
 * The icons are the one thing a manifest cannot take as SVG everywhere -- iOS
 * wants a PNG for the home screen -- so they are rasterised here and committed.
 * Nothing in the game loads this file; it is run when the mark changes and then
 * forgotten.
 *
 * Written out by hand rather than through an image library because the icon is
 * three rounded shapes on a flat ground, and pulling in a dependency for that
 * would cost more than the twenty lines of PNG chunking it saves. Everything
 * except the shape tests is either arithmetic or zlib, and Node has zlib.
 *
 * The artwork stays inside the middle two thirds of the square so that a
 * maskable icon keeps all of it after the launcher has cut its own shape out.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SIZES = [192, 512, 1024];

/** Samples per axis inside each pixel. Nine is plenty for shapes this smooth. */
const SUPERSAMPLE = 3;

const BENCH_TOP = [30, 38, 53];
const BENCH_BOTTOM = [18, 22, 30];
const GLASS_EDGE = [232, 238, 248];
const GLASS_FILL = [255, 255, 255];

/**
 * Three tubes, placed in fractions of the icon's width: the same picture as the
 * title screen.
 *
 * A fill is the height its surface reaches, as a fraction of the tube, and they
 * are listed from the bottom up -- so a point belongs to the first surface it is
 * under.
 */
const TUBES = [
	{ centre: 0.293, fills: [[0.25, "#3ec8e8"], [0.5, "#f279cc"]] },
	{ centre: 0.5, fills: [[1, "#f4d35e"]] },
	{ centre: 0.707, fills: [[0.25, "#8ede5a"]] },
];

const TUBE_WIDTH = 0.155;
const TUBE_TOP = 0.235;
const TUBE_BOTTOM = 0.8;
const WALL = 0.022;

const here = dirname(fileURLToPath(import.meta.url));

/** Renders the icon into one RGB byte per channel per pixel. */
function paint(size) {
	const pixels = new Uint8Array(size * size * 3);
	const step = 1 / (SUPERSAMPLE + 1);
	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) {
			let red = 0;
			let green = 0;
			let blue = 0;
			for (let sy = 1; sy <= SUPERSAMPLE; sy += 1) {
				for (let sx = 1; sx <= SUPERSAMPLE; sx += 1) {
					const sample = colourAt((column + sx * step) / size, (row + sy * step) / size);
					red += sample[0];
					green += sample[1];
					blue += sample[2];
				}
			}
			const samples = SUPERSAMPLE * SUPERSAMPLE;
			const at = (row * size + column) * 3;
			pixels[at] = Math.round(red / samples);
			pixels[at + 1] = Math.round(green / samples);
			pixels[at + 2] = Math.round(blue / samples);
		}
	}
	return pixels;
}

/** The colour at one point of the icon, in unit coordinates. */
function colourAt(x, y) {
	let colour = mix(BENCH_TOP, BENCH_BOTTOM, Math.min(y * 1.4, 1));
	for (const tube of TUBES) {
		const outer = tubeShape(tube.centre, 0);
		if (!inside(outer, x, y)) continue;
		const inner = tubeShape(tube.centre, WALL);
		if (!inside(inner, x, y)) return GLASS_EDGE;
		colour = mix(colour, GLASS_FILL, 0.07);
		const level = (TUBE_BOTTOM - y) / (TUBE_BOTTOM - TUBE_TOP);
		for (const [surface, ink] of tube.fills) {
			if (level <= surface) return rgb(ink);
		}
	}
	return colour;
}

/**
 * A tube as a rectangle with a half-round foot, inset by `wall`.
 *
 * Two numbers describe it: the straight part, and the circle the bottom is cut
 * from. Every point test below is one comparison against each.
 */
function tubeShape(centre, wall) {
	const half = TUBE_WIDTH / 2 - wall;
	return {
		left: centre - half,
		right: centre + half,
		top: TUBE_TOP + wall,
		foot: TUBE_BOTTOM - wall - half,
		radius: half,
		centre,
	};
}

function inside(shape, x, y) {
	if (x < shape.left || x > shape.right || y < shape.top) return false;
	if (y <= shape.foot) return true;
	const dx = x - shape.centre;
	const dy = y - shape.foot;
	return dx * dx + dy * dy <= shape.radius * shape.radius;
}

function mix(from, to, amount) {
	return [
		from[0] + (to[0] - from[0]) * amount,
		from[1] + (to[1] - from[1]) * amount,
		from[2] + (to[2] - from[2]) * amount,
	];
}

function rgb(hex) {
	return [
		Number.parseInt(hex.slice(1, 3), 16),
		Number.parseInt(hex.slice(3, 5), 16),
		Number.parseInt(hex.slice(5, 7), 16),
	];
}

// --- PNG --------------------------------------------------------------------

/** Eight-bit RGB, one IDAT, no interlacing: the simplest file that is still a PNG. */
function encodePng(width, height, pixels) {
	const stride = width * 3;
	// Every scanline carries a filter byte, and 0 means "stored as is". The
	// picture is flat colour over large areas, which deflate handles well enough
	// on its own that a cleverer filter would save nothing worth the code.
	const raw = new Uint8Array((stride + 1) * height);
	for (let row = 0; row < height; row += 1) {
		raw[row * (stride + 1)] = 0;
		raw.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
	}

	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header[8] = 8; // bits per channel
	header[9] = 2; // truecolour
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", new Uint8Array(0)),
	]);
}

function chunk(type, data) {
	const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = new Int32Array(256);
for (let index = 0; index < 256; index += 1) {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) {
		value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	}
	CRC_TABLE[index] = value;
}

function crc32(bytes) {
	let crc = -1;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ -1) >>> 0;
}

// --- Run --------------------------------------------------------------------

for (const size of SIZES) {
	const png = encodePng(size, size, paint(size));
	writeFileSync(join(here, "..", "icons", `icon-${size}.png`), png);
	process.stdout.write(`icons/icon-${size}.png\n`);
}
