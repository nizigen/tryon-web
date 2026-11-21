import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createApp, decodeImage, generate as generateAdapter, buildPrompt, getConfig as readConfig, gatewayEndpoint } from '../server.mjs';

const gatewayEnv = { IMAGE_API_BASE_URL: 'http://127.0.0.1:3425' };
const generate = (input, env, ...options) => generateAdapter(input, { ...gatewayEnv, ...env }, ...options);
const getConfig = (env, ...options) => readConfig({ ...gatewayEnv, ...env }, ...options);

const MiB = 1024 * 1024;
const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex');
const jpegBytes = Buffer.from('ffd8ff01', 'hex');
const webpBytes = Buffer.from('524946460c000000574542505650382000000000', 'hex');
const dataURL = (bytes, mime = 'image/png') => `data:${mime};base64,${bytes.toString('base64')}`;
const png = dataURL(pngBytes);
const input = { model: 'codex/gpt-image-2', person: png, garment: dataURL(jpegBytes, 'image/jpeg'), category: 'tops', prompt: '' };
const models = ['codex/gpt-image-2', 'workbuddy/hunyuan-image-alpha', 'workbuddy-ai/hy-image-3.5', 'minimax-code/MiniMax-Image'];
const listResponse = (values = models) => Response.json({ result: { tools: [{ name: 'generate_image', inputSchema: { properties: { model: { enum: values } } } }] } });
const imageResponse = () => Response.json({ result: { isError: false, content: [{ type: 'image', data: pngBytes.toString('base64'), mimeType: 'image/png' }] } });
const mcpFetch = async (_url, options) => JSON.parse(options.body).method === 'tools/list' ? listResponse() : imageResponse();
const code = (expected) => (error) => error.code === expected;

async function withApp(env, options, run) {
  const app = createApp({ ...gatewayEnv, ...env }, { fetchImpl: mcpFetch, ...options });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = (body = input, extra = {}) => fetch(`${base}/api/tryon`, {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body),
  });
  try { await run({ app, base, post }); }
  finally { app.closeAllConnections(); await new Promise((resolve) => app.close(resolve)); }
}

function rawRequest(base, path, { method = 'GET', headers = {}, chunks = [] } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(base + path, { method, headers }, (res) => {
      const body = [];
      res.on('data', (chunk) => body.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(body).toString() }));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

test('canonical base64, MIME signatures, WebP container and exact input image limit', () => {
  for (const [bytes, mime] of [[pngBytes, 'image/png'], [jpegBytes, 'image/jpeg'], [webpBytes, 'image/webp']]) {
    assert.equal(decodeImage(dataURL(bytes, mime)).mime, mime);
  }
  for (const value of ['', ` ${png}`, `${png}\n`, 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,!!!!', 'data:image/png;base64,a===', 'data:image/png;base64,AB==',
    'data:image/png;base64,YWJj', dataURL(pngBytes, 'image/jpeg'), dataURL(Buffer.from('RIFF0000WEBP'), 'image/webp')]) {
    assert.throws(() => decodeImage(value), code('INVALID_IMAGE'));
  }
  const exact = Buffer.alloc(8 * MiB); pngBytes.copy(exact);
  assert.equal(decodeImage(dataURL(exact)).bytes, 8 * MiB);
  assert.throws(() => decodeImage(dataURL(Buffer.concat([exact, Buffer.from([0])]))), code('IMAGE_TOO_LARGE'));
});

test('schema is strict and prompts count trimmed Unicode codepoints', async () => {
  for (const invalid of [null, [], {}, { ...input, model: 1 }, { ...input, category: 'upper' },
    { ...input, category: '__proto__' }, { ...input, category: ['tops'] }, { ...input, prompt: 1 },
    { ...input, prompt: null }, { ...input, prompt: '😀'.repeat(2001) }, { ...input, url: 'https://evil.example' }]) {
    await assert.rejects(generate(invalid, {}, () => { throw new Error('must not call'); }));
  }
  await generate({ ...input, prompt: ' ' + '😀'.repeat(2000) + ' ' }, {}, mcpFetch);
  const { prompt, ...withoutPrompt } = input;
  await generate(withoutPrompt, {}, mcpFetch);
  await assert.rejects(generate({ ...input, model: 'unknown' }, {}, mcpFetch), (e) => e.status === 400 && e.field === 'model');
});

test('buildPrompt maps every category to its replacement region', () => {
  assert.match(buildPrompt('tops', ''), /upper body/);
  assert.match(buildPrompt('bottoms', ''), /lower body/);
  assert.match(buildPrompt('dresses', ''), /full-body dress covering the torso and legs/);
  assert.match(buildPrompt('tops', 'cotton'), /Additional instruction from the user: cotton/);
});

test('dynamic model discovery chooses environment, Codex, first or empty default safely', async () => {
  for (const [values, preferred, expected] of [[models, models[2], models[2]], [models, 'unknown', models[0]], [['custom/model'], '', 'custom/model'], [[], '', null]]) {
    const config = await getConfig({ IMAGE_MODEL: preferred }, async () => listResponse(values));
    assert.equal(config.defaultEngine, expected);
    assert.deepEqual(config.gateway, { reachable: true });
    assert.equal(config.engines.filter((e) => e.default).length, expected ? 1 : 0);
    if (values[0] === 'custom/model') assert.equal(config.engines[0].label, 'custom/model');
  }
  const config = await getConfig({}, async () => { throw new Error('secret'); });
  assert.deepEqual(config.engines, []);
  assert.equal(config.defaultEngine, null);
  assert.deepEqual(config.gateway, { reachable: false });
  assert.doesNotMatch(JSON.stringify(config), /secret|3425/);
});

test('MCP sends exact headers, methods, model and ordered data URL references', async () => {
  const calls = [];
  const result = await generate(input, {}, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:3425/v1/images');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['content-type'], 'application/json');
    assert.equal(options.headers.accept, 'application/json, text/event-stream');
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(body.jsonrpc, '2.0');
    if (body.method === 'tools/list') { assert.deepEqual(body.params, {}); return listResponse(); }
    assert.equal(body.params.name, 'generate_image');
    assert.deepEqual(body.params.arguments, { model: input.model, prompt: buildPrompt('tops', ''), reference_images: [input.person, input.garment] });
    return imageResponse();
  });
  assert.equal(calls.length, 2);
  assert.equal(result.engine, input.model);
  assert.equal(result.image.dataURL, png);
  assert.equal(new Date(result.createdAt).toISOString(), result.createdAt);
});

