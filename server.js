'use strict';
// MekaIdle server: static files, accounts and the game API, backed by SQLite.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const G = require('./public/data.js');
const game = require('./lib/game.js');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_MS = 30 * 24 * 3600 * 1000;
const ONLINE_MS = 5 * 60 * 1000;
const PARTY_TTL = 15 * 60 * 1000;
const GUILD_MAX = 30;
const FRIENDS_MAX = 100;
const OPEN_TRADES_MAX = 10;
const BODY_LIMIT = 16 * 1024;

// ---------- Database ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'mekaidle.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, pass TEXT NOT NULL,
    mech TEXT NOT NULL, colour TEXT NOT NULL, state TEXT NOT NULL,
    guild_id INTEGER, guild_joined INTEGER, total_level INTEGER NOT NULL DEFAULT 6, power INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL, last_seen INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, player_id INTEGER NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS friends (a INTEGER NOT NULL, b INTEGER NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (a, b));
  CREATE TABLE IF NOT EXISTS guilds (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, tag TEXT NOT NULL UNIQUE,
    leader_id INTEGER NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS guild_chat (id INTEGER PRIMARY KEY, guild_id INTEGER NOT NULL, player_id INTEGER NOT NULL,
    name TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL,
    give TEXT NOT NULL, want TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS parties (id INTEGER PRIMARY KEY, leader_id INTEGER NOT NULL, raid TEXT NOT NULL, created INTEGER NOT NULL, session TEXT);
  CREATE TABLE IF NOT EXISTS party_members (party_id INTEGER NOT NULL, player_id INTEGER NOT NULL UNIQUE, joined INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS guild_chat_guild ON guild_chat (guild_id, id);
  CREATE INDEX IF NOT EXISTS trades_to ON trades (to_id, status);
  CREATE INDEX IF NOT EXISTS trades_from ON trades (from_id, status);
`);

// Added after launch: a running party raid's session. Existing databases get the column here.
for (const sql of [
  'ALTER TABLE parties ADD COLUMN session TEXT',
  'ALTER TABLE players ADD COLUMN combat_level INTEGER NOT NULL DEFAULT 4',
  'ALTER TABLE players ADD COLUMN activity TEXT',
  'ALTER TABLE players ADD COLUMN guild_rank TEXT',
  "ALTER TABLE parties ADD COLUMN diff TEXT NOT NULL DEFAULT 'normal'",
  "ALTER TABLE parties ADD COLUMN visibility TEXT NOT NULL DEFAULT 'friends'",
]) {
  try { db.exec(sql); } catch (e) { /* already there */ }
}
db.exec('DROP TABLE IF EXISTS raid_runs');
// Parties for raids that no longer exist (content changes) are dropped; members go idle on load.
for (const p of db.prepare('SELECT id, raid FROM parties').all()) {
  if (!G.RAID_BY_ID[p.raid]) { db.prepare('DELETE FROM party_members WHERE party_id = ?').run(p.id); db.prepare('DELETE FROM parties WHERE id = ?').run(p.id); }
}

const stmts = new Map();
const q = sql => {
  if (!stmts.has(sql)) stmts.set(sql, db.prepare(sql));
  return stmts.get(sql);
};

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- Helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = msg => { throw new HttpError(400, msg); };
const str = v => (typeof v === 'string' ? v : '');
const int = v => (Number.isInteger(v) ? v : NaN);

const hits = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, 'Slow down a little and try again shortly.');
  list.push(now);
  hits.set(key, list);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of hits) if (!list.some(t => now - t < 3600e3)) hits.delete(k);
  q('DELETE FROM sessions WHERE expires < ?').run(now);
}, 600e3).unref();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(password, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// ---------- Players ----------
function loadPlayer(id) {
  const row = q('SELECT * FROM players WHERE id = ?').get(id);
  if (!row) return null;
  row.state = game.migrate(JSON.parse(row.state), Date.now());
  return row;
}

// Loads a player and runs their activity (a skill, a solo raid or a party raid) forward to now.
function fresh(id) {
  const p = loadPlayer(id);
  if (!p) bad('That pilot no longer exists.');
  const now = Date.now();
  p.gained = game.advance(p.state, now);
  const a = p.state.activity;
  if (a && a.type === 'raid') {
    game.advanceRaid(a, [p], now, { [p.id]: p.gained });
  } else if (a && a.type === 'party') {
    const party = q('SELECT * FROM parties WHERE id = ?').get(a.party);
    if (party && party.session) advanceParty(party, now, p);
    else p.state.activity = null;
  }
  return p;
}

function savePlayer(p) {
  q('UPDATE players SET state = ?, total_level = ?, power = ?, combat_level = ?, activity = ?, colour = ? WHERE id = ?')
    .run(JSON.stringify(p.state), game.totalLevel(p.state), game.power(p.state), G.combatLevel(game.levels(p.state)), activityLabel(p.state), classColour(p.state), p.id);
}

// A short description of what a pilot is doing, e.g. "Mining: Iron vein".
function activityLabel(state) {
  const a = state.activity;
  if (!a) return 'Idle';
  const raidName = (id, diff) => (G.RAID_BY_ID[id] ? `${G.RAID_BY_ID[id].name}${diff && diff !== 'normal' ? ` (${G.DIFF_BY_ID[diff].name})` : ''}` : 'a raid');
  if (a.type === 'raid') return `Raiding ${raidName(a.raid, a.diff)}`;
  if (a.type === 'party') {
    const party = q('SELECT raid, diff FROM parties WHERE id = ?').get(a.party);
    return party ? `Party raid: ${raidName(party.raid, party.diff)}` : 'Idle';
  }
  const action = G.ACTION_BY_ID[a.id];
  return action ? `${G.SKILL_BY_ID[action.skill].name}: ${action.name}${a.left ? ` (${a.left} left)` : ''}` : 'Idle';
}

const classColour = state => {
  const it = G.ITEMS[state.equipment.weapon];
  return it ? G.CLASSES[it.cls].colour : G.UNARMED_COLOUR;
};

// The state as the client sees it: raid sessions are summarised, without the fight timeline.
function clientState(state) {
  const a = state.activity;
  if (!a || !a.type) return state;
  if (a.type === 'raid') return { ...state, activity: { type: 'raid', ...game.sessionSummary(a) } };
  const party = q('SELECT session FROM parties WHERE id = ?').get(a.party);
  const session = party && party.session ? JSON.parse(party.session) : null;
  return { ...state, activity: { type: 'party', party: a.party, ...game.sessionSummary(session) } };
}

// Loads, advances, applies fn and saves one player inside a transaction.
function withPlayer(id, fn) {
  return tx(() => {
    const p = fresh(id);
    const r = fn(p.state, p);
    savePlayer(p);
    return r === undefined ? { state: clientState(p.state) } : r;
  });
}

const PUB_SQL = `SELECT p.id, p.name, p.mech, p.colour, p.total_level, p.power, p.last_seen, p.guild_id, g.tag
  FROM players p LEFT JOIN guilds g ON g.id = p.guild_id`;
function pub(row) {
  return {
    id: row.id, name: row.name, mech: row.mech, colour: row.colour, level: row.total_level, power: row.power,
    online: Date.now() - row.last_seen < ONLINE_MS, guild: row.tag || null,
  };
}
const pubById = id => { const r = q(`${PUB_SQL} WHERE p.id = ?`).get(id); return r ? pub(r) : null; };
const findByName = name => q('SELECT id, name, guild_id FROM players WHERE name_key = ?').get(str(name).trim().toLowerCase());

function friendIds(me) {
  return q(`SELECT CASE WHEN a = ? THEN b ELSE a END AS id FROM friends WHERE (a = ? OR b = ?) AND status = 'accepted'`)
    .all(me, me, me).map(r => r.id);
}

// ---------- Routing ----------
const routes = new Map();
const route = (method, p, handler, auth = true) => routes.set(`${method} ${p}`, { handler, auth });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new HttpError(413, 'Request too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch { reject(new HttpError(400, 'Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function sessionCookie(ctx, token, maxAge) {
  const secure = ctx.req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  ctx.res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

function startSession(ctx, playerId) {
  const token = crypto.randomBytes(32).toString('hex');
  q('INSERT INTO sessions (token, player_id, expires) VALUES (?, ?, ?)').run(sha(token), playerId, Date.now() + SESSION_MS);
  q('UPDATE players SET last_seen = ? WHERE id = ?').run(Date.now(), playerId);
  sessionCookie(ctx, token, SESSION_MS / 1000);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function handleApi(req, res, url) {
  const r = routes.get(`${req.method} ${url.pathname}`);
  if (!r) throw new HttpError(404, 'Not found.');
  const ctx = { req, res, url, body: {}, ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() };
  if (req.method === 'POST') {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Expected JSON.');
    ctx.body = await readBody(req);
  }
  if (r.auth) {
    const token = cookies(req).sid;
    const s = token && q('SELECT player_id, expires FROM sessions WHERE token = ?').get(sha(token));
    if (!s || s.expires < Date.now()) throw new HttpError(401, 'Please log in.');
    ctx.me = s.player_id;
    q('UPDATE players SET last_seen = ? WHERE id = ?').run(Date.now(), ctx.me);
  }
  send(res, 200, r.handler(ctx) || { ok: true });
}

// ---------- Auth ----------
route('POST', '/api/register', ctx => {
  limit('auth:' + ctx.ip, 10, 10 * 60e3);
  const name = str(ctx.body.name).trim();
  const password = str(ctx.body.password);
  const mech = str(ctx.body.mech).trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) bad('Pilot names are 3 to 16 letters, numbers or underscores.');
  if (password.length < 8 || password.length > 200) bad('Your password needs at least 8 characters.');
  if (!/^[A-Za-z0-9 .'-]{1,24}$/.test(mech)) bad('Mech names are up to 24 letters, numbers, spaces or . \' -');
  if (findByName(name)) bad('That pilot name is already taken.');
  const now = Date.now();
  const info = q(`INSERT INTO players (name, name_key, pass, mech, colour, state, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, name.toLowerCase(), hashPassword(password), mech, G.UNARMED_COLOUR, JSON.stringify(game.newState(now)), now, now);
  startSession(ctx, Number(info.lastInsertRowid));
}, false);

route('POST', '/api/login', ctx => {
  limit('auth:' + ctx.ip, 10, 10 * 60e3);
  const row = q('SELECT id, pass FROM players WHERE name_key = ?').get(str(ctx.body.name).trim().toLowerCase());
  const password = str(ctx.body.password).slice(0, 200);
  if (!row || !checkPassword(password, row.pass)) bad('Wrong pilot name or password.');
  startSession(ctx, row.id);
}, false);

route('POST', '/api/logout', ctx => {
  const token = cookies(ctx.req).sid;
  if (token) q('DELETE FROM sessions WHERE token = ?').run(sha(token));
  sessionCookie(ctx, '', 0);
});

// ---------- Player ----------
route('GET', '/api/me', ctx => tx(() => {
  const p = fresh(ctx.me);
  savePlayer(p);
  const g = p.gained;
  const away = g.ms > 60e3 && (Object.keys(g.items).length || Object.keys(g.xp).length) ? g : null;
  const party = q('SELECT party_id FROM party_members WHERE player_id = ?').get(ctx.me);
  return {
    now: Date.now(),
    player: { id: p.id, name: p.name, mech: p.mech, colour: classColour(p.state) },
    state: clientState(p.state),
    away,
    guild: p.guild_id ? q('SELECT id, name, tag FROM guilds WHERE id = ?').get(p.guild_id) : null,
    alerts: {
      friends: q(`SELECT COUNT(*) AS n FROM friends WHERE b = ? AND status = 'pending'`).get(ctx.me).n,
      trades: q(`SELECT COUNT(*) AS n FROM trades WHERE to_id = ? AND status = 'open'`).get(ctx.me).n,
      party: party ? party.party_id : null,
    },
  };
}));

// Starting a skill ends any raid you're in, the same as switching between skills.
route('POST', '/api/action/start', ctx => withPlayer(ctx.me, (s, p) => {
  const action = G.ACTION_BY_ID[str(ctx.body.id)];
  if (action && game.level(s, action.skill) >= action.level && game.hasItems(s.items, action.inputs)) leaveRaid(p);
  game.startAction(s, str(ctx.body.id), ctx.body.count);
}));
route('POST', '/api/queue', ctx => withPlayer(ctx.me, s => game.setQueue(s, ctx.body.queue)));
route('POST', '/api/abilities', ctx => withPlayer(ctx.me, s => game.setAbilities(s, ctx.body.cls, str(ctx.body.generic) || null)));
route('POST', '/api/subclass', ctx => withPlayer(ctx.me, s => game.setSubclass(s, str(ctx.body.cls), str(ctx.body.sub), str(ctx.body.second))));
route('POST', '/api/action/stop', ctx => withPlayer(ctx.me, (s, p) => { leaveRaid(p); game.stopAction(s); }));
route('POST', '/api/equip', ctx => withPlayer(ctx.me, s => game.equip(s, str(ctx.body.item))));
route('POST', '/api/unequip', ctx => withPlayer(ctx.me, s => game.unequip(s, str(ctx.body.slot))));
route('POST', '/api/supplies', ctx => withPlayer(ctx.me, s => game.setSupply(s, str(ctx.body.item), ctx.body.on === true)));

// ---------- Raids and parties ----------
// A solo raid lives in the player's activity. A party raid lives on the party row (its
// session), and each member's activity points at the party. Either way, fights repeat
// until stopped, and are caught up whenever any pilot involved is loaded.
const memberIds = partyId => q('SELECT player_id FROM party_members WHERE party_id = ? ORDER BY joined').all(partyId).map(r => r.player_id);

function advanceParty(party, now, self) {
  const session = JSON.parse(party.session);
  const players = memberIds(party.id).map(id => {
    if (self && id === self.id) return self;
    const o = loadPlayer(id);
    if (o) o.gained = game.advance(o.state, now);
    return o;
  }).filter(Boolean);
  game.advanceRaid(session, players, now, Object.fromEntries(players.map(p => [p.id, p.gained])));
  players.forEach(p => { if (p !== self) savePlayer(p); });
  party.session = JSON.stringify(session);
  q('UPDATE parties SET session = ? WHERE id = ?').run(party.session, party.id);
  return session;
}

// Starts the current party fight over, for when someone joins or leaves mid-fight.
function restartParty(party) {
  const s = JSON.parse(party.session);
  Object.assign(s, { start: Date.now(), fight: null, n: (s.n || 0) + 1 });
  party.session = JSON.stringify(s);
  q('UPDATE parties SET session = ? WHERE id = ?').run(party.session, party.id);
}

// Ends a party's raid (members go idle). `self` is the already-loaded caller, saved by them.
function stopPartyRaid(party, self, disband) {
  for (const id of memberIds(party.id)) {
    const o = self && id === self.id ? self : loadPlayer(id);
    if (!o) continue;
    if (o !== self) game.advance(o.state, Date.now());
    if (o.state.activity && o.state.activity.type === 'party' && o.state.activity.party === party.id) o.state.activity = null;
    if (o !== self) savePlayer(o);
  }
  if (disband) {
    q('DELETE FROM party_members WHERE party_id = ?').run(party.id);
    q('DELETE FROM parties WHERE id = ?').run(party.id);
  } else {
    q('UPDATE parties SET session = NULL, created = ? WHERE id = ?').run(Date.now(), party.id);
  }
}

// Takes a freshly loaded player out of any raid: solo raids stop, party members leave,
// and a party leader stops the party's raid.
function leaveRaid(p) {
  const a = p.state.activity;
  if (a && a.type === 'raid') { p.state.activity = null; return; }
  const m = q('SELECT party_id FROM party_members WHERE player_id = ?').get(p.id);
  const party = m && q('SELECT * FROM parties WHERE id = ?').get(m.party_id);
  if (party && party.session) {
    if (party.leader_id === p.id) stopPartyRaid(party, p, false);
    else leaveParty(p, party);
  }
  if (p.state.activity && p.state.activity.type) p.state.activity = null;
}

function leaveParty(p, party) {
  if (party.leader_id === p.id) return stopPartyRaid(party, p, true);
  q('DELETE FROM party_members WHERE player_id = ?').run(p.id);
  if (p.state.activity && p.state.activity.type === 'party') p.state.activity = null;
  if (party.session) restartParty(party);
}

function purgeParties() {
  const old = q('SELECT id FROM parties WHERE session IS NULL AND created < ?').all(Date.now() - PARTY_TTL);
  old.forEach(p => {
    q('DELETE FROM party_members WHERE party_id = ?').run(p.id);
    q('DELETE FROM parties WHERE id = ?').run(p.id);
  });
}

function partyView(party) {
  return {
    id: party.id, raid: party.raid, diff: party.diff || 'normal', visibility: party.visibility || 'friends', leader: party.leader_id, created: party.created, expires: party.created + PARTY_TTL,
    members: memberIds(party.id).map(pubById).filter(Boolean),
    running: party.session ? game.sessionSummary(JSON.parse(party.session)) : null,
  };
}

// visibility: private (nobody else), friends (friends and guildmates) or public (anyone).
const VISIBILITY = ['private', 'friends', 'public'];
function canJoin(me, party) {
  if (party.leader_id === me) return true;
  if (party.visibility === 'private') return false;
  if (party.visibility === 'public') return true;
  if (friendIds(me).includes(party.leader_id)) return true;
  const mine = q('SELECT guild_id FROM players WHERE id = ?').get(me).guild_id;
  return !!mine && q('SELECT guild_id FROM players WHERE id = ?').get(party.leader_id).guild_id === mine;
}

route('GET', '/api/raids', ctx => {
  purgeParties();
  const mine = q('SELECT party_id FROM party_members WHERE player_id = ?').get(ctx.me);
  const open = q('SELECT * FROM parties ORDER BY created DESC').all()
    .filter(p => (!mine || p.id !== mine.party_id) && canJoin(ctx.me, p))
    .map(partyView)
    .filter(p => p.members.length < G.PARTY_MAX);
  return { party: mine ? partyView(q('SELECT * FROM parties WHERE id = ?').get(mine.party_id)) : null, open };
});

// The fight on screen right now, with its full timeline.
route('GET', '/api/raid/current', ctx => tx(() => {
  const p = fresh(ctx.me);
  savePlayer(p);
  const a = p.state.activity;
  let session = null, leader = null;
  if (a && a.type === 'raid') session = a;
  else if (a && a.type === 'party') {
    const party = q('SELECT session, leader_id FROM parties WHERE id = ?').get(a.party);
    session = party && party.session ? JSON.parse(party.session) : null;
    leader = party ? party.leader_id : null;
  }
  if (!session || !session.fight) return { current: null };
  let partyInfo = null;
  if (a.type === 'party') {
    const row = q('SELECT * FROM parties WHERE id = ?').get(a.party);
    if (row) partyInfo = partyView(row);
  }
  return { current: { ...game.sessionSummary(session), party: a.type === 'party', leader, partyInfo, fight: session.fight } };
}));

const diffOf = v => (G.DIFF_BY_ID[str(v)] ? str(v) : 'normal');
function requireUnlocked(state, raid, diff) {
  if (!game.raidUnlocked(state, raid.id, diff)) {
    bad(diff === 'normal' ? `Clear ${G.RAIDS[raid.n - 2].name} first.` : `Clear ${raid.name} on ${diff === 'heroic' ? 'Normal' : 'Heroic'} first.`);
  }
}

route('POST', '/api/raid/start', ctx => {
  const raid = G.RAID_BY_ID[str(ctx.body.raid)];
  if (!raid) bad('Unknown raid.');
  const diff = diffOf(ctx.body.diff);
  return withPlayer(ctx.me, (s, p) => {
    requireUnlocked(s, raid, diff);
    leaveRaid(p);
    const m = q('SELECT party_id FROM party_members WHERE player_id = ?').get(p.id);
    if (m) leaveParty(p, q('SELECT * FROM parties WHERE id = ?').get(m.party_id));
    s.activity = { type: 'raid', ...game.newSession(raid.id, diff, Date.now()) };
    game.advanceRaid(s.activity, [p], Date.now(), null);
  });
});

// Opens the raid you're in to others. A solo raid becomes a party raid (same fight carries on).
route('POST', '/api/raid/open', ctx => tx(() => {
  const visibility = str(ctx.body.visibility);
  if (!VISIBILITY.includes(visibility)) bad('Unknown setting.');
  const p = fresh(ctx.me);
  const a = p.state.activity;
  if (a && a.type === 'raid') {
    const now = Date.now();
    const session = { raid: a.raid, diff: a.diff || 'normal', start: a.start, n: a.n, fight: a.fight };
    const id = Number(q('INSERT INTO parties (leader_id, raid, diff, visibility, created, session) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ctx.me, a.raid, session.diff, visibility, now, JSON.stringify(session)).lastInsertRowid);
    q('INSERT INTO party_members (party_id, player_id, joined) VALUES (?, ?, ?)').run(id, ctx.me, now);
    p.state.activity = { type: 'party', party: id };
  } else {
    const m = q('SELECT party_id FROM party_members WHERE player_id = ?').get(ctx.me);
    const party = m && q('SELECT * FROM parties WHERE id = ?').get(m.party_id);
    if (!party) bad('You\u2019re not in a raid.');
    if (party.leader_id !== ctx.me) bad('Only the party leader can change who may join.');
    q('UPDATE parties SET visibility = ? WHERE id = ?').run(visibility, party.id);
  }
  savePlayer(p);
  return { state: clientState(p.state) };
}));

route('POST', '/api/party/kick', ctx => tx(() => {
  const m = q('SELECT party_id FROM party_members WHERE player_id = ?').get(ctx.me);
  const party = m && q('SELECT * FROM parties WHERE id = ?').get(m.party_id);
  if (!party || party.leader_id !== ctx.me) bad('Only the party leader can remove pilots.');
  const target = int(ctx.body.id);
  if (target === ctx.me || !memberIds(party.id).includes(target)) bad('That pilot isn\u2019t in your party.');
  if (party.session) advanceParty(party, Date.now(), null);
  const o = loadPlayer(target);
  q('DELETE FROM party_members WHERE player_id = ?').run(target);
  if (o && o.state.activity && o.state.activity.type === 'party' && o.state.activity.party === party.id) { o.state.activity = null; savePlayer(o); }
  if (party.session) restartParty(q('SELECT * FROM parties WHERE id = ?').get(party.id));
}));

route('POST', '/api/party/create', ctx => tx(() => {
  purgeParties();
  const raid = G.RAID_BY_ID[str(ctx.body.raid)];
  if (!raid) bad('Unknown raid.');
  const diff = diffOf(ctx.body.diff);
  const visibility = VISIBILITY.includes(str(ctx.body.visibility)) ? str(ctx.body.visibility) : 'friends';
  requireUnlocked(loadPlayer(ctx.me).state, raid, diff);
  if (q('SELECT 1 FROM party_members WHERE player_id = ?').get(ctx.me)) bad('Leave your current party first.');
  const now = Date.now();
  const id = Number(q('INSERT INTO parties (leader_id, raid, diff, visibility, created) VALUES (?, ?, ?, ?, ?)').run(ctx.me, raid.id, diff, visibility, now).lastInsertRowid);
  q('INSERT INTO party_members (party_id, player_id, joined) VALUES (?, ?, ?)').run(id, ctx.me, now);
}));

route('POST', '/api/party/join', ctx => tx(() => {
  purgeParties();
  const party = q('SELECT * FROM parties WHERE id = ?').get(int(ctx.body.id));
  if (!party) bad('That party has broken up.');
  if (!canJoin(ctx.me, party)) bad('That party isn\u2019t open to you.');
  if (q('SELECT 1 FROM party_members WHERE player_id = ?').get(ctx.me)) bad('Leave your current party first.');
  if (memberIds(party.id).length >= G.PARTY_MAX) bad('That party is full.');
  const p = fresh(ctx.me);
  if (party.session) leaveRaid(p);
  q('INSERT INTO party_members (party_id, player_id, joined) VALUES (?, ?, ?)').run(party.id, ctx.me, Date.now());
  if (party.session) {
    // Joining a raid that's already running puts you straight into its next fight.
    p.state.activity = { type: 'party', party: party.id };
    restartParty(party);
  }
  savePlayer(p);
}));

route('POST', '/api/party/leave', ctx => tx(() => {
  const m = q('SELECT party_id FROM party_members WHERE player_id = ?').get(ctx.me);
  if (!m) return;
  const p = fresh(ctx.me);
  leaveParty(p, q('SELECT * FROM parties WHERE id = ?').get(m.party_id));
  savePlayer(p);
  return { state: clientState(p.state) };
}));

route('POST', '/api/party/start', ctx => tx(() => {
  const m = q('SELECT party_id FROM party_members WHERE player_id = ?').get(ctx.me);
  const party = m && q('SELECT * FROM parties WHERE id = ?').get(m.party_id);
  if (!party) bad('You’re not in a party.');
  if (party.leader_id !== ctx.me) bad('Only the party leader can start the raid.');
  if (party.session) bad('The raid is already running.');
  const now = Date.now();
  // Every member switches from whatever they were doing to the party raid.
  const players = memberIds(party.id).map(fresh);
  players.forEach(p => {
    if (p.state.activity && p.state.activity.type === 'raid') p.state.activity = null;
    p.state.activity = { type: 'party', party: party.id };
  });
  const session = game.newSession(party.raid, party.diff || 'normal', now);
  game.advanceRaid(session, players, now, null);
  q('UPDATE parties SET session = ? WHERE id = ?').run(JSON.stringify(session), party.id);
  players.forEach(savePlayer);
  return { state: clientState(players.find(p => p.id === ctx.me).state) };
}));

route('POST', '/api/party/stop', ctx => tx(() => {
  const m = q('SELECT party_id FROM party_members WHERE player_id = ?').get(ctx.me);
  const party = m && q('SELECT * FROM parties WHERE id = ?').get(m.party_id);
  if (!party || !party.session) bad('Your party isn’t raiding.');
  if (party.leader_id !== ctx.me) bad('Only the party leader can stop the raid. You can leave instead.');
  const p = fresh(ctx.me);
  stopPartyRaid(party, p, false);
  savePlayer(p);
  return { state: clientState(p.state) };
}));

// ---------- Health ----------
// On Railway, data only survives redeploys when a volume is attached (RAILWAY_VOLUME_MOUNT_PATH)
// or DATA_DIR points somewhere persistent.
const onRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID);
const persistent = !onRailway || !!(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR);
route('GET', '/api/health', () => ({
  ok: true,
  persistentStorage: persistent,
  storage: persistent ? 'Saves are kept between deploys.' : 'WARNING: no volume attached. Every deploy wipes all accounts and progress.',
  pilots: q('SELECT COUNT(*) AS n FROM players').get().n,
}), false);

// ---------- Friends ----------
route('GET', '/api/social', ctx => {
  const me = ctx.me;
  return {
    friends: friendIds(me).map(pubById).filter(Boolean).sort((a, b) => b.online - a.online || a.name.localeCompare(b.name)),
    incoming: q(`SELECT a FROM friends WHERE b = ? AND status = 'pending' ORDER BY created`).all(me).map(r => pubById(r.a)).filter(Boolean),
    outgoing: q(`SELECT b FROM friends WHERE a = ? AND status = 'pending' ORDER BY created`).all(me).map(r => pubById(r.b)).filter(Boolean),
  };
});

route('POST', '/api/friends/add', ctx => tx(() => {
  const target = findByName(ctx.body.name);
  if (!target) bad('No pilot by that name.');
  if (target.id === ctx.me) bad('You can’t add yourself.');
  const existing = q('SELECT * FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').get(ctx.me, target.id, target.id, ctx.me);
  if (existing) {
    if (existing.status === 'pending' && existing.a === target.id) {
      q(`UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?`).run(target.id, ctx.me);
      return { ok: true, message: `You and ${target.name} are now friends.` };
    }
    bad(existing.status === 'accepted' ? `${target.name} is already your friend.` : `You’ve already sent ${target.name} a request.`);
  }
  if (friendIds(ctx.me).length >= FRIENDS_MAX) bad(`You can have up to ${FRIENDS_MAX} friends.`);
  q(`INSERT INTO friends (a, b, status, created) VALUES (?, ?, 'pending', ?)`).run(ctx.me, target.id, Date.now());
  return { ok: true, message: `Friend request sent to ${target.name}.` };
}));

route('POST', '/api/friends/accept', ctx => {
  const r = q(`UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ? AND status = 'pending'`).run(int(ctx.body.id), ctx.me);
  if (!r.changes) bad('That request is no longer there.');
});

route('POST', '/api/friends/remove', ctx => {
  const id = int(ctx.body.id);
  q('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').run(ctx.me, id, id, ctx.me);
});

// ---------- Guilds ----------
const RANK_ORDER = { leader: 0, officer: 1, member: 2 };
function guildMembers(guild) {
  return q(`SELECT p.id, p.name, p.mech, p.colour, p.total_level, p.power, p.last_seen, p.combat_level, p.activity, p.guild_rank, g.tag
    FROM players p LEFT JOIN guilds g ON g.id = p.guild_id WHERE p.guild_id = ? ORDER BY p.guild_joined`).all(guild.id)
    .map(row => ({
      ...pub(row), combat: row.combat_level, activity: row.activity || 'Idle',
      rank: row.id === guild.leader_id ? 'leader' : row.guild_rank === 'officer' ? 'officer' : 'member',
    }))
    .sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank] || b.online - a.online || b.combat - a.combat);
}

