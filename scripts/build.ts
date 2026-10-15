import { mkdir, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { zipSync } from 'fflate';
import { GROQ_ORIGIN } from '../apps/extension/src/direct/config';

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
const version = (process.env.RELEASE_VERSION ?? pkg.version).replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version) || version.split('.').some(n => Number(n) > 65535)) throw new Error('Invalid Chrome version');
const prompt = await readFile('packages/prompts/email-review.ru.md', 'utf8');
await rm('dist', { recursive: true, force: true }); await mkdir('dist/extension', { recursive: true });
await viteBuild({ configFile: false, define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { outDir: 'dist/extension', emptyOutDir: false, target: 'chrome120', sourcemap: false,
    lib: { entry: 'apps/extension/src/content/index.tsx', name: 'Pisma', formats: ['iife'], fileName: () => 'content.js' } },
});
await esbuild({ entryPoints: ['apps/extension/src/background/index.ts'], outfile: 'dist/extension/background.js', bundle: true, format: 'esm', target: 'chrome120', minify: true, define: { __REVIEW_PROMPT__: JSON.stringify(prompt) } });
await esbuild({ entryPoints: ['apps/extension/src/options/index.ts'], outfile: 'dist/extension/options.js', bundle: true, format: 'esm', target: 'chrome120', minify: true });
await copyFile('apps/extension/options.html', 'dist/extension/options.html');
await copyFile('apps/extension/src/options/styles.css', 'dist/extension/options.css');
const manifest = {
  manifest_version: 3, name: 'Письма — проверка перед отправкой', version,
  description: 'Проверка писем в Gmail через Groq. Прямое подключение без сервера, личный ключ в браузере.',
  minimum_chrome_version: '120', action: { default_title: 'Проверить письмо в Gmail' },
  background: { service_worker: 'background.js', type: 'module' },
  permissions: ['storage'], host_permissions: [`${GROQ_ORIGIN}/*`],
  options_ui: { page: 'options.html', open_in_tab: true },
  content_scripts: [{ matches: ['https://mail.google.com/*'], js: ['content.js'], run_at: 'document_idle' }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
};
await writeFile('dist/extension/manifest.json', JSON.stringify(manifest, null, 2));
await writeFile('dist/extension/INSTALL.txt', 'Распакуйте ZIP. Откройте chrome://extensions → Режим разработчика → Загрузить распакованное расширение → выберите эту папку. В настройках расширения сохраните личный API-ключ Groq (план Free для бесплатной квоты). Откройте Gmail и обновите вкладку. Сервер и Node.js пользователю не нужны.\n');
// Preserve the optional earlier backend as a separate developer artifact; the extension never calls it.
await esbuild({ entryPoints: ['apps/api/src/index.ts'], outfile: 'dist/api/server.js', bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node24' });
await copyFile('packages/prompts/email-review.ru.md', 'dist/email-review.ru.md');
await mkdir('artifacts', { recursive: true });
// Remove the obsolete local-backend ZIP so it cannot be mistaken for the current product.
for (const old of await readdir('artifacts')) if (/^pisma-.*-dev\.zip$/.test(old)) await rm(`artifacts/${old}`);
const file = `artifacts/pisma-${version}.zip`;
const entries: Record<string, Uint8Array> = {};
for (const name of (await readdir('dist/extension')).sort()) entries[name] = new Uint8Array(await readFile(`dist/extension/${name}`));
await writeFile(file, zipSync(entries, { level: 9 }));
console.log(`Built ${file}. Direct Groq connection. No backend URL or API key is included in the build.`);
