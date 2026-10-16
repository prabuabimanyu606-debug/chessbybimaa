import { allLegal, apply, inCheck, isW } from './chess-engine.mjs';

/* Tingkat kesulitan. Angka budgetMs adalah batas waktu berpikir per langkah. */
export const LEVELS = {
  easy:   { label: 'Easy',   depth: 1, quiescence: false, budgetMs: 1500, noise: 150 },
  medium: { label: 'Medium', depth: 2, quiescence: false, budgetMs: 2500, noise: 0 },
  hard:   { label: 'Hard',   depth: 3, quiescence: false, budgetMs: 3000, noise: 0 },
  expert: { label: 'Expert', depth: 5, quiescence: true,  budgetMs: 3000, noise: 0 },
};

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const MATE = 100000;
const QMAX = 6;
const ABORT = { abort: true };
let nodes = 0, deadline = 0;

/* Nilai posisi bidak (sudut pandang Putih, indeks 0 = a8). Hitam memakai i ^ 56. */
const PST = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
      0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
      -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
      0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};

function evalWhite(b) {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const t = p.toLowerCase();
    if (isW(p)) s += VAL[t] + PST[t][i];
    else s -= VAL[t] + PST[t][i ^ 56];
  }
  return s;
}

const sideScore = s => (s.turn === 'w' ? 1 : -1) * evalWhite(s.b);
const sameMove = (a, b) => a.from === b.from && a.to === b.to && (a.promo || '') === (b.promo || '');

function tick() {
  if ((++nodes & 1023) === 0 && Date.now() > deadline) throw ABORT;
}

function captured(s, m) {
  if (m.ep) return 'p';
  const c = s.b[m.to];
  return c ? c.toLowerCase() : '';
}

/* Urutan langkah: makan bidak terbaik dulu, lalu promosi. Langkah 'first' (hasil iterasi sebelumnya) diletakkan paling depan. */
function ordered(s, moves, first) {
  const score = m => {
    let v = 0;
    const cap = captured(s, m);
    if (cap) v += VAL[cap] * 10 - VAL[s.b[m.from].toLowerCase()];
    if (m.promo) v += 800;
    return v;
  };
  moves.sort((a, b) => score(b) - score(a));
  if (first) {
    const i = moves.findIndex(m => sameMove(m, first));
    if (i > 0) { const [x] = moves.splice(i, 1); moves.unshift(x); }
  }
  return moves;
}

function quiesce(s, alpha, beta, ply) {
  tick();
  const stand = sideScore(s);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (ply >= QMAX) return stand;
  const caps = ordered(s, allLegal(s).filter(m => captured(s, m) || m.promo), null);
  for (const m of caps) {
    const v = -quiesce(apply(s, m), -beta, -alpha, ply + 1);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function negamax(s, depth, alpha, beta, ply, useQ) {
  tick();
  if (depth === 0) return useQ ? quiesce(s, alpha, beta, ply) : sideScore(s);
  const moves = ordered(s, allLegal(s), null);
  if (moves.length === 0) return inCheck(s) ? -(MATE - ply) : 0;
  let best = -Infinity;
  for (const m of moves) {
    const v = -negamax(apply(s, m), depth - 1, -beta, -alpha, ply + 1, useQ);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function rootScores(s, depth, useQ, first) {
  const moves = ordered(s, allLegal(s), first);
  const out = [];
  let alpha = -Infinity;
  for (const m of moves) {
    const v = -negamax(apply(s, m), depth - 1, -Infinity, -alpha, 1, useQ);
    out.push({ move: m, score: v });
    if (v > alpha) alpha = v;
  }
  return out;
}

/* Pilih langkah untuk pihak yang sedang jalan dalam posisi s. Mengembalikan null jika tidak ada langkah legal. */
export function chooseMove(s, level) {
  const cfg = LEVELS[level] || LEVELS.medium;
  const root = allLegal(s);
  if (root.length === 0) return null;
  if (root.length === 1) return root[0];
  nodes = 0;
  deadline = Date.now() + cfg.budgetMs;
  let best = null, lastList = null;
  try {
    for (let d = 1; d <= cfg.depth; d++) {
      const list = rootScores(s, d, cfg.quiescence, best);
      list.sort((a, b) => b.score - a.score);
      lastList = list;
      best = list[0].move;
    }
  } catch (e) {
    if (e !== ABORT) throw e;
  }
  if (cfg.noise && lastList) {
    const top = lastList[0].score;
    const pool = lastList.filter(x => x.score >= top - cfg.noise);
    return pool[Math.floor(Math.random() * pool.length)].move;
  }
  return best || root[0];
}
