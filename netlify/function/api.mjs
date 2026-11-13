import { getStore } from "@netlify/blobs";
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { allLegal, apply, findMove, inCheck, replay } from "../../public/chess-engine.mjs";

const scrypt = promisify(scryptCb);
const SESSION_MS = 30 * 24 * 3600 * 1000;
const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const ID_RE = /^[a-z0-9_]{3,20}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const MOVE_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const MAX_RENAME = 3;
const TIME_OPTIONS = [10, 30];   // menit
const DEFAULT_MIN = 10;

/*
 * Penyimpanan (satu store "catur"), kunci:
 *   u/<id>            profil publik {id, name, createdAt}
 *   c/<id>            kredensial {salt, hash}  (scrypt)
 *   s/<token>         sesi {uid, exp}
 *   g/<gid>           permainan {white, black, whiteName, blackName, createdAt, timeMs}
 *   i/<uid>/<gid>     indeks permainan milik pemain
 *   m/<gid>/<ply>     langkah {m, t, w, b}: t = waktu server, w/b = sisa waktu (ms) setelah langkah
 *   d/<gid>/<ply>     tawaran remis pada posisi <ply> {by, status}
 *   e/<gid>           hasil akhir {result, winner}
 *   r/<uid>/<nomor>   catatan ganti nama
 */

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

const store = () => getStore({ name: "catur", consistency: "strong" });
const get = (st, key) => st.get(key, { type: "json" });
const pad = n => String(n).padStart(5, "0");
const plyOf = k => Number(k.slice(k.lastIndexOf("/") + 1));
const hashOf = async (pass, salt) => (await scrypt(pass, salt, 64)).toString("hex");
const colorIn = (meta, uid) => meta.white === uid ? "w" : (meta.black === uid ? "b" : null);
const other = c => c === "w" ? "b" : "w";

async function newSession(st, uid) {
  const token = randomBytes(32).toString("hex");
  await st.setJSON(`s/${token}`, { uid, exp: Date.now() + SESSION_MS });
  return token;
}

async function requireUser(st, req) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get("authorization") || "");
  if (!m) throw new ApiError(401, "Harus masuk dulu.");
  const sess = await get(st, `s/${m[1]}`);
  if (!sess || sess.exp < Date.now()) throw new ApiError(401, "Sesi berakhir. Masuk lagi.");
  const user = await get(st, `u/${sess.uid}`);
  if (!user) throw new ApiError(401, "Sesi berakhir. Masuk lagi.");
  return { token: m[1], user };
}

