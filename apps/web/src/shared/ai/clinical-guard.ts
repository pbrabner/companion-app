/**
 * Runtime clinical language guard for Companion reflection responses.
 *
 * Detects diagnostic, prescriptive, or judgmental language in AI-generated
 * text using a deny-list of PT-BR patterns. Called before streaming buffered
 * responses to the client — triggers retry with stricter prompt or safe
 * fallback (see route.ts).
 *
 * Patterns mirror the eval test deny-list in reflection-empathic.eval.test.ts
 * (E1-E5) so unit coverage and eval coverage stay in sync.
 *
 * @module shared/ai/clinical-guard
 */

/** Deny-list of PT-BR patterns that constitute clinical/prescriptive/judgmental language. */
export const CLINICAL_PATTERNS = [
  // Directive 1 — no diagnosis
  "você tem ansiedade",
  "você tem depressão",
  "você tem tdah",
  "você sofre de",
  "transtorno",
  "seu diagnóstico",
  // Directive 2 — no prescription
  "tome ",
  "medicamento",
  "remédio",
  "antidepressivo",
  "ansiolítico",
  // Directive 3 — no moral judgment
  "você está errado",
  "você está certo",
  // Directive 4 — no labeling
  "narcisista",
  "tóxico",
  "dependente emocional",
] as const;

/**
 * Safe fallback sent when both primary and retry AI responses contain
 * clinical language. Intentionally generic and non-prescriptive.
 */
export const CLINICAL_SAFE_FALLBACK =
  "Obrigado por compartilhar isso comigo. O que você escreveu parece importante. " +
  "Se sentir que seria útil conversar com alguém de confiança ou um profissional de saúde mental, " +
  "essa pode ser uma opção valiosa.";

/**
 * Returns true if the text contains any pattern from CLINICAL_PATTERNS.
 * Case-insensitive. Input is expected to be plain text (no HTML).
 */
export function hasClinicalLanguage(text: string): boolean {
  const lower = text.toLowerCase();
  return CLINICAL_PATTERNS.some((p) => lower.includes(p));
}
