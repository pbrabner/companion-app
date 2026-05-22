---
title: "Readme"
type: "Template"
purpose: "Modelo reutilizável pra novos documentos"
---

# Legion UI Design System — Template baseline

Template vendorado shadcn-style: copia uma vez, edita livremente, sem dep upstream.
Versão inicial: Wave 1 (5 componentes + tokens + tailwind config).

## Estrutura

```
ui-design-system-react/
├── DESIGN.md                  # tokens canônicos (cores, tipografia, spacing, radius)
├── globals.css                # @theme inline + :root + .dark tokens HSL (Tailwind 4)
├── lib/
│   └── utils.ts               # cn() helper (clsx + tailwind-merge)
├── components/
│   ├── Button.tsx             # variants: default/destructive/outline/secondary/ghost/link
│   ├── Input.tsx              # text/email/password + focus ring
│   ├── Card.tsx               # Card + Header + Title + Description + Content + Footer
│   ├── Dialog.tsx             # Radix Dialog modal (focus trap + ESC)
│   ├── Toast.tsx              # Radix Toast (live region + auto-dismiss)
│   ├── Select.tsx             # Radix Select com indicator [Wave 2]
│   ├── Checkbox.tsx           # Radix Checkbox + a11y [Wave 2]
│   ├── Switch.tsx             # Radix Switch toggle [Wave 2]
│   ├── Tabs.tsx               # Radix Tabs (List + Trigger + Content) [Wave 2]
│   ├── Tooltip.tsx            # Radix Tooltip (Provider + Trigger + Content) [Wave 2]
│   └── *.stories.tsx          # 10 Storybook stories (1 por componente) [Wave 3]
├── .storybook/                # Storybook 8 config [Wave 3]
│   ├── main.ts
│   └── preview.ts
├── .github/workflows/
│   ├── a11y.yml               # Pa11y WCAG AA CI template [Wave 2]
│   └── visual-regression.yml  # Lost Pixel visual regression CI [Wave 3]
├── themes/                    # Multi-brand themes [Wave 4]
│   ├── default.css
│   ├── ocean.css
│   ├── forest.css
│   └── README.md
└── components/
    ├── Form.tsx               # RHF + Zod wrappers (FormField, FormItem, FormControl, ...) [Wave 4]
    └── Form.stories.tsx       # Story LoginForm [Wave 4]
```

**Total Wave 1 + 2 + 3 + 4:** 11 componentes Radix + tokens + tailwind + globals.css + a11y CI + Storybook + visual regression + forms + 3 themes + animations.

## Uso

### 1. Inicializar no projeto

```bash
legion ui init                    # copia pra ./design-system/
legion ui init my-project-ui      # destino custom
legion ui init . --force          # sobrescreve arquivos existentes
```

## Setup (Tailwind 4)

Após copiar via `legion ui init`:

```bash
cd <destination>
```

Plugin PostCSS + Tailwind 4:

```bash
pnpm add -D @tailwindcss/postcss tailwindcss
```

Component deps (Radix + form + utility):

```bash
pnpm add @radix-ui/react-checkbox @radix-ui/react-dialog \
         @radix-ui/react-label @radix-ui/react-select @radix-ui/react-slot \
         @radix-ui/react-switch @radix-ui/react-tabs @radix-ui/react-toast \
         @radix-ui/react-tooltip @hookform/resolvers react-hook-form zod \
         class-variance-authority clsx tailwind-merge lucide-react
```

Adicione `postcss.config.js` ao projeto-raiz (ou copie do template) com:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

No layout root (Next.js: `app/layout.tsx`), importe o globals.css:

```tsx
import "./design-system/globals.css";
```

Dark mode: adicione `class="dark"` no `<html>`. Multi-brand: `data-theme="ocean"` (ou `forest`, `default`).

## A11y CI

`.github/workflows/a11y.yml` é template — copie pra `.github/workflows/` no
projeto e adicione URLs das páginas-chave. Roda Pa11y contra WCAG2AA.

### Storybook (Wave 3)

```bash
npm install -D storybook @storybook/react-vite @storybook/react @storybook/test \
  @storybook/addon-essentials @storybook/addon-interactions @storybook/addon-a11y \
  lost-pixel

# package.json scripts:
#   "storybook": "storybook dev -p 6006"
#   "build-storybook": "storybook build"

npm run storybook   # abre http://localhost:6006
```

