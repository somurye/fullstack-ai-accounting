import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { components } from '../types/api.generated';

/** `GET /users/me` のレスポンス形状 (docs/openapi.yaml `components.schemas.User`) */
export type AuthUser = components['schemas']['User'];

/** `POST /auth/login` レスポンスの `data.tenants[]` 要素の形状 */
export interface AuthTenantSummary {
  tenant_id: string;
  tenant_name: string;
}

interface SetSessionParams {
  accessToken: string;
  refreshToken?: string | null;
  user?: AuthUser | null;
  tenants?: AuthTenantSummary[];
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  availableTenants: AuthTenantSummary[];
  /** `X-Tenant-ID` ヘッダーおよびJWTの `tenant_id` クレームと照合される現在のテナントID */
  currentTenantId: string | null;
}

interface AuthActions {
  /** ログイン/MFA検証成功時に呼び出し、トークンとユーザー情報をセットする */
  setSession: (params: SetSessionParams) => void;
  /** ヘッダーのテナント切替ドロップダウン等から呼び出す */
  setCurrentTenant: (tenantId: string) => void;
  /** `GET /users/me` 取得後にプロフィール情報を更新する */
  setUser: (user: AuthUser) => void;
  /** ログアウト、または401受信時にセッションを破棄する */
  logout: () => void;
}

export type AuthStore = AuthState & AuthActions;

const initialState: AuthState = {
  accessToken: null,
  refreshToken: null,
  user: null,
  availableTenants: [],
  currentTenantId: null,
};

/**
 * authStore
 * =========
 * ログインセッション(アクセストークン・ユーザー情報)と選択中テナントIDを
 * `localStorage` へ永続化するグローバルストア。
 *
 * `src/lib/apiClient.ts` のaxiosリクエストインターセプターが
 * `useAuthStore.getState()` を直接参照し、`Authorization` / `X-Tenant-ID`
 * ヘッダーを自動付与する(Reactコンポーネントツリー外からの参照のため
 * フックではなくストアインスタンスを直接使用する)。
 *
 * 【セキュリティ上の注意】
 * XSS対策としてはhttpOnly Cookieでのトークン保持がより安全だが、
 * 本SPA構成ではAPIサーバーとオリジンが異なる場合があるため、
 * 要件に従いlocalStorage永続化を採用している。CSPの適切な設定や
 * 依存パッケージの脆弱性管理と併せて運用することを前提とする。
 */
export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      ...initialState,

      setSession: ({ accessToken, refreshToken = null, user = null, tenants = [] }) => {
        set((state) => {
          // 空文字は「未選択」と同義に扱う(過去に空文字が永続化された場合の
          // 自己修復も兼ねる)。`??` は `""` にはフォールバックしないため `||` を使う。
          const existingCurrentTenantId = state.currentTenantId || null;
          return {
            accessToken,
            refreshToken,
            user: user ?? state.user,
            availableTenants: tenants.length > 0 ? tenants : state.availableTenants,
            currentTenantId:
              existingCurrentTenantId ??
              tenants[0]?.tenant_id ??
              state.availableTenants[0]?.tenant_id ??
              null,
          };
        });
      },

      setCurrentTenant: (tenantId) => {
        if (!tenantId) return;
        set((state) => {
          // テナント一覧が既知の場合、そこに存在しないIDへの切替は無視する
          // (不正な値や、選択肢が確定する前の中途半端なonChangeイベント対策)。
          if (
            state.availableTenants.length > 0 &&
            !state.availableTenants.some((tenant) => tenant.tenant_id === tenantId)
          ) {
            return state;
          }
          return { ...state, currentTenantId: tenantId };
        });
      },

      setUser: (user) => {
        set({ user });
      },

      logout: () => {
        set({ ...initialState });
      },
    }),
    {
      name: 'keiri-kaikei-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        availableTenants: state.availableTenants,
        currentTenantId: state.currentTenantId,
      }),
    },
  ),
);

/** Reactコンポーネント外(axiosインターセプター等)から現在のセッション状態を取得する */
export function getAuthSnapshot(): AuthState {
  return useAuthStore.getState();
}

/** アクセストークンと選択中テナントの両方が揃っているかどうか */
export function isAuthenticated(): boolean {
  const { accessToken, currentTenantId } = useAuthStore.getState();
  return Boolean(accessToken && currentTenantId);
}
