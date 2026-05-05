---
title: "PRD — Captura de Reflexão Diária (Companion core feature)"
description: "Espaço para escrever reflexão diária livre + IA que extrai insights, padrões temporais e responde com empatia. Core feature do Companion."
purpose: "Definir escopo, restrições e CAs binários da feature core de Companion (post-T-007). Idéia gerada via planner-prd-basico em 2026-05-02; pesquisa de mercado e validação de viabilidade vêm em research-lab + validation-lab."
---

# PRD — Captura de Reflexão Diária (Companion)
## Product Requirements Document

> **Versão:** 0.1 (rascunho — saída de planner-prd-basico, pendente research-lab + validation-lab)
> **Data:** 2026-05-02
> **Status:** Rascunho — aguardando research-lab + validation-lab antes de promover a "Em revisão"
> **Owner:** pacini

---

## 1. Objetivo

Permitir que o usuário do Companion escreva uma reflexão diária em texto livre e receba (a) resposta empática em tempo real da IA conversacional, (b) extração estruturada de emoções/eventos/perguntas em aberto, e (c) análise temporal semanal que revela padrões só perceptíveis com 4+ reflexões acumuladas. Não substitui terapia — complementa autoconhecimento estruturado.

## 2. Para Quem

Profissionais 25-45 anos já familiarizados com terapia/coaching (não-curiosos). Valorizam autoconhecimento estruturado, topam pagar SaaS leve (~R$ 30-60/mês) por espaço protegido, e tipicamente abandonam apps de journaling tradicionais por falta de insight cumulativo. Trabalham com o **dia** como unidade base de reflexão (1 entrada/dia, timeline navegável, busca por sentimento/tema).

## 3. Problema

Apps de journaling existentes têm um de dois problemas:
- **Prompt vazio (Day One, Notion templates)**: a tela em branco intimida; retenção despenca após 2 semanas.
- **IA superficial (Stoic, Reflectly, alguns recursos do Day One Premium)**: resume o dia em 1 frase ou pergunta "como você se sente hoje?" sem cruzar com histórico — repetitivo e raso.

Profissionais que querem journaling estruturado pulam quando o app não conecta padrões ao longo do tempo. Companion ataca esse vácuo: a IA responde **agora** (em tempo real, com Claude Sonnet) E olha **trás** (análise semanal cumulativa, com Claude Sonnet em job batch).

## 4. Escopo

### Inclui (MVP)

- [ ] **Tela `/reflect`** — textarea livre + botão Submit. Opcionalmente, quando há ≥3 reflexões anteriores, a IA pré-popula um prompt sugerido baseado em padrões recentes (ex: "Ontem você mencionou ansiedade pré-reunião — como foi hoje?").
- [ ] **Persistência Postgres** — reflexão salva em tabela `reflections` (Supabase) com RLS estrito por `user_id`. Schema mínimo: `id`, `user_id`, `content`, `created_at`, `processed_at` (nullable).
- [ ] **Processamento assíncrono (Claude Haiku)** — após salvar, dispara job que extrai estrutura: emoções principais (lista), eventos chave (lista), perguntas em aberto (lista). Resultado salvo em coluna `insights_jsonb` da mesma row.
- [ ] **Resposta empática síncrona (Claude Sonnet)** — após Submit, no mesmo request, retorna 1-2 parágrafos de resposta empática (nunca diagnóstica, nunca prescritiva). Mostrada ao usuário imediatamente.
- [ ] **Tela `/history`** — timeline de reflexões passadas, ordenada por data. Filtros: período (últimos 7/30/90 dias), sentimento dominante (chips clicáveis), busca textual.
- [ ] **Tela `/insights`** — análise semanal (job batch toda segunda-feira 06:00 UTC, Claude Sonnet) que processa últimas 4-7 reflexões e gera 1-3 insights de padrão temporal. Mostra: padrão observado, evidência (refs a reflexões específicas), pergunta sugerida.
- [ ] **Privacy gate** — conteúdo de reflexão **nunca** vai para analytics de produto, telemetria third-party (Sentry/PostHog/etc), ou qualquer log persistente fora do banco do usuário. Apenas metadados não-emocionais (timestamp, comprimento de texto) podem ir pra observabilidade.
- [ ] **Custo controlado** — Haiku para processamento async (R$ ~0.001/reflexão). Sonnet para resposta síncrona e insights semanais (R$ ~0.05/reflexão sync + R$ ~0.10/semana). Budget alvo: < R$ 5/usuário/mês.

