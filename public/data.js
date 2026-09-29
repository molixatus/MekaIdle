// Game content and formulas, shared by the server (require) and the browser (window.GAME).
// Most content is generated from the tables below, so a change to a table flows everywhere.
(function (root) {
  'use strict';

  const MAX_LEVEL = 99;
  const OFFLINE_CAP = 12 * 3600 * 1000; // ms of offline progress granted

  // Total XP needed to reach a level.
  const xpForLevel = l => (l <= 1 ? 0 : Math.floor(30 * (l - 1) + 6 * Math.pow(l - 1, 2.4)));
  function levelFromXp(xp) {
    let l = 1;
    while (l < MAX_LEVEL && xp >= xpForLevel(l + 1)) l++;
    return l;
  }
  // Each level of a combat skill adds 1% to its damage or healing.
  const skillMult = level => 1 + (level - 1) / 100;

  // Deterministic random numbers, so generated raids are the same on server and client.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Tiers ----------
  // Ten material tiers. Each row names what every gathering skill finds at that tier.
  const TIER_ROWS = [
    ['copper', 1, 'Copper', 'Copper ore', 'Boar', 'Boar hide', 'Boar tusk', 'Tusk', 'Ash', 'Flax', 'Linen', 'Mendleaf', 'Novice’s'],
    ['iron', 10, 'Iron', 'Iron ore', 'Dire wolf', 'Wolf pelt', 'Wolf fang', 'Fang', 'Yew', 'Silkweed', 'Silk', 'Sunpetal', 'Acolyte’s'],
    ['titanium', 20, 'Titanium', 'Titanium ore', 'Cave bear', 'Bear hide', 'Bear claw', 'Claw', 'Maple', 'Cotton', 'Cotton', 'Brightroot', 'Cleric’s'],
    ['cobalt', 30, 'Cobalt', 'Cobalt ore', 'Rock drake', 'Drake hide', 'Drake horn', 'Horn', 'Elder', 'Moonthread', 'Moonweave', 'Frostmoss', 'Priest’s'],
    ['mithril', 40, 'Mithril', 'Mithril ore', 'Basilisk', 'Basilisk hide', 'Basilisk spine', 'Spine', 'Ironwood', 'Spidersilk', 'Spidersilk', 'Ghostcap', 'Bishop’s'],
    ['adamant', 50, 'Adamant', 'Adamant ore', 'Manticore', 'Manticore hide', 'Manticore stinger', 'Stinger', 'Bloodwood', 'Embersilk', 'Embersilk', 'Bloodthorn', 'Abbot’s'],
    ['iridium', 60, 'Iridium', 'Iridium ore', 'Storm wyvern', 'Wyvern hide', 'Wyvern talon', 'Talon', 'Frostwood', 'Frostweave', 'Frostweave', 'Moonlily', 'Cardinal’s'],
    ['orichalcum', 70, 'Orichalcum', 'Orichalcum ore', 'Chimera', 'Chimera hide', 'Chimera horn', 'Chimera', 'Starwood', 'Starsilk', 'Starsilk', 'Starlily', 'Saint’s'],
    ['starmetal', 80, 'Starmetal', 'Starmetal ore', 'Behemoth', 'Behemoth hide', 'Behemoth tusk', 'Behemoth', 'Dreamwood', 'Dreamweave', 'Dreamweave', 'Dreambloom', 'Seraph’s'],
    ['void', 90, 'Voidsteel', 'Void crystal', 'Void beast', 'Void hide', 'Void horn', 'Void', 'Voidwood', 'Voidsilk', 'Voidsilk', 'Voidroot', 'Ascendant’s'],
  ];
  // Items are coloured by tier, like rarity colours: copper, steel, green, teal, blue, purple, pink, orange, gold, red.
  const TIER_COLOURS = ['#d08d5b', '#a9c1dd', '#5fd068', '#3fc1c9', '#4f8ff0', '#a86bff', '#ff6fb1', '#ff9a3c', '#ffd24a', '#ff4d4d'];
  const TIERS = TIER_ROWS.map(([id, level, metal, ore, beast, hide, bone, bow, wood, fibre, cloth, herb, order], i) => ({
    n: i + 1, id, level, mult: Math.pow(1.5, i), colour: TIER_COLOURS[i],
    metal, ore, vein: `${metal} vein`, beast, hide, bone, venom: `${beast} venom`, leather: `${hide.split(' ')[0]}hide`.replace('Wolfhide', 'Wolfhide'),
    bow, wood, branch: `${wood} branch`, grove: `${wood} grove`, fibre, cloth, essence: `${wood} essence`, herb, patch: `${herb} patch`, order,
  }));
  TIERS.forEach(t => { t.leather = t.hide.replace(/ (hide|pelt)$/, '') + 'hide'; });
  const TIER_BY_ID = Object.fromEntries(TIERS.map(t => [t.id, t]));

  // ---------- Classes ----------
  // Four classes, set by the main-hand weapon. They also colour the mech.
  const CLASSES = {
    melee: { id: 'melee', name: 'Melee', colour: '#ef5a45', accent: '#ffd08a', style: 'melee', skill: 'melee' },
    ranged: { id: 'ranged', name: 'Ranged', colour: '#e8b923', accent: '#6fd1ff', style: 'ranged', skill: 'ranged' },
    magic: { id: 'magic', name: 'Magic', colour: '#a86bff', accent: '#8cff5a', style: 'magic', skill: 'magic' },
    healer: { id: 'healer', name: 'Healer', colour: '#3ddc84', accent: '#fff3a1', style: 'holy', skill: 'healing' },
  };
  const ROLES = CLASSES; // older name, still used in places
  const CLASS_OF_SKILL = { melee: 'melee', ranged: 'ranged', magic: 'magic', healing: 'healer' };
  const UNARMED_COLOUR = '#8d95a5';

  // ---------- Skills ----------
  // Every combat skill has one gathering skill feeding three artisan skills.
  const SKILLS = [
    { id: 'mining', name: 'Mining', group: 'gathering', chain: 'melee', desc: 'Mine ore for Smithing, Armoursmithing and Honing.' },
    { id: 'hunting', name: 'Hunting', group: 'gathering', chain: 'ranged', desc: 'Hunt beasts for hide, bone and venom, for Fletching, Leatherworking and Poisoncraft.' },
    { id: 'foraging', name: 'Foraging', group: 'gathering', chain: 'magic', desc: 'Forage groves for wood, fibre and essence, for Enchanting, Tailoring and Runecrafting.' },
    { id: 'herbalism', name: 'Herbalism', group: 'gathering', chain: 'healing', desc: 'Gather herbs and reeds for Scribing, Weaving and Alchemy.' },
    { id: 'smithing', name: 'Smithing', group: 'artisan', chain: 'melee', desc: 'Forge swords, axes, maces, greatswords and shields.' },
    { id: 'armoursmithing', name: 'Armoursmithing', group: 'artisan', chain: 'melee', desc: 'Forge plate armour: heavy defence and HP.' },
    { id: 'honing', name: 'Honing', group: 'artisan', chain: 'melee', desc: 'Make whetstones and weapon oils: fight buffs for melee.' },
    { id: 'fletching', name: 'Fletching', group: 'artisan', chain: 'ranged', desc: 'Make shortbows, longbows, crossbows, throwing daggers and quivers.' },
    { id: 'leatherworking', name: 'Leatherworking', group: 'artisan', chain: 'ranged', desc: 'Stitch leather armour: balanced defence and critical chance.' },
    { id: 'poisoncraft', name: 'Poisoncraft', group: 'artisan', chain: 'ranged', desc: 'Brew poisons and barbed tips: fight buffs for ranged.' },
    { id: 'enchanting', name: 'Enchanting', group: 'artisan', chain: 'magic', desc: 'Enchant wands, staves, sceptres, frost crystals and orbs.' },
    { id: 'tailoring', name: 'Tailoring', group: 'artisan', chain: 'magic', desc: 'Weave cloth armour: magic resistance and power.' },
    { id: 'runecrafting', name: 'Runecrafting', group: 'artisan', chain: 'magic', desc: 'Carve runes (fight buffs for magic) and sigils (trinkets anyone can wear).' },
    { id: 'scribing', name: 'Scribing', group: 'artisan', chain: 'healing', desc: 'Write the scrolls, tomes, codices and lanterns healers fight with, and holy relics.' },
    { id: 'weaving', name: 'Weaving', group: 'artisan', chain: 'healing', desc: 'Weave reed vestments: armour for healers, with healing and mana regeneration.' },
    { id: 'alchemy', name: 'Alchemy', group: 'artisan', chain: 'healing', desc: 'Brew health and mana potions and tonics that any class can use.' },
    { id: 'melee', name: 'Melee', group: 'combat', cls: 'melee', desc: 'Trained by fighting with a melee weapon. Each level adds 1% melee damage and unlocks abilities.' },
    { id: 'ranged', name: 'Ranged', group: 'combat', cls: 'ranged', desc: 'Trained by fighting with a bow, crossbow or daggers. Each level adds 1% ranged damage.' },
    { id: 'magic', name: 'Magic', group: 'combat', cls: 'magic', desc: 'Trained by fighting with a wand, staff, sceptre or crystal. Each level adds 1% magic damage.' },
    { id: 'healing', name: 'Healing', group: 'combat', cls: 'healer', desc: 'Trained by fighting with a scroll, tome, codex or lantern. Each level adds 1% healing and smite damage.' },
  ];
  const SKILL_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));
  const COMBAT_SKILLS = SKILLS.filter(s => s.group === 'combat').map(s => s.id);
  const combatLevel = levels => COMBAT_SKILLS.reduce((a, k) => a + ((levels && levels[k]) || 1), 0);

  // ---------- Stats ----------
  // Flat: atk (damage or healing per second), def (armour), hp, mres, eres, mana, regen.
  // Percent: crit, critDmg, power, heal, haste, pen, block, double, bleed, burn, poison, fire, frost, shock, lifesteal, defPct, hpPct.
  const STATS = {
    atk: { name: 'Damage/s', fmt: v => `+${v} damage/s` },
    def: { name: 'Armour', fmt: v => `+${v} armour` },
    hp: { name: 'HP', fmt: v => `+${v} HP` },
    mres: { name: 'Magic resist', fmt: v => `+${v} magic resist` },
    eres: { name: 'Elemental resist', fmt: v => `+${v} elemental resist` },
    mana: { name: 'Mana', fmt: v => `+${v} mana` },
    regen: { name: 'Mana regen', fmt: v => `+${v} mana/s` },
    crit: { name: 'Crit chance', fmt: v => `+${v}% crit`, pct: true },
    critDmg: { name: 'Crit damage', fmt: v => `+${v}% crit damage`, pct: true },
    power: { name: 'Power', fmt: v => `+${v}% power`, pct: true },
    heal: { name: 'Healing', fmt: v => `+${v}% healing`, pct: true },
    haste: { name: 'Attack speed', fmt: v => `+${v}% attack speed`, pct: true },
    pen: { name: 'Armour pen', fmt: v => `${v}% armour penetration`, pct: true },
    block: { name: 'Block', fmt: v => `${v}% damage blocked`, pct: true },
    double: { name: 'Double hit', fmt: v => `${v}% double hit`, pct: true },
    bleed: { name: 'Bleed', fmt: v => `${v}% bleed`, pct: true },
    burn: { name: 'Burn', fmt: v => `${v}% burn`, pct: true },
    poison: { name: 'Poison', fmt: v => `${v}% poison`, pct: true },
    fire: { name: 'Fire damage', fmt: v => `+${v}% fire damage`, pct: true },
    frost: { name: 'Frost damage', fmt: v => `+${v}% frost damage`, pct: true },
    shock: { name: 'Shock damage', fmt: v => `+${v}% shock damage`, pct: true },
    lifesteal: { name: 'Lifesteal', fmt: v => `${v}% lifesteal`, pct: true },
    defPct: { name: 'Armour %', fmt: v => `+${v}% armour`, pct: true },
    hpPct: { name: 'HP %', fmt: v => `+${v}% HP`, pct: true },
    enemyDmg: { name: 'Enemy damage', fmt: v => `enemies deal ${v}% damage`, pct: true },
  };
  const describe = stats => Object.entries(stats || {}).filter(([k, v]) => STATS[k] && typeof v === 'number' && v).map(([k, v]) => STATS[k].fmt(Math.round(v * 10) / 10)).join(', ');
  const round1 = v => Math.round(v * 10) / 10;

  // ---------- Weapons ----------
  // cast: ms per auto attack. `extra` stats are added on top of damage and scale gently with tier.
  // Every damage weapon averages the same damage per second before its extras, so they differ in
  // rhythm and effects. Two-handers hit 35% harder but leave the off-hand empty.
  const WEAPON_KINDS = [
    { id: 'sword', noun: 'sword', cls: 'melee', maker: 'smithing', cast: 1000, action: 'Slash', dtype: 'Slash', crit: 0.1, spread: 0.15, extra: { crit: 4 }, mats: { ore: 6 }, offset: 0, note: 'Quick, steady slashes.' },
    { id: 'axe', noun: 'axe', cls: 'melee', maker: 'smithing', cast: 1200, action: 'Hack', dtype: 'Slash', crit: 0.08, spread: 0.2, extra: { bleed: 15 }, mats: { ore: 6 }, offset: 2, note: 'Hacks that leave the target bleeding.' },
    { id: 'mace', noun: 'mace', cls: 'melee', maker: 'smithing', cast: 1400, action: 'Smash', dtype: 'Crush', crit: 0.06, spread: 0.12, extra: { pen: 25 }, mats: { ore: 7 }, offset: 4, note: 'Smashes through a quarter of the target’s armour.' },
    { id: 'greatsword', noun: 'greatsword', cls: 'melee', maker: 'smithing', cast: 2200, action: 'Cleave', dtype: 'Cleave', crit: 0.15, critMult: 2.4, spread: 0.15, twoHanded: true, extra: { critDmg: 20 }, mats: { ore: 10 }, offset: 6, note: 'Two-handed. Slow cleaves with brutal critical hits.' },
    { id: 'shortbow', noun: 'shortbow', cls: 'ranged', maker: 'fletching', cast: 1000, action: 'Quick shot', dtype: 'Pierce', crit: 0.12, spread: 0.12, extra: { haste: 6 }, mats: { bone: 4, hide: 1 }, offset: 0, note: 'Fast arrows.' },
    { id: 'longbow', noun: 'longbow', cls: 'ranged', maker: 'fletching', cast: 2000, action: 'Aimed shot', dtype: 'Pierce', crit: 0.3, spread: 0.12, extra: { crit: 6 }, mats: { bone: 6, hide: 1 }, offset: 2, note: 'Slow aimed shots with a high critical chance.' },
    { id: 'crossbow', noun: 'crossbow', cls: 'ranged', maker: 'fletching', cast: 1700, action: 'Heavy bolt', dtype: 'Bolt', crit: 0.08, spread: 0.1, extra: { pen: 40 }, mats: { bone: 5, hide: 2 }, offset: 4, note: 'Bolts that ignore much of the target’s armour.' },
    { id: 'daggers', noun: 'throwing daggers', cls: 'ranged', maker: 'fletching', cast: 900, action: 'Throw', dtype: 'Stab', crit: 0.1, spread: 0.2, extra: { double: 18, poison: 8 }, mats: { bone: 4, venom: 1 }, offset: 6, note: 'Rapid throws that can hit twice and poison.' },
    { id: 'wand', noun: 'wand', cls: 'magic', maker: 'enchanting', cast: 1000, action: 'Arcane bolt', dtype: 'Arcane', crit: 0.1, spread: 0.15, extra: { regen: 1 }, mats: { branch: 3, essence: 1 }, offset: 0, note: 'Rapid arcane bolts.' },
    { id: 'staff', noun: 'staff', cls: 'magic', maker: 'enchanting', cast: 2200, action: 'Fireball', dtype: 'Fire', crit: 0.08, spread: 0.25, twoHanded: true, extra: { burn: 30, fire: 8 }, mats: { branch: 8, essence: 1 }, offset: 2, note: 'Two-handed. Fireballs that leave the target burning.' },
    { id: 'sceptre', noun: 'sceptre', cls: 'magic', maker: 'enchanting', cast: 1700, action: 'Chain lightning', dtype: 'Shock', crit: 0.1, spread: 0.15, chain: 0.35, extra: { shock: 8 }, mats: { branch: 5, essence: 2 }, offset: 4, note: 'Lightning that arcs to every enemy in the wave for a third of the damage.' },
    { id: 'crystal', noun: 'frost crystal', cls: 'magic', maker: 'enchanting', cast: 1500, action: 'Frostbolt', dtype: 'Frost', crit: 0.1, spread: 0.12, chill: 0.12, extra: { frost: 8 }, mats: { branch: 4, essence: 3 }, offset: 6, note: 'Frostbolts that chill enemies so they hit 12% softer.' },
    { id: 'scroll', noun: 'scroll', cls: 'healer', maker: 'scribing', cast: 1000, action: 'Quick mend', dtype: 'Holy', crit: 0.06, spread: 0.1, extra: { haste: 6 }, mats: { reed: 3, herb: 1 }, offset: 0, note: 'Small, fast heals.' },
    { id: 'tome', noun: 'tome', cls: 'healer', maker: 'scribing', cast: 2000, action: 'Greater mend', dtype: 'Holy', crit: 0.06, spread: 0.1, extra: { heal: 8 }, mats: { reed: 5, herb: 2 }, offset: 2, note: 'Big heals on the most hurt pilot.' },
    { id: 'lantern', noun: 'lantern', cls: 'healer', maker: 'scribing', cast: 1600, action: 'Kindle', dtype: 'Holy', crit: 0.06, spread: 0.1, hot: 0.5, extra: { regen: 1 }, mats: { reed: 4, herb: 3 }, offset: 4, note: 'Half the heal lands now, the rest (plus more) over 4 seconds.' },
    { id: 'codex', noun: 'codex', cls: 'healer', maker: 'scribing', cast: 2000, action: 'Prayer of mending', dtype: 'Holy', crit: 0.06, spread: 0.1, group: 0.45, twoHanded: true, extra: { heal: 5 }, mats: { reed: 8, herb: 3 }, offset: 6, note: 'Two-handed. Heals the whole party at once.' },
  ];
  const WEAPON_BY_ID = Object.fromEntries(WEAPON_KINDS.map(w => [w.id, w]));

  const OFFHAND_KINDS = [
    { id: 'shield', noun: 'shield', cls: 'melee', maker: 'smithing', stats: { def: 8, hp: 200 }, extra: { block: 8 }, mats: { ore: 6 }, offset: 3, note: 'Blocks part of every hit.' },
    { id: 'quiver', noun: 'quiver', cls: 'ranged', maker: 'fletching', stats: { def: 3, hp: 100 }, extra: { haste: 6, crit: 3 }, mats: { hide: 4, bone: 1 }, offset: 3, note: 'Faster, sharper shots.' },
    { id: 'orb', noun: 'orb', cls: 'magic', maker: 'enchanting', stats: { def: 2, hp: 80, mana: 20 }, extra: { power: 6, regen: 1 }, mats: { essence: 3, branch: 2 }, offset: 3, note: 'Focuses power and mana.' },
    { id: 'relic', noun: 'relic', cls: 'healer', maker: 'scribing', stats: { def: 3, hp: 100, mana: 15 }, extra: { heal: 8, regen: 1 }, mats: { herb: 3, reed: 2 }, offset: 3, note: 'A holy focus for healers.' },
  ];
  const OFFHAND_BY_ID = Object.fromEntries(OFFHAND_KINDS.map(o => [o.id, o]));

  // ---------- Armour ----------
  const SLOTS = [
    { id: 'weapon', name: 'Main hand' }, { id: 'offhand', name: 'Off-hand' },
    { id: 'head', name: 'Head' }, { id: 'body', name: 'Body' }, { id: 'legs', name: 'Legs' }, { id: 'hands', name: 'Hands' }, { id: 'feet', name: 'Feet' },
    { id: 'trinket', name: 'Trinket' },
  ];
  const ARMOUR_SLOTS = ['head', 'body', 'legs', 'hands', 'feet'];
  const SLOT_SHARE = { head: 0.2, body: 0.32, legs: 0.24, hands: 0.12, feet: 0.12 };
  const SLOT_MATS = { head: 4, body: 7, legs: 5, hands: 3, feet: 3 };
  const SLOT_OFFSET = { head: 0, feet: 1, hands: 2, legs: 3, body: 5 };
  // Totals for a full tier 1 set; each slot takes its share. Percent stats step up per tier.
  const ARMOUR_TYPES = {
    plate: { name: 'Plate', maker: 'armoursmithing', mat: 'ore', icon: 'plate', nouns: { head: 'helm', body: 'breastplate', legs: 'greaves', hands: 'gauntlets', feet: 'sabatons' },
      total: { def: 30, hp: 900, mres: 6, eres: 10 }, pct: { block: [4, 0.4] },
      bonus3: { name: 'Fortified', defPct: 8 }, bonus5: { name: 'Bulwark', hpPct: 10, block: 6 } },
    leather: { name: 'Leather', maker: 'leatherworking', mat: 'hide', icon: 'leather', nouns: { head: 'hood', body: 'jerkin', legs: 'leggings', hands: 'bracers', feet: 'boots' },
      total: { def: 22, hp: 800, mres: 10, eres: 14 }, pct: { crit: [5, 0.5], haste: [3, 0.3] },
      bonus3: { name: 'Keen eye', crit: 4 }, bonus5: { name: 'Stalker', haste: 8, crit: 4 } },
    cloth: { name: 'Cloth', maker: 'tailoring', mat: 'fibre', icon: 'cloth', nouns: { head: 'hat', body: 'robe', legs: 'trousers', hands: 'gloves', feet: 'slippers' },
      total: { def: 15, hp: 720, mres: 24, eres: 10, mana: 30 }, pct: { power: [8, 1] }, flat: { regen: [1, 0.2] },
      bonus3: { name: 'Attuned', power: 6 }, bonus5: { name: 'Archmage', power: 8, regen: 2 } },
    vestment: { name: 'Vestment', maker: 'weaving', mat: 'reed', icon: 'vest', nouns: { head: 'circlet', body: 'vestment', legs: 'skirt', hands: 'prayer beads', feet: 'sandals' },
      total: { def: 17, hp: 760, mres: 18, eres: 12, mana: 25 }, pct: { heal: [10, 1] }, flat: { regen: [1.5, 0.25] },
      bonus3: { name: 'Blessed', heal: 8 }, bonus5: { name: 'Saintly', heal: 10, regen: 3 } },
  };
  const tierLabel = (t, type) => (type === 'plate' ? t.metal : type === 'leather' ? t.leather : type === 'cloth' ? t.cloth : `${t.order.replace('’s', '')}`);

  // ---------- Consumables ----------
  // Alchemy potions and tonics work for anyone; the other three are class buffs that only apply
  // (and are only used up) when your class matches.
  const CONSUMABLES = [
    // Alchemy (any class)
    { id: 'healing_potion', name: 'Healing potion', skill: 'alchemy', level: 1, tier: 1, icon: 'potion_hp_0', potion: 'hp', heal: 0.3, inputs: { herb: 2 } },
    { id: 'mana_potion', name: 'Mana potion', skill: 'alchemy', level: 10, tier: 2, icon: 'potion_mp_0', potion: 'mp', mana: 60, inputs: { herb: 2, reed: 1 } },
    { id: 'ironskin_tonic', name: 'Ironskin tonic', skill: 'alchemy', level: 15, tier: 2, icon: 'tonic_0', boost: { defPct: 10 }, inputs: { herb: 2, reed: 1 } },
    { id: 'greater_healing_potion', name: 'Greater healing potion', skill: 'alchemy', level: 30, tier: 4, icon: 'potion_hp_1', potion: 'hp', heal: 0.45, inputs: { herb: 2, reed: 2 } },
    { id: 'vigour_tonic', name: 'Vigour tonic', skill: 'alchemy', level: 35, tier: 4, icon: 'tonic_1', boost: { hpPct: 12 }, inputs: { herb: 3, reed: 1 } },
    { id: 'greater_mana_potion', name: 'Greater mana potion', skill: 'alchemy', level: 50, tier: 6, icon: 'potion_mp_1', potion: 'mp', mana: 120, inputs: { herb: 3, reed: 2 } },
    { id: 'fury_tonic', name: 'Fury tonic', skill: 'alchemy', level: 55, tier: 6, icon: 'tonic_2', boost: { power: 8 }, inputs: { herb: 3, reed: 2 } },
    { id: 'superior_healing_potion', name: 'Superior healing potion', skill: 'alchemy', level: 70, tier: 8, icon: 'potion_hp_2', potion: 'hp', heal: 0.6, inputs: { herb: 3, reed: 3 } },
    { id: 'titan_elixir', name: 'Elixir of titans', skill: 'alchemy', level: 85, tier: 9, icon: 'tonic_3', boost: { power: 6, defPct: 6, hpPct: 6 }, inputs: { herb: 4, reed: 3 } },
    // Honing (melee)
    { id: 'whetstone', name: 'Whetstone', skill: 'honing', level: 1, tier: 1, cls: 'melee', icon: 'hone_0', boost: { power: 8 }, inputs: { ore: 3 } },
    { id: 'weapon_oil', name: 'Weapon oil', skill: 'honing', level: 20, tier: 3, cls: 'melee', icon: 'hone_1', boost: { crit: 6 }, inputs: { ore: 4 } },
    { id: 'balance_stone', name: 'Balance stone', skill: 'honing', level: 40, tier: 5, cls: 'melee', icon: 'hone_2', boost: { haste: 10 }, inputs: { ore: 5 } },
    { id: 'tempering_oil', name: 'Tempering oil', skill: 'honing', level: 60, tier: 7, cls: 'melee', icon: 'hone_3', boost: { power: 10, pen: 10 }, inputs: { ore: 6 } },
    { id: 'master_whetstone', name: 'Master whetstone', skill: 'honing', level: 80, tier: 9, cls: 'melee', icon: 'hone_0', boost: { power: 15, crit: 5 }, inputs: { ore: 8 } },
    // Poisoncraft (ranged)
    { id: 'weak_poison', name: 'Weak poison', skill: 'poisoncraft', level: 1, tier: 1, cls: 'ranged', icon: 'poison_0', boost: { poison: 12 }, inputs: { venom: 2 } },
    { id: 'barbed_tips', name: 'Barbed tips', skill: 'poisoncraft', level: 20, tier: 3, cls: 'ranged', icon: 'poison_1', boost: { bleed: 12, crit: 3 }, inputs: { venom: 1, bone: 3 } },
    { id: 'paralytic_venom', name: 'Paralytic venom', skill: 'poisoncraft', level: 40, tier: 5, cls: 'ranged', icon: 'poison_2', boost: { enemyDmg: -10 }, inputs: { venom: 3 } },
    { id: 'deadly_poison', name: 'Deadly poison', skill: 'poisoncraft', level: 60, tier: 7, cls: 'ranged', icon: 'poison_0', boost: { poison: 25 }, inputs: { venom: 4 } },
    { id: 'hunters_draught', name: 'Hunter’s draught', skill: 'poisoncraft', level: 80, tier: 9, cls: 'ranged', icon: 'poison_3', boost: { power: 12, haste: 8 }, inputs: { venom: 4, hide: 2 } },
    // Runecrafting (magic)
    { id: 'rune_of_power', name: 'Rune of power', skill: 'runecrafting', level: 1, tier: 1, cls: 'magic', icon: 'rune_0', boost: { power: 8 }, inputs: { essence: 2 } },
    { id: 'rune_of_clarity', name: 'Rune of clarity', skill: 'runecrafting', level: 20, tier: 3, cls: 'magic', icon: 'rune_1', boost: { regen: 4 }, inputs: { essence: 3 } },
    { id: 'rune_of_fire', name: 'Rune of fire', skill: 'runecrafting', level: 40, tier: 5, cls: 'magic', icon: 'rune_2', boost: { fire: 15, burn: 10 }, inputs: { essence: 3, branch: 1 } },
    { id: 'rune_of_frost', name: 'Rune of frost', skill: 'runecrafting', level: 60, tier: 7, cls: 'magic', icon: 'rune_3', boost: { enemyDmg: -12 }, inputs: { essence: 4 } },
    { id: 'rune_of_ruin', name: 'Rune of ruin', skill: 'runecrafting', level: 80, tier: 9, cls: 'magic', icon: 'rune_0', boost: { power: 15, crit: 5 }, inputs: { essence: 5 } },
  ];
  const CONSUMABLE_BY_ID = Object.fromEntries(CONSUMABLES.map(c => [c.id, c]));

  // ---------- Abilities ----------
  // amt is measured in seconds of your damage (or healing) per second, so abilities scale with gear.
  // kind: damage | aoe | dot | heal | hot | group | barrier | buff | party | debuff | revive
  // Pilots use equipped abilities automatically in fights when they are off cooldown and useful.
  const A = (id, name, cls, level, cd, mana, cast, kind, o, desc) => ({ id, name, cls, level, cd, mana, cast, kind, ...o, desc });
  const ABILITIES = [
    A('heavy_strike', 'Heavy strike', 'melee', 1, 6, 15, 1200, 'damage', { amt: 3.6 }, 'A crushing blow for 3.6 seconds of damage.'),
    A('whirlwind', 'Whirlwind', 'melee', 5, 10, 25, 1500, 'aoe', { amt: 2.2 }, 'Spin and hit every enemy in the wave.'),
    A('rend', 'Rend', 'melee', 10, 12, 20, 1000, 'dot', { amt: 5, over: 6, ty: 'Bleed' }, 'The target bleeds heavily for 6 seconds.'),
    A('shield_wall', 'Shield wall', 'melee', 20, 30, 25, 500, 'buff', { stat: 'dr', value: 40, dur: 8 }, 'Take 40% less damage for 8 seconds. Used when hurt.'),
    A('battle_cry', 'Battle cry', 'melee', 35, 40, 30, 800, 'party', { stat: 'power', value: 15, dur: 12 }, 'The whole party deals 15% more for 12 seconds.'),
    A('execute', 'Execute', 'melee', 50, 8, 25, 1200, 'damage', { amt: 3, execute: 2.5 }, 'Deals 2.5 times as much to targets below 35% HP.'),
    A('bladestorm', 'Bladestorm', 'melee', 70, 35, 50, 3000, 'aoe', { amt: 7 }, 'A storm of blades on every enemy.'),
    A('aimed_shot', 'Aimed shot', 'ranged', 1, 7, 15, 1800, 'damage', { amt: 4.2, critBonus: 0.25 }, 'A careful shot with +25% crit chance.'),
    A('multishot', 'Multishot', 'ranged', 5, 10, 25, 1400, 'aoe', { amt: 2 }, 'Arrows at every enemy in the wave.'),
    A('poison_arrow', 'Poison arrow', 'ranged', 10, 12, 20, 1200, 'dot', { amt: 5.5, over: 6, ty: 'Poison' }, 'Poisons the target for 6 seconds.'),
    A('rapid_fire', 'Rapid fire', 'ranged', 20, 25, 25, 400, 'buff', { stat: 'haste', value: 35, dur: 8 }, '35% faster attacks for 8 seconds.'),
    A('hunters_mark', 'Hunter’s mark', 'ranged', 35, 30, 25, 800, 'debuff', { stat: 'mark', value: 20, dur: 12 }, 'The target takes 20% more damage from everyone for 12 seconds.'),
    A('volley', 'Volley', 'ranged', 50, 20, 40, 2200, 'aoe', { amt: 4 }, 'A rain of arrows on every enemy.'),
    A('deadeye', 'Deadeye', 'ranged', 70, 30, 45, 2500, 'damage', { amt: 8, critBonus: 1 }, 'A guaranteed critical hit.'),
    A('fireball', 'Pyroblast', 'magic', 1, 6, 18, 1600, 'damage', { amt: 3, dot: 1.5, ty: 'Fire' }, 'A blast that leaves the target burning.'),
    A('frost_nova', 'Frost nova', 'magic', 5, 15, 25, 1000, 'aoe', { amt: 1.4, chill: 20, dur: 6 }, 'Hits every enemy and chills them (20% less damage) for 6 seconds.'),
    A('arcane_missiles', 'Arcane missiles', 'magic', 10, 9, 22, 2000, 'damage', { amt: 5, hits: 5 }, 'Five quick missiles.'),
    A('chain_lightning', 'Chain lightning', 'magic', 20, 12, 30, 1500, 'aoe', { amt: 2.6, ty: 'Shock' }, 'Lightning through every enemy.'),
    A('mana_shield', 'Mana shield', 'magic', 35, 30, 30, 500, 'barrier', { value: 0.3, self: true }, 'A shield worth 30% of your HP. Used when hurt.'),
    A('meteor', 'Meteor', 'magic', 50, 25, 50, 2800, 'aoe', { amt: 5.5, dot: 2, ty: 'Fire' }, 'A meteor on every enemy, leaving them burning.'),
    A('time_warp', 'Time warp', 'magic', 70, 60, 60, 1000, 'party', { stat: 'haste', value: 30, dur: 10 }, 'The whole party acts 30% faster for 10 seconds.'),
    A('flash_heal', 'Flash heal', 'healer', 1, 4, 15, 800, 'heal', { amt: 2.8 }, 'A quick heal on the most hurt pilot.'),
    A('renew', 'Renew', 'healer', 5, 8, 15, 500, 'hot', { amt: 4, over: 8 }, 'Heals the most hurt pilot over 8 seconds.'),
    A('prayer', 'Prayer', 'healer', 10, 12, 30, 2000, 'group', { amt: 1.8 }, 'Heals the whole party.'),
    A('holy_smite', 'Holy smite', 'healer', 20, 8, 20, 1400, 'damage', { amt: 3.5, ty: 'Holy', selfHeal: 0.3 }, 'Smites the target and heals you for 30% of the damage.'),
    A('guardian_spirit', 'Guardian spirit', 'healer', 35, 30, 30, 600, 'barrier', { value: 0.35 }, 'Shields the most hurt pilot for 35% of their HP.'),
    A('divine_hymn', 'Divine hymn', 'healer', 50, 40, 55, 3000, 'group', { amt: 4.5 }, 'A powerful heal on the whole party.'),
    A('resurrect', 'Resurrect', 'healer', 70, 45, 60, 2500, 'revive', { value: 0.5 }, 'Brings a downed pilot back at half HP.'),
    A('second_wind', 'Second wind', 'generic', 5, 40, 0, 500, 'heal', { pct: 0.3, self: true }, 'Heal yourself for 30% of your HP. Used when below 40%.'),
    A('adrenaline', 'Adrenaline', 'generic', 20, 45, 20, 300, 'buff', { stat: 'haste', value: 25, dur: 10 }, '25% faster for 10 seconds.'),
    A('focus', 'Focus', 'generic', 40, 45, 20, 300, 'buff', { stat: 'crit', value: 20, dur: 10 }, '+20% crit chance for 10 seconds.'),
    A('sunder', 'Sunder armour', 'generic', 80, 30, 20, 800, 'debuff', { stat: 'sunder', value: 30, dur: 12 }, 'The target loses 30% of its armour for 12 seconds.'),
    A('iron_skin', 'Iron skin', 'generic', 130, 45, 25, 300, 'buff', { stat: 'dr', value: 30, dur: 10 }, 'Take 30% less damage for 10 seconds. Used when hurt.'),
    A('overcharge', 'Overcharge', 'generic', 200, 60, 30, 300, 'buff', { stat: 'power', value: 25, dur: 10 }, '+25% damage and healing for 10 seconds.'),
    A('last_stand', 'Last stand', 'generic', 300, 0, 0, 0, 'cheat', { value: 0.4 }, 'Once per fight, survive a killing blow and heal 40%.'),
  ];
  const ABILITY_BY_ID = Object.fromEntries(ABILITIES.map(a => [a.id, a]));
  const ABILITY_SLOTS = { cls: 2, generic: 1 };

  // ---------- Subclasses ----------
  // Chosen per class at level 5 of that class's combat skill. Multiclass (level 10) instead lets
  // you pick a second class: fights train both, and both classes' abilities can be equipped.
  const SUBCLASSES = [
    { id: 'berserker', cls: 'melee', name: 'Berserker', level: 5, stats: { power: 12, lifesteal: 6 }, rage: 20, desc: '+12% damage and 6% lifesteal. Below half HP, a further +20% damage.' },
    { id: 'guardian', cls: 'melee', name: 'Guardian', level: 5, stats: { hpPct: 15, block: 10 }, taunt: true, dr: 15, desc: 'Tank: enemies aim at you. +15% HP, 10% block and 15% less damage taken.' },
    { id: 'sharpshooter', cls: 'ranged', name: 'Sharpshooter', level: 5, stats: { crit: 8, critDmg: 50 }, desc: '+8% crit chance and +50% crit damage.' },
    { id: 'trapper', cls: 'ranged', name: 'Trapper', level: 5, stats: { poison: 10 }, spread: 0.25, desc: 'A quarter of your attack damage also poisons every enemy in the wave.' },
    { id: 'pyromancer', cls: 'magic', name: 'Pyromancer', level: 5, stats: { burn: 20, fire: 10 }, splash: 0.2, desc: 'Burns hit 20% harder and 20% of your damage splashes to every enemy as fire.' },
    { id: 'arcanist', cls: 'magic', name: 'Arcanist', level: 5, stats: { regen: 2 }, costCut: 0.3, abilityPower: 0.2, desc: 'Abilities cost 30% less mana and deal 20% more. +2 mana regen.' },
    { id: 'cleric', cls: 'healer', name: 'Cleric', level: 5, stats: { heal: 20 }, smite: 0.3, desc: '+20% healing and 30% stronger smites.' },
    { id: 'shadowmender', cls: 'healer', name: 'Shadowmender', level: 5, shadow: true, desc: 'Your attacks become shadow damage over time on every enemy in the wave, and every tick heals your whole party.' },
    { id: 'multiclass', cls: null, name: 'Multiclass', level: 10, desc: 'Instead of one of this class’s subclasses, take a subclass from another class (you need level 5 in that class).' },
  ];
  const SUBCLASS_BY_ID = Object.fromEntries(SUBCLASSES.map(s => [s.id, s]));
  // The subclass in effect for a class: its own pick, or with Multiclass, the borrowed subclass
  // from another class (state.multi[cls] holds that subclass's id).
  const resolveSubclass = (subclasses, multi, cls) => {
    const s = subclasses && subclasses[cls];
    if (s !== 'multiclass') return s || null;
    const b = SUBCLASS_BY_ID[multi && multi[cls]];
    return b && b.cls && b.cls !== cls ? b.id : null;
  };

  // ---------- Regions and raids ----------
  // 10 regions of 25 raids each: 250 raids. Each raid is a few trash waves and a boss, at one of
  // three difficulties. Raids unlock in order.
  const FOES = [
    'Goblin', 'Goblin scout', 'Orc brute', 'Troll', 'Skeleton', 'Zombie', 'Ghost', 'Wraith', 'Cave spider', 'Broodmother', 'Scorpion', 'Dire wolf', 'Werewolf', 'Cave bear',
    'Drake', 'Elder dragon', 'Wyvern', 'Stone golem', 'Ice golem', 'Rock golem', 'War golem', 'Imp', 'Giant bat', 'Slime', 'Rattlesnake', 'Sea serpent', 'Burrower', 'Rock crab',
    'Kraken', 'Harpy', 'Minotaur', 'Cyclops', 'Giant', 'Vampire lord', 'Watcher', 'Mind flayer', 'Mimic', 'Gargoyle', 'Tyrant rex', 'Raptor', 'Ogre', 'Spectre', 'Hag',
    'Cultist', 'Black knight', 'Crawler drone', 'Sentry turret', 'Pixie', 'Reaper', 'Mantis', 'Giant wasp', 'Bog frog', 'Lizardman', 'Wild boar', 'Elk spirit', 'Treant', 'Shroom',
    'Maneater', 'Beholder', 'Brain horror', 'Hydra', 'Prism', 'Daemon', 'Leviathan', 'Void bug', 'Scarab', 'Spider bot', 'Missile walker', 'Rogue mech',
  ];
  // Enemies deal physical damage unless listed here.
  const FOE_DAMAGE = { 6: 'magic', 7: 'magic', 21: 'fire', 33: 'magic', 34: 'magic', 35: 'magic', 41: 'magic', 42: 'magic', 43: 'magic', 47: 'magic', 48: 'magic',
    58: 'magic', 59: 'magic', 61: 'magic', 62: 'fire', 14: 'fire', 15: 'fire', 16: 'shock', 18: 'frost', 46: 'shock', 67: 'fire', 25: 'frost', 63: 'frost', 23: 'poison', 24: 'poison', 10: 'poison', 50: 'poison' };
  const REGIONS = [
    { id: 'scrapyard', name: 'Rustwood Scrapyard', trash: [0, 1, 23, 22, 53, 45, 46, 66, 27, 11], bosses: [2, 40, 66, 68, 36, 3, 20, 67], finale: 'The Scrap King', mat: 'Scrap core',
      trinket: { name: 'Rusted cog', stats: { defPct: 6, hpPct: 6 } } },
    { id: 'warrens', name: 'Goblin Warrens', trash: [0, 1, 2, 8, 24, 51, 52, 40, 21, 3], bosses: [3, 40, 9, 52, 21, 2, 30, 12], finale: 'Warchief Grukk', mat: 'Warband totem',
      trinket: { name: 'Goblin fang', stats: { crit: 4 }, passives: { bleed: 10 } } },
    { id: 'crypts', name: 'Sunken Crypts', trash: [4, 5, 6, 7, 22, 43, 41, 48, 42, 37], bosses: [41, 33, 42, 48, 62, 5, 7, 37], finale: 'The Lich Queen', mat: 'Grave dust',
      trinket: { name: 'Lich phylactery', stats: { power: 8, mana: 30 } } },
    { id: 'steppes', name: 'Howling Steppes', trash: [11, 53, 54, 29, 50, 39, 12, 49, 13, 30], bosses: [12, 13, 30, 38, 16, 11, 32, 39], finale: 'Alpha of the Steppes', mat: 'Moon fang',
      trinket: { name: 'Alpha’s claw', stats: { haste: 6, crit: 3 } } },
    { id: 'caverns', name: 'Crystal Caverns', trash: [23, 27, 26, 8, 65, 56, 19, 17, 61, 9], bosses: [17, 19, 61, 9, 28, 23, 18, 59], finale: 'The Crystal Heart', mat: 'Prism shard',
      trinket: { name: 'Prism heart', stats: { power: 10 } } },
    { id: 'wastes', name: 'Ember Wastes', trash: [21, 10, 52, 24, 39, 57, 14, 62, 65, 55], bosses: [14, 62, 38, 31, 15, 10, 55, 57], finale: 'Ashmaw the Undying', mat: 'Ember heart',
      trinket: { name: 'Ember core', stats: { fire: 12, eres: 20 } } },
    { id: 'spire', name: 'Stormspire', trash: [45, 46, 50, 67, 66, 58, 34, 47, 20, 16], bosses: [20, 34, 68, 58, 16, 67, 46, 35], finale: 'The Storm Engine', mat: 'Storm core',
      trinket: { name: 'Storm eye', stats: { heal: 10 }, passives: { surge: 10 } } },
    { id: 'citadel', name: 'Frozen Citadel', trash: [44, 41, 37, 33, 4, 18, 7, 48, 31, 32], bosses: [18, 33, 44, 37, 48, 31, 32, 15], finale: 'The Frost Tyrant', mat: 'Frost crystal',
      trinket: { name: 'Frozen heart', stats: { hpPct: 8, mres: 30 } } },
    { id: 'ruins', name: 'Starfall Ruins', trash: [64, 47, 43, 34, 59, 49, 35, 58, 61, 62], bosses: [35, 59, 58, 31, 61, 64, 47, 34], finale: 'The Fallen Star', mat: 'Star shard',
      trinket: { name: 'Fallen star', stats: { power: 8, regen: 2 } } },
    { id: 'rift', name: 'The Void Rift', trash: [64, 28, 62, 48, 25, 35, 63, 60, 59, 32], bosses: [63, 60, 32, 15, 48, 28, 62, 25], finale: 'The Void Titan', mat: 'Void shard',
      trinket: { name: 'Void heart', stats: { power: 6, defPct: 6, hpPct: 6 }, passives: { lifesteal: 5 } } },
  ];
  // Every region has a raid set for each class (in that class's armour type), a raid weapon for
  // each class, and two trinkets. Bosses in a region each drop a different mix of them.
  const THEMES = ['Scrap', 'Warband', 'Grave', 'Moon', 'Prism', 'Ember', 'Storm', 'Frost', 'Star', 'Void'];
  const SET_KINDS = { melee: { type: 'plate', suffix: 'guard' }, ranged: { type: 'leather', suffix: 'stalker' }, magic: { type: 'cloth', suffix: 'weave' }, healer: { type: 'vestment', suffix: 'ward' } };
  const SET_PASSIVES = { melee: ['thorns', 'bleed', 'lifesteal'], ranged: ['multishot', 'bleed', 'prismatic'], magic: ['prismatic', 'burn', 'lifesteal'], healer: ['overflow', 'surge'] };
  const PASSIVE_SCALE = { thorns: [20, 3], bleed: [15, 2], lifesteal: [6, 0.6], multishot: [12, 1.2], prismatic: [35, 4], burn: [18, 2], overflow: [25, 2.5], surge: [10, 1] };
  const SET_TWO = {
    melee: i => ({ hpPct: 6 + i, defPct: 2 + i / 2 }), ranged: i => ({ crit: 3 + i / 2, haste: 2 + i / 2 }),
    magic: i => ({ power: 5 + i, regen: 0.5 + i / 5 }), healer: i => ({ heal: 7 + i, regen: 1 + i / 5 }),
  };
  const UNIQUE_KINDS = { melee: ['greatsword', 'axe', 'mace', 'sword'], ranged: ['longbow', 'crossbow', 'daggers', 'shortbow'], magic: ['staff', 'sceptre', 'crystal', 'wand'], healer: ['codex', 'lantern', 'tome', 'scroll'] };
  const UNIQUE_SUFFIX = { melee: 'forged', ranged: 'fletched', magic: 'bound', healer: 'blessed' };
  const UNIQUE_PASSIVE = { melee: i => ({ bleed: 10 + 2 * i }), ranged: i => ({ multishot: 8 + i }), magic: i => ({ burn: 12 + 2 * i }), healer: i => ({ surge: 8 + i }) };
  const SET_BY_ID = {};
  REGIONS.forEach((reg, i) => {
    reg.theme = THEMES[i];
    reg.charm = { name: `${THEMES[i]} charm`, stats: i % 2 ? { hpPct: 4 + i, mres: 8 + 4 * i } : { crit: 3 + Math.floor(i / 2), haste: 3 + Math.floor(i / 2) } };
    reg.sets = {};
    Object.entries(SET_KINDS).forEach(([cls, k]) => {
      const pas = SET_PASSIVES[cls][i % SET_PASSIVES[cls].length];
      const [base, step] = PASSIVE_SCALE[pas];
      const set = { id: `${i + 1}_${cls}`, region: i, cls, name: THEMES[i] + k.suffix, type: k.type,
        two: Object.fromEntries(Object.entries(SET_TWO[cls](i)).map(([s, v]) => [s, Math.round(v * 10) / 10])), three: { passives: { [pas]: Math.round((base + step * i) * 10) / 10 } } };
      reg.sets[cls] = set;
      SET_BY_ID[set.id] = set;
    });
  });
  // How trash enemies fight. Swarms come in bigger packs; healers mend their allies; archers
  // ignore taunts; brutes hit slowly and hard; elites lead packs on their own.
  const TRASH_ROLES = {
    grunt: { name: 'Grunt', hp: 1, dmg: 1, cast: 1 },
    brute: { name: 'Brute', hp: 1.7, dmg: 1.35, cast: 1.4 },
    swarm: { name: 'Swarm', hp: 0.45, dmg: 0.5, cast: 0.8 },
    caster: { name: 'Caster', hp: 0.8, dmg: 1.2, cast: 1.1, magic: true },
    archer: { name: 'Archer', hp: 0.8, dmg: 1, cast: 1, noTaunt: true },
    healer: { name: 'Healer', hp: 0.9, dmg: 0.5, cast: 1.2, heals: true, magic: true },
    elite: { name: 'Elite', hp: 2.6, dmg: 1.7, cast: 1.2 },
  };
  const FOE_ROLE = FOES.map((_, i) => (FOE_DAMAGE[i] === 'magic' ? (i % 3 === 0 ? 'healer' : 'caster') : ['grunt', 'brute', 'swarm', 'archer', 'grunt', 'brute'][i % 6]));
  // Boss mechanics. `every`: used on every nth attack.
  const MECHANICS = {
    cleave: { name: 'Cleave', cost: 0.05, every: 4, desc: 'Every 4th attack hits every pilot.' },
    smash: { name: 'Crushing blow', cost: 0.08, every: 5, desc: 'Every 5th attack is a slow blow on one pilot for 2.5× damage.' },
    poison: { name: 'Venom spray', cost: 0.06, every: 6, desc: 'Poisons every pilot for 5 seconds.' },
    drain: { name: 'Mana drain', cost: 0.04, every: 5, desc: 'Drains mana from every pilot.' },
    mend: { name: 'Regenerate', cost: 0.1, every: 7, desc: 'Heals itself for 6% of its HP.' },
    summon: { name: 'Call for help', cost: 0.15, desc: 'Calls in more enemies at 70% and 35% HP.' },
    shield: { name: 'Iron hide', cost: 0.12, desc: 'At half HP, shields itself for 15% of its HP.' },
    enrage: { name: 'Enrage', cost: 0.08, desc: 'Below 30% HP it hits 40% harder and faster.' },
  };
  const MECH_POOL = Object.keys(MECHANICS);
  // Raid bosses, one per monster on the monster sheet: [row, col, name, damage type]. Every raid gets
  // its own; when there are more raids than monsters, repeats come in a later region, recoloured.
  const P = 'physical', Mg = 'magic', Fi = 'fire', Fr = 'frost', Sh = 'shock', Po = 'poison';
  const BOSS_ROSTER = [
    [0, 0, 'Skeleton warrior', P], [0, 1, 'Bone knight', P], [0, 2, 'Skeleton brute', P], [0, 3, 'Hooded executioner', P], [0, 4, 'Grey wolf', P],
    [0, 5, 'Swamp ogre', P], [0, 6, 'Dwarf flailer', P], [0, 8, 'Frost wraith', Fr], [0, 9, 'Bat swarm', P], [0, 10, 'Axe raider', P], [0, 11, 'Dwarf bandit', P],
    [1, 0, 'Deep one', Mg], [1, 1, 'Crimson mage', Fi], [1, 2, 'Viper', Po], [1, 3, 'Lizard rider', P], [1, 4, 'Mad jester', Mg], [1, 5, 'Hill ogre', P],
    [1, 6, 'Owl lord', P], [1, 7, 'Bandit swordsman', P], [1, 8, 'Goblin chief', P], [1, 9, 'Brown bear', P], [1, 10, 'Imp', Fi], [1, 11, 'Horned totem', Mg],
    [2, 0, 'Totem idol', Mg], [2, 1, 'Viking berserker', P], [2, 2, 'Blue yeti', Fr], [2, 3, 'Snow tiger', Fr], [2, 4, 'Bone pile', P], [2, 5, 'Dead treant', Po],
    [2, 6, 'Stone troll', P], [2, 7, 'Snapping turtle', P], [2, 8, 'Lizardman', P], [2, 9, 'Giant bat', P], [2, 10, 'Winged imp', Fi], [2, 11, 'Blood worm', P],
    [3, 0, 'Troll', P], [3, 1, 'Shadow ape', Mg], [3, 2, 'Lurker fish', Fr], [3, 3, 'Fire salamander', Fi], [3, 4, 'Vampire', Mg], [3, 5, 'Ghoul', Po],
    [3, 6, 'Carpet genie', Mg], [3, 7, 'Living pillar', P], [3, 8, 'Pink djinn', Mg], [3, 9, 'Violet dancer', Mg], [3, 10, 'Bat flock', P], [3, 11, 'Goblin', P],
    [4, 0, 'Harpy queen', P], [4, 1, 'Violet serpent', Po], [4, 2, 'Moth king', Mg], [4, 3, 'Green druid', Po], [4, 4, 'Myconid', Po], [4, 5, 'Red sorcerer', Fi],
    [4, 6, 'Priestess', Mg], [4, 7, 'Gargoyle', P], [4, 8, 'Mantis horror', P], [4, 9, 'Chimera', Fi], [4, 10, 'Sea serpent', Fr], [4, 11, 'Grey ghoul', Po],
    [5, 0, 'Werelion', P], [5, 1, 'Fairy queen', Mg], [5, 2, 'Fire cat', Fi], [5, 3, 'Frost cat', Fr], [5, 4, 'Wild cat', P], [5, 5, 'Shadow cat', Mg],
    [5, 6, 'Fly swarm', Po], [5, 8, 'Forest witch', Mg], [5, 9, 'Adder', Po], [5, 10, 'Dragon egg', Fi], [5, 11, 'Green dragon', Po],
    [6, 0, 'Blonde witch', Mg], [6, 1, 'Vampire countess', Mg], [6, 2, 'Blue harpy', Fr], [6, 3, 'Skeleton lord', P], [6, 4, 'Banshee', Mg], [6, 5, 'Yeti', Fr],
    [6, 6, 'Giant hand', Mg], [6, 7, 'Clay golem', P], [6, 8, 'Phoenix', Fi], [6, 9, 'Brawler', P], [6, 10, 'Magma beast', Fi], [6, 11, 'Scorpion', Po],
    [7, 0, 'Vampire lord', Mg], [7, 1, 'Lamia', Mg], [7, 2, 'Blood bear', P], [7, 3, 'Axe knight', P], [7, 4, 'Spirit', Mg], [7, 5, 'Iron knight', P],
    [7, 6, 'Dark paladin', Mg], [7, 7, 'Gentleman thief', P], [7, 8, 'Ice golem', Fr], [7, 10, 'Barbarian', P], [7, 11, 'Great eagle', P],
    [8, 0, 'Death rider', Mg], [8, 1, 'Dwarf', P], [8, 2, 'Shieldbearer', P], [8, 3, 'Ghost tree', Mg], [8, 4, 'Piranha', P], [8, 5, 'Gnome', Mg],
    [8, 6, 'Fire fox', Fi], [8, 7, 'Crab', P], [8, 8, 'Green phantom', Mg], [8, 9, 'Spear goblin', P], [8, 10, 'Slime', Po], [8, 11, 'Rock face', P],
    [9, 0, 'Swamp lizard', Po], [9, 1, 'Man-eater', Po], [9, 2, 'Hunter', P], [9, 3, 'Cyclops', P], [9, 4, 'Orc soldier', P], [9, 5, 'Pit fighter', P],
    [9, 6, 'Red warrior', P], [9, 7, 'Mimic', P], [9, 8, 'Greater mimic', P], [9, 9, 'Drakeling', Fi], [9, 10, 'Red archer', P], [9, 11, 'Violet knight', Mg],
    [10, 0, 'Leviathan', Fr], [10, 1, 'Sea urchin', Po], [10, 2, 'Palm walker', P], [10, 3, 'Roc', P], [10, 4, 'Wyvern', P], [10, 5, 'Kraken', Fr],
    [10, 7, 'Purple serpent', Po], [10, 8, 'Hydra', Fr], [10, 9, 'Blob beast', Po], [10, 10, 'Blue djinn', Mg],
    [11, 0, 'Pink worm', Po], [11, 1, 'Fire djinn', Fi], [11, 2, 'Water djinn', Fr], [11, 3, 'Sand djinn', Mg], [11, 4, 'Storm djinn', Sh],
    [11, 7, 'Glass golem', Sh], [11, 9, 'Naga', Mg], [11, 10, 'Frost harpy', Fr], [11, 11, 'Stone ape', P],
    [12, 0, 'Grey monk', Mg], [12, 1, 'Red monk', Fi], [12, 2, 'Blood monk', Fi], [12, 3, 'Cursed sword', P], [12, 4, 'Mummy', Po], [12, 5, 'White ape', Fr],
    [12, 6, 'Blue maw', Mg], [12, 7, 'Wasp swarm', Po], [12, 8, 'Gold golem', P], [12, 10, 'Vulture', P], [12, 11, 'Night bat', P],
    [13, 0, 'Red duchess', Mg], [13, 1, 'Living statue', P], [13, 2, 'Black rider', P], [13, 3, 'Night stalker', Mg], [13, 4, 'Ninja', P], [13, 5, 'Soldier', P],
    [13, 6, 'Swordmaster', P], [13, 7, 'Red mask', Fi], [13, 8, 'Blue mask', Fr], [13, 9, 'Bronze mask', P], [13, 10, 'Pink mask', Mg], [13, 11, 'Violet mask', Mg],
    [14, 0, 'Purple idol', Mg], [14, 1, 'Ice spider', Fr], [14, 3, 'Pegasus', Sh], [14, 4, 'Triton', Fr], [14, 5, 'Amazon', P], [14, 6, 'Minotaur', P],
    [14, 8, 'Golden warrior', P], [14, 9, 'Boulder', P], [14, 10, 'Succubus', Mg], [14, 11, 'Dancer', Mg],
    [15, 0, 'Reaper', Mg], [15, 1, 'Skeleton archer', P], [15, 2, 'Knight', P], [15, 3, 'Barbarian king', P], [15, 4, 'Dark knight', Mg], [15, 5, 'Blue knight', P],
    [15, 7, 'Sorcerer', Mg], [15, 9, 'Valkyrie', Sh], [15, 10, 'Water nymph', Fr], [15, 11, 'Dryad', Po],
  ];
  // Each region's finale has its own monster.
  const FINALE_SPRITES = [[14, 2, Mg], [0, 7, P], [15, 8, Fr], [5, 0, P], [11, 6, Fr], [11, 5, Fi], [10, 6, Sh], [7, 9, Fr], [5, 7, Mg], [10, 11, Mg]];
  const ADJECTIVES = ['Rotting', 'Savage', 'Ancient', 'Blighted', 'Furious', 'Hollow', 'Gilded', 'Twisted', 'Scarred', 'Venomous', 'Colossal', 'Cursed', 'Frenzied', 'Iron-clad', 'Starving', 'Grim'];
  const PASSIVES = {
    thorns: v => `Thorns: reflects ${v}% of damage taken.`,
    multishot: v => `Multishot: ${v}% chance for an attack to strike twice.`,
    prismatic: v => `Prismatic: critical hits also burn for ${v}% more.`,
    overflow: v => `Overflow: overhealing becomes a shield, up to ${v}% of HP.`,
    lifesteal: v => `Lifesteal: heals you for ${v}% of damage dealt.`,
    bleed: v => `Bleed: hits bleed for ${v}% more over 3 seconds.`,
    burn: v => `Burn: hits burn for ${v}% more over 3 seconds.`,
    surge: v => `Surge: ${v}% chance for a heal to be doubled.`,
  };
  const DIFFICULTIES = [
    { id: 'normal', name: 'Normal', hp: 1, dmg: 1, xp: 1, drop: 1, mats: 1, colour: '#5fd068' },
    { id: 'heroic', name: 'Heroic', hp: 1.3, dmg: 1.2, xp: 1.4, drop: 1.6, mats: 1.3, colour: '#4f8ff0' },
    { id: 'mythic', name: 'Mythic', hp: 1.65, dmg: 1.4, xp: 1.9, drop: 2.3, mats: 1.7, colour: '#ff9a3c' },
  ];
  const DIFF_BY_ID = Object.fromEntries(DIFFICULTIES.map(d => [d.id, d]));
  // bossKillS / trashKillS: seconds a reference pilot (matching crafted gear) needs to kill a boss or
  // a trash wave at the start of a region. deathS: seconds of that enemy damage the pilot survives.
  // frenzyS: after this long in the boss wave (a third of it for a trash wave) enemies hit harder every 10 seconds.
  const FIGHT = { respawnMs: 25000, waveGapMs: 1500, gapMs: 3000, safetyMs: 20 * 60000, bossKillS: 40, trashKillS: 9, deathS: 38, frenzyS: 100 };
  // Raid strength through a region, relative to the region's reference pilot: start + rise * (k/24)^shape.
  // region: extra strength per region (up to the 6th), since gear percentages (block, crit) grow with tier.
  // first: the first region is gentler while pilots learn the game.
  const RAID_CURVE = { start: 0.75, rise: 0.82, shape: 1.3, finale: 1.0, region: 0.035, first: 0.95 };
  // No size limit. Enemy HP grows with every pilot; enemy damage grows gently up to 4 pilots, then
  // by each extra pilot's share, so a big party isn't safer per pilot than a party of four.
  const PARTY = { max: Infinity, hpPerExtra: 0.75, dmgPerExtra: 0.22, dmgPerExtraBig: 0.42, extraFoesMax: 6 };
  const partyDmg = n => 1 + PARTY.dmgPerExtra * (Math.min(n, 4) - 1) + PARTY.dmgPerExtraBig * Math.max(0, n - 4);

  // ---------- Items ----------
  // Icon variants: each item base has several game-icons shapes; higher tiers use later ones.
  const VARIANTS = { sword: 10, axe: 9, mace: 7, greatsword: 6, shortbow: 2, longbow: 2, crossbow: 2, daggers: 6, wand: 4, staff: 3, sceptre: 3, crystal: 4,
    scroll: 3, tome: 4, codex: 4, lantern: 4, shield: 9, quiver: 3, orb: 5, relic: 5, plate_head: 7, plate_body: 5, plate_legs: 3, plate_hands: 2, plate_feet: 2,
    leather_head: 4, leather_body: 4, leather_legs: 2, leather_hands: 3, leather_feet: 3, cloth_head: 4, cloth_body: 3, cloth_legs: 2, cloth_hands: 1, cloth_feet: 2,
    vest_head: 4, vest_body: 3, vest_legs: 1, vest_hands: 1, vest_feet: 1, sigil: 10, trinket: 10, mat: 10 };
  const iconFor = (base, n) => `${base}_${Math.min(VARIANTS[base] - 1, Math.floor((n - 1) * VARIANTS[base] / 10))}`;
  const scaleExtra = (extra, n, share = 1) => Object.fromEntries(Object.entries(extra || {}).map(([k, v]) => [k, round1(v * share * (1 + 0.1 * (n - 1)))]));

  const ITEMS = {};
  const item = (id, o) => { ITEMS[id] = Object.assign({ id }, o); };
  const MAT_KEYS = ['ore', 'hide', 'bone', 'venom', 'branch', 'fibre', 'essence', 'herb'];
  const matId = (key, t) => (key === 'reed' ? 'reed' : `${t.id}_${key}`);
  const MAT_INFO = {
    ore: t => [t.ore, 'ore', `Mined at Mining ${t.level}. For Smithing, Armoursmithing and Honing.`],
    hide: t => [t.hide, 'hide', `From hunting the ${t.beast.toLowerCase()} at Hunting ${t.level}. For Leatherworking and Fletching.`],
    bone: t => [t.bone, 'bone', `From hunting the ${t.beast.toLowerCase()} at Hunting ${t.level}. For Fletching.`],
    venom: t => [t.venom, 'venom', `Sometimes found hunting the ${t.beast.toLowerCase()}. For Poisoncraft and throwing daggers.`],
    branch: t => [t.branch, 'branch', `Foraged at Foraging ${t.level}. For Enchanting.`],
    fibre: t => [t.fibre, 'fibre', `Foraged at Foraging ${t.level}. For Tailoring.`],
    essence: t => [t.essence, 'essence', 'Sometimes found foraging. For Runecrafting and Enchanting.'],
    herb: t => [t.herb, 'herb', `Gathered at Herbalism ${t.level}. For Scribing, Weaving and Alchemy.`],
  };

  item('gold', { name: 'Gold', type: 'resource', icon: 'gold', colour: '#f2c14e', desc: 'Raid bosses drop it.' });
  item('reed', { name: 'Reed', type: 'resource', icon: 'reed', colour: '#c9d08a', desc: 'Gathered alongside herbs. Used for scrolls, vestments and potions.' });
  TIERS.forEach(t => MAT_KEYS.forEach(k => {
    const [name, icon, desc] = MAT_INFO[k](t);
    item(matId(k, t), { name, type: 'resource', icon, colour: t.colour, tier: t.n, desc: `Tier ${t.n}. ${desc}` });
  }));
  REGIONS.forEach((reg, i) => {
    const t = TIERS[i];
    item(`mat_${t.n}`, { name: reg.mat, type: 'material', icon: `mat_${i}`, colour: t.colour, tier: t.n,
      desc: `Dropped by raids in ${reg.name}. Needed for ${t.n < 10 ? `tier ${t.n + 1} gear and ` : ''}the tier ${t.n} sigil.` });
  });

  // Consumables.
  CONSUMABLES.forEach(c => {
    const t = TIERS[c.tier - 1];
    const who = c.cls ? `${CLASSES[c.cls].name} only. ` : '';
    const what = c.potion === 'hp' ? `Drunk automatically when your HP drops below 40%. Restores ${Math.round(c.heal * 100)}% HP. Up to three potions per fight.`
      : c.potion === 'mp' ? `Drunk automatically when your mana runs low. Restores ${c.mana} mana. Up to three potions per fight.`
        : `Fight buff: ${describe(c.boost)} for one fight.`;
    item(c.id, { name: c.name, type: 'consumable', icon: c.icon, colour: t.colour, tier: c.tier, supply: true, cls: c.cls || null,
      heal: c.heal, mana: c.mana, potion: c.potion, boost: c.boost, desc: `${who}${what}` });
  });

  // Traits: each crafted tier of a weapon or armour piece gets one, named in the item, so a lower
  // tier can still be the better pick for its trait.
  const WEAPON_TRAITS = [
    ['Keen', { crit: 3 }], ['Swift', { haste: 4 }], ['Brutal', { critDmg: 12 }], ['Piercing', { pen: 8 }], ['Vampiric', { lifesteal: 2.5 }],
    ['Serrated', { bleed: 8 }], ['Searing', { fire: 5, burn: 6 }], ['Frigid', { frost: 6 }], ['Thundering', { shock: 6 }], ['Venomous', { poison: 8 }],
  ];
  const HEALER_TRAITS = [['Blessed', { heal: 5 }], ['Serene', { regen: 1 }], ['Radiant', { power: 4 }], ['Swift', { haste: 4 }], ['Hallowed', { mana: 25 }], ['Surging', { crit: 3 }], ['Warded', { mres: 6 }]];
  const ARMOUR_TRAITS = [['Sturdy', { defPct: 3 }], ['Vital', { hpPct: 3 }], ['Warded', { mres: 6 }], ['Insulated', { eres: 6 }], ['Nimble', { haste: 2 }],
    ['Focused', { regen: 0.5 }], ['Deadly', { crit: 1.5 }], ['Mighty', { power: 2 }]];
  const FLAT_TRAIT = ['mres', 'eres', 'mana'];
  function addTrait(id, list, k) {
    const it = ITEMS[id];
    const [name, stats] = list[k % list.length];
    const added = {};
    Object.entries(stats).forEach(([s, v]) => {
      added[s] = FLAT_TRAIT.includes(s) ? Math.round(v * TIERS[it.tier - 1].mult) : round1(v * (1 + 0.12 * (it.tier - 1)));
      it.stats[s] = round1((it.stats[s] || 0) + added[s]);
    });
    it.trait = name;
    it.name = `${name} ${it.name.charAt(0).toLowerCase()}${it.name.slice(1)}`;
    it.desc += ` ${name}: ${describe(added)}.`;
  }

  // Gear.
  TIERS.forEach(t => {
    const n = t.n;
    WEAPON_KINDS.forEach(w => {
      const name = w.cls === 'melee' ? `${t.metal} ${w.noun}` : w.cls === 'ranged' ? `${t.bow} ${w.noun}` : w.cls === 'magic' ? `${t.wood} ${w.noun}` : `${t.order} ${w.noun}`;
      item(`${t.id}_${w.id}`, { name, type: 'gear', slot: 'weapon', weapon: w.id, cls: w.cls, icon: iconFor(w.id, n), colour: t.colour, tier: n, twoHanded: !!w.twoHanded,
        stats: { atk: Math.round(100 * t.mult * (w.twoHanded ? 1.35 : 1)), ...scaleExtra(w.extra, n) }, desc: `Tier ${n} ${CLASSES[w.cls].name.toLowerCase()} weapon. ${w.note}` });
    });
    OFFHAND_KINDS.forEach(o => {
      const name = o.cls === 'melee' ? `${t.metal} ${o.noun}` : o.cls === 'ranged' ? `${t.leather} ${o.noun}` : o.cls === 'magic' ? `${t.wood} ${o.noun}` : `${t.order} ${o.noun}`;
      const stats = Object.fromEntries(Object.entries(o.stats).map(([k, v]) => [k, Math.round(v * t.mult)]));
      item(`${t.id}_${o.id}`, { name, type: 'gear', slot: 'offhand', offhand: o.id, cls: o.cls, icon: iconFor(o.id, n), colour: t.colour, tier: n,
        stats: { ...stats, ...scaleExtra(o.extra, n) }, desc: `Tier ${n} ${CLASSES[o.cls].name.toLowerCase()} off-hand. ${o.note} An off-hand from another class also lets you equip that class’s abilities.` });
    });
    Object.entries(ARMOUR_TYPES).forEach(([type, a]) => ARMOUR_SLOTS.forEach(slot => {
      const share = SLOT_SHARE[slot];
      const stats = {};
      Object.entries(a.total).forEach(([k, v]) => { stats[k] = Math.max(1, Math.round(v * t.mult * share)); });
      Object.entries(a.pct || {}).forEach(([k, [base, per]]) => { stats[k] = round1((base + per * (n - 1)) * share * 1.6); });
      Object.entries(a.flat || {}).forEach(([k, [base, per]]) => { stats[k] = round1((base + per * (n - 1)) * share * 1.6); });
      item(`${t.id}_${type}_${slot}`, { name: `${tierLabel(t, type)} ${a.nouns[slot]}`, type: 'gear', slot, armour: type, icon: iconFor(`${a.icon}_${slot}`, n), colour: t.colour, tier: n, stats,
        desc: `Tier ${n} ${a.name.toLowerCase()} armour. 3 ${a.name.toLowerCase()} pieces: ${a.bonus3.name}; all 5: ${a.bonus5.name}.` });
    }));
    // Every crafted tier of a piece has its own trait, so tiers differ in more than size.
    WEAPON_KINDS.forEach((w, wi) => addTrait(`${t.id}_${w.id}`, w.cls === 'healer' ? HEALER_TRAITS : WEAPON_TRAITS, n + wi));
    OFFHAND_KINDS.forEach((o, oi) => addTrait(`${t.id}_${o.id}`, o.cls === 'healer' ? HEALER_TRAITS : ARMOUR_TRAITS, n + oi * 3));
    Object.keys(ARMOUR_TYPES).forEach((type, ti) => ARMOUR_SLOTS.forEach((slot, si) =>
      addTrait(`${t.id}_${type}_${slot}`, type === 'vestment' ? HEALER_TRAITS : ARMOUR_TRAITS, n + si * 2 + ti)));
    const reg = REGIONS[n - 1];
    item(`sigil_${n}`, { name: `${reg.mat.split(' ')[0]} sigil`, type: 'gear', slot: 'trinket', icon: iconFor('sigil', n), colour: t.colour, tier: n,
      stats: { power: 2 + 2 * n, hpPct: 2 + 2 * n }, desc: `A trinket carved from ${reg.mat.toLowerCase()}s with Runecrafting.` });
    // Raid set pieces: one set per class, a little stronger than crafted armour of the tier.
    Object.values(reg.sets).forEach(set => {
      const at = ARMOUR_TYPES[set.type];
      ['head', 'body', 'legs'].forEach(slot => {
        const base = ITEMS[`${t.id}_${set.type}_${slot}`].stats;
        const stats = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, STATS[k] && STATS[k].pct ? round1(v * 1.3) : Math.round(v * 1.25)]));
        item(`set${n}_${set.cls}_${slot}`, { name: `${set.name} ${at.nouns[slot]}`, type: 'gear', slot, armour: set.type, set: set.id, icon: iconFor(`${at.icon}_${slot}`, Math.min(10, n + 2)),
          colour: t.colour, tier: n, rare: true, stats, desc: `Raid set piece from ${reg.name}, made for ${CLASSES[set.cls].name.toLowerCase()} pilots. Counts as ${at.name.toLowerCase()} armour.` });
      });
    });
    // Raid weapons: one per class, hitting like a weapon half a tier higher, with a passive.
    Object.entries(UNIQUE_KINDS).forEach(([cls, kinds]) => {
      const w = WEAPON_BY_ID[kinds[(n - 1) % kinds.length]];
      const base = ITEMS[`${t.id}_${w.id}`].stats;
      item(`u${n}_${cls}`, { name: `${reg.theme}${UNIQUE_SUFFIX[cls]} ${w.noun}`, type: 'gear', slot: 'weapon', weapon: w.id, cls, icon: iconFor(w.id, Math.min(10, n + 3)),
        colour: t.colour, tier: n, rare: true, twoHanded: !!w.twoHanded, stats: { atk: Math.round(base.atk * 1.3), ...scaleExtra(w.extra, n + 2) }, passives: UNIQUE_PASSIVE[cls](n - 1),
        desc: `A rare ${CLASSES[cls].name.toLowerCase()} weapon from ${reg.name}. ${w.note}` });
    });
    item(`trinket_${n}`, { name: reg.trinket.name, type: 'gear', slot: 'trinket', icon: `trinket_${n - 1}`, colour: t.colour, tier: n, rare: true,
      stats: reg.trinket.stats, passives: reg.trinket.passives, desc: `A rare trinket from ${reg.name}.` });
    item(`charm_${n}`, { name: reg.charm.name, type: 'gear', slot: 'trinket', icon: `trinket_${(n + 4) % 10}`, colour: t.colour, tier: n, rare: true,
      stats: reg.charm.stats, desc: `A rare trinket from ${reg.name}.` });
  });

  // ---------- Actions ----------
  // XP per second of activity rises through the tiers, tuned so reaching the end takes about four days.
  const XP_RATE = [0.8, 1.5, 2, 2.4, 2.8, 3.1, 3.4, 3.6, 3.8, 4];
  const ACTIONS = [];
  const action = o => ACTIONS.push(Object.assign({ inputs: {}, chance: [] }, o));
  const tierInputs = (t, mats) => Object.fromEntries(Object.entries(mats).map(([k, v]) => [matId(k, t), v]));
  const matCount = inputs => Object.values(inputs).reduce((a, v) => a + v, 0);
  const craftXp = (t, inputs, time) => Math.round(XP_RATE[t.n - 1] * (time / 1000 + 3 * matCount(inputs)) * 0.9);

  TIERS.forEach((t, i) => {
    const r = XP_RATE[i];
    action({ id: `mine_${t.id}`, skill: 'mining', name: t.vein, level: t.level, time: 3000, xp: Math.round(r * 3), item: matId('ore', t), outputs: { [matId('ore', t)]: [1, 1] } });
    action({ id: `hunt_${t.id}`, skill: 'hunting', name: t.beast, level: t.level, time: 3500, xp: Math.round(r * 3.5 * 1.1), item: matId('hide', t),
      outputs: { [matId('hide', t)]: [1, 1], [matId('bone', t)]: [1, 1] }, chance: [{ item: matId('venom', t), p: 0.4, qty: 1 }] });
    action({ id: `forage_${t.id}`, skill: 'foraging', name: t.grove, level: t.level, time: 3500, xp: Math.round(r * 3.5 * 1.1), item: matId('branch', t),
      outputs: { [matId('branch', t)]: [1, 1], [matId('fibre', t)]: [1, 1] }, chance: [{ item: matId('essence', t), p: 0.4, qty: 1 }] });
    action({ id: `herb_${t.id}`, skill: 'herbalism', name: t.patch, level: t.level, time: 3000, xp: Math.round(r * 3 * 1.1), item: matId('herb', t),
      outputs: { [matId('herb', t)]: [1, 1], reed: [1, 2] } });
  });

  // Gear recipes: tier materials, plus the previous region's raid material from tier 2 on.
  const raidMat = t => (t.n > 1 ? { [`mat_${t.n - 1}`]: 1 + Math.floor(t.n / 3) } : {});
  TIERS.forEach(t => {
    WEAPON_KINDS.forEach(w => {
      const id = `${t.id}_${w.id}`;
      const inputs = { ...tierInputs(t, w.mats), ...raidMat(t) };
      action({ id: `craft_${id}`, skill: w.maker, name: ITEMS[id].name, level: Math.max(1, t.level + w.offset), time: 4000, xp: craftXp(t, inputs, 4000), item: id, inputs, outputs: { [id]: [1, 1] } });
    });
    OFFHAND_KINDS.forEach(o => {
      const id = `${t.id}_${o.id}`;
      const inputs = { ...tierInputs(t, o.mats), ...raidMat(t) };
      action({ id: `craft_${id}`, skill: o.maker, name: ITEMS[id].name, level: t.level + o.offset, time: 4000, xp: craftXp(t, inputs, 4000), item: id, inputs, outputs: { [id]: [1, 1] } });
    });
    Object.entries(ARMOUR_TYPES).forEach(([type, a]) => ARMOUR_SLOTS.forEach(slot => {
      const id = `${t.id}_${type}_${slot}`;
      const mats = type === 'vestment' ? { reed: SLOT_MATS[slot], herb: Math.ceil(SLOT_MATS[slot] / 3) } : { [a.mat]: SLOT_MATS[slot] };
      const inputs = { ...tierInputs(t, mats), ...raidMat(t) };
      action({ id: `craft_${id}`, skill: a.maker, name: ITEMS[id].name, level: t.level + SLOT_OFFSET[slot], time: 4000, xp: craftXp(t, inputs, 4000), item: id, inputs, outputs: { [id]: [1, 1] } });
    }));
    const sid = `sigil_${t.n}`;
    const sInputs = { [`mat_${t.n}`]: 4, [matId('essence', t)]: 3 };
    action({ id: `craft_${sid}`, skill: 'runecrafting', name: ITEMS[sid].name, level: t.level + 5, time: 5000, xp: craftXp(t, sInputs, 5000), item: sid, inputs: sInputs, outputs: { [sid]: [1, 1] } });
  });
  CONSUMABLES.forEach(c => {
    const t = TIERS[c.tier - 1];
    const inputs = tierInputs(t, c.inputs);
    action({ id: `brew_${c.id}`, skill: c.skill, name: c.name, level: c.level, time: 3000, xp: craftXp(t, inputs, 3000), item: c.id, inputs, outputs: { [c.id]: [2, 2] } });
  });
  const ACTION_BY_ID = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

  // ---------- Mech stats ----------
  // HP and damage are on a x10 scale (so hits read 10-70, not 1-7); armour and resists are percentages-based and unscaled.
  const BASE = { atk: 50, def: 4, hp: 1200, mres: 2, eres: 2, mana: 100, regen: 3 };
  const PCT_KEYS = ['crit', 'critDmg', 'power', 'heal', 'haste', 'pen', 'block', 'double', 'bleed', 'burn', 'poison', 'fire', 'frost', 'shock', 'lifesteal', 'defPct', 'hpPct', 'enemyDmg'];

  // opts: { boosts: stats from fight buffs, subclass: subclass id }
  function mechStats(equipment, levels, opts) {
    const o = opts || {};
    const s = { ...BASE };
    PCT_KEYS.forEach(k => { s[k] = 0; });
    const passives = {};
    const types = {}, sets = {};
    const add = (stats, pas) => {
      Object.entries(stats || {}).forEach(([k, v]) => { if (typeof v === 'number' && k in s) s[k] += v; });
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
      const a = ARMOUR_TYPES[type];
      if (n >= 3) { add(a.bonus3); bonuses.push(`${a.bonus3.name} (3 ${a.name.toLowerCase()}): ${describe(a.bonus3)}`); }
      if (n >= 5) { add(a.bonus5); bonuses.push(`${a.bonus5.name} (5 ${a.name.toLowerCase()}): ${describe(a.bonus5)}`); }
    });
    Object.entries(sets).forEach(([id, count]) => {
      const set = SET_BY_ID[id];
      if (count >= 2) { add(set.two); bonuses.push(`${set.name} (2): ${describe(set.two)}`); }
      if (count >= 3) { add(set.three, set.three.passives); bonuses.push(`${set.name} (3): ${Object.entries(set.three.passives).map(([k, v]) => PASSIVES[k](v)).join(' ')}`); }
    });
    const weaponItem = ITEMS[equipment && equipment.weapon];
    const weapon = weaponItem ? WEAPON_BY_ID[weaponItem.weapon] : null;
    const offItem = ITEMS[equipment && equipment.offhand];
    const cls = weapon ? weapon.cls : 'melee';
    const sub = o.subclass && SUBCLASS_BY_ID[o.subclass];
    if (sub && sub.cls === cls) { add(sub.stats); bonuses.push(`${sub.name}: ${sub.desc}`); }
    add(o.boosts);
    const lv = k => (levels && levels[k]) || 1;
    const skill = CLASSES[cls].skill;
    return {
      atk: Math.round(s.atk * (1 + s.power / 100) * skillMult(lv(skill))),
      def: Math.round(s.def * (1 + s.defPct / 100)),
      hp: Math.round(s.hp * (1 + s.hpPct / 100)),
      mres: Math.round(s.mres), eres: Math.round(s.eres), mana: Math.round(s.mana), regen: round1(s.regen),
      crit: s.crit / 100, critDmg: s.critDmg / 100, heal: s.heal / 100, haste: s.haste / 100, pen: Math.min(0.8, s.pen / 100),
      block: Math.min(0.5, s.block / 100), double: s.double / 100, bleed: s.bleed / 100, burn: s.burn / 100, poison: s.poison / 100,
      fire: s.fire / 100, frost: s.frost / 100, shock: s.shock / 100, lifesteal: s.lifesteal / 100, enemyDmg: s.enemyDmg / 100,
      power: s.power, passives, bonuses,
      weapon: weapon ? weapon.id : null, offhand: offItem ? offItem.offhand : null, offCls: offItem ? offItem.cls : null,
      cls, role: cls, skill, subclass: sub && sub.cls === cls ? sub.id : null,
    };
  }
  const power = s => Math.round(Math.sqrt(Math.max(1, s.atk * (1 + (s.crit || 0) * 0.75) * (1 + (s.haste || 0))) * s.hp * (100 + (s.def || 0)) / 100) / 4);

  // A full set of a tier's crafted gear for a class, used to set raid difficulty and in tests.
  const CLASS_KIT = { melee: ['sword', 'shield', 'plate'], ranged: ['shortbow', 'quiver', 'leather'], magic: ['wand', 'orb', 'cloth'], healer: ['tome', 'relic', 'vestment'] };
  function kit(cls, tierN, sigil = tierN - 1) {
    const t = TIERS[tierN - 1];
    const [w, off, type] = CLASS_KIT[cls];
    const eq = { weapon: `${t.id}_${w}`, offhand: `${t.id}_${off}` };
    ARMOUR_SLOTS.forEach(slot => { eq[slot] = `${t.id}_${type}_${slot}`; });
    if (sigil > 0) eq.trinket = `sigil_${sigil}`;
    return eq;
  }

  // ---------- Raids ----------
  // Raids in a region get harder from start to finish: the first ones suit that region's crafted
  // gear, the last ones need gear from the next tier (made with this region's raid material and
  // higher skill levels). A pilot with matching gear wins early raids comfortably and starts to
  // lose around the middle of the region.
  const RAIDS = [];
  // The roster minus the finales' monsters, shuffled once, dealt out in order across all raids.
  const BOSS_DECK = (() => {
    const taken = new Set(FINALE_SPRITES.map(([r, c]) => `${r},${c}`));
    const deck = BOSS_ROSTER.filter(([r, c]) => !taken.has(`${r},${c}`));
    const rand = rng(424242);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    return deck;
  })();
  // Gear drops by difficulty: the best piece (listed first: raid weapon, then trinkets, then set
  // pieces) only drops on Mythic, the next two on Heroic or Mythic, the rest on any difficulty.
  // Mythic drops everything.
  const gearByDifficulty = drops => drops.map((d, i) => (i === 0 ? { ...d, minDiff: 'mythic' } : i <= 2 ? { ...d, minDiff: 'heroic' } : d));
  const COMBAT_XP = [32, 138, 280, 453, 651, 860, 1087, 1338, 1589, 1650];
  const CLASS_IDS = ['melee', 'ranged', 'magic', 'healer'];
  REGIONS.forEach((reg, ri) => {
    const t = TIERS[ri];
    const ref = mechStats(kit('melee', t.n), { melee: t.level + 5 });
    const pickRand = rng(1000 + ri);
    for (let k = 0; k < 25; k++) {
      const g = ri * 25 + k;
      const rand = rng(7919 * (g + 1));
      const pick = list => list[Math.floor(rand() * list.length)];
      const finale = k === 24;
      const f = (RAID_CURVE.start + RAID_CURVE.rise * Math.pow(k / 24, RAID_CURVE.shape)) * (finale ? RAID_CURVE.finale : 1) * (1 + RAID_CURVE.region * Math.min(ri, 5)) * (ri === 0 ? RAID_CURVE.first : 1);
      const bossFoe = reg.bosses[0];
      // This raid's boss: the next monster from the shuffled roster (a region never repeats one).
      const pick0 = finale ? null : BOSS_DECK[(ri * 24 + k) % BOSS_DECK.length];
      const reuse = !finale && ri * 24 + k >= BOSS_DECK.length;
      const adj = finale ? null : ADJECTIVES[Math.floor(pickRand() * ADJECTIVES.length)];
      const sprite = finale ? FINALE_SPRITES[ri].slice(0, 2) : pick0.slice(0, 2);
      const spriteHue = reuse ? 60 + 70 * (ri % 4) : 0;
      const styles = ['melee', 'ranged', 'magic'];
      const weak = styles[Math.floor(rand() * 3)];
      const resist = styles.filter(x => x !== weak)[Math.floor(rand() * 2)];
      const elements = ['fire', 'frost', 'shock', 'poison'];
      const def = Math.round(10 * t.mult * (0.8 + rand() * 0.45));
      const mres = Math.round(def * (0.5 + rand()));
      const eres = Math.round(def * (0.5 + rand()));
      const refDps = ref.atk * 100 / (100 + def);
      const dtype = finale ? FINALE_SPRITES[ri][2] : pick0[3];
      const resistOf = type => (type === 'physical' ? ref.def : type === 'magic' ? ref.mres : ref.eres);
      const dpsFor = type => Math.round(ref.hp * (100 + resistOf(type)) / 100 / FIGHT.deathS * f * 10) / 10;
      // Boss mechanics: one for the first few raids, two after, three (always including adds) for a finale.
      const mechs = [];
      if (finale) mechs.push('summon');
      while (mechs.length < (finale ? 3 : k < 3 ? 1 : 2)) { const m = pick(MECH_POOL); if (!mechs.includes(m)) mechs.push(m); }
      const cost = 1 + mechs.reduce((a, m) => a + MECHANICS[m].cost, 0);
      // Loot: every boss has its own table.
      const res = [];
      while (res.length < 2) { const m = pick(MAT_KEYS); if (!res.includes(m)) res.push(m); }
      const cons = pick(CONSUMABLES.filter(c => c.tier <= t.n));
      const slot = () => pick(['head', 'body', 'legs']);
      const setDrops = finale
        ? CLASS_IDS.map(cls => ({ item: `set${t.n}_${cls}_${slot()}`, qty: [1, 1], p: 0.15, rare: true }))
        : [CLASS_IDS[k % 4], CLASS_IDS[(k + 2) % 4]].map(cls => ({ item: `set${t.n}_${cls}_${slot()}`, qty: [1, 1], p: 0.1, rare: true }));
      const uniqueDrops = finale
        ? [CLASS_IDS[Math.floor(rand() * 4)]].concat(CLASS_IDS[Math.floor(rand() * 4)]).filter((c, i, a) => a.indexOf(c) === i).map(cls => ({ item: `u${t.n}_${cls}`, qty: [1, 1], p: 0.08, rare: true }))
        : [{ item: `u${t.n}_${CLASS_IDS[(k + 1) % 4]}`, qty: [1, 1], p: 0.05, rare: true }];
      const trinketDrops = finale
        ? [{ item: `trinket_${t.n}`, qty: [1, 1], p: 0.08, rare: true }, { item: `charm_${t.n}`, qty: [1, 1], p: 0.08, rare: true }]
        : [{ item: k % 2 ? `trinket_${t.n}` : `charm_${t.n}`, qty: [1, 1], p: 0.05, rare: true }];
      RAIDS.push({
        id: `r${g + 1}`, n: g + 1, region: ri, tier: t.n, k,
        name: finale ? reg.finale : `${adj} ${pick0[2].toLowerCase()}`, sprite, spriteHue,
        regionName: reg.name, foe: bossFoe, finale,
        res: { [weak]: 1.15, [resist]: 0.88 }, weakElement: elements[Math.floor(rand() * 4)],
        boss: { hp: Math.round(refDps * FIGHT.bossKillS * f / cost / 10) * 10, def, mres, eres, dps: Math.round(dpsFor(dtype) / Math.sqrt(cost) * 10) / 10, dtype, mechs },
        trash: { pool: reg.trash, maxWaves: 1 + Math.floor(k / 6), hp: Math.round(refDps * FIGHT.trashKillS * f), dps: Math.round(dpsFor('physical') * 0.6 * 10) / 10,
          def: Math.round(def * 0.7), mres: Math.round(mres * 0.7), eres: Math.round(eres * 0.7) },
        moves: { basic: finale ? 'Crushing blow' : 'Strike' },
        // Power needed per difficulty: the rating grows slower than fight difficulty (abilities,
        // subclass and set bonuses aren't in it), so the curve is compressed.
        recommended: Math.round(power(ref) * Math.pow(f, 0.6)),
        recommendedBy: Object.fromEntries(DIFFICULTIES.map(d => [d.id, Math.round(power(ref) * Math.pow(f * Math.sqrt(d.hp * d.dmg), 0.6))])),
        xp: Math.round(COMBAT_XP[ri] * (0.85 + 0.3 * k / 24) * (finale ? 1.5 : 1)),
        drops: [
          { item: `mat_${t.n}`, qty: [1, 2 + Math.floor(k / 12)] },
          { item: 'gold', qty: [Math.round(5 * t.mult), Math.round(12 * t.mult)] },
          { item: matId(res[0], t), qty: [2, 4] },
          { item: matId(res[1], t), qty: [1, 3] },
          { item: cons.id, qty: [1, 2], p: 0.3 },
          ...gearByDifficulty([...uniqueDrops, ...trinketDrops, ...setDrops]),
        ],
      });
    }
  });
  const RAID_BY_ID = Object.fromEntries(RAIDS.map(r => [r.id, r]));
  // Gear checks through a region, so progress alternates between crafting and raid gear:
  // raids 1-8 need nothing extra; raids 9-16 need 2 pieces of this region's raid gear (or better)
  // fitted; raids 17-24 need a next-tier weapon; the finale a next-tier weapon and 3 next-tier
  // armour pieces (tier 10 in the last region).
  // An off-hand from another class earns that class this share of each fight's XP.
  const OFFHAND_XP_SHARE = 0.3;
  const FINALE_ARMOUR = 3, RAID_GEAR_NEED = 2;
  const GEAR_STAGE = k => (k >= 24 ? 'finale' : k >= 16 ? 'next' : k >= 8 ? 'raid' : null);
  function gearCheck(equipment, raid) {
    const need = Math.min(10, raid.tier + 1);
    const stage = GEAR_STAGE(raid.k);
    const items = Object.values(equipment || {}).map(id => ITEMS[id]).filter(Boolean);
    const tierOf = slot => { const it = ITEMS[equipment && equipment[slot]]; return it ? it.tier || 0 : 0; };
    const raidPieces = items.filter(it => it.rare && (it.tier || 0) >= raid.tier).length;
    const weapon = tierOf('weapon') >= need;
    const armour = ARMOUR_SLOTS.filter(s => tierOf(s) >= need).length;
    if (stage === 'raid') return { ok: raidPieces >= RAID_GEAR_NEED, stage, raidPieces, short: `Needs ${RAID_GEAR_NEED} raid gear`,
      text: `Fit at least ${RAID_GEAR_NEED} pieces of raid gear from ${REGIONS[raid.region].name} or later (set pieces, raid weapons or trinkets). You have ${raidPieces}.` };
    if (stage === 'next') return { ok: weapon, stage, need, short: `Needs T${need} weapon`, text: `Fit a tier ${need} (or better) weapon, crafted with this region’s raid material.` };
    if (stage === 'finale') return { ok: weapon && armour >= FINALE_ARMOUR, stage, need, weapon, armour, short: `Needs T${need} gear`,
      text: `Fit a tier ${need} weapon and at least ${FINALE_ARMOUR} tier ${need} armour pieces. You have ${weapon ? 'the weapon' : 'no such weapon'} and ${armour} armour piece${armour === 1 ? '' : 's'}.` };
    return { ok: true, stage };
  }
  const finaleGear = gearCheck;

  const PATCH_NOTES = [
    { v: '0.11', date: '2026-09-29', notes: [
      'New setting (on by default): group damage numbers. Quick hits of the same type from the same pilot add up into one number with a ×count, so poison and other ticks don’t pile up.',
      'Multiclass (level 10) now lets you take a subclass from another class, if you have level 5 in that class. Off-hands already give you another class’s abilities, so Multiclass no longer does, and it no longer splits XP. Pick your borrowed subclass again on the Subclasses page.',
      'The gear picker on the Equipment page groups gear by class (your class first), with a coloured heading for each.',
      'Buffs and debuffs now show as icons above each unit’s name (buffs left, debuffs right) with the time left underneath and details on hover.',
      'Boss mechanics show as icons like your abilities: they pop when used, then count down to the next use.',
      'The damage meter, graph and raid log now share one panel pinned to the bottom of the raid screen (meter and graph on the left, log on the right). It opens upwards, remembers whether it’s open, and no longer makes the page jump when enemies are summoned. Units are more compact while it’s open.',
      'Skill XP bars are animated: they grow with each gain and glow, flash gold on a level-up, shimmer, and show the XP your current action is working towards as a striped segment.',
      'Damage meter and graph update much faster and look better: numbers count up smoothly, pilots slide up and down as their rank changes (gold, silver and bronze badges), bars glow in class colours, and the graph draws smooth filled curves with a pulsing marker at the live end.',
      'Raid screen abilities pop when used, then grey out with a clock sweep and a countdown underneath, and flash green when they’re ready again.',
      'Fixed raids and skills sometimes stopping after an update: your browser now refreshes its backup right after every action (and every 15 seconds), and a raid opened to friends or everyone carries on as a solo raid after an update instead of stopping.',
      'Skill pages show your level and XP bar full width under the title instead of squeezed into the corner.',
      'An off-hand from another class now trains that class too: it takes 30% of each fight’s XP, and the rest goes to your main class .',
      'Fixed damage-over-time numbers (bleed, burn, poison, shadow and others) squashing into a tiny box, and numbers near the edge of an enemy doing the same.',
      'In parties, each pilot’s damage numbers pop up in their own spot on the enemy (a grid with a cell per pilot), so they no longer pile on top of each other.',
      'New Settings page (above Log out): turn damage numbers, hit flashes, item shine and animations on or off, download a backup of your save, or reset your progress and start again.',
      'Damage over time (bleed, burn, poison, shadow, Rend and the like), chills and debuffs show under the target’s bars with the time left; buffs and heals over time show too. Buffs sit on the left, debuffs on the right.',
      'No more rainbow strobing in party fights: damage-over-time ticks don’t flash, and each unit flashes at most once every 0.6s.',
      'The status line at the top of every page is gone (the bar at the bottom shows the same), so pages sit higher on screen.',
      'Harder progression: each boss is now beaten on Normal, Heroic and Mythic before the next one opens. Raids you had already opened stay open.',
      'Heroic and Mythic are smaller steps up, and raid gear drops far more often (set pieces 10–15%, raid weapons and trinkets 5–8%).',
      'Gear checks through every region: raids 9–16 need 2 pieces of raid gear fitted, raids 17–24 a next-tier weapon, and the finale next-tier weapon and armour. Progress alternates between crafting and farming raid gear.',
      'Power is now a combat rating (damage × toughness), and recommended power is shown per difficulty, so Mythic no longer looks out of reach when it isn’t.',
      'Raid screen: pilots and enemies sit in two-column grids, and health and cast bars are taller and easier to read.',
      'Under each pilot’s bars: their fitted gear, abilities and subclass, each with details on hover. Hover a mech or an enemy to see its stats.',
      'Changing gear, abilities, subclass or supplies mid-raid takes effect straight away: the current fight starts over with your new loadout.',
      'A “Loot this session” row adds up everything you’ve won since you started raiding.',
      'The raid log keeps going across fights and only clears when you stop raiding or start a different raid.',
      'While a party raid is running, the party controls sit in the fight header instead of a separate box.',
      'Equipment: click a fitted slot to see the gear you could fit there, each compared with what you’re wearing. The old “Gear in storage” list is gone.',
      'New gear hover cards: a type pill, one stat per line, set bonuses showing how many pieces you have (3/5), and where the item comes from.',
      'Crafted gear and materials take their tier’s colour, so tiers are easy to tell apart. Leg armour now shows trousers instead of boots or robes.',
      'Your mech shows more of its gear: higher tiers add crests, horns, spikes, emblems and knee guards, raid gear has gold trim, vestments a sash, and gloves and boots differ by armour type.',
      'Item shine is constant and gentler.',
      'Inventory splits gear into a row per slot.',
      'Ability cards no longer squash their text next to a requirement.',
    ] },
    { v: '0.10', date: '2026-09-29', notes: [
      'A bar at the bottom of the screen shows what you’re doing, with its progress, how many are left, your queue and a Stop button.',
      'Crafted items appear the moment the bar fills, instead of a few seconds later.',
      'Lots more animation: pages slide in, gains float up from the card at work, level-ups flash gold, the skill you’re training works away in the sidebar, rare and high-tier gear shines.',
      'Hovering gear in storage or your inventory compares it with what you have fitted.',
      'Inventory is grouped by type, with tier badges, names and hover details on every item.',
      'Equipment storage and supplies are laid out in a grid.',
      'Raid page: bigger rows with large boss portraits, loot split into materials and equipment, coloured difficulty buttons, filters to hide cleared or fully looted bosses, open parties only when there are some, and the raid log only during a raid.',
      'Fixed pages flashing every few seconds.',
      'Fixed the sidebar queue running off the edge with long item names.',
      'Fixed the sidebar progress bar jumping back and forth during raids.',
      'Who can join your raids (closed, friends and guild, or everyone) is remembered and applied to every raid you start.',
      'Fixed HP bars briefly showing health left after a pilot went down or an enemy died.',
    ] },
    { v: '0.9', date: '2026-09-29', notes: [
      'New monster art: every raid has its own boss, and enemies are drawn from a new sprite sheet.',
      'Fights are livelier: characters bob, lunge when attacking and flash in colour when hit (red for hits, purple for poison, green for healing and more).',
      'HP and damage are ten times bigger, so hits no longer show as a string of 1s. Fixed enemies attacking far too fast for tiny damage.',
      'Parties have no size limit; enemies scale with every pilot.',
      'Gear drops by difficulty: a boss’s best piece only drops on Mythic, the next two on Heroic or Mythic.',
      'The raid log has a header and summary for each fight, icons, ability crits and filter counts.',
    ] },
    { v: '0.8', date: '2026-09-29', notes: [
      'Your progress survives game updates: your browser keeps a backup of your save and restores it automatically, and saves are never deleted when content changes.',
      'New pixel-art icons for every item, different for each tier.',
      'Every crafted weapon and armour piece has a trait (Keen, Swift, Vampiric, Sturdy…) with its own bonus.',
      'A region’s finale needs next-tier gear fitted: a weapon and at least 3 armour pieces.',
      'Raid loot is coloured by the class that uses it.',
      'Gathering cards show how many of each item you own.',
      'Signing up and logging in are no longer blocked after a few attempts.',
    ] },
    { v: '0.7', date: '2026-09-28', notes: [
      'Raids are harder and can be lost: if every pilot is down at the same time, the fight is a defeat (a quarter of the XP, no loot).',
      'Raids get tougher through each region. The first raids suit the region’s crafted gear; the last ones need next-tier gear, made with that region’s raid material.',
      'Bosses have mechanics: cleaves, crushing blows, venom, mana drain, regeneration, summoned adds, shields and enrage. Every enemy frenzies if a wave drags on.',
      'Trash packs vary: swarms, brutes, casters, archers who ignore taunts, healers who mend their allies, and elite champions.',
      'Every region now has a raid set for each class, a raid weapon for each class and two trinkets. Each boss drops its own mix, shown on the raid list.',
      'Founding a guild is free.',
      'When a party leader leaves, the next pilot takes over instead of the party breaking up.',
    ] },
    { v: '0.6', date: '2026-09-28', notes: [
      '250 raids across 10 regions, each with trash waves before the boss, in Normal, Heroic and Mythic.',
      'Abilities: 7 per combat class and 7 generic ones. Equip 2 class abilities and 1 generic.',
      'Subclasses at level 5 (including the Shadowmender healer), or multiclass at level 10.',
      'Off-hand slot, hands and feet armour, and 10 material tiers with many more items to craft.',
      'New artisan skills: Honing, Poisoncraft, Runecrafting and Weaving.',
      'Mech colour now follows the class of your main weapon.',
      'Action queue: line up to 5 actions with a count each.',
      'Raids never time out; downed pilots respawn after 25 seconds and still share the loot.',
      'Raid screen: fight log, damage meter modes and breakdowns, hoverable DPS graph, animated bars.',
      '"Hull" is now called HP everywhere.',
    ] },
    { v: '0.5', date: '2026-09-28', notes: ['Skill chains, game-icons.net art, raid set bonuses, guild ranks and activity.'] },
    { v: '0.4', date: '2026-09-28', notes: ['Raids farm like skills, party raids, 8-bit mechs.'] },
    { v: '0.3', date: '2026-09-28', notes: ['Combat classes and a live raid view.'] },
    { v: '0.2', date: '2026-09-28', notes: ['Accounts, guilds, trading and raids.'] },
  ];

  const GAME = {
    MAX_LEVEL, OFFLINE_CAP, TIERS, TIER_BY_ID, CLASSES, ROLES, CLASS_OF_SKILL, UNARMED_COLOUR, SKILLS, SKILL_BY_ID, COMBAT_SKILLS, STATS, describe,
    WEAPON_KINDS, WEAPON_BY_ID, OFFHAND_KINDS, OFFHAND_BY_ID, SLOTS, ARMOUR_SLOTS, ARMOUR_TYPES, CONSUMABLES, CONSUMABLE_BY_ID,
    ABILITIES, ABILITY_BY_ID, ABILITY_SLOTS, SUBCLASSES, SUBCLASS_BY_ID, resolveSubclass, REGIONS, SET_BY_ID, TRASH_ROLES, FOE_ROLE, MECHANICS, RAID_CURVE, FOES, FOE_DAMAGE, PASSIVES, DIFFICULTIES, DIFF_BY_ID, FIGHT, PARTY,
    ITEMS, ACTIONS, ACTION_BY_ID, RAIDS, RAID_BY_ID, finaleGear, gearCheck, FINALE_ARMOUR, RAID_GEAR_NEED, OFFHAND_XP_SHARE, PATCH_NOTES, CLASS_KIT,
    xpForLevel, levelFromXp, skillMult, mechStats, power, combatLevel, kit, rng,
    PARTY_MAX: PARTY.max, partyDmg, POTIONS_PER_RAID: 3, GUILD_COST: 0, QUEUE_MAX: 5,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = GAME;
  else root.GAME = GAME;
})(typeof window !== 'undefined' ? window : this);
