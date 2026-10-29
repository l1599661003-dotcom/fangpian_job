import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module'
import { MessagesModule } from '../messages/messages.module'
import { ResumeApiKeyService } from '../resumes/resume-api-key.service'
import { PublicMonthlyHiringController } from './public-monthly-hiring.controller'
import { RecruitmentController } from './recruitment.controller'
import { RecruitmentService } from './recruitment.service'

@Module({
  imports: [DatabaseModule, MessagesModule],
  controllers: [RecruitmentController, PublicMonthlyHiringController],
  providers: [RecruitmentService, ResumeApiKeyService],
  exports: [RecruitmentService],
})
export class RecruitmentModule {}
