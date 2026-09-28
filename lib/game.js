'use strict';
// Server-side game rules. Everything that changes a player's state goes through here.
const G = require('../public/data.js');

class GameError extends Error {}
const fail = msg => { throw new GameError(msg); };

const rnd = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const rollQty = q => (Array.isArray(q) ? rnd(q[0], q[1]) : q);
const STATE_VERSION = 4;

// ---------- State ----------
function newState(now) {
  const skills = {};
  G.SKILLS.forEach(s => { skills[s.id] = { xp: 0 }; });
  const equipment = {};
  G.SLOTS.forEach(s => { equipment[s.id] = null; });
  const supplies = {};
  Object.values(G.ITEMS).forEach(it => { if (it.supply) supplies[it.id] = true; });
  return { v: STATE_VERSION, skills, items: {}, equipment, supplies, activity: null, lastTick: now, raidLog: [] };
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
  return G.ITEMS[id] ? [id, 1] : null;
}

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
  s.v = STATE_VERSION;
  Object.keys(s.skills).forEach(k => { if (!G.SKILL_BY_ID[k]) delete s.skills[k]; });
  Object.keys(s.items).forEach(k => { if (!G.ITEMS[k]) delete s.items[k]; });
  Object.keys(s.equipment).forEach(k => { if (s.equipment[k] && !G.ITEMS[s.equipment[k]]) s.equipment[k] = null; });
  return s;
}

const level = (state, skill) => G.levelFromXp(state.skills[skill].xp);
const levels = state => Object.fromEntries(G.SKILLS.map(s => [s.id, level(state, s.id)]));
const totalLevel = state => G.SKILLS.reduce((a, s) => a + level(state, s.id), 0);
const stats = (state, boosts) => G.mechStats(state.equipment, levels(state), boosts);
const power = state => G.power(stats(state));

function hasItems(items, need) {
  return Object.entries(need).every(([id, n]) => (items[id] || 0) >= n);
}

