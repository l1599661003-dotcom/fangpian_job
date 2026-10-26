import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { jobs } from '../../platform/jobs'
import { llm } from '../../platform/llm'
import { tianjiWeixinMessage } from '../../platform/tianji-weixin-message'
import { teable,TeableRecord } from '../../platform/teable'
import { DatabaseService } from '../database/database.service'
import { MessagesService } from '../messages/messages.service'
import { appFlowUrl, interviewQuestionsUrl } from '../../platform/app-links'
import { candidateEmailCard } from '../../platform/candidate-email'
import { InterviewDecisionInput, InterviewFeedbackInput, InterviewQuestionGenerateInput, InterviewTemplateInput } from './evaluation.types'
import { createInterviewQuestionWord } from './interview-question-word'
import { structuredFallbackQuestions, structuredInterviewDimensions, structuredInterviewMaxCount, structuredInterviewSystemPrompt, structuredInterviewTargetCount } from './interview-question-blueprint'
import { canReadInterview, InterviewAccessScope } from './interview-access'
import { isInterviewStartingSoon } from './interview-reminders'
const now=()=>new Date().toISOString(),id=(p:string)=>`${p}_${randomUUID().replace(/-/g,'').slice(0,20)}`,text=(v:unknown)=>String(v??'').trim(),num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0
const json=<T>(v:unknown,f:T):T=>{try{return v?JSON.parse(String(v)) as T:f}catch{return f}}
const withTimeout=<T>(promise:Promise<T>,timeoutMs:number,message:string)=>new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(message)),timeoutMs);promise.then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})})
const beijingDayKey=(timestamp:number)=>new Date(timestamp+8*3_600_000).toISOString().slice(0,10)
const beijingMinuteOfDay=(timestamp:number)=>{const shifted=new Date(timestamp+8*3_600_000);return shifted.getUTCHours()*60+shifted.getUTCMinutes()}
const rejectionEmailHtml=(candidateName:string,round:string,reason:string)=>candidateEmailCard({
 candidateName,
 title:'面试结果通知',
 intro:[`感谢你参加方片新媒体${round}面试。经过综合评估，本次面试结果为暂不通过。`,'感谢你对方片新媒体的关注，也感谢你在面试中投入的时间。祝你后续求职顺利。'],
 details:[{label:'面试轮次',value:round},{label:'面试结果',value:'暂不通过'}],
 note:reason,
 noteTitle:'结果说明',
 footer:'方片新媒体招聘团队',
})
@Injectable()
export class EvaluationService{
 private questionGenerationJobs=new Map<string,string>()
 private hrHandoffLocks=new Map<string,Promise<any>>()
 constructor(private readonly database:DatabaseService,private readonly messages:MessagesService){} private table(n:string){return this.database.requireTableId(n)}
 private candidateName(candidate:TeableRecord|undefined){return text(candidate?.fields['姓名'])||'候选人'}
 async templates(){await this.seedTemplates();const rows=await teable.listAllRecords(this.table('recruitment_interview_templates'));return{templates:rows.map(this.mapTemplate)}}
 async createTemplate(input:InterviewTemplateInput){if(!text(input.name)||!input.questions?.length||!input.dimensions?.length)throw new BadRequestException('模板名称、评价维度和面试问题不能为空');const total=input.dimensions.reduce((s,x)=>s+num(x.weight),0);if(Math.abs(total-100)>0.01)throw new BadRequestException('评价维度权重合计必须为100');const templateId=id('interviewtpl'),timestamp=now();await teable.createRecord(this.table('recruitment_interview_templates'),{面试模板ID:templateId,模板名称:input.name,候选人类型:input.candidateType,适用岗位:text(input.position),适用轮次:input.round,维度JSON:JSON.stringify(input.dimensions),问题JSON:JSON.stringify(input.questions.map((q,i)=>({...q,id:q.id||`q${i+1}`}))),模板状态:'启用',版本:1,创建人:text(input.operator)||'当前用户',创建时间:timestamp,更新时间:timestamp});await this.audit('新增面试模板','面试模板',templateId,{},input,text(input.operator)||'当前用户');return{templateId,status:'启用'}}
 async workbench(query:{status?:string;interviewerUserId?:string},scope?:InterviewAccessScope){const [interviews,candidates,feedback,templates,assessments]=await Promise.all([teable.listAllRecords(this.table('recruitment_interviews')),teable.listAllRecords(this.table('recruitment_candidates')),teable.listAllRecords(this.table('recruitment_interview_feedback')),teable.listAllRecords(this.table('recruitment_interview_templates')),teable.listAllRecords(this.table('recruitment_assessment_invites'))]);const items=interviews.filter(row=>canReadInterview(row,scope)).filter(r=>!query.status||text(r.fields['面试状态'])===query.status).filter(r=>!query.interviewerUserId||json<string[]>(r.fields['面试官用户IDJSON'],[]).includes(query.interviewerUserId)).map(r=>{const interviewId=text(r.fields['面试ID'])||r.id,candidateId=text(r.fields['候选人ID']),candidate=candidates.find(c=>text(c.fields['候选人ID'])===candidateId),rows=feedback.filter(f=>text(f.fields['面试ID'])===interviewId),assessment=assessments.filter(a=>text(a.fields['候选人ID'])===candidateId).sort((a,b)=>text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0];return{id:interviewId,candidateId,candidateName:text(candidate?.fields['姓名']),role:text(candidate?.fields['期望职位']),round:text(r.fields['面试轮次']),type:text(r.fields['面试类型']),startAt:text(r.fields['开始时间']),endAt:text(r.fields['结束时间']),status:text(r.fields['面试状态']),confirmationStatus:text(r.fields['候选人确认状态']),evaluationStatus:text(r.fields['评价状态']),questionStatus:text(r.fields['面试题状态'])||'待生成',interviewerIds:json<string[]>(r.fields['面试官用户IDJSON'],[]),feedbackCount:rows.filter(f=>text(f.fields['评价状态'])==='已提交').length,assessment:{score:num(assessment?.fields['人工最终分'])||num(assessment?.fields['AI建议分']),conclusion:text(assessment?.fields['人工结论'])},template:this.chooseTemplate(r,candidate,templates)}}).sort((a,b)=>b.startAt.localeCompare(a.startAt));return{total:items.length,pendingFeedback:items.filter(x=>['已完成','待评价'].includes(x.status)&&x.feedbackCount<x.interviewerIds.length).length,items}}
 async extractFeedbackTranscript(interviewId:string,transcriptValue:string,timeoutMs=30000){
  const transcript=text(transcriptValue)
  if(!transcript)throw new BadRequestException('请先口述、粘贴或导入面试结果')
  if(transcript.length>20000)throw new BadRequestException('面试结果文本最多20000字')
  const interview=await this.findInterview(interviewId)
  await this.saveNotes(interviewId,{notes:transcript,operator:'面试评价会议总结'})
  const candidateId=text(interview.fields['候选人ID']),positionId=text(interview.fields['职位ID'])
  const [candidate,position]=await Promise.all([
   teable.findOneByField(this.table('recruitment_candidates'),'候选人ID',candidateId),
   (async()=>{const matched=await teable.findOneByField(this.table('recruitment_positions'),'职位ID',positionId);if(matched||!positionId)return matched;try{return await teable.getRecord(this.table('recruitment_positions'),positionId)}catch{return undefined}})(),
  ])
  const candidateName=this.candidateName(candidate),role=text(position?.fields['职位名称'])||text(candidate?.fields['期望职位'])||'岗位待确认',round=text(interview.fields['面试轮次'])||'本轮面试'
  const prompt=`你是面试评价结构化助手。只根据面试官口述中明确表达的事实和判断整理评价，不得补充未提到的经历、能力或结论。\n候选人：${candidateName}\n岗位：${role}\n轮次：${round}\n返回纯JSON：{"recommendation":"通过|加面|储备|待讨论|淘汰|空","otherRoles":"明确提到的其他匹配岗位或空","strengths":"明确提到的优势或空","risks":"明确提到的短板、风险、待核实项或空","comment":"将明确提到的关键问答、事实、数据和最终判断整理为简洁完整的面试详情或空"}。\n“可以过、建议推进”映射为通过；“再面一轮、还要确认”映射为加面；“先放人才库”映射为储备；“不合适、不通过”映射为淘汰；没有明确判断时recommendation留空。不要返回Markdown。\n\n面试官口述：\n${transcript.slice(0,18000)}`
  let value:any
  try{const answer=await withTimeout(llm.chat([{role:'user',content:prompt}],{timeoutMs}),timeoutMs,'AI解析面试结果超时');value=JSON.parse(answer.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim())}
  catch(error){console.error(`[面试评价AI解析] ${error instanceof Error?error.message:String(error)}`);throw new ServiceUnavailableException('AI解析面试结果失败，请稍后重试或先手动填写')}
  const stringify=(input:unknown)=>Array.isArray(input)?input.map(text).filter(Boolean).join('；'):text(input)
  const recommendation=['通过','加面','储备','待讨论','淘汰'].includes(text(value?.recommendation))?text(value.recommendation):''
  return{source:'ai',candidateName,role,round,extraction:{recommendation,otherRoles:stringify(value?.otherRoles),strengths:stringify(value?.strengths),risks:stringify(value?.risks),comment:stringify(value?.comment)}}
 }
 async saveNotes(interviewId:string,body:{notes:string;transcript?:string;operator?:string}){if(!text(body.notes)&&!text(body.transcript))throw new BadRequestException('请填写面试记录或转写文本');const interview=await this.findInterview(interviewId),table=this.table('recruitment_interview_notes'),rows=await teable.listAllRecords(table),existing=rows.find(r=>text(r.fields['面试ID'])===interviewId),timestamp=now(),fields={纪要ID:text(existing?.fields['纪要ID'])||id('note'),面试ID:interviewId,候选人ID:text(interview.fields['候选人ID']),原始记录:body.notes,转写文本:text(body.transcript),AI状态:'待生成',创建时间:text(existing?.fields['创建时间'])||timestamp,更新时间:timestamp};if(existing)await teable.updateRecord(table,existing.id,fields);else await teable.createRecord(table,fields);return{noteId:fields.纪要ID,status:'待生成'}}
 generateAiDraft(interviewId:string){return{jobId:jobs.start(p=>this.generateAiDraftJob(interviewId,p)),status:'running'}}
 private async generateAiDraftJob(interviewId:string,progress:(s:string)=>void){progress('读取面试记录、简历和测评结果');const [interview,notes,candidates,assessments]=await Promise.all([this.findInterview(interviewId),teable.listAllRecords(this.table('recruitment_interview_notes')),teable.listAllRecords(this.table('recruitment_candidates')),teable.listAllRecords(this.table('recruitment_assessment_invites'))]);const note=notes.find(r=>text(r.fields['面试ID'])===interviewId);if(!note)throw new BadRequestException('请先保存面试记录');const candidateId=text(interview.fields['候选人ID']),candidate=candidates.find(r=>text(r.fields['候选人ID'])===candidateId),assessment=assessments.filter(r=>text(r.fields['候选人ID'])===candidateId).sort((a,b)=>text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0];const prompt=`根据面试记录生成辅助纪要草稿。只返回JSON {summary,strengths,risks,toVerify,suggestedScores:{professional,communication,execution,culture,potential},recommendation}。不能替代面试官评价。\n候选人经历:${text(candidate?.fields['工作经历'])}\n测评:${text(assessment?.fields['AI评分JSON'])}\n记录:${text(note.fields['原始记录'])} ${text(note.fields['转写文本'])}`;progress('AI生成纪要和评价草稿');let draft:any;try{draft=json(await llm.chat([{role:'system',content:'输出严格JSON，必须基于记录证据，禁止自动录用或淘汰。'},{role:'user',content:prompt}]),null)}catch{}if(!draft)draft={summary:'AI服务不可用，保留原始面试记录供人工整理。',strengths:[],risks:[],toVerify:['需人工核对面试记录'],suggestedScores:{},recommendation:'待讨论'};await teable.updateRecord(this.table('recruitment_interview_notes'),note.id,{AI纪要草稿:text(draft.summary),AI优势JSON:JSON.stringify(draft.strengths||[]),AI风险JSON:JSON.stringify(draft.risks||[]),AI待确认JSON:JSON.stringify(draft.toVerify||[]),AI版本:'interview-v1',AI状态:'待人工确认',更新时间:now()});return{interviewId,draft,requiresHumanReview:true}}
 async submitFeedback(interviewId:string,input:InterviewFeedbackInput){
  if(!text(input.interviewerUserId)||!text(input.interviewer))throw new BadRequestException('面试官身份不能为空')
  for(const[key,value]of Object.entries(input.scores||{}))if(num(value)<0||num(value)>100)throw new BadRequestException(`${key}评分必须在0到100之间`)
  const interviewerEvaluation=text(input.interviewerEvaluation)||text(input.comment),aiSummary=text(input.aiSummary),candidateRating=text(input.candidateRating)
  if(!interviewerEvaluation||!text(input.recommendation))throw new BadRequestException('面试官评价和面试结论不能为空')
  if(!['S','a','b','c','z'].includes(candidateRating))throw new BadRequestException('请选择有效的候选人评级（S、a、b、c、z）')
  const evaluationLength=Array.from(interviewerEvaluation.replace(/\s/g,'')).length
  if(evaluationLength<50)throw new BadRequestException(`面试官评价至少填写50字（不含空白），当前${evaluationLength}字`)
  if(!text(input.notes))throw new BadRequestException('请先粘贴会议总结并生成AI面试总结')
  if(!aiSummary)throw new BadRequestException('请先使用会议总结转换生成AI面试总结')
  const interview=await this.findInterview(interviewId),table=this.table('recruitment_interview_feedback'),rows=await teable.listAllRecords(table)
  const assignedIds=json<string[]>(interview.fields['面试官用户IDJSON'],[])
  if(!assignedIds.includes(input.interviewerUserId))throw new BadRequestException('该评价人不在本次面试官名单中')
  if(!['通过','淘汰','加面','储备','待讨论'].includes(input.recommendation))throw new BadRequestException('请选择有效的面试评价结论')
  const existing=rows.filter(r=>text(r.fields['面试ID'])===interviewId&&text(r.fields['面试官用户ID'])===input.interviewerUserId).sort((a,b)=>num(b.fields['版本'])-num(a.fields['版本']))[0]
  if(existing&&text(existing.fields['锁定状态'])==='已锁定')throw new ConflictException('该面试官评价已经锁定，不能覆盖')
  const scores={professional:num(input.scores?.professional),communication:num(input.scores?.communication),execution:num(input.scores?.execution),culture:num(input.scores?.culture),potential:num(input.scores?.potential)}
  const overall=Math.round((scores.professional+scores.communication+scores.execution+scores.culture+scores.potential)/5),feedbackId=id('feedback'),timestamp=now(),deadline=new Date(Date.parse(text(interview.fields['结束时间']))+24*3600000).toISOString()
  await teable.createRecord(table,{评价ID:feedbackId,面试ID:interviewId,应聘记录ID:text(interview.fields['应聘记录ID']),候选人ID:text(interview.fields['候选人ID']),面试官用户ID:input.interviewerUserId,面试官:input.interviewer,候选人评级:candidateRating,专业能力分:scores.professional,沟通能力分:scores.communication,执行能力分:scores.execution,文化匹配分:scores.culture,发展潜力分:scores.potential,综合分:overall,推荐结论:input.recommendation,其他匹配岗位:text(input.otherRoles),候选人优势:text(input.strengths),风险与待核实项:text(input.risks),面试评价:interviewerEvaluation,面试官评价:interviewerEvaluation,AI面试总结:aiSummary,AI评价草稿:aiSummary,备注:text(input.notes),题目回答JSON:JSON.stringify(input.questionAnswers||{}),评分证据JSON:JSON.stringify(input.evidence||{}),AI草稿状态:aiSummary?'AI总结已人工核对':'未使用AI',人工确认状态:'已确认',提交时间:timestamp,评价截止时间:deadline,评价状态:'已提交',锁定状态:'已锁定',版本:num(existing?.fields['版本'])+1||1,创建时间:timestamp,更新时间:timestamp})
  const submittedIds=new Set(rows.filter(r=>text(r.fields['面试ID'])===interviewId&&text(r.fields['评价状态'])==='已提交'&&assignedIds.includes(text(r.fields['面试官用户ID']))).map(r=>text(r.fields['面试官用户ID'])))
  submittedIds.add(text(input.interviewerUserId))
  const interviewerIds=json<string[]>(interview.fields['面试官用户IDJSON'],[]),all=submittedIds.size,expected=interviewerIds.length
  await teable.updateRecord(this.table('recruitment_interviews'),interview.id,{评价状态:all>=expected?'已完成':'部分已提交',面试状态:text(interview.fields['面试状态'])==='进行中'?'已完成':text(interview.fields['面试状态']),更新时间:timestamp})
  await this.completeTask(interviewId,input.interviewerUserId)
  await this.audit('提交面试评价','面试',interviewId,{},input,text(input.operator)||input.interviewer)
  let handoff:any
  try{handoff=await this.ensureHrHandoff(interviewId)}catch(error){handoff={status:'待重试',message:error instanceof Error?error.message:String(error)}}
  return{feedbackId,overall,submitted:all,expected,handoff}
 }
 async ensureHrHandoff(interviewId:string):Promise<any>{
  const running=this.hrHandoffLocks.get(interviewId)
  if(running)return running
  const work=this.deliverHrHandoff(interviewId).finally(()=>this.hrHandoffLocks.delete(interviewId))
  this.hrHandoffLocks.set(interviewId,work)
  return work
 }

