import { Body, Controller, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import { ReferralCampaignInput, RewardRuleInput } from './referral.types'
import { ReferralVisibility, ReferralsService } from './referrals.service'
import { RequestIdentity, RoleAccessProfile } from '../database/role-access.service'
import { DatabaseService } from '../database/database.service'
import { teable } from '../../platform/teable'

type ReferralRequest = Request & { recruitmentAccess?: { identity: RequestIdentity; profile: RoleAccessProfile } }

@Controller('api/referrals')
export class ReferralsController {
  constructor(private readonly service: ReferralsService, private readonly database: DatabaseService) {}

  private async scope(request: ReferralRequest): Promise<ReferralVisibility | undefined> {
    const actor = request.recruitmentAccess
    if (!actor) throw new UnauthorizedException('请先登录')
    if (actor.profile.actions.includes('*') || actor.profile.dataScopes.some(scope => ['all', 'business_unit', 'assigned_departments'].includes(scope.type))) return undefined
    const account = await teable.findOneByField(this.database.requireTableId('recruitment_users'), '用户ID', actor.identity.userId)
    if (!account || account.fields['用户状态'] !== '启用') throw new UnauthorizedException('员工账号未启用')
    return { userId: actor.identity.userId, name: String(account.fields['姓名'] || ''), mobile: String(account.fields['手机'] || '').replace(/\s|-/g, '') }
  }

  @Get() async list(@Req() request: ReferralRequest) { return this.service.list(await this.scope(request)) }
  @Get('positions') positions() { return this.service.publishedPositions() }
  @Get('campaigns') async campaigns(@Req() request: ReferralRequest) { return this.service.campaigns(await this.scope(request)) }
  @Post('campaigns') async campaign(@Req() request: ReferralRequest, @Body() body: ReferralCampaignInput) {
    const scope = await this.scope(request)
    const actor = request.recruitmentAccess!.identity
    return this.service.createCampaign({ ...body, ...(scope ? { referrerUserId: scope.userId, referrerName: scope.name, referrerMobile: scope.mobile } : {}), operator: actor.userName, operatorUserId: actor.userId })
  }
  @Get('reward-rules') rules() { return this.service.rules() }
  @Post('reward-rules') rule(@Body() body: RewardRuleInput) { return this.service.createRule(body) }
  @Get('analytics') async analytics(@Req() request: ReferralRequest) { return this.service.analytics(await this.scope(request)) }
  @Post(':id/validity') validity(@Param('id') id: string, @Body() body: any) { return this.service.decideValidity(id, body) }
  @Post(':id/evaluate-rewards') evaluate(@Param('id') id: string, @Body() body: any) { return this.service.evaluateRewards(id, body) }
  @Post('rewards/:id/pay') pay(@Param('id') id: string, @Body() body: any) { return this.service.payReward(id, body) }
}
