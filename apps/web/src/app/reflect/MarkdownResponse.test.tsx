/**
 * Tests for MarkdownResponse — renderiza markdown da resposta IA com
 * HTML cru ESCAPADO (sem rehype-raw). CA-UI-1..3.
 * @module app/reflect/MarkdownResponse.test
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownResponse } from './MarkdownResponse';

describe('MarkdownResponse', () => {
  it('CA-UI-1: **negrito** → <strong>', () => {
    const { container } = render(<MarkdownResponse>{'Isso é **importante** sim'}</MarkdownResponse>);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('importante');
  });

  it('CA-UI-2: lista markdown → <ul><li>', () => {
    const { container } = render(<MarkdownResponse>{'- primeiro\n- segundo'}</MarkdownResponse>);
    const items = container.querySelectorAll('ul li');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe('primeiro');
  });

  it('CA-UI-3 ★ALTO: <script> na resposta → texto escapado, NÃO elemento script', () => {
    const { container } = render(
      <MarkdownResponse>{'Antes <script>alert(1)</script> depois'}</MarkdownResponse>,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(/alert\(1\)/)).toBeTruthy();
  });

  it('renderiza parágrafo simples com a classe do tema', () => {
    const { container } = render(<MarkdownResponse>{'Oi mundo'}</MarkdownResponse>);
    const p = container.querySelector('p');
    expect(p?.textContent).toBe('Oi mundo');
    expect(p?.className).toContain('text-foreground');
  });
});
