import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * main.ts
 * =======
 * アプリケーションのエントリポイント。
 *
 * - `setGlobalPrefix('v1')` は `docs/openapi.yaml` の `servers[].url` に含まれる
 *   `/v1` ベースパスに対応する(例: `POST /v1/journal-entries/{id}/post`)。
 * - `helmet()` によりセキュリティ関連HTTPヘッダーを付与する。
 * - `enableShutdownHooks()` により、プロセス終了時に `DatabaseService.onModuleDestroy()`
 *   (pg.Poolの正常クローズ)が確実に呼び出されるようにする。
 */
async function bootstrap(): Promise<void> {
  // `CORS_ORIGIN`未設定時に`origin: true`(全オリジンをリクエストのOriginヘッダーへ
  // 反射)へフォールバックすると、`credentials: true`と組み合わさって
  // 設定漏れがそのまま「任意オリジンからの資格情報付きリクエストを許可する」
  // 事故的な全許可設定になる。fail-closedとして空配列(=全オリジン拒否)へ倒す。
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [],
      credentials: true,
    },
  });

  app.use(helmet());
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);

  Logger.log(`🚀 API server listening on http://localhost:${port}/v1`, 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error('Failed to bootstrap application', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