test('SSE uses last data line and asynchronous generation polls the exact pending meta id', async () => {
  let calls = 0;
  const result = await generate(input, {}, async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === 'tools/list') return listResponse();
    calls++;
    if (calls === 1) return Response.json({ result: { isError: false, _meta: { 'image-service.local/pending': 'img_25bffa33785eff93ec508d70' }, content: [{ type: 'text', text: 'The image is still being made (20 s so far; it can take a few minutes). It goes on without this call. Don\'t ask for it again: call generation_result with id "img_25bffa33785eff93ec508d70" to wait for it and get it.' }] } });
    assert.equal(body.params.name, 'generation_result');
    assert.deepEqual(body.params.arguments, { id: 'img_25bffa33785eff93ec508d70' });
    return new Response('event: message\ndata: {}\n\ndata: ' + JSON.stringify({ result: { content: [{ type: 'image', mimeType: 'image/png', data: pngBytes.toString('base64') }] } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  assert.equal(result.image.dataURL, png);
  assert.equal(calls, 2);
});

test('MCP failures, missing images and invalid output fail without exposing upstream secrets', async () => {
  const failures = [
    () => { throw new Error('private-key secret-photo'); },
    () => new Response('secret body', { status: 502 }),
    () => Response.json({ error: { message: 'private-key' } }),
    () => Response.json({ result: { isError: true, content: [{ type: 'text', text: 'private-key' }] } }),
    () => Response.json({ result: { content: [{ type: 'text', text: 'ordinary failure 123' }] } }),
    () => new Response('{'),
    () => Response.json({ result: { content: [{ type: 'image', mimeType: 'image/png', data: 'AB==' }] } }),
    () => Response.json({ result: { content: [{ type: 'image', mimeType: 'image/jpeg', data: pngBytes.toString('base64') }] } }),
  ];
  for (const failure of failures) {
    await assert.rejects(generate(input, {}, async (_url, options) => JSON.parse(options.body).method === 'tools/list' ? listResponse() : failure()),
      (e) => e.status === 502 && !/private-key|secret|ordinary/.test(e.message));
  }
  await withApp({}, { fetchImpl: async (_url, options) => JSON.parse(options.body).method === 'tools/list' ? listResponse() : Response.json({ result: { isError: true, content: [{ type: 'text', text: 'MiniMax Image returned no images; key=secret' }] } }) }, async ({ post }) => {
    const response = await post(); assert.equal(response.status, 502);
    const error = (await response.json()).error;
    assert.equal(error.code, 'UPSTREAM_ERROR');
    assert.match(error.message, /MiniMax Image returned no images/);
    assert.doesNotMatch(error.message, /secret/);
  });
});

test('MCP response streams and decoded images enforce exact size limits', async () => {
  const exact = Buffer.alloc(16 * MiB); pngBytes.copy(exact);
  const respond = (data) => async (_url, options) => JSON.parse(options.body).method === 'tools/list' ? listResponse() : Response.json({ result: { content: [{ type: 'image', mimeType: 'image/png', data }] } });
  assert.equal((await generate(input, {}, respond(exact.toString('base64')))).image.mimeType, 'image/png');
  await assert.rejects(generate(input, {}, respond(Buffer.concat([exact, Buffer.from([0])]).toString('base64'))), code('UPSTREAM_FORMAT'));
  const payload = JSON.stringify({ result: { content: [{ type: 'image', mimeType: 'image/png', data: pngBytes.toString('base64') }] } });
  const exactJSON = payload + ' '.repeat(24 * MiB - Buffer.byteLength(payload));
  await generate(input, {}, async (_url, options) => JSON.parse(options.body).method === 'tools/list' ? listResponse() : new Response(exactJSON));
  let cancelled = false;
  await assert.rejects(generate(input, {}, async (_url, options) => JSON.parse(options.body).method === 'tools/list' ? listResponse() : new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.from(exactJSON)); c.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } }))), code('UPSTREAM_FORMAT'));
  assert.equal(cancelled, true);
});

