import { z } from 'zod';
import { modelJsonSchema, requestSchema, responseSchema, validateModelResult, type AnalyzeRequest, type AnalyzeResponse } from '../../../../packages/contracts/src/index';
import { snapshotHash } from '../content/session';
import { DIRECT_TIMEOUT_MS, GROQ_ENDPOINT, GROQ_MODEL, MAX_OUTPUT_TOKENS } from './config';
const envelopeSchema = z.object({ choices: z.array(z.object({
  finish_reason: z.string(), message: z.object({ content: z.string().max(100000).nullable(), refusal: z.string().nullable().optional() }),
})).length(1) });
class GroqError extends Error {}

/** Wire schema is structural; all richer bounds are enforced locally. */
export function structuredSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structuredSchema);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !['$schema', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'pattern', 'format'].includes(key))
    .map(([key, child]) => [key, structuredSchema(child)]));
}
export function groqPayload(request: AnalyzeRequest, prompt: string) {
  return {
    model: GROQ_MODEL, temperature: 0.1, stream: false, max_completion_tokens: MAX_OUTPUT_TOKENS, reasoning_effort: 'low',
    messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(request) }],
    response_format: { type: 'json_schema', json_schema: { name: 'email_review', strict: true, schema: structuredSchema(modelJsonSchema) } },
  };
}
export async function analyzeDirect(raw: unknown, prompt: string, reserve: (tokens: number) => Promise<string>, fetcher: typeof fetch = fetch): Promise<AnalyzeResponse> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Слишком большой текст или некорректный запрос.');
  const request = parsed.data;
  if (await snapshotHash(request) !== request.snapshotHash) throw new Error('Письмо изменилось. Запустите проверку повторно.');
  const body = JSON.stringify(groqPayload(request, prompt));
  // Conservative local allowance; not the provider's tokenizer or billing ledger.
  const reservedTokens = new TextEncoder().encode(body).byteLength + MAX_OUTPUT_TOKENS + 1024;
  const key = await reserve(reservedTokens);
  try {
    const response = await fetcher(GROQ_ENDPOINT, {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new GroqError('Groq отклонил доступ. Проверьте ключ и доступность сервиса для вашего аккаунта.');
      if (response.status === 429) throw new GroqError('Достигнут лимит Groq. Подождите и повторите позже; для длинного письма сократите выбранную историю.');
      if ([400, 413].includes(response.status)) throw new GroqError('Groq не принял запрос. Возможно, превышен лимит текста или изменилась поддержка модели.');
      throw new GroqError('Groq временно недоступен. Повторите проверку позже.');
    }
    const reader = response.body?.getReader(); if (!reader) throw new Error('EMPTY_MODEL_RESPONSE');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > 128000) throw new Error('INVALID_MODEL_RESPONSE');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let result;
    try {
      const envelope = envelopeSchema.parse(JSON.parse(new TextDecoder().decode(bytes))); const choice = envelope.choices[0]!;
      if (choice.finish_reason !== 'stop' || !choice.message.content || choice.message.refusal) throw new Error('Incomplete model response');
      result = validateModelResult(JSON.parse(choice.message.content), request);
    } catch { throw new GroqError('Ответ нейросети не прошёл проверку. Правки не применены; повторите анализ позже.'); }
    return responseSchema.parse({ ...result, schemaVersion: '1', promptVersion: '1.0.0',
      requestId: request.requestId, editorId: request.editorId, revision: request.revision, snapshotHash: request.snapshotHash,
      contextCoverage: request.contextCoverage, provider: 'groq',
      contextNote: request.contextCoverage === 'none' ? 'История не передана: договорённости не проверены.' : 'Проверены только выбранные сообщения. История может быть неполной.',
    });
  } catch (error) {
    // Never expose upstream response bodies, network error details or credentials.
    if (error instanceof GroqError) throw error;
    // A raw network error can include credentials. Do not preserve it in a cause.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('Не удалось получить ответ Groq. Проверьте соединение и повторите позже.');
  }
}
