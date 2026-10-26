import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { teable } from '../dist/platform/teable.js';
import { ResumeApiKeyService } from '../dist/modules/resumes/resume-api-key.service.js';

test('resume API key remains valid until rotation and exposes the connection-check endpoint', async () => {
  const originals = {
    listFields: teable.listFields,
    listRecords: teable.listRecords,
    createRecord: teable.createRecord,
    updateRecord: teable.updateRecord,
  };
  const rows = [];
  let sequence = 0;
  try {
    teable.listFields = async () => ['配置名称', 'API Key', '状态', '创建时间', '更新时间'].map((name) => ({ name }));
    teable.listRecords = async () => rows;
    teable.createRecord = async (_tableId, fields) => {
      const row = { id: `key_${++sequence}`, fields: { ...fields } };
      rows.push(row);
      return row;
    };
    teable.updateRecord = async (_tableId, id, fields) => {
      const row = rows.find((item) => item.id === id);
      row.fields = { ...row.fields, ...fields };
      return row;
    };

    const service = new ResumeApiKeyService({ requireTableId: (name) => name });
    const first = await service.getConfig();
    assert.match(first.apiKey, /^rf_live_/);
    assert.equal(first.expiresAt, null);
    assert.match(first.validity, /长期有效/);
    assert.equal(first.formatsEndpoint, '/api/public/resumes/formats');
    assert.equal(await service.validate(first.apiKey), true);

    const rotated = await service.rotate();
    assert.notEqual(rotated.apiKey, first.apiKey);
    assert.equal(await service.validate(first.apiKey), false);
    assert.equal(await service.validate(rotated.apiKey), true);
    assert.equal(rows.find((row) => row.fields['API Key'] === first.apiKey).fields['状态'], 'rotated');
  } finally {
    Object.assign(teable, originals);
  }
});

test('developer center and XBot sample use the current key flow', async () => {
  const [frontend, xbot] = await Promise.all([
    readFile(new URL('../source-app/vue/api-documentation.js', import.meta.url), 'utf8'),
    readFile(new URL('../project-docs/xbot-resume-parser.py', import.meta.url), 'utf8'),
  ]);
  assert.match(frontend, /Key 不自动过期/);
  assert.match(frontend, /api\/public\/resumes\/formats/);
  assert.match(frontend, /验证连接/);
  assert.match(frontend, /checkConnection/);
  assert.match(xbot, /https:\/\/r5vd-1031\.studio\.fengbao\.com/);
  assert.match(xbot, /global_key = _clean_api_key\(_get_global_variable\("resume_api_key"/);
  assert.match(xbot, /file_path = _resolve_file_path\(args\)/);
  assert.match(xbot, /api_key = _get_api_key\(args\)/);
  assert.ok(xbot.indexOf('_check_api_connection(session, api_key)') < xbot.indexOf('_upload_resume(session, file_path, api_key)'));
});
