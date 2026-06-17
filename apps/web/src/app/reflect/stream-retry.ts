/**
 * Cliente: dispara POST /api/reflect/<id>/retry e expõe os eventos do stream via
 * parseReflectStream. Usado por ReflectForm e ReflectionsList.
 * @module app/reflect/stream-retry
 */
import { parseReflectStream, type ReflectStreamEvent } from './parse-stream';

export type RetryResult =
  | { ok: true; events: AsyncGenerator<ReflectStreamEvent> }
  | { ok: false; code: 'auth' | 'not_found' | 'already_answered' | 'network' };

export async function streamRetry(reflectionId: string): Promise<RetryResult> {
  try {
    const res = await fetch(`/api/reflect/${reflectionId}/retry`, { method: 'POST' });
    if (res.status === 401) return { ok: false, code: 'auth' };
    if (res.status === 404) return { ok: false, code: 'not_found' };
    if (res.status === 409) return { ok: false, code: 'already_answered' };
    if (!res.ok || !res.body) return { ok: false, code: 'network' };
    return { ok: true, events: parseReflectStream(res.body.getReader()) };
  } catch {
    return { ok: false, code: 'network' };
  }
}
