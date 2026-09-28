// Game content and formulas, shared by the server (require) and the browser (window.GAME).
(function (root) {
  'use strict';

  const MAX_LEVEL = 99;
  const OFFLINE_CAP = 12 * 3600 * 1000; // ms of offline progress granted
  const BASE_STATS = { atk: 5, def: 2, hp: 100 };

  // Total XP needed to reach a level.
  const xpForLevel = l => (l <= 1 ? 0 : Math.floor(30 * (l - 1) + 6 * Math.pow(l - 1, 2.4)));
  function levelFromXp(xp) {
    let l = 1;
    while (l < MAX_LEVEL && xp >= xpForLevel(l + 1)) l++;
    return l;
  }
  // Each level of a combat skill adds 1% to its damage or healing.
  const skillMult = level => 1 + (level - 1) / 100;

  // ---------- Tiers ----------
  // One row per tier, naming what each gathering skill finds at that tier.
  const TIERS = [
    { n: 1, id: 'iron', level: 1, mult: 1, colour: '#b4bcc6', metal: 'Iron', ore: 'Iron ore', vein: 'Iron vein',
      beast: 'Boar', hide: 'Boar hide', bone: 'Boar tusk', leather: 'Boarhide', bow: 'Tusk',
      grove: 'Ash grove', branch: 'Ash branch', fibre: 'Flax', wood: 'Ash', cloth: 'Linen',
      herb: 'Mendleaf', order: 'Acolyte’s' },
    { n: 2, id: 'titanium', level: 15, mult: 2.2, colour: '#e8edf3', metal: 'Titanium', ore: 'Titanium ore', vein: 'Titanium vein',
      beast: 'Dire wolf', hide: 'Wolf pelt', bone: 'Wolf fang', leather: 'Wolfhide', bow: 'Fang',
      grove: 'Yew thicket', branch: 'Yew branch', fibre: 'Silkweed', wood: 'Yew', cloth: 'Silk',
      herb: 'Sunpetal', order: 'Cleric’s' },
    { n: 3, id: 'cobalt', level: 30, mult: 4, colour: '#5b9bff', metal: 'Cobalt', ore: 'Cobalt ore', vein: 'Cobalt vein',
      beast: 'Rock drake', hide: 'Drake hide', bone: 'Drake horn', leather: 'Drakehide', bow: 'Horn',
      grove: 'Elder wood', branch: 'Elder branch', fibre: 'Moonthread', wood: 'Elder', cloth: 'Moonweave',
      herb: 'Frostmoss', order: 'Bishop’s' },
    { n: 4, id: 'iridium', level: 45, mult: 6.8, colour: '#c87bff', metal: 'Iridium', ore: 'Iridium ore', vein: 'Iridium vein',
      beast: 'Storm wyvern', hide: 'Wyvern hide', bone: 'Wyvern talon', leather: 'Wyvernhide', bow: 'Talon',
      grove: 'Starwood grove', branch: 'Starwood branch', fibre: 'Starsilk', wood: 'Starwood', cloth: 'Starsilk',
      herb: 'Starlily', order: 'Saint’s' },
    { n: 5, id: 'void', level: 60, mult: 11, colour: '#2ee6b6', metal: 'Voidsteel', ore: 'Void crystal', vein: 'Void rift',
      beast: 'Void beast', hide: 'Void hide', bone: 'Void horn', leather: 'Voidhide', bow: 'Void',
      grove: 'Voidwood', branch: 'Voidwood branch', fibre: 'Voidsilk', wood: 'Voidwood', cloth: 'Voidsilk',
      herb: 'Voidroot', order: 'Seraph’s' },
  ];

  // ---------- Skills ----------
  // Every combat skill has one gathering skill feeding two artisan skills.
  const SKILLS = [
    { id: 'mining', name: 'Mining', group: 'gathering', chain: 'melee', desc: 'Mine ore for Smithing and Armoursmithing.' },
    { id: 'hunting', name: 'Hunting', group: 'gathering', chain: 'ranged', desc: 'Hunt beasts for hides and bone, for Fletching and Leatherworking.' },
    { id: 'foraging', name: 'Foraging', group: 'gathering', chain: 'magic', desc: 'Forage enchanted groves for branches and fibre, for Enchanting and Tailoring.' },
    { id: 'herbalism', name: 'Herbalism', group: 'gathering', chain: 'healing', desc: 'Gather herbs and reeds for Scribing and Alchemy.' },
    { id: 'smithing', name: 'Smithing', group: 'artisan', chain: 'melee', desc: 'Forge swords, greatswords and bulwarks from ore.' },
    { id: 'armoursmithing', name: 'Armoursmithing', group: 'artisan', chain: 'melee', desc: 'Forge heavy plate armour from ore. Three plate pieces: +10% defence and hull.' },
    { id: 'fletching', name: 'Fletching', group: 'artisan', chain: 'ranged', desc: 'Make shortbows, longbows and crossbows from bone and hide.' },
    { id: 'leatherworking', name: 'Leatherworking', group: 'artisan', chain: 'ranged', desc: 'Stitch leather armour from hides. Three leather pieces: +8% critical chance and +6% hull.' },
    { id: 'enchanting', name: 'Enchanting', group: 'artisan', chain: 'magic', desc: 'Enchant wands, staves and orbs, and bind raid materials into sigils.' },
    { id: 'tailoring', name: 'Tailoring', group: 'artisan', chain: 'magic', desc: 'Weave cloth armour. Three cloth pieces: +10% damage and healing.' },
    { id: 'scribing', name: 'Scribing', group: 'artisan', chain: 'healing', desc: 'Write the holy scrolls, tomes and codices that healers fight with.' },
    { id: 'alchemy', name: 'Alchemy', group: 'artisan', chain: 'healing', desc: 'Brew healing potions and tonics that anyone can take into a raid.' },
    { id: 'melee', name: 'Melee', group: 'combat', role: 'melee', desc: 'Trained by fighting with a sword, greatsword or bulwark. Each level adds 1% melee damage.' },
    { id: 'ranged', name: 'Ranged', group: 'combat', role: 'ranged', desc: 'Trained by fighting with a bow or crossbow. Each level adds 1% ranged damage.' },
    { id: 'magic', name: 'Magic', group: 'combat', role: 'magic', desc: 'Trained by fighting with a wand, staff or orb. Each level adds 1% magic damage.' },
    { id: 'healing', name: 'Healing', group: 'combat', role: 'healer', desc: 'Trained by fighting with a scroll, tome or codex. Each level adds 1% healing and smite damage.' },
  ];
  const SKILL_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));
  const COMBAT_SKILLS = SKILLS.filter(s => s.group === 'combat').map(s => s.id);
  const combatLevel = levels => COMBAT_SKILLS.reduce((a, k) => a + ((levels && levels[k]) || 1), 0);

  // ---------- Combat classes and weapons ----------
  // Bosses resist or are weak to melee, ranged and magic. Healers smite with holy damage.
  const STYLES = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic', holy: 'Holy' };
  const ROLES = {
    melee: { id: 'melee', name: 'Melee', colour: '#ef5a45', style: 'melee' },
    ranged: { id: 'ranged', name: 'Ranged', colour: '#f2c14e', style: 'ranged' },
    magic: { id: 'magic', name: 'Magic', colour: '#b66cf0', style: 'magic' },
    healer: { id: 'healer', name: 'Healer', colour: '#3ddc84', style: 'holy' },
  };

  // cast: ms per action. Hits are normalised so every damage weapon averages the same damage
  // per second before skills, gear and boss weaknesses; they differ in rhythm, crits and effects.
  const WEAPON_KINDS = [
    { id: 'sword', noun: 'sword', role: 'melee', stance: 'dps', skill: 'melee', maker: 'smithing', cast: 1000, action: 'Slash', dtype: 'Slash', crit: 0.1, spread: 0.15, mats: { ore: 5 }, offset: 0,
      note: 'Quick, steady slashes.' },
    { id: 'greatsword', noun: 'greatsword', role: 'melee', stance: 'dps', skill: 'melee', maker: 'smithing', cast: 2000, action: 'Cleave', dtype: 'Cleave', crit: 0.15, critMult: 2.4, spread: 0.15, mats: { ore: 8 }, offset: 2,
      note: 'Slow cleaves. Critical hits deal 2.4× instead of 1.75×.' },
    { id: 'bulwark', noun: 'bulwark', role: 'melee', stance: 'tank', skill: 'melee', maker: 'smithing', cast: 1400, action: 'Shield bash', dtype: 'Bash', crit: 0.05, spread: 0.1, dmg: 0.55, defMult: 1.6, hpMult: 1.3, mats: { ore: 7 }, offset: 4,
      note: 'Tank: the boss aims every normal attack at you. +60% defence, +30% hull, about half damage.' },
    { id: 'shortbow', noun: 'shortbow', role: 'ranged', stance: 'dps', skill: 'ranged', maker: 'fletching', cast: 1000, action: 'Quick shot', dtype: 'Pierce', crit: 0.12, spread: 0.12, mats: { bone: 4 }, offset: 0,
      note: 'Fast arrows.' },
    { id: 'longbow', noun: 'longbow', role: 'ranged', stance: 'dps', skill: 'ranged', maker: 'fletching', cast: 2000, action: 'Aimed shot', dtype: 'Pierce', crit: 0.3, spread: 0.12, mats: { bone: 6, hide: 1 }, offset: 2,
      note: 'Slow aimed shots with a 30% critical chance.' },
    { id: 'crossbow', noun: 'crossbow', role: 'ranged', stance: 'dps', skill: 'ranged', maker: 'fletching', cast: 1600, action: 'Heavy bolt', dtype: 'Bolt', crit: 0.08, spread: 0.1, pierce: 0.5, dmg: 0.9, mats: { bone: 5, hide: 2 }, offset: 4,
      note: 'Bolts ignore half of the boss’s defence. Best against armoured bosses.' },
    { id: 'wand', noun: 'wand', role: 'magic', stance: 'dps', skill: 'magic', maker: 'enchanting', cast: 1000, action: 'Arcane bolt', dtype: 'Arcane', crit: 0.1, spread: 0.15, mats: { branch: 3, fibre: 1 }, offset: 0,
      note: 'Rapid arcane bolts.' },
    { id: 'staff', noun: 'staff', role: 'magic', stance: 'dps', skill: 'magic', maker: 'enchanting', cast: 2200, action: 'Fireball', dtype: 'Fire', crit: 0.08, spread: 0.25, burn: 0.35, mats: { branch: 7 }, offset: 4,
      note: 'Fireballs that leave the boss burning for a third of the damage over 3 seconds.' },
    { id: 'orb', noun: 'orb', role: 'magic', stance: 'dps', skill: 'magic', maker: 'enchanting', cast: 1600, action: 'Arcane pulse', dtype: 'Arcane', crit: 0.12, spread: 0.15, surge: 4, mats: { branch: 4, fibre: 2 }, offset: 2,
      note: 'Every 4th pulse surges for double damage.' },
    { id: 'scroll', noun: 'scroll', role: 'healer', stance: 'heal', skill: 'healing', maker: 'scribing', cast: 1000, action: 'Quick mend', dtype: 'Holy', crit: 0.05, spread: 0.1, mats: { reed: 3, herb: 1 }, offset: 0,
      note: 'Small, fast heals.' },
    { id: 'tome', noun: 'tome', role: 'healer', stance: 'heal', skill: 'healing', maker: 'scribing', cast: 2000, action: 'Greater mend', dtype: 'Holy', crit: 0.05, spread: 0.1, mats: { reed: 5, herb: 2 }, offset: 2,
      note: 'Big heals on the most hurt pilot.' },
    { id: 'codex', noun: 'codex', role: 'healer', stance: 'heal', skill: 'healing', maker: 'scribing', cast: 2000, action: 'Prayer of mending', dtype: 'Holy', crit: 0.05, spread: 0.1, group: 0.5, mats: { reed: 6, herb: 3 }, offset: 4,
      note: 'Heals the whole party at once, each for half as much. Best in groups.' },
  ];
  const WEAPON_BY_ID = Object.fromEntries(WEAPON_KINDS.map(w => [w.id, w]));
  // Healers smite when everyone is healthy. Strong enough to clear content solo, slowly.
  const HEALER = { smiteAt: 0.8, smite: 0.65, smiteCast: 1200 };

  // ---------- Armour ----------
  const SLOTS = [
    { id: 'weapon', name: 'Weapon' },
    { id: 'head', name: 'Head' },
    { id: 'body', name: 'Body' },
    { id: 'legs', name: 'Legs' },
    { id: 'trinket', name: 'Trinket' },
  ];
  const ARMOUR_SLOTS = ['head', 'body', 'legs'];
  // Stats per piece at tier 1. Every type has about the same defence and hull, so every class can
  // solo; plate adds a little defence and its set bonus, leather adds critical chance, cloth power.
  const ARMOUR_TYPES = {
    plate: { name: 'Plate', maker: 'armoursmithing', mat: 'ore', bonus: { name: 'Fortified', defPct: 10, hpPct: 10 },
      pieces: { head: { noun: 'helm', def: 4, hp: 12, mats: 4, offset: 0 }, legs: { noun: 'greaves', def: 5, hp: 14, mats: 5, offset: 2 }, body: { noun: 'breastplate', def: 7, hp: 22, mats: 7, offset: 4 } } },
    leather: { name: 'Leather', maker: 'leatherworking', mat: 'hide', bonus: { name: 'Keen eye', crit: 8, hpPct: 6 },
      pieces: { head: { noun: 'hood', def: 3, hp: 12, crit: 2, mats: 3, offset: 0 }, legs: { noun: 'boots', def: 4, hp: 14, crit: 2, mats: 4, offset: 2 }, body: { noun: 'jerkin', def: 6, hp: 22, crit: 3, mats: 6, offset: 4 } } },
    cloth: { name: 'Cloth', maker: 'tailoring', mat: 'fibre', bonus: { name: 'Attuned', power: 10 },
      pieces: { head: { noun: 'hat', def: 3, hp: 12, power: 2, mats: 3, offset: 0 }, legs: { noun: 'trousers', def: 4, hp: 14, power: 3, mats: 4, offset: 2 }, body: { noun: 'robe', def: 6, hp: 22, power: 4, mats: 6, offset: 4 } } },
  };
  const tierLabel = (t, type) => (type === 'plate' ? t.metal : type === 'leather' ? t.leather : t.cloth);

  // ---------- Raids ----------
  // res: damage taken multiplier by style (above 1 is a weakness).
  const RAIDS = [
    { id: 'warden', tier: 1, name: 'The Warden', desc: 'A masked giant that guards the outer scrapyard. Its bone mask has never cracked.',
      mat: { id: 'servo_coil', name: 'Bone shard', colour: '#e8dcc0', icon: 'mat_warden' }, res: { magic: 1.12, melee: 0.9 },
      moves: { basic: 'Bone claw', sweep: 'Mask scream' }, dtype: 'Crush' },
    { id: 'hydra', tier: 2, name: 'Rust Hydra', desc: 'Three heads on one corroded body, all of them hungry.',
      mat: { id: 'hydraulic_heart', name: 'Hydra scale', colour: '#e5533d', icon: 'mat_hydra' }, res: { ranged: 1.12, magic: 0.9 },
      moves: { basic: 'Piston bite', sweep: 'Acid spray' }, dtype: 'Acid' },
    { id: 'colossus', tier: 3, name: 'Prism Colossus', desc: 'A floating crystal that focuses starlight into a cutting beam. Get close and it cracks.',
      mat: { id: 'graviton_core', name: 'Prism shard', colour: '#7aa8ff', icon: 'mat_colossus' }, res: { melee: 1.12, ranged: 0.9 },
      moves: { basic: 'Prism lance', sweep: 'Refraction' }, dtype: 'Light' },
    { id: 'sentinel', tier: 4, name: 'Storm Sentinel', desc: 'A great eye that rides the lightning down from orbit.',
      mat: { id: 'storm_capacitor', name: 'Storm core', colour: '#7fd8ff', icon: 'mat_sentinel' }, res: { magic: 1.12, ranged: 0.9 },
      moves: { basic: 'Arc bolt', sweep: 'Thunderstorm' }, dtype: 'Shock' },
    { id: 'titan', tier: 5, name: 'Void Titan', desc: 'Something vast, stepping out of the rift. The end of the line.',
      mat: { id: 'void_shard', name: 'Void shard', colour: '#2ee6b6', icon: 'mat_titan' }, res: { melee: 1.08, ranged: 1.08, magic: 0.92 },
      moves: { basic: 'Void lash', sweep: 'Collapse' }, dtype: 'Void' },
  ];
  const BOSS_MOVES = { basic: 2000, sweep: 3000, sweepEvery: 4, sweepShare: 0.6 };

  // Raid sets: three pieces (head, body, legs) that drop from one boss, with 2- and 3-piece bonuses.
  const PASSIVES = {
    thorns: v => `Thorns: reflects ${v}% of damage taken back at the boss.`,
    multishot: v => `Multishot: ${v}% chance for an attack to strike twice.`,
    prismatic: v => `Prismatic: critical hits also burn for ${v}% more over 3 seconds.`,
    overflow: v => `Overflow: overhealing becomes a shield, up to ${v}% of hull.`,
    lifesteal: v => `Lifesteal: heals you for ${v}% of the damage you deal.`,
    bleed: v => `Bleed: your hits bleed for ${v}% more over 3 seconds.`,
    surge: v => `Surge: ${v}% chance for a heal to be doubled.`,
  };
  const RAID_SETS = {
    warden: { name: 'Bonewarden', type: 'plate', two: { hpPct: 10 }, three: { passives: { thorns: 25 } } },
    hydra: { name: 'Hydrascale', type: 'leather', two: { crit: 5 }, three: { passives: { multishot: 20 } } },
    colossus: { name: 'Prismweave', type: 'cloth', two: { power: 8 }, three: { passives: { prismatic: 40 } } },
    sentinel: { name: 'Stormvestment', type: 'cloth', two: { heal: 12 }, three: { passives: { overflow: 30 } } },
    titan: { name: 'Voidforged', type: 'plate', two: { power: 8, hpPct: 8 }, three: { passives: { lifesteal: 10 } } },
  };
  const RAID_TRINKETS = {
    warden: { name: 'Warden’s mask', stats: { hpPct: 8, defPct: 5 } },
    hydra: { name: 'Hydra fang', stats: { crit: 4 }, passives: { bleed: 10 } },
    colossus: { name: 'Prism heart', stats: { power: 10 } },
    sentinel: { name: 'Storm eye', stats: { heal: 10 }, passives: { surge: 10 } },
    titan: { name: 'Void heart', stats: { power: 6, defPct: 6, hpPct: 6 }, passives: { lifesteal: 5 } },
  };
  const SET_DROP = 0.04, TRINKET_DROP = 0.025;

  // ---------- Items ----------
  const ITEMS = {};
  const item = (id, o) => { ITEMS[id] = Object.assign({ id }, o); };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  const MAT_OF = { ore: t => `${t.id}_ore`, hide: t => `${t.id}_hide`, bone: t => `${t.id}_bone`, branch: t => `${t.id}_branch`, fibre: t => `${t.id}_fibre`, herb: t => `${t.id}_herb`, reed: () => 'reed' };

  item('gold', { name: 'Gold', type: 'resource', icon: 'gold', colour: '#f2c14e', desc: 'Raid bosses drop it. Founding a guild costs 500.' });
  item('reed', { name: 'Reed', type: 'resource', icon: 'reed', colour: '#c9d08a', desc: 'Gathered alongside herbs. Scribes press it into pages.' });
  TIERS.forEach(t => {
    const tierNote = `Tier ${t.n}.`;
    item(`${t.id}_ore`, { name: t.ore, type: 'resource', icon: 'ore', colour: t.colour, tier: t.n, desc: `${tierNote} Mined at Mining ${t.level}. Used by Smithing and Armoursmithing.` });
    item(`${t.id}_hide`, { name: t.hide, type: 'resource', icon: 'hide', colour: t.colour, tier: t.n, desc: `${tierNote} From hunting the ${t.beast.toLowerCase()} at Hunting ${t.level}. Used by Leatherworking and Fletching.` });
    item(`${t.id}_bone`, { name: t.bone, type: 'resource', icon: 'bone', colour: t.colour, tier: t.n, desc: `${tierNote} From hunting the ${t.beast.toLowerCase()} at Hunting ${t.level}. Used by Fletching.` });
    item(`${t.id}_branch`, { name: t.branch, type: 'resource', icon: 'branch', colour: t.colour, tier: t.n, desc: `${tierNote} Foraged at Foraging ${t.level}. Used by Enchanting.` });
    item(`${t.id}_fibre`, { name: t.fibre, type: 'resource', icon: 'fibre', colour: t.colour, tier: t.n, desc: `${tierNote} Foraged at Foraging ${t.level}. Used by Tailoring and Enchanting.` });
    item(`${t.id}_herb`, { name: t.herb, type: 'resource', icon: 'herb', colour: t.colour, tier: t.n, desc: `${tierNote} Gathered at Herbalism ${t.level}. Used by Scribing and Alchemy.` });
  });
  RAIDS.forEach(r => item(r.mat.id, { name: r.mat.name, type: 'material', icon: r.mat.icon, colour: r.mat.colour, tier: r.tier,
    desc: `Dropped by ${r.name}. Needed for ${r.tier < 5 ? `every tier ${r.tier + 1} weapon and armour piece, and ` : ''}the ${ROMAN[r.tier - 1]} sigil.` }));

  // Consumables from Alchemy.
  item('healing_potion', { name: 'Healing potion', type: 'consumable', icon: 'potion', colour: '#ef5a45', heal: 0.35, supply: true, desc: 'Drunk automatically in a fight when your hull drops below 40%. Restores 35%. Up to three potions per fight.' });
  item('greater_healing_potion', { name: 'Greater healing potion', type: 'consumable', icon: 'potion_big', colour: '#ff7aa2', heal: 0.6, supply: true, desc: 'Drunk before ordinary potions when your hull drops below 40%. Restores 60%.' });
  item('ironskin_tonic', { name: 'Ironskin tonic', type: 'consumable', icon: 'tonic_def', colour: '#b4bcc6', supply: true, boost: { def: 0.1 }, desc: 'Raid tonic: +10% defence for one fight.' });
  item('fury_tonic', { name: 'Fury tonic', type: 'consumable', icon: 'tonic_dmg', colour: '#ff6fb1', supply: true, boost: { dmg: 0.1 }, desc: 'Raid tonic: +10% damage and healing for one fight.' });
  item('vigour_tonic', { name: 'Vigour tonic', type: 'consumable', icon: 'tonic_hp', colour: '#3ddc84', supply: true, boost: { hp: 0.15 }, desc: 'Raid tonic: +15% hull for one fight.' });
  const BOOSTS = ['ironskin_tonic', 'fury_tonic', 'vigour_tonic'];
  const POTIONS = ['greater_healing_potion', 'healing_potion'];

  // Gear.
  TIERS.forEach(t => {
    WEAPON_KINDS.forEach(w => {
      const name = w.role === 'melee' ? `${t.metal} ${w.noun}` : w.role === 'ranged' ? `${t.bow} ${w.noun}` : w.role === 'magic' ? `${t.wood} ${w.noun}` : `${t.order} ${w.noun}`;
      item(`${t.id}_${w.id}`, { name, type: 'gear', slot: 'weapon', weapon: w.id, icon: w.id, colour: t.colour, tier: t.n, stats: { atk: Math.round(10 * t.mult) }, desc: `Tier ${t.n}. ${w.note}` });
    });
    Object.entries(ARMOUR_TYPES).forEach(([type, a]) => ARMOUR_SLOTS.forEach(slot => {
      const p = a.pieces[slot];
      const stats = { def: Math.round(p.def * t.mult), hp: Math.round(p.hp * t.mult) };
      if (p.crit) stats.crit = p.crit + (t.n - 1) * 0.5;
      if (p.power) stats.power = p.power + (t.n - 1);
      item(`${t.id}_${type}_${slot}`, { name: `${tierLabel(t, type)} ${p.noun}`, type: 'gear', slot, armour: type, icon: `${type}_${slot}`, colour: t.colour, tier: t.n, stats,
        desc: `Tier ${t.n} ${a.name.toLowerCase()} armour. Wear three ${a.name.toLowerCase()} pieces for ${a.bonus.name}.` });
    }));
  });
  // Sigils: trinkets bound from raid materials.
  RAIDS.forEach(r => item(`sigil_${r.tier}`, { name: `${r.mat.name.split(' ')[0]} sigil`, type: 'gear', slot: 'trinket', icon: 'sigil', colour: r.mat.colour, tier: r.tier,
    stats: { power: 4 * r.tier, hpPct: 4 * r.tier }, desc: `A trinket bound from ${r.mat.name.toLowerCase()}s. Crafted with Enchanting.` }));
  // Raid set pieces and trinkets: drops only, a little stronger than crafted gear of their tier.
  RAIDS.forEach(r => {
    const set = RAID_SETS[r.id];
    const t = TIERS[r.tier - 1];
    const a = ARMOUR_TYPES[set.type];
    ARMOUR_SLOTS.forEach(slot => {
      const p = a.pieces[slot];
      const stats = { def: Math.round(p.def * t.mult * 1.15), hp: Math.round(p.hp * t.mult * 1.15) };
      if (p.crit) stats.crit = p.crit + (t.n - 1) * 0.5 + 1;
      if (p.power) stats.power = p.power + t.n;
      item(`${r.id}_set_${slot}`, { name: `${set.name} ${p.noun}`, type: 'gear', slot, armour: set.type, set: r.id, icon: `${set.type}_${slot}`, colour: r.mat.colour, tier: r.tier, rare: true, stats,
        desc: `Raid set piece from ${r.name}. Counts as ${a.name.toLowerCase()} armour.` });
    });
    const tr = RAID_TRINKETS[r.id];
    item(`${r.id}_trinket`, { name: tr.name, type: 'gear', slot: 'trinket', icon: `trinket_${r.id}`, colour: r.mat.colour, tier: r.tier, rare: true, stats: tr.stats, passives: tr.passives,
      desc: `A rare trinket from ${r.name}.` });
  });

  // ---------- Actions ----------
  // outputs: { itemId: [min, max] }, chance: extra rolls, inputs consumed per action.
  const ACTIONS = [];
  const action = o => ACTIONS.push(Object.assign({ inputs: {}, chance: [] }, o));
  const GATHER_XP = [8, 16, 25, 36, 50];
  const CRAFT_XP = [6, 12, 19, 28, 40]; // per material used

  TIERS.forEach((t, i) => {
    action({ id: `mine_${t.id}`, skill: 'mining', name: t.vein, level: t.level, time: 3000, xp: GATHER_XP[i], item: `${t.id}_ore`, outputs: { [`${t.id}_ore`]: [1, 1] } });
    action({ id: `hunt_${t.id}`, skill: 'hunting', name: t.beast, level: t.level, time: 3500, xp: Math.round(GATHER_XP[i] * 1.2), item: `${t.id}_hide`, outputs: { [`${t.id}_hide`]: [1, 1], [`${t.id}_bone`]: [1, 1] } });
    action({ id: `forage_${t.id}`, skill: 'foraging', name: t.grove, level: t.level, time: 3500, xp: Math.round(GATHER_XP[i] * 1.2), item: `${t.id}_branch`, outputs: { [`${t.id}_branch`]: [1, 1], [`${t.id}_fibre`]: [1, 1] } });
    action({ id: `herb_${t.id}`, skill: 'herbalism', name: `${t.herb} patch`, level: t.level, time: 3000, xp: GATHER_XP[i], item: `${t.id}_herb`, outputs: { [`${t.id}_herb`]: [1, 1], reed: [1, 2] } });
  });

  const craftInputs = (t, i, mats, extra) => {
    const inputs = {};
    Object.entries(mats).forEach(([m, n]) => { inputs[MAT_OF[m](t)] = n; });
    if (i > 0) inputs[RAIDS[i - 1].mat.id] = 2 + t.n;
    return Object.assign(inputs, extra || {});
  };
  const matCount = mats => Object.values(mats).reduce((a, n) => a + n, 0);
  TIERS.forEach((t, i) => {
    WEAPON_KINDS.forEach(w => {
      const id = `${t.id}_${w.id}`;
      action({ id: `craft_${id}`, skill: w.maker, name: ITEMS[id].name, level: t.level + w.offset, time: 4000, xp: CRAFT_XP[i] * matCount(w.mats), item: id, inputs: craftInputs(t, i, w.mats), outputs: { [id]: [1, 1] } });
    });
    Object.entries(ARMOUR_TYPES).forEach(([type, a]) => ARMOUR_SLOTS.forEach(slot => {
      const p = a.pieces[slot];
      const id = `${t.id}_${type}_${slot}`;
      action({ id: `craft_${id}`, skill: a.maker, name: ITEMS[id].name, level: t.level + p.offset, time: 4000, xp: CRAFT_XP[i] * p.mats, item: id, inputs: craftInputs(t, i, { [a.mat]: p.mats }), outputs: { [id]: [1, 1] } });
    }));
  });
  RAIDS.forEach(r => {
    const t = TIERS[r.tier - 1];
    const id = `sigil_${r.tier}`;
    action({ id: `craft_${id}`, skill: 'enchanting', name: ITEMS[id].name, level: [10, 25, 40, 55, 70][r.tier - 1], time: 6000, xp: 60 * r.tier, item: id,
      inputs: { [r.mat.id]: 5, [`${t.id}_branch`]: 3, [`${t.id}_fibre`]: 3 }, outputs: { [id]: [1, 1] } });
  });
  [
    ['healing_potion', 1, { iron_herb: 2 }, 3000, 12],
    ['ironskin_tonic', 5, { iron_herb: 2, reed: 1 }, 3000, 15],
    ['fury_tonic', 15, { titanium_herb: 2, reed: 1 }, 3500, 28],
    ['greater_healing_potion', 30, { cobalt_herb: 2, reed: 2 }, 3500, 45],
    ['vigour_tonic', 45, { iridium_herb: 2, reed: 2 }, 4000, 60],
  ].forEach(([id, level, inputs, time, xp]) => action({ id: `brew_${id}`, skill: 'alchemy', name: ITEMS[id].name, level, time, xp, item: id, inputs, outputs: { [id]: [1, 1] } }));

  const ACTION_BY_ID = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

  // ---------- Mech stats ----------
  const STAT_LABELS = { atk: v => `+${v} damage/s`, def: v => `+${v} defence`, hp: v => `+${v} hull`, crit: v => `+${v}% crit`, power: v => `+${v}% power`, heal: v => `+${v}% healing`, defPct: v => `+${v}% defence`, hpPct: v => `+${v}% hull` };
  const describe = stats => Object.entries(stats || {}).filter(([k, v]) => STAT_LABELS[k] && typeof v === 'number').map(([k, v]) => STAT_LABELS[k](v)).join(', ');
  // levels: { skillId: level }. boosts: { dmg, def, hp } fractions from raid tonics.
  // Stat keys on gear: atk, def, hp (flat); crit, power, heal, defPct, hpPct (percent).
  function mechStats(equipment, levels, boosts) {
    const s = { ...BASE_STATS, crit: 0, power: 0, heal: 0, defPct: 0, hpPct: 0 };
    const passives = {};
    const types = {}, sets = {};
    const add = (stats, pas) => {
      Object.entries(stats || {}).forEach(([k, v]) => { if (typeof v === 'number') s[k] = (s[k] || 0) + v; });
      Object.entries(pas || {}).forEach(([k, v]) => { passives[k] = (passives[k] || 0) + v; });
    };
    Object.values(equipment || {}).forEach(id => {
      const it = id && ITEMS[id];
      if (!it) return;
      add(it.stats, it.passives);
      if (it.armour) types[it.armour] = (types[it.armour] || 0) + 1;
      if (it.set) sets[it.set] = (sets[it.set] || 0) + 1;
    });
    const bonuses = [];
    Object.entries(types).forEach(([type, n]) => {
      if (n >= 3) { add(ARMOUR_TYPES[type].bonus); bonuses.push(`${ARMOUR_TYPES[type].bonus.name} (3 ${type}): ${describe(ARMOUR_TYPES[type].bonus)}`); }
    });
    Object.entries(sets).forEach(([id, n]) => {
      const set = RAID_SETS[id];
      if (n >= 2) { add(set.two); bonuses.push(`${set.name} (2): ${describe(set.two)}`); }
      if (n >= 3) { add(set.three, set.three.passives); bonuses.push(`${set.name} (3): ${Object.keys(set.three.passives).map(k => k[0].toUpperCase() + k.slice(1)).join(', ')}`); }
    });
    const weapon = WEAPON_BY_ID[(ITEMS[equipment && equipment.weapon] || {}).weapon] || null;
    const lv = k => (levels && levels[k]) || 1;
    const b = boosts || {};
    const skill = weapon ? weapon.skill : 'melee';
    return {
      atk: Math.round(s.atk * (1 + s.power / 100) * skillMult(lv(skill)) * (1 + (b.dmg || 0))),
      def: Math.round(s.def * (1 + s.defPct / 100) * ((weapon && weapon.defMult) || 1) * (1 + (b.def || 0))),
      hp: Math.round(s.hp * (1 + s.hpPct / 100) * ((weapon && weapon.hpMult) || 1) * (1 + (b.hp || 0))),
      crit: s.crit / 100,
      heal: s.heal / 100,
      passives,
      bonuses,
      weapon: weapon ? weapon.id : null,
      role: weapon ? weapon.role : 'melee',
      stance: weapon ? weapon.stance : 'dps',
      skill,
    };
  }
  const power = s => Math.round(s.atk * 2 * (1 + (s.crit || 0)) + s.def * 2 + s.hp / 5);

  // Boss stats are set against a reference pilot: that tier's sword and full plate, the
  // previous sigil and Melee around the tier's level. That pilot wins roughly half the time
  // solo with no supplies; potions, tonics, better gear choices or a party make it safe.
  const FIGHT = { maxMs: 90000, killMs: 40000, deathMs: 36000, gapMs: 3000 };
  RAIDS.forEach(r => {
    const t = TIERS[r.tier - 1];
    const eq = { weapon: `${t.id}_sword`, head: `${t.id}_plate_head`, body: `${t.id}_plate_body`, legs: `${t.id}_plate_legs` };
    if (r.tier > 1) eq.trinket = `sigil_${r.tier - 1}`;
    const ref = mechStats(eq, { melee: t.level + 5 });
    const def = Math.round(10 * t.mult);
    r.boss = {
      def,
      hp: Math.round(ref.atk * 100 / (100 + def) * FIGHT.killMs / 1000 / 10) * 10,
      dps: Math.round(ref.hp * (100 + ref.def) / 100 / (FIGHT.deathMs / 1000) * 10) / 10,
    };
    r.recommended = power(ref);
    r.xp = [60, 150, 320, 600, 1000][r.tier - 1];
    r.drops = [
      { item: r.mat.id, qty: [2, 4] },
      { item: 'gold', qty: [10 * r.tier, 25 * r.tier] },
      ...ARMOUR_SLOTS.map(slot => ({ item: `${r.id}_set_${slot}`, qty: [1, 1], p: SET_DROP })),
      { item: `${r.id}_trinket`, qty: [1, 1], p: TRINKET_DROP },
    ];
  });
  const RAID_BY_ID = Object.fromEntries(RAIDS.map(r => [r.id, r]));

  const GAME = {
    MAX_LEVEL, OFFLINE_CAP, BASE_STATS, TIERS, STYLES, ROLES, WEAPON_KINDS, WEAPON_BY_ID, HEALER,
    SKILLS, SKILL_BY_ID, COMBAT_SKILLS, SLOTS, ARMOUR_SLOTS, ARMOUR_TYPES, RAIDS, RAID_BY_ID, RAID_SETS, RAID_TRINKETS, PASSIVES,
    BOSS_MOVES, FIGHT, ITEMS, BOOSTS, POTIONS, ACTIONS, ACTION_BY_ID,
    xpForLevel, levelFromXp, skillMult, mechStats, power, combatLevel,
    PARTY_MAX: 4, PARTY_HP_SCALE: 1, POTIONS_PER_RAID: 3, GUILD_COST: 500,
    PAINTS: ['#b66cf0', '#e5533d', '#e8b923', '#3fa7f5', '#57c46b', '#d9dde3'],
    ACCENTS: { '#b66cf0': '#8cff5a', '#e5533d': '#ffb13b', '#e8b923': '#3fa7f5', '#3fa7f5': '#f2f4f7', '#57c46b': '#ff8f3d', '#d9dde3': '#3fa7f5' },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = GAME;
  else root.GAME = GAME;
})(typeof window !== 'undefined' ? window : this);
