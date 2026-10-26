import { Module } from '@nestjs/common'
import { InterviewsController } from './interviews.controller'
import { InterviewsService } from './interviews.service'
import { PublicInterviewsController } from './public-interviews.controller'
import { EvaluationsController } from './evaluations.controller'
import { EvaluationService } from './evaluation.service'
import { MessagesModule } from '../messages/messages.module'
import { TalentsModule } from '../talents/talents.module'

@Module({imports:[MessagesModule,TalentsModule],controllers:[InterviewsController,PublicInterviewsController,EvaluationsController],providers:[InterviewsService,EvaluationService],exports:[InterviewsService,EvaluationService]})
export class InterviewsModule {}
