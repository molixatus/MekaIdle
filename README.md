# MekaIdle

An online idle game about building a mech and raiding bosses, solo or with your guild. Pick one skill action at a time and it keeps running while you're away (up to 12 hours). Gather and craft your way to better parts, then use them to beat the next raid boss, whose drops unlock the tier after that.

## How it plays

- **Characters:** create a pilot (name, password, mech name and paint), then log in from any device. Progress is saved on the server.
- **Gathering:** Salvaging (scrap and rare circuits), Mining (five tiers of ore), Harvesting (gases).
- **Artisan:** Smelting (ore and scrap into plate), Alchemy (raid tonics), Crafting (repair kits, core modules), Weaponsmithing (weapons) and Armoursmithing (armour, reactors, legs).
- **Combat skills** only train by fighting: Melee, Ranged, Magic and Healing. Your weapon sets your class: vibro-blade (melee damage), bulwark (melee tank, draws the boss's attacks), rail rifle (ranged), psi focus (magic, with burn) or nanite staff (healer).
- **Raids:** five bosses, one per tier, each weak to some attack styles and resistant to others. Press Fight and fights repeat on their own (including offline, up to 12 hours) until you stop or start a skill, the same as skilling. Parties of up to four friends or guildmates farm together. There's no entry cost. A win drops the material needed for the next tier of gear and core modules.
- **The fight** plays inside the Raids page: your party and the boss side by side, cast bars that finish exactly as their hits land, floating damage numbers, a damage meter and a DPS graph.
- **Balance** (from simulation): a damage dealer in a full set of the matching tier wins roughly 40–45% solo against a neutral boss, around 90% with the style it's weak to, and reliably with repair kits. Tanks and healers need a party. A party in last tier's gear only gets through by exploiting a weakness.
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
- `lib/game.js` – server-side rules: offline progress, actions, equipment, supplies, repeating raid sessions, the combat timeline and loot
- `public/data.js` – game content (skills, items, recipes, raids) and formulas, shared by server and browser
- `public/app.js` – the browser client
- `public/icons.js` – inline SVG item and interface icons
- `public/sprites.js` – 8-bit pixel sprites for mechs and raid bosses
- `public/index.html`, `public/style.css` – layout and styling