function addItems(items, delta, sign = 1, tally) {
  for (const [id, n] of Object.entries(delta)) {
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

// ---------- Skill activity ----------
// Runs the current skill action forward to `now`, capped at the offline limit.
// Raid activities are advanced separately by advanceRaid.
function advance(state, now) {
  const gained = newGained(Math.max(0, now - state.lastTick));
  const elapsed = Math.min(gained.ms, G.OFFLINE_CAP);
  state.lastTick = now;
  const a = state.activity;
  if (a && a.type) return gained;
  const action = a && G.ACTION_BY_ID[a.id];
  if (!action) { state.activity = null; return gained; }
  let t = a.progress + elapsed;
  while (t >= action.time) {
    if (!hasItems(state.items, action.inputs)) { state.activity = null; break; }
    t -= action.time;
    addItems(state.items, action.inputs, -1, gained.items);
    const out = {};
    for (const [id, q] of Object.entries(action.outputs)) out[id] = rollQty(q);
    for (const c of action.chance) if (Math.random() < c.p) out[c.item] = (out[c.item] || 0) + c.qty;
    addItems(state.items, out, 1, gained.items);
    addXp(state, action.skill, action.xp, gained.xp);
  }
  if (state.activity) state.activity.progress = t;
  return gained;
}

function startAction(state, id) {
  const action = G.ACTION_BY_ID[id];
  if (!action) fail('Unknown action.');
  if (level(state, action.skill) < action.level) fail(`You need level ${action.level} for that.`);
  if (!hasItems(state.items, action.inputs)) fail('You don’t have the materials for that.');
  state.activity = { id, progress: 0 };
}

function stopAction(state) {
  state.activity = null;
}

// ---------- Equipment and supplies ----------
function equip(state, itemId) {
  const it = G.ITEMS[itemId];
  if (!it || it.type !== 'gear') fail('That can’t be equipped.');
  if (!state.items[itemId]) fail('You don’t have one of those.');
  addItems(state.items, { [itemId]: 1 }, -1);
  const old = state.equipment[it.slot];
  if (old) addItems(state.items, { [old]: 1 });
  state.equipment[it.slot] = itemId;
}

function unequip(state, slot) {
  if (!(slot in state.equipment)) fail('Unknown slot.');
  const old = state.equipment[slot];
  if (!old) return;
  addItems(state.items, { [old]: 1 });
  state.equipment[slot] = null;
}

function setSupply(state, itemId, on) {
  if (!G.ITEMS[itemId] || !G.ITEMS[itemId].supply) fail('That isn’t a raid supply.');
  state.supplies[itemId] = !!on;
}

// Supplies a pilot takes into their next fight.
function loadout(state) {
  const use = id => state.supplies[id] !== false && (state.items[id] || 0) > 0;
  const boosts = {};
  const used = [];
  G.BOOSTS.forEach(id => {
    if (!use(id)) return;
    used.push(id);
    Object.entries(G.ITEMS[id].boost).forEach(([k, v]) => { boosts[k] = (boosts[k] || 0) + v; });
  });
  const potions = {};
  G.POTIONS.forEach(id => { potions[id] = use(id) ? state.items[id] : 0; });
  return { boosts, used, potions };
}

// ---------- Raid combat ----------
// A fight is simulated up front as a timeline of events (ms from the start), which the
// client replays live. Every cast has a start and an end, and its effect lands exactly at
// the end, so cast bars and damage numbers line up on screen.
//   { t, e: 'cast', a, n, d, tg }          a / tg: pilot index, 'b' for the boss, 'all'
//   { t, e: 'hit', a, tg, v, ty, k?, c? }  k: heal | potion | leech | burn | thorns; c: crit
//   { t, e: 'down', tg }, { t, e: 'end', win }
const UNARMED = { id: null, role: 'melee', stance: 'dps', skill: 'melee', cast: 1200, action: 'Punch', dtype: 'Crush', crit: 0.05, spread: 0.1 };
const PILOT_GAP = 150, BOSS_GAP = 300;
const vary = spread => 1 - spread + Math.random() * 2 * spread;

function fight(raid, pilots, record = true) {
  const n = pilots.length;
  const events = [];
  const emit = record ? e => events.push(e) : () => {};
  const max = Math.round(raid.boss.hp * (1 + G.PARTY_HP_SCALE * (n - 1)));
  const boss = { hp: max, max, attacks: 0, cast: null };
  const dots = [];
  const fs = pilots.map((p, i) => {
    const w = G.WEAPON_BY_ID[p.stats.weapon] || UNARMED;
    return {
      i, id: p.id, s: p.stats, w, pas: p.stats.passives || {}, crit: w.crit + (p.stats.crit || 0),
      hp: p.stats.hp, max: p.stats.hp, barrier: 0, down: false, cast: null, attacks: 0,
      potions: { ...p.potions }, used: {}, potionCount: 0, dealt: 0, healed: 0, taken: 0,
    };
  });
  const alive = () => fs.filter(f => !f.down);
  const lowest = () => alive().sort((x, y) => x.hp / x.max - y.hp / y.max)[0];
  const r = v => Math.max(1, Math.round(v));
  const styleOf = f => G.ROLES[f.w.role].style;
  let t = 0;
  let ended = null;

  function heal(src, target, amount, k, extra) {
    const v = r(amount);
    const eff = Math.min(v, target.max - target.hp);
    target.hp += eff;
    if (k === 'heal') src.healed += eff;
    if (k === 'heal' && src.pas.overflow && v > eff) target.barrier = Math.min(target.max * src.pas.overflow / 100, target.barrier + v - eff);
    emit({ t, e: 'hit', a: src.i, tg: target.i, v, k, ty: k === 'leech' ? 'Lifesteal' : k === 'potion' ? extra.n : 'Heal', b: Math.round(target.barrier), ...extra });
  }

  function damageBoss(f, amount, style, ty, extra = {}, pierce = 0) {
    const v = r(amount * (raid.res[style] || 1) * 100 / (100 + raid.boss.def * (1 - pierce)));
    boss.hp -= v;
    f.dealt += v;
    emit({ t, e: 'hit', a: f.i, tg: 'b', v, ty, ...extra });
    if (f.pas.lifesteal && !f.down && f.hp < f.max) {
      const h = Math.min(f.max - f.hp, v * f.pas.lifesteal / 100);
      if (h >= 1) heal(f, f, h, 'leech', {});
    }
    if (boss.hp <= 0 && !ended) ended = { win: true };
  }

  const addDot = (f, total, ty, style) => {
    for (let k = 1; k <= 3; k++) dots.push({ t: t + k * 1000, f, v: total / 3, ty, style });
    dots.sort((x, y) => x.t - y.t);
  };

  // Passive effects that follow any direct hit on the boss.
  function afterHit(f, hit, crit, style) {
    if (crit && f.pas.prismatic) addDot(f, hit * f.pas.prismatic / 100, 'Prismatic', style);
    if (f.pas.bleed) addDot(f, hit * f.pas.bleed / 100, 'Bleed', style);
  }

  function startCast(f, at) {
    const w = f.w;
    let c;
    if (w.stance === 'heal') {
      const hurt = lowest();
      if (hurt && hurt.hp / hurt.max < G.HEALER.smiteAt) c = w.group ? { mode: 'group', n: w.action, d: w.cast, tg: 'all' } : { mode: 'heal', n: w.action, d: w.cast, tg: hurt.i };
      else c = { mode: 'smite', n: 'Smite', d: G.HEALER.smiteCast, tg: 'b' };
    } else {
      c = { mode: 'attack', n: w.action, d: w.cast, tg: 'b' };
    }
    f.cast = { ...c, start: at, end: at + c.d };
    emit({ t: at, e: 'cast', a: f.i, n: c.n, d: c.d, tg: c.tg });
  }

  function resolvePilot(f) {
    const c = f.cast;
    const w = f.w;
    // The short pause after each cast counts too, so fast and slow weapons deal the same per second.
    const perSec = f.s.atk * (c.d + PILOT_GAP) / 1000;
    const crit = Math.random() < f.crit;
    if (c.mode === 'attack') {
      const critMult = w.critMult || 1.75;
      const norm = (1 + w.crit * (critMult - 1)) * (w.surge ? 1 + 1 / w.surge : 1);
      f.attacks++;
      const surge = w.surge && f.attacks % w.surge === 0;
      const hit = perSec * (w.dmg || 1) / norm * vary(w.spread) * (crit ? critMult : 1) * (surge ? 2 : 1);
      const style = styleOf(f);
      const extra = { ...(crit ? { c: 1 } : {}), ...(surge ? { su: 1 } : {}) };
      if (w.burn) {
        damageBoss(f, hit * (1 - w.burn), style, w.dtype, extra, w.pierce);
        addDot(f, hit * w.burn, 'Burn', style);
      } else {
        damageBoss(f, hit, style, w.dtype, extra, w.pierce);
      }
      afterHit(f, hit, crit, style);
      if (f.pas.multishot && Math.random() * 100 < f.pas.multishot && !ended) {
        damageBoss(f, hit, style, w.dtype, { ...extra, ms: 1 }, w.pierce);
      }
    } else if (c.mode === 'smite') {
      const hit = perSec * G.HEALER.smite / (1 + w.crit * 0.75) * vary(0.12) * (crit ? 1.75 : 1);
      damageBoss(f, hit, 'holy', 'Holy', crit ? { c: 1 } : {});
      afterHit(f, hit, crit, 'holy');
    } else {
      const surge = f.pas.surge && Math.random() * 100 < f.pas.surge;
      const mult = (1 + f.s.heal) * (crit ? 1.5 : 1) * (surge ? 2 : 1);
      const extra = crit || surge ? { c: 1 } : {};
      if (c.mode === 'group') alive().forEach(x => heal(f, x, perSec * w.group * mult * vary(0.1), 'heal', extra));
      else heal(f, fs[c.tg].down ? lowest() : fs[c.tg], perSec * mult * vary(0.1), 'heal', extra);
    }
  }

  // Tanks draw every single-target attack while they stand.
  const pickTarget = () => {
    const tanks = alive().filter(f => f.w.stance === 'tank');
    const pool = tanks.length ? tanks : alive();
    return pool[Math.floor(Math.random() * pool.length)];
  };

  function startBoss(at) {
    boss.attacks++;
    const sweep = boss.attacks % G.BOSS_MOVES.sweepEvery === 0;
    const d = sweep ? G.BOSS_MOVES.sweep : G.BOSS_MOVES.basic;
    boss.cast = { sweep, d, tg: sweep ? 'all' : pickTarget().i, start: at, end: at + d };
    emit({ t: at, e: 'cast', a: 'b', n: sweep ? raid.moves.sweep : raid.moves.basic, d, tg: boss.cast.tg });
  }

  function resolveBoss() {
    const c = boss.cast;
    let targets = alive();
    if (!c.sweep) targets = [fs[c.tg].down ? pickTarget() : fs[c.tg]];
    for (const f of targets) {
      const crit = Math.random() < 0.1;
      const v = r(raid.boss.dps * (c.d + BOSS_GAP) / 1000 * (c.sweep ? G.BOSS_MOVES.sweepShare : 1) * vary(0.15) * (crit ? 1.5 : 1) * 100 / (100 + f.s.def));
      const absorbed = Math.min(f.barrier, v);
      f.barrier -= absorbed;
      f.hp -= v - absorbed;
      f.taken += v;
      emit({ t, e: 'hit', a: 'b', tg: f.i, v, ty: raid.dtype, ...(crit ? { c: 1 } : {}), ...(absorbed ? { ab: Math.round(absorbed), b: Math.round(f.barrier) } : {}) });
      if (f.pas.thorns) damageBoss(f, v * f.pas.thorns / 100, 'none', 'Thorns', { k: 'thorns' });
      if (f.hp <= 0) {
        f.hp = 0;
        f.down = true;
        f.cast = null;
        emit({ t, e: 'down', tg: f.i });
        continue;
      }
      if (f.hp < f.max * 0.4 && f.potionCount < G.POTIONS_PER_RAID) {
        const pot = G.POTIONS.find(k => (f.potions[k] || 0) > (f.used[k] || 0));
        if (pot) {
          f.used[pot] = (f.used[pot] || 0) + 1;
          f.potionCount++;
          heal(f, f, Math.min(f.max - f.hp, f.max * G.ITEMS[pot].heal), 'potion', { n: G.ITEMS[pot].name });
        }
      }
    }
    if (!alive().length && !ended) ended = { win: false };
  }

  fs.forEach((f, i) => startCast(f, 200 + i * 180 + Math.floor(Math.random() * 200)));
  startBoss(700);

  while (!ended) {
    // Whatever happens next: a pilot's cast landing, the boss's cast, or a damage-over-time tick.
    let next = boss.cast.end, who = 'boss';
    for (const f of fs) if (!f.down && f.cast && f.cast.end < next) { next = f.cast.end; who = f; }
    if (dots.length && dots[0].t < next) { next = dots[0].t; who = 'dot'; }
    if (next > G.FIGHT.maxMs) { t = G.FIGHT.maxMs; ended = { win: false, timeout: true }; break; }
    t = next;
    if (who === 'dot') {
      const d = dots.shift();
      damageBoss(d.f, d.v, d.style, d.ty, { k: 'burn' });
    } else if (who === 'boss') {
      resolveBoss();
      if (!ended) startBoss(t + BOSS_GAP);
    } else {
      resolvePilot(who);
      if (!ended) startCast(who, t + PILOT_GAP);
    }
  }
  emit({ t, e: 'end', win: ended.win, timeout: !!ended.timeout });

  return {
    win: ended.win, timeout: !!ended.timeout, ms: t, bossMax: max, events: record ? events : null,
    fighters: fs.map(f => ({
      id: f.id, role: f.w.role, stance: f.w.stance, weapon: f.s.weapon,
      max: f.max, hp: f.hp, down: f.down, dealt: f.dealt, healed: f.healed, taken: f.taken, used: f.used,
    })),
  };
}

// Simulates the next fight for a group of pilots ([{ id, name, colour, mech, state }]).
function simulate(raidId, players, record) {
  const raid = G.RAID_BY_ID[raidId];
  const loads = players.map(p => loadout(p.state));
  const result = fight(raid, players.map((p, i) => ({ id: p.id, stats: stats(p.state, loads[i].boosts), potions: loads[i].potions })), record);
  result.raid = raid.id;
  result.fighters.forEach((f, i) => {
    const p = players[i];
    Object.assign(f, { name: p.name, colour: p.colour, mech: p.mech, gear: { ...p.state.equipment }, supplies: loads[i].used });
  });
  return result;
}

// Applies a finished fight's costs and rewards to each pilot in it.
function applyFight(fightResult, players, at, gainedById) {
  const raid = G.RAID_BY_ID[fightResult.raid];
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
      for (const d of raid.drops) {
        if (d.p && Math.random() >= d.p) continue;
        loot[d.item] = (loot[d.item] || 0) + rollQty(d.qty);
      }
      addItems(s.items, loot, 1, g && g.items);
    }
    const skill = (G.WEAPON_BY_ID[f.weapon] || UNARMED).skill;
    const xp = { [skill]: fightResult.win ? raid.xp : Math.floor(raid.xp / 4) };
    Object.entries(xp).forEach(([k, v]) => addXp(s, k, v, g && g.xp));
    if (g) { g.fights++; if (fightResult.win) g.wins++; }
    s.raidLog.unshift({ at, raid: raid.id, win: fightResult.win, ms: fightResult.ms, party: names, loot, xp, dealt: f.dealt, healed: f.healed });
    s.raidLog.length = Math.min(s.raidLog.length, 20);
  }
}

