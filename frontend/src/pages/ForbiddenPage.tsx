import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

/** `RequireRole` によるSoD RBACガードでリダイレクトされた際に表示するページ */
export function ForbiddenPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="card max-w-md space-y-3 p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-negative" />
        <h1 className="text-lg font-semibold text-surface-50">アクセス権限がありません</h1>
        <p className="text-sm text-surface-400">
          この画面を表示する権限がありません。必要な場合は管理者にロールの変更を依頼してください。
        </p>
        <Link to="/dashboard" className="btn-primary inline-flex">
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}
