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
  };

  root.ICONS = {
    item: (kind, colour) => svg((ITEM[kind] || ITEM.mat)(colour)),
    ui: name => svg(`<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${UI[name] || ''}</g>`, 24),
  };
})(window);
