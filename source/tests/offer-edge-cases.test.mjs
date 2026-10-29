import test from 'node:test'
import assert from 'node:assert/strict'
import { teable } from '../dist/platform/teable.js'
import { RECRUITMENT_TABLES } from '../dist/modules/database/database.schema.js'
import { OffersService } from '../dist/modules/offers/offers.service.js'
import { MessagesService } from '../dist/modules/messages/messages.service.js'

function installMemory() {
  const records = new Map(RECRUITMENT_TABLES.map((table) => [table.name, []]))
  const tableFields = new Map(RECRUITMENT_TABLES.map((table) => [table.name, new Set(table.fields.map((field) => field.name))]))
  const originals = {}, methods = ['listRecords', 'listAllRecords', 'listByField', 'findOneByField', 'getRecord', 'createRecord', 'updateRecord', 'deleteRecord']
  for (const method of methods) originals[method] = teable[method]
  let sequence = 0
  teable.listRecords = async (tableId, options = {}) => {
    const rows = records.get(tableId) || []
    const skip = Number(options.skip || 0), take = Number(options.take || rows.length || 1)
    return rows.slice(skip, skip + take)
  }
  teable.listAllRecords = async (tableId) => [...(records.get(tableId) || [])]
  teable.listByField = async (tableId, fieldName, value, take = 200) => (records.get(tableId) || []).filter((row) => String(row.fields[fieldName] ?? '') === String(value ?? '')).slice(0, take)
  teable.findOneByField = async (tableId, fieldName, value) => (records.get(tableId) || []).find((row) => String(row.fields[fieldName] ?? '') === String(value ?? ''))
  teable.getRecord = async (tableId, recordId) => (records.get(tableId) || []).find((row) => row.id === recordId)
  teable.createRecord = async (tableId, fields) => {
    const allowedFields = tableFields.get(tableId)
    const unsupportedFields = allowedFields ? Object.keys(fields).filter((field) => !allowedFields.has(field)) : []
    if (unsupportedFields.length) throw new Error(`table ${tableId} unsupported fields: ${unsupportedFields.join(', ')}`)
    const row = { id: `${tableId}_${++sequence}`, fields: { ...fields }, createdTime: new Date().toISOString() }
    records.get(tableId).push(row)
    return row
  }
  teable.updateRecord = async (tableId, recordId, fields) => {
    const row = records.get(tableId).find((item) => item.id === recordId)
    if (!row) throw new Error(`record missing ${tableId}/${recordId}`)
    row.fields = { ...row.fields, ...fields }
    return row
  }
  teable.deleteRecord = async () => {}
  return { records, restore: () => Object.assign(teable, originals) }
}

function createService() {
  const database = { requireTableId: (name) => name }
  return new OffersService(database, new MessagesService(database))
}

