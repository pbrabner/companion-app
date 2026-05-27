/**
 * /reflect — daily reflection journaling page.
 * Stream-based form that posts to /api/reflect (T-009 backend).
 *
 * PRD: docs/plans/2026-05-24-frontend-reflect-design.md
 */

import { ReflectForm } from './ReflectForm';

export default function ReflectPage() {
  return (
    <main className="min-h-screen py-12">
      <ReflectForm />
    </main>
  );
}
