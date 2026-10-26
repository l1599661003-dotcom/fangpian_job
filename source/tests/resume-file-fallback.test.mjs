import test from 'node:test';
import assert from 'node:assert/strict';
import { ocr } from '../dist/platform/mcp.js';
import { ResumeFileService } from '../dist/modules/resumes/resume-file.service.js';

test('PDF extraction falls back to platform OCR when pdftotext is missing', async () => {
  const originalPath = process.env.PATH;
  const originalRecognize = ocr.recognize;
  const progress = [];
  try {
    process.env.PATH = '/path-without-system-programs';
    ocr.recognize = async (url) => {
      assert.equal(url, 'https://files.example.test/resume.pdf');
      return { text: '姓名：张静静\n求职意向：内容运营' };
    };
    const service = new ResumeFileService();
    const file = {
      originalname: '张静静.pdf',
      mimetype: 'application/pdf',
      size: 128,
      buffer: Buffer.from('%PDF-1.4 test fixture'),
    };
    const text = await service.extractText(file, 'https://files.example.test/resume.pdf', (message) => progress.push(message));
    assert.match(text, /张静静/);
    assert.deepEqual(progress, ['正在提取 PDF 文字', 'PDF 文本层不可用，正在进行 OCR']);
  } finally {
    process.env.PATH = originalPath;
    ocr.recognize = originalRecognize;
  }
});
