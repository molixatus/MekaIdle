# MekaIdle

An online idle game about building a mech and raiding bosses, solo or with your guild. Pick one skill action at a time and it keeps running while you're away (up to 12 hours). Gather and craft your way to better parts, then use them to beat the next raid boss, whose drops unlock the tier after that.

## How it plays

- **Characters:** create a pilot (name, password, mech name and paint), then log in from any device. Progress is saved on the server.
- **Skills come in chains.** Each combat skill has one gathering skill feeding two artisan skills:

  | Combat | Gathering | Artisan | Artisan |
  |---|---|---|---|
  | Melee | Mining | Smithing (swords, greatswords, bulwarks) | Armoursmithing (plate) |
  | Ranged | Hunting | Fletching (shortbows, longbows, crossbows) | Leatherworking (leather) |
  | Magic | Foraging | Enchanting (wands, staves, orbs, sigils) | Tailoring (cloth) |
  | Healing | Herbalism | Scribing (scrolls, tomes, codices) | Alchemy (potions and tonics) |

- **Gear:** 12 weapon types across 5 tiers, each with its own rhythm or effect (heavy crits, armour pierce, burn, surges, group heals, tanking). Three armour types with 3-piece bonuses: plate (defence and hull), leather (crit), cloth (power). Sigils are crafted from raid materials.
- **Raid loot:** five bosses, each weak to some attack styles. Wins drop the material for the next tier, gold, and rarely a piece of that boss's 3-piece set (Thorns, Multishot, Prismatic, Overflow shields, Lifesteal) or its trinket.
- **Raids farm like skills:** press Fight and fights repeat on their own, including offline (up to 12 hours), solo or in parties of up to four. The fight plays in the Raids page with cast bars and damage numbers coloured by pilot and labelled with the damage type.
- **Every class can solo.** A damage dealer in matching-tier gear wins roughly half its solo fights against a neutral boss and nearly all of them against a boss weak to its style; healers heal themselves and smite, so they clear everything, just more slowly.
- **Guilds** show who is online, each member's rank (leader, officer, member), combat level and current activity. Founding costs 500 gold. Also friends and escrowed trades.

## Running locally

Needs Node.js 24 (it uses the built-in `node:sqlite`, so there's nothing to install).

```
npm start
```

then go to http://localhost:3000. Data is stored in `data/mekaidle.db`.

## Deploying on Railway

Railway runs `npm start` on the `PORT` it provides and redeploys on every push to `main`.

**Attach a volume** to the service. Without one, every deploy starts with an empty database, so all accounts and progress reset. Visit `/api/health` on the live site to check: it says whether saves are kept between deploys. Attach it (any mount path) so accounts and progress survive redeploys. The server finds it through `RAILWAY_VOLUME_MOUNT_PATH`. Without a volume, the database is wiped on every deploy. You can also set `DATA_DIR` to choose the folder yourself.

## Files

- `server.js` – HTTP server, accounts and sessions, the JSON API, and the SQLite schema
- `lib/game.js` – server-side rules: offline progress, actions, equipment, supplies, repeating raid sessions, the combat timeline and loot
- `public/data.js` – game content (skills, items, recipes, raids) and formulas, shared by server and browser
- `public/app.js` – the browser client
- `public/gameicons.js` – item, skill and boss icons from game-icons.net (generated; see Credits)
- `public/icons.js` – small line icons for interface controls
- `public/sprites.js` – the 8-bit pixel mech, drawn from the equipped loadout
- `public/index.html`, `public/style.css` – layout and styling

## Credits

Item, skill, weapon and boss icons are from [game-icons.net](https://game-icons.net), made by Lorc, Delapouite, Carl Olsen, Caro Asercion, Lucas and Skoll, and licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). They are recoloured in the game. The credit is also shown in the game's sidebar and on the login screen.
