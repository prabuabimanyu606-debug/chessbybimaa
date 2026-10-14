export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const KN = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
const KG = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const ok = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

export const isW = p => p >= 'A' && p <= 'Z';
export const colorOf = p => p ? (isW(p) ? 'w' : 'b') : '';

export function newState() {
  const b = [];
  for (const ch of START.replace(/\//g, '')) {
    if (ch >= '1' && ch <= '8') for (let k = 0; k < +ch; k++) b.push('');
    else b.push(ch);
  }
  return { b, turn: 'w', cr: { K: 1, Q: 1, k: 1, q: 1 }, ep: -1 };
}

export function kingSq(b, col) { return b.indexOf(col === 'w' ? 'K' : 'k'); }

export function attacked(b, sq, by) {
  const r = sq >> 3, c = sq & 7, up = by === 'w' ? 1 : -1;
  const u = ch => by === 'w' ? ch.toUpperCase() : ch;
  for (const dc of [-1, 1]) if (ok(r + up, c + dc) && b[(r + up) * 8 + c + dc] === u('p')) return true;
  for (const [dr, dc] of KN) if (ok(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === u('n')) return true;
  for (const [dr, dc] of KG) {
    if (ok(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === u('k')) return true;
    let rr = r + dr, cc = c + dc;
    while (ok(rr, cc)) {
      const p = b[rr * 8 + cc];
      if (p) {
        const l = p.toLowerCase();
        if (colorOf(p) === by && (l === 'q' || (l === 'r' && (dr === 0 || dc === 0)) || (l === 'b' && dr !== 0 && dc !== 0))) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }
  return false;
}

function pseudo(s, from) {
  const { b, cr, ep } = s, p = b[from], col = colorOf(p), t = p.toLowerCase(), r = from >> 3, c = from & 7, m = [];
  const add = (to, x) => m.push({ from, to, ...x });
  if (t === 'p') {
    const d = col === 'w' ? -1 : 1, start = col === 'w' ? 6 : 1, last = col === 'w' ? 0 : 7;
    const push = (to, x) => { if (to >> 3 === last) for (const q of 'qrbn') add(to, { promo: q, ...x }); else add(to, x); };
    if (!b[(r + d) * 8 + c]) {
      push((r + d) * 8 + c);
      if (r === start && !b[(r + 2 * d) * 8 + c]) add((r + 2 * d) * 8 + c, { dbl: 1 });
    }
    for (const dc of [-1, 1]) {
      if (!ok(r + d, c + dc)) continue;
      const to = (r + d) * 8 + c + dc;
      if (b[to] && colorOf(b[to]) !== col) push(to);
      else if (to === ep) add(to, { ep: 1 });
    }
  } else if (t === 'n' || t === 'k') {
    for (const [dr, dc] of t === 'n' ? KN : KG) {
      if (!ok(r + dr, c + dc)) continue;
      const to = (r + dr) * 8 + c + dc;
      if (colorOf(b[to]) !== col) add(to);
    }
    if (t === 'k') {
      const home = col === 'w' ? 60 : 4, opp = col === 'w' ? 'b' : 'w', R = col === 'w' ? 'R' : 'r';
      if (from === home && !attacked(b, home, opp)) {
        if (cr[col === 'w' ? 'K' : 'k'] && b[home + 3] === R && !b[home + 1] && !b[home + 2] && !attacked(b, home + 1, opp) && !attacked(b, home + 2, opp)) add(home + 2, { castle: 'k' });
        if (cr[col === 'w' ? 'Q' : 'q'] && b[home - 4] === R && !b[home - 1] && !b[home - 2] && !b[home - 3] && !attacked(b, home - 1, opp) && !attacked(b, home - 2, opp)) add(home - 2, { castle: 'q' });
      }
    }
  } else {
    for (const [dr, dc] of KG) {
      if (t === 'r' && dr !== 0 && dc !== 0) continue;
      if (t === 'b' && (dr === 0 || dc === 0)) continue;
      let rr = r + dr, cc = c + dc;
      while (ok(rr, cc)) {
        const to = rr * 8 + cc;
        if (b[to]) { if (colorOf(b[to]) !== col) add(to); break; }
        add(to); rr += dr; cc += dc;
      }
    }
  }
  return m;
}

export function apply(s, m) {
  const b = s.b.slice(), p = b[m.from], col = colorOf(p), cr = { ...s.cr };
  b[m.to] = m.promo ? (col === 'w' ? m.promo.toUpperCase() : m.promo) : p;
  b[m.from] = '';
  if (m.ep) b[m.to + (col === 'w' ? 8 : -8)] = '';
  if (m.castle) {
    const h = m.from;
    if (m.castle === 'k') { b[h + 1] = b[h + 3]; b[h + 3] = ''; }
    else { b[h - 1] = b[h - 4]; b[h - 4] = ''; }
  }
  if (p === 'K') { cr.K = 0; cr.Q = 0; }
  if (p === 'k') { cr.k = 0; cr.q = 0; }
  for (const [sq, k] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.from === sq || m.to === sq) cr[k] = 0;
  return { b, turn: col === 'w' ? 'b' : 'w', cr, ep: m.dbl ? (m.from + m.to) / 2 : -1 };
}

export function legal(s, from) {
  return pseudo(s, from).filter(m => {
    const n = apply(s, m);
    return !attacked(n.b, kingSq(n.b, s.turn), n.turn);
  });
}

export function allLegal(s) {
  let a = [];
  s.b.forEach((p, i) => { if (p && colorOf(p) === s.turn) a = a.concat(legal(s, i)); });
  return a;
}

export function inCheck(s) { return attacked(s.b, kingSq(s.b, s.turn), s.turn === 'w' ? 'b' : 'w'); }

export const sqName = i => String.fromCharCode(97 + (i & 7)) + (8 - (i >> 3));
export const idxSq = s => (8 - (+s[1])) * 8 + (s.charCodeAt(0) - 97);
export const moveStr = m => sqName(m.from) + sqName(m.to) + (m.promo || '');

/* Cocokkan string langkah seperti "e2e4" atau "e7e8q" dengan langkah legal dalam posisi s. */
export function findMove(s, str) {
  if (typeof str !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(str)) return null;
  const f = idxSq(str.slice(0, 2)), t = idxSq(str.slice(2, 4)), pr = str[4] || '';
  return allLegal(s).find(m => m.from === f && m.to === t && (m.promo || '') === pr) || null;
}

/* Bangun ulang posisi dari daftar langkah. bad=true jika ada langkah yang tidak legal. */
export function replay(list) {
  let s = newState();
  for (const str of list) {
    const m = findMove(s, str);
    if (!m) return { s, bad: true };
    s = apply(s, m);
  }
  return { s, bad: false };
}
