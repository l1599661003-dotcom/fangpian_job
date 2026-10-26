import { Controller, ForbiddenException, Get, Headers, UnauthorizedException } from '@nestjs/common'
import { RoleAccessService } from '../database/role-access.service'
import { PointsService } from './points.service'

const POINTS_ROLE_CODES = new Set(['system_admin', 'hrbp', 'recruiter'])

@Controller('api/points')
export class PointsController {
  constructor(private readonly service: PointsService, private readonly access: RoleAccessService) {}

  @Get('ranking')
  async ranking(@Headers() headers: Record<string, string | string[] | undefined>) {
    const actor = await this.access.getRequestAccess(headers)
    if (!actor) throw new UnauthorizedException('积分排行必须启用可信登录身份')
    this.access.assertPage(actor.profile, 'points')
    if (!actor.profile.roleCodes.some((code) => POINTS_ROLE_CODES.has(code))) {
      throw new ForbiddenException('积分排行仅限招聘专员和HRBP查看')
    }
    return this.service.ranking()
  }
}
