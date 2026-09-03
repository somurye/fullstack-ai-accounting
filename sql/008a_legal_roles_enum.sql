-- ============================================================================
-- マイグレーション 008a: 法務向けロールENUM値の追加 (Phase 0: P0-T4)
-- ============================================================================
-- PostgreSQLでは ALTER TYPE ... ADD VALUE で追加した新しいENUM値を
-- 同一トランザクション内で直後に使用できない (unsafe use of new value エラー)
-- 制約があるため、ENUM拡張ステートメントを単独ファイルとして先行実行・COMMITする。
-- ============================================================================

ALTER TYPE role_code_enum ADD VALUE IF NOT EXISTS 'legal_admin';
ALTER TYPE role_code_enum ADD VALUE IF NOT EXISTS 'legal_viewer';