route('GET', '/api/guild', ctx => {
  const me = q('SELECT guild_id FROM players WHERE id = ?').get(ctx.me);
  if (!me.guild_id) {
    const guilds = q(`SELECT g.id, g.name, g.tag, COUNT(p.id) AS members, COALESCE(SUM(p.total_level), 0) AS level
      FROM guilds g LEFT JOIN players p ON p.guild_id = g.id GROUP BY g.id ORDER BY level DESC LIMIT 50`).all();
    return { guild: null, guilds };
  }
  const g = q('SELECT * FROM guilds WHERE id = ?').get(me.guild_id);
  const chat = q('SELECT id, player_id, name, text, at FROM guild_chat WHERE guild_id = ? ORDER BY id DESC LIMIT 50').all(g.id).reverse();
  const members = guildMembers(g);
  return { guild: { id: g.id, name: g.name, tag: g.tag, leader: g.leader_id, created: g.created, max: GUILD_MAX }, members, myRank: members.find(m => m.id === ctx.me).rank, chat };
});

route('POST', '/api/guild/create', ctx => {
  const name = str(ctx.body.name).trim().replace(/\s+/g, ' ');
  const tag = str(ctx.body.tag).trim().toUpperCase();
  if (!/^[A-Za-z0-9 '-]{3,24}$/.test(name)) bad('Guild names are 3 to 24 letters, numbers, spaces, \' or -.');
  if (!/^[A-Z0-9]{2,4}$/.test(tag)) bad('Tags are 2 to 4 letters or numbers.');
  return withPlayer(ctx.me, (s, p) => {
    if (p.guild_id) bad('Leave your current guild first.');
    if (q('SELECT 1 FROM guilds WHERE name_key = ?').get(name.toLowerCase())) bad('A guild with that name already exists.');
    if (q('SELECT 1 FROM guilds WHERE tag = ?').get(tag)) bad('That tag is taken.');
    if ((s.items.gold || 0) < G.GUILD_COST) bad(`Founding a guild costs ${G.GUILD_COST} gold.`);
    game.addItems(s.items, { gold: G.GUILD_COST }, -1);
    const now = Date.now();
    const id = Number(q('INSERT INTO guilds (name, name_key, tag, leader_id, created) VALUES (?, ?, ?, ?, ?)').run(name, name.toLowerCase(), tag, ctx.me, now).lastInsertRowid);
    q('UPDATE players SET guild_id = ?, guild_joined = ? WHERE id = ?').run(id, now, ctx.me);
  });
});

route('POST', '/api/guild/join', ctx => tx(() => {
  const me = q('SELECT guild_id FROM players WHERE id = ?').get(ctx.me);
  if (me.guild_id) bad('Leave your current guild first.');
  const g = q('SELECT id FROM guilds WHERE id = ?').get(int(ctx.body.id));
  if (!g) bad('That guild no longer exists.');
  if (q('SELECT COUNT(*) AS n FROM players WHERE guild_id = ?').get(g.id).n >= GUILD_MAX) bad('That guild is full.');
  q('UPDATE players SET guild_id = ?, guild_joined = ? WHERE id = ?').run(g.id, Date.now(), ctx.me);
}));

function removeFromGuild(playerId, guildId) {
  q('UPDATE players SET guild_id = NULL, guild_joined = NULL, guild_rank = NULL WHERE id = ?').run(playerId);
  const g = q('SELECT leader_id FROM guilds WHERE id = ?').get(guildId);
  if (!g || g.leader_id !== playerId) return;
  // The longest-serving member takes over, or the guild closes if nobody is left.
  const next = q(`SELECT id FROM players WHERE guild_id = ? ORDER BY CASE guild_rank WHEN 'officer' THEN 0 ELSE 1 END, guild_joined LIMIT 1`).get(guildId);
  if (next) {
    q('UPDATE guilds SET leader_id = ? WHERE id = ?').run(next.id, guildId);
    q('UPDATE players SET guild_rank = NULL WHERE id = ?').run(next.id);
  } else {
    q('DELETE FROM guild_chat WHERE guild_id = ?').run(guildId);
    q('DELETE FROM guilds WHERE id = ?').run(guildId);
  }
}

route('POST', '/api/guild/leave', ctx => tx(() => {
  const me = q('SELECT guild_id FROM players WHERE id = ?').get(ctx.me);
  if (me.guild_id) removeFromGuild(ctx.me, me.guild_id);
}));

function myGuild(me) {
  const row = q('SELECT guild_id, guild_rank FROM players WHERE id = ?').get(me);
  const g = row.guild_id && q('SELECT * FROM guilds WHERE id = ?').get(row.guild_id);
  if (!g) bad('You’re not in a guild.');
  return { g, rank: g.leader_id === me ? 'leader' : row.guild_rank === 'officer' ? 'officer' : 'member' };
}

route('POST', '/api/guild/kick', ctx => tx(() => {
  const { g, rank } = myGuild(ctx.me);
  const target = q('SELECT id, guild_id, guild_rank FROM players WHERE id = ?').get(int(ctx.body.id));
  if (!target || target.guild_id !== g.id || target.id === ctx.me || target.id === g.leader_id) bad('That pilot isn’t someone you can remove.');
  if (rank === 'member' || (rank === 'officer' && target.guild_rank === 'officer')) bad('Officers can remove members; only the leader can remove officers.');
  removeFromGuild(target.id, g.id);
}));

route('POST', '/api/guild/rank', ctx => tx(() => {
  const { g, rank } = myGuild(ctx.me);
  if (rank !== 'leader') bad('Only the guild leader can change ranks.');
  const target = q('SELECT id, guild_id FROM players WHERE id = ?').get(int(ctx.body.id));
  if (!target || target.guild_id !== g.id || target.id === ctx.me) bad('That pilot isn’t in your guild.');
  const next = str(ctx.body.rank);
  if (next === 'leader') {
    q('UPDATE guilds SET leader_id = ? WHERE id = ?').run(target.id, g.id);
    q("UPDATE players SET guild_rank = 'officer' WHERE id = ?").run(ctx.me);
    q('UPDATE players SET guild_rank = NULL WHERE id = ?').run(target.id);
  } else if (next === 'officer' || next === 'member') {
    q('UPDATE players SET guild_rank = ? WHERE id = ?').run(next === 'officer' ? 'officer' : null, target.id);
  } else bad('Unknown rank.');
}));

route('POST', '/api/guild/chat', ctx => {
  const text = str(ctx.body.text).trim().replace(/\s+/g, ' ');
  if (!text || text.length > 200) bad('Messages are 1 to 200 characters.');
  limit('chat:' + ctx.me, 5, 5e3);
  const me = q('SELECT name, guild_id FROM players WHERE id = ?').get(ctx.me);
  if (!me.guild_id) bad('You’re not in a guild.');
  q('INSERT INTO guild_chat (guild_id, player_id, name, text, at) VALUES (?, ?, ?, ?, ?)').run(me.guild_id, ctx.me, me.name, text, Date.now());
  q('DELETE FROM guild_chat WHERE guild_id = ? AND id <= (SELECT id FROM guild_chat WHERE guild_id = ? ORDER BY id DESC LIMIT 1 OFFSET 200)').run(me.guild_id, me.guild_id);
});

// ---------- Trading ----------
function itemMap(v, label) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad(`Invalid ${label}.`);
  const out = {};
  const entries = Object.entries(v);
  if (entries.length > 8) bad('Trades can include up to 8 kinds of item on each side.');
  for (const [id, n] of entries) {
    if (!G.ITEMS[id]) bad('Unknown item in trade.');
    if (!Number.isInteger(n) || n < 1 || n > 1e9) bad('Item amounts must be whole numbers above zero.');
    out[id] = n;
  }
  return out;
}