test('HTTP config shape, precise Host/Origin and route/method/static allowlist', async () => {
  await withApp({ IMAGE_API_BASE_URL: 'http://127.0.0.1:3425', OPENAI_API_KEY: 'do-not-leak' }, {}, async ({ base, post }) => {
    const response = await fetch(base + '/api/config');
    const config = await response.json();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(config.engines.map(({ id, available }) => ({ id, available })), models.map((id) => ({ id, available: true })));
    assert.equal(config.defaultEngine, models[0]);
    assert.deepEqual(config.gateway, { reachable: true });
    assert.deepEqual(config.limits, { imageBytes: 8 * MiB, requestBytes: 24 * MiB, promptChars: 2000 });
    assert.deepEqual(config.categories, ['tops', 'bottoms', 'dresses']);
    assert.doesNotMatch(JSON.stringify(config), /do-not-leak|private-key|images.example/);
    for (const origin of ['null', 'https://evil.example', base.replace('http:', 'https:'), base + '/', 'http://127.0.0.1:43130']) {
      assert.equal((await post(input, { origin })).status, 403);
    }
    assert.equal((await fetch(base + '/api/config', { headers: { origin: 'null' } })).status, 403);
    assert.equal((await fetch(base + '/api/tryon', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await rawRequest(base, '/api/config', { headers: { host: 'localhost:' + new URL(base).port } })).status, 403);
    assert.equal((await rawRequest(base, '/api/config', { headers: { host: '127.0.0.1:43130' } })).status, 403);
    for (const path of ['/server.mjs', '/BACKEND_STRUCTURE.md', '/test/server.test.mjs', '/.env', '/design/other.js', '/design/%2e%2e/server.mjs']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    for (const path of ['/design/a.html', '/design/preview.css', '/design/preview.js']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
      assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self'/);
      assert.equal((await fetch(base + path, { method: 'POST', headers: { origin: base } })).status, 405);
    }
    assert.equal((await fetch(base + '/api/config', { method: 'PUT' })).status, 405);
    assert.equal((await fetch(base + '/api/tryon')).status, 405);
    assert.equal((await fetch(base + '/api/tryon?x=1', { method: 'POST', headers: { origin: base } })).status, 400);
    assert.equal((await fetch(base + '/api/config', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } })).status, 403);
    const head = await fetch(base + '/design/a.html', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
  });
});

test('cross-site top-level navigation only permits allowlisted static HTML with valid Host and Origin', async () => {
  await withApp({}, {}, async ({ base }) => {
    const navigation = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
    for (const path of ['/', '/index.html', '/public/index.html', '/design/index.html', '/design/a.html']) {
      assert.equal((await rawRequest(base, path, { headers: navigation })).status, 200, path);
    }
    assert.equal((await rawRequest(base, '/', { method: 'HEAD', headers: navigation })).status, 200);
    for (const path of ['/api/config', '/api/tryon', '/server.mjs', '/design/preview.js']) {
      assert.equal((await rawRequest(base, path, { headers: navigation })).status, 403, path);
    }
    assert.equal((await rawRequest(base, '/', { headers: { ...navigation, origin: 'https://evil.example' } })).status, 403);
    assert.equal((await rawRequest(base, '/', { headers: { ...navigation, host: 'evil.example' } })).status, 403);
    assert.equal((await rawRequest(base, '/design/a.html', { headers: { ...navigation, 'sec-fetch-dest': 'iframe' } })).status, 403);
    assert.equal((await rawRequest(base, '/', { headers: { ...navigation, 'sec-fetch-mode': 'cors' } })).status, 403);
    assert.equal((await rawRequest(base, '/api/config', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await rawRequest(base, '/api/tryon', { method: 'POST', headers: { ...navigation, origin: base, 'content-type': 'application/json' }, chunks: [JSON.stringify(input)] })).status, 403);
    assert.equal((await rawRequest(base, '/design/a.html', { method: 'POST', headers: { ...navigation, origin: base } })).status, 403);
  });
});

test('HTTP accepts valid JSON and rejects invalid input and empty bodies', async () => {
  await withApp({}, {}, async ({ base, post }) => {
    assert.equal((await post()).status, 200);
    assert.equal((await post({ ...input, secret: 1 })).status, 400);
    assert.equal((await post(input, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post(input, { 'content-type': 'application/json; charset=utf-8' })).status, 200);
    assert.equal((await post(input, { 'content-type': 'application/json-evil' })).status, 415);
    const empty = await fetch(base + '/api/tryon', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '' });
    assert.equal(empty.status, 400);
    const invalid = await fetch(base + '/api/tryon', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{' });
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
  });
});

test('request body limit counts streamed bytes and accepts exactly 24MiB', async () => {
  await withApp({}, {}, async ({ base }) => {
    const body = JSON.stringify(input);
    const exact = body + ' '.repeat(24 * MiB - Buffer.byteLength(body));
    const headers = { origin: base, 'content-type': 'application/json' };
    const exactResponse = await rawRequest(base, '/api/tryon', { method: 'POST', headers, chunks: [exact] });
    assert.equal(exactResponse.status, 200);
    const oversized = await rawRequest(base, '/api/tryon', { method: 'POST', headers, chunks: [exact, ' '] });
    assert.equal(oversized.status, 413);
    const declared = await rawRequest(base, '/api/tryon', { method: 'POST', headers: { ...headers, 'content-length': String(24 * MiB + 1) } });
    assert.equal(declared.status, 413);
  });
});

test('one instance rejects concurrent generation then releases the slot on success', async () => {
  let release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  let calls = 0;
  await withApp({}, { fetchImpl: async (_url, options) => {
    if (JSON.parse(options.body).method === 'tools/list') return listResponse(); calls++; entered(); await new Promise((resolve) => { release = resolve; }); return imageResponse();
  } }, async ({ post }) => {
    const first = post(); await started;
    const second = await post();
    assert.equal(second.status, 409); assert.equal((await second.json()).error.code, 'BUSY');
    assert.equal(calls, 1); release(); assert.equal((await first).status, 200);
    const third = post();
    while (calls !== 2) await new Promise((resolve) => setImmediate(resolve));
    release(); assert.equal((await third).status, 200);
  });
});

test('single deadline aborts stalled fetch and stalled upstream body, with safe 502', async () => {
  for (const bodyStalls of [false, true]) {
    let signal;
    await withApp({}, { timeoutMs: 30, fetchImpl: async (_url, options) => {
      signal = options.signal;
      return bodyStalls ? new Response(new ReadableStream({ start() {} })) : new Promise(() => {});
    } }, async ({ post }) => {
      const response = await post();
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error.code, 'UPSTREAM_ERROR');
      assert.equal(signal.aborted, true);
    });
  }
});

test('deadline includes a slow client upload before any outbound request', async () => {
  let calls = 0;
  await withApp({}, { timeoutMs: 30, fetchImpl: async () => { calls++; return imageResponse(); } }, async ({ base }) => {
    const result = await new Promise((resolve, reject) => {
      const req = request(base + '/api/tryon', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' } }, (res) => {
        res.resume(); res.on('end', () => { req.destroy(); resolve(res.statusCode); });
      });
      req.on('error', reject); req.write('{');
    });
    assert.equal(result, 502); assert.equal(calls, 0);
  });
});

test('an already cancelled generation never starts an upstream request', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  let calls = 0;
  await assert.rejects(generate(input, {}, async () => {
    calls++; return imageResponse();
  }, { signal: controller.signal }), /cancelled/);
  assert.equal(calls, 0);
});

test('client disconnect aborts outbound fetch and releases the single instance slot', async () => {
  let started, aborted;
  const entered = new Promise((resolve) => { started = resolve; });
  const cancelled = new Promise((resolve) => { aborted = resolve; });
  let calls = 0;
  await withApp({}, { fetchImpl: async (_url, { signal, body }) => {
    if (JSON.parse(body).method === 'tools/list') return listResponse();
    calls++;
    if (calls > 1) return imageResponse();
    signal.addEventListener('abort', aborted, { once: true }); started(); return new Promise(() => {});
  } }, async ({ base, post }) => {
    const req = request(base + '/api/tryon', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' } });
    req.on('error', () => {}); req.end(JSON.stringify(input));
    await entered; req.destroy(); await cancelled;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await post()).status, 200);
  });
});


