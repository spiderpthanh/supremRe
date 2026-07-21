import pg from 'pg';
import { ITEMS, ITEMS_VERSION } from './items.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// Default drop time when none is configured: 15 minutes from boot.
// Override with DROP_TIME (ISO 8601) or reschedule via POST /reset.
const DEFAULT_DROP_DELAY_MS = 15 * 60 * 1000;

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mres (
      id          SERIAL PRIMARY KEY,
      menu_no     INT NOT NULL,
      name        TEXT NOT NULL,
      nsn         TEXT NOT NULL,
      claimed_by  TEXT,
      claimed_at  TIMESTAMPTZ
    );
  `);

  // Migration: the tier system was removed — people decide what they want.
  await pool.query('ALTER TABLE mres DROP COLUMN IF EXISTS tier;');

  // ONE meal per person, enforced by the database. Never check-then-write in app code.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS one_each
      ON mres (claimed_by)
      WHERE claimed_by IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS drop_config (
      id        INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      drop_time TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query('ALTER TABLE drop_config ADD COLUMN IF NOT EXISTS seed_version INT NOT NULL DEFAULT 0;');

  // Ensure the config row exists BEFORE seeding, so a fresh DB still gets the
  // boot+15min default and the reseed only ever touches seed_version.
  const dropTime = process.env.DROP_TIME
    ? new Date(process.env.DROP_TIME)
    : new Date(Date.now() + DEFAULT_DROP_DELAY_MS);
  await pool.query(
    `INSERT INTO drop_config (id, drop_time) VALUES (1, $1)
     ON CONFLICT (id) DO ${process.env.DROP_TIME ? 'UPDATE SET drop_time = $1' : 'NOTHING'}`,
    [dropTime]
  );

  await seedItems();
}

// Versioned reseed: whenever ITEMS_VERSION is bumped, the deployed DB wipes
// its inventory (claims included) and reloads the new list on boot.
async function seedItems() {
  const { rows } = await pool.query('SELECT seed_version FROM drop_config WHERE id = 1');
  const current = rows[0]?.seed_version ?? 0;
  const { rows: cnt } = await pool.query('SELECT count(*)::int AS n FROM mres');
  if (current === ITEMS_VERSION && cnt[0].n > 0) return;

  await pool.query('DELETE FROM mres');
  for (const it of ITEMS) {
    await pool.query(
      'INSERT INTO mres (menu_no, name, nsn) VALUES ($1, $2, $3)',
      [it.menu_no, it.name, it.nsn]
    );
  }
  await pool.query('UPDATE drop_config SET seed_version = $1 WHERE id = 1', [ITEMS_VERSION]);
  console.log(`Inventory reseeded to version ${ITEMS_VERSION} (${ITEMS.length} items)`);
}

export async function getDropTime() {
  const { rows } = await pool.query('SELECT drop_time FROM drop_config WHERE id = 1');
  return rows[0]?.drop_time ?? null;
}
