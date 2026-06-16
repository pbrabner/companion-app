# Smoke CA-MM-11 — Micro-memória cumulativa (PR #12)

**Data:** 2026-06-16
**Operador:** Pacini
**Ambiente:** live Supabase ("Midnight Puppies", ref `fvdmhnxmheblvsdgjoyp`), dev server localhost:3000
**Migration:** 0009_user_memory aplicada no live por Pacini via SQL Editor

## Objetivo
Validar o pipeline ponta-a-ponta: escrever ≥3 reflexões → confirmar `user_memory.findings` populado.

## Resultado: PASS

Após 4 reflexões, query service-role em `user_memory`:

```
linhas em user_memory: 1
source_count: 4 | last_synthesized_at: 2026-06-16T22:53:37.029828+00:00
findings: 4
  - [conf 0.3, ev 1] Dificuldade de foco sustentado e tendência à hiperestimulação por multitarefas
  - [conf 0.3, ev 1] Sobrecarga por autocensura e adequação de tom em papéis de liderança
  - [conf 0.3, ev 1] Desgaste e cansaço antecipado diante de processos organizacionais ineficientes
  - [conf 0.3, ev 1] Estranhamento diante de respostas emocionais atenuadas em situações de perda
```

## O que ficou provado
- **A (storage):** tabela `user_memory` criada, RLS owner-scoped, findings gravados.
- **B (síntese):** disparou no threshold (≥3 reflexões), gerou findings **via fallback Gemini** (Anthropic ausente no ambiente) — valida o CA-MM-7 em produção real, não só mock.
- **Conservadorismo por design:** todos `confidence 0.3, evidence_count 1` — o prompt não fabrica padrões de alta confiança a partir de evidência esparsa.
- **Privacy ★ALTO:** findings são abstrações ("tendência à hiperestimulação"), não cópia do texto cru.
- **Best-effort:** `upsert_failed` pré-migração e `ai_unavailable` (Sonnet sem chave) não quebraram o fluxo — reflexões salvas, app estável.

## Nota
A 4ª reflexão não exibiu resposta com awareness porque o **Sonnet** (`chatStream`) está sem `ANTHROPIC_API_KEY` no ambiente — isso é independente da micro-memória. O read-feedback (C) lê os findings antes do stream; só a exibição final depende do Sonnet. Fallback Sonnet→Gemini fica como próximo ciclo.
