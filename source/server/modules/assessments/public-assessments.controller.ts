import { Body, Controller, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { AssessmentsService } from './assessments.service'

@Controller('api/public/assessments')
export class PublicAssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Get(':token')
  get(@Param('token') token: string) { return this.assessments.getPublicAssessment(token) }

  @Patch(':token/answers')
  save(@Param('token') token: string, @Body() body: { answers: Array<{ questionId: string; value: unknown }>; clientTime?: string }) {
    return this.assessments.saveAnswers(token, body)
  }

  @Post(':token/files/:questionId')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@Param('token') token: string, @Param('questionId') questionId: string, @UploadedFile() file: Express.Multer.File) {
    return this.assessments.uploadAnswerFile(token, questionId, file)
  }

  @Post(':token/events')
  event(@Param('token') token: string, @Body() body: { type: string; detail?: unknown; clientTime?: string }) {
    return this.assessments.recordPublicEvent(token, body)
  }

  @Post(':token/submit')
  submit(@Param('token') token: string, @Body() body: { clientTime?: string }) { return this.assessments.submit(token, body) }
}
