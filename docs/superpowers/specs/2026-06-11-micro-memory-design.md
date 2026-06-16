# Spec — Micro-memória cumulativa (slice vertical A+B+C)

Feature: micro-memory
Status: APPROVED em brainstorming Pacini ↔ Legion, 2026-06-11
Workflow: `micro-memory` (Production Playbook, risk desenvolvimento, owner pacini)
Épico: micro-memória cumulativa IA. Esta spec é o slice vertical A+B+C; D (UI) e E (retry) ficam pra specs seguintes.
Specs relacionadas: 2026-06-11-reflections-history-design.md (ai_response persistido — o insumo), docs/specs/2026-05-04-T-009-submit-reflection.md (POST /api/reflect + privacy gate)

---

## 1. Objetivo

Dar ao Companion uma **memória cumulativa cross-temporal** dos padrões do usuário, sintetizada da própria série de reflexões + respostas da IA, e alimentá-la de volta no `/reflect` pra que o Sonnet responda com consciência de padrões longos — mandando findings compactos (high-context) em vez de reflexões cruas (low-read).

## 2. Realidade de partida (verificada 2026-06-11)

A memória de roadmap descrevia um pipeline de 4 camadas, mas **camadas 2-3 nunca existiram**:
- ✅ `journal_entries` raw (live + repo), com `ai_response`/`ai_response_at` persistidos (PR #10)
- ❌ `insights_jsonb` por reflexão (T-010) — nunca construído
- ❌ `weekly_insights` (PRD M2) — nunca construído
- `user_insights` (patterns_json) existe nas migrations mas NÃO no live e nunca foi ligada a nada (dormente; não reusada — ver D-MM-2)
- **Sem cron/job infra** no Companion (sem vercel.json). Por isso o trigger é on-demand (D-MM-1).
- AI client tem `chatStream` (Sonnet) e `classifyHaiku` (Haiku→JSON). **Nenhum** tem fallback Gemini no main (vive em branch abandonada `feat/ai-provider-fallback`) — esta spec adiciona fallback focado ao `classifyHaiku` (D-MM-6).

A consequência: a micro-memória sintetiza **direto** de reflexões raw + ai_response, pulando o pipeline intermediário que nunca foi feito.

## 3. Decisões (brainstorming 2026-06-11)

- **D-MM-1:** Trigger on-demand com threshold (não cron — não existe). Síntese best-effort após o /reflect, quando ≥ N reflexões novas desde a última síntese.
- **D-MM-2:** Tabela nova `user_memory` (1 linha/user, findings jsonb array) — não reusar `user_insights` (semântica pobre, e estaria igualmente fora do live).
- **D-MM-3:** Síntese via Haiku (`classifyHaiku`) — barato, coerente com "read-cheap".
- **D-MM-4:** N (threshold) = 3 reflexões novas; cap de 20 findings no array.
- **D-MM-5:** Síntese e leitura rodam com a **session do usuário** (RLS owner — a memória do usuário é mutável por ele), sem service role.
- **D-MM-6:** Fallback Gemini focado no `classifyHaiku` (Haiku falha → Gemini, mesmo prompt+validação). Branch `feat/ai-provider-fallback` é referência, não merge. `chatStream` fallback fica pra backlog.

## 4. Escopo

### 4.1 Armazenamento (A)

**Migration `supabase/migrations/0009_user_memory.sql`:**
```sql
-- migration: 0009_user_memory
-- purpose: micro-memoria cumulativa de findings da IA por usuario (slice A).
-- spec: docs/superpowers/specs/2026-06-11-micro-memory-design.md
-- Apply no live: MANUAL via SQL Editor (drift conhecido). NAO db push.
CREATE TABLE public.user_memory (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  findings            jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_synthesized_at timestamptz NULL,
  source_count        integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_select ON public.user_memory
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY owner_insert ON public.user_memory
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY owner_update ON public.user_memory
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY owner_delete ON public.user_memory
  FOR DELETE TO authenticated USING (user_id = auth.uid());
```

`types.ts` regenerado no mesmo PR (container descartável + `gen types --db-url`, pattern do PR #9).

**Shape de um finding** (TS, no array `findings`):
```ts
type MemoryFinding = {
  text: string;            // abstração, ex: "Padrão de ansiedade pré-reuniões"
  confidence: number;      // 0..1
  first_seen: string;      // ISO
  last_seen: string;       // ISO
  evidence_count: number;  // nº de reflexões que sustentam
};
```

### 4.2 Síntese (B)

**Módulo `apps/web/src/shared/memory/synthesize.ts`** + prompt versionado `apps/web/src/shared/ai/prompts/memory-synthesis.ts`.

**Trigger** (dentro do POST /api/reflect, best-effort após salvar ai_response, com timeout 5s — padrão do `saveAiResponse`):
- Conta reflexões com `created_at > last_synthesized_at` (ou todas, se NULL). Se `< N(3)` → no-op silencioso.
- Se `≥ N` → roda `synthesizeMemory(userId, supabase)`.

**`synthesizeMemory`** (incremental):
1. Lê `user_memory` do usuário (cria linha vazia se não existe).
2. Busca reflexões novas desde `last_synthesized_at` (body + ai_response), cap 20 mais recentes (bound de tokens).
3. `classifyHaiku` com `MEMORY_SYNTHESIS_PROMPT`: recebe findings atuais + reflexões novas; instrução = reforçar findings existentes (sobe confidence/evidence_count, atualiza last_seen), adicionar novos padrões, fundir duplicatas; devolver array completo, **máx 20**, ordenado por relevância; PT-BR; conservador (evidência fraca → confidence baixa, não inventar padrão de 1 reflexão); findings são **abstrações**, nunca cópia literal de conteúdo sensível.
4. Valida o JSON contra o shape (cada finding tem os 5 campos, tipos corretos; descarta entries malformadas; trunca em 20).
5. Grava `findings` + `last_synthesized_at = now()` + `source_count` via session do usuário.

**Erros/edge:**
- Haiku falha (e Gemini falha) ou JSON inválido → log estrutural sem conteúdo; `last_synthesized_at` **não avança** (re-tenta); findings antigos permanecem.
- Sem reflexões novas suficientes → no-op.
- Primeira síntese → array do zero.
- Timeout 5s → aborta sem travar o close do stream.

**Fallback Gemini no `classifyHaiku`** (MODIFY `apps/web/src/shared/ai/client.ts`):
- `classifyHaiku` tenta Anthropic Haiku; em erro de disponibilidade (APIError/APIConnectionError/timeout), chama Gemini (`@google/genai`, modelo `gemini-flash` equivalente) com o mesmo prompt JSON + mesma validação (parse + narrow).
- `@google/genai` nova dep; `GEMINI_API_KEY` lido lazy (padrão do `createClient`).
- Ambos falham → throw (a síntese trata como no-op best-effort).

### 4.3 Read-feedback (C)

**MODIFY `apps/web/src/app/api/reflect/route.ts`** — antes do `chatStream`:
1. `SELECT findings FROM user_memory WHERE user_id` (session do usuário, RLS).
2. `buildReflectionSystemPrompt(findings)` (função nova em `prompts/reflection-empathic.ts`) — concatena o `REFLECTION_EMPATHIC_SYSTEM_PROMPT` base + bloco de memória compacto; vazio/sem findings → retorna o prompt base puro.
3. Passa o resultado como `system` do `chatStream`.

**Bloco de memória** (instrução de sensibilidade embutida):
```
[Contexto acumulado sobre quem escreve — use com sensibilidade, não cite
literalmente nem confronte, não despeje contagens:]
- <finding.text>
- ...
```

**Privacy/sensibilidade ★ALTO:** prompt instrui o Sonnet a usar como tom, não como conteúdo. Findings (abstrações) vão pro Sonnet — mesma fronteira Anthropic do chatStream. Findings NUNCA em logs.

**Edge:** findings vazios/malformados → degrada pro prompt base. Leitura falha → best-effort, reflexão acontece sem memória.

### 4.4 Não inclui (specs seguintes do épico)

- ❌ D — UI que mostra os findings pro usuário ("o que o Companion aprendeu")
- ❌ E — retry button pra reflexões com ai_response NULL
- ❌ Fallback Gemini no `chatStream` (/reflect) — backlog
- ❌ Camadas insights_jsonb / weekly_insights (nunca foram feitas; micro-memória as torna desnecessárias pro objetivo atual)
- ❌ Cron/agendamento — quando houver infra, o trigger pode migrar de on-demand pra agendado

## 5. Critérios de aceite

| CA | Dado/Quando/Então | Verificação |
|---|---|---|
| CA-MM-1 | Migration 0009 cria user_memory + 4 RLS owner; types.ts ganha user_memory | migration + types diff |
| CA-MM-2 | < 3 reflexões novas desde last_synthesized_at → síntese NÃO dispara (no-op) | synthesize.test |
| CA-MM-3 | ≥ 3 novas → classifyHaiku chamado com findings atuais + reflexões novas | synthesize.test |
| CA-MM-4 | Síntese reforça finding existente (evidence_count↑, last_seen atualiza) e adiciona novo; cap 20 respeitado | synthesize.test |
| CA-MM-5 | JSON inválido do modelo → last_synthesized_at NÃO avança, findings antigos mantidos | synthesize.test |
| CA-MM-6 ★ALTO | Conteúdo de reflexão (sentinel) NUNCA em logs durante síntese | synthesize.test sentinel |
| CA-MM-7 | classifyHaiku: Haiku ok → usa Haiku; Haiku indisponível → usa Gemini; ambos falham → throw | client.test |
| CA-MM-8 | /reflect com findings → chatStream recebe system prompt com bloco de memória; sem findings → prompt base puro | reflect route.test |
| CA-MM-9 | Síntese é best-effort: falha/timeout não afeta o stream nem o ai_response | reflect route.test |
| CA-MM-10 | Suite + typecheck + build verdes | QA gate |
| CA-MM-11 | Smoke live: ≥3 reflexões → findings gerados; reflexão seguinte responde com awareness | gate humano Pacini |

## 6. Arquitetura — unidades

- `supabase/migrations/0009_user_memory.sql` — schema + RLS
- `apps/web/src/shared/memory/synthesize.ts` — `synthesizeMemory(userId, supabase)` + helper de threshold/validação
- `apps/web/src/shared/memory/types.ts` — `MemoryFinding`, validação de shape
- `apps/web/src/shared/ai/prompts/memory-synthesis.ts` — prompt versionado
- `apps/web/src/shared/ai/client.ts` — fallback Gemini no `classifyHaiku` (MODIFY)
- `apps/web/src/shared/ai/prompts/reflection-empathic.ts` — `buildReflectionSystemPrompt(findings)` (MODIFY)
- `apps/web/src/app/api/reflect/route.ts` — read-feedback (pré-chatStream) + trigger de síntese best-effort (pós-ai_response) (MODIFY)

## 7. Sequência de build

1. Migration 0009 + types regen
2. Fallback Gemini no classifyHaiku (+ dep @google/genai) + testes
3. memory/types + synthesize (incremental, validação, threshold) + testes (mock classifyHaiku)
4. read-feedback: buildReflectionSystemPrompt + wiring no /reflect (leitura pré-stream) + testes
5. trigger: chamada de síntese best-effort pós-ai_response no /reflect + testes
6. QA + review + smoke live (gate humano)

## 8. Riscos

- **Custo/latência da síntese:** mitigado por threshold (1 a cada ≥3 reflexões) + cap 20 + timeout 5s + best-effort. Haiku é barato.
- **Qualidade dos findings:** prompt conservador; confidence reflete evidência. Avaliável no smoke (CA-MM-11). Findings ruins não quebram nada (só informam tom).
- **Apply live da 0009:** manual via SQL Editor (passo do gate humano, antes do smoke). `user_memory` é tabela nova — sem conflito com schema live.
- **Gemini dep:** `GEMINI_API_KEY` precisa estar no env do servidor; sem ela o fallback lança e a síntese vira no-op (não quebra). Verificar no Task de fallback.
- **Privacy:** findings são abstrações por design (prompt força); RLS owner-only; nunca em logs. Mesma fronteira Anthropic já aceita.
