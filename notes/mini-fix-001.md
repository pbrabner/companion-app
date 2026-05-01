---
title: "Notes — mini-fix-001 (FK indexes + timezone fix)"
type: "Executor Notes"
purpose: "Registro de execução de mini-fix-001: 4 índices FK + correção de timezone do checkins_one_per_day, em resposta aos achados 🟠-1 e 🟠-2 do Code Reviewer parcial 2026-04-30"
---

# mini-fix-001 — Notes do Executor

> **Task:** mini-fix-001 — Correções da review parcial 2026-04-30
> **Stack adapter:** TypeScript / Next.js + adapter implícito SQL/pgTAP
> **Data de execução:** 2026-04-30
> **Migration:** `supabase/migrations/0003_secondary_indexes.sql`
> **Test:** `supabase/tests/secondary_indexes_and_tz.test.sql`

---

## Origem dos achados

A review parcial **2026-04-30** (`reviews/2026-04-30-fundacao-tecnica.md`, Code Reviewer) levantou dois achados de severidade 🟠 (média) sobre a fundação técnica das migrations 0001+0002:

### Achado 🟠-1 — `checkins_one_per_day` em UTC

O índice único `checkins_one_per_day` em `public.checkins` foi criado no 0001 com:

```sql
CREATE UNIQUE INDEX checkins_one_per_day
  ON public.checkins (user_id, ((created_at AT TIME ZONE 'UTC')::date));
```

Problema: o MVP do Companion é **PT-BR-only**, e a fronteira de "um check-in por dia" precisa ser interpretada em fuso brasileiro. Em `'UTC'`, um check-in feito às 22h do horário local brasileiro (01h UTC do dia seguinte) seria contado em um dia diferente do esperado pelo usuário, permitindo dois check-ins no mesmo "dia local" e bloqueando o legítimo no dia seguinte para usuários que se registram cedo na manhã.

Decisão owner correlata: **D-12** (`PROGRESS.md`) — _"MVP é PT-BR-only; índice usa America/Sao_Paulo, não UTC. Internacionalização fica para fase 2."_

### Achado 🟠-2 — Faltam índices secundários em colunas FK

Quatro colunas FK críticas para queries do app não tinham índice de apoio (apenas o constraint da FK, que não cria índice automático em PostgreSQL):

- `messages.conversation_id` — usada para listar mensagens de uma conversa (query quente).
- `journal_entries.user_id` — usada para listar entradas do diário do usuário corrente.
- `conversations.user_id` — usada para listar conversas do usuário.
- `safety_events.user_id` — usada para auditoria por usuário.

Sem índice nessas colunas, `SELECT ... WHERE conversation_id = $1` ou `WHERE user_id = $1` faz seq scan na tabela inteira, o que escala mal e impacta latência logo nos primeiros usuários reais.

---

## Convenção de naming

Adotada nesta migration e a ser seguida em índices secundários futuros:

```
idx_<table>_<column>
```

Aplicada aos quatro índices FK (`idx_messages_conversation_id`, `idx_journal_entries_user_id`, `idx_conversations_user_id`, `idx_safety_events_user_id`).

Nota: o índice `checkins_one_per_day` mantém seu nome original porque ele é um índice de **unicidade semântica** (não FK), e mudar o nome quebraria a continuidade conceitual da constraint expressa no 0001. Convenção `idx_<table>_<column>` aplica-se a índices secundários FK; índices de unicidade lógica continuam nomeados pelo significado de negócio.

---

## DROP + CREATE em vez de ALTER

PostgreSQL **não permite alterar a expressão de um índice** via `ALTER INDEX`. As opções de `ALTER INDEX` cobrem renomear, mover de tablespace, alterar storage parameters — mas não alteram a expressão indexada. Ver docs Postgres `ALTER INDEX`.

Portanto, para trocar `'UTC'` por `'America/Sao_Paulo'` no índice funcional, a única opção é:

```sql
DROP INDEX IF EXISTS public.checkins_one_per_day;
CREATE UNIQUE INDEX checkins_one_per_day ON public.checkins (...);
```

Como a migration 0003 roda dentro de uma transação implícita do Supabase CLI (`supabase db reset` aplica cada migration em transação) e a tabela está vazia em ambiente local, não há janela de inconsistência. Em produção, antes de rodar 0003, considerar se há dados em `checkins`: o `DROP` derruba o constraint de unicidade, e durante a recriação um insert concorrente poderia introduzir duplicatas. Mitigação simples: rodar a migration em janela de manutenção curta, ou envolver explicitamente em `BEGIN; ... COMMIT;` para que tudo aconteça atomicamente. No MVP atual sem usuários reais, ambas as preocupações são teóricas.

---

## Desvio do plano de teste — `like()` vs `matches()`

O plano original do test file usava `like()` da pgTAP para validar que a `indexdef` contém `'America/Sao_Paulo'`. Em execução, isso resultou em:

```
ERROR:  function like(text, unknown, unknown) does not exist
```

A função pgTAP correta para checagem de substring/regex em texto é `matches(have, regex, description)`. O test file foi corrigido para usar `matches(...)` com o padrão `'America/Sao_Paulo'`. Como `'/'` não é metacaractere de regex, a busca funciona como substring exato.

Esse desvio foi capturado durante a execução do GREEN, depois do commit RED. Para manter "RED semântico" como princípio, observou-se que o RED original já falhava pelas razões certas (4 índices ausentes), e a correção do `like → matches` foi incluída no commit GREEN junto da migration. RED commit (`0022786`) ficou consistente com o estado anterior; GREEN commit (`fc3f6a7`) traz tanto a migration quanto o ajuste do test helper.

---

## Resultado

```
Files=3, Tests=38,  0 wallclock secs ... Result: PASS
```

- 32 asserts pré-existentes (schema_support + schema_user_data) continuam verdes.
- 6 asserts novos do `secondary_indexes_and_tz.test.sql` passam:
  - 4 × `has_index` para os índices FK
  - 1 × `has_index` confirmando que `checkins_one_per_day` continua existindo após DROP+CREATE
  - 1 × `matches` confirmando `America/Sao_Paulo` na `indexdef`
- `pnpm typecheck` e `pnpm lint` continuam em 0 erros / 0 warnings.

---

## Referências

- Review fonte: `reviews/2026-04-30-fundacao-tecnica.md` (achados 🟠-1 e 🟠-2)
- Decisão owner: D-12 em `PROGRESS.md`
- Migration: `supabase/migrations/0003_secondary_indexes.sql`
- Test: `supabase/tests/secondary_indexes_and_tz.test.sql`
- Postgres docs: `ALTER INDEX` (não suporta alteração de expressão)
