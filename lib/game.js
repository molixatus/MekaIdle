'use strict';
// Server-side game rules. Everything that changes a player's state goes through here.
const G = require('../public/data.js');

class GameError extends Error {}
const fail = msg => { throw new GameError(msg); };

const rnd = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const rollQty = q => (Array.isArray(q) ? rnd(q[0], q[1]) : q);
const STATE_VERSION = 5;

// ---------- State ----------
function newState(now) {
  const skills = {};
  G.SKILLS.forEach(s => { skills[s.id] = { xp: 0 }; });
  const equipment = {};
  G.SLOTS.forEach(s => { equipment[s.id] = null; });
  const supplies = {};
  Object.values(G.ITEMS).forEach(it => { if (it.supply) supplies[it.id] = true; });
  return { v: STATE_VERSION, skills, items: {}, equipment, supplies, activity: null, queue: [], lastTick: now, raidLog: [],
    clears: {}, abilities: { cls: [], generic: null }, subclasses: {}, multi: {} };
}

const V3_SKILLS = { salvaging: ['scrapping'], harvesting: ['siphoning'], alchemy: ['chemistry'], crafting: ['engineering'],
  armoursmithing: ['fabrication'], melee: ['shielding'], ranged: ['kinetic', 'missile'], magic: ['energy', 'thermal', 'electronics'], healing: ['repair'] };
const V3_WEAPONS = { autocannon: 'rifle', missiles: 'rifle', laser: 'focus', flamer: 'focus', emp: 'focus', repair_arm: 'staff' };
const V4_SKILLS = { hunting: ['salvaging'], foraging: ['harvesting'], herbalism: ['harvesting'], smithing: ['weaponsmithing', 'smelting'],
  fletching: ['weaponsmithing'], leatherworking: ['armoursmithing'], enchanting: ['crafting'], tailoring: ['armoursmithing'], scribing: ['crafting'] };
const V4_SIMPLE = { scrap: ['gold', 1], circuit: ['gold', 5], hydrogen: ['gold', 2], plasma_gas: ['gold', 2], cryo_gas: ['gold', 2],
  repair_kit: ['healing_potion', 1], nano_kit: ['greater_healing_potion', 1], coolant_gel: ['ironskin_tonic', 1],
  overdrive_fuel: ['fury_tonic', 1], cryo_plating: ['vigour_tonic', 1] };
const V4_TIERED = { blade: 'sword', bulwark: 'bulwark', rifle: 'shortbow', focus: 'staff', staff: 'tome', armour: 'plate_body', reactor: 'plate_head', legs: 'plate_legs', ore: 'ore' };
// Maps a v3 item id to [new id, quantity multiplier], or null if it has no equivalent.
function v4Item(id) {
  if (V4_SIMPLE[id]) return V4_SIMPLE[id];
  const mod = /^module_([1-5])$/.exec(id);
  if (mod) return [`sigil_${mod[1]}`, 1];
  const m = /^([a-z]+)_([a-z]+)$/.exec(id);
  if (m && G.TIERS.some(t => t.id === m[1])) {
    if (m[2] === 'plate') return [`${m[1]}_ore`, 2];
    if (V4_TIERED[m[2]]) return [`${m[1]}_${V4_TIERED[m[2]]}`, 1];
  }
  // v4 raid materials, set pieces, trinkets and bulwarks pass through; the v5 step maps them.
  return G.ITEMS[id] || V4_KEEP.test(id) ? [id, 1] : null;
}
const V4_KEEP = /^(servo_coil|hydraulic_heart|graviton_core|storm_capacitor|void_shard|[a-z]+_bulwark|(warden|hydra|colossus|sentinel|titan)_(set_(head|body|legs)|trinket))$/;

