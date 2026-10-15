import { mount } from '../../apps/extension/src/content/index';
import { MockProvider } from '../../apps/api/src/mock';
import { responseSchema, validateModelResult, type AnalyzeRequest } from '../../packages/contracts/src/index';
const provider = new MockProvider();
mount(async (request: AnalyzeRequest) => {
  document.dispatchEvent(new CustomEvent('fixture-request', { detail: request }));
  await new Promise(resolve => setTimeout(resolve, Number(document.documentElement.dataset.delay ?? 30)));
  if (document.documentElement.dataset.apiError) throw new Error('Сервис анализа временно недоступен. Повторите позже.');
  const raw = await provider.analyze(request, () => {});
  if (document.documentElement.dataset.second && raw.issues[0]) raw.issues.push({
    ...raw.issues[0], id: 'fixture-second', title: 'Вторая тестовая правка',
    anchor: { quote: 'пришлите', before: '', after: '' }, replacementText: 'направьте',
  });
  if (document.documentElement.dataset.invalid) raw.issues[0]!.anchor!.quote = 'Несуществующая цитата';
  const result = validateModelResult(raw, request);
  return responseSchema.parse({ ...result, schemaVersion: '1', promptVersion: '1.0.0', requestId: request.requestId,
    editorId: request.editorId, revision: request.revision, snapshotHash: request.snapshotHash,
    contextCoverage: request.contextCoverage, contextNote: request.history.length ? 'История неполная. Проверены выбранные сообщения.' : 'История не передана: договорённости не проверены.', provider: 'mock' });
}, true);
