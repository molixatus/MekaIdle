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
  const itemIco = (id, cls = '') => {
    const it = G.ITEMS[id];
    if (!it) return gi('ore', '#5d6575', cls);
    return gi(it.icon, it.colour, `${cls}${it.rare ? ' rare' : ''}`);
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
  const num = n => Math.floor(n).toLocaleString('en-GB');
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

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  async function api(path, body) {
    const opts = body === undefined
      ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    let res;
    try { res = await fetch(path, opts); } catch (e) { throw new Error('Can’t reach the server. Check your connection.'); }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
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
    det.addEventListener('toggle', () => store('mekaidle-open-' + key, det.open ? '1' : '0'));
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
  const mySubclass = (cls = myClass()) => (me.state.subclasses || {})[cls] || null;
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
    me.state = state;
    offset = state.lastTick - Date.now();
    renderChrome();
    if (isLivePage()) renderPage();
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
      return it && it.armour ? { type: it.armour, colour: it.colour } : null;
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
  const foeArt = (foe, boss, cls = '', size) => h('span', { class: `sprite foe-sprite ${cls}`, 'aria-hidden': 'true', html: foeSprite(foe, boss, size) });
  // Raid list portraits use the plain icon in the boss's colour.
  const bossIcon = (raid, cls = '') => gi(`foe_${raid.foe}`, hslToHex(foeColour(raid.foe, true)), `boss-ico-svg ${cls}`);

  // ---------- Auth ----------
  function showAuth() {
    clearInterval(pollTimer);
    me = null;
    $('app').hidden = true;
    $('auth').hidden = false;
    closeModal();
  }

  function setupAuth() {
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
        await api('/api/login', { name: f.name.value, password: f.password.value });
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
  }

  async function poll() {
    if (!me || document.hidden) return;
    try {
      const data = await api('/api/me');
      me = data;
      offset = data.now - Date.now();
      renderChrome();
      if (isLivePage()) renderPage();
      else if (pageRefresh && ++polls % 2 === 0) pageRefresh();
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
    Object.values(navRefs).forEach(({ btn, right, spin, item, fill }) => {
      btn.toggleAttribute('aria-current', false);
      if (item.id === page) btn.setAttribute('aria-current', 'page');
      if (item.id === 'raids') spin.hidden = !raiding();
      if (item.skill) {
        const x = xpInfo(item.skill);
        right.textContent = String(x.level).padStart(2, '0');
        fill.style.width = x.pct + '%';
        btn.title = x.max ? `${item.name}: ${num(x.xp)} XP (max level)` : `${item.name}: ${num(x.xp)} XP, ${num(x.toGo)} to level ${x.level + 1}`;
        spin.hidden = item.skill !== activeSkill;
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

    $('topline').replaceChildren(h('span', { class: 'topline-now' }, activityText()),
      (me.state.queue || []).length ? h('span', { class: 'topline-queue' }, `Queue: ${me.state.queue.length}/${G.QUEUE_MAX}`) : '');
    const cls = myClass();
    const dot = h('span', { class: 'pilot-dot' });
    dot.style.background = classColour(me.state.equipment);
    $('pilot').replaceChildren(dot, h('div', {}, h('b', {}, me.player.name), h('small', {}, `${me.guild ? `[${me.guild.tag}] ` : ''}${me.player.mech} · ${G.CLASSES[cls].name}`)));
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
  function frame() {
    const p = me && activityProgress();
    const w = p ? `${p.frac * 100}%` : '0%';
    const nf = document.getElementById('now-fill');
    if (nf) nf.style.width = w;
    document.querySelectorAll('.card.active .card-fill').forEach(el => { el.style.width = w; });
    requestAnimationFrame(frame);
  }

  // ---------- Pages ----------
  const LIVE = ['skill', 'equipment', 'inventory', 'abilities', 'subclass'];
  const isLivePage = () => LIVE.includes(page.split(':')[0]) && !document.querySelector('.page input:focus, .page select:focus');

  function go(id) {
    const kind = id.split(':')[0];
    if (kind === 'hangar') id = 'equipment';
    if (!PAGES[id.split(':')[0]] || (id.startsWith('skill:') && !G.SKILL_BY_ID[id.slice(6)])) id = 'skill:mining';
    if (pageCleanup) pageCleanup();
    page = id;
    store(PAGE_KEY, id);
    pageRefresh = pageTick = pageCleanup = null;
    renderChrome();
    renderPage();
    window.scrollTo(0, 0);
  }

  function renderPage() {
    if (pageCleanup) pageCleanup();
    pageRefresh = pageTick = pageCleanup = null;
    const [kind, arg] = page.split(':');
    const el = PAGES[kind](arg);
    if (el) $('page').replaceChildren(...[].concat(el).filter(Boolean));
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
    if (it.set) bits.push(h('span', { class: 'set-chip' }, `${G.REGIONS[it.set - 1].set.name} set`));
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

  function levelBox(id) {
    const x = xpInfo(id);
    const fill = h('span');
    fill.style.width = x.pct + '%';
    return h('div', { class: 'level-box' },
      h('div', { class: 'level-row' }, h('span', {}, `Level ${x.level}`), h('span', {}, `${Math.floor(x.pct)}%`)),
      h('div', { class: 'bar' }, fill),
      h('div', { class: 'xp-row' }, h('span', {}, h('b', {}, num(x.xp)), ' XP'),
        x.max ? h('span', {}, 'Maximum level') : h('span', {}, h('b', {}, num(x.toGo)), ` to level ${x.level + 1}`)));
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
    const head = pageHead(id, 'skill-' + id, sk.name, sk.desc, levelBox(id));
    if (sk.group === 'combat') return [head, chainBar(id), ...combatSkillBody(sk)];
    // Every tier on one screen, lowest level first, with a divider where each tier starts.
    const tierOf = a => (G.ITEMS[a.item] || {}).tier || 1;
    const all = G.ACTIONS.filter(a => a.skill === id).sort((x, y) => x.level - y.level || tierOf(x) - tierOf(y));
    const cards = [];
    let lastTier = 0;
    all.forEach(a => {
      const tn = tierOf(a);
      if (all.length > 12 && tn !== lastTier) {
        const t = G.TIERS[tn - 1];
        const div = h('div', { class: 'tier-divider' }, h('span', {}, `Tier ${tn} · ${t.metal}`), h('small', {}, `from level ${a.level}`));
        div.style.setProperty('--tier', t.colour);
        cards.push(div);
      }
      lastTier = tn;
      cards.push(actionCard(a));
    });
    return [head, chainBar(id), section(SKILL_SECTION[id] || 'Actions', 'Hover a card for details. Click it to start, or set a count and start or queue it.', h('div', { class: 'grid' }, cards))];
  }

  // A small item badge (icon and a number) with the item's details on hover.
  const needChip = (id, main, sub, cls = '') => tip(h('span', { class: `need ${cls}` }, itemIco(id, 'sm'), main, sub ? h('small', {}, sub) : null), () => itemTip(id));

  function actionCard(a) {
    const locked = lvl(a.skill) < a.level;
    const active = !!me.state.activity && me.state.activity.id === a.id;
    const out = G.ITEMS[a.item];
    const inputs = Object.entries(a.inputs);
    const outputs = Object.entries(a.outputs);
    const count = h('input', { type: 'number', min: '1', placeholder: '∞', 'aria-label': `How many ${a.name}`, inputmode: 'numeric', disabled: locked });
    const n = () => { const v = parseInt(count.value, 10); return v > 0 ? v : null; };
    const start = async () => {
      await act('/api/action/start', { id: a.id, count: n() }, raiding() ? 'Raid stopped. Training instead.' : null);
    };
    const queue = async () => {
      const q = (me.state.queue || []).concat({ id: a.id, count: n() || 1 });
      if (q.length > G.QUEUE_MAX) { toast(`The queue holds ${G.QUEUE_MAX} actions.`, 'error'); return; }
      await act('/api/queue', { queue: q }, `Queued ${n() || 1} × ${a.name}.`);
    };
    const art = h('div', { class: 'card-art' }, itemIco(a.item, 'xl'));
    if (out) art.style.setProperty('--ic', out.colour);
    const tierBadge = out && out.tier ? h('span', { class: 'tier-badge' }, `T${out.tier}`) : null;
    if (tierBadge) tierBadge.style.setProperty('--tier', out.colour);
    const recipe = h('p', { class: 'tip-desc muted' }, `${a.name}: ${secs(a.time)}, ${a.xp} ${G.SKILL_BY_ID[a.skill].name} XP, level ${a.level}.`);
    const main = tip(h('button', { type: 'button', class: 'card-main', disabled: locked, 'aria-pressed': String(active),
      onclick: () => (active ? act('/api/action/stop', {}) : start()) },
    h('div', { class: 'card-top' }, tierBadge, out && out.type !== 'resource' ? itemName(a.item) : h('span', {}, a.name), h('span', { class: 'card-time' }, secs(a.time))),
    art,
    locked ? h('div', { class: 'card-xp' }, ui('lock', 'sm'), `Level ${a.level}`) : h('div', { class: 'card-xp' }, `${a.xp} XP`),
    inputs.length
      ? h('div', { class: 'needs' }, inputs.map(([id, q]) => needChip(id, String(q), `/${fmt(have(id))}`, have(id) < q ? 'short' : '')))
      : h('div', { class: 'needs' }, outputs.map(([id, q]) => needChip(id, q[0] === q[1] ? `+${q[0]}` : `+${q[0]}–${q[1]}`)),
        a.chance.map(c => needChip(c.item, `${Math.round(c.p * 100)}%`))),
    h('div', { class: 'card-foot' }, h('span', {}, `Owned: ${fmt(have(a.item))}`), active ? h('span', { class: 'ok' }, me.state.activity.left ? `${num(me.state.activity.left)} left` : 'Running') : null)),
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
    const trains = myClass() === cls || (mySubclass() === 'multiclass' && (me.state.multi || {})[myClass()] === cls);
    const abilities = G.ABILITIES.filter(a => a.cls === cls);
    return [
      h('div', { class: 'two-col' },
        h('div', { class: 'panel stack' },
          h('h2', {}, 'How it trains'),
          h('p', {}, `Fight raids with a ${cls} weapon (${kinds.map(w => w.noun).join(', ')}). A win gives the raid’s full XP, a loss a quarter. Multiclassing splits the XP 60/40 between two classes.`),
          cls === 'healer' ? h('p', { class: 'muted' }, 'Healers heal anyone under 80% HP and smite the rest of the time, so they can clear raids alone, just more slowly.') : null,
          h('p', { class: trains ? 'ok' : 'warn' }, trains ? `You are training ${sk.name}.` : `Fit a ${cls} weapon in Equipment to train ${sk.name}.`),
          h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => go('raids') }, 'Go to raids'),
            h('button', { type: 'button', class: 'btn', onclick: () => go('abilities') }, 'Abilities'), h('button', { type: 'button', class: 'btn', onclick: () => go('subclass') }, 'Subclasses'))),
        h('div', { class: 'panel stack' },
          h('h2', {}, 'Current bonus'),
          h('p', { class: 'big-number' }, `+${L - 1}% ${cls === 'healer' ? 'healing and smite' : `${sk.name.toLowerCase()} damage`}`),
          h('h3', {}, 'Abilities'),
          h('ul', { class: 'ability-mini' }, abilities.map(ab => h('li', { class: L >= ab.level ? 'ok' : 'muted' }, gi('ab_' + ab.id, null, 'sm'), `${ab.name} · level ${ab.level}`))))),
      section('Weapons', `Made with ${G.SKILL_BY_ID[kinds[0].maker].name}. Each tier needs the previous region’s raid material.`,
        h('div', { class: 'weapon-table' }, [...kinds, off].map(w => h('div', { class: 'weapon-kind' },
          h('div', { class: 'weapon-kind-head' }, gi(G.ITEMS[`copper_${w.id}`].icon, null, 'md'),
            h('div', {}, h('b', {}, w.noun[0].toUpperCase() + w.noun.slice(1) + (w === off ? ' (off-hand)' : '')), h('small', { class: 'muted' }, w.note))),
          h('div', { class: 'tier-row' }, G.TIERS.map(t => {
            const id = `${t.id}_${w.id}`;
            const recipe = G.ACTION_BY_ID['craft_' + id];
            const on = me.state.equipment.weapon === id || me.state.equipment.offhand === id;
            return h('button', { type: 'button', class: `tier-cell${on ? ' on' : ''}${have(id) ? ' owned' : ''}`, title: G.ITEMS[id].name,
              disabled: !have(id) || on, onclick: () => act('/api/equip', { item: id }, `${G.ITEMS[id].name} fitted.`) },
            itemIco(id, 'md'), h('small', {}, on ? 'Fitted' : have(id) ? `${have(id)} owned` : `Lv ${recipe.level}`));
          })))))),
    ];
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
          section('Fitted gear', raiding() ? 'Changes take effect from your next fight.' : null, h('div', { class: 'slot-list' }, G.SLOTS.map(slot => {
            const it = eq[slot.id] && G.ITEMS[eq[slot.id]];
            const blocked = slot.id === 'offhand' && G.ITEMS[eq.weapon] && G.ITEMS[eq.weapon].twoHanded;
            const empty = { weapon: 'sword_0', offhand: 'shield_0', head: 'plate_head_0', body: 'plate_body_0', legs: 'plate_legs_0', hands: 'plate_hands_0', feet: 'plate_feet_0', trinket: 'sigil_0' }[slot.id];
            return h('div', { class: `slot${it ? '' : ' empty-slot'}` },
              it ? itemIco(it.id) : gi(empty, '#4a5160'),
              h('div', { class: 'slot-info' }, h('small', {}, slot.name), it ? itemName(it.id, 'b') : h('b', {}, blocked ? 'Used by your two-handed weapon' : 'Empty'), statsLine(it)),
              it ? h('button', { type: 'button', class: 'btn small', onclick: () => act('/api/unequip', { slot: slot.id }) }, 'Remove') : null);
          }))),
          section('Raid supplies', supplies.length ? 'Ticked supplies go into every fight while you have them. Potions are only drunk when needed; buffs are used up each fight. Class buffs only apply to their class.' : null,
            supplies.length ? h('div', { class: 'slot-list' }, supplies.map(it => {
              const on = me.state.supplies[it.id] !== false;
              const box = h('input', { type: 'checkbox', checked: on, 'aria-label': `Bring ${it.name}`, onchange: e => act('/api/supplies', { item: it.id, on: e.target.checked }) });
              return h('label', { class: `slot supply${on ? '' : ' off'}` }, box, itemIco(it.id),
                h('div', { class: 'slot-info' }, h('small', {}, `${num(have(it.id))} owned${it.cls ? ` · ${G.CLASSES[it.cls].name} only` : ''}`), itemName(it.id, 'b'), h('span', { class: 'muted small' }, it.desc)));
            })) : h('div', { class: 'empty' }, 'No potions or buffs yet. Brew them with Alchemy, Honing, Poisoncraft or Runecrafting.')),
          section('Gear in storage', gear.length ? null : 'Craft weapons and armour, trade for them, or win set pieces from raids.',
            gear.length ? G.SLOTS.filter(sl => slotsBy[sl.id]).map(sl => collapsible(`gear-${sl.id}`, sl.name, `${slotsBy[sl.id].length}`,
              h('div', { class: 'slot-list' }, slotsBy[sl.id].sort((x, y) => G.ITEMS[y].tier - G.ITEMS[x].tier).map(id => {
                const it = G.ITEMS[id];
                return h('div', { class: `slot${it.rare ? ' rare-slot' : ''}` }, itemIco(id),
                  h('div', { class: 'slot-info' }, h('small', {}, `Tier ${it.tier} · ${have(id)} owned`), itemName(id, 'b'), statsLine(it)),
                  h('button', { type: 'button', class: 'btn small primary', onclick: () => act('/api/equip', { item: id }) }, 'Fit'));
              })), true)) : h('div', { class: 'empty' }, 'No spare gear yet.')))),
    ];
  }

  // ---------- Inventory ----------
  let invFilter = 'all';
  let invSelected = null;
  const TYPE_ORDER = { resource: 0, material: 1, consumable: 2, gear: 3 };
  const TYPE_NAME = { resource: 'Resource', material: 'Raid material', consumable: 'Consumable', gear: 'Gear' };

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
          ? h('div', { class: 'tiles' }, shown.map(id => {
            const tile = h('button', {
              type: 'button', class: `tile${G.ITEMS[id].rare ? ' rare-tile' : ''}`, title: G.ITEMS[id].name, 'aria-label': `${G.ITEMS[id].name}, ${have(id)}`,
              'aria-pressed': String(invSelected === id), onclick: () => { invSelected = id; renderPage(); },
            }, itemIco(id), h('span', { class: 'qty' }, fmt(have(id))));
            tile.style.setProperty('--tier', G.ITEMS[id].colour);
            return tile;
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
    const set = it.set ? G.REGIONS[it.set - 1].set : null;
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
    if (mySubclass(cls) === 'multiclass' && (me.state.multi || {})[cls]) set.add(me.state.multi[cls]);
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
      h('p', { class: 'muted' }, `You can use abilities from: ${[...usable].map(c => G.CLASSES[c].name).join(', ')}. A multiclass or an off-hand from another class adds that class.`),
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
      pageHead('subclass', 'skill-healing', 'Subclasses', 'At level 5 in a combat class, pick one of its two subclasses. At level 10 you can instead multiclass: train a second class alongside it and use both classes’ abilities.'),
      ...Object.values(G.CLASSES).map(c => {
        const L = lvl(c.skill);
        const current = subs[c.id];
        const options = G.SUBCLASSES.filter(s => s.cls === c.id);
        const secondSel = h('select', { 'aria-label': 'Second class' }, Object.values(G.CLASSES).filter(o => o.id !== c.id).map(o => h('option', { value: o.id, selected: multi[c.id] === o.id || null }, o.name)));
        const card = (sub, extra) => h('div', { class: `sub-card${current === sub.id ? ' chosen' : ''}${L < sub.level ? ' locked' : ''}` },
          gi('sub_' + sub.id, c.colour, 'xl'),
          h('div', { class: 'grow' }, h('h3', {}, sub.name, current === sub.id ? h('span', { class: 'ok small' }, ' · chosen') : null), h('p', {}, sub.desc),
            sub.id === 'multiclass' && current === 'multiclass' ? h('p', { class: 'ok small' }, `Also training ${G.CLASSES[multi[c.id]].name}.`) : null),
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
  const creditsPage = () => [
    pageHead('credits', 'skill-ranged', 'Credits', null),
    h('section', { class: 'panel stack' },
      h('h2', {}, 'Icons'),
      h('p', {}, `Item, skill, ability, subclass and enemy icons are from game-icons.net, made by ${window.GAME_ICON_AUTHORS.join(', ')}. They are licensed under Creative Commons Attribution 3.0 and are recoloured and, for enemies, redrawn as pixel art in the game.`),
      h('p', {}, h('a', { href: 'https://game-icons.net', target: '_blank', rel: 'noopener' }, 'game-icons.net'), ' · ',
        h('a', { href: 'https://creativecommons.org/licenses/by/3.0/', target: '_blank', rel: 'noopener' }, 'CC BY 3.0 licence')),
      h('h2', {}, 'Fonts'),
      h('p', {}, 'Inter and Chakra Petch, from Google Fonts (SIL Open Font License).')),
  ];

  // ---------- Raids ----------
  const DIFF_KEY = 'mekaidle-diff';
  const STYLE_NAME = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic' };
  const VIS_LABEL = { private: 'Closed (solo)', friends: 'Friends and guild', public: 'Everyone' };
  const clearsOf = id => (me.state.clears || {})[id] || 0;
  function raidOpen(r, diff) {
    if (diff === 'normal') return r.n === 1 || clearsOf(`r${r.n - 1}`) >= 1;
    return clearsOf(r.id) >= (diff === 'heroic' ? 1 : 2);
  }
  const diffScale = d => Math.sqrt(G.DIFF_BY_ID[d].hp * G.DIFF_BY_ID[d].dmg);
  function diffTag(d) {
    const x = G.DIFF_BY_ID[d || 'normal'];
    const e = h('span', { class: 'diff-tag' }, x.name);
    e.style.setProperty('--diff', x.colour);
    return e;
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
  function lootIcons(r, diff) {
    return h('div', { class: 'loot-icons', 'aria-label': 'Drops on a win' }, r.drops.map(x => {
      const text = dropText(x, diff);
      const chip = h('span', { class: `loot-ico${x.rare ? ' rare' : ''}` }, itemIco(x.item, 'sm'), h('small', {}, text));
      return tip(chip, () => itemTip(x.item, h('p', { class: x.rare ? 'rare-loot' : 'ok' }, x.p ? `${text} chance per win` : `${text} per win`)));
    }));
  }

  function raidRow(r, diff, ctx) {
    const d = G.DIFF_BY_ID[diff];
    const open = raidOpen(r, diff);
    const here = ctx.current && ctx.current.raid === r.id && ctx.current.diff === diff;
    const rec = Math.round(r.recommended * diffScale(diff));
    const ratio = ctx.power / rec;
    const pClass = ratio >= 1 ? 'ok' : ratio >= 0.8 ? 'warn' : 'bad';
    const pips = h('span', { class: 'clears', title: 'Cleared on Normal, Heroic, Mythic' }, G.DIFFICULTIES.map((x, i) => {
      const s = h('span', { class: `clear-pip${clearsOf(r.id) > i ? ' on' : ''}` });
      s.style.setProperty('--diff', x.colour);
      return s;
    }));
    let buttons;
    if (!open) buttons = h('span', { class: 'lock-note' }, ui('lock', 'sm'), diff === 'normal' ? `Clear #${r.n - 1}` : `Clear on ${diff === 'heroic' ? 'Normal' : 'Heroic'}`);
    else if (here) buttons = h('button', { type: 'button', class: 'btn small danger', onclick: ctx.stop }, 'Stop');
    else {
      buttons = [h('button', { type: 'button', class: 'btn small primary', onclick: () => ctx.start(r, diff) }, 'Fight'),
        h('button', { type: 'button', class: 'btn small', disabled: !!ctx.party, title: 'Form a party others can join', onclick: () => ctx.form(r, diff) }, 'Party')];
    }
    return h('div', { class: `raid-row${here ? ' fighting' : ''}${open ? '' : ' locked'}${r.finale ? ' finale' : ''}` },
      h('span', { class: 'raid-n' }, `#${r.n}`),
      h('span', { class: 'boss-ico' }, bossIcon(r)),
      h('div', { class: 'raid-info' }, h('b', {}, r.name, r.finale ? h('span', { class: 'finale-tag' }, 'Finale') : null), weakChips(r)),
      h('div', { class: 'raid-power', title: 'Your power / recommended' }, h('small', {}, 'Power'), h('b', { class: pClass }, `${fmt(ctx.power)} / ${fmt(rec)}`)),
      lootIcons(r, diff),
      pips,
      h('div', { class: 'raid-btns' }, buttons));
  }

  function raidsPage() {
    const battle = createBattle();
    const partyBox = h('div'), openBox = h('div'), bossBox = h('div');
    let data = { party: null, open: [] };
    let diff = G.DIFF_BY_ID[store(DIFF_KEY)] ? store(DIFF_KEY) : 'normal';
    const ctx = {
      start: startSolo, stop: stopRaid,
      form: (r, d) => partyAct('/api/party/create', { raid: r.id, diff: d }, 'Party formed. Friends and guildmates can join.'),
    };

    function drawBosses() {
      const a = me.state.activity;
      ctx.current = a && a.type === 'raid' ? { raid: a.raid, diff: a.diff || 'normal' } : null;
      ctx.party = data.party;
      ctx.power = G.power(myStats());
      const dd = G.DIFF_BY_ID[diff];
      const diffBar = h('div', { class: 'diff-bar' },
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Difficulty' }, G.DIFFICULTIES.map(x => {
          const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(x.id === diff), onclick: () => { diff = x.id; store(DIFF_KEY, diff); drawBosses(); } }, x.name);
          b.style.setProperty('--chip', x.colour);
          return b;
        })),
        h('span', { class: 'muted small' }, diff === 'normal' ? 'Base rewards. Clear a raid on Normal to unlock the next one and its Heroic mode.'
          : `Enemies have ${dd.hp}× HP and hit ${dd.dmg}× harder. ${dd.xp}× XP, ${dd.mats}× materials and ${dd.drop}× rare drop chance.`));
      const frontier = Math.max(1, ...G.RAIDS.filter(r => raidOpen(r, 'normal')).map(r => r.n));
      const regions = G.REGIONS.map((reg, ri) => {
        const raids = G.RAIDS.filter(r => r.region === ri);
        const unlocked = raidOpen(raids[0], 'normal');
        const cleared = raids.filter(r => clearsOf(r.id) >= 1).length;
        const note = unlocked ? `Tier ${ri + 1} · ${cleared}/25 cleared` : 'Locked';
        const title = h('span', { class: 'region-title' }, bossIcon(raids[24]), reg.name);
        title.style.setProperty('--tier', G.TIERS[ri].colour);
        const body = unlocked ? h('div', { class: 'raid-list' }, raids.map(r => raidRow(r, diff, ctx)))
          : h('div', { class: 'empty' }, `Beat ${G.REGIONS[ri - 1].finale} (#${ri * 25}) to open ${reg.name}.`);
        return collapsible(`region-${ri}`, title, note, body, raids.some(r => r.n === frontier));
      });
      bossBox.replaceChildren(collapsible('bosses', 'Bosses', '250 raids in 10 regions', h('div', {}, diffBar, regions), true));
    }

    function visibilityPicker(current, disabled) {
      const sel = h('select', { 'aria-label': 'Who can join', disabled }, Object.entries(VIS_LABEL).map(([v, label]) => h('option', { value: v, selected: v === current || null }, label)));
      sel.addEventListener('change', async () => {
        if (await act('/api/raid/open', { visibility: sel.value }, `Party is now open to: ${VIS_LABEL[sel.value].toLowerCase()}.`)) { await poll(); load(); battle.sync(true); }
      });
      return sel;
    }

    function drawParty() {
      const p = data.party;
      if (!p) partyBox.replaceChildren();
      else {
        const raid = G.RAID_BY_ID[p.raid];
        const leader = p.leader === me.player.id;
        const note = p.running ? `Raiding now · fight ${p.running.n}` : `Breaks up ${fmtTime(p.expires - now())} from now if not started.`;
        partyBox.replaceChildren(section('Your party', note,
          h('div', { class: 'panel party' },
            h('div', { class: 'raid-top' }, h('span', { class: 'boss-ico' }, bossIcon(raid)),
              h('div', { class: 'raid-title' }, h('small', { class: 'muted' }, `#${raid.n} · ${raid.regionName}`), h('h3', {}, raid.name, ' ', diffTag(p.diff))),
              h('span', { class: 'muted' }, `${p.members.length} / ${G.PARTY_MAX} pilots`)),
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
              h('button', { type: 'button', class: 'btn danger', onclick: () => partyAct('/api/party/leave', {}, leader ? 'Party disbanded.' : 'You left the party.') }, leader ? 'Disband' : 'Leave')))));
      }
      openBox.replaceChildren(collapsible('open-parties', 'Open parties', data.open.length ? `${data.open.length} open` : 'none right now',
        data.open.length ? h('div', { class: 'list' }, data.open.map(o => {
          const raid = G.RAID_BY_ID[o.raid];
          const lead = o.members.find(m => m.id === o.leader) || o.members[0];
          return h('div', { class: 'row' },
            h('span', { class: 'boss-ico' }, bossIcon(raid)),
            h('div', { class: 'grow' }, h('div', { class: 'name' }, `${lead ? lead.name : 'Someone'}’s party `, diffTag(o.diff)),
              h('small', {}, `#${raid.n} ${raid.name} · ${o.members.length}/${G.PARTY_MAX} pilots${o.running ? ' · raiding now' : ''}${o.visibility === 'public' ? ' · open to everyone' : ''}`)),
            h('button', { type: 'button', class: 'btn small primary', disabled: !!data.party, onclick: () => partyAct('/api/party/join', { id: o.id }, 'Joined the party.') }, 'Join'));
        })) : h('div', { class: 'empty' }, 'No open parties. Form one from a raid below, open your running raid to others, or add friends and join a guild to see theirs.'), true));
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
      if (await act('/api/raid/start', { raid: r.id, diff: d }, `Fighting ${r.name}. Fights repeat until you stop.`)) {
        load(); battle.sync(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
    async function stopRaid() {
      if (await act('/api/action/stop', {}, 'Stopped fighting.')) { load(); battle.sync(true); }
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

    pageRefresh = load;
    pageTick = () => battle.sync();
    pageCleanup = () => battle.destroy();
    drawBosses();
    drawParty();
    load();
    battle.sync();
    return [
      pageHead('raids', 'skill-melee', 'Raids', 'Pick a raid and press Fight. Fights repeat on their own, even while you’re away, until you stop or start a skill. Each fight is a few waves of enemies, then the boss.'),
      battle.el, partyBox, openBox, bossBox,
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

  function createBattle() {
    const root = h('section', { class: 'battle', 'aria-label': 'Current raid fight' });
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const self = { el: root, sync, destroy, onStop: null, onChange: null };
    let cur = null, raf = 0, fetching = false, idx = 0, quiet = false, asked = false;
    let party = [], foes = {}, foeBox, waveEl, clockEl, statusEl, meterList, meterRows = [], graphBox, graphSvg, graphAxisY, graphAxisX, graphCursor, graphTip;
    let stats = [], buckets = {}, lastMeter = 0, lastSec = -1, graphData = null;
    const expanded = new Set();
    const logItems = [];
    let lastLootAt = null;
    const logList = h('ol', { class: 'log-list', 'aria-live': 'off' });

    function destroy() { cancelAnimationFrame(raf); }

    // ----- Fight log -----
    function who(i) {
      const u = party[i];
      const b = h('b', { class: 'log-who' }, u ? u.name : '?');
      if (u) b.style.color = u.colour;
      return b;
    }
    const foeName = id => h('b', { class: 'log-foe' }, foes[id] ? foes[id].name : 'an enemy');
    function addLog(at, kind, parts, cls) {
      const li = h('li', { class: `log-${cls || kind}` }, h('time', {}, clockOf(at)), h('span', {}, parts));
      logItems.push({ kind, li });
      if (logItems.length > 400) logItems.shift().li.remove();
      if (logFilter === 'all' || logFilter === kind) logList.prepend(li);
    }
    function drawLog() {
      logList.replaceChildren(...logItems.filter(x => logFilter === 'all' || x.kind === logFilter).map(x => x.li).reverse());
    }
    function logPanel() {
      const tabs = h('div', { class: 'chips small', role: 'group', 'aria-label': 'Filter the log' }, LOG_FILTERS.map(([id, label]) =>
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(logFilter === id), onclick: e => {
          logFilter = id;
          tabs.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
          drawLog();
        } }, label)));
      return collapsible('battle-log', 'Raid log', null, h('div', { class: 'log' }, tabs, h('div', { class: 'log-scroll' }, logList)), true);
    }
    // Loot and XP arrive with the next poll after a fight ends.
    function checkLoot() {
      const e = me && me.state.raidLog && me.state.raidLog[0];
      if (!e) return;
      if (lastLootAt === null) { lastLootAt = e.at; return; }
      if (e.at <= lastLootAt) return;
      me.state.raidLog.filter(x => x.at > lastLootAt).reverse().forEach(x => {
        const raid = G.RAID_BY_ID[x.raid];
        const loot = Object.entries(x.loot || {}).filter(([id]) => G.ITEMS[id]);
        addLog(x.at, 'loot', [h('b', { class: x.win ? 'ok' : 'bad' }, x.win ? 'Victory' : 'Defeat'), ` against ${raid ? raid.name : 'a raid'}: ${xpText(x.xp)}`,
          loot.length ? ' · ' : '', loot.map(([id, n]) => h('span', { class: `log-loot${G.ITEMS[id].rare ? ' rare-loot' : ''}` }, itemIco(id, 'sm'), `${num(n)} `, itemName(id)))], 'loot');
      });
      lastLootAt = e.at;
    }

    function idle() {
      cancelAnimationFrame(raf);
      cur = null;
      root.replaceChildren(
        h('div', { class: 'battle-empty' },
          h('div', { class: 'battle-empty-art' }, mechArt(me.state.equipment, 'Your mech'), h('span', { class: 'vs' }, 'VS'), h('span', { class: 'unknown' }, '?')),
          h('div', {}, h('h2', {}, 'No fight running'), h('p', { class: 'muted' }, 'Choose a raid below and press Fight, or join a party. Your fights play out here.'))),
        logItems.length ? logPanel() : '');
    }

    async function sync(force) {
      checkLoot();
      const a = me && me.state.activity;
      if (!a || !a.type) { if (cur || !root.firstChild) idle(); return; }
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
      const artBox = h('div', { class: 'unit-art' }, o.art);
      const hpFill = h('span', { class: 'hp-fill' }), hpTrail = h('span', { class: 'hp-trail' }), hpShield = h('span', { class: 'hp-shield' }), hpText = h('b');
      const hpBar = h('div', { class: 'hpbar' }, hpTrail, hpFill, hpShield, hpText);
      const manaFill = h('span');
      const manaBar = o.enemy ? null : h('div', { class: 'manabar', title: 'Mana' }, manaFill);
      const castFill = h('span'), castText = h('b');
      const castBar = h('div', { class: 'castbar idle' }, castFill, castText);
      const statuses = h('div', { class: 'statuses' });
      const el = h('div', { class: `unit${o.enemy ? ' enemy' : ' pilot'}${o.boss ? ' boss' : ''}` }, artBox,
        h('div', { class: 'unit-info' },
          h('div', { class: 'unit-name' }, o.cls ? classIco(o.cls) : null, h('span', { class: 'unit-label' }, o.name), o.sub || null, o.kick || null),
          hpBar, manaBar, castBar, statuses),
        floats);
      if (o.colour) el.style.setProperty('--series', o.colour);
      const u = { ...o, el, artBox, floats, hpFill, hpTrail, hpShield, hpText, hpBar, manaFill, castFill, castText, castBar, statuses, hp: o.max, barrier: 0, cast: null, down: false, buffs: {}, mana: o.maxMana };
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
    function float(u, value, label, colour, big, kind) {
      if (quiet) return;
      if (u.floats.childElementCount > 7) u.floats.firstElementChild.remove();
      const s = h('span', { class: `float ${kind || ''}${big ? ' big' : ''}` }, h('b', {}, value), label ? h('small', {}, label) : null);
      s.style.left = `${10 + Math.random() * 70}%`;
      s.style.top = `${Math.random() * 40}%`;
      s.style.setProperty('--fc', colour);
      u.floats.append(s);
      setTimeout(() => s.remove(), 1400);
    }
    function pulse(u, cls) {
      if (quiet || reduced) return;
      const el = cls === 'glow' ? u.el : u.artBox;
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
    function load(c) {
      cancelAnimationFrame(raf);
      cur = c;
      idx = 0;
      asked = false;
      lastSec = -1;
      const f = c.fight;
      const raid = G.RAID_BY_ID[f.raid];
      const info = c.partyInfo;
      const leader = !c.party || c.leader === me.player.id;
      party = f.fighters.map((p, i) => {
        const colour = G.CLASSES[p.cls].colour;
        const kick = c.party && leader && p.id !== me.player.id
          ? h('button', { type: 'button', class: 'icon-btn tiny kick', title: 'Remove from party', 'aria-label': `Remove ${p.name} from the party`, onclick: () => kick_(p) }, ui('close', 'sm')) : null;
        return makeUnit({ i, id: p.id, name: p.name, cls: p.cls, colour, max: p.max, maxMana: p.mana, art: mechArt(p.gear || {}, `${p.name}’s mech`), kick,
          sub: p.subclass ? h('small', { class: 'unit-sub' }, G.SUBCLASS_BY_ID[p.subclass].name) : null });
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
        const fill = h('span'), val = h('span', { class: 'meter-val' }), detail = h('div', { class: 'meter-detail', hidden: true });
        fill.style.background = party[i].colour;
        const btn = h('button', { type: 'button', class: 'meter-row', 'aria-expanded': String(expanded.has(p.id)), onclick: () => {
          if (expanded.has(p.id)) expanded.delete(p.id); else expanded.add(p.id);
          btn.setAttribute('aria-expanded', String(expanded.has(p.id)));
          drawMeter(Math.min(now() - cur.start, cur.fight.ms));
        } }, h('div', { class: 'meter-name' }, classIco(p.cls), h('span', { class: 'grow' }, p.name), val), h('div', { class: 'meter-bar' }, fill));
        return { item: h('div', { class: 'meter-item' }, btn, detail), btn, fill, val, detail, i, id: p.id };
      });
      meterList = h('div', { class: 'meter' }, meterRows.map(r => r.item));
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
          h('div', { class: 'battle-actions' }, vis, h('button', { type: 'button', class: 'btn small danger', onclick: () => self.onStop && self.onStop() }, stopLabel))),
        waveEl,
        h('div', { class: 'battle-loot' }, h('small', {}, 'Drops on a win'), lootIcons(raid, c.diff)),
        h('div', { class: 'battle-stage' },
          h('div', { class: 'side pilots' }, party.map(u => u.el)),
          h('div', { class: 'side foes' }, foeBox)),
        collapsible('battle-meter', 'Damage meter and graph', 'click to show or hide', h('div', { class: 'battle-stats' },
          h('div', { class: 'battle-cell' }, h('div', { class: 'cell-head' }, h('h3', {}, 'Meter'), modeTabs), h('small', { class: 'muted' }, 'Click a pilot for a breakdown.'), meterList),
          h('div', { class: 'battle-cell' }, h('div', { class: 'cell-head' }, h('h3', {}, 'Over time'), h('small', { class: 'muted' }, '5-second average · hover for numbers')), graphBox)), false),
        logPanel());

      addLog(c.start, 'kills', [`Fight ${c.n}: `, h('b', {}, raid.name), ` (${G.DIFF_BY_ID[c.diff || 'normal'].name})`], 'fight');
      // Joining mid-fight: catch up to the current moment without animations.
      const clock = now() - c.start;
      quiet = true;
      while (idx < f.events.length && f.events[idx].t <= clock) apply(f.events[idx++]);
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

    // ----- Applying events -----
    function apply(e) {
      const at = cur.start + e.t;
      if (e.e === 'wave') {
        foes = {};
        const units = e.foes.map(x => {
          const u = makeUnit({ name: x.name, enemy: true, boss: x.boss, max: x.max, art: foeArt(x.foe, x.boss, '', x.boss ? 48 : 32) });
          foes[x.id] = u;
          return u;
        });
        foeBox.replaceChildren(...units.map(u => u.el));
        drawWave(e.w, e.of);
        addLog(at, 'kills', [e.boss ? h('b', {}, `Boss: ${e.foes[0].name}`) : `Wave ${e.w + 1} of ${e.of}: `, e.boss ? '' : e.foes.map(x => x.name).join(', ')], 'wave');
      } else if (e.e === 'cast') {
        const u = unitOf(e.a);
        if (!u) return;
        u.cast = { start: e.t, d: e.d };
        u.castText.textContent = castLabel(e);
        u.castBar.className = `castbar k-${e.k}`;
        if (e.m != null && u.maxMana) { u.mana = e.m; drawMana(u); }
        if (typeof e.a === 'number' && ABILITY_NAMES.has(e.n)) addLog(at, 'abilities', [who(e.a), ` casts ${e.n}`], 'ability');
        else if (e.k === 'danger') addLog(at, 'abilities', [foeName(e.a), ` begins ${e.n}!`], 'danger');
      } else if (e.e === 'hit') hit(e);
      else if (e.e === 'buff') {
        const targets = e.tg === 'all' ? party.filter(u => !u.down) : [unitOf(e.tg)].filter(Boolean);
        targets.forEach(u => {
          if (e.until) u.buffs[e.n] = { until: e.until, cls: typeof e.tg === 'string' ? 'debuff' : 'buff' };
          if (e.b != null) { u.barrier = e.b; drawHp(u); }
        });
      } else if (e.e === 'down') {
        const u = party[e.tg];
        Object.assign(u, { down: true, respawnAt: e.at, cast: null, hp: 0, barrier: 0, buffs: {} });
        u.el.classList.add('down');
        u.castBar.className = 'castbar idle';
        u.castFill.style.width = '0';
        u.castText.textContent = 'Downed';
        drawHp(u);
        addLog(at, 'kills', [who(e.tg), ' was downed. Respawning in 25s.'], 'death');
      } else if (e.e === 'respawn') {
        const u = party[e.tg];
        u.down = false;
        u.hp = e.hp != null ? e.hp : u.max;
        u.el.classList.remove('down');
        u.castText.textContent = '';
        drawHp(u);
        pulse(u, 'glow');
        addLog(at, 'kills', [who(e.tg), e.n === 'Respawned' ? ' respawned' : ` was brought back by ${e.n}`], 'respawn');
      } else if (e.e === 'kill') {
        const u = foes[e.tg];
        if (u) {
          Object.assign(u, { hp: 0, down: true, cast: null });
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
        addLog(at, 'kills', [h('b', { class: e.win ? 'ok' : 'bad' }, e.win ? 'Victory' : 'Stopped'), ` in ${fmtClock(e.t)}`], e.win ? 'win' : 'death');
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
        if (e.k === 'potion') addLog(cur.start + e.t, 'abilities', [who(e.tg), ` drinks a ${(e.n || e.sr).toLowerCase()}`], 'potion');
        float(target, `+${num(e.v)}${e.c ? '!' : ''}`, e.k === 'potion' ? 'Potion' : e.sr, '#4ee08f', e.c, 'heal');
        pulse(target, 'glow');
      } else if (typeof e.tg === 'number') {
        // An enemy hitting a pilot.
        if (e.ab) target.barrier = e.b || 0;
        target.hp = Math.max(0, target.hp - (e.v - (e.ab || 0)));
        const src = `${foes[e.a] ? foes[e.a].name : 'Enemy'}: ${e.sr}`;
        bump('taken', e.tg, src, e.v - (e.ab || 0));
        bump('mit', e.tg, src, Math.max(0, (e.raw || e.v) - e.v) + (e.ab || 0));
        float(target, `${num(e.v)}${e.c ? '!' : ''}`, e.ab ? `${e.ty} · ${num(e.ab)} absorbed` : e.ty, '#ff6b5b', e.c, 'taken');
        pulse(target, 'shake');
      } else {
        // A pilot hitting an enemy.
        target.hp = Math.max(0, target.hp - e.v);
        bump('dps', e.a, e.sr, e.v);
        const from = party[e.a];
        float(target, `${num(e.v)}${e.c ? '!' : ''}`, e.ty, from ? from.colour : '#fff', e.c, e.k === 'dot' ? 'dot' : 'dmg');
        if (e.k !== 'dot') pulse(target, 'shake');
      }
      drawHp(target);
    }

    function drawStatuses(clock) {
      const tank = party.find(u => !u.down && cur.fight.fighters[u.i].subclass === 'guardian');
      Object.values(foes).forEach(u => {
        if (tank && !u.down) u.buffs.Taunted = { until: Infinity, cls: 'taunt', label: `Taunted by ${tank.name}` };
        else delete u.buffs.Taunted;
      });
      [...party, ...Object.values(foes)].forEach(u => {
        const chips = Object.entries(u.buffs).filter(([, b]) => b.until > clock).map(([n, b]) => h('span', { class: `status ${b.cls}` }, b.label || n));
        if (u.down && u.respawnAt && !u.enemy) chips.unshift(h('span', { class: 'status down' }, `Respawn in ${Math.max(0, Math.ceil((u.respawnAt - clock) / 1000))}s`));
        u.statuses.replaceChildren(...chips);
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
      meterRows.slice().sort((a, b) => shown[b.i] - shown[a.i]).forEach(r => {
        meterList.append(r.item);
        r.fill.style.width = `${(shown[r.i] / top) * 100}%`;
        r.val.textContent = `${rate ? shown[r.i].toFixed(1) : num(vals[r.i])}${unit} · ${Math.round((vals[r.i] / total) * 100)}%`;
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

    function drawGraph(clock) {
      const sec = Math.floor(clock / 1000);
      const span = Math.max(20, sec + 1);
      const series = buckets[meterMode].map(b => {
        const pts = [];
        for (let x = 0; x <= sec; x++) {
          let sum = 0;
          for (let k = Math.max(0, x - 4); k <= x; k++) sum += b[k] || 0;
          pts.push(sum / Math.min(5, x + 1));
        }
        return pts;
      });
      const top = niceMax(Math.max(10, ...series.flat()) * 1.05);
      graphData = { series, span, sec, top };
      const W = 1000, H = 300;
      const X = x => (x / span) * W, Y = v => H - (v / top) * H;
      const grid = [0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" class="gl" vector-effect="non-scaling-stroke"/>`).join('');
      const seen = {};
      const lines = series.map((pts, i) => {
        const colour = party[i].colour;
        const dash = seen[colour] ? ' stroke-dasharray="6 4"' : '';
        seen[colour] = true;
        return `<polyline fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"${dash} points="${pts.map((v, x) => `${X(x).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;
      }).join('');
      graphSvg.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${grid}${lines}</svg>`;
      graphAxisY.replaceChildren(...[1, 0.75, 0.5, 0.25, 0].map(f => h('span', {}, fmt(top * f))));
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

    function tick(t) {
      if (!cur) return;
      const f = cur.fight;
      const clock = Math.min(now() - cur.start, f.ms);
      while (idx < f.events.length && f.events[idx].t <= clock) apply(f.events[idx++]);
      [...party, ...Object.values(foes)].forEach(u => {
        if (u.cast && !u.down) u.castFill.style.width = `${Math.min(1, (clock - u.cast.start) / u.cast.d) * 100}%`;
        else if (!u.cast) u.castFill.style.width = '0';
      });
      clockEl.textContent = fmtClock(clock);
      if (now() - cur.start >= f.ms) {
        const next = cur.start + f.ms + G.FIGHT.gapMs - now();
        statusEl.className = `battle-status ${f.win ? 'ok' : 'bad'}`;
        statusEl.textContent = `${f.win ? 'Victory' : 'Stopped'} · next fight ${next > 0 ? `in ${Math.ceil(next / 1000)}s` : 'starting'}`;
        // Ask the server to move on once the gap is over.
        if (next < -300 && !asked) { asked = true; poll(); }
      } else {
        statusEl.className = 'battle-status live';
        statusEl.textContent = 'Fighting';
      }
      if (t - lastMeter > 250) { lastMeter = t; drawMeter(clock); drawStatuses(clock); }
      const sec = Math.floor(clock / 1000);
      if (sec !== lastSec) { lastSec = sec; drawGraph(clock); }
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

    function drawNoGuild(data) {
      lastChatId = 0;
      const name = h('input', { name: 'name', required: true, maxlength: '24' });
      const tag = h('input', { name: 'tag', required: true, maxlength: '4', spellcheck: 'false' });
      const enough = have('gold') >= G.GUILD_COST;
      body.replaceChildren(h('div', { class: 'two-col' },
        section('Found a guild', `Costs ${num(G.GUILD_COST)} gold. You have ${num(have('gold'))}.`,
          h('form', { class: 'panel', onsubmit: async e => {
            e.preventDefault();
            if (await act('/api/guild/create', { name: name.value, tag: tag.value }, 'Guild founded.')) { await poll(); load(); }
          } },
            h('div', { class: 'form-row' }, h('label', { class: 'field' }, 'Guild name', name), h('label', { class: 'field' }, 'Tag (2–4)', tag)),
            h('p', { class: 'actions section' }, h('button', { type: 'submit', class: 'btn primary', disabled: !enough }, enough ? 'Found guild' : 'Not enough gold')))),
        section('Guilds', 'Open to join. Up to 30 pilots each.',
          data.guilds.length ? h('div', { class: 'list' }, data.guilds.map(g => h('div', { class: 'row' },
            h('div', { class: 'grow' }, h('div', { class: 'name' }, g.name, h('span', { class: 'tag' }, ` [${g.tag}]`)), h('small', {}, `${plural(g.members, 'pilot')} · total level ${num(g.level)}`)),
            h('button', { type: 'button', class: 'btn small primary', disabled: g.members >= 30, onclick: async () => { if (await act('/api/guild/join', { id: g.id }, `Welcome to ${g.name}.`)) { await poll(); load(); } } }, g.members >= 30 ? 'Full' : 'Join'))))
            : h('div', { class: 'empty' }, 'No guilds yet. Be the first to found one.'))));
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
    fights: fightsPage, trade: tradePage, guild: guildPage, social: socialPage, patch: patchPage, credits: creditsPage,
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
