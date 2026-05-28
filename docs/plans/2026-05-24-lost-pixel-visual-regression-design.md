---
title: "Lost Pixel visual regression setup — design"
type: design
status: proposed
created: 2026-05-24
owner: pacini
workflow_id: lost-pixel-visual-regression-setup-b4-close
related:
  - apps/web/src/design-system/.storybook/main.ts
  - apps/web/src/design-system/.github/workflows/visual-regression.yml (legacy location)
---

# Lost Pixel — design

## Problema

B4 entregou 11 componentes design-system (Button, Card, Checkbox, Dialog, Form, Input, Select, Switch, Tabs, Toast, Tooltip) com `.stories.tsx` cada, `.storybook/main.ts` + `preview.ts` configurados. Mas **não há visual regression ativo** — qualquer commit em componente pode quebrar visual sem detection. Workflow `visual-regression.yml` foi escrito durante B4 mas vive em `apps/web/src/design-system/.github/workflows/` (path errado — GH só lê de root `.github/workflows/`), e não há baselines.

Resultado: PRs que mexem em componentes não tem checkpoint visual.

## Objetivo

Setup Lost Pixel funcional self-contained no design-system: scripts Storybook + lost-pixel config + workflow GH ativo + baselines iniciais commitadas.

**Critério de sucesso:** push em `b4-tw4-smoke-2026-05-21` triggera workflow CI; primeira run gera baselines (passa por estar vazio); segundas runs comparam vs baseline e falham se diff > threshold.

## Não-objetivos

- Não configurar Lost Pixel Cloud (paga, free tier limitado) — usar modo local/baseline commitado
- Não cobrir pages full (só Storybook stories — design-system isolado)
- Não adicionar mais stories — usar as 11 existentes
- Não migrar para Chromatic ou outro vendor

## Decisões arquiteturais

### Local: self-contained no design-system

Tudo dentro de `apps/web/src/design-system/`:
- `package.json` ganha scripts `storybook`, `build-storybook`, `lost-pixel`
- `lost-pixel.config.js` no root do design-system
- Baselines em `.lostpixel/baseline/` (commitadas)
- Storybook build output em `storybook-static/` (gitignored)

Razão: design-system é declared package (`ui-design-system-react` v0.2.0). Mantém extraível pra outros projetos no futuro.

### Workflow: 1 arquivo em root `.github/workflows/`

Movido de `apps/web/src/design-system/.github/workflows/visual-regression.yml` pra `.github/workflows/visual-regression.yml`. Path do design-system passa a ser variável:

```yaml
- name: Build Storybook
  working-directory: apps/web/src/design-system
  run: pnpm build-storybook
```

Trigger: `push` em branches `main`, `staging`, `b4-*` (incluir branches de feature) e `pull_request`.

### Lost Pixel config

```js
// apps/web/src/design-system/lost-pixel.config.js
export const config = {
  storybookShots: {
    storybookUrl: './storybook-static',
  },
  imagePathBaseline: './.lostpixel/baseline',
  imagePathCurrent: './.lostpixel/current',
  imagePathDifference: './.lostpixel/difference',
  threshold: 0.001,  // 0.1% diff tolerance
  generateOnly: false,
};
```

### Baselines: commit em `.lostpixel/baseline/`

11 stories × N variantes (depende dos `*.stories.tsx`). Estimativa: ~20-40 PNGs, ~2-5 MB total. Aceitável commitar.

Re-record protocol: comentar `/lp update` no PR (segundo o workflow já escrito) ou re-rodar local + push.

### Storybook scripts

Adicionar a `apps/web/src/design-system/package.json`:

```json
"scripts": {
  "storybook": "storybook dev -p 6006",
  "build-storybook": "storybook build",
  "lost-pixel:test": "lost-pixel",
  "lost-pixel:update": "lost-pixel update"
}
```

DevDeps a adicionar:
- `storybook` (latest compatible com React 19)
- `@storybook/react-vite` (Vite builder, mais rápido que webpack)
- `@storybook/addon-essentials`
- `lost-pixel` (CLI)
- `vite` (peer)
- `@vitejs/plugin-react`

## Riscos

| Risco | Mitigação |
|---|---|
| Storybook 8.x incompatível com React 19 | Verificar matrix de compat antes de instalar; fallback Storybook 8.6+ (oficial RSC support) |
| Baselines flakery (fontes não-determinísticas no CI) | Wait for fonts loaded antes do screenshot; usar Lost Pixel `waitBeforeScreenshot` |
| Baselines blowup do repo size | `.lostpixel/baseline/` é só ~3MB inicial; revisar a cada release de design system |
| Path mismatch `working-directory` | Smoke local do workflow file via `act` ou push branch de teste |

## Definition of Done

- ✓ Storybook builda local (`pnpm build-storybook` from design-system root)
- ✓ `pnpm lost-pixel:test` roda local e cria baselines em `.lostpixel/baseline/`
- ✓ Workflow `.github/workflows/visual-regression.yml` triggera em push/PR
- ✓ Primeira run em CI passa (baselines commitadas)
- ✓ Mexer em `Button.tsx` (mudar cor) + push faz workflow falhar (visual diff > threshold)
- ✓ `/lp update` flow documentado em `apps/web/src/design-system/README.md`

## Cenários abertos (não bloqueia entrega)

- Threshold (0.001) é arbitrário — ajustar após primeiras runs reais
- Adicionar a11y testing (a11y.yml existe paralelo) — escopo separado
