import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common'
import { RoleAccessService } from '../database/role-access.service'
import { RecruitmentService } from './recruitment.service'
import { jobs } from '../../platform/jobs'
import { CollectionTaskInput, CollectionTaskProgressInput, MonthlyDemandInput, PositionChannelBindingInput, PositionInput, RecruitmentChannelInput } from './recruitment.types'

@Controller('api/recruitment')
export class RecruitmentController {
  constructor(private readonly recruitment: RecruitmentService, private readonly access: RoleAccessService) {}

  private async actor(headers: Record<string, string | string[] | undefined>) {
    const resolved = await this.access.getRequestAccess(headers)
    if (!resolved) throw new UnauthorizedException('招聘审批必须启用可信登录身份')
    return resolved
  }

  @Get()
  async overview(@Headers() headers: Record<string, string | string[] | undefined>, @Query('view') view?: string) {
    const actor = await this.actor(headers)
    if (view === 'positions') return this.recruitment.positionCatalog(actor.profile)
    return this.recruitment.overview(actor.profile)
  }

  @Get('monthly-hiring')
  async monthlyHiring(@Headers() headers: Record<string, string | string[] | undefined>, @Query('month') month: string, @Query('period') period?: string) {
    const actor = await this.actor(headers)
    return this.recruitment.monthlyHiring(month, actor.profile, period)
  }

  @Get('referral-poster-order')
  async referralPosterOrder(@Headers() headers: Record<string, string | string[] | undefined>) {
    await this.actor(headers)
    const hiring = await this.recruitment.monthlyHiring('', undefined)
    return {
      month: hiring.month,
      positionIds: [...new Set(hiring.departments.map((row) => row.positionId).filter(Boolean))],
    }
  }

  @Get('position-options')
  async positionOptions(@Headers() headers: Record<string, string | string[] | undefined>) {
    const actor = await this.actor(headers)
    return this.recruitment.positionOptions(actor.profile)
  }

  @Get('form-options')
  async formOptions(@Headers() headers: Record<string, string | string[] | undefined>) {
    const actor = await this.actor(headers)
    return this.recruitment.formOptions(actor.profile)
  }

  @Get('monthly-demands')
  async monthlyDemands(@Headers() headers: Record<string, string | string[] | undefined>, @Query('month') month: string, @Query('positionId') positionId: string) {
    const actor = await this.actor(headers)
    return this.recruitment.listMonthlyDemands(month, positionId, actor.profile)
  }

  @Get('department-demands')
  async departmentDemands(@Headers() headers: Record<string, string | string[] | undefined>, @Query('month') month: string) {
    const actor = await this.actor(headers)
    return this.recruitment.departmentDemandWorkbench(month, actor.profile)
  }

  @Post('department-demands')
  async saveDepartmentDemand(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: MonthlyDemandInput) {
    const actor = await this.actor(headers)
    const scope = await this.recruitment.departmentDemandScope(actor.profile)
    return this.recruitment.saveMonthlyDemand({ ...body, operator: actor.identity.userName }, actor.identity.userId, scope.profile)
  }

  @Post('department-demands/transcript-extract')
  async extractDepartmentDemand(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: { transcript?: string; background?: boolean }) {
    const actor = await this.actor(headers)
    const scope = await this.recruitment.departmentDemandScope(actor.profile)
    if (body.background === true) return { jobId: jobs.start(async progress => {
      progress('AI正在识别岗位、人数和到岗计划…')
      return this.recruitment.extractMonthlyDemandTranscript(body.transcript || '', scope.profile, 120_000)
    }), status: 'running' }
    return this.recruitment.extractMonthlyDemandTranscript(body?.transcript || '', scope.profile)
  }

  @Post('department-demands/:positionId/pause')
  async pauseDepartmentDemand(@Headers() headers: Record<string, string | string[] | undefined>, @Param('positionId') positionId: string, @Body() body: { reason?: string }) {
    const actor = await this.actor(headers)
    return this.recruitment.pauseDepartmentDemand(positionId, body.reason || '', actor.identity.userName, actor.profile)
  }

  @Post('monthly-demands')
  async saveMonthlyDemand(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: MonthlyDemandInput) {
    const actor = await this.actor(headers)
    return this.recruitment.saveMonthlyDemand({ ...body, operator: actor.identity.userName }, actor.identity.userId, actor.profile)
  }

  @Post('monthly-demands/transcript-extract')
  async extractMonthlyDemandTranscript(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: { transcript?: string; background?: boolean }) {
    const actor = await this.actor(headers)
    if (body.background === true) return { jobId: jobs.start(async progress => {
      progress('AI正在识别岗位、人数和到岗计划…')
      return this.recruitment.extractMonthlyDemandTranscript(body.transcript || '', actor.profile, 120_000)
    }), status: 'running' }
    return this.recruitment.extractMonthlyDemandTranscript(body?.transcript || '', actor.profile)
  }

  @Get('approvals/:type/:id')
  async approval(@Headers() headers: Record<string, string | string[] | undefined>, @Param('type') type: string, @Param('id') id: string) {
    const actor = await this.actor(headers)
    return this.recruitment.getRecruitmentApproval(type, id, actor.identity)
  }

  @Post('approvals/:type/:id/decision')
  async decideApproval(@Headers() headers: Record<string, string | string[] | undefined>, @Param('type') type: string, @Param('id') id: string, @Body() body: { decision?: string; opinion?: string }) {
    const actor = await this.actor(headers)
    return this.recruitment.decideRecruitmentApproval(type, id, body || {}, actor.identity)
  }

