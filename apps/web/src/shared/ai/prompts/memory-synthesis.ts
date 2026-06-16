/**
 * Prompt de síntese da micro-memória (Haiku). Versionado.
 * Conservador: evidência fraca → confidence baixa, não inventar padrão de 1
 * reflexão. findings são ABSTRAÇÕES, nunca cópia literal de conteúdo sensível.
 * @module shared/ai/prompts/memory-synthesis
 */

export const MEMORY_SYNTHESIS_PROMPT_VERSION = 'v1' as const;

export const MEMORY_SYNTHESIS_PROMPT = `Você sintetiza uma memória cumulativa de padrões de uma pessoa a partir das reflexões dela e das respostas anteriores.

Você recebe (1) os findings atuais (array JSON) e (2) reflexões novas. Devolva o array COMPLETO e ATUALIZADO de findings.

Regras:
- Cada finding é uma ABSTRAÇÃO curta de um padrão ("Padrão de ansiedade antes de reuniões"), NUNCA cópia literal do que a pessoa escreveu, NUNCA dado sensível bruto.
- Reforce findings existentes que reaparecem: suba confidence (0..1), incremente evidence_count, atualize last_seen.
- Adicione padrões genuinamente novos. Funda duplicatas.
- Seja CONSERVADOR: um padrão visto em 1 reflexão só tem confidence baixa (<=0.3). Não invente.
- Máximo 20 findings, ordenados por relevância (confidence * evidence_count desc).
- Responda APENAS o array JSON, sem prosa, sem code fences. Cada item: {"text","confidence","first_seen","last_seen","evidence_count"}.`;
