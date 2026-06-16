/**
 * Unit tests for buildReflectionSystemPrompt (read-feedback da micro-memória).
 * Função pura — sem mocks. CA-MM-8 / CA-MM-8b a nível de composição.
 * @module shared/ai/prompts/reflection-empathic.test
 */

import { describe, expect, it } from 'vitest';

import { buildReflectionSystemPrompt, REFLECTION_EMPATHIC_SYSTEM_PROMPT } from './reflection-empathic';
import type { MemoryFinding } from '@/shared/memory/types';

function finding(text: string): MemoryFinding {
  return { text, confidence: 0.5, first_seen: 'a', last_seen: 'b', evidence_count: 3 };
}

describe('buildReflectionSystemPrompt', () => {
  it('CA-MM-8b: array vazio → prompt base puro (sem bloco)', () => {
    const out = buildReflectionSystemPrompt([]);
    expect(out).toBe(REFLECTION_EMPATHIC_SYSTEM_PROMPT);
  });

  it('input falsy (cast) → prompt base puro', () => {
    const out = buildReflectionSystemPrompt(undefined as unknown as MemoryFinding[]);
    expect(out).toBe(REFLECTION_EMPATHIC_SYSTEM_PROMPT);
  });

  it('CA-MM-8: com findings → base + bloco com cada finding.text', () => {
    const out = buildReflectionSystemPrompt([finding('padrão A'), finding('padrão B')]);
    expect(out.startsWith(REFLECTION_EMPATHIC_SYSTEM_PROMPT)).toBe(true);
    expect(out).toContain('Contexto acumulado');
    expect(out).toContain('- padrão A');
    expect(out).toContain('- padrão B');
  });

  it('bloco é anexado com separador de nova linha (não concatenado direto)', () => {
    const out = buildReflectionSystemPrompt([finding('x')]);
    // logo após o prompt base deve haver uma quebra de linha antes do bloco
    expect(out.slice(REFLECTION_EMPATHIC_SYSTEM_PROMPT.length).startsWith('\n')).toBe(true);
  });
});
