import { Module } from '@nestjs/common'
import { MessagesModule } from '../messages/messages.module'
import { RecruitmentModule } from '../recruitment/recruitment.module'
import { OffersController } from './offers.controller'
import { OffersService } from './offers.service'
import { PublicOffersController } from './public-offers.controller'

@Module({
  imports: [MessagesModule, RecruitmentModule],
  controllers: [OffersController, PublicOffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
