'use strict';
(function () {
  const G = window.GAME;
  const I = window.ICONS;
  const POLL_MS = 3000;
  const PAGE_KEY = 'mekaidle-page';

  // ---------- Utilities ----------
  const $ = id => document.getElementById(id);

  // Builds an element. `html` is only ever used for our own icon markup.
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
  const ui = (name, cls = '') => h('span', { class: `ico ${cls}`, 'aria-hidden': 'true', html: I.ui(name) });
  const itemIco = (id, cls = '') => {
    const it = G.ITEMS[id];
    return h('span', { class: `ico ${cls}`, 'aria-hidden': 'true', html: I.item(it.icon, it.colour) });
  };

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

  // ---------- Session state ----------
  let me = null;      // latest /api/me payload
  let offset = 0;     // server clock minus local clock
  let page = store(PAGE_KEY) || 'skill:scrapping';
  let pollTimer = null;
  let polls = 0;
  let lastRaidAt = 0;
  let pageRefresh = null; // refresh hook for pages that load their own data

  const now = () => Date.now() + offset;
  const lvl = skill => G.levelFromXp(me.state.skills[skill].xp);
  const have = id => me.state.items[id] || 0;
  const hasAll = need => Object.entries(need).every(([id, n]) => have(id) >= n);
  const myLevels = () => Object.fromEntries(G.SKILLS.map(s => [s.id, lvl(s.id)]));
  const myStats = () => G.mechStats(me.state.equipment, myLevels());

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
    const action = G.ACTION_BY_ID[a.id];
    const t = a.progress + (now() - me.state.lastTick);
    return { action, frac: Math.min(1, (t % action.time) / action.time) };
  }

  // ---------- Auth ----------
  function showAuth() {
    clearInterval(pollTimer);
    me = null;
    $('app').hidden = true;
    $('auth').hidden = false;
    closeModal();
  }

  function mechSvg(colour, equipment = {}) {
    const svg = $('mech-template').content.firstElementChild.cloneNode(true);
    svg.style.setProperty('--paint', colour);
    G.SLOTS.forEach(s => {
      const g = svg.querySelector('.m-' + s.id);
      const id = G.ITEMS[equipment[s.id]] ? equipment[s.id] : null;
      if (id) g.style.setProperty('--part', G.ITEMS[id].colour);
      g.classList.toggle('empty', !id);
    });
    return svg;
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

    const paints = $('paints');
    G.PAINTS.forEach((c, i) => {
      const input = h('input', { type: 'radio', name: 'colour', value: c, checked: i === 0, 'aria-label': `Paint colour ${i + 1}` });
      const sw = h('span');
      sw.style.background = c;
      paints.append(h('label', { class: 'swatch' }, input, sw));
    });
    const preview = () => $('create-preview').replaceChildren(mechSvg(forms.create.colour.value, {}));
    paints.addEventListener('change', preview);
    preview();

    forms.create.addEventListener('submit', async e => {
      e.preventDefault();
      const f = forms.create;
      $('create-error').textContent = '';
      try {
        await api('/api/register', { name: f.name.value, password: f.password.value, mech: f.mech.value, colour: f.colour.value });
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
    lastRaidAt = me.state.raidLog[0] ? me.state.raidLog[0].at : 0;
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
      const latest = me.state.raidLog[0];
      if (latest && latest.at > lastRaidAt) {
        lastRaidAt = latest.at;
        const raid = G.RAID_BY_ID[latest.raid];
        toast(`${latest.win ? 'Victory' : 'Defeat'}: your party ${latest.win ? 'beat' : 'fell to'} the ${raid.name}.`, latest.win ? '' : 'error',
          latest.runId ? { label: 'Watch', onclick: () => watchReplay(latest.runId) } : null);
      }
      renderChrome();
      if (isLivePage()) renderPage();
      else if (pageRefresh && ++polls % 2 === 0) pageRefresh();
    } catch (e) { /* keep polling; errors surface on actions */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && me) poll(); });

  function showAway(g) {
    const rows = [];
    Object.entries(g.xp).forEach(([s, xp]) => {
      const sk = G.SKILLS.find(x => x.id === s);
      rows.push(h('div', { class: 'gain' }, ui(s, 'md skill-' + s), h('span', { class: 'grow' }, sk.name), h('b', { class: 'plus' }, `+${num(xp)} XP`)));
    });
    Object.entries(g.items).forEach(([id, n]) => {
      rows.push(h('div', { class: 'gain' }, itemIco(id, 'md'), h('span', { class: 'grow' }, G.ITEMS[id].name), h('b', { class: n < 0 ? 'minus' : 'plus' }, `${n > 0 ? '+' : ''}${num(n)}`)));
    });
    const capped = g.ms > G.OFFLINE_CAP;
    openModal(
      h('h2', { id: 'modal-title' }, 'Welcome back'),
      h('p', { class: 'muted' }, `You were away for ${fmtTime(g.ms)}.${capped ? ` Offline progress is capped at ${G.OFFLINE_CAP / 3600000} hours.` : ''}`),
      h('div', { class: 'gains' }, rows),
    );
  }

  // ---------- Modal ----------
  let lastFocus = null;
  function openModal(...content) {
    lastFocus = document.activeElement;
    $('modal-body').replaceChildren(...content);
    $('modal').hidden = false;
    $('modal-close').focus();
  }
  function closeModal() {
    $('modal').hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ---------- Chrome: sidebar and top bar ----------
  const skillNav = group => G.SKILLS.filter(s => s.group === group).map(s => ({ id: 'skill:' + s.id, name: s.name, icon: s.id, skill: s.id }));
  const NAV = [
    { title: 'Combat', items: [{ id: 'raids', name: 'Raids', icon: 'raids' }, { id: 'hangar', name: 'Hangar', icon: 'hangar' }] },
    { title: 'Combat skills', items: skillNav('combat') },
    { title: 'Gathering', items: skillNav('gathering') },
    { title: 'Artisan', items: skillNav('artisan') },
    { title: 'Pilot', items: [
      { id: 'inventory', name: 'Inventory', icon: 'inventory' },
      { id: 'trade', name: 'Trade', icon: 'trade', alert: 'trades' },
      { id: 'guild', name: 'Guild', icon: 'guild' },
      { id: 'social', name: 'Social', icon: 'social', alert: 'friends' },
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
        const spin = h('span', { class: 'spinner', hidden: true, 'aria-label': 'Training' });
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
    $('menu-btn').replaceChildren(ui('menu'));
    $('modal-close').replaceChildren(ui('close'));
  }

  function renderChrome() {
    if (!me) return;
    const activeSkill = me.state.activity && G.ACTION_BY_ID[me.state.activity.id].skill;
    Object.values(navRefs).forEach(({ btn, right, spin, item, fill }) => {
      btn.toggleAttribute('aria-current', false);
      if (item.id === page) btn.setAttribute('aria-current', 'page');
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
      } else if (item.id === 'raids') {
        right.className = me.alerts.party ? 'badge' : 'lvl';
        right.textContent = me.alerts.party ? '!' : '';
      }
    });

    // Current activity card
    const card = $('now-card');
    const a = me.state.activity && G.ACTION_BY_ID[me.state.activity.id];
    if (a) {
      const sk = G.SKILLS.find(s => s.id === a.skill);
      card.className = 'now-card';
      card.replaceChildren(itemIco(a.item),
        h('div', { class: 'now-name' }, h('span', {}, a.name), h('small', {}, `${sk.name} ${lvl(a.skill)}`)),
        h('div', { class: 'bar' }, h('span', { id: 'now-fill' })));
    } else {
      card.className = 'now-card idle';
      card.replaceChildren(h('span', {}, 'Idle. Pick a skill action to start training.'));
    }

    const s = myStats();
    $('wallet').replaceChildren(
      h('div', { class: 'coin', title: 'Scrap' }, itemIco('scrap'), h('span', {}, fmt(have('scrap'))), h('small', {}, 'Scrap')),
      h('div', { class: 'coin', title: 'Power cells' }, itemIco('power_cell'), h('span', {}, fmt(have('power_cell'))), h('small', {}, 'Cells')),
      h('div', { class: 'coin', title: 'Mech power' }, ui('power', 'skill-engineering'), h('span', {}, num(G.power(s))), h('small', {}, 'Power')),
    );
    const dot = h('span', { class: 'pilot-dot' });
    dot.style.background = me.player.colour;
    $('pilot').replaceChildren(dot, h('div', {}, me.player.name, h('small', {}, me.guild ? `[${me.guild.tag}] ${me.player.mech}` : me.player.mech)));
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
  const LIVE = ['skill', 'hangar', 'inventory'];
  const isLivePage = () => LIVE.includes(page.split(':')[0]);

  function go(id) {
    const kind = id.split(':')[0];
    if (!PAGES[kind] || (kind === 'skill' && !G.SKILLS.some(s => 'skill:' + s.id === id))) id = 'skill:scrapping';
    page = id;
    store(PAGE_KEY, id);
    pageRefresh = null;
    renderChrome();
    renderPage();
    window.scrollTo(0, 0);
  }

  function renderPage() {
    const [kind, arg] = page.split(':');
    const el = PAGES[kind](arg);
    if (el) $('page').replaceChildren(...[].concat(el));
  }

  function pageHead(icon, iconCls, title, lead, right) {
    return h('div', { class: 'page-head' },
      h('div', { class: 'page-title' }, ui(icon, iconCls), h('div', {}, h('h1', {}, title), h('p', { class: 'lead' }, lead))),
      right || null);
  }

  function section(title, note, ...body) {
    return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', {}, title), note ? h('p', {}, note) : null), ...body);
  }

  function statsLine(it) {
    if (!it) return null;
    const bits = [];
    const w = it.weapon && G.WEAPON_BY_ID[it.weapon];
    if (w) {
      const role = G.ROLES[w.role];
      const chip = h('span', { class: 'role-chip' }, role.name);
      chip.style.setProperty('--role', role.colour);
      bits.push(chip);
      if (w.role === 'striker') bits.push(h('span', { class: 'dtype-' + w.dtype }, G.DTYPE_BY_ID[w.dtype].name));
    }
    if (it.stats) {
      if (it.stats.atk) bits.push(h('span', { class: 'stat-atk' }, `+${it.stats.atk} ${w && w.role === 'mechanic' ? 'HEAL/S' : 'DMG/S'}`));
      if (it.stats.def) bits.push(h('span', { class: 'stat-def' }, `+${it.stats.def} DEF`));
      if (it.stats.hp) bits.push(h('span', { class: 'stat-hp' }, `+${it.stats.hp} HULL`));
    }
    if (it.pct) bits.push(h('span', { class: 'stat-pct' }, `+${it.pct}% ALL`));
    return bits.length ? h('div', { class: 'stats-line' }, bits) : null;
  }

  // Skill page
  const SKILL_SECTION = {
    scrapping: 'Scrap sites', mining: 'Veins', siphoning: 'Gas clouds', smelting: 'Furnace', chemistry: 'Recipes',
    engineering: 'Blueprints', weaponsmithing: 'Weapons', fabrication: 'Mech parts',
  };

  function levelBox(id) {
    const x = xpInfo(id);
    const fill = h('span');
    fill.style.width = x.pct + '%';
    return h('div', { class: 'level-box' },
      h('div', { class: 'level-row' }, h('span', {}, `Level ${x.level}`), h('span', {}, `${Math.floor(x.pct)}%`)),
      h('div', { class: 'bar' }, fill),
      h('div', { class: 'xp-row' },
        h('span', {}, h('b', {}, num(x.xp)), ' XP'),
        x.max ? h('span', {}, 'Maximum level') : h('span', {}, h('b', {}, num(x.toGo)), ` to level ${x.level + 1}`)));
  }

  function skillPage(id) {
    const sk = G.SKILL_BY_ID[id];
    const head = pageHead(id, 'skill-' + id, sk.name, sk.desc, levelBox(id));
    if (sk.group === 'combat') return [head, ...combatSkillBody(sk)];
    const actions = G.ACTIONS.filter(a => a.skill === id);
    return [head, section(SKILL_SECTION[id] || 'Actions', 'Click a card to start. Only one action runs at a time.', h('div', { class: 'grid' }, actions.map(actionCard)))];
  }

  function combatSkillBody(sk) {
    const L = lvl(sk.id);
    const s = myStats();
    const weapons = G.WEAPON_KINDS.filter(w => w.skill === sk.id);
    const fitted = me.state.equipment.weapon && G.ITEMS[me.state.equipment.weapon];
    const trains = sk.id === 'shielding' || s.skill === sk.id;
    const bonus = {
      shielding: `+${L - 1}% defence and hull`,
      repair: `+${L - 1}% healing`,
      electronics: `+${L - 1}% to target locks, jamming and ion pulses`,
    }[sk.id] || `+${L - 1}% ${sk.name.toLowerCase()} damage`;
    const earned = me.state.raidLog.reduce((a, e) => a + ((e.xp && e.xp[sk.id]) || 0), 0);
    const body = [
      h('div', { class: 'two-col' },
        h('div', { class: 'panel stack' },
          h('h2', {}, 'How it trains'),
          h('p', {}, sk.id === 'shielding'
            ? 'Every raid trains Shielding, whatever you’re carrying: 40% of the raid’s combat XP goes here.'
            : `Fight in raids with ${weapons.map(w => `${/^[aeiou]|^EMP/i.test(w.noun) ? 'an' : 'a'} ${w.noun}`).join(' or ')} fitted. A win gives the raid’s full XP, a loss a quarter. It can’t be trained any other way.`),
          h('p', { class: trains ? 'ok' : 'warn' }, trains
            ? `Your mech is training ${sk.name} right now.`
            : fitted ? `Your ${fitted.name.toLowerCase()} trains ${G.SKILL_BY_ID[s.skill].name} instead.` : 'Fit a weapon in the Hangar to start training.'),
          h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => go('raids') }, 'Go to raids'),
            h('button', { type: 'button', class: 'btn', onclick: () => go('hangar') }, 'Open hangar'))),
        h('div', { class: 'panel stack' },
          h('h2', {}, 'Current bonus'),
          h('p', { class: 'big-number' }, bonus),
          h('p', { class: 'muted' }, `${num(earned)} XP earned in your last ${plural(me.state.raidLog.length, 'raid')}.`))),
    ];
    if (weapons.length) {
      body.push(section('Weapons', `Forged with Weaponsmithing. ${G.ROLES[weapons[0].role].desc}`, h('div', { class: 'slot-list' }, G.TIERS.map(t => {
        const id = `${t.id}_${weapons[0].id}`;
        const it = G.ITEMS[id];
        const recipe = G.ACTION_BY_ID['smith_' + id];
        const on = me.state.equipment.weapon === id;
        return h('div', { class: 'slot' }, itemIco(id),
          h('div', { class: 'slot-info' }, h('small', {}, on ? 'Fitted' : `${num(have(id))} owned · Weaponsmithing ${recipe.level}`), h('b', {}, it.name), statsLine(it)),
          have(id) && !on ? h('button', { type: 'button', class: 'btn small primary', onclick: () => act('/api/equip', { item: id }, `${it.name} fitted.`) }, 'Fit') : null);
      }))));
    }
    if (sk.dtype) {
      body.push(section('Against the bosses', 'Bosses take more damage from some types and shrug off others.', h('div', { class: 'list' }, G.RAIDS.map(r => {
        const m = r.res[sk.dtype] || 1;
        return h('div', { class: 'row' }, h('span', { class: 'ico lg boss-ico', 'aria-hidden': 'true', html: I.boss(r.id) }),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, r.name), h('small', {}, `Tier ${r.tier}`)),
          h('span', { class: m > 1 ? 'ok' : m < 1 ? 'bad' : 'muted' }, m > 1 ? `Weak: +${Math.round((m - 1) * 100)}%` : m < 1 ? `Resists: ${Math.round((m - 1) * 100)}%` : 'Neutral'));
      }))));
    }
    return body;
  }

  function actionCard(a) {
    const locked = lvl(a.skill) < a.level;
    const active = !!me.state.activity && me.state.activity.id === a.id;
    const out = G.ITEMS[a.item];
    const inputs = Object.entries(a.inputs);
    let yieldText = null;
    if (a.skill === 'scrapping') {
      const [lo, hi] = a.outputs.scrap;
      yieldText = `${lo}–${hi} scrap, ${Math.round(a.chance[0].p * 100)}% circuit`;
    }
    return h('button', {
      type: 'button', class: `card action${active ? ' active' : ''}${locked ? ' locked' : ''}`,
      disabled: locked, 'aria-pressed': String(active), onclick: () => toggleAction(a),
    },
      h('div', { class: 'card-top' }, h('span', {}, a.name), h('span', { class: 'card-time' }, secs(a.time))),
      h('div', { class: 'card-art' }, itemIco(a.item, 'xl')),
      locked
        ? h('div', { class: 'card-xp' }, ui('lock', 'sm'), `Level ${a.level}`)
        : h('div', { class: 'card-xp' }, `${a.xp} XP`),
      out.type === 'gear' ? statsLine(out) : out.boost ? h('div', { class: 'stats-line' }, h('span', { class: 'stat-pct' }, out.desc.replace('Raid supply: ', ''))) : null,
      inputs.length ? h('div', { class: 'needs' }, inputs.map(([id, n]) =>
        h('span', { class: `need${have(id) < n ? ' short' : ''}`, title: G.ITEMS[id].name }, itemIco(id, 'sm'), String(n), h('small', {}, `/${fmt(have(id))}`)))) : null,
      h('div', { class: 'card-foot' }, h('span', {}, yieldText || `Owned: ${fmt(have(a.item))}`), active ? h('span', { class: 'ok' }, 'Running') : null),
      h('span', { class: 'card-fill' }));
  }

  async function toggleAction(a) {
    const active = me.state.activity && me.state.activity.id === a.id;
    await act(active ? '/api/action/stop' : '/api/action/start', active ? {} : { id: a.id });
  }

  // Hangar
  function roleLine(s) {
    const role = G.ROLES[s.role];
    const chip = h('span', { class: 'role-chip' }, role.name);
    chip.style.setProperty('--role', role.colour);
    return h('div', { class: 'stats-line left' }, chip,
      s.role === 'striker' ? h('span', { class: 'dtype-' + s.dtype }, `${G.DTYPE_BY_ID[s.dtype].name} damage`) : null,
      h('span', { class: 'muted' }, `Trains ${G.SKILL_BY_ID[s.skill].name}`));
  }

  function hangarPage() {
    const s = myStats();
    const eq = me.state.equipment;
    const gear = Object.keys(me.state.items).filter(id => G.ITEMS[id] && G.ITEMS[id].type === 'gear')
      .sort((x, y) => G.ITEMS[y].tier - G.ITEMS[x].tier);
    const supplies = Object.values(G.ITEMS).filter(it => it.supply);
    return [
      pageHead('hangar', 'skill-shielding', me.player.mech, `Piloted by ${me.player.name}. Your weapon decides your role in a raid and which combat skill you train.`),
      h('div', { class: 'hangar' },
        h('div', { class: 'panel' }, mechSvg(me.player.colour, eq), roleLine(s),
          h('div', { class: 'mech-stats' },
            h('div', { class: 'mech-stat' }, h('b', { class: s.role === 'mechanic' ? 'stat-hp' : 'stat-atk' }, num(s.atk)), h('small', {}, s.role === 'mechanic' ? 'Heal/s' : 'Damage/s')),
            h('div', { class: 'mech-stat' }, h('b', { class: 'stat-def' }, num(s.def)), h('small', {}, 'Defence')),
            h('div', { class: 'mech-stat' }, h('b', { class: 'stat-hp' }, num(s.hp)), h('small', {}, 'Hull')),
            h('div', { class: 'mech-stat' }, h('b', {}, num(G.power(s))), h('small', {}, 'Power')))),
        h('div', {},
          section('Fitted parts', null, h('div', { class: 'slot-list' }, G.SLOTS.map(slot => {
            const it = eq[slot.id] && G.ITEMS[eq[slot.id]];
            return h('div', { class: `slot${it ? '' : ' empty-slot'}` },
              it ? itemIco(it.id) : h('span', { class: 'ico', 'aria-hidden': 'true', html: I.item(slot.id === 'weapon' ? 'autocannon' : slot.id, '#5d6575') }),
              h('div', { class: 'slot-info' }, h('small', {}, slot.name), h('b', {}, it ? it.name : 'Empty'), statsLine(it)),
              it ? h('button', { type: 'button', class: 'btn small', onclick: () => act('/api/unequip', { slot: slot.id }) }, 'Remove') : null);
          }))),
          section('Raid supplies', 'Ticked supplies go into every raid while you have them. Kits are only used when needed; boosts are used up each raid.',
            h('div', { class: 'slot-list' }, supplies.map(it => {
              const on = me.state.supplies[it.id] !== false;
              const box = h('input', { type: 'checkbox', checked: on, 'aria-label': `Bring ${it.name}`, onchange: e => act('/api/supplies', { item: it.id, on: e.target.checked }) });
              return h('label', { class: `slot supply${on ? '' : ' off'}` }, box, itemIco(it.id),
                h('div', { class: 'slot-info' }, h('small', {}, `${num(have(it.id))} owned`), h('b', {}, it.name), h('span', { class: 'muted small' }, it.desc)));
            }))),
          section('Gear in storage', gear.length ? null : 'Forge weapons, fabricate parts, trade for them, or build core modules in Engineering.',
            gear.length ? h('div', { class: 'slot-list' }, gear.map(id => {
              const it = G.ITEMS[id];
              return h('div', { class: 'slot' }, itemIco(id),
                h('div', { class: 'slot-info' }, h('small', {}, `${G.SLOTS.find(x => x.id === it.slot).name} · ${have(id)} owned`), h('b', {}, it.name), statsLine(it)),
                h('button', { type: 'button', class: 'btn small primary', onclick: () => act('/api/equip', { item: id }) }, 'Fit'));
            })) : h('div', { class: 'empty' }, 'No spare gear yet.')))),
    ];
  }

  // Inventory
  let invFilter = 'all';
  let invSelected = null;
  const TYPE_ORDER = { resource: 0, material: 1, consumable: 2, gear: 3 };
  const TYPE_NAME = { resource: 'Resource', material: 'Raid material', consumable: 'Consumable', gear: 'Gear' };

  function inventoryPage() {
    const ids = Object.keys(me.state.items).filter(id => G.ITEMS[id])
      .sort((a, b) => TYPE_ORDER[G.ITEMS[a].type] - TYPE_ORDER[G.ITEMS[b].type] || (G.ITEMS[a].tier || 0) - (G.ITEMS[b].tier || 0));
    const shown = ids.filter(id => invFilter === 'all' || G.ITEMS[id].type === invFilter);
    if (invSelected && !me.state.items[invSelected]) invSelected = null;
    const filters = [['all', 'All'], ['resource', 'Resources'], ['material', 'Raid materials'], ['consumable', 'Consumables'], ['gear', 'Gear']];
    return [
      pageHead('inventory', 'skill-engineering', 'Inventory', `${plural(ids.length, 'kind')} of item in storage. Select one to see what it’s for.`),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter items' }, filters.map(([id, name]) =>
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(invFilter === id), onclick: () => { invFilter = id; renderPage(); } }, name))),
      h('div', { class: 'inv section' },
        shown.length
          ? h('div', { class: 'tiles' }, shown.map(id => h('button', {
            type: 'button', class: 'tile', title: G.ITEMS[id].name, 'aria-label': `${G.ITEMS[id].name}, ${have(id)}`,
            'aria-pressed': String(invSelected === id), onclick: () => { invSelected = id; renderPage(); },
          }, itemIco(id), h('span', { class: 'qty' }, fmt(have(id))))))
          : h('div', { class: 'empty' }, 'Nothing here yet. Start Scrapping to find your first materials.'),
        itemDetail(invSelected)),
    ];
  }

  function itemDetail(id) {
    if (!id) return h('div', { class: 'panel detail muted' }, 'Select an item to see its details.');
    const it = G.ITEMS[id];
    const madeBy = G.ACTIONS.filter(a => a.outputs[id] || a.chance.some(c => c.item === id));
    const usedIn = G.ACTIONS.filter(a => a.inputs[id]);
    const raids = G.RAIDS.filter(r => r.drops.some(d => d.item === id));
    const source = [...madeBy.map(a => `${a.name} (${G.SKILL_BY_ID[a.skill].name} ${a.level})`), ...raids.map(r => `${r.name} raid`)];
    return h('div', { class: 'panel detail' },
      h('div', { class: 'detail-head' }, itemIco(id), h('div', {}, h('h3', {}, it.name), h('small', {}, `${TYPE_NAME[it.type]}${it.tier ? ` · tier ${it.tier}` : ''} · ${num(have(id))} owned`))),
      h('p', {}, it.desc),
      statsLine(it),
      source.length ? h('div', {}, h('b', {}, 'Comes from'), h('ul', {}, source.map(s => h('li', {}, s)))) : null,
      usedIn.length ? h('div', {}, h('b', {}, 'Used in'), h('ul', {}, usedIn.slice(0, 8).map(a => h('li', {}, `${a.name} (${a.inputs[id]})`)), usedIn.length > 8 ? h('li', {}, `and ${usedIn.length - 8} more`) : null)) : null,
      it.type === 'gear' ? h('button', { type: 'button', class: 'btn primary', onclick: () => act('/api/equip', { item: id }, `${it.name} fitted.`) }, 'Fit to mech') : null,
      h('button', { type: 'button', class: 'btn', onclick: () => { tradePrefill = { give: id }; go('trade'); } }, 'Offer in a trade'));
  }

  // Raids
  const xpText = xp => Object.entries(xp || {}).map(([k, v]) => `+${num(v)} ${G.SKILL_BY_ID[k] ? G.SKILL_BY_ID[k].name : k}`).join(', ');

  function resChips(r) {
    return h('div', { class: 'res-chips' }, Object.entries(r.res).sort((a, b) => b[1] - a[1]).map(([d, m]) =>
      h('span', { class: `res-chip ${m > 1 ? 'weak' : 'resist'}` }, `${m > 1 ? 'Weak' : 'Resists'}: ${G.DTYPE_BY_ID[d].name} ${m > 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`)));
  }

  function raidsPage() {
    const partyBox = h('div');
    const openBox = h('div');
    const cards = h('div', { class: 'raid-grid' });
    const history = h('div');
    const s = myStats();
    const pw = G.power(s);
    let data = { party: null, open: [] };

    function drawCards() {
      cards.replaceChildren(...G.RAIDS.map(r => {
        const tier = G.TIERS[r.tier - 1];
        const ratio = pw / r.recommended;
        const cls = ratio >= 1 ? 'ok' : ratio >= 0.8 ? 'warn' : 'bad';
        const mult = s.dtype ? r.res[s.dtype] || 1 : 1;
        const card = h('article', { class: 'raid' },
          h('div', { class: 'raid-top' },
            h('span', { class: 'boss-portrait', 'aria-hidden': 'true', html: I.boss(r.id) }),
            h('div', { class: 'raid-title' }, h('span', { class: 'tier' }, `Tier ${r.tier} · ${tier.name}`), h('h3', {}, r.name),
              h('small', { class: 'muted' }, `${r.moves.basic} · ${r.moves.sweep} every ${G.BOSS_MOVES.sweepEvery}th attack`))),
          h('p', {}, r.desc),
          resChips(r),
          h('div', { class: 'kv' },
            h('div', {}, h('b', { class: 'stat-hp' }, num(r.boss.hp)), h('small', {}, 'Hull')),
            h('div', {}, h('b', { class: 'stat-atk' }, num(r.boss.dps)), h('small', {}, 'Damage/s')),
            h('div', {}, h('b', { class: 'stat-def' }, num(r.boss.def)), h('small', {}, 'Defence'))),
          h('div', { class: 'power-check' }, h('span', {}, `Recommended power ${num(r.recommended)}`), h('span', { class: cls }, `Yours ${num(pw)}`)),
          s.role === 'striker' && mult !== 1 ? h('div', { class: 'power-check' }, h('span', { class: 'muted' }, `Your ${G.DTYPE_BY_ID[s.dtype].name.toLowerCase()} weapon`), h('span', { class: mult > 1 ? 'ok' : 'bad' }, `${mult > 1 ? '+' : ''}${Math.round((mult - 1) * 100)}% damage`)) : null,
          h('div', { class: 'power-check' }, h('span', { class: 'muted' }, `Costs ${plural(r.cells, 'power cell')} each`), h('span', { class: have('power_cell') >= r.cells ? 'ok' : 'bad' }, `You have ${num(have('power_cell'))}`)),
          h('div', {}, h('small', { class: 'muted' }, 'Drops'), h('div', { class: 'drops' }, r.drops.map(d =>
            h('span', { class: 'need', title: G.ITEMS[d.item].name }, itemIco(d.item, 'sm'), `${d.qty[0]}–${d.qty[1]}${d.p ? ` (${Math.round(d.p * 100)}%)` : ''}`)))),
          h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'btn primary', disabled: have('power_cell') < r.cells, onclick: () => solo(r) }, 'Raid solo'),
            h('button', { type: 'button', class: 'btn', disabled: !!data.party, onclick: () => partyAct('/api/party/create', { raid: r.id }, 'Party formed. Friends and guildmates can now join.') }, 'Form a party')));
        card.style.setProperty('--tier', tier.colour);
        return card;
      }));
    }

    function drawParty() {
      const p = data.party;
      if (!p) { partyBox.replaceChildren(); }
      else {
        const raid = G.RAID_BY_ID[p.raid];
        const leader = p.leader === me.player.id;
        partyBox.replaceChildren(section('Your party', `Breaks up ${fmtTime(p.expires - now())} from now if not launched.`,
          h('div', { class: 'panel party' },
            h('div', { class: 'raid-top' }, h('span', { class: 'boss-portrait small', 'aria-hidden': 'true', html: I.boss(raid.id) }),
              h('div', { class: 'raid-title' }, h('span', { class: 'tier' }, `Tier ${raid.tier}`), h('h3', {}, raid.name)),
              h('span', { class: 'muted' }, `${p.members.length} / ${G.PARTY_MAX} pilots`)),
            h('div', { class: 'member-list' }, p.members.map(m => memberRow(m, m.id === p.leader ? 'Leader' : null))),
            h('p', { class: 'muted' }, `Each pilot needs ${plural(raid.cells, 'power cell')}. The boss gets tougher with every pilot, but its hits get shared out. Mix in a Mechanic or Tactician.`),
            h('div', { class: 'actions' },
              leader ? h('button', { type: 'button', class: 'btn primary', onclick: startParty }, 'Launch raid') : h('span', { class: 'muted' }, 'Waiting for the leader to launch.'),
              h('button', { type: 'button', class: 'btn danger', onclick: () => partyAct('/api/party/leave', {}, leader ? 'Party disbanded.' : 'You left the party.') }, leader ? 'Disband' : 'Leave')))));
      }
      openBox.replaceChildren(section('Open parties', 'Parties led by your friends and guildmates.',
        data.open.length ? h('div', { class: 'list' }, data.open.map(o => {
          const raid = G.RAID_BY_ID[o.raid];
          const lead = o.members.find(m => m.id === o.leader) || o.members[0];
          return h('div', { class: 'row' },
            h('span', { class: 'ico lg boss-ico', 'aria-hidden': 'true', html: I.boss(raid.id) }),
            h('div', { class: 'grow' }, h('div', { class: 'name' }, `${lead ? lead.name : 'Someone'}’s party`), h('small', {}, `${raid.name} · ${o.members.length}/${G.PARTY_MAX} pilots`)),
            h('button', { type: 'button', class: 'btn small primary', disabled: !!data.party, onclick: () => partyAct('/api/party/join', { id: o.id }, 'Joined the party.') }, 'Join'));
        })) : h('div', { class: 'empty' }, 'No open parties right now. Form one below, or add friends and join a guild to see theirs.')));
    }

    function drawHistory() {
      const log = me.state.raidLog;
      history.replaceChildren(section('Recent raids', null, log.length ? h('div', { class: 'history' }, log.slice(0, 10).map(e => {
        const raid = G.RAID_BY_ID[e.raid];
        return h('div', { class: 'history-row' },
          h('span', { class: 'ico lg boss-ico', 'aria-hidden': 'true', html: I.boss(raid.id) }),
          h('span', { class: `result ${e.win ? 'ok' : 'bad'}` }, e.win ? 'Victory' : 'Defeat'),
          h('div', { class: 'what' }, h('div', {}, raid.name), h('small', {}, `${e.party.length > 1 ? e.party.join(', ') : 'Solo'} · ${e.ms ? fmtTime(e.ms) : `${e.rounds} rounds`} · ${ago(e.at)}`)),
          h('span', { class: 'loot' }, h('span', { class: 'skill-kinetic' }, xpText(e.xp)), Object.entries(e.loot).map(([id, n]) => h('span', { title: G.ITEMS[id].name }, itemIco(id, 'sm'), num(n)))),
          e.runId ? h('button', { type: 'button', class: 'btn small', onclick: () => watchReplay(e.runId) }, ui('replay', 'sm'), 'Replay') : null);
      })) : h('div', { class: 'empty' }, 'No raids yet. Forge an iron weapon, fabricate iron parts, build some power cells, then take on the Scrapyard Warden.')));
    }

    async function load() {
      try {
        data = await api('/api/raids');
        drawParty();
        drawCards();
        drawHistory();
      } catch (e) { /* shown on next action */ }
    }
    async function partyAct(path, body, msg) {
      if (await act(path, body, msg)) load();
    }
    async function solo(r) {
      const res = await act('/api/raid/solo', { raid: r.id });
      if (res) { openRaidView(res.result); load(); }
    }
    async function startParty() {
      const res = await act('/api/party/start', {});
      if (res) { openRaidView(res.result); load(); }
    }

    pageRefresh = load;
    drawCards();
    drawParty();
    drawHistory();
    load();
    return [
      pageHead('raids', 'skill-thermal', 'Raids', 'Take your mech into boss fights, alone or with friends and guildmates. Each boss drops the material you need to build the next tier.'),
      partyBox, openBox, section('Bosses', 'Win or lose, each pilot burns their power cells and earns combat XP for their weapon, plus Shielding.', cards), history,
    ];
  }

  function memberRow(m, note) {
    return h('div', { class: 'member' },
      h('span', { class: `dot ${m.online ? 'online' : 'offline'}`, title: m.online ? 'Online' : 'Offline' }),
      h('span', { class: 'name' }, m.name, m.guild ? h('span', { class: 'tag' }, ` [${m.guild}]`) : null),
      note ? h('small', {}, note) : null,
      h('small', {}, `Power ${num(m.power)}`));
  }

  // ---------- Live raid view ----------
  // Replays a fight's timeline in real time. Each cast bar fills from its cast event to the
  // moment its hit lands, so bars and damage numbers stay in step.
  const SERIES = ['#5b9bff', '#f2c14e', '#3ddc84', '#ef5a45'];
  let raidView = null;

  async function watchReplay(runId) {
    try {
      const r = await api('/api/raid/replay?id=' + runId);
      openRaidView(r.result);
    } catch (e) { toast(e.message, 'error'); }
  }

  function openRaidView(result) {
    if (raidView) raidView.close();
    const raid = G.RAID_BY_ID[result.raid];
    const events = result.events;
    const endT = events[events.length - 1].t;
    const entry = me.state.raidLog.find(e => e.runId === result.runId) || (result.perPlayer && result.perPlayer[me.player.id]);
    if (entry) lastRaidAt = Math.max(lastRaidAt, entry.at);
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Units: pilots on the left, the boss on the right.
    function makeUnit(name, sub, art, max, boss) {
      const floats = h('div', { class: 'floats', 'aria-hidden': 'true' });
      const artBox = h('div', { class: 'unit-art' }, art, floats);
      const hpFill = h('span'), hpText = h('b');
      const castFill = h('span'), castText = h('b', {}, 'Getting ready');
      const castBar = h('div', { class: 'castbar idle' }, castFill, castText);
      const statuses = h('div', { class: 'statuses' });
      const el = h('div', { class: `unit${boss ? ' boss' : ''}` }, artBox,
        h('div', { class: 'unit-info' }, h('div', { class: 'unit-name' }, h('span', {}, name), sub), h('div', { class: 'hpbar' }, hpFill, hpText), castBar, statuses));
      const u = { name, el, artBox, floats, hpFill, hpText, castFill, castText, castBar, statuses, hp: max, max, cast: null, down: false, buffs: {} };
      drawHp(u);
      return u;
    }
    function drawHp(u) {
      const f = Math.max(0, u.hp) / u.max;
      u.hpFill.style.width = f * 100 + '%';
      u.hpFill.parentNode.classList.toggle('low', f < 0.3);
      u.hpText.textContent = `${num(Math.max(0, u.hp))} / ${num(u.max)}`;
    }

    const fighters = result.fighters.map((f, i) => {
      const role = G.ROLES[f.role] || G.ROLES.striker;
      const chip = h('span', { class: 'role-chip' }, role.name);
      chip.style.setProperty('--role', role.colour);
      const sub = h('small', {}, chip, f.role === 'striker' && f.dtype ? h('span', { class: 'dtype-' + f.dtype }, ` ${G.DTYPE_BY_ID[f.dtype].name}`) : null);
      const art = mechSvg(f.colour || '#8d95a5', f.gear || {});
      art.setAttribute('aria-label', `${f.name}’s mech`);
      const u = makeUnit(f.name, sub, art, f.max, false);
      u.el.style.setProperty('--series', SERIES[i]);
      return u;
    });
    const boss = makeUnit(raid.name, h('small', { class: 'tier' }, `Tier ${raid.tier}`), h('span', { class: 'boss-art', html: I.boss(raid.id) }), result.bossMax, true);
    const unit = k => (k === 'b' ? boss : fighters[k]);

    // Damage meter and graph.
    const dealt = fighters.map(() => 0), healed = fighters.map(() => 0);
    const buckets = fighters.map(() => []);
    const meterRows = result.fighters.map((f, i) => {
      const fill = h('span'), val = h('span', { class: 'meter-val' });
      fill.style.background = SERIES[i];
      const row = h('div', { class: 'meter-row' }, h('div', { class: 'meter-name' }, h('span', { class: 'swatch-dot' }), f.name, val), h('div', { class: 'meter-bar' }, fill));
      row.querySelector('.swatch-dot').style.background = SERIES[i];
      return { row, fill, val, i };
    });
    const meter = h('div', { class: 'meter' }, meterRows.map(r => r.row));
    const graph = h('div', { class: 'graph', role: 'img', 'aria-label': 'Damage per second over time for each pilot' });
    const legend = h('div', { class: 'legend' }, result.fighters.map((f, i) => {
      const d = h('span', { class: 'swatch-dot' });
      d.style.background = SERIES[i];
      return h('span', {}, d, f.name);
    }));

    const clockEl = h('span', { class: 'rv-clock' }, '0:00');
    const speedBtn = h('button', { type: 'button', class: 'btn small', onclick: () => { speed = speed >= 4 ? 1 : speed * 2; speedBtn.textContent = `${speed}× speed`; } }, '1× speed');
    const skipBtn = h('button', { type: 'button', class: 'btn small', onclick: skip }, ui('skip', 'sm'), 'Skip to end');
    const resultBox = h('div', { class: 'rv-result', hidden: true, 'aria-live': 'polite' });

    const view = h('div', { class: 'rv', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rv-title' },
      h('div', { class: 'rv-inner' },
        h('header', { class: 'rv-head' },
          h('div', {}, h('span', { class: 'tier' }, `Raid · tier ${raid.tier}`), h('h2', { id: 'rv-title' }, raid.name)),
          clockEl,
          h('div', { class: 'actions' }, speedBtn, skipBtn, h('button', { type: 'button', class: 'btn small', onclick: () => close() }, ui('close', 'sm'), 'Close'))),
        resultBox,
        h('div', { class: 'rv-arena' },
          h('div', { class: `rv-party n${fighters.length}` }, fighters.map(u => u.el)),
          h('div', { class: 'rv-vs', 'aria-hidden': 'true' }, 'VS'),
          h('div', { class: 'rv-enemy' }, boss.el)),
        h('div', { class: 'rv-meters' },
          h('section', { class: 'panel' }, h('h3', {}, 'Damage meter'), meter),
          h('section', { class: 'panel' }, h('h3', {}, 'Damage per second'), graph, legend))));
    document.body.append(view);
    document.body.classList.add('no-scroll');
    const lastFocus = document.activeElement;
    skipBtn.focus();

    let clock = 0, speed = 1, idx = 0, lastFrame = performance.now(), raf = 0, lastMeter = 0, lastSec = -1, finished = false, quiet = false;

    function float(u, text, cls) {
      if (quiet) return;
      const s = h('span', { class: `float ${cls}` }, text);
      s.style.left = `${25 + Math.random() * 50}%`;
      u.floats.append(s);
      setTimeout(() => s.remove(), 1100);
    }
    function pulse(u, cls) {
      if (quiet || reduced) return;
      u.artBox.classList.remove('shake', 'glow');
      void u.artBox.offsetWidth; // restart the animation
      u.artBox.classList.add(cls);
    }
    function castLabel(e) {
      if (e.a === 'b') return e.tg === 'all' ? `${e.n} → everyone` : `${e.n} → ${fighters[e.tg].name}`;
      return typeof e.tg === 'number' ? `${e.n} → ${fighters[e.tg].name}` : e.n;
    }
    function drawStatuses(u) {
      const chips = Object.entries(u.buffs).filter(([, b]) => b.until > clock)
        .map(([n, b]) => h('span', { class: `status ${b.cls}` }, b.pct ? `${n} ${b.pct}` : n));
      u.statuses.replaceChildren(...chips);
    }

    function apply(e) {
      if (e.e === 'cast') {
        const u = unit(e.a);
        u.cast = { start: e.t, d: e.d };
        u.castText.textContent = castLabel(e);
        u.castBar.classList.remove('idle');
        u.castBar.classList.toggle('danger', e.a === 'b' && e.tg === 'all');
      } else if (e.e === 'hit') {
        const target = unit(e.tg);
        if (e.k === 'heal' || e.k === 'kit') {
          const eff = Math.min(e.v, target.max - target.hp);
          target.hp += eff;
          if (e.k === 'heal') healed[e.a] += eff;
          float(target, e.k === 'kit' ? `+${num(e.v)} kit` : `+${num(e.v)}`, 'heal');
          pulse(target, 'glow');
        } else {
          target.hp = Math.max(0, target.hp - e.v);
          float(target, e.c ? `${num(e.v)}!` : num(e.v), `${e.a === 'b' ? 'taken' : 'dmg'}${e.c ? ' crit' : ''}${e.k === 'burn' ? ' burn' : ''}`);
          pulse(target, 'shake');
          if (e.a !== 'b') {
            dealt[e.a] += e.v;
            const sec = Math.floor(e.t / 1000);
            buckets[e.a][sec] = (buckets[e.a][sec] || 0) + e.v;
          }
          if (e.k === 'burn') target.buffs.Burning = { until: e.t + 1100, cls: 'burn' };
        }
        drawHp(target);
        if (e.k !== 'burn' && e.k !== 'kit') {
          const src = unit(e.a);
          src.castFill.style.width = '100%';
        }
      } else if (e.e === 'buff') {
        boss.buffs[e.n] = { until: e.until, pct: e.n === 'Jammed' ? `−${e.pct}%` : `+${e.pct}%`, cls: e.n === 'Jammed' ? 'jam' : 'lock' };
        float(boss, e.n === 'Jammed' ? 'JAMMED' : 'LOCKED', 'tag');
        const src = unit(e.a);
        src.castFill.style.width = '100%';
      } else if (e.e === 'down') {
        const u = unit(e.tg);
        u.down = true;
        u.cast = null;
        u.el.classList.add('down');
        u.castBar.classList.add('idle');
        u.castFill.style.width = '0';
        u.castText.textContent = 'Downed';
      }
    }

    function drawMeter() {
      const secs = Math.max(1, clock / 1000);
      const dps = dealt.map(d => d / secs);
      const top = Math.max(1, ...dps);
      meterRows.slice().sort((a, b) => dps[b.i] - dps[a.i]).forEach(r => {
        meter.append(r.row);
        r.fill.style.width = `${(dps[r.i] / top) * 100}%`;
        r.val.textContent = `${dps[r.i].toFixed(1)} DPS · ${num(dealt[r.i])}${healed[r.i] ? ` · ${(healed[r.i] / secs).toFixed(1)} HPS` : ''}`;
      });
    }

    function drawGraph() {
      const sec = Math.floor(clock / 1000);
      const span = Math.max(20, sec + 4);
      const series = buckets.map(b => {
        const pts = [];
        for (let s = 0; s <= sec; s++) {
          let sum = 0;
          for (let k = Math.max(0, s - 4); k <= s; k++) sum += b[k] || 0;
          pts.push(sum / Math.min(5, s + 1));
        }
        return pts;
      });
      const top = Math.max(10, ...series.flat()) * 1.1;
      const W = 400, H = 150;
      const x = s => (s / span) * W, y = v => H - (v / top) * H;
      const grid = [0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" class="gl"/><text x="4" y="${H * f - 3}" class="gt">${Math.round(top * (1 - f))}</text>`).join('');
      const lines = series.map((pts, i) => `<polyline fill="none" stroke="${SERIES[i]}" stroke-width="2" stroke-linejoin="round" points="${pts.map((v, s) => `${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`).join('');
      graph.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${lines}</svg>`;
    }

    function tick(t) {
      const dt = Math.min(100, t - lastFrame);
      lastFrame = t;
      clock = Math.min(endT, clock + dt * speed);
      while (idx < events.length && events[idx].t <= clock) apply(events[idx++]);
      for (const u of [...fighters, boss]) {
        if (u.cast && !u.down) u.castFill.style.width = `${Math.min(1, (clock - u.cast.start) / u.cast.d) * 100}%`;
      }
      clockEl.textContent = fmtClock(clock);
      if (t - lastMeter > 200) {
        lastMeter = t;
        drawMeter();
        [...fighters, boss].forEach(drawStatuses);
      }
      const sec = Math.floor(clock / 1000);
      if (sec !== lastSec) { lastSec = sec; drawGraph(); }
      if (idx >= events.length) finish();
      else raf = requestAnimationFrame(tick);
    }

    function skip() {
      quiet = true;
      clock = endT;
      while (idx < events.length) apply(events[idx++]);
      quiet = false;
      finish();
    }

    function finish() {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      clock = endT;
      clockEl.textContent = fmtClock(clock);
      drawMeter();
      drawGraph();
      [...fighters, boss].forEach(u => { if (!u.down) { u.castBar.classList.add('idle'); u.castText.textContent = u === boss && result.win ? 'Destroyed' : 'Standing'; } drawStatuses(u); });
      if (result.win) boss.el.classList.add('down');
      skipBtn.hidden = true;
      speedBtn.hidden = true;
      const loot = entry ? Object.entries(entry.loot || {}) : [];
      resultBox.replaceChildren(
        h('div', { class: `rv-banner ${result.win ? 'ok' : 'bad'}` }, result.win ? 'Victory' : result.timeout ? 'Out of time' : 'Defeat'),
        h('div', { class: 'rv-rewards' },
          h('span', { class: 'muted' }, fmtTime(endT)),
          entry ? h('span', { class: 'skill-kinetic' }, xpText(entry.xp)) : null,
          loot.map(([id, n]) => h('span', { class: 'pill', title: G.ITEMS[id].name }, itemIco(id, 'sm'), `+${num(n)} ${G.ITEMS[id].name}`)),
          !result.win ? h('span', { class: 'muted' }, 'No loot this time. Try a weapon the boss is weak to, bring repair kits and boosts, or bring a party.') : null));
      resultBox.hidden = false;
    }

    function close() {
      cancelAnimationFrame(raf);
      view.remove();
      document.body.classList.remove('no-scroll');
      document.removeEventListener('keydown', onKey);
      raidView = null;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      if (page === 'raids') renderPage();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    drawGraph();
    drawMeter();
    raidView = { close };
    raf = requestAnimationFrame(t => { lastFrame = t; tick(t); });
  }

  const fmtClock = ms => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

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
        data.history.length ? section('Recent trades', null, h('div', { class: 'list' }, data.history.map(t => tradeCard(t, 'done')))) : null);
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
      pageHead('trade', 'skill-fabrication', 'Trade', 'Swap materials and parts with other pilots. Items you offer are held safely until the other pilot accepts, declines, or you cancel.'),
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
      const enough = have('scrap') >= G.GUILD_COST;
      body.replaceChildren(h('div', { class: 'two-col' },
        section('Found a guild', `Costs ${num(G.GUILD_COST)} scrap. You have ${num(have('scrap'))}.`,
          h('form', { class: 'panel', onsubmit: async e => {
            e.preventDefault();
            if (await act('/api/guild/create', { name: name.value, tag: tag.value }, 'Guild founded.')) { await poll(); load(); }
          } },
            h('div', { class: 'form-row' }, h('label', { class: 'field' }, 'Guild name', name), h('label', { class: 'field' }, 'Tag (2–4)', tag)),
            h('p', { class: 'actions section' }, h('button', { type: 'submit', class: 'btn primary', disabled: !enough }, enough ? 'Found guild' : 'Not enough scrap')))),
        section('Guilds', 'Open to join. Up to 30 pilots each.',
          data.guilds.length ? h('div', { class: 'list' }, data.guilds.map(g => h('div', { class: 'row' },
            h('div', { class: 'grow' }, h('div', { class: 'name' }, g.name, h('span', { class: 'tag' }, ` [${g.tag}]`)), h('small', {}, `${plural(g.members, 'pilot')} · total level ${num(g.level)}`)),
            h('button', { type: 'button', class: 'btn small primary', disabled: g.members >= 30, onclick: async () => { if (await act('/api/guild/join', { id: g.id }, `Welcome to ${g.name}.`)) { await poll(); load(); } } }, g.members >= 30 ? 'Full' : 'Join'))))
            : h('div', { class: 'empty' }, 'No guilds yet. Be the first to found one.'))));
    }

    function drawGuild(data) {
      const g = data.guild;
      const leader = g.leader === me.player.id;
      const chatLog = body.querySelector('.chat-log');
      const newest = data.chat.length ? data.chat[data.chat.length - 1].id : 0;
      // Keep the chat box (and whatever is being typed) if only messages changed.
      if (chatLog && body.dataset.guild === String(g.id)) {
        if (newest !== lastChatId) { fillChat(chatLog, data.chat); lastChatId = newest; }
        body.querySelector('.members').replaceChildren(...membersList(data, leader));
        return;
      }
      body.dataset.guild = String(g.id);
      const log = h('div', { class: 'chat-log', 'aria-live': 'polite', 'aria-label': 'Guild chat' });
      fillChat(log, data.chat);
      lastChatId = newest;
      const input = h('input', { maxlength: '200', 'aria-label': 'Message', placeholder: 'Say something to your guild', autocomplete: 'off' });
      body.replaceChildren(
        h('div', { class: 'panel row' },
          h('div', { class: 'grow' }, h('h2', {}, g.name, h('span', { class: 'tag' }, ` [${g.tag}]`)), h('small', {}, `${data.members.length} / ${g.max} pilots · total level ${num(data.members.reduce((a, m) => a + m.level, 0))}`)),
          h('button', { type: 'button', class: 'btn danger', onclick: async () => {
            if (!confirm(leader && data.members.length > 1 ? 'Leave the guild? Leadership passes to the longest-serving member.' : 'Leave the guild?')) return;
            if (await act('/api/guild/leave', {}, 'You left the guild.')) { delete body.dataset.guild; await poll(); load(); }
          } }, 'Leave guild')),
        h('div', { class: 'two-col' },
          section('Members', 'Guildmates can join each other’s raid parties.', h('div', { class: 'member-list members' }, membersList(data, leader))),
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

    function membersList(data, leader) {
      return data.members.map(m => {
        const row = memberRow(m, m.id === data.guild.leader ? 'Leader' : `Level ${m.level}`);
        if (leader && m.id !== me.player.id) {
          row.append(h('button', { type: 'button', class: 'btn small danger', onclick: async () => {
            if (confirm(`Remove ${m.name} from the guild?`) && await act('/api/guild/kick', { id: m.id }, `${m.name} was removed.`)) load();
          } }, 'Remove'));
        }
        return row;
      });
    }

    pageRefresh = load;
    load();
    return [
      pageHead('guild', 'skill-engineering', me.guild ? me.guild.name : 'Guild', 'Band together with other pilots. Guildmates can see and join each other’s raid parties.'),
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
        }))) : null,
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

  const PAGES = { skill: skillPage, hangar: hangarPage, inventory: inventoryPage, raids: raidsPage, trade: tradePage, guild: guildPage, social: socialPage };

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
