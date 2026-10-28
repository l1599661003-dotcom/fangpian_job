import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { jobs } from '../../platform/jobs'
import { extname } from 'node:path'
import { teable, TeableRecord } from '../../platform/teable'
import { llm } from '../../platform/llm'
import { storage } from '../../platform/storage'
import { MAX_BATCH_FILES, MAX_FILE_SIZE, RESUME_FIELDS, RESUME_TABLE } from './resume.constants'
import { ResumeAnalysisStartInput, ResumeExtraction, ResumeImportContext, ResumeRecord, ResumeReviewInput } from './resume.types'
import { ResumeFileService } from './resume-file.service'
import { TalentsService } from '../talents/talents.service'
import { DatabaseService } from '../database/database.service'
import { ResumeWordService } from './resume-word.service'
import { dateTokens, readQualityWarnings, resumeQualityWarnings } from './resume-quality'

const emptyExtraction = (): ResumeExtraction => ({
  name: '', gender: '', age: null, phone: '', email: '', wechat: '', address: '', selfEvaluation: '',
  skillsCertificates: '', educationBackground: '', workExperience: '', jobIntention: '', yearsOfExperience: '',
  currentCompany: '', currentRole: '',
})
const text = (value: unknown) => String(value ?? '').trim()
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, message: string, onTimeout?: () => void) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => { onTimeout?.(); reject(new Error(message)) }, timeoutMs)
  promise.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
})
const REVIEW_FIELDS: Record<string, string> = {
  name: '姓名', gender: '性别', age: '年龄', phone: '电话', email: '邮箱', wechat: '微信', address: '地址', selfEvaluation: '自我评价',
  skillsCertificates: '技能证书', educationBackground: '教育背景', workExperience: '工作经历', jobIntention: '求职意向', yearsOfExperience: '工作年限',
  currentCompany: '当前公司', currentRole: '当前职位',
}
const CANDIDATE_REVIEW_FIELDS: Record<string, string> = {
  name: '姓名', gender: '性别', phone: '电话', email: '邮箱', wechat: '微信', address: '当前城市', selfEvaluation: '自我评价',
  educationBackground: '教育经历', workExperience: '工作经历', jobIntention: '期望职位', yearsOfExperience: '工作年限',
  currentCompany: '当前公司', currentRole: '当前职位',
}
const INVALID_NAME_HEADINGS = new Set([
  '个人优势', '工作经历', '工作经验', '教育经历', '教育背景', '项目经历', '实习经历', '校园经历',
  '专业技能', '技能证书', '自我评价', '个人评价', '求职意向', '基本信息', '个人信息', '联系方式',
  '资格证书', '荣誉奖项', '获奖经历', '语言能力', '兴趣爱好', '简历', '个人简历', '求职简历',
])
const INVALID_NAME_VALUES = new Set([
  '全部行业', '行业不限', '全部岗位', '全部状态', '全部来源', '全部标签',
  '商务提报', '商单提报', '商务团队', '商务执行', '商务运营', '商务', '山东烟台',
  '单提报', '经纪人', '纪人', '红签约经', '高层行政', '行政',
  '项目', '项目执行', '项目描述', '项目职责', '项目成果', '关键业绩', '荣誉奖励',
  '应届生', '相关学习', '支教教师', '宣传工作', '毕业院校', '应聘公司',
  '管理会计', '金融学', '计算机', '支持专员', '文员', '管控', '水平', '方向',
  '通过', '公司', '成果', '支持', '发展', '和建议', '利用', '应届', '单提',
  '全职', '兼职', '实习', '在职', '离职',
  '红签', '管理', '通用', '康复科', '向岗位', '向岗', '鲁工业大', '后端', '媒介', '编导',
  '剪辑', '运营', '经理', '主管', '助理', '负责人', '团队',
  '简版', '更新版', '完整版', '完整简历', '更新简历', '终版', '定稿版',
])
const INVALID_NAME_PARTS = /(?:行业不限|全部行业|全部岗位|全部状态|全部来源|全部标签|商务|提报|签约|经纪|行政|招聘|应届生|应届|全职|兼职|实习|在职|离职|相关学习|项目|荣誉|奖励|经历|经验|技能|证书|评价|建议|意向|信息|简历|能力|背景|联系方式|岗位|职位|应聘|公司|团队|运营|执行|支持|专员|文员|教师|会计|计算机|金融学|毕业院校|个人|自我|学习|成果|职责|业绩|管控|水平|方向|通过|基础|发展|全文|理工学院|单提|红签|通用|康复科|工业大学|鲁工业大|后端|媒介|编导|剪辑|经理|主管|助理|负责人)/
const INVALID_NAME_SUFFIX = /(?:简|的|个|女|先|完|求|等|以内|版)$/
const NAME_HONORIFIC = /(?:女士|先生|小姐|老师|同学)$/
const FILE_NAME_ROLE_PREFIX = /(?:经理|主管|专员|助理|后端|媒介|编导|剪辑|商务|行政|提报|经纪人|运营|执行|负责人|岗位|职位|招聘|团队管理|团队)/
const COMMON_CHINESE_SURNAMES = new Set('赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴代谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程嵇邢滑裴陆荣翁荀羊甄曲封储靳段巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲台从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍璩桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎慕连茹习艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公原商丛修牟律闫付隋迟初千肖矫禚续'.split(''))
const TRADITIONAL_SURNAME_MAP: Record<string, string> = {
  張: '张', 趙: '赵', 錢: '钱', 孫: '孙', 吳: '吴', 鄭: '郑', 馮: '冯', 陳: '陈', 衛: '卫', 蔣: '蒋', 韓: '韩', 楊: '杨',
  許: '许', 呂: '吕', 華: '华', 謝: '谢', 鄒: '邹', 蘇: '苏', 魯: '鲁', 韋: '韦', 馬: '马', 鳳: '凤', 鮑: '鲍', 費: '费',
  賀: '贺', 羅: '罗', 畢: '毕', 樂: '乐', 於: '于', 齊: '齐', 顧: '顾', 黃: '黄', 蕭: '萧', 鄧: '邓', 劉: '刘', 龍: '龙',
  葉: '叶', 賴: '赖', 譚: '谭', 喬: '乔', 關: '关', 鍾: '钟', 鐘: '钟', 歐: '欧', 陽: '阳',
}
const COMMON_COMPOUND_SURNAMES = ['欧阳', '司马', '上官', '诸葛', '夏侯', '东方', '皇甫', '尉迟', '公孙', '慕容', '司徒', '司空', '令狐', '宇文', '长孙', '轩辕']
const VALID_GENDERS = new Set(['男', '女'])

@Injectable()
export class ResumesService implements OnModuleInit {
  private fingerprintLocks = new Map<string, Promise<ResumeRecord>>()
  private wordLocks = new Map<string, Promise<ResumeRecord>>()
  private batchRefreshLocks = new Map<string, Promise<unknown>>()
  private batchQueue: Promise<unknown> = Promise.resolve()
  // 批量解析采用小并发，避免一份异常简历阻塞整批，同时不让 OCR/LLM 被大量并发压垮。
  private batchConcurrency = 4
  // 整批先持久化原文件。这样解析运行数十分钟时即使 Pod 重启，也不会丢掉尚未解析的文件。
  private batchStorageConcurrency = 4
  private batchItemTimeoutMs = 90_000

  constructor(
    private readonly files: ResumeFileService,
    private readonly word: ResumeWordService,
    readonly talents: TalentsService,
    private readonly database: DatabaseService,
  ) {}

  async onModuleInit() {
    // 数据库初始化完成后扫描未收尾批次。批次状态和明细是持久化事实源，
    // 进程重启后至少会把已超时项目标记为可重试，避免页面永久停在旧进度。
    setTimeout(() => { void this.recoverStaleBatches() }, 5_000)
  }

  async queueBatchOperation(operation: () => Promise<unknown>) {
    const task = this.batchQueue.catch(() => undefined).then(operation)
    this.batchQueue = task
    return task
  }

