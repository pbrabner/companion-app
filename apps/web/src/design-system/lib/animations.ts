// Animations canônicos Legion — constantes Tailwind class strings.
//
// Padrões reutilizáveis pra entrada/saída de componentes (Dialog, Toast,
// Tooltip, drawer, sheet etc).
//
// Deps obrigatórias no projeto-destino:
//   npm install -D tailwindcss-animate
//
// E adicionar ao tailwind.config.js:
//   plugins: [require("tailwindcss-animate"), ...]
//
// Uso:
//   import { FADE_IN, SLIDE_UP } from "../lib/animations";
//   <div className={cn(FADE_IN, "rounded border p-4")}>...</div>

/** Fade-in suave (200ms). Bom pra overlays, tooltips. */
export const FADE_IN = "animate-in fade-in-0 duration-200";

/** Slide-up entrada (200ms). Bom pra dialogs, sheets bottom. */
export const SLIDE_UP = "animate-in slide-in-from-bottom-2 duration-200";

/** Slide-down entrada (200ms). Bom pra dropdowns, navbars. */
export const SLIDE_DOWN = "animate-in slide-in-from-top-2 duration-200";

/** Scale-in entrada (150ms). Bom pra menus, popovers Radix. */
export const SCALE_IN =
  "animate-in zoom-in-95 fade-in-0 duration-150";

/** Pulse contínuo. Bom pra skeleton loaders, badges live. */
export const PULSE = "animate-pulse";

/** Map exportado pra discovery via Object.keys. */
export const ANIMATIONS = {
  FADE_IN,
  SLIDE_UP,
  SLIDE_DOWN,
  SCALE_IN,
  PULSE,
} as const;

export type AnimationName = keyof typeof ANIMATIONS;
