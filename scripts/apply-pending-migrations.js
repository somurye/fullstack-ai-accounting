const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const SQL_DIR = path.resolve(__dirname, '../sql');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/keiri_kaikei',
  });

  await client.connect();
  console.log('Connected to PostgreSQL');

  // schema_migrations テーブルを作成
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedRes = await client.query(`SELECT version FROM schema_migrations;`);
  const appliedSet = new Set(appliedRes.rows.map((r) => r.version));

  // 既に適用済みの可能性が高い初期テーブル群があれば 001〜007 をマーク
  const checkContracts = await client.query(
    `SELECT to_regclass('public.contracts') as contracts, to_regclass('public.users') as users;`
  );
  if (checkContracts.rows[0].users && !appliedSet.has('001_initial_schema_all_in_one.sql')) {
    // 001〜007は既に適用済みとしてマーク
    const earlyFiles = [
      '001_initial_schema_all_in_one.sql',
      '002_bank_integration.sql',
      '003_bank_connector_link_status.sql',
      '004_rbac_bookkeeper_role.sql',
      '005_audit_logs_search_upgrade.sql',
      '006_generic_approval_targets.sql',
      '007_attachments_document_category.sql',
    ];
    for (const f of earlyFiles) {
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING;`, [f]);
      appliedSet.add(f);
      console.log(`Marked as already applied: ${f}`);
    }
  }

  const files = fs
    .readdirSync(SQL_DIR)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }

    console.log(`\n=== Applying migration: ${file} ===`);
    const sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf8');

    try {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1);`, [file]);
      console.log(`[SUCCESS] ${file}`);
    } catch (err) {
      console.error(`[FAILED] ${file}:`, err.message);
      await client.end();
      process.exit(1);
    }
  }

  console.log('\nAll pending migrations applied successfully!');
  await client.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
