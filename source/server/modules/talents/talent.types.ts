export interface TalentScoreEvidence {
  business: string
  management: string
  logic: string
  communication: string
}

export interface TalentAnalysis {
  summary: string
  strengths: string[]
  risks: string[]
  skills: string[]
  recommendedRoles: string[]
  scores: {
    business: number
    management: number
    logic: number
    communication: number
    overall: number
  }
  evidence: TalentScoreEvidence
  confidence: '高' | '中' | '低'
  scoreDimensions?: {
    education: number
    experience: number
    skillMatch: number
    industryMatch: number
    stability: number
  }
  authenticityRisk?: '低' | '中' | '较高' | '高'
}

export interface ResumeTalentInput {
  id: string
  name: string
  gender: string
  age: number | null
  phone: string
  email: string
  wechat: string
  address: string
  selfEvaluation: string
  skillsCertificates: string
  educationBackground: string
  workExperience: string
  jobIntention: string
  yearsOfExperience: string
  currentCompany: string
  currentRole: string
  sourceFileName: string
  sourceFileUrl: string
  avatarUrl?: string
  avatarStatus?: string
  sourceType?: string
  suppressGroupPush?: boolean
  deferAiAnalysis?: boolean
  importedById?: string
  importedBy?: string
  rawText: string
  fingerprint?: string
  createdTime?: string
}

export interface TalentMergeInput {
  primaryCandidateId: string
  fieldSources?: Record<string, 'primary' | 'secondary'>
  reason: string
  operator?: string
}

export interface TalentOwnershipInput {
  owner: string
  ownerUserId?: string
  reason: string
  operator?: string
}

export interface TalentBirthYearInput {
  birthYear: number
  reason: string
  operator?: string
  operatorUserId?: string
}

export interface TalentNameInput {
  name: string
  operator?: string
  operatorUserId?: string
}

export interface TalentAnalysisRerunInput {
  reason: string
  operator?: string
  operatorUserId?: string
}

export interface TalentAnalysisCorrectionInput {
  reason: string
  summary?: string
  skills?: string[]
  recommendedRoles?: string[]
  strengths?: string[]
  risks?: string[]
  scores?: Partial<TalentAnalysis['scores']>
  operator?: string
  operatorUserId?: string
}

export interface TalentMatchCorrectionInput {
  reason: string
  positionId?: string
  positionName?: string
  operator?: string
  operatorUserId?: string
}

export interface PositionRematchInput {
  reason: string
  candidateIds?: string[]
  operator?: string
  operatorUserId?: string
}

export interface TalentBatchInput {
  candidateIds: string[]
  action: 'assign_owner' | 'add_tag'
  owner?: string
  ownerUserId?: string
  tag?: string
  tagCategory?: string
  reason: string
  operator?: string
}

export interface TalentContactLockInput {
  operator: string
  operatorUserId?: string
  durationMinutes?: number
}

export interface TalentArchiveDeleteInput {
  decision: '删除'
  reason: string
  operator?: string
  operatorUserId?: string
}

export interface TalentReviewInput {
  decision: '通过' | '退回' | '淘汰' | '储备'
  opinion: string
  evidence?: string[]
  riskFeedback?: Record<string, string>
  operator?: string
  operatorUserId?: string
}

export interface TalentCommunicationInput {
  type: string
  channel: '电话' | '微信' | '邮件' | '短信' | '当面' | '其他'
  direction?: '呼出' | '呼入' | '双向'
  summary: string
  result: string
  nextAction?: string
  nextFollowUpAt?: string
  wechat?: string
  templateId?: string
  rejectionReason?: string
  recontactAt?: string
  operator?: string
  operatorUserId?: string
  answerStatus?: string
  interestLevel?: string
  jobStatus?: string
  entryTime?: string
  leaveReason?: string
  leaveReasonDetail?: string
  maritalStatus?: string
  homeAddress?: string
  workContent?: string
  currentSalaryInfo?: string
  candidateConcerns?: string
  overtimeIntensity?: string
  overtimeAttitude?: string
  interviewType?: string
  interviewTime?: string
  notes?: string
}

export interface CommunicationTranscriptExtraction {
  channel?: TalentCommunicationInput['channel'] | ''
  answerStatus?: string
  interestLevel?: string
  jobStatus?: string
  entryTime?: string
  leaveReason?: string
  leaveReasonDetail?: string
  maritalStatus?: string
  homeAddress?: string
  workContent?: string
  currentSalaryInfo?: string
  candidateConcerns?: string
  overtimeIntensity?: string
  overtimeAttitude?: string
  interviewType?: string
  interviewTime?: string
  result?: string
  rejectionReason?: string
  notes?: string
}

export interface TalentWecomShareInput {
  expiresInDays?: number
  operator?: string
  operatorUserId?: string
  applicationId?: string
  assessmentId?: string
  webhookKey?: string
  sendMode?: 'group' | 'direct' | 'both'
  directUserIds?: string[]
  sendMessage?: boolean
  forceSend?: boolean
}

export interface TalentPublicReviewInput {
  decision: '合适' | '不合适' | '推荐其他部门' | '适合' | '不适合' | '其他'
  departmentId?: string
  department?: string
  positionId?: string
  position?: string
  targetPositionId?: string
  reviewer?: string
  reviewerUserId?: string
  comment?: string
  availableSlots?: string[]
}

export interface TalentReviewViewer {
  userId: string
  name: string
  departmentIds: string[]
  departments: string[]
  canViewAllPositions?: boolean
}

export interface CommunicationTemplateInput {
  name: string
  category: string
  position?: string
  channel?: string
  content: string
  variables?: string[]
  status?: string
  operator?: string
  operatorUserId?: string
}
