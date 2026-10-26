import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { InterviewsService } from './interviews.service'
import { TalentsService } from '../talents/talents.service'
import { jobs } from '../../platform/jobs'

@Controller('api/public/interviews')
export class PublicInterviewsController {
  constructor(private readonly interviews: InterviewsService, private readonly talents: TalentsService) {}
  @Get('communication') communicationLink(@Query('token') token:string){return this.interviews.publicCommunicationDetail(token)}
  @Post('communication/extract')
  async extractCommunicationLink(@Query('token') token: string, @Body() body: { transcript: string; background?: boolean }) {
    await this.interviews.publicCommunicationDetail(token)
    if (body.background === true) {
      const jobId = jobs.start(async (progress) => {
        progress('AI正在解析沟通记录，请稍候…')
        return this.talents.extractCommunicationTranscript(body.transcript, 120_000)
      }, { publicPolling: true })
      return { jobId, status: 'running' }
    }
    return this.talents.extractCommunicationTranscript(body.transcript)
  }
  @Post('communication') submitCommunicationLink(@Query('token') token:string,@Body() body:Record<string,unknown>){return this.interviews.submitPublicCommunicationByToken(token,body)}
  @Get(':token') get(@Param('token') token:string){return this.interviews.publicDetail(token)}
  @Post(':token/confirm') confirm(@Param('token') token:string){return this.interviews.candidateConfirm(token)}
  @Post(':token/reschedule') reschedule(@Param('token') token:string,@Body() body:{reason:string;preferredTimes?:string[]}){return this.interviews.candidateReschedule(token,body)}
  @Post(':token/check-in') checkIn(@Param('token') token:string){return this.interviews.checkIn(token)}
  @Post(':token/preparation') preparation(@Param('token') token:string,@Body() body:{profile?:Record<string,unknown>;confirm?:boolean}){return this.interviews.submitCandidatePreparation(token,body)}
  @Post(':token/communication') communication(@Param('token') token:string,@Body() body:Record<string,unknown>){return this.interviews.submitCandidateCommunication(token,body)}
}