test('Offer creation uses the canonical candidate and can create a selected position application', async () => {
  const memory = installMemory()
  try {
    const create = teable.createRecord
    const today = new Date().toISOString().slice(0, 10)
    const candidate = await create('recruitment_candidates', { 候选人ID: 'tal_canonical', 姓名: '候选人', 邮箱: 'candidate@example.test' })
    await create('recruitment_applications', { 应聘记录ID: 'app_wrong', 候选人ID: 'tal_canonical', 职位ID: 'pos_wrong', 当前状态: '进行中', 更新时间: '2026-10-18T00:00:00.000Z' })
    await create('recruitment_applications', { 应聘记录ID: 'app_selected', 候选人ID: 'tal_canonical', 职位ID: 'pos_selected', 当前状态: '进行中', 更新时间: '2026-10-01T00:00:00.000Z' })

    const offers = createService()
    offers.generateFile = async offerId => ({ offerId, fileName: 'offer.pdf', fileUrl: 'https://files.example.test/offer.pdf', status: '待发送', templateType: '社招' })
    const created = await offers.create({
      candidateId: candidate.id, positionId: 'pos_selected', role: '商务提报', department: '商务', location: '烟台',
      baseSalary: 3600, startDate: today, reportingTo: '张总', validFrom: today, validTo: today, probationMonths: '6个月，试用期薪资100%', templateId: '社招', operator: '张晓霞',
    })
    const row = memory.records.get('recruitment_offers').find((item) => item.fields['OfferID'] === created.offerId)
    assert.equal(row.fields['候选人ID'], 'tal_canonical')
    assert.equal(row.fields['应聘记录ID'], 'app_selected')
    assert.equal(row.fields['职位ID'], 'pos_selected')
    const createdForSelected = await offers.create({ candidateId: candidate.id, positionId: 'pos_missing', role: '岗位', baseSalary: 1, startDate: today, reportingTo: '张总', validFrom: today, validTo: today, templateId: '社招' })
    const selectedOffer = memory.records.get('recruitment_offers').find((item) => item.fields['OfferID'] === createdForSelected.offerId)
    const createdApplication = memory.records.get('recruitment_applications').find((item) => item.fields['职位ID'] === 'pos_missing' && item.fields['候选人ID'] === 'tal_canonical')
    assert.equal(selectedOffer.fields['应聘记录ID'], createdApplication.fields['应聘记录ID'])
    assert.equal(createdApplication.fields['当前阶段'], '待Offer决策')
    assert.equal(createdApplication.fields['当前状态'], '进行中')
    assert.equal(createdApplication.fields['来源类型'], 'HR创建Offer')
    await assert.rejects(() => offers.create({ candidateId: candidate.id, role: '岗位', baseSalary: 1, startDate: 'not-a-date', templateId: '社招' }), /入职日期格式无效/)
    await assert.rejects(() => offers.create({ candidateId: candidate.id, role: '岗位', baseSalary: 1, startDate: '2026-02-31', templateId: '社招' }), /入职日期格式无效/)
    await assert.rejects(() => offers.create({ candidateId: candidate.id, role: '岗位', baseSalary: 1, startDate: today, reportingTo: '张总', validFrom: today, validTo: today, templateId: 'missing_template' }), /Offer模板不存在/)
    await assert.rejects(() => offers.create({ candidateId: candidate.id, role: '岗位', baseSalary: 1, startDate: today, templateId: '社招', validFrom: today, validTo: today }), /汇报上级不能为空/)
    await assert.rejects(() => offers.create({ candidateId: candidate.id, role: '岗位', baseSalary: 1, startDate: today, reportingTo: '张总', validFrom: today, validTo: '2000-01-01', templateId: '社招' }), /本通知书有效期不完整/)
  } finally {
    memory.restore()
  }
})

test('Offer creation links the latest blank application to any selected position', async () => {
  const memory = installMemory()
  try {
    const today = new Date().toISOString().slice(0, 10)
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_blank_multi', 姓名: '多条空岗位候选人' })
    await teable.createRecord('recruitment_applications', { 应聘记录ID: 'app_blank_old', 候选人ID: 'tal_blank_multi', 当前状态: '进行中', 更新时间: '2026-10-01T00:00:00.000Z' })
    await teable.createRecord('recruitment_applications', { 应聘记录ID: 'app_blank_new', 候选人ID: 'tal_blank_multi', 当前状态: '进行中', 更新时间: '2026-10-18T00:00:00.000Z' })
    const offers = createService()
    offers.generateFile = async offerId => ({ offerId, fileName: 'offer.pdf', fileUrl: 'https://files.example.test/offer.pdf', status: '待发送', templateType: '社招' })

    const created = await offers.create({
      candidateId: 'tal_blank_multi', positionId: 'pos_any', role: '任意岗位',
      baseSalary: 5000, startDate: today, reportingTo: '张总', validFrom: today, validTo: today, templateId: '社招', operator: '王HR',
    })
    const offer = memory.records.get('recruitment_offers').find((item) => item.fields['OfferID'] === created.offerId)
    assert.equal(offer.fields['应聘记录ID'], 'app_blank_new')
    assert.equal(memory.records.get('recruitment_applications').find((item) => item.fields['应聘记录ID'] === 'app_blank_new').fields['职位ID'], 'pos_any')
  } finally {
    memory.restore()
  }
})

