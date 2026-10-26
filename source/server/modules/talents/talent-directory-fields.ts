export const TALENT_DIRECTORY_FIELDS: Record<string, string[]> = {
  recruitment_candidates: [
    '候选人ID', '姓名', '性别', '出生年份', '年龄', '出生年份来源', '出生年份确认状态',
    '电话', '邮箱', '微信', '当前城市', '教育经历', '工作经历', '自我评价', '工作年限',
    '当前公司', '当前职位', '期望职位', '技能JSON', '候选人状态', '天玑人事状态', '天玑入职日期', '天玑离职日期',
    '人才池', '负责人', '负责人用户ID', '来源类型', '重复检查状态', '合并状态', '合并至候选人ID',
    '创建人用户ID', '创建人',
    '合并事件ID', '疑似重复候选人JSON', '联系锁定状态', '锁定人用户ID', '锁定人', '锁定到期时间',
    '创建时间', '更新时间', '最新简历记录ID', '当前简历文件名', '当前简历地址', '头像地址', '头像提取状态',
  ],
  recruitment_applications: ['候选人ID', '职位ID', '负责人用户ID', '当前阶段', 'AI匹配分', '创建时间', '更新时间'],
  recruitment_ai_assessments: [
    '候选人ID', '分析记录ID', '版本号', '创建时间', '人工修正JSON', '人才摘要', '优势JSON',
    '业务能力分', '管理能力分', '逻辑能力分', '沟通协作分', '综合建议分', '置信度', '人工确认状态',
  ],
  recruitment_job_matches: [
    '候选人ID', '匹配状态', '分析记录ID', '匹配记录ID', '职位ID', '职位名称', '匹配总分',
    '技能匹配分', '经验匹配分', '管理匹配分', '业务匹配分', '推荐理由', '差距与待确认项', '置信度', '人工确认状态',
    '修正前岗位ID', '修正前岗位', '人工修正原因', '人工修正人用户ID', '人工修正人', '人工修正时间',
  ],
  recruitment_candidate_tags: ['候选人ID', '标签状态', '标签分类', '标签名称', '标签来源', '置信度', '人工确认状态'],
  recruitment_interviews: ['候选人ID', '面试官用户IDJSON'],
  recruitment_positions: ['职位ID', '部门ID'],
  recruitment_users: ['手机', '天玑人事状态'],
  recruitment_referrals: ['候选人ID', '推荐人用户ID', '推荐人', '推荐人部门', '推荐时间', '创建时间'],
  resume_extraction_records: ['候选人ID', '工作经历', '源文件名', '源文件地址', '创建时间', '更新时间'],
}

export const TALENT_DIRECTORY_FILTER_FIELDS: Record<string, string[]> = {
  recruitment_applications: ['候选人ID', '职位ID', '负责人用户ID', '当前阶段', 'AI匹配分', '创建时间', '更新时间'],
  recruitment_ai_assessments: ['候选人ID', '分析记录ID', '版本号', '创建时间', '人工确认状态'],
  recruitment_job_matches: ['候选人ID', '匹配状态', '分析记录ID', '职位ID', '职位名称', '匹配总分'],
  recruitment_positions: ['职位ID', '部门ID'],
  recruitment_candidate_tags: ['候选人ID', '标签状态', '标签分类', '标签名称'],
  recruitment_referrals: ['候选人ID', '推荐人用户ID', '推荐人', '推荐时间', '创建时间'],
}
