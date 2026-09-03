import * as path from 'path';

// scripts/db-migrate.js を読み込む
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  parseDatabaseUrl,
  matchesDockerCompose,
  determineRunner,
} = require(path.resolve(__dirname, '../../../scripts/db-migrate.js'));

describe('db-migrate runner logic (P0-T5)', () => {
  describe('parseDatabaseUrl', () => {
    it('ローカルの標準的なDATABASE_URLを正しくパースできる', () => {
      const url = 'postgresql://postgres:postgres@localhost:5432/keiri_kaikei';
      const parsed = parseDatabaseUrl(url);
      expect(parsed).toEqual({
        hostname: 'localhost',
        port: '5432',
        database: 'keiri_kaikei',
        user: 'postgres',
        password: 'postgres',
      });
    });

    it('特殊文字を含むパスワードやポート省略時のデフォルトポート(5432)を正しく扱う', () => {
      const url = 'postgresql://my%40user:p%40ss%23word@db.remote.com/my_special_db';
      const parsed = parseDatabaseUrl(url);
      expect(parsed).toEqual({
        hostname: 'db.remote.com',
        port: '5432',
        database: 'my_special_db',
        user: 'my@user',
        password: 'p@ss#word',
      });
    });

    it('不正な形式や非PostgreSQLプロトコルではnullを返す', () => {
      expect(parseDatabaseUrl('')).toBeNull();
      expect(parseDatabaseUrl('not-a-url')).toBeNull();
      expect(parseDatabaseUrl('http://localhost:5432/db')).toBeNull();
    });
  });

  describe('matchesDockerCompose', () => {
    it('localhost:5432/keiri_kaikei の場合に true を返す', () => {
      const parsed = parseDatabaseUrl('postgresql://postgres:postgres@localhost:5432/keiri_kaikei');
      expect(matchesDockerCompose(parsed)).toBe(true);
    });

    it('127.0.0.1:5432/keiri_kaikei の場合に true を返す', () => {
      const parsed = parseDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5432/keiri_kaikei');
      expect(matchesDockerCompose(parsed)).toBe(true);
    });

    it('リモートホストを指定している場合は false を返す（MAJOR-01対策）', () => {
      const parsed = parseDatabaseUrl('postgresql://prod_user:secret@rds.ap-northeast-1.amazonaws.com:5432/keiri_kaikei');
      expect(matchesDockerCompose(parsed)).toBe(false);
    });

    it('別ポートを指定している場合は false を返す', () => {
      const parsed = parseDatabaseUrl('postgresql://postgres:postgres@localhost:5433/keiri_kaikei');
      expect(matchesDockerCompose(parsed)).toBe(false);
    });

    it('別データベース名を指定している場合は false を返す', () => {
      const parsed = parseDatabaseUrl('postgresql://postgres:postgres@localhost:5432/other_db');
      expect(matchesDockerCompose(parsed)).toBe(false);
    });
  });

  describe('determineRunner', () => {
    it('ホストpsqlが存在する場合は最優先で host-psql を選択する', () => {
      const runner = determineRunner({
        hasPsql: true,
        isDockerRunning: true,
        parsedUrl: parseDatabaseUrl('postgresql://postgres:postgres@localhost:5432/keiri_kaikei'),
        hasNodePg: true,
      });
      expect(runner).toBe('host-psql');
    });

    it('ホストpsqlなし・Docker起動中・DATABASE_URLがローカルDockerと一致する場合は docker を選択する', () => {
      const runner = determineRunner({
        hasPsql: false,
        isDockerRunning: true,
        parsedUrl: parseDatabaseUrl('postgresql://postgres:postgres@localhost:5432/keiri_kaikei'),
        hasNodePg: true,
      });
      expect(runner).toBe('docker');
    });

    it('★MAJOR-01: ホストpsqlなし・Docker起動中であっても、DATABASE_URLがリモートの場合はDocker fallbackをスキップしnode-postgresへ進む', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const runner = determineRunner({
        hasPsql: false,
        isDockerRunning: true,
        parsedUrl: parseDatabaseUrl('postgresql://user:pass@production-db.example.com:5432/keiri_kaikei'),
        hasNodePg: true,
      });
      expect(runner).toBe('node-postgres');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping docker fallback: DATABASE_URL (production-db.example.com:5432/keiri_kaikei) does not match local docker compose settings')
      );
      consoleLogSpy.mockRestore();
    });

    it('ホストpsqlなし・Docker停止中・node-pgありの場合は node-postgres を選択する', () => {
      const runner = determineRunner({
        hasPsql: false,
        isDockerRunning: false,
        parsedUrl: parseDatabaseUrl('postgresql://postgres:postgres@localhost:5432/keiri_kaikei'),
        hasNodePg: true,
      });
      expect(runner).toBe('node-postgres');
    });

    it('いずれのランナーも利用できない場合は none を返す', () => {
      const runner = determineRunner({
        hasPsql: false,
        isDockerRunning: false,
        parsedUrl: parseDatabaseUrl('postgresql://postgres:postgres@localhost:5432/keiri_kaikei'),
        hasNodePg: false,
      });
      expect(runner).toBe('none');
    });
  });
});
