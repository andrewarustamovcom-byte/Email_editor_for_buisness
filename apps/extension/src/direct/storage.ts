import { z } from 'zod';
import { DAILY_REQUEST_LIMIT, DAILY_TOKEN_LIMIT, LIFETIME_TOKEN_LIMIT, REQUEST_INTERVAL_MS } from './config';
export interface LocalStore {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}
export const KEY_NAME = 'groqApiKey';
export const USAGE_NAME = 'directUsageV1';
export const keySchema = z.string().trim().regex(/^gsk_[A-Za-z0-9_-]{20,200}$/);
export const usageSchema = z.object({
  version: z.literal(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requests: z.int().nonnegative(), tokens: z.int().nonnegative(), lifetimeTokens: z.int().nonnegative(),
  nextRequestAt: z.int().nonnegative(),
}).strict();
export type Usage = z.infer<typeof usageSchema>;
export interface DirectStatus { configured: boolean; usage: Usage; model: string }

/** Serializes reservations across tabs; storage is updated BEFORE fetch. */
export class DirectStorage {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: LocalStore, private now = () => Date.now()) {}
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation); this.queue = pending.catch(() => {}); return pending;
  }
  private usage(raw: unknown): Usage {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (raw === undefined) return { version: 1, day, requests: 0, tokens: 0, lifetimeTokens: 0, nextRequestAt: 0 };
    const parsed = usageSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Повреждены локальные счётчики лимитов. Проверка остановлена.');
    const usage = parsed.data;
    // Never reset a daily budget if the clock moves backwards.
    return day > usage.day ? { ...usage, day, requests: 0, tokens: 0 } : usage;
  }
  async status(): Promise<{ configured: boolean; usage: Usage }> {
    const data = await this.store.get([KEY_NAME, USAGE_NAME]);
    return { configured: keySchema.safeParse(data[KEY_NAME]).success, usage: this.usage(data[USAGE_NAME]) };
  }
  saveKey(raw: unknown) {
    return this.serialized(async () => {
      const parsed = keySchema.safeParse(raw);
      if (!parsed.success) throw new Error('Вставьте API-ключ Groq, начинающийся с gsk_.');
      // Key changes never reset counters.
      await this.store.set({ [KEY_NAME]: parsed.data });
    });
  }
  deleteKey() { return this.serialized(() => this.store.remove([KEY_NAME])); }
  reserve(tokens: number): Promise<string> {
    return this.serialized(async () => {
      if (!Number.isSafeInteger(tokens) || tokens < 1) throw new Error('Некорректный размер запроса.');
      const data = await this.store.get([KEY_NAME, USAGE_NAME]);
      const key = keySchema.safeParse(data[KEY_NAME]);
      if (!key.success) throw new Error('Добавьте личный ключ Groq в настройках расширения.');
      const usage = this.usage(data[USAGE_NAME]);
      if (this.now() < usage.nextRequestAt) throw new Error(`Повторите проверку через ${Math.ceil((usage.nextRequestAt - this.now()) / 1000)} сек. Между запросами нужна минута.`);
      if (usage.requests >= DAILY_REQUEST_LIMIT || usage.tokens + tokens > DAILY_TOKEN_LIMIT)
        throw new Error('Достигнут дневной лимит расширения. Повторите проверку завтра.');
      if (usage.lifetimeTokens + tokens > LIFETIME_TOKEN_LIMIT)
        throw new Error('Достигнут общий лимит расширения. Проверьте расход в аккаунте Groq.');
      await this.store.set({ [USAGE_NAME]: { ...usage, requests: usage.requests + 1, tokens: usage.tokens + tokens,
        lifetimeTokens: usage.lifetimeTokens + tokens, nextRequestAt: this.now() + REQUEST_INTERVAL_MS } });
      return key.data;
    });
  }
}
