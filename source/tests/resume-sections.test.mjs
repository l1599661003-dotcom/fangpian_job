import test from 'node:test';
import assert from 'node:assert/strict';
import { ResumesService } from '../dist/modules/resumes/resumes.service.js';
import { llm } from '../dist/platform/llm.js';

const service = new ResumesService();
const work = '甲公司 总账会计 2022.03-2024.05\n负责账务核算。\n\n乙公司 外勤会计 2021.09-2021.12\n负责工商业务。\n\n丙公司 销售专员 2020.01-2020.07\n负责客户拓展。';
const raw = `测试候选人\n7年工作经验 | 求职意向：会计 | 期望薪资：6-10K\n资格证书\nCMA、CPA\n个人优势\n拥有5年工作经验，愿意学习。\n工作经历\n${work}\n项目经历\n校企合作项目\n教育经历\n测试学院 大专 会计`;

test('work section ignores inline experience labels and stops at the next section', () => {
  const result = service.ruleExtract(raw);
  assert.equal(result.workExperience, work);
  assert.equal(result.skillsCertificates, 'CMA、CPA');
  assert.equal(result.selfEvaluation, '拥有5年工作经验,愿意学习。');
  assert.equal(result.currentCompany, '甲公司');
  assert.equal(result.currentRole, '总账会计');
});

test('long work sections retain all jobs and cross-page content beyond 2000 characters', () => {
  const content = `甲公司 会计 2022-2024\n${'职责明细。'.repeat(600)}\f\n乙公司 会计 2020-2021\n最后一段职责`;
  const result = service.ruleExtract(`工作经历\n${content}\n资格证书\nCPA`);
  assert.equal(result.workExperience, content.replace(/\f/g, '\n'));
  assert.doesNotMatch(result.workExperience, /CPA/);
});

test('colon headings, indentation, CRLF and all section aliases are supported', () => {
  assert.equal(service.ruleExtract('  工作经历：负责会计核算\r\n  个人评价：认真负责').workExperience, '负责会计核算');
  assert.equal(service.ruleExtract('3年工作经验\n个人优势\n丰富工作经验，熟悉专业技能。').workExperience, '');
  assert.equal(service.ruleExtract('工作经验\n负责会计核算\n技能与证书\nCPA').workExperience, '负责会计核算');
});

test('resume-specific section names and aligned company-role-date rows are extracted', () => {
  const result = service.ruleExtract(`个人视窗
业务导向型人力资源负责人。
核心业绩：
提升组织效率和人才供给。
工作经验
示例教育集团 · 1000 人               HRD｜业务 HRBP 操盘                  2021.10 – 2026.08
统筹集团人力体系建设。
培训与认证
战略人力资源课程（2026.03）
教育背景
示例大学 硕士`);
  assert.match(result.workExperience, /示例教育集团[\s\S]*统筹集团人力体系建设/);
  assert.doesNotMatch(result.workExperience, /培训与认证|示例大学/);
  assert.match(result.selfEvaluation, /业务导向型人力资源负责人[\s\S]*提升组织效率和人才供给/);
  assert.equal(result.skillsCertificates, '战略人力资源课程(2026.03)');
  assert.equal(result.currentCompany, '示例教育集团');
  assert.equal(result.currentRole, 'HRD|业务 HRBP 操盘');
});

test('explicit source work section survives incorrect or incomplete AI output and AI failure', async context => {
  const original = llm.chat;
  context.after(() => { llm.chat = original; });
  llm.chat = async () => JSON.stringify({ workExperience: '求职意向：会计，资格证书：CPA' });
  assert.equal((await service.extract(raw)).workExperience, work);
  llm.chat = async () => { throw new Error('test unavailable'); };
  assert.equal((await service.extract(raw)).workExperience, work);
});

test('without an explicit section heading AI extraction remains available', async context => {
  const original = llm.chat;
  context.after(() => { llm.chat = original; });
  llm.chat = async () => JSON.stringify({ workExperience: work });
  assert.equal((await service.extract(work)).workExperience, work);
});
