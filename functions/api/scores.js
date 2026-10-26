// SIL Bestenliste – Cloudflare Pages Function
// Braucht eine KV-Bindung mit dem Variablennamen SCORES (Pages-Projekt > Settings > Bindings).

// Anzahl Noten pro Song: [Leicht, Normal]. Max. 1200 Punkte pro Note (Combo-Bonus ×2, Super Modus ×2).
const NOTES = {
  "babygirl": [129, 270],
  "magdalena": [175, 370],
  "egal-wo-du-grad-bist": [140, 294],
  "nie-vorbei": [98, 156],
  "wie-du-tanzt": [133, 278],
  "adidas-superstar": [139, 245]
};
const KEEP = 100, SHOW = 10;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });

function parseKey(song, mode) {
  if (!Object.prototype.hasOwnProperty.call(NOTES, song)) return null;
  const m = Number(mode);
  if (m !== 1 && m !== 2) return null;
  return { song, mode: m, key: `lb:${song}:${m}`, notes: NOTES[song][m - 1] };
}

function cleanName(raw) {
  const name = String(raw || "").normalize("NFC").replace(/[^\p{L}\p{N} ._\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16);
  return name.length >= 2 ? name : null;
}

export async function onRequestGet({ request, env }) {
  if (!env.SCORES) return json({ error: "Bestenliste ist noch nicht eingerichtet." }, 503);
  const url = new URL(request.url);
  const k = parseKey(url.searchParams.get("song"), url.searchParams.get("mode"));
  if (!k) return json({ error: "Unbekannter Song oder Modus." }, 400);
  const list = (await env.SCORES.get(k.key, "json")) || [];
  return json({ scores: list.slice(0, SHOW) }, 200, { "Cache-Control": "public, max-age=10" });
}

export async function onRequestPost({ request, env }) {
  if (!env.SCORES) return json({ error: "Bestenliste ist noch nicht eingerichtet." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }

  const k = parseKey(body.song, body.mode);
  if (!k) return json({ error: "Unbekannter Song oder Modus." }, 400);
  const name = cleanName(body.name);
  if (!name) return json({ error: "Der Name braucht 2 bis 16 Zeichen (Buchstaben, Zahlen, Leerzeichen, . _ -)." }, 400);
  const score = Math.floor(Number(body.score)), acc = Math.round(Number(body.acc)), combo = Math.floor(Number(body.combo));
  if (!(score > 0 && score <= k.notes * 1200 && acc >= 0 && acc <= 100 && combo >= 0 && combo <= k.notes)) {
    return json({ error: "Dieser Punktestand ist nicht möglich." }, 400);
  }

  // einfache Bremse: ein Eintrag pro Minute und Gerät
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rlKey = `rl:${ip}`;
  if (await env.SCORES.get(rlKey)) return json({ error: "Du kannst nur einen Eintrag pro Minute machen." }, 429);
  await env.SCORES.put(rlKey, "1", { expirationTtl: 60 });

  const list = (await env.SCORES.get(k.key, "json")) || [];
  const entry = { name, score, acc, combo, t: Date.now() };
  list.push(entry);
  list.sort((a, b) => b.score - a.score || a.t - b.t);
  const rank = list.indexOf(entry) + 1;
  await env.SCORES.put(k.key, JSON.stringify(list.slice(0, KEEP)));
  return json({ rank, kept: rank <= KEEP, scores: list.slice(0, SHOW) });
}
