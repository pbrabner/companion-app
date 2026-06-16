# Fallback Sonnet→Gemini no chatStream — Design

**Data:** 2026-06-16
**Operador:** Pacini
**Repo:** D:/companion-app (`apps/web`)
**Branch a criar:** `feat/chatstream-gemini-fallback`

## Problema

Hoje só `classifyHaiku` (não-streaming) tem fallback Gemini (CA-MM-7). O
`chatStream` (resposta empática streaming do `/reflect`, Sonnet 4.6) **não tem**.
Quando o Anthropic está indisponível — ex.: `ANTHROPIC_API_KEY` ausente no
ambiente — toda reflexão devolve `ai_unavailable` e a UI mostra "IA indisponível",
mesmo com a `GEMINI_API_KEY` funcionando. O smoke do PR #12 expôs isso ao vivo.

## Objetivo

Quando o Anthropic falha **na abertura do stream** (antes do primeiro token),
`chatStream` cai para um stream do Gemini, transparente para a rota. O usuário
recebe a resposta empática via Gemini em vez de "IA indisponível".

## Não-objetivos (YAGNI)

- Fallback para falha **no meio** do stream (após tokens já emitidos) — mantém o
  comportamento atual (`ai_unavailable` com texto parcial); evita o usuário ver
  texto do Sonnet e depois um restart do Gemini.
- Sinalizar na UI qual provedor respondeu — irrelevante para o usuário.
- Fallback para outros provedores além do Gemini.
- Mudar a rota `/reflect`, migrations ou UI.

## Arquitetura

Encapsular o fallback **dentro do `chatStream`**, espelhando o padrão já existente
no `classifyHaiku` (que encapsula `classifyGeminiFallback`). A rota `/reflect`
permanece intacta: ela continua consumindo um "stream de texto" e só emite
`ai_unavailable` quando os **dois** provedores falham.

`chatStream` é o único consumidor real (`grep` confirmou: demais ocorrências são
testes/eval).

### Componente 1 — `chatStreamGeminiFallback(args: ChatStreamArgs)` (novo)

Async generator privado em `apps/web/src/shared/ai/client.ts`.

- Lê `process.env.GEMINI_API_KEY` lazy (padrão estabelecido; sem validação no
  import).
- Mapeia `ChatMessage[]` → `contents` do Gemini:
  - role `assistant` → `'model'`, role `user` → `'user'`
  - cada mensagem vira `{ role, parts: [{ text: content }] }`
- `system` → `config.systemInstruction`.
- `const genai = new GoogleGenAI({ apiKey })`
- `const stream = await genai.models.generateContentStream({ model: GEMINI_FALLBACK_MODEL, contents, config: { systemInstruction: args.system } })`
- itera: para cada chunk, `const t = chunk.text; if (typeof t === 'string' && t.length > 0) yield t;`

Reusa `GEMINI_FALLBACK_MODEL = 'gemini-flash-latest'` (já exportado). API confirmada
no `@google/genai` 2.8.0: `generateContentStream(params) => Promise<AsyncGenerator<GenerateContentResponse>>`,
cada `GenerateContentResponse` tem `.text`.

### Componente 2 — `chatStream` com fronteira "antes do primeiro token"

```ts
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
      const evt = event as { type?: string; delta?: { type?: string; text?: string } };
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
    if (yielded) throw err;                  // mid-stream → propaga (texto parcial já entregue)
    yield* chatStreamGeminiFallback(args);   // abertura falhou → fallback Gemini
  }
}
```

A flag `yielded` é a fronteira exata: setada imediatamente antes do primeiro
`yield`. Erro com `yielded === false` (ex.: `await client.messages.stream()` rejeita
por chave ausente, ou auth-error na primeira iteração) → fallback. Erro com
`yielded === true` → re-lança, e a rota trata como `ai_unavailable` (texto parcial
já foi ao usuário).

## Privacy gate (★ALTO)

- O `catch` do `chatStream` **não loga** o erro original (igual `classifyHaiku`):
  erros do SDK Anthropic podem ecoar fragmentos do payload (conteúdo da reflexão).
- Quem loga continua sendo a rota `/reflect`, que já registra só `error_code`
  (nome da classe do erro, nunca `err.message`) e metadados. Sem mudança na rota.
- O fallback Gemini não loga conteúdo.

## Tratamento de erros

| Cenário | Comportamento |
|---|---|
| Anthropic OK | streama Sonnet; Gemini nunca instanciado |
| Anthropic falha na abertura (0 tokens) | fallback streama Gemini |
| Anthropic falha após N tokens | re-lança; rota emite `ai_unavailable` + texto parcial |
| Anthropic falha na abertura **e** Gemini falha | erro propaga; rota emite `ai_unavailable` (sem texto) |

## Testes

Em `apps/web/src/shared/ai/client.test.ts`, mockando `@anthropic-ai/sdk` e
`@google/genai`:

1. **Anthropic falha na abertura + 0 tokens → emite tokens do Gemini** (caso da
   chave ausente). Assert: chunks recebidos = chunks do Gemini.
2. **Anthropic streama com sucesso → Gemini não chamado.** Assert:
   `generateContentStream` não foi invocado.
3. **Anthropic streama N tokens depois falha → erro propaga, Gemini não chamado.**
   Assert: iterar o generator lança; `generateContentStream` não invocado; os N
   tokens foram emitidos antes do throw.
4. **Ambos falham → erro propaga.** Assert: iterar lança.
5. **Mapeamento de role** `assistant`→`model` e `user`→`user` no `contents`
   passado ao `generateContentStream`.

Testes existentes de `classifyHaiku` e da rota `/reflect` permanecem verdes
(a rota mocka `chatStream` inteiro — comportamento inalterado).

## Arquivos

- **Modificar:** `apps/web/src/shared/ai/client.ts` — adiciona
  `chatStreamGeminiFallback`, envolve `chatStream`.
- **Testar:** `apps/web/src/shared/ai/client.test.ts` — adiciona os 5 testes acima.
- **Sem** migration, **sem** mudança na rota, **sem** UI.

## Critérios de aceite

- **CA-CSF-1:** `chatStreamGeminiFallback` mapeia mensagens e streama `.text` do Gemini.
- **CA-CSF-2:** `chatStream` cai pro Gemini quando Anthropic falha antes do 1º token.
- **CA-CSF-3:** `chatStream` re-lança em falha mid-stream (sem chamar Gemini).
- **CA-CSF-4:** `chatStream` streama Sonnet normalmente quando Anthropic está OK.
- **CA-CSF-5:** nenhum log de conteúdo/erro no helper; rota inalterada.
- **CA-CSF-6:** suite verde (`classifyHaiku` + rota intactos), typecheck + build limpos.
- **CA-CSF-7 (smoke):** com `ANTHROPIC_API_KEY` ausente, uma reflexão no live recebe
  resposta empática via Gemini (sem "IA indisponível").
