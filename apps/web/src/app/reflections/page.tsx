/**
 * /reflections — historico de reflexoes do usuario com respostas da IA.
 * Rota protegida (middleware redireciona sem session por default).
 *
 * Spec: docs/superpowers/specs/2026-06-11-reflections-history-design.md
 */

import Link from 'next/link';

import { ReflectionsList } from './ReflectionsList';

export default function ReflectionsPage() {
  return (
    <main className="min-h-screen py-12 px-4">
      <div className="max-w-2xl mx-auto mb-8 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Histórico de reflexões</h1>
        <Link
          href="/reflect"
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          Refletir
        </Link>
      </div>
      <ReflectionsList />
    </main>
  );
}
