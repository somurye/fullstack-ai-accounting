/**
 * Multerの`FileInterceptor`にはデフォルトのファイルサイズ上限が無い(無制限)。
 * 上限を設定しないと、巨大なファイルのアップロードがメモリ上に無制限にバッファされ、
 * (特にOCR経路ではさらにbase64化されて~1.3倍に膨らんだ上でAI APIへ送信される)
 * Node プロセスのOOMを引き起こしうる。アップロードを受け付ける全エンドポイントで
 * 用途に応じた上限を必ず設定すること。
 */
export const OCR_IMAGE_UPLOAD_MAX_BYTES = 15 * 1024 * 1024; // 15MB (領収書画像/PDF)
export const CSV_UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10MB (銀行明細/給与CSV)
export const ATTACHMENT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024; // 20MB (証憑ファイル全般)