  private async recoverStaleBatches() {
    try {
      const rows = await teable.listAllRecords(this.database.requireTableId('resume_batch_imports'))
      const active = rows.filter((row) => ['上传中', '处理中', '重试中'].includes(String(row.fields['批次状态'] || '')))
      for (const row of active) {
        await this.recoverInterruptedBatch(row)
        // 批次项和原文件地址已经持久化后，重启不再依赖原 HTTP 请求中的内存文件。
        // 为每个批次只启动一个恢复任务，任务本身会按明细状态跳过已完成项。
        if (process.env.NODE_ENV === 'production') jobs.start((progress) => this.resumePersistedBatch(row, progress))
      }
    } catch (error) {
      console.error(`[ResumeFlow] 批量任务启动恢复失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async resumePersistedBatch(batch: TeableRecord, progress: (message: string) => void) {
    const batchId = String(batch.fields['批次ID'] || batch.id)
    const itemTable = this.database.requireTableId('resume_batch_import_items')
    const items = (await this.listBatchItems(batchId, itemTable)).sort((a, b) => Number(a.fields['序号'] || 0) - Number(b.fields['序号'] || 0))
    const candidates = items.filter((item) => !['已完成'].includes(String(item.fields['处理状态'] || '')) && String(item.fields['原文件地址'] || ''))
    let completed = 0
    for (const item of candidates) {
      const url = String(item.fields['原文件地址'] || '')
      try {
        const file = await this.downloadFile(url, this.decodeFileName(String(item.fields['文件名'] || 'resume')))
        await this.processBatchItem(batchId, itemTable, item, file, url, Number(item.fields['序号'] || 1) - 1, items.length, progress, this.batchImporter(batch))
        completed += 1
      } catch (error) {
        progress(`恢复第${item.fields['序号'] || '?'}份失败，已保留失败状态：${error instanceof Error ? error.message : String(error)}`)
      }
      await this.refreshBatch(batchId).catch(() => undefined)
    }
    progress(`批次恢复完成：本次接管${completed}/${candidates.length}份`)
    return this.refreshBatch(batchId, true)
  }

  validateFile(file: Express.Multer.File) { return this.files.validate(file) }

  private table() {
    return this.database.requireTableId(RESUME_TABLE)
  }

  async list() {
    const [rows, candidateRows] = await Promise.all([
      teable.listAllRecords(this.table()),
      teable.listAllRecords(this.database.requireTableId('recruitment_candidates')),
    ])
    // 人才主档的创建时间才是候选人“入库时间”的权威来源。
    // 简历解析记录可能来自历史导入或补录，未必带有自身创建时间。
    const candidateEntryTimes = new Map(candidateRows.map((row) => [
      String(row.fields['候选人ID'] || row.id),
      String(row.fields['创建时间'] || row.createdTime || ''),
    ]))
    // 人才档案默认展示最新入库的简历。创建时间为空的历史记录排在最后，
    // 同一时间再按平台记录创建时间稳定排序。
    return rows
      .map((row) => {
        const resume = this.fromTeable(row)
        return { ...resume, createdTime: candidateEntryTimes.get(resume.candidateId || '') || resume.createdTime }
      })
      .sort((left, right) => {
        const leftTime = Date.parse(left.createdTime || '') || 0
        const rightTime = Date.parse(right.createdTime || '') || 0
        return rightTime - leftTime || String(right.createdTime || '').localeCompare(String(left.createdTime || '')) || right.id.localeCompare(left.id)
      })
  }

  /**
   * 修复历史简历中的姓名和性别。
   *
   * 只使用已经入库的 OCR 原文和源文件名，不凭空猜测：
   * - 姓名只能来自明确姓名字段、正文顶部或文件名中的合法中文姓名；
   * - 性别只能来自“男/女”白名单或正文中的明确性别标签；
   * - 类似“全部行业”“行业不限”等脏值会被清空；
   * - 每条记录独立处理，单条异常不会阻断整批。
   */
  async backfillIdentity(progress: (message: string) => void) {
    const resumeTable = this.table()
    const candidateTable = this.database.requireTableId('recruitment_candidates')
    const [resumeRows, candidateRows] = await Promise.all([
      teable.listAllRecords(resumeTable),
      teable.listAllRecords(candidateTable),
    ])
    const candidatesById = new Map(candidateRows.map((row) => [String(row.fields['候选人ID'] || ''), row]))
    const candidatesByResumeId = new Map(candidateRows.map((row) => [String(row.fields['最新简历记录ID'] || ''), row]))
    const result = {
      scanned: resumeRows.length,
      updated: 0,
      namesFixed: 0,
      gendersFixed: 0,
      invalidGendersCleared: 0,
      skipped: 0,
      failed: 0,
      failures: [] as Array<{ recordId: string; error: string }>,
    }

    for (let index = 0; index < resumeRows.length; index += 1) {
      const row = resumeRows[index]
      try {
        const fields = row.fields || {}
        const rawText = String(fields['OCR原文'] || '')
        const sourceFileName = this.decodeFileName(String(fields['源文件名'] || ''))
        const existingName = String(fields['姓名'] || '').trim()
        const existingGender = String(fields['性别'] || '').trim()
        const existingPhone = String(fields['电话'] || '').trim()
        const existingEmail = String(fields['邮箱'] || '').trim()
        const existingAddress = String(fields['地址'] || '').trim()
        const existingYears = String(fields['工作年限'] || '').trim()
        const existingWechat = String(fields['微信'] || '').trim()
        const existingCompany = String(fields['当前公司'] || '').trim()
        const existingRole = String(fields['当前职位'] || '').trim()
        const textName = this.nameFromText(rawText)
        const fileNameName = this.nameFromFileName(sourceFileName)
        const contacts = this.extractContacts(rawText)
        const rawNormalized = rawText.normalize('NFKC')
        const wechat = rawNormalized.match(/(?:微信|WeChat)\s*[:：]?\s*([A-Za-z][\w-]{5,19})/i)?.[1] || ''
        const regularExtract = this.ruleExtract(rawText)
        const nextPhone = existingPhone || contacts.phone
        const nextEmail = existingEmail || contacts.email
        const nextAddress = existingAddress || regularExtract.address
        const dirtyYears = Boolean(existingYears) && (existingYears.includes('|') || existingYears.includes('｜') || existingYears.length > 20)
        const nextYears = dirtyYears ? regularExtract.yearsOfExperience : existingYears
        const nextCompany = existingCompany || regularExtract.currentCompany
        const nextRole = existingRole || regularExtract.currentRole
        const derived = this.normalize({
          ...emptyExtraction(),
          name: existingName,
          gender: existingGender,
        }, rawText, sourceFileName)
        const recovered = !this.cleanName(existingName) && !derived.name && rawText.length >= 20 && (rawText.match(/[\u3400-\u9fff]/g) || []).length >= 8
          ? await this.recoverIdentityWithLlm(rawText, sourceFileName)
          : { name: '', gender: '' }
        const safeExistingName = this.nameFromTrustedSource(existingName, textName, fileNameName)
        const safeExistingGender = this.normalizeGender(existingGender, rawText)
        const candidateId = String(fields['候选人ID'] || '')
        const candidate = candidatesById.get(candidateId) || candidatesByResumeId.get(row.id) || candidatesByResumeId.get(String(fields['解析记录ID'] || ''))
        const candidateFields = candidate?.fields || {}
        const safeCandidateName = this.cleanName(candidateFields['姓名'])
        // 只有明确字段、正文、文件名或同一候选人的已确认姓名才能作为回填依据。
        // 没有任何可靠证据时写占位值，避免把岗位词继续留在姓名字段里。
        const nextName = safeExistingName || derived.name || recovered.name || safeCandidateName || '未识别姓名'
        // 正文中的明确性别优先于历史字段；没有证据时保留合法历史值，非法值清空。
        const nextGender = this.normalizeGender('', rawText) || recovered.gender || safeExistingGender
        const patch: Record<string, unknown> = {}
        if (nextPhone !== existingPhone) patch.电话 = nextPhone
        if (nextEmail !== existingEmail) patch.邮箱 = nextEmail
        if (wechat && wechat !== existingWechat && !existingWechat) patch.微信 = wechat
        if (nextAddress !== existingAddress) patch.地址 = nextAddress
        if (nextYears !== existingYears) patch.工作年限 = nextYears
        if (nextCompany !== existingCompany) patch.当前公司 = nextCompany
        if (nextRole !== existingRole) patch.当前职位 = nextRole
        if (nextName !== existingName) {
          patch.姓名 = nextName
          result.namesFixed += 1
        }
        if (nextGender !== existingGender) {
          patch.性别 = nextGender
          if (existingGender && !VALID_GENDERS.has(existingGender)) result.invalidGendersCleared += 1
          if (nextGender) result.gendersFixed += 1
        }

        if (candidate) {
          const candidateName = String(candidateFields['姓名'] || '').trim()
          const candidateGender = String(candidateFields['性别'] || '').trim()
          const candidatePatch: Record<string, unknown> = {}
          if (!safeCandidateName && candidateName !== nextName) candidatePatch.姓名 = nextName
          const candidateNextGender = this.normalizeGender('', rawText) || recovered.gender || this.normalizeGender(candidateGender, '')
          if (candidateNextGender !== candidateGender) candidatePatch.性别 = candidateNextGender
          const candidateSync = {
            电话: nextPhone || String(candidateFields['电话'] || ''),
            邮箱: nextEmail || String(candidateFields['邮箱'] || ''),
            微信: wechat || String(candidateFields['微信'] || ''),
            当前城市: nextAddress || String(candidateFields['当前城市'] || ''),
            工作年限: nextYears || String(candidateFields['工作年限'] || ''),
            当前公司: nextCompany || String(candidateFields['当前公司'] || ''),
            当前职位: nextRole || String(candidateFields['当前职位'] || ''),
          }
          for (const [fieldName, value] of Object.entries(candidateSync)) {
            if (!String(candidateFields[fieldName] || '').trim() && value) candidatePatch[fieldName] = value
          }
          if (Object.keys(candidatePatch).length) {
            candidatePatch.更新时间 = new Date().toISOString()
            await teable.updateRecord(candidateTable, candidate.id, candidatePatch)
            candidatesById.set(String(candidateFields['候选人ID'] || ''), { ...candidate, fields: { ...candidateFields, ...candidatePatch } })
          }
        }

        if (Object.keys(patch).length) {
          patch.更新时间 = new Date().toISOString()
          await teable.updateRecord(resumeTable, row.id, patch)
          result.updated += 1
        } else {
          result.skipped += 1
        }
      } catch (error) {
        result.failed += 1
        result.failures.push({
          recordId: row.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      if ((index + 1) % 10 === 0 || index === resumeRows.length - 1) {
        progress(`正在修复姓名和性别：${index + 1}/${resumeRows.length}`)
      }
    }
    progress(`修复完成：补全姓名${result.namesFixed}条，修正性别${result.gendersFixed}条，清理错误性别${result.invalidGendersCleared}条`)
    return result
  }

  private async recoverIdentityWithLlm(rawText: string, fileName: string) {
    const prompt = `从下面的简历 OCR 原文中恢复候选人的真实姓名和性别，只返回 JSON：{"name":"","gender":""}。name只能是原文中明确出现的自然人姓名，不能使用岗位名、学校名、公司名、城市、章节标题、文件名，也不能根据上下文猜测；gender只能是“男”或“女”，原文没有明确性别就返回空字符串。无法确认姓名时name必须为空。\n文件名：${fileName}\n原文：${rawText.slice(0, 12000)}`
    try {
      const answer = await withTimeout(llm.chat([{ role: 'user', content: prompt }]), 12_000, '历史身份复核超时')
      const cleaned = answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      const parsed = JSON.parse(cleaned)
      const textName = this.nameFromText(rawText)
      const fileNameName = this.nameFromFileName(fileName)
      return {
        name: this.nameFromTrustedSource(parsed?.name, textName, fileNameName),
        gender: this.normalizeGender(parsed?.gender, rawText),
      }
    } catch {
      return { name: '', gender: '' }
    }
  }

  async delete(id: string) {
    const tableId = this.table()
    const recordId = id

    let row: TeableRecord | undefined
    try {
      row = await teable.getRecord(tableId, recordId)
    } catch {
      const rows = await teable.listRecords(tableId, { take: 1, filterByTql: `{解析记录ID} = "${recordId.replace(/"/g, '\\"')}"` })
      row = rows[0]
    }
    if (!row) {
      // 简历记录可能已被删除，但人才主档的“最新简历记录ID”还指向它（悬空引用）。
      // 此时直接把人才主档标记为已删除，让用户可以从人才库移除这条悬空记录。
      const candidateTable = this.database.requireTableId('recruitment_candidates')
      const candidateRows = await teable.listRecords(candidateTable, { take: 500, filterByTql: `{最新简历记录ID} = "${recordId.replace(/"/g, '\\"')}"` })
      const staleCandidateRows = candidateRows.filter((item) => String(item.fields['最新简历记录ID'] || '').trim() === recordId.trim())
      if (staleCandidateRows.length) {
        const deletedAt = new Date().toISOString()
        const primaryCandidateId = String(staleCandidateRows[0].fields['候选人ID'] || '').trim()
        await Promise.all(staleCandidateRows.map((item) => teable.updateRecord(candidateTable, item.id, { 候选人状态: '已删除', 人才池: '已删除', 最新简历记录ID: '', 当前简历文件名: '', 当前简历地址: '', 更新时间: deletedAt })))
        await this.resumeAudit('删除简历', { id: recordId, fields: { '源文件名': '(记录已不存在)' } } as TeableRecord, { deleted: true, candidateId: primaryCandidateId, affectedCandidates: staleCandidateRows.map((item) => String(item.fields['候选人ID'] || '').trim()).filter(Boolean), candidateStatus: '已从人才库隐藏' }, '当前用户', '人才库手动删除简历（简历记录已不存在，清理悬空引用）')
        return { deleted: true, candidateId: primaryCandidateId, affectedCandidates: staleCandidateRows.map((item) => String(item.fields['候选人ID'] || '').trim()).filter(Boolean), candidateStatus: '已从人才库隐藏' }
      }
      throw new NotFoundException('简历记录不存在')
    }

    const businessResumeId = String(row.fields['解析记录ID'] || row.id).trim()
    const candidateId = String(row.fields['候选人ID'] || '').trim()
    const versionTable = this.database.requireTableId('recruitment_resume_versions')
    const versions = candidateId
      ? await teable.listRecords(versionTable, { take: 500, filterByTql: `{候选人ID} = "${candidateId.replace(/"/g, '\\"')}"` })
      : []
    const deletedVersion = versions.find((item) => String(item.fields['简历记录ID'] || '') === row.id || String(item.fields['简历记录ID'] || '') === String(row.fields['解析记录ID'] || ''))

    if (deletedVersion) await teable.deleteRecord(versionTable, deletedVersion.id)
    await teable.deleteRecord(tableId, row.id)

    let candidateStatus: '保留人才' | '已从人才库隐藏' = '保留人才'
    if (candidateId) {
      const candidateTable = this.database.requireTableId('recruitment_candidates')
      const candidateRows = await teable.listRecords(candidateTable, { take: 1, filterByTql: `{候选人ID} = "${candidateId.replace(/"/g, '\\"')}"` })
      const candidate = candidateRows[0]
      const remainingVersions = versions.filter((item) => item.id !== deletedVersion?.id)
      const remainingResumes = await teable.listRecords(tableId, { take: 500, filterByTql: `{候选人ID} = "${candidateId.replace(/"/g, '\\"')}"` })

      if (candidate) {
        if (remainingVersions.length) {
          const currentVersion = remainingVersions.slice().sort((left, right) =>
            Number(right.fields['版本号'] || 0) - Number(left.fields['版本号'] || 0)
            || String(right.fields['创建时间'] || '').localeCompare(String(left.fields['创建时间'] || '')),
          )[0]
          await Promise.all(remainingVersions.map((item) => teable.updateRecord(versionTable, item.id, { 是否当前版本: item.id === currentVersion.id ? '是' : '否' })))
          const fallbackResume = remainingResumes.find((item) => item.id === currentVersion.fields['简历记录ID'] || String(item.fields['解析记录ID'] || '') === String(currentVersion.fields['简历记录ID'] || ''))
          await teable.updateRecord(candidateTable, candidate.id, { 最新简历记录ID: currentVersion.fields['简历记录ID'] || '', 当前简历文件名: String(fallbackResume?.fields['源文件名'] || ''), 当前简历地址: String(fallbackResume?.fields['源文件地址'] || ''), 候选人状态: String(candidate.fields['候选人状态'] || '') === '已删除' ? '待负责人审查' : candidate.fields['候选人状态'], 更新时间: new Date().toISOString() })
        } else if (remainingResumes.length) {
          const latestResume = remainingResumes.slice().sort((left, right) => String(right.fields['更新时间'] || right.fields['创建时间'] || '').localeCompare(String(left.fields['更新时间'] || left.fields['创建时间'] || '')))[0]
          await teable.updateRecord(candidateTable, candidate.id, { 最新简历记录ID: latestResume.fields['解析记录ID'] || latestResume.id, 当前简历文件名: String(latestResume.fields['源文件名'] || ''), 当前简历地址: String(latestResume.fields['源文件地址'] || ''), 候选人状态: String(candidate.fields['候选人状态'] || '') === '已删除' ? '待负责人审查' : candidate.fields['候选人状态'], 更新时间: new Date().toISOString() })
        } else {
          const deletedAt = new Date().toISOString()
          const staleCandidates = await teable.listRecords(candidateTable, { take: 500, filterByTql: `{最新简历记录ID} = "${businessResumeId.replace(/"/g, '\\"')}"` })
          const staleCandidateRows = staleCandidates.filter((item) => String(item.fields['最新简历记录ID'] || '').trim() === businessResumeId)
          const candidateRowsToUpdate = staleCandidateRows.length ? staleCandidateRows : [candidate]
          await Promise.all(candidateRowsToUpdate.map((item) => teable.updateRecord(candidateTable, item.id, { 候选人状态: '已删除', 人才池: '已删除', 最新简历记录ID: '', 当前简历文件名: '', 当前简历地址: '', 更新时间: deletedAt })))
          candidateStatus = '已从人才库隐藏'
        }
      }
    }