// Brings a save from any earlier version up to date.
function migrate(state, now) {
  const fresh = newState(now);
  const s = {
    ...fresh,
    ...state,
    skills: { ...fresh.skills, ...state.skills },
    equipment: { ...fresh.equipment, ...state.equipment },
    supplies: { ...fresh.supplies, ...state.supplies },
    items: { ...state.items },
    raidLog: Array.isArray(state.raidLog) ? state.raidLog : [],
  };
  const xpOf = k => (s.skills[k] && s.skills[k].xp) || 0;
  const renameItem = (from, to) => {
    if (s.items[from]) { s.items[to] = (s.items[to] || 0) + s.items[from]; delete s.items[from]; }
    if (s.equipment.weapon === from) s.equipment.weapon = to;
  };

  if (!state.v || state.v < 2) {
    // v1: one Piloting skill, one Fabrication skill and a generic weapon per tier.
    s.skills.kinetic = { xp: Math.max(xpOf('kinetic'), xpOf('piloting')) };
    s.skills.shielding = { xp: Math.max(xpOf('shielding'), xpOf('piloting')) };
    s.skills.weaponsmithing = { xp: Math.max(xpOf('weaponsmithing'), xpOf('fabrication')) };
    G.TIERS.forEach(t => renameItem(`${t.id}_weapon`, `${t.id}_autocannon`));
    if (s.activity && /^fab_\w+_weapon$/.test(s.activity.id || '')) s.activity = { ...s.activity, id: s.activity.id.replace(/^fab_(\w+)_weapon$/, 'smith_$1_autocannon') };
    s.raidLog = s.raidLog.map(e => (typeof e.xp === 'number' ? { ...e, xp: { kinetic: e.xp } } : e));
  }
  if (!state.v || state.v < 3) {
    // v2: damage-type combat skills, sci-fi skill names and power cells.
    Object.entries(V3_SKILLS).forEach(([to, from]) => { s.skills[to] = { xp: Math.max(xpOf(to), ...from.map(xpOf)) }; });
    G.TIERS.forEach(t => Object.entries(V3_WEAPONS).forEach(([from, to]) => renameItem(`${t.id}_${from}`, `${t.id}_${to}`)));
    if (s.items.power_cell) { s.items.scrap = (s.items.scrap || 0) + 12 * s.items.power_cell; delete s.items.power_cell; }
    if (s.activity && s.activity.id) {
      const m = /^smith_(\w+?)_(\w+)$/.exec(s.activity.id);
      const id = m && V3_WEAPONS[m[2]] ? `smith_${m[1]}_${V3_WEAPONS[m[2]]}` : s.activity.id;
      s.activity = G.ACTION_BY_ID[id] ? { ...s.activity, id } : null;
    }
    const newSkill = k => Object.keys(V3_SKILLS).find(to => V3_SKILLS[to].includes(k)) || k;
    s.raidLog = s.raidLog.map(e => ({ ...e, xp: Object.fromEntries(Object.entries(e.xp || {}).map(([k, v]) => [newSkill(k), v])) }));
  }
  if (!state.v || state.v < 4) {
    // v3: sci-fi gathering and crafting skills, armour/reactor/legs/module slots, scrap and circuits.
    Object.entries(V4_SKILLS).forEach(([to, from]) => { s.skills[to] = { xp: Math.max(xpOf(to), ...from.map(xpOf)) }; });
    const items = {};
    const give = (id, n) => { const m = v4Item(id); if (m) items[m[0]] = (items[m[0]] || 0) + n * m[1]; };
    Object.entries(s.items).forEach(([id, n]) => give(id, n));
    const old = s.equipment;
    const eq = { ...fresh.equipment };
    [['weapon', old.weapon], ['body', old.armour], ['head', old.reactor], ['legs', old.legs], ['trinket', old.module]].forEach(([slot, id]) => {
      const m = id && v4Item(id);
      if (m && G.ITEMS[m[0]] && G.ITEMS[m[0]].slot === slot && m[1] === 1) eq[slot] = m[0];
      else if (id) give(id, 1);
    });
    s.items = items;
    s.equipment = eq;
    s.supplies = { ...fresh.supplies };
    if (s.activity && s.activity.type === 'raid') s.activity = { ...s.activity, fight: null };
    else if (s.activity && !s.activity.type) s.activity = null;
    s.raidLog = s.raidLog.map(e => {
      const loot = {};
      Object.entries(e.loot || {}).forEach(([id, n]) => { const m = v4Item(id); if (m) loot[m[0]] = (loot[m[0]] || 0) + n * m[1]; });
      return { ...e, loot };
    });
  }
  if (!state.v || state.v < 5) {
    // v4: five tiers, bulwark and orb as weapons, five raid bosses, three armour slots.
    // Old tier-1..5 raid content lines up with the new tiers 2, 3, 4, 7 and 10.
    const TIER_MAP = [2, 3, 4, 7, 10];
    const OLD_RAIDS = ['warden', 'hydra', 'colossus', 'sentinel', 'titan'];
    const OLD_MATS = ['servo_coil', 'hydraulic_heart', 'graviton_core', 'storm_capacitor', 'void_shard'];
    const v5Item = id => {
      const m = /^([a-z]+)_(bulwark)$/.exec(id);
      if (m) return `${m[1]}_shield`;
      const sig = /^sigil_([1-5])$/.exec(id);
      if (sig) return `sigil_${TIER_MAP[sig[1] - 1]}`;
      const mat = OLD_MATS.indexOf(id);
      if (mat >= 0) return `mat_${TIER_MAP[mat]}`;
      const set = /^(warden|hydra|colossus|sentinel|titan)_set_(head|body|legs)$/.exec(id);
      if (set) return `set${TIER_MAP[OLD_RAIDS.indexOf(set[1])]}_${set[2]}`;
      const tr = /^(warden|hydra|colossus|sentinel|titan)_trinket$/.exec(id);
      if (tr) return `trinket_${TIER_MAP[OLD_RAIDS.indexOf(tr[1])]}`;
      return G.ITEMS[id] ? id : null;
    };
    const items = {};
    Object.entries(s.items).forEach(([id, n]) => { const to = v5Item(id); if (to) items[to] = (items[to] || 0) + n; });
    const eq = { ...fresh.equipment };
    Object.entries(s.equipment).forEach(([slot, id]) => {
      const to = id && v5Item(id);
      if (!to) return;
      const it = G.ITEMS[to];
      if (it && it.slot && eq[it.slot] === null && (slot === it.slot || slot === 'weapon')) eq[it.slot] = to;
      else items[to] = (items[to] || 0) + 1;
    });
    if (eq.weapon && G.ITEMS[eq.weapon].twoHanded && eq.offhand) { items[eq.offhand] = (items[eq.offhand] || 0) + 1; eq.offhand = null; }
    s.items = items;
    s.equipment = eq;
    // Unlock the new regions that match the old bosses already beaten.
    const beaten = s.raidLog.filter(e => e.win).map(e => OLD_RAIDS.indexOf(e.raid)).filter(i => i >= 0);
    const best = beaten.length ? Math.max(...beaten) : -1;
    s.clears = {};
    const regionsDone = best >= 0 ? [1, 2, 3, 6, 9][best] : 0;
    for (let g = 1; g <= regionsDone * 25; g++) s.clears[`r${g}`] = 1;
    s.raidLog = [];
    if (s.activity && s.activity.type === 'raid') s.activity = null;
    s.abilities = { cls: [], generic: null };
    s.subclasses = {};
    s.multi = {};
    s.queue = [];
    s.supplies = { ...fresh.supplies, ...state.supplies };
  }
  s.v = STATE_VERSION;
  if (!Array.isArray(s.queue)) s.queue = [];
  Object.keys(s.skills).forEach(k => { if (!G.SKILL_BY_ID[k]) delete s.skills[k]; });
  Object.keys(s.items).forEach(k => { if (!G.ITEMS[k]) delete s.items[k]; });
  Object.keys(s.equipment).forEach(k => { if (s.equipment[k] && !G.ITEMS[s.equipment[k]]) s.equipment[k] = null; });
  return s;
}

const level = (state, skill) => G.levelFromXp(state.skills[skill].xp);
const levels = state => Object.fromEntries(G.SKILLS.map(s => [s.id, level(state, s.id)]));
const totalLevel = state => G.SKILLS.reduce((a, s) => a + level(state, s.id), 0);
const combatLevel = state => G.combatLevel(levels(state));
const weaponClass = state => {
  const it = G.ITEMS[state.equipment.weapon];
  return it ? it.cls : 'melee';
};
const subclassOf = (state, cls = weaponClass(state)) => (state.subclasses && state.subclasses[cls]) || null;
const stats = (state, boosts) => G.mechStats(state.equipment, levels(state), { boosts, subclass: subclassOf(state) });
const power = state => G.power(stats(state));

function hasItems(items, need) {
  return Object.entries(need).every(([id, n]) => (items[id] || 0) >= n);
}

function addItems(items, delta, sign = 1, tally) {
  for (const [id, n] of Object.entries(delta)) {
    if (!n) continue;
    const v = (items[id] || 0) + sign * n;
    if (v > 0) items[id] = v; else delete items[id];
    if (tally) {
      tally[id] = (tally[id] || 0) + sign * n;
      if (!tally[id]) delete tally[id];
    }
  }
}

function addXp(state, skill, xp, tally) {
  state.skills[skill].xp += xp;
  if (tally) tally[skill] = (tally[skill] || 0) + xp;
}

const newGained = ms => ({ items: {}, xp: {}, ms, fights: 0, wins: 0 });

// ---------- Skill activity and the action queue ----------
// A skill activity is { id, progress, left } where left counts actions still to do (null: forever).
// state.queue holds up to QUEUE_MAX more { id, count } entries that start when the current one ends.
function canRun(state, action) {
  return level(state, action.skill) >= action.level && hasItems(state.items, action.inputs);
}

function nextFromQueue(state) {
  while (state.queue && state.queue.length) {
    const q = state.queue.shift();
    const action = G.ACTION_BY_ID[q.id];
    if (action && canRun(state, action)) return { id: q.id, progress: 0, left: q.count || null };
  }
  return null;
}

// Runs skill activities forward to `now`, capped at the offline limit. Raids advance separately.
function advance(state, now) {
  const gained = newGained(Math.max(0, now - state.lastTick));
  let budget = Math.min(gained.ms, G.OFFLINE_CAP);
  state.lastTick = now;
  if (state.activity && state.activity.type) return gained;
  if (!state.activity) state.activity = nextFromQueue(state);
  while (state.activity && !state.activity.type) {
    const a = state.activity;
    const action = G.ACTION_BY_ID[a.id];
    if (!action) { state.activity = nextFromQueue(state); continue; }
    let t = a.progress + budget;
    let stop = false;
    while (t >= action.time) {
      if (!hasItems(state.items, action.inputs)) { stop = true; break; }
      t -= action.time;
      addItems(state.items, action.inputs, -1, gained.items);
      const out = {};
      for (const [id, q] of Object.entries(action.outputs)) out[id] = rollQty(q);
      for (const c of action.chance) if (Math.random() < c.p) out[c.item] = (out[c.item] || 0) + c.qty;
      addItems(state.items, out, 1, gained.items);
      addXp(state, action.skill, action.xp, gained.xp);
      if (a.left != null && --a.left <= 0) { stop = true; break; }
    }
    if (!stop) { a.progress = t; break; }
    // This entry is finished (or ran out of materials): carry the leftover time into the next one.
    budget = t;
    state.activity = nextFromQueue(state);
    if (state.activity) state.activity.progress = 0;
  }
  return gained;
}

