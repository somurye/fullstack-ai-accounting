-- 職務分掌(SoD)RBAC: 会計担当(ACCOUNTANT)から出納・消込業務を分離した
-- 経理担当(BOOKKEEPER)ロールを追加する。既存の role_code_enum / roles テーブルへの
-- 追記のみで、既存ロール(owner/accounting_manager/accountant/approver/employee/
-- payroll_admin/viewer_external/system_service)は変更しない。
ALTER TYPE role_code_enum ADD VALUE IF NOT EXISTS 'bookkeeper';

INSERT INTO roles (code, name) VALUES
    ('bookkeeper', '経理担当(出納・消込)')
ON CONFLICT (code) DO NOTHING;
