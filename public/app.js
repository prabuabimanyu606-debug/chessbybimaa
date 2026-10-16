import { newState, apply, allLegal, inCheck, kingSq, legal, colorOf, isW, moveStr, replay } from './chess-engine.mjs';
import { chooseMove, LEVELS } from './chess-ai.mjs';

const $ = id => document.getElementById(id);
const API = '/.netlify/functions/api';
const SCRS = ['scr-menu', 'scr-auth', 'scr-home', 'scr-search', 'scr-game', 'scr-ai'];
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const glyph = p => GLYPH[p.toLowerCase()] + '\uFE0E';
const NAMA_BIDAK = { q: 'Menteri', r: 'Benteng', b: 'Gajah', n: 'Kuda' };

/* Simbol catur dipasang dari font kecil yang ikut tertanam di file ini (hanya 12 simbol catur).
   Dengan font ini, Chrome di HP/tablet tidak lagi menampilkan simbol sebagai gambar emoji abu-abu,
   sehingga warna putih dan hitam tampil sesuai pengaturan. */
const style = document.createElement('style');
style.textContent = `
@font-face{font-family:"CaturBidak";src:url(data:font/woff;base64,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) format("woff");unicode-range:U+2654-265F}
.sq span,#promo button{font-family:"CaturBidak","Segoe UI Symbol","DejaVu Sans",sans-serif;font-variant-emoji:text}
`;
document.head.appendChild(style);

const boardEl = $('board');
const optsEl = $('opts');
for (let i = 0; i < 64; i++) {
  const d = document.createElement('div');
  d.addEventListener('click', () => clickSq(i));
  boardEl.appendChild(d);
}

let SES = null;      // { token, user: { id, name } }
let V = null;        // tampilan permainan aktif (lokal atau online)
let tab = 'masuk';
let homeTimer = null;
let homeGen = 0;
let lastGames = '';
let USERS = [];

try { SES = JSON.parse(localStorage.getItem('catur-sesi') || 'null'); } catch { SES = null; }
if (!SES || !SES.token || !SES.user) SES = null;

function simpanSesi(v) {
  SES = v;
  try {
    if (v) localStorage.setItem('catur-sesi', JSON.stringify(v));
    else localStorage.removeItem('catur-sesi');
  } catch {}
}

function show(id) {
  for (const s of SCRS) $(s).classList.toggle('hidden', s !== id);
}

/* ===== Panggilan API ===== */
async function api(action, data = {}) {
  const headers = { 'content-type': 'application/json' };
  if (SES) headers.authorization = 'Bearer ' + SES.token;
  let r;
  try {
    r = await fetch(API, { method: 'POST', headers, body: JSON.stringify({ action, ...data }) });
  } catch {
    throw new Error('Tidak bisa terhubung ke server. Periksa koneksi Anda.');
  }
  let j = {};
  try { j = await r.json(); } catch {}
  if (r.status === 401 && SES && action !== 'login' && action !== 'register') {
    sesiBerakhir();
    const err = new Error('Sesi berakhir. Silakan masuk lagi.');
    err.authGone = true;
    err.status = 401;
    throw err;
  }
  if (!r.ok) {
    const err = new Error(j.error || 'Terjadi kesalahan. Coba lagi.');
    err.status = r.status;
    throw err;
  }
  return j;
}

function sesiBerakhir() {
  simpanSesi(null);
  stopHome();
  stopGame();
  $('menu-msg').textContent = 'Sesi berakhir. Silakan masuk lagi.';
  show('scr-menu');
}

/* ===== Menu ===== */
$('b-lokal').onclick = () => { $('menu-msg').textContent = ''; bukaLokal(); };
$('b-jauh').onclick = () => {
  $('menu-msg').textContent = '';
  if (SES) bukaBeranda();
  else bukaAuth();
};

/* ===== AI Player ===== */
$('b-ai').onclick = () => { $('menu-msg').textContent = ''; show('scr-ai'); };
$('b-ai-back').onclick = () => { $('menu-msg').textContent = ''; show('scr-menu'); };
document.querySelectorAll('[data-level]').forEach(b => {
  b.onclick = () => bukaAI(b.dataset.level);
});

function bukaAI(level) {
  stopHome();
  stopGame();
  V = baruView('ai', null);
  V.level = LEVELS[level] ? level : 'medium';
  show('scr-game');
  $('gmsg').textContent = '';
  render();
}