function startAction(state, id, count) {
  const action = G.ACTION_BY_ID[id];
  if (!action) fail('Unknown action.');
  if (level(state, action.skill) < action.level) fail(`You need level ${action.level} for that.`);
  if (!hasItems(state.items, action.inputs)) fail('You don’t have the materials for that.');
  const n = Number.isInteger(count) && count > 0 ? Math.min(count, 1e6) : null;
  state.activity = { id, progress: 0, left: n };
}

function stopAction(state) {
  state.activity = null;
}

function setQueue(state, entries) {
  if (!Array.isArray(entries)) fail('Invalid queue.');
  if (entries.length > G.QUEUE_MAX) fail(`The queue holds up to ${G.QUEUE_MAX} actions.`);
  state.queue = entries.map(e => {
    const action = e && G.ACTION_BY_ID[e.id];
    if (!action) fail('Unknown action in queue.');
    if (level(state, action.skill) < action.level) fail(`You need ${G.SKILL_BY_ID[action.skill].name} ${action.level} for ${action.name}.`);
    const count = Number.isInteger(e.count) && e.count > 0 ? Math.min(e.count, 1e6) : 1;
    return { id: e.id, count };
  });
}

// ---------- Equipment and supplies ----------
function equip(state, itemId) {
  const it = G.ITEMS[itemId];
  if (!it || it.type !== 'gear') fail('That can’t be equipped.');
  if (!state.items[itemId]) fail('You don’t have one of those.');
  if (it.slot === 'offhand') {
    const main = G.ITEMS[state.equipment.weapon];
    if (main && main.twoHanded) fail(`Your ${main.name.toLowerCase()} is two-handed.`);
  }
  addItems(state.items, { [itemId]: 1 }, -1);
  const old = state.equipment[it.slot];
  if (old) addItems(state.items, { [old]: 1 });
  state.equipment[it.slot] = itemId;
  // A two-hander frees the off-hand.
  if (it.twoHanded && state.equipment.offhand) {
    addItems(state.items, { [state.equipment.offhand]: 1 });
    state.equipment.offhand = null;
  }
  pruneAbilities(state);
}

function unequip(state, slot) {
  if (!(slot in state.equipment)) fail('Unknown slot.');
  const old = state.equipment[slot];
  if (!old) return;
  addItems(state.items, { [old]: 1 });
  state.equipment[slot] = null;
  pruneAbilities(state);
}

function setSupply(state, itemId, on) {
  if (!G.ITEMS[itemId] || !G.ITEMS[itemId].supply) fail('That isn’t a raid supply.');
  state.supplies[itemId] = !!on;
}

// ---------- Classes, subclasses and abilities ----------
// Classes whose abilities this pilot may equip: the main weapon's class, a multiclass second
// class, and the class of an off-hand from another class.
function abilityClasses(state) {
  const cls = weaponClass(state);
  const set = new Set([cls]);
  const sub = subclassOf(state, cls);
  if (sub === 'multiclass' && state.multi && state.multi[cls]) set.add(state.multi[cls]);
  const off = G.ITEMS[state.equipment.offhand];
  if (off && off.cls) set.add(off.cls);
  return set;
}

function abilityUnlocked(state, ab) {
  if (ab.cls === 'generic') return combatLevel(state) >= ab.level;
  return level(state, G.CLASSES[ab.cls].skill) >= ab.level;
}

function allowedAbility(state, ab) {
  return abilityUnlocked(state, ab) && (ab.cls === 'generic' || abilityClasses(state).has(ab.cls));
}

// Drops equipped abilities that no longer fit (after a weapon or off-hand swap).
function pruneAbilities(state) {
  const ab = state.abilities || { cls: [], generic: null };
  ab.cls = (ab.cls || []).filter(id => G.ABILITY_BY_ID[id] && allowedAbility(state, G.ABILITY_BY_ID[id]));
  if (ab.generic && !(G.ABILITY_BY_ID[ab.generic] && allowedAbility(state, G.ABILITY_BY_ID[ab.generic]))) ab.generic = null;
  state.abilities = ab;
}

function setAbilities(state, clsIds, genericId) {
  if (!Array.isArray(clsIds) || clsIds.length > G.ABILITY_SLOTS.cls) fail(`You can equip ${G.ABILITY_SLOTS.cls} class abilities.`);
  const ids = [...new Set(clsIds)];
  ids.forEach(id => {
    const ab = G.ABILITY_BY_ID[id];
    if (!ab || ab.cls === 'generic') fail('Unknown class ability.');
    if (!abilityUnlocked(state, ab)) fail(`${ab.name} unlocks at ${G.CLASSES[ab.cls].name} level ${ab.level}.`);
    if (!abilityClasses(state).has(ab.cls)) fail(`Equip a ${G.CLASSES[ab.cls].name.toLowerCase()} weapon or off-hand, or multiclass, to use ${ab.name}.`);
  });
  let generic = null;
  if (genericId) {
    const ab = G.ABILITY_BY_ID[genericId];
    if (!ab || ab.cls !== 'generic') fail('Unknown generic ability.');
    if (!abilityUnlocked(state, ab)) fail(`${ab.name} unlocks at combat level ${ab.level}.`);
    generic = genericId;
  }
  state.abilities = { cls: ids, generic };
}

function setSubclass(state, cls, subId, second) {
  if (!G.CLASSES[cls]) fail('Unknown class.');
  const sub = G.SUBCLASS_BY_ID[subId];
  if (!sub || (sub.cls && sub.cls !== cls)) fail('That subclass isn’t for this class.');
  const lv = level(state, G.CLASSES[cls].skill);
  if (lv < sub.level) fail(`${sub.name} needs ${G.CLASSES[cls].name} level ${sub.level}.`);
  state.subclasses = { ...(state.subclasses || {}), [cls]: subId };
  if (subId === 'multiclass') {
    if (!G.CLASSES[second] || second === cls) fail('Pick a different class to multiclass into.');
    state.multi = { ...(state.multi || {}), [cls]: second };
  }
  pruneAbilities(state);
}

// Supplies a pilot takes into their next fight: potions, general tonics, and class buffs that
// match their class (or multiclass second class).
function loadout(state) {
  const use = id => state.supplies[id] !== false && (state.items[id] || 0) > 0;
  const classes = abilityClasses(state);
  const boosts = {};
  const used = [];
  G.CONSUMABLES.forEach(c => {
    if (c.potion || !use(c.id)) return;
    if (c.cls && !classes.has(c.cls)) return;
    used.push(c.id);
    Object.entries(c.boost).forEach(([k, v]) => { boosts[k] = (boosts[k] || 0) + v; });
  });
  const potions = {};
  G.CONSUMABLES.filter(c => c.potion).forEach(c => { potions[c.id] = use(c.id) ? state.items[c.id] : 0; });
  return { boosts, used, potions };
}