 private async deliverHrHandoff(interviewId:string){
  const interview=await this.findInterview(interviewId)
  if(text(interview.fields['面试状态'])==='已取消')return{status:'无需处理'}
  const candidateId=text(interview.fields['候选人ID']),applicationId=text(interview.fields['应聘记录ID']),positionId=text(interview.fields['职位ID'])
  const [feedback,tasks,candidate,position]=await Promise.all([
   teable.listByField(this.table('recruitment_interview_feedback'),'面试ID',interviewId,200),
   teable.listByField(this.table('recruitment_tasks'),'对象ID',interviewId,200),
   teable.findOneByField(this.table('recruitment_candidates'),'候选人ID',candidateId),
   teable.findOneByField(this.table('recruitment_positions'),'职位ID',positionId),
  ])
  const interviewerIds=[...new Set(json<string[]>(interview.fields['面试官用户IDJSON'],[]))]
  const submitted=interviewerIds.map(userId=>feedback.filter(row=>text(row.fields['面试官用户ID'])===userId&&text(row.fields['评价状态'])==='已提交').sort((first,second)=>num(second.fields['版本'])-num(first.fields['版本']))[0])
  const decision=text(interview.fields['面试结果'])
  if((interviewerIds.length&&submitted.some(row=>!row))||(!decision&&!interviewerIds.length))return{status:'等待其他面试官评价'}
  const allSubmitted=interviewerIds.length>0&&submitted.every(Boolean)
  const recommendations=new Set(submitted.filter(Boolean).map(row=>text(row?.fields['推荐结论'])))
  const finalDecision=decision||(allSubmitted&&recommendations.size===1?[...recommendations][0]:'')
  if(!finalDecision){
   const phase='面试待决策'
   const url=appFlowUrl('decision',{candidate_id:candidateId,interview_id:interviewId,position_id:positionId,application_id:applicationId})
   if(!url)throw new BadRequestException('未配置应用公开地址，HR决策通知将在配置恢复后重试')
   const task=tasks.find(row=>text(row.fields['待办类型'])==='面试后HR处理')
   const previous=json<any>(task?.fields['扩展信息JSON'],{})
   if(previous.phase===phase&&previous.notificationStatus==='已发送')return{status:'已通知HR',nextStep:phase,url}
   const summary=submitted.filter(Boolean).map(row=>`${text(row.fields['面试官'])}：${text(row.fields['推荐结论'])}（${num(row.fields['综合分'])}分）`).join('；')
   const details={...previous,phase,url,interviewId,candidateId,applicationId,positionId,attempts:num(previous.attempts)+1,notificationStatus:'待发送',lastError:''}
   const taskFields={待办类型:'面试后HR处理',对象类型:'面试',对象ID:interviewId,标题:`${this.candidateName(candidate)} · ${phase}`,描述:`${summary}。面试官结论不一致，请HR复核后决策。`,处理人用户ID:text(position?.fields['招聘HR用户ID'])||text(position?.fields['备用招聘HR用户ID']),处理人:text(position?.fields['招聘HR'])||'岗位招聘HR',优先级:'高',待办状态:'待处理',扩展信息JSON:JSON.stringify(details),更新时间:now()}
   const saved=task?await teable.updateRecord(this.table('recruitment_tasks'),task.id,taskFields):await teable.createRecord(this.table('recruitment_tasks'),{...taskFields,待办ID:id('todo'),创建时间:now()})
   let notification:any
   try{notification=await this.messages.notifyPositionHr({category:'面试评价待决策',candidateId,positionId,applicationId,objectId:interviewId,objectType:'面试后HR处理',markdown:`## 【${phase}】${this.candidateName(candidate)}\n> 岗位：${text(position?.fields['职位名称'])||'待确认'} · ${text(interview.fields['面试轮次'])}\n> 评价结果：${summary}\n面试官结论不一致，请复核评价后决策。\n[打开面试决策 →](${url})`,operator:'面试评价完成自动交接'})}
   catch(error){notification={status:'发送失败',reason:error instanceof Error?error.message:String(error)}}
   const delivered=['已发送','已跳过'].includes(notification.status)
   const blockedReason=delivered?'':text(notification.reason||notification.error)||'天玑消息未送达'
   await teable.updateRecord(this.table('recruitment_tasks'),saved.id,{扩展信息JSON:JSON.stringify({...details,notificationStatus:delivered?'已发送':'发送失败',lastError:blockedReason,lastAttemptAt:now()}),处理人用户ID:notification.recruiterUserId||taskFields.处理人用户ID,更新时间:now()})
   return{status:delivered?'已通知HR':'待重试',nextStep:phase,url,blockedReason}
  }
  if(['储备','待讨论'].includes(finalDecision))return{status:'无需处理',decision:finalDecision}
  const rejected=finalDecision==='淘汰'
  if(rejected){
   const reason=decision?text((await teable.listByField(this.table('recruitment_interview_decisions'),'面试ID',interviewId,200)).sort((first,second)=>text(second.fields['决策时间']).localeCompare(text(first.fields['决策时间'])))[0]?.fields['决策原因']):submitted.map(row=>text(row?.fields['风险与待核实项'])).filter(Boolean).join('；')
   const mail=await this.sendRejectionEmail(interview,candidate,reason,'面试评价完成自动通知')
   const mailDelivered=['已发送','已跳过'].includes(mail.status)
   return{status:mailDelivered?'已通知候选人':'待重试',nextStep:'面试不通过邮件',mail,blockedReason:mailDelivered?'':text(mail.message)}
  }
  const passed=finalDecision==='通过',additionalRound=finalDecision==='加面'
  if(!passed&&!additionalRound)return{status:'等待最终决策'}
  const phase=passed?'Offer待填写':'安排加面'
  const action=passed?'offer':'schedule'
  const url=appFlowUrl(action,{candidate_id:candidateId,interview_id:interviewId,position_id:positionId,application_id:applicationId})
  if(!url)throw new BadRequestException('未配置应用公开地址，HR交接将在配置恢复后重试')
  const task=tasks.find(row=>text(row.fields['待办类型'])==='面试后HR处理')
  const previous=json<any>(task?.fields['扩展信息JSON'],{})
  const offers=passed?await teable.listByField(this.table('recruitment_offers'),'候选人ID',candidateId,200):[]
  const offer=offers.find(row=>(applicationId?text(row.fields['应聘记录ID'])===applicationId:positionId&&text(row.fields['职位ID'])===positionId)&&!['已撤回','已作废','已取消'].includes(text(row.fields['Offer状态']))&&Date.parse(text(row.fields['创建时间']))>=(Date.parse(text(interview.fields['创建时间']))||0))
  if(offer){
   if(task&&text(task.fields['待办状态'])!=='已完成')await teable.updateRecord(this.table('recruitment_tasks'),task.id,{待办状态:'已完成',完成时间:now(),扩展信息JSON:JSON.stringify({...previous,offerId:text(offer.fields['OfferID']),phase}),更新时间:now()})
   return{status:'Offer已填写',offerId:text(offer.fields['OfferID'])}
  }
  if(previous.phase===phase&&previous.notificationStatus==='已发送')return{status:'已通知HR',nextStep:phase,url}
  const summary=submitted.filter(Boolean).map(row=>{const score=num(row!.fields['综合分']);return `${text(row!.fields['面试官'])}：${text(row!.fields['推荐结论'])}${score?`（${score}分）`:''}`}).join('；')
  const details={...previous,phase,url,interviewId,candidateId,applicationId,positionId,attempts:num(previous.attempts)+1,notificationStatus:'待发送',lastError:''}
  const taskFields={待办类型:'面试后HR处理',对象类型:'面试',对象ID:interviewId,标题:`${this.candidateName(candidate)} · ${phase}`,描述:`${summary}。${passed?'请填写薪资、入职日期和Offer信息，核对后再发送。':'请为候选人安排下一轮面试。'}`,处理人用户ID:text(position?.fields['招聘HR用户ID'])||text(position?.fields['备用招聘HR用户ID']),处理人:text(position?.fields['招聘HR'])||'岗位招聘HR',优先级:'高',待办状态:'待处理',扩展信息JSON:JSON.stringify(details),更新时间:now()}
  const saved=task?await teable.updateRecord(this.table('recruitment_tasks'),task.id,taskFields):await teable.createRecord(this.table('recruitment_tasks'),{...taskFields,待办ID:id('todo'),创建时间:now()})
  let notification:any
  try{
   notification=await this.messages.notifyPositionHr({category:passed?'面试通过填Offer':'面试加面安排',candidateId,positionId,applicationId,objectId:interviewId,objectType:'面试后HR处理',markdown:`## 【${phase}】${this.candidateName(candidate)}\n> 岗位：${text(position?.fields['职位名称'])||'待确认'} · ${text(interview.fields['面试轮次'])}\n> 评价结果：${summary||finalDecision}\n${passed?'请填写薪资、入职日期及Offer信息，人工核对后发送。':'请为候选人安排下一轮面试。'}\n[${passed?'填写该候选人的 Offer':'安排该候选人的加面'} →](${url})`,operator:'面试评价完成自动交接'})
  }catch(error){notification={status:'发送失败',reason:error instanceof Error?error.message:String(error)}}
  const delivered=['已发送','已跳过'].includes(notification.status)
  const blockedReason=delivered?'':text(notification.reason||notification.error)||'天玑消息未送达'
  await teable.updateRecord(this.table('recruitment_tasks'),saved.id,{扩展信息JSON:JSON.stringify({...details,notificationStatus:delivered?'已发送':'发送失败',lastError:blockedReason,lastAttemptAt:now()}),处理人用户ID:notification.recruiterUserId||taskFields.处理人用户ID,更新时间:now()})
  return{status:delivered?'已通知HR':'待重试',nextStep:phase,url,blockedReason}
 }

