import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('referral poster follows monthly demand order and limits poster selection', async () => {
  const source = await readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../source-app/admin-ui.css', import.meta.url), 'utf8');
  const referralsService = await readFile(new URL('../server/modules/referrals/referrals.service.ts', import.meta.url), 'utf8');
  const posterStart = source.indexOf('async function openReferralPoster()');
  const posterEnd = source.indexOf('function renderPublicReferral', posterStart);
  const posterSource = source.slice(posterStart, posterEnd);

  assert.notEqual(posterStart, -1);
  assert.notEqual(posterEnd, -1);
  assert.match(posterSource, /request\('api\/recruitment\/referral-poster-order'\)/);
  assert.match(posterSource, /const orderedPositionIds = orderResult\.positionIds \|\| \[\];/);
  assert.match(posterSource, /const allPositions = orderedPositionIds\.map\(\(positionId\) => positionsById\.get\(positionId\)\)\.filter\(Boolean\);/);
  assert.match(posterSource, /new Set\(allPositions\.slice\(0, 5\)\.map\(\(position\) => position\.id\)\)/);
  assert.match(posterSource, /count >= 5/);
  assert.match(posterSource, /role: '全部岗位'/);
  assert.match(posterSource, /selectedPositions\.map\(\(position\) =>/);
  assert.doesNotMatch(posterSource, /positionsResult\.positions \|\| \[\]\)\.filter\(\(p\) => \['招聘中', '已发布'\]\.includes\(p\.status\)\)/);
  assert.match(styles, /\.rf-xhs-poster-qr-float img \{[^}]*filter: grayscale\(1\) contrast\(2\);/);
  assert.doesNotMatch(styles, /\.rf-xhs-poster-qr-float img \{[^}]*sepia/);
  assert.match(referralsService, /color:\{dark:'#000000',light:'#ffffff'\}/);
});
