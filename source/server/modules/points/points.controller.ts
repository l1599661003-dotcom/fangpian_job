import { Body, Controller, ForbiddenException, Get, Headers, Post, UnauthorizedException } from '@nestjs/common'
import { RoleAccessService } from '../database/role-access.service'
import { PointsService } from './points.service'

const POINTS_ROLE_CODES = new Set(['system_admin', 'hrbp', 'recruiter'])

@Controller('api/points')
export class PointsController {
  constructor(private readonly service: PointsService, private readonly access: RoleAccessService) {}

  @Get('ranking')
  async ranking(@Headers() headers: Record<string, string | string[] | undefined>) {
    const actor = await this.requireActor(headers)
    const ranking = await this.service.ranking()
    return { ...ranking, canManageRoster: actor.profile.roleCodes.includes('system_admin') }
  }

  @Post('roster')
  async updateRoster(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: { userId?: string; action?: 'add' | 'remove'; reason?: string },
  ) {
    const actor = await this.requireActor(headers)
    if (!actor.profile.roleCodes.includes('system_admin')) throw new ForbiddenException('只有管理员可以调整积分排名人员')
    const ranking = await this.service.updateRoster({
      userId: body.userId || '',
      action: body.action === 'remove' ? 'remove' : 'add',
      operatorUserId: actor.identity.userId,
      operator: actor.identity.userName,
      reason: body.reason,
    })
    return { ...ranking, canManageRoster: true }
  }

  private async requireActor(headers: Record<string, string | string[] | undefined>) {
    const actor = await this.access.getRequestAccess(headers)
    if (!actor) throw new UnauthorizedException('积分排行必须启用可信登录身份')
    this.access.assertPage(actor.profile, 'points')
    if (!actor.profile.roleCodes.some((code) => POINTS_ROLE_CODES.has(code))) {
      throw new ForbiddenException('积分排行仅限招聘专员和HRBP查看')
    }
    return actor
  }
}
