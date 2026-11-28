import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './src/app.mjs';
import { createCaptioner } from './src/caption.mjs';
import { createLoginService } from './src/login.mjs';
import { createStylist } from './src/outfit.mjs';
import { createSourceService } from './src/source.mjs';
import { createStore } from './src/store.mjs';
import { createTryonService } from './src/tryon.mjs';
import { createWardrobe } from './src/wardrobe.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

export async function bootstrap(env = process.env, { fetchImpl = fetch } = {}) {
  const dataDir = resolve(ROOT, 'data');
  const store = createStore({ dir: dataDir, catalogFile: resolve(ROOT, 'data/catalog.json') });
  await store.ready();
  const tryon = createTryonService({
    store,
    env,
    fetchImpl,
    resultsDir: resolve(ROOT, 'data/results'),
  });
  const interrupted = await tryon.reconcileInterruptedOrders();
  if (interrupted > 0) console.error(`reconciled ${interrupted} interrupted order(s)`);
  const sources = createSourceService({ env, fetchImpl, dataDir });
  const wardrobe = createWardrobe({ dir: dataDir, env, fetchImpl, captioner: createCaptioner({ env, fetchImpl }), sources });
  const stylist = createStylist({ env, fetchImpl, wardrobe });
  const login = createLoginService({ env, dir: dataDir });
  const app = createApp({ env, fetchImpl, store, tryon, sources, wardrobe, login, stylist, dataDir });
  return { app, store, tryon, sources, wardrobe, stylist, login };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, tryon, login } = await bootstrap();
  const server = app.listen(43130, '127.0.0.1', () => {
    console.log('TryOn Web running at http://127.0.0.1:43130');
  });
  const cleanup = setInterval(() => void tryon.cleanupExpiredResults(), 60 * 60 * 1000);
  cleanup.unref();
  const shutdown = () => {
    server.close();
    Promise.resolve(login?.dispose?.()).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
