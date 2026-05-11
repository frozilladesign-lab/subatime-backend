/**
 * Apply Prisma migrations using DATABASE_URL only (e.g. Supabase transaction pool :6543).
 * Use when `prisma migrate deploy` fails with EMAXCONNSESSION on session pool :5432.
 *
 * Prisma records checksum as sha256(hex) of migration.sql bytes (UTF-8, as on disk).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env at', envPath);
    process.exit(1);
  }
  const txt = fs.readFileSync(envPath, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

async function main() {
  const root = path.join(__dirname, '..');
  loadEnvFile(path.join(root, '.env'));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const migrationsDir = path.join(root, 'prisma', 'migrations');
  const dirs = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name !== 'manual-fixes')
    .sort();

  const isSupabase = /supabase\.com/i.test(databaseUrl);
  let conn = databaseUrl;
  if (isSupabase) {
    conn = conn
      .replace(/([?&])sslmode=[^&]*/gi, '$1')
      .replace(/([?&])sslrootcert=[^&]*/gi, '$1')
      .replace(/\?&/g, '?')
      .replace(/&&/g, '&')
      .replace(/\?$/, '');
  }
  const client = new Client({
    connectionString: conn,
    ...(isSupabase ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();

  const { rows: appliedRows } = await client.query(
    'SELECT "migration_name" FROM "_prisma_migrations" ORDER BY "started_at" ASC',
  );
  const applied = new Set(appliedRows.map((r) => r.migration_name));

  let appliedNow = 0;
  for (const name of dirs) {
    if (applied.has(name)) continue;
    const sqlPath = path.join(migrationsDir, name, 'migration.sql');
    if (!fs.existsSync(sqlPath)) {
      console.warn('Skip (no migration.sql):', name);
      continue;
    }
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const sum = checksum(sql);
    const id = crypto.randomUUID();
    const started = new Date().toISOString();

    console.log('Applying', name, '…');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
         VALUES ($1, $2, NOW(), $3, NULL, NULL, $4::timestamptz, 1)`,
        [id, sum, name, started],
      );
      await client.query('COMMIT');
      appliedNow += 1;
      console.log('  ok');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('  failed:', e.message);
      process.exitCode = 1;
      break;
    }
  }

  await client.end();
  if (appliedNow === 0 && !process.exitCode) {
    console.log('No pending migrations (or stopped after error).');
  } else if (!process.exitCode) {
    console.log('Done. Applied', appliedNow, 'migration(s).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