test('Offer creation stores the chosen candidate honorific and rejects other values', async () => {
  const memory = installMemory()
  try {
    const today = new Date().toISOString().slice(0, 10)
    const candidate = await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_honorific', 姓名: '王晨', 性别: '男' })
    const offers = createService()
    offers.generateFile = async offerId => ({ offerId, fileName: 'offer.pdf', fileUrl: 'https://files.example.test/offer.pdf', status: '待发送', templateType: '社招' })
    const created = await offers.create({
      candidateId: candidate.id, role: '商务提报', baseSalary: 3600, startDate: today, reportingTo: '张总', validFrom: today, validTo: today,
      candidateHonorific: '女士', templateId: '社招', operator: '王HR',
    })
    const row = memory.records.get('recruitment_offers').find((item) => item.fields['OfferID'] === created.offerId)
    assert.equal(row.fields['称谓'], '女士')
    await assert.rejects(() => offers.create({
      candidateId: candidate.id, role: '商务提报', baseSalary: 3600, startDate: today, reportingTo: '张总', validFrom: today, validTo: today,
      candidateHonorific: '老师', templateId: '社招', operator: '王HR',
    }), /候选人称谓只能选择先生或女士/)
  } finally {
    memory.restore()
  }
})

test('sending-preview edits reuse one Offer and regenerate its PDF', async () => {
  const memory = installMemory()
  try {
    const today = new Date().toISOString().slice(0, 10)
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_preview_edit', 姓名: '候选人' })
    await teable.createRecord('recruitment_offers', {
      OfferID: 'offer_preview_edit', 候选人ID: 'tal_preview_edit', 职位ID: 'pos_preview_edit', 审批状态: '已通过',
      Offer编号: 'FP-EDIT-001', 岗位名称: '商务提报', 当前版本: 1, 发送状态: '待人工发送',
    })
    const offers = createService()
    let generated = 0
    offers.generateFile = async offerId => {
      generated += 1
      return { offerId, fileName: `offer-v${generated}.pdf`, fileUrl: `https://files.example.test/offer-v${generated}.pdf`, status: '待发送' }
    }

    const updated = await offers.update('offer_preview_edit', {
      candidateId: 'tal_preview_edit', positionId: 'pos_preview_edit', role: '运营负责人', department: '运营部',
      location: '烟台', baseSalary: 13000, performanceSalary: 1500, commission: 800, startDate: today, reportingTo: '张总', validFrom: today, validTo: today,
      probationMonths: '3个月，试用期薪资100%', templateId: '社招', operator: '王HR',
    })

    assert.equal(updated.offerId, 'offer_preview_edit')
    assert.equal(updated.version, 2)
    assert.equal(updated.fileUrl, 'https://files.example.test/offer-v1.pdf')
    const row = memory.records.get('recruitment_offers')[0]
    assert.equal(row.fields['岗位名称'], '运营负责人')
    assert.equal(row.fields['当前版本'], 2)
    assert.equal(row.fields['发送状态'], '待人工发送')
    assert.deepEqual(JSON.parse(row.fields['薪资结构JSON']), { 底薪: 13000, 绩效: '1500', 其他: '800' })
    const version = memory.records.get('recruitment_offer_versions').find(item => item.fields['OfferID'] === 'offer_preview_edit')
    assert.equal(version.fields['变更类型'], '发送前修改')
    const audit = memory.records.get('recruitment_audit_logs').find(item => item.fields['操作类型'] === '发送前修改Offer')
    assert.equal(audit.fields['操作人'], '王HR')
    await assert.rejects(() => offers.update('offer_preview_edit', {
      candidateId: 'tal_preview_edit', positionId: 'pos_another', role: '运营负责人', baseSalary: 13000, startDate: today, reportingTo: '张总', validFrom: today, validTo: today, templateId: '社招',
    }), /候选人未应聘所选岗位，无法更换岗位/)
    await teable.createRecord('recruitment_applications', { 应聘记录ID: 'app_position_change', 候选人ID: 'tal_preview_edit', 职位ID: 'pos_another', 需求ID: 'demand_another', 当前状态: '进行中', 更新时间: today })
    const moved = await offers.update('offer_preview_edit', {
      candidateId: 'tal_preview_edit', positionId: 'pos_another', role: '运营经理', department: '运营部', baseSalary: 13000, startDate: today, reportingTo: '张总', validFrom: today, validTo: today, templateId: '社招', operator: '王HR',
    })
    assert.equal(moved.version, 3)
    const movedRow = memory.records.get('recruitment_offers')[0]
    assert.equal(movedRow.fields['职位ID'], 'pos_another')
    assert.equal(movedRow.fields['应聘记录ID'], 'app_position_change')
    assert.equal(movedRow.fields['需求ID'], 'demand_another')
    assert.equal(movedRow.fields['岗位名称'], '运营经理')
    await assert.rejects(() => offers.update('offer_preview_edit', {
      candidateId: 'tal_another', positionId: 'pos_preview_edit', role: '运营负责人', baseSalary: 13000, startDate: today, reportingTo: '张总', validFrom: today, validTo: today, templateId: '社招',
    }), /已创建的Offer不能更换候选人/)
  } finally {
    memory.restore()
  }
})

