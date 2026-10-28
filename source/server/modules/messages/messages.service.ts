import{BadRequestException,ConflictException,Injectable,NotFoundException,ServiceUnavailableException}from'@nestjs/common';import{randomUUID}from'node:crypto';import{im}from'../../platform/im';import{tianji}from'../../platform/tianji';import{teable,TeableRecord}from'../../platform/teable';import{tianjiWeixinMessage}from'../../platform/tianji-weixin-message';import{DatabaseService}from'../database/database.service';import{MessagePreviewInput,MessageRuleInput,MessageTemplateInput}from'./message.types';
const now=()=>new Date().toISOString(),id=(p:string)=>`${p}_${randomUUID().replace(/-/g,'').slice(0,20)}`,text=(v:unknown)=>String(v??'').trim(),num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0,json=<T>(v:unknown,f:T):T=>{try{return v?JSON.parse(String(v))as T:f}catch{return f}};
export function appendWecomMentions(markdown:string,userIds:string[]){const mentions=[...new Set(userIds.map(text).filter(Boolean))].map(userId=>`<@${userId}>`).join(' ');return mentions?`${markdown}\n\n${mentions}`:markdown}
export function sanitizeMessageContent(content:string,channel:string){const fields:string[]=[];let value=content;if(channel==='企业微信群'){const rules:Array<[string,RegExp,string]>=[['手机号',/(?<!\d)1[3-9]\d{9}(?!\d)/g,'[手机号已隐藏]'],['邮箱',/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'[邮箱已隐藏]'],['微信号',/(微信(?:号)?[：:\s]+)[A-Za-z][\w-]{5,19}/gi,'$1[已隐藏]'],['身份证号',/(?<!\d)\d{17}[\dXx](?!\d)/g,'[身份证已隐藏]'],['薪酬信息',/(?:月薪|薪资|Offer薪酬|基本月薪)[：:\s]*\d+(?:\.\d+)?(?:元|k|K)?/g,'[薪酬信息已隐藏]'],['背调信息',/(?:背调|背景调查)[：:\s]*[^\n]{1,80}/g,'[背调信息已隐藏]'],['内部评价',/(?:内部评价|淘汰原因|风险结论)[：:\s]*[^\n]{1,100}/g,'[内部评价已隐藏]']];for(const[name,pattern,replacement]of rules){if(pattern.test(value)){fields.push(name);pattern.lastIndex=0;value=value.replace(pattern,replacement)}}}return{content:value.trim().slice(0,3900),fields}}
@Injectable()export class MessagesService{constructor(private readonly database:DatabaseService){}private table(n:string){return this.database.requireTableId(n)}
private flowNotifyLocks = new Map<string, Promise<void>>()
private directNotifyLocks = new Set<string>()
async notifyFlowEvent(input:{category:string;candidateId?:string;objectId?:string;markdown:string;group:'business'|'talent';operator?:string;mentionedList?:string[]}) {
  const group = input.group === 'business' ? '业务评审群' : '人才协作群'
  const webhookKey = text(input.group === 'business' ? process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY : process.env.WECOM_TALENT_GROUP_WEBHOOK_KEY)
  const summary = { category: input.category, candidateId: input.candidateId, objectId: input.objectId, contentLength: input.markdown.length }
  const dedupeKey = ['AI自动业务群评审', '面试题自动推送'].includes(input.category) ? `${input.group}:${input.category}:${input.candidateId || ''}:${input.objectId || ''}` : ''
  const previous = dedupeKey ? (this.flowNotifyLocks.get(dedupeKey) || Promise.resolve()) : Promise.resolve()
  let release: (() => void) | undefined
  const current = dedupeKey ? new Promise<void>((resolve) => { release = resolve }) : undefined
  const queued = dedupeKey ? previous.then(() => current) : previous
  if (dedupeKey && queued) this.flowNotifyLocks.set(dedupeKey, queued)
  await previous
  try {
    if (dedupeKey) {
      const events = await teable.listAllRecords(this.table('recruitment_message_send_events'))
      const alreadySent = events.some((row) => {
        if (text(row.fields['新状态']) !== '已发送' || text(row.fields['渠道']) !== '企微群机器人') return false
        const request = json<{ category?: string; candidateId?: string; objectId?: string }>(row.fields['请求摘要JSON'], {})
        return request.category === input.category && request.candidateId === input.candidateId && request.objectId === input.objectId
      })
      if (alreadySent) return { status: '已跳过', reason: '相同流程通知已发送' }
    }
    if (!webhookKey) {
      const messageId = id('message'), timestamp = now()
      await teable.createRecord(this.table('recruitment_message_send_events'), {
        发送事件ID: id('msgevent'), 消息ID: messageId, 事件类型: '自动发送', 原状态: '待发送', 新状态: '跳过', 渠道: '企微群机器人',
        接收地址: group, 请求摘要JSON: JSON.stringify(summary), 响应摘要JSON: JSON.stringify({}), 错误信息: '未配置机器人', 操作人: input.operator || '招聘流程自动通知', 发生时间: timestamp,
      }).catch((auditError) => console.error(`[流程通知] 审计写入失败: ${auditError instanceof Error ? auditError.message : String(auditError)}`))
      console.warn(`[流程通知] 未配置${group}机器人，跳过 ${input.category}`)
      return { status: '跳过', reason: '未配置机器人' }
    }
    const messageId = id('message'), timestamp = now()
    try {
      const mentionedList = [...new Set((input.mentionedList || []).map(text).filter(Boolean))]
      const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(webhookKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'markdown', markdown: { content: appendWecomMentions(input.markdown, mentionedList) } }),
      })
      const result = await response.json().catch(() => ({} as any))
      if (!response.ok || result?.errcode !== 0) throw new Error(text(result?.errmsg) || `未收到企微成功回执（HTTP ${response.status}）`)
      await teable.createRecord(this.table('recruitment_message_send_events'), {
        发送事件ID: id('msgevent'), 消息ID: messageId, 事件类型: '自动发送', 原状态: '待发送', 新状态: '已发送', 渠道: '企微群机器人',
        接收地址: group, 请求摘要JSON: JSON.stringify(summary), 响应摘要JSON: JSON.stringify(result), 错误信息: '', 操作人: input.operator || '招聘流程自动通知', 发生时间: timestamp,
      })
      return { status: '已发送', messageId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[流程通知] ${group} ${input.category} 发送失败: ${message}`)
      await teable.createRecord(this.table('recruitment_message_send_events'), {
        发送事件ID: id('msgevent'), 消息ID: messageId, 事件类型: '自动发送', 原状态: '待发送', 新状态: '发送失败', 渠道: '企微群机器人',
        接收地址: group, 请求摘要JSON: JSON.stringify(summary), 响应摘要JSON: JSON.stringify({}), 错误信息: message, 操作人: input.operator || '招聘流程自动通知', 发生时间: timestamp,
      }).catch((auditError) => console.error(`[流程通知] 审计写入失败: ${auditError instanceof Error ? auditError.message : String(auditError)}`))
      return { status: '发送失败', error: message }
    }
  } finally {
    if (release) release()
    if (dedupeKey && this.flowNotifyLocks.get(dedupeKey) === queued) this.flowNotifyLocks.delete(dedupeKey)
  }
}
async notifyDirectUsers(input:{category:string;candidateId?:string;objectType?:string;objectId?:string;userIds:string[];markdown:string;operator?:string;operatorUserId?:string;force?:boolean}) {
  const userIds=[...new Set((input.userIds||[]).map(text).filter(Boolean))]
  if(!userIds.length)return{status:'发送失败',reason:'未指定接收人',results:[]}
  const [users,messages]=await Promise.all([
    Promise.all(userIds.map(userId=>this.findUser(userId))),
    text(input.candidateId)
      ?teable.listByField(this.table('recruitment_messages'),'候选人ID',text(input.candidateId),500)
      :text(input.objectId)
        ?teable.listByField(this.table('recruitment_messages'),'对象ID',text(input.objectId),500)
        :Promise.resolve([]),
  ])
  const results:any[]=[]
  for(const [index,userId] of userIds.entries()){
    const user=users[index]
    const name=text(user?.fields['姓名'])||userId
    const wechatId=text(user?.fields['天玑微信ID'])||text(user?.fields['企业微信用户ID'])
    if(!user||!wechatId){
      const reason=!user?'系统员工不存在':'未配置企微成员ID'
      await this.directRoutingFailure(input,userId,name,reason)
      results.push({userId,name,status:'发送失败',reason})
      continue
    }
    const lockKey=[input.category,input.candidateId,input.objectId,wechatId].map(text).join(':')
    if(this.directNotifyLocks.has(lockKey)){
      results.push({userId,name,wechatId,status:'发送中',reason:'相同流程通知正在发送，等待送达结果'})
      continue
    }
    const matching=messages.filter(row=>text(row.fields['消息分类'])===input.category&&text(row.fields['候选人ID'])===text(input.candidateId)&&text(row.fields['对象ID'])===text(input.objectId)&&text(row.fields['接收地址'])===wechatId)
    if(!input.force){
      const sent=matching.find(row=>text(row.fields['发送状态'])==='已发送')
      if(sent){
        results.push({userId,name,wechatId,status:'已跳过',reason:'相同流程通知已发送',messageId:text(sent.fields['消息ID'])||sent.id})
        continue
      }
    }
    this.directNotifyLocks.add(lockKey)
    try{
      const sending=matching.find(row=>text(row.fields['发送状态'])==='发送中')
      if(sending){
        const started=Date.parse(text(sending.fields['更新时间'])||text(sending.fields['创建时间']))||0
        if(Date.now()-started<5*60_000){results.push({userId,name,wechatId,status:'发送中',reason:'上一条通知尚在发送，将在后续检查确认'});continue}
        await teable.updateRecord(this.table('recruitment_messages'),sending.id,{发送状态:'发送失败',错误信息:'发送状态超时，已进入自动补发',更新时间:now()})
      }
      const preview=await this.preview({category:input.category,channel:'企业微信单聊',recipientType:'系统员工',recipientAddress:wechatId,candidateId:text(input.candidateId),objectType:text(input.objectType)||'招聘流程',objectId:text(input.objectId),content:input.markdown,operator:input.operator||'招聘流程自动通知',operatorUserId:input.operatorUserId})
      const delivered=await this.send(preview.messageId,{confirmed:true,operator:input.operator||'招聘流程自动通知',operatorUserId:input.operatorUserId})
      results.push({userId,name,wechatId,...delivered})
    }catch(error){
      results.push({userId,name,wechatId,status:'发送失败',error:error instanceof Error?error.message:String(error)})
    }finally{
      this.directNotifyLocks.delete(lockKey)
    }
  }
  const sentCount=results.filter(item=>item.status==='已发送').length
  const skippedCount=results.filter(item=>item.status==='已跳过').length
  const failedCount=results.length-sentCount-skippedCount
  const status=failedCount===0?(sentCount?'已发送':'已跳过'):(sentCount||skippedCount?'部分发送':'发送失败')
  const reason=text(results.find(item=>item.status==='发送失败')?.reason||results.find(item=>item.status==='发送失败')?.error)
  return{status,sent:sentCount,skipped:skippedCount,failed:failedCount,reason,results}
}
async notifyPositionHr(input:{category:string;candidateId?:string;positionId?:string;applicationId?:string;objectType?:string;objectId?:string;markdown:string;operator?:string;operatorUserId?:string;force?:boolean}) {
  const applicationId=text(input.applicationId),candidateId=text(input.candidateId)
  let application=applicationId?await teable.findOneByField(this.table('recruitment_applications'),'应聘记录ID',applicationId):undefined
  if(!application&&applicationId){try{application=await teable.getRecord(this.table('recruitment_applications'),applicationId)}catch{}}
  if(!application&&candidateId){
    const applications=await teable.listByField(this.table('recruitment_applications'),'候选人ID',candidateId,200)
    const active=applications.filter(row=>text(row.fields['当前状态'])!=='已结束').sort((a,b)=>text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))
    application=active.find(row=>text(row.fields['职位ID']))||active[0]
  }
  const positionId=text(input.positionId)||text(application?.fields['职位ID'])
  let position=positionId?await teable.findOneByField(this.table('recruitment_positions'),'职位ID',positionId):undefined
  if(!position&&positionId){try{position=await teable.getRecord(this.table('recruitment_positions'),positionId)}catch{}}
  const primaryUserId=text(position?.fields['招聘HR用户ID'])
  const backupUserId=text(position?.fields['备用招聘HR用户ID'])
  const firstUserId=primaryUserId||backupUserId
  if(!position||!firstUserId){
    const reason=!position?'未找到应聘记录对应岗位':'岗位未绑定招聘HR'
    await this.directRoutingFailure(input,positionId,text(position?.fields['职位名称'])||positionId,reason)
    return{status:'发送失败',reason,positionId,results:[]}
  }
  const primary=await this.notifyDirectUsers({...input,userIds:[firstUserId]})
  if(['已发送','已跳过'].includes(primary.status)||!backupUserId||backupUserId===firstUserId)return{...primary,positionId,recruiterUserId:firstUserId,route:primaryUserId?'主招聘HR':'备用招聘HR'}
  const backup=await this.notifyDirectUsers({...input,userIds:[backupUserId]})
  return{...backup,positionId,recruiterUserId:backupUserId,route:'备用招聘HR',primary}
}
private async directRoutingFailure(input:{category:string;candidateId?:string;objectId?:string;operator?:string},recipient:string,name:string,reason:string){
  const summary={category:input.category,candidateId:text(input.candidateId),objectId:text(input.objectId),recipient,name}
  await teable.createRecord(this.table('recruitment_message_send_events'),{发送事件ID:id('msgevent'),消息ID:'',事件类型:'自动私信路由失败',原状态:'待发送',新状态:'发送失败',渠道:'天玑个人机器人',接收地址:recipient,请求摘要JSON:JSON.stringify(summary),响应摘要JSON:JSON.stringify({}),错误信息:reason,操作人:input.operator||'招聘流程自动通知',发生时间:now()}).catch(error=>console.error(`[流程私信] 路由失败审计写入失败: ${error instanceof Error?error.message:String(error)}`))
  console.error(`[流程私信] ${input.category} 路由失败：${name||recipient} ${reason}`)
}
async connection(){try{await tianji.call('/api/admin/employee/getEmployeeList',{page:1,pageSize:1},['id']);return{status:'已连接',connector:'天玑企微',ownerIdentity:{authorized:true},checkedAt:now()}}catch(error){const message=error instanceof Error?error.message:String(error);return{status:'连接失败',connector:'天玑企微',message,action:'请检查天玑企微接口配置后重试',checkedAt:now()}}}
async templates(){await this.ensureTemplates();const rows=await teable.listAllRecords(this.table('recruitment_message_templates'));return{templates:rows.map(r=>({id:text(r.fields['消息模板ID'])||r.id,name:text(r.fields['模板名称']),category:text(r.fields['消息分类']),channel:text(r.fields['适用渠道']),audience:text(r.fields['适用对象']),content:text(r.fields['模板内容']),variables:json(r.fields['变量JSON'],[]),sensitivePolicy:text(r.fields['敏感字段策略']),status:text(r.fields['模板状态']),version:num(r.fields['版本'])}))}}
async createTemplate(input:MessageTemplateInput){if(!text(input.name)||!text(input.category)||!text(input.content))throw new BadRequestException('模板名称、分类和内容不能为空');const templateId=id('msgtpl'),timestamp=now(),variables=[...input.content.matchAll(/{{([^}]+)}}/g)].map(x=>x[1]);await teable.createRecord(this.table('recruitment_message_templates'),{消息模板ID:templateId,模板名称:input.name,消息分类:input.category,适用渠道:input.channel,适用对象:input.audience,模板内容:input.content,变量JSON:JSON.stringify(variables),敏感字段策略:text(input.sensitivePolicy)||'按渠道默认脱敏',模板状态:'启用',版本:1,创建人:text(input.operator)||'当前用户',创建时间:timestamp,更新时间:timestamp});return{templateId,status:'启用',variables}}
async list(){const rows=await teable.listAllRecords(this.table('recruitment_messages'));return{messages:rows.map(this.mapMessage).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}}
async previewWithDefaults(input:MessagePreviewInput){
  const next={...input}
  if(next.channel==='企业微信群'&&!text(next.recipientAddress)){
    next.recipientAddress=/业务|评审/.test(text(next.recipientType))?'业务评审群':'人才协作群'
  }
  return this.preview(next)
}
async preview(input:MessagePreviewInput){if(!text(input.category)||!text(input.channel)||!text(input.recipientType))throw new BadRequestException('消息分类、渠道和接收类型不能为空');if(input.channel!=='Owner通知'&&!text(input.recipientAddress))throw new BadRequestException('企微消息必须填写群聊ID或企微成员userid');let source=text(input.content);if(!source){await this.ensureTemplates();const templates=await teable.listAllRecords(this.table('recruitment_message_templates')),template=templates.find(r=>text(r.fields['消息模板ID'])===text(input.templateId));source=text(template?.fields['模板内容'])}if(!source)throw new BadRequestException('请选择模板或填写消息内容');const context=/{{[^}]+}}/.test(source)?await this.context(input):{},variables={...context,...(input.variables||{})};let rendered=source;for(const[k,v]of Object.entries(variables))rendered=rendered.replaceAll(`{{${k}}}`,text(v)||'待确认');const sanitized=sanitizeMessageContent(rendered,input.channel),messageId=id('message'),timestamp=now();await teable.createRecord(this.table('recruitment_messages'),{消息ID:messageId,模板ID:text(input.templateId),消息分类:input.category,渠道:input.channel,接收类型:input.recipientType,接收地址:text(input.recipientAddress),候选人ID:text(input.candidateId),对象类型:text(input.objectType),对象ID:text(input.objectId),变量JSON:JSON.stringify(variables),原始内容:rendered,发送内容:sanitized.content,脱敏字段JSON:JSON.stringify(sanitized.fields),确认状态:'待确认',发送状态:'草稿',重试次数:0,创建人用户ID:text(input.operatorUserId),创建人:text(input.operator)||'当前用户',创建时间:timestamp,更新时间:timestamp});await this.event(messageId,'创建预览','', '草稿',input.channel,text(input.recipientAddress),{category:input.category,masked:sanitized.fields},{},'',input.operator,input.operatorUserId);return{messageId,content:sanitized.content,maskedFields:sanitized.fields,channel:input.channel,recipientAddress:text(input.recipientAddress),confirmationStatus:'待确认',sendStatus:'草稿',warning:input.channel==='企业微信群'?'群消息已执行严格脱敏，请再次确认群成员范围。':'请核对接收人和链接后再发送。'}}
async send(messageId:string,body:{confirmed:boolean;operator?:string;operatorUserId?:string}){if(body.confirmed!==true)throw new BadRequestException('发送前必须明确确认预览内容和接收人');const row=await this.find(messageId);if(text(row.fields['发送状态'])==='已发送')throw new ConflictException('该消息已经发送');const timestamp=now();await teable.updateRecord(this.table('recruitment_messages'),row.id,{确认状态:'已确认',确认人用户ID:text(body.operatorUserId),确认人:text(body.operator)||'当前用户',确认时间:timestamp,发送状态:'发送中',更新时间:timestamp});return this.deliver(row,body.operator,body.operatorUserId)}
async retry(messageId:string,body:{operator?:string;operatorUserId?:string}){const row=await this.find(messageId);if(text(row.fields['发送状态'])!=='发送失败')throw new ConflictException('只有发送失败的消息可以重试');await teable.updateRecord(this.table('recruitment_messages'),row.id,{发送状态:'发送中',错误信息:'',重试次数:num(row.fields['重试次数'])+1,更新时间:now()});return this.deliver(row,body.operator,body.operatorUserId)}
private async deliver(row:TeableRecord,operator?:string,operatorUserId?:string){
  const messageId=text(row.fields['消息ID']),channel=text(row.fields['渠道']),recipient=text(row.fields['接收地址']),recipientType=text(row.fields['接收类型']),content=text(row.fields['发送内容']),requestSummary={channel,recipient,contentLength:content.length}
  try{
    let result:any
    if(channel==='Owner通知') result=await im.notifyOwner(content,{title:`人才管理系统·${text(row.fields['消息分类'])}`})
    else if(channel==='企业微信单聊') result=await tianjiWeixinMessage.send({wechatId:recipient,message:content,msgType:'markdown'})
    else result=await this.sendGroupWebhook(content,recipientType,recipient)
    const externalId=text(result?.message_id||result?.msgid||result?.id),timestamp=now()
    await teable.updateRecord(this.table('recruitment_messages'),row.id,{发送状态:'已发送',外部消息ID:externalId,错误信息:'',发送时间:timestamp,更新时间:timestamp})
    await this.event(messageId,'发送成功','发送中','已发送',channel,recipient,requestSummary,result,'',operator,operatorUserId)
    return{messageId,status:'已发送',externalId,sentAt:timestamp}
  }catch(error){
    const message=error instanceof Error?error.message:String(error)
    const action=channel==='Owner通知'?'请检查Studio登录和应用Owner通知授权':channel==='企业微信单聊'?'请检查天玑个人机器人消息接口和接收人的 wechat_id 配置':'请检查企微群机器人 Key 配置后重试'
    await teable.updateRecord(this.table('recruitment_messages'),row.id,{发送状态:'发送失败',错误信息:message,更新时间:now()})
    await this.event(messageId,'发送失败','发送中','发送失败',channel,recipient,requestSummary,{},message,operator,operatorUserId)
    throw new ServiceUnavailableException({message:`消息发送失败：${message}`,code:'MESSAGE_SEND_FAILED',action})
  }
}
private groupWebhookKey(recipientType:string,recipientAddress:string){
  const address=text(recipientAddress)
  if(address && /^[A-Za-z0-9_-]{20,}$/.test(address)) return address
  if(/业务|评审/.test(recipientType)) return text(process.env.WECOM_TALENT_REVIEW_WEBHOOK_KEY)
  return text(process.env.WECOM_TALENT_GROUP_WEBHOOK_KEY)
}
private async sendGroupWebhook(content:string,recipientType:string,recipientAddress:string){
  const webhookKey=this.groupWebhookKey(recipientType,recipientAddress)
  if(!webhookKey) throw new Error('未配置企微群机器人 Key')
  const response=await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(webhookKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({msgtype:'markdown',markdown:{content}})})
  const result=await response.json().catch(()=>({} as any))
  if(!response.ok||result?.errcode!==0) throw new Error(text(result?.errmsg)||`未收到企微成功回执（HTTP ${response.status}）`)
  return result
}
async rules(){const rows=await teable.listAllRecords(this.table('recruitment_message_trigger_rules'));return{rules:rows.map(r=>({id:text(r.fields['触发规则ID'])||r.id,name:text(r.fields['规则名称']),eventType:text(r.fields['事件类型']),conditions:json(r.fields['条件JSON'],{}),templateId:text(r.fields['模板ID']),channel:text(r.fields['渠道']),recipientType:text(r.fields['接收类型']),recipientAddress:text(r.fields['接收地址']),mode:text(r.fields['执行模式']),status:text(r.fields['规则状态']),priority:num(r.fields['优先级']),lastRunAt:text(r.fields['最近执行时间']),hitCount:num(r.fields['命中次数'])}))}}
async createRule(input:MessageRuleInput){if(!text(input.name)||!text(input.eventType)||!text(input.templateId))throw new BadRequestException('规则名称、事件类型和模板不能为空');if(input.mode==='自动发送'&&input.channel!=='Owner通知'&&!text(input.recipientAddress))throw new BadRequestException('自动发送规则必须配置接收地址');const ruleId=id('msgrule'),timestamp=now();await teable.createRecord(this.table('recruitment_message_trigger_rules'),{触发规则ID:ruleId,规则名称:input.name,事件类型:input.eventType,条件JSON:JSON.stringify(input.conditions||{}),模板ID:input.templateId,渠道:input.channel,接收类型:input.recipientType,接收地址:text(input.recipientAddress),执行模式:input.mode,规则状态:input.status||'启用',优先级:num(input.priority)||50,命中次数:0,创建人:text(input.operator)||'当前用户',创建时间:timestamp,更新时间:timestamp});return{ruleId,status:input.status||'启用'}}
async toggleRule(ruleId:string,body:{status:'启用'|'停用'}){const rows=await teable.listAllRecords(this.table('recruitment_message_trigger_rules')),row=rows.find(r=>text(r.fields['触发规则ID'])===ruleId||r.id===ruleId);if(!row)throw new NotFoundException('触发规则不存在');await teable.updateRecord(this.table('recruitment_message_trigger_rules'),row.id,{规则状态:body.status,更新时间:now()});return{ruleId,status:body.status}}
async scan(body:{operator?:string;operatorUserId?:string}){await this.ensureTemplates();const rules=(await teable.listAllRecords(this.table('recruitment_message_trigger_rules'))).filter(r=>text(r.fields['规则状态'])==='启用').sort((a,b)=>num(b.fields['优先级'])-num(a.fields['优先级']));let hits=0,sent=0,failed=0;for(const rule of rules){const contexts=await this.triggerContexts(text(rule.fields['事件类型']),json(rule.fields['条件JSON'],{}));for(const context of contexts){const runId=id('triggerrun');try{const preview=await this.preview({templateId:text(rule.fields['模板ID']),category:text(rule.fields['事件类型']),channel:text(rule.fields['渠道'])as any,recipientType:text(rule.fields['接收类型']),recipientAddress:text(rule.fields['接收地址']),candidateId:text(context.candidateId),objectType:text(context.objectType),objectId:text(context.objectId),variables:context.variables,operator:body.operator,operatorUserId:body.operatorUserId});hits++;let result='已生成草稿';if(text(rule.fields['执行模式'])==='自动发送'){await this.send(preview.messageId,{confirmed:true,operator:body.operator,operatorUserId:body.operatorUserId});sent++;result='已自动发送'}await teable.createRecord(this.table('recruitment_message_trigger_runs'),{触发运行ID:runId,触发规则ID:text(rule.fields['触发规则ID']),事件类型:text(rule.fields['事件类型']),对象类型:text(context.objectType),对象ID:text(context.objectId),候选人ID:text(context.candidateId),命中结果:'命中',条件快照JSON:JSON.stringify(context),消息ID:preview.messageId,执行结果:result,错误信息:'',发生时间:now()})}catch(error){failed++;await teable.createRecord(this.table('recruitment_message_trigger_runs'),{触发运行ID:runId,触发规则ID:text(rule.fields['触发规则ID']),事件类型:text(rule.fields['事件类型']),命中结果:'命中',条件快照JSON:JSON.stringify(context),执行结果:'失败',错误信息:error instanceof Error?error.message:String(error),发生时间:now()})}}await teable.updateRecord(this.table('recruitment_message_trigger_rules'),rule.id,{最近执行时间:now(),命中次数:num(rule.fields['命中次数'])+hits,更新时间:now()})}return{rules:rules.length,hits,sent,failed,drafts:hits-sent}}
async notifyOwner(body:{title:string;text:string;operator?:string;operatorUserId?:string}){const preview=await this.preview({category:text(body.title)||'内部告警',channel:'Owner通知',recipientType:'应用Owner',content:body.text,operator:body.operator,operatorUserId:body.operatorUserId});return this.send(preview.messageId,{confirmed:true,operator:body.operator,operatorUserId:body.operatorUserId})}
private sanitize(content:string,channel:string){const fields:string[]=[];let value=content;if(channel==='企业微信群'){const rules:Array<[string,RegExp,string]>=[['手机号',/(?<!\d)1[3-9]\d{9}(?!\d)/g,'[手机号已隐藏]'],['邮箱',/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'[邮箱已隐藏]'],['微信号',/(微信(?:号)?[：:\s]+)[A-Za-z][\w-]{5,19}/gi,'$1[已隐藏]'],['身份证号',/(?<!\d)\d{17}[\dXx](?!\d)/g,'[身份证已隐藏]'],['薪酬信息',/(?:月薪|薪资|Offer薪酬|基本月薪)[：:\s]*\d+(?:\.\d+)?(?:元|k|K)?/g,'[薪酬信息已隐藏]'],['背调信息',/(?:背调|背景调查)[：:\s]*[^\n]{1,80}/g,'[背调信息已隐藏]'],['内部评价',/(?:内部评价|淘汰原因|风险结论)[：:\s]*[^\n]{1,100}/g,'[内部评价已隐藏]']];for(const[name,pattern,replacement]of rules){if(pattern.test(value)){fields.push(name);pattern.lastIndex=0;value=value.replace(pattern,replacement)}}}return{content:value.trim().slice(0,3900),fields}}
async findReviewUser(userId:string){return this.findUser(userId)}
private async findUser(userId:string){const table=this.table('recruitment_users');for(const field of['用户ID','企业微信用户ID','天玑微信ID']){const row=await teable.findOneByField(table,field,userId);if(row)return row}try{return await teable.getRecord(table,userId)}catch{return undefined}}
private async context(input:MessagePreviewInput){const candidateId=text(input.candidateId);if(!candidateId)return{候选人姓名:'候选人',岗位名称:'招聘岗位',公司介绍:'方片新媒体是一家重视专业成长、协作与长期价值的团队。',岗位介绍:'该岗位的具体职责和任职要求请以招聘负责人发送的正式JD为准。'};const[candidate,apps,matches,interviews,offers,assessments,onboardings,followups,resumes]=await Promise.all([teable.findOneByField(this.table('recruitment_candidates'),'候选人ID',candidateId),...['recruitment_applications','recruitment_job_matches','recruitment_interviews','recruitment_offers','recruitment_assessment_invites','recruitment_onboarding_cases','recruitment_followups','resume_extraction_records'].map(n=>teable.listByField(this.table(n),'候选人ID',candidateId,500))]),app=apps.sort((a,b)=>text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0],match=matches.sort((a,b)=>num(b.fields['匹配总分'])-num(a.fields['匹配总分']))[0],interview=interviews.sort((a,b)=>text(b.fields['开始时间']).localeCompare(text(a.fields['开始时间'])))[0],offer=offers.sort((a,b)=>text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0],assessment=assessments.sort((a,b)=>text(b.fields['创建时间']).localeCompare(text(a.fields['创建时间'])))[0],onboarding=onboardings.sort((a,b)=>text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0],followup=followups.filter(r=>text(r.fields['回访状态'])==='待回访').sort((a,b)=>text(a.fields['计划回访日期']).localeCompare(text(b.fields['计划回访日期'])))[0],latestResumeId=text(candidate?.fields['最新简历记录ID']),resume=resumes.find(r=>r.id===latestResumeId||text(r.fields['解析记录ID'])===latestResumeId)||resumes.sort((a,b)=>text(b.fields['更新时间']).localeCompare(text(a.fields['更新时间'])))[0],assessmentPath=text(assessment?.fields['邀请路径']),assessmentLink=assessmentPath&&process.env.APP_PUBLIC_URL?new URL(assessmentPath,process.env.APP_PUBLIC_URL).toString():assessmentPath;return{候选人姓名:text(candidate?.fields['姓名'])||'候选人',候选人电话:text(candidate?.fields['电话']),候选人邮箱:text(candidate?.fields['邮箱']),候选人微信:text(candidate?.fields['微信']),岗位名称:text(match?.fields['职位名称'])||text(offer?.fields['岗位名称'])||'招聘岗位',匹配分:num(match?.fields['匹配总分']),当前阶段:text(app?.fields['当前阶段']),简历链接:text(resume?.fields['源文件地址']),面试时间:text(interview?.fields['开始时间']),面试地点:text(interview?.fields['面试地点'])||text(interview?.fields['会议地址']),测评链接:assessmentLink,Offer链接:text(offer?.fields['Offer文件地址']),入职日期:text(onboarding?.fields['计划入职日期'])||text(offer?.fields['入职日期']),回访日期:text(followup?.fields['计划回访日期']),公司介绍:'方片新媒体是一家重视专业成长、协作与长期价值的团队。',岗位介绍:`${text(match?.fields['职位名称'])||text(offer?.fields['岗位名称'])||'该岗位'}的具体职责和任职要求请以招聘负责人发送的正式JD为准。`}}
private async triggerContexts(eventType:string,conditions:Record<string,unknown>){if(eventType==='高匹配人才'){const[matches,candidates]=await Promise.all([teable.listAllRecords(this.table('recruitment_job_matches')),teable.listAllRecords(this.table('recruitment_candidates'))]),threshold=num(conditions.minScore)||85;return matches.filter(r=>num(r.fields['匹配总分'])>=threshold).map(r=>({candidateId:text(r.fields['候选人ID']),objectType:'岗位匹配',objectId:text(r.fields['匹配记录ID']),variables:{候选人姓名:text(candidates.find(c=>text(c.fields['候选人ID'])===text(r.fields['候选人ID']))?.fields['姓名']),岗位名称:text(r.fields['职位名称']),匹配分:num(r.fields['匹配总分'])}}))}if(eventType==='面试临近'){const rows=await teable.listAllRecords(this.table('recruitment_interviews')),hours=num(conditions.withinHours)||24,limit=Date.now()+hours*3600000;return rows.filter(r=>Date.parse(text(r.fields['开始时间']))>Date.now()&&Date.parse(text(r.fields['开始时间']))<=limit&&text(r.fields['预约状态'])!=='已取消').map(r=>({candidateId:text(r.fields['候选人ID']),objectType:'面试',objectId:text(r.fields['面试ID']),variables:{面试时间:text(r.fields['开始时间']),面试地点:text(r.fields['面试地点'])}}))}if(eventType==='回访到期'){const rows=await teable.listAllRecords(this.table('recruitment_followups')),asOf=text(conditions.asOf)||now().slice(0,10);return rows.filter(r=>text(r.fields['回访状态'])==='待回访'&&text(r.fields['计划回访日期'])<=asOf).map(r=>({candidateId:text(r.fields['候选人ID']),objectType:'回访',objectId:text(r.fields['回访ID']),variables:{回访日期:text(r.fields['计划回访日期'])}}))}return[]}
private async ensureTemplates(){const table=this.table('recruitment_message_templates'),rows=await teable.listAllRecords(table);if(rows.length)return;const seeds=[['优质简历群推送','优质简历','企业微信群','内部招聘群','【优质人才推荐】{{候选人姓名}}，推荐岗位：{{岗位名称}}，AI匹配{{匹配分}}分。简历链接：{{简历链接}}。请负责人在系统内查看证据并人工判断。'],['公司介绍','公司介绍','企业微信单聊','候选人','{{候选人姓名}}你好，{{公司介绍}}'],['岗位介绍','岗位介绍','企业微信单聊','候选人','{{候选人姓名}}你好，{{岗位介绍}}'],['测评邀请','测评邀请','企业微信单聊','候选人','{{候选人姓名}}你好，请通过以下链接完成{{岗位名称}}岗位测评：{{测评链接}}。'],['面试邀约','面试通知','企业微信单聊','候选人','{{候选人姓名}}你好，面试时间：{{面试时间}}，地点/会议地址：{{面试地点}}。如需改期请及时联系招聘负责人。'],['Offer通知','Offer通知','企业微信单聊','候选人','{{候选人姓名}}你好，录用通知已准备，请通过安全链接查看并答复：{{Offer链接}}。'],['入职提醒','入职通知','企业微信单聊','候选人','{{候选人姓名}}你好，计划入职日期为{{入职日期}}，请按招聘负责人要求准备入职资料。'],['回访提醒','回访通知','Owner通知','应用Owner','{{候选人姓名}}的回访任务计划日期为{{回访日期}}，请安排负责人联系并记录结果。']];const timestamp=now();for(const[name,category,channel,audience,content]of seeds){await teable.createRecord(table,{消息模板ID:id('msgtpl'),模板名称:name,消息分类:category,适用渠道:channel,适用对象:audience,模板内容:content,变量JSON:JSON.stringify([...content.matchAll(/{{([^}]+)}}/g)].map(x=>x[1])),敏感字段策略:channel==='企业微信群'?'严格脱敏':'按对象最小必要',模板状态:'启用',版本:1,创建人:'系统',创建时间:timestamp,更新时间:timestamp})}}
private async find(messageId:string){const table=this.table('recruitment_messages');let row=await teable.findOneByField(table,'消息ID',messageId);if(!row){try{row=await teable.getRecord(table,messageId)}catch{}}if(!row)throw new NotFoundException('消息不存在');return row}private mapMessage=(r:TeableRecord)=>({id:text(r.fields['消息ID'])||r.id,category:text(r.fields['消息分类']),channel:text(r.fields['渠道']),recipientType:text(r.fields['接收类型']),recipientAddress:text(r.fields['接收地址']),candidateId:text(r.fields['候选人ID']),content:text(r.fields['发送内容']),maskedFields:json(r.fields['脱敏字段JSON'],[]),confirmationStatus:text(r.fields['确认状态']),status:text(r.fields['发送状态']),retryCount:num(r.fields['重试次数']),externalId:text(r.fields['外部消息ID']),error:text(r.fields['错误信息']),creator:text(r.fields['创建人']),createdAt:text(r.fields['创建时间']),sentAt:text(r.fields['发送时间'])})
private async event(messageId:string,type:string,from:string,to:string,channel:string,recipient:string,request:unknown,response:unknown,error:string,operator?:string,operatorUserId?:string){await teable.createRecord(this.table('recruitment_message_send_events'),{发送事件ID:id('msgevent'),消息ID:messageId,事件类型:type,原状态:from,新状态:to,渠道:channel,接收地址:recipient,请求摘要JSON:JSON.stringify(request),响应摘要JSON:JSON.stringify(response),错误信息:error,操作人用户ID:text(operatorUserId),操作人:text(operator)||'系统',发生时间:now()})}}
