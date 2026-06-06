/// <reference types="@testing-library/jest-dom" />
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ResetPasswordForm } from './ResetPasswordForm';

type AuthCallback = (event: string, session: unknown) => void;

let authCallback: AuthCallback | null = null;
const unsubscribeMock = vi.fn();
const onAuthStateChangeMock = vi.fn((cb: AuthCallback) => {
  authCallback = cb;
  return {
    data: { subscription: { unsubscribe: unsubscribeMock } },
  };
});
const updateUserMock = vi.fn();
const routerReplaceMock = vi.fn();

vi.mock('../../../shared/db/browser', () => ({
  createBrowserClient: vi.fn(() => ({
    auth: {
      onAuthStateChange: onAuthStateChangeMock,
      updateUser: updateUserMock,
    },
  })),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ replace: routerReplaceMock })),
}));

beforeEach(() => {
  authCallback = null;
  unsubscribeMock.mockReset();
  onAuthStateChangeMock.mockClear();
  updateUserMock.mockReset();
  routerReplaceMock.mockReset();
});

function fireRecovery() {
  act(() => {
    authCallback?.('PASSWORD_RECOVERY', { user: { id: 'u1' } });
  });
}

describe('ResetPasswordForm', () => {
  it('renders "Verificando link..." em waiting', () => {
    render(<ResetPasswordForm />);
    expect(screen.getByText(/verificando link/i)).toBeInTheDocument();
  });

  it('transitions to ready após PASSWORD_RECOVERY event', async () => {
    render(<ResetPasswordForm />);
    expect(authCallback).not.toBeNull();

    fireRecovery();

    expect(
      await screen.findByRole('heading', { name: /nova senha/i }),
    ).toBeInTheDocument();
  });

  it('shows invalid_link após timeout', async () => {
    vi.useFakeTimers();
    try {
      render(<ResetPasswordForm />);

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(
        screen.getByRole('heading', { name: /link inválido ou expirado/i }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables submit when passwords don't match", async () => {
    render(<ResetPasswordForm />);
    fireRecovery();
    await screen.findByLabelText(/^nova senha$/i);

    await userEvent.type(
      screen.getByLabelText(/^nova senha$/i),
      'longpassword',
    );
    await userEvent.type(
      screen.getByLabelText(/confirmar senha/i),
      'different123',
    );

    expect(
      screen.getByRole('button', { name: /atualizar senha/i }),
    ).toBeDisabled();
    expect(screen.getByText(/senhas não conferem/i)).toBeInTheDocument();
  });

  it('disables submit when password < 8 chars', async () => {
    render(<ResetPasswordForm />);
    fireRecovery();
    await screen.findByLabelText(/^nova senha$/i);

    await userEvent.type(screen.getByLabelText(/^nova senha$/i), 'short');
    await userEvent.type(screen.getByLabelText(/confirmar senha/i), 'short');

    expect(
      screen.getByRole('button', { name: /atualizar senha/i }),
    ).toBeDisabled();
    expect(
      screen.getByText(/^senha precisa ter pelo menos 8 caracteres/i),
    ).toBeInTheDocument();
  });

  it('calls updateUser({ password }) on submit + success → router.replace("/")', async () => {
    updateUserMock.mockResolvedValueOnce({ error: null });

    render(<ResetPasswordForm />);
    fireRecovery();
    await screen.findByLabelText(/^nova senha$/i);

    await userEvent.type(
      screen.getByLabelText(/^nova senha$/i),
      'longpassword',
    );
    await userEvent.type(
      screen.getByLabelText(/confirmar senha/i),
      'longpassword',
    );
    await userEvent.click(
      screen.getByRole('button', { name: /atualizar senha/i }),
    );

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({ password: 'longpassword' });
      expect(routerReplaceMock).toHaveBeenCalledWith('/');
    });
  });

  it('shows error on updateUser fail', async () => {
    updateUserMock.mockResolvedValueOnce({
      error: { message: 'Token expired' },
    });

    render(<ResetPasswordForm />);
    fireRecovery();
    await screen.findByLabelText(/^nova senha$/i);

    await userEvent.type(
      screen.getByLabelText(/^nova senha$/i),
      'longpassword',
    );
    await userEvent.type(
      screen.getByLabelText(/confirmar senha/i),
      'longpassword',
    );
    await userEvent.click(
      screen.getByRole('button', { name: /atualizar senha/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/token expired/i)).toBeInTheDocument();
    });
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it('disables button during submitting', async () => {
    let resolveUpdate: (value: { error: null }) => void = () => {};
    updateUserMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    render(<ResetPasswordForm />);
    fireRecovery();
    await screen.findByLabelText(/^nova senha$/i);

    await userEvent.type(
      screen.getByLabelText(/^nova senha$/i),
      'longpassword',
    );
    await userEvent.type(
      screen.getByLabelText(/confirmar senha/i),
      'longpassword',
    );
    await userEvent.click(
      screen.getByRole('button', { name: /atualizar senha/i }),
    );

    expect(
      screen.getByRole('button', { name: /atualizando/i }),
    ).toBeDisabled();

    resolveUpdate({ error: null });
    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith('/');
    });
  });
});
