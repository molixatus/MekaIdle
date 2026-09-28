# MekaIdle

An idle browser game about upgrading a mech. Skills train on their own over real time (even with the tab closed), and each skill level unlocks another upgrade for one part of the mech. Upgrades multiply your scrap income, which pays for more upgrades.

## How it plays

- **Training:** queue up to five skill levels. Only the first one trains at a time. Progress carries on while you're away, up to 12 hours.
- **Skills:** Salvaging (+10% income per level), Engineering (cheaper upgrades), and one skill per mech part.
- **Upgrades:** Reactor, Arms, Armour and Legs. A part can't go above its skill's level.
- Saves to the browser's localStorage every 10 seconds and when the tab closes.

## Running locally

Open `index.html` in a browser, or:

```
npm install
npm start
```

then go to http://localhost:3000.

## Deploying on Railway

Railway detects `package.json` and runs `npm start`, which serves the folder on the `PORT` Railway provides. No build step.

## Files

- `index.html` – page layout and the mech drawing (SVG)
- `style.css` – styling
- `game.js` – game rules, training queue, saving and offline progress
