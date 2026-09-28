// 8-bit pixel sprites for mechs and raid bosses, drawn on a small grid and rendered as crisp SVG.
(function (root) {
  'use strict';

  // ---------- Colour helpers ----------
  function mix(hex, amount) {
    // amount > 0 lightens towards white, < 0 darkens towards black.
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
      const t = amount > 0 ? 255 : 0;
      return Math.round(c + (t - c) * Math.abs(amount));
    });
    return '#' + ch.map(c => c.toString(16).padStart(2, '0')).join('');
  }

  // ---------- Pixel canvas ----------
  // Shapes drawn with `s*` helpers are mirrored across the centre line. `swap` recolours the
  // mirrored half so one side can be lit and the other shaded.
  function Canvas(w, h, swap) {
    const g = Array.from({ length: h }, () => Array(w).fill('.'));
    const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c; };
    const mirror = (x, y, c) => { set(x, y, c); set(w - 1 - x, y, (swap && swap[c]) || c); };
    const c = {
      px: set,
      spx: mirror,
      rect(x0, y0, x1, y1, ch) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch); },
      srect(x0, y0, x1, y1, ch) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mirror(x, y, ch); },
      disc(cx, cy, r, ch) {
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
          for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
            if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.6) set(x, y, ch);
      },
      ring(cx, cy, r, thick, ch) {
        for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
          for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
            const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            if (d <= r + 0.5 && d >= r - thick + 0.5) set(x, y, ch);
          }
      },
      sline(x0, y0, x1, y1, ch, thick = 1) {
        const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
        for (let i = 0; i <= steps; i++) {
          const x = Math.round(x0 + (x1 - x0) * i / steps), y = Math.round(y0 + (y1 - y0) * i / steps);
          for (let k = 0; k < thick; k++) mirror(x + k, y, ch);
        }
      },
      // Adds a one-pixel outline around everything drawn so far.
      outline(ch = 'K') {
        const filled = (x, y) => x >= 0 && y >= 0 && x < w && y < h && g[y][x] !== '.' && g[y][x] !== ch;
        const out = [];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (g[y][x] !== '.') continue;
          if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) out.push([x, y]);
        }
        out.forEach(([x, y]) => { g[y][x] = ch; });
      },
      // Renders runs of equal pixels as rects.
      svg(palette, label) {
        let rects = '';
        for (let y = 0; y < h; y++) {
          let x = 0;
          while (x < w) {
            const ch = g[y][x];
            let run = 1;
            while (x + run < w && g[y][x + run] === ch) run++;
            if (ch !== '.' && palette[ch]) rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${palette[ch]}"/>`;
            x += run;
          }
        }
        return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="${label}">${rects}</svg>`;
      },
    };
    return c;
  }

  // ---------- Mech ----------
  // A tall, lanky frame with a forehead horn, jaw plates and tall shoulder pylons.
  // opts: { paint, accent, armour, legs, reactor, module, weapon (kind id), weaponColour }
  function mech(opts) {
    const o = opts || {};
    const paint = o.paint || '#8d95a5';
    const accent = o.accent || '#8cff5a';
    const armour = o.armour || mix(paint, -0.45);
    const legs = o.legs || paint;
    const c = Canvas(34, 46, { H: 'P', A: 'a', L: 'l' });
    // Horn and head.
    c.srect(16, 1, 16, 5, 'H');
    c.srect(14, 5, 16, 11, 'P');
    c.srect(14, 5, 14, 5, '.');
    c.srect(14, 7, 16, 7, 'E');
    c.srect(15, 9, 16, 11, 'G');
    c.srect(14, 10, 14, 11, 'p');
    c.srect(15, 12, 16, 12, 'D');
    // Shoulder pylons.
    c.srect(6, 5, 10, 15, 'A');
    c.srect(6, 5, 6, 15, 'a');
    c.srect(7, 7, 9, 7, 'G');
    c.srect(6, 4, 9, 4, 'A');
    // Collar, chest and core.
    c.srect(10, 13, 16, 14, 'P');
    c.srect(12, 15, 16, 19, 'P');
    c.srect(13, 15, 14, 16, 'H');
    c.srect(16, 16, 16, 18, 'R');
    // Waist, belt and hips.
    c.srect(14, 20, 16, 22, 'p');
    c.srect(13, 23, 16, 23, 'G');
    c.srect(12, 24, 16, 25, 'P');
    // Arms.
    c.srect(8, 16, 10, 23, 'P');
    c.srect(8, 16, 8, 23, 'p');
    c.srect(8, 24, 10, 24, 'D');
    c.srect(8, 25, 10, 30, 'A');
    c.srect(8, 31, 10, 32, 'D');
    // Legs.
    c.srect(12, 26, 14, 32, 'L');
    c.srect(12, 26, 12, 32, 'l');
    c.srect(12, 33, 14, 33, 'D');
    c.srect(13, 33, 13, 33, 'A');
    c.srect(12, 34, 14, 40, 'L');
    c.srect(12, 34, 12, 40, 'l');
    c.srect(12, 41, 14, 41, 'D');
    c.srect(10, 42, 14, 43, 'L');
    c.srect(10, 43, 14, 43, 'l');

    // Weapons sit in or over the hands.
    const w = o.weapon;
    if (w === 'blade') {
      c.rect(22, 31, 26, 31, 'w');
      c.rect(24, 32, 25, 44, 'W');
      c.rect(25, 32, 25, 44, 'Y');
      c.px(24, 45, 'W');
    } else if (w === 'bulwark') {
      c.rect(3, 17, 11, 34, 'W');
      c.rect(3, 17, 4, 34, 'w');
      c.rect(6, 22, 8, 28, 'X');
      c.rect(7, 20, 7, 30, 'X');
    } else if (w === 'rifle') {
      c.rect(20, 27, 26, 31, 'w');
      c.rect(26, 28, 33, 29, 'W');
      c.rect(21, 25, 24, 26, 'X');
      c.rect(19, 30, 21, 33, 'w');
    } else if (w === 'focus') {
      c.disc(28, 24, 3, 'X');
      c.disc(28, 24, 1, 'Y');
      c.rect(23, 29, 25, 30, 'W');
      c.px(32, 20, 'X'); c.px(24, 19, 'X'); c.px(31, 29, 'X');
    } else if (w === 'staff') {
      c.rect(26, 7, 26, 45, 'W');
      c.ring(26, 5, 3, 1, 'X');
      c.rect(26, 3, 26, 7, 'Y');
      c.rect(24, 5, 28, 5, 'Y');
    }
    c.outline('K');

    const weaponGlow = { blade: '#ff6b6b', bulwark: accent, rifle: '#5bc8ff', focus: '#c58cff', staff: '#3ddc84' }[w] || accent;
    const wc = o.weaponColour || '#a3adb8';
    return c.svg({
      K: '#07080c', P: paint, p: mix(paint, -0.3), H: mix(paint, 0.3), G: accent,
      E: o.module || '#ffdf4d', R: o.reactor || '#b3261e',
      A: armour, a: mix(armour, -0.3), L: legs, l: mix(legs, -0.3), D: '#1d2028',
      W: wc, w: mix(wc, -0.35), X: weaponGlow, Y: '#f4f6fa',
    }, 'Mech');
  }

  // ---------- Bosses ----------
  const BOSSES = {
    warden() {
      const c = Canvas(48, 48, { B: 'b', M: 'm' });
      c.srect(10, 15, 23, 21, 'B');
      c.disc(12, 16, 4, 'B'); c.disc(35, 16, 4, 'b');
      c.srect(8, 10, 9, 15, 'S'); c.spx(8, 9, 'S');
      c.srect(14, 21, 23, 31, 'B');
      c.srect(15, 23, 20, 23, 'S'); c.srect(15, 26, 20, 26, 'S'); c.srect(16, 29, 20, 29, 'S');
      c.srect(21, 25, 23, 29, 'R'); c.srect(22, 26, 23, 28, 'r');
      c.srect(5, 19, 9, 35, 'B'); c.srect(5, 19, 5, 35, 'b');
      c.srect(4, 36, 5, 41, 'S'); c.srect(7, 36, 8, 42, 'S');
      c.srect(16, 32, 22, 34, 'b');
      c.srect(14, 35, 18, 45, 'B'); c.srect(14, 35, 14, 45, 'b');
      c.srect(12, 45, 18, 46, 'b');
      c.srect(19, 3, 23, 15, 'M'); c.srect(19, 3, 19, 15, 'm');
      c.srect(20, 16, 23, 17, 'm'); c.srect(22, 18, 23, 19, 'm');
      c.srect(20, 7, 21, 10, 'O'); c.srect(22, 12, 23, 13, 'O');
      c.outline('K');
      return c.svg({ K: '#07080c', B: '#26382c', b: '#172219', M: '#efeadc', m: '#b8b19c', O: '#07080c', S: '#d9d2bd', R: '#ff3b30', r: '#ffd0c9' }, 'The Warden');
    },
    hydra() {
      const c = Canvas(48, 48, { B: 'b', M: 'm' });
      c.srect(7, 33, 23, 45, 'B'); c.disc(15, 35, 8, 'B'); c.disc(32, 35, 8, 'b');
      c.srect(7, 42, 23, 45, 'b');
      c.srect(20, 36, 23, 41, 'R'); c.srect(22, 37, 23, 40, 'r');
      c.srect(20, 14, 23, 34, 'B'); c.srect(20, 14, 20, 34, 'S');
      c.sline(15, 33, 7, 18, 'B', 4);
      c.sline(15, 33, 7, 18, 'S', 1);
      c.srect(17, 3, 23, 14, 'M'); c.srect(17, 3, 17, 14, 'm');
      c.srect(19, 7, 21, 9, 'O'); c.spx(20, 8, 'R');
      c.srect(18, 12, 23, 14, 'm'); c.spx(19, 14, 'M'); c.spx(21, 14, 'M');
      c.srect(1, 9, 10, 18, 'M'); c.srect(1, 9, 1, 18, 'm');
      c.srect(3, 12, 5, 13, 'O'); c.spx(4, 12, 'R');
      c.srect(1, 16, 10, 18, 'm'); c.spx(3, 18, 'M'); c.spx(6, 18, 'M'); c.spx(9, 18, 'M');
      c.outline('K');
      return c.svg({ K: '#07080c', B: '#9b4226', b: '#62281a', M: '#efeadc', m: '#b8b19c', O: '#07080c', S: '#f28a5b', R: '#ff3b30', r: '#ffd0c9' }, 'Rust Hydra');
    },
    colossus() {
      const c = Canvas(48, 48);
      for (let y = 3; y <= 44; y++) {
        const half = y <= 23 ? Math.round((y - 3) * 0.95) : Math.round((44 - y) * 0.95);
        for (let x = 23 - half; x <= 23; x++) { c.px(x, y, y <= 23 ? 'H' : 'c'); c.px(47 - x, y, y <= 23 ? 'C' : 'd'); }
      }
      c.rect(22, 3, 25, 44, 'C');
      c.rect(20, 21, 27, 26, 'R'); c.rect(22, 22, 25, 25, 'Y');
      c.rect(1, 16, 3, 20, 'C'); c.rect(44, 26, 46, 30, 'c');
      c.rect(6, 36, 7, 38, 'H'); c.rect(40, 9, 41, 11, 'C');
      c.outline('K');
      return c.svg({ K: '#07080c', H: '#8fb4ff', C: '#4d7cf0', c: '#2d4fa8', d: '#1d3474', R: '#ff3b30', Y: '#fff2c9' }, 'Prism Colossus');
    },
    sentinel() {
      const c = Canvas(48, 48, { c: 'd' });
      c.ring(23.5, 9, 8, 2, 'Y');
      for (let y = 14; y <= 42; y++) {
        const half = Math.max(1, Math.round(Math.min(y - 14, 42 - y) / 2) + 1);
        c.srect(24 - half, y, 23, y, y < 28 ? 'C' : 'c');
      }
      c.sline(19, 22, 11, 18, 'Y', 2); c.sline(11, 18, 13, 26, 'Y', 2); c.sline(13, 26, 3, 24, 'Y', 2);
      c.sline(19, 31, 10, 35, 'Y', 2); c.sline(10, 35, 12, 39, 'Y', 2); c.sline(12, 39, 4, 43, 'Y', 2);
      c.disc(23.5, 26, 3.4, 'W'); c.disc(23.5, 26, 1.4, 'R');
      c.outline('K');
      return c.svg({ K: '#07080c', Y: '#fff3a1', C: '#7fd8ff', c: '#3a8fb8', d: '#276582', W: '#f4fbff', R: '#ff3b30' }, 'Storm Sentinel');
    },
    titan() {
      const c = Canvas(48, 48, { V: 'v', U: 'V' });
      c.ring(23.5, 9, 9, 1, 't');
      c.srect(19, 4, 23, 12, 'V'); c.srect(18, 1, 18, 5, 'V');
      c.srect(19, 7, 21, 8, 'T');
      c.srect(8, 13, 23, 19, 'V'); c.srect(9, 9, 10, 13, 'V');
      c.srect(8, 13, 23, 13, 'U'); c.srect(9, 9, 9, 13, 'U');
      c.srect(13, 19, 23, 33, 'V'); c.srect(13, 19, 13, 33, 'U');
      c.srect(4, 15, 8, 36, 'V'); c.srect(4, 15, 4, 36, 'U'); c.srect(3, 37, 8, 41, 'v');
      c.srect(14, 34, 19, 45, 'V'); c.srect(14, 34, 14, 45, 'U'); c.srect(12, 45, 19, 46, 'v');
      c.sline(21, 21, 18, 27, 'T'); c.sline(18, 27, 20, 32, 'T');
      c.srect(22, 24, 23, 27, 'T');
      c.spx(2, 7, 't'); c.spx(5, 3, 't'); c.spx(1, 28, 't'); c.spx(10, 44, 't');
      c.outline('K');
      return c.svg({ K: '#1f6b5a', V: '#222c3b', v: '#141b26', U: '#34435a', T: '#2ee6b6', t: '#1b8f71' }, 'Void Titan');
    },
  };

  root.SPRITES = {
    mech,
    boss: id => (BOSSES[id] ? BOSSES[id]() : ''),
    mix,
  };
})(window);