  @Get('positions/:id')
  async position(@Headers() headers: Record<string, string | string[] | undefined>, @Param('id') id: string) {
    const actor = await this.actor(headers)
    return this.recruitment.getPosition(id, actor.profile)
  }

  @Get('positions/:id/versions')
  async positionVersions(@Headers() headers: Record<string, string | string[] | undefined>, @Param('id') id: string) {
    const actor = await this.actor(headers)
    return this.recruitment.getPositionVersions(id, actor.profile)
  }

  @Get('positions/:id/versions/compare')
  async comparePositionVersions(@Headers() headers: Record<string, string | string[] | undefined>, @Param('id') id: string, @Query() query: { from?: string; to?: string }) {
    const actor = await this.actor(headers)
    return this.recruitment.comparePositionVersions(id, actor.profile)
  }

  @Post('positions')
  async createPosition(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: PositionInput & { operator?: string }) {
    const actor = await this.actor(headers)
    return this.recruitment.createPosition(body, actor.identity.userName, actor.identity.userId, actor.profile)
  }

  @Post('positions/import')
  importPositions(@Body() body: { rows: Array<Partial<PositionInput> & { id?: string }>; sourceName?: string; operator?: string }) {
    return this.recruitment.importPositions(body)
  }

  @Post('positions/company-catalog/sync')
  syncCompanyPositionCatalog(@Body() body: { operator?: string }) {
    return this.recruitment.syncCompanyPositionCatalog(body.operator)
  }

  @Patch('positions/:id')
  async updatePosition(@Headers() headers: Record<string, string | string[] | undefined>, @Param('id') id: string, @Body() body: Partial<PositionInput> & { operator?: string }) {
    const actor = await this.actor(headers)
    return this.recruitment.updatePosition(id, body, actor.identity.userName, actor.profile)
  }

  @Post('positions/:id/publish')
  publishPosition(@Param('id') id: string, @Body() body: CollectionTaskInput & { operator?: string }) {
    return this.recruitment.publishPosition(id, body, body.operator)
  }

  @Post('positions/:id/offline')
  offlinePosition(@Param('id') id: string, @Body() body: { reason: string; operator?: string }) {
    return this.recruitment.changePositionStatus(id, '已下线', body.reason, body.operator)
  }

  @Post('positions/:id/close')
  closePosition(@Param('id') id: string, @Body() body: { reason: string; operator?: string }) {
    return this.recruitment.changePositionStatus(id, '已关闭', body.reason, body.operator)
  }

  @Post('positions/batch-publish')
  batchPublishPositions(@Body() body: { ids: string[]; operator?: string }) {
    return this.recruitment.batchPublishPositions(body.ids, body.operator)
  }

  @Post('positions/batch-offline')
  batchOfflinePositions(@Body() body: { ids: string[]; reason: string; operator?: string }) {
    return this.recruitment.batchOfflinePositions(body.ids, body.reason, body.operator)
  }

  @Post('positions/:id/reopen')
  reopenPosition(@Param('id') id: string, @Body() body: { reason?: string; operator?: string }) {
    return this.recruitment.changePositionStatus(id, '待发布', body.reason || '重新开放岗位', body.operator)
  }

  @Post('positions/:id/channels')
  bindPositionChannels(@Param('id') id: string, @Body() body: PositionChannelBindingInput) {
    return this.recruitment.bindPositionChannels(id, body)
  }

  @Get('channels')
  channels() { return this.recruitment.listChannels() }

  @Post('channels')
  createChannel(@Body() body: RecruitmentChannelInput) { return this.recruitment.createChannel(body) }

  @Patch('channels/:id')
  updateChannel(@Param('id') id: string, @Body() body: Partial<RecruitmentChannelInput>) {
    return this.recruitment.updateChannel(id, body)
  }

  @Get('collection-tasks')
  collectionTasks(@Query() query: { status?: string; positionId?: string; demandId?: string }) {
    return this.recruitment.listCollectionTasks(query)
  }

  @Get('collection-tasks/:id')
  collectionTask(@Param('id') id: string) { return this.recruitment.getCollectionTask(id) }

  @Post('collection-tasks/:id/claim')
  claimCollectionTask(@Param('id') id: string, @Body() body: CollectionTaskProgressInput) {
    return this.recruitment.claimCollectionTask(id, body)
  }

  @Patch('collection-tasks/:id/progress')
  updateCollectionProgress(@Param('id') id: string, @Body() body: CollectionTaskProgressInput) {
    return this.recruitment.updateCollectionTaskProgress(id, body)
  }

  @Post('collection-tasks/:id/complete')
  completeCollectionTask(@Param('id') id: string, @Body() body: CollectionTaskProgressInput) {
    return this.recruitment.finishCollectionTask(id, '已完成', body)
  }

  @Post('collection-tasks/:id/fail')
  failCollectionTask(@Param('id') id: string, @Body() body: CollectionTaskProgressInput) {
    return this.recruitment.finishCollectionTask(id, '执行失败', body)
  }

  @Post('collection-tasks/:id/retry')
  retryCollectionTask(@Param('id') id: string, @Body() body: CollectionTaskProgressInput) {
    return this.recruitment.retryCollectionTask(id, body)
  }

  @Post('collection-tasks/:id/cancel')
  cancelCollectionTask(@Param('id') id: string, @Body() body: CollectionTaskProgressInput) {
    return this.recruitment.cancelCollectionTask(id, body)
  }

  @Post('collection-tasks/check-stale')
  checkStaleCollectionTasks(@Body() body: { staleMinutes?: number; operator?: string }) {
    return this.recruitment.checkStaleCollectionTasks(body.staleMinutes, body.operator)
  }
}
