# Fallback Sonnet→Gemini no chatStream — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o Anthropic falha na abertura do stream, `chatStream` cai para um stream do Gemini, transparente para a rota `/reflect`.

**Architecture:** Encapsular o fallback dentro do `chatStream` (espelha o `classifyHaiku`). Novo async generator privado `chatStreamGeminiFallback` usa `generateContentStream` do `@google/genai`. O `chatStream` ganha uma flag `yielded` que delimita "falha antes do 1º token → fallback" vs "falha mid-stream → re-lança". Rota, migrations e UI ficam intactas.

**Tech Stack:** TypeScript, Next.js 15.5 (App Router), `@anthropic-ai/sdk`, `@google/genai` 2.8.0, Vitest 2.

**Spec:** `docs/superpowers/specs/2026-06-16-chatstream-gemini-fallback-design.md` (commit 7361c0a)

**Working dir dos comandos:** `D:/companion-app/apps/web` (todos os `pnpm` rodam aqui).

---

## File Structure

- **Modificar:** `apps/web/src/shared/ai/client.ts` — adiciona `chatStreamGeminiFallback` (generator privado) e envolve `chatStream` com a fronteira `yielded`.
- **Modificar (teste):** `apps/web/src/shared/ai/client.test.ts` — estende o mock de `@google/genai` com `generateContentStream` e adiciona os testes de fallback streaming.
- **Sem** migration, **sem** mudança na rota `/reflect`, **sem** UI.

---

## Task 0: Pre-flight (INLINE — controller, não subagent)

**Files:** nenhum (verificação).

- [ ] **Step 1: Verificar branch e HEAD**

Run: `cd D:/companion-app && git rev-parse --abbrev-ref HEAD && git log --oneline -1`
Expected: branch `feat/chatstream-gemini-fallback`, HEAD `7361c0a` (spec commit).

- [ ] **Step 2: Baseline da suite**

Run (de `apps/web`): `pnpm test src/shared/ai/client.test.ts`
Expected: PASS — os testes atuais de `chatStream` (2) e `classifyHaiku` (5) verdes.

- [ ] **Step 3: Baseline typecheck**

Run (de `apps/web`): `pnpm typecheck`
Expected: 0 erros.

---

## Task 1: `chatStreamGeminiFallback` — generator de fallback streaming

**Files:**
- Modify: `apps/web/src/shared/ai/client.ts`
- Test: `apps/web/src/shared/ai/client.test.ts`

Implementa o caminho Gemini isolado (sem ainda tocar no `chatStream`). Cobre CA-CSF-1 e o mapeamento de role do CA-CSF-5.

- [ ] **Step 1: Estender o mock de `@google/genai` no teste**

No topo de `apps/web/src/shared/ai/client.test.ts`, adicionar o mock do stream junto aos mocks existentes. Adicionar a declaração após `const geminiGenerateMock = vi.fn();`:

```typescript
const geminiStreamMock = vi.fn();
```

Substituir o bloco `vi.mock('@google/genai', ...)` existente por:

```typescript
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(() => ({
    models: {
      generateContent: geminiGenerateMock,
      generateContentStream: geminiStreamMock,
    },
  })),
}));
```

E no `beforeEach`, após `geminiGenerateMock.mockReset();`, adicionar:

```typescript
  geminiStreamMock.mockReset();
```

- [ ] **Step 2: Escrever o teste que falha (streaming + role mapping)**

Adicionar ao final de `apps/web/src/shared/ai/client.test.ts` um novo bloco. `chatStreamGeminiFallback` é privado — exercitamos via `chatStream` forçando o Anthropic a falhar na abertura, mas este teste foca em provar que o caminho Gemini streama e mapeia roles:

