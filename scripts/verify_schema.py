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
import os
import subprocess
import sys
import threading
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
REPO_ROOT = SCRIPT_DIR.parent
SQL_DIR = REPO_ROOT / "sql"

DOCKER_CONTAINER_NAME = "keiri_kaikei_verify_pg"
DOCKER_IMAGE = "pgvector/pgvector:pg16"
DOCKER_PORT = int(os.environ.get("VERIFY_DOCKER_PORT", "54320"))
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

def apply_single_sql(conn, sql_file: Path) -> None:
    sql = sql_file.read_text(encoding="utf-8")
    print(f"[schema] {sql_file.name} を適用中 ({len(sql):,} bytes)...")
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
    except psycopg2.errors.UnsafeNewEnumValueUsage:
        # ENUM追加直後に同一ファイル内で使用されている場合、ステートメントごとに分割実行
        statements = [s.strip() for s in sql.split(";") if s.strip()]
        for stmt in statements:
            with conn.cursor() as cur:
                cur.execute(stmt)


def apply_schema(dsn: str, max_file: str | None = None) -> None:
    if not SQL_DIR.exists():
        raise FileNotFoundError(f"SQLディレクトリが見つかりません: {SQL_DIR}")
    sql_files = sorted(
        [f for f in SQL_DIR.iterdir() if f.suffix == ".sql"],
        key=lambda p: p.name,
    )
    if max_file:
        sql_files = [f for f in sql_files if f.name <= max_file]
    if not sql_files:
        raise FileNotFoundError(f"SQLファイルが見つかりません: {SQL_DIR}")

    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        for sql_file in sql_files:
            apply_single_sql(conn, sql_file)
        print("[schema] マイグレーション適用完了")
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
        contract_target_id2 = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps)
               VALUES (%s, 'contract', %s, %s, 1) RETURNING id""",
            (t1, contract_target_id2, owner),
        )
        contract_ar_id2 = cur.fetchone()["id"]
        cur.execute(
            """INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action)
               VALUES (%s, %s, 1, %s, 'approve')""",
            (t1, contract_ar_id2, approver),
        )
    r.ok("新target_type(contract)で別ユーザーによる承認は成功する", True)

    with tx_as(dsn, role="app_runtime", tenant_id=t2) as cur:
        cur.execute("SELECT * FROM approval_requests WHERE id = %s", (contract_ar_id2,))
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
               WHERE r.code = 'legal_viewer' AND p.code LIKE 'contract.%'"""
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

    # ------------------------------------------------------------------
    print("\n--- 8. contracts: 契約書管理テーブル (Phase 1 P1-T1) ---")
    c1_id = str(uuid.uuid4())
    c_nda_id = str(uuid.uuid4())

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        # 1. draft 契約書の正常作成 (金額あり・期間あり・添付紐付け)
        cur.execute(
            """INSERT INTO contracts (
                 id, tenant_id, contract_no, title, counterparty_name, contract_type,
                 contract_amount, currency, start_date, end_date, auto_renewal,
                 renewal_notice_days, status, attachment_id, created_by
               ) VALUES (
                 %s, %s, 'CNT-2026-0001', '業務委託契約書', 'テスト株式会社', 'outsourcing',
                 500000.00, 'JPY', '2026-04-01', '2027-03-31', TRUE,
                 30, 'draft', %s, %s
               )
               RETURNING status, contract_amount, auto_renewal""",
            (c1_id, t1, att2_id, owner),
        )
        c1_row = cur.fetchone()
        r.ok("contracts に draft 契約書 (金額あり・期間あり) が正常作成できる",
             c1_row["status"] == "draft" and float(c1_row["contract_amount"]) == 500000.00 and c1_row["auto_renewal"])

        # 2. 金額なし契約 (NDA等) の登録 (contract_amount NULL, end_date NULL 許容, attachment_id NULLスキップ検証)
        cur.execute(
            """INSERT INTO contracts (
                 id, tenant_id, contract_no, title, counterparty_name, contract_type,
                 contract_amount, currency, start_date, end_date, auto_renewal,
                 attachment_id, created_by
               ) VALUES (
                 %s, %s, 'CNT-2026-0002', '秘密保持契約書(NDA)', '提携先株式会社', 'nda',
                 NULL, 'JPY', '2026-04-01', NULL, FALSE,
                 NULL, %s
               )
               RETURNING status, contract_amount, end_date, attachment_id""",
            (c_nda_id, t1, owner),
        )
        c_nda_row = cur.fetchone()
        r.ok("contracts に金額なし・終了日なし契約(NDA)が登録できる(attachment_id NULLスキップ)",
             c_nda_row["contract_amount"] is None and c_nda_row["end_date"] is None and c_nda_row["attachment_id"] is None)

    # 3. テナント整合性ガードトリガー検証 (MAJOR-02)
    # 3.1 他テナントの attachment_id を指定した contracts INSERT はトリガーで拒否される
    cross_att_blocked = False
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t2) as cur:
            # att2_id は t1 の添付ファイル
            cur.execute(
                """INSERT INTO contracts (
                     tenant_id, contract_no, title, counterparty_name, contract_type,
                     start_date, attachment_id, created_by
                   ) VALUES (
                     %s, 'CNT-CROSS-ATT', '不正添付契約', '相手先', 'other',
                     '2026-04-01', %s, %s
                   )""",
                (t2, att2_id, owner),
            )
    except Exception as e:  # noqa: BLE001
        cross_att_blocked = "attachment" in str(e).lower() or "does not belong" in str(e).lower() or "23503" in str(e)
    r.ok("他テナントの attachment_id を指定した contracts INSERT はDBトリガーで拒否される (MAJOR-02)", cross_att_blocked)

    # 3.2 他テナントのユーザー (tenant_users未登録) を created_by に指定した contracts INSERT は拒否される
    cross_user_blocked = False
    random_user_id = str(uuid.uuid4())
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                """INSERT INTO contracts (
                     tenant_id, contract_no, title, counterparty_name, contract_type,
                     start_date, created_by
                   ) VALUES (
                     %s, 'CNT-CROSS-USER', '不正ユーザー契約', '相手先', 'other',
                     '2026-04-01', %s
                   )""",
                (t1, random_user_id),
            )
    except Exception as e:  # noqa: BLE001
        cross_user_blocked = "not a member" in str(e).lower() or "created_by" in str(e).lower() or "23503" in str(e)
    r.ok("所属外ユーザーを created_by に指定した contracts INSERT はDBトリガーで拒否される (MAJOR-02)", cross_user_blocked)

    # 4. 不正な contract_type は CHECK 制約で拒否される
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                """INSERT INTO contracts (
                     tenant_id, contract_no, title, counterparty_name, contract_type,
                     start_date, created_by
                   ) VALUES (
                     %s, 'CNT-2026-INVALID', '不正契約', '相手先', 'invalid_contract_type',
                     '2026-04-01', %s
                   )""",
                (t1, owner),
            )
        r.ok("不正な contract_type は CHECK 制約で拒否される", False, "例外が発生しなかった")
    except Exception as e:  # noqa: BLE001
        r.ok("不正な contract_type は CHECK 制約で拒否される",
             "check constraint" in str(e).lower() or "contracts_contract_type_check" in str(e))

    # 5. RLS テナント分離: 他テナントから contracts が一切見えないこと
    with tx_as(dsn, role="app_runtime", tenant_id=t2) as cur:
        cur.execute("SELECT * FROM contracts WHERE id = %s", (c1_id,))
        r.ok("他テナントから contracts が一切見えない(RLS)", len(cur.fetchall()) == 0)

    # 6. 明示的自動承認 vs 未設定の区別 (MAJOR-01)
    # 6.1 承認ルール未設定のテナント(t2)では contract 承認ルールが0件であり、自動activeにしてはならない
    with tx_as(dsn, role="app_runtime", tenant_id=t2) as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM approval_rules WHERE tenant_id = %s AND target_type = 'contract'", (t2,))
        t2_rule_cnt = cur.fetchone()["cnt"]
        r.ok("承認ルール未設定のテナントでは contract ルール件数が 0 件 (未設定検出可能)", t2_rule_cnt == 0)

    # 6.2 t1 において明示的0-step自動承認ルール (is_explicit_auto_approve=TRUE) が登録できる
    # (DEBT-006: 混在防止のため、既存通常ルールを一旦削除して登録)
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("DELETE FROM approval_rules WHERE tenant_id = %s AND target_type = 'contract'", (t1,))
        cur.execute(
            """INSERT INTO approval_rules (tenant_id, target_type, step_number, is_explicit_auto_approve, condition)
               VALUES (%s, 'contract', 0, TRUE, '{}')
               RETURNING is_explicit_auto_approve, step_number""",
            (t1,),
        )
        cur.execute(
            "SELECT is_explicit_auto_approve, step_number FROM approval_rules WHERE tenant_id = %s AND target_type = 'contract' AND is_explicit_auto_approve = TRUE",
            (t1,),
        )
        auto_rule = cur.fetchone()
        r.ok("approval_rules に明示的自動承認ルール(is_explicit_auto_approve=TRUE, step_number=0)が登録できる (MAJOR-01)",
             auto_rule is not None and auto_rule["is_explicit_auto_approve"] is True and auto_rule["step_number"] == 0)

    # 6.3 1人テナント運用: 明示的自動承認ルールにより active 化
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """UPDATE contracts
               SET status = 'active', approved_at = now()
               WHERE id = %s RETURNING status, approved_at""",
            (c_nda_id,),
        )
        c_nda_active = cur.fetchone()
        r.ok("1人テナント運用: 明示的自動承認により active 化が成功する",
             c_nda_active["status"] == "active" and c_nda_active["approved_at"] is not None)

    # 7. 多段階承認フロー: draft → pending_approval → 別ユーザー承認で active
    # (DEBT-006: 自動承認ルールを通常ルールへ切り替え)
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("DELETE FROM approval_rules WHERE tenant_id = %s AND target_type = 'contract'", (t1,))
        cur.execute(
            """INSERT INTO approval_rules (tenant_id, target_type, step_number, approver_user_id, is_active)
               VALUES (%s, 'contract', 1, %s, TRUE)""",
            (t1, approver),
        )
        # draft → pending_approval
        cur.execute("UPDATE contracts SET status = 'pending_approval' WHERE id = %s RETURNING status", (c1_id,))
        c1_pending = cur.fetchone()
        r.ok("契約書の承認申請 (draft → pending_approval) が成功する", c1_pending["status"] == "pending_approval")

        # approval_requests 起票 (申請者: owner)
        cur.execute(
            """INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps)
               VALUES (%s, 'contract', %s, %s, 1) RETURNING id""",
            (t1, c1_id, owner),
        )
        contract_wf_ar_id = cur.fetchone()["id"]

        # 職務分掌(SoD): 申請者本人による自己承認は DB トリガーで拒否される
        self_approval_blocked = False
        try:
            cur.execute(
                """INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action)
                   VALUES (%s, %s, 1, %s, 'approve')""",
                (t1, contract_wf_ar_id, owner),
            )
        except Exception as e:  # noqa: BLE001
            self_approval_blocked = "self-approval" in str(e)
            cur.connection.rollback()
        r.ok("contracts 承認でも自己承認は拒否される (SoD)", self_approval_blocked)

    # 別ユーザー (approver) による承認完了 → contracts が active に更新
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps)
               VALUES (%s, 'contract', %s, %s, 1)
               ON CONFLICT (target_type, target_id) DO NOTHING RETURNING id""",
            (t1, c1_id, owner),
        )
        cur.execute("SELECT id FROM approval_requests WHERE target_type = 'contract' AND target_id = %s", (c1_id,))
        contract_wf_ar_id2 = cur.fetchone()["id"]

        cur.execute(
            """INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action)
               VALUES (%s, %s, 1, %s, 'approve')""",
            (t1, contract_wf_ar_id2, approver),
        )
        cur.execute(
            "UPDATE contracts SET status = 'active', approved_at = now() WHERE id = %s RETURNING status",
            (c1_id,),
        )
        c1_active_row = cur.fetchone()
        r.ok("別ユーザー承認により contracts が active に遷移する", c1_active_row["status"] == "active")

    # 8. 改ざん防止トリガー: active 化後の重要列 (contract_amount) 改ざんが拒否される
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                "UPDATE contracts SET contract_amount = 9999999.00 WHERE id = %s",
                (c1_id,),
            )
        r.ok("active 契約の金額直接変更はトリガーで拒否される", False, "例外が発生しなかった")
    except Exception as e:  # noqa: BLE001
        r.ok("active 契約の金額直接変更はトリガーで拒否される",
             "immutable" in str(e).lower() or "23001" in str(e), str(e))

    # 9. 物理削除制限: active 契約の DELETE は拒否され、draft 契約のみ削除できる
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute("DELETE FROM contracts WHERE id = %s", (c1_id,))
        r.ok("active 契約の物理削除はトリガーで拒否される", False, "例外が発生しなかった")
    except Exception as e:  # noqa: BLE001
        r.ok("active 契約の物理削除はトリガーで拒否される",
             "cannot be physically deleted" in str(e) or "23001" in str(e), str(e))

    # draft 契約の作成と削除
    draft_temp_id = str(uuid.uuid4())
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO contracts (
                 id, tenant_id, contract_no, title, counterparty_name, contract_type,
                 start_date, status, created_by
               ) VALUES (
                 %s, %s, 'CNT-2026-TEMP', '一時契約', '相手先', 'other',
                 '2026-04-01', 'draft', %s
               )""",
            (draft_temp_id, t1, owner),
        )
        cur.execute("DELETE FROM contracts WHERE id = %s", (draft_temp_id,))
        cur.execute("SELECT * FROM contracts WHERE id = %s", (draft_temp_id,))
        r.ok("draft 契約の物理削除は許可される", len(cur.fetchall()) == 0)

    # ------------------------------------------------------------------
    print("\n--- 9. AI条項抽出 (P1-T2: DEBT-002, DEBT-003, 契約書アップロード〜AI抽出〜確定) ---")

    # 1. DEBT-002: confidence_score が範囲外 (1.5, -0.3) の場合は DB 制約で弾かれる
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                """INSERT INTO ai_suggestions (
                     tenant_id, target_type, target_id, suggestion_type,
                     payload, confidence_score, model_name
                   ) VALUES (
                     %s, 'contract', %s, 'contract_terms',
                     '{"document_type":"contract"}'::jsonb, 1.5, 'test-model'
                   )""",
                (t1, str(uuid.uuid4())),
            )
        r.ok("confidence_score > 1.0 (1.5) の保存は拒否される (DEBT-002)", False, "例外が発生しなかった")
    except Exception as e:
        r.ok("confidence_score > 1.0 (1.5) の保存は拒否される (DEBT-002)",
             "check constraint" in str(e).lower() or "ai_suggestions_confidence_score_check" in str(e).lower() or "23514" in str(e), str(e))

    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                """INSERT INTO ai_suggestions (
                     tenant_id, target_type, target_id, suggestion_type,
                     payload, confidence_score, model_name
                   ) VALUES (
                     %s, 'contract', %s, 'contract_terms',
                     '{"document_type":"contract"}'::jsonb, -0.3, 'test-model'
                   )""",
                (t1, str(uuid.uuid4())),
            )
        r.ok("confidence_score < 0.0 (-0.3) の保存は拒否される (DEBT-002)", False, "例外が発生しなかった")
    except Exception as e:
        r.ok("confidence_score < 0.0 (-0.3) の保存は拒否される (DEBT-002)",
             "check constraint" in str(e).lower() or "ai_suggestions_confidence_score_check" in str(e).lower() or "23514" in str(e), str(e))

    # 2. DEBT-003: 契約書提案の model_name='contract-extractor-v1' で正常保存できる
    att_contract_id = str(uuid.uuid4())
    sug_contract_id = str(uuid.uuid4())
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        # 契約書添付ファイル登録 (document_category='contract')
        cur.execute(
            """INSERT INTO attachments (
                 id, tenant_id, file_name, mime_type, file_hash, storage_path, document_category, uploaded_by
               ) VALUES (
                 %s, %s, 'nda_sample.pdf', 'application/pdf', 'dummy_hash_nda', '/contracts/nda.pdf', 'contract', %s
               )""",
            (att_contract_id, t1, owner),
        )
        # AI条項抽出提案の隔離保存 (target_id=attachment_id, target_type='attachment', model_name='contract-extractor-v1', provider='rule_engine')
        cur.execute(
            """INSERT INTO ai_suggestions (
                 id, tenant_id, target_type, target_id, suggestion_type,
                 payload, confidence_score, model_name, provider
               ) VALUES (
                 %s, %s, 'attachment', %s, 'contract_terms',
                 %s::jsonb, 0.92, 'contract-extractor-v1', 'rule_engine'
               ) RETURNING id, model_name, provider, confidence_score""",
            (
                sug_contract_id,
                t1,
                att_contract_id,
                '{"document_type":"contract","suggested_fields":{"contract_title":{"value":"秘密保持契約書","confidence":0.95}}}',
            ),
        )
        saved_sug = cur.fetchone()
        r.ok("契約書提案の model_name が contract-extractor-v1 として保存される (DEBT-003)",
             saved_sug["model_name"] == "contract-extractor-v1")
        r.ok("契約書提案の provider が rule_engine として保存される (MINOR-01)",
             saved_sug["provider"] == "rule_engine")
        r.ok("契約書提案の confidence_score が 0〜1 範囲内で保存される",
             float(saved_sug["confidence_score"]) == 0.92)

    # 3. AI提案の隔離遵守: ai_suggestions に保存された段階では contracts テーブルに何も書かれていない
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("SELECT * FROM contracts WHERE attachment_id = %s", (att_contract_id,))
        r.ok("AI提案隔離原則: contracts テーブルへの自動書き込みは行われない", len(cur.fetchall()) == 0)

    # 4. 人間確認後の確定操作: Core API / INSERT 経由で contracts(draft) が作成される
    e2e_contract_id = str(uuid.uuid4())
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO contracts (
                 id, tenant_id, contract_no, title, counterparty_name, contract_type,
                 contract_amount, start_date, end_date, auto_renewal, attachment_id,
                 status, created_by
               ) VALUES (
                 %s, %s, 'CNT-2026-E2E1', '秘密保持契約書', 'テスト株式会社', 'nda',
                 0, '2026-04-01', '2027-03-31', true, %s,
                 'draft', %s
               ) RETURNING id, contract_no, status, title""",
            (e2e_contract_id, t1, att_contract_id, owner),
        )
        created_contract = cur.fetchone()
        r.ok("人間確認後に contracts(draft) が attachment_id 紐付けで正常作成される",
             created_contract["status"] == "draft" and created_contract["title"] == "秘密保持契約書")

    # 5. 後方互換性: 既存のレシートOCR AI提案 (suggestion_type='ocr') が正常に動作すること
    ocr_sug_id = str(uuid.uuid4())
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO ai_suggestions (
                 id, tenant_id, target_type, target_id, suggestion_type,
                 payload, confidence_score, model_name, provider
               ) VALUES (
                 %s, %s, 'expense_report', %s, 'ocr',
                 '{"suggested_account_code":"5000"}'::jsonb, 0.88, 'receipt-ocr-v1', 'rule_engine'
               ) RETURNING id""",
            (ocr_sug_id, t1, str(uuid.uuid4())),
        )
        r.ok("既存のレシートOCR提案フローに回帰がないこと", cur.fetchone() is not None)

    # 6. 【P1-T2-FIX実証】実PDF本文読込〜内容依存条項抽出 E2Eテスト (BLOCKER-01解消の完全証明)
    backend_dir = os.path.join(REPO_ROOT, "backend")
    cmd = f"npx ts-node src/scripts/verify-contract-pdf-e2e.ts \"{dsn}\""
    e2e_run = subprocess.run(cmd, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if e2e_run.returncode != 0:
        err_msg = f"\n[E2E ERROR STDOUT]:\n{e2e_run.stdout}\n[E2E ERROR STDERR]:\n{e2e_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    r.ok("実PDFアップロード〜AI条項抽出E2E: PDF内容依存性(金額別抽出)と白紙PDFエラーハンドリングが動作する (BLOCKER-01)",
         e2e_run.returncode == 0)

    # ------------------------------------------------------------------------
    # 10. 契約RBAC強制・AI提案ライフサイクル正式化 (Phase 1: P1-T3, DEBT-005, DEBT-006)
    # ------------------------------------------------------------------------
    print("\n--- 10. 契約RBAC強制・AI提案ライフサイクル正式化 (P1-T3: DEBT-005, DEBT-006) ---")

    # 1. contracts.source_suggestion_id 列の確認
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """SELECT column_name, data_type
               FROM information_schema.columns
               WHERE table_name = 'contracts' AND column_name = 'source_suggestion_id'"""
        )
        col = cur.fetchone()
        r.ok("contracts テーブルに source_suggestion_id 列が存在する", col is not None)

    # 2. ai_suggestions の既存データマイグレーション確認 (target_type='attachment')
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """SELECT COUNT(*) AS cnt
               FROM ai_suggestions
               WHERE suggestion_type = 'contract_terms' AND target_type = 'contract'"""
        )
        cnt = cur.fetchone()["cnt"]
        r.ok("契約書提案の target_type が 'attachment' に統一されている (0件の旧データ残存)", cnt == 0)

    # 3. DEBT-006: approval_rules 自動承認混在防止トリガー (自動承認存在時の通常追加拒否)
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("DELETE FROM approval_rules WHERE tenant_id = %s AND target_type = 'contract'", (t1,))
        auto_rule_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO approval_rules (id, tenant_id, target_type, step_number, is_explicit_auto_approve, is_active)
               VALUES (%s, %s, 'contract', 0, TRUE, TRUE)""",
            (auto_rule_id, t1),
        )
        # 通常ルール (step 1) の追加を試行
        normal_rule_id = str(uuid.uuid4())
        blocked = False
        try:
            cur.execute(
                """INSERT INTO approval_rules (id, tenant_id, target_type, step_number, approver_user_id, is_explicit_auto_approve, is_active)
                   VALUES (%s, %s, 'contract', 1, %s, FALSE, TRUE)""",
                (normal_rule_id, t1, owner),
            )
        except psycopg2.errors.CheckViolation:
            blocked = True
        r.ok("自動承認ルール存在時の通常ルール追加は DB トリガーで拒否される (DEBT-006)", blocked)

    # 4. DEBT-006: approval_rules 自動承認混在防止トリガー (通常ルール存在時の自動承認追加拒否)
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("DELETE FROM approval_rules WHERE tenant_id = %s AND target_type = 'contract'", (t1,))
        normal_rule_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO approval_rules (id, tenant_id, target_type, step_number, approver_user_id, is_explicit_auto_approve, is_active)
               VALUES (%s, %s, 'contract', 1, %s, FALSE, TRUE)""",
            (normal_rule_id, t1, owner),
        )
        # 自動承認ルール (step 0) の追加を試行
        auto_rule_id = str(uuid.uuid4())
        blocked = False
        try:
            cur.execute(
                """INSERT INTO approval_rules (id, tenant_id, target_type, step_number, is_explicit_auto_approve, is_active)
                   VALUES (%s, %s, 'contract', 0, TRUE, TRUE)""",
                (auto_rule_id, t1),
            )
        except psycopg2.errors.CheckViolation:
            blocked = True
        r.ok("通常ルール存在時の自動承認ルール追加は DB トリガーで拒否される (DEBT-006)", blocked)

    # 5. BLOCKER-01: approval_rules 自動承認ルールと通常ルールの並行INSERT耐性テスト (advisory lock検証)
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("DELETE FROM approval_rules WHERE tenant_id = %s AND target_type = 'contract'", (t1,))

    concurrent_results = []
    barrier = threading.Barrier(2)

    def insert_auto_rule():
        conn = psycopg2.connect(dsn)
        try:
            with conn.cursor() as cur:
                cur.execute("SET ROLE app_runtime")
                cur.execute("SET app.current_tenant_id = %s", (t1,))
                barrier.wait()
                cur.execute(
                    """INSERT INTO approval_rules (id, tenant_id, target_type, step_number, is_explicit_auto_approve, is_active)
                       VALUES (%s, %s, 'contract', 0, TRUE, TRUE)""",
                    (str(uuid.uuid4()), t1),
                )
                time.sleep(0.05)
                conn.commit()
                concurrent_results.append(("auto", True, None))
        except Exception as e:
            conn.rollback()
            concurrent_results.append(("auto", False, getattr(e, "pgcode", str(e))))
        finally:
            conn.close()

    def insert_normal_rule():
        conn = psycopg2.connect(dsn)
        try:
            with conn.cursor() as cur:
                cur.execute("SET ROLE app_runtime")
                cur.execute("SET app.current_tenant_id = %s", (t1,))
                barrier.wait()
                cur.execute(
                    """INSERT INTO approval_rules (id, tenant_id, target_type, step_number, approver_user_id, is_explicit_auto_approve, is_active)
                       VALUES (%s, %s, 'contract', 1, %s, FALSE, TRUE)""",
                    (str(uuid.uuid4()), t1, owner),
                )
                time.sleep(0.05)
                conn.commit()
                concurrent_results.append(("normal", True, None))
        except Exception as e:
            conn.rollback()
            concurrent_results.append(("normal", False, getattr(e, "pgcode", str(e))))
        finally:
            conn.close()

    t_auto = threading.Thread(target=insert_auto_rule)
    t_normal = threading.Thread(target=insert_normal_rule)
    t_auto.start()
    t_normal.start()
    t_auto.join()
    t_normal.join()

    successes = [r for r in concurrent_results if r[1] is True]
    failures = [r for r in concurrent_results if r[1] is False]
    r.ok("並行INSERT耐性: 2トランザクション同時実行時、advisory lockにより一方のみ成功する (BLOCKER-01)",
         len(successes) == 1 and len(failures) == 1)
    r.ok("並行INSERT耐性: 競合したトランザクションが 23514 (check_violation) で拒否される (BLOCKER-01)",
         len(failures) == 1 and failures[0][2] == "23514")

    # 6. source_suggestion_id 紐付けでの契約書作成 (正常系)
    test_sug_id = str(uuid.uuid4())
    test_att_id = str(uuid.uuid4())
    test_contract_id = str(uuid.uuid4())
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO attachments (id, tenant_id, file_name, mime_type, file_hash, storage_path, document_category, uploaded_by)
               VALUES (%s, %s, 'test.pdf', 'application/pdf', 'hash1', '/tmp/test.pdf', 'contract', %s)""",
            (test_att_id, t1, owner),
        )
        cur.execute(
            """INSERT INTO ai_suggestions (id, tenant_id, target_type, target_id, suggestion_type, payload, confidence_score, model_name, provider)
               VALUES (%s, %s, 'attachment', %s, 'contract_terms', '{}'::jsonb, 0.9, 'contract-extractor-v1', 'rule_engine')""",
            (test_sug_id, t1, test_att_id),
        )
        cur.execute(
            """INSERT INTO contracts (
                 id, tenant_id, contract_no, title, counterparty_name, contract_type,
                 contract_amount, start_date, auto_renewal, attachment_id, source_suggestion_id,
                 status, created_by
               ) VALUES (
                 %s, %s, 'CNT-2026-T3E2E', 'ライフサイクル連携契約書', 'テスト株式会社', 'service',
                 500000, '2026-04-01', false, %s, %s,
                 'draft', %s
               ) RETURNING source_suggestion_id""",
            (test_contract_id, t1, test_att_id, test_sug_id, owner),
        )
        saved_c = cur.fetchone()
        r.ok("contracts に source_suggestion_id が正常に永続化される (来歴保持)",
             saved_c["source_suggestion_id"] == test_sug_id)

    # 7. BLOCKER-02: 他テナントの source_suggestion_id を指定した contracts INSERT は DB トリガーで拒否される
    cross_tenant_sug_id = str(uuid.uuid4())
    cross_tenant_att_id = str(uuid.uuid4())
    with tx_as(dsn, role="app_runtime", tenant_id=t2) as cur:
        cur.execute(
            """INSERT INTO attachments (id, tenant_id, file_name, mime_type, file_hash, storage_path, document_category, uploaded_by)
               VALUES (%s, %s, 't2_contract.pdf', 'application/pdf', 'hash_t2', '/tmp/t2.pdf', 'contract', %s)""",
            (cross_tenant_att_id, t2, approver),
        )
        cur.execute(
            """INSERT INTO ai_suggestions (id, tenant_id, target_type, target_id, suggestion_type, payload, confidence_score, model_name, provider)
               VALUES (%s, %s, 'attachment', %s, 'contract_terms', '{}'::jsonb, 0.9, 'contract-extractor-v1', 'rule_engine')""",
            (cross_tenant_sug_id, t2, cross_tenant_att_id),
        )

    # t1 の contract に対し、t2 の suggestion を指定して INSERT を試行
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cross_tenant_blocked = False
        try:
            cur.execute(
                """INSERT INTO contracts (
                     id, tenant_id, contract_no, title, counterparty_name, contract_type,
                     contract_amount, start_date, auto_renewal, source_suggestion_id,
                     status, created_by
                   ) VALUES (
                     %s, %s, 'CNT-CROSS-TEST', '不正越境契約書', 'テスト株式会社', 'service',
                     100000, '2026-04-01', false, %s,
                     'draft', %s
                   )""",
                (str(uuid.uuid4()), t1, cross_tenant_sug_id, owner),
            )
        except psycopg2.errors.ForeignKeyViolation as e:
            cross_tenant_blocked = "does not belong to tenant" in str(e)
        r.ok("他テナントの source_suggestion_id を指定した contracts INSERT は DB トリガーで拒否される (BLOCKER-02)",
             cross_tenant_blocked)

    # 8. 【P1-T3実証】PermissionsGuard RBAC認可強制・解約遷移 E2Eテスト (DEBT-005)
    # ※ 本 E2E は 016 スキーマ (extracted_text 列) を含む ContractsService を呼ぶため、016 適用後のセクション 13-9 で実行する

    # ------------------------------------------------------------------------
    # 11. 契約期限アラート・全テナント横断バッチ基盤 (Phase 1: P1-T4)
    # ------------------------------------------------------------------------
    print("\n--- 11. 契約期限アラート・全テナント横断バッチ基盤 (P1-T4) ---")

    # 1. notifications テーブル定義の確認
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """SELECT column_name, data_type
               FROM information_schema.columns
               WHERE table_name = 'notifications' AND column_name = 'status'"""
        )
        col = cur.fetchone()
        r.ok("notifications テーブルが存在し status 列を持つ", col is not None)

    # 2. notifications RLS 設定の確認 (fail-closed)
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        notif_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO notifications (id, tenant_id, type, target_type, target_id, title, body, status)
               VALUES (%s, %s, 'test_type', 'contract', %s, 'テスト通知', '本文', 'unread')""",
            (notif_id, t1, str(uuid.uuid4())),
        )

    # 他テナント(t2)からは見えないこと (RLS)
    with tx_as(dsn, role="app_runtime", tenant_id=t2) as cur:
        cur.execute("SELECT id FROM notifications WHERE id = %s", (notif_id,))
        r.ok("他テナントの notifications は見えない (RLS完全分離)", cur.fetchone() is None)

    # 3. 未読重複防止用部分ユニークインデックスの確認 (同一未読のINSERT拒否)
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        target_contract_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO notifications (id, tenant_id, type, target_type, target_id, title, body, status)
               VALUES (%s, %s, 'contract_expiry', 'contract', %s, '通知1', '本文1', 'unread')""",
            (str(uuid.uuid4()), t1, target_contract_id),
        )
        duplicate_blocked = False
        try:
            cur.execute(
                """INSERT INTO notifications (id, tenant_id, type, target_type, target_id, title, body, status)
                   VALUES (%s, %s, 'contract_expiry', 'contract', %s, '通知2', '本文2', 'unread')""",
                (str(uuid.uuid4()), t1, target_contract_id),
            )
        except psycopg2.errors.UniqueViolation:
            duplicate_blocked = True
        r.ok("同一契約・同一種別の未読通知重複INSERTは部分ユニークインデックスで拒否される (多層重複防止)", duplicate_blocked)

    # 4. RBAC: notification.batch_execute 権限の存在と owner 限定割当の確認 (P1-T4-FIX)
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("SELECT id FROM permissions WHERE code = 'notification.batch_execute'")
        r.ok("notification.batch_execute パーミッションが登録されている (P1-T4-FIX)", cur.fetchone() is not None)

        cur.execute(
            """SELECT r.code
               FROM roles r
               JOIN role_permissions rp ON r.id = rp.role_id
               JOIN permissions p ON rp.permission_id = p.id
               WHERE p.code = 'notification.batch_execute'"""
        )
        assigned_roles = [row["code"] for row in cur.fetchall()]
        r.ok("notification.batch_execute は owner ロールにのみ割り当てられている (P1-T4-FIX)",
             assigned_roles == ["owner"])

    # 5. 【P1-T4実証】契約期限アラート・全テナント横断バッチ E2Eテスト (認可・情報漏洩防止含む)
    cmd_batch = f"npx ts-node src/scripts/verify-contract-expiry-alerts-e2e.ts \"{dsn}\""
    batch_run = subprocess.run(cmd_batch, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if batch_run.returncode != 0:
        err_msg = f"\n[BATCH E2E ERROR STDOUT]:\n{batch_run.stdout}\n[BATCH E2E ERROR STDERR]:\n{batch_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    r.ok("契約期限アラートE2E: 全テナント横断バッチ(RLS非バイパス)・認可強制(403)・情報秘匿化・auto_renewal文面分岐・未読重複防止・既読化・障害隔離が動作する (P1-T4-FIX)",
         batch_run.returncode == 0)

    # ------------------------------------------------------------------------
    # 12. 汎用稟議申請・ワークフロー起票 (Phase 1: P1-T5)
    # ------------------------------------------------------------------------
    print("\n--- 12. 汎用稟議申請・ワークフロー起票 (P1-T5) ---")

    # 1. general_requests テーブルとカラムの存在確認
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """SELECT column_name, data_type
               FROM information_schema.columns
               WHERE table_name = 'general_requests' AND column_name IN ('request_no', 'category', 'status', 'attachment_id', 'created_by')"""
        )
        cols = {row["column_name"] for row in cur.fetchall()}
        r.ok("general_requests テーブルに必要なカラム群が存在する",
             {'request_no', 'category', 'status', 'attachment_id', 'created_by'}.issubset(cols))

    # 2. general_requests RLS (ENABLE + FORCE) の確認
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """SELECT relrowsecurity, relforcerowsecurity
               FROM pg_class
               WHERE relname = 'general_requests'"""
        )
        row = cur.fetchone()
        r.ok("general_requests テーブルで RLS が ENABLE かつ FORCE されている",
             row is not None and row["relrowsecurity"] and row["relforcerowsecurity"])

    # 3. approval_rules / approval_requests の target_type に 'general_request' が許可され、無効な値は拒否されること
    test_rule_id = str(uuid.uuid4())
    test_req_id = str(uuid.uuid4())
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO approval_rules (id, tenant_id, target_type, step_number, approver_user_id, is_active)
               VALUES (%s, %s, 'general_request', 99, %s, TRUE)""",
            (test_rule_id, t1, approver),
        )
        cur.execute(
            """INSERT INTO approval_requests (id, tenant_id, target_type, target_id, submitted_by, total_steps)
               VALUES (%s, %s, 'general_request', %s, %s, 1)""",
            (test_req_id, t1, str(uuid.uuid4()), owner),
        )

    invalid_blocked = False
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                """INSERT INTO approval_rules (tenant_id, target_type, step_number, approver_user_id, is_active)
                   VALUES (%s, 'invalid_target', 1, %s, TRUE)""",
                (t1, approver),
            )
    except psycopg2.errors.CheckViolation:
        invalid_blocked = True

    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("DELETE FROM approval_requests WHERE id = %s", (test_req_id,))
        cur.execute("DELETE FROM approval_rules WHERE id = %s", (test_rule_id,))

    r.ok("approval_rules / approval_requests の target_type に 'general_request' が追加され有効に機能する",
         invalid_blocked)

    # 4. 【P1-T5-FIX3実証】段階的アップグレード & fail-closed検証 (014旧状態 -> 違反時エラー停止 -> 015正常適用 -> 制約機能 -> 冪等性)
    # 4-1. 014適用直後(旧状態): amount = -1 の INSERT が成功すること (制約未適用状態の再現確認)
    upgrade_pre_check = False
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                """INSERT INTO general_requests (tenant_id, request_no, title, description, category, amount, status, created_by)
                   VALUES (%s, 'REQ-PRE-001', '制約前負金額テスト', '説明', 'general', -1, 'draft', %s)
                   RETURNING id""",
                (t1, owner),
            )
            pre_row = cur.fetchone()
            cur.execute("DELETE FROM general_requests WHERE id = %s", (pre_row["id"],))
            upgrade_pre_check = True
    except Exception as e:
        print(f"014状態再現エラー: {e}")
        upgrade_pre_check = False
    r.ok("段階的アップグレード検証 1: 014適用直後(旧状態)は amount = -1 の INSERT が成功する (未制約状態の再現確認)",
         upgrade_pre_check)

    # 4-2. 【P1-T5-FIX3】違反データ存在時に015を適用すると fail-closed (RAISE EXCEPTION) で停止し、
    #      かつデータが一切書き換えられていないことの検証
    fail_closed_stopped = False
    data_intact = False
    constraint_not_applied = False
    migration_015_path = SQL_DIR / "015_general_request_constraints.sql"

    # 違反データを意図的に投入 (負の金額 & 無効なcategory)
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO general_requests (tenant_id, request_no, title, description, category, amount, status, created_by)
               VALUES (%s, 'REQ-VIOLATE-001', '違反データ金額', '説明', 'general', -500, 'draft', %s),
                      (%s, 'REQ-VIOLATE-002', '違反データ区分', '説明', 'unauthorized_category', 1000, 'draft', %s)""",
            (t1, owner, t1, owner),
        )

    # 違反データがある状態で 015 を適用 -> RAISE EXCEPTION で失敗することを確認
    conn_fail_test = psycopg2.connect(dsn)
    try:
        apply_single_sql(conn_fail_test, migration_015_path)
    except Exception as e:
        if "manual remediation required" in str(e):
            fail_closed_stopped = True
    finally:
        conn_fail_test.close()

    # 停止後、既存データが無断改変 (自動クレンジング) されていないことを検証
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute("SELECT amount FROM general_requests WHERE request_no = 'REQ-VIOLATE-001'")
        row_amount = cur.fetchone()
        cur.execute("SELECT category FROM general_requests WHERE request_no = 'REQ-VIOLATE-002'")
        row_category = cur.fetchone()
        if (
            row_amount and float(row_amount["amount"]) == -500.0 and
            row_category and row_category["category"] == "unauthorized_category"
        ):
            data_intact = True

        # 制約が中途半端に追加されていないことも確認
        cur.execute(
            """SELECT 1 FROM pg_constraint
               WHERE conname IN ('ck_general_requests_amount_nonnegative', 'ck_general_requests_category')
                 AND conrelid = 'general_requests'::regclass"""
        )
        constraints_found = cur.fetchall()
        if len(constraints_found) == 0:
            constraint_not_applied = True

        # 手動修復に相当するクリーンアップ (テスト用違反データの削除)
        cur.execute("DELETE FROM general_requests WHERE request_no IN ('REQ-VIOLATE-001', 'REQ-VIOLATE-002')")

    r.ok("段階的アップグレード検証 2: 違反データ存在時は015がfail-closedでエラー停止し、元データが改変されず制約も未適用に保たれる (P1-T5-FIX3)",
         fail_closed_stopped and data_intact and constraint_not_applied)

    # 4-3. 違反データが存在しない状態で 015_general_request_constraints.sql を適用 (段階的アップグレード)
    conn_mig = psycopg2.connect(dsn)
    conn_mig.autocommit = True
    try:
        apply_single_sql(conn_mig, migration_015_path)
    finally:
        conn_mig.close()
    print("[schema] 015_general_request_constraints.sql 適用完了 (段階的アップグレード)")

    # 4-4. 015適用後: amount = -1 の直接 INSERT が CHECK 制約で拒否されること
    neg_amount_blocked = False
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                """INSERT INTO general_requests (tenant_id, request_no, title, description, category, amount, status, created_by)
                   VALUES (%s, 'REQ-CHECK-001', '負の金額テスト', 'テスト', 'general', -1, 'draft', %s)""",
                (t1, owner),
            )
    except psycopg2.errors.CheckViolation:
        neg_amount_blocked = True
    r.ok("段階的アップグレード検証 3: 015適用後 amount = -1 は非負CHECK制約で拒否される (BLOCKER-01)",
         neg_amount_blocked)

    # 4-5. 015適用後: 無効な category の直接 INSERT が CHECK 制約で拒否されること
    inv_category_blocked = False
    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
            cur.execute(
                """INSERT INTO general_requests (tenant_id, request_no, title, description, category, amount, status, created_by)
                   VALUES (%s, 'REQ-CHECK-002', '不正カテゴリテスト', 'テスト', 'invalid_cat', 1000, 'draft', %s)""",
                (t1, owner),
            )
    except psycopg2.errors.CheckViolation:
        inv_category_blocked = True
    r.ok("段階的アップグレード検証 4: 015適用後 無効な category は CHECK 制約で拒否される",
         inv_category_blocked)

    # 4-6. 015を2回連続適用してもエラーにならないこと (ALTER TABLE 冪等性・IF NOT EXISTS相当の確認)
    idempotent_ok = False
    try:
        conn_mig2 = psycopg2.connect(dsn)
        conn_mig2.autocommit = True
        apply_single_sql(conn_mig2, migration_015_path)
        conn_mig2.close()
        idempotent_ok = True
    except Exception as e:
        print(f"冪等性エラー: {e}")
        idempotent_ok = False
    r.ok("段階的アップグレード検証 5: 015を2回連続適用してもエラーにならず正常終了する (ALTER TABLE 冪等性保証)",
         idempotent_ok)

    # 4-7. 正常系: amount IS NULL または amount >= 0、有効なカテゴリが正常に INSERT できること
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """INSERT INTO general_requests (tenant_id, request_no, title, description, category, amount, status, created_by)
               VALUES (%s, 'REQ-CHECK-003', '正常申請', 'テスト', 'equipment', 50000, 'draft', %s)
               RETURNING id""",
            (t1, owner),
        )
        ok_req_id = cur.fetchone()["id"]
        cur.execute("DELETE FROM general_requests WHERE id = %s", (ok_req_id,))
    r.ok("general_requests は正の金額・有効カテゴリで正常に登録できる (正常系回帰なし)", True)

    # 5. RBAC: general_request.* パーミッションの登録と employee ロールへの付与確認
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        cur.execute(
            """SELECT code FROM permissions WHERE code LIKE 'general_request.%%' ORDER BY code"""
        )
        perms = [row["code"] for row in cur.fetchall()]
        r.ok("general_request.create/view/edit/approve パーミッションが登録されている",
             perms == ['general_request.approve', 'general_request.create', 'general_request.edit', 'general_request.view'])

        cur.execute(
            """SELECT p.code
               FROM roles r
               JOIN role_permissions rp ON r.id = rp.role_id
               JOIN permissions p ON rp.permission_id = p.id
               WHERE r.code = 'employee' AND p.code LIKE 'general_request.%%'
               ORDER BY p.code"""
        )
        emp_perms = [row["code"] for row in cur.fetchall()]
        r.ok("employee ロールに general_request.create, view, edit が付与されている (SoD維持)",
             emp_perms == ['general_request.create', 'general_request.edit', 'general_request.view'])

    # 5. 【P1-T5実証】汎用稟議実DB E2Eテスト (多段階承認・ルール未設定エラー・テナント整合性トリガー・改ざん防止・RLS分離)
    cmd_gr = f"npx ts-node src/scripts/verify-general-requests-e2e.ts \"{dsn}\""
    gr_run = subprocess.run(cmd_gr, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if gr_run.returncode != 0:
        err_msg = f"\n[GENERAL REQUESTS E2E ERROR STDOUT]:\n{gr_run.stdout}\n[GENERAL REQUESTS E2E ERROR STDERR]:\n{gr_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    r.ok("汎用稟議E2E: 一連の起票〜承認完了(active)・未設定時安全エラー・テナント整合性トリガー・active改ざん防止・RLS分離が動作する (P1-T5)",
         gr_run.returncode == 0)

    # =========================================================================
    # 13. 契約書全文検索基盤 (pgvector活用・P1-T6)
    # =========================================================================
    print("\n--- 13. 契約書全文検索基盤 (P1-T6) 検証 ---")

    # 13-1. 015適用時点では contracts.extracted_text 列および contract_embeddings テーブルが存在しないことを確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT column_name FROM information_schema.columns
               WHERE table_name = 'contracts' AND column_name = 'extracted_text'"""
        )
        col_before = cur.fetchone()
        cur.execute(
            """SELECT table_name FROM information_schema.tables
               WHERE table_name = 'contract_embeddings'"""
        )
        tbl_before = cur.fetchone()
    r.ok("段階的アップグレード検証 1: 015時点では contracts.extracted_text 列が存在しない", col_before is None)
    r.ok("段階的アップグレード検証 2: 015時点では contract_embeddings テーブルが存在しない", tbl_before is None)

    # 13-2. 016_contract_fulltext_search.sql を適用
    file_016 = SQL_DIR / "016_contract_fulltext_search.sql"
    sql_016 = file_016.read_text(encoding="utf-8")
    apply_ok_016 = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_016)
        finally:
            conn.close()
    except Exception as e:
        apply_ok_016 = False
        print(f"  [ERROR] 016 migration apply failed: {e}")
    r.ok("段階的アップグレード検証 3: 016_contract_fulltext_search.sql がエラーなく正常適用される", apply_ok_016)

    # 13-3. contracts.extracted_text 列の存在とデータ型確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT data_type FROM information_schema.columns
               WHERE table_name = 'contracts' AND column_name = 'extracted_text'"""
        )
        col_after = cur.fetchone()
    r.ok("contracts.extracted_text 列 (TEXT) が正常に追加されている",
         col_after is not None and col_after["data_type"] == "text")

    # 13-4. contract_embeddings テーブル定義・カラム・インデックス確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT table_name FROM information_schema.tables
               WHERE table_name = 'contract_embeddings'"""
        )
        tbl_after = cur.fetchone()

        cur.execute(
            """SELECT column_name, data_type, udt_name FROM information_schema.columns
               WHERE table_name = 'contract_embeddings'"""
        )
        emb_cols = {row["column_name"]: row["udt_name"] for row in cur.fetchall()}

        # ivfflat インデックス確認
        cur.execute(
            """SELECT indexname, indexdef FROM pg_indexes
               WHERE tablename = 'contract_embeddings' AND indexname = 'ix_contract_embeddings_ivfflat'"""
        )
        idx_row = cur.fetchone()
    r.ok("contract_embeddings テーブルが正常に作成されている", tbl_after is not None)
    r.ok("contract_embeddings.embedding が vector 型 (1536次元) として定義されている",
         emb_cols.get("embedding") == "vector")
    r.ok("contract_embeddings.embedding に ivfflat ベクトルインデックスが設定されている",
         idx_row is not None and "ivfflat" in idx_row["indexdef"])

    # 13-5. RLS (ENABLE + FORCE) & テナント分離ポリシー確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT relrowsecurity, relforcerowsecurity
               FROM pg_class WHERE relname = 'contract_embeddings'"""
        )
        rls_stat = cur.fetchone()
        cur.execute(
            """SELECT policyname FROM pg_policies
               WHERE tablename = 'contract_embeddings' AND policyname = 'contract_embeddings_tenant_isolation'"""
        )
        pol_stat = cur.fetchone()
    r.ok("contract_embeddings で RLS が有効化かつ FORCE されている (バイパス不可)",
         rls_stat is not None and rls_stat["relrowsecurity"] and rls_stat["relforcerowsecurity"])
    r.ok("contract_embeddings に tenant_isolation ポリシーが適用されている", pol_stat is not None)

    # 13-6. 冪等性保証: 016を2回連続適用してもエラーにならないこと
    idempotent_016_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_016)
        finally:
            conn.close()
    except Exception as e:
        idempotent_016_ok = False
        print(f"  [ERROR] 016 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 4: 016を2回連続適用してもエラーにならず正常終了する (ALTER TABLE / DDL 冪等性保証)",
         idempotent_016_ok)

    # 13-7. DB層テナント整合性トリガーの検証 (他テナントのcontract_id参照をINSERT時に即時拒否)
    trigger_rejected = False
    with tx_as(dsn, role="app_runtime", tenant_id=t1) as cur:
        # t1 の契約を作成
        cur.execute(
            """INSERT INTO contracts (tenant_id, contract_no, title, counterparty_name, contract_type, start_date, status, created_by)
               VALUES (%s, 'CNT-TRIG-001', 'T1契約', '相手先A', 'service', '2026-04-01', 'draft', %s)
               RETURNING id""",
            (t1, owner),
        )
        t1_contract_id = cur.fetchone()["id"]

    try:
        with tx_as(dsn, role="app_runtime", tenant_id=t2) as cur:
            dummy_vec = "[" + ",".join(["0.01"] * 1536) + "]"
            cur.execute(
                """INSERT INTO contract_embeddings (tenant_id, contract_id, chunk_index, chunk_text, embedding, model_name)
                   VALUES (%s, %s, 0, '不正な他テナント契約チャンク', %s::vector, 'pseudo-embed-v1')""",
                (t2, t1_contract_id, dummy_vec),
            )
    except Exception as e:
        trigger_rejected = True
        err_str = str(e)
        pgcode = getattr(e, "pgcode", "")
        r.ok("DB層テナント整合性トリガー: 他テナントのcontract_idを指定したembeddingのINSERTが拒否される (fail-closed保証)",
             pgcode == "23503" or "23503" in err_str or "belong" in err_str or "violates" in err_str.lower() or "不整合" in err_str)
    if not trigger_rejected:
        r.ok("DB層テナント整合性トリガー: 他テナントのcontract_idを指定したembeddingのINSERTが拒否される (fail-closed保証)", False)

    # 13-8. 【P1-T6実証】契約書全文検索 実DB E2Eテスト (テキスト抽出・embedding生成・類似探索・完全テナント分離・journal_entry回帰なし)
    cmd_cs = f"npx ts-node src/scripts/verify-contract-search-e2e.ts \"{dsn}\""
    cs_run = subprocess.run(cmd_cs, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if cs_run.returncode != 0:
        err_msg = f"\n[CONTRACT SEARCH E2E ERROR STDOUT]:\n{cs_run.stdout}\n[CONTRACT SEARCH E2E ERROR STDERR]:\n{cs_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    r.ok("契約書全文検索E2E: PDFテキスト抽出・embedding生成・類似条項探索・未確定契約除外・完全テナント分離・仕訳類似検索回帰なしが動作する (P1-T6/P1-T6-FIX)",
         cs_run.returncode == 0)

    # 13-9. 【P1-T3/P1-T6回帰なし実証】PermissionsGuard RBAC認可強制・解約遷移 E2Eテスト (DEBT-005回帰なし)
    cmd_rbac = f"npx ts-node src/scripts/verify-contract-rbac-e2e.ts \"{dsn}\""
    rbac_run = subprocess.run(cmd_rbac, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if rbac_run.returncode != 0:
        err_msg = f"\n[RBAC E2E ERROR STDOUT]:\n{rbac_run.stdout}\n[RBAC E2E ERROR STDERR]:\n{rbac_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    r.ok("契約RBAC強制E2E: legal_viewer書込拒否(403)・閲覧許可・承認権限検証・解約遷移が動作する (DEBT-005回帰なし)",
         rbac_run.returncode == 0)

    # ========================================================================
    # 14. 発注申請 (P2-T1) の検証 (purchase_requestsテーブル・RLS・CHECK制約・WORM・承認フロー・E2E)
    # ========================================================================
    print("\n--- 14. 発注申請 (P2-T1) の検証 ---")

    # 14-1. 017_purchase_requests.sql の段階的適用
    sql_017_path = SQL_DIR / "017_purchase_requests.sql"
    with open(sql_017_path, "r", encoding="utf-8") as f:
        sql_017 = f.read()

    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql_017)
    finally:
        conn.close()
    print("[schema] 017_purchase_requests.sql を適用しました")

    # 14-2. purchase_requests テーブル存在確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT EXISTS (
                   SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = 'purchase_requests'
               ) AS table_exists"""
        )
        pr_table_exists = cur.fetchone()["table_exists"]
    r.ok("purchase_requests テーブルが正常に作成されている", pr_table_exists)

    # 14-3. CHECK制約の確認 (chk_purchase_requests_quantity_positive, chk_purchase_requests_calc_match等)
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT conname FROM pg_constraint
               WHERE conrelid = 'purchase_requests'::regclass AND contype = 'c'"""
        )
        constraints = {row["conname"] for row in cur.fetchall()}
    r.ok("purchase_requests に数量正数CHECK制約 (chk_purchase_requests_quantity_positive) が存在する",
         "chk_purchase_requests_quantity_positive" in constraints)
    r.ok("purchase_requests に単価非負CHECK制約 (chk_purchase_requests_unit_price_nonneg) が存在する",
         "chk_purchase_requests_unit_price_nonneg" in constraints)
    r.ok("purchase_requests に合計金額非負CHECK制約 (chk_purchase_requests_total_amount_nonneg) が存在する",
         "chk_purchase_requests_total_amount_nonneg" in constraints)
    r.ok("purchase_requests に数量×単価＝合計金額整合性CHECK制約 (chk_purchase_requests_calc_match) が存在する",
         "chk_purchase_requests_calc_match" in constraints)

    # 14-4. RLS (ENABLE + FORCE) & テナント分離ポリシー確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT relrowsecurity, relforcerowsecurity
               FROM pg_class WHERE relname = 'purchase_requests'"""
        )
        rls_pr = cur.fetchone()
        cur.execute(
            """SELECT policyname FROM pg_policies
               WHERE tablename = 'purchase_requests' AND policyname = 'tenant_isolation_purchase_requests'"""
        )
        pol_pr = cur.fetchone()
    r.ok("purchase_requests で RLS が有効化かつ FORCE されている (バイパス不可)",
         rls_pr is not None and rls_pr["relrowsecurity"] and rls_pr["relforcerowsecurity"])
    r.ok("purchase_requests に tenant_isolation ポリシーが適用されている", pol_pr is not None)

    # 14-5. 冪等性保証: 017を2回連続適用してもエラーにならないこと
    idempotent_017_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_017)
        finally:
            conn.close()
    except Exception as e:
        idempotent_017_ok = False
        print(f"  [ERROR] 017 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 5: 017を2回連続適用してもエラーにならず正常終了する (ALTER TABLE / DDL 冪等性保証)",
         idempotent_017_ok)

    # 14-6. 【P2-T1実証】発注申請 実DB E2Eテスト (RBAC二重防御・DB CHECK・暗黙自動承認防止・0-step・SoD・WORM・テナント分離)
    cmd_pr = f"npx ts-node src/scripts/verify-purchase-requests-e2e.ts \"{dsn}\""
    pr_run = subprocess.run(cmd_pr, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if pr_run.returncode != 0:
        err_msg = f"\n[PURCHASE REQUESTS E2E ERROR STDOUT]:\n{pr_run.stdout}\n[PURCHASE REQUESTS E2E ERROR STDERR]:\n{pr_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    r.ok("発注申請E2E: RBAC二重防御・DB CHECK整合性・暗黙自動承認防止・明示的0-step・多段階SoD自己承認拒否・WORM改ざん防止・完全テナント分離が動作する (P2-T1)",
         pr_run.returncode == 0)

    # ------------------------------------------------------------------
    print("\n--- 15. サプライヤーマスタ (P2-T2) の検証 ---")

    # 15-1. 018_suppliers.sql の段階的適用
    sql_018_path = SQL_DIR / "018_suppliers.sql"
    with open(sql_018_path, "r", encoding="utf-8") as f:
        sql_018 = f.read()

    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql_018)
    finally:
        conn.close()
    print("[schema] 018_suppliers.sql を適用しました")

    # 15-2. suppliers テーブル存在確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT EXISTS (
                   SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = 'suppliers'
               ) AS table_exists"""
        )
        sup_table_exists = cur.fetchone()["table_exists"]
    r.ok("suppliers テーブルが正常に作成されている", sup_table_exists)

    # 15-3. suppliers テーブルのユニーク制約確認 (uq_suppliers_tenant_name)
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT conname FROM pg_constraint
               WHERE conrelid = 'suppliers'::regclass AND contype = 'u'"""
        )
        u_constraints = {row["conname"] for row in cur.fetchall()}
    r.ok("suppliers にテナント内ユニーク制約 (uq_suppliers_tenant_name) が存在する",
         "uq_suppliers_tenant_name" in u_constraints)

    # 15-4. RLS (ENABLE + FORCE) & テナント分離ポリシー確認 (suppliers)
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT relrowsecurity, relforcerowsecurity
               FROM pg_class WHERE relname = 'suppliers'"""
        )
        rls_sup = cur.fetchone()
        cur.execute(
            """SELECT policyname FROM pg_policies
               WHERE tablename = 'suppliers' AND policyname = 'tenant_isolation_suppliers'"""
        )
        pol_sup = cur.fetchone()
    r.ok("suppliers で RLS が有効化かつ FORCE されている (バイパス不可)",
         rls_sup is not None and rls_sup["relrowsecurity"] and rls_sup["relforcerowsecurity"])
    r.ok("suppliers に tenant_isolation ポリシーが適用されている", pol_sup is not None)

    # 15-5. purchase_requests への supplier_id 列追加確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT EXISTS (
                   SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'purchase_requests' AND column_name = 'supplier_id'
               ) AS col_exists"""
        )
        col_sup_id_exists = cur.fetchone()["col_exists"]
    r.ok("purchase_requests に supplier_id 列が追加されている", col_sup_id_exists)

    # 15-5b. 参照中サプライヤー名前変更防止トリガー確認 (trg_prevent_supplier_name_change_if_referenced)
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT tgname FROM pg_trigger
               WHERE tgrelid = 'suppliers'::regclass
                 AND tgname = 'trg_prevent_supplier_name_change_if_referenced'"""
        )
        trg_name_change = cur.fetchone()
    r.ok("suppliers に参照中サプライヤー名前変更防止トリガー (trg_prevent_supplier_name_change_if_referenced) が存在する (BLOCKER-01)",
         trg_name_change is not None)

    # 15-6. 冪等性保証: 018を2回連続適用してもエラーにならないこと
    idempotent_018_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_018)
        finally:
            conn.close()
    except Exception as e:
        idempotent_018_ok = False
        print(f"  [ERROR] 018 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 6: 018を2回連続適用してもエラーにならず正常終了する (ALTER TABLE / DDL 冪等性保証)",
         idempotent_018_ok)

    # 15-7. 【P2-T2実証】サプライヤーマスタ 実DB E2Eテスト (RBAC二重防御・テナント整合性トリガー・名前不整合防止・後方互換性・RLS)
    cmd_sup = f"npx ts-node src/scripts/verify-suppliers-e2e.ts \"{dsn}\""
    sup_run = subprocess.run(cmd_sup, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if sup_run.returncode != 0:
        err_msg = f"\n[SUPPLIERS E2E ERROR STDOUT]:\n{sup_run.stdout}\n[SUPPLIERS E2E ERROR STDERR]:\n{sup_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    r.ok("サプライヤーマスタE2E: RBAC二重防御・テナント整合性トリガー・名前不整合防止・フリーテキスト後方互換性・完全テナント分離が動作する (P2-T2)",
         sup_run.returncode == 0)

    # ------------------------------------------------------------------------
    # 16. 発注〜検収〜請求の連携 (P2-T3) の検証
    # ------------------------------------------------------------------------
    print("\n--- 16. 発注〜検収〜請求の連携 (P2-T3) の検証 ---")

    # 16-1. 019_purchase_receipts_and_billing.sql を適用
    file_019 = SQL_DIR / "019_purchase_receipts_and_billing.sql"
    with open(file_019, encoding="utf-8") as f:
        sql_019 = f.read()
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql_019)
    finally:
        conn.close()
    print("[schema] 019_purchase_receipts_and_billing.sql を適用しました")

    # 16-2. purchase_receipts テーブル存在確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT EXISTS (
                   SELECT 1 FROM information_schema.tables
                   WHERE table_name = 'purchase_receipts'
               ) AS tbl_exists"""
        )
        tbl_receipts_exists = cur.fetchone()["tbl_exists"]
    r.ok("purchase_receipts テーブルが正常に作成されている", tbl_receipts_exists)

    # 16-3. purchase_receipts の数量正数CHECK制約確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT conname FROM pg_constraint
               WHERE conrelid = 'purchase_receipts'::regclass
                 AND conname = 'chk_purchase_receipts_quantity_positive'"""
        )
        chk_rec_qty = cur.fetchone()
    r.ok("purchase_receipts に数量正数CHECK制約 (chk_purchase_receipts_quantity_positive) が存在する", chk_rec_qty is not None)

    # 16-4. purchase_receipts の RLS 有効化 & FORCE 確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT relrowsecurity, relforcerowsecurity
               FROM pg_class WHERE relname = 'purchase_receipts'"""
        )
        rls_rec = cur.fetchone()
        cur.execute(
            """SELECT policyname FROM pg_policies
               WHERE tablename = 'purchase_receipts' AND policyname = 'tenant_isolation_purchase_receipts'"""
        )
        pol_rec = cur.fetchone()
    r.ok("purchase_receipts で RLS が有効化かつ FORCE されている (バイパス不可)",
         rls_rec is not None and rls_rec["relrowsecurity"] and rls_rec["relforcerowsecurity"])
    r.ok("purchase_receipts に tenant_isolation ポリシーが適用されている", pol_rec is not None)

    # 16-5. vendor_bills への purchase_request_id 列追加確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT EXISTS (
                   SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'vendor_bills' AND column_name = 'purchase_request_id'
               ) AS col_exists"""
        )
        col_pr_id_exists = cur.fetchone()["col_exists"]
    r.ok("vendor_bills に purchase_request_id 列が追加されている", col_pr_id_exists)

    # 16-6. 冪等性保証: 019を2回連続適用してもエラーにならないこと
    idempotent_019_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_019)
        finally:
            conn.close()
    except Exception as e:
        idempotent_019_ok = False
        print(f"  [ERROR] 019 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 7: 019を2回連続適用してもエラーにならず正常終了する (ALTER TABLE / DDL 冪等性保証)",
         idempotent_019_ok)

    # 16-7. 020_purchase_receipt_worm_delete.sql を適用 (P2-T3-FIX: DELETE防止WORMトリガー & app_runtime権限剥奪)
    file_020 = SQL_DIR / "020_purchase_receipt_worm_delete.sql"
    with open(file_020, encoding="utf-8") as f:
        sql_020 = f.read()
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql_020)
    finally:
        conn.close()
    print("[schema] 020_purchase_receipt_worm_delete.sql を適用しました")

    # 16-8. purchase_receipts に DELETE 防止トリガー (trg_prevent_purchase_receipt_delete) が存在することを確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT tgname FROM pg_trigger
               WHERE tgrelid = 'purchase_receipts'::regclass
                 AND tgname = 'trg_prevent_purchase_receipt_delete'"""
        )
        trg_del = cur.fetchone()
    r.ok("purchase_receipts に DELETE 防止トリガー (trg_prevent_purchase_receipt_delete) が存在する (P2-T3-FIX WORM保証)",
         trg_del is not None)

    # 16-9. app_runtime ロールから DELETE 権限が剥奪されていることを確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute(
            """SELECT has_table_privilege('app_runtime', 'purchase_receipts', 'DELETE') AS can_delete"""
        )
        can_del = cur.fetchone()["can_delete"]
    r.ok("app_runtime ロールから purchase_receipts の DELETE 権限が剥奪されている (最小権限の原則)",
         not can_del)

    # 16-10. 冪等性保証: 020を2回連続適用してもエラーにならないこと
    idempotent_020_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_020)
        finally:
            conn.close()
    except Exception as e:
        idempotent_020_ok = False
        print(f"  [ERROR] 020 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 8: 020を2回連続適用してもエラーにならず正常終了する (DDL 冪等性保証)",
         idempotent_020_ok)

    # 16-11. 【P2-T3実証】発注〜検収〜請求 実DB E2Eテスト (DELETE WORM防止含む)
    cmd_p2t3 = f"npx ts-node src/scripts/verify-purchase-receipts-billing-e2e.ts \"{dsn}\""
    p2t3_run = subprocess.run(cmd_p2t3, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if p2t3_run.returncode != 0:
        err_msg = f"\n[P2-T3 E2E ERROR STDOUT]:\n{p2t3_run.stdout}\n[P2-T3 E2E ERROR STDERR]:\n{p2t3_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    r.ok("発注〜検収〜請求E2E: 分納・状態一貫性・数量超過防止・Advisory Lock同時実行直列化・tenant整合性・請求紐付け・WORM(UPDATE/DELETE)・RBACが動作する (P2-T3)",
         p2t3_run.returncode == 0)

    # 17. 【P2-T4実証】購買ダッシュボード・レポート 実DB E2Eテスト
    cmd_p2t4 = f"npx ts-node src/scripts/verify-purchase-dashboard-e2e.ts \"{dsn}\""
    p2t4_run = subprocess.run(cmd_p2t4, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if p2t4_run.returncode != 0:
        err_msg = f"\n[P2-T4 E2E ERROR STDOUT]:\n{p2t4_run.stdout}\n[P2-T4 E2E ERROR STDERR]:\n{p2t4_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    r.ok("購買ダッシュボードE2E: テナント完全分離・二重RBAC認可・ステータス集計・サプライヤーランキング・検収待ち集計・月次推移が動作する (P2-T4)",
         p2t4_run.returncode == 0)

    # --------------------------------------------------------------------------
    # 18. 従業員マスタ・勤怠管理 (P3-T1) の検証
    # --------------------------------------------------------------------------
    print("\n--- 18. 従業員マスタ・勤怠管理 (P3-T1) の検証 ---")

    # 18-1. 021_employees_and_attendance.sql を適用
    file_021 = SQL_DIR / "021_employees_and_attendance.sql"
    with open(file_021, encoding="utf-8") as f:
        sql_021 = f.read()
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql_021)
    finally:
        conn.close()
    print("[schema] 021_employees_and_attendance.sql を適用しました")

    # 18-2. employees テーブルの作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('employees') IS NOT NULL AS exists")
        emp_tbl_exists = cur.fetchone()["exists"]
    r.ok("employees テーブルが正常に作成されている", emp_tbl_exists)

    # 18-3. employees テーブルの RLS 有効化確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'employees'")
        row = cur.fetchone()
        emp_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("employees の RLS が有効かつ FORCE されている", emp_rls_ok)

    # 18-4. attendance_records テーブルの作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('attendance_records') IS NOT NULL AS exists")
        att_tbl_exists = cur.fetchone()["exists"]
    r.ok("attendance_records テーブルが正常に作成されている", att_tbl_exists)

    # 18-5. attendance_records テーブルの RLS 有効化確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'attendance_records'")
        row = cur.fetchone()
        att_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("attendance_records の RLS が有効かつ FORCE されている", att_rls_ok)

    # 18-6. 段階的アップグレード・冪等性検証 (021を2回連続適用してもエラーにならないこと)
    idempotent_021_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_021)
        finally:
            conn.close()
    except Exception as e:
        idempotent_021_ok = False
        print(f"  [ERROR] 021 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 9: 021を2回連続適用してもエラーにならず正常終了する (DDL 冪等性保証)",
         idempotent_021_ok)

    # 18-7. 【P3-T1実証】実DB E2Eテスト (RBAC、tenant分離、整合性トリガー、労働時間区分境界値実測)
    cmd_p3t1 = f"npx ts-node src/scripts/verify-employees-attendance-e2e.ts \"{dsn}\""
    p3t1_run = subprocess.run(cmd_p3t1, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if p3t1_run.returncode != 0:
        err_msg = f"\n[P3-T1 E2E ERROR STDOUT]:\n{p3t1_run.stdout}\n[P3-T1 E2E ERROR STDERR]:\n{p3t1_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    else:
        print("\n=== P3-T1 E2E 実測実行ログ ===")
        print(p3t1_run.stdout)
    r.ok("従業員マスタ・勤怠管理E2E: テナント完全分離・二重RBAC認可・DB整合性トリガー・労働時間区分境界値実測(8h/22h/深夜/休日)が動作する (P3-T1)",
         p3t1_run.returncode == 0)

    # --------------------------------------------------------------------------
    # 19. 保険料率・税率マスタ管理 (P3-T2) の検証
    # --------------------------------------------------------------------------
    print("\n--- 19. 保険料率・税率マスタ管理 (P3-T2) の検証 ---")

    # 19-1. 022_insurance_and_tax_rates.sql を適用
    file_022 = SQL_DIR / "022_insurance_and_tax_rates.sql"
    with open(file_022, encoding="utf-8") as f:
        sql_022 = f.read()
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql_022)
    finally:
        conn.close()
    print("[schema] 022_insurance_and_tax_rates.sql を適用しました")

    # 19-2. insurance_rate_tables テーブルの作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('insurance_rate_tables') IS NOT NULL AS exists")
        ins_tbl_exists = cur.fetchone()["exists"]
    r.ok("insurance_rate_tables テーブルが正常に作成されている", ins_tbl_exists)

    # 19-3. insurance_rate_tables テーブルの RLS 有効化確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'insurance_rate_tables'")
        row = cur.fetchone()
        ins_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("insurance_rate_tables の RLS が有効かつ FORCE されている", ins_rls_ok)

    # 19-4. income_tax_withholding_brackets テーブルの作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('income_tax_withholding_brackets') IS NOT NULL AS exists")
        tax_tbl_exists = cur.fetchone()["exists"]
    r.ok("income_tax_withholding_brackets テーブルが正常に作成されている", tax_tbl_exists)

    # 19-5. income_tax_withholding_brackets テーブルの RLS 有効化確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'income_tax_withholding_brackets'")
        row = cur.fetchone()
        tax_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("income_tax_withholding_brackets の RLS が有効かつ FORCE されている", tax_rls_ok)

    # 19-6. 段階的アップグレード・冪等性検証 (022を2回連続適用してもエラーにならないこと)
    idempotent_022_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_022)
        finally:
            conn.close()
    except Exception as e:
        idempotent_022_ok = False
        print(f"  [ERROR] 022 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 10: 022を2回連続適用してもエラーにならず正常終了する (DDL 冪等性保証)",
         idempotent_022_ok)

    # 19-7. 023_rate_master_immutability.sql を適用 (改ざん防止トリガー)
    file_023 = SQL_DIR / "023_rate_master_immutability.sql"
    with open(file_023, encoding="utf-8") as f:
        sql_023 = f.read()
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql_023)
    finally:
        conn.close()
    print("[schema] 023_rate_master_immutability.sql を適用しました")

    # 19-8. トリガー作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("""
            SELECT count(*) = 4 AS all_exist
            FROM pg_trigger
            WHERE tgname IN (
                'trg_prevent_insurance_rate_past_update',
                'trg_prevent_insurance_rate_past_delete',
                'trg_prevent_tax_bracket_past_update',
                'trg_prevent_tax_bracket_past_delete'
            )
        """)
        trg_ok = cur.fetchone()["all_exist"]
    r.ok("保険料率・税額表の過去マスタ改ざん防止トリガーが正常に作成されている", trg_ok)

    # 19-9. 段階的アップグレード・冪等性検証 (023を2回連続適用してもエラーにならないこと)
    idempotent_023_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_023)
        finally:
            conn.close()
    except Exception as e:
        idempotent_023_ok = False
        print(f"  [ERROR] 023 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 11: 023を2回連続適用してもエラーにならず正常終了する (DDL 冪等性保証)",
         idempotent_023_ok)

    # 19-10. 【P3-T2実証】実DB E2Eテスト (RBAC二重防御、テナント完全分離、DB EXCLUDE重複拒否、指定日境界値判定、過去データ改ざん防止WORM、クエリ性能)
    cmd_p3t2 = f"npx ts-node src/scripts/verify-rate-masters-e2e.ts \"{dsn}\""
    p3t2_run = subprocess.run(cmd_p3t2, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if p3t2_run.returncode != 0:
        err_msg = f"\n[P3-T2 E2E ERROR STDOUT]:\n{p3t2_run.stdout}\n[P3-T2 E2E ERROR STDERR]:\n{p3t2_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    else:
        print("\n=== P3-T2 E2E 実測実行ログ ===")
        print(p3t2_run.stdout)
    r.ok("保険料率・税率マスタE2E: テナント完全分離・二重RBAC認可・DB EXCLUDE制約重複拒否・指定日有効判定・過去データ改ざん防止(WORM)が動作する (P3-T2)",
         p3t2_run.returncode == 0)

    # ------------------------------------------------------------------------
    # 20. Phase 3 Task 3 (P3-T3): 給与計算エンジン検証 (024_payroll_engine.sql)
    # ------------------------------------------------------------------------
    print("\n--- 20. 給与計算エンジン検証 (024_payroll_engine.sql) ---")

    # 20-1. 024_payroll_engine.sql を適用
    file_024 = SQL_DIR / "024_payroll_engine.sql"
    with open(file_024, encoding="utf-8") as f:
        sql_024 = f.read()
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql_024)
    finally:
        conn.close()
    print("[schema] 024_payroll_engine.sql を適用しました")

    # 20-2. employee_payroll_profiles テーブル作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('employee_payroll_profiles') IS NOT NULL AS exists")
        prof_tbl_exists = cur.fetchone()["exists"]
    r.ok("employee_payroll_profiles テーブルが正常に作成されている", prof_tbl_exists)

    # 20-3. employee_payroll_profiles RLS確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'employee_payroll_profiles'")
        row = cur.fetchone()
        prof_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("employee_payroll_profiles の RLS が有効かつ FORCE されている", prof_rls_ok)

    # 20-4. payroll_periods テーブル作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('payroll_periods') IS NOT NULL AS exists")
        period_tbl_exists = cur.fetchone()["exists"]
    r.ok("payroll_periods テーブルが正常に作成されている", period_tbl_exists)

    # 20-5. payroll_periods RLS確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'payroll_periods'")
        row = cur.fetchone()
        period_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("payroll_periods の RLS が有効かつ FORCE されている", period_rls_ok)

    # 20-6. payroll_calculations テーブル作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('payroll_calculations') IS NOT NULL AS exists")
        calc_tbl_exists = cur.fetchone()["exists"]
    r.ok("payroll_calculations テーブルが正常に作成されている", calc_tbl_exists)

    # 20-7. payroll_calculations RLS確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'payroll_calculations'")
        row = cur.fetchone()
        calc_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("payroll_calculations の RLS が有効かつ FORCE されている", calc_rls_ok)

    # 20-8. 段階的アップグレード・冪等性検証 (024を2回連続適用してもエラーにならないこと)
    idempotent_024_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_024)
        finally:
            conn.close()
    except Exception as e:
        idempotent_024_ok = False
        print(f"  [ERROR] 024 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 12: 024を2回連続適用してもエラーにならず正常終了する (DDL 冪等性保証)",
         idempotent_024_ok)

    # 20-9. 【P3-T3実証】実DB E2Eテスト (勤怠集計、料率・税額適用、計算根拠マスタID追跡、承認フロー連携、確定後WORM不変性、二重RBAC)
    cmd_p3t3 = f"npx ts-node src/scripts/verify-payroll-engine-e2e.ts \"{dsn}\""
    p3t3_run = subprocess.run(cmd_p3t3, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if p3t3_run.returncode != 0:
        err_msg = f"\n[P3-T3 E2E ERROR STDOUT]:\n{p3t3_run.stdout}\n[P3-T3 E2E ERROR STDERR]:\n{p3t3_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    else:
        print("\n=== P3-T3 E2E 実測実行ログ ===")
        print(p3t3_run.stdout)
    r.ok("給与計算エンジンE2E: ルール計算・料率マスタID記録・承認フロー連携・確定後WORM不変性・RBAC二重防御が動作する (P3-T3)",
         p3t3_run.returncode == 0)

    # ------------------------------------------------------------------------
    # 21. Phase 3 Task 4 (P3-T4): 給与明細発行・年末調整検証 (025_payslips_and_year_end_adjustments.sql)
    # ------------------------------------------------------------------------
    print("\n--- 21. 給与明細発行・年末調整検証 (025_payslips_and_year_end_adjustments.sql) ---")

    # 21-1. 025_payslips_and_year_end_adjustments.sql を適用
    file_025 = SQL_DIR / "025_payslips_and_year_end_adjustments.sql"
    with open(file_025, encoding="utf-8") as f:
        sql_025 = f.read()
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql_025)
    finally:
        conn.close()
    print("[schema] 025_payslips_and_year_end_adjustments.sql を適用しました")

    # 21-2. payslips テーブル作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('payslips') IS NOT NULL AS exists")
        payslips_tbl_exists = cur.fetchone()["exists"]
    r.ok("payslips テーブルが正常に作成されている", payslips_tbl_exists)

    # 21-3. payslips RLS確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'payslips'")
        row = cur.fetchone()
        payslips_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("payslips の RLS が有効かつ FORCE されている", payslips_rls_ok)

    # 21-4. year_end_adjustments テーブル作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('year_end_adjustments') IS NOT NULL AS exists")
        yea_tbl_exists = cur.fetchone()["exists"]
    r.ok("year_end_adjustments テーブルが正常に作成されている", yea_tbl_exists)

    # 21-5. year_end_adjustments RLS確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'year_end_adjustments'")
        row = cur.fetchone()
        yea_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("year_end_adjustments の RLS が有効かつ FORCE されている", yea_rls_ok)

    # 21-6. permissions の登録確認 (payslip.*, year_end_adjustment.*)
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("""SELECT code FROM permissions WHERE code IN (
            'payslip.create', 'payslip.view',
            'year_end_adjustment.create', 'year_end_adjustment.view', 'year_end_adjustment.approve'
        )""")
        perm_codes = {row["code"] for row in cur.fetchall()}
    r.ok("給与明細・年末調整の全権限 (5種) が permissions テーブルに登録されている",
         len(perm_codes) == 5, f"実測登録数: {len(perm_codes)} / 5")

    # 21-7. 段階的アップグレード・冪等性検証 (025を2回連続適用してもエラーにならないこと)
    idempotent_025_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_025)
        finally:
            conn.close()
    except Exception as e:
        idempotent_025_ok = False
        print(f"  [ERROR] 025 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 13: 025を2回連続適用してもエラーにならず正常終了する (DDL 冪等性保証)",
         idempotent_025_ok)

    # 21-8. 【P3-T4実証】実DB E2Eテスト (給与明細PDF発行、WORM不変性、確定境界DB最終防御、自己確定禁止、RLS分離)
    cmd_p3t4 = f"npx ts-node src/scripts/verify-payslips-year-end-adjustment-e2e.ts \"{dsn}\""
    p3t4_run = subprocess.run(cmd_p3t4, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if p3t4_run.returncode != 0:
        err_msg = f"\n[P3-T4 E2E ERROR STDOUT]:\n{p3t4_run.stdout}\n[P3-T4 E2E ERROR STDERR]:\n{p3t4_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    else:
        print("\n=== P3-T4 E2E 実測実行ログ ===")
        print(p3t4_run.stdout)
    r.ok("給与明細・年末調整E2E: 明細発行・PDF生成・WORM不変性・確定境界DB最終防御・自己確定防止・RLS分離が動作する (P3-T4)",
         p3t4_run.returncode == 0)

    # =========================================================================
    # 22. 【Phase 4 P4-T1】見積書 (quotations, quotation_line_items, WORM, 受注転換)
    # =========================================================================
    print("\n--- 22. 見積書機能 (quotations, quotation_line_items, WORM不変性, 受注転換) (P4-T1) ---")

    # 22-1. 026_quotations.sql の段階適用
    sql_026_path = SQL_DIR / "026_quotations.sql"
    sql_026 = sql_026_path.read_text(encoding="utf-8")
    apply_026_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_026)
        finally:
            conn.close()
    except Exception as e:
        apply_026_ok = False
        print(f"  [ERROR] 026_quotations.sql apply failed: {e}")
    r.ok("026_quotations.sql がエラーなく正常適用される", apply_026_ok)

    # 22-2. quotations テーブル作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('quotations') IS NOT NULL AS exists")
        quotations_tbl_exists = cur.fetchone()["exists"]
    r.ok("quotations テーブルが正常に作成されている", quotations_tbl_exists)

    # 22-3. quotations RLS確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'quotations'")
        row = cur.fetchone()
        quotations_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("quotations の RLS が有効かつ FORCE されている", quotations_rls_ok)

    # 22-4. quotation_line_items テーブル作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('quotation_line_items') IS NOT NULL AS exists")
        ql_tbl_exists = cur.fetchone()["exists"]
    r.ok("quotation_line_items テーブルが正常に作成されている", ql_tbl_exists)

    # 22-5. quotation_line_items RLS確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'quotation_line_items'")
        row = cur.fetchone()
        ql_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("quotation_line_items の RLS が有効かつ FORCE されている", ql_rls_ok)

    # 22-6. permissions の登録確認 (quotation.*)
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("""SELECT code FROM permissions WHERE code IN (
            'quotation.create', 'quotation.view', 'quotation.edit',
            'quotation.send', 'quotation.convert'
        )""")
        perm_codes = {row["code"] for row in cur.fetchall()}
    r.ok("見積書の全権限 (5種) が permissions テーブルに登録されている",
         len(perm_codes) == 5, f"実測登録数: {len(perm_codes)} / 5")

    # 22-7. 段階的アップグレード・冪等性検証 (026を2回連続適用してもエラーにならないこと)
    idempotent_026_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_026)
        finally:
            conn.close()
    except Exception as e:
        idempotent_026_ok = False
        print(f"  [ERROR] 026 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 14: 026を2回連続適用してもエラーにならず正常終了する (DDL 冪等性保証)",
         idempotent_026_ok)

    # =========================================================================
    # 23. 【Phase 4 P4-T1-FIX3】改訂先正当性・受注転換双方向DB検証 (027追加マイグレーション)
    # =========================================================================
    print("\n--- 23. 改訂先正当性・受注転換双方向DBガード (027追加マイグレーション) (P4-T1-FIX3) ---")

    # 23-1. 027_quotation_revision_and_conversion_guards.sql の段階適用
    sql_027_path = SQL_DIR / "027_quotation_revision_and_conversion_guards.sql"
    sql_027 = sql_027_path.read_text(encoding="utf-8")
    apply_027_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_027)
        finally:
            conn.close()
    except Exception as e:
        apply_027_ok = False
        print(f"  [ERROR] 027_quotation_revision_and_conversion_guards.sql apply failed: {e}")
    r.ok("027_quotation_revision_and_conversion_guards.sql がエラーなく正常適用される", apply_027_ok)

    # 23-2. invoices.source_quotation_id 列の存在確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("""SELECT count(*) as cnt FROM information_schema.columns
                       WHERE table_name = 'invoices' AND column_name = 'source_quotation_id'""")
        source_quote_col_exists = (cur.fetchone()["cnt"] == 1)
    r.ok("invoices テーブルに source_quotation_id 列が存在する (BLOCKER候補-02a)", source_quote_col_exists)

    # 23-3. quotations.superseded_by 部分UNIQUEインデックス存在確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("""SELECT count(*) as cnt FROM pg_indexes
                       WHERE tablename = 'quotations' AND indexname = 'ix_quotations_superseded_by_unique'""")
        superseded_idx_exists = (cur.fetchone()["cnt"] == 1)
    r.ok("quotations テーブルに superseded_by 部分UNIQUEインデックスが存在する (BLOCKER-01)", superseded_idx_exists)

    # 23-4. 段階的アップグレード・冪等性検証 (027を2回連続適用してもエラーにならないこと)
    idempotent_027_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_027)
        finally:
            conn.close()
    except Exception as e:
        idempotent_027_ok = False
        print(f"  [ERROR] 027 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 15: 027を2回連続適用してもエラーにならず正常終了する (DDL 冪等性保証)",
         idempotent_027_ok)

    # =========================================================================
    # 24. 【Phase 4 P4-T1-FIX4】invoice.source_quotation_id WORMガード (028追加マイグレーション)
    # =========================================================================
    print("\n--- 24. invoice.source_quotation_id WORM不変性ガード (028追加マイグレーション) (P4-T1-FIX4) ---")

    # 24-1. 028_invoice_source_quotation_guard.sql の段階適用
    sql_028_path = SQL_DIR / "028_invoice_source_quotation_guard.sql"
    sql_028 = sql_028_path.read_text(encoding="utf-8")
    apply_028_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_028)
        finally:
            conn.close()
    except Exception as e:
        apply_028_ok = False
        print(f"  [ERROR] 028_invoice_source_quotation_guard.sql apply failed: {e}")
    r.ok("028_invoice_source_quotation_guard.sql がエラーなく正常適用される", apply_028_ok)

    # 24-2. invoices.source_quotation_id 部分UNIQUEインデックス存在確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("""SELECT count(*) as cnt FROM pg_indexes
                       WHERE tablename = 'invoices' AND indexname = 'ix_invoices_source_quotation_unique'""")
        inv_source_quote_idx_exists = (cur.fetchone()["cnt"] == 1)
    r.ok("invoices テーブルに source_quotation_id 部分UNIQUEインデックスが存在する (BLOCKER)", inv_source_quote_idx_exists)

    # 24-3. 段階的アップグレード・冪等性検証 (028を2回連続適用してもエラーにならないこと)
    idempotent_028_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_028)
        finally:
            conn.close()
    except Exception as e:
        idempotent_028_ok = False
        print(f"  [ERROR] 028 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 16: 028を2回連続適用してもエラーにならず正常終了する (DDL 冪等性保証)",
         idempotent_028_ok)

    # 24-4. 【P4-T1-FIX4実証】実DB E2Eテスト (WORM不変性, 改訂先正当性DB検証, 双方向WORM不変性・部分UNIQUE)
    cmd_p4t1 = f"npx ts-node src/scripts/verify-quotations-e2e.ts \"{dsn}\""
    p4t1_run = subprocess.run(cmd_p4t1, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if p4t1_run.returncode != 0:
        err_msg = f"\n[P4-T1 E2E ERROR STDOUT]:\n{p4t1_run.stdout}\n[P4-T1 E2E ERROR STDERR]:\n{p4t1_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    else:
        print("\n=== P4-T1 E2E 実測実行ログ ===")
        print(p4t1_run.stdout)
    r.ok("見積書E2E: 作成・WORM・改訂先正当性DB検証・双方向WORM不変性・部分UNIQUE・PDF生成・RLSが動作する (P4-T1-FIX4)",
         p4t1_run.returncode == 0)

    # =========================================================================
    # 25. 【Phase 4 P4-T2】案件管理（商談パイプライン）(029_deals.sql 追加マイグレーション)
    # =========================================================================
    print("\n--- 25. 案件管理（商談パイプライン）(029_deals.sql 追加マイグレーション) (P4-T2) ---")

    # 25-1. 029_deals.sql の段階適用
    sql_029_path = SQL_DIR / "029_deals.sql"
    sql_029 = sql_029_path.read_text(encoding="utf-8")
    apply_029_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_029)
        finally:
            conn.close()
    except Exception as e:
        apply_029_ok = False
        print(f"  [ERROR] 029_deals.sql apply failed: {e}")
    r.ok("029_deals.sql がエラーなく正常適用される", apply_029_ok)

    # 25-2. deals テーブル作成確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT to_regclass('deals') IS NOT NULL AS exists")
        deals_tbl_exists = cur.fetchone()["exists"]
    r.ok("deals テーブルが正常に作成されている", deals_tbl_exists)

    # 25-3. deals RLS確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'deals'")
        row = cur.fetchone()
        deals_rls_ok = row["relrowsecurity"] and row["relforcerowsecurity"]
    r.ok("deals の RLS が有効かつ FORCE されている", deals_rls_ok)

    # 25-4. quotations.deal_id FK制約の存在確認
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("""SELECT count(*) as cnt FROM information_schema.table_constraints
                       WHERE table_name = 'quotations' AND constraint_name = 'fk_quotations_deal'""")
        fk_deal_exists = (cur.fetchone()["cnt"] == 1)
    r.ok("quotations テーブルに fk_quotations_deal 外部キー制約が存在する", fk_deal_exists)

    # 25-5. permissions の登録確認 (deal.*)
    with tx_as(dsn, role="postgres") as cur:
        cur.execute("""SELECT code FROM permissions WHERE code IN (
            'deal.create', 'deal.view', 'deal.edit', 'deal.close'
        )""")
        deal_perms = {row["code"] for row in cur.fetchall()}
    r.ok("案件管理の全権限 (4種) が permissions テーブルに登録されている",
         len(deal_perms) == 4, f"実測登録数: {len(deal_perms)} / 4")

    # 25-6. 段階的アップグレード・冪等性検証 (029を2回連続適用してもエラーにならないこと)
    idempotent_029_ok = True
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute(sql_029)
        finally:
            conn.close()
    except Exception as e:
        idempotent_029_ok = False
        print(f"  [ERROR] 029 re-apply failed: {e}")
    r.ok("段階的アップグレード検証 17: 029を2回連続適用してもエラーにならず正常終了する (DDL 冪等性保証)",
         idempotent_029_ok)

    # 25-7. 【P4-T2実証】実DB E2Eテスト (案件CRUD, terminal不変性, quotations連携, RBAC, RLS)
    cmd_p4t2 = f"npx ts-node src/scripts/verify-deals-e2e.ts \"{dsn}\""
    p4t2_run = subprocess.run(cmd_p4t2, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if p4t2_run.returncode != 0:
        err_msg = f"\n[P4-T2 E2E ERROR STDOUT]:\n{p4t2_run.stdout}\n[P4-T2 E2E ERROR STDERR]:\n{p4t2_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    else:
        print("\n=== P4-T2 E2E 実測実行ログ ===")
        print(p4t2_run.stdout)
    r.ok("案件管理E2E: 作成・更新・terminal不変性(won/lost)・失注理由必須・quotations外部キー連携・RBAC・RLSが動作する (P4-T2)",
         p4t2_run.returncode == 0)

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

        # 1. まず 001〜014 までを適用 (P1-T5マージ直後の既存DB状態を再現)
        apply_schema(dsn, max_file="014_general_requests.sql")
        # 2. 検証実行 (セクション12で015、...、セクション21で025、セクション22で026、セクション23で027、セクション24で028、セクション25で029段階適用 -> E2E実行)
        exit_code = run_verification(dsn)

        # 3. クリーンDBに最初から001〜029を一括適用した場合の回帰なし確認
        if exit_code == 0:
            fresh_db_name = "keiri_kaikei_fresh_029"
            conn_raw = psycopg2.connect(dsn)
            conn_raw.autocommit = True
            try:
                with conn_raw.cursor() as cur:
                    cur.execute(f"DROP DATABASE IF EXISTS {fresh_db_name}")
                    cur.execute(f"CREATE DATABASE {fresh_db_name}")
            finally:
                conn_raw.close()

            dsn_fresh = dsn.rsplit("/", 1)[0] + f"/{fresh_db_name}"
            print("\n--- クリーンDBへの001〜029一括適用検証 (新規環境回帰なし確認) ---")
            apply_schema(dsn_fresh)
            print("[schema] クリーンDBへの001〜029一括適用が正常終了しました (回帰なし確認完了)")
    finally:
        if args.use_docker and not args.keep_docker:
            docker_stop()

    return exit_code


if __name__ == "__main__":
    sys.exit(main())

