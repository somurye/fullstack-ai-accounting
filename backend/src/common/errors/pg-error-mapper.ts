/**
 * pg-error-mapper.ts
 * ===================
 * `sql/001_initial_schema_all_in_one.sql` のCHECK制約・トリガーが送出する
 * PostgreSQLエラー(SQLSTATE + メッセージ本文)を、`docs/openapi.yaml` で
 * 定義されたAPIエラーコードへ変換する。
 *
 * DBトリガーのメッセージ文字列は当該SQLファイルのものと完全に対応させている。
 * トリガーのメッセージ文言を変更した場合は、本ファイルの正規表現も
 * 合わせて更新すること(ズレると生の英語メッセージがユーザーに露出してしまう)。
 *
 * 参照しているSQLSTATE:
 *   23514 (check_violation)       … 貸借不一致、自己承認禁止 等のCHECK/トリガー違反
 *   23001 (restrict_violation)    … 追記専用違反、void時間窓超過、状態遷移違反
 *   23505 (unique_violation)      … 一意制約違反(伝票番号重複、CSV重複取込等)
 *   23503 (foreign_key_violation) … 存在しない勘定科目/取引先等の参照
 *   23502 (not_null_violation)    … 必須項目欠落
 *   42501 (insufficient_privilege)… RLS WITH CHECK違反、権限不足ロールでの書込
 */

export interface PgErrorLike {
  code?: string;
  message?: string;
  detail?: string;
  constraint?: string;
  column?: string;
  table?: string;
}

export interface MappedApiError {
  code: string;
  message: string;
  httpStatus: number;
}

const SQLSTATE = {
  CHECK_VIOLATION: '23514',
  RESTRICT_VIOLATION: '23001',
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  INSUFFICIENT_PRIVILEGE: '42501',
} as const;

/** `pg` が投げるエラーがPostgreSQLのSQLSTATEを持つ実DBエラーかどうかを判定する */
export function isPostgresError(err: unknown): err is PgErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as PgErrorLike).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((err as PgErrorLike).code as string)
  );
}

/**
 * PostgreSQLエラーをAPIエラーへ変換する。マッピング対象外のSQLSTATEの場合は
 * `null` を返す(呼び出し側は汎用の500 INTERNAL_ERRORにフォールバックすること)。
 */
export function mapPgError(err: PgErrorLike): MappedApiError | null {
  const code = err.code;
  const message = err.message ?? '';

  if (!code) return null;

  switch (code) {
    case SQLSTATE.CHECK_VIOLATION: {
      if (/not balanced/.test(message) || /must have at least 2 lines to be posted/.test(message)) {
        return {
          code: 'INVALID_BALANCE',
          message: '借方合計と貸方合計が一致しないため確定できません',
          httpStatus: 409,
        };
      }
      if (/self-approval is not permitted/.test(message)) {
        return {
          code: 'SELF_APPROVAL_NOT_ALLOWED',
          message: '申請者本人は承認者になれません',
          httpStatus: 409,
        };
      }
      return {
        code: 'VALIDATION_ERROR',
        message: '入力値がデータ制約に違反しています',
        httpStatus: 422,
      };
    }

    case SQLSTATE.RESTRICT_VIOLATION: {
      if (/void is only allowed within 24 hours/.test(message)) {
        return {
          code: 'VOID_WINDOW_EXPIRED',
          message: '確定から24時間を超えているためvoid(即時取消)はできません。反対仕訳を起票してください',
          httpStatus: 409,
        };
      }
      if (/is already referenced by other records/.test(message)) {
        return {
          code: 'VOID_WINDOW_EXPIRED',
          message: '既に他のレコードから参照されているためvoid(即時取消)はできません。反対仕訳を起票してください',
          httpStatus: 409,
        };
      }
      if (
        /cannot be modified once parent journal_entry status is/.test(message) ||
        /is append-only:/.test(message) ||
        /cannot be physically deleted/.test(message) ||
        /in status .* cannot be deleted/.test(message)
      ) {
        return {
          code: 'APPEND_ONLY_VIOLATION',
          message: 'このレコードは確定済み(追記専用)のため変更・削除できません',
          httpStatus: 409,
        };
      }
      if (
        /can only transition to voided/.test(message) ||
        /are append-only and cannot be updated/.test(message) ||
        /are immutable/.test(message) ||
        /cannot revert to draft/.test(message)
      ) {
        return {
          code: 'INVALID_STATE_TRANSITION',
          message: '現在の状態からその操作へは遷移できません',
          httpStatus: 409,
        };
      }
      return {
        code: 'CONFLICT',
        message: '現在の状態のため操作を完了できませんでした',
        httpStatus: 409,
      };
    }

    case SQLSTATE.UNIQUE_VIOLATION: {
      return {
        code: 'DUPLICATE_RECORD',
        message: '既に同じ内容のレコードが存在します(重複取込の可能性があります)',
        httpStatus: 409,
      };
    }

    case SQLSTATE.FOREIGN_KEY_VIOLATION: {
      return {
        code: 'INVALID_REFERENCE',
        message: '参照先のレコードが存在しません',
        httpStatus: 422,
      };
    }

    case SQLSTATE.NOT_NULL_VIOLATION: {
      return {
        code: 'VALIDATION_ERROR',
        message: err.column
          ? `必須項目が入力されていません (${err.column})`
          : '必須項目が入力されていません',
        httpStatus: 422,
      };
    }

    case SQLSTATE.INSUFFICIENT_PRIVILEGE: {
      // RLSのWITH CHECK違反(テナント越境INSERT/UPDATE)や、
      // app_readonly_externalロールでの書込試行等がここに該当する。
      return {
        code: 'FORBIDDEN',
        message: 'この操作を行う権限がありません',
        httpStatus: 403,
      };
    }

    default:
      return null;
  }
}
