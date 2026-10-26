import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module'
import { PointsController } from './points.controller'
import { PointsService } from './points.service'

@Module({
  imports: [DatabaseModule],
  controllers: [PointsController],
  providers: [PointsService],
})
export class PointsModule {}
