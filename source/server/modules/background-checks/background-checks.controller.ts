import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { BackgroundAuthorizationInput, BackgroundCheckInput, BackgroundConclusionInput, BackgroundContactInput, BackgroundRiskInput, BackgroundVerificationInput } from './background-check.types'
import { BackgroundChecksService } from './background-checks.service'
import { jobs } from '../../platform/jobs'

@Controller('api/background-checks')
export class BackgroundChecksController {
  constructor(private readonly checks: BackgroundChecksService) {}
  @Get('packages') packages() { return this.checks.packages() }
  @Post('sync-reports') syncReports(@Body() body: { days?: number; operator?: string }) { return this.checks.pullReports(Number(body.days || 1)) }
  @Get() list(@Query() query: { candidateId?: string; status?: string }) { return this.checks.list(query) }
  @Post() create(@Body() body: BackgroundCheckInput) { return this.checks.create(body) }
  @Post(':id/authorization') authorize(@Param('id') id: string, @Body() body: BackgroundAuthorizationInput) { return this.checks.authorize(id, body) }
  @Post(':id/contacts') contact(@Param('id') id: string, @Body() body: BackgroundContactInput) { return this.checks.addContact(id, body) }
  @Post(':id/verifications') verification(@Param('id') id: string, @Body() body: BackgroundVerificationInput) { return this.checks.addVerification(id, body) }
  @Post(':id/risks') risk(@Param('id') id: string, @Body() body: BackgroundRiskInput) { return this.checks.addRisk(id, body) }
  @Post(':id/evidence') @UseInterceptors(FileInterceptor('file')) evidence(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Body() body: { riskId?: string; operator?: string }) { return this.checks.uploadEvidence(id, file, body) }
  @Post(':id/external-request') externalRequest(@Param('id') id: string, @Body() body: { provider?: string; packageId: string; operator?: string }) { const jobId = jobs.start((progress) => this.checks.externalRequest(id, body, progress)); return { jobId, status: 'running' } }
  @Post(':id/sync-external') syncExternal(@Param('id') id: string, @Body() body: { operator?: string }) { return this.checks.syncExternal(id, body) }
  @Post(':id/external-result') externalResult(@Param('id') id: string, @Body() body: { externalTaskId: string; status: '成功' | '失败' | '处理中'; summary?: string; error?: string; operator?: string }) { return this.checks.externalResult(id, body) }
  @Post(':id/generate-report') report(@Param('id') id: string, @Body() body: { operator?: string }) { return this.checks.generateReport(id, body) }
  @Post(':id/conclusion') conclusion(@Param('id') id: string, @Body() body: BackgroundConclusionInput) { return this.checks.conclude(id, body) }
}
