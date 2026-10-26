import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common'
import { RoleAccessService } from '../database/role-access.service'
import { RecruitmentService } from '../recruitment/recruitment.service'
import { OfferApprovalInput, OfferInput, OfferNegotiationInput, OfferTemplateCreateInput, OfferTemplateUpdateInput } from './offer.types'
import { OffersService } from './offers.service'

@Controller('api/offers')
export class OffersController {
  constructor(
    private readonly offers: OffersService,
    private readonly recruitment: RecruitmentService,
    private readonly access: RoleAccessService,
  ) {}

  @Get()
  list(@Query() query: { status?: string; candidateId?: string }) { return this.offers.list(query) }

  @Get('templates')
  templates() { return this.offers.templates() }

  @Post('templates')
  createTemplate(@Body() body: OfferTemplateCreateInput) { return this.offers.createTemplate(body) }

  @Post('interview-context')
  interviewContext(@Body() body: { interviewId: string; candidateId?: string; applicationId?: string; positionId?: string }) {
    return this.offers.interviewOfferContext(body)
  }

  @Patch('templates/:id')
  updateTemplate(@Param('id') id: string, @Body() body: OfferTemplateUpdateInput) { return this.offers.updateTemplate(id, body) }

  @Patch(':id')
  async update(@Headers() headers: Record<string, string | string[] | undefined>, @Param('id') id: string, @Body() body: OfferInput) {
    const actor = await this.access.getRequestAccess(headers)
    if (!actor) throw new UnauthorizedException('修改Offer必须启用可信登录身份')
    const position = body.positionId ? (await this.recruitment.assertPositionAccess(body.positionId, actor.profile)).position : undefined
    return this.offers.update(id, {
      ...body,
      ...(position ? { positionId: position.id, role: position.name, department: position.department } : {}),
      operator: actor.identity.userName,
      operatorUserId: actor.identity.userId,
    })
  }

  @Post()
  async create(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: OfferInput) {
    const actor = await this.access.getRequestAccess(headers)
    if (!actor) throw new UnauthorizedException('创建Offer必须启用可信登录身份')
    if (body.interviewId) {
      const context = await this.offers.interviewOfferContext({
        interviewId: body.interviewId,
        candidateId: body.candidateId,
        applicationId: body.applicationId,
        positionId: body.positionId,
      })
      return this.offers.create({
        ...body,
        candidateId: context.candidate.id,
        applicationId: context.applicationId,
        positionId: context.position.id,
        role: context.position.name,
        department: context.position.department,
        location: body.location || context.position.location,
        operator: actor.identity.userName,
        operatorUserId: actor.identity.userId,
      })
    }
    const { position } = await this.recruitment.assertPositionAccess(body.positionId || '', actor.profile)
    return this.offers.create({
      ...body,
      positionId: position.id,
      role: position.name,
      department: position.department,
      location: body.location || position.location,
      operator: actor.identity.userName,
      operatorUserId: actor.identity.userId,
    })
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @Body() body: { operator?: string }) { return this.offers.submit(id, body) }

  @Post(':id/approval')
  approve(@Param('id') id: string, @Body() body: OfferApprovalInput) { return this.offers.approve(id, body) }

  @Post(':id/generate-file')
  file(@Param('id') id: string, @Body() body: { operator?: string }) { return this.offers.generateFile(id, body) }

  @Post(':id/send-email')
  email(@Param('id') id: string, @Body() body: { recipient?: string; expiresHours?: number; note?: string; operator?: string; operatorUserId?: string }) { return this.offers.sendEmail(id, body) }

  @Post(':id/response-link')
  link(@Param('id') id: string, @Body() body: any) { return this.offers.createResponseLink(id, body) }

  @Post(':id/negotiate')
  negotiate(@Param('id') id: string, @Body() body: OfferNegotiationInput) { return this.offers.negotiate(id, body) }
}
