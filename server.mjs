import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './src/app.mjs';
import { createSourceService } from './src/source.mjs';
import { createStore } from './src/store.mjs';
import { createTryonService } from './src/tryon.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

export async function bootstrap(env = process.env, { fetchImpl = fetch } = {}) {
  const store = createStore({ dir: resolve(ROOT, 'data'), catalogFile: resolve(ROOT, 'data/catalog.json') });
  await store.ready();
  const tryon = createTryonService({
    store,
    env,
    fetchImpl,
    resultsDir: resolve(ROOT, 'data/results'),
  });
  // 进程重启后内存任务丢失，磁盘上仍是 pending 的订单必须退回余额。
  const interrupted = await tryon.reconcileInterruptedOrders();
  if (interrupted > 0) console.error(`reconciled ${interrupted} interrupted order(s), balance refunded`);
  const sources = createSourceService({ env, fetchImpl });
  const app = createApp({ env, fetchImpl, store, tryon, sources });
  return { app, store, tryon, sources };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, tryon } = await bootstrap();
  app.listen(43130, '127.0.0.1', () => {
    console.log('TryOn Web running at http://127.0.0.1:43130');
  });
  const cleanup = setInterval(() => void tryon.cleanupExpiredResults(), 60 * 60 * 1000);
  cleanup.unref();
}
