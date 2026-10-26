import { Module } from '@nestjs/common'
import { ServeStaticModule } from '@nestjs/serve-static'
import { join } from 'node:path'
import { JobsModule } from './platform/jobs'
import { ResumesModule } from './modules/resumes/resumes.module'
import { DatabaseModule } from './modules/database/database.module'
import { TalentsModule } from './modules/talents/talents.module'
import { RecruitmentModule } from './modules/recruitment/recruitment.module'
import { AssessmentsModule } from './modules/assessments/assessments.module'
import { InterviewsModule } from './modules/interviews/interviews.module'
import { OffersModule } from './modules/offers/offers.module'
import { BackgroundChecksModule } from './modules/background-checks/background-checks.module'
import { EmployeeLifecycleModule } from './modules/employee-lifecycle/employee-lifecycle.module'
import { ReferralsModule } from './modules/referrals/referrals.module'
import { MessagesModule } from './modules/messages/messages.module'
import { GovernanceModule } from './modules/governance/governance.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { PointsModule } from './modules/points/points.module'
import { TalentReviewPageController } from './talent-review-page.controller'

import { TasksModule } from './platform/tasks'
import './tasks'
import { RecruitmentFlowTaskRunner } from './tasks/recruitment-flow.task'
import { DailyResumePushTaskRunner } from './tasks/daily-wecom-resume-push.task'
import { DailyRecruitmentActivityPushTaskRunner } from './tasks/daily-recruitment-activity-push.task'
import { BatchAiAnalysisTaskRunner } from './tasks/batch-ai-analysis.task'

@Module({
  controllers: [TalentReviewPageController],
  providers: [RecruitmentFlowTaskRunner, DailyResumePushTaskRunner, DailyRecruitmentActivityPushTaskRunner, BatchAiAnalysisTaskRunner],
  imports: [
    TasksModule,
    JobsModule,
    DatabaseModule,
    RecruitmentModule,
    AssessmentsModule,
    InterviewsModule,
    OffersModule,
    BackgroundChecksModule,
    EmployeeLifecycleModule,
    ReferralsModule,
    MessagesModule,
    GovernanceModule,
    AnalyticsModule,
    PointsModule,
    TalentsModule,
    ResumesModule,
    ServeStaticModule.forRoot({ rootPath: join(process.cwd(), 'dist', 'client'), exclude: ['/api/(.*)'] }),
  ],
})
export class AppModule {}
