import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { ResumeFileService } from '../dist/modules/resumes/resume-file.service.js';

const marker = 'abcdef1234567890AbCdEf-0123456789_ResumeTrace~~';

async function extractFixture(creator, keyword, producer = '') {
  const document = await PDFDocument.create();
  document.setCreator(creator);
  document.setKeywords([keyword]);
  if (producer) document.setProducer(producer);
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const heading of ['Work experience', 'Education', 'Certificates']) {
    const page = document.addPage([600, 840]);
    page.drawText(heading, { x: 30, y: 780, size: 16, font });
    page.drawText('CPA CMA Excel SAP Python C++ 2016-2021', { x: 30, y: 700, size: 12, font });
    page.drawText('user@example.test Certificate: AB1234567890', { x: 30, y: 670, size: 12, font });
    page.drawText(marker, { x: 25, y: 810, size: 8, font });
    page.drawText(marker, { x: 70, y: 200, size: 10, font, rotate: degrees(45) });
    page.drawText(marker, { x: 580, y: 200, size: 10, font, rotate: degrees(90) });
  }
  const directory = await mkdtemp(join(tmpdir(), 'resume-watermark-test-'));
  try {
    const file = join(directory, 'resume.pdf');
    await writeFile(file, await document.save());
    return await new ResumeFileService().pdfText(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('known resume watermark is excluded without losing body text across pages', async () => {
  const text = await extractFixture('BOSS直聘', marker);
  assert.doesNotMatch(text, /ResumeTrace|abcdef|AbCdEf/);
  for (const heading of ['Work experience', 'Education', 'Certificates']) assert.ok(text.includes(heading));
  assert.equal(text.match(/CPA CMA Excel SAP Python C\+\+ 2016-2021/g).length, 3);
  assert.equal(text.match(/user@example\.test Certificate: AB1234567890/g).length, 3);
  const lines = text.split(/\r?\n|\f/).map(line => line.trim()).filter(Boolean);
  assert.equal(lines.length, 9);
});

test('unverified PDF producers retain text even when it resembles a watermark', async () => {
  const text = await extractFixture('Other resume exporter', marker);
  assert.ok(text.includes(marker));
  assert.match(text, /CPA CMA Excel SAP Python C\+\+/);
});

test('WPS PDFs modified by iText suppress opaque diagonal resume watermarks', async () => {
  const text = await extractFixture('WPS 文字', marker, 'modified using iText 5.5');
  assert.doesNotMatch(text, /ResumeTrace|abcdef|AbCdEf/);
  for (const heading of ['Work experience', 'Education', 'Certificates']) assert.ok(text.includes(heading));
  assert.equal(text.match(/CPA CMA Excel SAP Python C\+\+ 2016-2021/g).length, 3);
  assert.equal(text.match(/user@example\.test Certificate: AB1234567890/g).length, 3);
});

test('ordinary resume metadata is not treated as a tracking watermark', async () => {
  const text = await extractFixture('BOSS直聘', 'CPA CMA SAP Python');
  assert.ok(text.includes(marker));
  assert.match(text, /Certificate: AB1234567890/);
});
