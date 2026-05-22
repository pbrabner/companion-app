// `cn()` helper canônico shadcn — combina clsx + tailwind-merge.
// Permite override de utilities Tailwind sem conflito (ex: cn("p-2", isLg && "p-4")).
//
// Deps esperadas no projeto-destino: `clsx`, `tailwind-merge`.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
