---
title: "Plan — T-009b: Clinical Guard (detecção runtime + retry + fallback safe)"
type: "Plano de Implementação"
purpose: "Plan TDD para T-009b — guarda de segurança que bufferiza a resposta do Sonnet, detecta linguagem clínica/diagnóstica via deny-list PT-BR, retenta com prompt mais estrito (1x) e cai pro fallback seguro se ambas falharem. Impede que linguagem clínica chegue ao cliente mesmo se o model escorregar do system prompt."
---

# T-009b — Clinical Guard: runtime detection + retry + safe fallback

**Goal:** Implementar camada de segurança em runtime que intercepta respostas do Sonnet antes de chegar ao cliente, detecta linguagem clínica/diagnóstica/prescritiva usando deny-list PT-BR, reenvia com prompt estrito (1 retry), e em último caso entrega texto fallback seguro e genérico.

**Problema:** O system prompt v1 (`reflection-empathic.ts`) define regras claras, mas LLMs podem ocasionalmente escorregar — especialmente em inputs com linguagem clínica forte (auto-diagnóstico, menção de medicamentos). O eval test (E1-E5) detecta isso em run manual, mas não há guarda em runtime que impeça o texto ruim de chegar ao browser.

**Arquitetura — decisão central: buffer antes de stream**
A resposta do Sonnet é **bufferizada completamente** antes de ser enviada ao cliente. Não é possível "tomar de volta" texto já enviado num stream. O cliente recebe o `reflection_id` imediatamente (1ª linha do stream, emitida antes do buffer), depois aguarda o texto verificado. Tradeoff intencional: latência adicional (~1-3s) vs garantia de segurança.

**Componentes:**
1. `apps/web/src/shared/ai/clinical-guard.ts` — `hasClinicalLanguage()` + `CLINICAL_SAFE_FALLBACK`
2. `apps/web/src/shared/ai/clinical-guard.test.ts` — unit tests
3. `apps/web/src/shared/ai/prompts/reflection-empathic.ts` — adiciona `REFLECTION_EMPATHIC_SYSTEM_PROMPT_STRICT`
4. `apps/web/src/app/api/reflect/route.ts` — buffer + guard + retry + fallback
5. `apps/web/src/app/api/reflect/route.test.ts` — novos cenários do guard
6. `notes/T-009b.md` — executor notes

**Escopo DENTRO:**
- Detecção por deny-list PT-BR (regex substring, case-insensitive)
- 1 retry com prompt estrito (`REFLECTION_EMPATHIC_SYSTEM_PROMPT_STRICT`)
- Fallback seguro se retry também clínico ou se retry lança erro
- Privacy gate mantido: guard logs nunca contêm conteúdo (user input ou AI response)
- Padrões do guard espelham o deny-list dos eval tests (E1-E5)

**Escopo FORA:**
- Classifier via Haiku (T-010b futuro — custo + latência adicionais por request)
- Detecção semântica (embeddings, NLI)
- Cache de respostas seguras
- UI feedback de "resposta foi revisada" (T-011b futuro)
- Suporte a idiomas além de PT-BR (próxima iteração)

**Critérios de aceite:**
- CA-1: `hasClinicalLanguage('')` retorna `false`
- CA-2: `hasClinicalLanguage` retorna `true` pra cada categoria: diagnóstico, prescrição, julgamento, rotulagem
- CA-3: Matching case-insensitive
- CA-4: `CLINICAL_PATTERNS` cobre todos os termos dos eval tests E1-E5
- CA-5: `CLINICAL_SAFE_FALLBACK` não aciona o próprio guard
- CA-6 (route): resposta limpa → cliente recebe texto do Sonnet sem retry
- CA-7 (route): resposta clínica → retry → cliente recebe texto do retry
- CA-8 (route): resposta clínica → retry também clínico → cliente recebe `CLINICAL_SAFE_FALLBACK`
- CA-9 (route): resposta clínica → retry lança erro → cliente recebe `CLINICAL_SAFE_FALLBACK`
- CA-10 (route): retry usa `REFLECTION_EMPATHIC_SYSTEM_PROMPT_STRICT` (não o prompt padrão)
- CA-11 ★ALTO (privacy): guard console.warn nunca loga AI response text (sentinel test)
- CA-12: Suite Vitest completa passa sem regressão

