# MekaIdle

An online idle game about building a mech and raiding, solo or with your guild. Pick one skill action at a time (or queue up to five) and it keeps running while you're away, for up to 12 hours. Gather and craft your way to better gear, then use it on the next raid, whose drops unlock the tier after that.

## How it plays

- **Characters:** create a pilot (name, password and mech name), then log in from any device. Progress is saved on the server. Your mech's colour follows the class of its main-hand weapon.
- **Skills come in chains.** Each combat skill has one gathering skill feeding three artisan skills:

  | Combat | Gathering | Weapons | Armour | Consumables |
  |---|---|---|---|---|
  | Melee | Mining | Smithing (swords, axes, maces, greatswords, shields) | Armoursmithing (plate) | Honing (whetstones, oils) |
  | Ranged | Hunting | Fletching (bows, crossbows, daggers, quivers) | Leatherworking (leather) | Poisoncraft (poisons) |
  | Magic | Foraging | Enchanting (wands, staves, sceptres, crystals, orbs) | Tailoring (cloth) | Runecrafting (runes, sigils) |
  | Healing | Herbalism | Scribing (scrolls, tomes, lanterns, codices, relics) | Weaving (vestments) | Alchemy (potions and tonics) |

- **Gear:** 10 material tiers, 16 main-hand weapons with different rhythms and effects, 4 off-hands, and head/body/legs/hands/feet armour in four types with 3- and 5-piece bonuses. An off-hand from another class also unlocks that class's abilities.
- **Abilities and subclasses:** 7 abilities per combat class plus 7 generic ones; equip 2 class abilities and 1 generic. At level 5 each class picks one of two subclasses (for example the Guardian tank or the Shadowmender healer); at level 10 you can multiclass instead.
- **Raids:** 250 raids in 10 regions, each a random number of trash waves then a boss, on Normal, Heroic or Mythic. Raids unlock in order. Fights repeat on their own, including offline, solo or in parties of up to four, and never time out: downed pilots respawn after 25 seconds and still share the loot.
- **Raid screen:** wave tracker, animated HP bars, cast bars coloured by action, damage numbers coloured by class, a damage meter (DPS, HPS, damage taken, mitigated) with per-source breakdowns, a hoverable graph and a filterable raid log. A running raid can be opened to friends and guildmates or to everyone, and the leader can remove pilots.
- **Pacing:** tuned so one class chain takes about four days of play to finish.
- **Guilds** show who is online, each member's rank, combat level and current activity. Also friends and escrowed trades.

## Running locally

Needs Node.js 24 (it uses the built-in `node:sqlite`, so there's nothing to install).

```
npm start
```

then go to http://localhost:3000. Data is stored in `data/mekaidle.db`.

## Deploying on Railway

Railway runs `npm start` on the `PORT` it provides and redeploys on every push to `main`.

**Attach a volume** to the service (right-click the service on the project canvas, or use + New → Volume, and mount it at `/data`). Without one, every deploy starts with an empty database, so all accounts and progress reset. The server finds the volume through `RAILWAY_VOLUME_MOUNT_PATH`; you can also set `DATA_DIR` to choose the folder yourself. Visit `/api/health` on the live site to check: `persistentStorage` should be `true`.

## Files

- `server.js` – HTTP server, accounts and sessions, the JSON API, and the SQLite schema
- `lib/game.js` – server-side rules: offline progress, the action queue, equipment, abilities, subclasses, repeating raid sessions, the wave combat timeline, loot, and save migrations
- `public/data.js` – game content (skills, items, recipes, abilities, raids, patch notes) and formulas, shared by server and browser
- `public/app.js` – the browser client
- `public/gameicons.js` – item, skill, ability and enemy icons from game-icons.net (generated; see Credits)
- `public/icons.js` – small line icons for interface controls
- `public/sprites.js` – the 8-bit pixel mech, drawn from the equipped loadout
- `public/index.html`, `public/style.css` – layout and styling

## Credits

Item, skill, ability, subclass and enemy icons are from [game-icons.net](https://game-icons.net), made by Carl Olsen, Caro Asercion, Cathelineau, Delapouite, Faithtoken, Irongamer, Lorc, Lucas, Sbed, Skoll and Willdabeast, and licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). They are recoloured in the game, and enemies are redrawn from them as pixel art. The credit is also shown on the in-game Credits page.