test('gateway discovery prefers environment, validates local file and only falls back on missing file', async () => {
  const read = async () => JSON.stringify({ addr: '127.0.0.1:4567' });
  assert.equal(await gatewayEndpoint({}, read), 'http://127.0.0.1:4567/v1/images');
  assert.equal(await gatewayEndpoint({ IMAGE_API_BASE_URL: 'http://127.0.0.1:7654', IMAGE_API_MCP_PATH: '/mcp/custom/image' }, () => { throw new Error(); }), 'http://127.0.0.1:7654/mcp/custom/image');
  assert.equal(await gatewayEndpoint({}, async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); }), 'http://127.0.0.1:3425/v1/images');
  for (const content of ['{', '{}', '{"addr":"evil.example:9999"}']) await assert.rejects(gatewayEndpoint({}, async () => content), code('UPSTREAM_ERROR'));
  for (const value of ['', 'http://evil.example', 'http://127.0.0.1:4567?key=secret', 'http://u:p@127.0.0.1:4567']) await assert.rejects(gatewayEndpoint({ IMAGE_API_BASE_URL: value }, read), code('UPSTREAM_ERROR'));
});

test('discovery failures return HTTP 200 empty config while generation fails 502', async () => {
  await withApp({}, { fetchImpl: async () => { throw new Error('secret'); } }, async ({ base, post }) => {
    const response = await fetch(base + '/api/config'); assert.equal(response.status, 200);
    const config = await response.json(); assert.deepEqual(config.engines, []); assert.equal(config.defaultEngine, null);
    assert.deepEqual(config.gateway, { reachable: false }); assert.doesNotMatch(JSON.stringify(config), /secret|baseUrl|3425/);
    assert.equal((await post()).status, 502);
  });
});

