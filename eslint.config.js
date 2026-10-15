import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default ts.config(
  { ignores: ['dist/**', 'artifacts/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node, chrome: 'readonly' } } },
);
