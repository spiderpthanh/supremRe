import pg from 'pg';
import { ITEMS } from './items.js';

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

  await seedItems();

  const dropTime = process.env.DROP_TIME
    ? new Date(process.env.DROP_TIME)
    : new Date(Date.now() + DEFAULT_DROP_DELAY_MS);
  await pool.query(
    `INSERT INTO drop_config (id, drop_time) VALUES (1, $1)
     ON CONFLICT (id) DO ${process.env.DROP_TIME ? 'UPDATE SET drop_time = $1' : 'NOTHING'}`,
    [dropTime]
  );
}

async function seedItems() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM mres');
  if (rows[0].n > 0) return;
  for (const it of ITEMS) {
    await pool.query(
      'INSERT INTO mres (menu_no, name, nsn) VALUES ($1, $2, $3)',
      [it.menu_no, it.name, it.nsn]
    );
  }
}

export async function getDropTime() {
  const { rows } = await pool.query('SELECT drop_time FROM drop_config WHERE id = 1');
  return rows[0]?.drop_time ?? null;
}
