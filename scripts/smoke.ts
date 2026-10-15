import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { categories, requestSchema } from '../packages/contracts/src/index';
import { analyzeDirect } from '../apps/extension/src/direct/groq';
import { keySchema } from '../apps/extension/src/direct/storage';
import { snapshotHash } from '../apps/extension/src/content/session';
const key = keySchema.safeParse(process.env.GROQ_API_KEY);
if (!key.success) throw new Error('Set GROQ_API_KEY in local .env for this one-request live smoke. Use Groq Free for a free quota.');
const subject = 'Информация о встрече'; const text = 'Коллеги, протокол встречи опубликован для информации.';
const input = requestSchema.parse({ requestId: randomUUID(), editorId: 'owner-live-smoke', revision: 0, subject, text,
  snapshotHash: await snapshotHash({ subject, text }), history: [], contextCoverage: 'none', language: 'ru', currentDate: new Date().toISOString(),
  timezone: 'Europe/Moscow', settings: { categories: [...categories] } });
const prompt = await readFile('packages/prompts/email-review.ru.md', 'utf8');
const result = await analyzeDirect(input, prompt, async () => key.data);
console.log(`Live smoke passed. Provider=${result.provider}, issues=${result.issues.length}. No key or email contents logged.`);
