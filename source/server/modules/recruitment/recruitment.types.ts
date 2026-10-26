export interface MonthlyDemandInput {
  month: string
  positionId: string
  headcount: number
  demandType?: string
  priority?: string
  expectedArrivalDate?: string
  latestArrivalDate?: string
  note?: string
  demandRequirement?: string
  operator?: string
}

export interface MonthlyDemandTranscriptExtraction {
  month: string
  positionId: string
  positionName: string
  headcount: number | null
  demandType: string
  priority: string
  expectedArrivalDate: string
  latestArrivalDate: string
  note: string
  matchedPosition: boolean
}

export interface PositionInput {
  name: string
  code?: string
  departmentId?: string
  department?: string
  owner?: string
  ownerUserId?: string
  recruiter?: string
  recruiterUserId?: string
  backupRecruiter?: string
  backupRecruiterUserId?: string
  currentEmployeeCount?: number
  category?: string
  level?: string
  city?: string
  location?: string
  headcount?: number
  minSalary?: number
  maxSalary?: number
  salaryText?: string
  jobDescription?: string
  responsibilities?: string
  requirements?: string
  benefits?: string
  tags?: string[]
  changeReason?: string
  // merged demand fields
  demandType?: string
  employmentType?: string
  priority?: string
  expectedArrivalDate?: string
  latestArrivalDate?: string
  approvalStatus?: string
  recruitmentStatus?: string
  sourceType?: string
  sourceId?: string
  description?: string
}

export interface PositionChannelBindingInput {
  channelIds: string[]
  frequency?: string
  targetCount?: number
  filters?: Record<string, unknown>
  operator?: string
}

export interface CollectionTaskInput {
  platforms?: string[]
  targetCount?: number
  filters?: Record<string, unknown>
  operator?: string
}

export interface CollectionTaskProgressInput {
  collectedCount?: number
  importedCount?: number
  result?: Record<string, unknown>
  error?: string
  externalTaskId?: string
  operator?: string
}

export interface RecruitmentChannelInput {
  name: string
  type?: string
  status?: string
  owner?: string
  ownerUserId?: string
  frequency?: string
  targetCount?: number
  config?: Record<string, unknown>
  description?: string
  operator?: string
}
