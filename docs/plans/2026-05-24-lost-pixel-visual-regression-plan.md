---
title: "Lost Pixel visual regression setup — implementation plan"
type: plan
status: proposed
created: 2026-05-24
owner: pacini
spec: docs/plans/2026-05-24-lost-pixel-visual-regression-design.md
workflow_id: lost-pixel-visual-regression-setup-b4-close
---

# Lost Pixel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lost Pixel rodando em CI, baselines commitadas, primeira proteção visual ativa pro design-system Companion.

**Architecture:** Self-contained no `apps/web/src/design-system/`. Storybook static build → Lost Pixel screenshot comparison vs `.lostpixel/baseline/`. Workflow GH em root `.github/workflows/` chamando design-system via `working-directory`.

**Tech Stack:** Storybook 8.x + Vite + React 19, lost-pixel CLI, GitHub Actions.

---

## Tasks Overview

| # | Task | Modelo | Branch |
|---|---|---|---|
| 1 | Storybook + Lost Pixel devDeps + scripts | sonnet | b4-tw4-smoke |
| 2 | `lost-pixel.config.js` + smoke build local | sonnet | b4-tw4-smoke |
| 3 | Gerar baselines locais + commit | sonnet | b4-tw4-smoke |
| 4 | Mover/refazer `visual-regression.yml` em root + adjust paths | sonnet | b4-tw4-smoke |
| 5 | Push branch + verificar workflow CI roda + baselines passam | haiku | b4-tw4-smoke |
| 6 | Smoke negativo: editar Button + push + ver CI falhar | haiku | b4-tw4-smoke |
| 7 | README design-system: documentar `/lp update` protocol | haiku | b4-tw4-smoke |

---

## Task 1 — Storybook + Lost Pixel devDeps + scripts

**Files:**
- Modify: `apps/web/src/design-system/package.json`
- Modify: `apps/web/pnpm-lock.yaml` (deps install)

- [ ] **Step 1.1** — Verificar React 19 compat com Storybook 8.6+

Run:
```bash
cd "D:/companion-app/apps/web"
pnpm view storybook versions --json | tail -20
```

Confirmar Storybook >= 8.6 instalável. Se houver issue, fallback Storybook 8.4 com `react@^18` peer warning aceito.

- [ ] **Step 1.2** — Adicionar devDeps em design-system/package.json

Editar `apps/web/src/design-system/package.json` adicionando `devDependencies`:

```json
"devDependencies": {
  "storybook": "^8.6.0",
  "@storybook/react-vite": "^8.6.0",
  "@storybook/addon-essentials": "^8.6.0",
  "lost-pixel": "^3.22.0",
  "vite": "^5.0.0",
  "@vitejs/plugin-react": "^4.3.0"
}
```

E `scripts`:

```json
"scripts": {
  "storybook": "storybook dev -p 6006",
  "build-storybook": "storybook build",
  "lost-pixel:test": "lost-pixel",
  "lost-pixel:update": "lost-pixel update"
}
```

- [ ] **Step 1.3** — Install + verificar

```bash
cd "D:/companion-app/apps/web/src/design-system"
pnpm install
pnpm storybook --help 2>&1 | head -3   # exit 0 = OK
```

- [ ] **Step 1.4** — Commit

```bash
cd "D:/companion-app"
git status -s
git add apps/web/src/design-system/package.json apps/web/pnpm-lock.yaml
git diff --cached --stat
git commit -m "feat(design-system): scripts + devDeps pra Storybook 8 + Lost Pixel"
```

---

## Task 2 — `lost-pixel.config.js` + smoke build local

**Files:**
- Create: `apps/web/src/design-system/lost-pixel.config.js`
- Modify: `apps/web/src/design-system/.gitignore` (se faltar — adicionar `storybook-static/`, `.lostpixel/current/`, `.lostpixel/difference/`)

- [ ] **Step 2.1** — Criar config

`apps/web/src/design-system/lost-pixel.config.js`:

```js
export const config = {
  storybookShots: {
    storybookUrl: './storybook-static',
  },
  imagePathBaseline: './.lostpixel/baseline',
  imagePathCurrent: './.lostpixel/current',
  imagePathDifference: './.lostpixel/difference',
  threshold: 0.001,
  generateOnly: false,
  // Wait for fonts antes do screenshot (anti-flake)
  waitBeforeScreenshot: 500,
};
```

- [ ] **Step 2.2** — Garantir .gitignore design-system tem builds locais

Se `.gitignore` do design-system não existe, criar:

```
storybook-static/
.lostpixel/current/
.lostpixel/difference/
node_modules/
```

(Manter `.lostpixel/baseline/` tracked — é o que commitamos.)

- [ ] **Step 2.3** — Smoke local: build Storybook

```bash
cd "D:/companion-app/apps/web/src/design-system"
pnpm build-storybook 2>&1 | tail -10
ls storybook-static/ | head   # confirmar arquivos gerados (index.html, etc)
```

Esperado: build conclui sem erros, `storybook-static/index.html` existe.

Se falhar: debug Storybook compat. Provavelmente issue com path imports nos `.stories.tsx` se eles usam `import { Button } from "./Button"` — Storybook 8 + Vite normalmente resolve.

- [ ] **Step 2.4** — Commit config

```bash
git add apps/web/src/design-system/lost-pixel.config.js apps/web/src/design-system/.gitignore
git diff --cached --stat
git commit -m "feat(design-system): lost-pixel.config.js + gitignore builds locais"
```

---

## Task 3 — Gerar baselines locais + commit

**Files:**
- Create: `apps/web/src/design-system/.lostpixel/baseline/*.png` (~20-40 imagens)

