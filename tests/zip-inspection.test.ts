import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestZip } from './fixtures/make-zip.js';
import { inspectZipDirectory } from '../src/zip-inspection.js';

test('bounded local ZIP inspection recognizes source hints without reading content', () => {
  const result = inspectZipDirectory(makeTestZip(['site/package.json', 'site/vite.config.ts', 'site/index.html']));
  assert.equal(result.runtime, 'احتمالاً Vite / Node.js');
  assert.equal(result.files, 3);
});
test('unsafe or malformed ZIP entries are rejected', () => {
  assert.throws(() => inspectZipDirectory(makeTestZip(['../secret.txt'])), /مسیر ناامن/);
  const broken = makeTestZip(['package.json']);
  broken.writeUInt32LE(0, 0);
  assert.throws(() => inspectZipDirectory(broken), /دادهٔ ZIP ناقص/);
});
test('ZIP size is bounded before parsing', () => {
  assert.throws(() => inspectZipDirectory(new Uint8Array(25 * 1024 * 1024 + 1)), /۲۵ مگابایت/);
});
