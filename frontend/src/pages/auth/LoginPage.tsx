import { KeyRound, Lock, LogIn, Mail } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { resolveHomePath } from '../../lib/rbac';
import { useAuthStore } from '../../stores/authStore';
import { fetchCurrentUser } from './api';
import { useLogin, useVerifyMfa } from './hooks';
import type { AuthTenantSummary } from '../../stores/authStore';

type Step = 'credentials' | 'mfa';

/**
 * LoginPage
 * =========
 * `POST /auth/login` → (MFA有効時) `POST /auth/mfa` → `GET /users/me` の順で
 * セッションを確立する。成功時は `authStore.setSession()` でトークンを保存し、
 * `ProtectedRoute` が管理する保護領域(`/dashboard` 等)へ遷移する。
 */
export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const setUser = useAuthStore((state) => state.setUser);

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [tenants, setTenants] = useState<AuthTenantSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loginMutation = useLogin();
  const mfaMutation = useVerifyMfa();

  const completeSession = async (
    accessToken: string,
    refreshToken: string,
    tenantList: AuthTenantSummary[],
  ): Promise<void> => {
    setSession({ accessToken, refreshToken, tenants: tenantList });
    let roles: string[] | undefined;
    try {
      const user = await fetchCurrentUser();
      setUser(user);
      roles = user.roles;
    } catch {
      // プロフィール取得に失敗してもセッション自体は有効なため、ログインは継続する
      // (ヘッダーのユーザー名表示が空になるのみ。ロール不明のためPCダッシュボードへ遷移する)。
    }
    navigate(resolveHomePath(roles), { replace: true });
  };

  const handleCredentialsSubmit = async (): Promise<void> => {
    setErrorMessage(null);
    try {
      const result = await loginMutation.mutateAsync({ email, password });
      setTenants(result.tenants);
      if (result.mfa_required && result.mfa_token) {
        setMfaToken(result.mfa_token);
        setStep('mfa');
        return;
      }
      if (result.access_token && result.refresh_token) {
        await completeSession(result.access_token, result.refresh_token, result.tenants);
      }
    } catch (error) {
      setErrorMessage(formatApiErrorMessage(error));
    }
  };

  const handleMfaSubmit = async (): Promise<void> => {
    setErrorMessage(null);
    try {
      const result = await mfaMutation.mutateAsync({ mfaToken, code });
      await completeSession(result.access_token, result.refresh_token, tenants);
    } catch (error) {
      setErrorMessage(formatApiErrorMessage(error));
    }
  };

  const isSubmitting = loginMutation.isPending || mfaMutation.isPending;

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-surface-950 px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            経
          </div>
          <h1 className="text-lg font-semibold text-surface-50">経理・会計オールインワン</h1>
          <p className="text-xs text-surface-400">
            {step === 'credentials' ? 'メールアドレスでログイン' : '認証アプリの6桁コードを入力してください'}
          </p>
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-lg border border-rose-800/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            {errorMessage}
          </div>
        )}

        {step === 'credentials' ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCredentialsSubmit();
            }}
          >
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-surface-400">
                <Mail className="h-3.5 w-3.5" />
                メールアドレス
              </label>
              <input
                type="email"
                required
                autoFocus
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting || !email || !password}
              className="btn-primary flex w-full items-center justify-center gap-2"
            >
              <LogIn className="h-4 w-4" />
              {isSubmitting ? 'ログイン中…' : 'ログイン'}
            </button>
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleMfaSubmit();
            }}
          >
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-surface-400">
                <KeyRound className="h-3.5 w-3.5" />
                認証コード(6桁)
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-center text-lg tracking-[0.3em] text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting || code.length !== 6}
              className="btn-primary flex w-full items-center justify-center gap-2"
            >
              {isSubmitting ? '検証中…' : '検証してログイン'}
            </button>
            <button
              type="button"
              className="btn-secondary w-full text-xs"
              onClick={() => {
                setStep('credentials');
                setCode('');
                setErrorMessage(null);
              }}
            >
              メールアドレス入力に戻る
            </button>
          </form>
        )}

        {step === 'credentials' && (
          <p className="mt-4 text-center text-xs text-surface-400">
            はじめてご利用の方は{' '}
            <Link to="/signup" className="text-brand-400 hover:underline">
              アカウントと会社を新規作成
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
