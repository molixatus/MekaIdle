'use strict';

// ---------- Config ----------
const SAVE_KEY = 'mekaidle-save-v1';
const MAX_SKILL = 25;
const QUEUE_MAX = 5;
const OFFLINE_CAP = 12 * 3600; // seconds of offline progress granted
const SAVE_EVERY = 10000; // ms

const SKILLS = [
  { id: 'salvaging', name: 'Salvaging', desc: '+10% scrap income per level.' },
  { id: 'engineering', name: 'Engineering', desc: 'Upgrades cost 3% less per level (up to 60%).' },
  { id: 'power', name: 'Power systems', desc: 'Lets you upgrade the reactor.' },
  { id: 'ballistics', name: 'Ballistics', desc: 'Lets you upgrade the arms.' },
  { id: 'plating', name: 'Plating', desc: 'Lets you upgrade the armour.' },
  { id: 'servos', name: 'Servo control', desc: 'Lets you upgrade the legs.' },
];

const PARTS = [
  { id: 'reactor', name: 'Reactor', skill: 'power', base: 10, growth: 1.55, bonus: 0.5 },
  { id: 'arms', name: 'Arms', skill: 'ballistics', base: 25, growth: 1.6, bonus: 0.35 },
  { id: 'armor', name: 'Armour', skill: 'plating', base: 40, growth: 1.65, bonus: 0.25 },
  { id: 'legs', name: 'Legs', skill: 'servos', base: 60, growth: 1.7, bonus: 0.25 },
];

const skillById = Object.fromEntries(SKILLS.map(s => [s.id, s]));

// ---------- State ----------
function newState() {
  const skills = {};
  SKILLS.forEach(s => { skills[s.id] = { level: 0, xp: 0 }; });
  const parts = {};
  PARTS.forEach(p => { parts[p.id] = 0; });
  return { scrap: 0, totalScrap: 0, skills, parts, queue: [], lastTick: Date.now(), log: [] };
}

function load() {
  const fresh = newState();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fresh;
    const s = JSON.parse(raw);
    return {
      ...fresh,
      ...s,
      skills: { ...fresh.skills, ...s.skills },
      parts: { ...fresh.parts, ...s.parts },
      queue: Array.isArray(s.queue) ? s.queue.filter(id => fresh.skills[id]) : [],
      log: Array.isArray(s.log) ? s.log.slice(0, 5) : [],
    };
  } catch (e) {
    return fresh;
  }
}

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
}

let state = load();

// ---------- Rules ----------
const xpToNext = level => Math.round(30 * Math.pow(1.4, level)); // seconds of training

function scrapRate() {
  let r = 1;
  PARTS.forEach(p => { r *= 1 + p.bonus * state.parts[p.id]; });
  return r * (1 + 0.1 * state.skills.salvaging.level);
}

const costMult = () => Math.max(0.4, 1 - 0.03 * state.skills.engineering.level);
const upgradeCost = p => Math.ceil(p.base * Math.pow(p.growth, state.parts[p.id]) * costMult());
const partUnlocked = p => state.parts[p.id] < state.skills[p.skill].level;
const plannedLevel = id => state.skills[id].level + state.queue.filter(q => q === id).length;

function addLog(msg) {
  state.log.unshift(msg);
  state.log.length = Math.min(state.log.length, 5);
  dirty.log = true;
}

function train(dt) {
  while (dt > 0 && state.queue.length) {
    const id = state.queue[0];
    const s = state.skills[id];
    if (s.level >= MAX_SKILL) { state.queue.shift(); dirty.queue = true; continue; }
    const need = xpToNext(s.level) - s.xp;
    if (dt >= need) {
      dt -= need;
      s.level += 1;
      s.xp = 0;
      state.queue.shift();
      addLog(`${skillById[id].name} reached level ${s.level}.`);
      dirty.queue = dirty.mech = true;
    } else {
      s.xp += dt;
      dt = 0;
    }
  }
}

