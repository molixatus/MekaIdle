# MekaIdle

An online idle game about building a mech and raiding bosses, solo or with your guild. Pick one skill action at a time and it keeps running while you're away (up to 12 hours). Gather and craft your way to better parts, then use them to beat the next raid boss, whose drops unlock the tier after that.

## How it plays

- **Characters:** create a pilot (name, password, mech name and paint), then log in from any device. Progress is saved on the server.
- **Gathering:** Scrapping (scrap and rare circuits), Mining (five tiers of ore), Siphoning (gases).
- **Artisan:** Smelting (ore + scrap into plate), Chemistry (raid boosts), Engineering (power cells, repair kits, core modules), Weaponsmithing (weapons) and Fabrication (armour, reactors, legs).
- **Combat skills** only train in raids: Kinetic, Energy, Thermal and Missile (by fighting with that weapon type), Shielding (every raid), Repair (Mechanics) and Electronics (Tacticians). Each level adds 1% to what the skill governs.
- **Roles come from your weapon:** autocannon, laser, flamer or missile pod make you a Striker; a repair arm makes you a Mechanic (healer); an EMP projector makes you a Tactician (target locks raise the boss's damage taken, jamming lowers its damage).
- **Raids:** five bosses, one per tier, each weak to some damage types and resistant to others. A win drops the material needed for the next tier of gear and core modules. Fights are simulated on the server and replayed live, with cast bars, damage numbers, a DPS meter and a DPS graph. Party members can rewatch a fight for 48 hours.
- **Balance** (from simulation): a Striker in a full set of the matching tier wins roughly 40–70% solo with no supplies, and reliably with repair kits or with the damage type the boss is weak to. Mechanics and Tacticians can't solo but make parties safe. A party in last tier's gear can't beat the 90-second limit.
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
- `lib/game.js` – server-side rules: offline progress, actions, equipment, supplies, the raid combat timeline and loot
- `public/data.js` – game content (skills, items, recipes, raids) and formulas, shared by server and browser
- `public/app.js` – the browser client
- `public/icons.js` – inline SVG icons
- `public/index.html`, `public/style.css` – layout and styling
