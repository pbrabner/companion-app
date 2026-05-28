---
title: "Multi-brand themes"
type: "Template"
purpose: "Themes Legion canônicos — default/ocean/forest via data-theme + CSS variables"
---

# Multi-brand themes (Wave 4)

Três palettes Legion prontas. Cada uma define `--primary`, `--ring`, `--accent`
e tokens correlatos via CSS variables HSL — pluggable via atributo `data-theme`
no `<html>`.

## Themes inclusos

| Theme | Hue primary | Quando usar |
|---|---|---|
| `default` | 222 (neutro / dark navy) | maioria dos produtos, branding genérico |
| `ocean` | 200 (azul + accent teal) | apps marítimos, fintechs frias, data viz |
| `forest` | 140 (verde + accent earth) | produtos sustentáveis, ESG, agricultura |

## Uso

### 1. Importar 1 ou mais themes

```tsx
// app/layout.tsx (Next.js) — ou root da SPA
import "./design-system/themes/default.css";
import "./design-system/themes/ocean.css";
import "./design-system/themes/forest.css";
```

Cada theme só ativa quando `<html>` tem `data-theme` correspondente.
`default` também aplica via `:root` (fallback).

### 2. Setar theme via atributo

```html
<html data-theme="ocean">     <!-- ocean ativo -->
<html data-theme="forest">    <!-- forest ativo -->
<html>                         <!-- default ativo -->
```

### 3. Dark mode combina com theme

`.dark` aplica em qualquer theme:

```html
<html data-theme="ocean" class="dark">   <!-- ocean dark -->
<html data-theme="forest" class="dark">  <!-- forest dark -->
```

Toggle programático:

```ts
document.documentElement.setAttribute("data-theme", "ocean");
document.documentElement.classList.toggle("dark");
```

## Adicionar theme novo

1. Copie `default.css` pra `themes/<nome>.css`
2. Renomeie selectors `[data-theme="default"]` → `[data-theme="<nome>"]`
3. Ajuste `--primary`, `--ring`, `--accent` (mantenha contraste WCAG AA: 4.5:1 texto, 3:1 UI)
4. Importe no root layout
5. Documente aqui

## Verificar contraste

Use [coolors.co contrast checker](https://coolors.co/contrast-checker) ou
plugin Storybook `@storybook/addon-a11y` (já configurado no Wave 3).
