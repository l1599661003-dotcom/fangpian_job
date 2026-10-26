import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { RecruitmentController } from '../dist/modules/recruitment/recruitment.controller.js';
const require = createRequire(import.meta.url);
const { resolveAccessPolicy } = require('../dist/modules/database/access.guard.js');

test('referral poster order exposes only unique monthly position IDs in demand order', async () => {
  let monthlyHiringArguments;
  const recruitment = {
    monthlyHiring: async (...args) => {
      monthlyHiringArguments = args;
      return {
        month: '2026-10',
        departments: [{ positionId: 'position_second' }, { positionId: 'position_first' }, { positionId: 'position_second' }, { positionId: '' }],
      };
    },
  };
  const access = { getRequestAccess: async () => ({ identity: { userId: 'referrer' }, profile: {} }) };
  const controller = new RecruitmentController(recruitment, access);

  assert.deepEqual(await controller.referralPosterOrder({}), { month: '2026-10', positionIds: ['position_second', 'position_first'] });
  assert.deepEqual(monthlyHiringArguments, ['', undefined]);
});

test('poster order is available to referral-page users without opening recruitment pages', () => {
  assert.deepEqual(resolveAccessPolicy('GET', '/api/recruitment/referral-poster-order').pagesAny, ['referrals']);
  assert.deepEqual(resolveAccessPolicy('GET', '/api/recruitment/monthly-hiring').pagesAny, ['home', 'positions']);
});