function advance(seconds) {
  let left = seconds;
  while (left > 0) {
    const step = Math.min(left, 60);
    const gain = scrapRate() * step;
    state.scrap += gain;
    state.totalScrap += gain;
    train(step);
    left -= step;
  }
}

// ---------- Actions ----------
function enqueue(id) {
  if (state.queue.length >= QUEUE_MAX || plannedLevel(id) >= MAX_SKILL) return;
  state.queue.push(id);
  dirty.queue = true;
  save();
}

function dequeue(index) {
  state.queue.splice(index, 1);
  dirty.queue = true;
  save();
}

function upgrade(partId) {
  const p = PARTS.find(x => x.id === partId);
  const cost = upgradeCost(p);
  if (!partUnlocked(p) || state.scrap < cost) return;
  state.scrap -= cost;
  state.parts[p.id] += 1;
  addLog(`${p.name} upgraded to level ${state.parts[p.id]}.`);
  dirty.mech = true;
  save();
}

// ---------- Formatting ----------
function fmt(n) {
  if (n < 10) return n.toFixed(1);
  if (n < 1000) return Math.floor(n).toString();
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
  let i = -1;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  return n.toFixed(n < 100 ? 2 : 1) + units[i];
}

function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const dirty = { queue: true, mech: true, log: true };
const skillEls = {};
const partEls = {};

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  });
  kids.forEach(k => e.append(k));
  return e;
}

function buildSkills() {
  const list = $('skills');
  SKILLS.forEach(s => {
    const lvl = el('span', { class: 'lvl' });
    const fill = el('span');
    const btn = el('button', { type: 'button', onclick: () => enqueue(s.id) });
    list.append(el('li', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, s.name), lvl),
      el('p', {}, s.desc),
      el('div', { class: 'bar', 'aria-hidden': 'true' }, fill),
      btn));
    skillEls[s.id] = { lvl, fill, btn };
  });
}

function buildParts() {
  const list = $('parts');
  PARTS.forEach(p => {
    const lvl = el('span', { class: 'lvl' });
    const info = el('p');
    const btn = el('button', { type: 'button', onclick: () => upgrade(p.id) });
    list.append(el('li', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, p.name), lvl),
      info, btn));
    partEls[p.id] = { lvl, info, btn };
  });
}

let activeEta = null;
function renderQueue() {
  const q = $('queue');
  q.replaceChildren();
  activeEta = null;
  if (!state.queue.length) {
    q.append(el('li', { class: 'empty' }, 'Nothing training. Pick a skill below.'));
    return;
  }
  const seen = {};
  state.queue.forEach((id, i) => {
    seen[id] = (seen[id] || 0) + 1;
    const target = state.skills[id].level + seen[id];
    const eta = el('span', { class: 'eta' });
    const remove = el('button', {
      type: 'button', class: 'ghost small',
      'aria-label': `Remove ${skillById[id].name} ${target} from queue`,
      onclick: () => dequeue(i),
    }, 'Remove');
    q.append(el('li', { class: i === 0 ? 'active' : '' },
      el('span', {}, `${skillById[id].name} ${target}`), eta, remove));
    if (i === 0) activeEta = eta;
    else eta.textContent = fmtTime(xpToNext(target - 1));
  });
}

function renderMech() {
  PARTS.forEach(p => {
    const lvl = state.parts[p.id];
    const g = $('m-' + p.id);
    g.setAttribute('class', `part tier-${Math.min(5, Math.floor(lvl / 5))}`);
    g.querySelectorAll('[data-min]').forEach(n => {
      n.classList.toggle('off', lvl < Number(n.dataset.min));
    });
  });
  const total = PARTS.reduce((a, p) => a + state.parts[p.id], 0);
  $('m-body').setAttribute('class', `part tier-${Math.min(5, Math.floor(total / 20))}`);

  const r = state.parts.reactor;
  const core = $('core');
  core.setAttribute('r', String(6 + Math.min(10, r * 0.6)));
  core.style.opacity = String(r ? 0.45 + 0.55 * Math.min(1, r / 15) : 0.2);
  core.classList.toggle('live', r > 0);

  $('mech-summary').textContent = total
    ? `${total} upgrades fitted across ${PARTS.filter(p => state.parts[p.id]).length} of 4 parts.`
    : 'A bare frame. Train a skill to start upgrading it.';
}

