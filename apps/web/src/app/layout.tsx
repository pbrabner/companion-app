/**
 * Root layout for the Companion web app — required by Next.js App Router.
 * Provides minimal HTML scaffold; styling deferred to dedicated UI tasks.
 * @module app/layout
 */

import type { ReactNode } from 'react';

export const metadata = {
  title: 'Companion',
  description: 'Companion — desenvolva seu próprio humano',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}