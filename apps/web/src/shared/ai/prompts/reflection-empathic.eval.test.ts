/**
 * Manual evaluation tests for the empathic reflection system prompt.
 * Skipped by default (network + cost) — run via:
 *   pnpm test -- --run reflection-empathic.eval
 * Each scenario sends real input to Sonnet via chatStream, aggregates the
 * response, and asserts no clinical/prescriptive language slipped through.
 * @module shared/ai/prompts/reflection-empathic.eval.test
 */
