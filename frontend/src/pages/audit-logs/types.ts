import type { components } from '../../types/api.generated';

export type AuditLog = components['schemas']['AuditLog'];

/** `action`(例: journal_entry.posted)の対象種別プレフィックスに対する日本語ラベル */
export const TARGET_TYPE_LABEL: Record<string, string> = {
  journal_entry: '仕訳',
  expense_report: '経費精算',
  invoice: '売上請求書',
  vendor_bill: '仕入請求書',
  bank_transaction: '銀行明細',
  bank_account: '銀行口座',
  bank_integration: '銀行連携',
  payroll_import: '給与インポート',
  fixed_asset: '固定資産',
  consumption_tax_return: '消費税申告',
  payment_batch: '支払バッチ',
  external_access_grant: '外部アクセス許可',
  attachment: '証憑',
  tenant: 'テナント',
  tenant_member: 'メンバー',
  user: 'ユーザー',
};

export function formatTargetType(targetType: string): string {
  return TARGET_TYPE_LABEL[targetType] ?? targetType;
}

/**
 * 検索フォームの「対象種別」ドロップダウンの選択肢。バックエンドの
 * `AUDIT_TARGET_TYPES`(`backend/src/modules/audit-logs/dto/audit-log.schemas.ts`)
 * ホワイトリストと1:1で対応させる(ここに無い値を送るとバリデーションエラーになる)。
 */
export const AUDIT_TARGET_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  'journal_entry',
  'user',
  'bank_account',
  'tenant',
  'invoice',
  'expense_report',
  'vendor_bill',
  'bank_transaction',
  'payroll_import',
  'fixed_asset',
  'consumption_tax_return',
  'payment_batch',
  'external_access_grant',
  'attachment',
].map((value) => ({ value, label: formatTargetType(value) }));

/** `action` の完全一致ラベル。未知のactionは `formatAction()` がフォールバック整形する */
const ACTION_LABEL: Record<string, string> = {
  'journal_entry.posted': '仕訳を確定',
  'journal_entry.submitted': '仕訳を申請',
  'journal_entry.rejected': '仕訳を却下',
  'expense_report.approved': '経費精算を承認',
  'expense_report.rejected': '経費精算を却下',
  'vendor_bill.submitted': '仕入請求書を申請',
  'vendor_bill.approved': '仕入請求書を承認',
  'vendor_bill.rejected': '仕入請求書を却下',
  'invoice.issued': '売上請求書を発行',
  'invoice.payment_recorded': '入金を記録',
  'invoice.voided': '売上請求書を取消',
  'bank_transaction.matched': '銀行明細を消込',
  'bank_integration.synced': '銀行明細をAPI同期',
  'bank_integration.connected': '銀行API連携を開始',
  'bank_integration.disconnected': '銀行API連携を解除',
  'payroll_import.imported': '給与データを取込',
  'payroll_import.posted': '給与仕訳を確定',
  'fixed_asset.depreciation_run': '減価償却を実行',
  'consumption_tax_return.finalized': '消費税申告を確定',
  'payment_batch.exported': '支払バッチを出力',
  'attachment.uploaded': '証憑をアップロード',
  'attachment.linked': '証憑を紐付け',
  'external_access_grant.granted': '外部アクセス許可を発行',
  'external_access_grant.revoked': '外部アクセス許可を失効',
  'tenant.signed_up': 'テナントを新規登録',
  'tenant.settings_updated': '自社情報を更新',
  'tenant.accounting_settings_updated': '会計処理設定を更新',
  'tenant.ai_integration_updated': 'AI連携設定を更新',
  'tenant.ai_integration_tested': 'AI連携の接続テストを実行',
  'tenant_member.invited': 'メンバーを招待',
  'tenant_member.invitation_cancelled': 'メンバー招待を取消',
  'tenant_member.invitation_accepted': 'メンバー招待を受諾',
  'tenant_member.role_changed': 'メンバーのロールを変更',
  'tenant_member.removed': 'メンバーを削除',
};

/** 未知のactionに対するフォールバック整形(target_type.verb → "対象種別ラベル: verb") */
export function formatAction(action: string): string {
  const known = ACTION_LABEL[action];
  if (known) return known;

  const dotIndex = action.indexOf('.');
  if (dotIndex === -1) return action;
  const targetType = action.slice(0, dotIndex);
  const verb = action.slice(dotIndex + 1);
  return `${formatTargetType(targetType)}: ${verb.replace(/_/g, ' ')}`;
}

export interface AuditLogListParams {
  page?: number;
  page_size?: number;
  target_type?: string;
  target_id?: string;
  actor_user_id?: string;
  /** 操作者名の部分一致検索 */
  actor_name?: string;
  /** 操作者名・対象名・対象IDのフリーワード部分一致検索 */
  keyword?: string;
  occurred_from?: string;
  occurred_to?: string;
}

/** アクション名からバッジの色味を分類するための簡易ヒント */
export function actionSeverity(action: string): 'neutral' | 'positive' | 'warning' {
  if (action.includes('reject') || action.includes('revoked') || action.includes('void')) {
    return 'warning';
  }
  if (
    action.includes('posted') ||
    action.includes('approved') ||
    action.includes('issued') ||
    action.includes('finalized') ||
    action.includes('exported')
  ) {
    return 'positive';
  }
  return 'neutral';
}

export const SEVERITY_BADGE: Record<ReturnType<typeof actionSeverity>, string> = {
  positive: 'badge-posted',
  warning: 'badge-rejected',
  neutral: 'badge-draft',
};

export const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** before_data/after_data の値を人間が読める文字列へ整形する(日時文字列・数値・真偽値・null) */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'はい' : 'いいえ';
  if (typeof value === 'number') return value.toLocaleString('ja-JP');
  if (typeof value === 'string') {
    if (ISO_DATE_TIME_RE.test(value)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return dateTimeFormatter.format(parsed);
      }
    }
    return value;
  }
  return JSON.stringify(value);
}
