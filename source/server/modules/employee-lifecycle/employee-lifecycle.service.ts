import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { jobs } from '../../platform/jobs'
import { llm } from '../../platform/llm'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { storage } from '../../platform/storage'
import { teable, TeableRecord } from '../../platform/teable'
import { DatabaseService } from '../database/database.service'
import { RecruitmentService } from '../recruitment/recruitment.service';import { MessagesService } from '../messages/messages.service'
import { appFlowUrl } from '../../platform/app-links'
import { ArrivalInput, ExitInterviewInput, FollowupInput, OffboardingInput, OnboardingInput, OnboardingTaskInput } from './employee-lifecycle.types'

const now=()=>new Date().toISOString(),id=(p:string)=>`${p}_${randomUUID().replace(/-/g,'').slice(0,20)}`,text=(v:unknown)=>String(v??'').trim(),num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0,json=<T>(v:unknown,f:T):T=>{try{return v?JSON.parse(String(v))as T:f}catch{return f}}
const addMonths=(date:string,months:number)=>{const d=new Date(`${date}T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString().slice(0,10)}
const addDays=(date:string,days:number)=>{const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}

@Injectable()
export class EmployeeLifecycleService{
  constructor(private readonly database:DatabaseService,private readonly recruitment:RecruitmentService,private readonly messages:MessagesService){}private table(n:string){return this.database.requireTableId(n)}
  async list(q:{candidateId?:string}){
    const candidateId=text(q.candidateId),names=['recruitment_onboarding_cases','recruitment_onboarding_documents','recruitment_onboarding_tasks','recruitment_probation_reviews','recruitment_offboarding_cases','recruitment_exit_interviews','recruitment_followups','recruitment_candidates']
    const sets=await Promise.all(names.map(name=>candidateId?teable.listByField(this.table(name),'候选人ID',candidateId,1000):teable.listAllRecords(this.table(name))))
    const[onboardings,documents,tasks,probations,offboardings,interviews,followups,candidates]=sets
    const rows=onboardings.map(r=>this.mapOnboarding(r,candidates.find(c=>text(c.fields['候选人ID'])===text(r.fields['候选人ID'])),documents.filter(x=>text(x.fields['入职单ID'])===text(r.fields['入职单ID'])),tasks.filter(x=>text(x.fields['入职单ID'])===text(r.fields['入职单ID'])),probations.filter(x=>text(x.fields['入职单ID'])===text(r.fields['入职单ID'])),offboardings.filter(x=>text(x.fields['入职单ID'])===text(r.fields['入职单ID'])),interviews,followups)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
    return{total:rows.length,onboardings:rows,overview:{pending:rows.filter(x=>x.status==='待入职').length,active:rows.filter(x=>x.status==='已入职').length,probation:rows.filter(x=>x.status==='试用期').length,offboarding:rows.filter(x=>x.offboarding?.status&&!['已离职'].includes(x.offboarding.status)).length,followups:rows.reduce((sum,item)=>sum+item.followups.filter((followup:any)=>followup.status==='待回访').length,0)}}
  }
  async create(input:OnboardingInput){if(!text(input.candidateId)||!text(input.plannedStartDate))throw new BadRequestException('候选人和计划入职日期不能为空');if(Date.parse(input.plannedStartDate)<Date.now()-86400000)throw new BadRequestException('计划入职日期不能早于今天');const[candidates,apps,offers,rows]=await Promise.all(['recruitment_candidates','recruitment_applications','recruitment_offers','recruitment_onboarding_cases'].map(n=>teable.listAllRecords(this.table(n))));const candidate=candidates.find(r=>text(r.fields['候选人ID'])===input.candidateId||r.id===input.candidateId);if(!candidate)throw new NotFoundException('候选人不存在');if(rows.some(r=>text(r.fields['候选人ID'])===input.candidateId&&!['已离职','已取消'].includes(text(r.fields['入职状态']))))throw new ConflictException('该人才已有进行中的入职流程');const app=apps.find(r=>text(r.fields['应聘记录ID'])===input.applicationId)||apps.filter(r=>text(r.fields['候选人ID'])===input.candidateId).sort((a,b)=>text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0],offer=offers.find(r=>text(r.fields['OfferID'])===input.offerId)||offers.filter(r=>text(r.fields['候选人ID'])===input.candidateId&&text(r.fields['候选人答复'])==='接受').sort((a,b)=>text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0];const onboardingId=id('onboarding'),timestamp=now(),number=`ON-${timestamp.slice(0,10).replace(/-/g,'')}-${onboardingId.slice(-6).toUpperCase()}`;await teable.createRecord(this.table('recruitment_onboarding_cases'),{入职单ID:onboardingId,候选人ID:input.candidateId,应聘记录ID:text(app?.fields['应聘记录ID']),OfferID:text(offer?.fields['OfferID']),需求ID:text(app?.fields['需求ID']),职位ID:text(input.positionId)||text(app?.fields['职位ID']),入职编号:number,计划入职日期:input.plannedStartDate,部门:text(input.department)||text(offer?.fields['部门']),岗位:text(input.role)||text(offer?.fields['岗位名称']),直属负责人:text(input.manager),工作地点:text(input.location)||text(offer?.fields['工作地点']),入职状态:'待入职',资料完成率:0,任务完成率:0,外部同步状态:'未发起',转正状态:'待试用',到岗提醒状态:'待发送',创建人用户ID:text(input.operatorUserId),创建人:text(input.operator)||'当前用户',创建时间:timestamp,更新时间:timestamp});await this.seedTasks(onboardingId,input.candidateId,input.plannedStartDate,input.operator);await this.event(input.candidateId,onboardingId,'','创建入职单','', '待入职','建立待入职清单',{plannedStartDate:input.plannedStartDate},input.operator,input.operatorUserId);return{onboardingId,number,status:'待入职'}}
  async addDocument(onboardingId:string,file:Express.Multer.File,body:{type:string;name?:string;operator?:string}){const row=await this.findOnboarding(onboardingId);if(!file?.buffer)throw new BadRequestException('请选择入职资料');if(file.size>15*1024*1024)throw new BadRequestException('单个资料不能超过15MB');const safe=file.originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g,'_'),uploaded=await storage.upload(`onboarding/${onboardingId}/${Date.now()}-${safe}`,file.mimetype||'application/octet-stream',file.buffer),timestamp=now(),documentId=id('ondoc');await teable.createRecord(this.table('recruitment_onboarding_documents'),{资料ID:documentId,入职单ID:onboardingId,候选人ID:text(row.fields['候选人ID']),资料类型:text(body.type)||'其他资料',资料名称:text(body.name)||file.originalname,文件地址:uploaded.cdnUrl,文件类型:file.mimetype,资料状态:'待核验',提交人:text(body.operator)||'当前用户',提交时间:timestamp,更新时间:timestamp});await this.refreshProgress(row);return{documentId,fileUrl:uploaded.cdnUrl,status:'待核验'}}
  async verifyDocument(onboardingId:string,documentId:string,body:{status:'已核验'|'需补充'|'已拒绝';note?:string;operator?:string}){await this.findOnboarding(onboardingId);const rows=await teable.listAllRecords(this.table('recruitment_onboarding_documents')),row=rows.find(x=>text(x.fields['资料ID'])===documentId&&text(x.fields['入职单ID'])===onboardingId);if(!row)throw new NotFoundException('入职资料不存在');await teable.updateRecord(this.table('recruitment_onboarding_documents'),row.id,{资料状态:body.status,核验说明:text(body.note),核验人:text(body.operator)||'当前用户',核验时间:now(),更新时间:now()});await this.refreshProgress(await this.findOnboarding(onboardingId));return{documentId,status:body.status}}
  async addTask(onboardingId:string,input:OnboardingTaskInput){const row=await this.findOnboarding(onboardingId);if(!text(input.name)||!text(input.category))throw new BadRequestException('任务名称和分类不能为空');const taskId=id('ontask'),timestamp=now();await teable.createRecord(this.table('recruitment_onboarding_tasks'),{入职任务ID:taskId,入职单ID:onboardingId,候选人ID:text(row.fields['候选人ID']),任务分类:input.category,任务名称:input.name,任务说明:text(input.description),负责人用户ID:text(input.ownerUserId),负责人:text(input.owner),截止时间:text(input.dueAt),任务状态:'待处理',来源类型:'人工新增',创建时间:timestamp,更新时间:timestamp});await this.refreshProgress(row);return{taskId,status:'待处理'}}
  async completeTask(onboardingId:string,taskId:string,body:{note:string;operator?:string}){const onboarding=await this.findOnboarding(onboardingId),rows=await teable.listAllRecords(this.table('recruitment_onboarding_tasks')),row=rows.find(x=>text(x.fields['入职任务ID'])===taskId&&text(x.fields['入职单ID'])===onboardingId);if(!row)throw new NotFoundException('入职任务不存在');await teable.updateRecord(this.table('recruitment_onboarding_tasks'),row.id,{任务状态:'已完成',完成时间:now(),完成说明:text(body.note),更新时间:now()});await this.refreshProgress(onboarding);return{taskId,status:'已完成'}}
  async externalRequest(onboardingId:string,body:{system:string;operator?:string}){const row=await this.findOnboarding(onboardingId);if(!text(body.system))throw new BadRequestException('请选择入职系统');const externalTaskId=id('externalon'),payload={externalTaskId,onboardingId,candidateId:text(row.fields['候选人ID']),plannedStartDate:text(row.fields['计划入职日期']),department:text(row.fields['部门']),role:text(row.fields['岗位']),minimumDataOnly:true};await teable.updateRecord(this.table('recruitment_onboarding_cases'),row.id,{外部系统:body.system,外部任务ID:externalTaskId,外部同步状态:'待外部系统接收',外部错误信息:'',更新时间:now()});return{status:'待外部系统接收',boundary:'当前仅提供入职系统接口边界，未连接具体OA/HR系统',request:payload}}
  async externalResult(onboardingId:string,body:{externalTaskId:string;status:'成功'|'失败'|'处理中';error?:string}){const row=await this.findOnboarding(onboardingId);if(text(row.fields['外部任务ID'])!==text(body.externalTaskId))throw new ConflictException('外部任务ID不匹配');await teable.updateRecord(this.table('recruitment_onboarding_cases'),row.id,{外部同步状态:body.status,外部错误信息:text(body.error),更新时间:now()});return{onboardingId,syncStatus:body.status}}
  async arrive(onboardingId:string,input:ArrivalInput){if(!text(input.actualDate)||!text(input.note))throw new BadRequestException('实际到岗日期和确认说明不能为空');const row=await this.findOnboarding(onboardingId);if(text(row.fields['实际到岗日期']))throw new ConflictException('该入职单已经确认到岗');const months=Math.max(1,Math.round(num(input.probationMonths)||3)),end=addMonths(input.actualDate,months),timestamp=now();await teable.updateRecord(this.table('recruitment_onboarding_cases'),row.id,{实际到岗日期:input.actualDate,入职状态:'试用期',试用期结束日期:end,转正状态:'试用中',更新时间:timestamp});await this.seedProbation(onboardingId,text(row.fields['候选人ID']),input.actualDate,end);await this.advanceApplication(row,'已入职','确认实际到岗',input.note,input.operator,input.operatorUserId);await this.messages.notifyPositionHr({category:'确认到岗跟进入职状态',candidateId:text(row.fields['候选人ID']),objectId:onboardingId,positionId:text(row.fields['职位ID']),applicationId:text(row.fields['应聘记录ID']),markdown:`## 【跟进入职状态】候选人 ${text(row.fields['候选人ID'])}\n> 已确认到岗：${input.actualDate}\n- 试用期结束：${end}\n[进入员工生命周期 →](${appFlowUrl('onboarding', { candidate_id: text(row.fields['候选人ID']), onboarding_id: onboardingId }) || `${text(process.env.APP_PUBLIC_URL).replace(/\/+$/, '')}/#employees`})`,operator:input.operator}).catch((error:unknown)=>console.error(`[流程私信] 确认到岗跟进入职状态 失败: ${error instanceof Error?error.message:String(error)}`));await this.event(text(row.fields['候选人ID']),onboardingId,'','确认到岗',text(row.fields['入职状态']),'试用期',input.note,{actualDate:input.actualDate,probationEnd:end},input.operator,input.operatorUserId);return{onboardingId,status:'试用期',actualDate:input.actualDate,probationEndDate:end}}
  async probationDue(days=30){const rows=await teable.listAllRecords(this.table('recruitment_probation_reviews')),limit=Date.now()+Math.max(1,days)*86400000;return{items:rows.filter(r=>text(r.fields['处理状态'])==='待处理'&&Date.parse(text(r.fields['计划日期']))<=limit).map(this.mapProbation)}}
  async checkProbationReviewReminders(operator='系统') {
    const [reviews, links, candidates, onboardings] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_probation_reviews')),
      teable.listAllRecords(this.table('recruitment_public_links')),
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_onboarding_cases')),
    ])
    let created = 0
    let notified = 0
    for (const review of reviews.filter(row => ['入职一月评价', '试用期中期'].includes(text(row.fields['节点类型'])) && text(row.fields['处理状态']) === '待处理' && Date.parse(text(row.fields['计划日期'])) <= Date.now() && text(row.fields['通知状态']) !== '已发送')) {
      const reviewId = text(review.fields['试用期记录ID']) || review.id
      const candidateId = text(review.fields['候选人ID'])
      const nodeType = text(review.fields['节点类型'])
      const onboarding = onboardings.find(row => text(row.fields['入职单ID']) === text(review.fields['入职单ID']))
      const candidate = candidates.find(row => text(row.fields['候选人ID']) === candidateId)
      const link = await this.createProbationReviewLink(review, links)
      const result = await this.messages.notifyPositionHr({
        category: nodeType, candidateId, objectId: reviewId, positionId: text(onboarding?.fields['职位ID']), applicationId: text(onboarding?.fields['应聘记录ID']),
        markdown: nodeType === '入职一月评价'
          ? `## 【入职一月评价】${text(candidate?.fields['姓名']) || '新人'}\n> 到岗日期：${text(onboarding?.fields['实际到岗日期']) || '待补充'}\n> 已入职满一个月，请HR填写述职评级（S/A/B）、新人成长等级和述职评价。\n[打开入职评价表 →](${link.url})`
          : `## 【${nodeType}】${text(candidate?.fields['姓名']) || '员工'}\n> 到岗日期：${text(onboarding?.fields['实际到岗日期']) || '待补充'}\n> 请HR完成本阶段试用期评价。\n[打开评价表 →](${link.url})`, operator,
      })
      await teable.updateRecord(this.table('recruitment_probation_reviews'), review.id, { 通知状态: result.status === '已发送' ? '已发送' : '发送失败', 通知时间: now(), 扩展信息JSON: JSON.stringify({ evaluationUrl: link.url }), 更新时间: now() })
      created++
      if (result.status === '已发送') notified++
    }
    return { checked: reviews.length, created, notified, operator }
  }

  async checkOnboardingArrivalReminders(operator='系统') {
    const [onboardings, candidates, links, offers] = await Promise.all([
      teable.listAllRecords(this.table('recruitment_onboarding_cases')),
      teable.listAllRecords(this.table('recruitment_candidates')),
      teable.listAllRecords(this.table('recruitment_public_links')),
      teable.listAllRecords(this.table('recruitment_offers')),
    ])
    let checked = 0
    let notified = 0
    const errors: string[] = []
    for (const onboarding of onboardings.filter(row => text(row.fields['入职状态']) === '待入职' && text(row.fields['到岗提醒状态']) !== '已发送' && Date.parse(text(row.fields['计划入职日期'])) <= Date.now())) {
      checked++
      const candidateId = text(onboarding.fields['候选人ID'])
      const candidate = candidates.find(row => text(row.fields['候选人ID']) === candidateId)
      const link = await this.createOnboardingArrivalLink(onboarding, links)
      const result = await this.messages.notifyPositionHr({
        category: '到岗日期确认', candidateId, objectId: text(onboarding.fields['入职单ID']), positionId: text(onboarding.fields['职位ID']), applicationId: text(onboarding.fields['应聘记录ID']),
        markdown: '## 【确认是否入职】' + (text(candidate?.fields['姓名']) || '候选人') + '\n> 计划入职日期：' + text(onboarding.fields['计划入职日期']) + '\n> 请HR确认候选人是否实际到岗。\n[打开到岗确认表 →](' + link.url + ')', operator,
      })
      await teable.updateRecord(this.table('recruitment_onboarding_cases'), onboarding.id, { 到岗提醒状态: ['已发送', '已跳过'].includes(result.status) ? '已发送' : '发送失败', 到岗提醒时间: now(), 到岗确认链接: link.url, 更新时间: now() })
      if (['已发送', '已跳过'].includes(result.status)) notified++
      else errors.push(`${text(onboarding.fields['入职单ID'])}: ${text(result.reason) || '到岗确认提醒发送失败'}`)
    }
    for (const offer of offers.filter(row => text(row.fields['发送状态']) === '已发送' && text(row.fields['候选人答复']) === '接受' && Date.parse(text(row.fields['入职日期'])) <= Date.now())) {
      const candidateId = text(offer.fields['候选人ID'])
      const offerId = text(offer.fields['OfferID']) || offer.id
      const applicationId = text(offer.fields['应聘记录ID'])
      if (onboardings.some(row => text(row.fields['OfferID']) === offerId || (applicationId && text(row.fields['应聘记录ID']) === applicationId))) continue
      checked++
      const candidate = candidates.find(row => text(row.fields['候选人ID']) === candidateId)
      const url = appFlowUrl('onboarding', { candidate_id: candidateId, offer_id: offerId, application_id: applicationId }) || `${text(process.env.APP_PUBLIC_URL).replace(/\/+$/, '')}/#employees`
      const result = await this.messages.notifyPositionHr({
        category: 'Offer入职日期确认', candidateId, objectId: `offer-arrival:${offerId}`, objectType: 'Offer到岗确认', positionId: text(offer.fields['职位ID']), applicationId,
        markdown: `## 【Offer入职日期已到】${text(candidate?.fields['姓名']) || '候选人'}\n> 岗位：${text(offer.fields['岗位名称']) || '待确认'}\n> 计划入职日期：${text(offer.fields['入职日期'])}\n请HR联系候选人确认是否实际到岗；如尚未创建入职单，请先补建后记录到岗结果。\n[打开入职管理 →](${url})`, operator,
      })
      if (result.status === '已发送') notified++
      else if (!['已跳过'].includes(result.status)) errors.push(`${offerId}: ${text(result.reason) || 'Offer到岗提醒发送失败'}`)
    }
    return { checked, notified, errors, operator }
  }


  async publicOnboardingArrivalDetail(token: string) {
    const link = await this.resolveOnboardingArrivalLink(token)
    const onboardingId = text(link.fields['对象ID'])
    const onboardings = await teable.listAllRecords(this.table('recruitment_onboarding_cases'))
    const onboarding = onboardings.find(row => text(row.fields['入职单ID']) === onboardingId || row.id === onboardingId)
    if (!onboarding) throw new NotFoundException('入职记录不存在')
    const candidates = await teable.listAllRecords(this.table('recruitment_candidates'))
    const candidate = candidates.find(row => text(row.fields['候选人ID']) === text(onboarding.fields['候选人ID']))
    return { onboardingId, candidateId: text(onboarding.fields['候选人ID']), candidateName: text(candidate?.fields['姓名']) || '候选人', role: text(onboarding.fields['岗位']), department: text(onboarding.fields['部门']), plannedStartDate: text(onboarding.fields['计划入职日期']), status: text(onboarding.fields['入职状态']), note: text(onboarding.fields['到岗确认说明']) }
  }

  async submitPublicOnboardingArrival(token: string, input: { arrived: boolean; actualDate?: string; probationMonths?: number; note: string; operator?: string }) {
    const link = await this.resolveOnboardingArrivalLink(token)
    const onboardingId = text(link.fields['对象ID'])
    const onboarding = await this.findOnboarding(onboardingId)
    if (!text(input.note)) throw new BadRequestException('请填写到岗确认说明')
    if (input.arrived) {
      if (!text(input.actualDate)) throw new BadRequestException('已到岗时必须填写实际到岗日期')
      const result = await this.arrive(onboardingId, { actualDate: text(input.actualDate), probationMonths: input.probationMonths, note: input.note, operator: input.operator || '到岗确认链接' })
      await teable.updateRecord(this.table('recruitment_onboarding_cases'), onboarding.id, { 到岗提醒状态: '已处理', 到岗确认说明: text(input.note), 到岗确认时间: now(), 更新时间: now() })
      await teable.updateRecord(this.table('recruitment_public_links'), link.id, { 链接状态: '已完成', 更新时间: now() })
      return result
    }
    const timestamp = now()
    await teable.updateRecord(this.table('recruitment_onboarding_cases'), onboarding.id, { 入职状态: '未到岗', 到岗提醒状态: '已处理', 到岗确认说明: text(input.note), 到岗确认时间: timestamp, 更新时间: timestamp })
    await this.advanceApplication(onboarding, '未到岗', '确认未到岗', input.note, input.operator || '到岗确认链接')
    await this.event(text(onboarding.fields['候选人ID']), onboardingId, '', '确认未到岗', text(onboarding.fields['入职状态']), '未到岗', input.note, {}, input.operator || '到岗确认链接')
    await teable.updateRecord(this.table('recruitment_public_links'), link.id, { 链接状态: '已完成', 更新时间: timestamp })
    return { onboardingId, status: '未到岗' }
  }

  private async createOnboardingArrivalLink(onboarding: TeableRecord, existingLinks: TeableRecord[]) {
    const onboardingId = text(onboarding.fields['入职单ID']) || onboarding.id
    const active = existingLinks.find(row => text(row.fields['链接类型']) === '到岗确认' && text(row.fields['对象ID']) === onboardingId && text(row.fields['链接状态']) === '有效' && Date.parse(text(row.fields['过期时间'])) > Date.now())
    if (active) return { url: text(active.fields['访问路径']) }
    const base = text(process.env.APP_PUBLIC_URL).replace(/\/+$/, '')
    if (!base) throw new BadRequestException('未配置应用公开地址，无法生成到岗确认链接')
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString()
    const url = base + '/onboarding-arrival?onboarding_arrival_token=' + encodeURIComponent(token)
    const created = await teable.createRecord(this.table('recruitment_public_links'), { 链接ID: id('link'), 候选人ID: text(onboarding.fields['候选人ID']), 链接类型: '到岗确认', 对象类型: '入职单', 对象ID: onboardingId, 访问Token哈希: createHash('sha256').update(token).digest('hex'), Token前缀: token.slice(0, 8), 访问路径: url, 链接状态: '有效', 过期时间: expiresAt, 创建人: '员工生命周期自动通知', 创建时间: now(), 更新时间: now() })
    existingLinks.push(created)
    return { url }
  }

  private async resolveOnboardingArrivalLink(token: string) {
    const hash = createHash('sha256').update(text(token)).digest('hex')
    const rows = await teable.listAllRecords(this.table('recruitment_public_links'))
    const link = rows.find(row => text(row.fields['链接类型']) === '到岗确认' && text(row.fields['访问Token哈希']) === hash)
    if (!link) throw new NotFoundException('到岗确认链接不存在')
    if (text(link.fields['链接状态']) !== '有效') throw new ConflictException('到岗确认链接已使用或已失效')
    if (Date.parse(text(link.fields['过期时间'])) <= Date.now()) throw new ConflictException('到岗确认链接已过期')
    return link
  }

  async publicProbationReviewDetail(token: string) {
    const link = await this.resolveProbationReviewLink(token)
    const reviewId = text(link.fields['对象ID'])
    const reviews = await teable.listAllRecords(this.table('recruitment_probation_reviews'))
    const review = reviews.find(row => text(row.fields['试用期记录ID']) === reviewId || row.id === reviewId)
    if (!review) throw new NotFoundException('入职评价记录不存在')
    const [candidates, onboardings] = await Promise.all([teable.listAllRecords(this.table('recruitment_candidates')), teable.listAllRecords(this.table('recruitment_onboarding_cases'))])
    const candidate = candidates.find(row => text(row.fields['候选人ID']) === text(review.fields['候选人ID']))
    const onboarding = onboardings.find(row => text(row.fields['入职单ID']) === text(review.fields['入职单ID']))
    return { reviewId, candidateId: text(review.fields['候选人ID']), candidateName: text(candidate?.fields['姓名']) || '员工', role: text(onboarding?.fields['岗位']), department: text(onboarding?.fields['部门']), nodeType: text(review.fields['节点类型']), plannedDate: text(review.fields['计划日期']), status: text(review.fields['处理状态']), performanceRating: text(review.fields['述职评级']), growthLevel: text(review.fields['新人成长等级']), appraisal: text(review.fields['述职评价']), score: num(review.fields['绩效评分']), managerReview: text(review.fields['负责人评价']), employeeFeedback: text(review.fields['员工反馈']), recommendation: text(review.fields['转正建议']) }
  }

  async submitPublicProbationReview(token: string, input: { performanceRating?: string; growthLevel?: string; appraisal?: string; score?: number; managerReview?: string; employeeFeedback?: string; recommendation?: string; operator?: string }) {
    const link = await this.resolveProbationReviewLink(token)
    const reviewId = text(link.fields['对象ID'])
    const rows = await teable.listAllRecords(this.table('recruitment_probation_reviews'))
    const review = rows.find(row => text(row.fields['试用期记录ID']) === reviewId || row.id === reviewId)
    if (!review) throw new NotFoundException('入职评价记录不存在')
    const nodeType = text(review.fields['节点类型'])
    const performanceRating = text(input.performanceRating).toUpperCase()
    const growthLevel = text(input.growthLevel)
    const appraisal = text(input.appraisal)
    if (nodeType === '入职一月评价') {
      if (!['S', 'A', 'B'].includes(performanceRating)) throw new BadRequestException('述职评级只能选择S、A或B')
      if (!growthLevel || !appraisal) throw new BadRequestException('请填写新人成长等级和述职评价')
    } else {
      if (!text(input.managerReview) || !text(input.recommendation)) throw new BadRequestException('请填写负责人评价和后续建议')
      if (num(input.score) < 0 || num(input.score) > 100) throw new BadRequestException('评分必须在0到100之间')
    }
    await teable.updateRecord(this.table('recruitment_probation_reviews'), review.id, nodeType === '入职一月评价'
      ? { 处理状态: '已完成', 实际处理日期: now().slice(0, 10), 述职评级: performanceRating, 新人成长等级: growthLevel, 述职评价: appraisal, 处理人: text(input.operator) || '入职评价链接', 更新时间: now() }
      : { 处理状态: '已完成', 实际处理日期: now().slice(0, 10), 绩效评分: num(input.score), 负责人评价: text(input.managerReview), 员工反馈: text(input.employeeFeedback), 转正建议: text(input.recommendation), 处理人: text(input.operator) || '入职评价链接', 更新时间: now() })
    const tasks = await teable.listAllRecords(this.table('recruitment_tasks'))
    for (const task of tasks.filter(row => text(row.fields['待办类型']) === '试用期节点' && text(row.fields['对象ID']) === reviewId && text(row.fields['待办状态']) !== '已完成')) await teable.updateRecord(this.table('recruitment_tasks'), task.id, { 待办状态: '已完成', 完成时间: now(), 更新时间: now() })
    await teable.updateRecord(this.table('recruitment_public_links'), link.id, { 链接状态: '已完成', 更新时间: now() })
    const questionBank = await this.startProbationQuestionFeedback(reviewId)
    return { reviewId, status: '已完成', performanceRating, growthLevel, recommendation: text(input.recommendation), questionBank }
  }

  private async createProbationReviewLink(review: TeableRecord, existingLinks: TeableRecord[]) {
    const reviewId = text(review.fields['试用期记录ID']) || review.id
    const active = existingLinks.find(row => text(row.fields['链接类型']) === '入职评价' && text(row.fields['对象ID']) === reviewId && text(row.fields['链接状态']) === '有效' && Date.parse(text(row.fields['过期时间'])) > Date.now())
    if (active) return { url: text(active.fields['访问路径']) }
    const base = text(process.env.APP_PUBLIC_URL).replace(/\/+$/, '')
    if (!base) throw new BadRequestException('未配置应用公开地址，无法生成入职评价链接')
    const token = randomBytes(32).toString('base64url'), expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString(), url = `${base}/onboarding-review?onboarding_review_token=${encodeURIComponent(token)}`
    const created = await teable.createRecord(this.table('recruitment_public_links'), { 链接ID: id('link'), 候选人ID: text(review.fields['候选人ID']), 链接类型: '入职评价', 对象类型: '试用期记录', 对象ID: reviewId, 访问Token哈希: createHash('sha256').update(token).digest('hex'), Token前缀: token.slice(0, 8), 访问路径: url, 链接状态: '有效', 过期时间: expiresAt, 创建人: '员工生命周期自动通知', 创建时间: now(), 更新时间: now() })
    existingLinks.push(created)
    return { url }
  }

  private async resolveProbationReviewLink(token: string) {
    const hash = createHash('sha256').update(text(token)).digest('hex')
    const rows = await teable.listAllRecords(this.table('recruitment_public_links'))
    const link = rows.find(row => text(row.fields['链接类型']) === '入职评价' && text(row.fields['访问Token哈希']) === hash)
    if (!link) throw new NotFoundException('入职评价链接不存在')
    if (text(link.fields['链接状态']) !== '有效') throw new ConflictException('入职评价链接已使用或已失效')
    if (Date.parse(text(link.fields['过期时间'])) <= Date.now()) throw new ConflictException('入职评价链接已过期')
    return link
  }
  async completeProbation(onboardingId:string,reviewId:string,body:{performanceRating?:string;growthLevel?:string;appraisal?:string;score?:number;managerReview?:string;employeeFeedback?:string;recommendation?:string;operator?:string}){const onboarding=await this.findOnboarding(onboardingId),row=await teable.findOneByField(this.table('recruitment_probation_reviews'),'试用期记录ID',reviewId);if(!row||text(row.fields['入职单ID'])!==onboardingId)throw new NotFoundException('试用期节点不存在');const nodeType=text(row.fields['节点类型']),performanceRating=text(body.performanceRating).toUpperCase(),growthLevel=text(body.growthLevel),appraisal=text(body.appraisal);if(nodeType==='入职一月评价'){if(!['S','A','B'].includes(performanceRating))throw new BadRequestException('述职评级只能选择S、A或B');if(!growthLevel||!appraisal)throw new BadRequestException('新人成长等级和述职评价不能为空')}else{if(!text(body.managerReview)||!text(body.recommendation))throw new BadRequestException('负责人评价和转正建议不能为空');if(num(body.score)<0||num(body.score)>100)throw new BadRequestException('评分必须在0到100之间')}await teable.updateRecord(this.table('recruitment_probation_reviews'),row.id,nodeType==='入职一月评价'?{处理状态:'已完成',实际处理日期:now().slice(0,10),述职评级:performanceRating,新人成长等级:growthLevel,述职评价:appraisal,处理人:text(body.operator)||'当前用户',更新时间:now()}:{处理状态:'已完成',实际处理日期:now().slice(0,10),绩效评分:num(body.score),负责人评价:text(body.managerReview),员工反馈:text(body.employeeFeedback),转正建议:text(body.recommendation),处理人:text(body.operator)||'当前用户',更新时间:now()});const taskRows=await teable.listByField(this.table('recruitment_tasks'),'对象ID',reviewId,100),task=taskRows.find(x=>text(x.fields['待办类型'])==='试用期节点');if(task)await teable.updateRecord(this.table('recruitment_tasks'),task.id,{待办状态:'已完成',完成时间:now(),更新时间:now()});let nextStatus=text(onboarding.fields['入职状态']);if(nodeType==='转正评估'){const passed=body.recommendation==='转正';nextStatus=passed?'已入职':'试用期异常';await teable.updateRecord(this.table('recruitment_onboarding_cases'),onboarding.id,{入职状态:nextStatus,转正状态:passed?'已转正':text(body.recommendation),完成时间:passed?now():'',更新时间:now()})}const note=nodeType==='入职一月评价'?appraisal:text(body.managerReview);await this.event(text(onboarding.fields['候选人ID']),onboardingId,'',`完成${nodeType}`,text(onboarding.fields['入职状态']),nextStatus,note,{reviewId,performanceRating,growthLevel,score:num(body.score),recommendation:text(body.recommendation)},body.operator);const questionBank=await this.startProbationQuestionFeedback(reviewId);return{reviewId,status:'已完成',performanceRating,growthLevel,recommendation:text(body.recommendation),questionBank}}
  async createOffboarding(input:OffboardingInput){const onboarding=await this.findOnboarding(input.onboardingId);if(!text(input.reasonCategory)||!text(input.reason)||!text(input.plannedDate))throw new BadRequestException('离职原因分类、说明和计划日期不能为空');const rows=await teable.listByField(this.table('recruitment_offboarding_cases'),'入职单ID',input.onboardingId,100);if(rows.some(r=>!['已离职','已取消'].includes(text(r.fields['离职状态']))))throw new ConflictException('已有进行中的离职流程');const offboardingId=id('offboarding'),timestamp=now(),number=`OFF-${timestamp.slice(0,10).replace(/-/g,'')}-${offboardingId.slice(-6).toUpperCase()}`;await teable.createRecord(this.table('recruitment_offboarding_cases'),{离职单ID:offboardingId,入职单ID:input.onboardingId,候选人ID:text(onboarding.fields['候选人ID']),应聘记录ID:text(onboarding.fields['应聘记录ID']),离职编号:number,申请日期:input.appliedAt||timestamp.slice(0,10),计划离职日期:input.plannedDate,离职类型:input.type,离职原因分类:input.reasonCategory,离职原因说明:input.reason,离职状态:'交接中',交接状态:'待处理',资产归还状态:'待处理',账号关闭状态:'待处理',人才回流标记:input.returnToPool?'建议回流':'暂不回流',回流建议时间:text(input.returnSuggestedAt),题库反哺状态:'待处理',题库反哺数量:0,题库反哺错误:'',申请人:text(input.operator)||'当前用户',经办人:text(input.operator)||'当前用户',创建时间:timestamp,更新时间:timestamp});await teable.updateRecord(this.table('recruitment_onboarding_cases'),onboarding.id,{入职状态:'离职流程中',更新时间:timestamp});await this.event(text(onboarding.fields['候选人ID']),input.onboardingId,offboardingId,'发起离职',text(onboarding.fields['入职状态']),'离职流程中',input.reason,{type:input.type,category:input.reasonCategory},input.operator);return{offboardingId,number,status:'交接中'}}
  async exitInterview(offboardingId:string,input:ExitInterviewInput){
    const row=await this.findOffboarding(offboardingId)
    if(!text(input.interviewDate)||!text(input.interviewer)||!text(input.mainReason))throw new BadRequestException('面谈日期、面谈人和离职主因不能为空')
    const sourceInterview=await this.resolveSourceInterview(row,input.sourceInterviewId)
    const sourceInterviewId=text(sourceInterview?.fields['面试ID'])||text(input.sourceInterviewId)
    const interviewerIds=text(input.interviewerUserId)?[text(input.interviewerUserId)]:json<string[]>(sourceInterview?.fields['面试官用户IDJSON'],[]).map(text).filter(Boolean)
    const interviewId=id('exitinterview'),timestamp=now()
    const exitRow=await teable.createRecord(this.table('recruitment_exit_interviews'),{离职面谈ID:interviewId,离职单ID:offboardingId,候选人ID:text(row.fields['候选人ID']),面谈日期:input.interviewDate,面谈人:input.interviewer,面谈人用户ID:interviewerIds[0]||'',来源面试ID:sourceInterviewId,离职主因:input.mainReason,满意项JSON:JSON.stringify(input.satisfaction||[]),不满意项JSON:JSON.stringify(input.dissatisfaction||[]),改进建议:text(input.suggestions),真实去向:text(input.destination),是否愿意回流:input.willingToReturn?'是':'否',回流条件:text(input.returnConditions),保密级别:text(input.confidentiality)||'HR可见',题库反哺状态:'处理中',题库反哺数量:0,题库反哺错误:'',创建时间:timestamp,更新时间:timestamp})
    await teable.updateRecord(this.table('recruitment_offboarding_cases'),row.id,{题库反哺状态:'处理中',题库反哺错误:'',更新时间:now()})
    const jobId=jobs.start(async progress=>{
      progress('正在根据离职原因复盘原面试题')
      try{
        const result=await this.optimizeOffboardingQuestionBank(row,input,sourceInterview)
        const fields={题库反哺状态:'已完成',题库反哺数量:result.created,题库反哺错误:'',题库反哺时间:now(),更新时间:now()}
        await Promise.all([teable.updateRecord(this.table('recruitment_exit_interviews'),exitRow.id,fields),teable.updateRecord(this.table('recruitment_offboarding_cases'),row.id,fields)])
        return{interviewId,created:result.created}
      }catch(error){
        const message=error instanceof Error?error.message:String(error)
        const fields={题库反哺状态:'失败',题库反哺错误:message.slice(0,1000),题库反哺时间:now(),更新时间:now()}
        await Promise.all([teable.updateRecord(this.table('recruitment_exit_interviews'),exitRow.id,fields),teable.updateRecord(this.table('recruitment_offboarding_cases'),row.id,fields)])
        throw error
      }
    })
    return{interviewId,sourceInterviewId,interviewerUserId:interviewerIds[0]||'',interviewerUserIds:interviewerIds,questionBankUpdated:false,questionBankCreated:0,questionBankStatus:'处理中',jobId}
  }

  private async optimizeOffboardingQuestionBank(offboarding:TeableRecord,input?:ExitInterviewInput,sourceInterview?:TeableRecord){
    const onboarding=await this.findOnboarding(text(offboarding.fields['入职单ID']))
    const source=sourceInterview||await this.resolveSourceInterview(offboarding,input?.sourceInterviewId)
    const exitRows=input?[]:await teable.listByField(this.table('recruitment_exit_interviews'),'离职单ID',text(offboarding.fields['离职单ID'])||offboarding.id,100)
    const latestExit=exitRows.sort((a,b)=>text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))[0]
    const reason=[text(offboarding.fields['离职原因分类']),text(offboarding.fields['离职原因说明']),text(input?.mainReason)||text(latestExit?.fields['离职主因']),text(input?.suggestions)||text(latestExit?.fields['改进建议']),...(input?.dissatisfaction||json<string[]>(latestExit?.fields['不满意项JSON'],[]))].filter(Boolean).join('；')
    const interviewerIds=text(input?.interviewerUserId)?[text(input?.interviewerUserId)]:json<string[]>(source?.fields['面试官用户IDJSON'],[]).map(text).filter(Boolean)
    return this.optimizeInterviewQuestionBank(text(onboarding.fields['岗位']),text(onboarding.fields['职位ID'])||text(source?.fields['职位ID']),reason,source,interviewerIds)
  }

  async startProbationQuestionFeedback(reviewId: string, allowedPositionIds?: string[]) {
    const review = await teable.findOneByField(this.table('recruitment_probation_reviews'), '试用期记录ID', reviewId)
    if (!review || text(review.fields['处理状态']) !== '已完成') throw new BadRequestException('请先完成入职评价')
    if (allowedPositionIds) {
      const onboarding = await this.findOnboarding(text(review.fields['入职单ID']))
      if (!allowedPositionIds.includes(text(onboarding.fields['职位ID']))) throw new ForbiddenException('没有该岗位的题库权限')
    }
    const extra = json<Record<string, any>>(review.fields['扩展信息JSON'], {})
    if (extra.questionBank?.status === '已完成' || (extra.questionBank?.status === '处理中' && Date.now() - Date.parse(extra.questionBank.startedAt) < 10 * 60_000)) return extra.questionBank
    const startedAt = now()
    await teable.updateRecord(this.table('recruitment_probation_reviews'), review.id, { 扩展信息JSON: JSON.stringify({ ...extra, questionBank: { status: '处理中', startedAt } }), 更新时间: now() })
    const jobId = jobs.start(async progress => {
      try {
        progress('根据入职评价完善岗位和个人题库')
        const onboarding = await this.findOnboarding(text(review.fields['入职单ID']))
        const source = await this.resolveSourceInterview(onboarding)
        const evidence = ['节点类型', '述职评级', '新人成长等级', '述职评价', '负责人评价', '员工反馈', '转正建议'].map(field => `${field}：${text(review.fields[field])}`).join('；')
        const result = await this.optimizeInterviewQuestionBank(text(onboarding.fields['岗位']), text(onboarding.fields['职位ID']), evidence, source, json<string[]>(source?.fields['面试官用户IDJSON'], []), '入职评价反哺', reviewId)
        const state = { status: '已完成', created: result.created, completedAt: now() }
        await teable.updateRecord(this.table('recruitment_probation_reviews'), review.id, { 扩展信息JSON: JSON.stringify({ ...extra, questionBank: state }), 更新时间: now() })
        return state
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await teable.updateRecord(this.table('recruitment_probation_reviews'), review.id, { 扩展信息JSON: JSON.stringify({ ...extra, questionBank: { status: '失败', error: message.slice(0, 1000), startedAt } }), 更新时间: now() })
        throw error
      }
    })
    return { status: '处理中', jobId }
  }

  private async optimizeInterviewQuestionBank(role:string,positionId:string,reason:string,sourceInterview?:TeableRecord,interviewerIds:string[]=[],sourceType='离职原因反哺',sourceEventId=''){
    if(!reason)return{created:0}
    const position=positionId?await teable.findOneByField(this.table('recruitment_positions'),'职位ID',positionId):undefined
    const targetRole=text(position?.fields['职位名称'])||text(role)||text(sourceInterview?.fields['面试类型'])||'通用岗位'
    const sourceInterviewId=text(sourceInterview?.fields['面试ID'])
    const [questions,feedbackRows]=await Promise.all([
      teable.listAllRecords(this.table('recruitment_question_bank')),
      sourceInterviewId?teable.listByField(this.table('recruitment_interview_feedback'),'面试ID',sourceInterviewId,200):Promise.resolve([]),
    ])
    const snapshot=json<any[]>(sourceInterview?.fields['面试题快照JSON'],[])
    const audiences=['', ...new Set(interviewerIds.map(text).filter(Boolean))]
    const feedbackKey = sourceEventId || createHash('sha256').update(`${sourceInterviewId}:${reason}`).digest('hex')
    let created=0
    for(const interviewerUserId of audiences){
      if (questions.some(row => { const info = json<any>(row.fields['评分规则JSON'], {}); return info.feedbackKey === feedbackKey && info.feedbackComplete === true && text(row.fields['适用面试官用户ID']) === interviewerUserId })) continue
      const answers=feedbackRows.filter(row=>!interviewerUserId||text(row.fields['面试官用户ID'])===interviewerUserId).flatMap(row=>Object.entries(json<Record<string,unknown>>(row.fields['题目回答JSON'],{})).map(([questionId,value])=>({questionId,answer:text(value&&typeof value==='object'?((value as any).answer??(value as any).value):value)}))).filter(item=>item.answer)
      const askedQuestions=snapshot.filter(item=>answers.some(answer=>answer.questionId===text(item.questionId)||answer.questionId===text(item.question))).map(item=>text(item.question)).filter(Boolean)
      const existingForAudience=questions.filter(row=>{
        const stored=text(row.fields['适用面试官用户ID']),storedIds=json<string[]>(stored,stored?[stored]:[])
        const storedPositionId = text(json<any>(row.fields['评分规则JSON'], {}).positionId)
        return (storedPositionId ? storedPositionId === positionId : !text(row.fields['适用岗位'])||text(row.fields['适用岗位'])===targetRole)&&(!interviewerUserId?!stored:storedIds.includes(interviewerUserId))
      })
      const prompt=`你是结构化面试题库优化助手。员工评价或离职复盘揭示了面试可改善的方向。复盘类型：${sourceType}。同时提炼有效的胜任力证据，不把离职直接等同于能力不足。只返回JSON数组，每项：{"question":"...","why":"...","observation":"..."}。最多3条，必须可向候选人提问、聚焦可核验事实，不能涉及歧视、婚育或敏感隐私。对个人题库生成未覆盖的追问，对岗位题库提炼通用验证问题；如果已有题覆盖该事实则返回空数组。不要重复已有题，不输出员工姓名或可识别隐私信息。\n岗位：${targetRole}\n面试官：${interviewerUserId||'岗位通用'}\n复盘事实：${reason}\n该面试官已明确询问的问题：${askedQuestions.join('；')||'没有可确认的题目回答'}\n该面试官已有反哺题：${existingForAudience.map(row=>text(row.fields['题干'])).filter(Boolean).join('；')||'暂无'}`
      const answer=await llm.chat([{role:'system',content:'输出严格JSON数组。问题必须是合规、事实型、可在面试中验证的追问。'},{role:'user',content:prompt}])
      const parsed=JSON.parse(answer.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim())
      if(!Array.isArray(parsed))throw new Error('离职原因题库反哺返回格式不正确')
      for(const item of parsed.slice(0,3) as Array<{question?:string;why?:string;observation?:string}>){
        const title=text(item.question);if(!title)continue
        const duplicate=existingForAudience.find(row=>text(row.fields['题干'])===title)
        if(duplicate)continue
        const createdRow = await teable.createRecord(this.table('recruitment_question_bank'),{题目ID:id('question'),题目分类:interviewerUserId?'面试官追问题':'岗位复盘题',题目类型:'text',题干:title,题目说明:`来源：${sourceType}，请审核后启用。${text(item.why)}`,参考答案:text(item.observation),满分:10,是否必答:'否',题目来源:sourceType,题目状态:'草稿',适用岗位:targetRole,适用面试官用户ID:interviewerUserId,来源面试ID:sourceInterviewId,评分规则JSON:JSON.stringify({positionId,feedbackKey}),创建人:'评价复盘自动反哺',创建时间:now(),更新时间:now()})
        existingForAudience.push(createdRow)
        created++
      }
      const completedRow = existingForAudience.find(row => json<any>(row.fields['评分规则JSON'], {}).feedbackKey === feedbackKey)
      if (completedRow) await teable.updateRecord(this.table('recruitment_question_bank'), completedRow.id, { 评分规则JSON: JSON.stringify({ ...json<any>(completedRow.fields['评分规则JSON'], {}), feedbackComplete: true }), 更新时间: now() })
    }
    return{created}
  }
  async completeOffboarding(offboardingId:string,body:{actualDate:string;handover:string;assets:string;accounts:string;operator?:string}){
    const row=await this.findOffboarding(offboardingId)
    if(!text(body.actualDate)||!text(body.handover)||!text(body.assets)||!text(body.accounts))throw new BadRequestException('实际离职日期和三项交接状态不能为空')
    if([body.handover,body.assets,body.accounts].some(value=>value!=='已完成'))throw new ConflictException('工作交接、资产归还和账号关闭全部完成后才能确认离职')
    const timestamp=now()
    await teable.updateRecord(this.table('recruitment_offboarding_cases'),row.id,{实际离职日期:body.actualDate,离职状态:'已离职',交接状态:body.handover,资产归还状态:body.assets,账号关闭状态:body.accounts,完成时间:timestamp,更新时间:timestamp})
    const onboarding=await this.findOnboarding(text(row.fields['入职单ID']))
    await teable.updateRecord(this.table('recruitment_onboarding_cases'),onboarding.id,{入职状态:'已离职',更新时间:timestamp})
    await this.advanceApplication(onboarding,'已离职','确认离职',text(row.fields['离职原因说明']),body.operator)
    const followupsGenerated=await this.generateFollowupsFor(text(row.fields['候选人ID']),text(row.fields['入职单ID']),offboardingId,body.actualDate,body.operator)
    if(text(row.fields['人才回流标记'])==='建议回流'){
      const candidate=await teable.findOneByField(this.table('recruitment_candidates'),'候选人ID',text(row.fields['候选人ID']))
      if(candidate)await teable.updateRecord(this.table('recruitment_candidates'),candidate.id,{候选人状态:'离职可回流',人才池:'离职人才回流池',入池原因:text(row.fields['离职原因分类']),更新时间:timestamp})
    }
    let questionBankJobId=''
    if(!['已完成','处理中'].includes(text(row.fields['题库反哺状态']))){
      await teable.updateRecord(this.table('recruitment_offboarding_cases'),row.id,{题库反哺状态:'处理中',题库反哺错误:'',更新时间:now()})
      questionBankJobId=jobs.start(async progress=>{
        progress('员工已离职，正在将离职原因反哺面试官题库')
        try{
          const result=await this.optimizeOffboardingQuestionBank(row)
          await teable.updateRecord(this.table('recruitment_offboarding_cases'),row.id,{题库反哺状态:'已完成',题库反哺数量:result.created,题库反哺错误:'',题库反哺时间:now(),更新时间:now()})
          return{offboardingId,created:result.created}
        }catch(error){
          const message=error instanceof Error?error.message:String(error)
          await teable.updateRecord(this.table('recruitment_offboarding_cases'),row.id,{题库反哺状态:'失败',题库反哺错误:message.slice(0,1000),题库反哺时间:now(),更新时间:now()})
          throw error
        }
      })
    }
    return{offboardingId,status:'已离职',followupsGenerated,questionBankStatus:questionBankJobId?'处理中':text(row.fields['题库反哺状态'])||'待处理',questionBankJobId}
  }
  async retryQuestionBank(offboardingId:string){
    const row=await this.findOffboarding(offboardingId)
    if(text(row.fields['题库反哺状态'])==='处理中' && Date.now()-Date.parse(text(row.fields['更新时间']))<10*60_000)throw new ConflictException('面试题库正在更新，请稍后刷新查看')
    await teable.updateRecord(this.table('recruitment_offboarding_cases'),row.id,{题库反哺状态:'处理中',题库反哺错误:'',更新时间:now()})
    const jobId=jobs.start(async progress=>{
      progress('正在重新根据离职原因优化面试官题库')
      try{
        const result=await this.optimizeOffboardingQuestionBank(row)
        await teable.updateRecord(this.table('recruitment_offboarding_cases'),row.id,{题库反哺状态:'已完成',题库反哺数量:result.created,题库反哺错误:'',题库反哺时间:now(),更新时间:now()})
        return{offboardingId,created:result.created}
      }catch(error){
        const message=error instanceof Error?error.message:String(error)
        await teable.updateRecord(this.table('recruitment_offboarding_cases'),row.id,{题库反哺状态:'失败',题库反哺错误:message.slice(0,1000),题库反哺时间:now(),更新时间:now()})
        throw error
      }
    })
    return{offboardingId,questionBankStatus:'处理中',jobId}
  }
  async generateFollowups(body:{asOf?:string;operator?:string}){const offboardings=await teable.listAllRecords(this.table('recruitment_offboarding_cases'));let created=0;for(const row of offboardings.filter(r=>text(r.fields['离职状态'])==='已离职'))created+=await this.generateFollowupsFor(text(row.fields['候选人ID']),text(row.fields['入职单ID']),text(row.fields['离职单ID']),text(row.fields['实际离职日期']),body.operator);return{created}}
  async recordFollowup(followupId:string,input:FollowupInput){if(!text(input.result)||!text(input.reason)||!text(input.feedback))throw new BadRequestException('回访结果、原因和反馈内容不能为空');const table=this.table('recruitment_followups');let row=await teable.findOneByField(table,'回访ID',followupId);if(!row){try{row=await teable.getRecord(table,followupId)}catch{}}if(!row)throw new NotFoundException('回访任务不存在');const candidate=await teable.findOneByField(this.table('recruitment_candidates'),'候选人ID',text(row.fields['候选人ID'])),ratingBefore=text(input.ratingBefore)||text(candidate?.fields['人才评级']);await teable.updateRecord(table,row.id,{实际回访日期:now().slice(0,10),回访状态:'已完成',回访渠道:input.channel,回访结果:input.result,回访原因:input.reason,反馈内容:input.feedback,满意度评分:Math.max(0,Math.min(10,num(input.satisfaction))),人才评级调整前:ratingBefore,人才评级调整后:text(input.ratingAfter),回流意向:text(input.returnIntent),下次回访日期:text(input.nextDate),负责人:text(input.operator)||'当前用户',更新时间:now()});if(text(input.ratingAfter)&&candidate){await teable.updateRecord(this.table('recruitment_candidates'),candidate.id,{人才评级:text(input.ratingAfter),入池原因:`回访评级：${input.reason}`,更新时间:now()});await teable.createRecord(this.table('recruitment_candidate_tags'),{标签记录ID:id('tag'),候选人ID:text(row.fields['候选人ID']),标签名称:`人才评级-${text(input.ratingAfter)}`,标签分类:'人才评级',标签来源:'离职回访',置信度:100,证据:input.feedback,人工确认状态:'已确认',分析版本:'人工回访',创建时间:now(),更新时间:now()})}return{followupId,status:'已完成',rating:input.ratingAfter}}
  async analytics(){const[offboardings,followups]=await Promise.all([teable.listAllRecords(this.table('recruitment_offboarding_cases')),teable.listAllRecords(this.table('recruitment_followups'))]);const count=(rows:TeableRecord[],field:string)=>rows.reduce((a,r)=>{const k=text(r.fields[field])||'未分类';a[k]=(a[k]||0)+1;return a},{}as Record<string,number>);return{offboardingReasons:count(offboardings,'离职原因分类'),followupReasons:count(followups.filter(r=>text(r.fields['回访状态'])==='已完成'),'回访原因'),returnIntent:count(followups.filter(r=>text(r.fields['回访状态'])==='已完成'),'回流意向'),completedFollowups:followups.filter(r=>text(r.fields['回访状态'])==='已完成').length}}
  private async seedTasks(onboardingId:string,candidateId:string,start:string,operator?:string){for(const[category,name,days]of[['资料','核验身份证明',-5],['工位','准备工位与门禁',-2],['设备','准备电脑和办公设备',-2],['账号','创建企业微信和业务账号',-1],['培训','安排入职培训与导师',1]]as Array<[string,string,number]>){const d=new Date(`${start}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);await teable.createRecord(this.table('recruitment_onboarding_tasks'),{入职任务ID:id('ontask'),入职单ID:onboardingId,候选人ID:candidateId,任务分类:category,任务名称:name,截止时间:d.toISOString(),任务状态:'待处理',来源类型:'系统模板',创建时间:now(),更新时间:now()})}}
  private async seedProbation(onboardingId:string,candidateId:string,start:string,end:string){for(const[type,date]of[['入职一周回访',addDays(start,7)],['入职一月评价',addMonths(start,1)],['转正评估',end]]){const reviewId=id('probation');await teable.createRecord(this.table('recruitment_probation_reviews'),{试用期记录ID:reviewId,入职单ID:onboardingId,候选人ID:candidateId,节点类型:type,计划日期:date,处理状态:'待处理',通知状态:'待发送',创建时间:now(),更新时间:now()});await teable.createRecord(this.table('recruitment_tasks'),{待办ID:id('task'),待办类型:'试用期节点',对象类型:'试用期记录',对象ID:reviewId,标题:`${type}：待处理`,描述:`请在${date}前完成${type}评价`,优先级:type==='转正评估'?'高':'普通',待办状态:'待处理',截止时间:`${date}T18:00:00.000Z`,提醒时间:`${date}T09:00:00.000Z`,创建时间:now(),更新时间:now()})}}
  private async generateFollowupsFor(candidateId:string,onboardingId:string,offboardingId:string,base:string,operator?:string){if(!base)return 0;const rows=await teable.listByField(this.table('recruitment_followups'),'离职单ID',offboardingId,100);let created=0;for(const[type,days]of[['离职30天回访',30],['离职90天回访',90]]as Array<[string,number]>){if(rows.some(r=>text(r.fields['回访类型'])===type))continue;const d=new Date(`${base}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);await teable.createRecord(this.table('recruitment_followups'),{回访ID:id('followup'),候选人ID:candidateId,入职单ID:onboardingId,离职单ID:offboardingId,回访类型:type,计划回访日期:d.toISOString().slice(0,10),回访状态:'待回访',负责人:text(operator)||'待分配',创建时间:now(),更新时间:now()});created++}return created}
  private async refreshProgress(row:TeableRecord){const onboardingId=text(row.fields['入职单ID']),[docs,tasks]=await Promise.all([teable.listByField(this.table('recruitment_onboarding_documents'),'入职单ID',onboardingId,1000),teable.listByField(this.table('recruitment_onboarding_tasks'),'入职单ID',onboardingId,1000)]),docRate=docs.length?Math.round(docs.filter(x=>text(x.fields['资料状态'])==='已核验').length/docs.length*100):0,taskRate=tasks.length?Math.round(tasks.filter(x=>text(x.fields['任务状态'])==='已完成').length/tasks.length*100):0;await teable.updateRecord(this.table('recruitment_onboarding_cases'),row.id,{资料完成率:docRate,任务完成率:taskRate,更新时间:now()})}
  private async advanceApplication(onboarding:TeableRecord,stage:string,action:string,reason:string,operator?:string,operatorUserId?:string){const app=await teable.findOneByField(this.table('recruitment_applications'),'应聘记录ID',text(onboarding.fields['应聘记录ID']));if(!app)return;const old=text(app.fields['当前阶段']);await teable.updateRecord(this.table('recruitment_applications'),app.id,{当前阶段:stage,当前状态:stage==='已离职'?'已结束':'进行中',最近处理时间:now(),流程结束时间:stage==='已离职'?now():'',更新时间:now()});await teable.createRecord(this.table('recruitment_stage_events'),{事件ID:id('evt'),应聘记录ID:text(app.fields['应聘记录ID'])||app.id,候选人ID:text(onboarding.fields['候选人ID']),职位ID:text(app.fields['职位ID']),原阶段:old,新阶段:stage,操作:action,结果:'成功',原因:reason,操作人用户ID:text(operatorUserId),操作人:text(operator)||'当前用户',发生时间:now(),来源类型:'员工生命周期',来源记录ID:text(onboarding.fields['入职单ID'])});const candidate=await teable.findOneByField(this.table('recruitment_candidates'),'候选人ID',text(onboarding.fields['候选人ID']));if(candidate)await teable.updateRecord(this.table('recruitment_candidates'),candidate.id,{候选人状态:stage,更新时间:now()})}
  private async event(candidateId:string,onboardingId:string,offboardingId:string,type:string,from:string,to:string,note:string,extra:unknown,operator?:string,operatorUserId?:string){await teable.createRecord(this.table('recruitment_employee_lifecycle_events'),{员工事件ID:id('emplevent'),候选人ID:candidateId,入职单ID:onboardingId,离职单ID:offboardingId,事件类型:type,原状态:from,新状态:to,事件说明:note,扩展信息JSON:JSON.stringify(extra||{}),操作人用户ID:text(operatorUserId),操作人:text(operator)||'当前用户',发生时间:now()})}
  private async resolveSourceInterview(offboarding:TeableRecord,requestedId?:string){const rows=await teable.listByField(this.table('recruitment_interviews'),'候选人ID',text(offboarding.fields['候选人ID']),200),active=rows.filter(item=>text(item.fields['面试状态'])!=='已取消');return(text(requestedId)?active.find(item=>text(item.fields['面试ID'])===text(requestedId)||item.id===text(requestedId)):undefined)||active.filter(item=>!text(offboarding.fields['应聘记录ID'])||text(item.fields['应聘记录ID'])===text(offboarding.fields['应聘记录ID'])).sort((left,right)=>text(right.fields['开始时间']).localeCompare(text(left.fields['开始时间'])))[0]||active.sort((left,right)=>text(right.fields['开始时间']).localeCompare(text(left.fields['开始时间'])))[0]}
  private async findOnboarding(value:string){const table=this.table('recruitment_onboarding_cases');let row=await teable.findOneByField(table,'入职单ID',value);if(!row){try{row=await teable.getRecord(table,value)}catch{}}if(!row)throw new NotFoundException('入职单不存在');return row}
  private async findOffboarding(value:string){const table=this.table('recruitment_offboarding_cases');let row=await teable.findOneByField(table,'离职单ID',value);if(!row){try{row=await teable.getRecord(table,value)}catch{}}if(!row)throw new NotFoundException('离职单不存在');return row}
  private mapOnboarding(r:TeableRecord,c:TeableRecord|undefined,docs:TeableRecord[],tasks:TeableRecord[],probations:TeableRecord[],offboardings:TeableRecord[],interviews:TeableRecord[],followups:TeableRecord[]){const off=offboardings.sort((a,b)=>text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))[0];return{id:text(r.fields['入职单ID'])||r.id,number:text(r.fields['入职编号']),candidateId:text(r.fields['候选人ID']),candidateName:text(c?.fields['姓名']),applicationId:text(r.fields['应聘记录ID']),demandId:text(r.fields['需求ID']),role:text(r.fields['岗位']),department:text(r.fields['部门']),manager:text(r.fields['直属负责人']),location:text(r.fields['工作地点']),plannedStartDate:text(r.fields['计划入职日期']),actualStartDate:text(r.fields['实际到岗日期']),status:text(r.fields['入职状态']),documentProgress:num(r.fields['资料完成率']),taskProgress:num(r.fields['任务完成率']),externalSystem:text(r.fields['外部系统']),externalTaskId:text(r.fields['外部任务ID']),syncStatus:text(r.fields['外部同步状态']),probationEndDate:text(r.fields['试用期结束日期']),regularizationStatus:text(r.fields['转正状态']),updatedAt:text(r.fields['更新时间']),documents:docs.map(x=>({id:text(x.fields['资料ID']),type:text(x.fields['资料类型']),name:text(x.fields['资料名称']),url:text(x.fields['文件地址']),status:text(x.fields['资料状态']),note:text(x.fields['核验说明'])})),tasks:tasks.map(x=>({id:text(x.fields['入职任务ID']),category:text(x.fields['任务分类']),name:text(x.fields['任务名称']),owner:text(x.fields['负责人']),dueAt:text(x.fields['截止时间']),status:text(x.fields['任务状态']),note:text(x.fields['完成说明'])})),probations:probations.map(this.mapProbation),offboarding:off?{id:text(off.fields['离职单ID']),number:text(off.fields['离职编号']),status:text(off.fields['离职状态']),type:text(off.fields['离职类型']),reasonCategory:text(off.fields['离职原因分类']),reason:text(off.fields['离职原因说明']),plannedDate:text(off.fields['计划离职日期']),actualDate:text(off.fields['实际离职日期']),handover:text(off.fields['交接状态']),assets:text(off.fields['资产归还状态']),accounts:text(off.fields['账号关闭状态']),returnFlag:text(off.fields['人才回流标记']),questionBankStatus:text(off.fields['题库反哺状态']),questionBankCount:num(off.fields['题库反哺数量']),questionBankError:text(off.fields['题库反哺错误']),interviews:interviews.filter(x=>text(x.fields['离职单ID'])===text(off.fields['离职单ID'])).map(x=>({id:text(x.fields['离职面谈ID']),date:text(x.fields['面谈日期']),interviewer:text(x.fields['面谈人']),mainReason:text(x.fields['离职主因']),suggestions:text(x.fields['改进建议']),willingToReturn:text(x.fields['是否愿意回流']),questionBankStatus:text(x.fields['题库反哺状态']),questionBankCount:num(x.fields['题库反哺数量']),questionBankError:text(x.fields['题库反哺错误'])}))}:null,followups:followups.filter(x=>text(x.fields['入职单ID'])===text(r.fields['入职单ID'])).map(x=>({id:text(x.fields['回访ID']),type:text(x.fields['回访类型']),plannedDate:text(x.fields['计划回访日期']),actualDate:text(x.fields['实际回访日期']),status:text(x.fields['回访状态']),channel:text(x.fields['回访渠道']),result:text(x.fields['回访结果']),reason:text(x.fields['回访原因']),feedback:text(x.fields['反馈内容']),satisfaction:num(x.fields['满意度评分']),ratingAfter:text(x.fields['人才评级调整后']),returnIntent:text(x.fields['回流意向'])}))}}
  private mapProbation=(x:TeableRecord)=>({id:text(x.fields['试用期记录ID']),type:text(x.fields['节点类型']),plannedDate:text(x.fields['计划日期']),actualDate:text(x.fields['实际处理日期']),status:text(x.fields['处理状态']),performanceRating:text(x.fields['述职评级']),growthLevel:text(x.fields['新人成长等级']),appraisal:text(x.fields['述职评价']),score:num(x.fields['绩效评分']),managerReview:text(x.fields['负责人评价']),recommendation:text(x.fields['转正建议'])})
}