function tradeView(t) {
  return {
    id: t.id, from: pubById(t.from_id), to: pubById(t.to_id), give: JSON.parse(t.give), want: JSON.parse(t.want),
    status: t.status, created: t.created, updated: t.updated,
  };
}

route('GET', '/api/trades', ctx => ({
  incoming: q(`SELECT * FROM trades WHERE to_id = ? AND status = 'open' ORDER BY created DESC`).all(ctx.me).map(tradeView),
  outgoing: q(`SELECT * FROM trades WHERE from_id = ? AND status = 'open' ORDER BY created DESC`).all(ctx.me).map(tradeView),
  history: q(`SELECT * FROM trades WHERE (from_id = ? OR to_id = ?) AND status != 'open' ORDER BY updated DESC LIMIT 10`).all(ctx.me, ctx.me).map(tradeView),
}));

route('POST', '/api/trade/create', ctx => {
  const target = findByName(ctx.body.to);
  if (!target) bad('No pilot by that name.');
  if (target.id === ctx.me) bad('You can’t trade with yourself.');
  const give = itemMap(ctx.body.give, 'offer');
  const want = itemMap(ctx.body.want || {}, 'request');
  if (!Object.keys(give).length) bad('Add at least one item to offer.');
  return withPlayer(ctx.me, s => {
    if (q(`SELECT COUNT(*) AS n FROM trades WHERE from_id = ? AND status = 'open'`).get(ctx.me).n >= OPEN_TRADES_MAX) bad(`You can have up to ${OPEN_TRADES_MAX} open offers.`);
    if (!game.hasItems(s.items, give)) bad('You don’t have everything you’re offering.');
    // Offered items are held by the trade until it's accepted, declined or cancelled.
    game.addItems(s.items, give, -1);
    const now = Date.now();
    q(`INSERT INTO trades (from_id, to_id, give, want, status, created, updated) VALUES (?, ?, ?, ?, 'open', ?, ?)`)
      .run(ctx.me, target.id, JSON.stringify(give), JSON.stringify(want), now, now);
  });
});

