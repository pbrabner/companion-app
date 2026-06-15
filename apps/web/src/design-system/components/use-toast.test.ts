/**
 * Tests for use-toast store — fila, dismiss, TOAST_LIMIT. CA-UI-6.
 * @module design-system/components/use-toast.test
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToast, toast, TOAST_LIMIT, __resetToastsForTest } from './use-toast';

describe('use-toast', () => {
  beforeEach(() => {
    __resetToastsForTest();
  });

  it('CA-UI-6a: toast() adiciona à fila', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: 'Oi', description: 'desc' });
    });
    expect(result.current.toasts.length).toBeGreaterThanOrEqual(1);
    expect(result.current.toasts[0]?.title).toBe('Oi');
  });

  it('CA-UI-6b: dismiss marca o toast como fechado (open=false) ou remove', () => {
    const { result } = renderHook(() => useToast());
    let id = '';
    act(() => {
      id = toast({ title: 'Some' }).id;
    });
    act(() => {
      result.current.dismiss(id);
    });
    const t = result.current.toasts.find((x) => x.id === id);
    expect(t === undefined || t.open === false).toBe(true);
  });

  it('CA-UI-6c: TOAST_LIMIT respeitado (fila não cresce além do limite)', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      for (let i = 0; i < TOAST_LIMIT + 3; i++) toast({ title: `t${i}` });
    });
    expect(result.current.toasts.length).toBeLessThanOrEqual(TOAST_LIMIT);
  });
});