    await this.resumeAudit('删除简历', row, { deleted: true, candidateId, candidateStatus }, '当前用户', '人才库手动删除简历')
    return { deleted: true, candidateId, candidateStatus }
  }

  async reparse(id: string, progress: (message: string) => void) {
    const tableId = this.table()
    const [recordById, recordsByBusinessId] = await Promise.all([
      teable.getRecord(tableId, id).catch(() => null),
      teable.listByField(tableId, '解析记录ID', id, 2),
    ])
    const row = recordById || recordsByBusinessId[0]
    if (!row) throw new NotFoundException('简历解析记录不存在')
    const sourceUrl = String(row.fields['源文件地址'] || '')
    const fileName = this.decodeFileName(String(row.fields['源文件名'] || '简历'))
    if (!sourceUrl || !/^https:\/\//i.test(sourceUrl)) throw new BadRequestException('该简历没有可用的原始文件地址，请重新上传')
    progress('正在读取原始简历')
    const file = await this.downloadFile(sourceUrl, fileName)
    const warnings: string[] = []
    const rawText = await this.files.extractText(file, sourceUrl, progress, message => warnings.push(message))
    const extracted = await this.extract(rawText)
    const normalized = this.normalize(extracted, rawText, fileName)
    normalized.qualityWarnings = [...new Set([...warnings, ...readQualityWarnings(extracted.qualityWarnings), ...resumeQualityWarnings(normalized, rawText)])]
    const latest = (await teable.listAllRecords(this.table())).find(item => item.id === row.id)
    if (!latest) throw new NotFoundException('简历在解析期间已被删除，已停止写入')
    await teable.listFields(this.table())
    const fields = this.preserveReviewedFields(latest, this.toFields(normalized, fileName, sourceUrl, rawText, this.fingerprint(rawText), String(latest.fields['头像地址'] || '')))
    const updated = await teable.updateRecord(this.table(), row.id, { ...fields, 更新时间: new Date().toISOString() })
    await this.syncReviewedResumeToCandidate(latest, fields, new Date().toISOString(), true)
    await this.resumeAudit('重新识别简历', latest, { qualityWarnings: normalized.qualityWarnings, preservedReviewedFields: true }, '当前用户', '原记录重新识别，保留人工复核和招聘流程，不重复入库或触发AI评分')
    progress('重新识别完成，已保留原记录、人工修正及招聘流程')
    return this.fromTeable(updated)
  }

  async convertImageToWord(id: string, body: { force?: boolean; operator?: string; operatorUserId?: string }) {
    const rows = await teable.listAllRecords(this.table())
    const row = rows.find((item) => item.id === id || String(item.fields['解析记录ID'] || '') === id)
    if (!row) throw new NotFoundException('简历解析记录不存在')
    const extension = extname(String(row.fields['源文件名'] || '')).toLowerCase()
    if (!['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff'].includes(extension)) throw new BadRequestException('只有图片简历可以转换为可编辑Word')
    if (!String(row.fields['OCR原文'] || '').trim()) throw new BadRequestException('该图片简历没有可用OCR文字，不能生成Word')
    if (row.fields['可编辑Word地址'] && !body.force) return this.fromTeable(row)
    if (this.wordLocks.has(row.id)) throw new ConflictException('该简历正在生成可编辑Word，请稍后刷新')
    const task = this.performWordConversion(row, body).finally(() => this.wordLocks.delete(row.id))
    this.wordLocks.set(row.id, task)
    return task
  }

  async review(id: string, input: ResumeReviewInput) {
    if (!input || typeof input.fields !== 'object' || Array.isArray(input.fields)) throw new BadRequestException('请提交需要复核的简历字段')
    if (!String(input.reason || '').trim()) throw new BadRequestException('请填写人工复核依据或修正原因')
    const rows = await teable.listAllRecords(this.table())
    const row = rows.find((item) => item.id === id || String(item.fields['解析记录ID'] || '') === id)
    if (!row) throw new NotFoundException('简历解析记录不存在')
    const normalized: Record<string, string | number | null> = {}
    for (const [key, field] of Object.entries(REVIEW_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(input.fields, key)) continue
      const value = (input.fields as any)[key]
      if (key === 'age') {
        if (value === '' || value == null) normalized[field] = null
        else {
          const age = Math.round(Number(value))
          if (!Number.isFinite(age) || age < 15 || age > 80) throw new BadRequestException('年龄应在15至80岁之间')
          normalized[field] = age
        }
        continue
      }
      const content = String(value ?? '').trim()
      const limit = ['selfEvaluation', 'skillsCertificates', 'educationBackground', 'workExperience'].includes(key) ? 20_000 : 500
      if (content.length > limit) throw new BadRequestException(`${field}内容过长`)
      if (key === 'name' && !content) throw new BadRequestException('姓名不能为空')
      if (key === 'phone' && content && !/^1[3-9]\d{9}$/.test(content)) throw new BadRequestException('手机号格式不正确')
      if (key === 'email' && content && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(content)) throw new BadRequestException('邮箱格式不正确')
      normalized[field] = content
    }
    const changes = Object.entries(normalized).filter(([field, value]) => String(row.fields[field] ?? '') !== String(value ?? '')).map(([field, value]) => ({ field, before: row.fields[field] ?? '', after: value ?? '' }))
    const timestamp = new Date().toISOString(), operator = String(input.operator || '').trim() || '当前用户'
    const correction = { changes, reason: String(input.reason).trim(), operatorUserId: String(input.operatorUserId || '').trim(), operator, reviewedAt: timestamp }
    const reviewFields = { ...normalized, 人工复核状态: changes.length ? '已修正' : '已确认', 人工修正内容: JSON.stringify(correction), 更新时间: timestamp }
    const updated = await teable.updateRecord(this.table(), row.id, reviewFields)
    await this.syncReviewedResumeToCandidate(row, normalized, timestamp)
    await this.resumeAudit(changes.length ? '人工修正简历字段' : '人工确认简历字段', row, correction, operator, correction.reason)
    return { resume: this.fromTeable(updated), changes, reviewStatus: reviewFields.人工复核状态, reviewedAt: timestamp }
  }

  async listVersions(candidateId: string) {
    const candidates = await teable.listAllRecords(this.database.requireTableId('recruitment_candidates'))
    if (!candidates.some((item) => item.id === candidateId || String(item.fields['候选人ID'] || '') === candidateId)) throw new NotFoundException('人才档案不存在')
    const rows = await teable.listAllRecords(this.database.requireTableId('recruitment_resume_versions'))
    const versions = rows.filter((item) => String(item.fields['候选人ID'] || '') === candidateId)
      .sort((a, b) => Number(b.fields['版本号'] || 0) - Number(a.fields['版本号'] || 0)).map((item) => this.mapVersion(item))
    return { candidateId, total: versions.length, currentVersionId: versions.find((item) => item.isCurrent)?.id || '', versions }
  }

  async activateVersion(versionId: string, body: { reason: string; operator?: string; operatorUserId?: string }) {
    if (!String(body.reason || '').trim()) throw new BadRequestException('请填写切换简历版本的原因')
    const tableId = this.database.requireTableId('recruitment_resume_versions')
    const rows = await teable.listAllRecords(tableId)
    const target = rows.find((item) => item.id === versionId || String(item.fields['简历版本ID'] || '') === versionId)
    if (!target) throw new NotFoundException('简历版本不存在')
    const candidateId = String(target.fields['候选人ID'] || '')
    const current = rows.find((item) => String(item.fields['候选人ID'] || '') === candidateId && String(item.fields['是否当前版本'] || '') === '是')
    if (current?.id === target.id) return { changed: false, ...(await this.listVersions(candidateId)) }
    const timestamp = new Date().toISOString()
    for (const row of rows.filter((item) => String(item.fields['候选人ID'] || '') === candidateId)) {
      await teable.updateRecord(tableId, row.id, { 是否当前版本: row.id === target.id ? '是' : '否', 启用时间: row.id === target.id ? timestamp : row.fields['启用时间'] })
    }
    const candidateTable = this.database.requireTableId('recruitment_candidates')
    const candidates = await teable.listAllRecords(candidateTable)
    const candidate = candidates.find((item) => item.id === candidateId || String(item.fields['候选人ID'] || '') === candidateId)
    if (!candidate) throw new NotFoundException('人才档案不存在')
    const resumeTable = this.database.requireTableId('resume_extraction_records')
    const activatedResumeRows = await teable.listRecords(resumeTable, { take: 1, filterByTql: `{解析记录ID} = "${String(target.fields['简历记录ID'] || '').replace(/"/g, '\\"')}"` })
    const activatedResume = activatedResumeRows[0]
    await teable.updateRecord(candidateTable, candidate.id, { 最新简历记录ID: target.fields['简历记录ID'], 当前简历文件名: String(activatedResume?.fields['源文件名'] || ''), 当前简历地址: String(activatedResume?.fields['源文件地址'] || ''), 更新时间: timestamp })
    await this.resumeAudit('切换人才当前简历版本', target, { fromVersionId: current?.fields['简历版本ID'] || '', toVersionId: target.fields['简历版本ID'], candidateId }, String(body.operator || '').trim() || '当前用户', String(body.reason).trim())
    return { changed: true, ...(await this.listVersions(candidateId)) }
  }

  private async ensureResumeVersion(resume: ResumeRecord, candidateId: string, file: { fileName: string; contentType?: string; size?: number }, importer?: ResumeImportContext) {
    const tableId = this.database.requireTableId('recruitment_resume_versions')
    const rows = await teable.listAllRecords(tableId)
    const candidateRows = rows.filter((item) => String(item.fields['候选人ID'] || '') === candidateId)
    const existing = candidateRows.find((item) => String(item.fields['简历记录ID'] || '') === resume.id || (resume.fingerprint && String(item.fields['简历指纹'] || '') === resume.fingerprint))
    if (existing) {
      if (String(existing.fields['是否当前版本'] || '') !== '是') await this.activateVersion(String(existing.fields['简历版本ID'] || existing.id), { reason: '重复上传同一份简历，恢复为当前版本', operator: '系统' })
      return this.mapVersion(existing)
    }
    const timestamp = new Date().toISOString(), nextVersion = Math.max(0, ...candidateRows.map((item) => Number(item.fields['版本号'] || 0))) + 1
    for (const row of candidateRows.filter((item) => String(item.fields['是否当前版本'] || '') === '是')) await teable.updateRecord(tableId, row.id, { 是否当前版本: '否' })
    const created = await teable.createRecord(tableId, {
      简历版本ID: `resver_${randomUUID().replaceAll('-', '').slice(0, 20)}`, 候选人ID: candidateId, 简历记录ID: resume.id, 版本号: nextVersion, 是否当前版本: '是',
      文件名: file.fileName || resume.sourceFileName, 文件地址: resume.sourceFileUrl, 文件类型: file.contentType || extname(file.fileName || resume.sourceFileName), 文件大小: Number(file.size || 0),
      简历指纹: resume.fingerprint || '', 来源类型: '简历上传', 解析状态: '已完成', 人工复核状态: resume.reviewStatus || '待复核',
      版本说明: nextVersion === 1 ? '首次入库简历' : '候选人新增简历附件', 创建人用户ID: String(importer?.operatorUserId || '').trim(), 创建人: String(importer?.operator || '').trim() || '系统导入', 创建时间: timestamp, 启用时间: timestamp,
    })
    // 不再全表扫描 candidates 表——ingestResume 已经更新过候选人记录，
    // 这里只更新最新简历记录ID即可，通过候选人表查询跳过减少一次 listRecords 调用。
    await this.resumeAudit('新增人才简历版本', created, { candidateId, resumeId: resume.id, version: nextVersion }, String(importer?.operator || '').trim() || '系统导入', nextVersion === 1 ? '首次入库简历' : '候选人新增简历附件')
    return this.mapVersion(created)
  }

  private mapVersion(row: TeableRecord) {
    return {
      id: String(row.fields['简历版本ID'] || row.id), recordId: row.id, candidateId: String(row.fields['候选人ID'] || ''), resumeId: String(row.fields['简历记录ID'] || ''),
      version: Number(row.fields['版本号'] || 0), isCurrent: String(row.fields['是否当前版本'] || '') === '是', fileName: String(row.fields['文件名'] || ''), fileUrl: String(row.fields['文件地址'] || ''),
      fileType: String(row.fields['文件类型'] || ''), fileSize: Number(row.fields['文件大小'] || 0), fingerprint: String(row.fields['简历指纹'] || ''), source: String(row.fields['来源类型'] || ''),
      parseStatus: String(row.fields['解析状态'] || ''), reviewStatus: String(row.fields['人工复核状态'] || ''), note: String(row.fields['版本说明'] || ''), creator: String(row.fields['创建人'] || ''),
      createdAt: String(row.fields['创建时间'] || ''), activatedAt: String(row.fields['启用时间'] || ''),
    }
  }

  private async syncReviewedResumeToCandidate(row: TeableRecord, normalized: Record<string, string | number | null>, timestamp: string, onlyIfLatest = false) {
    const candidateId = String(row.fields['候选人ID'] || '').trim()
    if (!candidateId) return
    const tableId = this.database.requireTableId('recruitment_candidates')
    const candidates = await teable.listAllRecords(tableId)
    const candidate = candidates.find((item) => item.id === candidateId || String(item.fields['候选人ID'] || '') === candidateId)
    if (!candidate) return
    const latestResumeId = String(candidate.fields['最新简历记录ID'] || '')
    if (onlyIfLatest && latestResumeId && ![row.id, String(row.fields['解析记录ID'] || '')].includes(latestResumeId)) return
    const fields: Record<string, unknown> = { 更新时间: timestamp }
    for (const [key, resumeField] of Object.entries(REVIEW_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(normalized, resumeField)) continue
      if (key === 'age') {
        if (String(candidate.fields['出生年份确认状态'] || '') !== '人工已确认' && normalized[resumeField]) {
          fields['年龄'] = normalized[resumeField]
          fields['出生年份'] = new Date().getUTCFullYear() - Number(normalized[resumeField])
          fields['出生年份来源'] = onlyIfLatest ? '简历重新识别年龄' : '人工复核简历年龄'
          fields['出生年份确认状态'] = '待人工复核'
        }
      } else if (key === 'skillsCertificates') {
        fields['技能JSON'] = JSON.stringify([...new Set(String(normalized[resumeField] || '').split(/[、,，；;\n]+/).map((item) => item.trim()).filter(Boolean))])
      } else if (CANDIDATE_REVIEW_FIELDS[key]) fields[CANDIDATE_REVIEW_FIELDS[key]] = normalized[resumeField]
    }
    await teable.updateRecord(tableId, candidate.id, fields)
  }

  async createBatch(files: Express.Multer.File[], body: { name?: string; operator?: string; operatorUserId?: string; suppressGroupPush?: boolean; batchId?: string; expectedTotal?: number }) {
    if (!Array.isArray(files) || !files.length) throw new BadRequestException('请选择需要批量上传的简历')
    const expectedTotal = Number(body.expectedTotal || files.length)
    if (!Number.isInteger(expectedTotal) || expectedTotal < files.length || expectedTotal > MAX_BATCH_FILES) {
      throw new BadRequestException(`单个批次最多上传${MAX_BATCH_FILES}份简历`)
    }
    files.forEach((file) => this.files.validate(file))
    const itemTable = this.database.requireTableId('resume_batch_import_items')
    const timestamp = new Date().toISOString(), operator = String(body.operator || '').trim() || '当前用户'
    const suppressGroupPush = body.suppressGroupPush === true
    let batch: TeableRecord, batchId: string, sequenceOffset = 0
    if (body.batchId) {
      batch = await this.findBatch(body.batchId)
      batchId = String(batch.fields['批次ID'] || batch.id)
      if (String(batch.fields['批次状态'] || '') !== '待处理') throw new ConflictException('该批次已开始处理，不能继续追加文件')
      if (Number(batch.fields['文件总数'] || 0) !== expectedTotal) throw new ConflictException('批次文件总数不一致，请重新上传')
      const existingItems = await this.listBatchItems(batchId, itemTable)
      if (existingItems.length + files.length > expectedTotal) throw new ConflictException('追加文件数量超出批次总数')
      sequenceOffset = existingItems.length
    } else {
      batchId = `batch_${randomUUID().replaceAll('-', '').slice(0, 20)}`
      batch = await teable.createRecord(this.database.requireTableId('resume_batch_imports'), {
        批次ID: batchId, 批次名称: String(body.name || '').trim() || `简历批量导入-${timestamp.slice(0, 16).replace('T', ' ')}`, 文件总数: expectedTotal,
        待处理数: expectedTotal, 处理中数: 0, 成功数: 0, 失败数: 0, 批次状态: '待处理', 创建人用户ID: String(body.operatorUserId || '').trim(), 创建人: operator, 不推送企微群: suppressGroupPush ? '是' : '否',
        创建时间: timestamp, 更新时间: timestamp, 错误摘要JSON: '[]',
      })
    }
    // 并行创建批次项记录，不再逐条串行写入
    const itemFields = files.map((file, index) => {
      const fileName = this.decodeFileName(file.originalname)
      return { 批次项ID: `batchitem_${randomUUID().replaceAll('-', '').slice(0, 20)}`, 批次ID: batchId, 序号: sequenceOffset + index + 1, 文件名: fileName, 文件类型: file.mimetype || extname(fileName), 文件大小: file.size, 处理状态: '待处理', 尝试次数: 0, 不推送企微群: suppressGroupPush ? '是' : '否', 创建时间: timestamp, 更新时间: timestamp }
    })
    // Teable 支持批量写入时一次提交，避免 50 份简历产生 50 次建档往返；
    // 保留单条回退，兼容旧版平台代理和现有测试替身。
    let itemRecords: TeableRecord[]
    if (process.env.NODE_ENV === 'production') {
      try {
      const chunks = Array.from({ length: Math.ceil(itemFields.length / 20) }, (_, index) => ({ index, fields: itemFields.slice(index * 20, index * 20 + 20) }))
      const results = await Promise.all(chunks.map(async ({ index, fields }) => {
        try {
          const records = await teable.createRecords(itemTable, fields)
          if (records.length !== fields.length) throw new Error(`批量写入返回${records.length}条，预期${fields.length}条`)
          return { index, records }
        } catch (error) {
          console.warn(`[ResumeFlow] 第${index * 20 + 1}-${index * 20 + fields.length}条批量写入失败，回退单条写入：${error instanceof Error ? error.message : String(error)}`)
          return { index, records: await Promise.all(fields.map((item) => teable.createRecord(itemTable, item))) }
        }
      }))
      itemRecords = results.sort((left, right) => left.index - right.index).flatMap((item) => item.records)
        if (itemRecords.length !== itemFields.length) throw new Error(`批量写入返回${itemRecords.length}条，预期${itemFields.length}条`)
      } catch (error) {
        console.warn(`[ResumeFlow] 批量写入不可用，回退单条写入：${error instanceof Error ? error.message : String(error)}`)
        itemRecords = await Promise.all(itemFields.map((fields) => teable.createRecord(itemTable, fields)))
      }
    } else {
      itemRecords = await Promise.all(itemFields.map((fields) => teable.createRecord(itemTable, fields)))
    }
    if (body.batchId) {
      await teable.updateRecord(this.database.requireTableId('resume_batch_imports'), batch.id, { 更新时间: new Date().toISOString() })
    }
    return { batchId, recordId: batch.id, record: batch, files, items: itemRecords }
  }

  async prepareBatchSources(batchId: string, items: TeableRecord[], files: Express.Multer.File[], progress?: (message: string) => void) {
    const itemTable = this.database.requireTableId('resume_batch_import_items')
    return this.persistBatchSources(itemTable, items, files, (message) => {
      console.log(`[ResumeFlow batch ${batchId}] ${message}`)
      progress?.(message)
    })
  }

  async startAnalysis(input: ResumeAnalysisStartInput, operator: { operator: string; operatorUserId: string }) {
    const items = (Array.isArray(input.items) ? input.items : []).map((item) => ({
      candidateId: String(item.candidateId || '').trim(),
      resumeId: String(item.resumeId || '').trim(),
      positionId: String(item.positionId || '').trim(),
    })).filter((item) => item.candidateId && item.resumeId)
    if (!items.length) throw new BadRequestException('请选择需要开始AI分析的简历')
    if (items.length > MAX_BATCH_FILES) throw new BadRequestException(`单次最多确认${MAX_BATCH_FILES}份简历`)

    const [positions, applications] = await Promise.all([
      teable.listAllRecords(this.database.requireTableId('recruitment_positions')),
      teable.listAllRecords(this.database.requireTableId('recruitment_applications')),
    ])
    const timestamp = new Date().toISOString()
    let selectedCount = 0
    for (const item of items) {
      const application = applications.find((row) =>
        text(row.fields['候选人ID']) === item.candidateId
        && text(row.fields['简历记录ID']) === item.resumeId
        && text(row.fields['当前状态']) !== '已结束',
      ) || applications.find((row) =>
        text(row.fields['候选人ID']) === item.candidateId
        && text(row.fields['当前状态']) !== '已结束',
      )
      if (!application) throw new NotFoundException(`未找到 ${item.candidateId} 的应聘记录，请重新上传简历`)

      if (item.positionId) {
        const position = positions.find((row) => text(row.fields['职位ID']) === item.positionId || row.id === item.positionId)
        if (!position) throw new BadRequestException('所选岗位不存在，请重新选择')
        const positionId = text(position.fields['职位ID']) || position.id
        const positionName = text(position.fields['职位名称'])
        await teable.updateRecord(this.database.requireTableId('recruitment_applications'), application.id, {
          职位ID: positionId, 更新时间: timestamp,
        })
        await teable.createRecord(this.database.requireTableId('recruitment_stage_events'), {
          事件ID: `evt_${randomUUID().replaceAll('-', '').slice(0, 20)}`, 应聘记录ID: text(application.fields['应聘记录ID']) || application.id,
          候选人ID: item.candidateId, 职位ID: positionId, 原阶段: 'AI分析中', 新阶段: 'AI分析中',
          操作: '上传人选择岗位', 结果: `适配岗位设为${positionName}`, 原因: '上传人在解析完成后人工选择岗位',
          操作人用户ID: operator.operatorUserId, 操作人: operator.operator, 发生时间: timestamp, 来源类型: '人工选择',
        })
        selectedCount++
      }
      this.talents.enqueueAiAnalysis(item.candidateId, item.resumeId, '上传人确认后开始AI分析', '入库自动分析')
    }
    return { total: items.length, selectedCount, queue: this.talents.getAiQueueStatus() }
  }

  async processBatch(batchId: string, files: Express.Multer.File[] = [], progress: (message: string) => void, initialItems?: TeableRecord[], initialBatch?: TeableRecord) {
    // 批次刚创建后可能尚未出现在 Teable 的 listRecords 结果中，
    // 优先使用创建接口已经拿到的主记录，避免后台任务在启动阶段直接退出。
    const batch = initialBatch || await this.findBatch(batchId)
    const itemTable = this.database.requireTableId('resume_batch_import_items')
    const expectedTotal = Number(batch.fields['文件总数'] || files.length)
    // 创建批次时已经拿到的记录直接进入队列，避免刚写入后再次 listRecords 时遇到最终一致性延迟。
    // 只有后台恢复、没有携带内存记录时，才重新从数据库等待批次项。
    const importer = this.batchImporter(batch)
    const items = initialItems?.length
      ? initialItems.slice().sort((a, b) => Number(a.fields['序号'] || 0) - Number(b.fields['序号'] || 0))
      : await this.waitForBatchItems(batchId, itemTable, expectedTotal, progress)
    if (!items.length) throw new Error(`批次没有可处理的文件（预期${expectedTotal}份）`)
    const startedAt = new Date().toISOString()
    await teable.updateRecord(this.database.requireTableId('resume_batch_imports'), batch.id, { 批次状态: '上传中', 开始时间: startedAt, 更新时间: startedAt })

    // 第一阶段：整批保存原始文件。这个阶段只负责上传，不做 OCR、LLM 或人才入库。
    const sourceUrls = await this.persistBatchSources(itemTable, items, files, progress)
    const queue = items.map((item, index) => ({ item, index, sourceUrl: sourceUrls.get(item.id) || '' }))
      .filter((entry) => entry.sourceUrl && String(entry.item.fields['处理状态'] || '') !== '失败')
    if (!queue.length) {
      progress('整批文件均未上传成功，未启动解析队列')
      return this.refreshBatch(batchId, true)
    }

    // 第二阶段：所有可解析文件上传完成后，才启动解析 worker。
    await teable.updateRecord(this.database.requireTableId('resume_batch_imports'), batch.id, { 批次状态: '处理中', 更新时间: new Date().toISOString() })
    progress(`整批文件上传完成，已启动${Math.min(this.batchConcurrency, queue.length)}条解析通道，共${queue.length}份简历`)
    let nextIndex = 0
    const worker = async () => {
      while (nextIndex < queue.length) {
        const index = nextIndex++
        const entry = queue[index]
        try {
          await this.processBatchItem(batchId, itemTable, entry.item, files[entry.index], entry.sourceUrl, entry.index, items.length, progress, importer)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          progress(`第${entry.index + 1}/${items.length}份出现状态更新异常，已继续处理后续文件：${message}`)
          console.error(`[ResumeFlow batch ${batchId}] worker item ${entry.index + 1} failed unexpectedly: ${message}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, this.batchConcurrency), queue.length) }, worker))
    return this.refreshBatch(batchId, true)
  }

  async markBatchFailed(batchId: string, message: string, initialBatch?: TeableRecord) {
    const batch = initialBatch || await this.findBatch(batchId)
    const timestamp = new Date().toISOString()
    await teable.updateRecord(this.database.requireTableId('resume_batch_imports'), batch.id, {
      批次状态: '全部失败', 待处理数: 0, 处理中数: 0, 成功数: 0, 失败数: Number(batch.fields['文件总数'] || 0),
      完成时间: timestamp, 更新时间: timestamp, 错误摘要JSON: JSON.stringify([{ fileName: '', error: message }]),
    })
  }

  /**
   * Teable 写入后列表查询存在短暂最终一致性窗口。
   * 批次创建接口刚返回时，批次项可能还暂时查不到；这里等待到记录可见，
   * 避免把“0 条批次项”误判成空批次并直接完成。
   */
  private async waitForBatchItems(batchId: string, itemTable: string, expectedTotal: number, progress: (message: string) => void) {
    const maxAttempts = 10
    let discovered = 0
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const items = (await this.listBatchItems(batchId, itemTable))
        .sort((a, b) => Number(a.fields['序号'] || 0) - Number(b.fields['序号'] || 0))
      discovered = items.length
      if (items.length >= expectedTotal) return items
      progress(`正在等待批量任务记录就绪（${attempt}/${maxAttempts}）`)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`批量任务项创建后暂时不可见（已发现${discovered}条，预期${expectedTotal}条），请稍后重试`)
  }

  private async persistBatchSources(itemTable: string, items: TeableRecord[], files: Express.Multer.File[], progress: (message: string) => void) {
    const sourceUrls = new Map<string, string>()
    let nextIndex = 0, saved = 0
    const worker = async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++, item = items[index], file = files[index]
        const currentUrl = String(item.fields['原文件地址'] || '')
        if (currentUrl) { sourceUrls.set(item.id, currentUrl); saved += 1; continue }
        const timestamp = new Date().toISOString()
        try {
          if (!file) throw new Error('上传文件未保留，请重新上传该文件')
          await teable.updateRecord(itemTable, item.id, { 处理状态: '上传中', 更新时间: timestamp })
          const stored = await withTimeout(this.files.saveOriginal(file), 45_000, '原始文件保存超时')
          await teable.updateRecord(itemTable, item.id, { 原文件地址: stored.cdnUrl, 处理状态: '待处理', 更新时间: new Date().toISOString() })
          sourceUrls.set(item.id, stored.cdnUrl)
          saved += 1
          progress(`正在安全保存原始简历文件（${saved}/${items.length}）`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          // 保存失败仅影响当前文件；其余文件仍会先完成持久化再进入解析队列。
          await teable.updateRecord(itemTable, item.id, { 处理状态: '失败', 错误信息: `原始文件保存失败：${message}`, 完成时间: timestamp, 更新时间: timestamp }).catch(() => undefined)
          progress(`第${index + 1}/${items.length}份原始文件保存失败，已跳过：${String(item.fields['文件名'] || '')}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, this.batchStorageConcurrency), items.length) }, worker))
    return sourceUrls
  }

  private batchImporter(batch: TeableRecord): ResumeImportContext {
    return {
      operatorUserId: String(batch.fields['创建人用户ID'] || '').trim(),
      operator: String(batch.fields['创建人'] || '').trim() || '系统导入',
      suppressGroupPush: String(batch.fields['不推送企微群'] || '').trim() === '是',
      deferAiAnalysis: false,
    }
  }

  private async processBatchItem(batchId: string, itemTable: string, item: TeableRecord, file: Express.Multer.File | undefined, sourceUrl: string, index: number, total: number, progress: (message: string) => void, importer?: ResumeImportContext) {
    const fileName = this.decodeFileName(file?.originalname || String(item.fields['文件名'] || '未命名简历'))
    progress(`正在处理第${index + 1}/${total}份：${fileName}`)
    const itemStartedAt = new Date().toISOString()
    const controller = new AbortController()
    try {
      await teable.updateRecord(itemTable, item.id, { 处理状态: '处理中', 尝试次数: Number(item.fields['尝试次数'] || 0) + 1, 开始时间: itemStartedAt, 完成时间: '', 错误信息: '', 更新时间: itemStartedAt })
      const workingFile = file || await this.downloadFile(sourceUrl, fileName)
      const result = await withTimeout(this.processPreparedFile(workingFile, sourceUrl, (message) => progress(`第${index + 1}/${total}份：${message}`), '简历上传', controller.signal, importer), this.batchItemTimeoutMs, `单份简历处理超时（${Math.round(this.batchItemTimeoutMs / 1000)}秒），已自动跳过并继续后续文件`, () => controller.abort())
      const completedAt = new Date().toISOString()
      await teable.updateRecord(itemTable, item.id, { 处理状态: '已完成', 简历记录ID: result.id, 候选人ID: result.candidateId, 应聘记录ID: result.applicationId, 是否重复: result.duplicate ? '是' : '否', 疑似重复数: Number(result.suspiciousDuplicateCount || 0), 完成时间: completedAt, 更新时间: completedAt })
    } catch (error) {
      const completedAt = new Date().toISOString(), message = error instanceof Error ? error.message : String(error)
      progress(`第${index + 1}/${total}份失败，已继续处理其他文件：${fileName}`)
      await teable.updateRecord(itemTable, item.id, { 处理状态: '失败', 错误信息: message, 完成时间: completedAt, 更新时间: completedAt }).catch((updateError) => {
        console.error(`[ResumeFlow batch ${batchId}] could not mark item ${item.id} failed: ${updateError instanceof Error ? updateError.message : String(updateError)}`)
      })
    } finally {
      // 每3份或最后一份才刷新批次统计，减少 Teable API 调用量
      if ((index + 1) % 3 === 0 || index + 1 >= total) {
        await this.refreshBatch(batchId).catch((refreshError) => {
          console.error(`[ResumeFlow batch ${batchId}] batch summary refresh failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`)
        })
      }
    }
  }

  async retryBatch(batchId: string, progress: (message: string) => void) {
    const batch = await this.findBatch(batchId)
    const importer = this.batchImporter(batch)
    const itemTable = this.database.requireTableId('resume_batch_import_items')
    const failed = (await this.listBatchItems(batchId, itemTable)).filter((item) => String(item.fields['处理状态'] || '') === '失败' && String(item.fields['原文件地址'] || ''))
    if (!failed.length) throw new BadRequestException('该批次没有已保留原文件的失败项，请重新上传未保留的文件')
    await teable.updateRecord(this.database.requireTableId('resume_batch_imports'), batch.id, { 批次状态: '重试中', 更新时间: new Date().toISOString() })
    for (let index = 0; index < failed.length; index++) {
      const item = failed[index], url = String(item.fields['原文件地址'] || '')
      progress(`正在重试第${index + 1}/${failed.length}份：${item.fields['文件名']}`)
      const startedAt = new Date().toISOString()
      await teable.updateRecord(itemTable, item.id, { 处理状态: '处理中', 尝试次数: Number(item.fields['尝试次数'] || 0) + 1, 开始时间: startedAt, 错误信息: '', 更新时间: startedAt })
      const controller = new AbortController()
      try {
        const result = await withTimeout((async () => {
          if (!url) throw new Error('原始文件上传失败，无法自动重试，请重新选择该文件上传')
          const file = await this.downloadFile(url, String(item.fields['文件名'] || 'resume'))
          return this.processPreparedFile(file, url, (message) => progress(`重试第${index + 1}/${failed.length}份：${message}`), '简历上传', controller.signal, importer)
        })(), this.batchItemTimeoutMs, `重试超时（${Math.round(this.batchItemTimeoutMs / 1000)}秒），已跳过该文件`, () => controller.abort())
        const completedAt = new Date().toISOString()
        await teable.updateRecord(itemTable, item.id, { 处理状态: '已完成', 简历记录ID: result.id, 候选人ID: result.candidateId, 应聘记录ID: result.applicationId, 是否重复: result.duplicate ? '是' : '否', 疑似重复数: Number(result.suspiciousDuplicateCount || 0), 完成时间: completedAt, 更新时间: completedAt })
      } catch (error) {
        const completedAt = new Date().toISOString()
        await teable.updateRecord(itemTable, item.id, { 处理状态: '失败', 错误信息: error instanceof Error ? error.message : String(error), 完成时间: completedAt, 更新时间: completedAt })
      }
      await this.refreshBatch(batchId)
    }
    return this.refreshBatch(batchId, true)
  }

  async batchDetail(batchId: string) {
    // 查询详情时不再每次都触发中断恢复——只有批次仍在处理中且无活跃项时才检查
    const batch = await this.findBatch(batchId)
    const itemTable = this.database.requireTableId('resume_batch_import_items')
    const items = (await this.listBatchItems(batchId, itemTable)).sort((a, b) => Number(a.fields['序号'] || 0) - Number(b.fields['序号'] || 0)).map((item) => this.mapBatchItem(item))
    // 仅在批次状态为处理中且所有项都不在处理中时才尝试恢复（可能已中断）
    const batchStatus = String(batch.fields['批次状态'] || '')
    if (batchStatus === '处理中' && items.some((item) => item.status === '待处理' || item.status === '处理中')) {
      await this.recoverInterruptedBatch(batch).catch(() => undefined)
      // 重新加载恢复后的最新状态
      const refreshedItems = (await this.listBatchItems(batchId, itemTable)).sort((a, b) => Number(a.fields['序号'] || 0) - Number(b.fields['序号'] || 0)).map((item) => this.mapBatchItem(item))
      items.length = 0
      items.push(...refreshedItems)
    }
    const total = Number(batch.fields['文件总数'] || items.length)
    // 兼容历史批次或 Teable 短暂返回空状态：空/未知状态都应视为待处理，不能被统计漏掉。
    const pending = items.filter((item) => !['上传中', '处理中', '已完成', '失败'].includes(item.status)).length
    const running = items.filter((item) => ['上传中', '处理中'].includes(item.status)).length
    const succeeded = items.filter((item) => item.status === '已完成').length
    const failed = items.filter((item) => item.status === '失败').length
    const uploaded = items.filter((item) => Boolean(item.sourceUrl)).length
    const retryable = items.filter((item) => item.status === '失败' && item.sourceUrl).length
    const needsReupload = items.filter((item) => item.status === '失败' && !item.sourceUrl).length
    const storedStatus = String(batch.fields['批次状态'] || '')
    const status = items.length < total
      ? storedStatus === '待处理' ? '待处理' : '处理中'
      : pending + running > 0
        ? (items.some((item) => item.status === '上传中') ? '上传中' : '处理中')
        : failed > 0
          ? (succeeded > 0 ? '部分失败' : '全部失败')
          : succeeded === total && total > 0
            ? '已完成'
            : storedStatus || '待处理'
    return { id: batchId, name: String(batch.fields['批次名称'] || ''), status, total, uploaded, pending, running, succeeded, failed, retryable, needsReupload, creator: String(batch.fields['创建人'] || ''), createdAt: String(batch.fields['创建时间'] || ''), startedAt: String(batch.fields['开始时间'] || ''), completedAt: String(batch.fields['完成时间'] || ''), items }
  }

  async listBatches(limit = 10) {
    const tableId = this.database.requireTableId('resume_batch_imports')
    const take = Math.max(1, Math.min(50, Math.round(Number(limit) || 10)))
    const rows = await teable.listRecords(tableId, {
      take,
      orderBy: [{ field: '更新时间', order: 'desc' }],
      fields: ['批次ID', '批次名称', '批次状态', '文件总数', '成功数', '失败数', '创建人', '创建时间', '更新时间'],
    })
    const timestamp = (row: TeableRecord) => Date.parse(String(row.fields['更新时间'] || row.fields['创建时间'] || '')) || 0
    return rows
      .sort((a, b) => timestamp(b) - timestamp(a))
      .map((row) => ({
        id: String(row.fields['批次ID'] || row.id),
        name: this.decodeFileName(String(row.fields['批次名称'] || '未命名批次')),
        status: String(row.fields['批次状态'] || '处理中'),
        total: Number(row.fields['文件总数'] || 0),
        succeeded: Number(row.fields['成功数'] || 0),
        failed: Number(row.fields['失败数'] || 0),
        creator: String(row.fields['创建人'] || ''),
        createdAt: String(row.fields['创建时间'] || ''),
        updatedAt: String(row.fields['更新时间'] || row.fields['创建时间'] || ''),
      }))
  }

  async exportBatch(batchId: string) {
    const detail = await this.batchDetail(batchId)
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const header = ['序号', '文件名', '文件类型', '文件大小', '处理状态', '尝试次数', '候选人ID', '简历记录ID', '应聘记录ID', '是否重复', '疑似重复数', '错误信息', '完成时间']
    const rows = detail.items.map((item: any) => [item.sequence, item.fileName, item.fileType, item.fileSize, item.status, item.attempts, item.candidateId, item.resumeId, item.applicationId, item.duplicate, item.suspiciousDuplicates, item.error, item.completedAt])
    return Buffer.from(`\uFEFF${[header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')}`, 'utf8')
  }

  async pushBatchToWecom(batchId: string, progress: (message: string) => void) {
    const detail = await this.batchDetail(batchId)
    const succeeded = detail.items.filter((item: any) => item.status === '已完成' && item.candidateId)
    if (!succeeded.length) { progress('批次中没有成功解析的简历，跳过企微推送'); return }
    progress(`开始推送${succeeded.length}份简历到企微群…`)
    let pushed = 0, failed = 0
    for (const item of succeeded) {
      try {
        await this.talents.shareForWecomReview(item.candidateId, { operator: '批量导入人工推送', operatorUserId: '', applicationId: item.applicationId, sendMessage: true })
        pushed += 1
        progress(`已推送 ${pushed}/${succeeded.length} 份简历到企微群`)
      } catch (error) {
        failed += 1
        const msg = error instanceof Error ? error.message : String(error)
        progress(`第${item.sequence}份推送企微失败：${msg}`)
      }
    }
    progress(`企微推送完成：成功${pushed}份，失败${failed}份`)
  }

  private async findBatch(batchId: string) {
    const tableId = this.database.requireTableId('resume_batch_imports')
    let batch: TeableRecord | undefined
    try {
      batch = await teable.getRecord(tableId, batchId)
    } catch {
      batch = await teable.findOneByField(tableId, '批次ID', batchId)
      // 某些旧平台代理/测试替身会忽略 TQL；不要把别的批次误当成目标批次。
      if (batch && String(batch.fields['批次ID'] || '') !== batchId) {
        batch = (await this.listAllRecords(tableId)).find((row) => String(row.fields['批次ID'] || row.id) === batchId)
      }
    }
    if (!batch) throw new NotFoundException('批量导入任务不存在')
    return batch
  }

  /**
   * Teable 列表接口单次默认最多返回 1000 条。批量导入明细长期累计后，
   * 新批次会排在首个 1000 条之外；此前因此出现“人才已入库，但进度永远 0%”。
   * 这里完整分页读取，避免在内存中拿不全记录后再按批次过滤。
   */
  private async listAllRecords(tableId: string) {
    const pageSize = 1000
    const records: TeableRecord[] = []
    for (let skip = 0; ; skip += pageSize) {
      const page = await teable.listRecords(tableId, { take: pageSize, skip })
      records.push(...page)
      if (page.length < pageSize) break
    }
    return records
  }

  private async listBatchItems(batchId: string, itemTable = this.database.requireTableId('resume_batch_import_items')) {
    const rows = await teable.listByField(itemTable, '批次ID', batchId, 1000)
    const matched = rows.filter((row) => String(row.fields['批次ID'] || '') === batchId)
    if (matched.length || rows.length < 1000) return matched
    // 兼容旧版平台代理忽略 filterByTql 的情况：只有在第一页无法命中目标批次时，
    // 才分页兜底，避免每次正常查询都拉取整张明细表。
    return (await this.listAllRecords(itemTable)).filter((row) => String(row.fields['批次ID'] || '') === batchId)
  }

  private async recoverInterruptedBatch(batch: TeableRecord) {
    const batchId = String(batch.fields['批次ID'] || batch.id)
    const itemTable = this.database.requireTableId('resume_batch_import_items')
    const items = await this.listBatchItems(batchId, itemTable)
    const cutoff = Date.now() - this.batchItemTimeoutMs - 30_000
    const processing = items.filter((item) => String(item.fields['处理状态'] || '') === '处理中')
    const stale = processing.filter((item) => {
      const startedAt = Date.parse(String(item.fields['开始时间'] || ''))
      return Number.isFinite(startedAt) && startedAt < cutoff
    })
    const active = processing.filter((item) => !stale.includes(item))
    if (!stale.length || active.length) return

    const timestamp = new Date().toISOString()
    const interrupted = items.filter((item) => String(item.fields['处理状态'] || '') === '待处理')
    await Promise.all([
      ...stale.map((item) => teable.updateRecord(itemTable, item.id, {
        处理状态: '失败', 错误信息: '单份简历处理超时或后台任务已中断，请点击重试失败文件。', 完成时间: timestamp, 更新时间: timestamp,
      })),
      ...interrupted.map((item) => teable.updateRecord(itemTable, item.id, {
        处理状态: '失败',
        错误信息: String(item.fields['原文件地址'] || '')
          ? '批量任务在此文件开始前已中断，原文件已保留在后台，可点击重试失败文件继续解析。'
          : '批量任务在此文件开始前已中断，原文件未保留在后台，请重新上传该文件。',
        完成时间: timestamp, 更新时间: timestamp,
      })),
    ])
    const succeeded = items.filter((item) => String(item.fields['处理状态'] || '') === '已完成').length
    const failed = items.filter((item) => ['失败', '处理中', '待处理'].includes(String(item.fields['处理状态'] || ''))).length
    await teable.updateRecord(this.database.requireTableId('resume_batch_imports'), batch.id, {
      待处理数: 0, 处理中数: 0, 成功数: succeeded, 失败数: failed,
      批次状态: succeeded ? '部分失败' : '全部失败', 完成时间: timestamp, 更新时间: timestamp,
      错误摘要JSON: JSON.stringify([...stale, ...interrupted].map((item) => ({ fileName: item.fields['文件名'], error: String(item.fields['处理状态'] || '') === '处理中' ? '单份简历处理超时或后台任务已中断' : String(item.fields['原文件地址'] || '') ? '任务中断前未开始处理，原文件已保留，可重试' : '任务中断前未开始处理，请重新上传' }))),
    })
  }

  private refreshBatch(batchId: string, complete = false) {
    const previous = this.batchRefreshLocks.get(batchId) || Promise.resolve()
    const task = previous.catch(() => undefined).then(() => this.refreshBatchNow(batchId, complete))
    this.batchRefreshLocks.set(batchId, task)
    return task.finally(() => {
      if (this.batchRefreshLocks.get(batchId) === task) this.batchRefreshLocks.delete(batchId)
    })
  }

  private async refreshBatchNow(batchId: string, complete = false) {
    const batch = await this.findBatch(batchId), items = await this.listBatchItems(batchId)
    const counts = {
      pending: items.filter((item) => !['上传中', '处理中', '已完成', '失败'].includes(String(item.fields['处理状态'] || ''))).length,
      running: items.filter((item) => ['上传中', '处理中'].includes(String(item.fields['处理状态'] || ''))).length,
      succeeded: items.filter((item) => String(item.fields['处理状态'] || '') === '已完成').length,
      failed: items.filter((item) => String(item.fields['处理状态'] || '') === '失败').length,
    }
    const finished = complete || counts.pending + counts.running === 0
    const status = finished ? counts.failed ? counts.succeeded ? '部分失败' : '全部失败' : '已完成' : String(batch.fields['批次状态'] || '处理中')
    const timestamp = new Date().toISOString()
    await teable.updateRecord(this.database.requireTableId('resume_batch_imports'), batch.id, { 待处理数: counts.pending, 处理中数: counts.running, 成功数: counts.succeeded, 失败数: counts.failed, 批次状态: status, 完成时间: finished ? timestamp : batch.fields['完成时间'], 更新时间: timestamp, 错误摘要JSON: JSON.stringify(items.filter((item) => String(item.fields['处理状态'] || '') === '失败').map((item) => ({ fileName: item.fields['文件名'], error: item.fields['错误信息'] }))) })
    return this.batchDetail(batchId)
  }

  private mapBatchItem(row: TeableRecord) {
    return { id: String(row.fields['批次项ID'] || row.id), sequence: Number(row.fields['序号'] || 0), fileName: this.decodeFileName(String(row.fields['文件名'] || '')), fileType: String(row.fields['文件类型'] || ''), fileSize: Number(row.fields['文件大小'] || 0), sourceUrl: String(row.fields['原文件地址'] || ''), status: String(row.fields['处理状态'] || ''), attempts: Number(row.fields['尝试次数'] || 0), resumeId: String(row.fields['简历记录ID'] || ''), candidateId: String(row.fields['候选人ID'] || ''), applicationId: String(row.fields['应聘记录ID'] || ''), duplicate: String(row.fields['是否重复'] || ''), suspiciousDuplicates: Number(row.fields['疑似重复数'] || 0), error: String(row.fields['错误信息'] || ''), createdAt: String(row.fields['创建时间'] || ''), startedAt: String(row.fields['开始时间'] || ''), completedAt: String(row.fields['完成时间'] || '') }
  }

  private async performWordConversion(row: TeableRecord, body: { force?: boolean; operator?: string; operatorUserId?: string }) {
    const operator = String(body.operator || '').trim() || '当前用户'
    const startedAt = new Date().toISOString()
    const version = Math.max(1, Number(row.fields['Word转换版本'] || 0) + 1)
    await teable.updateRecord(this.table(), row.id, { Word转换状态: '转换中', Word转换错误: '', 更新时间: startedAt })
    try {
      const resume = this.fromTeable(row)
      const bytes = await this.word.create(resume)
      const safeName = (resume.name || '未识别姓名').replace(/[^\p{L}\p{N}._-]+/gu, '_')
      const filename = `${safeName}-图片简历可编辑版-v${version}.docx`
      const stored = await storage.upload(`resumes/editable/${Date.now()}_${filename}`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes)
      const completedAt = new Date().toISOString()
      const fields = { 可编辑Word文件名: filename, 可编辑Word地址: stored.cdnUrl, Word转换状态: '已完成', Word转换错误: '', Word转换版本: version, Word转换人用户ID: String(body.operatorUserId || '').trim(), Word转换人: operator, Word转换时间: completedAt, 更新时间: completedAt }
      const updated = await teable.updateRecord(this.table(), row.id, fields)
      await this.resumeAudit('图片简历转可编辑Word', row, fields, operator, body.force ? '人工重新生成可编辑Word' : '首次生成可编辑Word')
      return this.fromTeable(updated)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await teable.updateRecord(this.table(), row.id, { Word转换状态: '转换失败', Word转换错误: message, 更新时间: new Date().toISOString() })
      await this.resumeAudit('图片简历转可编辑Word失败', row, { status: '转换失败', error: message }, operator, message, '失败')
      throw new ServiceUnavailableException(`可编辑Word生成失败：${message}`)
    }
  }

  private async resumeAudit(action: string, before: TeableRecord, after: unknown, operator: string, reason: string, result = '成功') {
    await teable.createRecord(this.database.requireTableId('recruitment_audit_logs'), {
      日志ID: `audit_${randomUUID().replaceAll('-', '').slice(0, 20)}`, 操作人: operator, 操作类型: action, 对象类型: '简历解析记录',
      对象ID: String(before.fields['解析记录ID'] || before.id), 修改前摘要JSON: JSON.stringify({ sourceFileName: before.fields['源文件名'], wordUrl: before.fields['可编辑Word地址'], wordVersion: before.fields['Word转换版本'] }),
      修改后摘要JSON: JSON.stringify(after), 操作原因: reason, 请求ID: `req_${randomUUID().replaceAll('-', '').slice(0, 20)}`, 发生时间: new Date().toISOString(), 操作结果: result, 错误信息: result === '成功' ? '' : reason,
    })
  }

  async processFile(file: Express.Multer.File, progress: (message: string) => void, sourceType = '简历上传', importer?: ResumeImportContext) {
    this.files.validate(file)
    progress('正在保存原始简历文件')
    const stored = await this.files.saveOriginal(file)
    return this.processPreparedFile(file, stored.cdnUrl, progress, sourceType, undefined, importer)
  }

  private async processPreparedFile(file: Express.Multer.File, sourceUrl: string, progress: (message: string) => void, sourceType = '简历上传', signal?: AbortSignal, importer?: ResumeImportContext) {
    signal?.throwIfAborted()
    const qualityWarnings: string[] = []
    const rawText = await this.files.extractText(file, sourceUrl, progress, message => qualityWarnings.push(message), signal)
    signal?.throwIfAborted()
    progress('正在提取候选人结构化信息')
    const extracted = await this.extract(rawText)
    signal?.throwIfAborted()
    const sourceFileName = this.decodeFileName(file.originalname)
    const normalized = this.normalize(extracted, rawText, sourceFileName)
    normalized.qualityWarnings = [...new Set([...qualityWarnings, ...readQualityWarnings(extracted.qualityWarnings), ...resumeQualityWarnings(normalized, rawText)])]
    if (normalized.qualityWarnings.length) progress(`解析完成，有${normalized.qualityWarnings.length}项需在简历详情中复核`)
    const fingerprint = this.fingerprint(rawText)
    progress('正在写入人才档案数据库')
    // 头像是增强信息：提取失败不会影响简历解析、入库或后续人才流程。
    const avatarUrl = typeof (this.files as any).extractAvatar === 'function'
      ? await (this.files as any).extractAvatar(file).catch(() => '')
      : ''
    signal?.throwIfAborted()
    const resume = await this.upsertWithLock(fingerprint, normalized, sourceFileName, sourceUrl, rawText, avatarUrl)
    signal?.throwIfAborted()
    const talent = await this.talents.ingestResume({
      ...resume,
      sourceType,
      suppressGroupPush: importer?.suppressGroupPush === true,
      deferAiAnalysis: importer?.deferAiAnalysis === true,
      importedById: String(importer?.operatorUserId || '').trim(),
      importedBy: String(importer?.operator || '').trim() || '系统导入',
    })
    const version = await this.ensureResumeVersion(resume, talent.candidateId, { fileName: sourceFileName, contentType: file.mimetype, size: file.size }, importer)
    progress('简历基础信息已入库')
    return { ...resume, ...talent, resumeVersion: version }
  }

  async processUrl(fileUrl: string, fileName: string, progress: (message: string) => void, sourceType = '简历上传', importer?: ResumeImportContext) {
    const file = await this.downloadFile(fileUrl, fileName)
    return this.processFile(file, progress, sourceType, importer)
  }

  private async downloadFile(fileUrl: string, fileName: string): Promise<Express.Multer.File> {
    if (!/^https:\/\//i.test(fileUrl)) throw new BadRequestException('fileUrl 必须是 HTTPS 地址')
    const response = await fetch(fileUrl, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new BadRequestException(`原始文件无法读取 (${response.status})`)
    if (Number(response.headers.get('content-length')) > MAX_FILE_SIZE) {
      await response.body?.cancel()
      throw new BadRequestException('简历文件不能超过 10MB')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new BadRequestException('原始文件为空')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.length
        if (size > MAX_FILE_SIZE) { await reader.cancel(); throw new BadRequestException('简历文件不能超过 10MB') }
        chunks.push(chunk.value)
      }
    } finally { reader.releaseLock() }
    const file = { originalname: fileName, mimetype: response.headers.get('content-type') || 'application/octet-stream', size, buffer: Buffer.concat(chunks) } as Express.Multer.File
    this.files.validate(file)
    return file
  }

  private async extract(rawText: string): Promise<ResumeExtraction> {
    const fallback = this.ruleExtract(rawText)
    const prompt = `你是简历结构化抽取器。只能依据原文，不得编造。先识别简历分区，再按分区抽取，不要把正文标题、公司名、岗位名、学校名当成姓名。返回纯 JSON，不要 Markdown。字段固定为：name(string), gender(string), age(number|null), phone(string), email(string), wechat(string), address(string), selfEvaluation(string), skillsCertificates(string), educationBackground(string), workExperience(string), jobIntention(string), yearsOfExperience(string), currentCompany(string), currentRole(string)。skillsCertificates保留技能、工具、证书并用顿号分隔；educationBackground保留学校、专业、学历和时间；workExperience按时间倒序保留公司、职位、时间和主要职责/成果；jobIntention只填岗位或求职方向，不要填城市、薪资或整段句子。没有的信息用空字符串或 null。gender只能填写“男”或“女”，原文没有明确性别时返回空字符串，不能根据姓名、岗位、行业、照片或语气推断。address字段应从期望城市、现居城市或地址中提取。currentCompany和currentRole必须取工作经历中时间最新的一段；如果没有工作经历则取最近实习/校园组织，再没有就返回空字符串，不要编造。name只能填写自然人真实姓名；个人优势、工作经历、教育经历、专业技能、自我评价、求职意向、全部行业、行业不限等文本绝对不能作为姓名，无法确认时name返回空字符串。\n\n简历原文：\n${rawText.slice(0, 24000)}`
    try {
      const answer = await withTimeout(llm.chat([{ role: 'user', content: prompt }]), 30_000, '大模型提取超时')
      const cleaned = answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      const parsed = JSON.parse(cleaned)
      const validated = this.validateExtraction(parsed)
      const merged = { ...fallback } as ResumeExtraction
      for (const key of Object.keys(merged) as Array<keyof ResumeExtraction>) {
        const value = validated[key]
        if (key === 'age') merged.age = typeof value === 'number' && value > 0 ? value : fallback.age
        else if (typeof value === 'string' && value.trim()) (merged as any)[key] = value
      }
      merged.phone = fallback.phone
      merged.email = fallback.email
      merged.gender = fallback.gender
      merged.age = fallback.age
      // LLM 有时会漏抽长文本分区；规则提取有值而 LLM 为空时回退，避免详情/列表空工作经历。
      for (const sectionKey of ['workExperience', 'educationBackground', 'skillsCertificates', 'selfEvaluation'] as const) {
        if (!merged[sectionKey]?.trim()) (merged as any)[sectionKey] = fallback[sectionKey]
      }
      if (!merged.currentCompany?.trim()) merged.currentCompany = fallback.currentCompany
      if (!merged.currentRole?.trim()) merged.currentRole = fallback.currentRole
      if (!merged.yearsOfExperience?.trim()) merged.yearsOfExperience = fallback.yearsOfExperience
      for (const sectionKey of ['workExperience', 'educationBackground', 'selfEvaluation', 'skillsCertificates'] as const) {
        if (fallback[sectionKey]) merged[sectionKey] = fallback[sectionKey]
      }
      merged.qualityWarnings = []
      if (validated.age && validated.age !== fallback.age || validated.gender && validated.gender !== fallback.gender) merged.qualityWarnings.push('AI年龄或性别与原文明确表述不一致，已回退原文结果；缺失信息不推测。')
      const compactSource = rawText.normalize('NFKC').replace(/\s+/g, '')
      for (const key of ['currentCompany', 'currentRole'] as const) {
        if (merged[key] && !compactSource.includes(merged[key].normalize('NFKC').replace(/\s+/g, ''))) {
          merged[key] = fallback[key]
          merged.qualityWarnings.push('AI提取的最近公司或职位无法在原文验证，已回退原文规则结果，请复核。')
        }
      }
      if (!fallback.workExperience && dateTokens(merged.workExperience).some(date => !dateTokens(rawText).includes(date))) {
        merged.workExperience = ''
        merged.qualityWarnings.push('AI工作经历包含原文没有的日期，已停止采用该段结果，请根据原件补充经历。')
      }
      if (validated.phone && validated.phone !== fallback.phone || validated.email && validated.email !== fallback.email) merged.qualityWarnings.push('AI联系方式与原文不一致，已使用原文可验证的联系方式，请复核。')
      if (rawText.length > 24000) merged.qualityWarnings.push('简历超过AI单次处理长度，已保留完整原文及规则分区；无明确标题的尾部内容请人工复核。')
      if (fallback.currentCompany) { merged.currentCompany = fallback.currentCompany; merged.currentRole = fallback.currentRole }
      return merged
    } catch (error) {
      console.warn(`[resume-extract] LLM extraction failed, using rule fallback: ${error instanceof Error ? error.message : String(error)}`)
      return { ...fallback, qualityWarnings: ['AI结构化提取失败，已使用规则提取保留原文，请复核各字段。'] }
    }
  }

  private validateExtraction(value: any): ResumeExtraction {
    const result = emptyExtraction()
    for (const key of Object.keys(result) as Array<keyof ResumeExtraction>) {
      if (key === 'age') result.age = Number.isInteger(value?.age) && value.age > 0 && value.age < 100 ? value.age : null
      else (result as any)[key] = typeof value?.[key] === 'string' ? value[key].trim() : ''
    }
    return result
  }

  private ruleExtract(text: string): ResumeExtraction {
    const normalized = text.normalize('NFKC')
    const contact = this.extractContacts(normalized)
    const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const labeledName = normalized.match(/(?:姓名|Name)\s*[:：]?\s*([\u4e00-\u9fa5·]{2,8})/i)?.[1]
    const probableName = this.nameFromText(normalized)
    const ageMatch = normalized.match(/(?:年龄|Age)\s*[:：]?\s*(\d{1,2})/i) || normalized.match(/(\d{1,2})\s*岁/)
    const wechat = normalized.match(/(?:微信|WeChat)\s*[:：]?\s*([A-Za-z][\w-]{5,19})/i)?.[1] || ''
    const address = normalized.match(/(?:地址|现居住地|所在地|期望城市|现居城市|所在城市|城市)\s*[:：]?\s*([^\n\s]{2,30})/)?.[1]?.trim() || ''
    return {
      ...emptyExtraction(), name: labeledName || probableName, gender: this.normalizeGender('', normalized), age: ageMatch ? Number(ageMatch[1]) : null,
      phone: contact.phone, email: contact.email, wechat, address,
      selfEvaluation: this.section(normalized, ['自我评价', '个人优势', '个人评价', '个人视窗', '核心业绩', 'Summary']),
      skillsCertificates: this.section(normalized, ['技能证书', '资格证书', '技能与证书', '专业技能', '技能特长', '培训与认证', '技能', 'Skills', 'Certifications']),
      educationBackground: this.section(normalized, ['教育背景', '教育经历', 'Education']),
      workExperience: this.section(normalized, ['工作经历', '工作经验', '职业经历', '工作履历', '实习经历', 'Work Experience', 'Professional Experience', 'Employment History']),
      jobIntention: normalized.match(/(?:求职意向|目标岗位|应聘职位|期望职位|求职方向)[ \t]*[:：]?[ \t]*([^\n|｜;；]{2,60})/)?.[1]?.trim() || '',
      yearsOfExperience: normalized.match(/(?:工作年限|工作经验)[ \t]*[:：][ \t]*(\d{1,2}(?:\.\d)?\s*年(?:以上)?)/)?.[1]?.trim() || normalized.match(/(\d{1,2}(?:\.\d)?\s*年(?:以上)?)\s*工作经验/)?.[1]?.trim() || '',
      currentCompany: this.currentExperience(normalized).company,
      currentRole: this.currentExperience(normalized).role,
    }
  }

  private section(text: string, names: string[]) {
    const headings = ['教育背景', '教育经历', '工作经历', '工作经验', '职业经历', '工作履历', '实习经历', '项目经历', '项目经验', '专业技能', '技能证书', '资格证书', '技能与证书', '技能特长', '培训与认证', '技能', '求职意向', '自我评价', '个人优势', '个人评价', '个人视窗', '核心业绩', '获奖经历', '培训经历', 'Education', 'Work Experience', 'Professional Experience', 'Employment History', 'Projects', 'Skills', 'Certifications', 'Summary', 'References']
    const labelPattern = (label: string) => /^[\u3400-\u9fff]+$/.test(label) ? [...label].join('[ \\t]*') : label.replace(/ /g, '[ \\t]+')
    const pattern = (labels: string[]) => new RegExp(`^[ \\t]*(?:[一二三四五六七八九十\\d]+[、.．][ \\t]*)?[【\\[]?(?:${labels.map(labelPattern).join('|')})[】\\]]?[ \\t]*(?:[:：][ \\t]*|(?=\\n|$))`, 'gmi')
    const normalized = text.replace(/\r\n?/g, '\n').replace(/\f/g, '\n')
    const sections: string[] = []
    for (const start of normalized.matchAll(pattern(names))) {
      const remaining = normalized.slice(start.index! + start[0].length)
      const next = pattern(headings).exec(remaining)
      const content = (next ? remaining.slice(0, next.index) : remaining).trim()
      if (content) sections.push(content)
    }
    return [...new Set(sections)].join('\n\n')
  }

  private currentExperience(text: string) {
    const workText = this.section(text, ['工作经历', '工作经验', '职业经历', '工作履历', '实习经历', 'Work Experience', 'Professional Experience', 'Employment History'])
    const source = workText
    const lines = source.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean)
    const pattern = /^(?:\d+[.、]\s*)?([^，,。；;｜|\n]{2,40}?)\s*([，,｜|\s]+)\s*([^，,。；;｜|\n]{2,30}?)\s*(?:\d{4}|20\d{2}|\d{1,2}\s*[-—~至到])/
    const dated = lines.map(line => ({ line, date: line.match(/((?:19|20)\d{2})[.\-/年](\d{1,2})/) }))
      .sort((left, right) => Number(/至今|present|current/i.test(right.line)) - Number(/至今|present|current/i.test(left.line)) || (Number(right.date?.[1] || 0) * 12 + Number(right.date?.[2] || 0)) - (Number(left.date?.[1] || 0) * 12 + Number(left.date?.[2] || 0)))
    for (const { line } of dated) {
      const columns = line.split(/[ \t]{2,}/).map(value => value.trim()).filter(Boolean)
      if (columns.length >= 3) {
        const company = columns[0].replace(/\s*[·•]\s*\d+\s*人\s*$/, '').trim()
        const role = columns[1]
        if (company && role && company.length <= 40 && role.length <= 40 && !/^(?:公司名称|职位名称|单位|部门)$/.test(company)) return { company, role }
      }
      const match = line.match(pattern)
      const company = match?.[1]?.trim()
      const role = match?.[3]?.trim()
      if (company && role && !/^(?:公司名称|职位名称|单位|部门)$/.test(company)) return { company, role }
    }
    return { company: '', role: '' }
  }

  extractContacts(input: string) {
    const text = input.normalize('NFKC').replace(/[｜|/\\,，;；—–-]+/g, ' ')
    const glued = text.match(/(?:\+?86)?(1[3-9]\d{9})([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/)
    const labeledPhone = text.match(/(?:手机(?:号码)?|联系电话|电话|Mobile|Phone|Tel)[ \t]*[:：]?[ \t]*(?:\+?86[ \t]*)?(1[3-9](?:[ \t]*\d){9})(?!\d)/i)?.[1]?.replace(/[ \t]/g, '')
    let phone = labeledPhone || glued?.[1] || text.match(/(?:^|\D)(?:\+?86\s*)?(1[3-9]\d{9})(?!\d)/)?.[1] || ''
    const spacedEmail = text.match(/([A-Za-z0-9._%+-]+\s+@\s*[A-Za-z0-9.-]+\s+\.\s+[A-Za-z]{2,})/)?.[1] || ''
    let email = glued?.[2] || text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] || spacedEmail.replace(/\s+/g, '')
    const emailLocal = email.split('@')[0]
    if (!phone && /^1[3-9]\d{9}.+/.test(emailLocal)) {
      phone = emailLocal.slice(0, 11)
      email = `${emailLocal.slice(11)}@${email.split('@').slice(1).join('@')}`
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) phone = ''
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) email = ''
    return { phone, email }
  }

  private normalize(value: ResumeExtraction, rawText: string, fileName = ''): ResumeExtraction {
    const contacts = this.extractContacts(rawText)
    const textName = this.nameFromText(rawText)
    const fileNameName = this.nameFromFileName(fileName)
    const extractedName = this.nameFromTrustedSource(value.name, textName, fileNameName)
    const name = extractedName || textName || fileNameName
    return {
      ...emptyExtraction(), ...value,
      name, gender: this.normalizeGender(value.gender, rawText), age: value.age && value.age > 0 && value.age < 100 ? Math.round(value.age) : null,
      phone: contacts.phone, email: contacts.email,
    }
  }

  private normalizeGender(value: unknown, rawText = '') {
    const input = String(value || '').normalize('NFKC').trim().toLowerCase()
    if (/^(男|男性|male|m)$/.test(input)) return '男'
    if (/^(女|女性|female|f)$/.test(input)) return '女'
    const text = String(rawText || '').normalize('NFKC')
    const labeled = text.match(/(?:性\s*别|gender)\s*[:：|｜]?\s*(男|男性|女|女性|male|female|m|f)(?=$|[\s|｜,，;；/\\岁年])/i)?.[1]
    if (/^(男|男性|male|m)$/i.test(labeled || '')) return '男'
    if (/^(女|女性|female|f)$/i.test(labeled || '')) return '女'
    const standalone = text.match(/(?:^|[\s|｜])([男女])(?=\s*[|｜,:：]?\s*(?:\d{1,2}\s*岁|年龄|年|性\s*别|$))/)?.[1]
    if (standalone) return standalone
    return ''
  }

  private cleanName(value: unknown) {
    const name = String(value || '').normalize('NFKC').replace(/\s+/g, '').replace(/^[姓名Name:：]+/i, '')
      .replace(/^[\s\u3000、，,.。．：:;；·•・—–_\-]+|[\s\u3000、，,.。．：:;；·•・—–_\-]+$/g, '').trim()
    if (!/^[\u3400-\u9fff·]{2,6}$/.test(name)) return ''
    if (INVALID_NAME_HEADINGS.has(name) || INVALID_NAME_VALUES.has(name) || INVALID_NAME_PARTS.test(name) || INVALID_NAME_SUFFIX.test(name)) return ''
    // “张先”“刘女”这类值通常是“张先生”“刘女士”被 OCR 截断，
    // 单字姓后跟称谓残片不能视为完整姓名。
    if (/^[\u3400-\u9fff](?:先|女)$/.test(name)) return ''
    const validationName = [...name].map((character) => TRADITIONAL_SURNAME_MAP[character] || character).join('')
    const surnameLength = COMMON_COMPOUND_SURNAMES.some((surname) => validationName.startsWith(surname)) ? 2 : COMMON_CHINESE_SURNAMES.has(validationName[0]) ? 1 : 0
    if (!surnameLength || name.replaceAll('·', '').length - surnameLength < 1 || name.replaceAll('·', '').length - surnameLength > 3) return ''
    return name
  }

  private comparableName(value: unknown) {
    const name = this.cleanName(value)
    return name ? [...name].map((character) => TRADITIONAL_SURNAME_MAP[character] || character).join('') : ''
  }

  private nameFromTrustedSource(value: unknown, textName: string, fileNameName: string) {
    const candidate = this.cleanName(value)
    if (!candidate) return ''
    const comparable = this.comparableName(candidate)
    return comparable && [textName, fileNameName].some((name) => this.comparableName(name) === comparable) ? candidate : ''
  }

  private nameFromExplicitSegment(value: unknown) {
    const segment = String(value || '').normalize('NFKC').replace(/\s+/g, '').trim()
    const direct = this.cleanName(segment)
    if (direct) return direct
    const patterns = [
      /^([\u3400-\u9fff·]{2,6}?)(?:女士|先生|小姐|老师|同学)(?:简历)?$/,
      /^([\u3400-\u9fff·]{2,6}?)(?:的|完整|个人)?(?:简历|求职意向|理由)$/,
    ]
    for (const pattern of patterns) {
      const match = segment.match(pattern)
      const candidate = this.cleanName(match?.[1])
      if (candidate) return candidate
    }
    return ''
  }

  private nameFromText(rawText: string) {
    const text = rawText.normalize('NFKC')
      // 两列表格被 OCR 拆列后，“姓名”与“性别”的字符会交错成“姓性 名：王禹涵 别：女”。
      // 先把这类表头折叠回“姓名：王禹涵 性别：女”，避免 AI 的正确结果因为原文不一致被丢弃。
      .replace(/姓[\s\S]{0,8}?名\s*[:：|｜]?\s*([\u3400-\u9fff·]{2,6})[\s\S]{0,8}?性[\s\S]{0,8}?别/g, '姓名：$1 性别')
      .replace(/姓[\s\S]{0,8}?名\s*[:：|｜]?\s*([\u3400-\u9fff·]{2,6})/g, '姓名：$1')
    const labeledPatterns = [
      /(?:姓\s*名|Name)\s*[:：|｜]?\s*([\u3400-\u9fff·]{2,8})(?=\s{2,}|[\s|｜\n]|$)/gi,
      /(?:姓\s*名|Name)\s*[:：|｜]?\s*((?:[\u3400-\u9fff]\s*){2,8}?)(?=\s{2,}|[\s|｜\n]|$)/gi,
    ]
    for (const pattern of labeledPatterns) {
      for (const match of text.matchAll(pattern)) {
        const explicit = this.nameFromExplicitSegment(match[1])
        if (explicit) return explicit
      }
    }

    // 无“姓名”标签时，只检查简历最前面的身份区。正文中的“利用电话”、
    // “应届生”等普通中文片段即使形似姓名，也不能作为身份依据。
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 12)
    const contactLine = lines.find((line) => {
      const contacts = this.extractContacts(line)
      return contacts.phone && contacts.email
    })
    if (contactLine) {
      const contacts = this.extractContacts(contactLine)
      const phoneIndex = contactLine.indexOf(contacts.phone)
      const emailIndex = contactLine.indexOf(contacts.email)
      if (phoneIndex >= 0 && emailIndex >= 0) {
        const firstEnd = phoneIndex < emailIndex ? phoneIndex + contacts.phone.length : emailIndex + contacts.email.length
        const lastStart = phoneIndex < emailIndex ? emailIndex : phoneIndex
        const between = contactLine.slice(firstEnd, lastStart)
        const candidate = between.match(/([\u3400-\u9fff·]{2,6})/)?.[1]
        const contactName = this.nameFromExplicitSegment(candidate)
        if (contactName) return contactName
      }
    }
    const identityContext = (value: string) => Boolean(
      this.extractContacts(value).phone
      || /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(value)
      || /(?:性\s*别|gender)\s*[:：|｜]?\s*(?:男|女|男性|女性|male|female|m|f)\b/i.test(value)
      || /(?:年龄|出生|生日|学历|本科|硕士|博士|求职|工作经验|工作年限|地址|地区|电话|手机|邮箱|微信)/.test(value),
    )
    for (let index = 0; index < lines.length; index += 1) {
      const compactLine = lines[index].replace(/\s+/g, ' ').trim()
      const exactLine = compactLine.replace(/\s+/g, '')
      const exactName = /^[\u3400-\u9fff·]{2,6}$/.test(exactLine) ? this.cleanName(exactLine) : ''
      if (exactName && identityContext(lines.slice(index + 1, index + 5).join(' '))) return exactName

      const identityHeading = index === 0 ? compactLine.match(/^([\u3400-\u9fff·]{2,6})(?=\s+)/)?.[1] : ''
      const identityHeadingName = this.nameFromExplicitSegment(identityHeading)
      if (identityHeadingName && identityContext(lines.slice(index + 1, index + 5).join(' '))) return identityHeadingName

      const leading = compactLine.match(/^((?:[\u3400-\u9fff]\s*){2,6})(?=\s*(?:求职|电话|手机|邮箱|微信|性别|男|女|出生|生日|年龄|地区|地址|工作年限|工作经验|\d{1,2}\s*岁|1[3-9]\d{9}|[A-Za-z0-9._%+-]+@))/i)?.[1]
      const leadingName = this.nameFromExplicitSegment(leading)
      if (leadingName && identityContext(compactLine.slice(leading?.length || 0))) return leadingName

      const bracketed = compactLine.match(/^((?:[\u3400-\u9fff]\s*){2,6})\s*[\(（]/)?.[1]
      const bracketedName = this.nameFromExplicitSegment(bracketed)
      if (bracketedName && identityContext(`${compactLine} ${lines.slice(index + 1, index + 3).join(' ')}`)) return bracketedName
    }
    return ''
  }

  private nameFromFileName(fileName: string) {
    const decoded = this.decodeFileName(fileName).replace(/\.[^.]+$/, '')
    const explicitPatterns = [
      /([\u3400-\u9fff·]{2,6})(?:女士|先生|小姐|老师|同学)(?=$|[\s\d.。．，,、_\-（）()【】\[\]])/,
      /([\u3400-\u9fff·]{2,6})(?:的|完整|个人)?(?:简历|求职意向|理由)(?=$|[\s\d.。．，,、_\-（）()【】\[\]])/,
    ]
    for (const pattern of explicitPatterns) {
      const match = decoded.match(pattern)
      const candidate = this.cleanName(match?.[1])
      if (candidate) return candidate
    }
    const afterBracket = decoded.match(/[】\]]\s*([\u3400-\u9fff·]{2,6})(?=[\s\d.。．，,、—–_\-]|$)/)?.[1]
    const direct = this.nameFromExplicitSegment(afterBracket)
    if (direct) return direct
    const tokens = decoded
      .split(/[【】\[\]_\-+＋\s（）()，,、.]+/)
      .map((token) => token.replace(/^\d+/, ''))
      .filter(Boolean)
    for (const token of tokens) {
      const tokenName = this.nameFromExplicitSegment(token)
      if (tokenName) return tokenName
      const suffix = token.match(new RegExp(`^.*${FILE_NAME_ROLE_PREFIX.source}([\\u3400-\\u9fff·]{2,6})$`))
      const suffixName = this.nameFromExplicitSegment(suffix?.[1])
      if (suffixName) return suffixName
    }
    return ''
  }

  private decodeFileName(fileName: string) {
    const value = String(fileName || '')
    if (!/[ÃÂãåæçèéäï]/.test(value)) return value
    const decoded = Buffer.from(value, 'latin1').toString('utf8')
    return decoded.includes('�') ? value : decoded
  }

  private fingerprint(rawText: string) {
    return createHash('sha256').update(rawText.normalize('NFKC').replace(/\s+/g, '').toLowerCase()).digest('hex')
  }

  private upsertWithLock(fingerprint: string, value: ResumeExtraction, fileName: string, fileUrl: string, rawText: string, avatarUrl = '') {
    const existing = this.fingerprintLocks.get(fingerprint)
    if (existing) return existing
    const promise = this.upsert(fingerprint, value, fileName, fileUrl, rawText, avatarUrl).finally(() => this.fingerprintLocks.delete(fingerprint))
    this.fingerprintLocks.set(fingerprint, promise)
    return promise
  }

  private resumeFieldsChecked = false
  private preserveReviewedFields(existing: TeableRecord, fields: Record<string, any>) {
    const status = String(existing.fields['人工复核状态'] || '')
    if (!['已修正', '已确认'].includes(status)) return fields
    const allowed = new Set(Object.values(REVIEW_FIELDS))
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(existing.fields, field)) fields[field] = existing.fields[field]
    }
    return fields
  }

  private async upsert(fingerprint: string, value: ResumeExtraction, fileName: string, fileUrl: string, rawText: string, avatarUrl = ''): Promise<ResumeRecord> {
    const tableId = this.table()
    // 字段检查只做一次，不每份简历都查
    if (!this.resumeFieldsChecked) {
      const fields = await teable.listFields(tableId)
      const available = new Set(fields.map((field) => field.name))
      for (const [name] of RESUME_FIELDS) if (!available.has(name)) throw new Error(`数据库缺少字段：${name}`)
      this.resumeFieldsChecked = true
    }
    const rows = await teable.listAllRecords(tableId)
    let existing = rows.find((row) => row.fields['简历指纹'] === fingerprint)
    if (!existing) {
      existing = rows.find((row) => row.fields['OCR原文'] && this.fingerprint(String(row.fields['OCR原文'])) === fingerprint)
    }
    const dbFields = this.toFields(value, fileName, fileUrl, rawText, fingerprint, avatarUrl || String(existing?.fields['头像地址'] || ''))
    if (existing) this.preserveReviewedFields(existing, dbFields)
    const row = existing
      ? await teable.updateRecord(tableId, existing.id, dbFields)
      : await teable.createRecord(tableId, dbFields)
    return this.fromTeable(row)
  }

  private toFields(value: ResumeExtraction, fileName: string, fileUrl: string, rawText: string, fingerprint: string, avatarUrl = '') {
    return {
      '姓名': this.cleanName(value.name) || '未识别姓名', '性别': this.normalizeGender(value.gender, rawText), '年龄': value.age, '电话': value.phone, '邮箱': value.email,
      '微信': value.wechat, '地址': value.address, '自我评价': value.selfEvaluation, '技能证书': value.skillsCertificates,
      '教育背景': value.educationBackground, '工作经历': value.workExperience, '求职意向': value.jobIntention,
      '工作年限': value.yearsOfExperience, '当前公司': value.currentCompany, '当前职位': value.currentRole,
      '源文件名': fileName, '源文件地址': fileUrl, 'OCR原文': rawText, '简历指纹': fingerprint,
      '解析质量JSON': JSON.stringify(value.qualityWarnings || []),
      '头像地址': avatarUrl, '头像提取状态': avatarUrl ? '已提取' : '未发现可用头像',
    }
  }

  private fromTeable(row: TeableRecord): ResumeRecord {
    const f = row.fields || {}
    return {
      id: row.id, name: String(f['姓名'] || ''), gender: this.normalizeGender(f['性别'], String(f['OCR原文'] || '')), age: f['年龄'] == null ? null : Number(f['年龄']),
      phone: String(f['电话'] || ''), email: String(f['邮箱'] || ''), wechat: String(f['微信'] || ''), address: String(f['地址'] || ''),
      selfEvaluation: String(f['自我评价'] || ''), skillsCertificates: String(f['技能证书'] || ''), educationBackground: String(f['教育背景'] || ''),
      qualityWarnings: readQualityWarnings(f['解析质量JSON']),
      workExperience: String(f['工作经历'] || ''), jobIntention: String(f['求职意向'] || ''), yearsOfExperience: String(f['工作年限'] || ''),
      currentCompany: String(f['当前公司'] || ''), currentRole: String(f['当前职位'] || ''),
      sourceFileName: String(f['源文件名'] || ''), sourceFileUrl: String(f['源文件地址'] || ''), rawText: String(f['OCR原文'] || ''),
      avatarUrl: String(f['头像地址'] || ''), avatarStatus: String(f['头像提取状态'] || ''),
      editableWordFileName: String(f['可编辑Word文件名'] || ''), editableWordUrl: String(f['可编辑Word地址'] || ''), wordConversionStatus: String(f['Word转换状态'] || ''),
      wordConversionError: String(f['Word转换错误'] || ''), wordConversionVersion: Number(f['Word转换版本'] || 0), wordConvertedBy: String(f['Word转换人'] || ''), wordConvertedAt: String(f['Word转换时间'] || ''),
      reviewStatus: String(f['人工复核状态'] || ''), correctionSummary: String(f['人工修正内容'] || ''),
      fingerprint: String(f['简历指纹'] || ''), createdTime: String(f['创建时间'] || row.createdTime || ''),
      candidateId: String(f['候选人ID'] || ''), applicationId: String(f['应聘记录ID'] || ''),
    }
  }
}
