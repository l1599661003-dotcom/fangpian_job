import test from 'node:test';
import assert from 'node:assert/strict';
import { teable } from '../dist/platform/teable.js';
import { RECRUITMENT_TABLES } from '../dist/modules/database/database.schema.js';
import { ReferralsService } from '../dist/modules/referrals/referrals.service.js';

function installMemory() {
  const records = new Map(RECRUITMENT_TABLES.map((table) => [table.name, []]));
  const originals = { listRecords: teable.listRecords, listAllRecords: teable.listAllRecords, createRecord: teable.createRecord, updateRecord: teable.updateRecord };
  let sequence = 0;
  teable.listRecords = async (tableId) => [...(records.get(tableId) || [])];
  teable.listAllRecords = async (tableId) => [...(records.get(tableId) || [])];
  teable.createRecord = async (tableId, fields) => {
    const row = { id: `${tableId}_${++sequence}`, fields: { ...fields }, createdTime: new Date().toISOString() };
    records.get(tableId).push(row);
    return row;
  };
  teable.updateRecord = async (tableId, recordId, fields) => {
    const row = records.get(tableId).find((item) => item.id === recordId);
    if (!row) throw new Error(`record not found: ${tableId}/${recordId}`);
    row.fields = { ...row.fields, ...fields };
    return row;
  };
  return { records, restore: () => Object.assign(teable, originals) };
}

test('personal referral QR requires mobile and reuses the same name mobile and role', async () => {
  const memory = installMemory();
  try {
    const service = new ReferralsService({ requireTableId: (name) => name }, { validateFile() {} });
    const input = {
      name: '产品经理个人内推', role: '产品经理', department: '产品部',
      publicBaseUrl: 'https://example.test/referral', expiresAt: '2026-09-30T23:59:59.999Z',
      referrerName: '高子云', referrerMobile: '13800138000', referrerDepartment: '人才部',
      referrerUserId: 'user_gao', operator: '高子云', operatorUserId: 'user_gao',
    };
    await assert.rejects(() => service.createCampaign({ ...input, referrerMobile: '' }), /姓名和手机号/);
    await assert.rejects(() => service.createCampaign({ ...input, referrerMobile: '123' }), /手机号格式/);

    const first = await service.createCampaign(input);
    const second = await service.createCampaign({ ...input, name: '重复点击生成' });
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.campaignId, first.campaignId);
    assert.equal(memory.records.get('recruitment_referral_campaigns').length, 1);

    const row = memory.records.get('recruitment_referral_campaigns')[0];
    assert.equal(row.fields['推荐人'], '高子云');
    assert.equal(row.fields['推荐人手机号'], '13800138000');
    assert.equal(row.fields['推荐人部门'], '人才部');
    assert.equal(Object.hasOwn(row.fields, '推荐人工号'), false);
    assert.equal(row.fields['过期时间'], '');

    row.fields['过期时间'] = '2000-01-01T00:00:00.000Z';
    const reopenedCampaign = await service.publicCampaign(first.token);
    assert.equal(reopenedCampaign.id, first.campaignId);
    assert.equal(reopenedCampaign.expiresAt, '');

    const listed = await service.campaigns();
    assert.equal(listed.campaigns[0].referrerMobileMasked, '138****8000');
    assert.equal(listed.campaigns[0].referrerName, '高子云');
    assert.equal(listed.campaigns[0].expiresAt, '');
  } finally {
    memory.restore();
  }
});

test('referral resume enters the talent archive and keeps its position application link', async () => {
  const memory = installMemory();
  try {
    const resumes = {
      validateFile() {},
      async processFile(file, progress, source) {
        assert.equal(source, '内推');
        progress('简历已入库');
        await teable.createRecord('resume_extraction_records', { 解析记录ID: 'resume_referral', 候选人ID: 'candidate_referral', 应聘记录ID: 'application_referral', 姓名: '内推候选人', 电话: '13900139000', 源文件名: file.originalname, 来源类型: '内推', 解析状态: '已完成', 创建时间: '2026-09-24T02:00:00.000Z' });
        await teable.createRecord('recruitment_candidates', { 候选人ID: 'candidate_referral', 姓名: '内推候选人', 电话: '13900139000', 候选人状态: '待负责人审查', 来源类型: '内推', 创建时间: '2026-09-24T02:00:00.000Z' });
        await teable.createRecord('recruitment_applications', { 应聘记录ID: 'application_referral', 候选人ID: 'candidate_referral', 当前阶段: '负责人审查', 当前状态: '进行中', 创建时间: '2026-09-24T02:00:00.000Z' });
        return { id: 'resume_referral', candidateId: 'candidate_referral', applicationId: 'application_referral', name: '内推候选人', phone: '13900139000', sourceFileUrl: 'https://files.example.test/referral.pdf', duplicate: false };
      },
    };
    const service = new ReferralsService({ requireTableId: (name) => name }, resumes);
    await teable.createRecord('recruitment_positions', { 职位ID: 'position_product', 职位名称: '产品经理', 部门: '产品部', 发布状态: '招聘中', 招聘状态: '招聘中' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'position_operations', 职位名称: '运营经理', 部门: '运营部', 发布状态: '招聘中', 招聘状态: '招聘中' });
    await teable.createRecord('recruitment_positions', { 职位ID: 'position_paused', 职位名称: '暂停岗位', 部门: '运营部', 发布状态: '招聘中', 招聘状态: '暂停招聘' });
    const campaign = await service.createCampaign({
      name: '产品经理个人内推', positionId: 'position_product', demandId: 'demand_product', role: '产品经理', department: '产品部',
      publicBaseUrl: 'https://example.test/referral', expiresAt: '2026-10-31T23:59:59.999Z',
      referrerName: '高子云', referrerMobile: '13800138000', referrerDepartment: '人才部', referrerUserId: 'user_gao', operator: '高子云', operatorUserId: 'user_gao',
    });
    const publicCampaign = await service.publicCampaign(campaign.token);
    assert.equal(publicCampaign.positionId, 'position_product');
    assert.deepEqual(publicCampaign.positions.map((item) => item.id), ['position_product', 'position_operations']);
    const result = await service.processSubmission(campaign.token, { originalname: '内推候选人.pdf' }, { candidateName: '内推候选人', candidatePhone: '13900139000', intendedPositionId: 'position_operations' }, () => {});

    assert.equal(result.candidateId, 'candidate_referral');
    assert.equal(result.positionId, 'position_operations');
    assert.equal(result.positionName, '运营经理');
    assert.equal(memory.records.get('resume_extraction_records')[0].fields['来源类型'], '内推');
    assert.equal(memory.records.get('recruitment_candidates')[0].fields['候选人状态'], '待负责人审查');
    const application = memory.records.get('recruitment_applications')[0];
    assert.equal(application.fields['职位ID'], 'position_operations');
    assert.equal(application.fields['需求ID'] || '', '');
    assert.equal(application.fields['来源类型'], '内推');
    const referral = memory.records.get('recruitment_referrals')[0];
    assert.equal(referral.fields['职位ID'], 'position_operations');
    assert.equal(referral.fields['需求ID'], '');
    assert.equal(referral.fields['候选人ID'], 'candidate_referral');
    assert.equal(referral.fields['应聘记录ID'], 'application_referral');
    assert.equal(referral.fields['关联状态'], '已关联');
    const listed = await service.list();
    assert.equal(listed.referrals[0].role, '运营经理');
    const tracked = await service.track(result.trackingToken);
    assert.equal(tracked.role, '运营经理');
  } finally {
    memory.restore();
  }
});
