import { Module } from '@nestjs/common'
import { PublicTalentReviewsController, TalentsController } from './talents.controller'
import { TalentsService } from './talents.service'
import { RecruitmentModule } from '../recruitment/recruitment.module'
import { MessagesModule } from '../messages/messages.module'

@Module({ imports: [RecruitmentModule, MessagesModule], controllers: [TalentsController, PublicTalentReviewsController], providers: [TalentsService], exports: [TalentsService] })
export class TalentsModule {}
