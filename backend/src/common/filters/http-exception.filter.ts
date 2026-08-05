import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContext } from '../context/request-context';
import { isPostgresError, mapPgError } from '../errors/pg-error-mapper';
import { AppException } from '../exceptions/app.exception';

/**
 * `docs/openapi.yaml` で定義されたエラーエンベロープ。
 * `{ "success": false, "error": { "code", "message", "details" } }`
 */
interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details: unknown[];
  };
  meta: {
    request_id: string | null;
  };
}

/**
 * HttpExceptionFilter
 * ====================
 * アプリケーション全体の例外を捕捉し、`docs/openapi.yaml` 定義の
 * 統一エラーエンベロープへ変換するグローバル例外フィルター。
 *
 * 捕捉する例外は大きく3種類:
 *   1. `AppException`        … アプリ層が意図的に投げた業務エラー(コード確定済み)
 *   2. PostgreSQLエラー      … `pg` から再スローされたDBエラー。
 *                               `pg-error-mapper` でAPIエラーコードへ変換する
 *                               (貸借不一致・追記専用違反・自己承認禁止 等)。
 *   3. その他(NestのHttpException、未知のエラー) … ステータスに応じた
 *                               汎用コードにフォールバックする。
 *
 * 未知のエラー(3の一部)は詳細をクライアントに露出せず、サーバーログにのみ
 * スタックトレースを出力する(情報漏洩防止)。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const requestId = RequestContext.getRequestId();

    const { httpStatus, code, message, details } = this.resolve(exception);

    if (httpStatus >= 500) {
      this.logger.error(
        `[${requestId ?? 'no-request-id'}] ${code}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`[${requestId ?? 'no-request-id'}] ${httpStatus} ${code}: ${message}`);
    }

    const body: ErrorEnvelope = {
      success: false,
      error: { code, message, details },
      meta: { request_id: requestId },
    };

    response.status(httpStatus).json(body);
  }

  private resolve(exception: unknown): {
    httpStatus: number;
    code: string;
    message: string;
    details: unknown[];
  } {
    // 1. アプリケーション層が意図的に投げた業務エラー
    if (exception instanceof AppException) {
      const status = exception.getStatus();
      return {
        httpStatus: status,
        code: exception.errorCode,
        message: exception.message,
        details: exception.details,
      };
    }

    // 2. PostgreSQLエラー(DBトリガー/CHECK制約由来を含む)
    if (isPostgresError(exception)) {
      const mapped = mapPgError(exception);
      if (mapped) {
        return {
          httpStatus: mapped.httpStatus,
          code: mapped.code,
          message: mapped.message,
          details: [],
        };
      }
      // マッピング対象外のDBエラーは内部エラーとして扱う(詳細は露出しない)。
      return {
        httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'サーバー内部でエラーが発生しました',
        details: [],
      };
    }

    // 3. Nestの標準HttpException(ValidationPipe, NotFoundException 等)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const responseBody = exception.getResponse();
      const message =
        typeof responseBody === 'string'
          ? responseBody
          : ((responseBody as { message?: string | string[] })?.message ?? exception.message);
      return {
        httpStatus: status,
        code: this.defaultCodeForStatus(status),
        message: Array.isArray(message) ? message.join(', ') : message,
        details: [],
      };
    }

    // 4. 完全に未知のエラー。詳細を露出せずログにのみ記録する。
    return {
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
      details: [],
    };
  }

  private defaultCodeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'VALIDATION_ERROR';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
    }
  }
}
