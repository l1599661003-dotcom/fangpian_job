import { Module } from '@nestjs/common'
import { ResumeApiKeyService } from './resume-api-key.service'
import { ResumeFileService } from './resume-file.service'
import { PublicResumeApiController } from './public-resume-api.controller'
import { ResumesController } from './resumes.controller'
import { ResumesService } from './resumes.service'
import { TalentsModule } from '../talents/talents.module'
import { RecruitmentModule } from '../recruitment/recruitment.module'
import { ResumeWordService } from './resume-word.service'

@Module({
  imports: [TalentsModule, RecruitmentModule],
  controllers: [ResumesController, PublicResumeApiController],
  providers: [ResumeFileService, ResumeWordService, ResumesService, ResumeApiKeyService],
  exports: [ResumesService],
})
export class ResumesModule {}
