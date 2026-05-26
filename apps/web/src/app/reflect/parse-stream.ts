/**
 * Parses streaming response from POST /api/reflect.
 *
 * Stream contract (from route.ts):
 *   First line: JSON metadata `{"reflection_id": "<uuid>"}\n`
 *   Body: raw Claude text chunks
 *   Optional tail: `\n{"error":"ai_unavailable","reflection_id":"<uuid>"}\n`
 */

export type ReflectStreamEvent =
  | { type: 'metadata'; reflection_id: string }
  | { type: 'text'; chunk: string }
  | { type: 'error'; code: string; reflection_id?: string };

const TAIL_ERROR_PATTERN = /\n(\{"error":[^\n]+\})\n?$/;

export async function* parseReflectStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<ReflectStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let metadataParsed = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    if (!metadataParsed) {
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const firstLine = buffer.slice(0, newlineIdx);
        try {
          const parsed = JSON.parse(firstLine);
          if (parsed && typeof parsed.reflection_id === 'string') {
            yield { type: 'metadata', reflection_id: parsed.reflection_id };
            buffer = buffer.slice(newlineIdx + 1);
          }
        } catch {
          // Not JSON → treat full first line as text (malformed contract)
          // Don't consume the buffer; fall through to text emission
        }
        metadataParsed = true;
      } else {
        // Not enough data yet for first newline; wait for more
        continue;
      }
    }

    // Check for tail error pattern at end of accumulated buffer
    const tailMatch = buffer.match(TAIL_ERROR_PATTERN);
    if (tailMatch) {
      const textBefore = buffer.slice(0, buffer.length - tailMatch[0].length);
      if (textBefore.length > 0) {
        yield { type: 'text', chunk: textBefore };
      }
      try {
        const matchedJson = tailMatch[1] ?? '';
        const err = JSON.parse(matchedJson);
        yield {
          type: 'error',
          code: err.error,
          reflection_id: err.reflection_id,
        };
      } catch {
        yield { type: 'text', chunk: buffer };
      }
      buffer = '';
      continue;
    }

    if (buffer.length > 0) {
      yield { type: 'text', chunk: buffer };
      buffer = '';
    }
  }

  // Flush any final buffer remaining
  if (buffer.length > 0) {
    yield { type: 'text', chunk: buffer };
  }
}
