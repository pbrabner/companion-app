/**
 * Constrói o ReadableStream de resposta empática usado por POST /api/reflect e
 * pelo endpoint de retry. Contrato: 1ª linha {reflection_id}, chunks de texto,
 * tail {error:"ai_unavailable"} em falha. Persiste a resposta best-effort em
 * sucesso. Privacy ★ALTO: nunca loga body/ai_response — só metadata + error_code.
 * @module app/api/reflect/response-stream
 */
import { chatStream } from '@/shared/ai/client';
import { createServiceClient } from '@/shared/db/service';

const SAVE_TIMEOUT_MS = 5000;

/**
 * Persiste a resposta completa da IA best-effort. NUNCA lança e resolve em no
 * máximo SAVE_TIMEOUT_MS. Loga só reflection_id + error_code.
 */
async function saveAiResponse(reflectionId: string, text: string): Promise<void> {
  try {
    const service = createServiceClient();
    const save = service
      .from('journal_entries')
      .update({ ai_response: text, ai_response_at: new Date().toISOString() })
      .eq('id', reflectionId)
      .then(({ error }) => (error ? (error.code ?? 'unknown') : null));
    const timeout = new Promise<string>((resolve) => {
      setTimeout(() => resolve('save_timeout'), SAVE_TIMEOUT_MS).unref?.();
    });
    const errorCode = await Promise.race([save, timeout]);
    if (errorCode !== null) {
      console.error('[reflect] ai_response_save_failed', {
        reflection_id: reflectionId,
        error_code: errorCode,
      });
    }
  } catch (err) {
    console.error('[reflect] ai_response_save_failed', {
      reflection_id: reflectionId,
      error_code: err instanceof Error ? err.constructor.name : 'unknown',
    });
  }
}

export interface BuildReflectionResponseStreamArgs {
  reflectionId: string;
  body: string;
  userId: string;
  systemPrompt: string;
  /** Hook pós-stream (ex.: disparar síntese). Só o POST passa. */
  onComplete?: () => Promise<void>;
}

/**
 * Stream da resposta empática: metadata → chatStream (acumula) → saveAiResponse
 * em sucesso, ou trailer ai_unavailable em falha. Roda onComplete no finally.
 */
export function buildReflectionResponseStream(
  args: BuildReflectionResponseStreamArgs,
): ReadableStream<Uint8Array> {
  const { reflectionId, body, userId, systemPrompt, onComplete } = args;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(JSON.stringify({ reflection_id: reflectionId }) + '\n'),
      );
      let accumulated = '';
      let aiSucceeded = false;
      try {
        for await (const chunk of chatStream({
          system: systemPrompt,
          messages: [{ role: 'user', content: body }],
        })) {
          accumulated += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        aiSucceeded = true;
      } catch (err) {
        // Privacy: só a classe do erro, nunca err.message.
        const errCode = err instanceof Error ? err.constructor.name : 'unknown';
        console.error('[reflect] ai_unavailable', {
          user_id: userId,
          reflection_id: reflectionId,
          content_length: body.length,
          error_code: errCode,
        });
        controller.enqueue(
          encoder.encode(
            '\n' + JSON.stringify({ error: 'ai_unavailable', reflection_id: reflectionId }) + '\n',
          ),
        );
      } finally {
        if (aiSucceeded) await saveAiResponse(reflectionId, accumulated);
        if (onComplete) await onComplete();
        controller.close();
      }
    },
  });
}
