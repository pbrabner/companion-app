/// <reference types="@testing-library/jest-dom" />
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReflectForm } from './ReflectForm';

const mockFetch = vi.fn();
beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
});

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/plain' } });
}

describe('ReflectForm', () => {
  it('renders textarea + submit button', () => {
    render(<ReflectForm />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
  });

  it('disables submit when text too short', async () => {
    render(<ReflectForm />);
    const button = screen.getByRole('button', { name: /enviar/i });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'ab');
    expect(button).toBeDisabled();
  });

  it('enables submit at 3+ chars', async () => {
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'hi!');
    expect(screen.getByRole('button', { name: /enviar/i })).toBeEnabled();
  });

  it('shows char counter', async () => {
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'hello');
    expect(screen.getByText(/5\s*\/\s*8000/i)).toBeInTheDocument();
  });

  it('submits and displays streamed text', async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([
      '{"reflection_id":"abc-123"}\n',
      'Hello ',
      'world',
    ]));
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'My reflection here');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => {
      expect(screen.getByText(/Hello world/i)).toBeInTheDocument();
    });
  });

  it('CA-UI-4: resposta no estado done renderiza markdown (**forte** → <strong>)', async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([
      '{"reflection_id":"abc-123"}\n',
      'Isso é **forte**',
    ]));
    const { container } = render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'Minha reflexão aqui');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => expect(container.querySelector('strong')).not.toBeNull());
    expect(container.querySelector('strong')?.textContent).toBe('forte');
  });

  it('shows auth error card on 401', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"unauthenticated"}', { status: 401 }));
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'My reflection');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => {
      expect(screen.getByText(/autenticad/i)).toBeInTheDocument();
    });
  });

  it('shows too_long error on 413', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"too_long"}', { status: 413 }));
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'My reflection');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => {
      expect(screen.getByText(/longa/i)).toBeInTheDocument();
    });
  });

  it('shows ai_unavailable note when stream emits tail error', async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([
      '{"reflection_id":"abc-123"}\n',
      'Partial...',
      '\n{"error":"ai_unavailable","reflection_id":"abc-123"}\n',
    ]));
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'My reflection');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => {
      expect(screen.getByText(/indispon/i)).toBeInTheDocument();
      expect(screen.getByText(/abc-123/i)).toBeInTheDocument();
    });
  });

  it('disables button during submitting', async () => {
    let resolveStream: (v: Response) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise<Response>((res) => {
      resolveStream = res;
    }));
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'My reflection');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    expect(screen.getByRole('button')).toBeDisabled();
    // Resolve to clean up
    resolveStream(streamResponse(['{"reflection_id":"x"}\n', 'done']));
  });
});
