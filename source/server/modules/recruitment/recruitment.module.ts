import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module'
import { MessagesModule } from '../messages/messages.module'
import { RecruitmentController } from './recruitment.controller'
import { RecruitmentService } from './recruitment.service'

@Module({
  imports: [DatabaseModule, MessagesModule],
  controllers: [RecruitmentController],
  providers: [RecruitmentService],
  exports: [RecruitmentService],
})
export class RecruitmentModule {}
