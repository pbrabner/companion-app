/// <reference types="@testing-library/jest-dom" />
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LoginForm } from './LoginForm';

vi.mock('../../shared/db/browser', () => ({
  createBrowserClient: vi.fn(() => ({
    auth: {
      signInWithOtp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  })),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

describe('LoginForm — forgot password flow', () => {
  it('renders "Esqueci minha senha" link', () => {
    render(<LoginForm />);
    expect(
      screen.getByRole('button', { name: /esqueci minha senha/i }),
    ).toBeInTheDocument();
  });

  it('click link mostra ForgotPasswordForm', async () => {
    render(<LoginForm />);

    await userEvent.click(
      screen.getByRole('button', { name: /esqueci minha senha/i }),
    );

    // ForgotPasswordForm headline
    expect(
      screen.getByRole('heading', { name: /esqueci minha senha/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /enviar link de reset/i }),
    ).toBeInTheDocument();
    // Original "Enviar link" do magic link sumiu
    expect(
      screen.queryByRole('button', { name: /^enviar link$/i }),
    ).not.toBeInTheDocument();
  });

  it('onBack retorna ao idle login', async () => {
    render(<LoginForm />);

    await userEvent.click(
      screen.getByRole('button', { name: /esqueci minha senha/i }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /voltar pro login/i }),
    );

    expect(
      screen.getByRole('heading', { name: /entrar no companion/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^enviar link$/i }),
    ).toBeInTheDocument();
  });
});
