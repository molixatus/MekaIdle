// Item icons from the pixel-art sprite sheet (public/items.webp): 16 columns by 137 rows.
// Every item maps to a cell [row, col] (and optionally a hue shift in degrees). Icons are placed
// by grid cell, not by pixel, so a higher-resolution copy of the same sheet can replace the file
// without changing anything here. Skill, ability, subclass and enemy icons are not from this sheet.
(function (root) {
  'use strict';
  const G = root.GAME;
  const SHEET = { src: 'items.webp', cols: 16, rows: 137 };

  // Ten cells per list: one per tier, so every tier of a piece looks different.
  const W = {
    sword: [[90, 6], [90, 7], [94, 0], [100, 6], [100, 7], [104, 3], [95, 7], [99, 0], [105, 0], [108, 11]],
    axe: [[91, 7], [91, 8], [91, 9], [101, 7], [101, 8], [101, 10], [96, 8], [96, 9], [96, 10], [111, 15]],
    mace: [[92, 0], [91, 11], [92, 3], [102, 0], [101, 11], [104, 1], [97, 0], [97, 3], [99, 1], [106, 4]],
    greatsword: [[90, 8], [94, 13], [94, 5], [100, 8], [104, 13], [104, 5], [95, 8], [99, 13], [106, 6], [108, 7]],
    shortbow: [[92, 11], [94, 11], [102, 11], [104, 11], [97, 11], [99, 11], [106, 2], [112, 14], [109, 5], [111, 4]],
    longbow: [[92, 10], [94, 10], [102, 10], [104, 10], [97, 10], [99, 10], [106, 3], [109, 6], [112, 13], [111, 12]],
    crossbow: [[94, 9], [92, 12], [104, 9], [102, 12], [99, 9], [97, 12], [109, 8], [109, 9], [109, 10], [110, 8]],
    daggers: [[90, 3], [94, 7], [94, 8], [100, 3], [104, 7], [104, 8], [95, 3], [99, 7], [105, 6], [107, 14]],
    wand: [[93, 5], [93, 6], [103, 5], [103, 6], [98, 5], [98, 6], [105, 3], [106, 14], [112, 6], [110, 15]],
    staff: [[93, 7], [93, 8], [93, 9], [103, 7], [103, 8], [103, 9], [98, 7], [98, 8], [98, 9], [105, 9]],
    sceptre: [[91, 12], [93, 3], [93, 4], [101, 12], [103, 3], [103, 4], [96, 12], [98, 3], [98, 4], [106, 15]],
    crystal: [[134, 0], [134, 1], [134, 2], [134, 8], [134, 12], [134, 13], [134, 14], [134, 15], [10, 5], [10, 3]],
    scroll: [[18, 8], [18, 9], [18, 10], [18, 11], [18, 12], [18, 13], [18, 14], [18, 15], [6, 8], [6, 10]],
    tome: [[18, 0], [6, 0], [6, 2], [18, 1], [6, 4], [18, 2], [6, 6], [18, 3], [18, 4], [18, 5]],
    codex: [[6, 1], [6, 3], [6, 5], [6, 7], [6, 9], [6, 11], [19, 0], [19, 3], [19, 6], [19, 8]],
    lantern: [[5, 4], [5, 5], [5, 10], [5, 11], [5, 2], [5, 3], [5, 8], [5, 9], [4, 2], [4, 5]],
    shield: [[113, 2], [113, 3], [113, 4], [134, 4], [134, 5], [134, 6], [134, 3], [134, 1], [113, 0], [113, 1]],
    quiver: [[134, 9], [134, 10], [134, 11], [25, 0], [25, 1], [25, 2], [25, 3], [25, 4], [25, 5], [134, 14]],
    orb: [[10, 9], [10, 10], [10, 11], [24, 0], [24, 1], [20, 14], [132, 6], [132, 7], [132, 12], [132, 13]],
    relic: [[8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], [8, 15], [9, 0], [8, 4], [8, 7]],
  };
  const row = (r, cols) => cols.map(c => [r, c]);
  const PLATE_COLS = [0, 1, 2, 3, 5, 7, 4, 6, 13, 11];
  const COAT_COLS = [5, 6, 0, 12, 13, 2, 10, 4, 1, 3];
  const withHue = (list, hues) => list.concat(hues.map((h, i) => [...list[i % list.length], h]));
  const A = {
    plate: {
      head: row(119, PLATE_COLS), body: row(120, PLATE_COLS), legs: row(121, PLATE_COLS),
      feet: [[115, 12], [115, 13], [115, 14], [115, 15], [135, 0], [135, 1], [135, 2], [135, 3], [135, 4], [135, 6]],
      hands: withHue([[128, 6], [128, 7], [128, 9], [128, 10], [128, 11]], [40, 90, 160, 220, 300]),
    },
    leather: {
      head: [[122, 0], [122, 1], [122, 2], [122, 3], [122, 4], [125, 14], [125, 15], [122, 5], [122, 6], [122, 13]],
      body: row(123, COAT_COLS), feet: row(124, COAT_COLS),
      legs: withHue(row(126, [8, 9, 10, 11, 12, 13, 14, 15]), [120, 240]),
      hands: withHue(row(127, [8, 9, 10, 11, 12, 13, 14, 15]), [120, 240]),
    },
    cloth: {
      head: row(125, [0, 1, 4, 5, 7, 3, 11, 12, 9, 6]),
      body: [[126, 0], [126, 1], [126, 2], [126, 3], [126, 4], [126, 5], [126, 6], [126, 7], [114, 5], [114, 6]],
      legs: row(126, [8, 9, 10, 11, 12, 13, 14, 15, 8, 9]).map((c, i) => [...c, 180 + i * 17]),
      feet: withHue(row(127, [0, 1, 2, 3, 4, 5, 6, 7]), [150, 270]),
      hands: row(127, [8, 9, 10, 11, 12, 13, 14, 15, 8, 9]).map((c, i) => [...c, 200 + i * 13]),
    },
    vestment: {
      head: [[114, 10], [114, 11], [114, 12], [114, 13], [114, 14], [114, 15], [129, 12], [129, 13], [129, 14], [129, 15]],
      body: row(130, [0, 2, 5, 7, 8, 9, 10, 11, 13, 15]), legs: row(131, [0, 2, 5, 7, 8, 9, 10, 11, 13, 15]),
      feet: [[115, 12, 280], [115, 13, 280], [115, 14, 280], [115, 15, 280], [135, 0, 280], [135, 1, 280], [135, 2, 280], [135, 3, 280], [135, 4, 280], [135, 6, 280]],
      hands: [[129, 0], [129, 1], [129, 2], [129, 3], [129, 4], [136, 0], [136, 1], [136, 2], [136, 3], [136, 4]],
    },
  };
  const M = {
    ore: [[12, 0], [13, 0], [12, 1], [13, 1], [12, 3], [13, 3], [12, 5], [13, 5], [10, 7], [10, 5]],
    hide: withHue([[12, 11], [13, 11], [14, 12], [14, 13], [14, 14], [14, 15]], [90, 180, 270, 320]),
    bone: [[14, 6], [14, 7], [14, 5], [12, 13], [13, 13], [14, 8], [14, 9], [14, 10], [14, 11], [14, 1]],
    venom: [[3, 12], [3, 13], [3, 14], [7, 8], [3, 8], [3, 9], [3, 10], [16, 8], [16, 11], [16, 13]],
    branch: [[6, 12], [6, 13], [6, 14], [6, 15], [15, 11], [15, 5], [15, 12], [12, 15], [13, 15], [15, 10]],
    fibre: [[15, 0], [15, 1], [15, 2], [15, 4], [15, 3], [26, 0], [26, 5], [28, 1], [26, 15], [15, 14]],
    essence: [[10, 12], [10, 13], [10, 14], [10, 15], [10, 9], [10, 10], [10, 11], [10, 6], [10, 8], [10, 4]],
    herb: [[16, 0], [16, 1], [16, 2], [16, 3], [16, 4], [16, 5], [16, 6], [16, 7], [15, 6], [15, 7]],
  };
  const RAID_MATS = [[0, 1], [2, 1], [14, 0], [14, 9], [10, 13], [62, 0], [10, 11], [134, 0], [0, 12], [10, 5]];
  const CONSUMABLE = {
    healing_potion: [16, 10], greater_healing_potion: [16, 12], superior_healing_potion: [16, 14],
    mana_potion: [7, 10], greater_mana_potion: [3, 11],
    ironskin_tonic: [3, 12], vigour_tonic: [3, 13], fury_tonic: [3, 14], titan_elixir: [3, 15],
    whetstone: [13, 1], weapon_oil: [7, 8], balance_stone: [19, 10], tempering_oil: [24, 14], master_whetstone: [13, 5],
    weak_poison: [3, 8], barbed_tips: [24, 2], paralytic_venom: [3, 10], deadly_poison: [7, 9], hunters_draught: [16, 9],
    rune_of_power: [20, 0], rune_of_clarity: [20, 1], rune_of_fire: [20, 2], rune_of_frost: [20, 3], rune_of_ruin: [20, 5],
  };
  const CLASS_ORDER = ['melee', 'ranged', 'magic', 'healer'];

  function cellFor(it) {
    const t = (it.tier || 1) - 1;
    if (it.id === 'gold') return [9, 15];
    if (it.id === 'reed') return [15, 3];
    if (CONSUMABLE[it.id]) return CONSUMABLE[it.id];
    let m = /^mat_(\d+)$/.exec(it.id);
    if (m) return RAID_MATS[m[1] - 1];
    m = /^[a-z]+_(ore|hide|bone|venom|branch|fibre|essence|herb)$/.exec(it.id);
    if (m) return M[m[1]][t];
    if ((m = /^sigil_(\d+)$/.exec(it.id))) return [132, m[1] - 1];
    if ((m = /^trinket_(\d+)$/.exec(it.id))) return [115, 1 + Number(m[1])];
    if ((m = /^charm_(\d+)$/.exec(it.id))) return [133, m[1] - 1];
    // Raid weapons: the sheet's unique coloured weapons, a different one for every region and class.
    if ((m = /^u(\d+)_([a-z]+)$/.exec(it.id))) {
      const i = (m[1] - 1) * 4 + CLASS_ORDER.indexOf(m[2]);
      return [105 + Math.floor(i / 16), i % 16];
    }
    // Raid set pieces: armour of the set's type in a colour no crafted tier uses.
    if ((m = /^set(\d+)_([a-z]+)_(head|body|legs)$/.exec(it.id))) {
      const list = A[it.armour][m[3]];
      const [r, c, h] = list[(Number(m[1]) + 4) % list.length];
      return [r, c, ((h || 0) + 35 * Number(m[1])) % 360];
    }
    if (it.slot === 'weapon' && W[it.weapon]) return W[it.weapon][t];
    if (it.slot === 'offhand' && W[it.offhand]) return W[it.offhand][t];
    if (it.armour && A[it.armour] && A[it.armour][it.slot]) return A[it.armour][it.slot][t];
    return null;
  }

  const MAP = {};
  Object.values(G.ITEMS).forEach(it => { const c = cellFor(it); if (c) MAP[it.id] = c; });
  root.ITEM_SHEET = { ...SHEET, map: MAP };
})(typeof window !== 'undefined' ? window : this);
