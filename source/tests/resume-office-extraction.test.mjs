import test from 'node:test';
import assert from 'node:assert/strict';
import { Document, Packer, Paragraph } from 'docx';
import { ResumeFileService } from '../dist/modules/resumes/resume-file.service.js';

test('DOCX resume text is read directly without waiting for Office-to-PDF conversion', async () => {
  const document = new Document({ sections: [{ children: [
    new Paragraph('姓名：李文博'),
    new Paragraph('求职意向：内容运营'),
    new Paragraph('工作经历：负责短视频账号策划与数据复盘。'),
  ] }] });
  const bytes = await Packer.toBuffer(document);
  const progress = [];
  const service = new ResumeFileService();
  const text = await service.extractText({
    originalname: '李文博-内容运营.docx',
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: bytes.length,
    buffer: bytes,
  }, 'https://files.example.test/resume.docx', (message) => progress.push(message));

  assert.match(text, /李文博/);
  assert.match(text, /内容运营/);
  assert.ok(progress.includes('正在读取 Word 文字内容'));
  assert.ok(!progress.includes('正在转换 Office 简历'));
});

