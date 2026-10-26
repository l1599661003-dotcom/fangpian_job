export type RecruitmentFieldType = 'singleLineText' | 'longText' | 'number'

export interface RecruitmentFieldDefinition {
  name: string
  type: RecruitmentFieldType
}

export interface RecruitmentTableDefinition {
  name: string
  fields: RecruitmentFieldDefinition[]
}

const text = (name: string): RecruitmentFieldDefinition => ({ name, type: 'singleLineText' })
const longText = (name: string): RecruitmentFieldDefinition => ({ name, type: 'longText' })
const number = (name: string): RecruitmentFieldDefinition => ({ name, type: 'number' })

export const RECRUITMENT_TABLES: RecruitmentTableDefinition[] = [
  {
    name: 'recruitment_monthly_demands',
    fields: [
      text('月度需求ID'), text('需求月份'), text('职位ID'), text('职位名称'), text('部门'), text('负责人'),
      number('需求数量'), text('需求类型'), text('需求状态'), text('优先级'), text('期望到岗日期'), longText('需求说明'), longText('需求要求'),
      text('最晚到岗日期'),
      longText('变更原因'), text('审批状态'), text('审批通过后状态'), text('审批提交时间'), text('审批申请人用户ID'), text('审批申请人'),
      text('审批人企微ID'), text('审批人用户ID'), text('审批人'), longText('审批意见'), text('审批时间'), text('审批通知状态'), longText('审批通知错误'),
      text('创建人用户ID'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_positions',
    fields: [
      text('职位ID'), text('需求ID'), text('职位名称'), text('职位编码'), text('部门ID'), text('部门'),
      text('负责人用户ID'), text('负责人'), text('招聘HR用户ID'), text('招聘HR'), text('备用招聘HR用户ID'), text('备用招聘HR'), text('招聘类别'), text('岗位层级'), text('工作城市'), text('工作地点'),
      number('招聘人数'), number('在职人数'), number('已到岗人数'), number('最低薪资'), number('最高薪资'), text('薪资文本'), longText('岗位JD'), longText('工作职责'), longText('任职要求'),
      longText('福利'), longText('标签JSON'), text('发布状态'), text('招聘状态'), text('需求类型'), text('优先级'), text('期望到岗日期'), text('审批状态'), text('发布时间'), text('下线时间'),
      text('最晚到岗日期'),
      text('审批提交时间'), text('审批申请人用户ID'), text('审批申请人'), text('审批人企微ID'), text('审批人用户ID'), text('审批人'), longText('审批意见'), text('审批时间'),
      text('审批通知状态'), longText('审批通知错误'),
      number('应聘人数缓存'), number('JD版本'), text('重匹配状态'), number('待重匹配人数'), text('最近JD变更时间'), longText('最近JD变更原因'),
      text('最近重匹配时间'), text('创建时间'), text('更新时间'), text('来源类型'), text('来源ID'),
    ],
  },
  {
    name: 'recruitment_candidates',
    fields: [
      text('候选人ID'), text('姓名'), text('性别'), number('出生年份'), number('年龄'), text('出生年份来源'), text('出生年份确认状态'),
      longText('出生年份冲突JSON'), longText('出生年份修正原因'), text('出生年份修正人用户ID'), text('出生年份修正人'), text('出生年份修正时间'), text('电话'), text('邮箱'),
      text('微信'), text('当前城市'), text('最高学历'), text('学校'), text('专业'), text('工作年限'), text('当前公司'),
      text('当前职位'), text('期望职位'), text('期望城市'), text('期望薪资'), text('可入职日期'), longText('自我评价'),
      longText('技能JSON'), longText('教育经历'), longText('工作经历'), text('候选人状态'), text('人才池'),
      longText('入池原因'), text('负责人用户ID'), text('负责人'), text('来源类型'), text('来源记录ID'), text('不推送企微群'),
      text('创建人用户ID'), text('创建人'),
      text('最新简历记录ID'), text('当前简历文件名'), text('当前简历地址'), text('头像地址'), text('头像提取状态'), text('首次进入时间'), text('最近联系时间'), text('创建时间'), text('更新时间'),
      text('归档时间'), text('人才评级'), text('重复检查状态'), longText('疑似重复候选人JSON'), text('合并状态'),
      text('合并至候选人ID'), text('合并事件ID'), text('联系锁定状态'), text('锁定人用户ID'), text('锁定人'), text('锁定到期时间'),
      text('天玑人事状态'), text('天玑员工ID'), text('天玑入职日期'), text('天玑离职日期'), text('天玑最近同步时间'),
    ],
  },
  {
    name: 'recruitment_candidate_duplicate_cases',
    fields: [
      text('重复案件ID'), text('候选人AID'), text('候选人BID'), number('综合相似分'), number('姓名相似分'),
      number('联系方式相似分'), number('教育经历相似分'), number('工作经历相似分'), longText('命中原因JSON'),
      text('案件状态'), text('处理结论'), text('主档候选人ID'), text('被合并候选人ID'), text('合并事件ID'),
      text('处理人'), longText('处理说明'), text('处理时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_candidate_merge_events',
    fields: [
      text('合并事件ID'), text('重复案件ID'), text('主档候选人ID'), text('副档候选人ID'), longText('字段选择JSON'),
      longText('主档合并前快照JSON'), longText('副档合并前快照JSON'), longText('关联迁移JSON'), text('合并状态'),
      text('操作人'), longText('合并原因'), text('合并时间'), text('撤销人'), longText('撤销原因'), text('撤销时间'),
    ],
  },
  {
    name: 'recruitment_candidate_owner_events',
    fields: [
      text('归属事件ID'), text('候选人ID'), text('原负责人用户ID'), text('原负责人'), text('新负责人用户ID'),
      text('新负责人'), longText('变更原因'), text('操作人'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_candidate_contact_locks',
    fields: [
      text('联系锁ID'), text('候选人ID'), text('锁定人用户ID'), text('锁定人'), text('锁定状态'),
      text('锁定时间'), text('到期时间'), text('最近续期时间'), text('释放时间'), longText('释放原因'),
    ],
  },
  {
    name: 'resume_extraction_records',
    fields: [
      text('姓名'), text('性别'), number('年龄'), text('电话'), text('邮箱'), text('微信'), text('地址'), longText('自我评价'),
      longText('技能证书'), longText('教育背景'), longText('工作经历'), text('求职意向'), text('工作年限'),
      text('当前公司'), text('当前职位'),
      text('源文件名'), text('源文件地址'), longText('OCR原文'), text('简历指纹'), text('解析记录ID'),
      longText('解析质量JSON'),
      text('头像地址'), text('头像提取状态'),
      text('候选人ID'), text('应聘记录ID'), text('解析状态'), longText('解析错误'), text('来源类型'),
      text('来源记录ID'), text('文件类型'), text('天玑人事状态'), number('文件大小'), text('解析器版本'), text('模型版本'),
      text('人工复核状态'), longText('人工修正内容'), text('可编辑Word文件名'), text('可编辑Word地址'),
      text('Word转换状态'), longText('Word转换错误'), number('Word转换版本'), text('Word转换人用户ID'), text('Word转换人'), text('Word转换时间'),
      text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_resume_versions',
    fields: [
      text('简历版本ID'), text('候选人ID'), text('简历记录ID'), number('版本号'), text('是否当前版本'),
      text('文件名'), text('文件地址'), text('文件类型'), number('文件大小'), text('简历指纹'), text('来源类型'),
      text('解析状态'), text('人工复核状态'), longText('版本说明'), text('创建人用户ID'), text('创建人'), text('创建时间'), text('启用时间'),
    ],
  },
  {
    name: 'resume_batch_imports',
    fields: [
      text('批次ID'), text('批次名称'), number('文件总数'), number('待处理数'), number('处理中数'), number('成功数'), number('失败数'),
      text('批次状态'), text('创建人用户ID'), text('创建人'), text('创建时间'), text('开始时间'), text('完成时间'), text('更新时间'), text('不推送企微群'), longText('错误摘要JSON'),
    ],
  },
  {
    name: 'resume_batch_import_items',
    fields: [
      text('批次项ID'), text('批次ID'), number('序号'), text('文件名'), text('文件类型'), number('文件大小'), text('原文件地址'),
      text('处理状态'), number('尝试次数'), text('简历记录ID'), text('候选人ID'), text('应聘记录ID'), text('是否重复'), number('疑似重复数'), text('不推送企微群'),
      longText('错误信息'), text('最近任务ID'), text('创建时间'), text('开始时间'), text('完成时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_applications',
    fields: [
      text('应聘记录ID'), text('候选人ID'), text('职位ID'), text('需求ID'), text('简历记录ID'), text('来源类型'),
      text('来源名称'), text('内推记录ID'), text('负责人用户ID'), text('负责人'), text('当前阶段'), text('当前状态'),
      number('AI匹配分'), text('AI评分版本'), text('人工复核结果'), longText('淘汰原因'), text('投递时间'),
      text('最近处理时间'), text('流程结束时间'), text('创建时间'), text('更新时间'), text('来源记录ID'),
    ],
  },
  {
    name: 'recruitment_stage_events',
    fields: [
      text('事件ID'), text('应聘记录ID'), text('候选人ID'), text('职位ID'), text('原阶段'), text('新阶段'),
      text('操作'), text('结果'), longText('原因'), text('操作人用户ID'), text('操作人'), text('发生时间'),
      text('来源类型'), text('来源记录ID'), longText('扩展信息JSON'),
    ],
  },
  {
    name: 'recruitment_stage_rules',
    fields: [
      text('阶段规则ID'), text('原阶段'), text('目标阶段'), longText('进入条件JSON'), longText('退出条件JSON'),
      number('SLA小时'), text('默认负责人角色'), text('规则状态'), number('版本'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_stage_sla_events',
    fields: [
      text('SLA事件ID'), text('应聘记录ID'), text('候选人ID'), text('当前阶段'), text('进入阶段时间'), text('SLA截止时间'),
      number('逾期小时'), text('处理状态'), text('待办ID'), number('升级层级'), text('最近提醒时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_candidate_tags',
    fields: [
      text('标签记录ID'), text('候选人ID'), text('标签名称'), text('标签分类'), text('标签来源'),
      number('置信度'), longText('证据'), text('人工确认状态'), text('标签状态'), text('分析版本'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_ai_assessments',
    fields: [
      text('分析记录ID'), text('候选人ID'), text('简历记录ID'), text('分析版本'), number('版本号'), text('父分析记录ID'),
      text('分析类型'), longText('重跑原因'), text('提示词版本'), text('模型版本'), text('运行状态'), number('耗时毫秒'), number('输入字符数'), number('输出字符数'), longText('运行错误'),
      number('输入估算Token'), number('输出估算Token'), number('估算成本元'), text('成本估算口径'),
      longText('人才摘要'), longText('优势JSON'), longText('风险与待确认JSON'), longText('技能JSON'),
      number('业务能力分'), number('管理能力分'), number('逻辑能力分'), number('沟通协作分'), number('综合建议分'),
      longText('评分证据JSON'), longText('推荐岗位JSON'), text('置信度'), text('人工确认状态'),
      longText('人工修正内容'), longText('人工修正JSON'), longText('生效评分JSON'), longText('生效技能JSON'), longText('生效推荐岗位JSON'),
      longText('人工修正原因'), text('修正人用户ID'), text('修正人'), text('修正时间'), text('确认人用户ID'), text('确认人'), text('确认时间'),
      text('运行人用户ID'), text('运行人'), text('开始时间'), text('完成时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_job_matches',
    fields: [
      text('匹配记录ID'), text('候选人ID'), text('职位ID'), text('职位名称'), text('需求ID'), text('分析记录ID'),
      number('匹配总分'), number('技能匹配分'), number('经验匹配分'), number('管理匹配分'), number('业务匹配分'),
      longText('推荐理由'), longText('差距与待确认项'), text('置信度'), text('人工确认状态'), text('人工结论'),
      text('分析版本'), number('岗位JD版本'), text('匹配状态'), text('父匹配记录ID'), text('重匹配批次ID'), longText('重匹配原因'),
      text('匹配人用户ID'), text('匹配人'), text('创建时间'), text('更新时间'),
      text('修正前岗位ID'), text('修正前岗位'), longText('人工修正原因'), text('人工修正人用户ID'), text('人工修正人'), text('人工修正时间'),
    ],
  },
  {
    name: 'recruitment_communications',
    fields: [
      text('沟通记录ID'), text('候选人ID'), text('应聘记录ID'), text('沟通类型'), text('沟通渠道'),
      text('沟通方向'), longText('沟通摘要'), longText('下一步行动'), text('下次跟进时间'), text('沟通结果'),
      text('微信号'), text('微信重复状态'), text('使用模板ID'), text('拒绝原因'), text('再联系时间'),
      text('接通状态'), text('兴趣度'), text('在职状态'), text('到岗时间'),
      text('离职原因'), longText('离职原因详情'), text('婚姻状况'), longText('居住区域'),
      longText('主要职责'), longText('当前薪酬整体情况'), longText('候选人关注点'),
      longText('当前加班强度'), longText('加班接受度'), text('约面形式'), text('约面时间'),
      longText('沟通备注'),
      text('操作人用户ID'), text('操作人'), text('发生时间'), text('创建时间'),
    ],
  },
  {
    name: 'recruitment_candidate_reviews',
    fields: [
      text('审查记录ID'), text('应聘记录ID'), text('候选人ID'), text('职位ID'), text('审查结论'),
      longText('审查意见'), longText('证据JSON'), longText('风险项反馈JSON'), number('AI匹配分'), text('AI置信度'),
      text('原阶段'), text('目标阶段'), text('审查人用户ID'), text('审查人'), text('审查时间'), text('创建时间'),
    ],
  },
  {
    name: 'recruitment_communication_templates',
    fields: [
      text('模板ID'), text('模板名称'), text('模板分类'), text('适用岗位'), text('适用渠道'), longText('模板内容'),
      longText('变量JSON'), text('模板状态'), text('创建人用户ID'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_question_bank',
    fields: [
      text('题目ID'), text('题目分类'), text('题目类型'), longText('题干'), longText('题目说明'), longText('选项JSON'),
      longText('参考答案'), longText('评分规则JSON'), number('满分'), text('是否必答'), text('题目来源'), text('题目状态'),
      text('适用岗位'), text('适用面试官用户ID'), text('来源面试ID'), longText('来源离职原因'),
      text('创建人用户ID'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_assessment_templates',
    fields: [
      text('题单ID'), text('题单名称'), text('题单分类'), text('职位ID'), text('适用岗位'), longText('答题说明'),
      number('限时分钟'), longText('题目IDJSON'), number('总分'), text('题单状态'), number('版本'), text('发布人用户ID'),
      text('发布人'), text('发布时间'), text('创建人用户ID'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_assessment_invites',
    fields: [
      text('测评邀请ID'), text('候选人ID'), text('应聘记录ID'), text('职位ID'), text('题单ID'), text('题单版本'),
      text('访问Token哈希'), text('Token前缀'), text('邀请路径'), text('邀请状态'), text('过期时间'), text('首次访问时间'), text('开始答题时间'),
      text('提交时间'), number('访问次数'), number('完成度'), number('答题耗时秒'), longText('异常JSON'),
      number('AI建议分'), longText('AI评分JSON'), text('AI评分状态'), number('人工最终分'), text('人工结论'),
      text('创建人用户ID'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_assessment_answers',
    fields: [
      text('答案ID'), text('测评邀请ID'), text('候选人ID'), text('题目ID'), text('题目类型'), longText('答案JSON'),
      text('文件名'), text('文件地址'), number('文件大小'), text('自动保存时间'), text('正式提交状态'),
      number('AI建议分'), longText('AI评分说明'), number('人工评分'), longText('人工评语'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_assessment_events',
    fields: [
      text('测评事件ID'), text('测评邀请ID'), text('候选人ID'), text('事件类型'), longText('事件详情JSON'),
      text('客户端时间'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_assessment_reviews',
    fields: [
      text('测评评审ID'), text('测评邀请ID'), text('候选人ID'), text('应聘记录ID'), number('AI建议分'),
      longText('AI评分摘要'), number('人工最终分'), text('人工结论'), longText('人工评语'), longText('逐题评分JSON'),
      text('评审人用户ID'), text('评审人'), text('评审时间'), text('创建时间'),
    ],
  },
  {
    name: 'recruitment_interviews',
    fields: [
      text('面试ID'), text('应聘记录ID'), text('候选人ID'), text('职位ID'), text('面试轮次'), text('面试类型'),
      text('面试方式'), text('开始时间'), text('结束时间'), text('时区'), text('面试地点'), text('会议地址'),
      text('会议室ID'), text('外部预约ID'), text('外部会议室预订ID'), longText('外部会议室预订信息JSON'), longText('外部会议信息JSON'), longText('面试官用户IDJSON'), longText('面试官姓名JSON'),
      text('组织者用户ID'), text('面试状态'), text('候选人确认状态'), text('签到状态'), text('评价状态'),
      text('面试结果'), longText('备注'), text('关联状态'), text('来源记录ID'), text('候选人操作Token哈希'), text('Token前缀'),
      text('操作链接过期时间'), text('候选人确认时间'), longText('候选人改期原因'), text('取消时间'), text('同步状态'),
      text('改期申请时间'), longText('改期期望时间JSON'), text('改期审批状态'), text('改期审批人用户ID'), text('改期审批人'),
      text('改期审批时间'), longText('改期审批说明'), text('改期通知状态'), longText('改期通知错误'),
      longText('同步错误'), text('最近同步时间'), text('提醒状态'), text('提醒时间'), text('签到时间'),
      text('面试题状态'), text('面试题生成时间'), longText('面试题生成错误'), longText('面试题快照JSON'),
      text('面试评价催填时间'), text('候选人邮件发送选项'), text('结果通知状态'), text('结果通知时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_interviewer_pool',
    fields: [
      text('面试官ID'), text('用户ID'), text('姓名'), text('部门ID'), text('部门'), longText('擅长岗位JSON'),
      longText('可面轮次JSON'), text('时区'), text('状态'), number('每日最大面试数'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_interviewer_availability',
    fields: [
      text('可用时间ID'), text('面试官ID'), text('用户ID'), text('开始时间'), text('结束时间'), text('可用状态'),
      text('重复规则'), text('来源类型'), text('外部日历事件ID'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_meeting_rooms',
    fields: [
      text('会议室ID'), text('会议室名称'), text('办公地点'), text('楼层'), number('容纳人数'), longText('设备JSON'),
      text('外部资源ID'), text('资源状态'), text('同步状态'), longText('同步错误'), text('最近同步时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_interview_sync_events',
    fields: [
      text('同步事件ID'), text('面试ID'), text('同步类型'), text('同步方向'), text('原状态'), text('新状态'),
      text('外部预约ID'), longText('请求摘要JSON'), longText('响应摘要JSON'), longText('错误信息'), text('重试来源事件ID'),
      text('操作人'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_interview_invite_templates',
    fields: [
      text('邀约模板ID'), text('模板名称'), text('适用面试方式'), longText('模板内容'), longText('变量JSON'),
      text('模板状态'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_interview_mail_events',
    fields: [
      text('邮件事件ID'), text('面试ID'), text('候选人ID'), text('收件人邮箱'), text('邮件主题'), longText('邮件正文'),
      text('发送状态'), text('外部邮件ID'), longText('错误信息'), text('发送人'), text('发送时间'), text('创建时间'),
    ],
  },
  {
    name: 'recruitment_interview_candidate_forms',
    fields: [
      text('填写记录ID'), text('面试ID'), text('候选人ID'), longText('个人信息JSON'), longText('预面试问卷JSON'),
      text('填写状态'), text('提交时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_interview_feedback',
    fields: [
      text('评价ID'), text('面试ID'), text('应聘记录ID'), text('候选人ID'), text('面试官用户ID'), text('面试官'), text('候选人评级'),
      number('专业能力分'), number('沟通能力分'), number('执行能力分'), number('文化匹配分'), number('发展潜力分'),
      number('综合分'), text('推荐结论'), longText('其他匹配岗位'), longText('候选人优势'), longText('风险与待核实项'), longText('面试评价'),
      longText('备注'), longText('AI评价草稿'), longText('AI面试总结'), longText('面试官评价'), text('AI版本'), text('是否人工修改'), text('提交时间'), text('评价截止时间'),
      longText('题目回答JSON'), longText('评分证据JSON'), text('AI草稿状态'), text('人工确认状态'), text('锁定状态'),
      text('评价状态'), number('版本'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_interview_templates',
    fields: [
      text('面试模板ID'), text('模板名称'), text('候选人类型'), text('适用岗位'), text('适用轮次'),
      longText('维度JSON'), longText('问题JSON'), text('模板状态'), number('版本'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_interview_notes',
    fields: [
      text('纪要ID'), text('面试ID'), text('候选人ID'), longText('原始记录'), longText('转写文本'), longText('AI纪要草稿'),
      longText('AI优势JSON'), longText('AI风险JSON'), longText('AI待确认JSON'), text('AI版本'), text('AI状态'),
      longText('人工确认纪要'), text('确认人'), text('确认时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_interview_decisions',
    fields: [
      text('决策ID'), text('面试ID'), text('应聘记录ID'), text('候选人ID'), longText('评价IDJSON'),
      longText('汇总评分JSON'), longText('意见分歧JSON'), text('招聘决策'), longText('决策原因'),
      text('决策人用户ID'), text('决策人'), text('决策时间'), text('创建时间'),
    ],
  },
  {
    name: 'recruitment_offers',
    fields: [
      text('OfferID'), text('候选人ID'), text('应聘记录ID'), text('职位ID'), text('需求ID'), text('Offer编号'),
      text('岗位名称'), text('部门'), text('工作地点'), number('基本月薪'), number('绩效月薪'), number('补贴月额'),
      number('奖金月数'), longText('薪资结构JSON'), text('入职日期'), text('汇报上级'), text('有效期开始'), text('有效期结束'), text('称谓'), text('试用期月数'), text('试用期薪资比例'),
      longText('保录信息'), text('是否需要背调'), text('Offer状态'), text('审批状态'), number('当前版本'),
      text('模板ID'), text('Offer文件地址'), text('Offer文件名'), text('答复Token哈希'), text('Token前缀'), text('答复过期时间'),
      text('发送状态'), text('发送时间'), text('候选人答复'), longText('候选人答复说明'), text('答复时间'),
      text('创建人用户ID'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_offer_versions',
    fields: [
      text('Offer版本ID'), text('OfferID'), number('版本号'), longText('Offer快照JSON'), text('变更类型'), longText('变更原因'),
      text('创建人'), text('创建时间'),
    ],
  },
  {
    name: 'recruitment_offer_approval_events',
    fields: [
      text('审批事件ID'), text('OfferID'), text('原审批状态'), text('新审批状态'), text('审批动作'), text('审批节点'),
      text('审批人用户ID'), text('审批人'), text('审批角色'), longText('审批意见'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_offer_templates',
    fields: [
      text('Offer模板ID'), text('模板名称'), text('适用类型'), longText('模板内容'), longText('变量JSON'), text('原始模板地址'),
      text('模板状态'), number('版本'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_offer_send_events',
    fields: [
      text('发送事件ID'), text('OfferID'), text('发送渠道'), text('接收地址'), text('发送状态'), longText('内容摘要JSON'),
      longText('错误信息'), text('操作人'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_offer_negotiations',
    fields: [
      text('谈薪记录ID'), text('OfferID'), number('原版本'), number('新版本'), longText('候选人诉求'), longText('公司答复'),
      longText('调整项JSON'), text('谈薪结果'), text('操作人'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_background_checks',
    fields: [
      text('背调ID'), text('候选人ID'), text('应聘记录ID'), text('OfferID'), text('背调编号'), text('背调状态'),
      text('授权状态'), text('授权方式'), text('授权时间'), text('授权文件地址'), longText('核验范围JSON'),
      text('外部服务商'), text('外部任务ID'), text('外部同步状态'), longText('外部错误信息'),
      text('八方订单ID'), text('八方套餐ID'), text('八方套餐名称'), text('八方订单状态'),
      text('八方报告结果'), text('八方报告地址'), text('八方报告类型'), text('八方下单时间'),
      text('八方报告同步时间'), text('风险等级'),
      text('背调结论'), longText('结论摘要'), text('报告地址'), text('报告文件名'), number('报告版本'),
      text('人工确认状态'), text('确认人用户ID'), text('确认人'), text('确认时间'), longText('确认意见'),
      text('创建人用户ID'), text('创建人'), text('创建时间'), text('更新时间'), text('完成时间'),
    ],
  },
  {
    name: 'recruitment_background_contacts',
    fields: [
      text('背调联系人ID'), text('背调ID'), text('候选人ID'), text('联系人姓名'), text('与候选人关系'), text('公司名称'),
      text('职位'), text('电话'), text('邮箱'), text('核验状态'), text('联系时间'), longText('联系备注'),
      text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_background_verifications',
    fields: [
      text('核验项ID'), text('背调ID'), text('候选人ID'), text('核验类型'), text('公司名称'), text('任职岗位'),
      text('候选人声明开始时间'), text('候选人声明结束时间'), text('核验开始时间'), text('核验结束时间'),
      longText('候选人声明内容'), longText('核验结果'), longText('离职原因'), longText('工作表现'), longText('带队与管理表现'),
      text('一致性结论'), text('证据来源'), text('核验人'), text('核验时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_background_risks',
    fields: [
      text('风险项ID'), text('背调ID'), text('候选人ID'), text('风险类型'), text('风险等级'), text('风险标题'),
      longText('风险说明'), longText('证据摘要'), longText('证据附件JSON'), text('处理状态'), longText('处理意见'),
      text('确认人'), text('确认时间'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_background_events',
    fields: [
      text('背调事件ID'), text('背调ID'), text('候选人ID'), text('原状态'), text('新状态'), text('事件类型'),
      longText('事件说明'), longText('扩展信息JSON'), text('操作人用户ID'), text('操作人'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_onboarding_cases',
    fields: [
      text('入职单ID'), text('候选人ID'), text('应聘记录ID'), text('OfferID'), text('需求ID'), text('职位ID'), text('入职编号'),
      text('计划入职日期'), text('实际到岗日期'), text('部门'), text('岗位'), text('直属负责人'), text('工作地点'),
      text('入职状态'), number('资料完成率'), number('任务完成率'), text('外部系统'), text('外部任务ID'), text('外部同步状态'),
      longText('外部错误信息'), text('试用期结束日期'), text('转正状态'), text('创建人用户ID'), text('创建人'),
      text('创建时间'), text('更新时间'), text('完成时间'), text('到岗提醒状态'), text('到岗提醒时间'), text('到岗确认链接'), longText('到岗确认说明'), text('到岗确认时间'),
    ],
  },
  {
    name: 'recruitment_onboarding_documents',
    fields: [
      text('资料ID'), text('入职单ID'), text('候选人ID'), text('资料类型'), text('资料名称'), text('文件地址'), text('文件类型'),
      text('资料状态'), longText('核验说明'), text('提交人'), text('提交时间'), text('核验人'), text('核验时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_onboarding_tasks',
    fields: [
      text('入职任务ID'), text('入职单ID'), text('候选人ID'), text('任务分类'), text('任务名称'), longText('任务说明'),
      text('负责人用户ID'), text('负责人'), text('截止时间'), text('任务状态'), text('完成时间'), longText('完成说明'),
      text('来源类型'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_probation_reviews',
    fields: [
      text('试用期记录ID'), text('入职单ID'), text('候选人ID'), text('节点类型'), text('计划日期'), text('实际处理日期'),
      text('处理状态'), text('述职评级'), text('新人成长等级'), longText('述职评价'), number('绩效评分'), longText('负责人评价'), longText('员工反馈'), text('转正建议'), text('处理人'),
      text('创建时间'), text('更新时间'), text('通知状态'), text('通知时间'), longText('扩展信息JSON'),
    ],
  },
  {
    name: 'recruitment_offboarding_cases',
    fields: [
      text('离职单ID'), text('入职单ID'), text('候选人ID'), text('应聘记录ID'), text('离职编号'), text('申请日期'), text('计划离职日期'),
      text('实际离职日期'), text('离职类型'), text('离职原因分类'), longText('离职原因说明'), text('离职状态'),
      text('交接状态'), text('资产归还状态'), text('账号关闭状态'), text('人才回流标记'), text('回流建议时间'),
      text('题库反哺状态'), number('题库反哺数量'), longText('题库反哺错误'), text('题库反哺时间'),
      text('申请人'), text('经办人'), text('创建时间'), text('更新时间'), text('完成时间'),
    ],
  },
  {
    name: 'recruitment_exit_interviews',
    fields: [
      text('离职面谈ID'), text('离职单ID'), text('候选人ID'), text('面谈日期'), text('面谈人'), text('面谈人用户ID'), text('来源面试ID'), text('离职主因'),
      longText('满意项JSON'), longText('不满意项JSON'), longText('改进建议'), longText('真实去向'), text('是否愿意回流'),
      text('回流条件'), text('保密级别'), text('题库反哺状态'), number('题库反哺数量'), longText('题库反哺错误'), text('题库反哺时间'),
      text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_followups',
    fields: [
      text('回访ID'), text('候选人ID'), text('入职单ID'), text('离职单ID'), text('回访类型'), text('计划回访日期'), text('实际回访日期'),
      text('回访状态'), text('回访渠道'), text('回访结果'), longText('回访原因'), longText('反馈内容'), number('满意度评分'),
      text('人才评级调整前'), text('人才评级调整后'), text('回流意向'), text('下次回访日期'), text('负责人'),
      text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_employee_lifecycle_events',
    fields: [
      text('员工事件ID'), text('候选人ID'), text('入职单ID'), text('离职单ID'), text('事件类型'), text('原状态'), text('新状态'),
      longText('事件说明'), longText('扩展信息JSON'), text('操作人用户ID'), text('操作人'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_referral_campaigns',
    fields: [
      text('内推活动ID'), text('活动名称'), text('职位ID'), text('需求ID'), text('岗位名称'), text('部门'), longText('活动说明'),
      text('推荐人用户ID'), text('推荐人'), text('推荐人手机号'), text('推荐人部门'),
      text('公开Token哈希'), text('Token前缀'), text('公开页面地址'), text('二维码DataURL'), text('活动状态'), text('过期时间'),
      text('创建人用户ID'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_referrals',
    fields: [
      text('内推记录ID'), text('候选人ID'), text('应聘记录ID'), text('职位ID'), text('需求ID'), text('推荐人用户ID'),
      text('推荐人'), text('推荐人部门ID'), text('推荐人部门'), longText('关系说明'), text('候选人姓名快照'),
      text('候选人电话快照'), text('来源类型'), text('内推状态'), text('当前进度'), text('有效性结论'),
      longText('无效原因'), text('推荐时间'), text('关联状态'), text('来源记录ID'), text('内推活动ID'), text('推荐人手机号'),
      text('源文件名'), text('源文件地址'), text('解析任务ID'), text('解析状态'), longText('解析错误'), text('查重状态'),
      text('进度Token哈希'), text('进度Token前缀'), text('进度查询过期时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_referral_reward_rules',
    fields: [
      text('奖励规则ID'), text('规则名称'), text('适用岗位'), text('适用部门'), text('奖励阶段'), text('奖励类型'),
      number('奖励金额'), number('奖励积分'), number('入职满天数'), text('规则状态'), number('版本'), longText('说明'),
      text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_referral_rewards',
    fields: [
      text('奖励记录ID'), text('奖励规则ID'), text('内推记录ID'), text('候选人ID'), text('应聘记录ID'), text('推荐人用户ID'), text('推荐人'), text('奖励阶段'),
      text('奖励类型'), number('应发金额'), number('实发金额'), number('奖励积分'), text('资格状态'),
      text('发放状态'), text('满足条件时间'), text('发放时间'), text('经办人用户ID'), longText('备注'),
      text('来源记录ID'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_referral_events',
    fields: [
      text('内推事件ID'), text('内推记录ID'), text('内推活动ID'), text('候选人ID'), text('事件类型'), text('原状态'), text('新状态'),
      longText('事件说明'), text('通知状态'), longText('通知内容JSON'), text('操作人用户ID'), text('操作人'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_public_links',
    fields: [
      text('链接ID'), text('候选人ID'), text('链接类型'), text('对象类型'), text('对象ID'), text('访问Token哈希'), text('Token前缀'), text('访问路径'),
      text('链接状态'), text('过期时间'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_message_templates',
    fields: [
      text('消息模板ID'), text('模板名称'), text('消息分类'), text('适用渠道'), text('适用对象'), longText('模板内容'),
      longText('变量JSON'), text('敏感字段策略'), text('模板状态'), number('版本'), text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_messages',
    fields: [
      text('消息ID'), text('模板ID'), text('消息分类'), text('渠道'), text('接收类型'), text('接收地址'), text('候选人ID'),
      text('对象类型'), text('对象ID'), longText('变量JSON'), longText('原始内容'), longText('发送内容'), longText('脱敏字段JSON'),
      text('确认状态'), text('确认人用户ID'), text('确认人'), text('确认时间'), text('发送状态'), number('重试次数'),
      text('外部消息ID'), longText('错误信息'), text('创建人用户ID'), text('创建人'), text('创建时间'), text('更新时间'), text('发送时间'),
    ],
  },
  {
    name: 'recruitment_message_send_events',
    fields: [
      text('发送事件ID'), text('消息ID'), text('事件类型'), text('原状态'), text('新状态'), text('渠道'), text('接收地址'),
      longText('请求摘要JSON'), longText('响应摘要JSON'), longText('错误信息'), text('操作人用户ID'), text('操作人'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_message_trigger_rules',
    fields: [
      text('触发规则ID'), text('规则名称'), text('事件类型'), longText('条件JSON'), text('模板ID'), text('渠道'), text('接收类型'),
      text('接收地址'), text('执行模式'), text('规则状态'), number('优先级'), text('最近执行时间'), number('命中次数'),
      text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_message_trigger_runs',
    fields: [
      text('触发运行ID'), text('触发规则ID'), text('事件类型'), text('对象类型'), text('对象ID'), text('候选人ID'),
      text('命中结果'), longText('条件快照JSON'), text('消息ID'), text('执行结果'), longText('错误信息'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_talent_review_shares',
    fields: [
      text('分享批次ID'), text('候选人ID'), text('应聘记录ID'), text('分析记录ID'), text('推荐职位ID'), text('推荐职位名称'),
      text('访问Token哈希'), text('Token前缀'), text('评审链接'), longText('人才快照JSON'), text('分享状态'),
      text('企微消息ID'), longText('发送错误'), number('反馈数'), text('认领反馈ID'), text('认领部门ID'), text('认领部门'),
      text('认领职位ID'), text('认领职位'), text('创建人用户ID'), text('创建人'), text('发送时间'), text('过期时间'),
      text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_talent_review_responses',
    fields: [
      text('反馈ID'), text('分享批次ID'), text('候选人ID'), text('反馈结论'), text('部门ID'), text('部门'), text('职位ID'), text('职位'),
      text('评审人用户ID'), text('评审人'), longText('评审意见'), text('处理结果'), text('应聘记录ID'), text('面试待办ID'),
      text('提交时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_tasks',
    fields: [
      text('待办ID'), text('待办类型'), text('对象类型'), text('对象ID'), text('标题'), longText('描述'),
      text('处理人用户ID'), text('处理人'), text('部门ID'), text('优先级'), text('待办状态'), text('截止时间'),
      text('提醒时间'), number('升级层级'), longText('扩展信息JSON'), longText('备注'), text('完成时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_task_events',
    fields: [
      text('待办事件ID'), text('待办ID'), text('事件类型'), text('原状态'), text('新状态'), text('原处理人用户ID'), text('新处理人用户ID'),
      number('升级层级'), longText('事件说明'), text('操作人用户ID'), text('操作人'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_candidate_rating_events',
    fields: [
      text('评级事件ID'), text('候选人ID'), text('原评级'), text('新评级'), longText('评级原因'), longText('评级证据JSON'),
      text('来源类型'), text('来源记录ID'), text('操作人用户ID'), text('操作人'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_report_exports',
    fields: [
      text('导出记录ID'), text('报表类型'), longText('筛选条件JSON'), number('导出行数'), text('导出人用户ID'), text('导出人'),
      text('权限角色'), text('导出水印'), text('请求ID'), text('客户端IP'), text('导出状态'), longText('错误信息'), text('导出时间'),
    ],
  },
  {
    name: 'recruitment_audit_logs',
    fields: [
      text('日志ID'), text('操作人用户ID'), text('操作人'), text('操作角色'), text('操作类型'), text('对象类型'),
      text('对象ID'), longText('修改前摘要JSON'), longText('修改后摘要JSON'), longText('操作原因'), text('IP地址'),
      text('客户端信息'), text('请求ID'), text('发生时间'), text('操作结果'), longText('错误信息'),
    ],
  },
  {
    name: 'resume_api_settings',
    fields: [
      text('配置名称'), text('API Key'), text('状态'), text('创建时间'), text('更新时间'), text('客户端ID'),
      text('Key前缀'), text('Key哈希'), longText('权限范围JSON'), number('每分钟调用上限'), text('最近使用时间'),
      text('轮换时间'), text('过期时间'), text('创建人用户ID'),
    ],
  },
  {
    name: 'resume_api_usage_logs',
    fields: [
      text('调用记录ID'), text('客户端ID'), text('接口路径'), text('请求ID'), text('任务ID'), text('来源IP'),
      text('文件类型'), number('文件大小'), number('HTTP状态码'), text('处理结果'), text('错误代码'),
      number('处理耗时毫秒'), text('调用时间'),
    ],
  },
  {
    name: 'recruitment_roles',
    fields: [
      text('角色编码'), text('角色名称'), longText('角色说明'), text('角色层级'), text('数据范围类型'),
      longText('页面权限JSON'), longText('操作权限JSON'), longText('敏感字段策略JSON'), text('是否系统角色'),
      text('角色状态'), number('版本'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_user_roles',
    fields: [
      text('用户角色ID'), text('用户ID'), text('用户姓名'), text('角色编码'), text('事业部ID'), text('事业部'),
      longText('部门IDJSON'), text('绑定状态'), text('生效时间'), text('失效时间'), text('授权人用户ID'),
      text('授权人'), longText('授权原因'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_users',
    fields: [
      text('用户ID'), text('姓名'), text('工号'), text('邮箱'), text('手机'), text('企业微信用户ID'), text('天玑微信ID'),
      text('内推码'),
      text('事业部ID'), text('事业部'), longText('部门IDJSON'), longText('部门JSON'), text('用户状态'), text('天玑人事状态'),
      text('身份来源'), text('最近同步时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_login_sessions',
    fields: [
      text('会话ID'), text('用户ID'), text('用户姓名'), text('令牌哈希'), text('会话状态'),
      text('创建时间'), text('过期时间'), text('最近访问时间'), text('退出时间'), text('来源IP'), text('身份来源'),
      longText('客户端信息'),
    ],
  },
  {
    name: 'recruitment_organization_units',
    fields: [
      text('组织单元ID'), text('组织类型'), text('组织编码'), text('组织名称'), text('上级组织单元ID'),
      text('负责人用户ID'), text('负责人'), text('组织状态'), number('排序'), text('来源类型'),
      text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_sensitive_access_requests',
    fields: [
      text('解锁申请ID'), text('申请人用户ID'), text('申请人'), longText('申请角色JSON'), text('对象类型'),
      text('对象ID'), text('候选人ID'), longText('敏感字段JSON'), longText('申请原因'), text('申请状态'),
      text('审批人用户ID'), text('审批人'), longText('审批意见'), text('审批时间'), text('授权开始时间'),
      text('授权到期时间'), text('撤销时间'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_collection_tasks',
    fields: [
      text('采集任务ID'), text('职位ID'), text('需求ID'), text('任务名称'), longText('目标平台JSON'), longText('采集条件JSON'),
      number('目标简历数'), text('触发方式'), text('任务状态'), text('外部任务ID'), text('领取人'),
      text('最近触发时间'), text('最近心跳时间'), text('最近完成时间'), number('重试次数'),
      number('已采集数量'), number('成功入库数量'), longText('最近结果JSON'), text('错误信息'),
      text('创建人'), text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_collection_task_events',
    fields: [
      text('采集事件ID'), text('采集任务ID'), text('职位ID'), text('需求ID'),
      text('原状态'), text('新状态'), text('操作'), text('外部任务ID'),
      number('已采集数量'), number('成功入库数量'), longText('结果JSON'), text('错误信息'),
      text('操作人'), text('发生时间'),
    ],
  },
  {
    name: 'recruitment_channels',
    fields: [
      text('渠道ID'), text('渠道名称'), text('渠道类型'), text('渠道状态'),
      text('渠道负责人用户ID'), text('渠道负责人'), text('默认采集频率'), number('单次目标简历数'),
      longText('平台配置JSON'), text('说明'), text('最近运行时间'), text('下次运行时间'),
      text('创建时间'), text('更新时间'),
    ],
  },
  {
    name: 'recruitment_position_channels',
    fields: [
      text('职位渠道ID'), text('职位ID'), text('需求ID'), text('渠道ID'), text('渠道名称'),
      text('绑定状态'), text('采集频率'), number('目标简历数'), longText('采集条件JSON'),
      text('渠道负责人'), text('创建时间'), text('更新时间'),
    ],
  },
]
'$(cat /tmp/role_templates.ts)'
'$(cat /tmp/role_templates.ts)'
export interface RoleTemplate {
  code: string
  name: string
  description: string
  level: string
  dataScope: string
  pages: string[]
  actions: string[]
  sensitiveFields: Record<string, string | boolean>
}

export const SYSTEM_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    code: 'system_admin', name: '超级管理员', description: '拥有系统全部菜单和管理权限。',
    level: 'L4', dataScope: 'all', pages: ['*'], actions: ['*'],
    sensitiveFields: { salary: 'full', contacts: 'full', resume: 'full' },
  },
  {
    code: 'recruiter', name: '招聘专员', description: '处理授权部门的需求、人才、面试和内推流程，并统计内推积分。',
    level: 'L2', dataScope: 'assigned_departments',
    pages: ['home', 'demands', 'positions', 'resume_parse', 'candidates', 'interviews', 'referrals', 'analytics', 'points'],
    actions: ['create_demand', 'edit_candidate', 'advance_application', 'arrange_interview', 'export_authorized_data'],
    sensitiveFields: { contacts: 'masked', interviewFeedback: 'authorized', salary: 'masked', unlock: false },
  },
  {
    code: 'hrbp', name: 'HRBP', description: '负责岗位、人才档案、面试、Offer 和内部推荐。',
    level: 'L2', dataScope: 'business_unit', pages: ['home', 'positions', 'candidates', 'interviews', 'offers', 'referrals', 'points'],
    actions: ['create_demand', 'manage_positions', 'edit_candidate', 'advance_application', 'arrange_interview', 'manage_assessments', 'manage_offer', 'review_offer', 'manage_background', 'manage_employee_lifecycle', 'manage_referrals', 'manage_messages', 'review_candidate', 'submit_interview_feedback'], sensitiveFields: { salary: 'authorized' },
  },
  {
    code: 'business_manager', name: '业务助理', description: '负责岗位、人才档案、面试和内部推荐。',
    level: 'L2', dataScope: 'assigned_departments', pages: ['home', 'positions', 'candidates', 'interviews', 'referrals'],
    actions: ['create_demand', 'manage_positions', 'edit_candidate', 'advance_application', 'arrange_interview', 'manage_assessments', 'manage_referrals', 'manage_messages', 'review_candidate', 'submit_interview_feedback'], sensitiveFields: { salary: 'hidden' },
  },
  {
    code: 'department_leader', name: '部门负责人', description: '可查看员工档案所属部门组织范围内的招聘看板、岗位和招聘HR；页面及操作权限仍由管理员配置。',
    level: 'L2', dataScope: 'assigned_departments', pages: ['home', 'positions', 'candidates', 'interviews'],
    actions: [], sensitiveFields: { salary: 'hidden', contacts: 'hidden', resume: 'hidden' },
  },
  {
    code: 'interviewer', name: '面试官', description: '仅查看分配给本人的面试和候选人必要信息，并提交评价。',
    level: 'L2', dataScope: 'assigned_interviews', pages: ['home', 'interviews', 'referrals'],
    actions: ['view_assigned_candidate_summary', 'submit_interview_feedback', 'review_candidate'], sensitiveFields: { salary: 'hidden' },
  },
  {
    code: 'referrer', name: '普通员工', description: '仅使用内部推荐。',
    level: 'L1', dataScope: 'self', pages: ['referrals'], actions: ['view_referrals', 'create_referral_campaign', 'submit_referral', 'manage_referrals'],
    sensitiveFields: { salary: 'hidden' },
  },
]
