import assert from 'node:assert/strict';
import test from 'node:test';
import { checkIdm, generateIdm, idmTimeout, preflightIdm } from '../src/idm.mjs';
import { MAX_BODY_BYTES } from '../src/validate.mjs';

const env = { IDM_BASE_URL: 'http://idm.test:8190' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const intermediate = Buffer.concat([png, Buffer.from('stage-one')]);
const image = `data:image/png;base64,${png.toString('base64')}`;
const top = { slot: 'top', layer: 'inner', garmentType: 'shirt', name: 'red floral shirt' };
const bottom = { slot: 'bottom', layer: 'middle', garmentType: 'jeans', name: 'black jeans' };
const json = body => new Response(JSON.stringify(body));
const health = { ok: true, pipeline: true, engine: 'idm-vton', categories: ['upper_body', 'lower_body', 'dresses'], canvas: [768, 1024] };
const single = { pieces: [top], referenceImages: [image, image] };

test('IDM checks are read-only, unconfigured skips network, timeout bounded', async () => {
  let called = false;
  assert.equal((await checkIdm({}, () => { called = true; })).configured, false);
  assert.equal(called, false);
  assert.equal(idmTimeout({}), 600000);
  for (const value of ['-1', 'NaN', '3600001', '999']) assert.equal(idmTimeout({ IDM_TIMEOUT_MS: value }), 600000);
  assert.equal(idmTimeout({ IDM_TIMEOUT_MS: '1000' }), 1000);
  const paths = [];
  assert.equal((await checkIdm(env, async (url, options) => {
    paths.push(new URL(url).pathname);
    assert.equal(options.redirect, 'error');
    return json(health);
  })).ready, true);
  assert.deepEqual(paths, ['/health']);
});

test('IDM health validates engine and bounded response, not just an arbitrary ok', async () => {
  for (const body of [{ ok: true }, { ...health, pipeline: false }, { ...health, engine: 'other' }]) {
    assert.equal((await checkIdm(env, async () => json(body))).ready, false);
  }
  assert.equal((await checkIdm(env, async () => new Response('{}', { headers: { 'content-length': '1000000' } }))).ready, false);
});

test('IDM sends pure base64 and keeps canonical image-service result shape', async () => {
  const requests = [];
  const result = await generateIdm(single, env, async (url, options) => {
    requests.push(JSON.parse(options.body));
    assert.equal(new URL(url).pathname, '/tryon');
    assert.equal(options.redirect, 'error');
    return json({ image: png.toString('base64') });
  });
  assert.equal(requests[0].person, png.toString('base64'));
  assert.equal(requests[0].garment, png.toString('base64'));
  assert.equal(requests[0].category, 'upper_body');
  assert.match(requests[0].description, /shirt/);
  assert.equal(requests[0].seed, 42);
  assert.deepEqual(result, { mimeType: 'image/png', buffer: png });
});

test('IDM serializes every garment and uses the actual previous output for the next person', async () => {
  const calls = [];
  const pieces = [top, bottom, { slot: 'outer', garmentType: 'coat', layer: 'outer' }];
  const result = await generateIdm({ pieces, referenceImages: [image, image, image, image] }, env, async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (calls.length > 1) assert.equal(body.person, intermediate.toString('base64'));
    return json({ image: (calls.length < 3 ? intermediate : png).toString('base64') });
  });
  assert.deepEqual(calls.map(call => call.category), ['upper_body', 'lower_body', 'upper_body']);
  assert.notEqual(calls[0].description, calls[1].description);
  assert.equal(result.buffer.equals(png), true);
});

test('IDM validates all pieces before any remote request, including a later unsupported item', async () => {
  let calls = 0;
  const fetcher = () => { calls += 1; throw Error('must not fetch'); };
  await assert.rejects(generateIdm({ pieces: [top, { slot: 'shoes' }], referenceImages: [image, image, image] }, env, fetcher), error => error.code === 'IDM_SLOT');
  await assert.rejects(preflightIdm([{ slot: 'accessory' }], env, fetcher), error => error.code === 'IDM_SLOT');
  assert.equal(calls, 0);
});

