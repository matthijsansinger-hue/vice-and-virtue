// ISteamMicroTxn/GetReport — the reconciliation call Valve asked for.
//
// Valve's review wants proof you can match settled Steam transactions against
// your own economy ledger. This calls GetReport on the PRODUCTION host (never
// the sandbox one — that is the whole point of their request) and writes the
// raw responses to a file you can attach to the resubmission.
//
// The key never goes in a URL you'd paste anywhere: it's read from the
// environment and only ever sent to partner.steam-api.com over HTTPS.
//
// Usage (cmd — all three lines in the SAME window, no quotes on the key):
//   cd /d "C:\Users\matth\OneDrive\Desktop\Vice and Virtue\vice-and-virtue"
//   set STEAM_PUBLISHER_KEY=your_publisher_key
//   node scripts/steam-report.js
//
// Usage (PowerShell):
//   $env:STEAM_PUBLISHER_KEY="your_publisher_key"
//
// Options:
//   --days 30        how far back to look (default 30)
//   --appid 5077460  override the app id
//   --order <id>     order id used for the QueryTxn control call
//   --out steam-getreport.json
//
// Requires Node 18+ for global fetch.

const fs = require("fs");

const KEY = process.env.STEAM_PUBLISHER_KEY;
if (!KEY) {
  console.error("Set STEAM_PUBLISHER_KEY first — see the usage note in this file.");
  process.exit(1);
}

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const APPID = arg("appid", process.env.STEAM_APP_ID || "5077460");
const DAYS = Number(arg("days", "30"));
const ORDER = arg("order", "1788351152173659");
const OUT = arg("out", "steam-getreport.json");
const HOST = "https://partner.steam-api.com";

const since = new Date(Date.now() - DAYS * 86400 * 1000)
  .toISOString()
  .replace(/\.\d{3}Z$/, "Z");

// Identify WHICH key this run is using without printing it. If the length isn't
// 32 you've got quotes or whitespace in the variable; if the tail doesn't match
// the key in Supabase, cmd has a different key than the one that just took a
// real payment.
console.log(`key: length=${KEY.length} tail=${KEY.slice(-4)}`);
if (KEY.length !== 32) {
  console.log("  ^ expected 32 — check for quotes/spaces in the variable");
}
console.log(`appid=${APPID}  window since ${since}\n`);

async function call(label, path, params) {
  const url = `${HOST}/ISteamMicroTxn/${path}/?${new URLSearchParams({
    key: KEY,
    appid: APPID,
    ...params,
  })}`;
  let status = 0;
  let text = "";
  try {
    const res = await fetch(url);
    status = res.status;
    text = await res.text();
  } catch (e) {
    text = String(e);
  }
  const oneLine = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  console.log(`${label.padEnd(22)} HTTP ${String(status).padEnd(4)} ${oneLine.slice(0, 90)}`);
  return { label, path, status, body: text };
}

(async () => {
  const results = [];

  // CONTROL — read-only, same interface + key, on the order we know exists.
  // If this succeeds while GetReport 403s, the key is fine and GetReport itself
  // is the problem. If both 403, the key in this shell is the wrong one.
  results.push(await call("QueryTxn (control)", "QueryTxn/v2", { orderid: ORDER }));

  // The call Valve actually asked for, across the plausible versions — the
  // suffix has changed between revisions and a wrong one can also 403.
  for (const v of ["v5", "v4", "v3", "v2", "v1"]) {
    results.push(
      await call(`GetReport ${v}`, `GetReport/${v}`, { time: since, maxresults: "1000" })
    );
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nall responses -> ${OUT}`);

  const ok = results.find((r) => r.status === 200 && r.label.startsWith("GetReport"));
  if (ok) {
    console.log(`\nGetReport succeeded on ${ok.path}. Body:\n`);
    console.log(ok.body.slice(0, 2000));
    console.log(
      "\nReconcile against the ledger:\n" +
        "  select order_id, user_id, package, created_at from steam_purchases order by created_at desc;"
    );
  } else {
    console.log(
      "\nNo GetReport version returned 200 — see the table above.\n" +
        "If QueryTxn also failed, the key in this shell isn't the one Supabase holds."
    );
  }
})();
