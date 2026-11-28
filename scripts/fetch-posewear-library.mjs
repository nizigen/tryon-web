import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const archive = fileURLToPath(new URL('../data/posewear-archive/', import.meta.url));
const indexUrl = 'https://posewear.pages.dev/assets/poses.2383bf449f.json';
const cdn = 'https://posewear-assets-96b.pages.dev/';
const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex');
const pngEnd = Buffer.from('0000000049454e44ae426082', 'hex');

async function atomicWrite(path, bytes) {
  const temporary = `${path}.${randomUUID()}.part`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90000), redirect: 'error' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function indexedPose(entry) {
  if (!/^[a-z0-9_]+_P\d{3}$/.test(entry.id) || !Array.isArray(entry.angles) || !entry.angles.length) {
    throw new Error('Unrecognized PoseWear index entry');
  }
  const restricted = entry.line === '双人互动';
  const angles = entry.angles.map(({ zh, en, o: original }) => {
    const view = ['front', 'diag', 'side', 'low', 'high'].find((key) => original === `o/p/${entry.id}_${key}.png`);
    if (!view) throw new Error(`Unexpected angle path for ${entry.id}`);
    const file = `${entry.id}${view === 'front' ? '' : `_${view}`}.png`;
    return { zh, en, view, source: cdn + original, file: `${restricted ? 'restricted' : 'library'}/${file}` };
  });
  return { id: entry.id, no: entry.no, line: entry.line, category: entry.cat, nameZh: entry.zh, nameEn: entry.en,
    restricted, upstream18Plus: Boolean(entry.a), angles };
}

async function refreshIndex() {
  const data = JSON.parse(await download(indexUrl));
  const poses = data.map(indexedPose);
  const angles = poses.flatMap((pose) => pose.angles);
  if (!poses.length || new Set(angles.map((angle) => angle.file)).size !== angles.length) throw new Error('Invalid index');
  const index = { schemaVersion: 2, capturedAt: new Date().toISOString(), indexUrl, poses };
  await atomicWrite(join(archive, 'library.json'), JSON.stringify(index, null, 2) + '\n');
  return index;
}

function pngRecord(bytes, file) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(pngHeader) || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      !bytes.subarray(-12).equals(pngEnd)) throw new Error(`Incomplete or invalid PNG: ${file}`);
  return { file, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
    sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function fetchAngle(angle, offline, knownHashes) {
  const path = join(archive, angle.file);
  const expected = knownHashes.get(angle.file);
  function check(bytes) {
    const result = pngRecord(bytes, angle.file);
    if (expected && expected !== result.sha256) throw new Error(`Checksum mismatch: ${angle.file}`);
    return result;
  }
  try {
    return check(await readFile(path));
  } catch (error) {
    if (offline || error.code !== 'ENOENT') throw error;
  }
  const bytes = await download(angle.source);
  const record = check(bytes);
  await atomicWrite(path, bytes);
  return record;
}

async function previousHashes() {
  const hashes = new Map();
  for (const name of ['checksums.json', 'pair-checksums.json']) {
    let records;
    try { records = JSON.parse(await readFile(join(archive, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const { file, sha256 } of records) {
      if (!/^[0-9a-f]{64}$/.test(sha256) || (hashes.has(file) && hashes.get(file) !== sha256)) {
        throw new Error(`Conflicting or invalid checksum for ${file}`);
      }
      hashes.set(file, sha256);
    }
  }
  return hashes;
}

async function previousManifest(name) {
  try {
    return JSON.parse(await readFile(join(archive, name), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function processAngles(angles, offline, knownHashes) {
  const pending = angles.values();
  async function run() {
    const records = [];
    for (const angle of pending) records.push(await fetchAngle(angle, offline, knownHashes));
    return records;
  }
  return (await Promise.all(Array.from({ length: 6 }, run))).flat().sort((left, right) => left.file.localeCompare(right.file, 'en'));
}

async function main(mode, prune) {
  if (!['--metadata', '--archive-all', '--archive-pairs', '--verify'].includes(mode)) {
    throw new Error('Usage: node scripts/fetch-posewear-library.mjs --metadata | --archive-all | --archive-pairs | --verify [--prune]');
  }
  if (prune && !['--archive-all', '--archive-pairs'].includes(mode)) throw new Error('--prune only applies to archive runs');
  await mkdir(archive, { recursive: true });
  if (mode === '--metadata') { await refreshIndex(); return; }
  const index = JSON.parse(await readFile(join(archive, 'library.json'), 'utf8'));
  if (index.schemaVersion !== 2) throw new Error('Run --metadata first');
  const poses = index.poses.filter((pose) => mode !== '--archive-pairs' || pose.restricted);
  for (const pose of poses) {
    if (!/^[a-z0-9_]+_P\d{3}$/.test(pose.id) || !pose.angles?.length) throw new Error('Invalid cached pose');
    for (const { view, file, source } of pose.angles) {
      const folder = pose.restricted ? 'restricted' : 'library';
      if (!['front', 'diag', 'side', 'low', 'high'].includes(view) ||
          file !== `${folder}/${pose.id}${view === 'front' ? '' : `_${view}`}.png` ||
          source !== `${cdn}o/p/${pose.id}_${view}.png`) throw new Error('Invalid cached asset location');
    }
  }
  await Promise.all(['restricted', 'library'].map((folder) => mkdir(join(archive, folder), { recursive: true })));
  const records = await processAngles(poses.flatMap((pose) => pose.angles), mode === '--verify', await previousHashes());
  const manifest = join(archive, mode === '--archive-pairs' ? 'pair-checksums.json' : 'checksums.json');
  const text = JSON.stringify(records, null, 2) + '\n';
  if (mode === '--verify') {
    if (text !== await readFile(manifest, 'utf8')) throw new Error('Archive differs from recorded checksums');
  } else {
    const previous = await previousManifest(mode === '--archive-pairs' ? 'pair-checksums.json' : 'checksums.json');
    const kept = new Set(records.map(({ file }) => file));
    const dropped = previous.map(({ file }) => file).filter((file) => !kept.has(file));
    if (dropped.length && !prune) {
      throw new Error(`Refusing to drop ${dropped.length} recorded file(s); pass --prune to authorize: ${dropped.slice(0, 3).join(', ')}`);
    }
    await atomicWrite(manifest, text);
  }
  console.log(JSON.stringify({ poses: poses.length, images: records.length, bytes: records.reduce((sum, item) => sum + item.bytes, 0), manifest }));
}

main(process.argv[2], process.argv.includes('--prune')).catch((error) => { console.error(error.message); process.exitCode = 1; });