### Exclui do MVP

- Compartilhamento social (público ou privado) de reflexões.
- Export PDF/Markdown da timeline (vem em Marco 2).
- Modo voz (gravação de áudio + transcrição) — Marco 3.
- Multi-idioma na UI — só PT-BR no MVP. Conteúdo de reflexão pode ser qualquer idioma; IA responde no idioma do conteúdo.
- Notifications/lembretes diários — Marco 2 (precisa decisão sobre canal: e-mail vs push web vs nada).
- Modo terapeuta (compartilhar com profissional autorizado) — futuro distante, requer compliance específico.
- Análise de áudio/voz/imagem — fora de escopo.
- Versão mobile nativa — web responsivo cobre MVP; nativo é Marco posterior.

## 5. Requisitos Funcionais

| ID | Requisito | Prioridade |
|---|---|---|
| RF-001 | Usuário autenticado (T-007 middleware) acessa `/reflect`, escreve texto, submete, recebe resposta empática síncrona em < 8s p95 | Alta |
| RF-002 | Reflexão é persistida em `reflections` com RLS Postgres garantindo isolamento por `user_id` (CA-002) | Alta |
| RF-003 | Após persistência, job async dispara em ≤ 5s e popula `insights_jsonb` em ≤ 30s p95 | Alta |
| RF-004 | Tela `/history` lista reflexões do usuário ordenadas por `created_at` desc, com paginação infinita (20 por página) | Alta |
| RF-005 | Tela `/history` permite filtro por período (7/30/90 dias) e por sentimento dominante (extraído do `insights_jsonb`) | Alta |
| RF-006 | Tela `/insights` mostra ≥1 insight gerado se usuário tem ≥4 reflexões na última semana; "ainda não há padrões suficientes" caso contrário | Alta |
| RF-007 | Conteúdo de reflexão **nunca** é enviado pra Sentry, PostHog, Vercel Analytics, ou qualquer SDK third-party de observabilidade. Apenas metadados (timestamp, char_count, response_latency_ms) | Alta |
| RF-008 | Job semanal de insights roda em segunda-feira 06:00 UTC via Vercel Cron, processa apenas usuários com ≥4 reflexões nos últimos 7 dias | Média |
| RF-009 | Prompt sugerido na `/reflect` aparece apenas quando usuário tem ≥3 reflexões anteriores; texto do prompt é gerado por Haiku usando últimas 3 reflexões como contexto | Média |
| RF-010 | Resposta empática nunca contém: diagnóstico clínico, prescrição de medicamento, julgamento moral, sugestão de "deveria fazer X" sem qualifier ("você pode considerar…") | Alta |

## 6. Requisitos Não Funcionais

| ID | Requisito | Meta |
|---|---|---|
| RNF-001 | Latência síncrona resposta empática | p95 < 8s, p50 < 4s |
| RNF-002 | Latência async insights extraction | p95 < 30s |
| RNF-003 | Disponibilidade | 99.5% uptime (acompanha Vercel + Supabase) |
| RNF-004 | Custo IA por usuário ativo/mês | < R$ 5 (assumindo 20-30 reflexões/mês) |
| RNF-005 | Segurança / Privacy | RLS Postgres por `user_id`, nenhum dado emocional em logs ou analytics, secrets via Vercel env vars |
| RNF-006 | Acessibilidade | WCAG AA na `/reflect` (textarea com label, contrast ratio, keyboard nav) |

## 7. Fluxos de Usuário

