import test from 'node:test';
import assert from 'node:assert/strict';
import { ResumesService } from '../dist/modules/resumes/resumes.service.js';

const service = new ResumesService({}, {}, {}, {});

test('name extraction handles a name between phone and email', () => {
  const rawText = [
    '媒红 电话：+8613181501165 栾怡涵 邮箱：3115079613@qq.com 出生年月：2004.12',
    '教育背景/Education',
    '山东工商学院，本科，翻译专业 2023/09-2027/06',
  ].join('\n');

  assert.equal(service.nameFromText(rawText), '栾怡涵');
});

test('name extraction handles a name between email and phone', () => {
  const rawText = [
    '邮箱：3115079613@qq.com 栾怡涵 电话：+8613181501165',
    '教育背景/Education',
  ].join('\n');

  assert.equal(service.nameFromText(rawText), '栾怡涵');
});
