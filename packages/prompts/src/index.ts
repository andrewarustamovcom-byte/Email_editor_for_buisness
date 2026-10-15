import { readFileSync } from 'node:fs';
export const promptVersion = '1.0.0' as const;
export const systemPrompt = readFileSync(new URL('../email-review.ru.md', import.meta.url), 'utf8');
