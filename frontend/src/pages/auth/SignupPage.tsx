import { Building2, Lock, Mail, User as UserIcon, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { fetchCurrentUser } from './api';
import { useSignup } from './hooks';

/**
 * SignupPage
 * ==========
 * `POST /auth/signup` で新規テナントとそのオーナーユーザーを一括作成し、
 * 成功時は返却されたトークンで即座にセッションを確立して `/dashboard` へ遷移する
 * (`LoginPage` の `completeSession` と同じ流れ)。
 */
export function SignupPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const setCurrentTenant = useAuthStore((state) => state.setCurrentTenant);
  const setUser = useAuthStore((state) => state.setUser);

  const [tenantName, setTenantName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const signupMutation = useSignup();

  const handleSubmit = async (): Promise<void> => {
    setErrorMessage(null);
    try {
      const result = await signupMutation.mutateAsync({
        email,
        password,
        name,
        tenant_name: tenantName,
      });
      setSession({
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        tenants: result.tenants,
      });
      // `setSession` は「既に選択中のテナントがあれば維持する」仕様(ログイン画面の
      // 通常フロー向け)のため、以前の(別テナントの)セッションがlocalStorageに
      // 残っていると新規作成したテナントへ切り替わらない。サインアップ直後は
      // 必ず今作成したテナントを選択させる。
      setCurrentTenant(result.tenants[0].tenant_id);
      try {
        const user = await fetchCurrentUser();
        setUser(user);
      } catch {
        // プロフィール取得に失敗してもセッション自体は有効なため、サインアップは継続する。
      }
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setErrorMessage(formatApiErrorMessage(error));
    }
  };

  const isSubmitting = signupMutation.isPending;

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-surface-950 px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            経
          </div>
          <h1 className="text-lg font-semibold text-surface-50">経理・会計オールインワン</h1>
          <p className="text-xs text-surface-400">アカウントと会社を新規作成</p>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-lg border border-rose-800/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            {errorMessage}
          </div>
        )}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-surface-400">
              <Building2 className="h-3.5 w-3.5" />
              会社名
            </label>
            <input
              type="text"
              required
              autoFocus
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              placeholder="株式会社サンプル"
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-surface-400">
              <UserIcon className="h-3.5 w-3.5" />
              お名前
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="山田 太郎"
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-surface-400">
              <Mail className="h-3.5 w-3.5" />
              メールアドレス
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-surface-400">
              <Lock className="h-3.5 w-3.5" />
              パスワード
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8文字以上"
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !tenantName || !name || !email || !password || password.length < 8}
            className="btn-primary flex w-full items-center justify-center gap-2"
          >
            <UserPlus className="h-4 w-4" />
            {isSubmitting ? '作成中…' : 'アカウントと会社を作成'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-surface-400">
          既にアカウントをお持ちの方は{' '}
          <Link to="/login" className="text-brand-400 hover:underline">
            ログイン
          </Link>
        </p>
      </div>
    </div>
  );
}
