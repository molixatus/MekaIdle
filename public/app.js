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
  // game-icons.net shapes, filled with a colour (or the text colour). Markup is built from our
  // own icon data and colours only.
  const GI = window.GAME_ICONS;
  const giSvg = (name, colour) => `<svg viewBox="0 0 512 512" focusable="false"><path fill="${colour || 'currentColor'}" d="${GI[name]}"/></svg>`;
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
  let page = store(PAGE_KEY) || 'skill:mining';
  let pollTimer = null;
  let polls = 0;
  let pageRefresh = null; // refresh hook for pages that load their own data
  let pageTick = null;    // called after every poll while its page is open
  let pageCleanup = null; // called when leaving the page

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

  const raiding = () => !!(me && me.state.activity && me.state.activity.type);

  function activityProgress() {
    const a = me && me.state.activity;
    if (!a) return null;
    if (a.type) return a.ms ? { frac: Math.max(0, Math.min(1, (now() - a.start) / a.ms)) } : null;
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

  // Pixel-art mech for a paint colour and set of fitted gear. Sprite markup is generated
  // locally from game data (colours and ids only), never from player text.
  function mechArt(colour, equipment = {}, label = 'Mech') {
    const piece = slot => {
      const it = G.ITEMS[equipment[slot]];
      return it && it.armour ? { type: it.armour, colour: it.colour } : null;
    };
    const weapon = G.ITEMS[equipment.weapon];
    const kind = weapon && G.WEAPON_BY_ID[weapon.weapon];
    const trinket = G.ITEMS[equipment.trinket];
    const el = h('span', { class: 'sprite mech-sprite', role: 'img', 'aria-label': label, html: window.SPRITES.mech({
      paint: colour, accent: G.ACCENTS[colour], head: piece('head'), body: piece('body'), legs: piece('legs'),
      weapon: kind ? kind.id : null, role: kind ? kind.role : null, weaponColour: weapon ? weapon.colour : null, core: trinket ? trinket.colour : null,
    }) });
    el.firstElementChild.removeAttribute('role');
    el.firstElementChild.setAttribute('aria-hidden', 'true');
    return el;
  }
  // Boss portraits: the boss's icon in its material colour.
  const bossArt = (id, cls = '') => {
    const r = G.RAID_BY_ID[id];
    return gi(`boss_${id}`, r ? r.mat.colour : null, `boss-sprite ${cls}`);
  };

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
    const preview = () => $('create-preview').replaceChildren(mechArt(forms.create.colour.value, {}, 'Your mech'));
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
      g.fights ? h('p', {}, `Your mech fought ${plural(g.fights, 'raid fight')} and won ${num(g.wins)}.`) : null,
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
    const act0 = me.state.activity;
    const activeSkill = !act0 ? null : act0.type ? myStats().skill : G.ACTION_BY_ID[act0.id].skill;
    Object.values(navRefs).forEach(({ btn, right, spin, item, fill }) => {
      if (item.id === 'raids') spin.hidden = !raiding();
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
    const a = act0 && !act0.type && G.ACTION_BY_ID[act0.id];
    if (act0 && act0.type) {
      const raid = G.RAID_BY_ID[act0.raid];
      card.className = 'now-card';
      card.replaceChildren(bossArt(act0.raid, 'now-boss'),
        h('div', { class: 'now-name' }, h('span', {}, raid ? raid.name : 'Raid'), h('small', {}, `${act0.type === 'party' ? 'Party' : 'Solo'} · fight ${act0.n || 1}`)),
        h('div', { class: 'bar red' }, h('span', { id: 'now-fill' })));
    } else if (a) {
      const sk = G.SKILLS.find(s => s.id === a.skill);
      card.className = 'now-card';
      card.replaceChildren(itemIco(a.item),
        h('div', { class: 'now-name' }, h('span', {}, a.name), h('small', {}, `${sk.name} ${lvl(a.skill)}`)),
        h('div', { class: 'bar' }, h('span', { id: 'now-fill' })));
    } else {
      card.className = 'now-card idle';
      card.replaceChildren(h('span', {}, 'Idle. Pick a skill action or a raid to start.'));
    }

    const s = myStats();
    $('wallet').replaceChildren(
      h('div', { class: 'coin', title: 'Gold' }, itemIco('gold'), h('span', {}, fmt(have('gold'))), h('small', {}, 'Gold')),
      h('div', { class: 'coin', title: 'Combat level: your four combat skills added together' }, gi('sk_melee', '#ef5a45'), h('span', {}, num(G.combatLevel(myLevels()))), h('small', {}, 'Combat')),
      h('div', { class: 'coin', title: 'Mech power' }, gi('power', '#f2c14e'), h('span', {}, num(G.power(s))), h('small', {}, 'Power')),
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
    if (!PAGES[kind] || (kind === 'skill' && !G.SKILLS.some(s => 'skill:' + s.id === id))) id = 'skill:mining';
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

  function roleChip(role, stance) {
    const r = G.ROLES[role] || G.ROLES.melee;
    const chip = h('span', { class: 'role-chip' }, stance === 'tank' ? `${r.name} · Tank` : r.name);
    chip.style.setProperty('--role', r.colour);
    return chip;
  }

  // "+10% hull, +5% crit" from a stats object.
  const STAT_TEXT = {
    atk: v => `+${v} damage/s`, def: v => `+${v} defence`, hp: v => `+${v} hull`, crit: v => `+${v}% crit`,
    power: v => `+${v}% power`, heal: v => `+${v}% healing`, defPct: v => `+${v}% defence`, hpPct: v => `+${v}% hull`,
  };
  const statText = stats => Object.entries(stats || {}).filter(([k, v]) => STAT_TEXT[k] && typeof v === 'number').map(([k, v]) => STAT_TEXT[k](v)).join(', ');
  const passiveText = pas => Object.entries(pas || {}).map(([k, v]) => G.PASSIVES[k](v));

  function statsLine(it) {
    if (!it) return null;
    const bits = [];
    const w = it.weapon && G.WEAPON_BY_ID[it.weapon];
    if (w) bits.push(roleChip(w.role, w.stance));
    if (it.armour) bits.push(h('span', { class: 'type-chip' }, G.ARMOUR_TYPES[it.armour].name));
    if (it.set) bits.push(h('span', { class: 'set-chip' }, `${G.RAID_SETS[it.set].name} set`));
    const st = it.stats || {};
    if (st.atk) bits.push(h('span', { class: 'stat-atk' }, `+${st.atk} ${w && w.role === 'healer' ? 'heal/s' : 'dmg/s'}`));
    if (st.def) bits.push(h('span', { class: 'stat-def' }, `+${st.def} def`));
    if (st.hp) bits.push(h('span', { class: 'stat-hp' }, `+${st.hp} hull`));
    ['crit', 'power', 'heal', 'defPct', 'hpPct'].forEach(k => { if (st[k]) bits.push(h('span', { class: 'stat-pct' }, STAT_TEXT[k](st[k]))); });
    if (it.passives) bits.push(h('span', { class: 'stat-passive' }, Object.keys(it.passives).map(k => k[0].toUpperCase() + k.slice(1)).join(', ')));
    return bits.length ? h('div', { class: 'stats-line' }, bits) : null;
  }

  // Skill page
  const SKILL_SECTION = {
    mining: 'Veins', hunting: 'Hunting grounds', foraging: 'Groves', herbalism: 'Herb patches',
    smithing: 'Weapons', armoursmithing: 'Plate armour', fletching: 'Bows', leatherworking: 'Leather armour',
    enchanting: 'Focuses and sigils', tailoring: 'Cloth armour', scribing: 'Holy books', alchemy: 'Potions and tonics',
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

  // The gathering -> artisan -> combat chain a skill belongs to.
  function chainBar(skillId) {
    const sk = G.SKILL_BY_ID[skillId];
    const chain = G.SKILLS.filter(s => s.chain === sk.chain || (s.group === 'combat' && s.id === sk.chain));
    const link = s => h('button', { type: 'button', class: `chain-step${s.id === skillId ? ' here' : ''}`, onclick: () => go('skill:' + s.id) }, ui(s.id, 'sm skill-' + s.id), s.name);
    const gather = chain.filter(s => s.group === 'gathering'), craft = chain.filter(s => s.group === 'artisan'), fight = chain.filter(s => s.group === 'combat');
    return h('div', { class: 'chain' }, gather.map(link), h('span', { class: 'chain-arrow', 'aria-hidden': 'true' }, '→'),
      h('span', { class: 'chain-group' }, craft.map(link)), h('span', { class: 'chain-arrow', 'aria-hidden': 'true' }, '→'), fight.map(link));
  }

  function skillPage(id) {
    const sk = G.SKILL_BY_ID[id];
    const head = pageHead(id, 'skill-' + id, sk.name, sk.desc, levelBox(id));
    if (sk.group === 'combat') return [head, chainBar(id), ...combatSkillBody(sk)];
    const actions = G.ACTIONS.filter(a => a.skill === id);
    return [head, chainBar(id), section(SKILL_SECTION[id] || 'Actions', 'Click a card to start. Only one activity runs at a time.', h('div', { class: 'grid' }, actions.map(actionCard)))];
  }

  function combatSkillBody(sk) {
    const L = lvl(sk.id);
    const s = myStats();
    const kinds = G.WEAPON_KINDS.filter(w => w.skill === sk.id);
    const fitted = me.state.equipment.weapon && G.ITEMS[me.state.equipment.weapon];
    const trains = s.skill === sk.id;
    const earned = me.state.raidLog.reduce((a, e) => a + ((e.xp && e.xp[sk.id]) || 0), 0);
    const style = G.ROLES[sk.role].style;
    const body = [
      h('div', { class: 'two-col' },
        h('div', { class: 'panel stack' },
          h('h2', {}, 'How it trains'),
          h('p', {}, `Fight raid bosses with ${kinds.map(w => `a ${w.noun}`).join(', ').replace(/, ([^,]*)$/, ' or $1')} fitted. A win gives the boss’s full XP, a loss a quarter. Nothing else trains it.`),
          sk.role === 'healer' ? h('p', { class: 'muted' }, 'Healers heal whoever drops below 80% hull and smite the boss the rest of the time, so they can clear raids alone, just more slowly.') : null,
          h('p', { class: trains ? 'ok' : 'warn' }, trains
            ? `Your mech is set up to train ${sk.name}.`
            : fitted ? `Your ${fitted.name.toLowerCase()} trains ${G.SKILL_BY_ID[s.skill].name} instead.` : 'Fit a weapon in the Hangar to start training.'),
          h('p', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => go('raids') }, 'Go to raids'),
            h('button', { type: 'button', class: 'btn', onclick: () => go('hangar') }, 'Open hangar'))),
        h('div', { class: 'panel stack' },
          h('h2', {}, 'Current bonus'),
          h('p', { class: 'big-number' }, `+${L - 1}% ${sk.id === 'healing' ? 'healing and smite' : `${sk.name.toLowerCase()} damage`}`),
          h('p', { class: 'muted' }, `${num(earned)} XP earned in your last ${plural(me.state.raidLog.length, 'fight')}.`))),
    ];
    body.push(section('Weapons', `Made with ${G.SKILL_BY_ID[kinds[0].maker].name}. Each tier needs the previous boss’s material.`,
      h('div', { class: 'weapon-table' }, kinds.map(w => h('div', { class: 'weapon-kind' },
        h('div', { class: 'weapon-kind-head' }, gi(w.id, null, 'md'), h('div', {}, h('b', {}, w.noun[0].toUpperCase() + w.noun.slice(1)), h('small', { class: 'muted' }, w.note))),
        h('div', { class: 'tier-row' }, G.TIERS.map(t => {
          const id = `${t.id}_${w.id}`;
          const recipe = G.ACTION_BY_ID['craft_' + id];
          const on = me.state.equipment.weapon === id;
          return h('button', { type: 'button', class: `tier-cell${on ? ' on' : ''}${have(id) ? ' owned' : ''}`, title: G.ITEMS[id].name,
            disabled: !have(id) || on, onclick: () => act('/api/equip', { item: id }, `${G.ITEMS[id].name} fitted.`) },
          itemIco(id, 'md'), h('small', {}, on ? 'Fitted' : have(id) ? `${have(id)} owned` : `Lv ${recipe.level}`));
        })))))));
    if (style !== 'holy') {
      body.push(section('Against the bosses', 'Bosses take more damage from some styles and shrug off others.', h('div', { class: 'list' }, G.RAIDS.map(r => {
        const m = r.res[style] || 1;
        return h('div', { class: 'row' }, h('span', { class: 'boss-ico' }, bossArt(r.id)),
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
    const outputs = Object.entries(a.outputs);
    return h('button', {
      type: 'button', class: `card action${active ? ' active' : ''}${locked ? ' locked' : ''}`,
      disabled: locked, 'aria-pressed': String(active), onclick: () => toggleAction(a),
    },
      h('div', { class: 'card-top' }, h('span', {}, a.name), h('span', { class: 'card-time' }, secs(a.time))),
      h('div', { class: 'card-art' }, itemIco(a.item, 'xl')),
      locked
        ? h('div', { class: 'card-xp' }, ui('lock', 'sm'), `Level ${a.level}`)
        : h('div', { class: 'card-xp' }, `${a.xp} XP`),
      out.type === 'gear' ? statsLine(out) : out.boost || out.heal ? h('div', { class: 'stats-line' }, h('span', { class: 'stat-pct' }, out.desc.split('.')[0].replace('Raid tonic: ', ''))) : null,
      inputs.length ? h('div', { class: 'needs' }, inputs.map(([id, n]) =>
        h('span', { class: `need${have(id) < n ? ' short' : ''}`, title: G.ITEMS[id].name }, itemIco(id, 'sm'), String(n), h('small', {}, `/${fmt(have(id))}`)))) : null,
      !inputs.length && outputs.length > 1 ? h('div', { class: 'needs' }, outputs.map(([id, q]) =>
        h('span', { class: 'need', title: G.ITEMS[id].name }, itemIco(id, 'sm'), q[0] === q[1] ? `+${q[0]}` : `+${q[0]}–${q[1]}`, h('small', {}, ` ${fmt(have(id))}`)))) : null,
      h('div', { class: 'card-foot' }, h('span', {}, `Owned: ${fmt(have(a.item))}`), active ? h('span', { class: 'ok' }, 'Running') : null),
      h('span', { class: 'card-fill' }));
  }

  async function toggleAction(a) {
    const active = me.state.activity && me.state.activity.id === a.id;
    await act(active ? '/api/action/stop' : '/api/action/start', active ? {} : { id: a.id }, !active && raiding() ? 'Raid stopped. Training instead.' : null);
  }

  // Hangar
  function roleLine(s) {
    return h('div', { class: 'stats-line left' }, roleChip(s.role, s.stance), h('span', { class: 'muted' }, `Trains ${G.SKILL_BY_ID[s.skill].name}`));
  }

  function hangarPage() {
    const s = myStats();
    const eq = me.state.equipment;
    const gear = Object.keys(me.state.items).filter(id => G.ITEMS[id] && G.ITEMS[id].type === 'gear')
      .sort((x, y) => (G.ITEMS[y].rare ? 1 : 0) - (G.ITEMS[x].rare ? 1 : 0) || G.ITEMS[y].tier - G.ITEMS[x].tier);
    const supplies = Object.values(G.ITEMS).filter(it => it.supply);
    const pas = passiveText(s.passives);
    return [
      pageHead('hangar', 'skill-melee', me.player.mech, `Piloted by ${me.player.name}. Your weapon decides your class; your armour changes your mech’s look and stats.`),
      h('div', { class: 'hangar' },
        h('div', { class: 'panel hangar-mech' }, h('div', { class: 'hangar-stage' }, mechArt(me.player.colour, eq, `${me.player.mech}, your mech`)), roleLine(s),
          h('div', { class: 'mech-stats' },
            h('div', { class: 'mech-stat' }, h('b', { class: s.role === 'healer' ? 'stat-hp' : 'stat-atk' }, num(s.atk)), h('small', {}, s.role === 'healer' ? 'Heal/s' : 'Damage/s')),
            h('div', { class: 'mech-stat' }, h('b', { class: 'stat-def' }, num(s.def)), h('small', {}, 'Defence')),
            h('div', { class: 'mech-stat' }, h('b', { class: 'stat-hp' }, num(s.hp)), h('small', {}, 'Hull')),
            h('div', { class: 'mech-stat' }, h('b', { class: 'stat-pct' }, `${Math.round(((G.WEAPON_BY_ID[s.weapon] || { crit: 0.05 }).crit + s.crit) * 100)}%`), h('small', {}, 'Crit'))),
          s.bonuses.length || pas.length ? h('div', { class: 'bonus-list' }, h('b', {}, 'Active bonuses'),
            h('ul', {}, s.bonuses.map(b => h('li', {}, b)), pas.map(p => h('li', { class: 'passive' }, p)))) : null),
        h('div', {},
          section('Fitted gear', raiding() ? 'Changes take effect from your next fight.' : null, h('div', { class: 'slot-list' }, G.SLOTS.map(slot => {
            const it = eq[slot.id] && G.ITEMS[eq[slot.id]];
            const empty = { weapon: 'sword', head: 'plate_head', body: 'plate_body', legs: 'plate_legs', trinket: 'sigil' }[slot.id];
            return h('div', { class: `slot${it ? '' : ' empty-slot'}` },
              it ? itemIco(it.id) : gi(empty, '#4a5160'),
              h('div', { class: 'slot-info' }, h('small', {}, slot.name), h('b', {}, it ? it.name : 'Empty'), statsLine(it)),
              it ? h('button', { type: 'button', class: 'btn small', onclick: () => act('/api/unequip', { slot: slot.id }) }, 'Remove') : null);
          }))),
          section('Raid supplies', 'Ticked supplies go into every fight while you have them. Potions are only drunk when needed; tonics are used up each fight.',
            h('div', { class: 'slot-list' }, supplies.map(it => {
              const on = me.state.supplies[it.id] !== false;
              const box = h('input', { type: 'checkbox', checked: on, 'aria-label': `Bring ${it.name}`, onchange: e => act('/api/supplies', { item: it.id, on: e.target.checked }) });
              return h('label', { class: `slot supply${on ? '' : ' off'}` }, box, itemIco(it.id),
                h('div', { class: 'slot-info' }, h('small', {}, `${num(have(it.id))} owned`), h('b', {}, it.name), h('span', { class: 'muted small' }, it.desc)));
            }))),
          section('Gear in storage', gear.length ? null : 'Craft weapons and armour, trade for them, or win set pieces from raids.',
            gear.length ? h('div', { class: 'slot-list' }, gear.map(id => {
              const it = G.ITEMS[id];
              return h('div', { class: `slot${it.rare ? ' rare-slot' : ''}` }, itemIco(id),
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
      pageHead('inventory', 'skill-alchemy', 'Inventory', `${plural(ids.length, 'kind')} of item in storage. Select one to see what it’s for.`),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter items' }, filters.map(([id, name]) =>
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(invFilter === id), onclick: () => { invFilter = id; renderPage(); } }, name))),
      h('div', { class: 'inv section' },
        shown.length
          ? h('div', { class: 'tiles' }, shown.map(id => h('button', {
            type: 'button', class: `tile${G.ITEMS[id].rare ? ' rare-tile' : ''}`, title: G.ITEMS[id].name, 'aria-label': `${G.ITEMS[id].name}, ${have(id)}`,
            'aria-pressed': String(invSelected === id), onclick: () => { invSelected = id; renderPage(); },
          }, itemIco(id), h('span', { class: 'qty' }, fmt(have(id))))))
          : h('div', { class: 'empty' }, 'Nothing here yet. Start with a gathering skill: Mining, Hunting, Foraging or Herbalism.'),
        itemDetail(invSelected)),
    ];
  }

  function setDetail(setId) {
    const set = G.RAID_SETS[setId];
    const worn = G.ARMOUR_SLOTS.filter(slot => G.ITEMS[me.state.equipment[slot]] && G.ITEMS[me.state.equipment[slot]].set === setId).length;
    return h('div', { class: 'set-box' },
      h('b', {}, `${set.name} set (${worn}/3 worn)`),
      h('ul', {},
        h('li', { class: worn >= 2 ? 'ok' : '' }, `2 pieces: ${statText(set.two)}`),
        h('li', { class: worn >= 3 ? 'ok' : '' }, `3 pieces: ${passiveText(set.three.passives).join(' ')}`)));
  }

  function itemDetail(id) {
    if (!id) return h('div', { class: 'panel detail muted' }, 'Select an item to see its details.');
    const it = G.ITEMS[id];
    const madeBy = G.ACTIONS.filter(a => a.outputs[id] || a.chance.some(c => c.item === id));
    const usedIn = G.ACTIONS.filter(a => a.inputs[id]);
    const raids = G.RAIDS.filter(r => r.drops.some(d => d.item === id));
    const source = [...madeBy.map(a => `${a.name} (${G.SKILL_BY_ID[a.skill].name} ${a.level})`), ...raids.map(r => {
      const d = r.drops.find(x => x.item === id);
      return `${r.name} raid${d.p ? ` (${(d.p * 100).toFixed(1).replace('.0', '')}% per win)` : ''}`;
    })];
    return h('div', { class: 'panel detail' },
      h('div', { class: 'detail-head' }, itemIco(id, 'xl'), h('div', {}, h('h3', {}, it.name), h('small', {}, `${it.rare ? 'Rare ' : ''}${TYPE_NAME[it.type]}${it.tier ? ` · tier ${it.tier}` : ''} · ${num(have(id))} owned`))),
      h('p', {}, it.desc),
      statsLine(it),
      it.passives ? h('ul', { class: 'passive-list' }, passiveText(it.passives).map(p => h('li', {}, p))) : null,
      it.set ? setDetail(it.set) : null,
      it.armour && !it.set ? h('p', { class: 'muted' }, `Wear three ${G.ARMOUR_TYPES[it.armour].name.toLowerCase()} pieces for ${G.ARMOUR_TYPES[it.armour].bonus.name}: ${statText(G.ARMOUR_TYPES[it.armour].bonus)}.`) : null,
      source.length ? h('div', {}, h('b', {}, 'Comes from'), h('ul', {}, source.map(s => h('li', {}, s)))) : null,
      usedIn.length ? h('div', {}, h('b', {}, 'Used in'), h('ul', {}, usedIn.slice(0, 8).map(a => h('li', {}, `${a.name} (${a.inputs[id]})`)), usedIn.length > 8 ? h('li', {}, `and ${usedIn.length - 8} more`) : null)) : null,
      it.type === 'gear' ? h('button', { type: 'button', class: 'btn primary', onclick: () => act('/api/equip', { item: id }, `${it.name} fitted.`) }, 'Fit to mech') : null,
      h('button', { type: 'button', class: 'btn', onclick: () => { tradePrefill = { give: id }; go('trade'); } }, 'Offer in a trade'));
  }

  // Raids
  const xpText = xp => Object.entries(xp || {}).map(([k, v]) => `+${num(v)} ${G.SKILL_BY_ID[k] ? G.SKILL_BY_ID[k].name : k}`).join(', ');

  function resChips(r) {
    return h('div', { class: 'res-chips' }, Object.entries(r.res).sort((a, b) => b[1] - a[1]).map(([d, m]) =>
      h('span', { class: `res-chip ${m > 1 ? 'weak' : 'resist'}` }, `${m > 1 ? 'Weak' : 'Resists'}: ${G.STYLES[d]} ${m > 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`)));
  }

  function raidsPage() {
    const battle = createBattle();
    const partyBox = h('div');
    const openBox = h('div');
    const cards = h('div', { class: 'raid-grid' });
    const history = h('div');
    let data = { party: null, open: [] };

    function drawCards() {
      const s = myStats();
      const pw = G.power(s);
      const a = me.state.activity;
      const style = G.ROLES[s.role].style;
      cards.replaceChildren(...G.RAIDS.map(r => {
        const tier = G.TIERS[r.tier - 1];
        const ratio = pw / r.recommended;
        const cls = ratio >= 1 ? 'ok' : ratio >= 0.8 ? 'warn' : 'bad';
        const mult = r.res[style] || 1;
        const here = a && a.type === 'raid' && a.raid === r.id;
        const set = G.RAID_SETS[r.id];
        const card = h('article', { class: `raid${here ? ' fighting' : ''}` },
          h('div', { class: 'raid-top' },
            h('span', { class: 'boss-portrait' }, bossArt(r.id)),
            h('div', { class: 'raid-title' }, h('span', { class: 'tier' }, `Tier ${r.tier}`), h('h3', {}, r.name),
              h('small', { class: 'muted' }, `${r.moves.basic} · ${r.moves.sweep} every ${G.BOSS_MOVES.sweepEvery}th attack`))),
          h('p', {}, r.desc),
          resChips(r),
          h('div', { class: 'kv' },
            h('div', {}, h('b', { class: 'stat-hp' }, num(r.boss.hp)), h('small', {}, 'Hull')),
            h('div', {}, h('b', { class: 'stat-atk' }, num(r.boss.dps)), h('small', {}, 'Damage/s')),
            h('div', {}, h('b', { class: 'stat-def' }, num(r.boss.def)), h('small', {}, 'Defence'))),
          h('div', { class: 'power-check' }, h('span', {}, `Recommended power ${num(r.recommended)}`), h('span', { class: cls }, `Yours ${num(pw)}`)),
          mult !== 1 ? h('div', { class: 'power-check' }, h('span', { class: 'muted' }, `Your ${G.ROLES[s.role].name.toLowerCase()} weapon`), h('span', { class: mult > 1 ? 'ok' : 'bad' }, `${mult > 1 ? '+' : ''}${Math.round((mult - 1) * 100)}% damage`)) : null,
          h('div', {}, h('small', { class: 'muted' }, `Drops on a win · ${set.name} set and ${G.RAID_TRINKETS[r.id].name} are rare`), h('div', { class: 'drops' }, r.drops.map(d =>
            h('span', { class: `need${G.ITEMS[d.item].rare ? ' rare-need' : ''}`, title: G.ITEMS[d.item].name }, itemIco(d.item, 'sm'),
              d.p ? `${(d.p * 100).toFixed(1).replace('.0', '')}%` : `${d.qty[0]}–${d.qty[1]}`)))),
          h('div', { class: 'actions' },
            here
              ? h('button', { type: 'button', class: 'btn danger', onclick: stopRaid }, 'Stop fighting')
              : h('button', { type: 'button', class: 'btn primary', onclick: () => startSolo(r) }, 'Fight'),
            h('button', { type: 'button', class: 'btn', disabled: !!data.party, onclick: () => partyAct('/api/party/create', { raid: r.id }, 'Party formed. Friends and guildmates can now join.') }, 'Form a party')));
        card.style.setProperty('--tier', r.mat.colour);
        return card;
      }));
    }

    function drawParty() {
      const p = data.party;
      if (!p) { partyBox.replaceChildren(); }
      else {
        const raid = G.RAID_BY_ID[p.raid];
        const leader = p.leader === me.player.id;
        const note = p.running ? `Raiding now · fight ${p.running.n}` : `Breaks up ${fmtTime(p.expires - now())} from now if not started.`;
        partyBox.replaceChildren(section('Your party', note,
          h('div', { class: 'panel party' },
            h('div', { class: 'raid-top' }, h('span', { class: 'boss-portrait small' }, bossArt(raid.id)),
              h('div', { class: 'raid-title' }, h('span', { class: 'tier' }, `Tier ${raid.tier}`), h('h3', {}, raid.name)),
              h('span', { class: 'muted' }, `${p.members.length} / ${G.PARTY_MAX} pilots`)),
            h('div', { class: 'member-list' }, p.members.map(m => memberRow(m, m.id === p.leader ? 'Leader' : null))),
            h('p', { class: 'muted' }, 'The boss gets tougher with every pilot, but its attacks get shared out. A tank draws its attacks and a healer keeps everyone standing. Fights repeat until the leader stops them.'),
            h('div', { class: 'actions' },
              leader && !p.running ? h('button', { type: 'button', class: 'btn primary', onclick: () => partyAct('/api/party/start', {}, 'Party raid started.') }, 'Start raiding') : null,
              leader && p.running ? h('button', { type: 'button', class: 'btn', onclick: () => partyAct('/api/party/stop', {}, 'Party raid stopped.') }, 'Stop raiding') : null,
              !leader ? h('span', { class: 'muted' }, p.running ? 'Fighting with the party.' : 'Waiting for the leader to start.') : null,
              h('button', { type: 'button', class: 'btn danger', onclick: () => partyAct('/api/party/leave', {}, leader ? 'Party disbanded.' : 'You left the party.') }, leader ? 'Disband' : 'Leave')))));
      }
      openBox.replaceChildren(section('Open parties', 'Parties led by your friends and guildmates. Joining a running party puts you straight into its next fight.',
        data.open.length ? h('div', { class: 'list' }, data.open.map(o => {
          const raid = G.RAID_BY_ID[o.raid];
          const lead = o.members.find(m => m.id === o.leader) || o.members[0];
          return h('div', { class: 'row' },
            h('span', { class: 'boss-ico' }, bossArt(raid.id)),
            h('div', { class: 'grow' }, h('div', { class: 'name' }, `${lead ? lead.name : 'Someone'}’s party`), h('small', {}, `${raid.name} · ${o.members.length}/${G.PARTY_MAX} pilots${o.running ? ' · raiding now' : ''}`)),
            h('button', { type: 'button', class: 'btn small primary', disabled: !!data.party, onclick: () => partyAct('/api/party/join', { id: o.id }, 'Joined the party.') }, 'Join'));
        })) : h('div', { class: 'empty' }, 'No open parties right now. Form one from a boss below, or add friends and join a guild to see theirs.')));
    }

    function drawHistory() {
      const log = me.state.raidLog;
      history.replaceChildren(section('Recent fights', null, log.length ? h('div', { class: 'history' }, log.slice(0, 10).map(e => {
        const raid = G.RAID_BY_ID[e.raid];
        return h('div', { class: 'history-row' },
          h('span', { class: 'boss-ico' }, bossArt(raid.id)),
          h('span', { class: `result ${e.win ? 'ok' : 'bad'}` }, e.win ? 'Victory' : 'Defeat'),
          h('div', { class: 'what' }, h('div', {}, raid.name), h('small', {}, `${e.party.length > 1 ? e.party.join(', ') : 'Solo'} · ${fmtTime(e.ms || 0)} · ${ago(e.at)}`)),
          h('span', { class: 'loot' }, h('span', { class: 'muted' }, xpText(e.xp)), Object.entries(e.loot).filter(([id]) => G.ITEMS[id]).map(([id, n]) =>
            h('span', { class: G.ITEMS[id].rare ? 'rare-loot' : '', title: G.ITEMS[id].name }, itemIco(id, 'sm'), num(n)))));
      })) : h('div', { class: 'empty' }, 'No fights yet. Craft a tier 1 weapon and some armour, then take on the Warden.')));
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
      if (await act(path, body, msg)) { await poll(); load(); battle.sync(); }
    }
    async function startSolo(r) {
      if (await act('/api/raid/start', { raid: r.id }, `Fighting ${r.name}. Fights repeat until you stop.`)) { load(); battle.sync(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    }
    async function stopRaid() {
      if (await act('/api/action/stop', {}, 'Stopped fighting.')) { load(); battle.sync(); }
    }
    battle.onStop = stopRaid;

    pageRefresh = load;
    pageTick = () => { battle.sync(); drawHistory(); };
    pageCleanup = () => battle.destroy();
    drawCards();
    drawParty();
    drawHistory();
    load();
    battle.sync();
    return [
      pageHead('raids', 'skill-melee', 'Raids', 'Pick a boss and press Fight. Fights repeat on their own, even while you’re away, until you stop or start a skill. Bosses drop the material for the next tier, gold, and rare set pieces.'),
      battle.el, partyBox, openBox, section('Bosses', 'Win or lose, you earn combat XP for your weapon’s skill. No entry cost.', cards), history,
    ];
  }

  function memberRow(m, note) {
    return h('div', { class: 'member' },
      h('span', { class: `dot ${m.online ? 'online' : 'offline'}`, title: m.online ? 'Online' : 'Offline' }),
      h('span', { class: 'name' }, m.name, m.guild ? h('span', { class: 'tag' }, ` [${m.guild}]`) : null),
      note ? h('small', {}, note) : null,
      h('small', {}, `Power ${num(m.power)}`));
  }

  // ---------- Battle panel ----------
  // Plays the current fight inside the Raids page, in step with the server's clock. The server
  // decides each fight up front; the panel replays its timeline, so every cast bar finishes
  // on the exact frame its hit or heal lands. Damage numbers take the colour of the pilot who
  // dealt them and name the damage type underneath.
  const SERIES = ['#5b9bff', '#f2c14e', '#3ddc84', '#ff7ab6'];
  const fmtClock = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function createBattle() {
    const root = h('section', { class: 'battle', 'aria-label': 'Current raid fight' });
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const api_ = { el: root, sync, destroy, onStop: null };
    let cur = null, raf = 0, fetching = false, idx = 0, quiet = false, asked = false;
    let party = [], boss = null, dealt = [], healed = [], buckets = [], meterRows = [], lastMeter = 0, lastSec = -1;
    let clockEl, statusEl, meter, graph, footer;

    function destroy() { cancelAnimationFrame(raf); }

    function idle() {
      cancelAnimationFrame(raf);
      cur = null;
      root.replaceChildren(
        h('div', { class: 'battle-empty' },
          h('div', { class: 'battle-empty-art' }, mechArt(me.player.colour, me.state.equipment, 'Your mech'), h('span', { class: 'vs' }, 'VS'), h('span', { class: 'unknown' }, '?')),
          h('div', {}, h('h2', {}, 'No fight running'), h('p', { class: 'muted' }, 'Choose a boss below and press Fight, or join a party. Your fights play out here.'))));
    }

    async function sync() {
      const a = me && me.state.activity;
      if (!a || !a.type) { if (cur || !root.firstChild) idle(); return; }
      if (cur && cur.n === a.n && cur.start === a.start) { drawFooter(); return; }
      if (fetching) return;
      fetching = true;
      try {
        const r = await api('/api/raid/current');
        if (r.current) load(r.current); else idle();
      } catch (e) { /* retried on the next poll */ } finally { fetching = false; }
    }

    function makeUnit(name, sub, art, max, big, colour) {
      const floats = h('div', { class: 'floats', 'aria-hidden': 'true' });
      const artBox = h('div', { class: 'unit-art' }, art);
      const hpFill = h('span'), hpText = h('b');
      const castFill = h('span'), castText = h('b', {}, 'Getting ready');
      const castBar = h('div', { class: 'castbar idle' }, castFill, castText);
      const statuses = h('div', { class: 'statuses' });
      const swatch = h('span', { class: 'swatch-dot' });
      if (colour) swatch.style.background = colour;
      const el = h('div', { class: `unit${big ? ' big' : ''}` }, artBox,
        h('div', { class: 'unit-info' }, h('div', { class: 'unit-name' }, h('span', {}, colour ? swatch : null, name), sub), h('div', { class: 'hpbar' }, hpFill, hpText), castBar, statuses), floats);
      if (colour) el.style.setProperty('--series', colour);
      const u = { name, el, artBox, floats, hpFill, hpText, castFill, castText, castBar, statuses, hp: max, max, barrier: 0, cast: null, down: false, buffs: {} };
      drawHp(u);
      return u;
    }
    function drawHp(u) {
      const f = Math.max(0, u.hp) / u.max;
      u.hpFill.style.width = f * 100 + '%';
      u.hpFill.parentNode.classList.toggle('low', f < 0.3);
      u.hpText.textContent = `${num(Math.max(0, u.hp))} / ${num(u.max)}${u.barrier >= 1 ? `  +${num(u.barrier)} shield` : ''}`;
    }

    function load(c) {
      cancelAnimationFrame(raf);
      cur = c;
      idx = 0;
      asked = false;
      lastSec = -1;
      const f = c.fight;
      const raid = G.RAID_BY_ID[f.raid];

      party = f.fighters.map((p, i) => {
        const u = makeUnit(p.name, roleChip(p.role, p.stance), mechArt(p.colour || '#8d95a5', p.gear || {}, `${p.name}’s mech`), p.max, false, SERIES[i]);
        u.stance = p.stance;
        u.colour = SERIES[i];
        return u;
      });
      boss = makeUnit(raid.name, h('span', { class: 'tier' }, `Tier ${raid.tier}`), bossArt(raid.id), f.bossMax, true, null);
      dealt = f.fighters.map(() => 0);
      healed = f.fighters.map(() => 0);
      buckets = f.fighters.map(() => []);
      meterRows = f.fighters.map((p, i) => {
        const fill = h('span'), val = h('span', { class: 'meter-val' });
        fill.style.background = SERIES[i];
        const dot = h('span', { class: 'swatch-dot' });
        dot.style.background = SERIES[i];
        return { row: h('div', { class: 'meter-row' }, h('div', { class: 'meter-name' }, dot, p.name, val), h('div', { class: 'meter-bar' }, fill)), fill, val, i };
      });
      meter = h('div', { class: 'meter' }, meterRows.map(r => r.row));
      graph = h('div', { class: 'graph', role: 'img', 'aria-label': 'Damage per second over time for each pilot' });
      clockEl = h('span', { class: 'battle-clock' }, '0:00');
      statusEl = h('span', { class: 'battle-status' });
      footer = h('footer', { class: 'battle-foot' });
      root.replaceChildren(
        h('header', { class: 'battle-head' },
          h('div', { class: 'battle-title' }, h('span', { class: 'tier' }, `Tier ${raid.tier} · ${c.party ? 'Party raid' : 'Solo raid'} · Fight ${c.n}`), h('h2', {}, raid.name)),
          statusEl, clockEl,
          h('button', { type: 'button', class: 'btn small danger', onclick: () => api_.onStop && api_.onStop() },
            !c.party ? 'Stop fighting' : c.leader === me.player.id ? 'Stop party raid' : 'Leave party')),
        h('div', { class: 'battle-grid' },
          h('div', { class: 'battle-cell' }, h('h3', {}, c.party ? 'Your party' : 'You'), h('div', { class: 'unit-list' }, party.map(u => u.el))),
          h('div', { class: 'battle-cell enemy' }, h('h3', {}, 'Enemy'), boss.el),
          h('div', { class: 'battle-cell' }, h('h3', {}, 'Damage meter'), meter),
          h('div', { class: 'battle-cell' }, h('h3', {}, 'Damage per second (5s average)'), graph)),
        footer);
      drawFooter();

      // Joining mid-fight: catch up silently to the current moment.
      const clock = now() - c.start;
      quiet = true;
      while (idx < f.events.length && f.events[idx].t <= clock) apply(f.events[idx++]);
      quiet = false;
      drawMeter(clock);
      drawGraph(clock);
      raf = requestAnimationFrame(tick);
    }

    function drawFooter() {
      if (!footer) return;
      const e = me.state.raidLog[0];
      if (!e) { footer.replaceChildren(h('span', { class: 'muted' }, 'Loot and XP from each fight show here and in Recent fights.')); return; }
      footer.replaceChildren(h('span', { class: 'muted' }, 'Last fight:'), h('b', { class: e.win ? 'ok' : 'bad' }, e.win ? 'Victory' : 'Defeat'),
        h('span', {}, xpText(e.xp)),
        ...Object.entries(e.loot || {}).filter(([id]) => G.ITEMS[id]).map(([id, n]) =>
          h('span', { class: `pill${G.ITEMS[id].rare ? ' rare-loot' : ''}`, title: G.ITEMS[id].name }, itemIco(id, 'sm'), G.ITEMS[id].rare ? G.ITEMS[id].name : `+${num(n)}`)));
    }

    // A floating number with its damage type underneath, in the dealer's colour.
    function float(u, value, label, colour, big) {
      if (quiet) return;
      const s = h('span', { class: `float${big ? ' big' : ''}` }, h('b', {}, value), label ? h('small', {}, label) : null);
      // Spread numbers around so bursts of hits stay readable.
      s.style.left = `${15 + Math.random() * 70}%`;
      s.style.top = `${u === boss ? 8 + Math.random() * 45 : 5 + Math.random() * 45}%`;
      s.style.setProperty('--fc', colour);
      u.floats.append(s);
      setTimeout(() => s.remove(), 1400);
    }
    function flash(u, cls) {
      if (quiet || reduced) return;
      u.artBox.classList.remove('hit', 'healed');
      void u.artBox.offsetWidth; // restart the animation
      u.artBox.classList.add(cls);
    }
    const unit = k => (k === 'b' ? boss : party[k]);
    function castLabel(e) {
      if (e.tg === 'all') return `${e.n} → everyone`;
      if (e.a === 'b' || typeof e.tg === 'number') return `${e.n} → ${party[e.tg].name}`;
      return e.n;
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
        const from = e.a === 'b' ? null : party[e.a];
        if (e.k === 'heal' || e.k === 'potion' || e.k === 'leech') {
          const eff = Math.min(e.v, target.max - target.hp);
          target.hp += eff;
          if (e.b !== undefined) target.barrier = e.b;
          if (e.k === 'heal') healed[e.a] += eff;
          float(target, `+${num(e.v)}${e.c ? '!' : ''}`, e.ty, '#4ee08f', e.c);
          flash(target, 'healed');
        } else {
          if (e.ab) target.barrier = e.b || 0;
          target.hp = Math.max(0, target.hp - (e.v - (e.ab || 0)));
          const colour = from ? from.colour : '#ff6b5b';
          float(target, `${num(e.v)}${e.c ? '!' : ''}`, e.ab ? `${e.ty} · ${num(e.ab)} blocked` : e.ty, colour, e.c);
          flash(target, 'hit');
          if (from) {
            dealt[e.a] += e.v;
            const sec = Math.floor(e.t / 1000);
            buckets[e.a][sec] = (buckets[e.a][sec] || 0) + e.v;
          }
          if (e.k === 'burn') target.buffs[e.ty] = { until: e.t + 1100, cls: 'burn' };
        }
        drawHp(target);
        if (e.k !== 'burn' && e.k !== 'potion' && e.k !== 'leech' && e.k !== 'thorns') unit(e.a).castFill.style.width = '100%';
      } else if (e.e === 'down') {
        const u = unit(e.tg);
        u.down = true;
        u.cast = null;
        u.el.classList.add('down');
        u.castBar.classList.add('idle');
        u.castFill.style.width = '0';
        u.castText.textContent = 'Downed';
      } else if (e.e === 'end') {
        [...party, boss].forEach(u => { if (!u.down) { u.castBar.classList.add('idle'); u.cast = null; } });
        if (e.win) { boss.el.classList.add('down'); boss.castText.textContent = 'Defeated'; }
      }
    }

    function drawStatuses(clock) {
      const tank = party.find(u => u.stance === 'tank' && !u.down);
      if (tank) boss.buffs.Taunted = { until: Infinity, cls: 'taunt', label: `Taunted by ${tank.name}` };
      else delete boss.buffs.Taunted;
      [...party, boss].forEach(u => {
        u.statuses.replaceChildren(...Object.entries(u.buffs).filter(([, b]) => b.until > clock)
          .map(([n, b]) => h('span', { class: `status ${b.cls}` }, b.label || n)));
      });
    }

    function drawMeter(clock) {
      const secs = Math.max(1, clock / 1000);
      const dps = dealt.map(d => d / secs);
      const top = Math.max(1, ...dps);
      meterRows.slice().sort((a, b) => dps[b.i] - dps[a.i]).forEach(r => {
        meter.append(r.row);
        r.fill.style.width = `${(dps[r.i] / top) * 100}%`;
        r.val.textContent = `${dps[r.i].toFixed(1)} DPS · ${num(dealt[r.i])}${healed[r.i] ? ` · ${(healed[r.i] / secs).toFixed(1)} HPS` : ''}`;
      });
    }

    function drawGraph(clock) {
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
      const W = 400, H = 140;
      const x = s => (s / span) * W, y = v => H - (v / top) * H;
      const grid = [0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" class="gl"/><text x="4" y="${H * f - 3}" class="gt">${Math.round(top * (1 - f))}</text>`).join('');
      const lines = series.map((pts, i) => `<polyline fill="none" stroke="${SERIES[i]}" stroke-width="2" stroke-linejoin="round" points="${pts.map((v, s) => `${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`).join('');
      graph.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${lines}</svg>`;
    }

    function tick(t) {
      if (!cur) return;
      const f = cur.fight;
      const clock = Math.min(now() - cur.start, f.ms);
      while (idx < f.events.length && f.events[idx].t <= clock) apply(f.events[idx++]);
      [...party, boss].forEach(u => {
        if (u.cast && !u.down) u.castFill.style.width = `${Math.min(1, (clock - u.cast.start) / u.cast.d) * 100}%`;
      });
      clockEl.textContent = fmtClock(clock);
      const done = now() - cur.start >= f.ms;
      if (done) {
        const next = cur.start + f.ms + G.FIGHT.gapMs - now();
        statusEl.className = `battle-status ${f.win ? 'ok' : 'bad'}`;
        statusEl.textContent = `${f.win ? 'Victory' : f.timeout ? 'Out of time' : 'Defeat'} · next fight ${next > 0 ? `in ${Math.ceil(next / 1000)}s` : 'starting'}`;
        // Ask the server to move on once the gap is over.
        if (next < -300 && !asked) { asked = true; poll(); }
      } else {
        statusEl.className = 'battle-status';
        statusEl.textContent = 'Fighting';
      }
      if (t - lastMeter > 200) { lastMeter = t; drawMeter(clock); drawStatuses(clock); }
      const sec = Math.floor(clock / 1000);
      if (sec !== lastSec) { lastSec = sec; drawGraph(clock); }
      raf = requestAnimationFrame(tick);
    }

    return api_;
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
      pageHead('guild', 'skill-crafting', me.guild ? me.guild.name : 'Guild', 'Band together with other pilots. Guildmates can see and join each other’s raid parties.'),
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