// A raid session repeats fights back to back: { raid, start, n, fight }.
// Runs every fight that has finished by `now`, then makes sure the current one is recorded.
function advanceRaid(session, players, now, gainedById) {
  if (!players.length) return;
  if (!session.fight || now - session.start > G.OFFLINE_CAP) {
    session.start = Math.max(session.start || now, now - G.OFFLINE_CAP);
    session.fight = simulate(session.raid, players, false);
  }
  while (now >= session.start + session.fight.ms + G.FIGHT.gapMs) {
    applyFight(session.fight, players, session.start + session.fight.ms, gainedById);
    session.start += session.fight.ms + G.FIGHT.gapMs;
    session.n = (session.n || 0) + 1;
    session.fight = simulate(session.raid, players, false);
  }
  // Only the fight on screen needs its timeline; nobody has seen this one yet, so rerolling it is fair.
  if (!session.fight.events) session.fight = simulate(session.raid, players, true);
}

function newSession(raidId, now) {
  if (!G.RAID_BY_ID[raidId]) fail('Unknown raid.');
  return { raid: raidId, start: now, n: 1, fight: null };
}

// What the client needs about a session without the (large) fight timeline.
function sessionSummary(session) {
  if (!session) return null;
  return { raid: session.raid, start: session.start, n: session.n, ms: session.fight ? session.fight.ms : null, win: session.fight ? session.fight.win : null };
}

module.exports = {
  GameError, fail, newState, migrate, level, levels, totalLevel, stats, power, loadout, newGained,
  hasItems, addItems, advance, startAction, stopAction, equip, unequip, setSupply,
  fight, simulate, applyFight, advanceRaid, newSession, sessionSummary,
};