 async checkHrHandoffs(){
  const [interviews,feedback]=await Promise.all([teable.listAllRecords(this.table('recruitment_interviews')),teable.listAllRecords(this.table('recruitment_interview_feedback'))])
  const submittedInterviews=new Set(feedback.filter(row=>text(row.fields['评价状态'])==='已提交').map(row=>text(row.fields['面试ID'])))
  const errors:string[]=[]
  let pending=0
  let notified=0
  for(const interview of interviews.filter(row=>text(row.fields['面试状态'])!=='已取消'&&(text(row.fields['面试结果'])||submittedInterviews.has(text(row.fields['面试ID'])||row.id)))){
   const interviewId=text(interview.fields['面试ID'])||interview.id
   try{
    const result=await this.ensureHrHandoff(interviewId)
    if(result.status==='已通知HR')notified++
    if(result.status==='待重试'){
      const reason=text(result.blockedReason)
      if(/候选人邮箱不存在|候选人档案不存在|未找到应聘记录对应岗位|岗位未绑定招聘HR/.test(reason))pending++
      else errors.push(`${interviewId}: HR交接消息等待重试${reason?`（${reason}）`:''}`)
    }
   }
   catch(error){errors.push(`${interviewId}: ${error instanceof Error?error.message:String(error)}`)}
  }
  return{notified,pending,errors}
 }
 async feedback(interviewId:string){
  const interview=await this.findInterview(interviewId),candidateId=text(interview.fields['候选人ID'])
  const [rows,historyRows,interviews]=await Promise.all([
   teable.listByField(this.table('recruitment_interview_feedback'),'面试ID',interviewId,200),
   teable.listByField(this.table('recruitment_interview_feedback'),'候选人ID',candidateId,200),
   teable.listByField(this.table('recruitment_interviews'),'候选人ID',candidateId,200),
  ])
  const interviewById=new Map(interviews.map(row=>[text(row.fields['面试ID'])||row.id,row]))
  const history=historyRows.filter(row=>text(row.fields['评价状态'])==='已提交').map(row=>{
   const item=this.mapFeedback(row),related=interviewById.get(item.interviewId)
   return{...item,round:text(related?.fields['面试轮次']),interviewStartAt:text(related?.fields['开始时间']),finalDecision:text(related?.fields['面试结果'])}
  }).sort((first,second)=>second.submittedAt.localeCompare(first.submittedAt))
  return{feedback:rows.map(this.mapFeedback),history}
 }
 async questions(interviewId:string){
  const interview=await this.findInterview(interviewId)
  const [candidate,position]=await Promise.all([teable.findOneByField(this.table('recruitment_candidates'),'候选人ID',text(interview.fields['候选人ID'])),teable.findOneByField(this.table('recruitment_positions'),'职位ID',text(interview.fields['职位ID']))])
  const interviewerIds=json<string[]>(interview.fields['面试官用户IDJSON'],[]),storedNames=json<string[]>(interview.fields['面试官姓名JSON'],[]).map(text).filter(Boolean)
  let interviewerNames=storedNames
  if(!interviewerNames.length){const[users,pool]=await Promise.all([teable.listAllRecords(this.table('recruitment_users')),teable.listAllRecords(this.table('recruitment_interviewer_pool'))]);interviewerNames=interviewerIds.map(userId=>{const user=users.find(row=>text(row.fields['用户ID'])===userId||text(row.fields['企业微信用户ID'])===userId),legacy=pool.find(row=>text(row.fields['面试官ID'])===userId||text(row.fields['用户ID'])===userId);return text(user?.fields['姓名'])||text(legacy?.fields['姓名'])||userId}).filter(Boolean)}
  return { interviewId:text(interview.fields['面试ID'])||interview.id, candidateId:text(interview.fields['候选人ID']), candidateName:this.candidateName(candidate), role:text(position?.fields['职位名称'])||text(candidate?.fields['期望职位'])||text(interview.fields['面试类型'])||'通用岗位', round:text(interview.fields['面试轮次']), startAt:text(interview.fields['开始时间']), endAt:text(interview.fields['结束时间']), interviewerNames, status:text(interview.fields['面试题状态'])||'待生成', generatedAt:text(interview.fields['面试题生成时间']), questions:json<any[]>(interview.fields['面试题快照JSON'],[]) }
 }
 async exportQuestions(interviewId:string){const detail=await this.questions(interviewId);if(!detail.questions.length)throw new BadRequestException('本次面试尚未生成题目，暂时无法导出');const content=await createInterviewQuestionWord(detail);const safe=(value:unknown)=>text(value).replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,' ').slice(0,40),date=(detail.startAt||detail.generatedAt||now()).slice(0,10);return{fileName:`${safe(detail.candidateName)||'候选人'}-${safe(detail.role)||'通用岗位'}-${safe(detail.round)||'面试'}-面试题-${date}.docx`,content}}
 async checkFeedbackSla(operator='系统') {
  const [interviews, feedback, tasks, links, candidates] = await Promise.all([
    teable.listAllRecords(this.table('recruitment_interviews')),
    teable.listAllRecords(this.table('recruitment_interview_feedback')),
    teable.listAllRecords(this.table('recruitment_tasks')),
    teable.listAllRecords(this.table('recruitment_public_links')),
    teable.listAllRecords(this.table('recruitment_candidates')),
  ])
  let created = 0
  let notified = 0
  const errors: string[] = []
  const current = Date.now()
  const day = 24 * 3_600_000
  for (const interview of interviews.filter(row => {
    const end = Date.parse(text(row.fields['结束时间']))
    return Number.isFinite(end) && current >= end && text(row.fields['面试状态']) !== '已取消'
  })) {
    const interviewId = text(interview.fields['面试ID']) || interview.id
    const interviewerIds = json<string[]>(interview.fields['面试官用户IDJSON'], [])
    const candidate = candidates.find(row => text(row.fields['候选人ID']) === text(interview.fields['候选人ID']))
    const end = Date.parse(text(interview.fields['结束时间']))
    const deadline = new Date(end + day).toISOString()
    const currentDay = beijingDayKey(current)
    const dailyReminderDue = beijingMinuteOfDay(current) >= 9 * 60 && currentDay > beijingDayKey(end)
    for (const userId of interviewerIds) {
      if (feedback.some(row => text(row.fields['面试ID']) === interviewId && text(row.fields['面试官用户ID']) === userId && text(row.fields['评价状态']) === '已提交')) continue
      const objectId = `${interviewId}:${userId}`
      let task = tasks.find(row => text(row.fields['待办类型']) === '面试评价' && text(row.fields['对象ID']) === objectId && text(row.fields['待办状态']) !== '已完成')
      const link = await this.createPublicEvaluationLink(interview, userId, links)
      const overdue = current > Date.parse(deadline)
      if (!task) {
        task = await teable.createRecord(this.table('recruitment_tasks'), {
          待办ID: id('todo'), 待办类型: '面试评价', 对象类型: '面试评价', 对象ID: objectId,
          标题: '请提交面试评价', 描述: `面试 ${interviewId} 已结束，请独立提交评价`, 处理人用户ID: userId,
          优先级: overdue ? '高' : '中', 待办状态: '待处理', 截止时间: deadline, 提醒时间: '',
          升级层级: overdue ? 1 : 0, 扩展信息JSON: JSON.stringify({ evaluationUrl: link.url, interviewerUserId: userId }),
          创建时间: now(), 更新时间: now(),
        })
        tasks.push(task)
        created++
      }
      let result: any
      try {
        result = await this.messages.notifyDirectUsers({
          category: '面试评价入口', candidateId: text(interview.fields['候选人ID']), objectId: `${objectId}:initial`, objectType: '面试评价', userIds: [userId],
          markdown: `## 【面试评价入口】${this.candidateName(candidate)}
> 面试已结束，请填写本次面试评价。
[打开面试评价 →](${link.url})`, operator,
        })
      } catch (error) {
        errors.push(`${interviewId}/${userId}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      if (result.status === '已发送') notified++
      if (result.status === '发送失败') errors.push(`${interviewId}/${userId}: ${text(result.reason) || '面试评价入口发送失败'}`)
      if (result.status !== '已发送' || !dailyReminderDue) {
        if (['已发送','已跳过'].includes(result.status)) {
          const timestamp = now()
          await teable.updateRecord(this.table('recruitment_tasks'), task.id, { 待办状态: '已提醒', 提醒时间: timestamp, 更新时间: timestamp })
        }
        continue
      }
      const reminderNumber = Math.max(1, Math.floor((current - end) / day))
      try {
        result = await this.messages.notifyDirectUsers({
          category: '面试评价催填', candidateId: text(interview.fields['候选人ID']), objectId: `${objectId}:${currentDay}`, objectType: '面试评价', userIds: [userId],
          markdown: `## 【面试评价待提交】${this.candidateName(candidate)}
> 面试已结束，请面试官独立填写评价。
[打开面试评价表 →](${link.url})
<font color="comment">每日 09:00 提醒 · 第${reminderNumber}次提醒</font>`, operator,
        })
      } catch (error) {
        errors.push(`${interviewId}/${userId}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      if (result.status === '已发送') notified++
      if (['已发送','已跳过'].includes(result.status)) {
        const timestamp = now()
        await teable.updateRecord(this.table('recruitment_tasks'), task.id, { 待办状态: '已提醒', 提醒时间: timestamp, 更新时间: timestamp })
        await teable.updateRecord(this.table('recruitment_interviews'), interview.id, { 面试评价催填时间: timestamp, 更新时间: timestamp })
      } else if (result.status === '发送失败') {
        const timestamp = now()
        await teable.updateRecord(this.table('recruitment_tasks'), task.id, { 待办状态: '待处理', 提醒时间: timestamp, 更新时间: timestamp })
        errors.push(`${interviewId}/${userId}: ${text(result.reason) || '面试评价提醒发送失败'}`)
      }
    }
  }
  return { checked: interviews.length, created, notified, errors, operator }
 }

 async checkBeforeInterviews() {
  const [interviews, candidates] = await Promise.all([
   teable.listAllRecords(this.table('recruitment_interviews')),
   teable.listAllRecords(this.table('recruitment_candidates')),
  ])
  const current = Date.now()
  let notified = 0
  const errors: string[] = []
  for (const interview of interviews) {
   if (!isInterviewStartingSoon(interview, current)) continue
   const interviewId = text(interview.fields['面试ID']) || interview.id
   const candidate = candidates.find(row => text(row.fields['候选人ID']) === text(interview.fields['候选人ID']))
   const interviewerIds = json<string[]>(interview.fields['面试官用户IDJSON'], [])
   if (!interviewerIds.length) continue
   const startAt = text(interview.fields['开始时间'])
   const time = new Date(startAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
   const location = text(interview.fields['会议地址']) || text(interview.fields['面试地点']) || '请查看面试邀请'
   const results: any[] = []
   for (const userId of interviewerIds) {
    try {
     const result = await this.messages.notifyDirectUsers({
      category: '面试即将开始', candidateId: text(interview.fields['候选人ID']), objectId: `${interviewId}:${startAt}`, objectType: '面试题', userIds: [userId],
      markdown: `## 【面试即将开始】${this.candidateName(candidate)}\n> 时间：${time}（北京时间）\n> 地点：${location}\n[打开并打印面试题 →](${interviewQuestionsUrl(interviewId)})`, operator: '面试流程自动通知',
     })
     results.push(result)
     if (result.status === '已发送') notified++
     if (result.status === '发送失败') errors.push(`${interviewId}/${userId}: ${text(result.reason) || '面试开始提醒发送失败'}`)
    } catch (error) { errors.push(`${interviewId}/${userId}: ${error instanceof Error ? error.message : String(error)}`) }
   }
   const questionSnapshot = json<any[]>(interview.fields['面试题快照JSON'], [])
   if (results.length && questionSnapshot.length && results.every(result => ['已发送','已跳过'].includes(text(result.status)))) {
    await teable.updateRecord(this.table('recruitment_interviews'), interview.id, { 面试题状态: '已发布', 面试题生成错误: '', 更新时间: now() })
   }
  }
  return { checked: interviews.length, notified, errors }
 }

 private async createPublicEvaluationLink(interview: TeableRecord, interviewerUserId: string, existingLinks: TeableRecord[]) {
  const interviewId = text(interview.fields['面试ID']) || interview.id
  const objectId = `${interviewId}:${interviewerUserId}`
  const active = existingLinks.find(row => text(row.fields['链接类型']) === '面试评价' && text(row.fields['对象ID']) === objectId && text(row.fields['链接状态']) === '有效' && Date.parse(text(row.fields['过期时间'])) > Date.now())
  if (active) return { url: text(active.fields['访问路径']) }
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Math.max(Date.now(), Date.parse(text(interview.fields['结束时间'])) || 0) + 3 * 86_400_000).toISOString()
  const base = text(process.env.APP_PUBLIC_URL).replace(/\/+$/, '')
  if (!base) throw new BadRequestException('未配置应用公开地址，无法生成面试评价链接')
  const url = `${base}/evaluation?evaluation_token=${encodeURIComponent(token)}`
  const created = await teable.createRecord(this.table('recruitment_public_links'), {
    链接ID: id('link'), 候选人ID: text(interview.fields['候选人ID']), 链接类型: '面试评价', 对象类型: '面试评价', 对象ID: objectId,
    访问Token哈希: createHash('sha256').update(token).digest('hex'), Token前缀: token.slice(0, 8), 访问路径: url,
    链接状态: '有效', 过期时间: expiresAt, 创建人: '面试流程自动通知', 创建时间: now(), 更新时间: now(),
  })
  existingLinks.push(created)
  return { url }
 }

 async publicEvaluationDetail(token: string) {
  const link = await this.resolvePublicEvaluationLink(token)
  const interviewId = text(link.fields['对象ID']).split(':')[0]
  const interviewerUserId = text(link.fields['对象ID']).slice(interviewId.length + 1)
  const [interview, candidates, positions, users, interviewerPool] = await Promise.all([this.findInterview(interviewId), teable.listAllRecords(this.table('recruitment_candidates')), teable.listAllRecords(this.table('recruitment_positions')), teable.listAllRecords(this.table('recruitment_users')), teable.listAllRecords(this.table('recruitment_interviewer_pool'))])
  const candidate = candidates.find(row => text(row.fields['候选人ID']) === text(interview.fields['候选人ID']))
  const position = positions.find(row => text(row.fields['职位ID']) === text(interview.fields['职位ID']) || row.id === text(interview.fields['职位ID']))
  const user = users.find(row => text(row.fields['用户ID']) === interviewerUserId || row.id === interviewerUserId)
  const pool = interviewerPool.find(row => text(row.fields['用户ID']) === interviewerUserId || text(row.fields['面试官ID']) === interviewerUserId)
  if(text(interview.fields['面试状态'])==='已取消')throw new ConflictException('本次面试已取消，请联系招聘负责人')
  if(!json<string[]>(interview.fields['面试官用户IDJSON'],[]).includes(interviewerUserId))throw new ConflictException('你已不在本次面试的面试官名单中')
  const feedback=await teable.listByField(this.table('recruitment_interview_feedback'),'面试ID',interviewId,200)
  const own=feedback.filter(row=>text(row.fields['面试官用户ID'])===interviewerUserId)
  if(own.some(row=>text(row.fields['锁定状态'])==='已锁定'))throw new ConflictException('面试评价已提交并锁定')
  const draft=own.find(row=>text(row.fields['评价状态'])==='草稿')
  const questionSnapshot=json<any[]>(interview.fields['面试题快照JSON'],[]).filter(question=>!Array.isArray(question.interviewerIds)||!question.interviewerIds.length||question.interviewerIds.includes(interviewerUserId))
  return { interviewId, interviewerUserId, interviewerName: text(user?.fields['姓名']) || text(pool?.fields['姓名']) || interviewerUserId, candidateName: this.candidateName(candidate), role: text(position?.fields['职位名称']) || text(interview.fields['职位ID']), round: text(interview.fields['面试轮次']), startAt: text(interview.fields['开始时间']), endAt: text(interview.fields['结束时间']), status: text(interview.fields['评价状态']), questionSnapshot, draft:json<any>(draft?.fields['评分证据JSON'],{}).draft||null, draftSavedAt:text(draft?.fields['更新时间']) }
 }

 async savePublicEvaluationDraft(token:string,input:Record<string,unknown>){
  const detail=await this.publicEvaluationDetail(token)
  const serialized=JSON.stringify(input)
  if(serialized.length>100000)throw new BadRequestException('面试记录过长，请精简后保存')
  const table=this.table('recruitment_interview_feedback')
  const rows=await teable.listByField(table,'面试ID',detail.interviewId,200)
  const existing=rows.find(row=>text(row.fields['面试官用户ID'])===detail.interviewerUserId&&text(row.fields['评价状态'])==='草稿')
  const fields={面试ID:detail.interviewId,面试官用户ID:detail.interviewerUserId,面试官:detail.interviewerName,评分证据JSON:JSON.stringify({draft:input}),评价状态:'草稿',锁定状态:'未锁定',更新时间:now()}
  if(existing)await teable.updateRecord(table,existing.id,fields)
  else await teable.createRecord(table,{...fields,评价ID:id('feedback'),版本:0,创建时间:now()})
  return{status:'已保存',savedAt:fields.更新时间}
 }

 async extractPublicEvaluation(token:string,transcript:string){
  const detail=await this.publicEvaluationDetail(token)
  return this.extractFeedbackTranscript(detail.interviewId,transcript)
 }

 async submitPublicEvaluation(token: string, input: Omit<InterviewFeedbackInput, 'interviewerUserId' | 'interviewer'>) {
  const link = await this.resolvePublicEvaluationLink(token,true)
  const parts = text(link.fields['对象ID']).split(':')
  const interviewId = parts.shift() || ''
  const interviewerUserId = parts.join(':')
  const feedback=await teable.listByField(this.table('recruitment_interview_feedback'),'面试ID',interviewId,200)
  const existing=feedback.find(row=>text(row.fields['面试官用户ID'])===interviewerUserId&&text(row.fields['锁定状态'])==='已锁定')
  if(existing){
   if(text(link.fields['链接状态'])!=='已完成')await teable.updateRecord(this.table('recruitment_public_links'),link.id,{链接状态:'已完成',更新时间:now()})
   const interview=await this.findInterview(interviewId)
   return{feedbackId:text(existing.fields['评价ID']),overall:num(existing.fields['综合分']),submitted:new Set(feedback.filter(row=>text(row.fields['评价状态'])==='已提交').map(row=>text(row.fields['面试官用户ID']))).size,expected:json<string[]>(interview.fields['面试官用户IDJSON'],[]).length,alreadySubmitted:true}
  }
  const detail = await this.publicEvaluationDetail(token)
  const result = await this.submitFeedback(interviewId, { ...input, interviewerUserId, interviewer: text((input as any).interviewer) || detail.interviewerName, operator: input.operator || '面试评价链接' } as InterviewFeedbackInput)
  await teable.updateRecord(this.table('recruitment_public_links'), link.id, { 链接状态: '已完成', 更新时间: now() })
  return result
 }

 private async resolvePublicEvaluationLink(token: string,allowCompleted=false) {
  const hash = createHash('sha256').update(text(token)).digest('hex')
  const rows = await teable.listAllRecords(this.table('recruitment_public_links'))
  const link = rows.find(row => text(row.fields['链接类型']) === '面试评价' && text(row.fields['访问Token哈希']) === hash)
  if (!link) throw new NotFoundException('面试评价链接不存在')
  if (text(link.fields['链接状态']) !== '有效'&&!(allowCompleted&&text(link.fields['链接状态'])==='已完成')) throw new ConflictException('面试评价链接已使用或已失效')
  if (Date.parse(text(link.fields['过期时间'])) <= Date.now()) throw new ConflictException('面试评价链接已过期')
  return link
 }

 async aggregate(interviewId:string){const rows=(await teable.listAllRecords(this.table('recruitment_interview_feedback'))).filter(r=>text(r.fields['面试ID'])===interviewId&&text(r.fields['评价状态'])==='已提交');if(!rows.length)return{interviewId,count:0};const avg=(f:string)=>Math.round(rows.reduce((s,r)=>s+num(r.fields[f]),0)/rows.length),recommendations=rows.reduce((m,r)=>{const k=text(r.fields['推荐结论']);m[k]=(m[k]||0)+1;return m},{} as Record<string,number>);return{interviewId,count:rows.length,scores:{professional:avg('专业能力分'),communication:avg('沟通能力分'),execution:avg('执行能力分'),culture:avg('文化匹配分'),potential:avg('发展潜力分'),overall:avg('综合分')},recommendations,strengths:rows.map(r=>text(r.fields['候选人优势'])).filter(Boolean),risks:rows.map(r=>text(r.fields['风险与待核实项'])).filter(Boolean),disagreements:Object.keys(recommendations).length>1?recommendations:{}}}
 async decide(interviewId:string,input:InterviewDecisionInput){
  if(!text(input.reason))throw new BadRequestException('招聘决策必须填写原因')
  const interview=await this.findInterview(interviewId),aggregate=await this.aggregate(interviewId)
  if(!aggregate.count)throw new ConflictException('至少需要一份已提交评价才能决策')
  const feedback=(await teable.listAllRecords(this.table('recruitment_interview_feedback'))).filter(r=>text(r.fields['面试ID'])===interviewId),decisionId=id('decision'),timestamp=now(),operator=text(input.operator)||'当前用户'
  await teable.createRecord(this.table('recruitment_interview_decisions'),{决策ID:decisionId,面试ID:interviewId,应聘记录ID:text(interview.fields['应聘记录ID']),候选人ID:text(interview.fields['候选人ID']),评价IDJSON:JSON.stringify(feedback.map(r=>text(r.fields['评价ID']))),汇总评分JSON:JSON.stringify(aggregate),意见分歧JSON:JSON.stringify((aggregate as any).disagreements||{}),招聘决策:input.decision,决策原因:input.reason,决策人用户ID:text(input.operatorUserId),决策人:operator,决策时间:timestamp,创建时间:timestamp})
  const stage={通过:'待Offer决策',淘汰:'已淘汰',加面:'约面',储备:'储备人才'}[input.decision]
  await teable.updateRecord(this.table('recruitment_interviews'),interview.id,{面试结果:input.decision,面试状态:'已完成',评价状态:'已完成',更新时间:timestamp})
  const applications=await teable.listAllRecords(this.table('recruitment_applications')),app=applications.find(r=>text(r.fields['应聘记录ID'])===text(interview.fields['应聘记录ID']))
  const previousStage=text(app?.fields['当前阶段'])||'面试'
  if(app)await teable.updateRecord(this.table('recruitment_applications'),app.id,{当前阶段:stage,当前状态:input.decision==='淘汰'?'已结束':'进行中',最近处理时间:timestamp,流程结束时间:input.decision==='淘汰'?timestamp:'',更新时间:timestamp})
  const candidates=await teable.listAllRecords(this.table('recruitment_candidates')),candidate=candidates.find(r=>text(r.fields['候选人ID'])===text(interview.fields['候选人ID']))
  if(candidate)await teable.updateRecord(this.table('recruitment_candidates'),candidate.id,{候选人状态:stage,更新时间:timestamp})
  await teable.createRecord(this.table('recruitment_stage_events'),{事件ID:id('evt'),应聘记录ID:text(interview.fields['应聘记录ID']),候选人ID:text(interview.fields['候选人ID']),职位ID:text(interview.fields['职位ID']),原阶段:previousStage,新阶段:stage,操作:'面试招聘决策',结果:input.decision,原因:input.reason,操作人用户ID:text(input.operatorUserId),操作人:operator,发生时间:timestamp,来源类型:'面试决策',来源记录ID:decisionId,扩展信息JSON:JSON.stringify({aggregate})})
  let handoff:any
  try{handoff=await this.ensureHrHandoff(interviewId)}catch(error){handoff={status:'待重试',message:error instanceof Error?error.message:String(error)}}
  await this.audit('面试招聘决策','面试',interviewId,aggregate,input,operator,input.reason)
  return{decisionId,decision:input.decision,targetStage:stage,aggregate,handoff}
 }
 private async sendRejectionEmail(interview:TeableRecord,candidate:TeableRecord|undefined,reason:string,operator:string){
  const interviewId=text(interview.fields['面试ID'])||interview.id,candidateId=text(interview.fields['候选人ID']),email=text(candidate?.fields['邮箱']),candidateName=this.candidateName(candidate),round=text(interview.fields['面试轮次'])||'本轮',subject=`方片新媒体｜${round}面试结果通知｜${candidateName}`,content=rejectionEmailHtml(candidateName,round,reason),mailTable=this.table('recruitment_interview_mail_events')
  const previousEvents=(await teable.listByField(mailTable,'面试ID',interviewId,1000)).filter(row=>text(row.fields['邮件主题'])===subject)
  const previous=previousEvents.sort((first,second)=>text(second.fields['创建时间']).localeCompare(text(first.fields['创建时间'])))[0]
  if(previousEvents.some(row=>text(row.fields['发送状态'])==='已发送'))return{status:'已跳过',recipient:email,message:'不通过结果邮件已发送'}
  if(text(previous?.fields['发送状态'])==='发送中'&&Date.now()-(Date.parse(text(previous.fields['创建时间']))||0)<5*60_000)return{status:'发送中',message:'不通过结果邮件正在发送'}
  const timestamp=now(),event=previous&&text(previous.fields['发送状态'])==='发送中'?previous:await teable.createRecord(mailTable,{邮件事件ID:id('mail'),面试ID:interviewId,候选人ID:candidateId,收件人邮箱:email,邮件主题:subject,邮件正文:content,发送状态:'发送中',外部邮件ID:'',错误信息:'',发送人:operator,创建时间:timestamp})
  if(!email){const message='候选人邮箱不存在，未发送不通过邮件';await teable.updateRecord(mailTable,event.id,{发送状态:'发送失败',错误信息:message,发送时间:now()});await teable.updateRecord(this.table('recruitment_interviews'),interview.id,{结果通知状态:'发送失败',结果通知时间:now(),更新时间:now()});return{status:'发送失败',message}}
  try{const response=await tianjiWeixinMessage.sendMail({toEmails:[email],subject,content,contentType:'html'}),externalId=text(response.messageId),sentAt=now();await teable.updateRecord(mailTable,event.id,{收件人邮箱:email,邮件正文:content,发送状态:'已发送',外部邮件ID:externalId,错误信息:'',发送人:operator,发送时间:sentAt});await teable.updateRecord(this.table('recruitment_interviews'),interview.id,{结果通知状态:'已发送',结果通知时间:sentAt,更新时间:sentAt});return{status:'已发送',recipient:email}}
  catch(error){const message=error instanceof Error?error.message:String(error);await teable.updateRecord(mailTable,event.id,{收件人邮箱:email,邮件正文:content,发送状态:'发送失败',外部邮件ID:'',错误信息:message.slice(0,1000),发送人:operator,发送时间:now()});await teable.updateRecord(this.table('recruitment_interviews'),interview.id,{结果通知状态:'发送失败',结果通知时间:now(),更新时间:now()});return{status:'发送失败',message}}
 }

 async salary(query:{role?:string;city?:string}){const rows=await teable.listAllRecords(this.table('recruitment_salary_benchmarks'));return{benchmarks:rows.filter(r=>!query.role||text(r.fields['岗位名称']).includes(query.role)).filter(r=>!query.city||text(r.fields['城市'])===query.city).map(r=>({id:text(r.fields['薪酬参考ID'])||r.id,role:text(r.fields['岗位名称']),city:text(r.fields['城市']),level:text(r.fields['职级']),min:num(r.fields['最低月薪']),median:num(r.fields['中位月薪']),max:num(r.fields['最高月薪']),source:text(r.fields['数据来源']),date:text(r.fields['数据日期']),note:text(r.fields['说明'])}))}}
queueInterviewQuestionGeneration(input:InterviewQuestionGenerateInput){
  const interviewId=text(input.interviewId)
  if(!interviewId)throw new BadRequestException('面试ID不能为空')
  const existingJobId=this.questionGenerationJobs.get(interviewId)
  if(existingJobId)return{jobId:existingJobId,status:'running'}
  const jobId=jobs.start(async(progress)=>{
   progress('面试已创建，正在读取岗位、意向沟通和面试官题库')
   try{
    const result=await this.generateInterviewQuestions(input)
    progress(result.status==='已生成待推送'?'面试题已生成，将在面试前10分钟发送链接':'面试题状态已确认')
    return result
   }finally{this.questionGenerationJobs.delete(interviewId)}
  })
  this.questionGenerationJobs.set(interviewId,jobId)
  return{jobId,status:'running'}
 }
async generateInterviewQuestions(input: InterviewQuestionGenerateInput) {
  const targetCount = Math.max(structuredInterviewTargetCount, Math.min(structuredInterviewMaxCount, Math.round(Number(input.count) || structuredInterviewTargetCount)))
  const interview = await this.findInterview(input.interviewId)
  const interviewId = text(interview.fields['面试ID']) || interview.id
  if(text(interview.fields['面试状态'])==='已取消')throw new ConflictException('面试已取消，不能生成面试题')
  const currentStatus = text(interview.fields['面试题状态'])
  const existingSnapshot=json<any[]>(interview.fields['面试题快照JSON'],[])
  if (currentStatus === '已发布' && existingSnapshot.length && !input.regenerate) {
    return { interviewId, status: currentStatus, snapshot: existingSnapshot }
  }
  const generationStarted=Date.parse(text(interview.fields['面试题生成时间'])||text(interview.fields['更新时间']))||0
  if(currentStatus==='生成中'&&Date.now()-generationStarted<10*60_000)return{interviewId,status:'生成中',snapshot:existingSnapshot}
  if(['已生成待审核','已生成待推送'].includes(currentStatus)&&existingSnapshot.length&&!input.regenerate)return {interviewId,status:currentStatus,snapshot:existingSnapshot}
  await teable.updateRecord(this.table('recruitment_interviews'), interview.id, { 面试题状态: '生成中', 面试题生成时间: now(), 面试题生成错误: '', 更新时间: now() })
  try {
    const [position, questions, communications, candidate] = await Promise.all([
      teable.findOneByField(this.table('recruitment_positions'),'职位ID',text(interview.fields['职位ID'])),
      teable.listAllRecords(this.table('recruitment_question_bank'),{filterByTql:'{题目状态} = "已发布"'}),
      teable.listByField(this.table('recruitment_communications'),'候选人ID',text(interview.fields['候选人ID']),200),
      teable.findOneByField(this.table('recruitment_candidates'),'候选人ID',text(interview.fields['候选人ID'])),
    ])
    const role = text(position?.fields['职位名称']) || text(interview.fields['面试类型']) || '通用岗位'
    const interviewerIds = json<string[]>(interview.fields['面试官用户IDJSON'], [])
    const published = questions.filter(row => {
      const positionId = text(json<any>(row.fields['评分规则JSON'], {}).positionId)
      return text(row.fields['题目状态']) === '已发布' && (positionId ? positionId === text(interview.fields['职位ID']) : !text(row.fields['适用岗位']) || text(row.fields['适用岗位']) === role)
    })
    const general = published.filter(row => !text(row.fields['适用面试官用户ID']))
    const interviewerSpecific = published.filter(row => interviewerIds.some(userId => json<string[]>(row.fields['适用面试官用户ID'], text(row.fields['适用面试官用户ID']) ? [text(row.fields['适用面试官用户ID'])] : []).includes(userId)))
    const baseRows = [...general, ...interviewerSpecific].filter((row, index, all) => all.findIndex(item => text(item.fields['题干']) === text(row.fields['题干'])) === index).slice(0, targetCount)
    const baseSnapshot = baseRows.map(row => ({ questionId: text(row.fields['题目ID']) || row.id, question: text(row.fields['题干']), dimension: text(row.fields['题目分类']), source: text(row.fields['适用面试官用户ID']) ? '面试官补充题' : '岗位通用题', why: text(row.fields['题目说明']), observation: text(row.fields['参考答案']), interviewerIds: json<string[]>(row.fields['适用面试官用户ID'], text(row.fields['适用面试官用户ID']) ? [text(row.fields['适用面试官用户ID'])] : []) }))
    const communicationText = communications.filter(row => text(row.fields['候选人ID']) === text(interview.fields['候选人ID'])).sort((a, b) => text(b.fields['发生时间']).localeCompare(text(a.fields['发生时间']))).slice(0, 5).map(row => [row.fields['沟通摘要'], row.fields['沟通备注'], row.fields['候选人关注点'], row.fields['当前加班强度'], row.fields['约面形式']].map(text).filter(Boolean).join('；')).filter(Boolean).join('\n')
    const aiTarget = Math.max(0, targetCount - baseSnapshot.length)
    const dimensionList = structuredInterviewDimensions.map(dimension => `${dimension.name}：${dimension.focus}`).join('\n')
    const priorQuestionTitles=input.regenerate?existingSnapshot.map(item=>text(item?.question)).filter(Boolean):[]
    const prompt = `根据岗位、候选人经历、意向沟通和面试官历史遗漏题，生成${aiTarget}道本次面试需要重点追问的问题。只返回JSON数组，每项：{"question":"...","dimension":"...","why":"...","observation":"..."}。题目必须覆盖以下结构化面试维度，每个维度1-2道，优先使用候选人真实经历和岗位JD定制；问题必须可核验事实，不得涉及歧视、婚育、隐私或违法话题，不要重复已有题干。
结构化面试维度：
${dimensionList}
岗位：${role}
JD：${text(position?.fields['岗位JD'])}
任职要求：${text(position?.fields['任职要求'])}
候选人经历：${text(candidate?.fields['工作经历'])}
意向沟通：${communicationText}
已有题目：${[...baseSnapshot.map(item => item.question),...priorQuestionTitles].join('；')}`
    const answer = aiTarget > 0 ? await llm.chat([{ role: 'system', content: structuredInterviewSystemPrompt }, { role: 'user', content: prompt }]) : '[]'
    const drafts = json<Array<{ question?: string; dimension?: string; why?: string; observation?: string }>>(answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(), [])
    if (!Array.isArray(drafts)) throw new BadRequestException('AI面试题格式无效，请重试')
    const snapshot = [...baseSnapshot]
    let created = 0
    for (const draft of drafts.slice(0, aiTarget)) {
      const title = text(draft.question)
      if (!title || snapshot.some(item => item.question === title) || priorQuestionTitles.includes(title)) continue
      const createdRow = await teable.createRecord(this.table('recruitment_question_bank'), {
        题目ID: id('question'), 题目分类: text(draft.dimension) || '沟通追问', 题目类型: 'text', 题干: title,
        题目说明: `来源：本次面试AI草稿。${text(draft.why)}`, 参考答案: text(draft.observation), 满分: 10, 是否必答: '否',
        题目来源: '约面AI题库', 题目状态: '草稿', 适用岗位: role, 来源面试ID: interviewId, 评分规则JSON: JSON.stringify({ positionId: text(interview.fields['职位ID']) }),
        创建人: text(input.operator) || '流程自动化', 创建时间: now(), 更新时间: now(),
      })
      snapshot.push({ questionId: text(createdRow.fields['题目ID']) || createdRow.id, question: title, dimension: text(draft.dimension) || '沟通追问', source: '本次沟通AI追问', why: text(draft.why), observation: text(draft.observation), interviewerIds })
      created++
    }
    let fallbackCount = 0
    const fallbackTarget = Math.max(0, targetCount - snapshot.length)
    const existingDimensions = new Set(snapshot.map(question => text(question.dimension)))
    const fallbackPool = structuredFallbackQuestions(role).filter(question => !snapshot.some(item => item.question === question.question) && !priorQuestionTitles.includes(question.question))
    const orderedFallbackPool = [
      ...fallbackPool.filter(question => !existingDimensions.has(question.dimension)),
      ...fallbackPool.filter(question => existingDimensions.has(question.dimension)),
    ]
    for (const fallback of orderedFallbackPool.slice(0, fallbackTarget)) {
      const createdRow = await teable.createRecord(this.table('recruitment_question_bank'), {
        题目ID: id('question'), 题目分类: fallback.dimension, 题目类型: 'text', 题干: fallback.question,
        题目说明: `来源：结构化面试表兜底。${fallback.why}`, 参考答案: fallback.observation, 满分: 10, 是否必答: '否',
        题目来源: '结构化面试表兜底', 题目状态: '草稿', 适用岗位: role, 来源面试ID: interviewId, 评分规则JSON: JSON.stringify({ positionId: text(interview.fields['职位ID']) }),
        创建人: text(input.operator) || '流程自动化', 创建时间: now(), 更新时间: now(),
      })
      snapshot.push({ questionId: text(createdRow.fields['题目ID']) || createdRow.id, question: fallback.question, dimension: fallback.dimension, source: '结构化面试表兜底', why: fallback.why, observation: fallback.observation, interviewerIds })
      fallbackCount++
    }
    if (!snapshot.length) throw new BadRequestException('暂未生成有效面试题，请重试或先配置岗位基础题库')
    await teable.updateRecord(this.table('recruitment_interviews'), interview.id, { 面试题状态: '已生成待推送', 面试题生成时间: now(), 面试题快照JSON: JSON.stringify(snapshot), 面试题生成错误: '', 更新时间: now() })
    const candidateName = this.candidateName(candidate)
    await this.completeQuestionTask(interviewId)
    return { interviewId, role, candidateName, snapshot, status: '已生成待推送', notification: { status: '待开始前推送' }, generatedCount: created, fallbackCount, baseCount: baseSnapshot.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await teable.updateRecord(this.table('recruitment_interviews'), interview.id, { 面试题状态: '生成失败', 面试题生成错误: message.slice(0, 1000), 更新时间: now() })
    throw error
  }
 }

 private async completeQuestionTask(interviewId: string) {
  const rows = await teable.listByField(this.table('recruitment_tasks'),'对象ID',interviewId,100)
  for (const row of rows.filter(item => text(item.fields['待办类型']) === '面试题生成' && text(item.fields['待办状态']) !== '已完成')) await teable.updateRecord(this.table('recruitment_tasks'), row.id, { 待办状态: '已完成', 完成时间: now(), 更新时间: now() })
 }

 async createSalary(body:{role:string;city?:string;level?:string;min:number;median:number;max:number;source:string;date?:string;note?:string;operator?:string}){if(!text(body.role)||!text(body.source)||num(body.min)>num(body.median)||num(body.median)>num(body.max))throw new BadRequestException('薪酬参考岗位、来源和区间必须有效');const benchmarkId=id('salary');await teable.createRecord(this.table('recruitment_salary_benchmarks'),{薪酬参考ID:benchmarkId,岗位名称:body.role,城市:text(body.city),职级:text(body.level),最低月薪:body.min,中位月薪:body.median,最高月薪:body.max,数据来源:body.source,数据日期:text(body.date)||now().slice(0,10),说明:text(body.note),创建人:text(body.operator)||'当前用户',创建时间:now(),更新时间:now()});return{benchmarkId}}
 async analytics(scope?:InterviewAccessScope){const [feedback,interviews,candidates]=await Promise.all([teable.listAllRecords(this.table('recruitment_interview_feedback')),teable.listAllRecords(this.table('recruitment_interviews')),teable.listAllRecords(this.table('recruitment_candidates'))]);const byInterviewer=new Map<string,any>();for(const row of feedback.filter(r=>text(r.fields['评价状态'])==='已提交'&&(!scope||scope.all||scope.userIds.includes(text(r.fields['面试官用户ID']))))){const key=text(row.fields['面试官用户ID'])||text(row.fields['面试官']),current=byInterviewer.get(key)||{userId:key,name:text(row.fields['面试官']),submitted:0,recommendedPass:0,successful:0,totalScore:0};current.submitted++;current.totalScore+=num(row.fields['综合分']);if(text(row.fields['推荐结论'])==='通过'){current.recommendedPass++;const interview=interviews.find(i=>text(i.fields['面试ID'])===text(row.fields['面试ID'])),candidate=candidates.find(c=>text(c.fields['候选人ID'])===text(interview?.fields['候选人ID']));if(['已入职','在职'].includes(text(candidate?.fields['候选人状态'])))current.successful++}byInterviewer.set(key,current)}return{interviewers:[...byInterviewer.values()].map(x=>({...x,averageScore:x.submitted?Math.round(x.totalScore/x.submitted):0,accuracy:x.recommendedPass?Math.round(x.successful/x.recommendedPass*100):null,accuracyNote:'准确率以推荐通过后已入职/在职结果为当前可用代理，90天留存将在P12入离职数据接入后更新'})),questionEffectiveness:{status:'基础数据已采集',note:'按题目回答、维度评分和最终决策关联；样本不足时不输出误导性排名'}}}
 private async seedTemplates(){const table=this.table('recruitment_interview_templates'),rows=await teable.listAllRecords(table);if(rows.length)return;const dims=[{key:'professional',label:'专业能力',weight:30},{key:'communication',label:'沟通能力',weight:20},{key:'execution',label:'执行能力',weight:20},{key:'culture',label:'文化匹配',weight:15},{key:'potential',label:'发展潜力',weight:15}],templates=[{name:'应届生结构化面试清单',type:'应届生',round:'一面',questions:[{dimension:'学习潜力',question:'请讲一次你快速学习新知识并完成任务的经历。',followUp:'目标、行动、结果分别是什么？',observation:'学习方法和复盘能力'},{dimension:'沟通协作',question:'请讲一次团队意见不一致时你如何推进。',observation:'倾听、表达和共识'}]},{name:'社招一面问题模板',type:'社招',round:'一面',questions:[{dimension:'专业能力',question:'请说明与你应聘岗位最相关的项目和量化结果。',followUp:'你的个人贡献占比是多少？',observation:'事实、数据和归因'},{dimension:'离职动因',question:'最近一次考虑离职的主要原因是什么？',observation:'动机一致性'}]},{name:'社招二面问题模板',type:'社招',round:'二面',questions:[{dimension:'业务判断',question:'面对目标冲突和资源不足，你如何排序并承担结果？',observation:'业务判断和担当'},{dimension:'管理能力',question:'请讲一次带队达成困难目标的经历。',followUp:'如何分工、反馈和纠偏？',observation:'管理闭环'}]}];for(const t of templates)await teable.createRecord(table,{面试模板ID:id('interviewtpl'),模板名称:t.name,候选人类型:t.type,适用岗位:'',适用轮次:t.round,维度JSON:JSON.stringify(dims),问题JSON:JSON.stringify(t.questions.map((q,i)=>({...q,id:`q${i+1}`}))),模板状态:'启用',版本:1,创建人:'系统',创建时间:now(),更新时间:now()})}
 private chooseTemplate(interview:TeableRecord,candidate:TeableRecord|undefined,templates:TeableRecord[]){const type=/应届|实习|校招/.test(`${text(candidate?.fields['来源类型'])} ${text(candidate?.fields['工作年限'])}`)?'应届生':'社招',round=text(interview.fields['面试轮次']);const row=templates.find(t=>text(t.fields['候选人类型'])===type&&text(t.fields['适用轮次'])===round)||templates.find(t=>text(t.fields['适用轮次'])===round);return row?this.mapTemplate(row):null}
 private mapTemplate=(r:TeableRecord)=>({id:text(r.fields['面试模板ID'])||r.id,name:text(r.fields['模板名称']),candidateType:text(r.fields['候选人类型']),position:text(r.fields['适用岗位']),round:text(r.fields['适用轮次']),dimensions:json(r.fields['维度JSON'],[]),questions:json(r.fields['问题JSON'],[]),status:text(r.fields['模板状态']),version:num(r.fields['版本'])})
 private mapFeedback=(r:TeableRecord)=>({id:text(r.fields['评价ID'])||r.id,interviewId:text(r.fields['面试ID']),interviewerUserId:text(r.fields['面试官用户ID']),interviewer:text(r.fields['面试官']),candidateRating:text(r.fields['候选人评级']),scores:{professional:num(r.fields['专业能力分']),communication:num(r.fields['沟通能力分']),execution:num(r.fields['执行能力分']),culture:num(r.fields['文化匹配分']),potential:num(r.fields['发展潜力分']),overall:num(r.fields['综合分'])},recommendation:text(r.fields['推荐结论']),otherRoles:text(r.fields['其他匹配岗位']),strengths:text(r.fields['候选人优势']),risks:text(r.fields['风险与待核实项']),aiSummary:text(r.fields['AI面试总结'])||text(r.fields['AI评价草稿']),interviewerEvaluation:text(r.fields['面试官评价'])||text(r.fields['面试评价']),comment:text(r.fields['面试官评价'])||text(r.fields['面试评价']),notes:text(r.fields['备注']),questionAnswers:json(r.fields['题目回答JSON'],{}),submittedAt:text(r.fields['提交时间']),status:text(r.fields['评价状态']),version:num(r.fields['版本'])})
 private async findInterview(value:string){const table=this.table('recruitment_interviews');let row=await teable.findOneByField(table,'面试ID',value);if(!row){try{row=await teable.getRecord(table,value)}catch{}}if(!row)throw new NotFoundException('面试不存在');return row}
 private async completeTask(interviewId:string,userId:string){const table=this.table('recruitment_tasks'),rows=await teable.listByField(table,'对象ID',`${interviewId}:${userId}`,100);for(const row of rows.filter(item=>text(item.fields['待办类型'])==='面试评价'&&text(item.fields['待办状态'])!=='已完成'))await teable.updateRecord(table,row.id,{待办状态:'已完成',完成时间:now(),更新时间:now()})}
 private async audit(a:string,t:string,o:string,b:unknown,n:unknown,p:string,r=''){await teable.createRecord(this.table('recruitment_audit_logs'),{日志ID:id('audit'),操作人:p,操作类型:a,对象类型:t,对象ID:o,修改前摘要JSON:JSON.stringify(b),修改后摘要JSON:JSON.stringify(n),操作原因:r,请求ID:id('req'),发生时间:now(),操作结果:'成功',错误信息:''})}
}
