import { HttpException } from '@nestjs/common';

/**
 * ErrorDetail
 * 検証エラー等の個別項目を表す。`docs/openapi.yaml` の `ApiError.details` に対応する。
 */
export interface ErrorDetail {
  field?: string;
  message: string;
  [key: string]: unknown;
}

/**
 * AppException
 * ============
 * アプリケーション層(サービス/コントローラ)から意図的に投げる、
 * `docs/openapi.yaml` のエラーエンベロープ
 * `{ "success": false, "error": { "code", "message", "details" } }`
 * に1対1で対応する例外クラス。
 *
 * DBトリガー/CHECK制約由来の例外(`INVALID_BALANCE` 等)は
 * `src/common/errors/pg-error-mapper.ts` が別途変換するため、
 * このクラスは主にアプリケーション層のビジネスルール違反
 * (例: 承認ルール未設定、CSVフォーマット不正)を表現する際に使用する。
 */
export class AppException extends HttpException {
  public readonly errorCode: string;
  public readonly details: ErrorDetail[];

  constructor(
    errorCode: string,
    message: string,
    httpStatus: number,
    details: ErrorDetail[] = [],
  ) {
    super({ code: errorCode, message, details }, httpStatus);
    this.errorCode = errorCode;
    this.details = details;
  }

  static badRequest(message: string, details: ErrorDetail[] = []): AppException {
    return new AppException('VALIDATION_ERROR', message, 400, details);
  }

  static unauthorized(message = '認証に失敗しました'): AppException {
    return new AppException('UNAUTHORIZED', message, 401);
  }

  static forbidden(message = 'この操作を行う権限がありません'): AppException {
    return new AppException('FORBIDDEN', message, 403);
  }

  static tenantMismatch(
    message = 'X-Tenant-IDヘッダーがトークンのテナントクレームと一致しません',
  ): AppException {
    return new AppException('TENANT_MISMATCH', message, 403);
  }

  static notFound(message = '指定されたリソースが見つかりません'): AppException {
    return new AppException('NOT_FOUND', message, 404);
  }

  static conflict(code: string, message: string, details: ErrorDetail[] = []): AppException {
    return new AppException(code, message, 409, details);
  }
}
