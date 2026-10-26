import { Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Param, Patch, Post, Query, Res, UnauthorizedException, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common'
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express'
import { Response } from 'express'
import { storage } from '../../platform/storage'
import { jobs } from '../../platform/jobs'
import { im } from '../../platform/im'
import { MAX_BATCH_FILES, MAX_FILE_SIZE } from './resume.constants'
import { ResumeApiKeyService } from './resume-api-key.service'
import { ResumesService } from './resumes.service'
import { ResumeAnalysisStartInput, ResumeReviewInput } from './resume.types'
import { RoleAccessService } from '../database/role-access.service'
import { RecruitmentService } from '../recruitment/recruitment.service'

@Controller('api/resumes')
export class ResumesController {
  constructor(
    private readonly resumes: ResumesService,
    private readonly apiKeys: ResumeApiKeyService,
    private readonly access: RoleAccessService,
    private readonly recruitment: RecruitmentService,
  ) {}

  private async importOperator(headers: Record<string, string | string[] | undefined>, body: { operator?: string; operatorUserId?: string; suppressGroupPush?: string | boolean; deferAiAnalysis?: boolean } = {}) {
    const identity = await this.access.resolveRequestIdentity(headers)
    const suppressGroupPush = body.suppressGroupPush === true || ['true', 'on', '1'].includes(String(body.suppressGroupPush || '').toLowerCase())
    return {
      operator: String(body.operator || identity?.userName || '').trim() || '系统导入',
      operatorUserId: String(body.operatorUserId || identity?.userId || '').trim(),
      suppressGroupPush,
      deferAiAnalysis: body.deferAiAnalysis === true,
    }
  }

  @Get()
  async list(@Headers() headers: Record<string, string | string[] | undefined>) {
    const requestAccess = await this.access.getRequestAccess(headers)
    const resumes = await this.resumes.list()
    return {
      resumes: requestAccess ? resumes.map((resume) => this.access.protectTalent(resume, requestAccess.profile, { candidateId: resume.candidateId || resume.id })) : resumes,
    }
  }

  @Post('upload-url')
  async uploadUrl(@Body() body: { filename: string; contentType: string }) {
    return storage.getUploadUrl(body.filename, body.contentType || 'application/octet-stream')
  }

  @Post('process')
  @HttpCode(202)
  async process(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: { fileUrl: string; fileName: string; operator?: string; operatorUserId?: string; suppressGroupPush?: string | boolean }) {
    const importer = await this.importOperator(headers, body)
    const jobId = jobs.start((progress) => this.resumes.processUrl(body.fileUrl, body.fileName, progress, '简历上传', importer))
    return { jobId, status: 'running' }
  }

  @Post('parse-upload')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async parseUpload(@Headers() headers: Record<string, string | string[] | undefined>, @UploadedFile() file: Express.Multer.File, @Body() body: { operator?: string; operatorUserId?: string; suppressGroupPush?: string | boolean }) {
    this.resumes.validateFile(file)
    const importer = await this.importOperator(headers, body)
    const jobId = jobs.start((progress) => this.resumes.processFile(file, progress, '简历上传', importer))
    return { jobId, status: 'running' }
  }

  @Post('analysis/start')
  @HttpCode(202)
  async startAnalysis(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: ResumeAnalysisStartInput) {
    const requestAccess = await this.access.getRequestAccess(headers)
    if (!requestAccess) throw new UnauthorizedException('请先登录后再确认AI分析')
    const { positions } = await this.recruitment.positionOptions(requestAccess.profile)
    const allowedPositionIds = new Set(positions.map((position) => position.id).filter(Boolean))
    const items = (Array.isArray(body.items) ? body.items : []).map((item) => ({
      candidateId: String(item?.candidateId || '').trim(),
      resumeId: String(item?.resumeId || '').trim(),
      positionId: String(item?.positionId || '').trim(),
    })).filter((item) => item.candidateId && item.resumeId)
    if (items.some((item) => item.positionId && !allowedPositionIds.has(item.positionId))) {
      throw new ForbiddenException('所选岗位不在当前账号可用范围内')
    }
    const identity = await this.access.resolveRequestIdentity(headers)
    return this.resumes.startAnalysis(
      { items },
      {
        operator: String(identity?.userName || '').trim() || '当前用户',
        operatorUserId: String(identity?.userId || '').trim(),
      },
    )
  }

  @Post('identity-backfill')
  @HttpCode(202)
  identityBackfill() {
    const jobId = jobs.start((progress) => this.resumes.backfillIdentity(progress))
    return { jobId, status: 'running' }
  }

  @Post('batch-upload')
  @HttpCode(202)
  @UseInterceptors(FilesInterceptor('files', MAX_BATCH_FILES, { limits: { fileSize: MAX_FILE_SIZE } }))
  async batchUpload(@Headers() headers: Record<string, string | string[] | undefined>, @UploadedFiles() files: Express.Multer.File[], @Body() body: { name?: string; operator?: string; operatorUserId?: string; suppressGroupPush?: string | boolean; batchId?: string; expectedTotal?: string; finalize?: string }) {
    const importer = await this.importOperator(headers, body || {})
    const expectedTotal = Number(body.expectedTotal || files.length)
    const batch = await this.resumes.createBatch(files, { ...body, ...importer, expectedTotal })
    const finalize = body.finalize === 'true' || body.finalize === '1'
    if (!finalize) {
      jobs.start(async (progress) => {
        await this.resumes.queueBatchOperation(() => this.resumes.prepareBatchSources(batch.batchId, batch.items, files, progress))
      })
      return { batchId: batch.batchId, jobId: '', status: 'uploading', total: expectedTotal }
    }
    const jobId = jobs.start(async (progress) => {
      let detail: any
      try {
        detail = await this.resumes.queueBatchOperation(async () => {
          await this.resumes.prepareBatchSources(batch.batchId, batch.items, files, progress)
          return this.resumes.processBatch(batch.batchId, [], progress)
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.resumes.markBatchFailed(batch.batchId, message, batch.record).catch(() => undefined)
        throw error
      }
      const succeeded = Number(detail?.succeeded || 0)
      const failed = Number(detail?.failed || 0)
      const total = Number(detail?.total || expectedTotal)
      await im.notifyOwner(
        `批量简历导入完成：${detail?.name || batch.batchId}，成功${succeeded}份，失败${failed}份，共${total}份。${failed ? '失败文件已置顶，可在任务详情中直接重试。' : ''}`,
        { title: '简历批量导入完成' },
      )
      return detail
    })
    return { batchId: batch.batchId, jobId, status: 'running', total: expectedTotal }
  }

  @Get('batches')
  listBatches(@Query('limit') limit?: string) {
    return this.resumes.listBatches(Number(limit || 10))
  }

  @Get('batches/:batchId')
  batch(@Param('batchId') batchId: string) { return this.resumes.batchDetail(batchId) }

  @Post('batches/:batchId/retry')
  @HttpCode(202)
  retryBatch(@Param('batchId') batchId: string) {
    const jobId = jobs.start((progress) => this.resumes.retryBatch(batchId, progress))
    return { batchId, jobId, status: 'running' }
  }

  @Get('batches/:batchId/export')
  async exportBatch(@Param('batchId') batchId: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.resumes.exportBatch(batchId)
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader('Content-Disposition', `attachment; filename="resume-batch-${batchId}.csv"`)
    return file
  }

  @Get('api-config')
  apiConfig() { return this.apiKeys.getConfig() }

  @Post('api-config/rotate')
  @HttpCode(200)
  rotate() { return this.apiKeys.rotate() }

  @Get('candidates/:candidateId/versions')
  async versions(@Param('candidateId') candidateId: string, @Headers() headers: Record<string, string | string[] | undefined>) {
    const requestAccess = await this.access.getRequestAccess(headers)
    const result = await this.resumes.listVersions(candidateId)
    if (!requestAccess || ['full', 'authorized'].includes(this.access.sensitiveFieldPolicy(requestAccess.profile, 'resume', { candidateId }))) return result
    return { ...result, versions: result.versions.map((version) => ({ ...version, fileUrl: '', fingerprint: '' })) }
  }

  @Post('versions/:versionId/activate')
  activateVersion(@Param('versionId') versionId: string, @Body() body: { reason: string; operator?: string; operatorUserId?: string }) {
    return this.resumes.activateVersion(versionId, body)
  }

  @Post(':id/reparse')
  @HttpCode(202)
  reparse(@Param('id') id: string) {
    const jobId = jobs.start((progress) => this.resumes.reparse(id, progress))
    return { jobId, status: 'running' }
  }

  @Post(':id/convert-to-word')
  convertToWord(@Param('id') id: string, @Body() body: { force?: boolean; operator?: string; operatorUserId?: string }) {
    return this.resumes.convertImageToWord(id, body || {})
  }

  @Patch(':id/review')
  review(@Param('id') id: string, @Body() body: ResumeReviewInput) {
    return this.resumes.review(id, body)
  }

  @Delete(':id')
  delete(@Param('id') id: string) { return this.resumes.delete(id) }
}
