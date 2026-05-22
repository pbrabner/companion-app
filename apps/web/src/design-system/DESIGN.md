---
title: "Design"
type: "Template"
purpose: "Modelo reutilizável pra novos documentos"
---

# Design System — Legion Baseline (React + Tailwind + shadcn)

Tokens canônicos para projetos derivados do Legion (Companion, Nexus, ClaudeClaw).
Vendorado via `legion ui init`. Editar diretamente após init — não há
sincronização automática com upstream.

## Tokens

### Cores semânticas (HSL para suportar `dark:` mode futuro)

| Token | Light | Dark | Uso |
|---|---|---|---|
| `--background` | `0 0% 100%` | `0 0% 4%` | Fundo geral |
| `--foreground` | `0 0% 4%` | `0 0% 98%` | Texto sobre background |
| `--primary` | `222 47% 11%` | `0 0% 98%` | Ações primárias (Button default) |
| `--primary-foreground` | `0 0% 98%` | `222 47% 11%` | Texto sobre primary |
| `--secondary` | `0 0% 96%` | `0 0% 15%` | Fundos secundários (Card hover) |
| `--secondary-foreground` | `0 0% 9%` | `0 0% 98%` | Texto sobre secondary |
| `--muted` | `0 0% 96%` | `0 0% 15%` | Fundos placeholder |
| `--muted-foreground` | `0 0% 45%` | `0 0% 64%` | Texto secundário |
| `--accent` | `0 0% 96%` | `0 0% 15%` | Highlights menores |
| `--destructive` | `0 84% 60%` | `0 63% 31%` | Erros, ações destrutivas |
| `--destructive-foreground` | `0 0% 98%` | `0 0% 98%` | Texto sobre destructive |
| `--border` | `0 0% 90%` | `0 0% 15%` | Bordas inputs/cards |
| `--input` | `0 0% 90%` | `0 0% 15%` | Border inputs |
| `--ring` | `222 47% 11%` | `0 0% 83%` | Focus ring |

### Tipografia

- **Font stack default:** `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Monospace:** `"JetBrains Mono", "Fira Code", Consolas, monospace`
- **Tamanhos:** `text-xs` (12) · `text-sm` (14) · `text-base` (16) · `text-lg` (18) · `text-xl` (20) · `text-2xl` (24) · `text-3xl` (30) · `text-4xl` (36)
- **Pesos:** 400 (regular) · 500 (medium) · 600 (semibold) · 700 (bold)

### Spacing scale

`0` · `1` (4px) · `2` (8px) · `3` (12px) · `4` (16px) · `6` (24px) · `8` (32px) · `12` (48px) · `16` (64px) · `24` (96px)

Cumpre 4-base — não usar `5`, `7`, `9` etc (incoerência visual).

### Radius

- `--radius-sm`: `0.25rem` (4px) — inputs pequenos
- `--radius-md`: `0.375rem` (6px) — buttons, inputs default
- `--radius-lg`: `0.5rem` (8px) — cards, dialogs
- `--radius-full`: `9999px` — pills, avatars

### Animations

- `--duration-fast`: 100ms — hover, focus
- `--duration-normal`: 200ms — modal open, toast slide
- `--duration-slow`: 400ms — transitions multi-elemento

Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (out-expo) para entradas, `ease-in-out` default.

## Componentes vendorados (Wave 1)

| Componente | Variants | Acessibilidade |
|---|---|---|
| `Button` | default · destructive · outline · secondary · ghost · link; sizes default/sm/lg/icon | `aria-disabled`, focus-visible ring |
| `Input` | text/email/password com border focus | label association via `htmlFor` no projeto |
| `Card` | Header + Title + Description + Content + Footer | landmark `section` quando aplicável |
| `Dialog` | modal centrado com overlay | Radix Dialog (focus trap + ESC close + aria-modal) |
| `Toast` | default · destructive variants | Radix Toast (live region + auto-dismiss) |

## Próximos passos pós-init

1. `pnpm add -D @tailwindcss/postcss tailwindcss && pnpm add @radix-ui/react-dialog @radix-ui/react-toast clsx tailwind-merge class-variance-authority`
2. Configurar `postcss.config.js` com `@tailwindcss/postcss` plugin
3. Tokens em `globals.css` via `@theme inline` — utilities Tailwind disponíveis automaticamente
4. Importar componentes: `import { Button } from "@/components/Button"`
5. Customizar cores em `:root` do CSS global para brand próprio

## Origem dos tokens

Baseado em shadcn/ui defaults (`https://ui.shadcn.com`) com ajustes para
acessibilidade contraste AA (WCAG 2.1). Brand-neutral por design — projetos
customizam `--primary` e companion colors.
