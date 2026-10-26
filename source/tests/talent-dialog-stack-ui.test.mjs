import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('talent workflow dialogs replace loading states and preserve resume detail', async () => {
  const source = await readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
  assert.match(source, /function isTalentDialogLoading\(layer\)/);
  assert.match(source, /:scope > \.rf-dialog > \.rf-dialog-loading/);
  assert.match(source, /parentIsTalentDetail && !nextIsTalentDetail/);
  assert.doesNotMatch(source, /parentIsTalentDetail \|\| hasParentDialog/);
  assert.doesNotMatch(source, /if \(talentDialogStack\.length\) return;/);
  assert.doesNotMatch(source, /closeTalentDialog\(\); openOfferManagement\(\)/);
  assert.match(source, /openTalentOfferDialog\(state\.activeId\)/);
});
