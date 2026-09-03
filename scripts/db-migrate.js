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
 *   2. `docker compose exec -T postgres psql` (Dockerコンテナ稼働中 かつ DATABASE_URLがローカルDockerと一致する場合)
 *   3. `node-postgres` (pgパッケージ経由での直接SQL実行)
 *
 * ※注意 (MAJOR-01対応):
 *   DATABASE_URLがリモートDB等を指している場合に意図せずローカルDockerコンテナへマイグレーションを
 *   流し込まないよう、DATABASE_URLをパースし、host/port/databaseがローカルDocker composeの
 *   設定 (localhost:5432/keiri_kaikei) と一致する場合のみDocker fallbackを使用する。
 *   一致しない場合はDocker fallbackをスキップし、node-postgresによる直接接続へ進む。
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
 * DATABASE_URL をパースしてオブジェクトを返す
 * パスワードや特殊文字（@, %, # 等）が含まれる場合もURL標準仕様に従って正しくデコードする
 */
function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== 'string') return null;
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? String(parsed.port) : '5432';
    const database = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
    const user = decodeURIComponent(parsed.username || '');
    const password = decodeURIComponent(parsed.password || '');
    return {
      hostname,
      port,
      database,
      user,
      password,
    };
  } catch {
    return null;
  }
}

/**
 * DATABASE_URL の接続先がローカルの Docker Compose (postgres サービス) と一致するか判定する
 */
function matchesDockerCompose(parsedUrl) {
  if (!parsedUrl) return false;
  const localHosts = ['localhost', '127.0.0.1', '::1'];
  const isLocalHost = localHosts.includes(parsedUrl.hostname);
  const isDefaultPort = parsedUrl.port === '5432';
  const isTargetDb = parsedUrl.database === 'keiri_kaikei';
  return isLocalHost && isDefaultPort && isTargetDb;
}

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
 * 実行ランナーを判定する
 * @returns {'host-psql' | 'docker' | 'node-postgres' | 'none'}
 */
function determineRunner({ hasPsql, isDockerRunning, parsedUrl, hasNodePg }) {
  if (hasPsql) {
    return 'host-psql';
  }

  if (isDockerRunning) {
    if (matchesDockerCompose(parsedUrl)) {
      return 'docker';
    } else {
      console.log(
        `[runner] Skipping docker fallback: DATABASE_URL (${parsedUrl ? `${parsedUrl.hostname}:${parsedUrl.port}/${parsedUrl.database}` : 'invalid'}) does not match local docker compose settings (localhost:5432/keiri_kaikei). Proceeding to node-postgres fallback.`
      );
    }
  }

  if (hasNodePg) {
    return 'node-postgres';
  }

  return 'none';
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

  const parsedUrl = parseDatabaseUrl(databaseUrl);
  if (!parsedUrl) {
    console.warn(`[runner] Warning: Could not fully parse DATABASE_URL. Please verify format.`);
  }

  const files = readdirSync(SQL_DIR)
    .filter((name) => SQL_FILE_RE.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  if (files.length === 0) {
    console.error(`No migration files found under ${SQL_DIR}`);
    process.exit(1);
  }

  const psqlAvailable = hasCommand('psql');
  const dockerRunning = isDockerPostgresRunning();
  let nodePgAvailable = false;
  try {
    require('pg');
    nodePgAvailable = true;
  } catch {
    try {
      require(path.resolve(__dirname, '../backend/node_modules/pg'));
      nodePgAvailable = true;
    } catch {
      nodePgAvailable = false;
    }
  }

  const runner = determineRunner({
    hasPsql: psqlAvailable,
    isDockerRunning: dockerRunning,
    parsedUrl,
    hasNodePg: nodePgAvailable,
  });

  if (runner === 'host-psql') {
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

  if (runner === 'docker') {
    console.log('[runner] Using docker compose exec postgres psql fallback...');
    const dbUser = parsedUrl?.user || 'postgres';
    const dbName = parsedUrl?.database || 'keiri_kaikei';
    for (const file of files) {
      const fullPath = path.join(SQL_DIR, file);
      const sqlContent = readFileSync(fullPath);
      console.log(`\n=== Applying ${file} (via docker compose exec) ===`);
      try {
        execFileSync(
          'docker',
          ['compose', 'exec', '-T', 'postgres', 'psql', '-U', dbUser, '-d', dbName, '-v', 'ON_ERROR_STOP=1'],
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

  if (runner === 'node-postgres') {
    const pgSuccess = await runWithNodePostgres(databaseUrl, files);
    if (pgSuccess) {
      console.log(`\nAll ${files.length} migration file(s) applied successfully.`);
      return;
    }
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

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  parseDatabaseUrl,
  matchesDockerCompose,
  determineRunner,
  hasCommand,
  isDockerPostgresRunning,
  runWithNodePostgres,
};
