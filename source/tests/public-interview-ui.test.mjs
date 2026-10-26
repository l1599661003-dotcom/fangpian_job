import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('candidate interview invitation only submits preparation information', async () => {
  const source = await readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
  assert.match(source, /提交基本信息/);
  assert.match(source, /JSON\.stringify\(\{ profile \}\)/);
  assert.doesNotMatch(source, /data-public-interview-confirm/);
  assert.doesNotMatch(source, /提交信息并确认参加/);
});
