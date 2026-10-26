import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common'
import { RoleAccessService } from '../database/role-access.service'
import { RecruitmentService } from '../recruitment/recruitment.service'
import { jobs } from '../../platform/jobs'
import { BankQuestionInput, QuestionBankService } from './question-bank.service'

@Controller('api/assessments/bank')
export class QuestionBankController {
  constructor(private readonly bank: QuestionBankService, private readonly recruitment: RecruitmentService, private readonly access: RoleAccessService) {}
  private async actor(headers: Record<string, string | string[] | undefined>) {
    const actor = await this.access.getRequestAccess(headers)
    if (!actor) throw new UnauthorizedException('请先登录')
    return actor
  }
  @Get()
  async list(@Headers() headers: Record<string, string | string[] | undefined>, @Query() query: { positionId?: string; scope?: string; status?: string }) {
    const actor = await this.actor(headers), { positions } = await this.recruitment.positionOptions(actor.profile)
    return this.bank.list(positions, actor.identity.userId, query)
  }
  @Post('import')
  @HttpCode(202)
  async import(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: { positionId: string; scope?: string; questions: BankQuestionInput[] }) {
    const actor = await this.actor(headers), { position } = await this.recruitment.assertPositionAccess(body.positionId, actor.profile)
    const jobId = jobs.start(async progress => { progress('正在校验、去重并保存题目'); return this.bank.import(position, actor.identity.userId, actor.identity.userName, body) })
    return { jobId, status: 'running' }
  }
  @Patch(':id')
  async update(@Headers() headers: Record<string, string | string[] | undefined>, @Param('id') id: string, @Body() body: { status?: string; title?: string; referenceAnswer?: string }) {
    const actor = await this.actor(headers), { positions } = await this.recruitment.positionOptions(actor.profile)
    return this.bank.update(id, positions, actor.identity.userId, body)
  }
}
