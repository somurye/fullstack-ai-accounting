#!/usr/bin/env node
/**
 * db-migrate.js
 * =============
 * `sql/`直下の`NNN_*.sql`ファイルを連番の昇順で全てPostgreSQLに適用する。
 * 個別に`001`/`002`/...を手動で実行する運用は、新しいマイグレーションの
 * 追加漏れやコマンド順序の取り違えを起こしやすいため、一本化する。
 *
 * 実行方式 (フォールバック順):
 *   1. ホストの `psql` コマンド (PATHにある場合)
 *   2. `docker compose exec -T postgres psql` (Dockerコンテナ稼働中の場合)
 *   3. `node-postgres` (pgパッケージ経由での直接SQL実行)
 *
 * 各ファイルは独立したトランザクション/接続で実行され、
 * 008a (ALTER TYPE) -> 008b (INSERT) のようなENUM追加直後の同一Tx使用制約を
 * 確実に回避する。
 *
 * 使い方: DATABASE_URL="postgresql://..." node scripts/db-migrate.js
 *         (backend/package.jsonの`npm run db:migrate`から呼び出される)
 */
const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const SQL_DIR = path.resolve(__dirname, '..', 'sql');
const ROOT_DIR = path.resolve(__dirname, '..');
const SQL_FILE_RE = /^\d+.*\.sql$/;

/**
 * コマンドがPATHに存在するかチェックする
 */
function hasCommand(cmd) {
  try {
    const checkCmd = process.platform === 'win32' ? 'where.exe' : 'which';
    execFileSync(checkCmd, [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Dockerコンテナ 'postgres' が起動中か確認する
 */
function isDockerPostgresRunning() {
  if (!hasCommand('docker')) return false;
  try {
    const out = execFileSync('docker', ['compose', 'ps', '-q', 'postgres'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * node-postgres (pg) を利用してSQLファイルを適用するフォールバック
 */
async function runWithNodePostgres(databaseUrl, files) {
  let Client;
  try {
    Client = require('pg').Client;
  } catch {
    try {
      Client = require(path.resolve(__dirname, '../backend/node_modules/pg')).Client;
    } catch {
      return false;
    }
  }

  console.log('[runner] Using node-postgres (pg) client fallback...');
  for (const file of files) {
    const fullPath = path.join(SQL_DIR, file);
    const sql = readFileSync(fullPath, 'utf8');
    console.log(`\n=== Applying ${file} (via node-postgres) ===`);

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(sql);
    } catch (err) {
      console.error(`\nMigration failed at ${file}: ${err.message}`);
      await client.end();
      process.exit(1);
    }
    await client.end();
  }
  return true;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is not set.');
    console.error('Example: DATABASE_URL="postgresql://postgres:postgres@localhost:5432/keiri_kaikei" npm run db:migrate');
    process.exit(1);
  }

  const files = readdirSync(SQL_DIR)
    .filter((name) => SQL_FILE_RE.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  if (files.length === 0) {
    console.error(`No migration files found under ${SQL_DIR}`);
    process.exit(1);
  }

  // 1. ホストの psql コマンドを試す
  if (hasCommand('psql')) {
    console.log('[runner] Using host psql command...');
    for (const file of files) {
      const fullPath = path.join(SQL_DIR, file);
      console.log(`\n=== Applying ${file} (via host psql) ===`);
      try {
        execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', fullPath], {
          stdio: 'inherit',
        });
      } catch (error) {
        console.error(`\nMigration failed at ${file}: ${error.message}`);
        process.exit(typeof error.status === 'number' ? error.status : 1);
      }
    }
    console.log(`\nAll ${files.length} migration file(s) applied successfully.`);
    return;
  }

  // 2. Docker compose の postgres コンテナを試す
  if (isDockerPostgresRunning()) {
    console.log('[runner] Using docker compose exec postgres psql fallback...');
    for (const file of files) {
      const fullPath = path.join(SQL_DIR, file);
      const sqlContent = readFileSync(fullPath);
      console.log(`\n=== Applying ${file} (via docker compose exec) ===`);
      try {
        execFileSync(
          'docker',
          ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'keiri_kaikei', '-v', 'ON_ERROR_STOP=1'],
          {
            cwd: ROOT_DIR,
            input: sqlContent,
            stdio: ['pipe', 'inherit', 'inherit'],
          }
        );
      } catch (error) {
        console.error(`\nMigration failed at ${file}: ${error.message}`);
        process.exit(typeof error.status === 'number' ? error.status : 1);
      }
    }
    console.log(`\nAll ${files.length} migration file(s) applied successfully.`);
    return;
  }

  // 3. node-postgres (pg) を試す
  const pgSuccess = await runWithNodePostgres(databaseUrl, files);
  if (pgSuccess) {
    console.log(`\nAll ${files.length} migration file(s) applied successfully.`);
    return;
  }

  // どのランナーも利用できない場合
  console.error('\nERROR: No suitable migration runner found.');
  console.error('Please either:');
  console.error('  1. Install PostgreSQL client on host:');
  console.error('     - Windows: winget install PostgreSQL.PostgreSQL.16');
  console.error('     - macOS:   brew install libpq && brew link --force libpq');
  console.error('     - Linux:   sudo apt-get install -y postgresql-client');
  console.error('  2. Or start docker container: docker compose up -d');
  console.error('  3. Or install node-postgres in backend: cd backend && npm install');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
