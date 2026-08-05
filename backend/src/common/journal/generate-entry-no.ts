import type { PoolClient } from 'pg';
import { acquireAdvisoryLock } from '../database/advisory-lock';

/**
 * `JE-{YYYYMMDD}-{4桁連番}` 形式の伝票番号をテナント×日付単位で採番する。
 * `journal-entries`モジュールの手動起票と、`expense-reports`モジュールの先行仕訳自動起票の
 * 両方から共有される(同一テーブル `journal_entries` への採番のため、ロジックは1箇所に集約する)。
 */
export async function generateJournalEntryNo(
  client: PoolClient,
  tenantId: string,
  entryDate: string,
): Promise<string> {
  const datePart = entryDate.replace(/-/g, '');
  await acquireAdvisoryLock(client, `journal_entry_no:${tenantId}:${datePart}`);
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM journal_entries WHERE tenant_id = $1 AND entry_no LIKE $2`,
    [tenantId, `JE-${datePart}-%`],
  );
  const seq = Number(rows[0]?.count ?? 0) + 1;
  return `JE-${datePart}-${String(seq).padStart(4, '0')}`;
}
