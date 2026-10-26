export interface ResumeRecord {
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
  rawText: string
  qualityWarnings?: string[]
  editableWordFileName?: string
  editableWordUrl?: string
  wordConversionStatus?: string
  wordConversionError?: string
  wordConversionVersion?: number
  wordConvertedBy?: string
  wordConvertedAt?: string
  reviewStatus?: string
  correctionSummary?: string
  fingerprint?: string
  createdTime?: string
  candidateId?: string
  applicationId?: string
  duplicate?: boolean
  analysis?: unknown
  matches?: unknown[]
}

export type ResumeExtraction = Omit<ResumeRecord, 'id' | 'sourceFileName' | 'sourceFileUrl' | 'rawText' | 'fingerprint' | 'createdTime'>

export interface ResumeImportContext {
  operator?: string
  operatorUserId?: string
  suppressGroupPush?: boolean
  deferAiAnalysis?: boolean
}

export interface ResumeAnalysisStartItem {
  candidateId: string
  resumeId: string
  positionId?: string
}

export interface ResumeAnalysisStartInput {
  items?: ResumeAnalysisStartItem[]
}

export interface ResumeReviewInput {
  fields: Partial<Pick<ResumeRecord, 'name' | 'gender' | 'age' | 'phone' | 'email' | 'wechat' | 'address' | 'selfEvaluation' | 'skillsCertificates' | 'educationBackground' | 'workExperience' | 'jobIntention' | 'yearsOfExperience' | 'currentCompany' | 'currentRole'>>
  reason: string
  operator?: string
  operatorUserId?: string
}
