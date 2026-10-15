import { chromium, expect, test } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Fastify from 'fastify';
import { MockProvider } from '../../apps/api/src/mock';
import { requestSchema } from '../../packages/contracts/src/index';
import { GROQ_ORIGIN } from '../../apps/extension/src/direct/config';
import { usageSchema } from '../../apps/extension/src/direct/storage';

test('built extension calls the model directly, isolates the key and persists limits after browser restart', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'pisma-direct-extension-'));
  const extension = join(temp, 'extension'); cpSync(resolve('dist/extension'), extension, { recursive: true });
  const apiKey = 'gsk_abcdefghijklmnopqrstuv123456';
  const app = Fastify({ logger: false }); let calls = 0;
  app.post('/openai/v1/chat/completions', async req => {
    calls++; expect(req.headers.authorization).toBe(`Bearer ${apiKey}`);
    const body = req.body as { model: string; messages: { role: string; content: string }[]; response_format: { json_schema: { strict: boolean } } };
    expect(body.model).toBe('openai/gpt-oss-120b'); expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[0]!.role).toBe('system'); expect(body.messages[0]!.content).toContain('Не придумывай даты');
    const request = requestSchema.parse(JSON.parse(body.messages[1]!.content));
    const result = await new MockProvider().analyze(request, () => {});
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] };
  });
  let context;
  try {
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const manifestPath = join(extension, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { host_permissions: string[]; permissions: string[]; options_ui: { page: string } };
    expect(manifest.host_permissions).toEqual([`${GROQ_ORIGIN}/*`]); expect(manifest.permissions).toEqual(['storage']);
    expect(manifest.options_ui.page).toBe('options.html');
    manifest.host_permissions = [`${origin}/*`]; writeFileSync(manifestPath, JSON.stringify(manifest));
    const backgroundPath = join(extension, 'background.js'); writeFileSync(backgroundPath, readFileSync(backgroundPath, 'utf8').replaceAll(GROQ_ORIGIN, origin));
    // Probe from the extension's real content world, never copying the secret into the page.
    const contentPath = join(extension, 'content.js'); writeFileSync(contentPath, readFileSync(contentPath, 'utf8') + `\ndocument.addEventListener('fixture-storage-probe', async () => { try { const result = await chrome.storage.local.get('groqApiKey'); document.documentElement.dataset.keyAccess = result.groqApiKey ? 'accessible' : 'unavailable'; } catch { document.documentElement.dataset.keyAccess = 'blocked'; } });`);
    const launch = () => chromium.launchPersistentContext(join(temp, 'profile'), {
      channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    context = await launch();
    let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;
    const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.getByRole('status')).toContainText('Ключ ещё не добавлен');
    await options.getByLabel('Личный API-ключ Groq').fill('AQVN-fixture-invalid');
    await options.getByRole('button', { name: 'Сохранить ключ' }).click(); await expect(options.getByRole('status')).toContainText('начинающийся с gsk_');
    await options.getByLabel('Личный API-ключ Groq').fill(apiKey);
    await options.getByRole('button', { name: 'Сохранить ключ' }).click();
    await expect(options.getByRole('status')).toContainText('Ключ сохранён'); await expect(options.getByLabel('Личный API-ключ Groq')).toHaveValue('');
    const html = readFileSync('tests/fixtures/gmail.html', 'utf8').replace(/<script type="module"[^>]*><\/script>/, '');
    await context.route('https://mail.google.com/**', route => route.fulfill({ contentType: 'text/html', body: html }));
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://mail.google.com/mail/u/0/');
    await page.getByRole('button', { name: 'Проверить письмо' }).click();
    await page.getByLabel('Черновик', { exact: true }).selectOption('0');
    await page.evaluate(() => document.dispatchEvent(new Event('fixture-storage-probe')));
    await expect(page.locator('html')).toHaveAttribute('data-key-access', 'blocked');
    await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click();
    const card = page.locator('article').filter({ hasText: 'Смягчите категоричный тон' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Принять', exact: true }).click(); await expect(page.locator('#draft-1 b')).toHaveText('пожалуйста');
    await page.getByRole('button', { name: 'Отменить последнюю правку' }).click(); await expect(page.locator('#draft-1 b')).toHaveText('немедленно');
    await page.locator('.panel').evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ path: 'artifacts/panel-preview.png', fullPage: true });
    await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Между запросами нужна минута'); expect(calls).toBe(1);
    const stored = await worker.evaluate(() => chrome.storage.local.get(null));
    expect(Object.keys(stored).sort()).toEqual(['directUsageV1', 'groqApiKey']); expect(usageSchema.parse(stored.directUsageV1).requests).toBe(1);
    expect(JSON.stringify(stored)).not.toContain('Коллеги'); expect(errors).toEqual([]);
    await context.close(); context = await launch();
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const afterRestart = await worker.evaluate(() => chrome.storage.local.get('directUsageV1'));
    expect(usageSchema.parse(afterRestart.directUsageV1).requests).toBe(1);
    const reopenedOptions = await context.newPage(); await reopenedOptions.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(reopenedOptions.getByRole('status')).toContainText('Ключ сохранён');
    await reopenedOptions.getByRole('button', { name: 'Удалить сохранённый ключ' }).click(); await expect(reopenedOptions.getByRole('status')).toContainText('Ключ ещё не добавлен');
    const deleted = await worker.evaluate(() => chrome.storage.local.get(null)); expect(deleted.groqApiKey).toBeUndefined(); expect(usageSchema.parse(deleted.directUsageV1).requests).toBe(1);
  } finally { await context?.close(); await app.close(); rmSync(temp, { recursive: true, force: true }); }
});
