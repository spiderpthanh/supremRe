import express from 'express';
import cors from 'cors';
import { pool, initDb, getDropTime, getRound } from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const RESET_SECRET = process.env.RESET_SECRET || 'hooah';
// One claim per operative PER ROUND — a round ends when this many kits are
// claimed in it (or the shelf is empty), even if items remain (12 items, 7 friends).
const PLAYER_COUNT = Number(process.env.PLAYER_COUNT) || 7;

// ---- GET / — health check + endpoint map. Keeps the base URL from 404ing. --
app.get('/', (_req, res) => {
  res.json({
    service: 'supremRe drop API',
    status: 'ok',
    endpoints: ['GET /mres', 'GET /config', 'GET /manifest', 'POST /claim', 'POST /reset', 'POST /admin/item', 'POST /admin/round'],
  });
});

// ---- GET /config — drop time + server clock, for countdown sync ------------
app.get('/config', async (_req, res) => {
  const dropTime = await getDropTime();
  res.json({
    drop_time: dropTime,
    server_now: new Date().toISOString(),
    player_count: PLAYER_COUNT,
    round: await getRound(),
  });
});

// ---- GET /mres — full stock status. Polled ~1.5s by every client. ----------
app.get('/mres', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, menu_no, name, nsn,
            claimed_by IS NOT NULL AS claimed,
            claimed_by, claim_round
       FROM mres
      ORDER BY menu_no`
  );
  res.json(rows);
});

// ---- POST /claim — the ONLY endpoint that mutates stock. -------------------
// Race safety is this one UPDATE: first transaction to flip claimed_by from
// NULL wins; everyone else matches 0 rows. The one_each_round partial unique
// index is the backstop against a user claiming twice in the same round.
app.post('/claim', async (req, res) => {
  const { mre_id, user } = req.body ?? {};
  const mreId = Number(mre_id);
  const userName = typeof user === 'string' ? user.trim() : '';
  if (!Number.isInteger(mreId) || !userName) {
    return res.status(400).json({ reason: 'bad_request' });
  }

  const dropTime = await getDropTime();
  if (dropTime && new Date() < new Date(dropTime)) {
    return res.status(403).json({ reason: 'not_live', drop_time: dropTime });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE mres
          SET claimed_by = $1, claimed_at = now(),
              claim_round = (SELECT current_round FROM drop_config WHERE id = 1)
        WHERE id = $2 AND claimed_by IS NULL
        RETURNING id, menu_no, name, nsn, claimed_by, claimed_at, claim_round`,
      [userName, mreId]
    );

    if (rows.length === 1) {
      return res.json({ ok: true, item: rows[0] });
    }

    // 0 rows: either taken by someone else, or a bogus id.
    const { rows: cur } = await pool.query(
      'SELECT claimed_by FROM mres WHERE id = $1',
      [mreId]
    );
    if (cur.length === 0) return res.status(404).json({ reason: 'no_such_mre' });
    return res.status(409).json({ reason: 'taken', winner: cur[0].claimed_by });
  } catch (err) {
    if (err.code === '23505') {
      // one_each_round violation: this operative already holds a meal this round.
      const { rows: mine } = await pool.query(
        `SELECT menu_no FROM mres
          WHERE claimed_by = $1
            AND claim_round = (SELECT current_round FROM drop_config WHERE id = 1)`,
        [userName]
      );
      return res.status(409).json({ reason: 'already_have', menu: mine[0]?.menu_no ?? null });
    }
    throw err;
  }
});

