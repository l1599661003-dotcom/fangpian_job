import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common'
import { RoleAccessService } from '../database/role-access.service'
import { RecruitmentService } from '../recruitment/recruitment.service'
import { AssessmentInviteInput, AssessmentReviewInput, AssessmentTemplateInput, QuestionInput } from './assessment.types'
import { AssessmentsService } from './assessments.service'

@Controller('api/assessments')
export class AssessmentsController {
  constructor(
    private readonly assessments: AssessmentsService,
    private readonly recruitment: RecruitmentService,
    private readonly access: RoleAccessService,
  ) {}

  @Get('questions')
  async questions(@Headers() headers: Record<string, string | string[] | undefined>, @Query() query: { category?: string; type?: string; position?: string; status?: string }) {
    const actor = await this.access.getRequestAccess(headers)
    if (!actor) throw new UnauthorizedException('请先登录')
    const { positions } = await this.recruitment.positionOptions(actor.profile)
    return this.assessments.listQuestions(query, { userId: actor.identity.userId, positionIds: positions.map(position => position.id) })
  }

  @Post('questions')
  createQuestion(@Body() body: QuestionInput) { return this.assessments.createQuestion(body) }

  @Patch('questions/:questionId')
  async updateQuestion(@Headers() headers: Record<string, string | string[] | undefined>, @Param('questionId') questionId: string, @Body() body: Partial<QuestionInput>) {
    const actor = await this.access.getRequestAccess(headers)
    if (!actor) throw new UnauthorizedException('请先登录')
    const { positions } = await this.recruitment.positionOptions(actor.profile)
    return this.assessments.updateQuestion(questionId, { ...body, operatorUserId: actor.identity.userId, operator: actor.identity.userName }, positions.map(position => position.id))
  }

  @Get('templates')
  templates(@Query() query: { status?: string; position?: string }) { return this.assessments.listTemplates(query) }

  @Post('templates')
  async createTemplate(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: AssessmentTemplateInput) {
    const actor = await this.access.getRequestAccess(headers)
    if (!actor) throw new UnauthorizedException('创建岗位题单必须启用可信登录身份')
    const { position } = await this.recruitment.assertPositionAccess(body.positionId || '', actor.profile)
    return this.assessments.createTemplate({
      ...body,
      positionId: position.id,
      position: position.name,
      operator: actor.identity.userName,
      operatorUserId: actor.identity.userId,
    })
  }

  @Post('templates/generate-draft')
  @HttpCode(202)
  async generateDraft(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: { candidateId: string; positionId?: string; count?: number; operator?: string; operatorUserId?: string }) {
    const actor = await this.access.getRequestAccess(headers)
    if (!actor) throw new UnauthorizedException('生成岗位题单必须启用可信登录身份')
    if (body.positionId) await this.recruitment.assertPositionAccess(body.positionId, actor.profile)
    return this.assessments.generateDraft({ ...body, operator: actor.identity.userName, operatorUserId: actor.identity.userId })
  }

  @Post('templates/:templateId/publish')
  publish(@Param('templateId') templateId: string, @Body() body: { operator?: string; operatorUserId?: string }) { return this.assessments.publishTemplate(templateId, body) }

  @Post('invites')
  createInvite(@Body() body: AssessmentInviteInput) { return this.assessments.createInvite(body) }

  @Get('candidates/:candidateId/context')
  candidateContext(@Param('candidateId') candidateId: string) { return this.assessments.candidateAssessmentContext(candidateId) }

  @Get('submissions')
  submissions(@Query() query: { status?: string; candidateId?: string }) { return this.assessments.listSubmissions(query) }

  @Get('submissions/:inviteId')
  submission(@Param('inviteId') inviteId: string) { return this.assessments.submissionDetail(inviteId) }

  @Post('submissions/:inviteId/review')
  review(@Param('inviteId') inviteId: string, @Body() body: AssessmentReviewInput) { return this.assessments.reviewSubmission(inviteId, body) }
}
