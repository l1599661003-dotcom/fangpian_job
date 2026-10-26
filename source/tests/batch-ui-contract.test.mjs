import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('batch progress polling remains active after five minutes and retries transient reads', async () => {
  const source = await readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
  assert.match(source, /while \(true\)/);
  assert.doesNotMatch(source, /for \(let attempt = 0; attempt < 300; attempt\+\+\)/);
  assert.match(source, /const batchName = document/);
  assert.doesNotMatch(source, /document\.getElementById\('rf-batch-name'\)\.value\.trim\(\)}（第/);
  assert.match(source, /批量进度暂时读取失败，正在自动重试/);
});

