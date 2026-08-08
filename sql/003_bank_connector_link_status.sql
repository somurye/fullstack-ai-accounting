-- 「銀行・外部決済コネクタ」設定UIのOAuth連携(モック)状態を保持するためのカラム追加。
-- 連携有無自体は既存の tenant_integration_settings.bank_connector_status (not_connected/connected)
-- をそのまま流用し、プロバイダー種別と連携日時のみ新規カラムとして追加する。
ALTER TABLE tenant_integration_settings
  ADD COLUMN bank_connector_provider TEXT,
  ADD COLUMN bank_connector_linked_at TIMESTAMPTZ;
