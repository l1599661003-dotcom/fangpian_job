import { Body, Controller, Delete, ForbiddenException, Get, Headers, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common'
import { TalentsService } from './talents.service'
import { CommunicationTemplateInput, CommunicationTranscriptExtraction, PositionRematchInput, TalentAnalysisCorrectionInput, TalentAnalysisRerunInput, TalentArchiveDeleteInput, TalentBatchInput, TalentBirthYearInput, TalentCommunicationInput, TalentContactLockInput, TalentMatchCorrectionInput, TalentMergeInput, TalentNameInput, TalentOwnershipInput, TalentPublicReviewInput, TalentReviewInput, TalentReviewViewer, TalentWecomShareInput } from './talent.types'
import { RoleAccessService } from '../database/role-access.service'
import { AccessAdminService } from '../database/access-admin.service'
import { jobs } from '../../platform/jobs'
import { appendFile } from 'node:fs/promises'

@Controller('api/talents')
export class TalentsController {
  constructor(private readonly talents: TalentsService, private readonly access: RoleAccessService) {}

  @Get()
  async list(@Query() query: { q?: string; job?: string; status?: string; source?: string; tag?: string; importer?: string; minScore?: string; age?: string; region?: string; score?: string; page?: string; pageSize?: string }, @Headers() headers: Record<string, string | string[] | undefined>) {
    const requestAccess = await this.access.getRequestAccess(headers)
    if (requestAccess) this.access.assertPage(requestAccess.profile, 'candidates')
    try { return await this.talents.list(query, requestAccess?.profile) } catch (error: any) { const stack = error?.stack || String(error); await appendFile('/tmp/talents-error.log', `${new Date().toISOString()}\nquery=${JSON.stringify(query)}\n${stack}\n\n`).catch(() => undefined); console.error('[TalentsListError]', stack); throw error }
  }

  @Post('avatars/backfill')
  async backfillStoredAvatars(@Headers() headers: Record<string, string | string[] | undefined>) {
    const requestAccess = await this.access.getRequestAccess(headers)
    if (requestAccess) this.access.assertPage(requestAccess.profile, 'candidates')
    const jobId = jobs.start((progress) => this.talents.backfillStoredAvatars(progress))
    return { jobId }
  }

  @Get('duplicates')
  duplicates(@Query() query: { status?: string }) { return this.talents.listDuplicateCases(query.status) }

  @Post('duplicates/scan')
  scanDuplicates(@Body() body: { operator?: string }) { return this.talents.scanDuplicateCandidates(body.operator) }

  @Get('duplicates/:caseId')
  duplicateDetail(@Param('caseId') caseId: string) { return this.talents.getDuplicateCase(caseId) }

  @Post('duplicates/:caseId/merge')
  mergeDuplicate(@Param('caseId') caseId: string, @Body() body: TalentMergeInput) {
    return this.talents.mergeDuplicateCase(caseId, body)
  }

  @Post('duplicates/:caseId/resolve')
  resolveDuplicate(@Param('caseId') caseId: string, @Body() body: { result: string; note: string; operator?: string }) {
    return this.talents.resolveDuplicateCase(caseId, body)
  }

  @Post('merges/:mergeId/undo')
  undoMerge(@Param('mergeId') mergeId: string, @Body() body: { reason: string; operator?: string }) {
    return this.talents.undoMerge(mergeId, body)
  }

  @Post('contact-locks/release-expired')
  releaseExpiredLocks(@Body() body: { operator?: string }) { return this.talents.releaseExpiredContactLocks(body.operator) }

  @Post('ownership/release-stale')
  releaseStaleOwnership(@Body() body: { inactiveDays?: number; dryRun?: boolean; operator?: string }) {
    return this.talents.releaseStaleOwnership(body)
  }

  @Get('review-queue')
  reviewQueue(@Query() query: { owner?: string; q?: string }) { return this.talents.reviewQueue(query) }

  @Get('communication-templates')
  communicationTemplates(@Query() query: { category?: string; channel?: string; position?: string }) {
    return this.talents.listCommunicationTemplates(query)
  }

  @Post('communication-templates')
  createCommunicationTemplate(@Body() body: CommunicationTemplateInput) {
    return this.talents.createCommunicationTemplate(body)
  }

  @Get('communications/wechat-check')
  checkWechat(@Query() query: { wechat?: string; candidateId?: string }) {
    return this.talents.checkWechatDuplicate(query.wechat, query.candidateId)
  }

  @Post('communications/transcript-extract')
  extractCommunicationTranscript(@Body() body: { transcript: string; background?: boolean }) {
    if (body.background === true) {
      const jobId = jobs.start(async (progress) => {
        progress('AI正在解析沟通记录，请稍候…')
        return this.talents.extractCommunicationTranscript(body.transcript, 120_000)
      })
      return { jobId, status: 'running' }
    }
    return this.talents.extractCommunicationTranscript(body.transcript)
  }

  @Get('follow-ups/overdue')
  overdueFollowUps(@Query() query: { owner?: string }) { return this.talents.listOverdueFollowUps(query.owner) }

  @Post('follow-ups/sync')
  syncFollowUps(@Body() body: { operator?: string }) { return this.talents.syncFollowUpTasks(body.operator) }

  @Post('batch')
  batch(@Body() body: TalentBatchInput) { return this.talents.batch(body) }

  @Get('job-rematch/impact')
  jobRematchImpact(@Query() query: { positionId?: string }) { return this.talents.positionRematchImpact(query.positionId || '') }

  @Post('job-rematch/run')
  runJobRematch(@Body() body: PositionRematchInput & { positionId: string }) { return this.talents.rematchPosition(body.positionId, body) }

  @Get('ai-monitoring')
  aiMonitoring(@Query() query: { days?: string }) { return this.talents.aiMonitoring(Number(query.days) || 30) }

  @Get(':id/assessment-versions')
  assessmentVersions(@Param('id') id: string) { return this.talents.analysisVersions(id) }

  @Post(':id/assessment-rerun')
  async rerunAssessment(@Param('id') id: string, @Body() body: TalentAnalysisRerunInput) {
    const jobId = jobs.start(async (progress) => {
      progress('正在生成AI人才画像与岗位匹配...')
      const result = await this.talents.rerunAnalysis(id, body)
      progress('AI分析完成，正在刷新人才详情...')
      return { ...result, talent: await this.talents.detail(id) }
    })
    return { jobId, status: 'running', message: '已启动异步AI分析任务，请保持当前页面等待结果' }
  }

  @Get(':id/assessment-versions/compare')
  compareAssessmentVersions(@Param('id') id: string, @Query() query: { from?: string; to?: string }) { return this.talents.compareAnalysisVersions(id, query.from, query.to) }

  @Post('batch-auto-analyze')
  batchAutoAnalyze(@Query('limit') limit?: string) {
    // 异步执行：立即返回 jobId，后台逐个处理，避免网关 60s 超时
    const maxLimit = Math.max(1, Math.min(250, Number(limit) || 250))
    const jobId = jobs.start(async (progress) => {
      progress('正在查找待分析的人才...')
      const result = await this.talents.batchAutoAnalyze(maxLimit)
      progress(`完成：处理${result.total}份，成功${result.succeeded}份，失败${result.failed}份`)
      return result
    })
    return { jobId, status: 'running', message: `已启动异步AI分析任务，最多处理${maxLimit}份简历` }
  }

  @Get('ai-queue/status')
  aiQueueStatus() {
    return this.talents.getAiQueueStatus()
  }

  @Post('assessment-rerun-all')
  async rerunAllAssessments(@Body() body: TalentAnalysisRerunInput) {
    const result = await this.talents.rerunAllAnalysis({ reason: body.reason || 'AI分析规则更新后全量重跑', operator: body.operator })
    return { ...result, status: 'running', message: `已加入${result.total}个人才到AI分析队列，将逐个生成新分析版本` }
  }

  @Patch(':id/assessment-correction')
  correctAssessment(@Param('id') id: string, @Body() body: TalentAnalysisCorrectionInput) { return this.talents.correctAnalysis(id, body) }

  @Patch(':id/match-correction')
  async correctMatch(@Param('id') id: string, @Headers() headers: Record<string, string | string[] | undefined>, @Body() body: TalentMatchCorrectionInput) {
    const requestAccess = await this.access.getRequestAccess(headers)
    if (requestAccess) {
      this.access.assertAction(requestAccess.profile, 'manage_assessments')
      body.operator = requestAccess.identity.userName
      body.operatorUserId = requestAccess.identity.userId
    }
    return this.talents.correctMatch(id, body)
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    const requestAccess = await this.access.getRequestAccess(headers)
    if (requestAccess) this.access.assertPage(requestAccess.profile, 'candidates')
    return this.talents.detail(id, requestAccess?.profile)
  }

  @Patch(':id/ownership')
  updateOwnership(@Param('id') id: string, @Body() body: TalentOwnershipInput) {
    return this.talents.updateOwnership(id, body)
  }

  @Patch(':id/birth-year')
  updateBirthYear(@Param('id') id: string, @Body() body: TalentBirthYearInput) {
    return this.talents.updateBirthYear(id, body)
  }

  @Patch(':id/name')
  async updateName(@Param('id') id: string, @Headers() headers: Record<string, string | string[] | undefined>, @Body() body: TalentNameInput) {
    const requestAccess = await this.access.getRequestAccess(headers)
    const identity = requestAccess?.identity
    return this.talents.updateName(id, {
      ...body,
      operator: identity?.userName || body.operator,
      operatorUserId: identity?.userId || body.operatorUserId,
    })
  }

  @Post(':id/review')
  review(@Param('id') id: string, @Body() body: TalentReviewInput) { return this.talents.reviewTalent(id, body) }

  @Post(':id/referral-hr-review')
  referralHrReview(@Param('id') id: string, @Body() body: { decision?: string; reason?: string; operator?: string; operatorUserId?: string }) {
    return this.talents.reviewReferralByHr(id, body)
  }

  @Get(':id/communications')
  communications(@Param('id') id: string) { return this.talents.listCommunications(id) }

  @Post(':id/communications')
  createCommunication(@Param('id') id: string, @Body() body: TalentCommunicationInput) {
    return this.talents.createCommunication(id, body)
  }

  @Post(':id/contact-lock')
  acquireContactLock(@Param('id') id: string, @Body() body: TalentContactLockInput) {
    return this.talents.acquireContactLock(id, body)
  }

  @Post(':id/contact-lock/release')
  releaseContactLock(@Param('id') id: string, @Body() body: { reason: string; operator?: string; operatorUserId?: string }) {
    return this.talents.releaseContactLock(id, body)
  }

  @Post(':id/stage')
  advance(@Param('id') id: string, @Body() body: { stage: string; reason?: string; operator?: string }) {
    return this.talents.advance(id, body)
  }

  @Post(':id/wecom-review-share')
  shareForWecomReview(@Param('id') id: string, @Body() body: TalentWecomShareInput) {
    return this.talents.shareForWecomReview(id, body)
  }

  @Post(':id/flow-wecom')
  pushFlowWecom(@Param('id') id: string, @Body() body: { step: string; operator?: string; operatorUserId?: string }) {
    return this.talents.pushFlowWecom(id, body)
  }

  @Patch(':id/assessment')
  confirmAssessment(@Param('id') id: string, @Body() body: { result: string; note?: string; operator?: string }) {
    return this.talents.confirmAssessment(id, body)
  }

  @Delete(':id')
  archive(@Param('id') id: string, @Body() body: TalentArchiveDeleteInput) {
    return this.talents.archiveTalent(id, body)
  }
}


@Controller('api/public/talent-reviews')
export class PublicTalentReviewsController {
  constructor(private readonly talents: TalentsService, private readonly access: RoleAccessService, private readonly administration: AccessAdminService) {}

  private async viewer(headers: Record<string, string | string[] | undefined>): Promise<TalentReviewViewer> {
    const identity = await this.access.resolveRequestIdentity(headers)
    if (!identity) throw new UnauthorizedException('请先登录系统，再打开简历评审')
    const account = await this.administration.account(identity.userId)
    if (!account || account.status !== '启用') throw new ForbiddenException('当前账号暂无简历评审权限，请联系管理员')
    const access = await this.access.getUserAccess(identity.userId)
    return {
      userId: identity.userId,
      name: account.name || identity.userName,
      departmentIds: account.departmentIds || [],
      departments: account.departments || [],
      canViewAllPositions: access.roleCodes.includes('system_admin') || access.dataScopes.some((scope) => scope.type === 'all'),
    }
  }

  @Get(':token')
  async detail(@Param('token') token: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    return this.talents.publicReviewDetail(token, await this.viewer(headers))
  }

  @Post(':token/respond')
  async respond(@Param('token') token: string, @Body() body: TalentPublicReviewInput, @Headers() headers: Record<string, string | string[] | undefined>) {
    return this.talents.submitPublicReview(token, body, await this.viewer(headers))
  }
}
