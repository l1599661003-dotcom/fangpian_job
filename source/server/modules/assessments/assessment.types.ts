export type AssessmentQuestionType = 'text' | 'single' | 'multiple' | 'file'

export interface QuestionInput {
  category: string
  type: AssessmentQuestionType
  title: string
  description?: string
  options?: string[]
  referenceAnswer?: string
  scoringRules?: Record<string, unknown>
  score?: number
  required?: boolean
  position?: string
  source?: string
  status?: string
  operator?: string
  operatorUserId?: string
}

export interface AssessmentTemplateInput {
  name: string
  category: string
  positionId?: string
  position?: string
  instructions?: string
  durationMinutes?: number
  questionIds: string[]
  operator?: string
  operatorUserId?: string
}

export interface AssessmentInviteInput {
  candidateId: string
  templateId: string
  applicationId?: string
  expiresHours?: number
  operator?: string
  operatorUserId?: string
}

export interface AssessmentReviewInput {
  finalScore: number
  conclusion: '通过' | '不通过' | '待复核' | '进入面试' | '储备'
  comment: string
  questionScores?: Record<string, { score: number; comment?: string }>
  operator?: string
  operatorUserId?: string
}
