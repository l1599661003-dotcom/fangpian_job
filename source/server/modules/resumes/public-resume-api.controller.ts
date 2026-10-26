import { Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, UnauthorizedException, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { jobs } from '../../platform/jobs'
import { MAX_FILE_SIZE, SUPPORTED_EXTENSIONS } from './resume.constants'
import { ResumeApiKeyService } from './resume-api-key.service'
import { ResumesService } from './resumes.service'

@Controller('api/public/resumes')
export class PublicResumeApiController {
  constructor(private readonly resumes: ResumesService, private readonly apiKeys: ResumeApiKeyService) {}

  private async authorize(key?: string) {
    if (!await this.apiKeys.validate(key)) throw new UnauthorizedException('X-API-Key 缺失、错误或已被轮换')
  }

  @Post('parse')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async parse(@Headers('x-api-key') key: string | undefined, @UploadedFile() file: Express.Multer.File) {
    await this.authorize(key)
    this.resumes.validateFile(file)
    const jobId = jobs.start((progress) => this.resumes.processFile(file, progress, '简历上传', { operator: '外部API导入' }))
    return { jobId, status: 'running' }
  }

  @Get('jobs/:jobId')
  async job(@Headers('x-api-key') key: string | undefined, @Param('jobId') jobId: string) {
    await this.authorize(key)
    const job = jobs.get(jobId)
    if (!job) throw new NotFoundException('解析任务不存在或已过期')
    return job
  }

  @Get('formats')
  async formats(@Headers('x-api-key') key: string | undefined) {
    await this.authorize(key)
    return {
      authenticated: true,
      keyValidity: '长期有效，直到主动轮换密钥',
      maxFileSizeMB: MAX_FILE_SIZE / 1024 / 1024,
      supportedExtensions: [...SUPPORTED_EXTENSIONS],
    }
  }
}
