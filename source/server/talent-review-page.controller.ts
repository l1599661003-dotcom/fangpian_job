import { Controller, Get, Res } from '@nestjs/common'
import { join } from 'node:path'
import type { Response } from 'express'

/**
 * 企微内打开的评审页不能落到招聘后台 SPA 的首页兜底。
 * 使用不带扩展名的专用公开路由，稳定返回独立评审页面。
 */
@Controller()
export class TalentReviewPageController {
  @Get('talent-review')
  page(@Res() response: Response) {
    response.setHeader('Cache-Control', 'no-store')
    return response.sendFile(join(process.cwd(), 'dist', 'client', 'talent-review.html'))
  }
}