/* Sinyal "ada perubahan" ke Pusher. Gagal kirim tidak membatalkan apa pun; cadangan polling tetap berjalan. */
async function notifyGame(gid, data) {
  const appId = process.env.PUSHER_APP_ID, key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET, cluster = process.env.PUSHER_CLUSTER;
  if (!appId || !key || !secret || !cluster) return;
  try {
    const body = JSON.stringify({ name: "move", channel: `game-${gid}`, data: JSON.stringify(data) });
    const path = `/apps/${appId}/events`;
    const params = {
      auth_key: key,
      auth_timestamp: String(Math.floor(Date.now() / 1000)),
      auth_version: "1.0",
      body_md5: createHash("md5").update(body).digest("hex"),
    };
    const qs = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
    const sig = createHmac("sha256", secret).update(`POST\n${path}\n${qs}`).digest("hex");
    const r = await fetch(`https://api-${cluster}.pusher.com${path}?${qs}&auth_signature=${sig}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) console.error("Pusher menolak sinyal:", r.status);
  } catch (err) {
    console.error("Gagal kirim sinyal Pusher:", err);
  }
}

async function renameCount(st, uid) {
  return ((await st.list({ prefix: `r/${uid}/` })).blobs || []).length;
}

async function plyCount(st, gid) {
  return ((await st.list({ prefix: `m/${gid}/` })).blobs || []).length;
}

async function currentName(st, uid, fallback) {
  const u = await get(st, `u/${uid}`);
  return u ? u.name : fallback;
}

/* Ambil catatan langkah. recs = catatan dengan ply >= from; last = catatan terakhir (untuk jam). */
async function loadRecords(st, gid, from = 0) {
  const res = await st.list({ prefix: `m/${gid}/` });
  const keys = (res.blobs || []).map(b => b.key).sort();
  const total = keys.length;
  const wanted = keys.filter(k => plyOf(k) >= from);
  const recs = (await Promise.all(wanted.map(k => get(st, k)))).filter(Boolean);
  let last = null;
  if (total > 0) {
    const lastKey = keys[total - 1];
    last = wanted.includes(lastKey) ? recs[recs.length - 1] ?? null : await get(st, lastKey);
  }
  return { total, recs, last };
}

/* Jam: sisa waktu tiap pemain. Pihak yang sedang jalan berkurang sejak langkah terakhir. */
function clockState(meta, total, last, now) {
  const base = meta.timeMs || DEFAULT_MIN * 60000;
  let w = base, b = base, t0 = meta.createdAt;
  if (last) { w = last.w; b = last.b; t0 = last.t; }
  const turn = total % 2 === 0 ? "w" : "b";
  const elapsed = Math.max(0, now - t0);
  return { w: turn === "w" ? w - elapsed : w, b: turn === "b" ? b - elapsed : b, turn, serverNow: now };
}

async function setEnd(st, gid, value) {
  return st.setJSON(`e/${gid}`, value, { onlyIfNew: true });
}

const actions = {
  /* Konfigurasi publik untuk browser (kunci Pusher yang aman dibagikan). Tidak butuh login. */
  async config() {
    const key = process.env.PUSHER_KEY, cluster = process.env.PUSHER_CLUSTER;
    if (!key || !cluster) return { pusherKey: null, pusherCluster: null };
    return { pusherKey: key, pusherCluster: cluster };
  },

  async register(st, b) {
    const name = String(b.username ?? "").trim();
    const pass = String(b.password ?? "");
    if (!NAME_RE.test(name)) throw new ApiError(400, "Nama pengguna 3–20 karakter: huruf, angka, atau _.");
    if (pass.length < 6 || pass.length > 200) throw new ApiError(400, "Kata sandi 6–200 karakter.");
    const id = name.toLowerCase();
    const claim = await st.setJSON(`u/${id}`, { id, name, createdAt: Date.now() }, { onlyIfNew: true });
    if (claim?.modified === false) throw new ApiError(409, "Nama pengguna sudah dipakai.");
    const salt = randomBytes(16).toString("hex");
    await st.setJSON(`c/${id}`, { salt, hash: await hashOf(pass, salt) });
    const token = await newSession(st, id);
    return { token, user: { id, name } };
  },

  async login(st, b) {
    const name = String(b.username ?? "").trim();
    const pass = String(b.password ?? "");
    const id = name.toLowerCase();
    const [cred, user] = await Promise.all([get(st, `c/${id}`), get(st, `u/${id}`)]);
    let good = false;
    if (cred && user) {
      const expected = Buffer.from(cred.hash, "hex");
      const got = await scrypt(pass, cred.salt, 64);
      good = got.length === expected.length && timingSafeEqual(got, expected);
    }
    if (!good) throw new ApiError(401, "Nama pengguna atau kata sandi salah.");
    const token = await newSession(st, id);
    return { token, user: { id: user.id, name: user.name } };
  },

  async profile(st, _b, me) {
    const used = await renameCount(st, me.user.id);
    return { user: { id: me.user.id, name: me.user.name }, renamesLeft: Math.max(0, MAX_RENAME - used) };
  },

  async rename(st, b, me) {
    const name = String(b.name ?? "").trim();
    if (!NAME_RE.test(name)) throw new ApiError(400, "Nama 3–20 karakter: huruf, angka, atau _.");
    if (name === me.user.name) throw new ApiError(400, "Nama itu sama dengan nama sekarang.");
    const used = await renameCount(st, me.user.id);
    if (used >= MAX_RENAME) throw new ApiError(409, `Batas ganti nama sudah habis (${MAX_RENAME}x).`);
    const claim = await st.setJSON(`r/${me.user.id}/${pad(used + 1)}`, { name, at: Date.now() }, { onlyIfNew: true });
    if (claim?.modified === false) throw new ApiError(409, "Ganti nama bersamaan. Coba lagi.");
    await st.setJSON(`u/${me.user.id}`, { ...me.user, name });
    return { user: { id: me.user.id, name }, renamesLeft: MAX_RENAME - used - 1 };
  },

  async logout(st, _b, me) {
    await st.delete(`s/${me.token}`);
    return { ok: true };
  },

  async players(st, _b, me) {
    const res = await st.list({ prefix: "u/" });
    const users = await Promise.all((res.blobs || []).map(x => get(st, x.key)));
    const players = users
      .filter(u => u && u.id !== me.user.id)
      .map(u => ({ id: u.id, name: u.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { players };
  },

  async duel(st, b, me) {
    const oid = String(b.opponentId ?? "");
    const mins = b.timeMin === undefined ? DEFAULT_MIN : Number(b.timeMin);
    if (!TIME_OPTIONS.includes(mins)) throw new ApiError(400, "Pilihan waktu tidak valid.");
    if (!ID_RE.test(oid)) throw new ApiError(400, "Pemain tidak valid.");
    if (oid === me.user.id) throw new ApiError(400, "Tidak bisa duel dengan diri sendiri.");
    const opp = await get(st, `u/${oid}`);
    if (!opp) throw new ApiError(404, "Pemain tidak ditemukan.");
    const gid = randomBytes(8).toString("hex");
    const createdAt = Date.now();
    await st.setJSON(`g/${gid}`, {
      white: me.user.id, black: oid, whiteName: me.user.name, blackName: opp.name,
      createdAt, timeMs: mins * 60000,
    }, { onlyIfNew: true });
    await st.setJSON(`i/${me.user.id}/${gid}`, { gid, createdAt });
    await st.setJSON(`i/${oid}/${gid}`, { gid, createdAt });
    return { gid };
  },

  async games(st, _b, me) {
    const res = await st.list({ prefix: `i/${me.user.id}/` });
    const gids = (res.blobs || []).map(x => x.key.split("/")[2]);
    const metas = (await Promise.all(gids.map(async gid => ({ gid, meta: await get(st, `g/${gid}`) }))))
      .filter(x => x.meta);
    metas.sort((a, b) => (b.meta.createdAt || 0) - (a.meta.createdAt || 0));
    const games = await Promise.all(metas.slice(0, 30).map(async ({ gid, meta }) => {
      const plies = await plyCount(st, gid);
      const end = await get(st, `e/${gid}`);
      const myColor = colorIn(meta, me.user.id);
      const oppId = myColor === "w" ? meta.black : meta.white;
      const oppName = await currentName(st, oppId, myColor === "w" ? meta.blackName : meta.whiteName);
      return {
        id: gid,
        opponent: oppName,
        myColor,
        myTurn: (plies % 2 === 0) === (myColor === "w"),
        over: !!end,
        createdAt: meta.createdAt,
      };
    }));
    return { games };
  },

  async game(st, b, me) {
    const gid = String(b.gid ?? "");
    if (!HEX16.test(gid)) throw new ApiError(400, "Permainan tidak valid.");
    const meta = await get(st, `g/${gid}`);
    if (!meta) throw new ApiError(404, "Permainan tidak ditemukan.");
    const myColor = colorIn(meta, me.user.id);
    if (!myColor) throw new ApiError(403, "Anda bukan pemain di permainan ini.");
    const from = Math.max(0, Number.parseInt(b.have, 10) || 0);
    const now = Date.now();
    const { total, recs, last } = await loadRecords(st, gid, from);
    const end = await get(st, `e/${gid}`);
    const offer = await get(st, `d/${gid}/${pad(total)}`);
    const oppId = myColor === "w" ? meta.black : meta.white;
    const oppName = await currentName(st, oppId, myColor === "w" ? meta.blackName : meta.whiteName);
    return {
      game: { id: gid, myColor, oppName, whiteName: meta.whiteName, blackName: meta.blackName, timeMs: meta.timeMs },
      from,
      moves: recs.map(r => r.m),
      clock: clockState(meta, total, last, now),
      end: end || null,
      offer: offer || null,
    };
  },

  async move(st, b, me) {
    const gid = String(b.gid ?? "");
    const mv = String(b.move ?? "");
    if (!HEX16.test(gid)) throw new ApiError(400, "Permainan tidak valid.");
    if (!MOVE_RE.test(mv)) throw new ApiError(400, "Format langkah tidak valid.");
    const meta = await get(st, `g/${gid}`);
    if (!meta) throw new ApiError(404, "Permainan tidak ditemukan.");
    const myColor = colorIn(meta, me.user.id);
    if (!myColor) throw new ApiError(403, "Anda bukan pemain di permainan ini.");
    if (await get(st, `e/${gid}`)) throw new ApiError(409, "Permainan sudah selesai.");

    const now = Date.now();
    const { total, recs, last } = await loadRecords(st, gid, 0);
    const { s, bad } = replay(recs.map(r => r.m));
    if (bad) throw new ApiError(500, "Data permainan rusak.");
    if (s.turn !== myColor) throw new ApiError(409, "Bukan giliran Anda.");
    if (allLegal(s).length === 0) throw new ApiError(409, "Permainan sudah selesai.");

    const clk = clockState(meta, total, last, now);
    if (clk[myColor] <= 0) {
      await setEnd(st, gid, { result: "timeout", winner: other(myColor) });
      await notifyGame(gid, { end: "timeout" });
      throw new ApiError(409, "Waktu habis.");
    }
    const m = findMove(s, mv);
    if (!m) throw new ApiError(400, "Langkah tidak legal.");

    const ply = total;
    const claim = await st.setJSON(`m/${gid}/${pad(ply)}`, { m: mv, t: now, w: clk.w, b: clk.b }, { onlyIfNew: true });
    if (claim?.modified === false) throw new ApiError(409, "Papan sudah berubah. Muat ulang.");

    const after = apply(s, m);
    if (allLegal(after).length === 0) {
      const mate = inCheck(after);
      await setEnd(st, gid, { result: mate ? "mate" : "stalemate", winner: mate ? myColor : null });
    }
    await notifyGame(gid, { ply });
    return { ok: true, ply };
  },

  async resign(st, b, me) {
    const gid = String(b.gid ?? "");
    if (!HEX16.test(gid)) throw new ApiError(400, "Permainan tidak valid.");
    const meta = await get(st, `g/${gid}`);
    if (!meta) throw new ApiError(404, "Permainan tidak ditemukan.");
    const myColor = colorIn(meta, me.user.id);
    if (!myColor) throw new ApiError(403, "Anda bukan pemain di permainan ini.");
    const claim = await setEnd(st, gid, { result: "resign", winner: other(myColor) });
    if (claim?.modified === false) throw new ApiError(409, "Permainan sudah selesai.");
    await notifyGame(gid, { end: "resign" });
    return { ok: true };
  },

  async timeout(st, b, me) {
    const gid = String(b.gid ?? "");
    if (!HEX16.test(gid)) throw new ApiError(400, "Permainan tidak valid.");
    const meta = await get(st, `g/${gid}`);
    if (!meta) throw new ApiError(404, "Permainan tidak ditemukan.");
    if (!colorIn(meta, me.user.id)) throw new ApiError(403, "Anda bukan pemain di permainan ini.");
    if (await get(st, `e/${gid}`)) throw new ApiError(409, "Permainan sudah selesai.");
    const now = Date.now();
    const { total, last } = await loadRecords(st, gid, Number.MAX_SAFE_INTEGER);
    const clk = clockState(meta, total, last, now);
    if (clk[clk.turn] > 0) throw new ApiError(409, "Waktu belum habis.");
    const claim = await setEnd(st, gid, { result: "timeout", winner: other(clk.turn) });
    if (claim?.modified === false) throw new ApiError(409, "Permainan sudah selesai.");
    await notifyGame(gid, { end: "timeout" });
    return { ok: true };
  },

  async offerDraw(st, b, me) {
    const gid = String(b.gid ?? "");
    if (!HEX16.test(gid)) throw new ApiError(400, "Permainan tidak valid.");
    const meta = await get(st, `g/${gid}`);
    if (!meta) throw new ApiError(404, "Permainan tidak ditemukan.");
    const myColor = colorIn(meta, me.user.id);
    if (!myColor) throw new ApiError(403, "Anda bukan pemain di permainan ini.");
    if (await get(st, `e/${gid}`)) throw new ApiError(409, "Permainan sudah selesai.");
    const total = await plyCount(st, gid);
    const claim = await st.setJSON(`d/${gid}/${pad(total)}`, { by: myColor, status: "open" }, { onlyIfNew: true });
    if (claim?.modified === false) throw new ApiError(409, "Tawaran remis sudah ada di posisi ini.");
    await notifyGame(gid, { offer: "open" });
    return { ok: true };
  },

  async acceptDraw(st, b, me) {
    const gid = String(b.gid ?? "");
    if (!HEX16.test(gid)) throw new ApiError(400, "Permainan tidak valid.");
    const meta = await get(st, `g/${gid}`);
    if (!meta) throw new ApiError(404, "Permainan tidak ditemukan.");
    const myColor = colorIn(meta, me.user.id);
    if (!myColor) throw new ApiError(403, "Anda bukan pemain di permainan ini.");
    if (await get(st, `e/${gid}`)) throw new ApiError(409, "Permainan sudah selesai.");
    const total = await plyCount(st, gid);
    const offer = await get(st, `d/${gid}/${pad(total)}`);
    if (!offer || offer.status !== "open" || offer.by === myColor) throw new ApiError(409, "Tidak ada tawaran remis untuk Anda.");
    const claim = await setEnd(st, gid, { result: "draw", winner: null });
    if (claim?.modified === false) throw new ApiError(409, "Permainan sudah selesai.");
    await notifyGame(gid, { end: "draw" });
    return { ok: true };
  },

  async declineDraw(st, b, me) {
    const gid = String(b.gid ?? "");
    if (!HEX16.test(gid)) throw new ApiError(400, "Permainan tidak valid.");
    const meta = await get(st, `g/${gid}`);
    if (!meta) throw new ApiError(404, "Permainan tidak ditemukan.");
    const myColor = colorIn(meta, me.user.id);
    if (!myColor) throw new ApiError(403, "Anda bukan pemain di permainan ini.");
    if (await get(st, `e/${gid}`)) throw new ApiError(409, "Permainan sudah selesai.");
    const total = await plyCount(st, gid);
    const offer = await get(st, `d/${gid}/${pad(total)}`);
    if (!offer || offer.status !== "open" || offer.by === myColor) throw new ApiError(409, "Tidak ada tawaran remis untuk Anda.");
    await st.setJSON(`d/${gid}/${pad(total)}`, { by: offer.by, status: "declined" });
    await notifyGame(gid, { offer: "declined" });
    return { ok: true };
  },
};

export default async function handler(req) {
  if (req.method !== "POST") return json(405, { error: "Gunakan POST." });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Permintaan tidak valid." }); }
  const action = body?.action;
  if (typeof action !== "string" || !Object.hasOwn(actions, action)) return json(400, { error: "Aksi tidak dikenal." });
  try {
    const st = store();
    const open = action === "register" || action === "login" || action === "config";
    const me = open ? null : await requireUser(st, req);
    return json(200, await actions[action](st, body, me));
  } catch (err) {
    if (err instanceof ApiError) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: "Kesalahan server. Coba lagi." });
  }
}