// ---- GET /manifest — post-drop results screen -------------------------------
app.get('/manifest', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT menu_no, name, nsn, claimed_by, claimed_at, claim_round
       FROM mres
      WHERE claimed_by IS NOT NULL
      ORDER BY claim_round, claimed_at`
  );
  const { rows: total } = await pool.query('SELECT count(*)::int AS n FROM mres');
  const round = await getRound();
  // A round is complete once every operative holds a kit this round, or the
  // shelf is empty. Leftover items stay as surplus.
  const thisRound = rows.filter((r) => r.claim_round === round).length;
  res.json({
    claimed: rows,
    total: total[0].n,
    player_count: PLAYER_COUNT,
    round,
    complete: thisRound >= PLAYER_COUNT || rows.length >= total[0].n,
  });
});

// ---- POST /admin/item — per-item claim control (secret-gated). -------------
// { secret, mre_id, claimed_by }: a name assigns the item (admin overwrite),
// null/empty clears it. An assign is stamped with the current round, and the
// one_each_round index still blocks a name holding two kits in a round.
app.post('/admin/item', async (req, res) => {
  const { secret, mre_id, claimed_by } = req.body ?? {};
  if (secret !== RESET_SECRET) return res.status(403).json({ reason: 'bad_secret' });
  const mreId = Number(mre_id);
  if (!Number.isInteger(mreId)) return res.status(400).json({ reason: 'bad_request' });
  const name = typeof claimed_by === 'string' ? claimed_by.trim() : '';

  try {
    const { rows } = await pool.query(
      name
        ? `UPDATE mres SET claimed_by = $2, claimed_at = now(),
                  claim_round = (SELECT current_round FROM drop_config WHERE id = 1)
             WHERE id = $1 RETURNING id, menu_no, name, nsn, claimed_by, claimed_at, claim_round`
        : `UPDATE mres SET claimed_by = NULL, claimed_at = NULL, claim_round = NULL
             WHERE id = $1 RETURNING id, menu_no, name, nsn, claimed_by, claimed_at, claim_round`,
      name ? [mreId, name] : [mreId]
    );
    if (rows.length === 0) return res.status(404).json({ reason: 'no_such_mre' });
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ reason: 'already_holds', user: name });
    }
    throw err;
  }
});

// ---- POST /admin/round — start the next drop WITHOUT touching claims. ------
// Body: { secret, drop_in_seconds, round? }. Sets the current round (explicit
// `round`, else current + 1) and schedules the new drop time.
app.post('/admin/round', async (req, res) => {
  const { secret, drop_in_seconds, round } = req.body ?? {};
  if (secret !== RESET_SECRET) return res.status(403).json({ reason: 'bad_secret' });
  const secs = Number(drop_in_seconds);
  if (!Number.isFinite(secs)) return res.status(400).json({ reason: 'bad_request' });

  const next = round === undefined || round === null
    ? (await getRound()) + 1
    : Number(round);
  if (!Number.isInteger(next) || next < 1) return res.status(400).json({ reason: 'bad_request' });

  const t = new Date(Date.now() + secs * 1000);
  await pool.query('UPDATE drop_config SET current_round = $1, drop_time = $2 WHERE id = 1', [next, t]);
  res.json({ ok: true, round: next, drop_time: await getDropTime() });
});

// ---- POST /reset — dev only. Clears claims, back to round 1; optionally reschedules. ----
// Body: { secret, drop_in_seconds? }
app.post('/reset', async (req, res) => {
  const { secret, drop_in_seconds } = req.body ?? {};
  if (secret !== RESET_SECRET) return res.status(403).json({ reason: 'bad_secret' });

  await pool.query('UPDATE mres SET claimed_by = NULL, claimed_at = NULL, claim_round = NULL');
  await pool.query('UPDATE drop_config SET current_round = 1 WHERE id = 1');
  if (Number.isFinite(Number(drop_in_seconds))) {
    const t = new Date(Date.now() + Number(drop_in_seconds) * 1000);
    await pool.query('UPDATE drop_config SET drop_time = $1 WHERE id = 1', [t]);
  }
  const dropTime = await getDropTime();
  res.json({ ok: true, drop_time: dropTime });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ reason: 'server_error' });
});

if (!process.env.DATABASE_URL) {
  console.error(
    'FATAL: DATABASE_URL is not set on this service.\n' +
    'The database connection defaults to localhost:5432, which does not exist here.\n' +
    'On Railway: open THIS service (not the Postgres one) -> Variables -> add\n' +
    '  DATABASE_URL = ${{Postgres.DATABASE_URL}}   (match your DB service name)\n' +
    'or paste the raw connection string value from the Postgres service.'
  );
  process.exit(1);
}

initDb().then(() => {
  app.listen(PORT, () => console.log(`supremRe drop API live on :${PORT}`));
}).catch((err) => {
  if (err.code === 'ECONNREFUSED') {
    console.error(
      'DB init failed: could not connect to Postgres at ' +
      `${err.address}:${err.port}.\n` +
      'DATABASE_URL is set but points somewhere unreachable. Verify it is your\n' +
      "Railway Postgres URL (host ending in .railway.internal for the private network),\n" +
      'and that the API and database are in the same project.'
    );
  } else {
    console.error('DB init failed:', err);
  }
  process.exit(1);
});
