/**
 * Tipos + validação de shape da micro-memória. findings são abstrações
 * (não conteúdo cru). Validação descarta entries malformadas e trunca em MAX.
 * @module shared/memory/types
 */

export const MAX_FINDINGS = 20;
export const SYNTHESIS_THRESHOLD = 3;

export type MemoryFinding = {
  text: string;
  confidence: number;
  first_seen: string;
  last_seen: string;
  evidence_count: number;
};

function isFinding(v: unknown): v is MemoryFinding {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.text === 'string' && f.text.length > 0 &&
    typeof f.confidence === 'number' &&
    typeof f.first_seen === 'string' &&
    typeof f.last_seen === 'string' &&
    typeof f.evidence_count === 'number'
  );
}

/** Valida e normaliza um array desconhecido de findings (do modelo ou do DB). */
export function sanitizeFindings(raw: unknown): MemoryFinding[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isFinding).slice(0, MAX_FINDINGS);
}
