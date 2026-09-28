// Inline SVG icons. Item icons are coloured per tier; UI icons use currentColor strokes.
(function (root) {
  'use strict';
  const shade = 'fill="#000" opacity=".28"';
  const svg = (inner, box = 48) => `<svg viewBox="0 0 ${box} ${box}" xmlns="http://www.w3.org/2000/svg" focusable="false">${inner}</svg>`;

  const ITEM = {
    ore: c => `<path d="M24 5 31 19 24 37 17 19Z" fill="${c}"/><path d="M24 5 31 19 24 37Z" ${shade}/>
      <path d="M12 17 18 26 14 39 7 28Z" fill="${c}"/><path d="M12 17 18 26 14 39Z" ${shade}/>
      <path d="M36 17 41 28 34 39 30 26Z" fill="${c}"/><path d="M36 17 41 28 34 39Z" ${shade}/>
      <path d="M5 39H43L39 44H9Z" fill="#5b4c3e"/>`,
    plate: c => `<path d="M6 22 24 13 42 22 24 31Z" fill="${c}"/>
      <path d="M6 22V29L24 38V31Z" fill="${c}"/><path d="M6 22V29L24 38V31Z" ${shade}/>
      <path d="M42 22V29L24 38V31Z" fill="${c}"/><path d="M42 22V29L24 38V31Z" fill="#000" opacity=".45"/>
      <path d="M14 22 24 17 34 22 24 27Z" fill="#fff" opacity=".18"/>`,
    scrap: c => `<g fill="${c}">${[0, 45, 90, 135].map(a => `<rect x="20.5" y="5" width="7" height="38" rx="2" transform="rotate(${a} 24 24)"/>`).join('')}
      <circle cx="24" cy="24" r="13"/></g><path d="M24 11a13 13 0 0 1 0 26z" ${shade}/><circle cx="24" cy="24" r="5" class="hole"/>`,
    circuit: c => `<g stroke="#cfd6de" stroke-width="2.5" stroke-linecap="round">
      <path d="M17 6v5M24 6v5M31 6v5M17 37v5M24 37v5M31 37v5M6 17h5M6 24h5M6 31h5M37 17h5M37 24h5M37 31h5"/></g>
      <rect x="10" y="10" width="28" height="28" rx="3" fill="${c}"/><rect x="17" y="17" width="14" height="14" rx="1.5" fill="#15251a"/>`,
    cell: c => `<rect x="19" y="5" width="10" height="6" rx="1.5" fill="${c}"/>
      <rect x="12" y="10" width="24" height="33" rx="3.5" fill="#2a2f3a" stroke="${c}" stroke-width="2.5"/>
      <path d="M26 15 17 28h6l-2 10 9-14h-6z" fill="${c}"/>`,
    kit: c => `<rect x="18" y="7" width="12" height="8" rx="2" fill="none" stroke="${c}" stroke-width="3"/>
      <rect x="6" y="13" width="36" height="28" rx="4" fill="${c}"/><rect x="6" y="30" width="36" height="11" rx="4" ${shade}/>
      <path d="M21 18h6v5h5v6h-5v5h-6v-5h-5v-6h5z" fill="#fff"/>`,
    mat: c => `<circle cx="24" cy="24" r="19" fill="${c}" opacity=".18"/><path d="M24 5 37 24 24 43 11 24Z" fill="${c}"/>
      <path d="M24 5 37 24 24 43Z" ${shade}/><path d="M24 12 30 24 24 36 18 24Z" fill="#fff" opacity=".35"/>`,
    weapon: c => `<rect x="26" y="17" width="18" height="6" rx="1.5" fill="${c}"/><rect x="26" y="26" width="14" height="5" rx="1.5" fill="${c}"/>
      <rect x="26" y="26" width="14" height="5" rx="1.5" ${shade}/>
      <rect x="5" y="14" width="23" height="20" rx="4" fill="${c}"/><rect x="5" y="25" width="23" height="9" rx="4" ${shade}/>
      <rect x="11" y="32" width="8" height="11" rx="2" fill="${c}"/><rect x="11" y="32" width="8" height="11" rx="2" ${shade}/>`,
    armour: c => `<path d="M24 4 41 10V23C41 34 33 40 24 44 15 40 7 34 7 23V10Z" fill="${c}"/>
      <path d="M24 4V44C15 40 7 34 7 23V10Z" fill="#fff" opacity=".12"/>
      <path d="M24 13 33 16V23C33 30 29 33 24 36Z" ${shade}/>`,
    reactor: c => `<circle cx="24" cy="24" r="19" fill="#2a2f3a" stroke="${c}" stroke-width="3"/>
      <circle cx="24" cy="24" r="13.5" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="3 3"/>
      <circle cx="24" cy="24" r="8" fill="${c}"/><circle cx="21.5" cy="21.5" r="2.5" fill="#fff" opacity=".5"/>`,
    legs: c => `<path d="M11 5h10v18l-3 17h-9l3-17z" fill="${c}"/><path d="M27 5h10l-1 18 3 17h-9l-3-17z" fill="${c}"/>
      <path d="M27 5h10l-1 18 3 17h-9l-3-17z" ${shade}/><rect x="6" y="39" width="15" height="5" rx="1.5" fill="${c}"/>
      <rect x="27" y="39" width="15" height="5" rx="1.5" fill="${c}"/><rect x="12" y="20" width="8" height="4" fill="#1b1f27"/>
      <rect x="28" y="20" width="8" height="4" fill="#1b1f27"/>`,
    module: c => `<path d="M24 4 41 14V34L24 44 7 34V14Z" fill="${c}"/><path d="M24 4 41 14V34L24 44Z" ${shade}/>
      <path d="M24 15 32 19.5V28.5L24 33 16 28.5V19.5Z" fill="#fff" opacity=".3"/>`,
    autocannon: c => `<rect x="24" y="14" width="20" height="5" rx="1.5" fill="${c}"/><rect x="24" y="21" width="20" height="5" rx="1.5" fill="${c}"/>
      <rect x="24" y="28" width="20" height="5" rx="1.5" fill="${c}"/><rect x="24" y="14" width="20" height="19" rx="1.5" ${shade}/>
      <rect x="5" y="11" width="22" height="25" rx="4" fill="${c}"/><rect x="5" y="26" width="22" height="10" rx="4" ${shade}/>
      <rect x="10" y="34" width="8" height="9" rx="2" fill="${c}"/><circle cx="16" cy="20" r="3" fill="#1b1f27"/>`,
    laser: c => `<rect x="4" y="19" width="16" height="12" rx="3" fill="${c}"/><rect x="18" y="22" width="22" height="6" rx="2" fill="${c}"/>
      <rect x="18" y="25" width="22" height="3" ${shade}/><circle cx="41" cy="25" r="4" fill="#5bc8ff"/><circle cx="41" cy="25" r="7" fill="#5bc8ff" opacity=".3"/>
      <rect x="8" y="29" width="7" height="11" rx="2" fill="${c}"/>`,
    flamer: c => `<path d="M34 25c4-5 10-3 11 0-1 4-7 6-11 0z" fill="#ff7a3c"/><path d="M36 25c3-2 6-1 7 0-1 2-4 3-7 0z" fill="#ffd36b"/>
      <rect x="4" y="16" width="18" height="18" rx="4" fill="${c}"/><rect x="20" y="21" width="15" height="8" rx="2" fill="${c}"/>
      <rect x="20" y="25" width="15" height="4" ${shade}/><circle cx="12" cy="25" r="4" fill="#1b1f27"/><rect x="9" y="33" width="7" height="9" rx="2" fill="${c}"/>`,
    missiles: c => `<rect x="5" y="10" width="30" height="28" rx="3" fill="${c}"/><rect x="5" y="28" width="30" height="10" rx="3" ${shade}/>
      ${[[13, 17], [27, 17], [13, 30], [27, 30]].map(([x, y]) => `<circle cx="${x - 2}" cy="${y - 2}" r="4.5" fill="#1b1f27"/><path d="M${x - 2} ${y - 6}l3 4h-6z" fill="#ff5470"/>`).join('')}
      <rect x="35" y="16" width="8" height="16" rx="2" fill="${c}"/>`,
    repair_arm: c => `<path d="M8 38 26 20" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
      <path d="M24 10a9 9 0 0 1 14 11l-6-2-2-6z" fill="${c}"/><path d="M38 21a9 9 0 0 1-11 3l2-5 5-2z" fill="${c}"/>
      <path d="M8 38 26 20" stroke="#000" stroke-opacity=".25" stroke-width="3" stroke-linecap="round"/>
      <circle cx="36" cy="36" r="9" fill="#3ddc84"/><path d="M34.5 31h3v3.5H41v3h-3.5V41h-3v-3.5H31v-3h3.5z" fill="#fff"/>`,
    emp: c => `<path d="M8 34a16 16 0 0 1 16-16v16z" fill="${c}"/><path d="M8 34a16 16 0 0 1 16-16v16z" ${shade}/>
      <rect x="6" y="34" width="20" height="6" rx="2" fill="${c}"/><circle cx="24" cy="18" r="3" fill="#b66cf0"/>
      <path d="M30 12a10 10 0 0 1 0 12M35 8a16 16 0 0 1 0 20M40 4a22 22 0 0 1 0 28" fill="none" stroke="#b66cf0" stroke-width="2.5" stroke-linecap="round"/>`,
    gas: c => `<rect x="17" y="4" width="14" height="5" rx="1.5" fill="#8d95a5"/><rect x="13" y="9" width="22" height="34" rx="7" fill="${c}"/>
      <rect x="13" y="9" width="11" height="34" rx="7" fill="#fff" opacity=".15"/><rect x="17" y="20" width="14" height="10" rx="2" fill="#1b1f27" opacity=".55"/>`,
    vial: c => `<rect x="18" y="4" width="12" height="6" rx="1.5" fill="#8d95a5"/><path d="M20 10h8v9l10 17a5 5 0 0 1-4 7H14a5 5 0 0 1-4-7l10-17z" fill="#2a2f3a"/>
      <path d="M14.5 29h19l3.5 7a3 3 0 0 1-3 4.5H14a3 3 0 0 1-3-4.5z" fill="${c}"/><circle cx="20" cy="34" r="2" fill="#fff" opacity=".5"/>`,
  };

  // Raid boss portraits, 120x120.
  const BOSS = {
    warden: `<rect x="14" y="92" width="92" height="14" rx="7" fill="#3b3226"/><rect x="18" y="95" width="84" height="8" rx="4" fill="#5b4c3e"/>
      <rect x="30" y="64" width="46" height="30" rx="4" fill="#d99a2b"/><rect x="30" y="80" width="46" height="14" fill="#000" opacity=".2"/>
      <rect x="36" y="69" width="18" height="11" rx="2" fill="#9ee6ff"/><circle cx="45" cy="74" r="3" fill="#ef5a45"/>
      <path d="M62 66 96 20l6 4-32 46z" fill="#e8b923"/><path d="M62 66 96 20l3 2-33 46z" fill="#000" opacity=".2"/>
      <path d="M99 24v26" stroke="#8d95a5" stroke-width="2"/><path d="M93 50h12l-2 8h-3l-1-4-1 4h-3z" fill="#a3adb8"/>
      <rect x="66" y="58" width="8" height="10" fill="#5b4c3e"/>`,
    hydra: `<ellipse cx="60" cy="98" rx="40" ry="10" fill="#3b2a26"/><path d="M28 96c0-22 12-32 32-32s32 10 32 32z" fill="#9a4a32"/>
      <path d="M28 96c0-22 12-32 32-32v32z" fill="#fff" opacity=".08"/>
      ${[[34, 24, -1], [60, 12, 0], [86, 24, 1]].map(([x, y, d]) => `<path d="M${60 + d * 12} 70 Q${x + d * 6} ${y + 30} ${x} ${y + 12}" stroke="#b5583a" stroke-width="10" fill="none" stroke-linecap="round"/>
        <rect x="${x - 11}" y="${y}" width="22" height="16" rx="5" fill="#c46a45"/><rect x="${x - 11}" y="${y + 10}" width="22" height="6" rx="2" fill="#6b2e22"/>
        <circle cx="${x - 4}" cy="${y + 6}" r="2.5" fill="#ffdf6b"/><circle cx="${x + 4}" cy="${y + 6}" r="2.5" fill="#ffdf6b"/>`).join('')}`,
    colossus: `<rect x="38" y="84" width="16" height="24" rx="3" fill="#48607f"/><rect x="66" y="84" width="16" height="24" rx="3" fill="#48607f"/>
      <rect x="26" y="36" width="68" height="52" rx="8" fill="#5d7bff"/><rect x="26" y="66" width="68" height="22" rx="6" fill="#000" opacity=".2"/>
      <rect x="44" y="18" width="32" height="22" rx="4" fill="#4a64d8"/><rect x="48" y="25" width="24" height="6" rx="2" fill="#ffdf6b"/>
      <rect x="10" y="40" width="18" height="40" rx="5" fill="#48607f"/><rect x="92" y="40" width="18" height="40" rx="5" fill="#48607f"/>
      <rect x="12" y="30" width="6" height="12" fill="#8d95a5"/><rect x="102" y="30" width="6" height="12" fill="#8d95a5"/>
      <rect x="38" y="46" width="44" height="8" rx="2" fill="#2d3a66"/><rect x="38" y="58" width="44" height="4" rx="2" fill="#2d3a66"/>`,
    sentinel: `<circle cx="60" cy="56" r="40" fill="#7fd8ff" opacity=".12"/>
      <ellipse cx="60" cy="56" rx="44" ry="10" fill="none" stroke="#7fd8ff" stroke-width="3" opacity=".7"/>
      <path d="M60 18 84 56 60 94 36 56z" fill="#3a8fb8"/><path d="M60 18 84 56 60 94z" fill="#000" opacity=".2"/>
      <circle cx="60" cy="56" r="10" fill="#e8fbff"/><circle cx="60" cy="56" r="5" fill="#7fd8ff"/>
      <path d="M22 88l8-14 4 6 8-12" fill="none" stroke="#e8fbff" stroke-width="3" stroke-linejoin="round"/>
      <path d="M98 88l-8-14-4 6-8-12" fill="none" stroke="#e8fbff" stroke-width="3" stroke-linejoin="round"/>
      <path d="M52 104l8-10 8 10" fill="none" stroke="#7fd8ff" stroke-width="3"/>`,
    titan: `<circle cx="60" cy="60" r="52" fill="#2ee6b6" opacity=".08"/>
      <path d="M20 112c2-30 10-48 22-56l-6-18c8-12 40-12 48 0l-6 18c12 8 20 26 22 56z" fill="#141a22"/>
      <path d="M36 38c8-12 40-12 48 0l-6 18H42z" fill="#1d2630"/>
      <path d="M46 44h10l-3 5h-7zM64 44h10v5h-7z" fill="#2ee6b6"/>
      <path d="M60 60 54 76l8 6-6 18M40 70l-8 16M80 70l8 16" stroke="#2ee6b6" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M26 20l6 8M94 20l-6 8M60 6v8" stroke="#2ee6b6" stroke-width="2" opacity=".6" stroke-linecap="round"/>`,
  };

  const UI = {
    scrapping: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    mining: '<path d="M4.5 9.5c4-4 11-4 15 0"/><path d="M12 6.8 7 21"/>',
    smelting: '<path d="M12 3c1 4 5.5 5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.3 1-3.8 2.2-4.8 0 2 1 3.3 2.3 3.3C11 9 10 6.5 12 3z"/>',
    engineering: '<path d="M14.7 6.3a4 4 0 0 0 5 5L11.5 19.5a2.1 2.1 0 0 1-3-3l8.2-8.2a4 4 0 0 1-2-2z"/>',
    fabrication: '<path d="M3 7h12c0 3 2.5 4 6 4v2.5H9l-2 3.5h10M10 13.5V17"/><path d="M5 21h14"/>',
    piloting: '<rect x="5" y="15" width="14" height="5" rx="1.5"/><path d="M12 15V9"/><circle cx="12" cy="6.5" r="2.8"/>',
    hangar: '<rect x="7" y="4" width="10" height="8" rx="2"/><path d="M10 8h4M9 12v4M15 12v4M7 16h10M5 20h14"/>',
    inventory: '<path d="M3 8l9-4 9 4v9l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v9"/>',
    raids: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.4"/>',
    trade: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
    guild: '<path d="M6 3v18M6 4h12l-3 4.5L18 13H6"/>',
    social: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14c2.8.2 4.5 2.2 4.5 5"/>',
    logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    power: '<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>',
    siphoning: '<path d="M9 3h6M10 3v4M14 3v4"/><rect x="6" y="7" width="12" height="14" rx="4"/><path d="M9 13h6"/>',
    chemistry: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/>',
    weaponsmithing: '<path d="M3 9h11l2-2h3v5h-3l-2-2"/><path d="M6 9v4l-2 7h4l2-7h3"/>',
    kinetic: '<rect x="9" y="8" width="6" height="13" rx="1"/><path d="M9 8c0-3 1.5-5 3-5s3 2 3 5"/><path d="M9 17h6"/>',
    energy: '<circle cx="12" cy="12" r="9"/><path d="M13 5 8 13h4l-1 6 5-8h-4z"/>',
    thermal: '<path d="M12 3c1 4 5.5 5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.3 1-3.8 2.2-4.8 0 2 1 3.3 2.3 3.3C11 9 10 6.5 12 3z"/><path d="M12 14c.6 1.5 2 2 2 3.3a2 2 0 0 1-4 0c0-1 .6-1.6 1-2"/>',
    missile: '<path d="M14 4c3-1 6 0 6 0s1 3 0 6l-8 8-6-6z"/><path d="M8 12l-4 1 2 2M12 16l-1 4-2-2M6 18l-2 2"/>',
    shielding: '<path d="M12 3 20 6v6c0 5-3.5 8-8 9.5C7.5 20 4 17 4 12V6z"/><path d="M12 7v10"/>',
    repair: '<path d="M14.7 6.3a4 4 0 0 0 5 5L11.5 19.5a2.1 2.1 0 0 1-3-3l8.2-8.2a4 4 0 0 1-2-2z"/><path d="M5 3v6M2 6h6"/>',
    electronics: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    skip: '<path d="M5 5l9 7-9 7zM17 5v14"/>',
    replay: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5"/>',
  };

  root.ICONS = {
    boss: id => `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" focusable="false">${BOSS[id] || ''}</svg>`,
    item: (kind, colour) => svg((ITEM[kind] || ITEM.mat)(colour)),
    ui: name => svg(`<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${UI[name] || ''}</g>`, 24),
  };
})(window);
