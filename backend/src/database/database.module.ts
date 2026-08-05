import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * DatabaseModule
 * ==============
 * `DatabaseService`(pg.Poolベースの生SQLアクセス層)をアプリ全体で共有する
 * グローバルモジュール。各機能モジュールは `DatabaseModule` を個別にimportせずとも
 * `DatabaseService` をDIできる。
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
