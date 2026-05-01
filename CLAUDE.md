# CLAUDE.md — Companion

> Este projeto usa Legion mainstream como source of truth de regras globais.
> Veja: D:/Legion - New Horizon/legion/CLAUDE.md (regras pipeline + Sentinel + Marshal).

## Project-specific

- **Stack:** Next.js 15 + TypeScript + Vitest + Playwright + Supabase (local Docker WSL2)
- **Repo separado** do Legion (Decisão A1 da Architecture). Nunca misturar conteúdo dos dois repos.
- **Comandos pnpm/supabase/docker rodam SEMPRE via WSL** (`wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app/apps/web && pnpm <cmd>"`). pnpm Windows foi removido.
- **TDD obrigatório**: RED semântico → GREEN minimal → push. RED infraestrutural (missing dep) é teatro — recalibrado a partir de T-002.
- **Critério de aceite binário**: passa ou não passa. Sem zona cinza tipo "fechada com pendências" (Marshal F21 detecta automaticamente).
- **Notes obrigatório** em desvios não-óbvios: `notes/T-XXX.md` documenta decisões fora do espaço óbvio do backlog.