```typescript
describe('chatStream — fallback Gemini streaming (CA-CSF-1)', () => {
  it('quando Anthropic falha na abertura, streama os chunks .text do Gemini', async () => {
    streamMock.mockRejectedValueOnce(new Error('APIConnectionError'));
    geminiStreamMock.mockResolvedValueOnce(
      (async function* () {
        yield { text: 'g1' };
        yield { text: 'g2' };
      })(),
    );

    const { chatStream } = await import('./client');

    const collected: string[] = [];
    for await (const chunk of chatStream({
      system: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
    })) {
      collected.push(chunk);
    }

    expect(collected).toEqual(['g1', 'g2']);
  });

  it('mapeia role assistant→model e user→user no contents do Gemini', async () => {
    streamMock.mockRejectedValueOnce(new Error('down'));
    geminiStreamMock.mockResolvedValueOnce(
      (async function* () {
        yield { text: 'x' };
      })(),
    );

    const { chatStream } = await import('./client');
    for await (const _ of chatStream({
      system: 'sys',
      messages: [
        { role: 'user', content: 'pergunta' },
        { role: 'assistant', content: 'resposta' },
      ],
    })) {
      void _;
    }

    expect(geminiStreamMock).toHaveBeenCalledTimes(1);
    const callArg = geminiStreamMock.mock.calls[0][0];
    expect(callArg.config).toEqual({ systemInstruction: 'sys' });
    expect(callArg.contents).toEqual([
      { role: 'user', parts: [{ text: 'pergunta' }] },
      { role: 'model', parts: [{ text: 'resposta' }] },
    ]);
  });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run (de `apps/web`): `pnpm test src/shared/ai/client.test.ts`
Expected: FAIL — o `chatStream` atual não tem fallback, então em `streamMock.mockRejectedValueOnce` ele lança em vez de cair pro Gemini (`collected` vazio / iteração lança; `geminiStreamMock` não chamado).

- [ ] **Step 4: Implementar `chatStreamGeminiFallback` e o catch mínimo no `chatStream`**

Em `apps/web/src/shared/ai/client.ts`, adicionar o generator privado logo após a função `chatStream` (antes de `classifyGeminiFallback`):

```typescript
/**
 * Fallback de chat streaming via Gemini quando o Anthropic está indisponível.
 * Mapeia ChatMessage[] para o formato `contents` do Gemini (role assistant→model)
 * e re-emite os chunks de texto. NÃO loga conteúdo.
 */
