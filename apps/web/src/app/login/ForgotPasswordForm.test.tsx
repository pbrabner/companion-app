/// <reference types="@testing-library/jest-dom" />
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForgotPasswordForm } from './ForgotPasswordForm';

const resetPasswordForEmailMock = vi.fn();

vi.mock('../../shared/db/browser', () => ({
  createBrowserClient: vi.fn(() => ({
    auth: {
      resetPasswordForEmail: resetPasswordForEmailMock,
    },
  })),
}));

beforeEach(() => {
  resetPasswordForEmailMock.mockReset();
});

describe('ForgotPasswordForm', () => {
  it('renders email input + submit button disabled (empty)', () => {
    render(<ForgotPasswordForm onBack={() => {}} />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /enviar link de reset/i }),
    ).toBeDisabled();
  });

  it('enables button com email válido', async () => {
    render(<ForgotPasswordForm onBack={() => {}} />);

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com');

    expect(
      screen.getByRole('button', { name: /enviar link de reset/i }),
    ).toBeEnabled();
  });

  it('transitions to sent após resetPasswordForEmail success', async () => {
    resetPasswordForEmailMock.mockResolvedValueOnce({ error: null });

    render(<ForgotPasswordForm onBack={() => {}} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com');
    await userEvent.click(
      screen.getByRole('button', { name: /enviar link de reset/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/verifica seu email/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/se esse email está cadastrado/i),
    ).toBeInTheDocument();
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith(
      'user@example.com',
      expect.objectContaining({
        redirectTo: expect.stringContaining('/auth/reset-password'),
      }),
    );
  });

  it('shows error message on error', async () => {
    resetPasswordForEmailMock.mockResolvedValueOnce({
      error: { message: 'Rate limit exceeded' },
    });

    render(<ForgotPasswordForm onBack={() => {}} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com');
    await userEvent.click(
      screen.getByRole('button', { name: /enviar link de reset/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/rate limit exceeded/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /enviar link de reset/i }),
    ).toBeEnabled();
  });

  it('disables button during sending', async () => {
    let resolveReset: (value: { error: null }) => void = () => {};
    resetPasswordForEmailMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReset = resolve;
      }),
    );

    render(<ForgotPasswordForm onBack={() => {}} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com');
    await userEvent.click(
      screen.getByRole('button', { name: /enviar link de reset/i }),
    );

    expect(screen.getByRole('button', { name: /enviando/i })).toBeDisabled();

    resolveReset({ error: null });
    await waitFor(() => {
      expect(screen.getByText(/verifica seu email/i)).toBeInTheDocument();
    });
  });

  it('calls onBack ao clicar voltar', async () => {
    const onBack = vi.fn();
    render(<ForgotPasswordForm onBack={onBack} />);

    await userEvent.click(
      screen.getByRole('button', { name: /voltar pro login/i }),
    );

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
