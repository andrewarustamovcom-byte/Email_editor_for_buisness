import { createHash, randomUUID } from 'node:crypto';
import { categories, requestSchema, responseSchema } from '../packages/contracts/src/index';
const api = new URL(process.env.EXTENSION_API_URL ?? 'http://127.0.0.1:8787');
const health = await fetch(new URL('/health', api), { signal: AbortSignal.timeout(10000) }).then(r => r.json()) as { provider?: string };
if (health.provider !== 'yandex') throw new Error('Smoke requires a running YandexProvider backend, not mock');
const subject = 'Информация о встрече'; const text = 'Коллеги, встреча завершилась. Протокол направлю отдельным письмом.';
const request = requestSchema.parse({
  requestId: randomUUID(), editorId: 'owner-smoke', revision: 0, subject, text,
  snapshotHash: createHash('sha256').update(JSON.stringify({ subject, text })).digest('hex'),
  history: [], contextCoverage: 'none', language: 'ru', currentDate: new Date().toISOString(),
  timezone: 'Europe/Moscow', settings: { categories: [...categories] },
});
const response = await fetch(new URL('/v1/analyze', api), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(55000) });
if (!response.ok) throw new Error(`Smoke failed: HTTP ${response.status}`);
const result = responseSchema.parse(await response.json());
if (result.provider !== 'yandex' || result.requestId !== request.requestId) throw new Error('Unexpected provider or request');
console.log(`Live smoke passed. Provider=yandex, issues=${result.issues.length}. No email contents logged.`);
