import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (variant: ToastVariant, message: string) => void;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION_MS = 5_000;

/**
 * toastStore
 * ==========
 * 画面右下に積み上げ表示するトースト通知の状態管理。`authStore` と同様、
 * axiosインターセプター等のReactツリー外からも `useToastStore.getState().push()` で
 * 呼び出せるようにストアインスタンスを直接公開する。
 */
export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (variant, message) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, variant, message }] }));
    setTimeout(() => get().dismiss(id), DEFAULT_DURATION_MS);
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

/** コンポーネント外(ミューテーションのonErrorハンドラ等)から呼び出す薄いヘルパー */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
};
