// 8-bit pixel sprite for the player mech, drawn on a small grid and rendered as crisp SVG.
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
  // A lanky frame with a forehead horn, built from layers so every armour slot changes its
  // silhouette: plate is heavy and spiked, leather is lean, cloth is draped. Armour pieces take
  // the tier colour on their main plates and the pilot's paint shows on the frame and trims.
  // opts: { paint, accent, head, body, legs: { type, colour } | null, weapon, weaponColour, core }
  const W = 40, H = 56;

  function drawFrame(c) {
    c.srect(17, 6, 19, 11, 'P');
    c.srect(18, 8, 19, 8, 'E');
    c.srect(18, 10, 19, 11, 'G');
    c.spx(16, 7, 'p');
    c.srect(18, 12, 19, 12, 'D');
    c.srect(15, 13, 19, 22, 'P');
    c.srect(16, 14, 17, 15, 'H');
    c.srect(17, 23, 19, 26, 'D');
    c.srect(16, 27, 19, 28, 'p');
    c.srect(15, 29, 19, 31, 'P');
    c.srect(12, 13, 14, 15, 'D');
    c.srect(12, 16, 13, 23, 'P');
    c.srect(12, 16, 12, 23, 'p');
    c.srect(12, 24, 13, 24, 'D');
    c.srect(11, 25, 13, 31, 'P');
    c.srect(11, 25, 11, 31, 'p');
    c.srect(11, 32, 13, 33, 'D');
    c.srect(15, 32, 17, 40, 'P');
    c.srect(15, 32, 15, 40, 'p');
    c.srect(15, 41, 17, 41, 'D');
    c.srect(15, 42, 17, 50, 'P');
    c.srect(15, 42, 15, 50, 'p');
    c.srect(15, 51, 17, 51, 'D');
    c.srect(14, 52, 18, 53, 'p');
  }

  const HEADS = {
    plate(c) {
      c.srect(16, 5, 19, 11, 'A');
      c.srect(16, 5, 16, 11, 'a');
      c.srect(17, 8, 19, 8, 'E');
      c.srect(19, 1, 19, 4, 'H');
      c.srect(18, 3, 18, 4, 'P');
      c.srect(15, 6, 15, 9, 'A');
      c.srect(17, 10, 19, 11, 'P');
      c.srect(18, 11, 19, 11, 'G');
    },
    leather(c) {
      c.srect(15, 5, 19, 12, 'A');
      c.srect(15, 5, 15, 12, 'a');
      c.srect(18, 3, 19, 4, 'A');
      c.srect(17, 8, 19, 11, 'D');
      c.srect(18, 9, 19, 9, 'E');
      c.srect(14, 12, 19, 13, 'a');
    },
    cloth(c) {
      c.srect(19, 0, 19, 1, 'A');
      c.srect(18, 2, 19, 3, 'A');
      c.srect(17, 4, 19, 5, 'A');
      c.srect(14, 6, 19, 6, 'a');
      c.srect(16, 5, 19, 5, 'G');
      c.srect(17, 7, 19, 11, 'P');
      c.srect(18, 8, 19, 8, 'E');
      c.srect(18, 10, 19, 11, 'p');
    },
  };

  const BODIES = {
    plate(c) {
      c.srect(15, 13, 19, 21, 'P');
      c.srect(15, 13, 19, 13, 'B');
      c.srect(15, 19, 19, 21, 'B');
      c.srect(16, 22, 19, 23, 'b');
      c.srect(9, 11, 14, 17, 'B');
      c.srect(9, 11, 9, 17, 'b');
      c.srect(10, 9, 11, 10, 'B');
      c.spx(10, 8, 'H');
      c.srect(10, 18, 14, 18, 'b');
      c.srect(11, 25, 13, 29, 'B');
    },
    leather(c) {
      c.srect(15, 14, 19, 23, 'B');
      c.srect(15, 14, 15, 23, 'b');
      c.srect(16, 16, 16, 16, 'b'); c.srect(17, 17, 17, 17, 'b'); c.srect(18, 18, 18, 18, 'b');
      c.srect(11, 13, 14, 15, 'B');
      c.srect(11, 13, 11, 15, 'b');
      c.srect(15, 26, 19, 27, 'b');
      c.srect(19, 26, 19, 27, 'G');
      c.srect(11, 28, 13, 30, 'b');
    },
    cloth(c) {
      c.srect(13, 12, 19, 14, 'b');
      c.srect(15, 15, 19, 24, 'B');
      c.srect(19, 15, 19, 24, 'G');
      c.srect(10, 16, 13, 24, 'B');
      c.srect(10, 16, 10, 24, 'b');
      c.srect(10, 24, 13, 24, 'G');
      c.srect(17, 25, 19, 40, 'B');
      c.srect(17, 25, 17, 40, 'b');
      c.srect(17, 40, 19, 40, 'G');
    },
  };

  const LEGS = {
    plate(c) {
      c.srect(14, 32, 17, 39, 'C');
      c.srect(14, 32, 14, 39, 'c');
      c.srect(15, 40, 17, 42, 'c');
      c.spx(16, 39, 'H');
      c.srect(14, 43, 17, 50, 'C');
      c.srect(14, 43, 14, 50, 'c');
      c.srect(13, 51, 18, 53, 'C');
      c.srect(13, 53, 18, 53, 'c');
    },
    leather(c) {
      c.srect(15, 34, 17, 35, 'c');
      c.srect(15, 38, 17, 38, 'c');
      c.srect(14, 44, 17, 51, 'C');
      c.srect(14, 44, 17, 44, 'c');
      c.srect(14, 44, 14, 51, 'c');
      c.srect(13, 52, 18, 53, 'c');
    },
    cloth(c) {
      c.srect(14, 32, 17, 47, 'C');
      c.srect(14, 32, 14, 47, 'c');
      c.srect(13, 45, 17, 48, 'C');
      c.srect(15, 30, 19, 31, 'c');
      c.srect(14, 52, 18, 53, 'c');
    },
  };

  // Weapons sit in the right hand (the viewer's right), apart from the bulwark's shield.
  const WEAPONS = {
    sword(c) { c.rect(29, 11, 30, 29, 'W'); c.rect(30, 11, 30, 29, 'Y'); c.rect(27, 30, 32, 30, 'w'); c.rect(29, 31, 30, 35, 'D'); },
    greatsword(c) { c.rect(29, 3, 31, 28, 'W'); c.rect(31, 3, 31, 28, 'Y'); c.px(30, 2, 'W'); c.rect(26, 29, 34, 30, 'w'); c.rect(29, 31, 31, 37, 'D'); c.px(30, 38, 'X'); },
    bulwark(c) {
      c.rect(3, 17, 12, 40, 'W'); c.rect(3, 17, 12, 17, 'w'); c.rect(3, 40, 12, 40, 'w'); c.rect(3, 17, 3, 40, 'w'); c.rect(12, 17, 12, 40, 'w');
      c.rect(7, 22, 8, 34, 'X'); c.rect(5, 26, 10, 27, 'X');
      c.rect(29, 21, 30, 30, 'W'); c.rect(27, 31, 32, 31, 'w'); c.rect(29, 32, 30, 34, 'D');
    },
    shortbow(c) { c.rect(32, 20, 32, 42, 'W'); c.rect(31, 18, 31, 20, 'W'); c.rect(31, 42, 31, 44, 'W'); c.rect(30, 19, 30, 43, 'Y'); c.rect(33, 29, 33, 33, 'w'); },
    longbow(c) { c.rect(32, 9, 32, 50, 'W'); c.rect(31, 6, 31, 9, 'W'); c.rect(31, 50, 31, 53, 'W'); c.rect(30, 7, 30, 52, 'Y'); c.rect(33, 27, 33, 33, 'w'); },
    crossbow(c) { c.rect(24, 28, 36, 30, 'W'); c.rect(24, 30, 36, 30, 'w'); c.rect(34, 22, 35, 36, 'w'); c.rect(33, 29, 39, 29, 'Y'); c.rect(25, 31, 27, 34, 'w'); },
    wand(c) { c.rect(29, 22, 29, 34, 'W'); c.disc(29, 20, 1.6, 'X'); c.px(29, 20, 'Y'); c.px(32, 17, 'X'); c.px(26, 18, 'X'); },
    staff(c) { c.rect(30, 6, 30, 53, 'W'); c.rect(29, 6, 29, 8, 'w'); c.rect(31, 6, 31, 8, 'w'); c.disc(30, 3, 2.2, 'X'); c.px(30, 3, 'Y'); },
    orb(c) { c.disc(31, 23, 3.4, 'X'); c.disc(31, 23, 1.6, 'Y'); c.rect(28, 29, 34, 29, 'W'); c.px(36, 18, 'X'); c.px(27, 18, 'X'); c.px(35, 28, 'X'); },
    scroll(c) { c.rect(28, 29, 35, 37, 'Y'); c.rect(28, 28, 28, 38, 'W'); c.rect(35, 28, 35, 38, 'W'); c.rect(30, 31, 33, 31, 'w'); c.rect(30, 33, 33, 33, 'w'); c.rect(30, 35, 32, 35, 'w'); },
    tome(c) { c.rect(27, 28, 34, 37, 'W'); c.rect(28, 29, 33, 36, 'Y'); c.rect(30, 30, 31, 35, 'X'); c.rect(29, 32, 32, 33, 'X'); },
    codex(c) { c.rect(25, 24, 36, 32, 'Y'); c.rect(30, 24, 31, 32, 'W'); c.rect(25, 32, 36, 33, 'W'); c.px(24, 21, 'X'); c.px(37, 21, 'X'); c.px(30, 20, 'X'); c.px(27, 28, 'w'); c.px(34, 28, 'w'); },
  };
  const GLOW = { melee: '#ffe08a', ranged: '#fff3c4', magic: '#c58cff', healer: '#6dffb0' };

  function mech(opts) {
    const o = opts || {};
    const paint = o.paint || '#8d95a5';
    const accent = o.accent || '#8cff5a';
    const c = Canvas(W, H, { H: 'P' });
    drawFrame(c);
    if (o.legs && LEGS[o.legs.type]) LEGS[o.legs.type](c);
    if (o.body && BODIES[o.body.type]) BODIES[o.body.type](c);
    if (o.head && HEADS[o.head.type]) HEADS[o.head.type](c);
    c.srect(19, 16, 19, 17, 'R');
    if (o.weapon && WEAPONS[o.weapon]) WEAPONS[o.weapon](c);
    c.outline('K');
    const tone = (slot, fallback) => (o[slot] ? o[slot].colour : fallback);
    const A = tone('head', paint), B = tone('body', paint), C = tone('legs', paint);
    const wc = o.weaponColour || '#b4bcc6';
    return c.svg({
      K: '#07080c', P: paint, p: mix(paint, -0.32), H: mix(paint, 0.35), G: accent, E: '#ffdf4d', D: '#1b1e26',
      R: o.core || '#b3261e', A, a: mix(A, -0.32), B, b: mix(B, -0.32), C, c: mix(C, -0.32),
      W: wc, w: mix(wc, -0.35), X: GLOW[o.role] || accent, Y: '#f4efe0',
    }, 'Mech');
  }

  root.SPRITES = { mech, mix };
})(window);
