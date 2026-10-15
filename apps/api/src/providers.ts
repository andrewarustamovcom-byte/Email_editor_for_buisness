import { z } from 'zod';
import { modelJsonSchema, modelResultSchema, type AnalyzeRequest } from '../../../packages/contracts/src/index';
import { systemPrompt } from '../../../packages/prompts/src/index';
import type { Config } from './config';
import { ApiError } from './errors';
export interface AIProvider {
  readonly name: 'mock' | 'yandex';
  estimateTokens(request: AnalyzeRequest): number;
  analyze(request: AnalyzeRequest, reserveAttempt: (tokens: number, first: boolean) => void): Promise<unknown>;
}

export { MockProvider } from './mock';
const envelopeSchema = z.object({ result: z.object({ alternatives: z.array(z.object({
  status: z.string(), message: z.object({ text: z.string().max(100000) }),
})).min(1) }) });

export class YandexProvider implements AIProvider {
  readonly name = 'yandex' as const;
  constructor(private config: Config, private fetcher: typeof fetch = fetch) {}
  private payload(request: AnalyzeRequest) {
    return {
      modelUri: `gpt://${this.config.YANDEX_FOLDER_ID}/${this.config.YANDEX_MODEL}`,
      completionOptions: { stream: false, temperature: 0.1, maxTokens: String(this.config.MAX_OUTPUT_TOKENS), reasoningOptions: { mode: 'DISABLED' } },
      messages: [{ role: 'system', text: systemPrompt }, { role: 'user', text: JSON.stringify(request) }],
      jsonSchema: { schema: modelJsonSchema },
    };
  }
  estimateTokens(request: AnalyzeRequest) {
    // UTF-8 bytes conservatively upper-bound byte-level tokenization; reserve schema and overhead too.
    return Buffer.byteLength(JSON.stringify(this.payload(request)), 'utf8') + this.config.MAX_OUTPUT_TOKENS + 1024;
  }
  async analyze(request: AnalyzeRequest, reserve: (tokens: number, first: boolean) => void): Promise<unknown> {
    const body = JSON.stringify(this.payload(request));
    const signal = AbortSignal.timeout(this.config.PROVIDER_TIMEOUT_MS);
    for (let attempt = 0; attempt < 2; attempt++) {
      reserve(this.estimateTokens(request), attempt === 0);
      try {
        const response = await this.fetcher(`${this.config.YANDEX_API_BASE_URL.replace(/\/$/, '')}/foundationModels/v1/completion`, {
          method: 'POST', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Api-Key ${this.config.YANDEX_API_KEY}`, 'x-folder-id': this.config.YANDEX_FOLDER_ID, 'x-data-logging-enabled': 'false' }, body,
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (attempt === 0 && [429, 502, 503].includes(response.status)) {
            await new Promise(resolve => setTimeout(resolve, 300)); continue;
          }
          if ([401, 403].includes(response.status)) throw new ApiError('PROVIDER_CONFIGURATION', 503, 'Владелец проекта должен проверить подключение модели.');
          throw new ApiError('PROVIDER_UNAVAILABLE', 503, 'Сервис анализа временно недоступен. Повторите позже.');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Missing response body');
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) {
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 128000) throw new Error('Response too large');
            chunks.push(chunk.value);
          }
        } finally { await reader.cancel(); }
        const envelope = envelopeSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        const alternative = envelope.result.alternatives[0]!;
        if (alternative.status !== 'ALTERNATIVE_STATUS_FINAL') throw new Error('Incomplete model output');
        return modelResultSchema.parse(JSON.parse(alternative.message.text));
      } catch (error) {
        if (error instanceof ApiError) throw error;
        // No retries after timeout/network failure: the provider may have already billed the call.
        throw new ApiError('INVALID_PROVIDER_RESPONSE', 502, 'Не удалось получить корректный ответ модели. Правки не применены.');
      }
    }
    throw new ApiError('PROVIDER_UNAVAILABLE', 503, 'Сервис анализа временно недоступен.');
  }
}
