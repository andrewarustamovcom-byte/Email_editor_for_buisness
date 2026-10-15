import Fastify, { LogController } from 'fastify';
import { createHash } from 'node:crypto';
import { requestSchema, responseSchema, validateModelResult } from '../../../packages/contracts/src/index';
import type { Config } from './config';
import { Budget } from './budget';
import { ApiError } from './errors';
import { MockProvider, YandexProvider, type AIProvider } from './providers';

export function createApp(config: Config, provider?: AIProvider) {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: 'info' },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 128000, requestTimeout: 10000, connectionTimeout: 30000,
    // Never trust arbitrary X-Forwarded-For. See reverse-proxy setup in docs.
    trustProxy: false,
  });
  const ai = provider ?? (config.AI_PROVIDER === 'mock' ? new MockProvider() : new YandexProvider(config));
  const budget = new Budget(config);
  const ips = new Map<string, { minute: number; count: number }>();
  let global = { minute: 0, count: 0 }; let active = 0;
  app.addHook('onClose', async () => { budget.close(); });
  app.addHook('onSend', async (_req, reply) => { reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff'); });
  app.setErrorHandler((error, _req, reply) => {
    const known = error instanceof ApiError;
    const httpStatus = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = known ? error.status : httpStatus === 413 ? 413 : httpStatus === 400 || httpStatus === 415 ? 400 : 500;
    if (status === 429) reply.header('Retry-After', '60');
    // Never serialize validation errors, bodies, upstream responses, arbitrary URLs or secrets.
    reply.code(status).send({ code: known ? error.code : status === 413 ? 'TEXT_TOO_LARGE' : status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
      message: known ? error.message : status < 500 ? 'Проверьте формат и размер письма и истории.' : 'Сервис временно недоступен.' });
  });
  app.get('/health', async () => ({ status: 'ok', provider: ai.name, schemaVersion: '1' }));
  app.post('/v1/analyze', {
    onRequest: async (req) => {
      const minute = Math.floor(Date.now() / 60000);
      if (minute !== global.minute) { global = { minute, count: 0 }; ips.clear(); }
      const bucket = ips.get(req.ip) ?? { minute, count: 0 };
      if (ips.size >= 2048 && !ips.has(req.ip)) throw new ApiError('RATE_LIMITED', 429, 'Слишком много запросов. Повторите через минуту.');
      bucket.count++; global.count++; ips.set(req.ip, bucket);
      if (bucket.count > config.IP_REQUESTS_PER_MINUTE || global.count > config.GLOBAL_REQUESTS_PER_MINUTE)
        throw new ApiError('RATE_LIMITED', 429, 'Слишком много запросов. Повторите через минуту.');
    },
  }, async (req) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError('INVALID_REQUEST', 400, 'Проверьте формат и размер письма и истории.');
    const input = parsed.data;
    const hash = createHash('sha256').update(JSON.stringify({ subject: input.subject, text: input.text })).digest('hex');
    if (hash !== input.snapshotHash) throw new ApiError('SNAPSHOT_MISMATCH', 400, 'Снимок письма не совпадает с запросом.');
    if (active >= config.MAX_CONCURRENT) throw new ApiError('BUSY', 429, 'Сервис занят. Повторите через минуту.');
    active++;
    try {
      const raw = await ai.analyze(input, (tokens, first) => budget.reserve(tokens, first));
      let result;
      try { result = validateModelResult(raw, input); }
      catch { throw new ApiError('INVALID_ANALYSIS', 502, 'Ответ модели не прошёл проверку. Запустите анализ повторно.'); }
      return responseSchema.parse({ ...result,
        schemaVersion: '1', promptVersion: '1.0.0', requestId: input.requestId, editorId: input.editorId,
        revision: input.revision, snapshotHash: input.snapshotHash, contextCoverage: input.contextCoverage,
        contextNote: input.contextCoverage === 'none' ? 'История не передана: договорённости не проверены.' :
          input.contextCoverage === 'partial' ? 'Проверены только выбранные доступные сообщения. История неполная.' : 'Проверен только предоставленный набор сообщений, не весь почтовый ящик.',
        provider: ai.name,
      });
    } finally { active--; }
  });
  return app;
}