test('Offer list exposes the stored fields needed to reopen an Offer for correction', async () => {
  const memory = installMemory()
  const originalListAllByAnyField = teable.listAllByAnyField
  try {
    await teable.createRecord('recruitment_offers', {
      OfferID: 'offer_edit_fields', 候选人ID: 'tal_edit_fields', 职位ID: 'pos_edit_fields', 岗位名称: '商务提报', 部门: '商务部',
      工作地点: '烟台', 入职日期: '2026-11-02', 汇报上级: '张总', 有效期开始: '2026-10-20', 有效期结束: '2026-11-02',
      称谓: '女士', 试用期月数: '3个月，试用期薪资100%', 模板ID: '社招', 薪资结构JSON: JSON.stringify({ 底薪: 13000, 绩效: 1500, 其他: 800 }),
      审批状态: '已通过', Offer状态: '待发送', 当前版本: 1, 发送状态: '待人工发送', Offer文件地址: 'https://files.example.test/offer.pdf',
    })
    teable.listAllByAnyField = async () => []
    const { offers: [offer] } = await createService().list({})
    assert.equal(offer.positionId, 'pos_edit_fields')
    assert.equal(offer.templateId, '社招')
    assert.equal(offer.candidateHonorific, '女士')
    assert.equal(offer.location, '烟台')
    assert.equal(offer.probationMonths, '3个月，试用期薪资100%')
    assert.equal(offer.reportingTo, '张总')
    assert.equal(offer.validFrom, '2026-10-20')
    assert.equal(offer.validTo, '2026-11-02')
    assert.equal(offer.performanceSalary, '1500')
    assert.equal(offer.commission, '800')
  } finally {
    teable.listAllByAnyField = originalListAllByAnyField
    memory.restore()
  }
})

test('Offer edits require an approved or revision-pending Offer and emails never use a stale PDF', async () => {
  const memory = installMemory()
  try {
    const today = new Date().toISOString().slice(0, 10)
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_edit_guard', 姓名: '候选人', 邮箱: 'guard@example.test' })
    await teable.createRecord('recruitment_offers', { OfferID: 'offer_draft_guard', 候选人ID: 'tal_edit_guard', 审批状态: '部门审批', Offer状态: '审批中', 当前版本: 1 })
    await teable.createRecord('recruitment_offers', { OfferID: 'offer_revision_guard', 候选人ID: 'tal_edit_guard', 审批状态: '待重新审批', Offer状态: '谈薪中', 当前版本: 2, Offer文件地址: 'https://files.example.test/old.pdf' })
    const offers = createService()
    let generated = 0
    offers.generateFile = async offerId => {
      generated += 1
      return { offerId, fileName: 'new.pdf', fileUrl: 'https://files.example.test/new.pdf', status: '待发送' }
    }
    const input = { candidateId: 'tal_edit_guard', role: '商务提报', baseSalary: 9000, startDate: today, reportingTo: '张总', validFrom: today, validTo: today, templateId: '社招', operator: '王HR' }
    await assert.rejects(() => offers.update('offer_draft_guard', input), /审批通过后才能修改/)
    await assert.rejects(() => offers.sendEmail('offer_revision_guard', { recipient: 'guard@example.test' }), /未审批通过/)
    assert.equal(generated, 0)
    const updated = await offers.update('offer_revision_guard', input)
    assert.equal(updated.version, 3)
    assert.equal(generated, 1)
    const row = memory.records.get('recruitment_offers').find(item => item.fields['OfferID'] === 'offer_revision_guard')
    assert.equal(row.fields['审批状态'], '已通过')
    assert.equal(row.fields['基本月薪'], 9000)
  } finally {
    memory.restore()
  }
})

