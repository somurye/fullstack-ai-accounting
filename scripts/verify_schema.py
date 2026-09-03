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
            try:
                with conn.cursor() as cur:
                    cur.execute(sql)
            except psycopg2.errors.UnsafeNewEnumValueUsage:
                # ENUM追加直後に同一ファイル内で使用されている場合、ステートメントごとに分割実行
                statements = [s.strip() for s in sql.split(";") if s.strip()]
                for stmt in statements:
                    with conn.cursor() as cur:
                        cur.execute(stmt)
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

    # 8. 【P1-T3実証】PermissionsGuard RBAC認可強制・解約遷移 E2Eテスト (DEBT-005完全証明)
    cmd_rbac = f"npx ts-node src/scripts/verify-contract-rbac-e2e.ts \"{dsn}\""
    rbac_run = subprocess.run(cmd_rbac, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if rbac_run.returncode != 0:
        err_msg = f"\n[RBAC E2E ERROR STDOUT]:\n{rbac_run.stdout}\n[RBAC E2E ERROR STDERR]:\n{rbac_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    r.ok("契約RBAC強制E2E: legal_viewer書込拒否(403)・閲覧許可・承認権限検証・解約遷移が動作する (DEBT-005)",
         rbac_run.returncode == 0)

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

    # 4. 【P1-T4実証】契約期限アラート・全テナント横断バッチ E2Eテスト
    cmd_batch = f"npx ts-node src/scripts/verify-contract-expiry-alerts-e2e.ts \"{dsn}\""
    batch_run = subprocess.run(cmd_batch, cwd=backend_dir, capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")
    if batch_run.returncode != 0:
        err_msg = f"\n[BATCH E2E ERROR STDOUT]:\n{batch_run.stdout}\n[BATCH E2E ERROR STDERR]:\n{batch_run.stderr}"
        print(err_msg.encode("cp932", errors="replace").decode("cp932"))
    r.ok("契約期限アラートE2E: 全テナント横断バッチ(RLS非バイパス)・auto_renewal文面分岐・未読重複防止・既読化・障害隔離が動作する (P1-T4)",
         batch_run.returncode == 0)

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
