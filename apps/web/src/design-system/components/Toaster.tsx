'use client';

/**
 * Toaster — monta o ToastProvider e renderiza a fila do use-toast store.
 * Montado uma vez no root layout.
 * @module design-system/components/Toaster
 */

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './Toast';
import { useToast } from './use-toast';

export function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <ToastProvider>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          variant={t.variant}
          open={t.open}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
        >
          <div className="grid gap-1">
            {t.title && <ToastTitle>{t.title}</ToastTitle>}
            {t.description && <ToastDescription>{t.description}</ToastDescription>}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
