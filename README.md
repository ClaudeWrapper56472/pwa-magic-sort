# Decant

A liquid sorting puzzle, as an installable progressive web app.

No dependencies, no build step, no framework. Plain ES modules served as files.

## The rules

Every tube holds four units of coloured liquid, stacked. **Tap a tube to pick it
up, then tap another to pour into it.** A pour is allowed when the destination is
empty, or when the colour already on top of it matches the colour on top of the
tube in hand and there is room. Liquid of the same colour moves together: pour a
run of three and all three go across, unless the destination fills up on the way,
in which case the rest stays where it is.

The level is done when every tube is either empty or filled to the top with a
single colour.

Tapping a tube that cannot take the pour picks *that* one up instead, because
changing your mind is much the likelier reading of that tap. Tapping the tube you
are holding puts it down. A finished tube is left alone: nothing you could do by
unpacking one gets you anywhere you could not reach without it.

Three things are always available. **Undo** takes back the last pour, as many
times as you like. **Extra tube** adds one more empty tube, once per level, and
is spent when used — starting the level again is what gives it back.
**Restart** puts the board back the way it opened.

There is no timer pressure and nothing to lose. Level 1 is three colours in six
tubes, and every level after it is a little harder: colours are added up to ten,
and inside each colour count the openings get progressively more churned up.
Finishing a level without undoing or taking an extra tube is a *clean run*, which
is the only thing the game keeps score of.

**Easy, Medium and Hard** on the menu are three places to join that one ladder
rather than three separate settings: the first three-, six- and nine-colour
board, always from the beginning of that stretch. Dropping back to an easier board
does not cost you anything. The save keeps two numbers -- the level you are
playing and the furthest you have reached -- and the menu offers a way back to
the furthest one whenever the play button is carrying on from somewhere else.

**Keyboard:** the tubes are buttons, so `Tab` moves between them and `Enter`
picks one up or pours into it. `U` undoes, `T` takes the extra tube, `R` restarts,
`Esc` goes back to the menu.

## Running it

Modules and the service worker need a real origin, so open it over HTTP rather
than as a file:

```bash
cd ~/Sites/pwa-magic-sort
python3 -m http.server 8000
# then http://localhost:8000
```

Installing it from the browser's Add to Home Screen gives a standalone portrait
app that plays offline.

```bash
node tests/verify.mjs        # 137 assertions over the puzzle layer, a fifth of a second
node tools/make-icons.mjs    # redraws icons/, only needed when the mark changes
```

The self-check needs Node 18 or newer. It runs the whole puzzle layer headlessly,
and builds a level at every rung of the ladder to confirm each one is legal,
solvable and inside the difficulty window it was asked for.

## Layout

```
index.html               The shell: both screens, shown and hidden
manifest.webmanifest     Installability: name, icons, portrait, standalone
sw.js                    Precaches everything; code network-first, icons cache-first
css/style.css            Chrome, layout, and every rule the tubes are drawn with

js/puzzle/               Pure puzzle logic. No DOM, so it all runs under Node.
  tubes.js               The rules, and the layout a board is stored in
  level.js               One level: colours, tubes, opening position
  solver.js              Depth-first search, which is what proves a level solvable
  ladder.js              Level number -> which board to build
  generator.js           Deals boards at random and proves them before serving one

js/commands/             Undo system
  command.js             Base class
  pour-command.js        One pour: what moved, and from where to where
  undo-stack.js          The stack, serialization, command factory

js/
  game-state.js          The running game, and every event the UI listens to
  puzzle-state.js        The board model commands act on
  save-manager.js        The save document in localStorage, plus suspend hooks
  save-migration.js      Pure version-migration functions
  settings.js            Preferences
  util/emitter.js        Named events
  util/rng.js            Seeded PCG32
  ui/                    palette.js, rack.js, menu-screen.js, game-screen.js, main.js

icons/                   App icons
tools/make-icons.mjs     Draws them
tests/verify.mjs         Self-check for the puzzle layer
```

## How a level is built

