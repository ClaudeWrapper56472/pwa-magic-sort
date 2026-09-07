import { Settings } from "../settings.js";
import { SaveManager } from "../save-manager.js";
import { GameState } from "../game-state.js";
import { MenuScreen } from "./menu-screen.js";
import { GameScreen } from "./game-screen.js";

/**
 * Boot and screen router.
 *
 * Both screens exist from the start and are shown or hidden, rather than being
 * built and thrown away. There are only two of them and they are cheap, and
 * keeping them alive means the rack does not rebuild its tubes every time the
 * player glances at the menu.
 */

const settings = new Settings();
settings.load();

const save = new SaveManager(settings);
save.load();
save.installSuspendHooks();

const game = new GameState(save);

const menuRoot = document.querySelector("#menu-screen");
const gameRoot = document.querySelector("#game-screen");
const menu = new MenuScreen(menuRoot, save, settings);
const screen = new GameScreen(gameRoot, game, settings);

function showMenu() {
	menuRoot.hidden = false;
	gameRoot.hidden = true;
	menu.refresh();
}

function showGame() {
	menuRoot.hidden = true;
	gameRoot.hidden = false;
}

/**
 * Resuming is just what "play" means when there is something to resume. Keeping
 * that decision here rather than in the menu means the menu never has to ask the
 * save anything except what to write on the button.
 *
 * The screen is shown before the level is built, because the rack sizes its tubes
 * from the space it has been given and a hidden element has none.
 */
menu.on("playRequested", () => {
	showGame();
	if (!game.resumeSavedGame()) game.startLevel();
});

/**
 * A difficulty, or the way back to the furthest level: both name a level to start
 * on and nothing more. Any suspended level is dropped, since the level being
 * started takes its place in the save.
 */
menu.on("levelChosen", (level) => {
	save.clearSession();
	showGame();
	game.startLevel(level);
});

screen.on("exitRequested", showMenu);

showMenu();

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("sw.js").catch((error) => {
			// Offline play is the only casualty, and it is not worth a visible error.
			console.warn("Service worker registration failed.", error);
		});
	});
}
