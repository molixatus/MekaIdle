'use strict';
// Server-side game rules. Everything that changes a player's state goes through here.
const G = require('../public/data.js');

class GameError extends Error {}
const fail = msg => { throw new GameError(msg); };

const rnd = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const rollQty = q => (Array.isArray(q) ? rnd(q[0], q[1]) : q);

// ---------- State ----------
function newState(now) {
  const skills = {};
  G.SKILLS.forEach(s => { skills[s.id] = { xp: 0 }; });
  const equipment = {};
  G.SLOTS.forEach(s => { equipment[s.id] = null; });
  return { skills, items: {}, equipment, activity: null, lastTick: now, raidLog: [] };
}

// Fill in anything added to the game since this save was written.
function migrate(state, now) {
  const fresh = newState(now);
  return {
    ...fresh,
    ...state,
    skills: { ...fresh.skills, ...state.skills },
    equipment: { ...fresh.equipment, ...state.equipment },
    items: { ...state.items },
    raidLog: Array.isArray(state.raidLog) ? state.raidLog : [],
  };
}

const level = (state, skill) => G.levelFromXp(state.skills[skill].xp);
const totalLevel = state => G.SKILLS.reduce((a, s) => a + level(state, s.id), 0);
const stats = state => G.mechStats(state.equipment, level(state, 'piloting'));
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

// ---------- Equipment ----------
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

// ---------- Raids ----------
// 10% of hits land as criticals for 1.75x, which keeps close fights uncertain.
const hit = (atk, def) => {
  const roll = (0.8 + Math.random() * 0.4) * (Math.random() < 0.1 ? 1.75 : 1);
  return Math.max(1, Math.round(atk * roll * 100 / (100 + def)));
};

// fighters: [{ name, atk, def, hp, kits: { nano_kit, repair_kit } }]
function fight(raid, fighters) {
  const n = fighters.length;
  const boss = { max: Math.round(raid.boss.hp * (1 + G.PARTY_HP_SCALE * (n - 1))) };
  boss.hp = boss.max;
  fighters.forEach(f => { f.max = f.hp; f.down = false; f.used = {}; f.usedCount = 0; f.dealt = 0; });
  const log = [];
  const say = (round, text, kind = '') => log.push({ round, text, kind });
  const marks = [0.75, 0.5, 0.25];

  say(0, n === 1 ? `You power up and walk into the ${raid.name}’s lair alone.` : `A party of ${n} powers up and moves in on the ${raid.name}.`);
  for (let round = 1; round <= G.MAX_ROUNDS; round++) {
    for (const f of fighters) {
      if (f.down) continue;
      const dmg = hit(f.atk, raid.boss.def);
      boss.hp -= dmg;
      f.dealt += dmg;
    }
    if (boss.hp <= 0) {
      say(round, `The ${raid.name} collapses in a shower of sparks.`, 'win');
      return { win: true, rounds: round, log, fighters };
    }
    while (marks.length && boss.hp <= boss.max * marks[0]) {
      say(round, `The ${raid.name} is down to ${Math.round(marks[0] * 100)}% hull.`, 'good');
      marks.shift();
    }

    const alive = fighters.filter(f => !f.down);
    const sweep = round % 4 === 0;
    const targets = sweep ? alive : [alive[Math.floor(Math.random() * alive.length)]];
    if (sweep && n > 1) say(round, `The ${raid.name} sweeps across the whole party.`, 'bad');
    for (const f of targets) {
      const dmg = hit(raid.boss.atk * (sweep ? 0.6 : 1), f.def);
      f.hp -= dmg;
      if (f.hp <= 0) {
        f.hp = 0;
        f.down = true;
        say(round, `${f.name}’s mech goes down.`, 'bad');
        continue;
      }
      if (f.hp < f.max * 0.4 && f.usedCount < G.KITS_PER_RAID) {
        const kit = ['nano_kit', 'repair_kit'].find(k => (f.kits[k] || 0) > (f.used[k] || 0));
        if (kit) {
          f.used[kit] = (f.used[kit] || 0) + 1;
          f.usedCount++;
          f.hp = Math.min(f.max, f.hp + Math.round(f.max * G.ITEMS[kit].heal));
          say(round, `${f.name} patches up with a ${G.ITEMS[kit].name.toLowerCase()}.`);
        }
      }
    }
    if (fighters.every(f => f.down)) {
      say(round, `The ${raid.name} stands over the wreckage. The raid has failed.`, 'lose');
      return { win: false, rounds: round, log, fighters };
    }
  }
  say(G.MAX_ROUNDS, 'Power reserves run dry and the raid pulls back.', 'lose');
  return { win: false, rounds: G.MAX_ROUNDS, log, fighters };
}

// players: [{ id, name, state }] already advanced to now. Mutates their states.
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
  const fighters = players.map(p => ({
    id: p.id, name: p.name, ...stats(p.state),
    kits: { nano_kit: p.state.items.nano_kit || 0, repair_kit: p.state.items.repair_kit || 0 },
  }));
  const result = fight(raid, fighters);
  const names = players.map(p => p.name);

  const perPlayer = {};
  players.forEach((p, i) => {
    const f = fighters[i];
    addItems(p.state.items, { power_cell: raid.cells }, -1);
    addItems(p.state.items, f.used, -1);
    const loot = {};
    if (result.win) {
      for (const d of raid.drops) {
        if (d.p && Math.random() >= d.p) continue;
        loot[d.item] = (loot[d.item] || 0) + rollQty(d.qty);
      }
      addItems(p.state.items, loot);
    }
    const xp = result.win ? raid.xp : Math.floor(raid.xp / 4);
    addXp(p.state, 'piloting', xp);
    const entry = { at: now, raid: raid.id, win: result.win, rounds: result.rounds, party: names, loot, xp, kits: f.used, dealt: f.dealt };
    p.state.raidLog.unshift(entry);
    p.state.raidLog.length = Math.min(p.state.raidLog.length, 20);
    perPlayer[p.id] = entry;
  });

  return {
    raid: raid.id,
    win: result.win,
    rounds: result.rounds,
    log: result.log,
    fighters: fighters.map(f => ({ id: f.id, name: f.name, hp: f.hp, max: f.max, dealt: f.dealt, down: f.down })),
    perPlayer,
  };
}

module.exports = {
  GameError, fail, newState, migrate, level, totalLevel, stats, power,
  hasItems, addItems, advance, startAction, stopAction, equip, unequip, fight, runRaid,
};
