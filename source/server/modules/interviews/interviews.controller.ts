import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { Request } from 'express'
import { jobs } from '../../platform/jobs'
import { AvailabilityInput, InterviewAppointmentInput, InterviewerInput, MeetingRoomAvailabilityQuery, MeetingRoomInput, WecomUserSearchInput } from './interview.types'
import { InterviewsService } from './interviews.service'
import { requestInterviewScope } from './interview-access'

@Controller('api/interviews')
export class InterviewsController {
  private readonly creationJobs = new Map<string, { payload: string; jobId: string }>()
  constructor(private readonly interviews: InterviewsService) {}
  @Get('interviewers') interviewers(){return this.interviews.listInterviewers()}
  @Post('interviewers') createInterviewer(@Body() body:InterviewerInput){return this.interviews.createInterviewer(body)}
  @Get('availability') availability(@Query() query:{interviewerId?:string;from?:string;to?:string}){return this.interviews.listAvailability(query)}
  @Post('availability') addAvailability(@Body() body:AvailabilityInput){return this.interviews.addAvailability(body)}
  @Get('candidates') candidates(){return this.interviews.listSchedulingCandidates()}
  @Post('scheduling-candidate') schedulingCandidate(@Body() body:{candidateId?:string;interviewId?:string;phone?:string}) { return this.interviews.resolveSchedulingCandidate(body) }
  @Get('rooms/availability') roomAvailability(@Query() query:MeetingRoomAvailabilityQuery, @Query('background') background?: string) {
    if (background !== 'true') return this.interviews.roomAvailability(query)
    const jobId = jobs.start(async progress => {
      progress('正在通过天玑查询企业微信实时会议室状态…')
      return this.interviews.roomAvailability(query)
    })
    return { jobId, status: 'running' }
  }
  @Get('rooms') rooms(){return this.interviews.listRooms()}
  @Post('wecom/authorization-notice') authorizationNotice(@Req() request: Request) {
    const identity = (request as any).recruitmentAccess?.identity
    const jobId = jobs.start(async progress => {
      progress('正在通过天玑通知高子云…')
      return this.interviews.notifyWecomAuthorizationExpired(identity?.userName || '招聘人员', identity?.userId || '')
    })
    return { jobId, status: 'running' }
  }
  @Post('rooms') createRoom(@Body() body:MeetingRoomInput){return this.interviews.createRoom(body)}
  @Post('wecom/users/search') searchWecomUsers(@Body() body:WecomUserSearchInput){return this.interviews.searchWecomUsers(body.keywords)}
  @Post('wecom/resources/sync') syncResources(@Body() body:Partial<MeetingRoomAvailabilityQuery>, @Query('background') background?: string) {
    if (background !== 'true') return this.interviews.syncWecomResources(body)
    const jobId = jobs.start(async progress => {
      progress('正在通过天玑查询并同步企业微信会议室…')
      return this.interviews.syncWecomResources(body)
    })
    return { jobId, status: 'running' }
  }
  @Get('invite-templates') inviteTemplates(){return this.interviews.listInviteTemplates()}
  @Get('appointments') appointments(@Query() query:{from?:string;to?:string;candidateId?:string;status?:string}, @Req() request: Request){return this.interviews.listAppointments(query, requestInterviewScope(request))}
  @Get('appointments/:interviewId') appointment(@Param('interviewId') id:string){return this.interviews.getAppointment(id)}
  @Post('appointments') create(@Body() body:InterviewAppointmentInput, @Query('background') background?: string, @Query('requestId') requestId?: string, @Req() request?: Request) {
    const identity = (request as any)?.recruitmentAccess?.identity
    if (identity) body = { ...body, organizerUserId: identity.userId, operator: identity.userName }
    if (background !== 'true') return this.interviews.createAppointment(body)
    if (!requestId || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) throw new BadRequestException('缺少有效的提交标识，请重新打开面试安排')
    const key = `${body.candidateId}:${requestId}`, payload = JSON.stringify(body)
    const existing = this.creationJobs.get(key)
    if (existing) {
      if (existing.payload !== payload) throw new ConflictException('该邀请正在处理，请先查看原提交结果，不要重复创建')
      return { jobId: existing.jobId, status: 'running' }
    }
    const jobId = jobs.start(progress => this.interviews.createAppointment(body, progress))
    this.creationJobs.set(key, { payload, jobId })
    return { jobId, status: 'running' }
  }
  @Patch('appointments/:interviewId') update(@Param('interviewId') id:string,@Body() body:Partial<InterviewAppointmentInput>){return this.interviews.updateAppointment(id,body)}
  @Post('appointments/:interviewId/reschedule-decision') rescheduleDecision(@Param('interviewId') id:string,@Body() body:{decision:'批准'|'拒绝';startAt?:string;endAt?:string;meetingRoomId?:string;location?:string;note?:string;operator?:string;operatorUserId?:string}){const jobId=jobs.start(progress=>this.interviews.decideReschedule(id,body,progress));return{jobId,status:'running'}}
  @Get('reschedule-jobs/:jobId') rescheduleJob(@Param('jobId') jobId:string){const job=jobs.get(jobId);if(!job)throw new NotFoundException('改期处理任务不存在或已过期');return job}
  @Post('appointments/:interviewId/cancel') cancel(@Param('interviewId') id:string,@Body() body:{reason:string;operator?:string}){return this.interviews.cancelAppointment(id,body)}
  @Post('appointments/:interviewId/retry-sync') retry(@Param('interviewId') id:string,@Body() body:{operator?:string}){return this.interviews.retrySync(id,body.operator)}
  @Post('appointments/:interviewId/retry-invitation') retryInvitation(@Param('interviewId') id:string,@Body() body:{operator?:string}){return this.interviews.retryInvitation(id,body.operator)}
  @Post('appointments/:interviewId/result') sendResult(@Param('interviewId') id:string,@Body() body:{result:string;note?:string;operator?:string}){return this.interviews.sendInterviewResult(id,body)}
 @Post('reminders/check') reminders(@Body() body:{operator?:string}){return this.interviews.checkReminders(body.operator)}
}
