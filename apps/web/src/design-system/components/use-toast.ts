'use client';

/**
 * use-toast — store global de toasts (padrão shadcn vendorado).
 * Fila com TOAST_LIMIT, dispatch via reducer, subscribers React.
 * @module design-system/components/use-toast
 */

import * as React from 'react';

export const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 5000;

export type ToasterToast = {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  open: boolean;
};

type Action =
  | { type: 'ADD'; toast: ToasterToast }
  | { type: 'DISMISS'; id?: string }
  | { type: 'REMOVE'; id?: string };

let count = 0;
function genId(): string {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return String(count);
}

let memoryState: { toasts: ToasterToast[] } = { toasts: [] };
const listeners: Array<(s: { toasts: ToasterToast[] }) => void> = [];
const removeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function reducer(state: { toasts: ToasterToast[] }, action: Action): { toasts: ToasterToast[] } {
  switch (action.type) {
    case 'ADD':
      return { toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) };
    case 'DISMISS':
      return {
        toasts: state.toasts.map((t) =>
          action.id === undefined || t.id === action.id ? { ...t, open: false } : t,
        ),
      };
    case 'REMOVE':
      return {
        toasts: action.id === undefined ? [] : state.toasts.filter((t) => t.id !== action.id),
      };
    default:
      return state;
  }
}

function dispatch(action: Action): void {
  memoryState = reducer(memoryState, action);
  for (const l of listeners) l(memoryState);
}

function scheduleRemove(id: string): void {
  if (removeTimers.has(id)) return;
  const timer = setTimeout(() => {
    removeTimers.delete(id);
    dispatch({ type: 'REMOVE', id });
  }, TOAST_REMOVE_DELAY);
  timer.unref?.();
  removeTimers.set(id, timer);
}

export function toast(opts: { title?: string; description?: string; variant?: 'default' | 'destructive' }): { id: string } {
  const id = genId();
  dispatch({ type: 'ADD', toast: { ...opts, id, open: true } });
  scheduleRemove(id);
  return { id };
}

export function useToast() {
  const [state, setState] = React.useState(memoryState);
  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const i = listeners.indexOf(setState);
      if (i > -1) listeners.splice(i, 1);
    };
  }, []);
  return {
    toasts: state.toasts,
    dismiss: (id?: string) => dispatch({ type: 'DISMISS', id }),
  };
}

/**
 * Reseta o estado module-level. APENAS para testes (isolamento entre casos).
 */
export function __resetToastsForTest(): void {
  for (const timer of removeTimers.values()) clearTimeout(timer);
  removeTimers.clear();
  memoryState = { toasts: [] };
  listeners.length = 0;
  count = 0;
}
