import { Controller, Get, Headers, Query, Req, Res, UnauthorizedException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { RoleAccessService } from '../database/role-access.service'
import { AnalyticsService } from './analytics.service'
import { AnalyticsQuery } from './analytics.types'

@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService, private readonly access: RoleAccessService) {}
  @Get('dashboard') async dashboard(@Query() query: AnalyticsQuery, @Headers() headers: Record<string, string | string[] | undefined>) { const resolved = await this.access.getRequestAccess(headers); if (resolved) this.access.assertPage(resolved.profile, 'analytics'); return this.service.dashboard(query, resolved?.profile) }
  @Get('definitions') definitions() { return this.service.definitionsResponse() }
  @Get('drilldown') async drilldown(@Query('metric') metric: string, @Query() query: any, @Headers() headers: Record<string, string | string[] | undefined>) { const resolved = await this.access.getRequestAccess(headers); if (resolved) this.access.assertPage(resolved.profile, 'analytics'); return this.service.drilldown(metric, query, Number(query.page) || 1, Number(query.pageSize) || 50, resolved?.profile) }
  @Get('export')
  async export(@Query('metric') metric: string, @Query() query: AnalyticsQuery, @Headers() headers: Record<string, string | string[] | undefined>, @Req() request: Request, @Res() response: Response) {
    const resolved = await this.access.getRequestAccess(headers)
    if (!resolved) throw new UnauthorizedException('报表导出必须使用可信登录身份')
    this.access.assertPage(resolved.profile, 'analytics')
    this.access.assertAction(resolved.profile, 'export_authorized_data')
    const requestId = String(headers['x-request-id'] || randomUUID()), clientIp = request.ip || request.socket.remoteAddress || ''
    const result = await this.service.export(metric, query, resolved.profile, resolved.identity.userName, requestId, clientIp)
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`)
    response.setHeader('X-Export-Watermark', encodeURIComponent(result.watermark))
    response.send(result.content)
  }
}
