import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import { ResumeFileService } from '../dist/modules/resumes/resume-file.service.js';
import { ResumesService } from '../dist/modules/resumes/resumes.service.js';
import { dateTokens, meaningfulResumeText, resumeQualityWarnings, readQualityWarnings } from '../dist/modules/resumes/resume-quality.js';
import { ocr } from '../dist/platform/mcp.js';
import { storage } from '../dist/platform/storage.js';
import { llm } from '../dist/platform/llm.js';
import { teable } from '../dist/platform/teable.js';

const noop = () => {};
const makeFile = (buffer, name = 'resume.txt') => ({ originalname: name, buffer, size: buffer.length, mimetype: 'application/octet-stream' });
async function withPdf(pages, action) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = document.addPage([600, 840]);
    if (text) page.drawText(text, { x: 40, y: 740, size: 12, font });
  }
  const directory = await mkdtemp(join(tmpdir(), 'resume-quality-'));
  const path = join(directory, 'resume.pdf');
  const bytes = Buffer.from(await document.save());
  await writeFile(path, bytes);
  const service = new ResumeFileService();
  service.isBlankPdfPage = async () => false;
  try { await action(service, path, bytes); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('UTF8 and UTF16 TXT files retain Chinese instead of silently accepting replacement characters', async () => {
  const service = new ResumeFileService();
  const source = '姓名：测试候选人\n工作经历：负责产品设计';
  for (const bytes of [Buffer.from(source), Buffer.concat([Buffer.from([255, 254]), Buffer.from(source, 'utf16le')])]) {
    assert.equal(await service.extractText(makeFile(bytes), '', noop), source);
  }
  const warning = [];
  assert.equal(await service.extractText(makeFile(Buffer.from('d0d5c3fba3bad5c5c8fd0ab9a4d7f7beadc0faa3bacec4b0b8', 'hex')), '', noop, value => warning.push(value)), '姓名：张三\n工作经历：文案');
  assert.equal(warning.length, 1);
});

test('file validation checks actual byte length and PDF signature', () => {
  const service = new ResumeFileService();
  assert.throws(() => service.validate({ ...makeFile(Buffer.alloc(10 * 1024 * 1024 + 1)), size: 1 }), /10MB/);
  assert.throws(() => service.validate(makeFile(Buffer.from('<html>login</html>'), 'resume.pdf')), /有效的 PDF/);
  assert.throws(() => service.validate(makeFile(Buffer.alloc(0))), /为空/);
});

test('BOSS PDF watermark fragments are removed without discarding the text layer', async () => {
  const watermark = 'd060abc84cb003a21H1-3927EFpUwYW4UvieWOOrl_fYMxFn';
  const document = await PDFDocument.create();
  document.setCreator('BOSS直聘');
  document.setProducer('直聘简历; modified using iText® 5.5.13');
  document.setKeywords([watermark]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([600, 840]);
  page.drawText('Wu Qingcheng work experience game testing', { x: 40, y: 740, size: 12, font });
  page.drawText(watermark, { x: 120, y: 120, size: 24, font, rotate: degrees(45) });
  const directory = await mkdtemp(join(tmpdir(), 'resume-watermark-'));
  const path = join(directory, 'resume.pdf');
  await writeFile(path, Buffer.from(await document.save()));
  try {
    const text = await new ResumeFileService().pdfText(path);
    assert.match(text, /Wu Qingcheng/);
    assert.match(text, /game testing/);
    assert.equal(text.includes(watermark), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('BOSS PDFs with short metadata IDs still remove diagonal watermark fragments', async () => {
  const watermark = 'f916c1fca470c6af1H1_0964EFRRwYy8VP-YWOOjlvTQNBRk2g~~';
  const document = await PDFDocument.create();
  document.setCreator('BOSS直聘');
  document.setProducer('直聘简历; modified using iText® 5.5.13 ©2000-2018 iText Group NV (AGPL-version)');
  document.setKeywords(['cid_ tid_21c04e1b9f838f2a1HQ~']);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([600, 840]);
  page.drawText('Wang Zhifa finance audit experience', { x: 40, y: 740, size: 12, font });
  page.drawText(watermark, { x: 120, y: 120, size: 24, font, rotate: degrees(45) });
  const directory = await mkdtemp(join(tmpdir(), 'resume-boss-short-meta-'));
  const path = join(directory, 'resume.pdf');
  await writeFile(path, Buffer.from(await document.save()));
  try {
    const text = await new ResumeFileService().pdfText(path);
    assert.match(text, /Wang Zhifa/);
    assert.match(text, /finance audit experience/);
    assert.equal(text.includes(watermark), false);
    assert.doesNotMatch(text, /(^|\n)\s*(?:2g~|Rk|jlv)\s*(\n|$)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('English resumes are valid text and readable undated pages do not require OCR', async () => {
  assert.equal(meaningfulResumeText('John Smith\nWork Experience\nSoftware Engineer'), true);
  await withPdf(['John Smith\nSkills: TypeScript and Node.js'], async (service, path) => {
    service.ocrPdfPage = async () => { throw new Error('unexpected OCR'); };
    assert.match(await service.checkedPdfText(path, '', noop, noop), /TypeScript/);
  });
});

test('date-bearing pages are verified independently and conflicts are never silently rewritten', async () => {
  await withPdf(['Work Experience: Acme 2021.09-2021.12', 'Education: University 2016.01-2020.06'], async (service, path) => {
    const calls = [], warnings = [];
    service.ocrPdfPage = async (_path, page) => { calls.push(page); return page === 1 ? 'Work Experience: Acme 2019.09-2021.12' : 'Education: University 2016/01-2020/06'; };
    const text = await service.checkedPdfText(path, '', noop, value => warnings.push(value));
    assert.deepEqual(calls, [1, 2]);
    assert.match(text, /2021.09/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /第1页.*不一致/);
  });
});

test('mixed PDFs retain text pages and OCR every missing page without shifting page numbers', async () => {
  await withPdf(['', 'Education University', ''], async (service, path) => {
    const calls = [];
    service.ocrPdfPage = async (_path, page) => { calls.push(page); return `工作经历：第${page}页公司，负责财务核算。`; };
    const text = await service.checkedPdfText(path, '', noop, noop);
    assert.deepEqual(calls, [1, 3]);
    assert.match(text, /第1页公司/);
    assert.match(text, /Education University/);
    assert.match(text, /第3页公司/);
  });
});

test('verified blank PDF pages are skipped, but an entirely blank document is rejected', async () => {
  await withPdf(['Education University', ''], async (service, path) => {
    delete service.isBlankPdfPage;
    service.ocrPdfPage = async () => { assert.fail('blank pages must not require OCR'); };
    const warnings = [];
    assert.match(await service.checkedPdfText(path, '', noop, value => warnings.push(value)), /Education/);
    assert.match(warnings[0], /纯空白页/);
  });
  await withPdf([''], async (service, path) => {
    delete service.isBlankPdfPage;
    await assert.rejects(service.checkedPdfText(path, '', noop, noop), /空白文件/);
  });
});

test('failure to read a scanned page stops the whole extraction rather than saving a partial resume', async () => {
  await withPdf(['Skills: software engineering', ''], async (service, path) => {
    service.ocrPdfPage = async () => { throw new Error('provider unavailable'); };
    await assert.rejects(service.checkedPdfText(path, '', noop, noop), /第2页识别失败.*未保存不完整/);
  });
});

test('a page with both a text header and scanned body uses the complete visual text', async () => {
  await withPdf(['Work Experience'], async (service, path) => {
    service.pdfImagePages = async () => new Set([1]);
    service.ocrPdfPage = async () => 'Work Experience\nAcme Engineer 2020.01-2024.05\nBuilt reliable systems and led the engineering team.';
    const warnings = [];
    assert.match(await service.checkedPdfText(path, '', noop, value => warnings.push(value)), /Acme Engineer/);
    assert.match(warnings[0], /文本层不完整/);
  });
});

test('optional visual check failure keeps readable text with an explicit warning', async () => {
  await withPdf(['Work Experience Acme 2022.03-2024.05'], async (service, path) => {
    const warnings = [];
    service.ocrPdfPage = async () => { throw new Error('unavailable'); };
    assert.match(await service.checkedPdfText(path, '', noop, value => warnings.push(value)), /Acme/);
    assert.match(warnings[0], /画面校验失败/);
  });
});

test('PDF visual verification uploads rendered page images, not a PDF text layer', async context => {
  const originalUpload = storage.upload, originalRecognize = ocr.recognize;
  context.after(() => { storage.upload = originalUpload; ocr.recognize = originalRecognize; });
  let uploads = 0;
  storage.upload = async (_path, mime, bytes) => {
    uploads++;
    assert.equal(mime, 'image/png');
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    return { cdnUrl: 'https://example.test/page.png' };
  };
  ocr.recognize = async url => { assert.equal(url, 'https://example.test/page.png'); return { content: '工作经历：测试公司 2022.03-2024.05' }; };
  await withPdf(['Work Experience 2022.03-2024.05'], async (service, path, bytes) => {
    assert.match(await service.extractText(makeFile(bytes, 'resume.pdf'), '', noop), /Work Experience/);
  });
  assert.equal(uploads, 1);
});

test('OCR envelopes and errors never become object text inside a resume', async context => {
  const original = ocr.recognize;
  context.after(() => { ocr.recognize = original; });
  const service = new ResumeFileService();
  ocr.recognize = async () => ({ content: [{ type: 'text', text: JSON.stringify({ content: '姓名：测试候选人\n工作经历：负责产品运营' }) }] });
  assert.match(await service.ocrText(''), /测试候选人/);
  ocr.recognize = async () => ({ isError: true, content: [{ type: 'text', text: '失败' }] });
  await assert.rejects(service.ocrText(''), /识别失败/);
  ocr.recognize = async () => ({ content: { text: 'broken' } });
  await assert.rejects(service.ocrText(''), /可靠的文字/);
});

test('OCR-spaced, numbered, repeated and English section headings retain complete sections', () => {
  const service = new ResumesService();
  const parsed = service.ruleExtract('7年工作经验 | 求职意向：会计 | 期望薪资：6K\n一、【工 作 经 历】\n甲公司 会计 2020.01-2021.01\n工作经历\n乙公司 会计 2022.01-至今\nEducation\nExample University\nSkills\nExcel');
  assert.match(parsed.workExperience, /甲公司/);
  assert.match(parsed.workExperience, /乙公司/);
  assert.doesNotMatch(parsed.workExperience, /University|薪资/);
  assert.equal(parsed.educationBackground, 'Example University');
  assert.equal(parsed.yearsOfExperience, '7年');
  assert.equal(parsed.jobIntention, '会计');
  assert.equal(parsed.currentCompany, '乙公司');
});

test('education rows are never treated as current employment without a work heading', () => {
  assert.equal(new ResumesService().ruleExtract('教育经历\n测试学院 会计 2018.01-2022.01').currentCompany, '');
});

test('AI invented contacts are discarded in favor of source evidence', async context => {
  const original = llm.chat;
  context.after(() => { llm.chat = original; });
  llm.chat = async () => JSON.stringify({ phone: '13911112222', email: 'invented@example.test' });
  const parsed = await new ResumesService().extract('姓名：张三\n电话：13800138000\n工作经历：负责财务核算');
  assert.equal(parsed.phone, '13800138000');
  assert.equal(parsed.email, '');
  assert.match(parsed.qualityWarnings.join(''), /联系方式与原文不一致/);
});

test('AI invented employment dates and companies are not accepted without source evidence', async context => {
  const original = llm.chat;
  context.after(() => { llm.chat = original; });
  llm.chat = async () => JSON.stringify({ workExperience: '虚构公司 会计 2022.01-2024.06', currentCompany: '虚构公司' });
  const parsed = await new ResumesService().extract('在财务部门从事财务核算工作。');
  assert.equal(parsed.workExperience, '');
  assert.equal(parsed.currentCompany, '');
  assert.match(parsed.qualityWarnings.join(''), /原文没有的日期/);
});

test('age and gender require explicit source evidence rather than AI guesses', async context => {
  const original = llm.chat;
  context.after(() => { llm.chat = original; });
  llm.chat = async () => JSON.stringify({ age: 28, gender: '男' });
  const parsed = await new ResumesService().extract('姓名：张三\n工作经历：负责财务核算');
  assert.equal(parsed.age, null);
  assert.equal(parsed.gender, '');
  assert.match(parsed.qualityWarnings.join(''), /缺失信息不推测/);
});

test('labeled spaced or dashed phone numbers are read without completing masked numbers', () => {
  const service = new ResumesService();
  assert.equal(service.extractContacts('电话：138 0013 8000').phone, '13800138000');
  assert.equal(service.extractContacts('手机：138-0013-8000').phone, '13800138000');
  assert.equal(service.extractContacts('手机：138****8000').phone, '');
});

test('quality warnings preserve uncertainty instead of manufacturing missing data', () => {
  const warnings = resumeQualityWarnings({ name: '', phone: '', email: '', workExperience: '测试公司 2024.05-2022.01', educationBackground: '' }, '7年工作经验\n拥有5年工作经验\n13800138000 13900139000');
  assert.match(warnings.join(''), /姓名.*联系方式|姓名/s);
  assert.match(warnings.join(''), /多个手机号/);
  assert.match(warnings.join(''), /工作年限表述不一致/);
  assert.match(warnings.join(''), /倒置/);
  assert.deepEqual(readQualityWarnings('{bad'), []);
  assert.deepEqual(readQualityWarnings('["需复核",null,"需复核"]'), ['需复核']);
  assert.deepEqual(dateTokens('2022年03月 2022/3 2022.03 2023.13'), ['2022-03']);
});

test('previously reviewed fields including cleared values are protected during extraction updates', () => {
  const service = new ResumesService();
  const fields = service.preserveReviewedFields({ fields: { 人工复核状态: '已修正', 工作经历: '原件核实后的经历', 电话: '' } }, { 工作经历: 'AI改写', 电话: '13800138000', OCR原文: '新原文' });
  assert.equal(fields.工作经历, '原件核实后的经历');
  assert.equal(fields.电话, '');
  assert.equal(fields.OCR原文, '新原文');
});

test('cancelled extraction cannot proceed into database writes or ingestion after OCR returns', async () => {
  const controller = new AbortController();
  const service = new ResumesService({ extractText: async () => { controller.abort(); return '姓名：测试候选人'; } });
  service.upsertWithLock = async () => { assert.fail('must not write'); };
  await assert.rejects(service.processPreparedFile({}, '', noop, '简历上传', controller.signal), /abort/i);
});

test('download rejects oversized headers and streamed bodies before ingestion', async context => {
  const original = global.fetch;
  context.after(() => { global.fetch = original; });
  const service = new ResumesService(new ResumeFileService());
  global.fetch = async () => new Response('body', { headers: { 'content-length': String(11 * 1024 * 1024) } });
  await assert.rejects(service.downloadFile('https://example.test/a.txt', 'a.txt'), /10MB/);
  global.fetch = async () => new Response(Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(service.downloadFile('https://example.test/a.txt', 'a.txt'), /10MB/);
  await assert.rejects(service.downloadFile('http://example.test/a.txt', 'a.txt'), /HTTPS/);
});

test('reparse updates the original record, preserves corrections and never reruns ingestion', async context => {
  const original = { listAllRecords: teable.listAllRecords, listFields: teable.listFields, updateRecord: teable.updateRecord };
  context.after(() => Object.assign(teable, original));
  const row = { id: 'resume-one', fields: { 解析记录ID: 'resume-one', 源文件地址: 'https://example.test/a.txt', 源文件名: 'a.txt', 候选人ID: 'candidate-one', 人工复核状态: '已修正', 工作经历: '人工核实经历' } };
  const writes = [];
  teable.listAllRecords = async () => [row];
  teable.listFields = async () => [];
  teable.updateRecord = async (_table, id, fields) => { writes.push(id); return { ...row, fields: { ...row.fields, ...fields } }; };
  const service = new ResumesService({ extractText: async () => '姓名：张三\n工作经历：新文字\n教育经历：大学本科' }, {}, { ingestResume: async () => assert.fail('must not ingest') }, { requireTableId: name => name });
  service.downloadFile = async () => ({});
  service.extract = async text => service.ruleExtract(text);
  service.syncReviewedResumeToCandidate = async () => {};
  service.resumeAudit = async () => {};
  const result = await service.reparse('resume-one', noop);
  assert.deepEqual(writes, ['resume-one']);
  assert.equal(result.id, 'resume-one');
  assert.equal(result.workExperience, '人工核实经历');
});