**Riscos + mitigação:**
- **Falso positivo**: "tóxico" pode aparecer em contexto não-clínico ("ambiente tóxico"). Aceito — o CLINICAL_SAFE_FALLBACK é gentil e não-clínico, impacto baixo. Retry com prompt estrito tende a produzir texto clean.
- **Latência do retry**: ~3-5s adicionais quando guard dispara. Aceito — segurança > velocidade nesse contexto. UI pode mostrar "revisando resposta..." (T-011b).
- **Loop retry → fallback**: Retry usa prompt ESTRITO explicitamente. Se ambos falharem, fallback é incondicional. Sem loop infinito.
- **Privacy leak via guard warn**: Guard log deve conter apenas `{user_id, reflection_id}` — jamais AI response text. Enforced por code review + padrão de logging.

**Pré-requisitos:**
- T-009 ✅ — Route Handler `POST /api/reflect` operacional
- `chatStream` helper com fallback Claude→Gemini ✅
- System prompt `REFLECTION_EMPATHIC_SYSTEM_PROMPT` v1 ✅
- Suite Vitest baseline: 33 passed + 5 skipped (eval)

---

## Tasks

### Task 1: Scaffold

- [ ] Criar `notes/T-009b.md` (frontmatter stub)
- [ ] Criar `apps/web/src/shared/ai/clinical-guard.ts` (header docstring + stubs vazios)
- [ ] Criar `apps/web/src/shared/ai/clinical-guard.test.ts` (header docstring)
- [ ] Commit `chore(T-009b): scaffold`

### Task 2: RED — unit tests clinical-guard

- [ ] Escrever `clinical-guard.test.ts` completo (22+ cenários cobrindo CA-1..CA-5)
- [ ] Rodar suite → espera FAIL (função não implementada)
- [ ] Commit `test(T-009b): RED — unit tests clinical-guard`

### Task 3: GREEN — implementar clinical-guard.ts

- [ ] Implementar `hasClinicalLanguage`, `CLINICAL_PATTERNS`, `CLINICAL_SAFE_FALLBACK`
- [ ] Rodar suite → espera PASS nos novos tests
- [ ] Commit `feat(T-009b): GREEN — clinical-guard module`

### Task 4: RED — route tests para guard

- [ ] Adicionar mock de `REFLECTION_EMPATHIC_SYSTEM_PROMPT_STRICT` no vi.mock existente
- [ ] Adicionar cenários CA-6..CA-11 em `route.test.ts`
- [ ] Rodar suite → espera FAIL nos novos cenários de route
- [ ] Commit `test(T-009b): RED — route guard scenarios`

### Task 5: GREEN — modificar route.ts + adicionar STRICT prompt

- [ ] Adicionar `REFLECTION_EMPATHIC_SYSTEM_PROMPT_STRICT` em `reflection-empathic.ts`
- [ ] Adicionar `bufferChatStream` helper em `route.ts`
- [ ] Modificar stream builder: buffer → `hasClinicalLanguage` → retry/fallback
- [ ] Rodar suite → espera PASS em todos (CA-6..CA-11)
- [ ] Typecheck + lint
- [ ] Commit `feat(T-009b): GREEN — clinical guard em route + prompt strict`

### Task 6: Suite completa + notes

- [ ] Rodar suite completa — zero regressão
- [ ] Preencher `notes/T-009b.md` completo
- [ ] Commit `docs(T-009b): notes — clinical guard runtime detection`

---

## Mapeamento CA → Task

| CA | Task |
|---|---|
| CA-1..CA-5 (unit guard) | Task 2 RED, Task 3 GREEN |
| CA-6..CA-11 (route guard) | Task 4 RED, Task 5 GREEN |
| CA-12 (zero regressão) | Task 6 |