### Fluxo principal: capturar reflexão

```
1. Usuário autenticado abre app, middleware redireciona pra /reflect (default landing pós-onboarding)
2. Tela mostra:
   - Saudação contextual ("Boa noite, Pacini" — sem emoji forçado)
   - Textarea grande, focada por padrão
   - Se ≥3 reflexões prévias: prompt sugerido ("Ontem você falou sobre X — como isso evoluiu?") como placeholder ou botão "Use esta sugestão"
   - Sem contador de palavras, sem mood emojis, sem "tags" — minimalismo intencional
3. Usuário escreve texto livre (sem limite hard, soft limit ~5000 chars)
4. Usuário clica Submit
5. Sistema:
   a. Salva em `reflections` (Postgres, RLS)
   b. Chama Claude Sonnet 4.6 com reflexão + últimas 2 reflexões como contexto, retorna resposta empática
   c. Dispara job async (queue Supabase ou Vercel Edge) que chama Claude Haiku 4.5 pra extrair `insights_jsonb`
6. UI mostra resposta empática logo abaixo da textarea (não navega — fica na mesma tela)
7. Usuário pode ler, fechar, ou navegar pra /history ou /insights
```

### Fluxo secundário: revisar timeline

```
1. Usuário acessa /history
2. Sistema lista últimas 20 reflexões ordenadas desc, com:
   - Data (formato relativo: "Ontem", "3 dias atrás", "12 mar")
   - Trecho de 200 chars do conteúdo
   - Sentimento dominante (chip colorido) extraído de insights_jsonb
3. Filtros: período (botões 7/30/90 dias), sentimento (multi-select chips), busca textual
4. Click em uma reflexão abre /reflect/<id> (read-only, mostra também resposta empática original e insights extraídos)
```

### Fluxo terciário: ler insights semanais

```
1. Toda segunda 06:00 UTC, job processa usuários com ≥4 reflexões últimas 7 dias
2. Pra cada usuário, Claude Sonnet recebe as reflexões e gera 1-3 insights estruturados:
   { padrao: "...", evidencia: ["ref-id-1", "ref-id-2"], pergunta_sugerida: "..." }
3. Insights salvos em tabela `weekly_insights` (RLS por user_id)
4. Usuário acessa /insights, vê últimos insights gerados
5. Click em "Refletir sobre isto" leva pra /reflect com prompt pré-populado pela pergunta sugerida
```

## 8. Critérios de Aceite

| ID | Critério |
|---|---|
| CA-001 | Dado usuário autenticado em `/reflect`, quando submete reflexão de 500 chars, então resposta empática aparece em ≤ 8s e reflexão persiste em `reflections` |
| CA-002 ★ALTO | Dado dois usuários distintos A e B, quando A consulta `/history`, então **nenhuma** reflexão de B aparece (RLS Postgres validado por teste pgTAP cross-user) |
| CA-003 ★ALTO | Dado reflexão submetida, quando inspecionamos logs do Vercel/Sentry/PostHog/qualquer telemetria third-party, então o `content` da reflexão **não** aparece em nenhum log (privacy gate) |
| CA-004 | Dado job async disparado, quando passam 30s, então `insights_jsonb` da reflexão está populado com chaves `emocoes`, `eventos`, `perguntas_em_aberto` |
| CA-005 | Dado usuário com 5 reflexões na última semana, quando job semanal roda em segunda 06:00 UTC, então tabela `weekly_insights` ganha 1-3 entries pra esse usuário |
| CA-006 | Dado usuário com 0-3 reflexões na semana, quando acessa `/insights`, então UI mostra "ainda não há padrões suficientes — escreva mais 1 reflexão pra desbloquear análise" |
| CA-007 | Dado resposta empática gerada por Claude, quando texto contém termos clínicos ("você tem depressão", "tome remédio X"), então sistema rejeita e retry uma vez; se persistir, mostra fallback safe ("obrigado por compartilhar — sua reflexão foi salva") |
| CA-008 | Dado usuário com ≥3 reflexões prévias, quando abre `/reflect`, então UI mostra prompt sugerido contextual (não placeholder genérico) |
| CA-009 | Dado custo de IA por usuário/mês > R$ 10 detectado, quando dashboard de billing roda, então alerta dispara pra owner (kill-switch decisão consciente) |

