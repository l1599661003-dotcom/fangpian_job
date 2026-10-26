import { Module } from '@nestjs/common'
import { RecruitmentModule } from '../recruitment/recruitment.module'
import { AssessmentsController } from './assessments.controller'
import { AssessmentsService } from './assessments.service'
import { PublicAssessmentsController } from './public-assessments.controller'
import { QuestionBankController } from './question-bank.controller'
import { QuestionBankService } from './question-bank.service'

@Module({ imports: [RecruitmentModule], controllers: [AssessmentsController, PublicAssessmentsController, QuestionBankController], providers: [AssessmentsService, QuestionBankService], exports: [AssessmentsService] })
export class AssessmentsModule {}