test('pending wait shares the total deadline and reports a safe 502', async () => {
  let calls = 0;
  await assert.rejects(generate(input, {}, async (_url, options) => {
    calls++;
    if (JSON.parse(options.body).method === 'tools/list') return listResponse();
    return Response.json({ result: { isError: false, _meta: { 'image-service.local/pending': 'img_123abc' }, content: [] } });
  }, { timeoutMs: 30 }), (error) => error.status === 502 && error.code === 'UPSTREAM_ERROR');
  assert.equal(calls, 2);
});


test('gateway MCP path cannot normalize into an external URL', async () => {
  for (const path of ['/\t/remote.example/path', '/\n/remote.example/path', '//remote.example/path', '/\\remote.example/path']) {
    await assert.rejects(gatewayEndpoint({ ...gatewayEnv, IMAGE_API_MCP_PATH: path }), code('UPSTREAM_ERROR'));
  }
});

test('pending followed by a terminal missing image or error fails immediately and releases the slot', async () => {
  for (const isError of [false, true]) {
    let calls = 0;
    await withApp({}, { timeoutMs: 3000, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.method === 'tools/list') return listResponse();
      calls++;
      if (calls === 1) return Response.json({ result: { _meta: { 'image-service.local/pending': 'img_abcd' }, content: [] } });
      if (calls === 2) return Response.json({ result: { isError, content: [{ type: 'text', text: 'Finished without an image' }] } });
      return imageResponse();
    } }, async ({ post }) => {
      const response = await post(); assert.equal(response.status, 502);
      assert.doesNotMatch((await response.json()).error.message, /超时/);
      assert.equal(calls, 2);
      assert.equal((await post()).status, 200);
      assert.equal(calls, 3);
    });
  }
});