async function* chatStreamGeminiFallback(
  args: ChatStreamArgs,
): AsyncIterable<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const genai = new GoogleGenAI({ apiKey });
  const contents = args.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const stream = await genai.models.generateContentStream({
    model: GEMINI_FALLBACK_MODEL,
    contents,
    config: { systemInstruction: args.system },
  });
  for await (const chunk of stream as AsyncIterable<{ text?: string }>) {
    const t = chunk.text;
    if (typeof t === 'string' && t.length > 0) {
      yield t;
    }
  }
}
```

E envolver o corpo atual do `chatStream` num try/catch (substituir a função inteira `export async function* chatStream` existente):

```typescript
export async function* chatStream(args: ChatStreamArgs): AsyncIterable<string> {
  let yielded = false;
  try {
    const client = createClient();
    const stream = await client.messages.stream({
      model: args.model ?? SONNET_MODEL,
      max_tokens: args.maxTokens ?? 4096,
      system: args.system,
      messages: args.messages,
    });

    for await (const event of stream as AsyncIterable<unknown>) {
      const evt = event as {
        type?: string;
        delta?: { type?: string; text?: string };
      };
      if (
        evt.type === 'content_block_delta' &&
        evt.delta?.type === 'text_delta' &&
        typeof evt.delta.text === 'string'
      ) {
        yielded = true;
        yield evt.delta.text;
      }
    }
  } catch (err) {
    // Anthropic indisponível. Se já emitimos algum token (falha mid-stream),
    // re-lançamos — o texto parcial já foi entregue e a rota trata como
    // ai_unavailable. Se falhou antes do 1º token (abertura), caímos pro Gemini.
    // NÃO logamos o erro original (pode ecoar conteúdo do prompt).
    if (yielded) throw err;
    yield* chatStreamGeminiFallback(args);
  }
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run (de `apps/web`): `pnpm test src/shared/ai/client.test.ts`
Expected: PASS — os 2 novos testes verdes; os testes existentes seguem verdes.

- [ ] **Step 6: Typecheck**

Run (de `apps/web`): `pnpm typecheck`
Expected: 0 erros. (Se o tipo de `contents` reclamar, manter o objeto literal exatamente como acima — `{ role: string, parts: [{ text: string }] }` é aceito por `ContentListUnion` do genai 2.8.0.)

- [ ] **Step 7: Commit**

```bash
cd D:/companion-app && git add apps/web/src/shared/ai/client.ts apps/web/src/shared/ai/client.test.ts
git commit -m "feat(ai): chatStreamGeminiFallback + fallback na abertura do chatStream (CA-CSF-1,2)"
```

---

## Task 2: Fronteira `yielded` — comportamento completo do `chatStream`

**Files:**
- Test: `apps/web/src/shared/ai/client.test.ts`

A implementação da fronteira já entrou na Task 1. Esta task adiciona os testes que provam os ramos restantes: Sonnet OK (CA-CSF-4), mid-stream re-lança (CA-CSF-3), ambos falham (erro propaga). Test-only.

- [ ] **Step 1: Escrever os testes que faltam**

Adicionar ao bloco de fallback (ou um novo `describe`) em `apps/web/src/shared/ai/client.test.ts`:

```typescript
describe('chatStream — fronteira yielded (CA-CSF-2,3,4)', () => {
  it('Anthropic OK → streama Sonnet e NÃO chama o Gemini', async () => {
    streamMock.mockImplementation(async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } };
    });

    const { chatStream } = await import('./client');

    const collected: string[] = [];
    for await (const chunk of chatStream({
      system: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
    })) {
      collected.push(chunk);
    }

    expect(collected).toEqual(['a', 'b']);
    expect(geminiStreamMock).not.toHaveBeenCalled();
  });

  it('Anthropic emite N tokens depois falha (mid-stream) → re-lança, Gemini NÃO chamado', async () => {
    streamMock.mockImplementation(async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } };
      throw new Error('mid-stream boom');
    });

    const { chatStream } = await import('./client');

    const collected: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of chatStream({
          system: 'sys',
          messages: [{ role: 'user', content: 'oi' }],
        })) {
          collected.push(chunk);
        }
      })(),
    ).rejects.toThrow('mid-stream boom');

    expect(collected).toEqual(['a']);
    expect(geminiStreamMock).not.toHaveBeenCalled();
  });

  it('Anthropic falha na abertura E Gemini falha → erro propaga', async () => {
    streamMock.mockRejectedValueOnce(new Error('anthropic down'));
    geminiStreamMock.mockRejectedValueOnce(new Error('gemini down'));

    const { chatStream } = await import('./client');

    await expect(
      (async () => {
        for await (const _ of chatStream({
          system: 'sys',
          messages: [{ role: 'user', content: 'oi' }],
        })) {
          void _;
        }
      })(),
    ).rejects.toThrow('gemini down');
  });
});
```

- [ ] **Step 2: Rodar e ver passar**

Run (de `apps/web`): `pnpm test src/shared/ai/client.test.ts`
Expected: PASS — todos os ramos cobertos. (A implementação já existe da Task 1; estes testes não devem exigir mudança de produção. Se algum falhar, é bug de implementação da Task 1 a corrigir, não placeholder.)

- [ ] **Step 3: Commit**

```bash
cd D:/companion-app && git add apps/web/src/shared/ai/client.test.ts
git commit -m "test(ai): cobre ramos da fronteira yielded do chatStream (CA-CSF-3,4)"
```

---

## Task 3: Regressão BC + typecheck + build (INLINE — controller verify)

**Files:** nenhum (verificação; commit no-op se sem fixes).

- [ ] **Step 1: Suite completa**

Run (de `apps/web`): `pnpm test`
Expected: PASS — suite inteira verde. Os testes da rota `/reflect` (que mocka `chatStream`) e do `classifyHaiku` permanecem intactos. Contagem ≥ 118 + 5 novos = ~123 pass.

- [ ] **Step 2: Typecheck**

Run (de `apps/web`): `pnpm typecheck`
Expected: 0 erros.

- [ ] **Step 3: Build**

Run (de `apps/web`): `pnpm build`
Expected: build Next.js limpo (0 erros).

- [ ] **Step 4: Smoke gate (HUMAN — CA-CSF-7)**

Depende de `ANTHROPIC_API_KEY` ausente no `.env.local` + quota Gemini + dev server. Pacini roda: subir o dev server, escrever 1 reflexão, confirmar que a resposta empática chega (via Gemini) em vez de "IA indisponível". PAUSE para Pacini avaliar e decidir abrir o PR.

---

## Self-Review (controller, antes de despachar)

**Spec coverage:**
- CA-CSF-1 (fallback mapeia e streama) → Task 1 Step 2/4 ✅
- CA-CSF-2 (fallback antes do 1º token) → Task 1 ✅
- CA-CSF-3 (mid-stream re-lança) → Task 2 ✅
- CA-CSF-4 (Sonnet OK normal) → Task 2 ✅
- CA-CSF-5 (sem log; role mapping; rota inalterada) → Task 1 role-mapping test; rota não tocada por construção ✅
- CA-CSF-6 (suite/typecheck/build verdes) → Task 3 ✅
- CA-CSF-7 (smoke) → Task 3 Step 4 (human gate) ✅

**Placeholder scan:** nenhum "TBD/TODO"; todo código completo.

**Type consistency:** `chatStreamGeminiFallback(args: ChatStreamArgs)`, `geminiStreamMock`, `yielded`, `GEMINI_FALLBACK_MODEL` consistentes entre tasks e com a spec.
