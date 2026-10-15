import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/gmail.html');
  await page.getByLabel('Черновик', { exact: true }).selectOption('0');
});
test('compare, highlight, accept and undo preserve markup, link, signature and quoted history', async ({ page }) => {
  await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click();
  const card = page.locator('article').filter({ hasText: 'Смягчите категоричный тон' });
  await expect(card.locator('.before')).toHaveText('немедленно'); await expect(card.locator('.after')).toHaveText('пожалуйста');
  await card.getByRole('button', { name: 'Показать в письме' }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('немедленно');
  await card.getByRole('button', { name: 'Принять', exact: true }).click();
  await expect(page.locator('#draft-1 b')).toHaveText('пожалуйста');
  await expect(page.locator('#draft-1 a')).toHaveAttribute('href', 'https://example.org/report');
  await expect(page.locator('#draft-1 .gmail_signature')).toHaveText('С уважением,Алексей');
  await expect(page.locator('#draft-1 blockquote')).toHaveText('Цитата прошлого письма.');
  await page.getByRole('button', { name: 'Отменить последнюю правку' }).click();
  await expect(page.locator('#draft-1 b')).toHaveText('немедленно');
  await card.getByRole('button', { name: 'Отклонить' }).click(); await expect(card).toContainText('Отклонено');
});
test('edits while analysis runs make results stale and prevent acceptance', async ({ page }) => {
  await page.evaluate(() => { document.documentElement.dataset.delay = '500'; });
  await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click();
  await page.locator('#draft-1 b').evaluate(el => { el.textContent = 'срочно'; });
  await expect(page.getByRole('alert')).toContainText('Результат устарел');
  for (const button of await page.getByRole('button', { name: 'Принять', exact: true }).all()) await expect(button).toBeDisabled();
});
test('sequential native edits rebase anchors and undo in reverse order', async ({ page }) => {
  await page.evaluate(() => { document.documentElement.dataset.second = '1'; });
  await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click();
  await page.locator('article').filter({ hasText: 'Смягчите категоричный тон' }).getByRole('button', { name: 'Принять', exact: true }).click();
  await page.locator('article').filter({ hasText: 'Вторая тестовая правка' }).getByRole('button', { name: 'Принять', exact: true }).click();
  await expect(page.locator('#draft-1')).toContainText('пожалуйста направьте');
  await page.getByRole('button', { name: 'Отменить последнюю правку' }).click();
  await expect(page.locator('#draft-1')).toContainText('пожалуйста пришлите');
  await page.getByRole('button', { name: 'Отменить последнюю правку' }).click();
  await expect(page.locator('#draft-1')).toContainText('немедленно пришлите');
});
test('only selected draft and explicit history are sent, no invented deadline is applied', async ({ page }) => {
  await page.evaluate(() => { document.addEventListener('fixture-request', event => { document.documentElement.dataset.lastRequest = JSON.stringify((event as CustomEvent).detail); }); });
  await page.getByLabel('Учитывать историю переписки').check();
  await page.getByRole('button', { name: 'Выбрать доступные сообщения' }).click();
  await page.locator('.message input').check();
  await page.getByLabel('История вручную').fill('Уточнение: окончательный срок пока не согласован.');
  await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click();
  await expect(page.locator('.summary')).toContainText('История неполная');
  const sent = JSON.parse(await page.locator('html').getAttribute('data-last-request') ?? '{}');
  expect(sent.subject).toBe('Отчёт по проекту'); expect(sent.history).toHaveLength(2);
  expect(sent.text).not.toContain('Алексей'); expect(sent.text).not.toContain('Цитата прошлого');
  const question = page.locator('article').filter({ hasText: 'Уточните необходимый срок' });
  await expect(question).toContainText('К какой дате и времени'); await expect(question.getByRole('button', { name: 'Принять', exact: true })).toBeDisabled();
  await page.getByLabel('Черновик', { exact: true }).selectOption('1');
  await expect(page.getByLabel('История вручную')).toHaveValue('');
  await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click();
  await expect(page.locator('.summary')).toContainText('Замечаний не найдено');
  await expect(page.locator('#draft-1 b')).toHaveText('немедленно');
});
test('repeated quotes disable automatic replacement', async ({ page }) => {
  await page.locator('#draft-1 b').evaluate(el => { el.textContent = 'немедленно немедленно'; });
  await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click();
  const card = page.locator('article').filter({ hasText: 'Смягчите категоричный тон' });
  await expect(card.getByRole('button', { name: 'Принять', exact: true })).toBeDisabled(); await expect(card).toContainText('неоднозначна');
});
test('closing a draft during analysis leaves the panel usable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => { document.documentElement.dataset.delay = '200'; });
  await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click();
  await page.locator('#draft-1').evaluate(el => el.closest('section')!.remove());
  await expect(page.getByRole('button', { name: 'Проверить письмо', exact: true })).toBeEnabled();
  await expect(page.locator('.panel')).toBeVisible(); expect(errors).toEqual([]);
});
test('cross-node replacement refuses to change formatting and offers copying', async ({ page }) => {
  await page.locator('#draft-1 b').evaluate(el => { el.innerHTML = 'неме<i>дленно</i>'; });
  await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click();
  await page.locator('article').filter({ hasText: 'Смягчите категоричный тон' }).getByRole('button', { name: 'Принять', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('вставить вручную'); await expect(page.locator('#draft-1 b i')).toHaveText('дленно');
});
test('API failure and invalid model output show errors with no applicable edits', async ({ page }) => {
  await page.evaluate(() => { document.documentElement.dataset.apiError = '1'; });
  await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('временно недоступен'); await expect(page.locator('article')).toHaveCount(0);
  await page.evaluate(() => { delete document.documentElement.dataset.apiError; document.documentElement.dataset.invalid = '1'; });
  await page.getByRole('button', { name: 'Проверить письмо', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.locator('article')).toHaveCount(0);
});
