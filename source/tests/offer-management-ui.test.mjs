import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Offer management only exposes templates and history while preserving workflow creation', async () => {
  const [html, source] = await Promise.all([
    readFile(new URL('../source-app/方片招聘网站界面.html', import.meta.url), 'utf8'),
    readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8'),
  ]);
  const renderStart = source.indexOf('function renderOfferManagement()');
  const renderEnd = source.indexOf('async function ensureOfferCandidate', renderStart);
  const managementSource = source.slice(renderStart, renderEnd);

  assert.doesNotMatch(html, /data-action="offer-create"/);
  assert.match(html, /data-action="offer-template-manager"/);
  assert.match(managementSource, /Offer历史记录/);
  assert.doesNotMatch(managementSource, /data-rf-new-offer/);
  assert.doesNotMatch(managementSource, /新建 Offer/);
  assert.match(source, /openOfferForm\(candidateId, \{ interviewId, positionId:/);
});

test('Offer template management uses a visual form builder and supports creating multiple templates', async () => {
  const source = await readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
  const editorStart = source.indexOf('function offerTemplateFieldCatalog');
  const editorEnd = source.indexOf('function offerActionButtons', editorStart);
  const editorSource = source.slice(editorStart, editorEnd);

  assert.match(editorSource, /data-template-create/);
  assert.match(editorSource, /data-template-field-row/);
  assert.match(editorSource, /data-template-preview/);
  assert.match(editorSource, /method:isNew\?'POST':'PATCH'/);
  assert.doesNotMatch(editorSource, /可填写字段（每行一个）/);
  assert.doesNotMatch(editorSource, /dedupeOfferTemplates/);
});

test('manual Offer email dialog closes after successful delivery', async () => {
  const source = await readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
  const start = source.indexOf('function openOfferEmailForm');
  const end = source.indexOf('function openOfferEditForm', start);
  assert.ok(start >= 0 && end > start);
  const sendSource = source.slice(start, end);
  assert.match(sendSource, /closeTalentDialog\(false\)/);
  assert.doesNotMatch(sendSource, /正在发送答复链接….*await openOfferManagement\(\);\}\}catch/s);
});

test('Offer adjustment reopens the full Offer form for PATCH regeneration without negotiation fields', async () => {
  const source = await readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function openOfferEditForm');
  const next = source.slice(start + 40).search(/\n  (?:async )?function /);
  const editSource = source.slice(start, next < 0 ? undefined : start + 40 + next);
  const saveStart = source.indexOf('async function saveOffer()');
  const saveSource = source.slice(saveStart, source.indexOf('function renderOfferPreview', saveStart));

  assert.ok(start > 0);
  assert.match(source, /data-offer-action="edit"/);
  assert.doesNotMatch(source, /data-offer-action="negotiate"/);
  assert.doesNotMatch(source, /openOfferNegotiation|rf-negotiation-|谈薪结果|候选人诉求/);
  assert.match(editSource, /data-offer-id="\$\{escapeHtml\(offer\.id\)\}"/);
  assert.match(editSource, /rf-offer-candidate" disabled/);
  assert.match(editSource, /<select id="rf-offer-role" required>/);
  assert.match(editSource, /id="rf-offer-department" value=/);
  assert.match(editSource, /重新生成 PDF 并预览/);
  assert.doesNotMatch(editSource, /bindOfferEmailOption/);
  assert.doesNotMatch(saveSource, /editMode/);
  assert.match(saveSource, /if \(!position\) throw new Error\(/);
  assert.match(source, /method: 'PATCH'/);
});

test('Offer history does not expose duplicate email sends after delivery', async () => {
  const source = await readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
  const actionsStart = source.indexOf('function offerActionButtons');
  const actionsEnd = source.indexOf('function openOfferForm', actionsStart);
  const actionSource = source.slice(actionsStart, actionsEnd);
  const createStart = source.indexOf('async function saveOffer()');
  const createEnd = source.indexOf('function renderOfferPreview', createStart);
  const createSource = source.slice(createStart, createEnd);
  assert.match(actionSource, /\['已发送','候选人已答复'\]\.includes\(item\.sendStatus\)/);
  assert.match(actionSource, /重试发送/);
  assert.doesNotMatch(createSource, /send-email/);
  assert.match(source, /method: 'PATCH'/);
  assert.match(source, /api\/offers\/\$\{encodeURIComponent\(existingOfferId\)\}/);
  assert.match(createSource, /showOfferDraftPreview/);
  assert.match(source, /OFFER REVIEW/);
  assert.match(source, /rf-offer-preview-ack/);
  assert.match(source, /确认并发送 Offer/);
});

test('talent offer dialog omits status summary and uses text salary inputs', async () => {
  const source = await readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
  const dialogStart = source.indexOf('function renderTalentOfferDialog');
  const dialogEnd = source.indexOf('async function saveTalentOffer', dialogStart);
  const dialogSource = source.slice(dialogStart, dialogEnd);
  const helperStart = source.indexOf('function offerOptionalSalaryField');
  const helperEnd = source.indexOf('function readOfferAmount', helperStart);
  const helperSource = source.slice(helperStart, helperEnd);

  assert.doesNotMatch(dialogSource, /rf-talent-offer-summary/);
  assert.doesNotMatch(dialogSource, /当前 Offer/);
  assert.match(helperSource, /type="text"/);
  assert.doesNotMatch(helperSource, /type="number"/);
  assert.match(helperSource, /rf-offer-commission.*其他/);
  assert.match(source, /showTalentOfferDraftPreview/);
  const talentSaveStart = source.indexOf('async function saveTalentOffer');
  const talentSaveEnd = source.indexOf('function renderOfferPage', talentSaveStart);
  const talentSaveSource = source.slice(talentSaveStart, talentSaveEnd);
  assert.doesNotMatch(talentSaveSource, /request\('api\/offers'/);
  assert.doesNotMatch(talentSaveSource, /send-email/);
});

test('Offer preview renders the generated PDF and supports edit-regeneration', async () => {
  const source = await readFile(new URL('../source-app/resumeflow.js', import.meta.url), 'utf8');
  const previewStart = source.indexOf('async function submitOfferForPreview');
  const previewEnd = source.indexOf('async function saveOffer()', previewStart);
  const previewSource = source.slice(previewStart, previewEnd);

  assert.match(previewSource, /method: 'PATCH'/);
  assert.match(previewSource, /renderOfferPreview\(\{ offer: created/);
  assert.doesNotMatch(previewSource, /rf-offer-document-paper/);
  assert.doesNotMatch(previewSource, /尚未生成 PDF/);
  assert.match(source, /data-offer-preview-edit/);
  assert.match(source, /<iframe title="录用通知书 PDF 预览"/);
});
