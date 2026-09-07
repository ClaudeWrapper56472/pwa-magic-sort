import * as Ladder from "../puzzle/ladder.js";
import { Emitter } from "../util/emitter.js";

/**
 * Title screen, and three ways off it.
 *
 * The play button carries on: a suspended level if there is one, otherwise the
 * level the player is on. Below it, and only when the two have parted company,
 * a button back to the furthest level they have reached -- the way back from an
 * easier board. Then Easy, Medium and Hard, which always start their part of the
 * ladder from the beginning.
 *
 * The menu does not decide what carrying on means -- it just reports the press
 * and lets the router work out whether there is a game to resume. All it asks
 * the save for is what to write on the buttons.
 *
 * Emits: playRequested(), levelChosen(level)
 */
export class MenuScreen extends Emitter {
	constructor(root, save, settings) {
		super();
		this.root = root;
		this.save = save;
		this.settings = settings;
		this._playButton = root.querySelector("#play-button");
		this._furthestButton = root.querySelector("#furthest-button");
		this._startAt = root.querySelector("#start-at");
		this._motionButton = root.querySelector("#motion-button");
		this._stats = root.querySelector("#menu-stats");

		this._playButton.addEventListener("click", () => this.emit("playRequested"));
		this._furthestButton.addEventListener("click",
			() => this.emit("levelChosen", this.save.furthestLevel()));
		this._motionButton.addEventListener("click", () => {
			this.settings.set("motion", !this.settings.get("motion"));
		});
		this._buildDifficulties();
		save.on("statsChanged", () => this.refresh());
		save.on("sessionAvailable", () => this.refresh());
		settings.on("changed", () => this._refreshMotion());
		this.refresh();
	}

	refresh() {
		const carryingOn = this._renderPlayButton();
		this._renderFurthest(carryingOn);
		this._refreshMotion();
		this._renderStats();
	}

	/** Writes the play button, and answers which level it would start. */
	_renderPlayButton() {
		if (!this.save.hasSession()) {
			const level = this.save.playingLevel();
			this._playButton.textContent = `Play level ${level}`;
			return level;
		}
		const session = this.save.session();
		const level = Math.max(Number(session.level ?? Ladder.FIRST_LEVEL), Ladder.FIRST_LEVEL);
		const seconds = Math.floor(Number(session.elapsed ?? 0));
		this._playButton.textContent = `Continue level ${level}  ·  ${formatTime(seconds)}`;
		return level;
	}

	/**
	 * The way back to the furthest level reached. Hidden while the play button is
	 * already offering it, which is the usual case: the two only part company
	 * after a difficulty button drops the player onto an easier board.
	 */
	_renderFurthest(carryingOn) {
		const furthest = this.save.furthestLevel();
		this._furthestButton.hidden = furthest === carryingOn;
		if (this._furthestButton.hidden) return;
		this._furthestButton.textContent =
			`Back to level ${furthest}  ·  ${Ladder.colourCountFor(furthest)} colours`;
	}

	/**
	 * The difficulty row. Each button starts its part of the ladder from the
	 * beginning, whatever the player has done since, so the labels are fixed and
	 * are written once here.
	 */
	_buildDifficulties() {
		const heading = document.createElement("h2");
		heading.textContent = "Start at";

		const row = document.createElement("div");
		row.className = "difficulty";
		row.setAttribute("role", "group");
		row.setAttribute("aria-label", "Start at a difficulty");

		for (const entry of Ladder.DIFFICULTIES) {
			const start = Ladder.firstLevelWithColours(entry.colours);
			const button = document.createElement("button");
			button.type = "button";
			const level = document.createElement("span");
			level.className = "level";
			level.textContent = `Level ${start}`;
			const colours = document.createElement("span");
			colours.className = "colours";
			colours.textContent = `${entry.colours} colours`;
			button.append(document.createTextNode(entry.name), level, colours);
			button.setAttribute("aria-label",
				`${entry.name}: level ${start}, ${entry.colours} colours`);
			button.addEventListener("click", () => this.emit("levelChosen", start));
			row.append(button);
		}

		this._startAt.replaceChildren(heading, row);
	}

	_refreshMotion() {
		const on = this.settings.get("motion");
		this._motionButton.textContent = `Pour animation: ${on ? "on" : "off"}`;
		this._motionButton.setAttribute("aria-pressed", String(on));
	}

	_renderStats() {
		const level = this.save.playingLevel();
		const completed = this.save.levelsCompleted();
		const streak = this.save.streak();
		const run = Number(streak.current ?? 0);
		const best = Number(streak.best ?? 0);

		const lines = [
			`On level ${level}  ·  ${Ladder.colourCountFor(level)} colours`,
			`${completed} level${completed === 1 ? "" : "s"} finished`,
		];
		if (run > 0) lines.push(`${run} clean in a row (best ${best})`);
		else if (best > 0) lines.push(`Best clean run ${best}`);
		const nextColour = Ladder.nextStepUp(level);
		if (nextColour > 0) lines.push(`A new colour at level ${nextColour}`);

		this._stats.replaceChildren();
		const heading = document.createElement("h2");
		heading.textContent = "Progress";
		this._stats.append(heading);
		for (const line of lines) {
			const paragraph = document.createElement("p");
			paragraph.textContent = line;
			this._stats.append(paragraph);
		}
	}
}

function formatTime(seconds) {
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
