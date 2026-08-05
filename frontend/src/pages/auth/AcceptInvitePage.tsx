import { Lock, LogIn, Mail, User as UserIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { fetchCurrentUser } from './api';
import { useAcceptInvite, useValidateInvitation } from './hooks';
import type { InvitationValidationResult } from './types';

type Status = 'validating' | 'valid' | 'invalid';

/**
 * AcceptInvitePage
 * ================
 * `invite_url` (`${FRONTEND_BASE_URL}/accept-invite?token=...`、
 * `backend/src/modules/settings/settings.service.ts` の `createInvitation` が生成)から
 * 遷移してくる画面。表示直後に `GET /auth/invitations/validate` でトークンを検証し、
 * 有効な場合のみ受諾フォームを表示する。受諾成功時は `LoginPage` と同様に
 * セッションを確立して `/dashboard` へ遷移する。
 */
export function AcceptInvitePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const setSession = useAuthStore((state) => state.setSession);
  const setCurrentTenant = useAuthStore((state) => state.setCurrentTenant);
  const setUser = useAuthStore((state) => state.setUser);

  const [status, setStatus] = useState<Status>('validating');
  const [invitation, setInvitation] = useState<InvitationValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validateMutation = useValidateInvitation();
  const acceptMutation = useAcceptInvite();

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setValidationError('招待URLが不正です(tokenが指定されていません)');
      return;
    }
    validateMutation
      .mutateAsync(token)
      .then((result) => {
        setInvitation(result);
        setStatus('valid');
      })
      .catch((error: unknown) => {
        setValidationError(formatApiErrorMessage(error));
        setStatus('invalid');
      });
    // token変更時のみ再検証すればよいため、mutationオブジェクトは依存配列から除外する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleSubmit = async (): Promise<void> => {
    setSubmitError(null);
    try {
      const result = await acceptMutation.mutateAsync({ token, password, name });
      setSession({
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        tenants: result.tenants,
      });
      // SignupPage同様、以前の(別テナントの)セッションが残っていても
      // 必ず今参加したテナントを選択させる。
      setCurrentTenant(result.tenants[0].tenant_id);
      try {
        const user = await fetchCurrentUser();
        setUser(user);
      } catch {
        // プロフィール取得に失敗してもセッション自体は有効なため、招待受諾は継続する。
      }
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setSubmitError(formatApiErrorMessage(error));
    }
  };

  const isSubmitting = acceptMutation.isPending;

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-surface-950 px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            経
          </div>
          <h1 className="text-lg font-semibold text-surface-50">経理・会計オールインワン</h1>
          <p className="text-xs text-surface-400">招待の受諾</p>
        </div>

        {status === 'validating' && (
          <p className="py-6 text-center text-sm text-surface-400">招待を確認しています…</p>
        )}

        {status === 'invalid' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-rose-800/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
              {validationError ?? '招待の確認に失敗しました'}
            </div>
            <p className="text-center text-xs text-surface-400">
              <Link to="/login" className="text-brand-400 hover:underline">
                ログイン画面へ戻る
              </Link>
            </p>
          </div>
        )}

        {status === 'valid' && invitation && (
          <>
            <p className="mb-4 rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-center text-sm text-surface-200">
              <span className="font-semibold text-surface-50">{invitation.tenant_name}</span>{' '}
              から招待されています
            </p>

            {submitError && (
              <div className="mb-4 rounded-lg border border-rose-800/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
                {submitError}
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
                  <Mail className="h-3.5 w-3.5" />
                  メールアドレス
                </label>
                <input
                  type="email"
                  disabled
                  value={invitation.email}
                  className="w-full cursor-not-allowed rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-surface-400 outline-none"
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
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="山田 太郎"
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
                disabled={isSubmitting || !name || !password || password.length < 8}
                className="btn-primary flex w-full items-center justify-center gap-2"
              >
                <LogIn className="h-4 w-4" />
                {isSubmitting ? '参加中…' : '招待を受けて参加する'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
