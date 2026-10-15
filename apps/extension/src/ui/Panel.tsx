import { useEffect, useState } from 'react';
import { categories, categoryLabels, requestSchema, responseSchema, validateModelResult, type AnalyzeRequest, type AnalyzeResponse, type HistoryMessage } from '../../../../packages/contracts/src/index';
import type { MailAdapter } from '../adapters/mail';
import { ReviewSession, snapshotHash } from '../content/session';
export type Transport = (request: AnalyzeRequest) => Promise<AnalyzeResponse>;
const statusLabels = { clear: 'Замечаний нет', issues: 'Есть замечания', insufficient: 'Недостаточно данных', not_applicable: 'Неприменимо' };
export function Panel({ adapter, transport, open, onClose }: { adapter: MailAdapter; transport: Transport; open: boolean; onClose: () => void }) {
  const [editors, setEditors] = useState<HTMLElement[]>([]);
  const [editor, setEditor] = useState<HTMLElement | null>(null);
  const [historyOn, setHistoryOn] = useState(false);
  const [manual, setManual] = useState('');
  const [available, setAvailable] = useState<HistoryMessage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [, render] = useState(0);
  useEffect(() => {
    if (!open) return;
    const refreshSettings = () => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        void chrome.runtime.sendMessage({ type: 'PISMA_STATUS' }).then((value: unknown) => {
          if (typeof value === 'object' && value !== null && 'configured' in value) setConfigured(value.configured === true);
        }).catch(() => {});
      }
    };
    refreshSettings(); window.addEventListener('focus', refreshSettings);
    const refresh = () => {
      const list = adapter.editors(); setEditors(old => old.length === list.length && old.every((e, i) => e === list[i]) ? old : list);
      setEditor(current => current && list.includes(current) ? current : adapter.activeEditor()); render(n => n + 1);
    };
    refresh(); const timer = window.setInterval(refresh, 700); return () => { clearInterval(timer); window.removeEventListener('focus', refreshSettings); };
  }, [adapter, open]);
  // Never carry history selection across drafts.
  useEffect(() => { setAvailable([]); setSelected(new Set()); setManual(''); setSession(null); }, [editor]);
  async function analyze() {
    if (!editor) return;
    setError(''); setLoading(true); setSession(null);
    try {
      const snapshot = adapter.read(editor);
      const history = historyOn ? available.filter(m => selected.has(m.id)) : [];
      if (historyOn && manual.trim()) history.push({ id: 'manual-history', text: manual.trim(), date: null });
      const request = requestSchema.parse({
        ...snapshot, snapshotHash: await snapshotHash(snapshot), requestId: crypto.randomUUID(), history,
        contextCoverage: history.length ? 'partial' : 'none', language: 'ru', currentDate: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, settings: { categories: [...categories] },
      });
      const result = responseSchema.parse(await transport(request));
      if (result.requestId !== request.requestId || result.snapshotHash !== request.snapshotHash || result.contextCoverage !== request.contextCoverage)
        throw new Error('Ответ не совпадает с запросом. Проверьте письмо повторно.');
      try { validateModelResult({ summary: result.summary, categories: result.categories, issues: result.issues }, request); }
      catch { throw new Error('Ответ модели не прошёл проверку. Запустите анализ снова.'); }
      setSession(new ReviewSession(editor, result, snapshot, adapter));
      if (result.provider === 'groq') setConfigured(true);
    } catch (err) {
      setError(err instanceof Error && err.name !== 'ZodError' ? err.message : 'Проверьте размер текста: письмо до 20 000, история до 24 000 символов и 10 сообщений.');
    } finally { setLoading(false); }
  }
  const stale = session?.stale() ?? false;
  const currentSnapshot = editor?.isConnected ? adapter.read(editor) : null;
  function act(fn: () => void) { try { setError(''); fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Действие недоступно.'); } render(n => n + 1); }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setError(''); }
    catch { setError('Копирование недоступно. Выделите и скопируйте предложенный текст вручную.'); }
  }
  if (!open) return null;
  return <section className="panel" aria-label="Проверка письма">
    <header><div className="brand"><span className="logo">✦</span>Письма</div><button className="close" aria-label="Закрыть панель" onClick={onClose}>×</button></header>
    <main>
      <div className="eyebrow">Перед отправкой</div><h1>Мысль ясна.<br/>Письмо убедительно.</h1>
      <p className="muted">Проверьте формулировки и договорённости. Решение о каждой правке — за вами.</p>
      {configured === false && <div className="notice">Добавьте личный ключ Groq для проверки писем.<br/><button className="secondary" onClick={() => { void chrome.runtime.sendMessage({ type: 'PISMA_OPEN_OPTIONS' }); }}>Подключить нейросеть</button></div>}
      {configured === true && <button className="quiet" onClick={() => { void chrome.runtime.sendMessage({ type: 'PISMA_OPEN_OPTIONS' }); }}>Настройки Groq</button>}
      {!editor && <div className="notice">{editors.length > 1 ? 'Выберите черновик для проверки.' : 'Откройте черновик в Gmail. Другая почта пока не поддерживается.'}</div>}
      {editors.length > 1 && <select aria-label="Черновик" disabled={loading} value={editor ? editors.indexOf(editor) : -1} onChange={e => setEditor(editors[Number(e.target.value)] ?? null)}>
        <option value={-1}>Выберите черновик</option>{editors.map((el, i) => el.isConnected ? <option key={adapter.read(el).editorId} value={i}>{adapter.read(el).subject || `Черновик ${i + 1}`}</option> : null)}
      </select>}
      {currentSnapshot && <p className="muted">{currentSnapshot.subject || 'Без темы'} · {currentSnapshot.text.length.toLocaleString('ru')} симв.</p>}
      <div className="controls"><label><input type="checkbox" checked={historyOn} disabled={loading} onChange={e => setHistoryOn(e.target.checked)}/>Учитывать историю переписки</label>
        {historyOn && <div className="history">
          <button className="secondary" disabled={!currentSnapshot || loading} onClick={() => { if (editor?.isConnected) { setAvailable(adapter.availableHistory(editor)); setSelected(new Set()); } }}>Выбрать доступные сообщения</button>
          <p className="muted">Только открытые сообщения цепочки. Скрытые письма не загружаются.</p>
          {available.map(m => <div className="message" key={m.id}><label><input type="checkbox" disabled={loading} checked={selected.has(m.id)} onChange={e => setSelected(old => { const next = new Set(old); if (e.target.checked) next.add(m.id); else next.delete(m.id); return next; })}/><span>{m.text.slice(0, 65)}{m.text.length > 65 ? '…' : ''}</span></label><details><summary>Просмотреть сообщение</summary><pre>{m.text}</pre></details></div>)}
          <textarea aria-label="История вручную" placeholder="Или вставьте историю вручную…" maxLength={12000} disabled={loading} value={manual} onChange={e => setManual(e.target.value)}/>
        </div>}
        <p className="muted">{historyOn ? `В запросе: ${selected.size} выбранных сообщений${manual.trim() ? ' + ручная история' : ''}. Контекст неполный.` : 'История выключена. Будут отправлены только тема и текст черновика.'}</p>
      </div>
      <button className="primary" disabled={!currentSnapshot || loading} onClick={() => void analyze()}>{loading ? 'Проверяем письмо…' : 'Проверить письмо'}</button>
      {error && <div role="alert" className="error">{error}</div>}
      {session && <div className="summary" aria-live="polite">
        {session.result.provider === 'mock' && <div className="notice">Демо · MockProvider. Настоящая модель не подключена.</div>}
        {stale && <div role="alert" className="error">Письмо изменилось. Результат устарел — запустите проверку снова.</div>}
        <p>{session.result.summary}</p><div className="notice">{session.result.contextNote}</div>
        <ul className="category-list">{categories.map(c => <li key={c} title={statusLabels[session.result.categories[c]]}>{categoryLabels[c]} · {statusLabels[session.result.categories[c]]}</li>)}</ul>
        {session.result.issues.length === 0 && <div className="success">Замечаний не найдено в пределах доступных данных.</div>}
        {session.result.issues.map(issue => {
          const accepted = session.applied.some(a => a.issueId === issue.id); const rejected = session.rejected.has(issue.id);
          const location = session.location(issue);
          return <article className="card" key={issue.id}>
            <span className="tag">{issue.severity === 'critical' ? 'Важно' : issue.severity === 'warning' ? 'Обратите внимание' : 'Уточнение'}</span><span className="category">{categoryLabels[issue.category]}</span>
            <h2>{issue.title}</h2><p>{issue.explanation}</p>
            {issue.anchor && <><div className="diff-label">БЫЛО</div><div className="diff before">{issue.anchor.quote}</div></>}
            {issue.replacementText && <><div className="diff-label">{issue.suggestion === 'insert' ? 'ПРЕДЛОЖЕНИЕ ВСТАВКИ' : 'СТАЛО'}</div><div className="diff after">{issue.replacementText}</div></>}
            {issue.question && <div className="notice">{issue.question}</div>}
            {issue.evidence.map((e, i) => <p key={i} className="muted">Сообщение {e.messageId}: «{e.quote}»</p>)}
            {!stale && !accepted && !rejected && issue.suggestion === 'replace' && !location && <p className="muted">Цитата неоднозначна или затронута другой правкой. Доступно ручное копирование.</p>}
            <div className="actions">
              {issue.anchor && <button className="quiet" disabled={stale || !location} onClick={() => act(() => { if (location && !adapter.highlight(session.editor, location.start, location.end)) throw new Error('Не удалось выделить фрагмент.'); })}>Показать в письме</button>}
              {!accepted && !rejected && <><button className="accept" disabled={stale || issue.suggestion !== 'replace' || !location} onClick={() => act(() => session.accept(issue))}>Принять</button><button className="quiet" onClick={() => act(() => { session.rejected.add(issue.id); })}>Отклонить</button></>}
              {issue.replacementText && <button className="quiet" onClick={() => void copy(issue.replacementText!)}>Копировать</button>}
              {accepted && <span className="muted">Принято</span>}{rejected && <span className="muted">Отклонено</span>}
            </div>
          </article>;
        })}
        {session.applied.length > 0 && <button className="secondary" disabled={stale} onClick={() => act(() => session.undo())}>Отменить последнюю правку</button>}
      </div>}
      <footer>При проверке выбранный текст передаётся напрямую в Groq. Расширение не сохраняет письма. Письмо отправляете только вы.</footer>
    </main>
  </section>;
}
