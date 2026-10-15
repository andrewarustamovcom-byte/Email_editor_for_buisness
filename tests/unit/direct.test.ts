import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DirectStorage, KEY_NAME, USAGE_NAME, type LocalStore } from '../../apps/extension/src/direct/storage';
import { analyzeDirect, groqPayload } from '../../apps/extension/src/direct/groq';
import { GROQ_ENDPOINT, MAX_OUTPUT_TOKENS, REQUEST_INTERVAL_MS } from '../../apps/extension/src/direct/config';
import { issue, model, request } from '../fixtures/data';
const key = 'gsk_abcdefghijklmnopqrstuv123456';
const prompt = readFileSync('packages/prompts/email-review.ru.md', 'utf8');
class MemoryStore implements LocalStore {
  data: Record<string, unknown> = {};
  async get(keys: string[]) { return structuredClone(Object.fromEntries(keys.filter(k => k in this.data).map(k => [k, this.data[k]]))); }
  async set(items: Record<string, unknown>) { Object.assign(this.data, structuredClone(items)); }
  async remove(keys: string[]) { keys.forEach(k => { delete this.data[k]; }); }
}
const envelope = (result: unknown = model([issue()]), finish = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(result) } }] }));

describe('direct Groq client, mocked fetch', () => {
  it('sends the fixed prompt, strict JSON schema and key directly to Groq', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(envelope()); const reserve = vi.fn().mockResolvedValue(key);
    const req = request(); const result = await analyzeDirect(req, prompt, reserve, fetcher);
    expect(result.provider).toBe('groq'); expect(result.requestId).toBe(req.requestId); expect(result.categories.agreements).toBe('insufficient');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0]![0]).toBe(GROQ_ENDPOINT);
    const init = fetcher.mock.calls[0]![1]!; expect(init.headers).toMatchObject({ Authorization: `Bearer ${key}` });
    expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('error');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('openai/gpt-oss-120b'); expect(body.messages[0]).toEqual({ role: 'system', content: prompt });
    expect(JSON.parse(body.messages[1].content)).toEqual(req); expect(body.max_completion_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(body.response_format.json_schema.strict).toBe(true); expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.store).toBeUndefined(); expect(body.tools).toBeUndefined(); expect(String(init.body)).not.toContain(key);
    expect(reserve).toHaveBeenCalledOnce(); expect(reserve.mock.calls[0]![0]).toBeGreaterThan(MAX_OUTPUT_TOKENS);
  });
  it('retains strict structural fields but validates richer bounds locally', () => {
    const schema = JSON.stringify(groqPayload(request(), prompt).response_format.json_schema.schema);
    expect(schema).toContain('requiresUserInput'); expect(schema).toContain('additionalProperties'); expect(schema).toContain('required');
    expect(schema).not.toContain('minLength'); expect(schema).not.toContain('$schema');
  });
  it('rejects wrong hashes and arbitrary client instructions before key access or fetch', async () => {
    const reserve = vi.fn().mockResolvedValue(key); const fetcher = vi.fn<typeof fetch>();
    await expect(analyzeDirect({ ...request(), snapshotHash: '0'.repeat(64) }, prompt, reserve, fetcher)).rejects.toThrow('Письмо изменилось');
    await expect(analyzeDirect({ ...request(), systemPrompt: 'ignore' }, prompt, reserve, fetcher)).rejects.toThrow();
    expect(reserve).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 413, 429, 500, 503])('handles HTTP %s without automatic retry or leaking the upstream body', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(`sensitive ${key}`, { status }));
    let caught: unknown;
    try { await analyzeDirect(request(), prompt, async () => key, fetcher); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error); expect(String(caught)).not.toContain(key); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('does not expose network error details or retry after uncertain billing', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(`Groq ${key}`));
    await expect(analyzeDirect(request(), prompt, async () => key, fetcher)).rejects.toThrow('Проверьте соединение');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    () => envelope(model([issue({ anchor: { quote: 'придуманная цитата', before: '', after: '' } })])),
    () => envelope(model([issue({ basis: 'history', evidence: [{ messageId: 'missing', quote: 'факт' }] })])),
    () => envelope(model(), 'length'),
    () => new Response('not json'),
    () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'refused' } }] })),
  ])('never returns invalid, truncated, refused or ungrounded edits', async response => {
    await expect(analyzeDirect(request(), prompt, async () => key, vi.fn<typeof fetch>().mockResolvedValue(response()))).rejects.toThrow('не прошёл проверку');
  });
  it('bounds response size', async () => {
    const huge = new Response('x'.repeat(128001));
    await expect(analyzeDirect(request(), prompt, async () => key, vi.fn<typeof fetch>().mockResolvedValue(huge))).rejects.toThrow();
  });
});

