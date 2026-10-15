import type { AIProvider } from './providers';
import type { AnalyzeRequest, ModelResult, Issue } from '../../../packages/contracts/src/index';
export class MockProvider implements AIProvider {
  readonly name = 'mock' as const;
  estimateTokens() { return 1; }
  async analyze(request: AnalyzeRequest, reserve: (tokens: number, first: boolean) => void): Promise<ModelResult> {
    reserve(1, true);
    const issues: Issue[] = [];
    if (request.text.includes('немедленно') && request.settings.categories.includes('tone')) issues.push({
      id: 'mock-tone', category: 'tone', severity: 'warning', title: 'Смягчите категоричный тон',
      explanation: '«Немедленно» может восприниматься как давление. Предложение сохраняет просьбу, не добавляя срок.',
      basis: 'draft', anchor: { quote: 'немедленно', before: '', after: '' }, suggestion: 'replace',
      replacementText: 'пожалуйста', question: null, requiresUserInput: false, evidence: [],
    });
    if (request.text.includes('как можно скорее') && request.settings.categories.includes('deadline')) issues.push({
      id: 'mock-deadline', category: 'deadline', severity: 'info', title: 'Уточните необходимый срок',
      explanation: 'Если запрос срочный, адресату нужен согласованный срок. Без ваших данных дату предложить нельзя.',
      basis: 'draft', anchor: { quote: 'как можно скорее', before: '', after: '' }, suggestion: 'question',
      replacementText: null, question: 'К какой дате и времени нужен результат?', requiresUserInput: true, evidence: [],
    });
    return {
      summary: issues.length ? 'Демонстрационный анализ: проверьте формулировки перед отправкой.' : 'Демонстрационный анализ: замечаний по тестовым правилам нет.',
      categories: { action: 'clear', structure: 'clear', deadline: issues.some(i => i.category === 'deadline') ? 'issues' : 'not_applicable', agreements: 'insufficient', tone: issues.some(i => i.category === 'tone') ? 'issues' : 'clear' },
      issues,
    };
  }
}
