import { createHash, randomUUID } from 'node:crypto';
import { categories, type AnalyzeRequest, type Issue, type ModelResult } from '../../packages/contracts/src/index';
export function request(overrides: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
  const value: AnalyzeRequest = {
    requestId: randomUUID(), editorId: 'editor-1', revision: 0, subject: 'Отчёт', text: 'Коллеги, немедленно пришлите отчёт как можно скорее.',
    snapshotHash: '', history: [], contextCoverage: 'none', language: 'ru', currentDate: '2026-10-15T10:00:00+03:00', timezone: 'Europe/Moscow', settings: { categories: [...categories] }, ...overrides,
  };
  value.snapshotHash = createHash('sha256').update(JSON.stringify({ subject: value.subject, text: value.text })).digest('hex'); return value;
}
export function issue(overrides: Partial<Issue> = {}): Issue {
  return { id: 'tone-1', category: 'tone', severity: 'warning', title: 'Тон', explanation: 'Смягчите тон.', basis: 'draft',
    anchor: { quote: 'немедленно', before: '', after: '' }, suggestion: 'replace', replacementText: 'пожалуйста', question: null,
    requiresUserInput: false, evidence: [], ...overrides };
}
export function model(issues: Issue[] = []): ModelResult {
  return { summary: 'Проверка выполнена.', categories: { action: 'clear', structure: 'clear', deadline: 'not_applicable', agreements: 'insufficient', tone: issues.length ? 'issues' : 'clear' }, issues };
}
