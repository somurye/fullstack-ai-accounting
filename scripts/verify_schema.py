#!/usr/bin/env python3
"""
verify_schema.py
=================

経理・会計オールインワンAIアプリケーション
sql/001_initial_schema_all_in_one.sql の検証スクリプト(Phase 3)

目的:
    ローカルDocker等のPostgreSQL 16環境に対して実際にDDLを適用し、
    以下の設計上重要な振る舞いが意図通り動作することを自動テストで確認する。

      1. RLSによる完全テナント分離(読み取り・書き込みの越境遮断、fail-closed)
      2. 仕訳の貸借不一致時の posted 遷移拒否(CHECK/トリガー)
      3. 確定後(posted)の仕訳ヘッダ/明細・監査ログ等の追記専用性(UPDATE/DELETE禁止)
      4. 24時間以内・未参照時のみの void 許可
      5. 承認履歴における自己承認の禁止
      6. viewer_external(税理士/監査人)の時限アクセス制御 + 読み取り専用の強制

    本スクリプトのアサーションは、開発時にPGlite(実PostgreSQLエンジンのWASM版)上で
    事前検証した内容を、実際のDocker PostgreSQL環境向けに psycopg2 で書き直したもの。
    (docs/03_database_design.md 「7. 検証結果サマリー」参照)

前提:
    - Docker が利用可能であること(--use-docker 指定時。未指定時は既存のPostgreSQLに接続)
    - Python: psycopg2-binary

使い方:
    # Dockerで使い捨てのPostgreSQL16コンテナを起動して検証する(推奨)
    python3 verify_schema.py --use-docker

    # 既存のPostgreSQLインスタンスに対して検証する
    python3 verify_schema.py --dsn "postgresql://postgres:postgres@localhost:5432/postgres"

終了コード:
    0 = 全テスト成功
    1 = いずれかのテスト失敗、またはセットアップ失敗
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2-binary が必要です。 pip install psycopg2-binary --break-system-packages", file=sys.stderr)
    sys.exit(1)


SCRIPT_DIR = Path(__file__).resolve().parent
SQL_DIR = SCRIPT_DIR.parent / "sql"

DOCKER_CONTAINER_NAME = "keiri_kaikei_verify_pg"
DOCKER_IMAGE = "postgres:16"
DOCKER_PORT = 55432
DOCKER_PASSWORD = "verify_pw"
DOCKER_DB = "keiri_kaikei_verify"


# ----------------------------------------------------------------------------
# テスト結果集計
# ----------------------------------------------------------------------------

class Results:
    def __init__(self) -> None:
        self.passed: list[str] = []
        self.failed: list[tuple[str, str]] = []

    def ok(self, name: str, condition: bool, detail: str = "") -> None:
        if condition:
            self.passed.append(name)
            print(f"  [PASS] {name}")
        else:
            self.failed.append((name, detail))
            print(f"  [FAIL] {name}  {detail}")

    def summary(self) -> int:
        total = len(self.passed) + len(self.failed)
        print("\n" + "=" * 70)
        print(f"検証結果: {len(self.passed)}/{total} 件成功")
        if self.failed:
            print("失敗した項目:")
            for name, detail in self.failed:
                print(f"  - {name}: {detail}")
        print("=" * 70)
        return 0 if not self.failed else 1


# ----------------------------------------------------------------------------
# Docker管理(--use-docker 指定時のみ使用)
# ----------------------------------------------------------------------------

def docker_start() -> str:
    print(f"[docker] 既存コンテナ {DOCKER_CONTAINER_NAME} を削除(存在すれば)...")
    subprocess.run(["docker", "rm", "-f", DOCKER_CONTAINER_NAME],
                    capture_output=True, check=False)

    print(f"[docker] {DOCKER_IMAGE} を起動 (port={DOCKER_PORT})...")
    subprocess.run([
        "docker", "run", "-d",
        "--name", DOCKER_CONTAINER_NAME,
        "-e", f"POSTGRES_PASSWORD={DOCKER_PASSWORD}",
        "-e", f"POSTGRES_DB={DOCKER_DB}",
        "-p", f"{DOCKER_PORT}:5432",
        DOCKER_IMAGE,
    ], check=True)

    dsn = f"postgresql://postgres:{DOCKER_PASSWORD}@localhost:{DOCKER_PORT}/{DOCKER_DB}"

    print("[docker] PostgreSQLの起動待機中...")
    for attempt in range(30):
        try:
            conn = psycopg2.connect(dsn)
            conn.close()
            print("[docker] 起動完了")
            return dsn
        except psycopg2.OperationalError:
            time.sleep(1)
    raise RuntimeError("PostgreSQLコンテナの起動待機がタイムアウトしました")


def docker_stop() -> None:
    print(f"[docker] コンテナ {DOCKER_CONTAINER_NAME} を停止・削除...")
    subprocess.run(["docker", "rm", "-f", DOCKER_CONTAINER_NAME],
                    capture_output=True, check=False)


# ----------------------------------------------------------------------------
# スキーマ適用
# ----------------------------------------------------------------------------

def apply_schema(dsn: str) -> None:
    if not SQL_DIR.exists():
        raise FileNotFoundError(f"SQLディレクトリが見つかりません: {SQL_DIR}")
    sql_files = sorted(
        [f for f in SQL_DIR.iterdir() if f.suffix == ".sql"],
        key=lambda p: p.name,
    )
    if not sql_files:
        raise FileNotFoundError(f"SQLファイルが見つかりません: {SQL_DIR}")

    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        for sql_file in sql_files:
            sql = sql_file.read_text(encoding="utf-8")
            print(f"[schema] {sql_file.name} を適用中 ({len(sql):,} bytes)...")
            with conn.cursor() as cur:
                cur.execute(sql)
        print("[schema] 全マイグレーション適用完了")
    finally:
        conn.close()


# ----------------------------------------------------------------------------
# トランザクションヘルパー: RLSコンテキストを設定して実行
# ----------------------------------------------------------------------------

@contextmanager
def tx_as(dsn: str, role: str | None = None,
          tenant_id: str | None = None, user_id: str | None = None):
    """指定ロール/テナント/ユーザーコンテキストでの1トランザクションを提供する。
    with文を抜けると自動COMMITし、例外発生時はROLLBACKする。
    """
    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if role:
                cur.execute(f"SET LOCAL ROLE {role}")
            if tenant_id:
                cur.execute("SET LOCAL app.current_tenant_id = %s", (tenant_id,))
            if user_id:
                cur.execute("SET LOCAL app.current_user_id = %s", (user_id,))
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ----------------------------------------------------------------------------
# 検証本体
# ----------------------------------------------------------------------------

def run_verification(dsn: str) -> int:
    r = Results()

    t1 = str(uuid.uuid4())
    t2 = str(uuid.uuid4())
    owner = str(uuid.uuid4())
    approver = str(uuid.uuid4())
    tax_advisor = str(uuid.uuid4())

    print("\n--- セットアップ: テナント/ユーザー/科目マスタ ---")
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("INSERT INTO tenants (id, name) VALUES (%s, 'Tenant One')", (t1,))
    with tx_as(dsn, role="app_runtime", tenant_id=t2) as cur:
        cur.execute("INSERT INTO tenants (id, name) VALUES (%s, 'Tenant Two')", (t2,))

    for uid, email, name in [
        (owner, "owner@example.com", "Owner"),
        (approver, "approver@example.com", "Approver"),
        (tax_advisor, "tax@example.com", "Tax Advisor"),
    ]:
        with tx_as(dsn, role="app_runtime", user_id=uid) as cur:
            cur.execute(
                "INSERT INTO users (id, email, name) VALUES (%s, %s, %s)",
                (uid, email, name),
            )

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            "INSERT INTO tenant_users (tenant_id, user_id) VALUES (%s, %s), (%s, %s)",
            (t1, owner, t1, approver),
        )
        cur.execute(
            """INSERT INTO accounts (tenant_id, code, name, account_type, normal_balance)
               VALUES (%s, '1000', '現金', 'asset', 'debit') RETURNING id""",
            (t1,),
        )
        cash_id = cur.fetchone()["id"]
        cur.execute(
            """INSERT INTO accounts (tenant_id, code, name, account_type, normal_balance)
               VALUES (%s, '5000', '旅費交通費', 'expense', 'debit') RETURNING id""",
            (t1,),
        )
        expense_id = cur.fetchone()["id"]

    with tx_as(dsn, role="app_runtime", tenant_id=t2) as cur:
        cur.execute(
            """INSERT INTO accounts (tenant_id, code, name, account_type, normal_balance)
               VALUES (%s, '1000', 'Cash', 'asset', 'debit') RETURNING id""",
            (t2,),
        )
        cash_id_t2 = cur.fetchone()["id"]

    # ------------------------------------------------------------------
    print("\n--- 1. RLS: テナント分離 (app_runtime) ---")
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("SELECT * FROM accounts WHERE id = %s", (cash_id_t2,))
        r.ok("他テナントの科目は見えない(RLS遮断)", len(cur.fetchall()) == 0)
        cur.execute("SELECT * FROM accounts WHERE id = %s", (cash_id,))
        r.ok("自テナントの科目は見える", len(cur.fetchall()) == 1)
        cur.execute("SELECT * FROM accounts")
        rows = cur.fetchall()
        r.ok("自テナントの科目のみが一覧に表示される", len(rows) == 2, f"got {len(rows)}")

    with tx_as(dsn, role="app_runtime") as cur:  # tenant_id未設定
        cur.execute("SELECT * FROM accounts")
        r.ok("テナントコンテキスト未設定時はfail-closed(0件)", len(cur.fetchall()) == 0)

    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                """INSERT INTO accounts (tenant_id, code, name, account_type, normal_balance)
                   VALUES (%s, '9999', 'Fraud', 'asset', 'debit')""",
                (t2,),  # tenant_idを詐称
            )
        r.ok("RLS WITH CHECKによる越境INSERT遮断", False, "例外が発生しなかった")
    except psycopg2.errors.InsufficientPrivilege:
        r.ok("RLS WITH CHECKによる越境INSERT遮断", True)
    except Exception as e:  # noqa: BLE001
        r.ok("RLS WITH CHECKによる越境INSERT遮断", "row-level security" in str(e).lower(), str(e))

    # ------------------------------------------------------------------
    print("\n--- 2. 仕訳: 貸借一致チェック ---")
    je_id = str(uuid.uuid4())
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, status, created_by)
               VALUES (%s, %s, 'JE-0001', current_date, 'draft', %s)""",
            (je_id, t1, owner),
        )
        cur.execute(
            """INSERT INTO journal_entry_lines
               (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
               VALUES (%s, %s, 1, %s, 'debit', 1000)""",
            (t1, je_id, expense_id),
        )
        cur.execute(
            """INSERT INTO journal_entry_lines
               (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
               VALUES (%s, %s, 2, %s, 'credit', 900)""",  # わざと不一致にする
            (t1, je_id, cash_id),
        )

    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute("UPDATE journal_entries SET status = 'posted' WHERE id = %s", (je_id,))
        r.ok("貸借不一致の仕訳はpostedに遷移できない", False, "例外が発生しなかった")
    except Exception as e:  # noqa: BLE001
        r.ok("貸借不一致の仕訳はpostedに遷移できない", "not balanced" in str(e), str(e))

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            "UPDATE journal_entry_lines SET amount = 1000 WHERE journal_entry_id = %s AND line_no = 2",
            (je_id,),
        )
        cur.execute("UPDATE journal_entries SET status = 'posted' WHERE id = %s", (je_id,))

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("SELECT status FROM journal_entries WHERE id = %s", (je_id,))
        r.ok("貸借一致後は正常にpostedへ遷移する", cur.fetchone()["status"] == "posted")

    # ------------------------------------------------------------------
    print("\n--- 3. 追記専用性(確定後の改変禁止) ---")
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                "UPDATE journal_entry_lines SET amount = 1 WHERE journal_entry_id = %s AND line_no = 1",
                (je_id,),
            )
        r.ok("posted後の仕訳明細は改変できない", False, "例外が発生しなかった")
    except Exception as e:  # noqa: BLE001
        r.ok("posted後の仕訳明細は改変できない", "cannot be modified" in str(e), str(e))

    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute("UPDATE journal_entries SET description = 'hacked' WHERE id = %s", (je_id,))
        r.ok("posted後の仕訳ヘッダは改変できない", False, "例外が発生しなかった")
    except Exception as e:  # noqa: BLE001
        r.ok("posted後の仕訳ヘッダは改変できない",
             "append-only" in str(e) or "posted journal_entries" in str(e), str(e))

    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute("DELETE FROM journal_entries WHERE id = %s", (je_id,))
        r.ok("仕訳は物理削除できない", False, "例外が発生しなかった")
    except Exception as e:  # noqa: BLE001
        r.ok("仕訳は物理削除できない", "cannot be physically deleted" in str(e), str(e))

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("UPDATE journal_entries SET status = 'voided' WHERE id = %s", (je_id,))
        cur.execute("SELECT status FROM journal_entries WHERE id = %s", (je_id,))
        r.ok("24時間以内・未参照のvoidは成功する", cur.fetchone()["status"] == "voided")

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            "INSERT INTO audit_logs (tenant_id, action, target_type) VALUES (%s, 'test.action', 'journal_entry')",
            (t1,),
        )
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute("UPDATE audit_logs SET action = 'tampered' WHERE tenant_id = %s", (t1,))
        r.ok("監査ログは追記専用(UPDATE禁止)", False, "例外が発生しなかった")
    except Exception as e:  # noqa: BLE001
        r.ok("監査ログは追記専用(UPDATE禁止)", "append-only" in str(e), str(e))

    # ------------------------------------------------------------------
    print("\n--- 4. 職務分掌: 自己承認の禁止 ---")
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        je2 = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, status, created_by)
               VALUES (%s, %s, 'JE-0002', current_date, 'draft', %s)""",
            (je2, t1, owner),
        )
        cur.execute(
            """INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps)
               VALUES (%s, 'journal_entry', %s, %s, 1) RETURNING id""",
            (t1, je2, owner),
        )
        ar_id = cur.fetchone()["id"]

        self_approval_blocked = False
        try:
            cur.execute(
                """INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action)
                   VALUES (%s, %s, 1, %s, 'approve')""",
                (t1, ar_id, owner),
            )
        except Exception as e:  # noqa: BLE001
            self_approval_blocked = "self-approval" in str(e)
            cur.connection.rollback()
        r.ok("自己承認は拒否される", self_approval_blocked)

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        je3 = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, status, created_by)
               VALUES (%s, %s, 'JE-0003', current_date, 'draft', %s)""",
            (je3, t1, owner),
        )
        cur.execute(
            """INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps)
               VALUES (%s, 'journal_entry', %s, %s, 1) RETURNING id""",
            (t1, je3, owner),
        )
        ar_id2 = cur.fetchone()["id"]
        cur.execute(
            """INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action)
               VALUES (%s, %s, 1, %s, 'approve')""",
            (t1, ar_id2, approver),
        )
    r.ok("別ユーザーによる承認は成功する", True)

    # 4.1 新target_type (contract / purchase_request) での承認ルール登録、自己承認禁止、RLS検証 (Phase 0 P0-T1)
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("SELECT id FROM roles WHERE code = 'owner'")
        owner_role_row = cur.fetchone()
        owner_role_id = owner_role_row["id"] if owner_role_row else None

        cur.execute("SELECT id FROM roles WHERE code = 'accounting_manager'")
        mgr_role_row = cur.fetchone()
        mgr_role_id = mgr_role_row["id"] if mgr_role_row else None

        if owner_role_id and mgr_role_id:
            cur.execute(
                """INSERT INTO approval_rules (tenant_id, target_type, step_number, condition, approver_role_id, is_active)
                   VALUES (%s, 'contract', 1, '{"min_amount": 0}', %s, TRUE)
                   ON CONFLICT (tenant_id, target_type, step_number, approver_role_id, approver_user_id) DO NOTHING""",
                (t1, owner_role_id),
            )
            cur.execute(
                """INSERT INTO approval_rules (tenant_id, target_type, step_number, condition, approver_role_id, is_active)
                   VALUES (%s, 'purchase_request', 1, '{"min_amount": 0}', %s, TRUE)
                   ON CONFLICT (tenant_id, target_type, step_number, approver_role_id, approver_user_id) DO NOTHING""",
                (t1, mgr_role_id),
            )
            r.ok("新target_type(contract, purchase_request)の承認ルール登録が成功する", True)

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        contract_target_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps)
               VALUES (%s, 'contract', %s, %s, 1) RETURNING id""",
            (t1, contract_target_id, owner),
        )
        contract_ar_id = cur.fetchone()["id"]

        contract_self_approval_blocked = False
        try:
            cur.execute(
                """INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action)
                   VALUES (%s, %s, 1, %s, 'approve')""",
                (t1, contract_ar_id, owner),
            )
        except Exception as e:  # noqa: BLE001
            contract_self_approval_blocked = "self-approval" in str(e)
            cur.connection.rollback()
        r.ok("新target_type(contract)でも自己承認は拒否される", contract_self_approval_blocked)

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action)
               VALUES (%s, %s, 1, %s, 'approve')""",
            (t1, contract_ar_id, approver),
        )
    r.ok("新target_type(contract)で別ユーザーによる承認は成功する", True)

    with tx_as(dsn, role="app_runtime", tenant_id=t2) as cur:
        cur.execute("SELECT * FROM approval_requests WHERE id = %s", (contract_ar_id,))
        r.ok("新target_type(contract)の承認依頼は他テナントから見えない(RLS)", len(cur.fetchall()) == 0)

    # ------------------------------------------------------------------
    print("\n--- 5. viewer_external: 時限アクセス制御 ---")
    with tx_as(dsn, role="app_readonly_external", tenant_id=t1, user_id=tax_advisor) as cur:
        cur.execute("SELECT * FROM accounts")
        r.ok("許可レコードが無い場合は0件", len(cur.fetchall()) == 0)

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO external_access_grants (tenant_id, user_id, valid_from, valid_until, granted_by)
               VALUES (%s, %s, now() - interval '10 days', now() - interval '1 day', %s)""",
            (t1, tax_advisor, owner),
        )
    with tx_as(dsn, role="app_readonly_external", tenant_id=t1, user_id=tax_advisor) as cur:
        cur.execute("SELECT * FROM accounts")
        r.ok("許可期間が期限切れの場合は0件", len(cur.fetchall()) == 0)

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO external_access_grants (tenant_id, user_id, valid_from, valid_until, granted_by)
               VALUES (%s, %s, now() - interval '1 day', now() + interval '30 days', %s)""",
            (t1, tax_advisor, owner),
        )
    with tx_as(dsn, role="app_readonly_external", tenant_id=t1, user_id=tax_advisor) as cur:
        cur.execute("SELECT * FROM accounts")
        r.ok("許可期間内は正常に閲覧できる", len(cur.fetchall()) == 2, f"got {len(cur.fetchall())}")

    try:
        with tx_as(dsn, role="app_readonly_external", tenant_id=t1, user_id=tax_advisor) as cur:
            cur.execute(
                """INSERT INTO accounts (tenant_id, code, name, account_type, normal_balance)
                   VALUES (%s, '2000', 'x', 'asset', 'debit')""",
                (t1,),
            )
        r.ok("viewer_externalは許可期間内でも書き込み不可(権限レベル)", False, "例外が発生しなかった")
    except Exception:
        r.ok("viewer_externalは許可期間内でも書き込み不可(権限レベル)", True)

    # ------------------------------------------------------------------
    print("\n--- 6. attachments: document_category 汎用化 (Phase 0 P0-T2) ---")
    att1_id = str(uuid.uuid4())
    att2_id = str(uuid.uuid4())

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        # 1. document_category 省略時のデフォルト値 ('receipt')
        cur.execute(
            """INSERT INTO attachments (id, tenant_id, file_name, storage_path, mime_type, file_hash, uploaded_by)
               VALUES (%s, %s, 'receipt_01.jpg', '/uploads/receipt_01.jpg', 'image/jpeg', 'hash1', %s)
               RETURNING document_category""",
            (att1_id, t1, owner),
        )
        row1 = cur.fetchone()
        r.ok("attachments の document_category 省略時は既定値 'receipt'", row1["document_category"] == "receipt")

        # 2. document_category = 'contract' (金額NULL) での登録
        cur.execute(
            """INSERT INTO attachments (id, tenant_id, file_name, storage_path, mime_type, file_hash, document_category, counterparty_name, uploaded_by)
               VALUES (%s, %s, 'contract.pdf', '/uploads/contract.pdf', 'application/pdf', 'hash2', 'contract', 'パートナー企業', %s)
               RETURNING document_category, amount""",
            (att2_id, t1, owner),
        )
        row2 = cur.fetchone()
        r.ok("attachments に document_category = 'contract' (金額NULL) が登録できる",
             row2["document_category"] == "contract" and row2["amount"] is None)

    # 3. 不正な document_category は CHECK 制約で拒否される
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                """INSERT INTO attachments (tenant_id, file_name, storage_path, mime_type, file_hash, document_category, uploaded_by)
                   VALUES (%s, 'test.bin', '/uploads/test.bin', 'application/octet-stream', 'hash3', 'invalid_cat', %s)""",
                (t1, owner),
            )
        r.ok("不正な document_category は CHECK 制約で拒否される", False, "例外が発生しなかった")
    except Exception as e:  # noqa: BLE001
        r.ok("不正な document_category は CHECK 制約で拒否される",
             "check constraint" in str(e).lower() or "violates check" in str(e).lower() or "attachments_document_category_check" in str(e),
             str(e))

    # 4. 他テナントからの RLS 分離確認
    with tx_as(dsn, role="app_runtime", tenant_id=t2) as cur:
        cur.execute("SELECT * FROM attachments WHERE id = %s", (att2_id,))
        r.ok("attachments(contract) は他テナントから見えない(RLS)", len(cur.fetchall()) == 0)

    # ------------------------------------------------------------------
    print("\n--- 7. RBAC: 法務向けロールと契約権限 (Phase 0 P0-T4) ---")
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        # 1. roles テーブルに legal_admin / legal_viewer が登録されている
        cur.execute("SELECT code, name FROM roles WHERE code IN ('legal_admin', 'legal_viewer')")
        roles_rows = {r["code"]: r["name"] for r in cur.fetchall()}
        r.ok("roles テーブルに legal_admin, legal_viewer が登録されている",
             "legal_admin" in roles_rows and "legal_viewer" in roles_rows)

        # 2. permissions テーブルに contract.* の5権限が登録されている
        cur.execute("SELECT code FROM permissions WHERE code LIKE 'contract.%'")
        perm_codes = {r["code"] for r in cur.fetchall()}
        expected_perms = {'contract.create', 'contract.view', 'contract.edit', 'contract.approve', 'contract.terminate'}
        r.ok("permissions テーブルに contract.* の全5権限が登録されている",
             expected_perms.issubset(perm_codes),
             f"差分: {expected_perms - perm_codes}")

        # 3. legal_admin に contract.* の5権限がすべて紐付いている
        cur.execute(
            """SELECT p.code FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
               WHERE r.code = 'legal_admin'"""
        )
        legal_admin_perms = {r["code"] for r in cur.fetchall()}
        r.ok("legal_admin に contract.* の5権限がすべて紐付いている",
             expected_perms.issubset(legal_admin_perms))

        # 4. legal_viewer は contract.view のみを持ち、作成・承認権限を持たない
        cur.execute(
            """SELECT p.code FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
               WHERE r.code = 'legal_viewer'"""
        )
        legal_viewer_perms = {r["code"] for r in cur.fetchall()}
        r.ok("legal_viewer は contract.view のみを持ち作成・承認権限を持たない",
             legal_viewer_perms == {'contract.view'})

        # 5. 既存ロールへの契約権限付与スコープ検証 (MAJOR-01 方針a)
        # owner: 全契約権限
        cur.execute(
            """SELECT p.code FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
               WHERE r.code = 'owner' AND p.code LIKE 'contract.%'"""
        )
        owner_contract_perms = {r["code"] for r in cur.fetchall()}
        r.ok("owner に契約権限がすべて付与されている",
             expected_perms.issubset(owner_contract_perms))

        # approver: 閲覧・承認権限 (作成・編集・解約は不可)
        cur.execute(
            """SELECT p.code FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
               WHERE r.code = 'approver' AND p.code LIKE 'contract.%'"""
        )
        approver_contract_perms = {r["code"] for r in cur.fetchall()}
        r.ok("approver は contract.view, contract.approve のみ保持する",
             approver_contract_perms == {'contract.view', 'contract.approve'})

        # accountant / accounting_manager: 閲覧のみ
        cur.execute(
            """SELECT p.code FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
               WHERE r.code IN ('accountant', 'accounting_manager') AND p.code LIKE 'contract.%'"""
        )
        acct_contract_perms = {r["code"] for r in cur.fetchall()}
        r.ok("accountant / accounting_manager は contract.view のみ保持する",
             acct_contract_perms == {'contract.view'})

        # employee / payroll_admin / viewer_external: 契約権限なし (fail-closed)
        cur.execute(
            """SELECT p.code FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
               WHERE r.code IN ('employee', 'payroll_admin', 'viewer_external') AND p.code LIKE 'contract.%'"""
        )
        no_perm_rows = cur.fetchall()
        r.ok("employee / payroll_admin / viewer_external には契約権限が付与されない (fail-closed)",
             len(no_perm_rows) == 0)

    return r.summary()


# ----------------------------------------------------------------------------
# エントリポイント
# ----------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dsn", help="接続先PostgreSQLのDSN。--use-docker指定時は不要")
    parser.add_argument("--use-docker", action="store_true",
                         help="使い捨てのDocker PostgreSQL16コンテナを起動して検証する")
    parser.add_argument("--keep-docker", action="store_true",
                         help="検証後もDockerコンテナを削除せず残す(--use-docker併用時)")
    args = parser.parse_args()

    if not args.use_docker and not args.dsn:
        parser.error("--dsn または --use-docker のいずれかを指定してください")

    dsn = None
    try:
        if args.use_docker:
            dsn = docker_start()
        else:
            dsn = args.dsn

        apply_schema(dsn)
        exit_code = run_verification(dsn)
    finally:
        if args.use_docker and not args.keep_docker:
            docker_stop()

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