/* Giliran AI (Hitam). Berpikir sebentar di setTimeout agar tampilan sempat diperbarui. */
function aiGiliran() {
  const view = V;
  if (!view || view.mode !== 'ai' || view.over) return;
  view.aiThinking = true;
  render();
  view.aiTimer = setTimeout(() => {
    view.aiTimer = null;
    if (V !== view) return;
    const mv = chooseMove(view.S, view.level);
    if (mv) {
      view.S = apply(view.S, mv);
      view.hist.push(moveStr(mv));
    }
    view.aiThinking = false;
    render();
  }, 60);
}

/* ===== Masuk / Daftar ===== */
function setTab(t) {
  tab = t;
  $('t-masuk').classList.toggle('on', t === 'masuk');
  $('t-daftar').classList.toggle('on', t === 'daftar');
  $('b-auth').textContent = t === 'masuk' ? 'Masuk' : 'Buat akun';
  $('i-pass').autocomplete = t === 'masuk' ? 'current-password' : 'new-password';
  $('auth-msg').textContent = '';
}
function bukaAuth() {
  setTab('masuk');
  $('i-user').value = '';
  $('i-pass').value = '';
  show('scr-auth');
}
$('t-masuk').onclick = () => setTab('masuk');
$('t-daftar').onclick = () => setTab('daftar');
$('b-auth-back').onclick = () => { $('menu-msg').textContent = ''; show('scr-menu'); };

$('f-auth').addEventListener('submit', async e => {
  e.preventDefault();
  const username = $('i-user').value.trim();
  const password = $('i-pass').value;
  const msg = $('auth-msg');
  if (tab === 'daftar') {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) { msg.textContent = 'Nama pengguna 3–20 karakter: huruf, angka, atau _.'; return; }
    if (password.length < 6) { msg.textContent = 'Kata sandi minimal 6 karakter.'; return; }
  }
  $('b-auth').disabled = true;
  msg.textContent = 'Memproses…';
  try {
    const out = await api(tab === 'daftar' ? 'register' : 'login', { username, password });
    simpanSesi({ token: out.token, user: out.user });
    $('i-pass').value = '';
    msg.textContent = '';
    bukaBeranda();
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    $('b-auth').disabled = false;
  }
});

/* ===== Beranda: Permainan saya ===== */
function stopHome() {
  if (homeTimer) clearInterval(homeTimer);
  homeTimer = null;
  homeGen++;
}

function bukaBeranda() {
  stopGame();
  stopHome();
  show('scr-home');
  $('me-name').textContent = SES.user.name;
  $('home-msg').textContent = '';
  lastGames = '';
  const gen = homeGen;
  const tick = async () => {
    if (gen !== homeGen) return;
    try {
      const { games } = await api('games');
      if (gen !== homeGen) return;
      const s = JSON.stringify(games);
      if (s !== lastGames) { lastGames = s; renderHome(games); }
      $('home-msg').textContent = '';
    } catch (e) {
      if (gen === homeGen && !e.authGone) $('home-msg').textContent = e.message;
    }
  };
  tick();
  homeTimer = setInterval(tick, 3000);
}

function renderHome(games) {
  const ul = $('list-games');
  ul.textContent = '';
  $('home-kosong').classList.toggle('hidden', games.length > 0);
  for (const g of games) {
    const status = g.over ? 'Selesai' : (g.myTurn ? 'Giliran Anda' : 'Giliran ' + g.opponent);
    const li = document.createElement('li');
    const info = document.createElement('span');
    const nama = document.createElement('strong');
    nama.textContent = 'vs ' + g.opponent;
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = status;
    info.append(nama, document.createElement('br'), sub);
    const btn = document.createElement('button');
    btn.textContent = 'Buka';
    btn.onclick = () => bukaGame(g.id);
    li.append(info, btn);
    ul.appendChild(li);
  }
}

$('b-cari').onclick = () => bukaCari();
$('b-home-back').onclick = () => { stopHome(); $('menu-msg').textContent = ''; show('scr-menu'); };
$('b-keluar').onclick = () => {
  const token = SES ? SES.token : null;
  simpanSesi(null);
  stopHome();
  stopGame();
  $('menu-msg').textContent = '';
  show('scr-menu');
  if (token) {
    fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ action: 'logout' }),
    }).catch(() => {});
  }
};

/* ===== Cari pemain & duel ===== */
async function bukaCari() {
  stopHome();
  show('scr-search');
  $('i-cari').value = '';
  $('list-users').textContent = '';
  $('cari-msg').textContent = 'Memuat daftar pemain…';
  try {
    const out = await api('players');
    USERS = out.players;
    renderUsers();
  } catch (e) {
    if (!e.authGone) $('cari-msg').textContent = e.message;
  }
}

