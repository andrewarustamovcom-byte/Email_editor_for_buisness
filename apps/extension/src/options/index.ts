import { keySchema, type DirectStatus } from '../direct/storage';
import { DAILY_REQUEST_LIMIT, DAILY_TOKEN_LIMIT } from '../direct/config';
const form = document.querySelector<HTMLFormElement>('#settings')!;
const key = document.querySelector<HTMLInputElement>('#key')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const usage = document.querySelector<HTMLParagraphElement>('#usage')!;
async function send(message: object): Promise<Record<string, unknown>> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (typeof response !== 'object' || response === null || !('ok' in response) || !response.ok) throw new Error('Не удалось обновить настройки расширения.');
  return response as Record<string, unknown>;
}
async function refresh() {
  const result = await send({ type: 'PISMA_STATUS' }) as unknown as DirectStatus;
  status.textContent = result.configured ? 'Ключ сохранён. Откройте Gmail для проверки письма.' : 'Ключ ещё не добавлен.';
  usage.textContent = `Лимит расширения на день: ${result.usage.requests} / ${DAILY_REQUEST_LIMIT} проверок; резерв токенов ${result.usage.tokens.toLocaleString('ru')} / ${DAILY_TOKEN_LIMIT.toLocaleString('ru')}. Это локальный счётчик, квоты аккаунта смотрите в Groq.`;
}
form.addEventListener('submit', event => {
  event.preventDefault();
  void (async () => {
    const parsed = keySchema.safeParse(key.value);
    if (!parsed.success) { status.textContent = 'Вставьте API-ключ Groq, начинающийся с gsk_.'; return; }
    try { await send({ type: 'PISMA_SAVE_KEY', key: parsed.data }); key.value = ''; await refresh(); }
    catch { status.textContent = 'Не удалось сохранить ключ. Попробуйте ещё раз.'; }
  })();
});
document.querySelector('#delete')!.addEventListener('click', () => {
  void (async () => {
    try { await send({ type: 'PISMA_DELETE_KEY' }); key.value = ''; await refresh(); }
    catch { status.textContent = 'Не удалось удалить ключ.'; }
  })();
});
void refresh().catch(() => { status.textContent = 'Не удалось прочитать настройки расширения.'; });