// Everything the fight engine needs about one pilot.
function fighter(p) {
  const load = loadout(p.state);
  const s = G.mechStats(p.state.equipment, levels(p.state), { boosts: load.boosts, subclass: subclassOf(p.state) });
  const ab = p.state.abilities || { cls: [], generic: null };
  const abilities = [...(ab.cls || []), ab.generic].filter(id => id && G.ABILITY_BY_ID[id] && allowedAbility(p.state, G.ABILITY_BY_ID[id]));
  return { id: p.id, name: p.name, stats: s, potions: load.potions, used: load.used, abilities, subclass: s.subclass };
}

// ---------- Raid combat ----------
// A fight is simulated up front as a timeline of events (ms from the start), which the client
// replays live. Every cast has a start and an end and its effect lands exactly at the end, so
// cast bars and damage numbers line up. A fight is trash waves then a boss wave; downed pilots
// respawn after 25 seconds and enemies never heal, so every fight is eventually won.
//   { t, e: 'wave', w, of, boss, foes: [{ id, name, foe, max, boss }] }
//   { t, e: 'cast', a, n, d, tg, k }        k: attack | ability | heal | buff | danger | enemy
//   { t, e: 'hit', a, tg, v, ty, sr, k?, c?, raw?, ab?, b? }   k: heal | potion | leech | dot | thorns | hot
//   { t, e: 'buff', tg, n }, { t, e: 'down', tg }, { t, e: 'respawn', tg }, { t, e: 'kill', a, tg }
//   { t, e: 'mana', tg, m }, { t, e: 'end', win }
const UNARMED = { id: null, cls: 'melee', cast: 1200, action: 'Punch', dtype: 'Crush', crit: 0.05, spread: 0.1 };
const PILOT_GAP = 150, ENEMY_GAP = 300;
const vary = spread => 1 - spread + Math.random() * 2 * spread;
const ELEMENTS = ['fire', 'frost', 'shock'];

function buildWaves(raid, diff, n) {
  const d = G.DIFF_BY_ID[diff] || G.DIFFICULTIES[0];
  const hpScale = d.hp * (1 + G.PARTY.hpPerExtra * (n - 1));
  const dmgScale = d.dmg * (1 + G.PARTY.dmgPerExtra * (n - 1));
  const waves = [];
  const trashWaves = 1 + Math.floor(Math.random() * raid.trash.maxWaves);
  const pool = raid.trash.pool;
  const trashFoe = (i, count) => {
    const foe = pool[Math.floor(Math.random() * pool.length)];
    return {
      name: G.FOES[foe], foe, boss: false, hp: Math.round(raid.trash.hp * hpScale / count * vary(0.1)), def: raid.trash.def, mres: raid.trash.mres, eres: raid.trash.eres,
      dps: raid.trash.dps * dmgScale / count, dtype: G.FOE_DAMAGE[foe] || 'physical', cast: 1600 + Math.floor(Math.random() * 800), move: 'Attack',
    };
  };
  for (let w = 0; w < trashWaves; w++) {
    const count = 2 + Math.floor(Math.random() * 2) + Math.floor((n - 1) / 2);
    waves.push({ boss: false, foes: Array.from({ length: count }, (_, i) => trashFoe(i, count)) });
  }
  const bossWave = [{
    name: raid.name, foe: raid.foe, boss: true, hp: Math.round(raid.boss.hp * hpScale), def: raid.boss.def, mres: raid.boss.mres, eres: raid.boss.eres,
    dps: raid.boss.dps * dmgScale, dtype: raid.boss.dtype, cast: 2000, move: raid.moves.basic, sweep: raid.moves.sweep,
  }];
  const adds = raid.finale ? 2 : raid.k >= 12 ? 1 : 0;
  for (let i = 0; i < adds; i++) {
    const add = trashFoe(i, 3);
    add.hp = Math.round(add.hp * 0.8);
    bossWave.push(add);
  }
  waves.push({ boss: true, foes: bossWave });
  return waves;
}