- [ ] **Step 3.1** — Rodar lost-pixel update pela primeira vez

```bash
cd "D:/companion-app/apps/web/src/design-system"
pnpm lost-pixel:update 2>&1 | tail -10
ls .lostpixel/baseline/ | head -20
```

Esperado: `.lostpixel/baseline/` populado com 1 PNG por story-variant.

Se nenhuma imagem gerar: verificar `storybookShots.storybookUrl` no config aponta corretamente pro build (`./storybook-static`).

- [ ] **Step 3.2** — Verificar tamanho razoável

```bash
du -sh apps/web/src/design-system/.lostpixel/baseline/
```

Esperado < 10MB. Se maior, considerar reduzir variants nas stories.

- [ ] **Step 3.3** — Commit baselines

```bash
cd "D:/companion-app"
git add apps/web/src/design-system/.lostpixel/baseline/
git status -s | head
git diff --cached --stat
git commit -m "feat(design-system): baselines visuais iniciais (Storybook + Lost Pixel)"
```

---

## Task 4 — Mover/refazer `visual-regression.yml` em root + adjust paths

**Files:**
- Create: `.github/workflows/visual-regression.yml` (NEW location)
- Delete: `apps/web/src/design-system/.github/` (recursivo — diretório legado)

- [ ] **Step 4.1** — Criar workflow no path correto

`.github/workflows/visual-regression.yml`:

```yaml
name: Visual regression

on:
  push:
    branches: [main, staging, "b4-*"]
  pull_request:
    branches: [main, staging]

jobs:
  lost-pixel:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: apps/web/src/design-system
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: apps/web/pnpm-lock.yaml

      - name: Install
        run: pnpm install --frozen-lockfile
        working-directory: apps/web

      - name: Build Storybook
        run: pnpm build-storybook

      - name: Lost Pixel
        run: pnpm lost-pixel:test
        # Sem secret: roda local-mode (compara contra baseline commitado)
```

- [ ] **Step 4.2** — Deletar workflow legado

```bash
cd "D:/companion-app"
git rm -r apps/web/src/design-system/.github/  # se rastreado
# ou apenas rm -rf se untracked
rm -rf apps/web/src/design-system/.github/ 2>/dev/null
```

- [ ] **Step 4.3** — Commit

```bash
git add .github/workflows/visual-regression.yml
git status -s | head
git diff --cached --stat
git commit -m "ci(visual-regression): workflow no path GH (root .github/workflows/)"
```

---

## Task 5 — Push branch + CI run

- [ ] **Step 5.1** — Push branch atualizada

```bash
cd "D:/companion-app"
git push origin b4-tw4-smoke-2026-05-21
```

- [ ] **Step 5.2** — Aguardar workflow rodar

```bash
gh run watch --exit-status
# ou
gh run list --workflow=visual-regression.yml --limit 1
```

- [ ] **Step 5.3** — Verificar resultado

Esperado: workflow PASSA (baselines existem e batem). Se falhar com "no baselines found": ajustar `imagePathBaseline` no config.

Se passar: ✓ checkpoint visual ativo.

---

## Task 6 — Smoke negativo

**Goal:** prova que regressão visual é detectada.

- [ ] **Step 6.1** — Editar Button cor

```bash
cd "D:/companion-app"
# Adicionar `bg-red-500` no Button (ou similar mudança visual óbvia)
```

Editar `apps/web/src/design-system/components/Button.tsx` — adicionar `className` com cor diferente em alguma variant.

- [ ] **Step 6.2** — Commit + push

```bash
git add apps/web/src/design-system/components/Button.tsx
git commit -m "test(button): mudança visual deliberada pra testar Lost Pixel detection"
git push
```

- [ ] **Step 6.3** — Verificar CI falha

```bash
gh run watch --exit-status
```

Esperado: workflow FALHA com diff > threshold. Log mostra paths de imagens em `.lostpixel/difference/` (não commitado).

- [ ] **Step 6.4** — Revert smoke

```bash
git revert HEAD --no-edit
git push
```

- [ ] **Step 6.5** — Verificar CI passa de novo

```bash
gh run watch --exit-status
```

Esperado: PASS de novo.

---

## Task 7 — README design-system

**Files:**
- Modify: `apps/web/src/design-system/README.md`

- [ ] **Step 7.1** — Adicionar seção "Visual regression"

Append no README:

```markdown
## Visual regression

Storybook + Lost Pixel guardam screenshots de cada story em `.lostpixel/baseline/`.

### Workflow

- Cada push triggera `visual-regression.yml` (GH Actions)
- CI builda Storybook + roda `lost-pixel` comparando vs baselines
- Diff > 0.1% → CI falha + diff salvo (visualizar via download artifact)

### Atualizar baselines (quando mudança visual é intencional)

Local:
\```bash
cd apps/web/src/design-system
pnpm build-storybook
pnpm lost-pixel:update
git add .lostpixel/baseline/
git commit -m "feat(design-system): update baselines (motivo)"
\```

### Threshold

Default 0.001 (0.1% diff). Ajustar em `lost-pixel.config.js` se necessário.
```

- [ ] **Step 7.2** — Commit

```bash
git add apps/web/src/design-system/README.md
git commit -m "docs(design-system): visual regression update protocol"
```

---

## Final

- [ ] Push final state
- [ ] `legion workflow evidence add --path "apps/web/src/design-system/.lostpixel/baseline" --note "baselines commitadas, smokes pass+fail validados"`
- [ ] `legion workflow verdict --verdict PASS --source qa --note "Lost Pixel ativo em CI"`
- [ ] `legion workflow transition --to verifying` → `closing` → `learned`
- [ ] (Optional) Open PR b4-tw4-smoke → main consolidando B4 inteiro