function renderUsers() {
  const q = $('i-cari').value.trim().toLowerCase();
  const ul = $('list-users');
  ul.textContent = '';
  const hasil = USERS.filter(u => !q || u.name.toLowerCase().includes(q));
  $('cari-msg').textContent = USERS.length === 0
    ? 'Belum ada pemain lain.'
    : (hasil.length === 0 ? 'Tidak ada pemain dengan nama itu.' : '');
  for (const u of hasil) {
    const li = document.createElement('li');
    const nm = document.createElement('span');
    nm.textContent = u.name;
    const b = document.createElement('button');
    b.textContent = 'Duel';
    b.onclick = () => duel(u, b);
    li.append(nm, b);
    ul.appendChild(li);
  }
}

$('i-cari').addEventListener('input', renderUsers);
$('b-search-back').onclick = () => bukaBeranda();

async function duel(lawan, btn) {
  btn.disabled = true;
  try {
    const out = await api('duel', { opponentId: lawan.id });
    bukaGame(out.gid);
  } catch (e) {
    if (!e.authGone) {
      $('cari-msg').textContent = 'Duel gagal dibuat. ' + e.message;
      btn.disabled = false;
    }
  }
}

/* ===== Papan: mode lokal dan online ===== */
function baruView(mode, gid) {
  return {
    mode, gid,
    myColor: null, oppName: '',
    hist: [], S: newState(), sel: -1, targets: [], pend: null,
    busy: false, bad: false, over: false, loaded: mode === 'local' || mode === 'ai',
    timer: null, tick: null, fetching: false, again: false,
    aiTimer: null, aiThinking: false, level: null,
  };
}

function bukaLokal() {
  stopHome();
  stopGame();
  V = baruView('local', null);
  show('scr-game');
  $('gmsg').textContent = '';
  $('vs').textContent = '';
  render();
}

function bukaGame(gid) {
  stopHome();
  stopGame();
  V = baruView('online', gid);
  const view = V;
  show('scr-game');
  $('gmsg').textContent = '';
  $('vs').textContent = '';
  $('status').textContent = 'Memuat permainan…';

  const tick = async () => {
    if (V !== view) return;
    if (view.fetching) { view.again = true; return; }
    view.fetching = true;
    const start = view.hist.length;
    try {
      const out = await api('game', { gid, have: start });
      if (V !== view) return;
      view.myColor = out.game.myColor;
      view.oppName = out.game.oppName;
      setHist(view.hist.slice(0, start).concat(out.moves));
      $('gmsg').textContent = '';
    } catch (e) {
      if (V === view && !e.authGone) {
        $('gmsg').textContent = e.message;
        if (e.status === 403 || e.status === 404) clearInterval(view.timer);
      }
    } finally {
      view.fetching = false;
      if (V === view && view.again) { view.again = false; tick(); }
    }
  };

  view.tick = tick;
  tick();
  view.timer = setInterval(tick, 1500);
}

function stopGame() {
  if (V && V.timer) clearInterval(V.timer);
  if (V && V.aiTimer) clearTimeout(V.aiTimer);
  V = null;
  $('promo').classList.remove('on');
}

function setHist(list) {
  if (V.loaded && list.length === V.hist.length && list.every((x, i) => x === V.hist[i])) return;
  V.hist = list.slice();
  const r = replay(V.hist);
  V.S = r.s;
  V.bad = r.bad;
  V.sel = -1;
  V.targets = [];
  V.loaded = true;
  render();
}

function giliranSaya() {
  if (V.mode === 'ai') return V.S.turn === 'w';
  return V.mode === 'local' || V.S.turn === V.myColor;
}

function clickSq(i) {
  if (!V || V.busy || V.over || V.bad || V.pend || !V.loaded || !giliranSaya()) return;
  const cocok = V.targets.filter(m => m.to === i);
  if (V.sel >= 0 && cocok.length) {
    if (cocok[0].promo) { tampilPromosi(cocok); return; }
    langkah(cocok[0]);
    return;
  }
  const p = V.S.b[i];
  if (p && colorOf(p) === V.S.turn && i !== V.sel) {
    V.sel = i;
    V.targets = legal(V.S, i);
  } else {
    V.sel = -1;
    V.targets = [];
  }
  render();
}

