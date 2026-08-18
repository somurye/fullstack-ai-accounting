#!/usr/bin/env node
/**
 * db-migrate.js
 * =============
 * `sql/`直下の`NNN_*.sql`ファイルを連番の昇順で全て`psql`に適用する。
 * 個別に`001`/`002`/...を手動で`psql -f`する運用は、新しいマイグレーションの
 * 追加漏れやコマンド順序の取り違えを起こしやすいため、一本化する。
 *
 * 各SQLファイルは`CREATE TABLE IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`等の
 * べき等な記述を前提とする(既存の`001`〜`005`もこの前提で書かれている)。
 * 失敗したファイルがあれば直ちに停止し、以降のファイルは適用しない。
 *
 * 使い方: DATABASE_URL="postgresql://..." node scripts/db-migrate.js
 *         (backend/package.jsonの`npm run db:migrate`から呼び出される)
 */
const { execFileSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');

const SQL_DIR = path.resolve(__dirname, '..', 'sql');
const SQL_FILE_RE = /^\d+.*\.sql$/;

function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const files = readdirSync(SQL_DIR)
    .filter((name) => SQL_FILE_RE.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  if (files.length === 0) {
    console.error(`No migration files found under ${SQL_DIR}`);
    process.exit(1);
  }

  for (const file of files) {
    const fullPath = path.join(SQL_DIR, file);
    console.log(`\n=== Applying ${file} ===`);
    try {
      execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', fullPath], {
        stdio: 'inherit',
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.error(`\n'psql' command not found on PATH. Install the PostgreSQL client and retry.`);
      } else {
        console.error(`\nMigration failed at ${file}: ${error.message}`);
      }
      process.exit(typeof error.status === 'number' ? error.status : 1);
    }
  }

  console.log(`\nAll ${files.length} migration file(s) applied successfully.`);
}

main();