10 stories cobrem todas as variants dos componentes. Decorator no `preview.ts`
alterna `.dark` class globalmente — toggle pela toolbar Storybook.

### Visual regression CI (Wave 3)

`.github/workflows/visual-regression.yml` roda Lost Pixel após `build-storybook`.
Compara screenshots contra baseline em `.lostpixel/baseline/`. Falha CI se diff
>0.1%. Atualizar baseline: comment `/lp update` no PR ou push manual.

### Forms (Wave 4)

`components/Form.tsx` é wrapper shadcn-style sobre **react-hook-form** + **Zod**:

- `Form` (alias de `FormProvider`)
- `FormField` (Controller com contexto de campo)
- `FormItem` (div com id contextual + spacing)
- `FormLabel` (Radix Label vinculado a `htmlFor`)
- `FormControl` (Radix Slot — passa props pro input filho)
- `FormDescription` / `FormMessage` (a11y `aria-describedby`)

Deps adicionais:
```bash
npm install react-hook-form @hookform/resolvers zod \
  @radix-ui/react-label
```

Story exemplo (`Form.stories.tsx`): `LoginForm` com schema Zod
(`email` + `password.min(8)`) e `handleSubmit`.

### Multi-brand themes (Wave 4)

`themes/` traz 3 palettes plugáveis via atributo `data-theme`:

```tsx
import "./design-system/themes/default.css";
import "./design-system/themes/ocean.css";   // azul/teal
import "./design-system/themes/forest.css";  // verde/earth
```

```html
<html data-theme="ocean">           <!-- ativa ocean -->
<html data-theme="forest" class="dark">  <!-- forest + dark -->
```

Detalhes e instruções pra criar tema novo: `themes/README.md`.

### Animations (Wave 4)

`lib/animations.ts` exporta 5 constantes Tailwind class strings prontas:

```ts
import { FADE_IN, SLIDE_UP, SLIDE_DOWN, SCALE_IN, PULSE } from "./design-system/lib/animations";
```

Patterns: `FADE_IN`, `SLIDE_UP`, `SLIDE_DOWN`, `SCALE_IN`, `PULSE`.

Dep adicional:

```bash
pnpm add -D tailwindcss-animate
```

Animations já estão configuradas em `globals.css` com Tailwind 4 `@theme inline`.

## CSS global — Tailwind 4 @theme inline

Em `globals.css` (ou equivalente), configure `@theme inline` para tokens HSL. Exemplo:

```css
@theme inline {
  --background: 0 0% 100%;
  --foreground: 0 0% 4%;
  --primary: 222 47% 11%;
  --primary-foreground: 0 0% 98%;
  --secondary: 0 0% 96%;
  --secondary-foreground: 0 0% 9%;
  --muted: 0 0% 96%;
  --muted-foreground: 0 0% 45%;
  --accent: 0 0% 96%;
  --accent-foreground: 0 0% 9%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 90%;
  --input: 0 0% 90%;
  --ring: 222 47% 11%;
}

@layer base {
  :root {
    color-scheme: light;
  }

  .dark {
    color-scheme: dark;
    --background: 0 0% 4%;
    --foreground: 0 0% 98%;
    /* ... ver DESIGN.md tabela completa */
  }
}
```

Utilities Tailwind (`bg-primary`, `text-foreground`, etc.) ficam disponíveis automaticamente.

## Importar componentes

```tsx
import { Button } from "./design-system/components/Button";
import { Card, CardHeader, CardTitle, CardContent } from "./design-system/components/Card";

export default function HomePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Olá</CardTitle>
      </CardHeader>
      <CardContent>
        <Button variant="default">Clique</Button>
      </CardContent>
    </Card>
  );
}
```

## Customização

Vendoring: **edite diretamente**. Não há sincronização automática com upstream.
Quando mudar variants/tokens, **documente no `DESIGN.md` do projeto** pra futuras
referências.

## Wave 2 planejada

- 5+ componentes adicionais (Select, Checkbox, Switch, Tabs, Tooltip)
- Dark mode provider canônico
- Storybook setup
- Visual regression (Chromatic ou similar)
- A11y testing (axe-core CI)

## Origem

Baseado em [shadcn/ui](https://ui.shadcn.com) (MIT) + Radix UI primitives.
Tokens HSL ajustados pra WCAG AA contrast.
