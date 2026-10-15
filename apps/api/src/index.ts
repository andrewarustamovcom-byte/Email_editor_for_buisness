import { createApp } from './app';
import { loadConfig } from './config';
const config = loadConfig();
const app = createApp(config);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void app.close(); });
try { await app.listen({ host: config.HOST, port: config.PORT }); }
catch { app.log.error('API startup failed. Check server configuration and budget lock.'); await app.close(); process.exitCode = 1; }
