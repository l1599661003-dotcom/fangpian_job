import { Injectable } from '@nestjs/common'
import { teable } from '../../platform/teable'
import type { TeableRecord } from '../../platform/teable'
import { DatabaseService } from '../database/database.service'

export const POINT_RULES = {
  core: { interview: 3, offer: 6, onboard: 9 },
  normal: { interview: 1, offer: 2, onboard: 3 },
} as const

type Milestone = keyof typeof POINT_RULES.core

interface PointEvent {
  referrerUserId: string
  referrerName: string
  referrerDepartment: string
  referralId: string
  applicationId: string
  candidateId: string
  candidateName: string
  positionId: string
  positionName: string
  positionDepartment: string
  category: 'core' | 'normal'
  milestone: Milestone
  points: number
  occurredAt: string
}

const text = (value: unknown) => String(value ?? '').trim()

@Injectable()
export class PointsService {
  constructor(private readonly database: DatabaseService) {}

  async ranking() {
    const [referrals, applications, positions, interviews, offers, onboardings] = await Promise.all([
      teable.listAllRecords(this.database.requireTableId('recruitment_referrals')),
      teable.listAllRecords(this.database.requireTableId('recruitment_applications')),
      teable.listAllRecords(this.database.requireTableId('recruitment_positions')),
      teable.listAllRecords(this.database.requireTableId('recruitment_interviews')),
      teable.listAllRecords(this.database.requireTableId('recruitment_offers')),
      teable.listAllRecords(this.database.requireTableId('recruitment_onboarding_cases')),
    ])
    const events = this.buildEvents({ referrals, applications, positions, interviews, offers, onboardings })
    const people = new Map<string, {
      userId: string
      name: string
      department: string
      points: number
      corePoints: number
      normalPoints: number
      interviews: number
      offers: number
      onboardings: number
      details: PointEvent[]
      rank: number
    }>()

    for (const event of events) {
      const key = event.referrerUserId || event.referrerName
      if (!key) continue
      const person = people.get(key) || {
        userId: event.referrerUserId,
        name: event.referrerName || '未知推荐人',
        department: event.referrerDepartment,
        points: 0,
        corePoints: 0,
        normalPoints: 0,
        interviews: 0,
        offers: 0,
        onboardings: 0,
        details: [],
        rank: 0,
      }
      person.department ||= event.referrerDepartment
      person.points += event.points
      if (event.category === 'core') person.corePoints += event.points
      else person.normalPoints += event.points
      if (event.milestone === 'interview') person.interviews += 1
      if (event.milestone === 'offer') person.offers += 1
      if (event.milestone === 'onboard') person.onboardings += 1
      person.details.push(event)
      people.set(key, person)
    }

    const ranking = [...people.values()]
      .sort((left, right) => right.points - left.points || left.name.localeCompare(right.name, 'zh-CN'))
      .map((person, index, rows) => {
        const previous = rows[index - 1]
        person.rank = previous && previous.points === person.points ? previous.rank : index + 1
        return { ...person, details: [...person.details].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)) }
      })

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        participants: ranking.length,
        totalPoints: ranking.reduce((sum, person) => sum + person.points, 0),
        interviews: ranking.reduce((sum, person) => sum + person.interviews, 0),
        offers: ranking.reduce((sum, person) => sum + person.offers, 0),
        onboardings: ranking.reduce((sum, person) => sum + person.onboardings, 0),
      },
      rules: [
        { category: '中高层岗位', interview: POINT_RULES.core.interview, offer: POINT_RULES.core.offer, onboard: POINT_RULES.core.onboard },
        { category: '普通岗位', interview: POINT_RULES.normal.interview, offer: POINT_RULES.normal.offer, onboard: POINT_RULES.normal.onboard },
      ],
      ranking,
    }
  }

  private buildEvents(input: {
    referrals: TeableRecord[]
    applications: TeableRecord[]
    positions: TeableRecord[]
    interviews: TeableRecord[]
    offers: TeableRecord[]
    onboardings: TeableRecord[]
  }) {
    const positionsById = new Map(input.positions.map((row) => [text(row.fields['职位ID']) || row.id, row]))
    const applicationsById = new Map(input.applications.map((row) => [text(row.fields['应聘记录ID']) || row.id, row]))
    const seen = new Set<string>()
    const events: PointEvent[] = []

    const sortedReferrals = [...input.referrals].sort((left, right) =>
      text(left.fields['推荐时间'] || left.fields['创建时间']).localeCompare(text(right.fields['推荐时间'] || right.fields['创建时间']))
    )

    for (const referral of sortedReferrals) {
      if (text(referral.fields['有效性结论']) === '无效') continue
      const candidateId = text(referral.fields['候选人ID'])
      const referralApplicationId = text(referral.fields['应聘记录ID'])
      const referralPositionId = text(referral.fields['职位ID'])
      const application = applicationsById.get(referralApplicationId)
        || input.applications.find((row) => text(row.fields['内推记录ID']) === text(referral.fields['内推记录ID']))
        || input.applications
          .filter((row) => text(row.fields['候选人ID']) === candidateId && (!referralPositionId || text(row.fields['职位ID']) === referralPositionId))
          .sort((left, right) => text(right.fields['更新时间'] || right.fields['创建时间']).localeCompare(text(left.fields['更新时间'] || left.fields['创建时间'])))[0]
      const applicationId = text(application?.fields['应聘记录ID']) || referralApplicationId
      const positionId = referralPositionId || text(application?.fields['职位ID'])
      const position = positionsById.get(positionId)
      const key = `${candidateId}|${positionId}`
      if (!candidateId || !positionId || seen.has(key)) continue

      const referrerUserId = text(referral.fields['推荐人用户ID'])
      const referrerName = text(referral.fields['推荐人']) || '未知推荐人'
      const positionOwnerIds = [position?.fields['负责人用户ID'], position?.fields['招聘HR用户ID'], position?.fields['备用招聘HR用户ID']].map(text).filter(Boolean)
      const positionOwnerNames = [position?.fields['负责人'], position?.fields['招聘HR'], position?.fields['备用招聘HR']].map(text).filter(Boolean)
      if ((referrerUserId && positionOwnerIds.includes(referrerUserId)) || (!referrerUserId && positionOwnerNames.includes(referrerName))) continue

      seen.add(key)
      const category = /中高层|核心/.test(text(position?.fields['岗位层级'])) ? 'core' : 'normal'
      const candidateName = text(referral.fields['候选人姓名快照']) || candidateId
      const positionName = text(position?.fields['职位名称']) || text(referral.fields['岗位名称']) || '岗位待补充'
      const positionDepartment = text(position?.fields['部门'])
      const base = {
        referrerUserId,
        referrerName,
        referrerDepartment: text(referral.fields['推荐人部门']),
        referralId: text(referral.fields['内推记录ID']) || referral.id,
        applicationId,
        candidateId,
        candidateName,
        positionId,
        positionName,
        positionDepartment,
        category,
      } as const

      const matchesFlow = (row: TeableRecord) => {
        const rowApplicationId = text(row.fields['应聘记录ID'])
        if (applicationId && rowApplicationId) return rowApplicationId === applicationId
        const rowPositionId = text(row.fields['职位ID'])
        return text(row.fields['候选人ID']) === candidateId && (!rowPositionId || !positionId || rowPositionId === positionId)
      }

      const milestones: Array<{ milestone: Milestone; occurredAt: string }> = []
      const interview = input.interviews.find(row => matchesFlow(row) && text(row.fields['面试状态']) !== '已取消')
      if (interview) milestones.push({ milestone: 'interview', occurredAt: text(interview.fields['开始时间'] || interview.fields['创建时间']) })

      const offer = input.offers.find(row => matchesFlow(row) && (
        Boolean(text(row.fields['发送时间']))
        || ['已发送', '候选人已答复'].includes(text(row.fields['发送状态']))
      ))
      if (offer) milestones.push({ milestone: 'offer', occurredAt: text(offer.fields['发送时间'] || offer.fields['创建时间']) })

      const onboarding = input.onboardings.find(row => matchesFlow(row) && text(row.fields['实际到岗日期']))
      if (onboarding) milestones.push({ milestone: 'onboard', occurredAt: text(onboarding.fields['实际到岗日期']) })

      for (const item of milestones) {
        events.push({
          ...base,
          milestone: item.milestone,
          points: POINT_RULES[category][item.milestone],
          occurredAt: item.occurredAt || text(referral.fields['推荐时间'] || referral.fields['创建时间']),
        })
      }
    }
    return events
  }
}