function fight(raid, diff, pilots, record = true) {
  const n = pilots.length;
  const events = [];
  const emit = record ? e => events.push(e) : () => {};
  const waves = buildWaves(raid, diff, n);
  const timers = []; // { t, kind, ref }
  const at = (t, kind, ref) => timers.push({ t, kind, ref });
  const r = v => Math.max(1, Math.round(v));
  let t = 0;
  let ended = null;
  let wave = -1;
  let foes = [];

  const fs = pilots.map((p, i) => {
    const s = p.stats;
    const w = G.WEAPON_BY_ID[s.weapon] || UNARMED;
    const sub = s.subclass ? G.SUBCLASS_BY_ID[s.subclass] : null;
    return {
      i, id: p.id, name: p.name, s, w, cls: w.cls || 'melee', sub, pas: s.passives || {},
      hp: s.hp, max: s.hp, mana: s.mana, maxMana: s.mana, lastMana: 0, barrier: 0, down: false, cast: null, attacks: 0,
      cds: {}, buffs: [], abilities: (p.abilities || []).map(id => G.ABILITY_BY_ID[id]),
      potions: { ...p.potions }, used: {}, potionCount: 0, cheated: false, deaths: 0,
      dealt: 0, healed: 0, taken: 0, mitigated: 0, src: {},
    };
  });
  const alive = () => fs.filter(f => !f.down);
  const liveFoes = () => foes.filter(e => e.hp > 0);
  const lowest = () => alive().sort((x, y) => x.hp / x.max - y.hp / y.max)[0];
  const buffSum = (f, stat) => f.buffs.filter(b => b.stat === stat && b.until > t).reduce((a, b) => a + b.value, 0);
  const debuff = (e, stat) => e.debuffs.filter(b => b.stat === stat && b.until > t).reduce((a, b) => a + b.value, 0);
  const tally = (f, label, key, v) => {
    const row = f.src[label] || (f.src[label] = { dmg: 0, heal: 0, hits: 0 });
    row[key] += v;
    row.hits++;
  };
  const regenMana = f => {
    f.mana = Math.min(f.maxMana, f.mana + (f.s.regen || 0) * (t - f.lastMana) / 1000);
    f.lastMana = t;
  };

  // ----- Damage to enemies -----
  // category: physical (armour), magic (magic resist) or an element (elemental resist).
  function hitFoe(f, e, raw, style, category, ty, sr, extra = {}) {
    if (!e || e.hp <= 0 || ended) return 0;
    let res;
    if (category === 'physical') res = e.def * (1 - (f.s.pen || 0) - (extra.pen || 0)) * (1 - debuff(e, 'sunder') / 100);
    else if (category === 'magic') res = e.mres;
    else res = e.eres / (category === e.weakElement ? 1.25 : 1);
    const mult = (raid.res[style] || 1) * (1 + debuff(e, 'mark') / 100) * (category === e.weakElement ? 1.25 : 1);
    const v = r(raw * mult * 100 / (100 + Math.max(0, res)));
    e.hp -= v;
    f.dealt += v;
    tally(f, sr, 'dmg', v);
    emit({ t, e: 'hit', a: f.i, tg: e.id, v, ty, sr, ...extra.tag });
    const steal = (f.s.lifesteal || 0) + (f.pas.lifesteal || 0) / 100;
    if (steal > 0 && !f.down && f.hp < f.max) heal(f, f, v * steal, 'leech', 'Lifesteal');
    if (e.hp <= 0) killFoe(f, e);
    return v;
  }

  function killFoe(f, e) {
    e.hp = 0;
    e.cast = null;
    emit({ t, e: 'kill', a: f ? f.i : null, tg: e.id });
    if (!liveFoes().length) {
      if (wave >= waves.length - 1) { ended = { win: true }; return; }
      emit({ t, e: 'clear', w: wave });
      fs.forEach(x => { x.cast = null; });
      at(t + G.FIGHT.waveGapMs, 'wave');
    }
  }

  function addDot(f, e, total, ticks, style, category, ty, sr, healShare) {
    for (let k = 1; k <= ticks; k++) at(t + k * 1000, 'dot', { f, e, v: total / ticks, style, category, ty, sr, healShare });
  }

  // ----- Healing -----
  function heal(src, target, amount, k, sr, extra = {}) {
    if (!target || target.down) return;
    const v = r(amount);
    const eff = Math.min(v, target.max - target.hp);
    target.hp += eff;
    if (k === 'heal' || k === 'hot') { src.healed += eff; tally(src, sr, 'heal', eff); }
    if ((k === 'heal' || k === 'hot') && src.pas.overflow && v > eff) target.barrier = Math.min(target.max * src.pas.overflow / 100, target.barrier + v - eff);
    emit({ t, e: 'hit', a: src.i, tg: target.i, v, k, ty: 'Heal', sr, b: Math.round(target.barrier), ...extra });
  }

  // ----- Casting -----
  const castTime = (f, base) => Math.round(base / (1 + (f.s.haste || 0) + buffSum(f, 'haste') / 100));
  const powerMult = f => {
    let m = 1 + buffSum(f, 'power') / 100;
    if (f.sub && f.sub.rage && f.hp < f.max / 2) m *= 1 + f.sub.rage / 100;
    return m;
  };

  function chooseAbility(f) {
    const ready = f.abilities.filter(ab => ab && ab.kind !== 'cheat' && (f.cds[ab.id] || 0) <= t && f.mana >= manaCost(f, ab));
    const hurt = lowest();
    const foesLeft = liveFoes().length;
    const down = fs.filter(x => x.down);
    for (const ab of ready) {
      if (ab.kind === 'revive' && down.length) return { ab, tg: down[0].i };
      if ((ab.kind === 'heal' || ab.kind === 'hot') && !ab.self && hurt && hurt.hp / hurt.max < 0.6) return { ab, tg: hurt.i };
      if (ab.kind === 'heal' && ab.self && f.hp / f.max < 0.4) return { ab, tg: f.i };
      if (ab.kind === 'group' && alive().filter(x => x.hp / x.max < 0.7).length >= Math.min(2, alive().length)) return { ab, tg: 'all' };
      if (ab.kind === 'barrier' && ab.self && f.hp / f.max < 0.55) return { ab, tg: f.i };
      if (ab.kind === 'barrier' && !ab.self && hurt && hurt.hp / hurt.max < 0.5) return { ab, tg: hurt.i };
      if (ab.kind === 'buff' && ab.stat === 'dr' && f.hp / f.max < 0.5) return { ab, tg: f.i };
      if (ab.kind === 'buff' && ab.stat !== 'dr' && !buffSum(f, ab.stat)) return { ab, tg: f.i };
      if (ab.kind === 'party' && !buffSum(f, ab.stat)) return { ab, tg: 'all' };
      if (ab.kind === 'debuff' && foesLeft && !debuff(liveFoes()[0], ab.stat)) return { ab, tg: liveFoes()[0].id };
      if ((ab.kind === 'damage' || ab.kind === 'dot') && foesLeft) return { ab, tg: liveFoes()[0].id };
      if (ab.kind === 'aoe' && foesLeft) return { ab, tg: 'all' };
    }
    return null;
  }
  const manaCost = (f, ab) => Math.round(ab.mana * (f.sub && f.sub.costCut ? 1 - f.sub.costCut : 1));

  function startCast(f, when) {
    if (f.down || ended || !liveFoes().length) { f.cast = null; return; }
    regenMana(f);
    const pick = chooseAbility(f);
    let c;
    if (pick) {
      const ab = pick.ab;
      f.mana -= manaCost(f, ab);
      f.cds[ab.id] = when + ab.cd * 1000;
      const k = ['heal', 'hot', 'group', 'barrier', 'revive'].includes(ab.kind) ? 'heal' : ['buff', 'party', 'debuff'].includes(ab.kind) ? 'buff' : 'ability';
      c = { mode: 'ability', ab, n: ab.name, d: Math.max(300, castTime(f, ab.cast)), tg: pick.tg, k };
    } else if (f.cls === 'healer') {
      const hurt = lowest();
      if (f.sub && f.sub.shadow) c = { mode: 'shadow', n: 'Shadow word', d: castTime(f, f.w.cast), tg: 'all', k: 'attack', base: f.w.cast };
      else if (hurt && hurt.hp / hurt.max < 0.8) c = { mode: f.w.group ? 'group' : 'heal', n: f.w.action, d: castTime(f, f.w.cast), tg: f.w.group ? 'all' : hurt.i, k: 'heal', base: f.w.cast };
      else c = { mode: 'smite', n: 'Smite', d: castTime(f, 1200), tg: liveFoes()[0].id, k: 'attack', base: 1200 };
    } else {
      c = { mode: 'attack', n: f.w.action, d: castTime(f, f.w.cast), tg: liveFoes()[0].id, k: 'attack', base: f.w.cast };
    }
    f.cast = { ...c, end: when + c.d };
    emit({ t: when, e: 'cast', a: f.i, n: c.n, d: c.d, tg: c.tg, k: c.k, m: Math.round(f.mana) });
    at(f.cast.end, 'pilot', f);
  }

  // The weapon's normal hit, in its own style, with its extra effects.
  function weaponHit(f, e, mult, sr) {
    const w = f.w;
    const style = G.CLASSES[f.cls].style;
    const category = f.cls === 'magic' ? 'magic' : 'physical';
    const base = mult.base || w.cast;
    const perSec = f.s.atk * (base + PILOT_GAP) / 1000 * powerMult(f);
    const critMult = (w.critMult || 1.75) + (f.s.critDmg || 0);
    const crit = Math.random() < w.crit + (f.s.crit || 0) + buffSum(f, 'crit') / 100 + (mult.critBonus || 0);
    const norm = 1 + w.crit * ((w.critMult || 1.75) - 1);
    const raw = perSec * (mult.amt || 1) / norm * vary(w.spread || 0.1) * (crit ? critMult : 1);
    const tag = crit ? { tag: { c: 1 } } : {};
    const elemental = ELEMENTS.reduce((a, el) => a + (f.s[el] || 0), 0);
    const v = hitFoe(f, e, raw * (1 - (w.burn || 0)), style, category, w.dtype, sr, { ...tag, pen: 0 });
    if (elemental > 0 && e.hp > 0) {
      const el = ELEMENTS.find(x => f.s[x]) || 'fire';
      hitFoe(f, e, raw * elemental, style, el, el[0].toUpperCase() + el.slice(1), sr, {});
    }
    if (w.burn || f.s.burn) addDot(f, e, raw * ((w.burn || 0) + (f.s.burn || 0) + (f.pas.burn || 0) / 100), 3, style, 'fire', 'Burn', 'Burn');
    if (f.s.bleed || f.pas.bleed) addDot(f, e, raw * ((f.s.bleed || 0) + (f.pas.bleed || 0) / 100), 3, style, 'physical', 'Bleed', 'Bleed');
    if (f.s.poison) addDot(f, e, raw * f.s.poison, 3, style, 'poison', 'Poison', 'Poison');
    if (crit && f.pas.prismatic) addDot(f, e, raw * f.pas.prismatic / 100, 3, style, 'fire', 'Prismatic', 'Prismatic');
    if (w.chain) liveFoes().filter(x => x !== e).forEach(x => hitFoe(f, x, raw * w.chain, style, 'shock', 'Shock', 'Chain lightning'));
    if (w.chill && e.hp > 0) e.debuffs.push({ stat: 'chill', value: w.chill * 100, until: t + 4000 });
    if (f.sub && f.sub.spread) liveFoes().forEach(x => addDot(f, x, raw * f.sub.spread, 3, style, 'poison', 'Poison', 'Trapper poison'));
    if (f.sub && f.sub.splash) liveFoes().filter(x => x !== e).forEach(x => hitFoe(f, x, raw * f.sub.splash, style, 'fire', 'Fire', 'Pyromancer splash'));
    const doubleChance = (f.s.double || 0) + (f.pas.multishot || 0) / 100;
    if (doubleChance && Math.random() < doubleChance && e.hp > 0 && !mult.noDouble) weaponHit(f, e, { ...mult, noDouble: true }, 'Double hit');
    return v;
  }

  function resolvePilot(f) {
    const c = f.cast;
    f.cast = null;
    const focus = foes.find(e => e.id === c.tg && e.hp > 0) || liveFoes()[0];
    const style = G.CLASSES[f.cls].style;
    const perSec = f.s.atk * powerMult(f);
    if (c.mode === 'attack') weaponHit(f, focus, { base: c.base }, 'Auto attack');
    else if (c.mode === 'smite') {
      const raw = perSec * 1.35 * 1.1 * (f.sub && f.sub.smite ? 1 + f.sub.smite : 1) * vary(0.12);
      const crit = Math.random() < f.w.crit + (f.s.crit || 0);
      hitFoe(f, focus, raw * (crit ? 1.75 : 1), 'holy', 'magic', 'Holy', 'Smite', crit ? { tag: { c: 1 } } : {});
    } else if (c.mode === 'shadow') {
      // Shadowmender: shadow damage over time on every enemy; each tick heals the party.
      const per = perSec * (c.base / 1000) * 0.95 * vary(0.1);
      liveFoes().forEach(e => addDot(f, e, per / Math.sqrt(liveFoes().length), 4, 'holy', 'magic', 'Shadow', 'Shadow word', 0.4));
    } else if (c.mode === 'heal' || c.mode === 'group') {
      const hmult = 1 + (f.s.heal || 0);
      const surge = f.pas.surge && Math.random() * 100 < f.pas.surge ? 2 : 1;
      const crit = Math.random() < f.w.crit + (f.s.crit || 0);
      const amount = perSec * (c.base / 1000) * hmult * vary(0.1) * surge * (crit ? 1.5 : 1);
      const extra = crit || surge > 1 ? { c: 1 } : {};
      if (c.mode === 'group') alive().forEach(x => heal(f, x, amount * f.w.group, 'heal', f.w.action, extra));
      else {
        const target = fs[c.tg] && !fs[c.tg].down ? fs[c.tg] : lowest();
        if (f.w.hot) {
          heal(f, target, amount * f.w.hot, 'heal', f.w.action, extra);
          for (let k = 1; k <= 4; k++) at(t + k * 1000, 'hot', { f, target, v: amount * (1 - f.w.hot) * 1.4 / 4, sr: f.w.action });
        } else heal(f, target, amount, 'heal', f.w.action, extra);
      }
    } else if (c.mode === 'ability') useAbility(f, c.ab, c.tg, focus);
    if (!ended) startCast(f, t + PILOT_GAP);
  }

  function useAbility(f, ab, tg, focus) {
    const style = G.CLASSES[f.cls].style;
    const abPower = 1 + (f.sub && f.sub.abilityPower ? f.sub.abilityPower : 0);
    const perSec = f.s.atk * powerMult(f) * abPower;
    const category = ab.ty === 'Fire' ? 'fire' : ab.ty === 'Shock' ? 'shock' : ab.ty === 'Poison' ? 'poison' : ab.ty === 'Holy' ? 'magic' : f.cls === 'magic' ? 'magic' : 'physical';
    const ty = ab.ty || f.w.dtype;
    const hmult = 1 + (f.s.heal || 0);
    if (ab.kind === 'damage' && focus) {
      const crit = Math.random() < f.w.crit + (f.s.crit || 0) + (ab.critBonus || 0);
      let amt = ab.amt * (focus.hp < focus.max * 0.35 && ab.execute ? ab.execute : 1);
      const raw = perSec * amt * (crit ? (f.w.critMult || 1.75) + (f.s.critDmg || 0) : 1) * vary(0.1);
      const hits = ab.hits || 1;
      for (let k = 0; k < hits && focus.hp > 0; k++) hitFoe(f, focus, raw / hits, style, category, ty, ab.name, crit ? { tag: { c: 1 } } : {});
      if (ab.dot && focus.hp > 0) addDot(f, focus, perSec * ab.dot, 3, style, 'fire', 'Burn', ab.name);
      if (ab.selfHeal) heal(f, f, raw * ab.selfHeal, 'heal', ab.name);
    } else if (ab.kind === 'aoe') {
      liveFoes().forEach(e => {
        hitFoe(f, e, perSec * ab.amt * vary(0.1), style, category, ty, ab.name, {});
        if (ab.dot && e.hp > 0) addDot(f, e, perSec * ab.dot, 3, style, 'fire', 'Burn', ab.name);
        if (ab.chill && e.hp > 0) e.debuffs.push({ stat: 'chill', value: ab.chill, until: t + ab.dur * 1000 });
      });
    } else if (ab.kind === 'dot' && focus) {
      addDot(f, focus, perSec * ab.amt, ab.over, style, ab.ty === 'Poison' ? 'poison' : 'physical', ab.ty, ab.name);
    } else if (ab.kind === 'heal') {
      const target = ab.self ? f : fs[tg] && !fs[tg].down ? fs[tg] : lowest();
      heal(f, target, ab.pct ? target.max * ab.pct : perSec * ab.amt * hmult * vary(0.1), 'heal', ab.name);
    } else if (ab.kind === 'hot') {
      const target = fs[tg] && !fs[tg].down ? fs[tg] : lowest();
      for (let k = 1; k <= ab.over; k++) at(t + k * 1000, 'hot', { f, target, v: perSec * ab.amt * hmult / ab.over, sr: ab.name });
    } else if (ab.kind === 'group') {
      alive().forEach(x => heal(f, x, perSec * ab.amt * hmult * vary(0.1), 'heal', ab.name));
    } else if (ab.kind === 'barrier') {
      const target = ab.self ? f : fs[tg] && !fs[tg].down ? fs[tg] : lowest();
      target.barrier += target.max * ab.value;
      emit({ t, e: 'buff', a: f.i, tg: target.i, n: ab.name, b: Math.round(target.barrier) });
    } else if (ab.kind === 'buff') {
      f.buffs.push({ stat: ab.stat, value: ab.value, until: t + ab.dur * 1000 });
      emit({ t, e: 'buff', a: f.i, tg: f.i, n: ab.name, until: t + ab.dur * 1000 });
    } else if (ab.kind === 'party') {
      alive().forEach(x => x.buffs.push({ stat: ab.stat, value: ab.value, until: t + ab.dur * 1000 }));
      emit({ t, e: 'buff', a: f.i, tg: 'all', n: ab.name, until: t + ab.dur * 1000 });
    } else if (ab.kind === 'debuff' && focus) {
      focus.debuffs.push({ stat: ab.stat, value: ab.value, until: t + ab.dur * 1000 });
      emit({ t, e: 'buff', a: f.i, tg: focus.id, n: ab.name, until: t + ab.dur * 1000 });
    } else if (ab.kind === 'revive') {
      const dead = fs[tg] && fs[tg].down ? fs[tg] : fs.find(x => x.down);
      if (dead) revive(dead, ab.value, ab.name);
    }
  }

  function revive(f, pct, why) {
    f.down = false;
    f.hp = Math.round(f.max * pct);
    f.barrier = 0;
    f.mana = Math.max(f.mana, f.maxMana / 2);
    f.lastMana = t;
    f.respawnToken = (f.respawnToken || 0) + 1;
    emit({ t, e: 'respawn', tg: f.i, n: why, hp: f.hp });
    startCast(f, t + 500);
  }

  // ----- Enemies -----
  function pickTarget() {
    const tanks = alive().filter(f => f.sub && f.sub.taunt);
    const pool = tanks.length ? tanks : alive();
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function startFoe(e, when) {
    if (e.hp <= 0 || ended) return;
    const target = pickTarget();
    if (!target) {
      // Nobody standing: wait for the next respawn.
      const next = Math.min(...fs.filter(f => f.down).map(f => f.respawnAt || Infinity));
      at(Math.max(when, isFinite(next) ? next + 200 : when + 1000), 'foeWait', e);
      return;
    }
    e.attacks++;
    const sweep = e.boss && e.attacks % 4 === 0;
    const d = sweep ? 3000 : e.cast;
    e.cast = { sweep, d, tg: sweep ? 'all' : target.i, end: when + d };
    emit({ t: when, e: 'cast', a: e.id, n: sweep ? e.sweep : e.move, d, tg: e.cast.tg, k: sweep ? 'danger' : 'enemy' });
    at(e.cast.end, 'foe', e);
  }

  function resolveFoe(e) {
    const c = e.cast;
    e.cast = null;
    if (!c || e.hp <= 0) return;
    let targets = alive();
    if (!c.sweep) targets = [fs[c.tg] && !fs[c.tg].down ? fs[c.tg] : pickTarget()].filter(Boolean);
    const chill = debuff(e, 'chill') / 100;
    for (const f of targets) {
      const crit = Math.random() < 0.1;
      const raw = e.dps * (c.d + ENEMY_GAP) / 1000 * (c.sweep ? 0.6 : 1) * vary(0.15) * (crit ? 1.5 : 1) * (1 - chill);
      const res = e.dtype === 'physical' ? f.s.def : e.dtype === 'magic' ? f.s.mres : f.s.eres;
      const dr = Math.min(0.8, (f.s.block || 0) + buffSum(f, 'dr') / 100 + (f.sub && f.sub.dr ? f.sub.dr / 100 : 0) - (f.s.enemyDmg || 0));
      const v = r(raw * 100 / (100 + res) * (1 - dr));
      const absorbed = Math.min(f.barrier, v);
      f.barrier -= absorbed;
      f.hp -= v - absorbed;
      f.taken += v - absorbed;
      f.mitigated += Math.max(0, Math.round(raw) - v) + absorbed;
      const ty = e.dtype === 'physical' ? 'Physical' : e.dtype[0].toUpperCase() + e.dtype.slice(1);
      emit({ t, e: 'hit', a: e.id, tg: f.i, v, raw: Math.round(raw), ty, sr: c.sweep ? e.sweep : e.move, ...(crit ? { c: 1 } : {}), ...(absorbed ? { ab: Math.round(absorbed), b: Math.round(f.barrier) } : {}) });
      if (f.pas.thorns) hitFoe(f, e, v * f.pas.thorns / 100, 'none', 'physical', 'Thorns', 'Thorns', { tag: { k: 'thorns' } });
      if (f.hp <= 0) {
        const cheat = f.abilities.find(ab => ab && ab.kind === 'cheat');
        if (cheat && !f.cheated) {
          f.cheated = true;
          f.hp = 1;
          heal(f, f, f.max * cheat.value, 'heal', cheat.name);
          continue;
        }
        f.hp = 0;
        f.down = true;
        f.deaths++;
        f.cast = null;
        f.buffs = [];
        f.respawnAt = t + G.FIGHT.respawnMs;
        emit({ t, e: 'down', tg: f.i, at: f.respawnAt });
        at(f.respawnAt, 'respawn', { f, token: (f.respawnToken || 0) });
        continue;
      }
      drinkIfNeeded(f);
    }
    if (!ended) startFoe(e, t + ENEMY_GAP);
  }

  function drinkIfNeeded(f) {
    if (f.potionCount >= G.POTIONS_PER_RAID) return;
    if (f.hp < f.max * 0.4) {
      const pot = ['superior_healing_potion', 'greater_healing_potion', 'healing_potion'].find(k => (f.potions[k] || 0) > (f.used[k] || 0));
      if (pot) {
        f.used[pot] = (f.used[pot] || 0) + 1;
        f.potionCount++;
        heal(f, f, f.max * G.ITEMS[pot].heal, 'potion', G.ITEMS[pot].name, { n: G.ITEMS[pot].name });
      }
    }
  }

  function startWave() {
    wave++;
    const w = waves[wave];
    foes = w.foes.map((x, k) => ({ ...x, id: `e${wave}_${k}`, max: x.hp, attacks: 0, cast: null, debuffs: [], weakElement: raid.weakElement }));
    emit({ t, e: 'wave', w: wave, of: waves.length, boss: w.boss, foes: foes.map(e => ({ id: e.id, name: e.name, foe: e.foe, max: e.max, boss: e.boss })) });
    fs.forEach((f, i) => { if (!f.down) startCast(f, t + 200 + i * 150 + Math.floor(Math.random() * 200)); });
    foes.forEach((e, k) => startFoe(e, t + 700 + k * 350));
  }

  startWave();
  while (!ended) {
    let bi = 0;
    for (let k = 1; k < timers.length; k++) if (timers[k].t < timers[bi].t) bi = k;
    const next = timers.splice(bi, 1)[0];
    if (!next) break;
    if (next.t > G.FIGHT.safetyMs) { t = G.FIGHT.safetyMs; ended = { win: false, timeout: true }; break; }
    t = next.t;
    const ref = next.ref;
    if (next.kind === 'pilot') { if (ref.cast && !ref.down && ref.cast.end === t) resolvePilot(ref); }
    else if (next.kind === 'foe') { if (ref.cast && ref.hp > 0 && foes.includes(ref) && ref.cast.end === t) resolveFoe(ref); }
    else if (next.kind === 'foeWait') { if (ref.hp > 0 && foes.includes(ref) && !ref.cast) startFoe(ref, t); }
    else if (next.kind === 'dot') {
      if (foes.includes(ref.e) && ref.e.hp > 0) {
        const v = hitFoe(ref.f, ref.e, ref.v, ref.style, ref.category, ref.ty, ref.sr, { tag: { k: 'dot' } });
        if (ref.healShare && v) alive().forEach(x => heal(ref.f, x, v * ref.healShare, 'hot', 'Shadow mend'));
      }
    } else if (next.kind === 'hot') { if (!ref.target.down) heal(ref.f, ref.target, ref.v, 'hot', ref.sr); }
    else if (next.kind === 'respawn') { if (ref.f.down && ref.token === (ref.f.respawnToken || 0)) revive(ref.f, 1, 'Respawned'); }
    else if (next.kind === 'wave') {
      // Casts and damage over time from the last wave are over; respawns and heals carry on.
      for (let k = timers.length - 1; k >= 0; k--) if (timers[k].kind !== 'respawn' && timers[k].kind !== 'hot') timers.splice(k, 1);
      startWave();
    }
  }
  emit({ t, e: 'end', win: ended.win, timeout: !!ended.timeout });

  return {
    win: ended.win, timeout: !!ended.timeout, ms: t, waves: waves.length, events: record ? events : null,
    fighters: fs.map(f => ({
      id: f.id, cls: f.cls, weapon: f.s.weapon, subclass: f.s.subclass, max: f.max, deaths: f.deaths,
      dealt: f.dealt, healed: f.healed, taken: f.taken, mitigated: f.mitigated, used: f.used, src: f.src,
    })),
  };
}

// Simulates the next fight for a group of pilots ([{ id, name, colour, mech, state }]).
function simulate(raidId, diff, players, record) {
  const raid = G.RAID_BY_ID[raidId];
  const pilots = players.map(fighter);
  const result = fight(raid, diff, pilots, record);
  result.raid = raid.id;
  result.diff = diff;
  result.fighters.forEach((f, i) => {
    const p = players[i];
    const s = pilots[i].stats;
    Object.assign(f, { name: p.name, mech: p.mech, gear: { ...p.state.equipment }, supplies: pilots[i].used, hp: s.hp, mana: s.mana, abilities: pilots[i].abilities });
  });
  return result;
}

// Applies a finished fight's costs and rewards to each pilot in it. Downed pilots still share
// the loot and XP when the party wins.
function applyFight(fightResult, players, at, gainedById) {
  const raid = G.RAID_BY_ID[fightResult.raid];
  const d = G.DIFF_BY_ID[fightResult.diff] || G.DIFFICULTIES[0];
  const names = fightResult.fighters.map(f => f.name);
  for (const f of fightResult.fighters) {
    const p = players.find(x => x.id === f.id);
    if (!p) continue;
    const s = p.state;
    const g = gainedById && gainedById[p.id];
    addItems(s.items, f.used, -1, g && g.items);
    f.supplies.forEach(id => addItems(s.items, { [id]: 1 }, -1, g && g.items));
    const loot = {};
    if (fightResult.win) {
      for (const drop of raid.drops) {
        if (drop.p && Math.random() >= drop.p * d.drop) continue;
        loot[drop.item] = (loot[drop.item] || 0) + Math.round(rollQty(drop.qty) * (drop.rare ? 1 : d.mats));
      }
      addItems(s.items, loot, 1, g && g.items);
      const di = G.DIFFICULTIES.indexOf(d) + 1;
      s.clears = s.clears || {};
      if ((s.clears[raid.id] || 0) < di) s.clears[raid.id] = di;
    }
    // XP goes to the main weapon's combat skill, split 60/40 with a multiclass second class.
    const cls = f.cls;
    const base = Math.round(raid.xp * d.xp * (fightResult.win ? 1 : 0.25));
    const xp = {};
    const second = s.subclasses && s.subclasses[cls] === 'multiclass' && s.multi && s.multi[cls];
    if (second) {
      xp[G.CLASSES[cls].skill] = Math.round(base * 0.6);
      xp[G.CLASSES[second].skill] = Math.round(base * 0.4);
    } else xp[G.CLASSES[cls].skill] = base;
    Object.entries(xp).forEach(([k, v]) => addXp(s, k, v, g && g.xp));
    if (g) { g.fights++; if (fightResult.win) g.wins++; }
    s.raidLog.unshift({ at, raid: raid.id, diff: d.id, win: fightResult.win, ms: fightResult.ms, party: names, loot, xp, dealt: f.dealt, healed: f.healed, deaths: f.deaths });
    s.raidLog.length = Math.min(s.raidLog.length, 30);
  }
}

// A raid session repeats fights back to back: { raid, diff, start, n, fight }.
// Runs every fight that has finished by `now`, then makes sure the current one is recorded.
function advanceRaid(session, players, now, gainedById) {
  if (!players.length) return;
  if (!G.RAID_BY_ID[session.raid]) { session.fight = null; return; }
  const diff = session.diff || 'normal';
  if (!session.fight || now - session.start > G.OFFLINE_CAP) {
    session.start = Math.max(session.start || now, now - G.OFFLINE_CAP);
    session.fight = simulate(session.raid, diff, players, false);
  }
  while (now >= session.start + session.fight.ms + G.FIGHT.gapMs) {
    applyFight(session.fight, players, session.start + session.fight.ms, gainedById);
    session.start += session.fight.ms + G.FIGHT.gapMs;
    session.n = (session.n || 0) + 1;
    session.fight = simulate(session.raid, diff, players, false);
  }
  // Only the fight on screen needs its timeline; nobody has seen this one yet, so rerolling it is fair.
  if (!session.fight.events) session.fight = simulate(session.raid, diff, players, true);
}

// Raid n unlocks by clearing raid n-1 on Normal; Heroic needs a Normal clear, Mythic a Heroic one.
function raidUnlocked(state, raidId, diff = 'normal') {
  const raid = G.RAID_BY_ID[raidId];
  if (!raid) return false;
  const clears = state.clears || {};
  if (diff === 'normal') return raid.n === 1 || (clears[`r${raid.n - 1}`] || 0) >= 1;
  if (diff === 'heroic') return (clears[raid.id] || 0) >= 1;
  if (diff === 'mythic') return (clears[raid.id] || 0) >= 2;
  return false;
}

function newSession(raidId, diff, now) {
  if (!G.RAID_BY_ID[raidId]) fail('Unknown raid.');
  if (!G.DIFF_BY_ID[diff]) fail('Unknown difficulty.');
  return { raid: raidId, diff, start: now, n: 1, fight: null };
}

// What the client needs about a session without the (large) fight timeline.
function sessionSummary(session) {
  if (!session) return null;
  return { raid: session.raid, diff: session.diff || 'normal', start: session.start, n: session.n, ms: session.fight ? session.fight.ms : null, win: session.fight ? session.fight.win : null };
}

module.exports = {
  GameError, fail, newState, migrate, level, levels, totalLevel, combatLevel, weaponClass, subclassOf, stats, power, loadout, fighter, newGained,
  hasItems, addItems, advance, startAction, stopAction, setQueue, equip, unequip, setSupply, setAbilities, setSubclass, abilityClasses, allowedAbility,
  fight, simulate, applyFight, advanceRaid, raidUnlocked, newSession, sessionSummary,
};