test('IDM invalid quantities, malformed metadata and all bad images never upload', async () => {
  let called = false;
  const fetcher = () => { called = true; throw Error('must not fetch'); };
  for (const pieces of [undefined, null, {}, [], Array(6).fill(top), [null]]) {
    await assert.rejects(generateIdm({ pieces, referenceImages: [image, image] }, env, fetcher), error => error.status === 400);
  }
  await assert.rejects(generateIdm({ pieces: [top, bottom], referenceImages: [image, image] }, env, fetcher), error => error.status === 400);
  await assert.rejects(generateIdm({ pieces: [top, bottom], referenceImages: [image, image, 'invalid'] }, env, fetcher), error => error.code === 'INVALID_IMAGE');
  assert.equal(called, false);
});

test('IDM endpoints only come from validated server configuration', async () => {
  let called = false;
  for (const base of ['', 'file:///tmp', 'http://user:pass@idm.test', 'http://idm.test/?token=secret']) {
    await assert.rejects(generateIdm(single, { IDM_BASE_URL: base }, () => { called = true; }), error => error.code === 'WORKFLOW_UNAVAILABLE');
  }
  assert.equal(called, false);
});

test('IDM malformed JSON, URL responses and noncanonical base64 are never treated as a result', async () => {
  for (const payload of [null, {}, { url: 'https://elsewhere.test/private' }, { image: 'not base64' }, { image: png.toString('base64') + '\n' }, { image: Buffer.from('not an image').toString('base64') }]) {
    await assert.rejects(generateIdm(single, env, async () => json(payload)), error => error.code === 'UPSTREAM_FORMAT');
  }
  await assert.rejects(generateIdm(single, env, async () => new Response('invalid json')), error => error.code === 'UPSTREAM_FORMAT');
});

test('IDM caps streaming and declared response sizes', async () => {
  await assert.rejects(generateIdm(single, env, async () => new Response('{}', { headers: { 'content-length': String(MAX_BODY_BYTES + 1) } })), error => error.code === 'UPSTREAM_FORMAT');
  const chunk = new Uint8Array(1024 * 1024);
  await assert.rejects(generateIdm(single, env, async () => new Response(new ReadableStream({
    start(controller) { for (let i = 0; i < 25; i += 1) controller.enqueue(chunk); controller.close(); },
  }))), error => error.code === 'UPSTREAM_FORMAT');
});

test('IDM busy, input error and inference failure have readable errors without remote details', async () => {
  for (const [status, expected] of [[503, 'WORKFLOW_UNAVAILABLE'], [400, 'INVALID_IMAGE'], [413, 'IMAGE_TOO_LARGE'], [500, 'WORKFLOW_FAILED']]) {
    await assert.rejects(generateIdm(single, env, async () => new Response('secret-key /root/private/model', { status })), error => {
      assert.equal(error.code, expected);
      assert.doesNotMatch(error.message, /secret-key|private/);
      return true;
    });
  }
});

test('IDM stops a multi-step job on the first failed stage', async () => {
  let calls = 0;
  await assert.rejects(generateIdm({ pieces: [top, bottom, { slot: 'outer' }], referenceImages: [image, image, image, image] }, env, async () => {
    calls += 1;
    return calls === 1 ? json({ image: png.toString('base64') }) : new Response('', { status: 500 });
  }), error => error.code === 'WORKFLOW_FAILED');
  assert.equal(calls, 2);
});

test('IDM timeout covers the complete chain and honours external abort without retry', async () => {
  let calls = 0;
  const waiting = async (_url, { signal }) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  await assert.rejects(generateIdm(single, env, waiting, { timeoutMs: 20 }), error => error.code === 'UPSTREAM_ERROR');
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort(new Error('external cancellation'));
  await assert.rejects(generateIdm(single, env, waiting, { signal: controller.signal }), /external cancellation/);
});
