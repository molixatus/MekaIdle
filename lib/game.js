'use strict';
// Server-side game rules. Everything that changes a player's state goes through here.
const G = require('../public/data.js');

class GameError extends Error {}
const fail = msg => { throw new GameError(msg); };

const rnd = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const rollQty = q => (Array.isArray(q) ? rnd(q[0], q[1]) : q);
const STATE_VERSION = 2;

// ---------- State ----------
function newState(now) {
  const skills = {};
  G.SKILLS.forEach(s => { skills[s.id] = { xp: 0 }; });
  const equipment = {};
  G.SLOTS.forEach(s => { equipment[s.id] = null; });
  const supplies = {};
  G.ITEMS && Object.values(G.ITEMS).forEach(it => { if (it.supply) supplies[it.id] = true; });
  return { v: STATE_VERSION, skills, items: {}, equipment, supplies, activity: null, lastTick: now, raidLog: [] };
}

// Brings a save from any earlier version up to date.
function migrate(state, now) {
  const fresh = newState(now);
  const old = state.skills || {};
  const s = {
    ...fresh,
    ...state,
    skills: { ...fresh.skills, ...old },
    equipment: { ...fresh.equipment, ...state.equipment },
    supplies: { ...fresh.supplies, ...state.supplies },
    items: { ...state.items },
    raidLog: Array.isArray(state.raidLog) ? state.raidLog : [],
  };
  if (!state.v || state.v < 2) {
    // v1 had one generic weapon per tier, one Piloting skill and one Fabrication skill.
    const pilotXp = old.piloting ? old.piloting.xp : 0;
    s.skills.kinetic = { xp: Math.max(s.skills.kinetic.xp, pilotXp) };
    s.skills.shielding = { xp: Math.max(s.skills.shielding.xp, pilotXp) };
    s.skills.weaponsmithing = { xp: Math.max(s.skills.weaponsmithing.xp, old.fabrication ? old.fabrication.xp : 0) };
    delete s.skills.piloting;
    G.TIERS.forEach(t => {
      const was = `${t.id}_weapon`, now = `${t.id}_autocannon`;
      if (s.items[was]) { s.items[now] = (s.items[now] || 0) + s.items[was]; delete s.items[was]; }
      if (s.equipment.weapon === was) s.equipment.weapon = now;
    });
    if (s.activity && !G.ACTION_BY_ID[s.activity.id]) {
      const renamed = s.activity.id.replace(/^fab_(\w+)_weapon$/, 'smith_$1_autocannon');
      s.activity = G.ACTION_BY_ID[renamed] ? { ...s.activity, id: renamed } : null;
    }
    s.raidLog = s.raidLog.map(e => (typeof e.xp === 'number' ? { ...e, xp: { kinetic: e.xp } } : e));
    s.v = 2;
  }
  Object.keys(s.skills).forEach(k => { if (!G.SKILL_BY_ID[k]) delete s.skills[k]; });
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

// ---------- Activity ----------
// Runs the current action forward to `now`, capped at the offline limit.
function advance(state, now) {
  const gained = { items: {}, xp: {}, ms: Math.max(0, now - state.lastTick) };
  const elapsed = Math.min(gained.ms, G.OFFLINE_CAP);
  state.lastTick = now;
  const a = state.activity;
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

// Supplies a pilot will take into their next raid.
function loadout(state) {
  const use = id => state.supplies[id] !== false && (state.items[id] || 0) > 0;
  const boosts = {};
  const used = [];
  G.BOOSTS.forEach(id => {
    if (!use(id)) return;
    used.push(id);
    Object.entries(G.ITEMS[id].boost).forEach(([k, v]) => { boosts[k] = (boosts[k] || 0) + v; });
  });
  const kits = {
    nano_kit: use('nano_kit') ? state.items.nano_kit : 0,
    repair_kit: use('repair_kit') ? state.items.repair_kit : 0,
  };
  return { boosts, used, kits };
}

// ---------- Raid combat ----------
// A fight is simulated up front as a timeline of events (ms from the start), which
// the client replays live. Every cast has a start and an end, and its effect lands
// exactly at the end, so cast bars and damage numbers line up on screen.
const UNARMED = { id: null, role: 'striker', dtype: 'kinetic', skill: 'kinetic', cast: 1200, action: 'Servo punch', crit: 0.05, spread: 0.1 };
const vary = spread => 1 - spread + Math.random() * 2 * spread;

function fight(raid, pilots) {
  const n = pilots.length;
  const events = [];
  const emit = e => events.push(e);
  const max = Math.round(raid.boss.hp * (1 + G.PARTY_HP_SCALE * (n - 1)));
  const boss = { hp: max, max, attacks: 0, lockUntil: 0, lock: 0, jamUntil: 0, jam: 0, cast: null };
  const burns = [];
  const fs = pilots.map((p, i) => ({
    i, id: p.id, name: p.name, s: p.stats, w: G.WEAPON_BY_ID[p.stats.weapon] || UNARMED,
    hp: p.stats.hp, max: p.stats.hp, down: false, cast: null, kits: { ...p.kits }, used: {}, kitCount: 0,
    dealt: 0, healed: 0, taken: 0,
  }));
  const alive = () => fs.filter(f => !f.down);
  const r = v => Math.max(1, Math.round(v));
  let t = 0;
  let ended = null;

  const damageBoss = (f, amount, dtype, extra) => {
    const locked = t < boss.lockUntil ? 1 + boss.lock : 1;
    const v = r(amount * (raid.res[dtype] || 1) * locked * 100 / (100 + raid.boss.def));
    boss.hp -= v;
    f.dealt += v;
    emit({ t, e: 'hit', a: f.i, tg: 'b', v, ...extra });
    if (boss.hp <= 0 && !ended) ended = { win: true };
  };

  function startCast(f, at) {
    const w = f.w;
    let c;
    if (w.role === 'mechanic') {
      const hurt = alive().sort((x, y) => x.hp / x.max - y.hp / y.max)[0];
      c = hurt && hurt.hp / hurt.max < 0.9
        ? { mode: 'heal', n: w.action, d: w.cast, tg: hurt.i }
        : { mode: 'rivet', n: 'Rivet gun', d: 1000, tg: 'b' };
    } else if (w.role === 'tactician') {
      if (boss.lockUntil < at + 1500) c = { mode: 'lock', n: G.TACTICS.lock.name, d: G.TACTICS.lock.cast, tg: 'b' };
      else if (boss.jamUntil < at + 1500) c = { mode: 'jam', n: G.TACTICS.jam.name, d: G.TACTICS.jam.cast, tg: 'b' };
      else c = { mode: 'pulse', n: w.action, d: w.cast, tg: 'b' };
    } else {
      c = { mode: 'attack', n: w.action, d: w.cast, tg: 'b' };
    }
    f.cast = { ...c, start: at, end: at + c.d };
    emit({ t: at, e: 'cast', a: f.i, n: c.n, d: c.d, tg: c.tg });
  }

  function resolvePilot(f) {
    const c = f.cast;
    const w = f.w;
    const perSec = f.s.atk * c.d / 1000;
    if (c.mode === 'attack') {
      const crit = Math.random() < w.crit;
      const hit = perSec / (1 + w.crit * 0.75) * vary(w.spread) * (crit ? 1.75 : 1);
      if (w.burn) {
        damageBoss(f, hit * (1 - w.burn), w.dtype, crit ? { c: 1 } : {});
        const tick = hit * w.burn / 3;
        for (let k = 1; k <= 3; k++) burns.push({ t: t + k * 1000, f, v: tick });
        burns.sort((x, y) => x.t - y.t);
      } else {
        damageBoss(f, hit, w.dtype, crit ? { c: 1 } : {});
      }
    } else if (c.mode === 'rivet') {
      damageBoss(f, perSec * 0.4 * vary(0.1), 'kinetic', {});
    } else if (c.mode === 'pulse') {
      damageBoss(f, perSec * 0.5 * vary(0.1), 'energy', {});
    } else if (c.mode === 'heal') {
      const target = fs[c.tg].down ? alive().sort((x, y) => x.hp / x.max - y.hp / y.max)[0] : fs[c.tg];
      const v = r(perSec * vary(0.1));
      const eff = Math.min(v, target.max - target.hp);
      target.hp += eff;
      f.healed += eff;
      emit({ t, e: 'hit', a: f.i, tg: target.i, v, k: 'heal' });
    } else if (c.mode === 'lock' || c.mode === 'jam') {
      const tac = G.TACTICS[c.mode];
      boss[c.mode + 'Until'] = t + tac.ms;
      boss[c.mode] = Math.min(0.5, tac.amount * f.s.elec);
      emit({ t, e: 'buff', a: f.i, tg: 'b', n: c.mode === 'lock' ? 'Target locked' : 'Jammed', until: t + tac.ms, pct: Math.round(boss[c.mode] * 100) });
    }
  }

  function startBoss(at) {
    boss.attacks++;
    const sweep = boss.attacks % G.BOSS_MOVES.sweepEvery === 0;
    const targets = alive();
    const target = targets[Math.floor(Math.random() * targets.length)];
    const d = sweep ? G.BOSS_MOVES.sweep : G.BOSS_MOVES.basic;
    boss.cast = { sweep, d, tg: sweep ? 'all' : target.i, start: at, end: at + d };
    emit({ t: at, e: 'cast', a: 'b', n: sweep ? raid.moves.sweep : raid.moves.basic, d, tg: boss.cast.tg });
  }

  function resolveBoss() {
    const c = boss.cast;
    let targets = alive();
    if (!c.sweep) {
      const f = fs[c.tg];
      targets = [f.down ? targets[Math.floor(Math.random() * targets.length)] : f];
    }
    const jam = t < boss.jamUntil ? 1 - boss.jam : 1;
    for (const f of targets) {
      const crit = Math.random() < 0.1;
      const v = r(raid.boss.dps * c.d / 1000 * (c.sweep ? G.BOSS_MOVES.sweepShare : 1) * vary(0.15) * (crit ? 1.5 : 1) * jam * 100 / (100 + f.s.def));
      f.hp -= v;
      f.taken += v;
      emit({ t, e: 'hit', a: 'b', tg: f.i, v, ...(crit ? { c: 1 } : {}) });
      if (f.hp <= 0) {
        f.hp = 0;
        f.down = true;
        f.cast = null;
        emit({ t, e: 'down', tg: f.i });
        continue;
      }
      if (f.hp < f.max * 0.4 && f.kitCount < G.KITS_PER_RAID) {
        const kit = ['nano_kit', 'repair_kit'].find(k => (f.kits[k] || 0) > (f.used[k] || 0));
        if (kit) {
          f.used[kit] = (f.used[kit] || 0) + 1;
          f.kitCount++;
          const heal = Math.min(f.max - f.hp, Math.round(f.max * G.ITEMS[kit].heal));
          f.hp += heal;
          emit({ t, e: 'hit', a: f.i, tg: f.i, v: heal, k: 'kit', n: G.ITEMS[kit].name });
        }
      }
    }
    if (!alive().length) ended = { win: false };
  }

  fs.forEach((f, i) => startCast(f, 200 + i * 180 + Math.floor(Math.random() * 200)));
  startBoss(700);

  while (!ended) {
    // Pick whatever happens next: a pilot's cast landing, the boss's cast, or a burn tick.
    let next = boss.cast.end, who = 'boss';
    for (const f of fs) if (!f.down && f.cast && f.cast.end < next) { next = f.cast.end; who = f; }
    if (burns.length && burns[0].t < next) { next = burns[0].t; who = 'burn'; }
    if (next > G.FIGHT.maxMs) { t = G.FIGHT.maxMs; ended = { win: false, timeout: true }; break; }
    t = next;
    if (who === 'burn') {
      const b = burns.shift();
      damageBoss(b.f, b.v, 'thermal', { k: 'burn' });
    } else if (who === 'boss') {
      resolveBoss();
      if (!ended) startBoss(t + 300);
    } else {
      resolvePilot(who);
      if (!ended) startCast(who, t + 150);
    }
  }
  emit({ t, e: 'end', win: ended.win, timeout: !!ended.timeout });

  return {
    win: ended.win,
    timeout: !!ended.timeout,
    ms: t,
    events,
    bossMax: max,
    fighters: fs.map(f => ({
      id: f.id, name: f.name, role: f.w.role, weapon: f.s.weapon, dtype: f.w.dtype || null,
      max: f.max, hp: f.hp, down: f.down, dealt: f.dealt, healed: f.healed, taken: f.taken, used: f.used,
    })),
  };
}

// players: [{ id, name, colour, state }] already advanced to now. Mutates their states.
function runRaid(raidId, players, now) {
  const raid = G.RAID_BY_ID[raidId];
  if (!raid) fail('Unknown raid.');
  for (const p of players) {
    if ((p.state.items.power_cell || 0) < raid.cells) {
      fail(players.length === 1
        ? `You need ${raid.cells} power cell${raid.cells > 1 ? 's' : ''} to launch this raid.`
        : `${p.name} needs ${raid.cells} power cell${raid.cells > 1 ? 's' : ''} to launch this raid.`);
    }
  }
  const loads = players.map(p => loadout(p.state));
  const result = fight(raid, players.map((p, i) => ({
    id: p.id, name: p.name, stats: stats(p.state, loads[i].boosts), kits: loads[i].kits,
  })));
  const names = players.map(p => p.name);

  const perPlayer = {};
  players.forEach((p, i) => {
    const f = result.fighters[i];
    const s = p.state;
    addItems(s.items, { power_cell: raid.cells }, -1);
    addItems(s.items, f.used, -1);
    loads[i].used.forEach(id => addItems(s.items, { [id]: 1 }, -1));
    const loot = {};
    if (result.win) {
      for (const d of raid.drops) {
        if (d.p && Math.random() >= d.p) continue;
        loot[d.item] = (loot[d.item] || 0) + rollQty(d.qty);
      }
      addItems(s.items, loot);
    }
    const base = result.win ? raid.xp : Math.floor(raid.xp / 4);
    const skill = (G.WEAPON_BY_ID[f.weapon] || UNARMED).skill;
    const xp = { [skill]: base, shielding: Math.round(base * 0.4) };
    Object.entries(xp).forEach(([k, v]) => addXp(s, k, v));
    const entry = { at: now, raid: raid.id, win: result.win, ms: result.ms, party: names, loot, xp, kits: f.used, supplies: loads[i].used, dealt: f.dealt, healed: f.healed };
    s.raidLog.unshift(entry);
    s.raidLog.length = Math.min(s.raidLog.length, 20);
    perPlayer[p.id] = entry;
  });

  return {
    raid: raid.id,
    win: result.win,
    timeout: result.timeout,
    ms: result.ms,
    bossMax: result.bossMax,
    events: result.events,
    fighters: result.fighters.map((f, i) => ({ ...f, colour: players[i].colour, mech: players[i].mech, gear: { ...players[i].state.equipment } })),
    perPlayer,
  };
}

module.exports = {
  GameError, fail, newState, migrate, level, levels, totalLevel, stats, power, loadout,
  hasItems, addItems, advance, startAction, stopAction, equip, unequip, setSupply, fight, runRaid,
};
