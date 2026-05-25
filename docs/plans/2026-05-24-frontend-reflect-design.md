---
title: "Frontend /reflect — page + form + stream display"
type: design
status: proposed
created: 2026-05-24
owner: pacini
workflow_id: frontend-reflect-page-form-stream-display
related:
  - apps/web/src/app/api/reflect/route.ts (T-009 backend)
  - apps/web/src/design-system/components/ (Wave 1 components)
---

# Frontend /reflect — design

## Problema

T-009 entregou backend `POST /api/reflect` (Route Handler com streaming Sonnet + persistência Supabase). Não há frontend que use isso. Companion landing é só smoke do design system. Loop end-to-end de journaling (escrever → submit → ver resposta empática IA) inativo.

## Objetivo

Página `/reflect` permite usuário autenticado escrever reflexão, submeter, e ver resposta da Claude em real-time via stream.

**Critério de sucesso:** usuário autenticado abre `/reflect`, escreve 100+ chars, clica "Enviar", vê resposta chegando palavra a palavra em ~2-5s, persistida em `journal_entries`.

## Não-objetivos

- Construir login UI (out of scope — usuário deve estar pré-autenticado via Supabase session externa; 401 mostra mensagem)
- Histórico de reflections (GET /api/reflections é task separada)
- Edit/delete (apenas create nesta entrega)
- Adicionar Textarea component ao design system (usar `<textarea>` Tailwind por enquanto)
- Markdown rendering da resposta (texto plano)

## Arquitetura

### Page route

`apps/web/src/app/reflect/page.tsx` (Next.js App Router). Server component que renderiza Client component `<ReflectForm />`.

### Component `<ReflectForm />`

Client component (`'use client'`) com:
- Textarea `<textarea>` Tailwind (chars: 3-8000, contador visível)
- Button "Enviar" (design system) — disabled se invalid OU loading
- Área de resposta: mostra chunks chegando do stream em real-time
- Error states: invalid input, 401, 429, network error
- Loading state durante stream

### Stream consumption

```typescript
const response = await fetch('/api/reflect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content }),
});

if (!response.ok) {
  // handle 400/401/413/etc
  return;
}

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';
let isFirstChunk = true;
let reflectionId: string | null = null;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  if (isFirstChunk) {
    // Parse first line as JSON metadata: {"reflection_id": "..."}\n
    const newlineIdx = buffer.indexOf('\n');
    if (newlineIdx !== -1) {
      const metadataLine = buffer.slice(0, newlineIdx);
      try {
        const meta = JSON.parse(metadataLine);
        reflectionId = meta.reflection_id;
      } catch { /* unexpected, but don't fail UI */ }
      buffer = buffer.slice(newlineIdx + 1);
      isFirstChunk = false;
    }
  }

  // Check for tail error JSON: \n{"error":"ai_unavailable",...}\n
  // Simple heuristic: if buffer ends with } and contains {"error", split it.
  // (Otherwise, treat as Claude text chunk)
  setStreamedText((prev) => prev + buffer);
  buffer = '';
}
```

### Estados visuais

| Estado | UI |
|---|---|
| `idle` | Form vazio, button "Enviar" disabled |
| `valid` | Form com 3+ chars, button enabled |
| `submitting` | Button "Enviando..." disabled, textarea readonly |
| `streaming` | Resposta aparecendo chunk-by-chunk, indicador "..." piscando no fim |
| `done` | Resposta completa, button "Nova reflexão" reset form |
| `error.input` | Mensagem inline abaixo do textarea (too short/too long) |
| `error.auth` | Card centralizado: "Você precisa estar autenticado pra registrar reflexões. Login UI em breve." |
| `error.network` | Toast "Erro de conexão. Tenta de novo." |
| `error.ai_unavailable` | Resposta parcial + nota "IA indisponível agora. Sua reflexão foi salva (ID: \<uuid\>)" |

### Layout

```
┌─ Reflect ─────────────────────────────────────────┐
│                                                   │
│ Como você está se sentindo agora?                 │
│                                                   │
│ ┌───────────────────────────────────────────────┐ │
│ │                                               │ │
│ │ (textarea, 8 rows, autofocus)                 │ │
│ │                                               │ │
│ └───────────────────────────────────────────────┘ │
│                                  142 / 8000 chars │
│                                                   │
│                                    [Enviar]       │
│                                                   │
│ ──────────────────────────────────────────────── │
│                                                   │
│ ✨ Resposta:                                      │
│                                                   │
│ (texto chegando aqui em real-time)                │
│                                                   │
└───────────────────────────────────────────────────┘
```

Mobile-first, responsive. Max-width ~640px (centered).

## Stack técnica

- Next.js 15 App Router (já em uso)
- React 19 client component
- Tailwind 4 utility classes (no Textarea novo)
- `fetch` + `ReadableStream` (browser native, no library)
- Design system Button (já existe)
- Supabase auth handled by backend (401 → UI mensagem)

## Riscos

| Risco | Mitigação |
|---|---|
| Stream parse complexity (first-line JSON + tail error JSON) | Pequena unit util `parseReflectStream()` testada em unidade |
| Browser stream API quirks (TextDecoder, getReader) | Tipos TypeScript estritos; teste E2E mock fetch |
| Resposta longa (Sonnet pode produzir 500+ palavras) trava UI | CSS `overflow-y: auto` + height limit no display |
| Form re-submit acidental durante stream | Button disabled durante `submitting | streaming` |
| Sem login UI = teste real só com seed user manual | Documentar no `/reflect` page o setup pra teste manual |

## Test plan

### Unit
1. `parseReflectStream` utility: handles first-line metadata, plain text chunks, tail error JSON
2. `<ReflectForm />` rendering: 6 estados (idle, valid, submitting, streaming, done, error)
3. Validação inline: too short, too long boundary cases

### Integration (Vitest + MSW or fetch mock)
4. Submit valid → mock streamed response → asserts UI shows reflection_id + chunks
5. 401 response → asserts error.auth card visible
6. 413 too_long → asserts inline error
7. Mid-stream connection drop → asserts error.network toast

### Manual (require Supabase session)
8. Seed user via Supabase dashboard
9. Login via magic link copied to localhost
10. Submit real reflection → see Claude stream

## Definition of Done

- ✓ `/reflect` page renderiza com form
- ✓ Submit valid input chama /api/reflect e mostra resposta streaming
- ✓ Todos 7 estados visuais cobertos
- ✓ 10+ unit/integration tests passing
- ✓ Manual smoke com seed user documentado em report
- ✓ Lost Pixel: novos snapshots se houver novos componentes/stories
- ✓ Funciona em desktop + mobile (validate via dev tools)
