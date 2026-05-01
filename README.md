---
title: "Companion"
description: "Plataforma de desenvolvimento pessoal assistido por IA — MVP Conceitual em construção"
purpose: "Primeira leitura sobre o repositório Companion (produto separado do Legion, Decisão A1)"
---

# Companion (web app)

Plataforma de desenvolvimento pessoal assistido por IA. MVP Conceitual em construção.

> Este repositório é o produto Companion. É **separado** do Legion (a plataforma de orquestração de agentes que produz o pipeline experimental que define este produto). Decisão A1 da Architecture: isolamento de domínios, ciclos de release independentes, dados sensíveis (reflexões emocionais) nunca compartilham infra com tooling de engenharia.

---

## Stack

- **Framework:** Next.js 15 (App Router) + React 19 + TypeScript estrito
- **Estilo:** Tailwind 4 (instalado, ainda não wired)
- **Banco / Auth:** Supabase (Postgres 16 + Auth + RLS)
- **IA:** Claude Sonnet 4.6 (chat) + Haiku 4.5 (tasks baratas) via `@anthropic-ai/sdk`
- **Test runner:** Vitest 2.x (unit/integration), Playwright 1.x (E2E)
- **Package manager:** pnpm 10.x
- **Deploy:** Vercel (a ser conectado)

---

## Setup local

### Pré-requisitos

- Node.js 22+
- pnpm 10+
- Docker Desktop (rodando — exigido por `supabase start`)
- Conta Supabase (free tier serve para o MVP)

### Passo a passo

```bash
# 1. Instalar deps do app web
cd apps/web
pnpm install
cd ../..

# 2. Configurar variáveis de ambiente
cp apps/web/.env.example apps/web/.env.local
# Editar apps/web/.env.local:
#   NEXT_PUBLIC_SUPABASE_URL       — copie do dashboard Supabase do projeto Companion
#   NEXT_PUBLIC_SUPABASE_ANON_KEY  — copie do dashboard
#   SUPABASE_SERVICE_ROLE_KEY      — copie do dashboard (NUNCA exposta ao cliente)

# 3. Subir stack Supabase local (Docker)
npx --prefix apps/web supabase start
# Aguarde alguns minutos no primeiro start (pull de imagens).
# Ao final, anote as URLs locais retornadas (Studio, API URL, anon key, service_role key)
# — você pode copiar essas para .env.local se quiser desenvolver totalmente offline.

# 4. Verificar status
npx --prefix apps/web supabase status

# 5. Subir o app web
cd apps/web
pnpm dev
# http://localhost:3000
```

### Encerrando

```bash
npx --prefix apps/web supabase stop
```

---

## Comandos úteis

```bash
cd apps/web

pnpm dev          # next dev
pnpm build        # next build
pnpm start        # next start (prod)
pnpm test         # vitest (unit/integration)
pnpm test:watch   # vitest watch mode
pnpm typecheck    # tsc --noEmit
pnpm lint         # next lint
```

---

## Estrutura

```
companion-app/
├── apps/
│   └── web/                       # Next.js app
│       ├── src/
│       │   ├── app/               # rotas (App Router)
│       │   ├── modules/           # features (auth, checkin, journal, ...)
│       │   ├── shared/            # cross-cutting (db, ai, utils)
│       │   └── lib/               # helpers genéricos
│       ├── public/                # ícones, imagens estáticas
│       ├── package.json
│       ├── next.config.ts
│       ├── vitest.config.ts
│       └── tsconfig.json
├── supabase/                      # SQL migrations + config local
│   ├── config.toml
│   └── migrations/                # criadas em T-003a/T-003b
├── notes/                         # notes do Executor por task (T-XXX.md quando há desvios)
├── .gitignore
└── README.md
```

---

## Status do MVP

Veja [`legion/docs/experimentos/fluxo-entrega/companion/03-backlog.md`](https://github.com/andreschuenck/legion/blob/main/docs/experimentos/fluxo-entrega/companion/03-backlog.md) — pipeline experimental que produziu este backlog tem 35 tasks. Estado atual: T-001 e T-002 concluídas.

---

## Não comitar

- `apps/web/.env.local` (já no `.gitignore`)
- Qualquer credencial real, em qualquer formato, em qualquer arquivo versionado