function tampilPromosi(list) {
  V.pend = list;
  optsEl.textContent = '';
  const putih = V.S.turn === 'w';
  for (const q of 'qrbn') {
    const bt = document.createElement('button');
    bt.textContent = glyph(q);
    bt.style.color = putih ? '#fff' : '#15181d';
    bt.style.textShadow = putih ? '0 0 2px #000,0 0 2px #000' : 'none';
    bt.setAttribute('aria-label', NAMA_BIDAK[q]);
    bt.onclick = () => { const m = list.find(x => x.promo === q); if (m) langkah(m); };
    optsEl.appendChild(bt);
  }
  $('promo').classList.add('on');
}

function langkah(m) {
  const str = moveStr(m);
  V.sel = -1;
  V.targets = [];
  V.pend = null;
  $('promo').classList.remove('on');
  if (V.mode === 'local' || V.mode === 'ai') {
    V.S = apply(V.S, m);
    V.hist.push(str);
    render();
    if (V.mode === 'ai') aiGiliran();
  } else {
    render();
    kirimLangkah(str);
  }
}

async function kirimLangkah(str) {
  const view = V;
  view.busy = true;
  $('gmsg').textContent = '';
  render();
  try {
    await api('move', { gid: view.gid, move: str });
  } catch (e) {
    if (V === view && !e.authGone) $('gmsg').textContent = e.message;
  } finally {
    view.busy = false;
    if (V === view) {
      render();
      if (view.tick) view.tick();   // selalu sinkron ulang dari server setelah mencoba mengirim
    }
  }
}

function statusText(over, chk) {
  if (V.mode === 'online' && !V.loaded) return 'Memuat permainan…';
  if (V.bad) return 'Data permainan rusak. Kembali lalu buka lagi.';
  if (V.mode === 'ai') {
    if (over) return chk ? `Skakmat! ${V.S.turn === 'w' ? 'AI' : 'Anda'} menang` : 'Seri: stalemate (pat)';
    if (V.S.turn === 'w') return 'Giliran Anda' + (chk ? ' — skak!' : '');
    return (V.aiThinking ? 'AI sedang berpikir…' : 'Giliran AI') + (chk ? ' — skak!' : '');
  }
  if (V.mode === 'local') {
    if (over) return chk ? `Skakmat! ${V.S.turn === 'w' ? 'Hitam' : 'Putih'} menang` : 'Seri: stalemate (pat)';
    return `Giliran ${V.S.turn === 'w' ? 'Putih' : 'Hitam'}${chk ? ' — skak!' : ''}`;
  }
  const mine = V.S.turn === V.myColor;
  if (over) return chk ? `Skakmat! ${mine ? V.oppName : 'Anda'} menang` : 'Seri: stalemate (pat)';
  return (mine ? 'Giliran Anda' : `Menunggu ${V.oppName}`) + (chk ? ' — skak!' : '');
}

function render() {
  if (!V) return;
  const S = V.S, chk = inCheck(S), over = allLegal(S).length === 0;
  V.over = over;
  const ks = kingSq(S.b, S.turn);
  const tuju = new Map();
  if (V.sel >= 0) for (const m of V.targets) tuju.set(m.to, m);
  for (let i = 0; i < 64; i++) {
    const d = boardEl.children[i], p = S.b[i], m = tuju.get(i);
    const cls = ['sq', (((i >> 3) + (i & 7)) % 2 ? 'd' : 'l')];
    if (i === V.sel) cls.push('sel');
    if (m) cls.push('hint', (p || m.ep) ? 'cap' : '');
    if (chk && i === ks) cls.push('chk');
    d.className = cls.filter(Boolean).join(' ');
    d.innerHTML = p ? `<span class="${isW(p) ? 'w' : 'b'}">${glyph(p)}</span>` : '';
  }
  $('status').textContent = statusText(over, chk);
  if (V.mode === 'ai') {
    $('vs').textContent = `Anda: Putih · Lawan: AI ${LEVELS[V.level].label}`;
  } else {
    $('vs').textContent = (V.mode === 'online' && V.loaded && V.myColor)
      ? `Anda: ${V.myColor === 'w' ? 'Putih' : 'Hitam'} · Lawan: ${V.oppName}`
      : '';
  }
}

$('b-game-back').onclick = () => {
  const online = V && V.mode === 'online';
  stopGame();
  $('gmsg').textContent = '';
  if (online) bukaBeranda();
  else { $('menu-msg').textContent = ''; show('scr-menu'); }
};

/* ===== Mulai ===== */
show('scr-menu');
setTab('masuk');
