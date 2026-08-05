import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('メールアドレスの形式が不正です'),
  password: z.string().min(1, 'パスワードを入力してください'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaVerifySchema = z.object({
  mfa_token: z.string().min(1, 'mfa_tokenは必須です'),
  code: z.string().regex(/^\d{6}$/, 'MFAコードは6桁の数字で入力してください'),
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

/**
 * `docs/openapi.yaml` の `/auth/logout` にはrequestBodyの定義がない
 * (Authorizationヘッダーのアクセストークンのみが必須情報として設計されている)。
 * 実務上は「今使っているクライアントのリフレッシュトークンだけを失効させたい」
 * ケースもあるため、任意で `refresh_token` を受け付け、指定が無ければそのユーザーの
 * 全セッションを失効させる(全端末ログアウト相当)。
 */
export const logoutSchema = z.object({
  refresh_token: z.string().optional(),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

export const signupSchema = z.object({
  email: z.string().email('メールアドレスの形式が不正です'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
  name: z.string().min(1, 'お名前を入力してください'),
  tenant_name: z.string().min(1, '会社名を入力してください'),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const validateInvitationSchema = z.object({
  token: z.string().min(1, 'tokenは必須です'),
});
export type ValidateInvitationInput = z.infer<typeof validateInvitationSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(1, 'tokenは必須です'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
  name: z.string().min(1, 'お名前を入力してください'),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
