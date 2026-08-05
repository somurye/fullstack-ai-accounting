import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useToastStore, type ToastVariant } from '../../stores/toastStore';
import { cn } from '../../lib/utils';

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'border-positive/30 bg-surface-900',
  error: 'border-negative/30 bg-surface-900',
  info: 'border-info/30 bg-surface-900',
};

const VARIANT_ICON: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const VARIANT_ICON_COLOR: Record<ToastVariant, string> = {
  success: 'text-positive',
  error: 'text-negative',
  info: 'text-info',
};

/** `AppLayout` にマウントするグローバルトースト通知の表示先。`toastStore` の状態を購読する */
export function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const Icon = VARIANT_ICON[t.variant];
        return (
          <div
            key={t.id}
            role="alert"
            className={cn(
              'card pointer-events-auto flex items-start gap-2.5 border p-3.5 shadow-panel-lg',
              VARIANT_STYLES[t.variant],
            )}
          >
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', VARIANT_ICON_COLOR[t.variant])} />
            <p className="flex-1 text-sm text-surface-100">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="text-surface-500 transition-colors hover:text-surface-200"
              aria-label="閉じる"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
