-- 監査ログの検索性刷新: クライアントのUser-Agentを記録し、詳細モーダルで確認できるようにする。
ALTER TABLE audit_logs ADD COLUMN user_agent TEXT;