test('failed PDF regeneration restores the stored Offer so fields never drift from the PDF', async () => {
  const memory = installMemory()
  try {
    const today = new Date().toISOString().slice(0, 10)
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_regen_fail', 姓名: '候选人' })
    await teable.createRecord('recruitment_offers', {
      OfferID: 'offer_regen_fail', 候选人ID: 'tal_regen_fail', 审批状态: '已通过', Offer状态: '待发送', 当前版本: 1,
      岗位名称: '商务提报', 基本月薪: 8000, 薪资结构JSON: JSON.stringify({ 底薪: 8000 }), 汇报上级: '张总',
      Offer文件地址: 'https://files.example.test/old.pdf', 发送状态: '待人工发送',
    })
    const offers = createService()
    offers.generateFile = async () => { throw new Error('PDF渲染失败') }
    await assert.rejects(() => offers.update('offer_regen_fail', {
      candidateId: 'tal_regen_fail', role: '运营负责人', baseSalary: 13000, startDate: today, reportingTo: '张总', validFrom: today, validTo: today, templateId: '社招', operator: '王HR',
    }), /PDF渲染失败/)
    const row = memory.records.get('recruitment_offers').find(item => item.fields['OfferID'] === 'offer_regen_fail')
    assert.equal(row.fields['岗位名称'], '商务提报')
    assert.equal(row.fields['基本月薪'], 8000)
    assert.equal(row.fields['当前版本'], 1)
    assert.equal(row.fields['Offer文件地址'], 'https://files.example.test/old.pdf')
    assert.deepEqual(JSON.parse(row.fields['薪资结构JSON']), { 底薪: 8000 })
    assert.equal(memory.records.get('recruitment_offer_versions').filter(item => item.fields['OfferID'] === 'offer_regen_fail').length, 0)
  } finally {
    memory.restore()
  }
})

test('answered Offers cannot be regenerated, relinked, or resent', async () => {
  const memory = installMemory()
  try {
    await teable.createRecord('recruitment_offers', {
      OfferID: 'offer_answered', 候选人ID: 'tal_answered', 审批状态: '已通过', Offer状态: '已接受', 候选人答复: '接受',
      Offer文件地址: 'https://files.example.test/offer.pdf',
    })
    const offers = createService()
    await assert.rejects(() => offers.generateFile('offer_answered', {}), /候选人已答复/)
    await assert.rejects(() => offers.createResponseLink('offer_answered', {}), /候选人已答复/)
    await assert.rejects(() => offers.sendEmail('offer_answered', { recipient: 'candidate@example.test' }), /候选人已答复/)
  } finally {
    memory.restore()
  }
})

test('disabled Offer templates cannot be used for creation or regeneration', async () => {
  const memory = installMemory()
  try {
    await teable.createRecord('recruitment_offer_templates', {
      Offer模板ID: 'tpl_disabled_social', 适用类型: '社招', 模板状态: '停用',
    })
    const offers = createService()
    await assert.rejects(() => offers.create({
      candidateId: 'tal_disabled_template', role: '岗位', baseSalary: 1, startDate: new Date().toISOString().slice(0, 10), reportingTo: '张总', validFrom: new Date().toISOString().slice(0, 10), validTo: new Date().toISOString().slice(0, 10),
    }), /Offer模板不存在或已停用/)

    await teable.createRecord('recruitment_offers', {
      OfferID: 'offer_disabled_template', 候选人ID: 'tal_disabled_template', 审批状态: '已通过', 模板ID: 'tpl_disabled_social',
    })
    await assert.rejects(() => offers.generateFile('offer_disabled_template', {}), /Offer模板已停用/)
  } finally {
    memory.restore()
  }
})

test('Offer creation backfills a legacy application without a position', async () => {
  const memory = installMemory()
  try {
    const today = new Date().toISOString().slice(0, 10)
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_blank_position', 姓名: '候选人' })
    const application = await teable.createRecord('recruitment_applications', {
      应聘记录ID: 'app_blank_position', 候选人ID: 'tal_blank_position', 职位ID: '', 当前状态: '进行中', 更新时间: '2026-10-18T00:00:00.000Z',
    })
    const offers = createService()
    offers.generateFile = async offerId => ({ offerId, fileUrl: 'https://files.example.test/offer.pdf' })

    const created = await offers.create({
      candidateId: 'tal_blank_position', positionId: 'pos_selected', role: '商务提报', baseSalary: 5000,
      startDate: today, reportingTo: '张总', validFrom: today, validTo: today, templateId: '社招', operator: '王HR',
    })
    assert.ok(created.offerId)
    const row = memory.records.get('recruitment_offers').find((item) => item.fields['OfferID'] === created.offerId)
    assert.equal(row.fields['应聘记录ID'], 'app_blank_position')
    assert.equal(row.fields['职位ID'], 'pos_selected')
    assert.equal(application.fields['职位ID'], 'pos_selected')
  } finally {
    memory.restore()
  }
})