Deal at random, then prove it. Liquid is dealt into the tubes with no thought for
whether the result can be finished, and a deal is only offered to a player once
the solver has played it through to the end. That is what makes "guaranteed
solvable" a fact rather than a hope.

The other way round — scrambling a finished board with legal pours run backwards
— would make every board solvable by construction and need no solver at all. It
is not used here because those boards give themselves away: a backwards walk
leaves the liquid in the shapes a forwards walk would have produced, and the
openings come out visibly tamer than a straight deal.

Two things make the proof cheap enough to run on every deal. Tube order is thrown
away when the search records a position it has already refuted — nothing in the
rules cares which tube is which — which collapses the search space by a factor of
twelve factorial on a full board. And moves are tried best first, so most searches
are close to a straight walk to the answer. Across the whole ladder a level takes
about a third of a millisecond to build, five milliseconds at the ninety-ninth
percentile and thirty at the worst seen. That is why there is no worker, no bank
of precomputed levels and no spinner: the wait is well inside a frame.

Difficulty inside a colour count is set by how mixed up the opening is, measured
as the number of contiguous colour runs on the board. A deal has to land inside a
window — a floor, so a level that falls out nearly sorted is not served as a
puzzle, and a ceiling, so an unlucky deal at three colours is not knottier than a
careful one at six. Both ends climb across a colour count's run of levels and
reset when a colour is added, which is the breather that pays for the extra tube.

## How a pour is drawn

Liquid is drawn as bands rather than as units: three units of one colour are one
block of liquid to look at, and the block is the thing that moves. Every tube
keeps exactly four band elements for its whole life, most of them at zero height.
A pour changes two of those heights and CSS carries the liquid between them, so
nothing is created or destroyed mid-animation and there is no half-built element
for an interrupted pour to leave behind.

Only the top band of a tube can ever change size, which is what lets `height` be
the only property that transitions. Everything below the top band is exactly where
it was, so a band grows out of the surface rather than sliding up from the floor.

The tube itself is moved by one transform. It pivots about its own base, so the
transform is worked out backwards: rotate first, see where that has put the spout,
and translate by whatever is left over. Which way it leans is decided by the
screen rather than by where it came from: a leaning tube's body reaches most of a
tube-length sideways from its spout, so it goes to whichever side of the
destination has the room, and leans less when even that side is short of it. The
stream is drawn behind the tubes, so it disappears into the destination instead of
running down the front of it.

The board has already moved by the time any of this runs — the rules and the undo
history cannot wait on an animation — so the rack is catching the picture up with
a move that has happened, and a pour that arrives mid-animation waits its turn on
a queue. The tube's walk home is not waited on at all: it has nothing left to say
about the board, and holding the next tap for another sixth of a second would cost
the player pace and buy nothing.

Every duration is a constant in `RackView`, published to the stylesheet as a
custom property, so the CSS and the code that waits on it cannot drift apart. The
same goes for size: the rack measures the space it has been given, publishes one
number — the height of a single unit of liquid — and every other measurement in
the stylesheet is a `calc()` off it.

How many rows the tubes are laid out in is not a constant either. Six tubes
across one row of a phone are thin and wasteful when the same six make two rows of
three at nearly twice the size, so every row count is tried and the one that makes
the biggest tube wins.

## Deliberate omissions

- **No accounts, no ads, no leaderboards, no purchases, no analytics.** Nothing
  here talks to a network at all; the service worker only ever fetches the app's
  own files.
- **No sound.**
- **No level select.** You are on a level; you play that level. Easy, Medium and
  Hard are the only other places to join the ladder.
- **No redo.** Undo is for taking back a pour that turned out badly, and putting
  one back is a single tap on two tubes.
- **No hint.** The extra tube is the help this game offers, and unlike a hint it
  leaves the puzzle to the player.
- **No colour-blind mode.** The palette is ordered so that the colours brought
  into play first are the ones furthest apart, but the ten-colour boards do ask
  you to tell red from orange.
- **No settings screen.** The one option worth a switch — the pour animation —
  sits on the title screen.
