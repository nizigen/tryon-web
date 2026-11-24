import assert from 'node:assert/strict';
import test from 'node:test';
import { checkWorkflow, generateWorkflow, workflowTimeout } from '../src/comfyui.mjs';
import { workflowGraph } from '../src/comfy-workflow.mjs';

const env = { COMFYUI_BASE_URL: 'http://gpu.test:8188' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const image = `data:image/png;base64,${png.toString('base64')}`;
const json = body => new Response(JSON.stringify(body));
function objectInfo() {
  const graph = workflowGraph({ images: ['person.png', 'garment.png'], prompt: 'wear it', env, seed: 1 });
  const schema = {};
  for (const node of Object.values(graph)) {
    schema[node.class_type] = { input: { required: Object.fromEntries(Object.entries(node.inputs).map(([key, value]) => [key, [typeof value === 'number' ? 'FLOAT' : 'STRING']])) } };
  }
  return schema;
}
test('workflow status unconfigured does not call network; timeout bounded', async () => {
  assert.equal((await checkWorkflow({}, () => { throw Error('network'); })).configured, false);
  assert.equal(workflowTimeout({}), 900000);
  assert.equal(workflowTimeout({ COMFYUI_TIMEOUT_MS: '-1' }), 900000);
});
test('workflow preflight checks schema and model enums without uploading photos', async () => {
  const schema = objectInfo();
  const urls = [];
  const fetcher = async url => { urls.push(String(url)); return json(schema); };
  assert.equal((await checkWorkflow(env, fetcher)).ready, true);
  assert.deepEqual(urls, ['http://gpu.test:8188/object_info']);
  schema.LoraLoaderModelOnly.input.required.lora_name = [['other.safetensors']];
  assert.equal((await checkWorkflow(env, fetcher)).ready, false);
  delete schema.LoraLoaderModelOnly;
  assert.equal((await checkWorkflow(env, fetcher)).ready, false);
});
test('workflow uploads distinct references, submits one graph, downloads only output node', async () => {
  const calls = [];
  let upload = 0;
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    const path = new URL(url).pathname;
    if (path === '/upload/image') {
      assert.ok(options.body instanceof FormData);
      return json({ name: `ref-${++upload}.png`, subfolder: '', type: 'input' });
    }
    if (path === '/prompt') {
      const body = JSON.parse(options.body);
      assert.equal(body.prompt.output.class_type, 'SaveImage');
      return json({ prompt_id: 'own-prompt' });
    }
    if (path === '/history/own-prompt') return json({ 'own-prompt': { status: { completed: true, status_str: 'success' }, outputs: { unrelated: { images: [{ filename: 'wrong.png' }] }, output: { images: [{ filename: 'result.png', subfolder: 'tryon', type: 'output' }] } } } });
    if (path === '/view') { assert.equal(new URL(url).searchParams.get('filename'), 'result.png'); return new Response(png); }
    throw Error('unexpected URL');
  };
  const result = await generateWorkflow({ referenceImages: [image, image], prompt: 'reference image 1' }, env, fetcher);
  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual(result.buffer, png);
  assert.equal(upload, 2);
  assert.ok(calls.every(call => call.options.redirect === 'error'));
});
test('invalid references and too many garments never upload; missing config is readable', async () => {
  let called = false;
  const fetcher = () => { called = true; throw Error(); };
  await assert.rejects(generateWorkflow({ referenceImages: [image, image, image, image, image] }, env, fetcher), e => e.code === 'WORKFLOW_PIECES');
  await assert.rejects(generateWorkflow({ referenceImages: [image, 'invalid'] }, env, fetcher), e => e.code === 'INVALID_IMAGE');
  await assert.rejects(generateWorkflow({ referenceImages: [image, image] }, {}, fetcher), e => e.code === 'WORKFLOW_UNAVAILABLE');
  assert.equal(called, false);
});
test('workflow rejects unsafe result paths and propagates execution failure', async () => {
  for (const history of [
    { status: { status_str: 'error' }, outputs: {} },
    { status: { completed: true, status_str: 'success' }, outputs: { output: { images: [{ filename: '../secret.png', type: 'output' }] } } },
  ]) {
    const fetcher = async url => {
      const path = new URL(url).pathname;
      if (path === '/upload/image') return json({ name: 'ref.png', type: 'input' });
      if (path === '/prompt') return json({ prompt_id: 'p' });
      if (path === '/history/p') return json({ p: history });
      throw Error('must not fetch view');
    };
    await assert.rejects(generateWorkflow({ referenceImages: [image, image], prompt: '' }, env, fetcher), e => ['WORKFLOW_FAILED', 'UPSTREAM_FORMAT'].includes(e.code));
  }
});
test('unexpected upload subfolders fail before submitting an incompatible graph', async () => {
  const paths = [];
  const fetcher = async url => {
    paths.push(new URL(url).pathname);
    return json({ name: 'ref.png', subfolder: 'unexpected', type: 'input' });
  };
  await assert.rejects(generateWorkflow({ referenceImages: [image, image] }, env, fetcher), error => error.code === 'UPSTREAM_FORMAT');
  assert.deepEqual(paths, ['/upload/image']);
});

test('workflow timeout cancels only own queued prompt without global interrupt', async () => {
  const deletions = [];
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/upload/image') return json({ name: 'ref.png', type: 'input' });
    if (path === '/prompt') return json({ prompt_id: 'owned' });
    if (path === '/history/owned') return json({});
    if (path === '/queue') { deletions.push(JSON.parse(options.body)); return json({}); }
    throw Error(path);
  };
  await assert.rejects(generateWorkflow({ referenceImages: [image, image], prompt: '' }, env, fetcher, { timeoutMs: 40, pollMs: 1 }), e => e.code === 'UPSTREAM_ERROR');
  assert.deepEqual(deletions, [{ delete: ['owned'] }]);
});