test('interview Offer context can recover the application position', async () => {
  const memory = installMemory()
  try {
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_context_position', 姓名: '候选人' })
    await teable.createRecord('recruitment_positions', { 职位ID: 'pos_context', 职位名称: '商务提报', 部门: '商务', 工作地点: '烟台' })
    await teable.createRecord('recruitment_applications', {
      应聘记录ID: 'app_context_position', 候选人ID: 'tal_context_position', 职位ID: 'pos_context', 当前状态: '进行中', 更新时间: '2026-10-18T00:00:00.000Z',
    })
    await teable.createRecord('recruitment_interviews', {
      面试ID: 'interview_context_position', 候选人ID: 'tal_context_position', 应聘记录ID: 'app_context_position',
    })
    const context = await createService().interviewOfferContext({ interviewId: 'interview_context_position' })
    assert.equal(context.position.id, 'pos_context')
    assert.equal(context.position.name, '商务提报')
    assert.equal(context.applicationId, 'app_context_position')
  } finally {
    memory.restore()
  }
})

test('expired response links cannot overwrite answered Offer status', async () => {
  const memory = installMemory()
  try {
    await teable.createRecord('recruitment_offers', {
      OfferID: 'offer_answered_expired', 审批状态: '已通过', Offer状态: '待候选人答复',
      Offer文件地址: 'https://files.example.test/offer.pdf',
    })
    const offers = createService()
    const link = await offers.createResponseLink('offer_answered_expired', { channel: '测试', expiresHours: 72 })
    const row = memory.records.get('recruitment_offers')[0]
    await teable.updateRecord('recruitment_offers', row.id, {
      答复过期时间: new Date(Date.now() - 1_000).toISOString(), 候选人答复: '接受', Offer状态: '已接受',
    })

    const answered = await offers.publicOffer(link.token)
    assert.equal(answered.status, '已接受')
    assert.equal(answered.response, '接受')
    assert.equal(answered.fileUrl, 'https://files.example.test/offer.pdf')
    assert.equal(row.fields['Offer状态'], '已接受')
    await assert.rejects(() => offers.respond(link.token, { response: 'reject' }), /该Offer已经答复/)
  } finally {
    memory.restore()
  }
})

test('Offer PDF generation failure is persisted with its reason', async () => {
  const memory = installMemory()
  try {
    const today = new Date().toISOString().slice(0, 10)
    await teable.createRecord('recruitment_candidates', { 候选人ID: 'tal_failed_pdf', 姓名: '候选人' })
    await teable.createRecord('recruitment_applications', { 应聘记录ID: 'app_failed_pdf', 候选人ID: 'tal_failed_pdf', 职位ID: 'pos_failed_pdf', 当前状态: '进行中' })
    const offers = createService()
    offers.renderPdf = async () => { throw new Error('模拟中文字体缺失') }
    await assert.rejects(() => offers.create({
      candidateId: 'tal_failed_pdf', applicationId: 'app_failed_pdf', positionId: 'pos_failed_pdf', role: '岗位',
      baseSalary: 1000, startDate: today, reportingTo: '张总', validFrom: today, validTo: today, templateId: '社招', operator: '王HR',
    }), /模拟中文字体缺失/)
    const row = memory.records.get('recruitment_offers')[0]
    assert.equal(row.fields['Offer状态'], '生成失败')
    assert.equal(row.fields['发送状态'], '生成失败')
    const audit = memory.records.get('recruitment_audit_logs').find((item) => item.fields['操作类型'] === '生成Offer文件失败')
    assert.equal(audit.fields['操作结果'], '失败')
    assert.equal(audit.fields['错误信息'], '模拟中文字体缺失')
  } finally {
    memory.restore()
  }
})
