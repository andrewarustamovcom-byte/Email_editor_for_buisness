import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Config } from './config';
import { ApiError } from './errors';
const ledgerSchema = z.object({
  version: z.literal(1), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dailyTokens: z.int().nonnegative(), lifetimeTokens: z.int().nonnegative(), dailyRequests: z.int().nonnegative(),
}).strict();

/** One process, one persistent volume. Reserve worst-case tokens BEFORE every external call. */
export class Budget {
  private ledger: z.infer<typeof ledgerSchema>;
  private lock: number;
  private closed = false;
  constructor(private config: Config, private today = () => new Date().toISOString().slice(0, 10)) {
    mkdirSync(dirname(config.BUDGET_PATH), { recursive: true });
    this.lock = openSync(`${config.BUDGET_PATH}.lock`, 'wx', 0o600);
    try {
      writeFileSync(this.lock, String(process.pid));
      this.ledger = existsSync(config.BUDGET_PATH)
        ? ledgerSchema.parse(JSON.parse(readFileSync(config.BUDGET_PATH, 'utf8')))
        : { version: 1, day: this.today(), dailyTokens: 0, lifetimeTokens: 0, dailyRequests: 0 };
      this.persist();
    } catch (error) { this.close(); throw error; }
  }
  private persist() {
    const path = `${this.config.BUDGET_PATH}.tmp`;
    const fd = openSync(path, 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(this.ledger)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(path, this.config.BUDGET_PATH);
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(this.config.BUDGET_PATH), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  }
  reserve(tokens: number, newRequest: boolean) {
    if (this.closed || !Number.isSafeInteger(tokens) || tokens < 1) throw new Error('Invalid budget reservation');
    if (this.ledger.day !== this.today()) {
      this.ledger.day = this.today(); this.ledger.dailyTokens = 0; this.ledger.dailyRequests = 0;
    }
    const { DAILY_TOKEN_LIMIT, LIFETIME_TOKEN_LIMIT, DAILY_REQUEST_LIMIT } = this.config;
    if (this.ledger.dailyTokens + tokens > DAILY_TOKEN_LIMIT ||
        this.ledger.lifetimeTokens + tokens > LIFETIME_TOKEN_LIMIT ||
        (newRequest && this.ledger.dailyRequests >= DAILY_REQUEST_LIMIT))
      throw new ApiError('BUDGET_EXHAUSTED', 429, 'Достигнут общий лимит API. Повторите позже или обратитесь к владельцу проекта.');
    this.ledger.dailyTokens += tokens; this.ledger.lifetimeTokens += tokens;
    if (newRequest) this.ledger.dailyRequests++;
    // If disk write fails, no external call happens. In-memory reservation is retained.
    this.persist();
  }
  close() {
    if (this.closed) return;
    this.closed = true; closeSync(this.lock); unlinkSync(`${this.config.BUDGET_PATH}.lock`);
  }
}
