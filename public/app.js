'use strict';
(function () {
  const G = window.GAME;
  const I = window.ICONS;
  const POLL_MS = 3000;
  const PAGE_KEY = 'mekaidle-page';

  // ---------- Utilities ----------
  const $ = id => document.getElementById(id);

  // Builds an element. `html` is only ever used for our own icon and sprite markup.
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
    return e;
  }
  // game-icons.net shapes, filled with a colour (or the text colour). Markup is built from our
  // own icon data and colours only.
  const GI = window.GAME_ICONS;
  const giSvg = (name, colour) => `<svg viewBox="0 0 512 512" focusable="false"><path fill="${colour || 'currentColor'}" d="${GI[name] || ''}"/></svg>`;
  const gi = (name, colour, cls = '') => h('span', { class: `ico gi ${cls}`, 'aria-hidden': 'true', html: giSvg(name, colour) });
  // Skill and navigation icons come from game-icons; small controls keep the line icons.
  const ui = (name, cls = '') => {
    const key = GI['sk_' + name] ? 'sk_' + name : GI['nav_' + name] ? 'nav_' + name : GI[name] ? name : null;
    return key ? gi(key, null, cls) : h('span', { class: `ico ${cls}`, 'aria-hidden': 'true', html: I.ui(name) });
  };
  // Item icons come from the pixel-art sheet (itemsheet.js); anything unmapped falls back to game-icons.
  const SHEET = window.ITEM_SHEET;
  const itemIco = (id, cls = '') => {
    const it = G.ITEMS[id];
    if (!it) return gi('ore', '#5d6575', cls);
    const cell = SHEET && SHEET.map[id];
    if (!cell) return gi(it.icon, it.colour, `${cls}${it.rare ? ' rare' : ''}`);
    const [r, c, hue] = cell;
    // The sheet is drawn larger than the box and offset so only the inside of the cell shows: a
    // margin of each cell is cut off, which hides stray pixels from neighbouring icons.
    const m = 0.08, k = 1 / (1 - 2 * m);
    const inner = h('span', { class: 'item-sprite-img' });
    inner.style.backgroundImage = `url(${SHEET.src})`;
    inner.style.width = `${SHEET.cols * k * 100}%`;
    inner.style.height = `${SHEET.rows * k * 100}%`;
    inner.style.left = `${-(c + m) * k * 100}%`;
    inner.style.top = `${-(r + m) * k * 100}%`;
    if (hue) inner.style.filter = `hue-rotate(${hue}deg)`;
    // Rare gear and tier 7+ gear shine: a light sweep drawn only on the item's own pixels (masked by
    // the same sheet cell), gold for rare gear, tinted with the tier colour otherwise.
    // Raid materials shine too, in their tier colour.
    const shiny = (it.type === 'gear' && (it.rare || (it.tier || 0) >= 7)) || it.type === 'material';
    const box = h('span', { class: `ico item-sprite ${cls}${it.rare ? ' rare' : ''}${shiny ? ' shiny' : ''}`, 'aria-hidden': 'true' }, inner);
    // A layer drawn only on the item's own pixels (masked by the same sheet cell).
    const layer = klass => {
      const el = h('span', { class: klass });
      ['width', 'height', 'left', 'top'].forEach(p => { el.style[p] = inner.style[p]; });
      el.style.maskImage = el.style.webkitMaskImage = `url(${SHEET.src})`;
      return el;
    };
    // Crafted gear and gathered or crafted materials take their tier's colour, strongly enough to
    // tell tiers apart while keeping some of the sprite's own accents (varied a little per item).
    if (!it.rare && it.tier && (it.type === 'gear' || it.type === 'resource')) {
      const tint = layer('item-tint');
      let hash = 0;
      for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
      tint.style.backgroundColor = it.colour;
      tint.style.opacity = String(0.42 + (hash % 20) / 100);
      box.append(tint);
    }
    if (shiny) {
      const shineEl = layer('item-shine');
      shineEl.style.setProperty('--shine', it.rare ? '#ffd86b' : it.colour);
      box.append(shineEl);
    }
    return box;
  };
  // Item names are coloured by the item's tier.
  const itemName = (id, tag = 'span') => {
    const it = G.ITEMS[id];
    const e = h(tag, { class: `iname${it && it.rare ? ' rare-name' : ''}` }, it ? it.name : id);
    if (it) e.style.color = it.colour;
    return e;
  };
  const classIco = (cls, sz = 'sm') => gi('sk_' + G.CLASSES[cls].skill, G.CLASSES[cls].colour, sz);

  function fmt(n) {
    n = Math.floor(n);
    if (n < 10000) return n.toLocaleString('en-GB');
    const units = ['K', 'M', 'B', 'T'];
    let i = -1;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    return (n < 100 ? n.toFixed(1) : Math.floor(n)) + units[i];
  }
  // Exact below a million, then compact (12.4M, 3.1B, 1.2T), since high tiers hit very large numbers.
  const num = n => (Math.abs(n) < 1e6 ? Math.floor(n).toLocaleString('en-GB') : fmt(n));
  function fmtTime(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    if (hh) return `${hh}h ${mm}m`;
    if (mm) return `${mm}m ${ss}s`;
    return `${ss}s`;
  }
  function ago(t) {
    const s = (now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  const secs = ms => (ms / 1000).toFixed(1) + 's';
  const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
  const pct = v => `${Math.round(v * 1000) / 10}%`;

  // Display settings, kept in this browser.
  const SETTINGS_KEY = 'mekaidle-settings';
  const SETTINGS = { floats: true, groupFloats: true, flashes: true, auras: true, shine: true, motion: true };
  try { Object.assign(SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* defaults */ }
  function applySettings() {
    document.body.classList.toggle('no-motion', !SETTINGS.motion);
    document.body.classList.toggle('no-shine', !SETTINGS.shine);
    document.body.classList.toggle('no-auras', !SETTINGS.auras);
  }
  applySettings();
  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  // ---------- Save backups ----------
  // The server can be wiped by an update, so this browser keeps a signed copy of each pilot's save
  // and hands it back when the server no longer knows the pilot.
  const backupKey = name => 'mekaidle-save:' + String(name).toLowerCase();
  async function saveBackup() {
    if (!me) return;
    try {
      const r = await api('/api/backup');
      if (r.backup) store(backupKey(me.player.name), r.backup);
    } catch (e) { /* try again later */ }
  }
  // After anything you do, the browser's copy is refreshed shortly, so a redeploy right after
  // starting a skill or raid doesn't lose it.
  let backupSoonTimer = null;
  function backupSoon() {
    clearTimeout(backupSoonTimer);
    backupSoonTimer = setTimeout(saveBackup, 1500);
  }
  async function restoreFromBrowser(name, password) {
    const backup = store(backupKey(name));
    if (!backup) return false;
    try {
      const res = await fetch('/api/restore', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backup, password }) });
      return res.ok;
    } catch (e) { return false; }
  }

  async function api(path, body, retried) {
    const opts = body === undefined
      ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    let res;
    try { res = await fetch(path, opts); } catch (e) { throw new Error('Can’t reach the server. Check your connection.'); }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (res.status === 409 && data.restore && !retried) {
      if (await restoreFromBrowser(data.name)) return api(path, body, true);
      showAuth();
      throw new Error('This pilot isn\u2019t on the server any more, and this browser has no backup of it.');
    }
    if (res.status === 401 && !path.startsWith('/api/login')) { showAuth(); throw new Error(data.error || 'Please log in.'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // Runs an API call, shows any error as a toast, and applies a returned state.
  async function act(path, body, okMsg) {
    try {
      const r = await api(path, body);
      if (r.state) setState(r.state);
      if (r.message || okMsg) toast(r.message || okMsg);
      backupSoon();
      return r;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    }
  }

  function toast(text, kind = '', button) {
    const t = h('div', { class: `toast ${kind}` }, h('span', {}, text),
      button ? h('button', { type: 'button', class: 'btn small', onclick: () => { t.remove(); button.onclick(); } }, button.label) : null);
    $('toasts').append(t);
    setTimeout(() => t.remove(), button ? 12000 : kind === 'error' ? 5000 : 3500);
  }

  // A collapsible section whose open state is remembered per browser.
  function collapsible(key, title, note, body, openByDefault = true) {
    const saved = store('mekaidle-open-' + key);
    const open = saved == null ? openByDefault : saved === '1';
    const det = h('details', { class: 'fold', open: open || null }, h('summary', {}, h('span', { class: 'fold-title' }, title), note ? h('span', { class: 'fold-note' }, note) : null), body);
    det.addEventListener('toggle', () => {
      store('mekaidle-open-' + key, det.open ? '1' : '0');
      // Animate only when the player opens it, not when the page is rebuilt with it open.
      if (det.open) { det.classList.add('opening'); setTimeout(() => det.classList.remove('opening'), 300); }
    });
    return det;
  }

  // Hover tooltips. One delegated listener, so tooltips keep working when a live page re-renders
  // under a still mouse, and never get stuck on an element that has been replaced.
  const tips = new WeakMap();
  function tip(el, build) {
    tips.set(el, build);
    el.classList.add('has-tip');
    return el;
  }
  let tipFor = null;
  function placeTip(e) {
    const t = $('tooltip');
    const pad = 14;
    const r = t.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = Math.max(8, e.clientX - r.width - pad);
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, e.clientY - r.height - pad);
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }
  document.addEventListener('mousemove', e => {
    const el = e.target.closest && e.target.closest('.has-tip');
    const t = $('tooltip');
    if (!el || !tips.has(el)) { if (!t.hidden) t.hidden = true; tipFor = null; return; }
    if (tipFor !== el) {
      tipFor = el;
      t.replaceChildren(...[].concat(tips.get(el)()).filter(Boolean));
      t.hidden = false;
    }
    placeTip(e);
  });
  document.addEventListener('scroll', () => { $('tooltip').hidden = true; tipFor = null; }, true);
  // What an item is, for tooltips: name, kind, stats and description.
  function itemTip(id, extra) {
    const it = G.ITEMS[id];
    if (!it) return [];
    if (it.type === 'gear') return gearTip(id, extra);
    const kind = it.slot ? (G.SLOTS.find(s => s.id === it.slot) || {}).name : { resource: 'Resource', material: 'Raid material', consumable: 'Consumable' }[it.type];
    return [
      h('div', { class: 'tip-head' }, itemIco(id, 'md'), h('div', {}, itemName(id, 'b'), h('small', {}, `${it.rare ? 'Rare ' : ''}${kind}${it.tier ? ` · tier ${it.tier}` : ''} · ${num(have(id))} owned`))),
      it.type === 'gear' ? statsLine(it) : null,
      it.boost || it.potion ? h('div', { class: 'stats-line left' }, it.cls ? classChip(it.cls) : null,
        h('span', { class: it.potion ? 'stat-hp' : 'stat-atk' }, it.boost ? G.describe(it.boost) : it.potion === 'hp' ? `Restores ${Math.round(it.heal * 100)}% HP` : `Restores ${it.mana} mana`)) : null,
      it.passives ? h('ul', { class: 'passive-list' }, passiveText(it.passives).map(p => h('li', {}, p))) : null,
      h('p', { class: 'tip-desc' }, it.desc),
      extra || null,
    ];
  }

  // Gear hover card: name and type pill, slot and tier, one stat per line, description, set bonuses
  // (with how many pieces you have fitted), and where it comes from.
  function gearTip(id, extra) {
    const it = G.ITEMS[id];
    const slot = (G.SLOTS.find(s => s.id === it.slot) || {}).name || 'Gear';
    const eq = me ? me.state.equipment : {};
    const w = it.slot === 'weapon' ? G.WEAPON_BY_ID[it.weapon] : null;
    const pillText = it.armour ? G.ARMOUR_TYPES[it.armour].name : it.set ? 'Raid set' : w ? `${G.CLASSES[it.cls].name}${it.twoHanded ? ' · two-handed' : ''}`
      : it.slot === 'offhand' ? `${G.CLASSES[it.cls].name} off-hand` : it.rare ? 'Raid gear' : slot;
    const pill = h('span', { class: 'tip-pill' }, pillText);
    pill.style.setProperty('--pill', it.cls && !it.armour ? G.CLASSES[it.cls].colour : it.colour);
    const st = it.stats || {};
    const lines = STAT_ORDER.filter(k => st[k] && G.STATS[k]).map(k => h('li', { class: k === 'atk' && it.cls === 'healer' ? 'stat-hp' : statClass(k) },
      k === 'atk' && it.cls === 'healer' ? `+${st[k]} healing/s` : G.STATS[k].fmt(st[k])));
    if (w) lines.unshift(h('li', { class: 'stat-muted' }, `${secs(w.cast)} per hit`));
    passiveText(it.passives).forEach(p => lines.push(h('li', { class: 'stat-passive' }, p)));
    const bonusLine = (have, need, name, text) => h('li', { class: have >= need ? 'on' : '' }, `Set bonus (${Math.min(have, need)}/${need}): `, h('b', {}, name), text ? ` (${text})` : '');
    const bonuses = [];
    if (it.armour) {
      const a = G.ARMOUR_TYPES[it.armour];
      const n = G.SLOTS.filter(s => G.ITEMS[eq[s.id]] && G.ITEMS[eq[s.id]].armour === it.armour).length;
      bonuses.push(bonusLine(n, 3, a.bonus3.name, G.describe(a.bonus3)), bonusLine(n, 5, a.bonus5.name, G.describe(a.bonus5)));
    }
    if (it.set) {
      const set = G.SET_BY_ID[it.set];
      const n = G.SLOTS.filter(s => G.ITEMS[eq[s.id]] && G.ITEMS[eq[s.id]].set === it.set).length;
      bonuses.push(bonusLine(n, 2, set.name, G.describe(set.two)), bonusLine(n, 3, set.name, passiveText(set.three.passives).join(' ')));
    }
    const craft = G.ACTIONS.find(a => a.outputs[id]);
    const raids = craft ? [] : G.RAIDS.filter(r => r.drops.some(d => d.item === id));
    const foot = craft ? `${G.SKILL_BY_ID[craft.skill].name} level ${craft.level} · ${Object.entries(craft.inputs).map(([i, q]) => `${q} ${G.ITEMS[i] ? G.ITEMS[i].name : i}`).join(', ')}`
      : raids.length ? `Drops from ${raids.length === 1 ? `#${raids[0].n} ${raids[0].name}` : `${raids.length} raids`} in ${[...new Set(raids.map(r => r.regionName))].slice(0, 2).join(', ')}` : null;
    const showDesc = it.desc && !(it.armour && !it.set);
    return [
      h('div', { class: 'tip-head gear-tip-head' }, itemIco(id, 'md'), h('div', { class: 'grow' }, itemName(id, 'b'),
        h('small', {}, `${slot} · tier ${it.tier || 0}${me ? ` · ${num(have(id))} owned` : ''}`)), pill),
      lines.length ? h('ul', { class: 'tip-stats' }, lines) : null,
      showDesc ? h('p', { class: 'tip-desc' }, it.desc) : null,
      bonuses.length ? h('ul', { class: 'tip-sets' }, bonuses) : null,
      foot ? h('p', { class: 'tip-foot' }, foot) : null,
      extra || null,
    ];
  }

  // ---------- Session state ----------
  let me = null;      // latest /api/me payload
  let offset = 0;     // server clock minus local clock
  let page = store(PAGE_KEY) || 'skill:mining';
  let pollTimer = null;
  let polls = 0;
  let pageRefresh = null; // refresh hook for pages that load their own data
  let pageTick = null;    // called after every poll while its page is open
  let pageCleanup = null; // called when leaving the page

  const now = () => Date.now() + offset;
  const lvl = skill => G.levelFromXp(me.state.skills[skill].xp);
  const have = id => me.state.items[id] || 0;
  const myLevels = () => Object.fromEntries(G.SKILLS.map(s => [s.id, lvl(s.id)]));
  const myClass = () => { const it = G.ITEMS[me.state.equipment.weapon]; return it ? it.cls : 'melee'; };
  const classColour = eq => { const it = G.ITEMS[eq.weapon]; return it ? G.CLASSES[it.cls].colour : G.UNARMED_COLOUR; };
  const mySubclass = (cls = myClass()) => G.resolveSubclass(me.state.subclasses, me.state.multi, cls);
  const myStats = () => G.mechStats(me.state.equipment, myLevels(), { subclass: mySubclass() });
  const myCombat = () => G.combatLevel(myLevels());
  const raiding = () => !!(me && me.state.activity && me.state.activity.type);

  // Level, progress through the level, and XP still needed, for one skill.
  function xpInfo(skill) {
    const xp = me.state.skills[skill].xp;
    const level = G.levelFromXp(xp);
    const max = level >= G.MAX_LEVEL;
    const from = G.xpForLevel(level), to = G.xpForLevel(level + 1);
    return { xp, level, max, from, to, toGo: max ? 0 : to - xp, pct: max ? 100 : ((xp - from) / (to - from)) * 100 };
  }

  function setState(state) {
    const before = me.state;
    me.state = state;
    offset = state.lastTick - Date.now();
    renderChrome();
    if (isLivePage()) refreshPage();
    celebrate(before, state);
  }

  const skillAct = () => (me && me.state.activity && !me.state.activity.type ? me.state.activity : me && me.state.side) || null;
  function skillProgress() {
    const a = skillAct();
    const action = a && G.ACTION_BY_ID[a.id];
    if (!action) return null;
    const t = a.progress + (now() - me.state.lastTick);
    return { a, action, frac: Math.min(1, (t % action.time) / action.time) };
  }
  function activityProgress() {
    const a = me && me.state.activity;
    if (!a) return null;
    if (a.type) return a.ms ? { frac: Math.max(0, Math.min(1, (now() - a.start) / a.ms)) } : null;
    const action = G.ACTION_BY_ID[a.id];
    if (!action) return null;
    const t = a.progress + (now() - me.state.lastTick);
    return { action, frac: Math.min(1, (t % action.time) / action.time) };
  }

  // ---------- Mech art ----------
  // Pixel-art mech for a set of fitted gear. Its colour follows the main weapon's class.
  // Sprite markup is generated locally from game data (colours and ids only), never player text.
  function mechArt(equipment = {}, label = 'Mech') {
    const piece = slot => {
      const it = G.ITEMS[equipment[slot]];
      return it && it.armour ? { type: it.armour, colour: it.colour, tier: it.tier, rare: !!it.rare } : null;
    };
    const weapon = G.ITEMS[equipment.weapon];
    const off = G.ITEMS[equipment.offhand];
    const trinket = G.ITEMS[equipment.trinket];
    const cls = weapon ? G.CLASSES[weapon.cls] : null;
    const el = h('span', { class: 'sprite mech-sprite', role: 'img', 'aria-label': label, html: window.SPRITES.mech({
      paint: cls ? cls.colour : G.UNARMED_COLOUR, accent: cls ? cls.accent : '#8cff5a', head: piece('head'), body: piece('body'), legs: piece('legs'),
      hands: piece('hands'), feet: piece('feet'), weapon: weapon ? weapon.weapon : null, role: weapon ? weapon.cls : null, weaponColour: weapon ? weapon.colour : null,
      offhand: off ? off.offhand : null, offhandColour: off ? off.colour : null, core: trinket ? trinket.colour : null,
    }) });
    el.firstElementChild.removeAttribute('role');
    el.firstElementChild.setAttribute('aria-hidden', 'true');
    return el;
  }

  // Enemy sprites: each foe's game-icons silhouette rasterised onto a small grid and drawn as
  // shaded pixel art with an outline, so enemies match the mech's 8-bit look.
  const spriteCache = new Map();
  function foeColour(foe, boss) {
    const hue = (foe * 47) % 360;
    return boss ? `hsl(${hue}, 55%, 58%)` : `hsl(${hue}, 35%, 55%)`;
  }
  function hslToHex(str) {
    const [hh, ss, ll] = str.match(/[\d.]+/g).map(Number);
    const s = ss / 100, l = ll / 100;
    const k = n => (n + hh / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function foeSprite(foe, boss, size = 40) {
    const key = `${foe}:${boss ? 1 : 0}:${size}`;
    if (spriteCache.has(key)) return spriteCache.get(key);
    const pad = 2, n = size + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.scale(size / 512, size / 512);
    ctx.fill(new Path2D(GI['foe_' + foe] || ''));
    const data = ctx.getImageData(0, 0, size, size).data;
    const on = (x, y) => x >= pad && y >= pad && x < size + pad && y < size + pad && data[((y - pad) * size + (x - pad)) * 4 + 3] > 110;
    const base = window.SPRITES.mix(hslToHex(foeColour(foe, boss)), 0);
    const light = window.SPRITES.mix(base, 0.35), dark = window.SPRITES.mix(base, -0.35);
    let rects = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let c = null;
        if (on(x, y)) c = !on(x, y - 1) || !on(x - 1, y) ? light : !on(x, y + 1) || !on(x + 1, y) ? dark : base;
        else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) c = '#07080c';
        if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
      }
    }
    const svg = `<svg viewBox="0 0 ${n} ${n}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
    spriteCache.set(key, svg);
    return svg;
  }
  // Enemy sprites from the monster sheet (public/monsters.png, 12 x 16 cells of 48 x 72, made
  // transparent from the supplied sheet). Index in G.FOES -> [row, col]. The mech enemies have no
  // match and keep their game-icons sprites.
  const MONSTERS = { src: 'monsters.png', cols: 12, rows: 16, map: {
    0: [1, 8], 1: [3, 11], 2: [0, 7], 3: [3, 0], 4: [0, 0], 5: [3, 5], 6: [7, 4], 7: [0, 8], 8: [14, 1], 9: [4, 9],
    10: [6, 11], 11: [0, 4], 12: [7, 2], 13: [1, 9], 14: [9, 9], 15: [11, 5], 16: [10, 4], 17: [2, 6], 18: [11, 6], 19: [8, 11],
    20: [12, 8], 21: [2, 10], 22: [2, 9], 23: [8, 10], 24: [1, 2], 25: [10, 7], 26: [2, 11], 27: [8, 7], 28: [10, 5], 29: [4, 0],
    30: [14, 6], 31: [9, 3], 32: [1, 5], 33: [7, 0], 34: [14, 0], 35: [1, 0], 36: [9, 7], 37: [4, 7], 38: [5, 11], 39: [9, 0],
    40: [0, 5], 41: [6, 4], 42: [6, 1], 43: [1, 1], 44: [7, 6], 47: [5, 1], 48: [15, 0], 49: [4, 8], 50: [12, 7], 51: [2, 7],
    52: [2, 8], 53: [5, 4], 54: [14, 3], 55: [2, 5], 56: [4, 4], 57: [9, 1], 58: [13, 8], 59: [13, 10], 60: [10, 8], 61: [11, 8],
    62: [6, 10], 63: [10, 0], 64: [5, 6], 65: [10, 9],
  } };
  // `foe` is an index in G.FOES, or { sprite: [row, col], hue } for a raid boss.
  function foeArt(foe, boss, cls = '', size) {
    const cell = typeof foe === 'object' && foe.sprite ? foe.sprite : MONSTERS.map[foe];
    const hue = typeof foe === 'object' ? foe.hue : 0;
    const box = cell && window.MONSTER_BOXES && window.MONSTER_BOXES[cell[0] * MONSTERS.cols + cell[1]];
    if (box) {
      // Scale the monster so its own outline (not its cell) fills the space: bosses 150px, enemies
      // in a fight 96px, small portraits 36px.
      const [bx, by, bw, bh] = box;
      const target = size === 48 ? 150 : size === 32 ? 96 : size || 36;
      const sc = target / Math.max(bw, bh);
      const el = h('span', { class: `sprite foe-sprite mon-sprite${boss ? ' boss-art' : ''} ${cls}`, 'aria-hidden': 'true' });
      el.style.width = `${Math.round(bw * sc)}px`;
      el.style.height = `${Math.round(bh * sc)}px`;
      el.style.backgroundImage = `url(${MONSTERS.src})`;
      el.style.backgroundSize = `${576 * sc}px ${1152 * sc}px`;
      el.style.backgroundPosition = `${-bx * sc}px ${-by * sc}px`;
      if (hue) el.style.filter = `hue-rotate(${hue}deg)`;
      return el;
    }
    return h('span', { class: `sprite foe-sprite${boss ? ' boss-art' : ''} ${cls}`, 'aria-hidden': 'true', html: foeSprite(foe, boss, size) });
  }
  // Raid list portraits use the plain icon in the boss's colour.
  const bossIcon = (raid, cls = '', px) => (raid.sprite ? foeArt({ sprite: raid.sprite, hue: raid.spriteHue }, false, `boss-ico-mon ${cls}`, px) : MONSTERS.map[raid.foe] ? foeArt(raid.foe, false, `boss-ico-mon ${cls}`, px) : gi(`foe_${raid.foe}`, hslToHex(foeColour(raid.foe, true)), `boss-ico-svg ${cls}`));

  // ---------- Auth ----------
  function showAuth() {
    clearInterval(pollTimer);
    me = null;
    $('app').hidden = true;
    $('auth').hidden = false;
    closeModal();
  }

  function setupAuth() {
    // Warn before anyone makes an account the server can't keep.
    api('/api/health').then(h0 => { $('auth-storage').hidden = !!h0.persistentStorage; }).catch(() => {});
    const tabs = { create: $('tab-create'), login: $('tab-login') };
    const forms = { create: $('form-create'), login: $('form-login') };
    const pick = which => {
      Object.keys(tabs).forEach(k => {
        tabs[k].setAttribute('aria-selected', String(k === which));
        forms[k].hidden = k !== which;
      });
    };
    tabs.create.addEventListener('click', () => pick('create'));
    tabs.login.addEventListener('click', () => pick('login'));
    if (store('mekaidle-has-account')) pick('login');
    $('create-preview').replaceChildren(mechArt({}, 'Your mech'));

    forms.create.addEventListener('submit', async e => {
      e.preventDefault();
      const f = forms.create;
      $('create-error').textContent = '';
      try {
        await api('/api/register', { name: f.name.value, password: f.password.value, mech: f.mech.value });
        store('mekaidle-has-account', '1');
        f.reset();
        await boot();
      } catch (err) { $('create-error').textContent = err.message; }
    });
    forms.login.addEventListener('submit', async e => {
      e.preventDefault();
      const f = forms.login;
      $('login-error').textContent = '';
      try {
        try {
          await api('/api/login', { name: f.name.value, password: f.password.value });
        } catch (err) {
          if (!(await restoreFromBrowser(f.name.value.trim(), f.password.value))) throw err;
        }
        store('mekaidle-has-account', '1');
        f.password.value = '';
        await boot();
      } catch (err) { $('login-error').textContent = err.message; }
    });
  }

  // ---------- Boot and polling ----------
  async function boot() {
    let data;
    try { data = await api('/api/me'); } catch (e) { showAuth(); return; }
    me = data;
    offset = data.now - Date.now();
    $('auth').hidden = true;
    $('app').hidden = false;
    buildChrome();
    renderChrome();
    go(page);
    if (data.away) showAway(data.away);
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, POLL_MS);
    saveBackup();
    clearInterval(backupTimer);
    backupTimer = setInterval(saveBackup, 15000);
  }
  let backupTimer = null;
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveBackup(); });

  // Shows what just changed: "+1 Copper ore" rising from the card at work, and level-ups.
  function celebrate(before, after) {
    if (!before || !after || document.hidden) return;
    const a = after.activity;
    const action = a && !a.type && G.ACTION_BY_ID[a.id];
    if (action) {
      const art = document.querySelector('.card.action.active .card-art');
      const ids = [...Object.keys(action.outputs), ...action.chance.map(c => c.item)];
      // One pop-up per update, a line for each gain, so they never overlap.
      const lines = [];
      ids.forEach(id => {
        const gain = (after.items[id] || 0) - (before.items[id] || 0);
        if (gain > 0) lines.push(h('span', { class: 'gain-line' }, itemIco(id, 'sm'), `+${num(gain)} ${G.ITEMS[id].name}`));
      });
      const xp = after.skills[action.skill].xp - before.skills[action.skill].xp;
      if (xp > 0) lines.push(h('span', { class: 'gain-line xp' }, `+${num(xp)} XP`));
      if (art && lines.length) {
        art.querySelectorAll('.gain-float').forEach(old => old.remove());
        const f = h('span', { class: 'gain-float' }, lines);
        art.append(f);
        setTimeout(() => f.remove(), 2000);
      }
    }
    G.SKILLS.forEach(sk => {
      const was = G.levelFromXp(before.skills[sk.id].xp), is = G.levelFromXp(after.skills[sk.id].xp);
      if (is <= was) return;
      toast(`${sk.name} is now level ${is}!`, 'levelup');
      const ref = navRefs['skill:' + sk.id];
      if (ref) { ref.btn.classList.remove('levelup'); void ref.btn.offsetWidth; ref.btn.classList.add('levelup'); }
    });
  }

  async function poll() {
    if (!me || document.hidden) return;
    try {
      const data = await api('/api/me');
      const before = me && me.state;
      me = data;
      offset = data.now - Date.now();
      renderChrome();
      if (isLivePage()) refreshPage();
      else if (pageRefresh && ++polls % 2 === 0) pageRefresh();
      try { celebrate(before, data.state); } catch (err) { console.error(err); }
      if (pageTick) pageTick();
    } catch (e) { /* keep polling; errors surface on actions */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && me) poll(); });

  function showAway(g) {
    const rows = [];
    Object.entries(g.xp).forEach(([s, xp]) => {
      const sk = G.SKILL_BY_ID[s];
      if (sk) rows.push(h('div', { class: 'gain' }, ui(s, 'md skill-' + s), h('span', { class: 'grow' }, sk.name), h('b', { class: 'plus' }, `+${num(xp)} XP`)));
    });
    Object.entries(g.items).forEach(([id, n]) => {
      if (!G.ITEMS[id]) return;
      rows.push(h('div', { class: 'gain' }, itemIco(id, 'md'), h('span', { class: 'grow' }, itemName(id)), h('b', { class: n < 0 ? 'minus' : 'plus' }, `${n > 0 ? '+' : ''}${num(n)}`)));
    });
    const capped = g.ms > G.OFFLINE_CAP;
    openModal(
      h('h2', { id: 'modal-title' }, 'Welcome back'),
      h('p', { class: 'muted' }, `You were away for ${fmtTime(g.ms)}.${capped ? ` Offline progress is capped at ${G.OFFLINE_CAP / 3600000} hours.` : ''}`),
      g.fights ? h('p', {}, `Your mech fought ${plural(g.fights, 'raid')} and won ${num(g.wins)}.`) : null,
      h('div', { class: 'gains' }, rows),
    );
  }

  // ---------- Modal ----------
  let lastFocus = null;
  function openModal(...content) {
    lastFocus = document.activeElement;
    $('modal-body').replaceChildren(...content.filter(Boolean));
    $('modal').hidden = false;
    $('modal-close').focus();
  }
  function closeModal() {
    $('modal').hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ---------- Chrome: sidebar ----------
  const skillNav = group => G.SKILLS.filter(s => s.group === group).map(s => ({ id: 'skill:' + s.id, name: s.name, icon: s.id, skill: s.id }));
  const NAV = [
    { title: 'Mech', items: [
      { id: 'raids', name: 'Raids', icon: 'raids' },
      { id: 'fights', name: 'Recent fights', icon: 'fights' },
      { id: 'equipment', name: 'Equipment', icon: 'equipment' },
      { id: 'inventory', name: 'Inventory', icon: 'inventory' },
      { id: 'abilities', name: 'Abilities', icon: 'abilities' },
      { id: 'subclass', name: 'Subclasses', icon: 'subclass' },
    ] },
    { title: 'Combat skills', items: skillNav('combat') },
    { title: 'Gathering', items: skillNav('gathering') },
    { title: 'Artisan', items: skillNav('artisan') },
    { title: 'Pilot', items: [
      { id: 'trade', name: 'Trade', icon: 'trade', alert: 'trades' },
      { id: 'guild', name: 'Guild', icon: 'guild' },
      { id: 'social', name: 'Social', icon: 'social', alert: 'friends' },
      { id: 'patch', name: 'Patch notes', icon: 'patch' },
    ] },
  ];
  const navRefs = {};

  function buildChrome() {
    const nav = $('nav');
    nav.replaceChildren();
    NAV.forEach(group => {
      const g = h('div', { class: 'nav-group' }, h('h2', {}, group.title));
      group.items.forEach(item => {
        const right = h('span', { class: 'lvl' });
        const spin = h('span', { class: 'spinner', hidden: true, 'aria-label': 'Active' });
        const fill = item.skill ? h('span') : null;
        const btn = h('button', { type: 'button', class: `nav-item${item.skill ? ' has-bar' : ''}`, onclick: () => { go(item.id); closeMenu(); } },
          ui(item.icon, item.skill ? 'skill-' + item.skill : ''),
          h('span', { class: 'label' }, item.name, spin),
          right,
          item.skill ? h('span', { class: 'nav-bar', 'aria-hidden': 'true' }, fill) : null);
        navRefs[item.id] = { btn, right, spin, item, fill };
        g.append(btn);
      });
      nav.append(g);
    });
    $('logout').replaceChildren(ui('logout'), h('span', { class: 'label' }, 'Log out'));
    $('credits-link').replaceChildren(ui('credits'), h('span', { class: 'label' }, 'Credits'));
    $('settings-link').replaceChildren(ui('settings'), h('span', { class: 'label' }, 'Settings'));
    $('settings-link').onclick = () => { go('settings'); closeMenu(); };
    $('credits-link').onclick = () => { go('credits'); closeMenu(); };
    $('menu-btn').replaceChildren(ui('menu'));
    $('modal-close').replaceChildren(ui('close'));
  }

  function activityText() {
    const a = me.state.activity;
    if (!a) return 'Idle';
    if (a.type) {
      const raid = G.RAID_BY_ID[a.raid];
      return raid ? `${a.type === 'party' ? 'Party raid' : 'Raiding'}: ${raid.name}${a.diff && a.diff !== 'normal' ? ` (${G.DIFF_BY_ID[a.diff].name})` : ''} · fight ${a.n || 1}` : 'Raiding';
    }
    const action = G.ACTION_BY_ID[a.id];
    return action ? `${G.SKILL_BY_ID[action.skill].name}: ${action.name}${a.left ? ` · ${num(a.left)} left` : ''}` : 'Idle';
  }

  function renderChrome() {
    if (!me) return;
    const act0 = me.state.activity;
    const activeSkill = !act0 ? null : act0.type ? G.CLASSES[myClass()].skill : (G.ACTION_BY_ID[act0.id] || {}).skill;
    // A skill trained alongside a raid animates too.
    const sideSkill = me.state.side ? (G.ACTION_BY_ID[me.state.side.id] || {}).skill : null;
    // Raiding with an off-hand from another class trains that class too (its share of the XP).
    const offItem = act0 && act0.type ? G.ITEMS[me.state.equipment.offhand] : null;
    const offSkill = offItem && offItem.cls && offItem.cls !== myClass() ? G.CLASSES[offItem.cls].skill : null;
    const training = sk => sk === activeSkill || sk === sideSkill || sk === offSkill;
    Object.values(navRefs).forEach(({ btn, right, spin, item, fill }) => {
      btn.toggleAttribute('aria-current', false);
      if (item.id === page) btn.setAttribute('aria-current', 'page');
      if (item.id === 'raids') spin.hidden = !raiding();
      if (item.skill) {
        const x = xpInfo(item.skill);
        right.textContent = String(x.level).padStart(2, '0');
        fill.style.width = x.pct + '%';
        btn.title = x.max ? `${item.name}: ${num(x.xp)} XP (max level)` : `${item.name}: ${num(x.xp)} XP, ${num(x.toGo)} to level ${x.level + 1}`;
        spin.hidden = !training(item.skill);
        btn.classList.toggle('training', training(item.skill));
      } else if (item.alert) {
        const n = me.alerts[item.alert];
        right.className = n ? 'badge' : 'lvl';
        right.textContent = n ? String(n) : '';
      }
    });

    // Current activity card.
    const card = $('now-card');
    const a = act0 && !act0.type && G.ACTION_BY_ID[act0.id];
    if (act0 && act0.type && G.RAID_BY_ID[act0.raid]) {
      const raid = G.RAID_BY_ID[act0.raid];
      card.className = 'now-card';
      card.replaceChildren(foeArt(raid.foe, true, 'now-foe', 24),
        h('div', { class: 'now-name' }, h('span', {}, raid.name), h('small', {}, `${act0.type === 'party' ? 'Party' : 'Solo'} · fight ${act0.n || 1}`)),
        h('div', { class: 'bar red' }, h('span', { id: 'now-fill' })));
    } else if (a) {
      const sk = G.SKILL_BY_ID[a.skill];
      card.className = 'now-card';
      card.replaceChildren(itemIco(a.item),
        h('div', { class: 'now-name' }, h('span', {}, a.name), h('small', {}, act0.left ? `${num(act0.left)} left` : `${sk.name} ${lvl(a.skill)}`)),
        h('div', { class: 'bar' }, h('span', { id: 'now-fill' })));
    } else {
      card.className = 'now-card idle';
      card.replaceChildren(h('span', {}, 'Idle. Pick a skill action or a raid to start.'));
    }
    renderQueue();
    renderActionBar();

    $('topline').replaceChildren('',
      h('span', { class: 'topline-now' }, activityText()),
      (me.state.queue || []).length ? h('span', { class: 'topline-queue' }, `Queue: ${me.state.queue.length}/${G.QUEUE_MAX}`) : '');
    const cls = myClass();
    const dot = h('span', { class: 'pilot-dot' });
    dot.style.background = classColour(me.state.equipment);
    $('pilot').replaceChildren(dot, h('div', {}, h('b', {}, me.player.name), h('small', {}, `${me.guild ? `[${me.guild.tag}] ` : ''}${me.player.mech} · ${G.CLASSES[cls].name}`)));
  }

  // The bar pinned to the bottom of the screen: what you're doing, a Queue button that opens your
  // queued actions, and Stop on the right.
  let queueOpen = false;
  function renderActionBar() {
    const bar = $('action-bar');
    const a = me.state.activity;
    const q = me.state.queue || [];
    if (!a && !q.length) { bar.hidden = true; bar.replaceChildren(); return; }
    bar.hidden = false;
    const parts = [];
    if (a && a.type) {
      const raid = G.RAID_BY_ID[a.raid];
      parts.push(raid ? h('span', { class: 'ab-art' }, bossIcon(raid, '', 34)) : '',
        h('div', { class: 'ab-info' }, h('b', {}, raid ? raid.name : 'Raid'), h('small', {}, `${a.type === 'party' ? 'Party raid' : 'Solo raid'}${a.diff && a.diff !== 'normal' ? ` \u00b7 ${G.DIFF_BY_ID[a.diff].name}` : ''} \u00b7 fight ${a.n || 1}`)),
        h('div', { class: 'ab-bar' }, h('span', { id: 'action-fill', class: 'raid' })),
        h('button', { type: 'button', class: 'btn small', onclick: () => go('raids') }, 'Watch'));
      const side = me.state.side && G.ACTION_BY_ID[me.state.side.id];
      if (side) parts.push(h('div', { class: 'ab-side', title: `Training alongside the raid: ${Math.round(G.DUAL_XP * 100)}% XP for both` },
        itemIco(side.item, 'sm'), h('div', { class: 'ab-info' }, h('b', {}, side.name), h('small', {}, `${Math.round(G.DUAL_XP * 100)}% XP · raid too`)),
        h('div', { class: 'ab-bar' }, h('span', { id: 'side-fill' })),
        h('button', { type: 'button', class: 'icon-btn tiny', 'aria-label': `Stop ${side.name}`, onclick: () => act('/api/action/stop', { what: 'skill' }, 'Skill stopped. Raid XP back to full.') }, ui('close', 'sm'))));
    } else if (a && G.ACTION_BY_ID[a.id]) {
      const action = G.ACTION_BY_ID[a.id];
      const sk = G.SKILL_BY_ID[action.skill];
      parts.push(h('span', { class: 'ab-art' }, itemIco(action.item, 'md')),
        h('div', { class: 'ab-info' }, h('b', {}, action.name), h('small', {}, `${sk.name} ${lvl(action.skill)} \u00b7 ${action.xp} XP each \u00b7 ${secs(action.time)}`)),
        h('div', { class: 'ab-bar' }, h('span', { id: 'action-fill' })),
        h('span', { class: 'ab-left' }, a.left ? `${num(a.left)} left` : 'Repeating'));
    } else {
      parts.push(h('div', { class: 'ab-info' }, h('b', {}, 'Idle'), h('small', {}, 'Your queue starts with the next action.')), h('div', { class: 'ab-bar' }));
    }
    // Queue button and its panel.
    const panel = h('div', { class: 'ab-queue', hidden: !queueOpen },
      h('div', { class: 'queue-head' }, h('b', {}, `Queue ${q.length}/${G.QUEUE_MAX}`),
        q.length ? h('button', { type: 'button', class: 'link-btn', onclick: () => act('/api/queue', { queue: [] }, 'Queue cleared.') }, 'Clear') : ''),
      q.length ? q.map((e, i) => {
        const action = G.ACTION_BY_ID[e.id];
        return h('div', { class: 'queue-row' }, action ? itemIco(action.item, 'sm') : '', h('span', { class: 'grow' }, action ? action.name : e.id), h('small', {}, `\u00d7${num(e.count)}`),
          h('button', { type: 'button', class: 'icon-btn tiny', 'aria-label': `Remove ${action ? action.name : ''} from the queue`, onclick: () => act('/api/queue', { queue: q.filter((_, k) => k !== i) }) }, ui('close', 'sm')));
      }) : h('p', { class: 'muted small' }, 'Nothing queued. Use Queue on any skill card to line up to five actions.'));
    const qBtn = h('button', { type: 'button', class: `btn small${queueOpen ? ' on' : ''}`, 'aria-expanded': String(queueOpen), onclick: () => { queueOpen = !queueOpen; renderActionBar(); if (queueOpen) { const pnl = document.querySelector('.ab-queue'); if (pnl) pnl.classList.add('opening'); } } },
      'Queue', q.length ? h('span', { class: 'chip-count' }, String(q.length)) : '');
    const stop = a ? h('button', { type: 'button', class: 'btn small danger', onclick: () => (a.type === 'party' ? act('/api/party/leave', {}) : act('/api/action/stop', { what: a.type ? 'raid' : 'skill' })) }, a.type === 'party' ? 'Leave' : 'Stop') : '';
    bar.replaceChildren(panel, ...parts, qBtn, stop);
  }

  // The action queue: up to five entries that start in order once the current action ends.
  function renderQueue() {
    const q = me.state.queue || [];
    const box = $('queue-box');
    if (!q.length) { box.replaceChildren(); box.hidden = true; return; }
    box.hidden = false;
    box.replaceChildren(h('div', { class: 'queue-head' }, h('b', {}, `Queue ${q.length}/${G.QUEUE_MAX}`),
      h('button', { type: 'button', class: 'link-btn', onclick: () => act('/api/queue', { queue: [] }, 'Queue cleared.') }, 'Clear')),
    ...q.map((e, i) => {
      const action = G.ACTION_BY_ID[e.id];
      return h('div', { class: 'queue-row' }, action ? itemIco(action.item, 'sm') : null,
        h('span', { class: 'grow' }, action ? action.name : e.id), h('small', {}, `×${num(e.count)}`),
        h('button', { type: 'button', class: 'icon-btn tiny', 'aria-label': `Remove ${action ? action.name : ''} from queue`,
          onclick: () => act('/api/queue', { queue: q.filter((_, k) => k !== i) }) }, ui('close', 'sm')));
    }));
  }

  function openMenu() { $('sidebar').classList.add('open'); $('scrim').hidden = false; }
  function closeMenu() { $('sidebar').classList.remove('open'); $('scrim').hidden = true; }

  // Progress bars run smoothly between polls.
  // When an action's bar completes, ask the server straight away so the item shows up then
  // (the regular check-in is only every few seconds).
  let doneKey = null;
  // One error must never stop the loop (that froze every progress bar), so each frame is guarded.
  function frame() {
    try { frameBody(); } catch (e) { /* skip this frame */ }
    requestAnimationFrame(frame);
  }
  function frameBody() {
    const p = me && activityProgress();
    const w = p ? `${p.frac * 100}%` : '0%';
    const nf = document.getElementById('now-fill');
    if (nf) nf.style.width = w;
    const af = document.getElementById('action-fill');
    if (af) af.style.width = w;
    const sp = me && skillProgress();
    const sw = sp ? `${sp.frac * 100}%` : '0%';
    const sf = document.getElementById('side-fill');
    if (sf) sf.style.width = sw;
    if (sp) {
      const done = Math.floor((sp.a.progress + (now() - me.state.lastTick)) / sp.action.time);
      const key = `${me.state.lastTick}:${done}`;
      if (done > 0 && key !== doneKey) { doneKey = key; setTimeout(poll, 150); }
    }
    document.querySelectorAll('.card.active .card-fill').forEach(el => { el.style.width = sw; });
    const ghost = document.querySelector('.xp-ghost');
    if (ghost) {
      const x = xpInfo(ghost.dataset.skill);
      const a = sp && sp.action.skill === ghost.dataset.skill ? sp.action : null;
      const xpEach = a ? a.xp * (me.state.side ? G.DUAL_XP : 1) : 0;
      const gain = a && !x.max ? Math.min(100 - x.pct, (xpEach / (x.to - x.from)) * 100) : 0;
      ghost.style.left = `${x.pct}%`;
      ghost.style.width = `${gain && sp ? gain * sp.frac : 0}%`;
    }
  }

  // ---------- Pages ----------
  const LIVE = ['skill', 'equipment', 'inventory', 'abilities', 'subclass'];
  const isLivePage = () => LIVE.includes(page.split(':')[0]) && !document.querySelector('.page input:focus, .page select:focus');
  // What each live page shows, as a string: the refresh only rebuilds the page when this changes,
  // so animations aren't restarted (which looked like a flash) every few seconds.
  const levelsSig = st => G.SKILLS.map(sk => G.levelFromXp(st.skills[sk.id].xp)).join(',');
  const itemsSig = (st, keep) => Object.entries(st.items).filter(([id]) => !keep || (G.ITEMS[id] && keep(G.ITEMS[id]))).sort().join(';');
  const PAGE_SIG = {
    skill: st => JSON.stringify([levelsSig(st), st.activity && [st.activity.id, st.activity.type], st.side && st.side.id]),
    equipment: st => JSON.stringify([st.equipment, st.supplies, st.subclasses, levelsSig(st), itemsSig(st, it => it.type === 'gear' || it.supply)]),
    inventory: st => JSON.stringify([itemsSig(st), st.equipment]),
    abilities: st => JSON.stringify([st.abilities, st.subclasses, st.multi, st.equipment, levelsSig(st)]),
    subclass: st => JSON.stringify([st.subclasses, st.multi, st.equipment, levelsSig(st)]),
  };
  let lastSig = null;
  // In-place updaters registered by the page being shown (for changes that don't need a rebuild).
  let softRefresh = [];
  const refreshPage = () => { if (pageChanged()) renderPage(); else softRefresh.forEach(f => f()); };
  function pageChanged() {
    const f = PAGE_SIG[page.split(':')[0]];
    const sig = f ? f(me.state) : null;
    if (sig !== null && sig === lastSig) return false;
    lastSig = sig;
    return true;
  }

  function go(id) {
    const kind = id.split(':')[0];
    if (kind === 'hangar') id = 'equipment';
    if (!PAGES[id.split(':')[0]] || (id.startsWith('skill:') && !G.SKILL_BY_ID[id.slice(6)])) id = 'skill:mining';
    if (pageCleanup) pageCleanup();
    page = id;
    store(PAGE_KEY, id);
    enterNext = true;
    pageRefresh = pageTick = pageCleanup = null;
    renderChrome();
    renderPage();
    window.scrollTo(0, 0);
  }

  // Pages animate in when you go to them; the refresh every few seconds doesn't replay it.
  let enterNext = true;
  function renderPage() {
    softRefresh = [];
    const sigF = PAGE_SIG[page.split(':')[0]];
    lastSig = sigF && me ? sigF(me.state) : null;
    if (pageCleanup) pageCleanup();
    pageRefresh = pageTick = pageCleanup = null;
    const [kind, arg] = page.split(':');
    document.body.classList.toggle('on-raids', kind === 'raids');
    const el = PAGES[kind](arg);
    // A refresh during the entrance would replay the fade-in and blink; end the entrance instead.
    if (!enterNext) { clearTimeout(renderPage.enterTimer); $('page').classList.remove('page-enter'); }
    if (el) $('page').replaceChildren(...[].concat(el).filter(Boolean));
    if (enterNext) {
      enterNext = false;
      const pg = $('page');
      pg.classList.remove('page-enter');
      void pg.offsetWidth;
      pg.classList.add('page-enter');
      // Drop the entrance class afterwards, so later refreshes don't replay it and nothing can stay hidden.
      clearTimeout(renderPage.enterTimer);
      renderPage.enterTimer = setTimeout(() => pg.classList.remove('page-enter'), 1100);
      // Stagger cards, tiles and rows as they come in.
      pg.querySelectorAll('.card, .tile, .raid-row, .slot, .ability, .sub-card, .row, .history-row').forEach((el2, i) => { el2.style.animationDelay = `${Math.min(i, 24) * 22}ms`; });
    }
  }

  function pageHead(icon, iconCls, title, lead, right) {
    return h('div', { class: 'page-head' },
      h('div', { class: 'page-title' }, ui(icon, iconCls), h('div', {}, h('h1', {}, title), lead ? h('p', { class: 'lead' }, lead) : null)),
      right || null);
  }

  function section(title, note, ...body) {
    return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', {}, title), note ? h('p', {}, note) : null), ...body);
  }

  // ---------- Item stats ----------
  function classChip(cls, extra) {
    const c = G.CLASSES[cls];
    const chip = h('span', { class: 'role-chip' }, classIco(cls), extra ? `${c.name} · ${extra}` : c.name);
    chip.style.setProperty('--role', c.colour);
    return chip;
  }
  const roleChip = (cls, stance) => classChip(cls, stance === 'tank' ? 'Tank' : null);

  const STAT_ORDER = ['atk', 'def', 'hp', 'mres', 'eres', 'mana', 'regen', 'crit', 'critDmg', 'power', 'heal', 'haste', 'pen', 'block', 'double', 'bleed', 'burn', 'poison', 'fire', 'frost', 'shock', 'lifesteal', 'defPct', 'hpPct', 'enemyDmg'];
  const statClass = k => (['atk', 'crit', 'critDmg', 'power', 'haste', 'pen', 'double', 'bleed', 'burn', 'poison', 'fire', 'frost', 'shock'].includes(k) ? 'stat-atk'
    : ['def', 'mres', 'eres', 'block', 'defPct', 'enemyDmg'].includes(k) ? 'stat-def' : ['mana', 'regen'].includes(k) ? 'stat-mana' : 'stat-hp');

  function statsLine(it) {
    if (!it) return null;
    const bits = [];
    if (it.cls && it.slot === 'weapon') {
      const w = G.WEAPON_BY_ID[it.weapon];
      bits.push(classChip(it.cls, it.twoHanded ? 'Two-handed' : null));
      bits.push(h('span', { class: 'stat-muted' }, `${secs(w.cast)} per hit`));
    } else if (it.cls && it.slot === 'offhand') bits.push(classChip(it.cls, 'Off-hand'));
    else if (it.cls) bits.push(classChip(it.cls, 'Buff'));
    if (it.armour) bits.push(h('span', { class: 'type-chip' }, G.ARMOUR_TYPES[it.armour].name));
    if (it.set) bits.push(h('span', { class: 'set-chip' }, `${G.SET_BY_ID[it.set].name} set`));
    const st = it.stats || {};
    STAT_ORDER.forEach(k => {
      if (!st[k]) return;
      const label = k === 'atk' && it.cls === 'healer' ? `+${st[k]} healing/s` : G.STATS[k].fmt(st[k]);
      bits.push(h('span', { class: k === 'atk' && it.cls === 'healer' ? 'stat-hp' : statClass(k) }, label));
    });
    if (it.passives) bits.push(h('span', { class: 'stat-passive' }, Object.keys(it.passives).map(k => k[0].toUpperCase() + k.slice(1)).join(', ')));
    return bits.length ? h('div', { class: 'stats-line' }, bits) : null;
  }
  const passiveText = pas => Object.entries(pas || {}).map(([k, v]) => G.PASSIVES[k] ? G.PASSIVES[k](v) : `${k} ${v}`);

  // ---------- Skill pages ----------
  const SKILL_SECTION = {
    mining: 'Veins', hunting: 'Hunting grounds', foraging: 'Groves', herbalism: 'Herb patches', smithing: 'Weapons and shields', armoursmithing: 'Plate armour',
    honing: 'Whetstones and oils', fletching: 'Bows, daggers and quivers', leatherworking: 'Leather armour', poisoncraft: 'Poisons', enchanting: 'Focuses and orbs',
    tailoring: 'Cloth armour', runecrafting: 'Runes and sigils', scribing: 'Holy books, lanterns and relics', weaving: 'Vestments', alchemy: 'Potions and tonics',
  };

  // The page is rebuilt when XP changes, so the bar remembers where it was and animates from there:
  // it grows with each gain (with a glow), sweeps round to a new level, and a faint segment ahead
  // of it fills with the current action's progress towards the XP it will give.
  const lastLevelBar = {};
  function levelBox(id) {
    const x = xpInfo(id);
    const prev = lastLevelBar[id];
    lastLevelBar[id] = { level: x.level, pct: x.pct };
    const fill = h('span', { class: 'xp-fill' });
    const ghost = h('span', { class: 'xp-ghost', 'data-skill': id });
    const bar = h('div', { class: 'bar xp-bar' }, ghost, fill);
    const levelled = prev && x.level > prev.level;
    const gained = prev && !levelled && x.pct > prev.pct + 0.01;
    fill.style.width = `${prev && !levelled ? prev.pct : 0}%`;
    setTimeout(() => {
      fill.style.width = x.pct + '%';
      if (gained || levelled) { bar.classList.remove('xp-gain'); void bar.offsetWidth; bar.classList.add(levelled ? 'xp-level' : 'xp-gain'); }
    }, 30);
    const pctEl = h('span', {}, `${Math.floor(x.pct)}%`), xpEl = h('b', {}, num(x.xp)), toGoEl = h('b', {}, num(x.toGo));
    softRefresh.push(() => {
      const y = xpInfo(id);
      if (y.pct > (lastLevelBar[id] || {}).pct + 0.01) { bar.classList.remove('xp-gain'); void bar.offsetWidth; bar.classList.add('xp-gain'); }
      lastLevelBar[id] = { level: y.level, pct: y.pct };
      fill.style.width = y.pct + '%';
      pctEl.textContent = `${Math.floor(y.pct)}%`;
      xpEl.textContent = num(y.xp);
      toGoEl.textContent = num(y.toGo);
    });
    return h('div', { class: 'level-box' },
      h('div', { class: 'level-row' }, h('span', {}, `Level ${x.level}`), pctEl),
      bar,
      h('div', { class: 'xp-row' }, h('span', {}, xpEl, ' XP'),
        x.max ? h('span', {}, 'Maximum level') : h('span', {}, toGoEl, ` to level ${x.level + 1}`)));
  }

  // The gathering -> artisan -> combat chain a skill belongs to.
  function chainBar(skillId) {
    const sk = G.SKILL_BY_ID[skillId];
    const chainId = sk.group === 'combat' ? sk.id : sk.chain;
    const chain = G.SKILLS.filter(s => s.chain === chainId || s.id === chainId);
    const link = s => h('button', { type: 'button', class: `chain-step${s.id === skillId ? ' here' : ''}`, onclick: () => go('skill:' + s.id) }, ui(s.id, 'sm skill-' + s.id), s.name, h('small', {}, lvl(s.id)));
    const arrow = () => h('span', { class: 'chain-arrow', 'aria-hidden': 'true' }, '→');
    return h('div', { class: 'chain' }, chain.filter(s => s.group === 'gathering').map(link), arrow(),
      h('span', { class: 'chain-group' }, chain.filter(s => s.group === 'artisan').map(link)), arrow(), chain.filter(s => s.group === 'combat').map(link));
  }

  function skillPage(id) {
    const sk = G.SKILL_BY_ID[id];
    // The level and XP bar runs full width under the title.
    const lv = levelBox(id);
    lv.classList.add('level-wide');
    const head = [pageHead(id, 'skill-' + id, sk.name, sk.desc), lv];
    if (sk.group === 'combat') return [...head, chainBar(id), ...combatSkillBody(sk)];
    // Every tier on one screen, lowest level first, with a divider where each tier starts.
    const tierOf = a => a.tier || (G.ITEMS[a.item] || {}).tier || 1;
    const all = G.ACTIONS.filter(a => a.skill === id).sort((x, y) => tierOf(x) - tierOf(y) || x.level - y.level);
    const cards = [];
    let lastTier = 0;
    all.forEach(a => {
      const tn = tierOf(a);
      if (new Set(all.map(tierOf)).size > 1 && tn !== lastTier) {
        const t = G.TIERS[tn - 1];
        const div = h('div', { class: 'tier-divider' }, h('span', {}, `Tier ${tn} · ${t.metal}`), h('small', {}, `from level ${a.level}`));
        div.style.setProperty('--tier', t.colour);
        cards.push(div);
      }
      lastTier = tn;
      cards.push(actionCard(a));
    });
    return [...head, chainBar(id), section(SKILL_SECTION[id] || 'Actions', 'Hover a card for details. Click it to start, or set a count and start or queue it.', h('div', { class: 'grid' }, cards))];
  }

  // A small item badge (icon and a number) with the item's details on hover.
  const needChip = (id, main, sub, cls = '') => tip(h('span', { class: `need ${cls}` }, itemIco(id, 'sm'), main, sub ? h('small', {}, sub) : null), () => itemTip(id));

  function actionCard(a) {
    const locked = lvl(a.skill) < a.level;
    const running = skillAct();
    const active = !!running && running.id === a.id;
    const out = G.ITEMS[a.item];
    const inputs = Object.entries(a.inputs);
    const outputs = Object.entries(a.outputs);
    const count = h('input', { type: 'number', min: '1', placeholder: '∞', 'aria-label': `How many ${a.name}`, inputmode: 'numeric', disabled: locked });
    const n = () => { const v = parseInt(count.value, 10); return v > 0 ? v : null; };
    const start = async () => {
      await act('/api/action/start', { id: a.id, count: n() }, raiding() ? `Training alongside your raid: ${Math.round(G.DUAL_XP * 100)}% XP for both until one stops.` : null);
    };
    const queue = async () => {
      const q = (me.state.queue || []).concat({ id: a.id, count: n() || 1 });
      if (q.length > G.QUEUE_MAX) { toast(`The queue holds ${G.QUEUE_MAX} actions.`, 'error'); return; }
      await act('/api/queue', { queue: q }, `Queued ${n() || 1} × ${a.name}.`);
    };
    // The parts that change as you play (counts, what's left), refreshed in place.
    const needsEl = h('div', { class: 'needs' }), footEl = h('div', { class: 'card-foot' });
    const fillLive = () => {
      const run = skillAct();
      needsEl.replaceChildren(...(inputs.length
        ? inputs.map(([id, q]) => needChip(id, String(q), `/${fmt(have(id))}`, have(id) < q ? 'short' : ''))
        : [...outputs.map(([id, q]) => needChip(id, q[0] === q[1] ? `+${q[0]}` : `+${q[0]}–${q[1]}`)), ...a.chance.map(c => needChip(c.item, `${Math.round(c.p * 100)}%`))]));
      footEl.replaceChildren(h('span', {}, inputs.length ? `Owned: ${fmt(have(a.item))}` : `Owned: ${[...outputs.map(([id]) => id), ...a.chance.map(c => c.item)].map(id => `${fmt(have(id))} ${G.ITEMS[id].name.split(' ').pop().toLowerCase()}`).join(', ')}`),
        active && run ? h('span', { class: 'ok' }, run.left ? `${num(run.left)} left` : (me.state.side ? `Running · ${Math.round(G.DUAL_XP * 100)}% XP` : 'Running')) : null);
    };
    fillLive();
    softRefresh.push(fillLive);
    const art = h('div', { class: 'card-art' }, itemIco(a.item, 'xl'));
    if (out) art.style.setProperty('--ic', out.colour);
    const tierBadge = out && out.tier ? h('span', { class: 'tier-badge' }, `T${out.tier}`) : null;
    if (tierBadge) tierBadge.style.setProperty('--tier', out.colour);
    const recipe = h('p', { class: 'tip-desc muted' }, `${a.name}: ${secs(a.time)}, ${a.xp} ${G.SKILL_BY_ID[a.skill].name} XP, level ${a.level}.`);
    const main = tip(h('button', { type: 'button', class: 'card-main', disabled: locked, 'aria-pressed': String(active),
      onclick: () => (active ? act('/api/action/stop', { what: 'skill' }) : start()) },
    h('div', { class: 'card-top' }, tierBadge, out && out.type !== 'resource' ? itemName(a.item) : h('span', {}, a.name), h('span', { class: 'card-time' }, secs(a.time))),
    art,
    locked ? h('div', { class: 'card-xp' }, ui('lock', 'sm'), `Level ${a.level}`) : h('div', { class: 'card-xp' }, `${a.xp} XP`),
    needsEl,
    footEl),
    () => itemTip(a.item, recipe));
    return h('div', { class: `card action${active ? ' active' : ''}${locked ? ' locked' : ''}` }, main,
      h('div', { class: 'card-controls' }, count,
        h('button', { type: 'button', class: 'btn small', disabled: locked, onclick: start }, 'Start'),
        h('button', { type: 'button', class: 'btn small', disabled: locked, onclick: queue }, 'Queue')),
      h('span', { class: 'card-fill' }));
  }

  function combatSkillBody(sk) {
    const cls = sk.cls;
    const L = lvl(sk.id);
    const kinds = G.WEAPON_KINDS.filter(w => w.cls === cls);
    const off = G.OFFHAND_KINDS.find(o => o.cls === cls);
    const offCls = (G.ITEMS[me.state.equipment.offhand] || {}).cls;
    const trains = myClass() === cls || (offCls === cls && myClass() !== cls);
    const abilities = G.ABILITIES.filter(a => a.cls === cls);
    return [
      h('div', { class: 'two-col' },
        h('div', { class: 'panel stack' },
          h('h2', {}, 'How it trains'),
          h('p', {}, `Fight raids with a ${cls} weapon (${kinds.map(w => w.noun).join(', ')}). A win gives the raid’s full XP, a loss a quarter. Multiclassing splits the XP 60/40 between two classes, and an off-hand from another class takes ${Math.round(G.OFFHAND_XP_SHARE * 100)}% for its class.`),
          cls === 'healer' ? h('p', { class: 'muted' }, 'Healers heal anyone under 80% HP and smite the rest of the time, so they can clear raids alone, just more slowly.') : null,
          h('p', { class: trains ? 'ok' : 'warn' }, trains ? `You are training ${sk.name}.` : `Fit a ${cls} weapon in Equipment to train ${sk.name}.`),
          h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => go('raids') }, 'Go to raids'),
            h('button', { type: 'button', class: 'btn', onclick: () => go('abilities') }, 'Abilities'), h('button', { type: 'button', class: 'btn', onclick: () => go('subclass') }, 'Subclasses'))),
        h('div', { class: 'panel stack' },
          h('h2', {}, 'Current bonus'),
          h('p', { class: 'big-number' }, `+${L - 1}% ${cls === 'healer' ? 'healing and smite' : `${sk.name.toLowerCase()} damage`}`),
          h('h3', {}, 'Abilities'),
          h('ul', { class: 'ability-mini' }, abilities.map(ab => h('li', { class: L >= ab.level ? 'ok' : 'muted' }, gi('ab_' + ab.id, null, 'sm'), `${ab.name} · level ${ab.level}`))))),
      section('Weapons', `Made with ${G.SKILL_BY_ID[kinds[0].maker].name}. Each tier needs raid material from the previous tier’s bosses.`,
        h('div', { class: 'weapon-table' }, [...kinds, off].map(w => h('div', { class: 'weapon-kind' },
          h('div', { class: 'weapon-kind-head' }, itemIco(`copper_${w.id}`, 'md'),
            h('div', {}, h('b', {}, w.noun[0].toUpperCase() + w.noun.slice(1) + (w === off ? ' (off-hand)' : '')), h('small', { class: 'muted' }, w.note))),
          h('div', { class: 'tier-row' }, G.TIERS.filter(t => t.level <= L + 8).slice(-10).map(t => {
            const id = `${t.id}_${w.id}`;
            const recipe = G.ACTION_BY_ID['craft_' + id];
            const on = me.state.equipment.weapon === id || me.state.equipment.offhand === id;
            return h('button', { type: 'button', class: `tier-cell${on ? ' on' : ''}${have(id) ? ' owned' : ''}`, title: G.ITEMS[id].name,
              disabled: !have(id) || on, onclick: () => act('/api/equip', { item: id }, `${G.ITEMS[id].name} fitted.`) },
            itemIco(id, 'md'), h('small', {}, on ? 'Fitted' : have(id) ? `${have(id)} owned` : `Lv ${recipe.level}`));
          })))))),
    ];
  }

  // What fitting an item would change: what it replaces, and your mech's stats before and after
  // (set bonuses, traits, subclass and a two-hander freeing the off-hand all included).
  function gearCompare(id) {
    const it = G.ITEMS[id];
    if (!it || !it.slot) return null;
    const eq = me.state.equipment;
    const next = { ...eq, [it.slot]: id };
    if (it.slot === 'weapon' && it.twoHanded) next.offhand = null;
    if (it.slot === 'offhand' && G.ITEMS[eq.weapon] && G.ITEMS[eq.weapon].twoHanded) return h('p', { class: 'bad tip-desc' }, 'Your two-handed weapon leaves no room for an off-hand.');
    if (eq[it.slot] === id) return h('p', { class: 'ok tip-desc' }, 'You have this fitted.');
    const cur = myStats();
    const nextStats = G.mechStats(next, myLevels(), { subclass: mySubclass(it.cls && it.slot === 'weapon' ? it.cls : myClass()) });
    const worn = eq[it.slot] && G.ITEMS[eq[it.slot]];
    const ROWS = [
      ['Power', s0 => G.power(s0), v => num(v)], ['Damage/s', s0 => s0.atk, v => num(v)], ['Armour', s0 => s0.def, v => num(v)], ['HP', s0 => s0.hp, v => num(v)],
      ['Mana', s0 => s0.mana, v => num(v)], ['Mana regen', s0 => s0.regen, v => `${v}/s`], ['Magic resist', s0 => s0.mres, v => num(v)], ['Elemental resist', s0 => s0.eres, v => num(v)],
      ['Crit', s0 => s0.crit, pct], ['Attack speed', s0 => s0.haste, pct], ['Armour pen', s0 => s0.pen, pct], ['Block', s0 => s0.block, pct], ['Healing', s0 => s0.heal, pct],
      ['Double hit', s0 => s0.double, pct], ['Lifesteal', s0 => s0.lifesteal, pct], ['Bleed', s0 => s0.bleed, pct], ['Burn', s0 => s0.burn, pct], ['Poison', s0 => s0.poison, pct],
    ];
    const rows = ROWS.map(([label, get, show]) => {
      const a = get(cur) || 0, b = get(nextStats) || 0;
      if (Math.abs(b - a) < 1e-6) return null;
      return h('div', { class: 'cmp-row' }, h('span', {}, label), h('span', { class: 'muted' }, show(a)), h('span', {}, '\u2192'), h('b', { class: b > a ? 'ok' : 'bad' }, show(b)));
    }).filter(Boolean);
    const classNote = it.slot === 'weapon' && it.cls !== myClass() ? h('p', { class: 'warn tip-desc' }, `Switches your class to ${G.CLASSES[it.cls].name}.`) : null;
    const offNote = it.slot === 'weapon' && it.twoHanded && eq.offhand ? h('p', { class: 'warn tip-desc' }, `Two-handed: takes off your ${G.ITEMS[eq.offhand].name}.`) : null;
    return h('div', { class: 'cmp' },
      h('div', { class: 'cmp-head' }, 'Compared with ', worn ? itemName(worn.id, 'b') : h('b', {}, 'an empty slot')),
      classNote, offNote,
      rows.length ? h('div', { class: 'cmp-rows' }, rows) : h('p', { class: 'muted tip-desc' }, 'No change to your stats.'));
  }

  // ---------- Equipment ----------
  function equipmentPage() {
    const s = myStats();
    const eq = me.state.equipment;
    const cls = s.cls;
    const gear = Object.keys(me.state.items).filter(id => G.ITEMS[id] && G.ITEMS[id].type === 'gear');
    const supplies = Object.values(G.ITEMS).filter(it => it.supply && have(it.id) > 0);
    const pas = passiveText(s.passives);
    const weapon = G.WEAPON_BY_ID[s.weapon];
    const statRows = [
      ['Damage/s', num(s.atk), 'stat-atk'], ['Armour', num(s.def), 'stat-def'], ['HP', num(s.hp), 'stat-hp'], ['Mana', `${num(s.mana)} (+${s.regen}/s)`, 'stat-mana'],
      ['Magic resist', num(s.mres), 'stat-def'], ['Elemental resist', num(s.eres), 'stat-def'], ['Crit', pct((weapon ? weapon.crit : 0.05) + s.crit), 'stat-atk'],
      ['Level bonus', `+${s.effLevel - 1}% damage${s.level > s.levelCap ? ` (capped at level ${s.levelCap} by your weapon)` : ''}`, 'stat-atk'],
      ['Attack speed', `+${pct(s.haste)}`, 'stat-atk'], ['Armour pen', pct(s.pen), 'stat-atk'], ['Block', pct(s.block), 'stat-def'],
      s.heal ? ['Healing', `+${pct(s.heal)}`, 'stat-hp'] : null, s.double ? ['Double hit', pct(s.double), 'stat-atk'] : null,
      s.lifesteal ? ['Lifesteal', pct(s.lifesteal), 'stat-hp'] : null,
      ...['bleed', 'burn', 'poison', 'fire', 'frost', 'shock'].filter(k => s[k]).map(k => [G.STATS[k].name, pct(s[k]), 'stat-atk']),
    ].filter(Boolean);
    const slotsBy = {};
    gear.forEach(id => { const sl = G.ITEMS[id].slot; (slotsBy[sl] = slotsBy[sl] || []).push(id); });
    return [
      pageHead('equipment', 'skill-melee', me.player.mech, `Piloted by ${me.player.name}. Your main-hand weapon sets your class and your mech’s colour.`,
        h('div', { class: 'head-stats' },
          h('div', {}, h('small', {}, 'Combat level'), h('b', {}, num(myCombat()))),
          h('div', {}, h('small', {}, 'Power'), h('b', {}, num(G.power(s)))))),
      h('div', { class: 'hangar' },
        h('div', { class: 'panel hangar-mech' },
          h('div', { class: 'hangar-stage' }, mechArt(eq, `${me.player.mech}, your mech`)),
          h('div', { class: 'stats-line left' }, classChip(cls), s.subclass ? h('span', { class: 'set-chip' }, G.SUBCLASS_BY_ID[s.subclass].name) : null, h('span', { class: 'muted' }, `Trains ${G.SKILL_BY_ID[s.skill].name}`)),
          h('dl', { class: 'stat-grid' }, statRows.map(([k, v, c]) => h('div', {}, h('dt', {}, k), h('dd', { class: c }, v)))),
          s.bonuses.length || pas.length ? h('div', { class: 'bonus-list' }, h('b', {}, 'Active bonuses'),
            h('ul', {}, s.bonuses.map(b => h('li', {}, b)), pas.map(p => h('li', { class: 'passive' }, p)))) : null),
        h('div', {},
          section('Fitted gear', `Click a slot to see the gear you can fit there.${raiding() ? ' Changes apply to your current fight straight away.' : ''}`, h('div', { class: 'slot-list' }, G.SLOTS.map(slot => {
            const it = eq[slot.id] && G.ITEMS[eq[slot.id]];
            const blocked = slot.id === 'offhand' && G.ITEMS[eq.weapon] && G.ITEMS[eq.weapon].twoHanded;
            const empty = { weapon: 'sword_0', offhand: 'shield_0', head: 'plate_head_0', body: 'plate_body_0', legs: 'plate_legs_0', hands: 'plate_hands_0', feet: 'plate_feet_0', trinket: 'sigil_0' }[slot.id];
            const spare = (slotsBy[slot.id] || []).length;
            const pick = h('button', { type: 'button', class: 'slot-pick', 'aria-label': `Choose ${slot.name.toLowerCase()} gear`, onclick: () => gearPicker(slot) },
              it ? itemIco(it.id) : gi(empty, '#4a5160'),
              h('div', { class: 'slot-info' }, h('small', {}, slot.name, spare ? h('span', { class: 'slot-spare' }, ` · ${spare} in storage`) : null),
                it ? itemName(it.id, 'b') : h('b', {}, blocked ? 'Used by your two-handed weapon' : 'Empty'), statsLine(it)));
            return h('div', { class: `slot${it ? '' : ' empty-slot'}` }, it ? tip(pick, () => itemTip(it.id)) : pick,
              it ? h('button', { type: 'button', class: 'btn small', onclick: () => act('/api/unequip', { slot: slot.id }) }, 'Remove') : null);
          }))),
          section('Raid supplies', supplies.length ? 'Ticked supplies go into every fight while you have them. Potions are only drunk when needed; buffs are used up each fight. Class buffs only apply to their class.' : null,
            supplies.length ? h('div', { class: 'slot-list slot-grid' }, supplies.map(it => {
              const on = me.state.supplies[it.id] !== false;
              const box = h('input', { type: 'checkbox', checked: on, 'aria-label': `Bring ${it.name}`, onchange: e => act('/api/supplies', { item: it.id, on: e.target.checked }) });
              return h('label', { class: `slot supply${on ? '' : ' off'}` }, box, itemIco(it.id),
                h('div', { class: 'slot-info' }, h('small', {}, `${num(have(it.id))} owned${it.cls ? ` · ${G.CLASSES[it.cls].name} only` : ''}`), itemName(it.id, 'b'), h('span', { class: 'muted small' }, it.desc)));
            })) : h('div', { class: 'empty' }, 'No potions or buffs yet. Brew them with Alchemy, Honing, Poisoncraft or Runecrafting.')))),
    ];
  }

  // A pop-up listing the stored gear for one slot, best first, each compared with what's fitted.
  function gearPicker(slot) {
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const ids = Object.keys(me.state.items).filter(id => G.ITEMS[id] && G.ITEMS[id].slot === slot.id && have(id) > 0 && me.state.equipment[slot.id] !== id)
      .sort((x, y) => (G.ITEMS[y].tier || 0) - (G.ITEMS[x].tier || 0) || (G.ITEMS[y].rare ? 1 : 0) - (G.ITEMS[x].rare ? 1 : 0));
    const fitted = me.state.equipment[slot.id];
    // Grouped by class (armour by the class that wears it), your own class first.
    const ARMOUR_CLS = { plate: 'melee', leather: 'ranged', cloth: 'magic', vestment: 'healer' };
    const clsOf = id => G.ITEMS[id].cls || ARMOUR_CLS[G.ITEMS[id].armour] || null;
    const groups = [myClass(), ...Object.keys(G.CLASSES).filter(c => c !== myClass()), null]
      .map(c => [c, ids.filter(id => clsOf(id) === c || (c === null && !G.CLASSES[clsOf(id)]))]).filter(([, g]) => g.length);
    const itemRow = id => h('div', { class: `picker-item${G.ITEMS[id].rare ? ' rare-slot' : ''}` },
      h('div', { class: 'picker-top' }, tip(h('span', {}, itemIco(id, 'md')), () => itemTip(id)),
        h('div', { class: 'slot-info' }, h('small', {}, `Tier ${G.ITEMS[id].tier || 0} · ${have(id)} owned`), itemName(id, 'b'), statsLine(G.ITEMS[id])),
        h('button', { type: 'button', class: 'btn small primary', onclick: async () => { close(); await act('/api/equip', { item: id }, `${G.ITEMS[id].name} fitted.`); } }, 'Fit')),
      gearCompare(id));
    const list = ids.length ? h('div', { class: 'picker-list' }, groups.map(([c, g]) => {
      const head = h('h3', { class: 'picker-group' }, c ? classIco(c) : null, c ? G.CLASSES[c].name : 'Any class', h('small', {}, String(g.length)));
      if (c) head.style.setProperty('--role', G.CLASSES[c].colour);
      return [head, ...g.map(itemRow)];
    }))
      : h('div', { class: 'empty' }, `No spare ${slot.name.toLowerCase()} gear. Craft it, trade for it, or win it from raids.`);
    const overlay = h('div', { class: 'modal picker-modal', onclick: e => { if (e.target === overlay) close(); } },
      h('div', { class: 'modal-card picker-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${slot.name} gear` },
        h('div', { class: 'modal-head' }, h('h2', {}, `${slot.name} gear`), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, ui('close', 'sm'))),
        fitted && G.ITEMS[fitted] ? h('div', { class: 'picker-now' }, h('small', {}, 'Fitted now'), itemIco(fitted, 'sm'), itemName(fitted, 'b')) : null,
        list));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
  }

  // ---------- Inventory ----------
  let invFilter = 'all';
  let invSelected = null;
  const TYPE_ORDER = { resource: 0, material: 1, consumable: 2, gear: 3 };
  const TYPE_NAME = { resource: 'Resource', material: 'Raid material', consumable: 'Consumable', gear: 'Gear' };

  const INV_GROUP = { resource: 'Resources', material: 'Raid materials', consumable: 'Consumables', gear: 'Gear' };
  // Where an item comes from and what uses it, in a line or two (for tooltips).
  function itemSources(id) {
    const from = G.ACTIONS.filter(a => a.outputs[id] || a.chance.some(c => c.item === id)).map(a => `${G.SKILL_BY_ID[a.skill].name} (${a.name})`);
    const raids = G.RAIDS.filter(r => r.drops.some(d => d.item === id));
    if (raids.length) from.push(raids.length === 1 ? `Raid #${raids[0].n} ${raids[0].name}` : `${raids.length} raids in ${[...new Set(raids.map(r => r.regionName))].slice(0, 2).join(', ')}`);
    const uses = G.ACTIONS.filter(a => a.inputs[id]);
    return h('div', { class: 'tip-sources' },
      from.length ? h('p', {}, h('b', {}, 'From: '), from.slice(0, 3).join(', ')) : null,
      uses.length ? h('p', {}, h('b', {}, 'Used in: '), `${uses.slice(0, 3).map(a => a.name).join(', ')}${uses.length > 3 ? ` and ${uses.length - 3} more` : ''}`) : null);
  }
  function invTile(id) {
    const it = G.ITEMS[id];
    const tile = h('button', {
      type: 'button', class: `tile${it.rare ? ' rare-tile' : ''}`, 'aria-label': `${it.name}, ${have(id)}`,
      'aria-pressed': String(invSelected === id), onclick: () => { invSelected = id; renderPage(); },
    }, it.tier ? h('span', { class: 'tile-tier' }, `T${it.tier}`) : null, itemIco(id), h('span', { class: 'qty' }, fmt(have(id))), itemName(id, 'span'));
    tile.style.setProperty('--tier', it.colour);
    return tip(tile, () => itemTip(id, h('div', {}, it.type === 'gear' ? gearCompare(id) : null, itemSources(id))));
  }
  function inventoryPage() {
    const ids = Object.keys(me.state.items).filter(id => G.ITEMS[id] && id !== 'gold')
      .sort((a, b) => TYPE_ORDER[G.ITEMS[a].type] - TYPE_ORDER[G.ITEMS[b].type] || (G.ITEMS[a].tier || 0) - (G.ITEMS[b].tier || 0));
    const shown = ids.filter(id => invFilter === 'all' || G.ITEMS[id].type === invFilter);
    if (invSelected && !me.state.items[invSelected]) invSelected = null;
    const filters = [['all', 'All'], ['resource', 'Resources'], ['material', 'Raid materials'], ['consumable', 'Consumables'], ['gear', 'Gear']];
    return [
      pageHead('inventory', 'skill-alchemy', 'Inventory', `${plural(ids.length, 'kind')} of item in storage. Select one to see what it’s for.`,
        h('div', { class: 'head-stats' }, h('div', { class: 'gold-box' }, itemIco('gold', 'md'), h('div', {}, h('small', {}, 'Gold'), h('b', {}, num(have('gold'))))))),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter items' }, filters.map(([id, name]) =>
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(invFilter === id), onclick: () => { invFilter = id; renderPage(); } }, name))),
      h('div', { class: 'inv section' },
        shown.length
          // Grouped by type, each under its own heading in the All view.
          ? h('div', { class: 'inv-groups' }, Object.keys(TYPE_ORDER).map(type => {
            const ofType = shown.filter(id => G.ITEMS[id].type === type);
            if (!ofType.length) return null;
            return h('div', { class: 'inv-group' },
              invFilter === 'all' ? h('h3', { class: 'inv-head' }, INV_GROUP[type], h('small', {}, String(ofType.length))) : null,
              // Gear gets a row per slot.
              type === 'gear'
                ? G.SLOTS.filter(sl => ofType.some(id => G.ITEMS[id].slot === sl.id)).map(sl => {
                  const inSlot = ofType.filter(id => G.ITEMS[id].slot === sl.id);
                  return h('div', { class: 'inv-sub' }, h('h4', { class: 'inv-subhead' }, sl.name, h('small', {}, String(inSlot.length))), h('div', { class: 'tiles' }, inSlot.map(invTile)));
                })
                : h('div', { class: 'tiles' }, ofType.map(invTile)));
          }))
          : h('div', { class: 'empty' }, 'Nothing here yet. Start with a gathering skill: Mining, Hunting, Foraging or Herbalism.'),
        itemDetail(invSelected)),
    ];
  }

  function itemDetail(id) {
    if (!id) return h('div', { class: 'panel detail muted' }, 'Select an item to see its details.');
    const it = G.ITEMS[id];
    const madeBy = G.ACTIONS.filter(a => a.outputs[id] || a.chance.some(c => c.item === id));
    const usedIn = G.ACTIONS.filter(a => a.inputs[id]);
    const raids = G.RAIDS.filter(r => r.drops.some(d => d.item === id));
    const source = [...madeBy.map(a => `${a.name} (${G.SKILL_BY_ID[a.skill].name} ${a.level})`)];
    if (raids.length) source.push(`${raids.length} raid${raids.length > 1 ? 's' : ''} in ${[...new Set(raids.map(r => r.regionName))].join(', ')}`);
    const set = it.set ? G.SET_BY_ID[it.set] : null;
    return h('div', { class: 'panel detail' },
      h('div', { class: 'detail-head' }, itemIco(id, 'xl'), h('div', {}, itemName(id, 'h3'), h('small', {}, `${it.rare ? 'Rare ' : ''}${TYPE_NAME[it.type]}${it.tier ? ` · tier ${it.tier}` : ''} · ${num(have(id))} owned`))),
      h('p', {}, it.desc),
      statsLine(it),
      it.passives ? h('ul', { class: 'passive-list' }, passiveText(it.passives).map(p => h('li', {}, p))) : null,
      set ? h('div', { class: 'set-box' }, h('b', {}, `${set.name} set`), h('ul', {}, h('li', {}, `2 pieces: ${G.describe(set.two)}`), h('li', {}, `3 pieces: ${passiveText(set.three.passives).join(' ')}`))) : null,
      source.length ? h('div', {}, h('b', {}, 'Comes from'), h('ul', {}, source.map(s => h('li', {}, s)))) : null,
      usedIn.length ? h('div', {}, h('b', {}, 'Used in'), h('ul', {}, usedIn.slice(0, 8).map(a => h('li', {}, `${a.name} (${a.inputs[id]})`)), usedIn.length > 8 ? h('li', {}, `and ${usedIn.length - 8} more`) : null)) : null,
      it.type === 'gear' ? h('button', { type: 'button', class: 'btn primary', onclick: () => act('/api/equip', { item: id }, `${it.name} fitted.`) }, 'Fit to mech') : null,
      h('button', { type: 'button', class: 'btn', onclick: () => { tradePrefill = { give: id }; go('trade'); } }, 'Offer in a trade'));
  }

  // ---------- Abilities ----------
  function abilityClasses() {
    const cls = myClass();
    const set = new Set([cls]);
    const off = G.ITEMS[me.state.equipment.offhand];
    if (off && off.cls) set.add(off.cls);
    return set;
  }
  const abilityUnlocked = ab => (ab.cls === 'generic' ? myCombat() >= ab.level : lvl(G.CLASSES[ab.cls].skill) >= ab.level);

  function abilitiesPage() {
    const loadout = me.state.abilities || { cls: [], generic: null };
    const usable = abilityClasses();
    const save = (clsIds, generic, msg) => act('/api/abilities', { cls: clsIds, generic }, msg);
    const abilityCard = ab => {
      const equipped = ab.cls === 'generic' ? loadout.generic === ab.id : loadout.cls.includes(ab.id);
      const unlocked = abilityUnlocked(ab);
      const allowed = ab.cls === 'generic' || usable.has(ab.cls);
      const full = ab.cls !== 'generic' && loadout.cls.length >= G.ABILITY_SLOTS.cls;
      let button;
      if (equipped) button = h('button', { type: 'button', class: 'btn small', onclick: () => (ab.cls === 'generic' ? save(loadout.cls, null) : save(loadout.cls.filter(x => x !== ab.id), loadout.generic)) }, 'Remove');
      else if (!unlocked) button = h('span', { class: 'lock-note' }, ui('lock', 'sm'), ab.cls === 'generic' ? `Combat level ${ab.level}` : `Level ${ab.level}`);
      else if (!allowed) button = h('span', { class: 'muted small' }, `Needs a ${G.CLASSES[ab.cls].name.toLowerCase()} weapon or off-hand`);
      else button = h('button', { type: 'button', class: 'btn small primary', disabled: full,
        onclick: () => (ab.cls === 'generic' ? save(loadout.cls, ab.id, `${ab.name} equipped.`) : save([...loadout.cls, ab.id], loadout.generic, `${ab.name} equipped.`)) }, full ? 'Slots full' : 'Equip');
      const colour = ab.cls === 'generic' ? '#c3c9d4' : G.CLASSES[ab.cls].colour;
      return h('div', { class: `ability${equipped ? ' equipped' : ''}${unlocked ? '' : ' locked'}` },
        gi('ab_' + ab.id, colour, 'lg'),
        h('div', { class: 'grow' }, h('b', {}, ab.name), h('p', { class: 'small' }, ab.desc),
          h('small', { class: 'muted' }, `${ab.cd ? `${ab.cd}s cooldown` : 'Once per fight'}${ab.mana ? ` · ${ab.mana} mana` : ''}${ab.cast ? ` · ${secs(ab.cast)} cast` : ''}`)),
        button);
    };
    const slot = (id, label) => {
      const ab = id && G.ABILITY_BY_ID[id];
      return h('div', { class: `ab-slot${ab ? ' filled' : ''}` }, ab ? gi('ab_' + ab.id, ab.cls === 'generic' ? '#c3c9d4' : G.CLASSES[ab.cls].colour, 'lg') : h('span', { class: 'ab-empty' }, '+'),
        h('div', {}, h('small', {}, label), h('b', {}, ab ? ab.name : 'Empty')));
    };
    return [
      pageHead('abilities', 'skill-magic', 'Abilities', 'Equip up to two class abilities and one generic ability. Your mech uses them by itself in raids when they’re ready and useful.'),
      h('div', { class: 'ab-slots' }, slot(loadout.cls[0], 'Class ability'), slot(loadout.cls[1], 'Class ability'), slot(loadout.generic, 'Generic ability')),
      h('p', { class: 'muted' }, `You can use abilities from: ${[...usable].map(c => G.CLASSES[c].name).join(', ')}. An off-hand from another class adds that class.`),
      ...Object.values(G.CLASSES).map(c => collapsible(`ab-${c.id}`, `${c.name} abilities`, `level ${lvl(c.skill)}${usable.has(c.id) ? '' : ' · not usable now'}`,
        h('div', { class: 'ability-list' }, G.ABILITIES.filter(a => a.cls === c.id).map(abilityCard)), usable.has(c.id))),
      collapsible('ab-generic', 'Generic abilities', `combat level ${myCombat()}`, h('div', { class: 'ability-list' }, G.ABILITIES.filter(a => a.cls === 'generic').map(abilityCard)), true),
    ];
  }

  // ---------- Subclasses ----------
  function subclassPage() {
    const subs = me.state.subclasses || {};
    const multi = me.state.multi || {};
    return [
      pageHead('subclass', 'skill-healing', 'Subclasses', 'At level 5 in a combat class, pick one of its two subclasses. At level 10 you can instead multiclass: take a subclass from another class you have at level 5.'),
      ...Object.values(G.CLASSES).map(c => {
        const L = lvl(c.skill);
        const current = subs[c.id];
        const options = G.SUBCLASSES.filter(s => s.cls === c.id);
        // Multiclass picks one subclass from another class (level 5 in that class).
        const borrowable = G.SUBCLASSES.filter(s => s.cls && s.cls !== c.id);
        const secondSel = h('select', { 'aria-label': 'Subclass to borrow' }, borrowable.map(s => {
          const ok = lvl(G.CLASSES[s.cls].skill) >= s.level;
          return h('option', { value: s.id, selected: multi[c.id] === s.id || null, disabled: !ok || null }, `${s.name} (${G.CLASSES[s.cls].name}${ok ? '' : `, needs level ${s.level}`})`);
        }));
        const card = (sub, extra) => h('div', { class: `sub-card${current === sub.id ? ' chosen' : ''}${L < sub.level ? ' locked' : ''}` },
          gi('sub_' + sub.id, c.colour, 'xl'),
          h('div', { class: 'grow' }, h('h3', {}, sub.name, current === sub.id ? h('span', { class: 'ok small' }, ' · chosen') : null), h('p', {}, sub.desc),
            sub.id === 'multiclass' && current === 'multiclass' ? h('p', { class: G.resolveSubclass(subs, multi, c.id) ? 'ok small' : 'warn small' },
              G.resolveSubclass(subs, multi, c.id) ? `Using ${G.SUBCLASS_BY_ID[multi[c.id]].name} from ${G.CLASSES[G.SUBCLASS_BY_ID[multi[c.id]].cls].name}.` : 'Pick a subclass to borrow.') : null),
          L < sub.level ? h('span', { class: 'lock-note' }, ui('lock', 'sm'), `Level ${sub.level}`) : h('div', { class: 'actions' }, extra,
            h('button', { type: 'button', class: 'btn small primary', disabled: current === sub.id && sub.id !== 'multiclass',
              onclick: () => act('/api/subclass', { cls: c.id, sub: sub.id, second: secondSel.value }, `${c.name}: ${sub.name}.`) }, current === sub.id ? (sub.id === 'multiclass' ? 'Update' : 'Chosen') : 'Choose')));
        return h('section', { class: 'section' },
          h('div', { class: 'section-head' }, h('h2', {}, classIco(c.id, 'md'), ` ${c.name}`), h('p', {}, `Level ${L}${current ? ` · ${G.SUBCLASS_BY_ID[current].name}` : ' · no subclass yet'}`)),
          h('div', { class: 'sub-grid' }, options.map(s => card(s)), card(G.SUBCLASS_BY_ID.multiclass, secondSel)));
      }),
      h('p', { class: 'muted' }, 'You can change your choice at any time. A subclass only applies while your main-hand weapon is of that class.'),
    ];
  }

  // ---------- Recent fights ----------
  const xpText = xp => Object.entries(xp || {}).map(([k, v]) => `+${num(v)} ${G.SKILL_BY_ID[k] ? G.SKILL_BY_ID[k].name : k}`).join(', ');
  function fightsPage() {
    const log = (me.state.raidLog || []).filter(e => G.RAID_BY_ID[e.raid]);
    return [
      pageHead('fights', 'skill-melee', 'Recent fights', 'Your last 30 raid fights, newest first.'),
      log.length ? h('div', { class: 'history' }, log.map(e => {
        const raid = G.RAID_BY_ID[e.raid];
        const d = G.DIFF_BY_ID[e.diff || 'normal'];
        return h('div', { class: 'history-row' },
          h('span', { class: 'boss-ico' }, foeArt(raid.foe, true, '', 28)),
          h('span', { class: `result ${e.win ? 'ok' : 'bad'}` }, e.win ? 'Victory' : 'Defeat'),
          h('div', { class: 'what' }, h('div', {}, `#${raid.n} ${raid.name}`, d.id !== 'normal' ? h('span', { class: 'diff-tag', style: null }, ` ${d.name}`) : null),
            h('small', {}, `${e.party.length > 1 ? e.party.join(', ') : 'Solo'} · ${fmtTime(e.ms || 0)}${e.deaths ? ` · ${plural(e.deaths, 'death')}` : ''} · ${ago(e.at)}`)),
          h('span', { class: 'loot' }, h('span', { class: 'muted' }, xpText(e.xp)), Object.entries(e.loot || {}).filter(([id]) => G.ITEMS[id]).map(([id, n]) =>
            h('span', { class: G.ITEMS[id].rare ? 'rare-loot' : '', title: G.ITEMS[id].name }, itemIco(id, 'sm'), num(n)))));
      })) : h('div', { class: 'empty' }, 'No fights yet.'),
    ];
  }

  // ---------- Patch notes and credits ----------
  const patchPage = () => [
    pageHead('patch', 'skill-scribing', 'Patch notes', 'What changed in each update.'),
    ...G.PATCH_NOTES.map(p => h('section', { class: 'panel patch' }, h('h2', {}, `Version ${p.v}`, h('small', { class: 'muted' }, ` · ${p.date}`)), h('ul', {}, p.notes.map(n => h('li', {}, n))))),
  ];
  // Rename the pilot (login name, needs the password) and/or the mech, checked as you type with the
  // same rules the server uses.
  function renameForm() {
    const NAME_OK = /^[A-Za-z0-9_]{3,16}$/, MECH_OK = /^[A-Za-z0-9 .'-]{1,24}$/;
    const name = h('input', { type: 'text', value: me.player.name, maxlength: '16', autocomplete: 'off', 'aria-label': 'Pilot name' });
    const mech = h('input', { type: 'text', value: me.player.mech, maxlength: '24', autocomplete: 'off', 'aria-label': 'Mech name' });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Password' });
    const passRow = h('label', { class: 'inline-field', hidden: true }, 'Password (needed to change your pilot name)', pass);
    const msg = h('p', { class: 'small rename-msg' });
    const save = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Save names');
    const check = () => {
      const n = name.value.trim(), m = mech.value.trim().replace(/\s+/g, ' ');
      const nameChanged = n !== me.player.name;
      passRow.hidden = !nameChanged;
      let err = '';
      if (!NAME_OK.test(n)) err = 'Pilot names are 3 to 16 letters, numbers or underscores.';
      else if (!MECH_OK.test(m)) err = 'Mech names are up to 24 letters, numbers, spaces or . ’ -';
      else if (nameChanged && !pass.value) err = 'Enter your password to change your pilot name.';
      msg.textContent = err;
      msg.className = `small rename-msg${err ? ' bad' : ''}`;
      save.disabled = !!err || (!nameChanged && m === me.player.mech);
      return { n, m, nameChanged };
    };
    [name, mech, pass].forEach(el => el.addEventListener('input', check));
    save.addEventListener('click', async () => {
      const { n, m } = check();
      if (save.disabled) return;
      const r = await act('/api/rename', { name: n, mech: m, password: pass.value }, 'Names saved.');
      if (!r) return;
      // The browser's backup follows the pilot to the new name.
      if (r.oldName && r.oldName.toLowerCase() !== r.name.toLowerCase()) { try { localStorage.removeItem(backupKey(r.oldName)); } catch (e) { /* ignore */ } }
      me.player.name = r.name;
      me.player.mech = r.mech;
      await poll();
      await saveBackup();
      renderChrome();
      renderPage();
    });
    return h('div', { class: 'rename stack' },
      h('label', { class: 'inline-field' }, 'Pilot name', name),
      h('label', { class: 'inline-field' }, 'Mech name', mech),
      passRow, msg, h('div', { class: 'actions' }, save));
  }

  function settingsPage() {
    const toggle = (key, label, desc) => h('label', { class: 'setting' },
      h('input', { type: 'checkbox', checked: SETTINGS[key], onchange: e => {
        SETTINGS[key] = e.target.checked;
        store(SETTINGS_KEY, JSON.stringify(SETTINGS));
        applySettings();
        toast('Setting saved.');
      } }),
      h('div', {}, h('b', {}, label), h('small', { class: 'muted' }, desc)));
    const confirmBox = h('input', { type: 'text', placeholder: me.player.name, 'aria-label': 'Type your pilot name to confirm', autocomplete: 'off' });
    const reset = async () => {
      if (confirmBox.value.trim().toLowerCase() !== me.player.name.toLowerCase()) { toast('Type your pilot name exactly to confirm.', 'error'); return; }
      if (!confirm('Reset all your progress? Skills, items, gear and raid clears go back to the start. This can’t be undone.')) return;
      if (await act('/api/reset', { confirm: confirmBox.value }, 'Progress reset. A fresh start!')) { await saveBackup(); go('skill:mining'); }
    };
    const download = async () => {
      try {
        const r = await api('/api/backup');
        const a = h('a', { href: URL.createObjectURL(new Blob([r.backup], { type: 'text/plain' })), download: `mekaidle-${me.player.name}.save` });
        document.body.append(a);
        a.click();
        a.remove();
      } catch (e) { toast('Couldn’t make a backup just now.', 'error'); }
    };
    return [
      pageHead('settings', 'skill-scribing', 'Settings', 'Display options are saved in this browser.'),
      h('section', { class: 'panel stack settings' },
        h('h2', {}, 'Display'),
        toggle('floats', 'Damage and healing numbers', 'Numbers that float up from units in raids.'),
        toggle('groupFloats', 'Group damage numbers', 'Hits of the same type from the same pilot in quick succession add up into one number (with a ×count) instead of stacking.'),
        toggle('auras', 'Effect animations', 'A bubble over shielded units, and blood, poison, embers, frost, shadow or healing sparkles over units with those effects.'),
        toggle('flashes', 'Hit flashes', 'Units flash red when hit, green when healed, and so on.'),
        toggle('shine', 'Item shine', 'The light sweep across rare and high-tier items.'),
        toggle('motion', 'Animations', 'Page transitions, bobbing sprites and other movement.')),
      h('section', { class: 'panel stack settings' },
        h('h2', {}, 'Account'),
        h('p', {}, 'Pilot ', h('b', {}, me.player.name), ' · mech ', h('b', {}, me.player.mech), me.guild ? [' · guild ', h('b', {}, `[${me.guild.tag}] ${me.guild.name}`)] : ''),
        renameForm(),
        h('p', { class: 'muted' }, 'Your save is backed up in this browser automatically. You can also download a copy to keep.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: download }, 'Download save backup'))),
      h('section', { class: 'panel stack settings danger-zone' },
        h('h2', {}, 'Reset progress'),
        h('p', {}, 'Start again from scratch: all skills back to level 1, and your items, gear, abilities, subclasses and raid clears are cleared. Your name, mech, guild and friends stay. Open trade offers are withdrawn.'),
        h('label', { class: 'inline-field' }, 'Type your pilot name to confirm', confirmBox),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn danger', onclick: reset }, 'Reset stats'))),
    ];
  }
  const creditsPage = () => [
    pageHead('credits', 'skill-ranged', 'Credits', null),
    h('section', { class: 'panel stack' },
      h('h2', {}, 'Icons'),
      h('p', {}, `Item, skill, ability, subclass and enemy icons are from game-icons.net, made by ${window.GAME_ICON_AUTHORS.join(', ')}. They are licensed under Creative Commons Attribution 3.0 and are recoloured and, for enemies, redrawn as pixel art in the game.`),
      h('p', {}, h('a', { href: 'https://game-icons.net', target: '_blank', rel: 'noopener' }, 'game-icons.net'), ' · ',
        h('a', { href: 'https://creativecommons.org/licenses/by/3.0/', target: '_blank', rel: 'noopener' }, 'CC BY 3.0 licence')),
      h('h2', {}, 'Item art'),
      h('p', {}, 'Item icons come from a pixel-art icon sprite sheet supplied for the game. Its artist and licence should be credited here.'),
      h('h2', {}, 'Fonts'),
      h('p', {}, 'Inter and Chakra Petch, from Google Fonts (SIL Open Font License).')),
  ];

  // ---------- Raids ----------
  const DIFF_KEY = 'mekaidle-diff';
  const STYLE_NAME = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic' };
  // Who can join your raids: remembered in this browser and applied to every raid you start.
  const VIS_KEY = 'mekaidle-visibility';
  const VIS_LABEL = { private: 'Closed (solo)', friends: 'Friends and guild', public: 'Everyone' };
  const clearsOf = id => (me.state.clears || {})[id] || 0;
  function raidOpen(r, diff) {
    if (diff === 'normal') return r.n <= (me.state.reached || 1) || clearsOf(`r${r.n - 1}`) >= 3;
    return clearsOf(r.id) >= (diff === 'heroic' ? 1 : 2);
  }
  const diffScale = d => Math.sqrt(G.DIFF_BY_ID[d].hp * G.DIFF_BY_ID[d].dmg);
  function diffTag(d) {
    const x = G.DIFF_BY_ID[d || 'normal'];
    const e = h('span', { class: 'diff-tag' }, x.name);
    e.style.setProperty('--diff', x.colour);
    return e;
  }
  function mechChips(mechs) {
    return h('span', { class: 'mech-chips' }, mechs.map(m => tip(h('span', { class: 'mech-chip' }, G.MECHANICS[m].name), () => [h('b', {}, G.MECHANICS[m].name), h('p', { class: 'tip-desc' }, G.MECHANICS[m].desc)])));
  }
  function weakChips(r) {
    const weak = Object.keys(r.res).find(k => r.res[k] > 1);
    const resist = Object.keys(r.res).find(k => r.res[k] < 1);
    return h('span', { class: 'res-chips' },
      h('span', { class: 'res-chip weak' }, `Weak to ${STYLE_NAME[weak].toLowerCase()} and ${r.weakElement}`),
      h('span', { class: 'res-chip resist' }, `Resists ${STYLE_NAME[resist].toLowerCase()}`));
  }

  function memberRow(m, note) {
    const dot = h('span', { class: 'pilot-dot' });
    if (m.colour) dot.style.background = m.colour;
    return h('div', { class: 'member' },
      h('span', { class: `dot ${m.online ? 'online' : 'offline'}`, title: m.online ? 'Online' : 'Offline' }),
      dot,
      h('span', { class: 'name' }, m.name, m.guild ? h('span', { class: 'tag' }, ` [${m.guild}]`) : null),
      note ? h('small', {}, note) : null,
      h('small', {}, `Power ${num(m.power)}`));
  }

  // What a win drops at a difficulty: amounts for guaranteed drops, chances for rare ones.
  function dropText(x, diff) {
    const d = G.DIFF_BY_ID[diff || 'normal'];
    if (x.p) return `${(Math.min(1, x.p * d.drop) * 100).toFixed(1).replace('.0', '')}%`;
    const lo = Math.round(x.qty[0] * d.mats), hi = Math.round(x.qty[1] * d.mats);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  }
  const TYPE_CLASS = { plate: 'melee', leather: 'ranged', cloth: 'magic', vestment: 'healer' };
  const itemClass = it => it && (it.cls || (it.set && G.SET_BY_ID[it.set] && G.SET_BY_ID[it.set].cls) || TYPE_CLASS[it.armour]) || null;
  // Drops shown as chips; `only` picks 'gear' or 'materials' (everything else), or all when unset.
  const isGearDrop = x => G.ITEMS[x.item] && G.ITEMS[x.item].type === 'gear';
  const lootGroup = (label, r, diff, only) => h('div', { class: `loot-group loot-${only}` }, h('small', { class: 'loot-label' }, label), lootIcons(r, diff, only));
  function lootIcons(r, diff, only) {
    const drops = r.drops.filter(x => !only || (only === 'gear') === isGearDrop(x));
    return h('div', { class: 'loot-icons', 'aria-label': 'Drops on a win' }, drops.map(x => {
      const text = dropText(x, diff);
      const cls = itemClass(G.ITEMS[x.item]);
      const need = x.minDiff && G.DIFF_BY_ID[x.minDiff];
      const off = need && G.DIFFICULTIES.indexOf(need) > G.DIFFICULTIES.findIndex(d => d.id === (diff || 'normal'));
      const tag = need ? h('span', { class: 'diff-dot', title: `${need.name}${need.id === 'heroic' ? ' and Mythic' : ''} only` }, need.name[0]) : null;
      if (tag) tag.style.setProperty('--diff', need.colour);
      const chip = h('span', { class: `loot-ico${x.rare ? ' rare' : ''}${cls ? ' class-loot' : ''}${off ? ' off-diff' : ''}` }, itemIco(x.item, 'sm'), h('small', {}, off ? '–' : text), tag);
      if (cls) { chip.style.setProperty('--cls', G.CLASSES[cls].colour); chip.title = `${G.CLASSES[cls].name} gear`; }
      return tip(chip, () => itemTip(x.item, h('p', { class: off ? 'bad' : x.rare ? 'rare-loot' : 'ok' }, off ? `Only drops on ${need.name}${need.id === 'heroic' ? ' or Mythic' : ''}.` : x.p ? `${text} chance per win${need ? ` (${need.name}${need.id === 'heroic' ? ' and Mythic' : ''} only)` : ''}` : `${text} per win`)));
    }));
  }

  function raidRow(r, diff, ctx) {
    const d = G.DIFF_BY_ID[diff];
    const rec = r.recommendedBy ? r.recommendedBy[diff] : Math.round(r.recommended * diffScale(diff));
    const ratio = ctx.power / rec;
    const pClass = ratio >= 1 ? 'ok' : ratio >= 0.8 ? 'warn' : 'bad';
    const pips = h('span', { class: 'clears', title: 'Cleared on Normal, Heroic, Mythic' }, G.DIFFICULTIES.map((x, i) => {
      const s = h('span', { class: `clear-pip${clearsOf(r.id) > i ? ' on' : ''}` });
      s.style.setProperty('--diff', x.colour);
      return s;
    }));
    // One button per difficulty right on the row: fight (or switch to) any unlocked one directly.
    // The next difficulty you haven't cleared is highlighted; the one you're on becomes Stop.
    let buttons;
    const anyOpen = raidOpen(r, 'normal');
    if (!anyOpen) buttons = h('span', { class: 'lock-note' }, ui('lock', 'sm'), `Clear #${r.n - 1} on Mythic`);
    else {
      const member = ctx.party && ctx.party.leader !== me.player.id;
      const leading = ctx.party && !member;
      const cleared = clearsOf(r.id);
      const nextDiff = G.DIFFICULTIES[Math.min(cleared, G.DIFFICULTIES.length - 1)].id;
      const diffBtn = (x, i) => {
        if (ctx.current && ctx.current.raid === r.id && ctx.current.diff === x.id) {
          // The one you're fighting: a tick if it's cleared (a cross otherwise), turning into a cross on hover to stop.
          const stop = h('button', { type: 'button', class: `btn small danger diff-btn fighting-btn${cleared > i ? ' was-done' : ''}`, title: `Fighting on ${x.name}${cleared > i ? ' (cleared)' : ''}. Click to stop.`, onclick: ctx.stop },
            h('span', { class: 'fb-idle' }, cleared > i ? '✓' : ui('close', 'sm')), h('span', { class: 'fb-hover' }, ui('close', 'sm')), x.name);
          stop.style.setProperty('--diff', x.colour);
          return stop;
        }
        const ok = raidOpen(r, x.id);
        const title = !ok ? `Clear it on ${G.DIFFICULTIES[i - 1].name} first` : member ? 'Only the party leader can change the boss'
          : `${leading ? 'Take your party' : ctx.current ? 'Switch' : 'Fight'} on ${x.name}${cleared > i ? ' (cleared)' : ''}`;
        const b = h('button', { type: 'button', class: `btn small diff-btn${x.id === nextDiff && cleared < 3 ? ' next' : ''}${cleared > i ? ' done' : ''}`,
          disabled: !ok || member || null, title, onclick: () => ctx.start(r, x.id) }, ok ? null : ui('lock', 'sm'), x.name);
        b.style.setProperty('--diff', x.colour);
        return b;
      };
      buttons = [h('div', { class: 'diff-btns', role: 'group', 'aria-label': `Fight ${r.name}` }, G.DIFFICULTIES.map(diffBtn)),
        h('button', { type: 'button', class: 'btn small party-btn', disabled: !!ctx.party, title: `Form a party on ${G.DIFF_BY_ID[nextDiff].name} that others can join`, onclick: () => ctx.form(r, nextDiff) }, 'Party')];
    }
    return h('div', { class: `raid-row${ctx.current && ctx.current.raid === r.id ? ' fighting' : ''}${anyOpen ? '' : ' locked'}${r.finale ? ' finale' : ''}` },
      h('span', { class: 'raid-n' }, `#${r.n}`),
      h('span', { class: 'boss-ico' }, bossIcon(r, '', 88)),
      h('div', { class: 'raid-info' }, h('b', {}, r.name, r.finale ? h('span', { class: 'finale-tag' }, 'Finale') : null), h('div', { class: 'raid-chips' }, weakChips(r), mechChips(r.boss.mechs))),
      h('div', { class: 'raid-power', title: 'Your power / recommended' }, h('small', {}, 'Power'), h('b', { class: pClass }, `${fmt(ctx.power)} / ${fmt(rec)}`)),
      lootGroup('Materials', r, diff, 'materials'),
      lootGroup('Equipment', r, diff, 'gear'),
      pips,
      h('div', { class: 'raid-btns' }, buttons));
  }

  function raidsPage() {
    const battle = createBattle();
    const partyBox = h('div'), openBox = h('div'), bossBox = h('div');
    let data = { party: null, open: [] };
    let lastBossSig = null;
    let diff = G.DIFF_BY_ID[store(DIFF_KEY)] ? store(DIFF_KEY) : 'normal';
    const ctx = {
      start: startSolo, stop: () => (battle.onStop ? battle.onStop() : stopRaid()),
      form: (r, d) => { const vis = store(VIS_KEY) && store(VIS_KEY) !== 'private' ? store(VIS_KEY) : 'friends'; return partyAct('/api/party/create', { raid: r.id, diff: d, visibility: vis }, vis === 'public' ? 'Party formed. Anyone can join.' : 'Party formed. Friends and guildmates can join.'); },
    };

    function drawBosses() {
      const a = me.state.activity;
      ctx.current = a && a.type && a.raid ? { raid: a.raid, diff: a.diff || 'normal' } : null;
      ctx.party = data.party;
      ctx.power = G.power(myStats());
      // Only rebuild the list when something it shows has changed: rebuilding every refresh made
      // long lists jump while scrolling.
      const sig = JSON.stringify([diff, me.state.clears, ctx.current, ctx.party && [ctx.party.id, ctx.party.leader], ctx.power, me.state.items, me.state.equipment,
        store('mekaidle-hide-cleared'), store('mekaidle-hide-looted')]);
      if (sig === lastBossSig && bossBox.firstChild) return;
      lastBossSig = sig;
      const dd = G.DIFF_BY_ID[diff];
      const diffBar = h('div', { class: 'diff-bar' },
        h('small', { class: 'diff-bar-label' }, 'Show loot and power for'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Show loot and power for' }, G.DIFFICULTIES.map(x => {
          const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(x.id === diff), onclick: () => { diff = x.id; store(DIFF_KEY, diff); drawBosses(); } }, x.name);
          b.style.setProperty('--chip', x.colour);
          return b;
        })),
        h('span', { class: 'muted small' }, diff === 'normal' ? 'Base rewards. Pick a difficulty on each boss to fight it; clear all three to open the next boss.'
          : `Enemies have ${dd.hp}× HP and hit ${dd.dmg}× harder. ${dd.xp}× XP, ${dd.mats}× materials and ${dd.drop}× rare drop chance.`));
      // One list of every open region, with a header per region. Filters hide bosses cleared on the
      // chosen difficulty, or bosses whose rare loot (set pieces, weapons, trinkets) you all own.
      const owns = id => have(id) > 0 || Object.values(me.state.equipment).includes(id);
      const diffRank = G.DIFFICULTIES.findIndex(x => x.id === diff) + 1;
      const hideCleared = store('mekaidle-hide-cleared') === '1';
      const hideLooted = store('mekaidle-hide-looted') === '1';
      const looted = r => r.drops.filter(x => x.rare).every(x => owns(x.item));
      const check = (key, label, on) => {
        const box = h('input', { type: 'checkbox', checked: on || null, onchange: e => { store(key, e.target.checked ? '1' : '0'); drawBosses(); } });
        return h('label', { class: 'raid-filter' }, box, label);
      };
      const filters = h('div', { class: 'raid-filters' },
        check('mekaidle-hide-cleared', `Hide bosses cleared on ${dd.name}`, hideCleared),
        check('mekaidle-hide-looted', 'Hide bosses whose rare loot I all own', hideLooted));
      const list = [];
      let hidden = 0;
      for (const [ri, reg] of G.REGIONS.entries()) {
        const raids = G.RAIDS.filter(r => r.region === ri);
        const unlocked = raidOpen(raids[0], 'normal');
        const cleared = raids.filter(r => clearsOf(r.id) >= 1).length;
        const head = h('div', { class: 'region-head' }, h('span', { class: 'region-title' }, bossIcon(raids[24]), reg.name),
          h('small', {}, unlocked ? `Tiers ${ri * 8 + 1}\u2013${ri * 8 + 8} \u00b7 ${cleared}/25 cleared` : `Locked \u00b7 beat ${G.REGIONS[ri - 1].finale} (#${ri * 25}) on Mythic to open`));
        head.style.setProperty('--tier', G.TIERS[ri * 8].colour);
        list.push(head);
        const shown = raids.filter(r => !(hideCleared && clearsOf(r.id) >= diffRank) && !(hideLooted && looted(r)));
        hidden += raids.length - shown.length;
        list.push(shown.length ? h('div', { class: 'raid-list' }, shown.map(r => raidRow(r, diff, ctx))) : h('div', { class: 'empty small' }, 'Every boss here is hidden by your filters.'));
      }
      if (hidden) filters.append(h('small', { class: 'muted' }, `${hidden} hidden by filters`));
      bossBox.replaceChildren(h('div', { class: 'section boss-list' }, diffBar, filters, list));
    }

    function visibilityPicker(current, disabled) {
      const sel = h('select', { 'aria-label': 'Who can join', disabled }, Object.entries(VIS_LABEL).map(([v, label]) => h('option', { value: v, selected: v === current || null }, label)));
      sel.addEventListener('change', async () => {
        store(VIS_KEY, sel.value);
        if (await act('/api/raid/open', { visibility: sel.value }, `Party is now open to: ${VIS_LABEL[sel.value].toLowerCase()}.`)) { await poll(); load(); battle.sync(true); }
      });
      return sel;
    }

    function drawParty() {
      const p = data.party;
      if (!p || p.running) partyBox.replaceChildren();
      else {
        const raid = G.RAID_BY_ID[p.raid];
        const leader = p.leader === me.player.id;
        const note = p.running ? `Raiding now · fight ${p.running.n}` : `Breaks up ${fmtTime(p.expires - now())} from now if not started.`;
        partyBox.replaceChildren(section('Your party', note,
          h('div', { class: 'panel party' },
            h('div', { class: 'raid-top' }, h('span', { class: 'boss-ico' }, bossIcon(raid)),
              h('div', { class: 'raid-title' }, h('small', { class: 'muted' }, `#${raid.n} · ${raid.regionName}`), h('h3', {}, raid.name, ' ', diffTag(p.diff))),
              h('span', { class: 'muted' }, plural(p.members.length, 'pilot'))),
            h('div', { class: 'member-list' }, p.members.map(m => {
              const row = memberRow(m, m.id === p.leader ? 'Leader' : null);
              if (leader && m.id !== me.player.id) row.append(h('button', { type: 'button', class: 'btn small', onclick: () => partyAct('/api/party/kick', { id: m.id }, `${m.name} removed from the party.`) }, 'Kick'));
              return row;
            })),
            h('label', { class: 'inline-field' }, 'Who can join', visibilityPicker(p.visibility, !leader)),
            h('p', { class: 'muted small' }, 'Enemies get tougher with every pilot, slightly less than one pilot’s worth, so a party clears faster and more safely than solo. Guardians draw attacks and healers keep everyone standing.'),
            h('div', { class: 'actions' },
              leader && !p.running ? h('button', { type: 'button', class: 'btn primary', onclick: () => partyAct('/api/party/start', {}, 'Party raid started.') }, 'Start raiding') : null,
              leader && p.running ? h('button', { type: 'button', class: 'btn', onclick: () => partyAct('/api/party/stop', {}, 'Party raid stopped.') }, 'Stop raiding') : null,
              !leader ? h('span', { class: 'muted' }, p.running ? 'Fighting with the party.' : 'Waiting for the leader to start.') : null,
              h('button', { type: 'button', class: 'btn danger', onclick: () => partyAct('/api/party/leave', {}, p.members.length > 1 && leader ? 'You left the party. The next pilot now leads it.' : p.members.length > 1 ? 'You left the party.' : 'Party disbanded.') }, p.members.length > 1 ? 'Leave party' : 'Disband')))));
      }
      // Only shown when there's a party you can join.
      if (!data.open.length) { openBox.replaceChildren(); return; }
      openBox.replaceChildren(section('Open parties', `${data.open.length} you can join`,
        h('div', { class: 'list' }, data.open.map(o => {
          const raid = G.RAID_BY_ID[o.raid];
          const lead = o.members.find(m => m.id === o.leader) || o.members[0];
          return h('div', { class: 'row' },
            h('span', { class: 'boss-ico' }, bossIcon(raid)),
            h('div', { class: 'grow' }, h('div', { class: 'name' }, `${lead ? lead.name : 'Someone'}’s party `, diffTag(o.diff)),
              h('small', {}, `#${raid.n} ${raid.name} · ${plural(o.members.length, 'pilot')}${o.running ? ' · raiding now' : ''}${o.visibility === 'public' ? ' · open to everyone' : ''}`)),
            h('button', { type: 'button', class: 'btn small primary', disabled: !!data.party, onclick: () => partyAct('/api/party/join', { id: o.id }, 'Joined the party.') }, 'Join'));
        }))));
    }

    async function load() {
      try {
        data = await api('/api/raids');
        drawParty();
        drawBosses();
      } catch (e) { /* shown on next action */ }
    }
    async function partyAct(path, body, msg) {
      if (await act(path, body, msg)) { await poll(); load(); battle.sync(true); }
    }
    async function startSolo(r, d) {
      const moving = data.party && data.party.leader === me.player.id;
      if (await act('/api/raid/start', { raid: r.id, diff: d }, moving ? `Your party moves to ${r.name}.` : `Fighting ${r.name}. Fights repeat until you stop.`)) {
        const vis = store(VIS_KEY);
        if (!moving && vis && vis !== 'private') await act('/api/raid/open', { visibility: vis });
        load(); battle.sync(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
    async function stopRaid() {
      if (await act('/api/action/stop', { what: 'raid' }, 'Stopped fighting.')) { load(); battle.sync(true); }
    }
    battle.onStop = () => {
      const a = me.state.activity;
      if (a && a.type === 'party') {
        const p = data.party;
        return partyAct(p && p.leader === me.player.id ? '/api/party/stop' : '/api/party/leave', {}, p && p.leader === me.player.id ? 'Party raid stopped.' : 'You left the party.');
      }
      return stopRaid();
    };
    battle.onChange = () => load();
    battle.onLeave = n => partyAct('/api/party/leave', {}, n > 1 ? 'You left the party. The next pilot now leads it.' : 'Party disbanded.');

    pageRefresh = load;
    pageTick = () => battle.sync();
    pageCleanup = () => battle.destroy();
    drawBosses();
    drawParty();
    load();
    battle.sync();
    return [
      pageHead('raids', 'skill-melee', 'Raids', 'Pick a raid and press Fight. Fights repeat on their own, even while you’re away, until you stop or start a skill. Each fight is a few waves of enemies, then the boss.'),
      openBox, battle.el, partyBox, bossBox,
    ];
  }

  // ---------- Battle panel ----------
  // Replays the current fight's timeline in step with the server clock. Every cast bar finishes
  // on the frame its hit or heal lands. Numbers take the colour of the dealer's class.
  const fmtClock = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const HEAL_KINDS = ['heal', 'hot', 'potion', 'leech'];
  const METER_MODES = [['dps', 'DPS', true], ['hps', 'HPS', true], ['taken', 'Damage taken', false], ['mit', 'Mitigated', false]];
  const LOG_FILTERS = [['all', 'All'], ['abilities', 'Abilities & potions'], ['kills', 'Kills & deaths'], ['loot', 'Loot']];
  const ABILITY_NAMES = new Set(G.ABILITIES.map(a => a.name));
  let meterMode = METER_MODES.some(m => m[0] === store('mekaidle-meter')) ? store('mekaidle-meter') : 'dps';
  let logFilter = 'all';
  const niceMax = v => {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return [1, 2, 2.5, 5, 10].map(m => m * p).find(m => m >= v);
  };
  const clockOf = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // The raid log belongs to a raid session, not to the panel: it survives page rebuilds and new
  // fights, and is cleared only when the session ends or a different one starts.
  const BLOG = { key: null, items: [], counts: { all: 0, abilities: 0, kills: 0, loot: 0 }, lastLootAt: null, list: null, fight: null, upTo: 0 };
  function resetLog(key) {
    BLOG.key = key;
    BLOG.items.length = 0;
    Object.keys(BLOG.counts).forEach(k => { BLOG.counts[k] = 0; });
    BLOG.fight = null;
    BLOG.upTo = 0;
    if (BLOG.list) BLOG.list.replaceChildren();
  }
  // Short stat lines for hover cards ("1,234 damage/s").
  // Totals keep percentages as fractions (0.05 = 5%).
  const FRACTION_STATS = new Set(['crit', 'critDmg', 'heal', 'haste', 'pen', 'block', 'double', 'bleed', 'burn', 'poison', 'fire', 'frost', 'shock', 'lifesteal', 'enemyDmg']);
  const statText = (k, v) => G.STATS[k].fmt(FRACTION_STATS.has(k) ? Math.round(v * 1000) / 10 : Math.round(v * 10) / 10).replace(/^\+/, '');
  function pilotTip(p) {
    const st = p.stats || {};
    const sub = p.subclass && G.SUBCLASS_BY_ID[p.subclass];
    return [
      h('div', { class: 'tip-head' }, classIco(p.cls, 'md'), h('div', {}, h('b', {}, p.name),
        h('small', {}, `${G.CLASSES[p.cls].name}${sub ? ` · ${sub.name}` : ''}${p.multi ? ` + ${G.CLASSES[p.multi].name}` : ''} · power ${num(G.power(st))}`))),
      h('ul', { class: 'tip-stats' }, STAT_ORDER.filter(k => st[k] && G.STATS[k] && k !== 'power').map(k => h('li', { class: statClass(k) }, statText(k, st[k])))),
    ];
  }
  const DTYPE_NAME = { physical: 'physical', magic: 'magic', fire: 'fire', frost: 'frost', shock: 'shock', poison: 'poison' };
  function foeTip(x) {
    const role = x.boss ? 'Boss' : x.role && G.TRASH_ROLES[x.role] ? G.TRASH_ROLES[x.role].name : 'Enemy';
    return [
      h('div', { class: 'tip-head' }, h('div', {}, h('b', {}, x.name), h('small', {}, role))),
      h('ul', { class: 'tip-stats' },
        h('li', { class: 'stat-hp' }, `${num(x.max)} HP`),
        x.dps ? h('li', { class: 'stat-atk' }, `${num(x.dps)} ${DTYPE_NAME[x.dtype] || 'physical'} damage/s`) : null,
        x.cast ? h('li', { class: 'stat-muted' }, `Attacks every ${secs(x.cast)}`) : null,
        x.def != null ? h('li', { class: 'stat-def' }, `${num(x.def)} armour`) : null,
        x.mres != null ? h('li', { class: 'stat-def' }, `${num(x.mres)} magic resist`) : null,
        x.eres != null ? h('li', { class: 'stat-def' }, `${num(x.eres)} elemental resist`) : null),
      x.mechs && x.mechs.length ? h('div', { class: 'tip-desc' }, mechChips(x.mechs)) : null,
    ];
  }
  // Under a pilot's bars: fitted gear (left), abilities and subclass (right), each with a hover card.
  function pilotKit(p, abRefs) {
    const gear = G.SLOTS.map(sl => p.gear && p.gear[sl.id]).filter(id => id && G.ITEMS[id])
      .map(id => tip(h('span', { class: 'kit-item' }, itemIco(id, 'sm')), () => itemTip(id)));
    const abs = (p.abilities || []).map(id => G.ABILITY_BY_ID[id]).filter(Boolean).map(ab => {
      const time = h('small', { class: 'cd-time', 'aria-hidden': 'true' });
      const el = h('span', { class: 'kit-ab' }, gi('ab_' + ab.id, ab.cls === 'generic' ? '#c3c9d4' : G.CLASSES[ab.cls].colour, 'sm'), h('span', { class: 'cd-sweep' }), time);
      if (abRefs) abRefs[ab.id] = { el, time, shown: '' };
      return tip(el,
        () => [h('b', {}, ab.name), h('p', { class: 'tip-desc' }, ab.desc),
          h('small', { class: 'muted' }, `${ab.cd ? `${ab.cd}s cooldown` : 'Once per fight'}${ab.mana ? ` · ${ab.mana} mana` : ''}`)]);
    });
    const sub = p.subclass && G.SUBCLASS_BY_ID[p.subclass];
    const subEl = sub ? tip(h('span', { class: 'kit-sub' }, gi('sub_' + sub.id, G.CLASSES[p.cls].colour, 'sm')),
      () => [h('b', {}, sub.name), p.multi ? h('small', { class: 'muted' }, ` · also ${G.CLASSES[p.multi].name}`) : null, h('p', { class: 'tip-desc' }, sub.desc)]) : null;
    return h('div', { class: 'unit-kit' }, h('div', { class: 'kit-gear' }, gear), h('div', { class: 'kit-right' }, abs, subEl));
  }

  function createBattle() {
    const root = h('section', { class: 'battle', 'aria-label': 'Current raid fight' });
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const self = { el: root, sync, destroy, onStop: null, onChange: null, onLeave: null };
    let cur = null, raf = 0, fetching = false, idx = 0, quiet = false, asked = false;
    let party = [], foes = {}, foeBox, waveEl, clockEl, statusEl, meterList, meterRows = [], graphBox, graphSvg, graphAxisY, graphAxisX, graphCursor, graphTip;
    let stats = [], buckets = {}, lastMeter = 0, lastSec = -1, graphData = null, lastGraph = 0, meterOrder = '', graphEls = null, graphTop = 0, graphFinal = false;
    const graphUid = Math.random().toString(36).slice(2, 8);
    const expanded = new Set();
    const logItems = BLOG.items;
    if (!BLOG.list) BLOG.list = h('ol', { class: 'log-list', 'aria-live': 'off' });
    const logList = BLOG.list;
    let logMuted = false, muteBelow = 0, sessionLootEl = null;

    function destroy() { cancelAnimationFrame(raf); document.body.classList.remove('dock-open', 'dock-closed'); }
    // Meter, graph and raid log in one panel pinned to the bottom of the screen, so nothing above
    // it moves when enemies join a fight. It collapses to a header and remembers its state.
    function battleDock(side, log) {
      const setOpen = open => {
        store('mekaidle-dock', open ? '1' : '0');
        dock.classList.toggle('open', open);
        document.body.classList.toggle('dock-open', open);
        document.body.classList.toggle('dock-closed', !open);
        toggle.setAttribute('aria-expanded', String(open));
      };
      const toggle = h('button', { type: 'button', class: 'dock-head', onclick: () => setOpen(!dock.classList.contains('open')) },
        ui('menu', 'sm'), h('span', {}, 'Damage meter, graph and raid log'), h('small', { class: 'muted' }, 'click to show or hide'));
      const dock = h('section', { class: 'battle-dock', 'aria-label': 'Fight details' }, toggle, h('div', { class: 'dock-body' }, side, log));
      const bar = document.getElementById('action-bar');
      document.documentElement.style.setProperty('--ab-h', `${bar && !bar.hidden ? bar.offsetHeight : 0}px`);
      setOpen(store('mekaidle-dock') !== '0');
      return dock;
    }

    // ----- Fight log -----
    function who(i) {
      const u = party[i];
      const b = h('b', { class: 'log-who' }, u ? u.name : '?');
      if (u) b.style.color = u.colour;
      return b;
    }
    const foeName = id => h('b', { class: 'log-foe' }, foes[id] ? foes[id].name : 'an enemy');
    // Each entry: an icon, the time on the fight clock (or the time of day for loot), and text.
    const LOG_ICON = { wave: ['flag', '#f2c14e'], fight: ['nav_raids', '#f2c14e'], kill: ['sk_melee', '#c3c9d4'], death: ['skull', '#ff7a6b'],
      respawn: ['sk_healing', '#4ee08f'], win: ['crown', '#3ddc84'], danger: ['power', '#ff9a8a'], summary: ['nav_fights', '#9cc4ff'], crit: ['power', '#ffd24a'] };
    const ABILITY_ID = Object.fromEntries(G.ABILITIES.map(a => [a.name, a.id]));
    const logCounts = BLOG.counts;
    const tabRefs = {};
    function addLog(at, kind, parts, cls, icon) {
      if (logMuted) return;
      const inFight = cur && at >= cur.start && at <= cur.start + cur.fight.ms + 60000;
      const ic = icon || (LOG_ICON[cls] ? gi(LOG_ICON[cls][0], LOG_ICON[cls][1], 'sm') : null);
      const li = h('li', { class: `log-${cls || kind}` }, h('time', { title: clockOf(at) }, inFight ? fmtClock(at - cur.start) : clockOf(at).slice(0, 5)), h('span', { class: 'log-ico' }, ic), h('span', { class: 'log-text' }, parts));
      logItems.push({ kind, li });
      logCounts.all++;
      logCounts[kind] = (logCounts[kind] || 0) + 1;
      if (logItems.length > 400) { const old = logItems.shift(); old.li.remove(); logCounts.all--; logCounts[old.kind]--; }
      if (logFilter === 'all' || logFilter === kind) logList.prepend(li);
      drawTabCounts();
    }
    function drawTabCounts() {
      Object.entries(tabRefs).forEach(([id, el]) => { el.textContent = logCounts[id] ? String(logCounts[id]) : ''; });
    }
    function drawLog() {
      logList.replaceChildren(...logItems.filter(x => logFilter === 'all' || x.kind === logFilter).map(x => x.li).reverse());
    }
    function logPanel() {
      const tabs = h('div', { class: 'chips small', role: 'group', 'aria-label': 'Filter the log' }, LOG_FILTERS.map(([id, label]) => {
        tabRefs[id] = h('span', { class: 'chip-count' });
        return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(logFilter === id), onclick: e => {
          logFilter = id;
          tabs.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
          drawLog();
        } }, label, tabRefs[id]);
      }));
      drawTabCounts();
      return h('div', { class: 'battle-cell dock-log' }, h('div', { class: 'cell-head' }, h('h3', {}, 'Raid log'), h('small', { class: 'muted' }, 'newest first')), h('div', { class: 'log' }, tabs, h('div', { class: 'log-scroll' }, logList)));
    }
    // A closing line for each fight: result, time, damage, healing, deaths and the top pilot.
    function fightSummary(e, at) {
      const dealt = stats.reduce((a, x) => a + x.dps, 0), healed = stats.reduce((a, x) => a + x.hps, 0);
      const secsF = Math.max(1, e.t / 1000);
      let top = 0;
      stats.forEach((x, i) => { if (x.dps > stats[top].dps) top = i; });
      const bits = [`${fmtClock(e.t)} \u00b7 ${num(dealt)} damage (${num(dealt / secsF)}/s)`];
      if (healed) bits.push(`${num(healed)} healing`);
      if (downs) bits.push(plural(downs, 'pilot down'));
      addLog(at, 'kills', [h('b', { class: e.win ? 'ok' : 'bad' }, e.win ? 'Fight won' : 'Fight lost'), ` \u00b7 ${bits.join(' \u00b7 ')}`,
        party.length > 1 ? [' \u00b7 top: ', who(top), ` ${num(stats[top].dps / secsF)} DPS`] : ''], 'summary');
    }
    let downs = 0;
    // Loot and XP arrive with the next poll after a fight ends.
    function checkLoot() {
      const e = me && me.state.raidLog && me.state.raidLog[0];
      if (!e) return;
      if (BLOG.lastLootAt === null) { BLOG.lastLootAt = e.at; return; }
      if (e.at <= BLOG.lastLootAt) return;
      me.state.raidLog.filter(x => x.at > BLOG.lastLootAt).reverse().forEach(x => {
        const raid = G.RAID_BY_ID[x.raid];
        const loot = Object.entries(x.loot || {}).filter(([id]) => G.ITEMS[id]);
        addLog(x.at, 'loot', [h('b', { class: x.win ? 'ok' : 'bad' }, x.win ? 'Loot' : 'No loot'), ` from ${raid ? raid.name : 'a raid'}: ${xpText(x.xp)}`,
          loot.length ? ' · ' : '', loot.map(([id, n]) => h('span', { class: `log-loot${G.ITEMS[id].rare ? ' rare-loot' : ''}` }, itemIco(id, 'sm'), `${num(n)} `, itemName(id)))], 'loot');
      });
      BLOG.lastLootAt = e.at;
    }

    function idle() {
      cancelAnimationFrame(raf);
      cur = null;
      // No fight: nothing to show. The log belongs to a raid, so leaving clears it.
      resetLog(null);
      root.replaceChildren();
      root.hidden = true;
      document.body.classList.remove('dock-open', 'dock-closed');
    }

    async function sync(force) {
      const a = me && me.state.activity;
      // Loot only goes in the log while you're raiding; outside a raid just note what's been seen.
      if (a && a.type) {
        const key = `${a.type}:${a.party || ''}:${a.raid}:${a.diff}:${a.began || ''}`;
        if (BLOG.key !== key) resetLog(key);
        checkLoot();
        drawSessionLoot();
      }
      else if (me && me.state.raidLog && me.state.raidLog[0]) BLOG.lastLootAt = me.state.raidLog[0].at;
      if (!a || !a.type) { if (cur || !root.firstChild || BLOG.key) idle(); return; }
      if (!force && cur && cur.n === a.n && cur.start === a.start) return;
      if (fetching) return;
      fetching = true;
      try {
        const r = await api('/api/raid/current');
        if (r.current && r.current.fight && r.current.fight.events) load(r.current); else idle();
      } catch (e) { /* retried on the next poll */ } finally { fetching = false; }
    }

    // ----- Units -----
    function makeUnit(o) {
      const floats = h('div', { class: 'floats', 'aria-hidden': 'true' });
      const bob = h('span', { class: 'bob' }, o.art);
      bob.style.animationDelay = `-${(Math.random() * 3).toFixed(2)}s`;
      const fxEl = h('span', { class: 'fx' }, o.art);
      bob.replaceChildren(fxEl);
      const actEl = h('span', { class: 'act' }, bob);
      const auras = h('span', { class: 'auras', 'aria-hidden': 'true' }, h('span', { class: 'aura-bubble' }),
        h('span', { class: 'aura-parts' }, Array.from({ length: 6 }, (_, i) => { const p = h('i'); p.style.setProperty('--i', String(i)); return p; })));
      const artBox = h('div', { class: 'unit-art' }, actEl, auras);
      const hpFill = h('span', { class: 'hp-fill' }), hpTrail = h('span', { class: 'hp-trail' }), hpShield = h('span', { class: 'hp-shield' }), hpText = h('b');
      const hpBar = h('div', { class: 'hpbar' }, hpTrail, hpFill, hpShield, hpText);
      const manaFill = h('span');
      const manaBar = o.enemy ? null : h('div', { class: 'manabar', title: 'Mana' }, manaFill);
      const castFill = h('span'), castText = h('b');
      const castBar = h('div', { class: 'castbar idle' }, castFill, castText);
      const statusPos = h('div', { class: 'status-pos' }), statusNeg = h('div', { class: 'status-neg' });
      const statuses = h('div', { class: 'statuses' }, statusPos, statusNeg);
      const el = h('div', { class: `unit${o.enemy ? ' enemy' : ' pilot'}${o.boss ? ' boss' : ''}` }, artBox,
        h('div', { class: 'unit-info' },
          statuses,
          h('div', { class: 'unit-name' }, o.cls ? classIco(o.cls) : null, h('span', { class: 'unit-label' }, o.name), o.sub || null, o.kick || null),
          hpBar, manaBar, castBar, o.kit || null),
        floats);
      if (o.tipFn) tip(artBox, o.tipFn);
      if (o.colour) el.style.setProperty('--series', o.colour);
      const u = { ...o, el, artBox, actEl, fxEl, floats, hpFill, hpTrail, hpShield, hpText, hpBar, manaFill, castFill, castText, castBar, statuses, statusPos, statusNeg, hp: o.max, barrier: 0, cast: null, down: false, buffs: {}, mana: o.maxMana };
      drawHp(u);
      drawMana(u);
      return u;
    }
    function drawHp(u) {
      const f = Math.max(0, Math.min(1, u.hp / u.max));
      u.hpFill.style.width = f * 100 + '%';
      u.hpTrail.style.width = f * 100 + '%';
      const sh = Math.min(1 - f, u.barrier / u.max);
      u.hpShield.style.left = f * 100 + '%';
      u.hpShield.style.width = Math.max(0, sh) * 100 + '%';
      u.hpBar.classList.toggle('low', f < 0.3);
      u.hpText.textContent = `${num(Math.max(0, u.hp))} / ${num(u.max)}${u.barrier >= 1 ? ` +${num(u.barrier)}` : ''}`;
    }
    function drawMana(u) {
      if (!u.maxMana) return;
      u.manaFill.style.width = `${Math.max(0, Math.min(1, u.mana / u.maxMana)) * 100}%`;
    }
    // Where a number pops up. Numbers on an enemy go in a grid with one cell per pilot (so in a big
    // party each pilot's hits land in their own spot), jittered a little inside the cell.
    function floatSpot(slot) {
      if (slot == null || party.length < 2) return [15 + Math.random() * 70, Math.random() * 45];
      const n = party.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      const col = slot % cols, row = Math.floor(slot / cols) % rows;
      const cw = 80 / cols, rh = 62 / rows;
      return [10 + (col + 0.5 + (Math.random() - 0.5) * 0.6) * cw, (row + 0.15 + Math.random() * 0.5) * rh];
    }
    function float(u, value, label, colour, big, kind, slot) {
      if (quiet || !SETTINGS.floats) return;
      // Grouping: a hit of the same type from the same pilot shortly after joins the number already
      // showing (summed, with a ×count) instead of stacking another box on top. Crits stay separate.
      const key = `${slot}|${label}|${kind}`;
      u.floatGroups = u.floatGroups || new Map();
      const g = SETTINGS.groupFloats && !big && u.floatGroups.get(key);
      const amount = parseFloat(String(value).replace(/[^0-9.]/g, '')) || 0;
      if (g && g.el.isConnected && performance.now() - g.at < 600) {
        g.total += amount;
        g.count++;
        g.b.textContent = `${String(value).startsWith('+') ? '+' : ''}${num(Math.round(g.total))}`;
        if (g.small) g.small.textContent = `${label} ×${g.count}`;
        g.b.classList.remove('bump'); void g.b.offsetWidth; g.b.classList.add('bump');
        return;
      }
      if (u.floats.childElementCount > Math.max(8, party.length * 3)) u.floats.firstElementChild.remove();
      // Kinds get a prefix so general classes (like .dot) can't restyle the number boxes.
      const s = h('span', { class: `float${kind ? ` fk-${kind}` : ''}${big ? ' big' : ''}` }, h('b', {}, value), label ? h('small', {}, label) : null);
      const [x, y] = floatSpot(slot);
      s.style.left = `${x}%`;
      s.style.top = `${y}%`;
      s.style.setProperty('--fc', colour);
      u.floats.append(s);
      if (!big) u.floatGroups.set(key, { el: s, b: s.firstChild, small: label ? s.lastChild : null, total: amount, count: 1, at: performance.now() });
      setTimeout(() => s.remove(), 1400);
    }
    // A colour flash for what's happening: poison purple, healing green, fire orange, and so on.
    const FX_OF_TYPE = { Poison: 'poison', Venom: 'poison', Fire: 'burn', Burn: 'burn', Prismatic: 'burn', Frost: 'frost', Shock: 'shock',
      Bleed: 'bleed', Shadow: 'shadow', Drain: 'mana', Holy: 'holy', Magic: 'shadow' };
    function flash(u, kind) {
      if (quiet || reduced || !SETTINGS.flashes || !u || !u.fxEl) return;
      const t0 = performance.now();
      if (u.lastFlash && t0 - u.lastFlash < 600) return;
      u.lastFlash = t0;
      u.fxEl.className = 'fx';
      void u.fxEl.offsetWidth; // restart the animation
      u.fxEl.className = `fx fx-${kind}`;
    }
    function pulse(u, cls) {
      if (quiet || reduced) return;
      const el = cls === 'glow' ? u.el : cls === 'lunge' || cls === 'cast-flash' ? u.actEl : u.artBox;
      el.classList.remove(cls);
      void el.offsetWidth; // restart the animation
      el.classList.add(cls);
    }
    const unitOf = k => (typeof k === 'number' ? party[k] : foes[k]);
    function castLabel(e) {
      if (e.tg === 'all') return `${e.n} → ${typeof e.a === 'number' && e.k !== 'heal' ? 'all enemies' : 'everyone'}`;
      const t = unitOf(e.tg);
      return t && t !== unitOf(e.a) ? `${e.n} → ${t.name}` : e.n;
    }

    // ----- Loading a fight -----
    function step() {
      const i = idx++;
      logMuted = i < muteBelow;
      apply(cur.fight.events[i]);
      logMuted = false;
      if (BLOG.fight === cur.start && i >= BLOG.upTo) BLOG.upTo = i + 1;
    }
    // Everything this session has dropped for you so far.
    function drawSessionLoot() {
      if (!sessionLootEl || !cur) return;
      const sl = me.state.sessionLoot;
      const mine = sl && sl.began === cur.began ? sl : null;
      const items = mine ? Object.entries(mine.items).filter(([id, n]) => G.ITEMS[id] && n > 0)
        .sort((a, b) => (G.ITEMS[b[0]].rare ? 1 : 0) - (G.ITEMS[a[0]].rare ? 1 : 0)) : [];
      const sig = JSON.stringify([items, mine && mine.fights]);
      if (sessionLootEl.dataset.sig === sig) return;
      sessionLootEl.dataset.sig = sig;
      sessionLootEl.replaceChildren(h('small', {}, 'Loot this session'),
        items.length ? h('div', { class: 'loot-icons' }, items.map(([id, n]) => tip(h('span', { class: `loot-ico${G.ITEMS[id].rare ? ' rare-loot' : ''}` }, itemIco(id, 'sm'), h('b', {}, num(n))), () => itemTip(id))))
          : h('span', { class: 'muted small' }, 'Nothing yet'),
        mine ? h('span', { class: 'muted small session-count' }, `${mine.wins}/${mine.fights} fights won`) : null);
    }

    function load(c) {
      cancelAnimationFrame(raf);
      root.hidden = false;
      cur = c;
      idx = 0;
      asked = false;
      lastSec = -1;
      lastGraph = 0;
      graphFinal = false;
      const f = c.fight;
      const raid = G.RAID_BY_ID[f.raid];
      const info = c.partyInfo;
      const leader = !c.party || c.leader === me.player.id;
      muteBelow = BLOG.fight === c.start ? BLOG.upTo : 0;
      const newFight = BLOG.fight !== c.start;
      if (newFight) { BLOG.fight = c.start; BLOG.upTo = 0; }
      party = f.fighters.map((p, i) => {
        const abRefs = {};
        const colour = G.CLASSES[p.cls].colour;
        const kick = c.party && leader && p.id !== me.player.id
          ? h('button', { type: 'button', class: 'icon-btn tiny kick', title: 'Remove from party', 'aria-label': `Remove ${p.name} from the party`, onclick: () => kick_(p) }, ui('close', 'sm')) : null;
        return makeUnit({ i, id: p.id, name: p.name, cls: p.cls, colour, max: p.max, maxMana: p.mana, art: mechArt(p.gear || {}, `${p.name}’s mech`), kick,
          sub: p.subclass ? h('small', { class: 'unit-sub' }, G.SUBCLASS_BY_ID[p.subclass].name) : null, kit: pilotKit(p, abRefs), tipFn: () => pilotTip(p), abRefs, cds: {} });
      });
      stats = f.fighters.map(() => ({ dps: 0, hps: 0, taken: 0, mit: 0, src: { dps: {}, hps: {}, taken: {}, mit: {} } }));
      buckets = Object.fromEntries(METER_MODES.map(([m]) => [m, f.fighters.map(() => [])]));
      foes = {};
      foeBox = h('div', { class: 'foe-list' });
      waveEl = h('div', { class: 'wave-track', 'aria-live': 'polite' });
      clockEl = h('span', { class: 'battle-clock' }, '0:00');
      statusEl = h('span', { class: 'battle-status' });

      const stopLabel = !c.party ? 'Stop' : leader ? 'Stop party raid' : 'Leave party';
      const vis = leader
        ? (() => {
          const sel = h('select', { 'aria-label': 'Who can join this raid' }, Object.entries(VIS_LABEL).map(([v, label]) => h('option', { value: v, selected: v === (c.party && info ? info.visibility : 'private') || null }, label)));
          sel.addEventListener('change', async () => {
            store(VIS_KEY, sel.value);
            if (!c.party && sel.value === 'private') return;
            if (await act('/api/raid/open', { visibility: sel.value }, sel.value === 'private' ? 'Party closed to new pilots.' : `Raid open to ${VIS_LABEL[sel.value].toLowerCase()}.`)) {
              await poll();
              sync(true);
              if (self.onChange) self.onChange();
            }
          });
          return h('label', { class: 'vis-pick' }, ui('social', 'sm'), sel);
        })()
        : h('span', { class: 'muted small' }, info ? VIS_LABEL[info.visibility] : '');

      // Damage meter.
      meterRows = f.fighters.map((p, i) => {
        const fill = h('span'), val = h('span', { class: 'meter-val' }), detail = h('div', { class: 'meter-detail', hidden: true }), rank = h('span', { class: 'meter-rank' }, String(i + 1));
        fill.style.background = party[i].colour;
        const btn = h('button', { type: 'button', class: 'meter-row', 'aria-expanded': String(expanded.has(p.id)), onclick: () => {
          if (expanded.has(p.id)) expanded.delete(p.id); else expanded.add(p.id);
          btn.setAttribute('aria-expanded', String(expanded.has(p.id)));
          drawMeter(Math.min(now() - cur.start, cur.fight.ms));
        } }, h('div', { class: 'meter-name' }, rank, classIco(p.cls), h('span', { class: 'grow' }, p.name), val), h('div', { class: 'meter-bar' }, fill));
        const item = h('div', { class: 'meter-item' }, btn, detail);
        item.style.setProperty('--series', party[i].colour);
        return { item, btn, fill, val, detail, rank, i, id: p.id, disp: 0 };
      });
      meterList = h('div', { class: 'meter' }, meterRows.map(r => r.item));
      meterOrder = '';
      graphEls = null;
      graphTop = 0;
      const modeTabs = h('div', { class: 'chips small', role: 'group', 'aria-label': 'Meter mode' }, METER_MODES.map(([id, label]) =>
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(meterMode === id), onclick: e => {
          meterMode = id;
          store('mekaidle-meter', id);
          modeTabs.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === e.currentTarget)));
          const clock = Math.min(now() - cur.start, cur.fight.ms);
          drawMeter(clock);
          drawGraph(clock);
        } }, label)));

      // Graph: the SVG stretches to fit, axis labels are HTML so they never distort.
      graphSvg = h('div', { class: 'graph-plot' });
      graphAxisY = h('div', { class: 'graph-y' });
      graphAxisX = h('div', { class: 'graph-x' });
      graphCursor = h('div', { class: 'graph-cursor', hidden: true });
      graphTip = h('div', { class: 'graph-tip', hidden: true });
      const plotWrap = h('div', { class: 'graph-area' }, graphSvg, graphCursor, graphTip);
      plotWrap.addEventListener('mousemove', e => hoverGraph(e, plotWrap));
      plotWrap.addEventListener('mouseleave', () => { graphCursor.hidden = true; graphTip.hidden = true; });
      graphBox = h('div', { class: 'graph', role: 'img', 'aria-label': 'Per-second values over time for each pilot' }, graphAxisY, plotWrap, graphAxisX);

      root.replaceChildren(
        h('header', { class: 'battle-head' },
          h('span', { class: 'boss-ico' }, bossIcon(raid)),
          h('div', { class: 'battle-title' },
            h('small', {}, `#${raid.n} · ${raid.regionName} · ${c.party ? `Party of ${f.fighters.length}` : 'Solo'} · Fight ${c.n}`),
            h('h2', {}, raid.name, ' ', diffTag(c.diff))),
          h('div', { class: 'battle-meta' }, statusEl, clockEl),
          h('div', { class: 'battle-actions' }, vis,
            c.party && leader ? h('button', { type: 'button', class: 'btn small', onclick: () => self.onLeave && self.onLeave(f.fighters.length) }, f.fighters.length > 1 ? 'Leave party' : 'Disband') : null,
            h('button', { type: 'button', class: 'btn small danger', onclick: () => self.onStop && self.onStop() }, stopLabel))),
        waveEl,
        h('div', { class: 'battle-loot' }, h('small', {}, 'Drops on a win'), lootIcons(raid, c.diff)),
        sessionLootEl = h('div', { class: 'battle-loot session-loot' }),
        h('div', { class: 'battle-stage' },
          h('div', { class: 'side pilots' }, party.map(u => u.el)),
          h('div', { class: 'side foes' }, foeBox)),
        battleDock(
          h('div', { class: 'dock-side' },
            h('div', { class: 'battle-cell dock-meter' }, h('div', { class: 'cell-head' }, h('h3', {}, 'Meter'), modeTabs), h('div', { class: 'dock-scroll' }, meterList)),
            h('div', { class: 'battle-cell dock-graph' }, h('div', { class: 'cell-head' }, h('h3', {}, 'Over time'), h('small', { class: 'muted' }, '5-second average · hover for numbers')), graphBox)),
          logPanel()));

      downs = 0;
      drawSessionLoot();
      if (newFight) addLog(c.start, 'kills', [h('b', {}, `Fight ${c.n}`), ' \u00b7 ', h('b', {}, raid.name), ` \u00b7 ${G.DIFF_BY_ID[c.diff || 'normal'].name}${c.party ? ` \u00b7 party of ${f.fighters.length}` : ''}`], 'fight');
      // Joining mid-fight: catch up to the current moment without animations.
      const clock = now() - c.start;
      quiet = true;
      while (idx < f.events.length && f.events[idx].t <= clock) step();
      quiet = false;
      drawMeter(clock);
      drawGraph(clock);
      raf = requestAnimationFrame(tick);
    }

    async function kick_(p) {
      if (await act('/api/party/kick', { id: p.id }, `${p.name} removed from the party.`)) { await poll(); sync(true); if (self.onChange) self.onChange(); }
    }

    function drawWave(w, of) {
      waveEl.replaceChildren(h('span', { class: 'wave-label' }, w === of - 1 ? 'Boss wave' : `Wave ${w + 1} of ${of}`),
        h('span', { class: 'wave-pips' }, Array.from({ length: of }, (_, k) =>
          h('span', { class: `wave-pip${k < w ? ' done' : k === w ? ' now' : ''}${k === of - 1 ? ' boss' : ''}`, title: k === of - 1 ? 'Boss' : `Wave ${k + 1}` }, k === of - 1 ? gi('skull', null, 'sm') : null))));
    }

    const castTarget = e => {
      if (e.tg === 'all') return e.k === 'heal' || e.k === 'buff' ? ' on the party' : ' on every enemy';
      if (typeof e.tg === 'number') return e.tg === e.a ? '' : [' on ', who(e.tg)];
      return foes[e.tg] ? [' on ', foeName(e.tg)] : '';
    };
    // ----- Applying events -----
    const MECH_ICON = { cleave: 'ab_rend', smash: 'skull', poison: 'ab_poison_arrow', drain: 'ab_mana_shield', mend: 'sk_healing', summon: 'flag', shield: 'ab_shield_wall', enrage: 'power' };
    // A boss used a mechanic: pop its icon, and for repeating ones count down to the next use
    // (every Nth attack, so roughly N attack intervals).
    function mechUsed(u, name, at) {
      const m = u && u.mechByName && u.mechByName[name];
      const ref = m && u.abRefs[m];
      if (!ref) return;
      const every = G.MECHANICS[m].every;
      u.cds[m] = every ? { from: at, until: at + every * (u.castMs + 300) } : { from: at, until: at + 1 };
      if (!quiet && !reduced) { ref.el.classList.remove('cd-fire', 'cd-ready'); void ref.el.offsetWidth; ref.el.classList.add('cd-fire'); }
    }
    function foeUnit(x) {
      const sub = !x.boss && x.role && x.role !== 'grunt' ? h('small', { class: `unit-sub role-${x.role}` }, G.TRASH_ROLES[x.role].name) : null;
      // A boss's mechanics show like pilot abilities: an icon each, with a pop and a countdown after use.
      const abRefs = {}, mechByName = {};
      const mechs = (x.mechs || []).filter(m => G.MECHANICS[m]).map(m => {
        const M = G.MECHANICS[m];
        mechByName[M.name] = m;
        if (m === 'enrage') mechByName.Enraged = m;
        const time = h('small', { class: 'cd-time', 'aria-hidden': 'true' });
        const el = h('span', { class: 'kit-ab foe-ab' }, gi(MECH_ICON[m] || 'power', '#ff9a8a', 'sm'), h('span', { class: 'cd-sweep' }), time);
        abRefs[m] = { el, time, shown: '' };
        return tip(el, () => [h('b', {}, M.name), h('p', { class: 'tip-desc' }, M.desc)]);
      });
      const kit = mechs.length ? h('div', { class: 'unit-kit' }, h('div', { class: 'kit-gear' }), h('div', { class: 'kit-right' }, mechs)) : null;
      const u = makeUnit({ name: x.name, enemy: true, boss: x.boss, max: x.max, tipFn: () => foeTip(x), art: foeArt(x.sprite ? { sprite: x.sprite, hue: x.spriteHue } : x.foe, x.boss, '', x.boss ? 48 : 32), sub,
        kit, abRefs, cds: {}, mechByName, castMs: x.cast || 2000 });
      foes[x.id] = u;
      return u;
    }

    function apply(e) {
      const at = cur.start + e.t;
      if (e.e === 'wave') {
        foes = {};
        const units = e.foes.map(foeUnit);
        foeBox.replaceChildren(...units.map(u => u.el));
        drawWave(e.w, e.of);
        addLog(at, 'kills', [e.boss ? h('b', {}, `Boss: ${e.foes[0].name}`) : `Wave ${e.w + 1} of ${e.of}: `, e.boss ? '' : e.foes.map(x => x.name).join(', ')], 'wave');
      } else if (e.e === 'cast') {
        const u = unitOf(e.a);
        if (!u) return;
        u.cast = { start: e.t, d: e.d };
        u.castText.textContent = castLabel(e);
        u.castBar.className = `castbar k-${e.k}`;
        if (e.k !== 'attack' && e.k !== 'enemy') pulse(u, 'cast-flash');
        if (e.m != null && u.maxMana) { u.mana = e.m; drawMana(u); }
        if (typeof e.a === 'number' && ABILITY_NAMES.has(e.n)) startCooldown(u, ABILITY_ID[e.n], e.t);
        if (typeof e.a === 'number' && ABILITY_NAMES.has(e.n)) addLog(at, 'abilities', [who(e.a), ' casts ', h('b', { class: 'log-ab' }, e.n), castTarget(e)], 'ability', gi('ab_' + ABILITY_ID[e.n], '#ffc98a', 'sm'));
        else if (e.k === 'danger') { mechUsed(u, e.n, e.t); addLog(at, 'abilities', [foeName(e.a), ` begins ${e.n}!`], 'danger'); }
      } else if (e.e === 'hit') hit(e);
      else if (e.e === 'spawn') {
        mechUsed(foes[e.a], e.n, e.t);
        foeBox.append(...e.foes.map(foeUnit).map(u => u.el));
        addLog(at, 'abilities', [foeName(e.a), ` uses ${e.n}: ${e.foes.map(x => x.name).join(', ')} join the fight!`], 'danger');
      } else if (e.e === 'mana') {
        const u = party[e.tg];
        if (u && u.maxMana) { u.mana = e.m; drawMana(u); flash(u, 'mana'); }
      } else if (e.e === 'buff') {
        if (e.danger) mechUsed(foes[e.tg], e.n, e.t);
        if (e.danger) addLog(at, 'abilities', [foeName(e.tg), e.n === 'Frenzy' ? ' goes into a frenzy!' : e.n === 'Enraged' ? ' is enraged!' : ` uses ${e.n}!`], 'danger');
        const targets = e.tg === 'all' ? party.filter(u => !u.down) : [unitOf(e.tg)].filter(Boolean);
        targets.forEach(u => {
          if (e.until) u.buffs[e.n] = { until: e.until, from: e.t, neg: !!e.neg, ty: e.ty, cls: e.neg ? 'debuff' : 'buff' };
          if (e.b != null) { u.barrier = e.b; drawHp(u); flash(u, 'shield'); }
        });
      } else if (e.e === 'down') {
        const u = party[e.tg];
        Object.assign(u, { down: true, respawnAt: e.at, cast: null, hp: 0, barrier: 0, buffs: {} });
        u.el.classList.add('down');
        u.castBar.className = 'castbar idle';
        u.castFill.style.width = '0';
        u.castText.textContent = 'Downed';
        drawHp(u);
        downs++;
        addLog(at, 'kills', [who(e.tg), e.at ? ' was downed \u2013 back in 25s' : ' was downed'], 'death');
      } else if (e.e === 'respawn') {
        const u = party[e.tg];
        u.down = false;
        u.hp = e.hp != null ? e.hp : u.max;
        if (ABILITY_NAMES.has(e.n)) startCooldown(u, ABILITY_ID[e.n], e.t);
        u.el.classList.remove('down');
        u.castText.textContent = '';
        drawHp(u);
        pulse(u, 'glow');
        addLog(at, 'kills', [who(e.tg), e.n === 'Respawned' ? ' respawned' : ` was brought back by ${e.n}`], 'respawn');
      } else if (e.e === 'kill') {
        const u = foes[e.tg];
        if (u) {
          Object.assign(u, { hp: 0, down: true, cast: null, buffs: {} });
          u.el.classList.add('down');
          u.castBar.className = 'castbar idle';
          u.castText.textContent = 'Defeated';
          drawHp(u);
        }
        addLog(at, 'kills', [e.a != null ? who(e.a) : 'Someone', ' killed ', foeName(e.tg)], 'kill');
      } else if (e.e === 'clear') {
        party.forEach(u => { if (!u.down) { u.cast = null; u.castBar.className = 'castbar idle'; u.castText.textContent = 'Next wave…'; } });
      } else if (e.e === 'end') {
        [...party, ...Object.values(foes)].forEach(u => { if (!u.down) { u.castBar.className = 'castbar idle'; u.cast = null; u.castText.textContent = ''; } });
        if (!e.win) addLog(at, 'kills', [h('b', { class: 'bad' }, 'Defeat'), e.wipe ? ' \u2013 every pilot was down at once. Better gear, potions or a party will help.' : ''], 'death');
        fightSummary(e, at);
      }
    }

    function hit(e) {
      const target = unitOf(e.tg);
      if (!target) return;
      const sec = Math.floor(e.t / 1000);
      const bump = (mode, i, sr, v) => {
        if (!stats[i] || !v) return;
        stats[i][mode] += v;
        stats[i].src[mode][sr] = (stats[i].src[mode][sr] || 0) + v;
        buckets[mode][i][sec] = (buckets[mode][i][sec] || 0) + v;
      };
      if (typeof e.tg === 'number' && HEAL_KINDS.includes(e.k)) {
        const eff = Math.min(e.v, target.max - target.hp);
        target.hp += eff;
        if (e.b !== undefined) target.barrier = e.b;
        if ((e.k === 'heal' || e.k === 'hot') && typeof e.a === 'number') bump('hps', e.a, e.sr, eff);
        if (e.k === 'potion') { const pid = Object.keys(G.ITEMS).find(id => G.ITEMS[id].name === (e.n || e.sr)); addLog(cur.start + e.t, 'abilities', [who(e.tg), ` drinks a ${(e.n || e.sr).toLowerCase()} (+${num(e.v)} HP)`], 'potion', pid ? itemIco(pid, 'sm') : null); }
        float(target, `+${num(e.v)}${e.c ? '!' : ''}`, e.k === 'potion' ? 'Potion' : e.sr, '#4ee08f', e.c, 'heal', typeof e.a === 'number' ? e.a : null);
        pulse(target, 'glow');
        if (e.k !== 'hot') flash(target, 'heal');
      } else if (typeof e.tg === 'number') {
        // An enemy hitting a pilot.
        if (e.ab) target.barrier = e.b || 0;
        target.hp = Math.max(0, target.hp - (e.v - (e.ab || 0)));
        const src = `${foes[e.a] ? foes[e.a].name : 'Enemy'}: ${e.sr}`;
        bump('taken', e.tg, src, e.v - (e.ab || 0));
        bump('mit', e.tg, src, Math.max(0, (e.raw || e.v) - e.v) + (e.ab || 0));
        float(target, `${num(e.v)}${e.c ? '!' : ''}`, e.ab ? `${e.ty} · ${num(e.ab)} absorbed` : e.ty, '#ff6b5b', e.c, 'taken');
        if (foes[e.a] && e.k !== 'dot') pulse(foes[e.a], 'lunge');
        const fxP = e.ab && e.ab >= e.v ? 'shield' : FX_OF_TYPE[e.ty];
        pulse(target, fxP ? 'shake-plain' : 'shake');
        if (fxP && e.k !== 'dot') flash(target, fxP);
      } else if (e.k === 'eheal') {
        // An enemy healing itself or an ally.
        target.hp = Math.min(target.max, target.hp + e.v);
        float(target, `+${num(e.v)}`, e.sr, '#4ee08f', false, 'heal');
        pulse(target, 'glow');
        flash(target, 'heal');
        addLog(cur.start + e.t, 'abilities', [foeName(e.a), ` ${e.a === e.tg ? 'regenerates' : `mends ${target.name}`} for ${num(e.v)}`], 'danger');
      } else {
        // A pilot hitting an enemy (an enemy shield soaks some of it).
        if (e.ab) target.barrier = e.b || 0;
        target.hp = Math.max(0, target.hp - (e.v - (e.ab || 0)));
        bump('dps', e.a, e.sr, e.v);
        const from = party[e.a];
        float(target, `${num(e.v)}${e.c ? '!' : ''}`, e.ty, from ? from.colour : '#fff', e.c, e.k === 'dot' ? 'dot' : 'dmg', from ? e.a : null);
        if (e.c && ABILITY_NAMES.has(e.sr) && !quiet) addLog(cur.start + e.t, 'abilities', [who(e.a), '\u2019s ', h('b', { class: 'log-ab' }, e.sr), ' crits ', foeName(e.tg), ` for ${num(e.v)}!`], 'crit');
        const fxE = e.ab && e.ab >= e.v ? 'shield' : FX_OF_TYPE[e.ty];
        if (e.k !== 'dot') { pulse(target, fxE ? 'shake-plain' : 'shake'); if (from && e.k !== 'thorns') pulse(from, 'lunge'); }
        if (fxE && e.k !== 'dot') flash(target, fxE);
      }
      drawHp(target);
    }

    // An icon for a buff or debuff: the ability's own icon, else one for its damage type.
    const TYPE_ICON = { Bleed: 'ab_rend', Burn: 'ab_fireball', Prismatic: 'ab_fireball', Fire: 'ab_fireball', Poison: 'ab_poison_arrow',
      Frost: 'ab_frost_nova', Shadow: 'sub_shadowmender', Heal: 'sk_healing' };
    const statusIcon = (n, b) => (ABILITY_ID[n] ? 'ab_' + ABILITY_ID[n] : b.cls === 'taunt' ? 'sub_guardian' : TYPE_ICON[b.ty] || (/shield/i.test(n) ? 'ab_mana_shield' : 'power'));
    const clockNow = () => (cur ? now() - cur.start : 0);
    function drawStatuses(clock) {
      const tank = party.find(u => !u.down && cur.fight.fighters[u.i].subclass === 'guardian');
      Object.values(foes).forEach(u => {
        if (tank && !u.down) u.buffs.Taunted = { until: Infinity, cls: 'taunt', neg: true, label: `Taunted by ${tank.name}` };
        else delete u.buffs.Taunted;
      });
      [...party, ...Object.values(foes)].forEach(u => {
        // Icon badges kept per effect (so they don't flicker), with the time left underneath.
        const live = Object.entries(u.buffs).filter(([, b]) => b.until > clock);
        u.statusEls = u.statusEls || new Map();
        const keep = new Set();
        const badge = ([n, b]) => {
          keep.add(n);
          let s = u.statusEls.get(n);
          if (!s) {
            const time = h('small', {});
            const el = tip(h('span', { class: `sbadge ${b.neg ? 'neg' : 'pos'}${b.ty ? ` ty-${b.ty.toLowerCase()}` : ''}${b.cls === 'taunt' ? ' ty-taunt' : ''}` },
              gi(statusIcon(n, b), null, 'sm'), time), () => {
              const left = b.until - clockNow();
              return [h('b', {}, b.label || n), h('small', { class: 'muted' }, `${b.neg ? 'Debuff' : 'Buff'}${Number.isFinite(left) && b.until - b.from < 600000 ? ` · ${Math.max(0, left / 1000).toFixed(1)}s left` : ''}`)];
            });
            s = { el, time };
            u.statusEls.set(n, s);
          }
          const left = b.until - clock;
          // Fight-long effects (frenzy, enrage) show no timer.
          const timed = Number.isFinite(left) && b.from != null && b.until - b.from < 600000;
          const txt = timed ? (left >= 10000 ? `${Math.ceil(left / 1000)}s` : `${(left / 1000).toFixed(1)}s`) : '';
          if (s.time.textContent !== txt) s.time.textContent = txt;
          s.el.style.setProperty('--left', timed ? String(Math.max(0, Math.min(1, left / (b.until - b.from)))) : '1');
          return s.el;
        };
        const pos = live.filter(([, b]) => !b.neg).map(badge), neg = live.filter(([, b]) => b.neg).map(badge);
        const tys = new Set(live.map(([, b]) => (b.ty || '').toLowerCase()));
        const partKind = u.down ? null : ['bleed', 'poison', 'burn', 'prismatic', 'frost', 'shadow', 'heal'].find(k => tys.has(k));
        const aura = `${u.barrier >= 1 && !u.down ? 'shielded ' : ''}${partKind ? `fx-${partKind === 'prismatic' ? 'burn' : partKind}` : ''}`;
        if (u.auraCls !== aura) { u.auraCls = aura; u.artBox.dataset.aura = aura; }
        [...u.statusEls.keys()].forEach(n => { if (!keep.has(n)) u.statusEls.delete(n); });
        if (u.down && u.respawnAt && !u.enemy) pos.unshift(h('span', { class: 'status down' }, `Respawn in ${Math.max(0, Math.ceil((u.respawnAt - clock) / 1000))}s`));
        // Only touch the DOM when the badges change: re-inserting one replays its pop-in (a flash).
        const same = (box, list) => box.childElementCount === list.length && list.every((el, k) => box.children[k] === el);
        if (!same(u.statusPos, pos)) u.statusPos.replaceChildren(...pos);
        if (!same(u.statusNeg, neg)) u.statusNeg.replaceChildren(...neg);
      });
    }

    function drawMeter(clock) {
      const s = Math.max(1, clock / 1000);
      const rate = METER_MODES.find(m => m[0] === meterMode)[2];
      const unit = rate ? (meterMode === 'dps' ? ' DPS' : ' HPS') : '';
      const vals = stats.map(x => x[meterMode]);
      const shown = vals.map(v => (rate ? v / s : v));
      const top = Math.max(1, ...shown);
      const total = vals.reduce((a, b) => a + b, 0) || 1;
      const sorted = meterRows.slice().sort((a, b) => shown[b.i] - shown[a.i]);
      const order = sorted.map(r => r.i).join();
      if (order !== meterOrder) {
        // Slide rows from where they were to their new place.
        const before = new Map(meterRows.map(r => [r, r.item.getBoundingClientRect().top]));
        sorted.forEach((r, k) => { meterList.append(r.item); r.rank.textContent = String(k + 1); r.item.dataset.rank = String(k + 1); });
        if (meterOrder && !reduced) sorted.forEach(r => {
          const dy = before.get(r) - r.item.getBoundingClientRect().top;
          if (!dy) return;
          r.item.style.transition = 'none';
          r.item.style.transform = `translateY(${dy}px)`;
          void r.item.offsetWidth;
          r.item.style.transition = '';
          r.item.style.transform = '';
        });
        meterOrder = order;
      }
      sorted.forEach(r => {
        const target = rate ? shown[r.i] : vals[r.i];
        r.disp = quiet || Math.abs(target - r.disp) < 0.05 ? target : r.disp + (target - r.disp) * 0.35;
        r.fill.style.width = `${(shown[r.i] / top) * 100}%`;
        r.val.replaceChildren(h('b', {}, `${rate ? r.disp.toFixed(1) : num(Math.round(r.disp))}${unit}`), h('small', {}, `${Math.round((vals[r.i] / total) * 100)}%`));
        const open = expanded.has(r.id);
        r.detail.hidden = !open;
        if (open) {
          const src = Object.entries(stats[r.i].src[meterMode]).sort((a, b) => b[1] - a[1]);
          const all = vals[r.i] || 1;
          r.detail.replaceChildren(...(src.length ? src.map(([name, v]) => {
            const bar = h('span');
            bar.style.width = `${(v / all) * 100}%`;
            bar.style.background = party[r.i].colour;
            return h('div', { class: 'src-row' }, h('span', { class: 'grow' }, name), h('span', {}, rate ? `${(v / s).toFixed(1)}/s` : num(v)), h('span', { class: 'muted' }, `${Math.round((v / all) * 100)}%`),
              h('span', { class: 'src-bar' }, bar));
          }) : [h('span', { class: 'muted small' }, 'Nothing yet.')]));
        }
      });
    }

    const GW = 1000, GH = 300, SVGNS = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
    // Built once per fight: a gradient, filled area and line per pilot, plus a glowing head marker.
    function buildGraph() {
      const svg = svgEl('svg', { viewBox: `0 0 ${GW} ${GH}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      const defs = svgEl('defs', {});
      svg.append(defs);
      [0.25, 0.5, 0.75].forEach(f => svg.append(svgEl('line', { x1: 0, x2: GW, y1: GH * f, y2: GH * f, class: 'gl', 'vector-effect': 'non-scaling-stroke' })));
      const seen = {};
      const series = party.map((u, i) => {
        const id = `gg-${graphUid}-${i}`;
        const grad = svgEl('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.append(svgEl('stop', { offset: '0%', 'stop-color': u.colour, 'stop-opacity': '0.32' }), svgEl('stop', { offset: '100%', 'stop-color': u.colour, 'stop-opacity': '0' }));
        defs.append(grad);
        const area = svgEl('path', { fill: `url(#${id})`, class: 'g-area' });
        const line = svgEl('path', { fill: 'none', stroke: u.colour, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', class: 'g-line' });
        if (seen[u.colour]) line.setAttribute('stroke-dasharray', '6 4');
        seen[u.colour] = true;
        svg.append(area, line);
        const head = h('span', { class: 'g-head' });
        head.style.setProperty('--series', u.colour);
        return { area, line, head };
      });
      graphSvg.replaceChildren(svg);
      graphSvg.parentElement.querySelectorAll('.g-head').forEach(x => x.remove());
      series.forEach(x => graphSvg.parentElement.append(x.head));
      graphEls = { series, mode: meterMode };
    }
    // A smooth curve through the points that never overshoots between them.
    const curve = pts => pts.map(([x, y], k) => {
      if (!k) return `M${x.toFixed(1)},${y.toFixed(1)}`;
      const [px, py] = pts[k - 1];
      const mx = (px + x) / 2;
      return `C${mx.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    function drawGraph(clock) {
      if (!graphEls || graphEls.mode !== meterMode) { buildGraph(); graphTop = 0; }
      const tf = Math.max(0, clock / 1000);
      const sec = Math.floor(tf);
      const span = Math.max(20, tf);
      // 5-second rolling average per second, plus a live point for the second in progress.
      const series = buckets[meterMode].map(b => {
        const pts = [];
        for (let x = 0; x < sec; x++) {
          let sum = 0;
          for (let k = Math.max(0, x - 4); k <= x; k++) sum += b[k] || 0;
          pts.push(sum / Math.min(5, x + 1));
        }
        let sum = 0;
        for (let k = Math.max(0, sec - 4); k <= sec; k++) sum += b[k] || 0;
        pts.push(sum / Math.max(1, Math.min(5, tf)));
        return pts;
      });
      const target = niceMax(Math.max(10, ...series.flat()) * 1.05);
      graphTop = !graphTop || quiet || reduced ? target : graphTop + (target - graphTop) * 0.3;
      graphData = { series, span, sec, top: graphTop };
      const X = x => (x / span) * GW, Y = v => GH - Math.min(1, v / graphTop) * GH;
      series.forEach((pts, i) => {
        const el = graphEls.series[i];
        const xy = pts.map((v, x) => [X(x === pts.length - 1 ? tf : x), Y(v)]);
        const d = curve(xy);
        el.line.setAttribute('d', d);
        el.area.setAttribute('d', xy.length ? `${d} L${xy[xy.length - 1][0].toFixed(1)},${GH} L${xy[0][0].toFixed(1)},${GH} Z` : '');
        const last = xy[xy.length - 1];
        el.head.style.left = `${(last[0] / GW) * 100}%`;
        el.head.style.top = `${(last[1] / GH) * 100}%`;
        el.head.classList.toggle('done', clock >= cur.fight.ms);
      });
      graphAxisY.replaceChildren(...[1, 0.75, 0.5, 0.25, 0].map(f => h('span', {}, fmt(graphTop * f))));
      graphAxisX.replaceChildren(...[0, 0.25, 0.5, 0.75, 1].map(f => h('span', {}, fmtClock(span * f * 1000))));
    }

    function hoverGraph(e, area) {
      if (!graphData) return;
      const rect = area.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const x = Math.min(graphData.sec, Math.round(frac * graphData.span));
      graphCursor.hidden = false;
      graphCursor.style.left = `${(x / graphData.span) * 100}%`;
      const label = METER_MODES.find(m => m[0] === meterMode)[1];
      graphTip.hidden = false;
      graphTip.replaceChildren(h('b', {}, `${fmtClock(x * 1000)} · ${label}`), ...graphData.series.map((pts, i) => {
        const dot = h('span', { class: 'swatch-dot' });
        dot.style.background = party[i].colour;
        return h('div', {}, dot, `${party[i].name}: ${fmt(pts[x] || 0)}`);
      }));
      const left = (x / graphData.span) * rect.width;
      graphTip.style.left = `${Math.min(left + 10, rect.width - 150)}px`;
    }

    function startCooldown(u, id, at) {
      const ab = G.ABILITY_BY_ID[id];
      const ref = u && u.abRefs && u.abRefs[id];
      if (!ab || !ref) return;
      u.cds[id] = { from: at, until: at + (ab.cd || 300) * 1000 };
      if (!quiet && !reduced) { ref.el.classList.remove('cd-fire', 'cd-ready'); void ref.el.offsetWidth; ref.el.classList.add('cd-fire'); }
    }
    // Greys out abilities on cooldown with a clock sweep and the time left; a flash when ready again.
    function drawCooldowns(clock) {
      [...party, ...Object.values(foes)].forEach(u => Object.entries(u.abRefs || {}).forEach(([id, ref]) => {
        const c = u.cds[id];
        const left = c ? c.until - clock : 0;
        const on = left > 0;
        if (on) {
          ref.el.style.setProperty('--cd', String(left / (c.until - c.from)));
          const txt = left >= 10000 ? `${Math.ceil(left / 1000)}s` : `${(left / 1000).toFixed(1)}s`;
          if (txt !== ref.shown) { ref.time.textContent = txt; ref.shown = txt; }
        }
        if (on !== !!ref.on) {
          ref.on = on;
          ref.el.classList.toggle('on-cd', on);
          if (!on && c && !quiet && !reduced) { ref.el.classList.remove('cd-fire'); void ref.el.offsetWidth; ref.el.classList.add('cd-ready'); }
        }
      }));
    }

    function tick(t) {
      if (!cur) return;
      const f = cur.fight;
      const clock = Math.min(now() - cur.start, f.ms);
      while (idx < f.events.length && f.events[idx].t <= clock) step();
      [...party, ...Object.values(foes)].forEach(u => {
        if (u.cast && !u.down) u.castFill.style.width = `${Math.min(1, (clock - u.cast.start) / u.cast.d) * 100}%`;
        else if (!u.cast) u.castFill.style.width = '0';
      });
      clockEl.textContent = fmtClock(clock);
      drawCooldowns(now() - cur.start);
      if (now() - cur.start >= f.ms) {
        const next = cur.start + f.ms + G.FIGHT.gapMs - now();
        statusEl.className = `battle-status ${f.win ? 'ok' : 'bad'}`;
        statusEl.textContent = `${f.win ? 'Victory' : 'Defeat'} · next fight ${next > 0 ? `in ${Math.ceil(next / 1000)}s` : 'starting'}`;
        // Ask the server to move on once the gap is over.
        if (next < -300 && !asked) { asked = true; poll(); }
      } else {
        statusEl.className = 'battle-status live';
        statusEl.textContent = 'Fighting';
      }
      if (t - lastMeter > 100) { lastMeter = t; drawMeter(clock); }
      if (t - lastSec > 250) { lastSec = t; drawStatuses(clock); }
      // After the fight ends, the graph is drawn once more and then left alone.
      if (t - lastGraph > 200 && !graphFinal) { lastGraph = t; drawGraph(clock); graphFinal = clock >= f.ms; }
      raf = requestAnimationFrame(tick);
    }

    return self;
  }

  // Trade
  let tradePrefill = null;

  function tradePage() {
    const lists = h('div');
    let data = { incoming: [], outgoing: [], history: [] };

    const giveRows = h('div', { class: 'item-rows' });
    const wantRows = h('div', { class: 'item-rows' });
    const itemOptions = (ids, withCount) => ids.map(id => h('option', { value: id }, withCount ? `${G.ITEMS[id].name} (${fmt(have(id))})` : G.ITEMS[id].name));
    const myIds = () => Object.keys(me.state.items).filter(id => G.ITEMS[id]);
    const allIds = Object.keys(G.ITEMS);

    function addRow(box, mine, preset) {
      const ids = mine ? myIds() : allIds;
      if (!ids.length) { toast('You don’t have anything to offer yet.', 'error'); return; }
      const sel = h('select', { 'aria-label': 'Item' }, itemOptions(ids, mine));
      if (preset) sel.value = preset;
      const qty = h('input', { type: 'number', min: '1', value: '1', 'aria-label': 'Amount', inputmode: 'numeric' });
      const row = h('div', { class: 'item-row' }, sel, qty, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove row', onclick: () => row.remove() }, ui('close')));
      box.append(row);
    }
    const collect = box => {
      const out = {};
      box.querySelectorAll('.item-row').forEach(r => {
        const id = r.querySelector('select').value;
        const n = parseInt(r.querySelector('input').value, 10);
        if (id && n > 0) out[id] = (out[id] || 0) + n;
      });
      return out;
    };

    const toInput = h('input', { name: 'to', required: true, spellcheck: 'false', autocomplete: 'off', list: 'friend-names' });
    const friendList = h('datalist', { id: 'friend-names' });
    const form = h('form', { class: 'panel', onsubmit: async e => {
      e.preventDefault();
      const res = await act('/api/trade/create', { to: toInput.value, give: collect(giveRows), want: collect(wantRows) }, 'Offer sent. Your items are held until it’s settled.');
      if (res) { giveRows.replaceChildren(); wantRows.replaceChildren(); addRow(giveRows, true); load(); }
    } },
      h('label', { class: 'field' }, 'Trade with pilot', toInput, friendList),
      h('div', { class: 'section-head section' }, h('h2', {}, 'You give'), h('button', { type: 'button', class: 'btn small', onclick: () => addRow(giveRows, true) }, 'Add item')),
      giveRows,
      h('div', { class: 'section-head section' }, h('h2', {}, 'You want'), h('button', { type: 'button', class: 'btn small', onclick: () => addRow(wantRows, false) }, 'Add item')),
      wantRows,
      h('p', { class: 'muted section' }, 'Leave “You want” empty to send a gift.'),
      h('p', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'Send offer')));

    if (tradePrefill && tradePrefill.to) toInput.value = tradePrefill.to;
    if (myIds().length) addRow(giveRows, true, tradePrefill && tradePrefill.give);
    tradePrefill = null;

    const side = (label, items) => h('div', { class: 'trade-side' }, h('small', {}, label),
      Object.keys(items).length ? Object.entries(items).map(([id, n]) => h('span', { class: 'pill' }, itemIco(id, 'sm'), `${num(n)} × ${G.ITEMS[id].name}`)) : h('span', { class: 'muted' }, 'Nothing'));

    function tradeCard(t, mode) {
      const other = mode === 'in' ? t.from : t.to;
      const title = mode === 'in' ? `${other.name} offers you` : mode === 'out' ? `Your offer to ${other.name}` : `${t.from.name} → ${t.to.name}`;
      const give = side(mode === 'in' ? 'You get' : 'They get', t.give);
      const want = side(mode === 'in' ? 'You give' : 'You get', t.want);
      const canAfford = mode !== 'in' || Object.entries(t.want).every(([id, n]) => have(id) >= n);
      return h('div', { class: 'trade-card' },
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, title), h('small', {}, mode === 'done' ? `${t.status} · ${ago(t.updated)}` : ago(t.created)))),
        h('div', { class: 'trade-sides' }, give, ui('trade', 'arrow'), want),
        mode === 'in' ? h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn primary', disabled: !canAfford, onclick: () => tradeAct('/api/trade/accept', t.id, 'Trade complete.') }, canAfford ? 'Accept' : 'You’re missing items'),
          h('button', { type: 'button', class: 'btn danger', onclick: () => tradeAct('/api/trade/decline', t.id, 'Offer declined.') }, 'Decline')) : null,
        mode === 'out' ? h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn danger', onclick: () => tradeAct('/api/trade/cancel', t.id, 'Offer cancelled. Your items are back.') }, 'Cancel offer')) : null);
    }

    async function tradeAct(path, id, msg) {
      if (await act(path, { id }, msg)) { load(); poll(); }
    }

    function draw() {
      lists.replaceChildren(
        section('Offers to you', null, data.incoming.length ? h('div', { class: 'list' }, data.incoming.map(t => tradeCard(t, 'in'))) : h('div', { class: 'empty' }, 'No offers waiting.')),
        section('Your open offers', null, data.outgoing.length ? h('div', { class: 'list' }, data.outgoing.map(t => tradeCard(t, 'out'))) : h('div', { class: 'empty' }, 'You have no open offers.')),
        data.history.length ? section('Recent trades', null, h('div', { class: 'list' }, data.history.map(t => tradeCard(t, 'done')))) : '');
    }

    async function load() {
      try {
        const [t, s] = await Promise.all([api('/api/trades'), api('/api/social')]);
        data = t;
        friendList.replaceChildren(...s.friends.map(f => h('option', { value: f.name })));
        draw();
      } catch (e) { /* shown on next action */ }
    }

    pageRefresh = load;
    draw();
    load();
    return [
      pageHead('trade', 'skill-smithing', 'Trade', 'Swap materials and parts with other pilots. Items you offer are held safely until the other pilot accepts, declines, or you cancel.'),
      h('div', { class: 'two-col' }, h('div', {}, form), lists),
    ];
  }

  // Guild
  function guildPage() {
    const body = h('div');
    let lastChatId = 0;

    async function load() {
      try {
        const data = await api('/api/guild');
        if (data.guild) drawGuild(data); else drawNoGuild(data);
      } catch (e) { /* shown on next action */ }
    }

    // The founding form is built once, so a refresh of the guild list never clears it.
    const name = h('input', { name: 'name', required: true, maxlength: '24', autocomplete: 'off' });
    const tag = h('input', { name: 'tag', required: true, maxlength: '4', spellcheck: 'false', autocomplete: 'off' });
    const foundForm = section('Found a guild', 'Free. Pick a name and a 2\u20134 character tag.',
      h('form', { class: 'panel', onsubmit: async e => {
        e.preventDefault();
        if (await act('/api/guild/create', { name: name.value, tag: tag.value }, 'Guild founded.')) { name.value = ''; tag.value = ''; await poll(); load(); }
      } },
        h('div', { class: 'form-row' }, h('label', { class: 'field' }, 'Guild name', name), h('label', { class: 'field' }, 'Tag (2\u20134)', tag)),
        h('p', { class: 'actions section' }, h('button', { type: 'submit', class: 'btn primary' }, 'Found guild'))));
    const guildList = h('div');

    function drawNoGuild(data) {
      lastChatId = 0;
      delete body.dataset.guild;
      if (!body.contains(foundForm)) body.replaceChildren(h('div', { class: 'two-col' }, foundForm, guildList));
      guildList.replaceChildren(
        section('Guilds', 'Open to join. Up to 30 pilots each.',
          data.guilds.length ? h('div', { class: 'list' }, data.guilds.map(g => h('div', { class: 'row' },
            h('div', { class: 'grow' }, h('div', { class: 'name' }, g.name, h('span', { class: 'tag' }, ` [${g.tag}]`)), h('small', {}, `${plural(g.members, 'pilot')} · total level ${num(g.level)}`)),
            h('button', { type: 'button', class: 'btn small primary', disabled: g.members >= 30, onclick: async () => { if (await act('/api/guild/join', { id: g.id }, `Welcome to ${g.name}.`)) { await poll(); load(); } } }, g.members >= 30 ? 'Full' : 'Join'))))
            : h('div', { class: 'empty' }, 'No guilds yet. Be the first to found one.')));
    }

    function drawGuild(data) {
      const g = data.guild;
      const leader = data.myRank;
      const chatLog = body.querySelector('.chat-log');
      const newest = data.chat.length ? data.chat[data.chat.length - 1].id : 0;
      // Keep the chat box (and whatever is being typed) if only messages changed.
      if (chatLog && body.dataset.guild === String(g.id)) {
        if (newest !== lastChatId) { fillChat(chatLog, data.chat); lastChatId = newest; }
        body.querySelector('.members').replaceChildren(...membersList(data, leader));
        body.querySelector('.guild-online').textContent = onlineText(data);
        return;
      }
      body.dataset.guild = String(g.id);
      const log = h('div', { class: 'chat-log', 'aria-live': 'polite', 'aria-label': 'Guild chat' });
      fillChat(log, data.chat);
      lastChatId = newest;
      const input = h('input', { maxlength: '200', 'aria-label': 'Message', placeholder: 'Say something to your guild', autocomplete: 'off' });
      body.replaceChildren(
        h('div', { class: 'panel row' },
          h('div', { class: 'grow' }, h('h2', {}, g.name, h('span', { class: 'tag' }, ` [${g.tag}]`)), h('small', { class: 'guild-online' }, onlineText(data))),
          h('button', { type: 'button', class: 'btn danger', onclick: async () => {
            if (!confirm(leader === 'leader' && data.members.length > 1 ? 'Leave the guild? Leadership passes to an officer, or the longest-serving member.' : 'Leave the guild?')) return;
            if (await act('/api/guild/leave', {}, 'You left the guild.')) { delete body.dataset.guild; await poll(); load(); }
          } }, 'Leave guild')),
        section('Members', 'Guildmates can join each other’s raid parties. Combat level is a pilot’s four combat skills added together.',
          h('div', { class: 'guild-table', role: 'table', 'aria-label': 'Guild members' },
            h('div', { class: 'guild-row head', role: 'row' }, ['Pilot', 'Rank', 'Combat', 'Doing', ''].map(t => h('span', { role: 'columnheader' }, t))),
            h('div', { class: 'members', role: 'rowgroup' }, membersList(data, leader)))),
        h('div', { class: 'guild-chat-wrap' },
          section('Guild chat', null, h('div', { class: 'chat' }, log,
            h('form', { onsubmit: async e => {
              e.preventDefault();
              if (!input.value.trim()) return;
              if (await act('/api/guild/chat', { text: input.value })) { input.value = ''; load(); }
            } }, input, h('button', { type: 'submit', class: 'btn primary' }, 'Send'))))));
      log.scrollTop = log.scrollHeight;
    }

    function fillChat(log, chat) {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      log.replaceChildren(...(chat.length ? chat.map(m => h('p', { class: 'chat-msg' }, h('b', {}, m.name), m.text, h('small', {}, ago(m.at))))
        : [h('p', { class: 'muted' }, 'No messages yet.')]));
      if (atBottom) log.scrollTop = log.scrollHeight;
    }

    const onlineText = data => `${data.members.filter(m => m.online).length} online · ${data.members.length} / ${data.guild.max} pilots`;
    const RANKS = { leader: 'Leader', officer: 'Officer', member: 'Member' };

    // One row per member: online dot, name, rank, combat level, current activity, and the
    // controls this pilot's own rank allows.
    function membersList(data, myRank) {
      return data.members.map(m => {
        const controls = [];
        const rankAct = (rank, label, msg) => h('button', { type: 'button', class: 'btn small', onclick: async () => {
          if (rank === 'leader' && !confirm(`Hand leadership of the guild to ${m.name}? You'll become an officer.`)) return;
          if (await act('/api/guild/rank', { id: m.id, rank }, msg)) load();
        } }, label);
        if (m.id !== me.player.id && myRank === 'leader') {
          controls.push(m.rank === 'officer' ? rankAct('member', 'Demote', `${m.name} is now a member.`) : rankAct('officer', 'Promote', `${m.name} is now an officer.`));
          controls.push(rankAct('leader', 'Make leader', `${m.name} now leads the guild.`));
        }
        if (m.id !== me.player.id && m.rank !== 'leader' && (myRank === 'leader' || (myRank === 'officer' && m.rank === 'member'))) {
          controls.push(h('button', { type: 'button', class: 'btn small danger', onclick: async () => {
            if (confirm(`Remove ${m.name} from the guild?`) && await act('/api/guild/kick', { id: m.id }, `${m.name} was removed.`)) load();
          } }, 'Remove'));
        }
        return h('div', { class: `guild-row${m.online ? '' : ' away'}`, role: 'row' },
          h('span', { class: 'who', role: 'cell' }, h('span', { class: `dot ${m.online ? 'online' : 'offline'}`, title: m.online ? 'Online' : 'Offline' }),
            h('span', { class: 'visually-hidden' }, m.online ? 'Online: ' : 'Offline: '), h('b', {}, m.name)),
          h('span', { role: 'cell' }, h('span', { class: `rank-chip ${m.rank}` }, m.rank === 'leader' ? gi('crown', null, 'sm') : null, RANKS[m.rank])),
          h('span', { class: 'combat', role: 'cell' }, gi('sk_melee', null, 'sm'), num(m.combat)),
          h('span', { class: 'doing', role: 'cell' }, m.online ? m.activity : `${m.activity} (offline)`),
          h('span', { class: 'row-actions', role: 'cell' }, controls));
      });
    }

    pageRefresh = load;
    load();
    return [
      pageHead('guild', 'skill-scribing', me.guild ? me.guild.name : 'Guild', 'Band together with other pilots. Guildmates can see and join each other’s raid parties.'),
      body,
    ];
  }

  // Social
  function socialPage() {
    const lists = h('div');
    const nameInput = h('input', { required: true, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Pilot name', placeholder: 'Pilot name' });

    async function load() {
      try { draw(await api('/api/social')); } catch (e) { /* shown on next action */ }
    }
    async function friendAct(path, body, msg) {
      if (await act(path, body, msg)) { load(); poll(); }
    }

    function draw(data) {
      lists.replaceChildren(
        data.incoming.length ? section('Friend requests', null, h('div', { class: 'list' }, data.incoming.map(p => {
          const row = memberRow(p);
          row.append(
            h('button', { type: 'button', class: 'btn small primary', onclick: () => friendAct('/api/friends/accept', { id: p.id }, `You and ${p.name} are now friends.`) }, 'Accept'),
            h('button', { type: 'button', class: 'btn small danger', onclick: () => friendAct('/api/friends/remove', { id: p.id }, 'Request declined.') }, 'Decline'));
          return row;
        }))) : '',
        section('Friends', `${data.friends.filter(f => f.online).length} online`, data.friends.length ? h('div', { class: 'list' }, data.friends.map(p => {
          const row = memberRow(p, `Level ${p.level}`);
          row.append(
            h('button', { type: 'button', class: 'btn small', onclick: () => { tradePrefill = { to: p.name }; go('trade'); } }, 'Trade'),
            h('button', { type: 'button', class: 'btn small danger', onclick: () => { if (confirm(`Remove ${p.name} from your friends?`)) friendAct('/api/friends/remove', { id: p.id }, `${p.name} removed.`); } }, 'Remove'));
          return row;
        })) : h('div', { class: 'empty' }, 'No friends yet. Add a pilot by name above.')),
        data.outgoing.length ? section('Sent requests', null, h('div', { class: 'list' }, data.outgoing.map(p => {
          const row = memberRow(p);
          row.append(h('button', { type: 'button', class: 'btn small', onclick: () => friendAct('/api/friends/remove', { id: p.id }, 'Request cancelled.') }, 'Cancel'));
          return row;
        }))) : null);
    }

    pageRefresh = load;
    load();
    return [
      pageHead('social', 'skill-mining', 'Social', 'Add friends to trade with them and join their raid parties.'),
      h('form', { class: 'panel form-row', onsubmit: async e => {
        e.preventDefault();
        if (await act('/api/friends/add', { name: nameInput.value })) { nameInput.value = ''; load(); }
      } }, h('label', { class: 'field' }, 'Add a friend', nameInput), h('button', { type: 'submit', class: 'btn primary' }, 'Send request')),
      lists,
    ];
  }


  const PAGES = {
    skill: skillPage, equipment: equipmentPage, inventory: inventoryPage, abilities: abilitiesPage, subclass: subclassPage, raids: raidsPage,
    fights: fightsPage, trade: tradePage, guild: guildPage, social: socialPage, patch: patchPage, credits: creditsPage, settings: settingsPage,
  };

  // ---------- Wiring ----------
  $('menu-btn').addEventListener('click', openMenu);
  $('scrim').addEventListener('click', closeMenu);
  $('modal-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('modal').hidden) closeModal();
    else closeMenu();
  });
  $('logout').addEventListener('click', async () => {
    try { await api('/api/logout', {}); } catch (e) { /* already logged out */ }
    location.reload();
  });

  setupAuth();
  requestAnimationFrame(frame);
  boot();
})();
