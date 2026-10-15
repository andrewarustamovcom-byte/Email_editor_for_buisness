import { analyzeDirect } from '../direct/groq';
import { DirectStorage } from '../direct/storage';
import { GROQ_MODEL } from '../direct/config';

// Only trusted extension contexts may read local storage.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const storage = new DirectStorage({
  get: keys => chrome.storage.local.get(keys), set: items => chrome.storage.local.set(items), remove: keys => chrome.storage.local.remove(keys),
});
chrome.runtime.onInstalled.addListener(details => { if (details.reason === 'install') void chrome.runtime.openOptionsPage(); });
chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: 'PISMA_TOGGLE' }); }
  catch { await chrome.action.setBadgeText({ tabId: tab.id, text: 'G' }); await chrome.action.setTitle({ tabId: tab.id, title: 'Откройте Gmail и обновите страницу: другая почта пока не поддерживается.' }); }
});
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (typeof message !== 'object' || message === null || !('type' in message) || sender.id !== chrome.runtime.id) return false;
  const gmail = sender.frameId === 0 && sender.tab && sender.url?.startsWith('https://mail.google.com/');
  const options = sender.url === chrome.runtime.getURL('options.html');
  if (message.type === 'PISMA_OPEN_OPTIONS' && gmail) { void chrome.runtime.openOptionsPage(); sendResponse({ ok: true }); return false; }
  if (message.type === 'PISMA_STATUS' && (gmail || options)) {
    void storageReady.then(() => storage.status()).then(status => sendResponse({ ok: true, ...status, model: GROQ_MODEL }),
      () => sendResponse({ ok: false, message: 'Не удалось прочитать настройки расширения.' })); return true;
  }
  if ((message.type === 'PISMA_SAVE_KEY' || message.type === 'PISMA_DELETE_KEY') && options) {
    void storageReady.then(() => message.type === 'PISMA_SAVE_KEY' ? storage.saveKey('key' in message ? message.key : undefined) : storage.deleteKey())
      .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false, message: 'Не удалось сохранить настройки. Проверьте ключ Groq и доступ к хранилищу Chrome.' })); return true;
  }
  if (message.type !== 'PISMA_ANALYZE' || !gmail) return false;
  void (async () => {
    try {
      await storageReady;
      const data = await analyzeDirect('payload' in message ? message.payload : undefined, __REVIEW_PROMPT__, tokens => storage.reserve(tokens));
      sendResponse({ ok: true, data });
    } catch (error) { sendResponse({ ok: false, message: error instanceof Error ? error.message : 'Не удалось выполнить проверку.' }); }
  })();
  return true;
});
