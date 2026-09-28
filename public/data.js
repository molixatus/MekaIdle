// Game content and formulas, shared by the server (require) and the browser (window.GAME).
(function (root) {
  'use strict';

  const MAX_LEVEL = 99;
  const OFFLINE_CAP = 12 * 3600 * 1000; // ms of offline progress granted
  const BASE_STATS = { atk: 5, def: 2, hp: 100 };

  // Total XP needed to reach a level.
  const xpForLevel = l => (l <= 1 ? 0 : Math.floor(30 * (l - 1) + 6 * Math.pow(l - 1, 2.4)));
  function levelFromXp(xp) {
    let l = 1;
    while (l < MAX_LEVEL && xp >= xpForLevel(l + 1)) l++;
    return l;
  }

  // ---------- Tiers ----------
  const TIERS = [
    { n: 1, id: 'iron', name: 'Iron', ore: 'Iron ore', vein: 'Iron vein', level: 1, colour: '#a3adb8', mult: 1 },
    { n: 2, id: 'titanium', name: 'Titanium', ore: 'Titanium ore', vein: 'Titanium vein', level: 15, colour: '#e3e9f0', mult: 2.2 },
    { n: 3, id: 'cobalt', name: 'Cobalt', ore: 'Cobalt ore', vein: 'Cobalt vein', level: 30, colour: '#4f8ff0', mult: 4 },
    { n: 4, id: 'iridium', name: 'Iridium', ore: 'Iridium ore', vein: 'Iridium vein', level: 45, colour: '#c46cf5', mult: 6.8 },
    { n: 5, id: 'void', name: 'Voidsteel', ore: 'Void crystal', vein: 'Void rift', level: 60, colour: '#2ee6b6', mult: 11 },
  ];

  const SKILLS = [
    { id: 'scrapping', name: 'Scrapping', desc: 'Strip wrecks for scrap and the odd intact circuit. Scrap feeds almost everything else.' },
    { id: 'mining', name: 'Mining', desc: 'Drill ore from the asteroid belt, ready to smelt into plate.' },
    { id: 'smelting', name: 'Smelting', desc: 'Melt ore down with scrap into plates for fabrication and engineering.' },
    { id: 'engineering', name: 'Engineering', desc: 'Build power cells to launch raids, repair kits to survive them, and core modules from raid materials.' },
    { id: 'fabrication', name: 'Fabrication', desc: 'Forge mech parts from plates, scrap and the materials that raid bosses drop.' },
    { id: 'piloting', name: 'Piloting', desc: 'Trained by fighting in raids. Each level adds 1% to your mech’s attack, defence and hull.', raidOnly: true },
  ];

  const SLOTS = [
    { id: 'weapon', name: 'Weapon', noun: 'cannon', plates: 4, base: { atk: 10 } },
    { id: 'armour', name: 'Armour', noun: 'plating', plates: 6, base: { def: 6, hp: 20 } },
    { id: 'reactor', name: 'Reactor', noun: 'reactor', plates: 3, base: { hp: 40, atk: 3 } },
    { id: 'legs', name: 'Legs', noun: 'legs', plates: 5, base: { def: 4, hp: 20 } },
    { id: 'module', name: 'Core module' },
  ];

  const RAIDS = [
    { id: 'warden', tier: 1, name: 'Scrapyard Warden', desc: 'A salvage crane that learnt to fight back. It guards the outer yard.', mat: { id: 'servo_coil', name: 'Servo coil', colour: '#e8b923' } },
    { id: 'hydra', tier: 2, name: 'Rust Hydra', desc: 'Three hydraulic heads on one corroded chassis, all of them angry.', mat: { id: 'hydraulic_heart', name: 'Hydraulic heart', colour: '#e5533d' } },
    { id: 'colossus', tier: 3, name: 'Ironclad Colossus', desc: 'A walking fortress. Slow, but every step shakes the ground.', mat: { id: 'graviton_core', name: 'Graviton core', colour: '#5d7bff' } },
    { id: 'sentinel', tier: 4, name: 'Storm Sentinel', desc: 'An orbital guardian that rides the lightning down to meet you.', mat: { id: 'storm_capacitor', name: 'Storm capacitor', colour: '#7fd8ff' } },
    { id: 'titan', tier: 5, name: 'Void Titan', desc: 'Something vast, stepping out of the rift. The end of the line.', mat: { id: 'void_shard', name: 'Void shard', colour: '#2ee6b6' } },
  ];

  // ---------- Items ----------
  const ITEMS = {};
  const item = (id, o) => { ITEMS[id] = Object.assign({ id }, o); };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

  item('scrap', { name: 'Scrap', type: 'resource', icon: 'scrap', colour: '#c9a36b', desc: 'Twisted metal from the wrecks. Smelting, engineering and fabrication all eat it, and founding a guild costs 500.' });
  item('circuit', { name: 'Intact circuit', type: 'resource', icon: 'circuit', colour: '#57c46b', desc: 'A rare find while scrapping, and a small reward from raids. Needed for kits, reactors and core modules.' });
  TIERS.forEach(t => {
    item(t.id + '_ore', { name: t.ore, type: 'resource', icon: 'ore', colour: t.colour, tier: t.n, desc: `Mined from the ${t.vein.toLowerCase()} at Mining level ${t.level}. Smelt it into plate.` });
    item(t.id + '_plate', { name: `${t.name} plate`, type: 'resource', icon: 'plate', colour: t.colour, tier: t.n, desc: `Smelted at Smelting level ${t.level}. Used to fabricate ${t.name.toLowerCase()} mech parts.` });
  });
  RAIDS.forEach(r => item(r.mat.id, { name: r.mat.name, type: 'material', icon: 'mat', colour: r.mat.colour, tier: r.tier, desc: `Dropped by the ${r.name}. Used for tier ${r.tier + 1 <= 5 ? r.tier + 1 : r.tier} parts and the Mk ${ROMAN[r.tier - 1]} core module.` }));
  item('power_cell', { name: 'Power cell', type: 'consumable', icon: 'cell', colour: '#e8b923', desc: 'Raids burn power cells to launch: one per tier of the raid, for each pilot.' });
  item('repair_kit', { name: 'Repair kit', type: 'consumable', icon: 'kit', colour: '#e5533d', heal: 0.35, desc: 'Used automatically in raids when your hull drops below 40%. Restores 35% hull. Up to three kits per raid.' });
  item('nano_kit', { name: 'Nano repair kit', type: 'consumable', icon: 'kit', colour: '#2ee6b6', heal: 0.6, desc: 'Used before ordinary kits when your hull drops below 40%. Restores 60% hull. Up to three kits per raid.' });
  TIERS.forEach(t => SLOTS.slice(0, 4).forEach(s => {
    const stats = {};
    Object.entries(s.base).forEach(([k, v]) => { stats[k] = Math.round(v * t.mult); });
    item(`${t.id}_${s.id}`, { name: `${t.name} ${s.noun}`, type: 'gear', slot: s.id, icon: s.id, colour: t.colour, tier: t.n, stats, desc: `Tier ${t.n} ${s.name.toLowerCase()}.` });
  }));
  RAIDS.forEach(r => item(`module_${r.tier}`, { name: `Core module Mk ${ROMAN[r.tier - 1]}`, type: 'gear', slot: 'module', icon: 'module', colour: r.mat.colour, tier: r.tier, pct: 5 * r.tier, desc: `Adds ${5 * r.tier}% to attack, defence and hull.` }));

  // ---------- Actions ----------
  // outputs: { itemId: [min, max] }, chance: extra rolls, inputs consumed per action.
  const ACTIONS = [];
  const action = o => ACTIONS.push(Object.assign({ inputs: {}, chance: [] }, o));

  [
    ['scrap_heap', 'Scrap heap', 1, 3000, 5, [1, 2], 0.05],
    ['drone_wrecks', 'Wrecked drones', 10, 3000, 10, [2, 4], 0.08],
    ['tank_graveyard', 'Tank graveyard', 25, 3500, 18, [4, 7], 0.1],
    ['crashed_frigate', 'Crashed frigate', 40, 4000, 28, [7, 12], 0.12],
    ['titan_carcass', 'Titan carcass', 55, 4000, 40, [10, 18], 0.15],
  ].forEach(([id, name, level, time, xp, scrap, p]) => action({
    id, skill: 'scrapping', name, level, time, xp, item: 'scrap', outputs: { scrap }, chance: [{ item: 'circuit', p, qty: 1 }],
  }));

  TIERS.forEach((t, i) => {
    action({ id: `mine_${t.id}`, skill: 'mining', name: t.vein, level: t.level, time: 3000, xp: [7, 14, 22, 32, 45][i], item: t.id + '_ore', outputs: { [t.id + '_ore']: [1, 1] } });
    action({ id: `smelt_${t.id}`, skill: 'smelting', name: `${t.name} plate`, level: t.level, time: 3000, xp: [10, 20, 30, 44, 60][i], item: t.id + '_plate', inputs: { [t.id + '_ore']: 2, scrap: 2 * t.n }, outputs: { [t.id + '_plate']: [1, 1] } });
  });

  action({ id: 'eng_power_cell', skill: 'engineering', name: 'Power cell', level: 1, time: 3000, xp: 8, item: 'power_cell', inputs: { scrap: 12 }, outputs: { power_cell: [1, 1] } });
  action({ id: 'eng_repair_kit', skill: 'engineering', name: 'Repair kit', level: 10, time: 4000, xp: 20, item: 'repair_kit', inputs: { iron_plate: 1, circuit: 1, scrap: 5 }, outputs: { repair_kit: [1, 1] } });
  action({ id: 'eng_nano_kit', skill: 'engineering', name: 'Nano repair kit', level: 35, time: 4000, xp: 45, item: 'nano_kit', inputs: { cobalt_plate: 1, circuit: 2, scrap: 15 }, outputs: { nano_kit: [1, 1] } });
  RAIDS.forEach(r => {
    const t = TIERS[r.tier - 1];
    action({
      id: `eng_module_${r.tier}`, skill: 'engineering', name: ITEMS[`module_${r.tier}`].name, level: [10, 25, 40, 55, 70][r.tier - 1], time: 6000, xp: 60 * r.tier,
      item: `module_${r.tier}`, inputs: { [r.mat.id]: 5, circuit: 3 * r.tier, [t.id + '_plate']: 2, scrap: 50 * r.tier }, outputs: { [`module_${r.tier}`]: [1, 1] },
    });
  });

  TIERS.forEach((t, i) => SLOTS.slice(0, 4).forEach((s, j) => {
    const inputs = { [t.id + '_plate']: s.plates, scrap: 8 * t.n };
    if (s.id === 'reactor') inputs.circuit = 2 * t.n;
    if (i > 0) inputs[RAIDS[i - 1].mat.id] = 2 + t.n;
    const id = `${t.id}_${s.id}`;
    action({ id: `fab_${id}`, skill: 'fabrication', name: ITEMS[id].name, level: t.level + 2 * j, time: 4000, xp: [12, 24, 38, 56, 80][i] * s.plates, item: id, inputs, outputs: { [id]: [1, 1] } });
  }));

  const ACTION_BY_ID = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

  // ---------- Combat ----------
  function mechStats(equipment, pilotLevel) {
    const s = Object.assign({}, BASE_STATS);
    let pct = 0;
    Object.values(equipment || {}).forEach(id => {
      const it = id && ITEMS[id];
      if (!it) return;
      Object.entries(it.stats || {}).forEach(([k, v]) => { s[k] += v; });
      pct += it.pct || 0;
    });
    const m = (1 + (pilotLevel - 1) / 100) * (1 + pct / 100);
    return { atk: Math.round(s.atk * m), def: Math.round(s.def * m), hp: Math.round(s.hp * m) };
  }
  const power = s => Math.round(s.atk * 2 + s.def * 2 + s.hp / 5);

  // Boss stats are set against a full set of that tier's gear, the previous
  // module and Piloting around the tier's level: a coin flip solo without repair kits, safe with them or in a geared party.
  RAIDS.forEach(r => {
    const t = TIERS[r.tier - 1];
    const eq = {};
    SLOTS.slice(0, 4).forEach(s => { eq[s.id] = `${t.id}_${s.id}`; });
    if (r.tier > 1) eq.module = `module_${r.tier - 1}`;
    const ref = mechStats(eq, t.level + 5);
    const def = Math.round(10 * t.mult);
    const perRound = ref.atk * 100 / (100 + def);
    r.boss = {
      def,
      hp: Math.round(perRound * 20 / 10) * 10,
      atk: Math.round(ref.hp * (100 + ref.def) / 1800),
    };
    r.recommended = power(ref);
    r.cells = r.tier;
    r.xp = [60, 150, 320, 600, 1000][r.tier - 1];
    r.drops = [
      { item: r.mat.id, qty: [2, 4] },
      { item: 'scrap', qty: [15 * r.tier, 30 * r.tier] },
      { item: t.id + '_ore', qty: [2, 5] },
      { item: 'circuit', qty: [1, r.tier], p: 0.25 },
    ];
  });
  const RAID_BY_ID = Object.fromEntries(RAIDS.map(r => [r.id, r]));

  const GAME = {
    MAX_LEVEL, OFFLINE_CAP, BASE_STATS, TIERS, SKILLS, SLOTS, RAIDS, RAID_BY_ID, ITEMS, ACTIONS, ACTION_BY_ID,
    xpForLevel, levelFromXp, mechStats, power,
    PARTY_MAX: 4, PARTY_HP_SCALE: 1, MAX_ROUNDS: 30, KITS_PER_RAID: 3, GUILD_COST: 500,
    PAINTS: ['#e8b923', '#e5533d', '#3fa7f5', '#57c46b', '#b66cf0', '#d9dde3'],
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = GAME;
  else root.GAME = GAME;
})(typeof window !== 'undefined' ? window : this);