function renderLog() {
  $('log').replaceChildren(...state.log.map(m => el('li', {}, m)));
}

function render() {
  if (dirty.queue) { renderQueue(); dirty.queue = false; }
  if (dirty.mech) { renderMech(); dirty.mech = false; }
  if (dirty.log) { renderLog(); dirty.log = false; }

  $('scrap').textContent = fmt(state.scrap);
  $('rate').textContent = `+${fmt(scrapRate())} per second`;

  const full = state.queue.length >= QUEUE_MAX;
  SKILLS.forEach(s => {
    const { lvl, fill, btn } = skillEls[s.id];
    const sk = state.skills[s.id];
    lvl.textContent = `${sk.level} / ${MAX_SKILL}`;
    fill.style.width = sk.level >= MAX_SKILL ? '100%' : `${(sk.xp / xpToNext(sk.level)) * 100}%`;
    const next = plannedLevel(s.id);
    if (next >= MAX_SKILL) { btn.disabled = true; btn.textContent = 'Fully trained or queued'; }
    else {
      btn.disabled = full;
      btn.textContent = full ? 'Queue full' : `Queue level ${next + 1} (${fmtTime(xpToNext(next))})`;
    }
  });

  PARTS.forEach(p => {
    const { lvl, info, btn } = partEls[p.id];
    const level = state.parts[p.id];
    const cost = upgradeCost(p);
    lvl.textContent = `Level ${level}`;
    if (partUnlocked(p)) {
      info.className = '';
      info.textContent = `×${(1 + p.bonus * level).toFixed(2)} scrap now. Each level adds ${p.bonus * 100}%.`;
      btn.disabled = state.scrap < cost;
      btn.textContent = `Upgrade for ${fmt(cost)} scrap`;
    } else {
      info.className = 'needs';
      info.textContent = `Needs ${skillById[p.skill].name} level ${level + 1}.`;
      btn.disabled = true;
      btn.textContent = `Upgrade for ${fmt(cost)} scrap`;
    }
  });

  if (activeEta && state.queue.length) {
    const s = state.skills[state.queue[0]];
    activeEta.textContent = fmtTime(xpToNext(s.level) - s.xp);
  }
}

// ---------- Loop ----------
function tick() {
  const now = Date.now();
  const dt = Math.min((now - state.lastTick) / 1000, OFFLINE_CAP);
  state.lastTick = now;
  if (dt > 0) advance(dt);
  render();
}

function applyOffline() {
  const away = (Date.now() - state.lastTick) / 1000;
  if (away < 30) return;
  const before = state.scrap;
  const beforeLog = state.log.length ? state.log[0] : null;
  const granted = Math.min(away, OFFLINE_CAP);
  advance(granted);
  state.lastTick = Date.now();
  const levelled = [];
  for (const m of state.log) { if (m === beforeLog) break; levelled.push(m); }
  let text = `While you were away for ${fmtTime(away)} your mech salvaged ${fmt(state.scrap - before)} scrap.`;
  if (levelled.length) text += ` ${levelled.reverse().join(' ')}`;
  if (away > OFFLINE_CAP) text += ` Offline progress is capped at ${OFFLINE_CAP / 3600} hours.`;
  $('notice-text').textContent = text;
  $('notice').hidden = false;
}

function init() {
  buildSkills();
  buildParts();
  applyOffline();
  $('notice-close').addEventListener('click', () => { $('notice').hidden = true; });
  $('wipe').addEventListener('click', () => {
    if (!confirm('Wipe your save and start again? This cannot be undone.')) return;
    state = newState();
    dirty.queue = dirty.mech = dirty.log = true;
    save();
    render();
  });
  render();
  setInterval(tick, 200);
  setInterval(save, SAVE_EVERY);
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
}

init();
