import { z } from 'zod';
const number = (fallback: number, max: number) => z.coerce.number().int().positive().max(max).default(fallback);
const envSchema = z.object({
  AI_PROVIDER: z.enum(['mock', 'yandex']).default('mock'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'), PORT: number(8787, 65535),
  YANDEX_API_KEY: z.string().default(''), YANDEX_FOLDER_ID: z.string().default(''),
  YANDEX_MODEL: z.string().regex(/^[a-z0-9-]+(?:\/[a-z0-9-]+)?$/).default('aliceai-llm'),
  YANDEX_API_BASE_URL: z.url().default('https://ai.api.cloud.yandex.net'),
  BUDGET_PATH: z.string().default('var/budget.json'),
  DAILY_TOKEN_LIMIT: number(200000, 10000000), LIFETIME_TOKEN_LIMIT: number(2000000, 100000000),
  DAILY_REQUEST_LIMIT: number(100, 10000), MAX_OUTPUT_TOKENS: number(3000, 6000),
  IP_REQUESTS_PER_MINUTE: number(6, 100), GLOBAL_REQUESTS_PER_MINUTE: number(20, 1000),
  MAX_CONCURRENT: number(2, 10), PROVIDER_TIMEOUT_MS: number(25000, 25000),
});
export type Config = z.infer<typeof envSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(env);
  const url = new URL(config.YANDEX_API_BASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('YANDEX_API_BASE_URL must be a clean HTTPS URL');
  if (config.AI_PROVIDER === 'yandex' && (!config.YANDEX_API_KEY || !/^[a-zA-Z0-9_-]+$/.test(config.YANDEX_FOLDER_ID)))
    throw new Error('Set YANDEX_API_KEY and YANDEX_FOLDER_ID on the server');
  if (config.NODE_ENV === 'production' && config.AI_PROVIDER !== 'yandex')
    throw new Error('Production must use YandexProvider');
  return config;
}
