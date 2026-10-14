import { newState, apply, allLegal, inCheck, kingSq, legal, colorOf, isW, moveStr, replay } from './chess-engine.mjs';

const $ = id => document.getElementById(id);
const API = '/.netlify/functions/api';
const SCRS = ['scr-menu', 'scr-auth', 'scr-home', 'scr-search', 'scr-game'];
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const NAMA_BIDAK = { q: 'Menteri', r: 'Benteng', b: 'Gajah', n: 'Kuda' };
const glyph = p => GLYPH[p.toLowerCase()] + '\uFE0E';

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
    busy: false, bad: false, over: false, loaded: mode === 'local',
    timer: null, tick: null, fetching: false, again: false,
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
  if (V.mode === 'local') {
    V.S = apply(V.S, m);
    V.hist.push(str);
    render();
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
  $('vs').textContent = (V.mode === 'online' && V.loaded && V.myColor)
    ? `Anda: ${V.myColor === 'w' ? 'Putih' : 'Hitam'} · Lawan: ${V.oppName}`
    : '';
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
