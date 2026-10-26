import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module'
import { BackgroundChecksController } from './background-checks.controller'
import { BackgroundChecksService } from './background-checks.service'

@Module({ imports: [DatabaseModule], controllers: [BackgroundChecksController], providers: [BackgroundChecksService], exports: [BackgroundChecksService] })
export class BackgroundChecksModule {}
