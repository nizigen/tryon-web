import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

test('断点续传不得把与旧双人清单不符的文件重新登记为有效', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'pose-archive-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'data', 'posewear-archive');
  await mkdir(join(root, 'scripts'));
  await mkdir(join(dir, 'restricted'), { recursive: true });
  const script = join(root, 'scripts', 'fetch-posewear-library.mjs');
  await copyFile(new URL('../scripts/fetch-posewear-library.mjs', import.meta.url), script);
  const id = 'pair60_P001';
  const file = `restricted/${id}.png`;
  const source = `https://posewear-assets-96b.pages.dev/o/p/${id}_front.png`;
  await writeFile(join(dir, 'library.json'), JSON.stringify({ schemaVersion: 2, poses: [{ id, restricted: true, angles: [{ file, source, view: 'front' }] }] }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const manifest = JSON.stringify([{ file, sha256: createHash('sha256').update(png).digest('hex') }]);
  await writeFile(join(dir, 'pair-checksums.json'), manifest);
  await writeFile(join(dir, file), Buffer.concat([png.subarray(0, 33), Buffer.from([png[33] ^ 1]), png.subarray(34)]));
  await assert.rejects(promisify(execFile)(process.execPath, [script, '--archive-all']), /Checksum mismatch/);
  assert.equal(await readFile(join(dir, 'pair-checksums.json'), 'utf8'), manifest);
  await assert.rejects(readFile(join(dir, 'checksums.json')), { code: 'ENOENT' });
  await writeFile(join(dir, file), png);
  await promisify(execFile)(process.execPath, [script, '--archive-all']);
  await promisify(execFile)(process.execPath, [script, '--verify']);
});

test('索引缩容不得静默丢弃旧摘要，需显式 --prune', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'pose-archive-shrink-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'data', 'posewear-archive');
  await mkdir(join(root, 'scripts'));
  await mkdir(join(dir, 'restricted'), { recursive: true });
  const script = join(root, 'scripts', 'fetch-posewear-library.mjs');
  await copyFile(new URL('../scripts/fetch-posewear-library.mjs', import.meta.url), script);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const angles = ['pair61_P001', 'pair61_P002'].map((id) => ({
    file: `restricted/${id}.png`,
    source: `https://posewear-assets-96b.pages.dev/o/p/${id}_front.png`,
    view: 'front',
  }));
  await Promise.all(angles.map(({ file }) => writeFile(join(dir, file), png)));
  const sha256 = createHash('sha256').update(png).digest('hex');
  const manifest = JSON.stringify(angles.map(({ file }) => ({ file, sha256 })));
  await writeFile(join(dir, 'pair-checksums.json'), manifest);
  await writeFile(join(dir, 'library.json'), JSON.stringify({
    schemaVersion: 2,
    poses: [{ id: 'pair61_P001', restricted: true, angles: [angles[0]] }],
  }));
  await assert.rejects(promisify(execFile)(process.execPath, [script, '--archive-pairs']), /Refusing to drop 1 recorded file/);
  assert.equal(await readFile(join(dir, 'pair-checksums.json'), 'utf8'), manifest);
  await promisify(execFile)(process.execPath, [script, '--archive-pairs', '--prune']);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'pair-checksums.json'), 'utf8')).map(({ file }) => file), ['restricted/pair61_P001.png']);
});