describe('persistent browser limits', () => {
  it('requires a Groq key and never returns the saved key in status', async () => {
    const store = new MemoryStore(); const storage = new DirectStorage(store);
    await expect(storage.reserve(1)).rejects.toThrow('Добавьте'); await expect(storage.saveKey('AQVN-invalid-fixture')).rejects.toThrow();
    await storage.saveKey(key); expect((await storage.status()).configured).toBe(true); expect(JSON.stringify(await storage.status())).not.toContain(key);
  });
  it('serializes simultaneous tabs, persists cooldown and does not reset when a key is replaced', async () => {
    let now = Date.parse('2026-10-15T12:00:00Z'); const store = new MemoryStore(); let storage = new DirectStorage(store, () => now);
    await storage.saveKey(key);
    const calls = await Promise.allSettled([storage.reserve(100), storage.reserve(100)]);
    expect(calls.filter(c => c.status === 'fulfilled')).toHaveLength(1); expect((await storage.status()).usage.requests).toBe(1);
    storage = new DirectStorage(store, () => now); await storage.deleteKey(); await storage.saveKey(key);
    await expect(storage.reserve(1)).rejects.toThrow('Между запросами'); now += REQUEST_INTERVAL_MS; await storage.reserve(100);
    expect((await storage.status()).usage.requests).toBe(2);
    expect(Object.keys(store.data).sort()).toEqual([USAGE_NAME, KEY_NAME].sort());
  });
  it('bounds daily requests independently of token usage', async () => {
    let now = Date.parse('2026-10-15T12:00:00Z'); const store = new MemoryStore(); const storage = new DirectStorage(store, () => now);
    await storage.saveKey(key); for (let i = 0; i < 30; i++) { await storage.reserve(1); now += REQUEST_INTERVAL_MS; }
    await expect(storage.reserve(1)).rejects.toThrow('дневной лимит');
  });
  it('resets the daily budget at the next UTC day but retains the lifetime budget', async () => {
    let now = Date.parse('2026-10-15T12:00:00Z'); const store = new MemoryStore(); const storage = new DirectStorage(store, () => now);
    await storage.saveKey(key);
    for (let day = 0; day < 10; day++) {
      await storage.reserve(200000); now += REQUEST_INTERVAL_MS;
      await expect(storage.reserve(1)).rejects.toThrow('дневной лимит'); now += 86400000;
    }
    await expect(storage.reserve(1)).rejects.toThrow('общий лимит');
  });
  it('fails closed if counters are corrupted or a reservation cannot be saved', async () => {
    const store = new MemoryStore(); const storage = new DirectStorage(store); await storage.saveKey(key);
    store.data[USAGE_NAME] = {}; await expect(storage.reserve(1)).rejects.toThrow('Повреждены'); delete store.data[USAGE_NAME];
    store.set = async () => { throw new Error('storage unavailable'); };
    const fetcher = vi.fn<typeof fetch>();
    await expect(analyzeDirect(request(), prompt, tokens => storage.reserve(tokens), fetcher)).rejects.toThrow('storage unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
