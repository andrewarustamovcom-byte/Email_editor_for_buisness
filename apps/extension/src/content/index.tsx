import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { GmailAdapter } from '../adapters/gmail';
import { Panel, type Transport } from '../ui/Panel';
import { styles } from '../ui/styles';
export function mount(transport: Transport, initialOpen = false) {
  if (document.getElementById('pisma-personal-root')) return;
  const host = document.createElement('div'); host.id = 'pisma-personal-root'; host.dataset.pismaPanel = 'true';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;right:0;';
  const shadow = host.attachShadow({ mode: 'open' }); const style = document.createElement('style'); style.textContent = styles;
  const root = document.createElement('div'); shadow.append(style, root); document.documentElement.append(host);
  const adapter = new GmailAdapter(); let toggle = () => {};
  function App() {
    const [open, setOpen] = useState(initialOpen); toggle = () => setOpen(v => !v);
    return <><Panel adapter={adapter} transport={transport} open={open} onClose={() => setOpen(false)}/>{!open && <button className="launcher" onClick={() => setOpen(true)}>✦ Проверить письмо</button>}</>;
  }
  createRoot(root).render(<App/>);
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) chrome.runtime.onMessage.addListener((message: unknown) => {
    if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'PISMA_TOGGLE') toggle();
  });
  window.addEventListener('pagehide', () => adapter.dispose(), { once: true });
}
// In fixtures mount is called explicitly with a mock transport; shipped bundle is Gmail-only.
if (location.hostname === 'mail.google.com') mount(async payload => {
  const response: unknown = await chrome.runtime.sendMessage({ type: 'PISMA_ANALYZE', payload });
  if (typeof response !== 'object' || response === null || !('ok' in response)) throw new Error('Нет связи с сервисом проверки. Повторите попытку.');
  if (!response.ok) throw new Error('message' in response && typeof response.message === 'string' ? response.message : 'Ошибка проверки.');
  if (!('data' in response)) throw new Error('Некорректный ответ сервиса.');
  return response.data as Awaited<ReturnType<Transport>>;
});