## 9. Marcos

| Marco | Escopo | Impacto |
|---|---|---|
| Marco 1 (MVP) | RF-001 a RF-007 + RF-010 (síncrono + async + history básico + privacy gate). Sem `/insights` semanais. | ★ALTO — destrava feedback de usuário real |
| Marco 2 | RF-006 + RF-008 + RF-009 (insights semanais + cron + prompt sugerido). Testa diferencial vs concorrentes. | ★ALTO — diferencial principal vs Day One/Stoic |
| Marco 3 | Notifications, export PDF, polish UX | Médio — retenção long-tail |

## 10. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Privacy leak: conteúdo emocional vaza pra analytics third-party por engano (default Vercel/PostHog SDK captura tudo) | Média | Alto (regulatório + reputação) | Test E2E que valida CA-003 grepando network requests durante submit; opt-out explícito de qualquer SDK genérico |
| Resposta empática de Claude desliza pra território clínico ("você tem ansiedade generalizada") | Média | Alto (regulatório, dano ao usuário) | RF-010 + CA-007 (retry+fallback) + system prompt forte com exemplos de não-fazer + eval set específico de gatilhos clínicos |
| Custo IA explode (usuário "viciado" escrevendo 5x/dia) | Média | Médio | Rate limit suave (10 reflexões/dia); CA-009 alerta de custo; soft cap em chars/reflexão |
| Latência > 8s (Sonnet sob carga) frustra usuário | Média | Médio | Streaming response (mostra texto chegando) + fallback Haiku se Sonnet timeout > 6s |
| Insights semanais geram falsos padrões (overfitting de 4 pontos) | Alta | Médio | Mín 4 reflexões pra gerar; redação cuidadosa ("notei tendência" não "você é"); usuário pode marcar insight como "não me reconheço aqui" pra retreinar |
| Apple/Google rejeitam app por conteúdo emocional sem disclaimer | Baixa | Baixo (web app inicialmente) | MVP é web; quando for nativo, disclaimer explícito + age gate 18+ |
| Concorrente (Day One) lança feature similar com brand reconhecida | Média | Médio | Diferencial não é só feature, é o cruzamento temporal específico — replicar exige histórico do usuário, vantagem incumbent |
| Schema de `insights_jsonb` evolui e quebra reflexões antigas | Média | Médio | Versionamento explícito (`insights_schema_version` na coluna); backfill scripts; nunca delete dados antigos |

## 11. Decisões Pendentes

- [ ] Qual queue pra job async? Opções: Supabase Functions + cron, Vercel Edge Functions, Trigger.dev, Inngest. (Decisão deve preceder arquitetura T-008+)
- [ ] Streaming resposta empática (mostra texto chegando) vs batch (espera tudo)? Latência percebida muda decisão.
- [ ] Schema `insights_jsonb` v1: emoções como lista de strings ou objetos `{nome, intensidade}`? Eventos como strings ou estrutura?
- [ ] Onboarding pré-`/reflect` precisa coletar baseline (estado emocional médio, áreas de vida que importam)? Ou começa direto?
- [ ] System prompt pra Claude Sonnet (resposta empática) é versionado em git ou em config DB? Versionar permite rollback rápido se eval falhar.
- [ ] Quantas reflexões anteriores virar contexto pro Sonnet (RF-001)? 2 últimas? 7 últimas? Trade-off: relevância vs custo.
- [ ] CA-003 privacy gate: como provar em CI? Test que grepa network requests no Playwright + revisão manual de SDKs instalados a cada release.
- [ ] Pricing efetivo: R$ 30/mês cobre custo IA esperado? Precisa ser refinado em validation-lab com estimativa de uso real.
