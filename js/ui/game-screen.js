import * as Ladder from "../puzzle/ladder.js";
import { RackView } from "./rack.js";
import { Emitter } from "../util/emitter.js";

/**
 * The playing screen: the rack, the toolbar, and the card that covers them.
 *
 * This is the only view that knows all the pieces exist, and its whole job is
 * translating between them: a tap on a tube becomes a GameState call, a GameState
 * event becomes a label. Nothing here holds game state of its own, so the screen
 * can be closed and reopened mid-level without losing anything.
 *
 * Emits: exitRequested()
 */
export class GameScreen extends Emitter {
	/** How long a status message stays up. */
	static STATUS_MS = 4000;

	constructor(root, game, settings) {
		super();
		this.root = root;
		this.game = game;

		this._levelLabel = root.querySelector("#level-label");
		this._movesLabel = root.querySelector("#moves-label");
		this._timeLabel = root.querySelector("#time-label");
		this._progressLabel = root.querySelector("#progress-label");
		this._statusLabel = root.querySelector("#status-label");
		this._undoButton = root.querySelector("#undo-button");
		this._tubeButton = root.querySelector("#tube-button");
		this._restartButton = root.querySelector("#restart-button");
		this._backButton = root.querySelector("#back-button");
		this._resultPanel = root.querySelector("#result-panel");
		this._resultTitle = root.querySelector("#result-title");
		this._resultDetail = root.querySelector("#result-detail");
		this._nextButton = root.querySelector("#next-button");
		this._resultMenuButton = root.querySelector("#result-menu-button");

		this._rack = new RackView(root.querySelector("#rack"), game, settings);

		this._statusTimer = null;

		this._wireRack();
		this._wireButtons();
		this._wireGame();
		this._installKeyboard();

		this._resultPanel.hidden = true;
		this._statusLabel.textContent = "";
	}

	_wireRack() {
		this._rack.on("tubeTapped", (index) => this.game.selectTube(index));
	}

	_wireButtons() {
		this._backButton.addEventListener("click", () => this._onBackPressed());
		this._undoButton.addEventListener("click", () => this.game.undo());
		this._tubeButton.addEventListener("click", () => this.game.addTube());
		this._restartButton.addEventListener("click", () => this.game.restartLevel());
		this._nextButton.addEventListener("click", () => this._onNextPressed());
		this._resultMenuButton.addEventListener("click", () => this._onBackPressed());
	}

	_wireGame() {
		const game = this.game;
		game.on("levelLoaded", (level) => {
			this._resultPanel.hidden = true;
			this._levelLabel.textContent = Ladder.describe(level);
			if (Ladder.isStepUp(level)) this._showStatus("A new colour from here on.");
			else if (level === Ladder.FIRST_LEVEL) {
				this._showStatus("Tap a tube, then tap where to pour it.");
			} else this._clearStatus();
		});
		game.on("movesChanged", (moves) => {
			this._movesLabel.textContent = `${moves} ${moves === 1 ? "pour" : "pours"}`;
		});
		game.on("timeChanged", (seconds) => {
			this._timeLabel.textContent = formatTime(seconds);
		});
		game.on("progressChanged", (sorted, total) => {
			this._progressLabel.textContent = `${sorted} / ${total} colours sorted`;
		});
		game.on("historyChanged", (canUndo) => {
			this._undoButton.disabled = !canUndo;
		});
		// A message about the board -- that it has nothing left to pour, say -- is
		// about the board as it was. Taking a move back answers it, so it goes.
		game.on("boardChanged", () => this._clearStatus());
		game.on("helpersChanged", (left) => {
			this._tubeButton.disabled = left <= 0;
		});
		game.on("tubeAdded", () => this._showStatus("One more tube. Make it count."));
		game.on("stuck", () => {
			this._showStatus("No pour left that goes anywhere — undo, or start the level over.");
		});
		game.on("levelUnavailable", () => {
			this._showStatus("Could not build a level. Try again.");
		});
		game.on("levelCompleted", (level, moves, seconds, clean) => {
			this._showResult(level, moves, seconds, clean);
		});
	}

	/**
	 * Keyboard play. The tubes are buttons, so tabbing between them and pressing
	 * one is already the whole of the game; what is left is the toolbar, which is
	 * quicker under a finger than under four more presses of Tab.
	 */
	_installKeyboard() {
		window.addEventListener("keydown", (event) => {
			if (this.root.hidden) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const key = event.key.toLowerCase();
			if (!this._resultPanel.hidden) {
				if (key === "escape") this._onBackPressed();
				else return;
			} else if (key === "u" || key === "z") this.game.undo();
			else if (key === "t") this.game.addTube();
			else if (key === "r") this.game.restartLevel();
			else if (key === "escape") this._onBackPressed();
			else return;
			event.preventDefault();
		});
	}

	/**
	 * The card waits for the rack to finish pouring. The board is already solved by
	 * the time this runs, and covering the last pour with a panel would take away
	 * the one moment the player has been working towards.
	 */
	async _showResult(level, moves, seconds, clean) {
		await this._rack.whenIdle();
		this._resultTitle.textContent = `Level ${level} done`;
		const parts = [`${moves} pours`, formatTime(seconds)];
		if (clean) parts.push("clean run");
		this._resultDetail.textContent = parts.join("   ");
		this._nextButton.textContent = `Level ${level + 1}`;
		this._resultPanel.hidden = false;
		this._nextButton.focus();
	}

	_onNextPressed() {
		this._resultPanel.hidden = true;
		// The level after the one just finished, which is what the button says.
		// A player who dropped back to an easier board carries on from there.
		this.game.startLevel(this.game.levelNumber + 1);
	}

	_onBackPressed() {
		if (!this.game.finished) this.game.suspend();
		this.emit("exitRequested");
	}

	_showStatus(message) {
		this._statusLabel.textContent = message;
		if (this._statusTimer !== null) clearTimeout(this._statusTimer);
		this._statusTimer = setTimeout(() => this._clearStatus(), GameScreen.STATUS_MS);
	}

	_clearStatus() {
		if (this._statusTimer !== null) clearTimeout(this._statusTimer);
		this._statusTimer = null;
		this._statusLabel.textContent = "";
	}
}

function formatTime(seconds) {
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
