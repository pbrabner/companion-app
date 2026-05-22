/**
 * Root landing page for the Companion web app.
 * Smoke test for B4 design system on Tailwind 4 (PRD 2026-05-21).
 * @module app/page
 */

import { getVersion } from '@/lib/version';

import { Button } from '../design-system/components/Button';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold text-foreground">Hello Companion</h1>
      <p className="text-muted-foreground">v{getVersion()}</p>
      <Button>Smoke B4 TW4</Button>
    </main>
  );
}
