export interface BackgroundCheckInput {
  candidateId: string
  applicationId?: string
  offerId?: string
  scopes?: string[]
  provider?: string
  operator?: string
  operatorUserId?: string
}

export interface BackgroundAuthorizationInput {
  status: '已授权' | '拒绝授权' | '已撤回'
  method: string
  authorizedAt?: string
  fileUrl?: string
  note?: string
  operator?: string
  operatorUserId?: string
}

export interface BackgroundContactInput {
  name: string
  relationship: string
  company?: string
  role?: string
  phone?: string
  email?: string
  status?: string
  note?: string
  operator?: string
}

export interface BackgroundVerificationInput {
  type: string
  company?: string
  role?: string
  declaredStart?: string
  declaredEnd?: string
  verifiedStart?: string
  verifiedEnd?: string
  declaration?: string
  result: string
  leavingReason?: string
  performance?: string
  managementPerformance?: string
  consistency: '一致' | '部分一致' | '不一致' | '待确认'
  evidenceSource: string
  verifier?: string
}

export interface BackgroundRiskInput {
  type: string
  level: '低' | '中' | '高' | '严重'
  title: string
  description: string
  evidenceSummary: string
  attachments?: Array<{ name: string; url: string; contentType?: string }>
  operator?: string
}

export interface BackgroundConclusionInput {
  conclusion: '通过' | '有条件通过' | '异常待决策' | '终止录用'
  opinion: string
  operator?: string
  operatorUserId?: string
}
