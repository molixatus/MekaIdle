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
  // Each level of a combat skill adds 1% to its damage or healing.
  const skillMult = level => 1 + (level - 1) / 100;

  // ---------- Tiers ----------
  const TIERS = [
    { n: 1, id: 'iron', name: 'Iron', ore: 'Iron ore', vein: 'Iron vein', level: 1, colour: '#a3adb8', mult: 1 },
    { n: 2, id: 'titanium', name: 'Titanium', ore: 'Titanium ore', vein: 'Titanium vein', level: 15, colour: '#e3e9f0', mult: 2.2 },
    { n: 3, id: 'cobalt', name: 'Cobalt', ore: 'Cobalt ore', vein: 'Cobalt vein', level: 30, colour: '#4f8ff0', mult: 4 },
    { n: 4, id: 'iridium', name: 'Iridium', ore: 'Iridium ore', vein: 'Iridium vein', level: 45, colour: '#c46cf5', mult: 6.8 },
    { n: 5, id: 'void', name: 'Voidsteel', ore: 'Void crystal', vein: 'Void rift', level: 60, colour: '#2ee6b6', mult: 11 },
  ];

  // ---------- Combat classes and weapons ----------
  // Bosses resist or are weak to the three attack styles.
  const STYLES = [
    { id: 'melee', name: 'Melee' },
    { id: 'ranged', name: 'Ranged' },
    { id: 'magic', name: 'Magic' },
  ];
  const STYLE_BY_ID = Object.fromEntries(STYLES.map(s => [s.id, s]));

  const ROLES = {
    melee: { id: 'melee', name: 'Melee', colour: '#ef5a45' },
    ranged: { id: 'ranged', name: 'Ranged', colour: '#f2c14e' },
    magic: { id: 'magic', name: 'Magic', colour: '#b66cf0' },
    healer: { id: 'healer', name: 'Healer', colour: '#3ddc84' },
  };
  const STANCES = {
    dps: 'Damage',
    tank: 'Tank: the boss aims every normal attack at you, and your shield adds 60% defence and 30% hull, but you hit for about half.',
    heal: 'Heals whoever is most damaged, and fires nanite bolts when everyone is healthy.',
  };

  // cast: ms per action. Damage per cast is normalised so the damage weapons share the same
  // average damage per second before skills and boss weaknesses; they differ in rhythm and swing.
  const WEAPON_KINDS = [
    { id: 'blade', noun: 'vibro-blade', role: 'melee', stance: 'dps', skill: 'melee', cast: 1000, action: 'Blade slash', crit: 0.1, spread: 0.15, circuits: 0, offset: 0 },
    { id: 'bulwark', noun: 'bulwark', role: 'melee', stance: 'tank', skill: 'melee', cast: 1400, action: 'Shield bash', crit: 0.05, spread: 0.1, dmg: 0.55, defMult: 1.6, hpMult: 1.3, circuits: 0, offset: 2 },
    { id: 'rifle', noun: 'rail rifle', role: 'ranged', stance: 'dps', skill: 'ranged', cast: 1600, action: 'Rail shot', crit: 0.22, spread: 0.12, circuits: 1, offset: 1 },
    { id: 'focus', noun: 'psi focus', role: 'magic', stance: 'dps', skill: 'magic', cast: 2200, action: 'Psi blast', crit: 0.1, spread: 0.3, burn: 0.3, circuits: 2, offset: 2 },
    { id: 'staff', noun: 'nanite staff', role: 'healer', stance: 'heal', skill: 'healing', cast: 2000, action: 'Nanite mend', circuits: 1, offset: 3 },
  ];
  const WEAPON_BY_ID = Object.fromEntries(WEAPON_KINDS.map(w => [w.id, w]));

  const SKILLS = [
    { id: 'salvaging', name: 'Salvaging', group: 'gathering', desc: 'Strip wrecks for scrap and the odd intact circuit. Scrap feeds almost everything else.' },
    { id: 'mining', name: 'Mining', group: 'gathering', desc: 'Drill ore from the asteroid belt, ready to smelt into plate.' },
    { id: 'harvesting', name: 'Harvesting', group: 'gathering', desc: 'Harvest volatile gases from the nebula for Alchemy.' },
    { id: 'smelting', name: 'Smelting', group: 'artisan', desc: 'Melt ore down with scrap into plates for weapons, armour and kits.' },
    { id: 'alchemy', name: 'Alchemy', group: 'artisan', desc: 'Brew raid tonics from harvested gas. Each tonic you bring is used up in a fight for a boost.' },
    { id: 'crafting', name: 'Crafting', group: 'artisan', desc: 'Craft repair kits to survive raids, and core modules from raid materials.' },
    { id: 'weaponsmithing', name: 'Weaponsmithing', group: 'artisan', desc: 'Forge weapons. The weapon you fit decides your combat class and which combat skill you train.' },
    { id: 'armoursmithing', name: 'Armoursmithing', group: 'artisan', desc: 'Forge armour, reactors and legs from plates, scrap and the materials raid bosses drop.' },
    { id: 'melee', name: 'Melee', group: 'combat', role: 'melee', desc: 'Trained by fighting with a vibro-blade (damage) or a bulwark (tank). Each level adds 1% melee damage.' },
    { id: 'ranged', name: 'Ranged', group: 'combat', role: 'ranged', desc: 'Trained by fighting with a rail rifle. Each level adds 1% ranged damage.' },
    { id: 'magic', name: 'Magic', group: 'combat', role: 'magic', desc: 'Trained by fighting with a psi focus. Each level adds 1% magic damage, burn included.' },
    { id: 'healing', name: 'Healing', group: 'combat', role: 'healer', desc: 'Trained by fighting with a nanite staff. Each level adds 1% healing.' },
  ];
  const SKILL_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));

  const SLOTS = [
    { id: 'weapon', name: 'Weapon' },
    { id: 'armour', name: 'Armour', noun: 'plating', plates: 6, base: { def: 6, hp: 20 } },
    { id: 'reactor', name: 'Reactor', noun: 'reactor', plates: 3, base: { hp: 40, atk: 3 } },
    { id: 'legs', name: 'Legs', noun: 'legs', plates: 5, base: { def: 4, hp: 20 } },
    { id: 'module', name: 'Core module' },
  ];
  const PART_SLOTS = SLOTS.filter(s => s.plates);

  // res: damage taken multiplier by attack style (above 1 is a weakness).
  const RAIDS = [
    { id: 'warden', tier: 1, name: 'The Warden', desc: 'A masked giant that guards the outer scrapyard. Its bone mask has never cracked.',
      mat: { id: 'servo_coil', name: 'Servo coil', colour: '#e8b923' }, res: { magic: 1.12, melee: 0.9 },
      moves: { basic: 'Bone claw', sweep: 'Mask scream' } },
    { id: 'hydra', tier: 2, name: 'Rust Hydra', desc: 'Three masked heads on one corroded body, all of them hungry.',
      mat: { id: 'hydraulic_heart', name: 'Hydraulic heart', colour: '#e5533d' }, res: { ranged: 1.12, magic: 0.9 },
      moves: { basic: 'Piston bite', sweep: 'Acid spray' } },
    { id: 'colossus', tier: 3, name: 'Prism Colossus', desc: 'A floating crystal that focuses starlight into a cutting beam. Get close and it cracks.',
      mat: { id: 'graviton_core', name: 'Graviton core', colour: '#5d7bff' }, res: { melee: 1.12, ranged: 0.9 },
      moves: { basic: 'Prism lance', sweep: 'Refraction' } },
    { id: 'sentinel', tier: 4, name: 'Storm Sentinel', desc: 'A haloed eye that rides the lightning down from orbit.',
      mat: { id: 'storm_capacitor', name: 'Storm capacitor', colour: '#7fd8ff' }, res: { magic: 1.12, ranged: 0.9 },
      moves: { basic: 'Arc bolt', sweep: 'Thunderstorm' } },
    { id: 'titan', tier: 5, name: 'Void Titan', desc: 'Something vast, stepping out of the rift. The end of the line.',
      mat: { id: 'void_shard', name: 'Void shard', colour: '#2ee6b6' }, res: { melee: 1.08, ranged: 1.08, magic: 0.92 },
      moves: { basic: 'Void lash', sweep: 'Collapse' } },
  ];
  const BOSS_MOVES = { basic: 2000, sweep: 3000, sweepEvery: 4, sweepShare: 0.6 };

  // ---------- Items ----------
  const ITEMS = {};
  const item = (id, o) => { ITEMS[id] = Object.assign({ id }, o); };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

  item('scrap', { name: 'Scrap', type: 'resource', icon: 'scrap', colour: '#c9a36b', desc: 'Twisted metal from the wrecks. Smelting, crafting and smithing all eat it, and founding a guild costs 500.' });
  item('circuit', { name: 'Intact circuit', type: 'resource', icon: 'circuit', colour: '#57c46b', desc: 'A rare find while salvaging, and a small reward from raids. Needed for kits, reactors, most weapons and core modules.' });
  TIERS.forEach(t => {
    item(t.id + '_ore', { name: t.ore, type: 'resource', icon: 'ore', colour: t.colour, tier: t.n, desc: `Mined from the ${t.vein.toLowerCase()} at Mining level ${t.level}. Smelt it into plate.` });
    item(t.id + '_plate', { name: `${t.name} plate`, type: 'resource', icon: 'plate', colour: t.colour, tier: t.n, desc: `Smelted at Smelting level ${t.level}. Used for ${t.name.toLowerCase()} weapons and armour.` });
  });
  const GASES = [
    { id: 'hydrogen', name: 'Hydrogen', level: 1, colour: '#9fd3ff', xp: 8 },
    { id: 'plasma_gas', name: 'Plasma gas', level: 20, colour: '#ff6fb1', xp: 20 },
    { id: 'cryo_gas', name: 'Cryo gas', level: 40, colour: '#7ff0ff', xp: 35 },
  ];
  GASES.forEach(g => item(g.id, { name: g.name, type: 'resource', icon: 'gas', colour: g.colour, desc: `Harvested at Harvesting level ${g.level}. Used in Alchemy.` }));
  RAIDS.forEach(r => item(r.mat.id, { name: r.mat.name, type: 'material', icon: 'mat', colour: r.mat.colour, tier: r.tier,
    desc: `Dropped by ${r.name}. Used for ${r.tier < 5 ? `tier ${r.tier + 1} weapons and armour, and ` : ''}the Mk ${ROMAN[r.tier - 1]} core module.` }));
  item('repair_kit', { name: 'Repair kit', type: 'consumable', icon: 'kit', colour: '#e5533d', heal: 0.35, supply: true, desc: 'Used automatically in a fight when your hull drops below 40%. Restores 35% hull. Up to three kits per fight.' });
  item('nano_kit', { name: 'Nano repair kit', type: 'consumable', icon: 'kit', colour: '#2ee6b6', heal: 0.6, supply: true, desc: 'Used before ordinary kits when your hull drops below 40%. Restores 60% hull. Up to three kits per fight.' });
  item('coolant_gel', { name: 'Coolant tonic', type: 'consumable', icon: 'vial', colour: '#9fd3ff', supply: true, boost: { def: 0.1 }, desc: 'Raid tonic: +10% defence for one fight.' });
  item('overdrive_fuel', { name: 'Overdrive tonic', type: 'consumable', icon: 'vial', colour: '#ff6fb1', supply: true, boost: { dmg: 0.1 }, desc: 'Raid tonic: +10% damage and healing for one fight.' });
  item('cryo_plating', { name: 'Cryo tonic', type: 'consumable', icon: 'vial', colour: '#7ff0ff', supply: true, boost: { hp: 0.15 }, desc: 'Raid tonic: +15% hull for one fight.' });
  const BOOSTS = ['coolant_gel', 'overdrive_fuel', 'cryo_plating'];

  TIERS.forEach(t => {
    WEAPON_KINDS.forEach(w => item(`${t.id}_${w.id}`, {
      name: `${t.name} ${w.noun}`, type: 'gear', slot: 'weapon', weapon: w.id, icon: w.id, colour: t.colour, tier: t.n,
      stats: { atk: Math.round(10 * t.mult) },
      desc: `Tier ${t.n} ${ROLES[w.role].name.toLowerCase()} weapon${w.stance === 'tank' ? ' for tanks' : ''}. ${w.action} every ${(w.cast / 1000).toFixed(1)}s.`,
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
  // Action ids are kept stable across renames so saved activities keep working.
  const ACTIONS = [];
  const action = o => ACTIONS.push(Object.assign({ inputs: {}, chance: [] }, o));

  [
    ['scrap_heap', 'Scrap heap', 1, 3000, 5, [1, 2], 0.05],
    ['drone_wrecks', 'Wrecked drones', 10, 3000, 10, [2, 4], 0.08],
    ['tank_graveyard', 'Tank graveyard', 25, 3500, 18, [4, 7], 0.1],
    ['crashed_frigate', 'Crashed frigate', 40, 4000, 28, [7, 12], 0.12],
    ['titan_carcass', 'Titan carcass', 55, 4000, 40, [10, 18], 0.15],
  ].forEach(([id, name, level, time, xp, scrap, p]) => action({
    id, skill: 'salvaging', name, level, time, xp, item: 'scrap', outputs: { scrap }, chance: [{ item: 'circuit', p, qty: 1 }],
  }));

  TIERS.forEach((t, i) => {
    action({ id: `mine_${t.id}`, skill: 'mining', name: t.vein, level: t.level, time: 3000, xp: [7, 14, 22, 32, 45][i], item: t.id + '_ore', outputs: { [t.id + '_ore']: [1, 1] } });
    action({ id: `smelt_${t.id}`, skill: 'smelting', name: `${t.name} plate`, level: t.level, time: 3000, xp: [10, 20, 30, 44, 60][i], item: t.id + '_plate', inputs: { [t.id + '_ore']: 2, scrap: 2 * t.n }, outputs: { [t.id + '_plate']: [1, 1] } });
  });

  GASES.forEach(g => action({ id: `siphon_${g.id}`, skill: 'harvesting', name: g.name, level: g.level, time: 3000, xp: g.xp, item: g.id, outputs: { [g.id]: [1, 1] } }));
  action({ id: 'chem_coolant_gel', skill: 'alchemy', name: 'Coolant tonic', level: 1, time: 3000, xp: 10, item: 'coolant_gel', inputs: { hydrogen: 2, scrap: 3 }, outputs: { coolant_gel: [1, 1] } });
  action({ id: 'chem_overdrive_fuel', skill: 'alchemy', name: 'Overdrive tonic', level: 15, time: 3500, xp: 25, item: 'overdrive_fuel', inputs: { plasma_gas: 2, scrap: 5 }, outputs: { overdrive_fuel: [1, 1] } });
  action({ id: 'chem_cryo_plating', skill: 'alchemy', name: 'Cryo tonic', level: 35, time: 4000, xp: 45, item: 'cryo_plating', inputs: { cryo_gas: 2, circuit: 1 }, outputs: { cryo_plating: [1, 1] } });

  action({ id: 'eng_repair_kit', skill: 'crafting', name: 'Repair kit', level: 1, time: 4000, xp: 20, item: 'repair_kit', inputs: { iron_plate: 1, circuit: 1, scrap: 5 }, outputs: { repair_kit: [1, 1] } });
  action({ id: 'eng_nano_kit', skill: 'crafting', name: 'Nano repair kit', level: 35, time: 4000, xp: 45, item: 'nano_kit', inputs: { cobalt_plate: 1, circuit: 2, scrap: 15 }, outputs: { nano_kit: [1, 1] } });
  RAIDS.forEach(r => {
    const t = TIERS[r.tier - 1];
    action({
      id: `eng_module_${r.tier}`, skill: 'crafting', name: ITEMS[`module_${r.tier}`].name, level: [10, 25, 40, 55, 70][r.tier - 1], time: 6000, xp: 60 * r.tier,
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
      action({ id: `fab_${id}`, skill: 'armoursmithing', name: ITEMS[id].name, level: t.level + 2 * j, time: 4000, xp: SMITH_XP[i] * s.plates, item: id, inputs, outputs: { [id]: [1, 1] } });
    });
  });

  const ACTION_BY_ID = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

  // ---------- Mech stats ----------
  // levels: { skillId: level }. boosts: { dmg, def, hp } fractions from raid tonics.
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
    const skill = weapon ? weapon.skill : 'melee';
    return {
      atk: Math.round(s.atk * mod * skillMult(lv(skill)) * (1 + (b.dmg || 0))),
      def: Math.round(s.def * mod * (weapon && weapon.defMult || 1) * (1 + (b.def || 0))),
      hp: Math.round(s.hp * mod * (weapon && weapon.hpMult || 1) * (1 + (b.hp || 0))),
      weapon: weapon ? weapon.id : null,
      role: weapon ? weapon.role : 'melee',
      stance: weapon ? weapon.stance : 'dps',
      skill,
    };
  }
  const power = s => Math.round(s.atk * 2 + s.def * 2 + s.hp / 5);

  // Boss stats are set against a reference pilot: a full set of that tier's gear with a
  // rail rifle, the previous module and Ranged around the tier's level. That pilot wins
  // roughly half the time solo with no supplies; kits, tonics or a party make it safe.
  const FIGHT = { maxMs: 90000, killMs: 40000, deathMs: 36000, gapMs: 3000 };
  RAIDS.forEach(r => {
    const t = TIERS[r.tier - 1];
    const eq = { weapon: `${t.id}_rifle` };
    PART_SLOTS.forEach(s => { eq[s.id] = `${t.id}_${s.id}`; });
    if (r.tier > 1) eq.module = `module_${r.tier - 1}`;
    const ref = mechStats(eq, { ranged: t.level + 5 });
    const def = Math.round(10 * t.mult);
    r.boss = {
      def,
      hp: Math.round(ref.atk * 100 / (100 + def) * FIGHT.killMs / 1000 / 10) * 10,
      dps: Math.round(ref.hp * (100 + ref.def) / 100 / (FIGHT.deathMs / 1000) * 10) / 10,
    };
    r.recommended = power(ref);
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
    MAX_LEVEL, OFFLINE_CAP, BASE_STATS, TIERS, STYLES, STYLE_BY_ID, ROLES, STANCES, WEAPON_KINDS, WEAPON_BY_ID,
    SKILLS, SKILL_BY_ID, SLOTS, PART_SLOTS, RAIDS, RAID_BY_ID, BOSS_MOVES, FIGHT, ITEMS, BOOSTS, ACTIONS, ACTION_BY_ID,
    xpForLevel, levelFromXp, skillMult, mechStats, power,
    PARTY_MAX: 4, PARTY_HP_SCALE: 1, KITS_PER_RAID: 3, GUILD_COST: 500,
    PAINTS: ['#b66cf0', '#e5533d', '#e8b923', '#3fa7f5', '#57c46b', '#d9dde3'],
    // Trim colour for each paint, for the mech's jaw, belt and highlights.
    ACCENTS: { '#b66cf0': '#8cff5a', '#e5533d': '#ffb13b', '#e8b923': '#3fa7f5', '#3fa7f5': '#f2f4f7', '#57c46b': '#ff8f3d', '#d9dde3': '#3fa7f5' },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = GAME;
  else root.GAME = GAME;
})(typeof window !== 'undefined' ? window : this);