function closeTrade(ctx, check, status) {
  return tx(() => {
    const t = q(`SELECT * FROM trades WHERE id = ? AND status = 'open'`).get(int(ctx.body.id));
    if (!t || !check(t)) bad('That offer is no longer open.');
    const sender = fresh(t.from_id);
    const give = JSON.parse(t.give);
    const want = JSON.parse(t.want);
    if (status === 'accepted') {
      const me = fresh(ctx.me);
      if (!game.hasItems(me.state.items, want)) bad('You don’t have everything they asked for.');
      game.addItems(me.state.items, want, -1);
      game.addItems(me.state.items, give);
      game.addItems(sender.state.items, want);
      savePlayer(me);
    } else {
      game.addItems(sender.state.items, give);
    }
    savePlayer(sender);
    q('UPDATE trades SET status = ?, updated = ? WHERE id = ?').run(status, Date.now(), t.id);
  });
}

route('POST', '/api/trade/accept', ctx => closeTrade(ctx, t => t.to_id === ctx.me, 'accepted'));
route('POST', '/api/trade/decline', ctx => closeTrade(ctx, t => t.to_id === ctx.me, 'declined'));
route('POST', '/api/trade/cancel', ctx => closeTrade(ctx, t => t.from_id === ctx.me, 'cancelled'));

// ---------- Static files ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

const zlib = require('node:zlib');
const gzCache = new Map();
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding', ...SECURITY_HEADERS };
    let body = data;
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && /\.(js|css|html|svg|json)$/.test(file)) {
      // Compressed copies are cached per file version (size and content hash).
      const key = `${file}:${data.length}:${sha(data.toString('latin1')).slice(0, 12)}`;
      if (!gzCache.has(key)) gzCache.set(key, zlib.gzipSync(data, { level: 9 }));
      body = gzCache.get(key);
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e instanceof HttpError) send(res, e.status, { error: e.message });
    else if (e instanceof game.GameError) send(res, 400, { error: e.message });
    else {
      console.error(e);
      send(res, 500, { error: 'Something went wrong on the server.' });
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MekaIdle listening on port ${PORT}, data in ${DATA_DIR}`);
  if (!persistent) console.warn('WARNING: no Railway volume attached. The database will be wiped on the next deploy. Attach a volume to this service.');
});
