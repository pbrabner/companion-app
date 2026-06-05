/// <reference types="@testing-library/jest-dom" />
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LogoutButton } from './LogoutButton';

const signOutMock = vi.fn();
const routerPushMock = vi.fn();

vi.mock('../../shared/db/browser', () => ({
  createBrowserClient: vi.fn(() => ({
    auth: { signOut: signOutMock },
  })),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: routerPushMock })),
}));

beforeEach(() => {
  signOutMock.mockReset();
  routerPushMock.mockReset();
});

describe('LogoutButton', () => {
  it('renders button with label "Sair" in idle state', () => {
    render(<LogoutButton />);
    expect(screen.getByRole('button', { name: /sair/i })).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('shows user email when provided', () => {
    render(<LogoutButton userEmail="user@example.com" />);
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
  });

  it('disables button during signing_out (pending signOut)', async () => {
    let resolveSignOut: (value: { error: null }) => void = () => {};
    signOutMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSignOut = resolve;
      }),
    );

    render(<LogoutButton />);
    const button = screen.getByRole('button', { name: /sair/i });
    await userEvent.click(button);

    expect(screen.getByRole('button', { name: /saindo/i })).toBeDisabled();

    resolveSignOut({ error: null });
    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith('/login');
    });
  });

  it('calls router.push("/login") on successful signOut', async () => {
    signOutMock.mockResolvedValueOnce({ error: null });

    render(<LogoutButton />);
    await userEvent.click(screen.getByRole('button', { name: /sair/i }));

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' });
      expect(routerPushMock).toHaveBeenCalledWith('/login');
    });
  });

  it('shows error message and re-enables button on signOut error', async () => {
    signOutMock.mockResolvedValueOnce({
      error: { message: 'Network unreachable' },
    });

    render(<LogoutButton />);
    await userEvent.click(screen.getByRole('button', { name: /sair/i }));

    await waitFor(() => {
      expect(screen.getByText(/network unreachable/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /sair/i })).toBeEnabled();
    expect(routerPushMock).not.toHaveBeenCalled();
  });
});
