# MekaIdle

An online idle game about building a mech and raiding bosses, solo or with your guild. Pick one skill action at a time and it keeps running while you're away (up to 12 hours). Gather and craft your way to better parts, then use them to beat the next raid boss, whose drops unlock the tier after that.

## How it plays

- **Characters:** create a pilot (name, password, mech name and paint), then log in from any device. Progress is saved on the server.
- **Gathering:** Scrapping (scrap and rare circuits) and Mining (five tiers of ore).
- **Processing:** Smelting (ore + scrap → plate), Engineering (power cells, repair kits, core modules), Fabrication (weapon, armour, reactor and legs for each tier).
- **Raids:** five bosses, one per tier. Each attempt costs power cells. A win gives Piloting XP, scrap, ore and the boss's material, which is needed for the next tier of parts and for core modules. Solo is about a coin flip in a full set of the matching tier without repair kits. Parties of up to four friends or guildmates share the boss's hits, and the boss's hull grows with each pilot.
- **Hangar and inventory:** fit parts to your mech and see where every item comes from and what it's used in.
- **Social:** friends, guilds (500 scrap to found, up to 30 pilots, with chat), and trades where offered items are held until the offer is accepted, declined or cancelled.

## Running locally

Needs Node.js 24 (it uses the built-in `node:sqlite`, so there's nothing to install).

```
npm start
```

then go to http://localhost:3000. Data is stored in `data/mekaidle.db`.

## Deploying on Railway

Railway runs `npm start` on the `PORT` it provides and redeploys on every push to `main`.

**Attach a volume** to the service (any mount path) so accounts and progress survive redeploys. The server finds it through `RAILWAY_VOLUME_MOUNT_PATH`. Without a volume, the database is wiped on every deploy. You can also set `DATA_DIR` to choose the folder yourself.

## Files

- `server.js` – HTTP server, accounts and sessions, the JSON API, and the SQLite schema
- `lib/game.js` – server-side rules: offline progress, actions, equipment, raid combat and loot
- `public/data.js` – game content (skills, items, recipes, raids) and formulas, shared by server and browser
- `public/app.js` – the browser client
- `public/icons.js` – inline SVG icons
- `public/index.html`, `public/style.css` – layout and styling
