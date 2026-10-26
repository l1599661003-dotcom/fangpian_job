import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('interview question review exposes the Word export action', async () => {
  const source = await readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
  assert.match(source, /data-rf-export-interview-questions/);
  assert.match(source, /questions\/export/);
  assert.match(source, /Word 文档已生成并开始下载/);
});
