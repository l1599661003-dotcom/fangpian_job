import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { RoleAccessService } from '../database/role-access.service'
import { TalentsService } from '../talents/talents.service'
import { GovernanceService } from './governance.service'
import { RatingInput, TransitionInput } from './governance.types'

@Controller('api/governance')
export class GovernanceController {
  constructor(private readonly service: GovernanceService, private readonly access: RoleAccessService, private readonly talents: TalentsService) {}
  @Get('stage-rules') rules() { return this.service.rules() }
  @Get('talents/:id/allowed-transitions') allowed(@Param('id') id: string) { return this.service.allowed(id) }
  @Post('talents/:id/transition') transition(@Param('id') id: string, @Body() body: TransitionInput) { return this.service.transition(id, body) }
  @Post('sla/scan') sla(@Body() body: any) { return this.service.scanSla(body) }
  @Get('tasks') tasks(@Query() query: any) { return this.service.tasks(query) }
  @Post('tasks/:id/action') task(@Param('id') id: string, @Body() body: any) { return this.service.taskAction(id, body) }
  @Post('talents/:id/rating') rate(@Param('id') id: string, @Body() body: RatingInput) { return this.service.rate(id, body) }
  @Get('talents/:id/rating-history') ratings(@Param('id') id: string) { return this.service.ratingHistory(id) }
  @Get('talents/:id/timeline') timeline(@Param('id') id: string) { return this.service.timeline(id) }
  @Get('audits') audits(@Query() query: any) { return this.service.audits(query) }
  @Get('talents/:id/export')
  async export(@Param('id') candidateId: string, @Headers() headers: Record<string, string | string[] | undefined>, @Req() request: Request, @Res() response: Response) {
    const resolved = await this.access.getRequestAccess(headers)
    if (!resolved) throw new UnauthorizedException('人才历史导出必须使用可信登录身份')
    this.access.assertPage(resolved.profile, 'candidates')
    this.access.assertAction(resolved.profile, 'export_authorized_data')
    await this.talents.detail(candidateId, resolved.profile)
    const requestId = String(headers['x-request-id'] || randomUUID()), clientIp = request.ip || request.socket.remoteAddress || ''
    const result = await this.service.exportHistory(candidateId, resolved.profile, resolved.identity.userName, requestId, clientIp)
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`)
    response.setHeader('X-Export-Watermark', encodeURIComponent(result.watermark))
    response.send(result.content)
  }
}
