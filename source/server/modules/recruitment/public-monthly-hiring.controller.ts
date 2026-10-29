import { Controller, Get, Headers, Query, UnauthorizedException } from '@nestjs/common'
import { ResumeApiKeyService } from '../resumes/resume-api-key.service'
import { RecruitmentService } from './recruitment.service'

@Controller('api/public/recruitment')
export class PublicMonthlyHiringController {
  constructor(private readonly recruitment: RecruitmentService, private readonly apiKeys: ResumeApiKeyService) {}

  @Get('monthly-hiring')
  async monthlyHiring(@Headers('x-api-key') key: string | undefined, @Query('month') month: string, @Query('period') period?: string) {
    if (!await this.apiKeys.validate(key)) throw new UnauthorizedException('X-API-Key 缺失、错误或已被轮换')
    const hiring = await this.recruitment.monthlyHiring(month, undefined, period)
    return {
      month: hiring.month,
      period: hiring.period,
      generatedAt: hiring.generatedAt,
      keyValidity: '长期有效，直到主动轮换密钥',
      summary: hiring.summary,
      departments: hiring.departments.map((row) => ({
        positionId: row.positionId,
        department: row.department,
        role: row.role,
        demand: row.demand,
        completed: row.completed,
        remaining: row.remaining,
        completionRate: row.completionRate,
        completedAll: row.completedAll,
        status: row.status,
        priority: row.priority,
        expectedArrivalDate: row.expectedArrivalDate,
        latestArrivalDate: row.latestArrivalDate,
        recruiter: row.recruiter,
        backupRecruiter: row.backupRecruiter,
      })),
    }
  }
}
