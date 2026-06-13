/**
 * /reflect — daily reflection journaling page.
 * Stream-based form that posts to /api/reflect (T-009 backend).
 *
 * PRD: docs/plans/2026-05-24-frontend-reflect-design.md
 */

import Link from 'next/link';

import { ReflectForm } from './ReflectForm';

export default function ReflectPage() {
  return (
    <main className="min-h-screen py-12">
      <ReflectForm />
      <p className="text-center mt-6">
        <Link
          href="/reflections"
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          Ver histórico
        </Link>
      </p>
    </main>
  );
}
