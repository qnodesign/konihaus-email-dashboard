// konihaus — sync blog newsletter subscribers (S3 blog-emails.json) into Brevo lists.
// Keeps three lists in step with the JSON: "Blog-nl" (everyone), "Blog-nl EN" and "Blog-nl DE" (by language).
// Run it shortly before every send (DSM Task Scheduler, e.g. hourly at :45). Usage:
//   node brevo-sync.js            -> sync
//   node brevo-sync.js --dry-run  -> only print what would change
//   node brevo-sync.js --force    -> allow removing more than half of a list (safety guard)
// Needs in .env: BREVO_API_KEY plus the same S3 variables the dashboard uses (S3_BUCKET_NAME, AWS_REGION, AWS_* keys).
// Unsubscribes via Brevo's own link blacklist the contact in Brevo; this script never un-blacklists anyone.
const fs = require("node:fs");
const path = require("node:path");

try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    if (process.loadEnvFile) process.loadEnvFile(envPath);
    else for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
} catch { /* optional */ }

const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const KEY = process.env.BREVO_API_KEY || "";
const BUCKET = process.env.S3_BUCKET_NAME || "";
const REGION = process.env.AWS_REGION || "eu-central-1";
const FILE = process.env.S3_BLOG_KEY || "blog-emails.json";
const LISTS = {
  all: process.env.BREVO_LIST_ALL || "Blog-nl",
  en: process.env.BREVO_LIST_EN || "Blog-nl EN",
  de: process.env.BREVO_LIST_DE || "Blog-nl DE",
};
const log = (...a) => console.log(new Date().toISOString(), "[brevo-sync]", ...a);

async function brevo(method, url, body) {
  const res = await fetch("https://api.brevo.com/v3" + url, {
    method,
    headers: { "api-key": KEY, accept: "application/json", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function readSubscribers() {
  let raw;
  if (BUCKET) {
    const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
    const out = await new S3Client({ region: REGION }).send(new GetObjectCommand({ Bucket: BUCKET, Key: FILE }));
    raw = await out.Body.transformToString("utf-8");
  } else raw = fs.readFileSync(path.join(__dirname, FILE), "utf-8");
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error(`${FILE} is not a JSON array`);
  const byEmail = new Map();
  for (const r of rows.sort((a, b) => String(a.subscribedAt).localeCompare(String(b.subscribedAt)))) {
    const email = String(r.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    const lang = String(r.language || "").toLowerCase().startsWith("de") ? "de" : "en"; // unknown -> English
    byEmail.set(email, { email, lang, subscribedAt: r.subscribedAt }); // latest entry wins (language change)
  }
  return byEmail;
}

async function allLists() {
  const out = [];
  for (let offset = 0; ; offset += 50) {
    const r = await brevo("GET", `/contacts/lists?limit=50&offset=${offset}`);
    out.push(...(r.lists || []));
    if (!r.lists || r.lists.length < 50) return out;
  }
}

async function ensureLists() {
  const lists = await allLists();
  const ids = {};
  const base = lists.find((l) => l.name === LISTS.all);
  if (!base) throw new Error(`Brevo list "${LISTS.all}" not found`);
  for (const [k, name] of Object.entries(LISTS)) {
    const hit = lists.find((l) => l.name === name);
    if (hit) { ids[k] = hit.id; continue; }
    if (DRY) { log(`would create list "${name}"`); ids[k] = null; continue; }
    ids[k] = (await brevo("POST", "/contacts/lists", { name, folderId: base.folderId })).id;
    log(`created list "${name}" (id ${ids[k]})`);
  }
  return ids;
}

async function members(listId) {
  const set = new Set();
  if (!listId) return set;
  for (let offset = 0; ; offset += 500) {
    const r = await brevo("GET", `/contacts/lists/${listId}/contacts?limit=500&offset=${offset}`);
    (r.contacts || []).forEach((c) => set.add(c.email.toLowerCase()));
    if (!r.contacts || r.contacts.length < 500) return set;
  }
}

(async () => {
  if (!KEY) throw new Error("BREVO_API_KEY missing in .env");
  const subs = await readSubscribers();
  if (subs.size === 0 && !FORCE) throw new Error(`${FILE} has no subscribers - refusing to empty the lists (use --force)`);
  const ids = await ensureLists();
  const want = { all: new Set(subs.keys()), en: new Set(), de: new Set() };
  subs.forEach((s) => want[s.lang].add(s.email));

  const have = {};
  for (const k of Object.keys(LISTS)) have[k] = await members(ids[k]);

  // 1) create/update contacts that are missing from any list they belong to
  const toUpsert = [...subs.values()].filter((s) => !have.all.has(s.email) || !have[s.lang].has(s.email));
  for (const s of toUpsert) {
    const listIds = [ids.all, ids[s.lang]].filter(Boolean);
    const attributes = s.subscribedAt ? { SUBSCRIBED_AT: String(s.subscribedAt).slice(0, 10) } : undefined;
    log(`${DRY ? "would add" : "add"} ${s.email} -> ${LISTS.all} + ${LISTS[s.lang]}`);
    if (!DRY) await brevo("POST", "/contacts", { email: s.email, listIds, updateEnabled: true, attributes });
  }
  // 2) remove people who are no longer subscribed (or switched language) from each list
  for (const k of Object.keys(LISTS)) {
    const extra = [...have[k]].filter((e) => !want[k].has(e));
    if (!extra.length) continue;
    if (extra.length > have[k].size / 2 && have[k].size > 3 && !FORCE)
      throw new Error(`would remove ${extra.length} of ${have[k].size} from "${LISTS[k]}" - looks wrong, stopping (use --force)`);
    log(`${DRY ? "would remove" : "remove"} ${extra.length} from "${LISTS[k]}": ${extra.join(", ")}`);
    for (let i = 0; !DRY && i < extra.length; i += 150)
      await brevo("POST", `/contacts/lists/${ids[k]}/contacts/remove`, { emails: extra.slice(i, i + 150) });
  }
  log(`done: ${subs.size} subscribers (EN ${want.en.size}, DE ${want.de.size}), ${toUpsert.length} added/updated${DRY ? " [dry run]" : ""}`);
})().catch((e) => { log("ERROR", e.message); process.exitCode = 1; });
