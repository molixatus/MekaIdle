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
  // Each level of a combat skill adds 1% to what it governs.
  const skillMult = level => 1 + (level - 1) / 100;

  // ---------- Tiers ----------
  const TIERS = [
    { n: 1, id: 'iron', name: 'Iron', ore: 'Iron ore', vein: 'Iron vein', level: 1, colour: '#a3adb8', mult: 1 },
    { n: 2, id: 'titanium', name: 'Titanium', ore: 'Titanium ore', vein: 'Titanium vein', level: 15, colour: '#e3e9f0', mult: 2.2 },
    { n: 3, id: 'cobalt', name: 'Cobalt', ore: 'Cobalt ore', vein: 'Cobalt vein', level: 30, colour: '#4f8ff0', mult: 4 },
    { n: 4, id: 'iridium', name: 'Iridium', ore: 'Iridium ore', vein: 'Iridium vein', level: 45, colour: '#c46cf5', mult: 6.8 },
    { n: 5, id: 'void', name: 'Voidsteel', ore: 'Void crystal', vein: 'Void rift', level: 60, colour: '#2ee6b6', mult: 11 },
  ];

  // ---------- Combat: damage types, weapons and roles ----------
  const DAMAGE_TYPES = [
    { id: 'kinetic', name: 'Kinetic', colour: '#e8b45a' },
    { id: 'energy', name: 'Energy', colour: '#5bc8ff' },
    { id: 'thermal', name: 'Thermal', colour: '#ff7a3c' },
    { id: 'missile', name: 'Missile', colour: '#ff5470' },
  ];
  const DTYPE_BY_ID = Object.fromEntries(DAMAGE_TYPES.map(d => [d.id, d]));

  const ROLES = {
    striker: { id: 'striker', name: 'Striker', colour: '#ef5a45', desc: 'Deals damage. Trains the skill for its weapon’s damage type.' },
    mechanic: { id: 'mechanic', name: 'Mechanic', colour: '#3ddc84', desc: 'Heals the most damaged pilot in the party. Fires a rivet gun when everyone is healthy. Trains Repair.' },
    tactician: { id: 'tactician', name: 'Tactician', colour: '#b66cf0', desc: 'Target-locks the boss so it takes more damage and jams it so it hits softer, then fires ion pulses. Trains Electronics.' },
  };

  // cast: ms per attack. Damage per cast is normalised so every striker weapon has the same average DPS
  // before skills and boss weaknesses; they differ in rhythm, crits and spread.
  const WEAPON_KINDS = [
    { id: 'autocannon', noun: 'autocannon', role: 'striker', dtype: 'kinetic', skill: 'kinetic', cast: 1000, action: 'Autocannon burst', crit: 0.08, spread: 0.1, circuits: 0, offset: 0 },
    { id: 'laser', noun: 'laser', role: 'striker', dtype: 'energy', skill: 'energy', cast: 1600, action: 'Laser lance', crit: 0.22, spread: 0.12, circuits: 1, offset: 1 },
    { id: 'flamer', noun: 'flamer', role: 'striker', dtype: 'thermal', skill: 'thermal', cast: 1400, action: 'Flamer sweep', crit: 0.05, spread: 0.15, burn: 0.35, circuits: 0, offset: 1 },
    { id: 'missiles', noun: 'missile pod', role: 'striker', dtype: 'missile', skill: 'missile', cast: 2600, action: 'Missile volley', crit: 0.1, spread: 0.4, circuits: 1, offset: 2 },
    { id: 'repair_arm', noun: 'repair arm', role: 'mechanic', skill: 'repair', cast: 2000, action: 'Field repair', circuits: 1, offset: 2 },
    { id: 'emp', noun: 'EMP projector', role: 'tactician', skill: 'electronics', dtype: 'energy', cast: 1400, action: 'Ion pulse', circuits: 2, offset: 3 },
  ];
  const WEAPON_BY_ID = Object.fromEntries(WEAPON_KINDS.map(w => [w.id, w]));
  const TACTICS = { lock: { name: 'Target lock', cast: 1200, ms: 8000, amount: 0.1 }, jam: { name: 'EMP burst', cast: 1500, ms: 6000, amount: 0.12 } };

  const SKILLS = [
    { id: 'scrapping', name: 'Scrapping', group: 'gathering', desc: 'Strip wrecks for scrap and the odd intact circuit. Scrap feeds almost everything else.' },
    { id: 'mining', name: 'Mining', group: 'gathering', desc: 'Drill ore from the asteroid belt, ready to smelt into plate.' },
    { id: 'siphoning', name: 'Siphoning', group: 'gathering', desc: 'Siphon volatile gases from the nebula for Chemistry.' },
    { id: 'smelting', name: 'Smelting', group: 'artisan', desc: 'Melt ore down with scrap into plates for weapons, parts and kits.' },
    { id: 'chemistry', name: 'Chemistry', group: 'artisan', desc: 'Brew raid supplies from siphoned gas. Each supply you bring is used up in your next raid for a boost.' },
    { id: 'engineering', name: 'Engineering', group: 'artisan', desc: 'Build power cells to launch raids, repair kits to survive them, and core modules from raid materials.' },
    { id: 'weaponsmithing', name: 'Weaponsmithing', group: 'artisan', desc: 'Forge weapons. The weapon you fit decides your role in a raid and which combat skill you train.' },
    { id: 'fabrication', name: 'Fabrication', group: 'artisan', desc: 'Build armour, reactors and legs from plates, scrap and the materials raid bosses drop.' },
    { id: 'kinetic', name: 'Kinetic', group: 'combat', dtype: 'kinetic', desc: 'Trained by fighting with autocannons. Each level adds 1% kinetic damage.' },
    { id: 'energy', name: 'Energy', group: 'combat', dtype: 'energy', desc: 'Trained by fighting with lasers. Each level adds 1% energy damage.' },
    { id: 'thermal', name: 'Thermal', group: 'combat', dtype: 'thermal', desc: 'Trained by fighting with flamers. Each level adds 1% thermal damage, burn included.' },
    { id: 'missile', name: 'Missile', group: 'combat', dtype: 'missile', desc: 'Trained by fighting with missile pods. Each level adds 1% missile damage.' },
    { id: 'shielding', name: 'Shielding', group: 'combat', desc: 'Trained in every raid by soaking hits. Each level adds 1% defence and hull.' },
    { id: 'repair', name: 'Repair', group: 'combat', desc: 'The Mechanic’s skill, trained by fighting with a repair arm. Each level adds 1% healing.' },
    { id: 'electronics', name: 'Electronics', group: 'combat', desc: 'The Tactician’s skill, trained by fighting with an EMP projector. Each level strengthens target locks, jamming and ion pulses by 1%.' },
  ];
  const SKILL_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));
  const COMBAT_SKILLS = SKILLS.filter(s => s.group === 'combat').map(s => s.id);

  const SLOTS = [
    { id: 'weapon', name: 'Weapon' },
    { id: 'armour', name: 'Armour', noun: 'plating', plates: 6, base: { def: 6, hp: 20 } },
    { id: 'reactor', name: 'Reactor', noun: 'reactor', plates: 3, base: { hp: 40, atk: 3 } },
    { id: 'legs', name: 'Legs', noun: 'legs', plates: 5, base: { def: 4, hp: 20 } },
    { id: 'module', name: 'Core module' },
  ];
  const PART_SLOTS = SLOTS.filter(s => s.plates);

  // res: damage taken multiplier by type (above 1 is a weakness).
  const RAIDS = [
    { id: 'warden', tier: 1, name: 'Scrapyard Warden', desc: 'A salvage crane that learnt to fight back. It guards the outer yard.',
      mat: { id: 'servo_coil', name: 'Servo coil', colour: '#e8b923' }, res: { thermal: 1.12, energy: 0.9 },
      moves: { basic: 'Crane swing', sweep: 'Scrap avalanche' } },
    { id: 'hydra', tier: 2, name: 'Rust Hydra', desc: 'Three hydraulic heads on one corroded chassis, all of them angry.',
      mat: { id: 'hydraulic_heart', name: 'Hydraulic heart', colour: '#e5533d' }, res: { energy: 1.12, thermal: 0.9 },
      moves: { basic: 'Piston bite', sweep: 'Hydraulic spray' } },
    { id: 'colossus', tier: 3, name: 'Ironclad Colossus', desc: 'A walking fortress. Slow, but every step shakes the ground.',
      mat: { id: 'graviton_core', name: 'Graviton core', colour: '#5d7bff' }, res: { missile: 1.12, kinetic: 0.9 },
      moves: { basic: 'Fortress slam', sweep: 'Quake stomp' } },
    { id: 'sentinel', tier: 4, name: 'Storm Sentinel', desc: 'An orbital guardian that rides the lightning down to meet you.',
      mat: { id: 'storm_capacitor', name: 'Storm capacitor', colour: '#7fd8ff' }, res: { kinetic: 1.12, energy: 0.9 },
      moves: { basic: 'Arc bolt', sweep: 'Thunderstorm' } },
    { id: 'titan', tier: 5, name: 'Void Titan', desc: 'Something vast, stepping out of the rift. The end of the line.',
      mat: { id: 'void_shard', name: 'Void shard', colour: '#2ee6b6' }, res: { thermal: 1.1, missile: 1.1, kinetic: 0.92, energy: 0.92 },
      moves: { basic: 'Void lash', sweep: 'Collapse' } },
  ];
  const BOSS_MOVES = { basic: 2000, sweep: 3000, sweepEvery: 4, sweepShare: 0.6 };

  // ---------- Items ----------
  const ITEMS = {};
  const item = (id, o) => { ITEMS[id] = Object.assign({ id }, o); };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

  item('scrap', { name: 'Scrap', type: 'resource', icon: 'scrap', colour: '#c9a36b', desc: 'Twisted metal from the wrecks. Smelting, engineering and smithing all eat it, and founding a guild costs 500.' });
  item('circuit', { name: 'Intact circuit', type: 'resource', icon: 'circuit', colour: '#57c46b', desc: 'A rare find while scrapping, and a small reward from raids. Needed for kits, reactors, most weapons and core modules.' });
  TIERS.forEach(t => {
    item(t.id + '_ore', { name: t.ore, type: 'resource', icon: 'ore', colour: t.colour, tier: t.n, desc: `Mined from the ${t.vein.toLowerCase()} at Mining level ${t.level}. Smelt it into plate.` });
    item(t.id + '_plate', { name: `${t.name} plate`, type: 'resource', icon: 'plate', colour: t.colour, tier: t.n, desc: `Smelted at Smelting level ${t.level}. Used for ${t.name.toLowerCase()} weapons and parts.` });
  });
  const GASES = [
    { id: 'hydrogen', name: 'Hydrogen', level: 1, colour: '#9fd3ff', xp: 8 },
    { id: 'plasma_gas', name: 'Plasma gas', level: 20, colour: '#ff6fb1', xp: 20 },
    { id: 'cryo_gas', name: 'Cryo gas', level: 40, colour: '#7ff0ff', xp: 35 },
  ];
  GASES.forEach(g => item(g.id, { name: g.name, type: 'resource', icon: 'gas', colour: g.colour, desc: `Siphoned at Siphoning level ${g.level}. Used in Chemistry.` }));
  RAIDS.forEach(r => item(r.mat.id, { name: r.mat.name, type: 'material', icon: 'mat', colour: r.mat.colour, tier: r.tier,
    desc: `Dropped by the ${r.name}. Used for ${r.tier < 5 ? `tier ${r.tier + 1} weapons and parts, and ` : ''}the Mk ${ROMAN[r.tier - 1]} core module.` }));
  item('power_cell', { name: 'Power cell', type: 'consumable', icon: 'cell', colour: '#e8b923', desc: 'Raids burn power cells to launch: one per tier of the raid, for each pilot.' });
  item('repair_kit', { name: 'Repair kit', type: 'consumable', icon: 'kit', colour: '#e5533d', heal: 0.35, supply: true, desc: 'Used automatically in raids when your hull drops below 40%. Restores 35% hull. Up to three kits per raid.' });
  item('nano_kit', { name: 'Nano repair kit', type: 'consumable', icon: 'kit', colour: '#2ee6b6', heal: 0.6, supply: true, desc: 'Used before ordinary kits when your hull drops below 40%. Restores 60% hull. Up to three kits per raid.' });
  item('coolant_gel', { name: 'Coolant gel', type: 'consumable', icon: 'vial', colour: '#9fd3ff', supply: true, boost: { def: 0.1 }, desc: 'Raid supply: +10% defence for one raid.' });
  item('overdrive_fuel', { name: 'Overdrive fuel', type: 'consumable', icon: 'vial', colour: '#ff6fb1', supply: true, boost: { dmg: 0.1 }, desc: 'Raid supply: +10% damage and healing for one raid.' });
  item('cryo_plating', { name: 'Cryo plating', type: 'consumable', icon: 'vial', colour: '#7ff0ff', supply: true, boost: { hp: 0.15 }, desc: 'Raid supply: +15% hull for one raid.' });
  const BOOSTS = ['coolant_gel', 'overdrive_fuel', 'cryo_plating'];

  TIERS.forEach(t => {
    WEAPON_KINDS.forEach(w => item(`${t.id}_${w.id}`, {
      name: `${t.name} ${w.noun}`, type: 'gear', slot: 'weapon', weapon: w.id, icon: w.id, colour: t.colour, tier: t.n,
      stats: { atk: Math.round(10 * t.mult) },
      desc: `Tier ${t.n} weapon. ${ROLES[w.role].name}${w.dtype && w.role === 'striker' ? `, ${DTYPE_BY_ID[w.dtype].name.toLowerCase()} damage` : ''}: ${w.action.toLowerCase()} every ${(w.cast / 1000).toFixed(1)}s.`,
    }));
    PART_SLOTS.forEach(s => {
      const stats = {};
      Object.entries(s.base).forEach(([k, v]) => { stats[k] = Math.round(v * t.mult); });
      item(`${t.id}_${s.id}`, { name: `${t.name} ${s.noun}`, type: 'gear', slot: s.id, icon: s.id, colour: t.colour, tier: t.n, stats, desc: `Tier ${t.n} ${s.name.toLowerCase()}.` });
    });
  });
  RAIDS.forEach(r => item(`module_${r.tier}`, { name: `Core module Mk ${ROMAN[r.tier - 1]}`, type: 'gear', slot: 'module', icon: 'module', colour: r.mat.colour, tier: r.tier, pct: 5 * r.tier, desc: `Adds ${5 * r.tier}% to damage, healing, defence and hull.` }));

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

  GASES.forEach(g => action({ id: `siphon_${g.id}`, skill: 'siphoning', name: g.name, level: g.level, time: 3000, xp: g.xp, item: g.id, outputs: { [g.id]: [1, 1] } }));
  action({ id: 'chem_coolant_gel', skill: 'chemistry', name: 'Coolant gel', level: 1, time: 3000, xp: 10, item: 'coolant_gel', inputs: { hydrogen: 2, scrap: 3 }, outputs: { coolant_gel: [1, 1] } });
  action({ id: 'chem_overdrive_fuel', skill: 'chemistry', name: 'Overdrive fuel', level: 15, time: 3500, xp: 25, item: 'overdrive_fuel', inputs: { plasma_gas: 2, scrap: 5 }, outputs: { overdrive_fuel: [1, 1] } });
  action({ id: 'chem_cryo_plating', skill: 'chemistry', name: 'Cryo plating', level: 35, time: 4000, xp: 45, item: 'cryo_plating', inputs: { cryo_gas: 2, circuit: 1 }, outputs: { cryo_plating: [1, 1] } });

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

  const SMITH_XP = [12, 24, 38, 56, 80];
  TIERS.forEach((t, i) => {
    const prevMat = i > 0 ? RAIDS[i - 1].mat.id : null;
    WEAPON_KINDS.forEach(w => {
      const id = `${t.id}_${w.id}`;
      const inputs = { [t.id + '_plate']: 4, scrap: 8 * t.n };
      if (w.circuits) inputs.circuit = w.circuits * t.n;
      if (prevMat) inputs[prevMat] = 2 + t.n;
      action({ id: `smith_${id}`, skill: 'weaponsmithing', name: ITEMS[id].name, level: t.level + w.offset, time: 4000, xp: SMITH_XP[i] * 4, item: id, inputs, outputs: { [id]: [1, 1] } });
    });
    PART_SLOTS.forEach((s, j) => {
      const id = `${t.id}_${s.id}`;
      const inputs = { [t.id + '_plate']: s.plates, scrap: 8 * t.n };
      if (s.id === 'reactor') inputs.circuit = 2 * t.n;
      if (prevMat) inputs[prevMat] = 2 + t.n;
      action({ id: `fab_${id}`, skill: 'fabrication', name: ITEMS[id].name, level: t.level + 2 * j, time: 4000, xp: SMITH_XP[i] * s.plates, item: id, inputs, outputs: { [id]: [1, 1] } });
    });
  });

  const ACTION_BY_ID = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

  // ---------- Mech stats ----------
  // levels: { skillId: level }. boosts: { dmg, def, hp } fractions from raid supplies.
  function mechStats(equipment, levels, boosts) {
    const s = Object.assign({}, BASE_STATS);
    let pct = 0;
    Object.values(equipment || {}).forEach(id => {
      const it = id && ITEMS[id];
      if (!it) return;
      Object.entries(it.stats || {}).forEach(([k, v]) => { s[k] += v; });
      pct += it.pct || 0;
    });
    const weapon = WEAPON_BY_ID[(ITEMS[equipment && equipment.weapon] || {}).weapon] || null;
    const lv = k => (levels && levels[k]) || 1;
    const b = boosts || {};
    const mod = 1 + pct / 100;
    const shield = skillMult(lv('shielding'));
    const skill = weapon ? weapon.skill : 'kinetic';
    return {
      atk: Math.round(s.atk * mod * skillMult(lv(skill)) * (1 + (b.dmg || 0))),
      def: Math.round(s.def * mod * shield * (1 + (b.def || 0))),
      hp: Math.round(s.hp * mod * shield * (1 + (b.hp || 0))),
      weapon: weapon ? weapon.id : null,
      role: weapon ? weapon.role : 'striker',
      dtype: weapon ? weapon.dtype || null : 'kinetic',
      skill,
      elec: skillMult(lv('electronics')),
    };
  }
  const power = s => Math.round(s.atk * 2 + s.def * 2 + s.hp / 5);

  // Boss stats are set against a reference pilot: a full set of that tier's gear with an
  // autocannon, the previous module and combat skills around the tier's level. That pilot
  // wins about half the time solo with no supplies; kits, boosts or a party make it safe.
  const FIGHT = { maxMs: 90000, killMs: 40000, deathMs: 36000 };
  RAIDS.forEach(r => {
    const t = TIERS[r.tier - 1];
    const eq = { weapon: `${t.id}_autocannon` };
    PART_SLOTS.forEach(s => { eq[s.id] = `${t.id}_${s.id}`; });
    if (r.tier > 1) eq.module = `module_${r.tier - 1}`;
    const ref = mechStats(eq, { kinetic: t.level + 5, shielding: t.level + 5 });
    const def = Math.round(10 * t.mult);
    r.boss = {
      def,
      hp: Math.round(ref.atk * 100 / (100 + def) * FIGHT.killMs / 1000 / 10) * 10,
      dps: Math.round(ref.hp * (100 + ref.def) / 100 / (FIGHT.deathMs / 1000) * 10) / 10,
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
    MAX_LEVEL, OFFLINE_CAP, BASE_STATS, TIERS, DAMAGE_TYPES, DTYPE_BY_ID, ROLES, WEAPON_KINDS, WEAPON_BY_ID, TACTICS,
    SKILLS, SKILL_BY_ID, COMBAT_SKILLS, SLOTS, PART_SLOTS, RAIDS, RAID_BY_ID, BOSS_MOVES, FIGHT, ITEMS, BOOSTS, ACTIONS, ACTION_BY_ID,
    xpForLevel, levelFromXp, skillMult, mechStats, power,
    PARTY_MAX: 4, PARTY_HP_SCALE: 0.8, KITS_PER_RAID: 3, GUILD_COST: 500,
    PAINTS: ['#e8b923', '#e5533d', '#3fa7f5', '#57c46b', '#b66cf0', '#d9dde3'],
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = GAME;
  else root.GAME = GAME;
})(typeof window !== 'undefined' ? window : this);
