import { getStore } from "@netlify/blobs";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { allLegal, apply, findMove, inCheck, replay } from "../../public/chess-engine.mjs";

const scrypt = promisify(scryptCb);
const SESSION_MS = 30 * 24 * 3600 * 1000;
const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const ID_RE = /^[a-z0-9_]{3,20}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const MOVE_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/*
 * Penyimpanan (satu store "catur"), kunci:
 *   u/<id>            profil publik {id, name, createdAt}
 *   c/<id>            kredensial {salt, hash}  (scrypt)
 *   s/<token>         sesi {uid, exp}
 *   g/<gid>           data permainan {white, black, whiteName, blackName, createdAt}
 *   i/<uid>/<gid>     indeks permainan milik pemain
 *   m/<gid>/<ply>     satu langkah per ply (5 digit); dibuat hanya jika belum ada
 *   e/<gid>           hasil akhir jika permainan sudah selesai
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
const hashOf = async (pass, salt) => (await scrypt(pass, salt, 64)).toString("hex");
const colorIn = (meta, uid) => meta.white === uid ? "w" : (meta.black === uid ? "b" : null);

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

/* Ambil langkah dengan indeks >= from, berurutan dari ply terkecil. */
async function loadMoves(st, gid, from = 0) {
  const res = await st.list({ prefix: `m/${gid}/` });
  const keys = (res.blobs || [])
    .map(b => b.key)
    .sort()
    .filter(k => Number(k.slice(k.lastIndexOf("/") + 1)) >= from);
  const vals = await Promise.all(keys.map(k => get(st, k)));
  return vals.filter(Boolean).map(v => v.m);
}

function gameView(gid, meta, myColor) {
  return {
    id: gid,
    myColor,
    oppName: myColor === "w" ? meta.blackName : meta.whiteName,
    whiteName: meta.whiteName,
    blackName: meta.blackName,
  };
}

const actions = {
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
    if (!ID_RE.test(oid)) throw new ApiError(400, "Pemain tidak valid.");
    if (oid === me.user.id) throw new ApiError(400, "Tidak bisa duel dengan diri sendiri.");
    const opp = await get(st, `u/${oid}`);
    if (!opp) throw new ApiError(404, "Pemain tidak ditemukan.");
    const gid = randomBytes(8).toString("hex");
    const createdAt = Date.now();
    await st.setJSON(`g/${gid}`, {
      white: me.user.id, black: oid, whiteName: me.user.name, blackName: opp.name, createdAt,
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
      const plies = ((await st.list({ prefix: `m/${gid}/` })).blobs || []).length;
      const end = await get(st, `e/${gid}`);
      const myColor = colorIn(meta, me.user.id);
      return {
        id: gid,
        opponent: myColor === "w" ? meta.blackName : meta.whiteName,
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
    const moves = await loadMoves(st, gid, from);
    return { game: gameView(gid, meta, myColor), from, moves };
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

    const all = await loadMoves(st, gid, 0);
    const { s, bad } = replay(all);
    if (bad) throw new ApiError(500, "Data permainan rusak.");
    if (s.turn !== myColor) throw new ApiError(409, "Bukan giliran Anda.");
    if (allLegal(s).length === 0) throw new ApiError(409, "Permainan sudah selesai.");
    const m = findMove(s, mv);
    if (!m) throw new ApiError(400, "Langkah tidak legal.");

    const ply = all.length;
    const claim = await st.setJSON(`m/${gid}/${pad(ply)}`, { m: mv }, { onlyIfNew: true });
    if (claim?.modified === false) throw new ApiError(409, "Papan sudah berubah. Muat ulang.");

    const after = apply(s, m);
    if (allLegal(after).length === 0) {
      const mate = inCheck(after);
      await st.setJSON(`e/${gid}`, { result: mate ? "mate" : "stalemate", winner: mate ? myColor : null }, { onlyIfNew: true });
    }
    return { ok: true, ply };
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
    const open = action === "register" || action === "login";
    const me = open ? null : await requireUser(st, req);
    return json(200, await actions[action](st, body, me));
  } catch (err) {
    if (err instanceof ApiError) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: "Kesalahan server. Coba lagi." });
  }
}
