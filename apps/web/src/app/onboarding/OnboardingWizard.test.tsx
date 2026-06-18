import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingWizard } from './OnboardingWizard';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('../../design-system/components/use-toast', () => ({ toast: vi.fn() }));

const TRACKS = [
  { slug: 'disciplina', title: 'Disciplina', description: 'desc d' },
  { slug: 'regulacao-emocional', title: 'Regulação Emocional', description: 'desc r' },
  { slug: 'direcao', title: 'Direção', description: 'desc dir' },
];

beforeEach(() => {
  vi.clearAllMocks();
  pushMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('OnboardingWizard', () => {
  it('CA-OB-4: 3 passos, aceita → trilha → baseline → submit → push /reflect', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const user = userEvent.setup();
    render(<OnboardingWizard tracks={TRACKS} />);

    await user.click(screen.getByRole('button', { name: /Aceito/i }));
    await user.click(screen.getByText('Disciplina'));
    await user.click(screen.getByRole('button', { name: /Avançar/i }));
    await user.click(screen.getByRole('button', { name: 'Humor 4' }));
    await user.click(screen.getByLabelText('Trabalho'));
    await user.click(screen.getByRole('button', { name: /Concluir/i }));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/onboarding',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1].body);
    expect(body).toEqual({ accepted: true, track: 'disciplina', mood: 4, areas: ['trabalho'] });
    expect(pushMock).toHaveBeenCalledWith('/reflect');
  });

  it('não avança da trilha sem escolher uma', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard tracks={TRACKS} />);
    await user.click(screen.getByRole('button', { name: /Aceito/i }));
    expect(screen.getByRole('button', { name: /Avançar/i })).toBeDisabled();
  });

  it('não conclui sem humor + ao menos 1 área', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard tracks={TRACKS} />);
    await user.click(screen.getByRole('button', { name: /Aceito/i }));
    await user.click(screen.getByText('Disciplina'));
    await user.click(screen.getByRole('button', { name: /Avançar/i }));
    expect(screen.getByRole('button', { name: /Concluir/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Humor 3' }));
    expect(screen.getByRole('button', { name: /Concluir/i })).toBeDisabled();
  });
});
