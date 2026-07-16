// Hammers POST /claim concurrently and verifies:
//   1. no MRE is ever double-sold
//   2. no user ever holds two MREs (one_each backstop)
//
// Usage: API_URL=http://localhost:3000 RESET_SECRET=hooah node scripts/race-test.js

const API = process.env.API_URL || 'http://localhost:3000';
const SECRET = process.env.RESET_SECRET || 'hooah';
const USERS = 20;

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  // Fresh board, drop already live.
  const reset = await post('/reset', { secret: SECRET, drop_in_seconds: -1 });
  if (!reset.body.ok) throw new Error(`reset failed: ${JSON.stringify(reset.body)}`);

  const mres = await (await fetch(`${API}/mres`)).json();
  const ids = mres.map((m) => m.id);
  console.log(`${ids.length} MREs, ${USERS} users, ${ids.length * USERS} concurrent claims...`);

  // Every user fires a claim at every item simultaneously — worst-case stampede.
  const results = await Promise.all(
    Array.from({ length: USERS }, (_, u) =>
      ids.map((id) => post('/claim', { mre_id: id, user: `user${u + 1}` }))
    ).flat()
  );

  const wins = results.filter((r) => r.status === 200);
  const taken = results.filter((r) => r.status === 409 && r.body.reason === 'taken');
  const alreadyHave = results.filter((r) => r.status === 409 && r.body.reason === 'already_have');
  console.log(`200 ok: ${wins.length}, 409 taken: ${taken.length}, 409 already_have: ${alreadyHave.length}`);

  const finalState = await (await fetch(`${API}/mres`)).json();
  const claimedBy = finalState.filter((m) => m.claimed).map((m) => m.claimed_by);

  let failed = false;
  if (wins.length !== ids.length) {
    console.error(`FAIL: expected exactly ${ids.length} successful claims, got ${wins.length}`);
    failed = true;
  }
  if (claimedBy.length !== ids.length) {
    console.error(`FAIL: expected all ${ids.length} items claimed, got ${claimedBy.length}`);
    failed = true;
  }
  const dupes = claimedBy.filter((u, i) => claimedBy.indexOf(u) !== i);
  if (dupes.length > 0) {
    console.error(`FAIL: users holding multiple meals: ${[...new Set(dupes)].join(', ')}`);
    failed = true;
  }
  // Winners reported by the API must match the final DB state (no phantom wins).
  const winners = new Set(wins.map((r) => r.body.item.claimed_by));
  for (const u of claimedBy) {
    if (!winners.has(u)) {
      console.error(`FAIL: ${u} holds an item but never got a 200`);
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log('PASS: no double-sell, no double-claim.');

  // Leave the board clean for the next run.
  await post('/reset', { secret: SECRET });
}

main().catch((err) => { console.error(err); process.exit(1); });
