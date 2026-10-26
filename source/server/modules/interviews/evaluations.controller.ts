import { Body,Controller,Get,HttpCode,Param,Post,Query,Req,Res } from '@nestjs/common'
import type { Request,Response } from 'express'
import { jobs } from '../../platform/jobs'
import { EvaluationService } from './evaluation.service'
import { requestInterviewScope } from './interview-access'
import { InterviewDecisionInput,InterviewFeedbackInput,InterviewQuestionGenerateInput,InterviewTemplateInput } from './evaluation.types'
@Controller('api/interview-evaluations')
export class EvaluationsController{
 constructor(private readonly evaluations:EvaluationService){}
 @Get('templates') templates(){return this.evaluations.templates()}
 @Post('templates') createTemplate(@Body() body:InterviewTemplateInput){return this.evaluations.createTemplate(body)}
 @Get('workbench') workbench(@Query() query:{status?:string;interviewerUserId?:string},@Req() request:Request){return this.evaluations.workbench(query,requestInterviewScope(request))}
 @Post('interviews/:interviewId/feedback-extract') feedbackExtract(@Param('interviewId') id:string,@Body() body:{transcript?:string;background?:boolean}){
  if(body.background===true)return{jobId:jobs.start(async progress=>{progress('AI正在整理面试结论、优势和风险…');return this.evaluations.extractFeedbackTranscript(id,body.transcript||'',120000)}),status:'running'}
  return this.evaluations.extractFeedbackTranscript(id,body?.transcript||'')
 }
 @Post('interviews/:interviewId/notes') notes(@Param('interviewId') id:string,@Body() body:{notes:string;transcript?:string;operator?:string}){return this.evaluations.saveNotes(id,body)}
 @Post('interviews/:interviewId/ai-draft') @HttpCode(202) aiDraft(@Param('interviewId') id:string){return this.evaluations.generateAiDraft(id)}
 @Get('interviews/:interviewId/feedback') feedback(@Param('interviewId') id:string){return this.evaluations.feedback(id)}
 @Get('interviews/:interviewId/questions') questions(@Param('interviewId') id:string){return this.evaluations.questions(id)}
 @Get('interviews/:interviewId/questions/export') async exportQuestions(@Param('interviewId') id:string,@Res() response:Response){const result=await this.evaluations.exportQuestions(id),fallback=`interview-questions-${id.replace(/[^a-zA-Z0-9_-]/g,'-')}.docx`;response.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');response.setHeader('Content-Disposition',`attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);response.send(result.content)}
 @Post('interviews/:interviewId/feedback') submitFeedback(@Param('interviewId') id:string,@Body() body:InterviewFeedbackInput){return this.evaluations.submitFeedback(id,body)}
 @Get('interviews/:interviewId/aggregate') aggregate(@Param('interviewId') id:string){return this.evaluations.aggregate(id)}
 @Post('interviews/:interviewId/decision') decide(@Param('interviewId') id:string,@Body() body:InterviewDecisionInput){return this.evaluations.decide(id,body)}
 @Post('feedback-sla/check') checkSla(@Body() body:{operator?:string}){return this.evaluations.checkFeedbackSla(body.operator)}
 @Post('before-interviews/check') checkBeforeInterviews(){return this.evaluations.checkBeforeInterviews()}
 @Post('public/draft') savePublicDraft(@Query('token') token:string,@Body() body:Record<string,unknown>){return this.evaluations.savePublicEvaluationDraft(token,body)}
 @Post('public/extract') async extractPublic(@Query('token') token:string,@Body() body:{transcript?:string;background?:boolean}){
  if(body.background===true){
   const detail=await this.evaluations.publicEvaluationDetail(token)
   return{jobId:jobs.start(async progress=>{progress('AI正在整理面试记录和会议总结…');return this.evaluations.extractFeedbackTranscript(detail.interviewId,body.transcript||'',120000)},{publicPolling:true}),status:'running'}
  }
  return this.evaluations.extractPublicEvaluation(token,body.transcript||'')
 }
 @Get('public') publicEvaluation(@Query('token') token:string){return this.evaluations.publicEvaluationDetail(token)}
 @Post('public') submitPublicEvaluation(@Query('token') token:string,@Body() body:any){return this.evaluations.submitPublicEvaluation(token,body)}
 @Get('salary-benchmarks') salary(@Query() query:{role?:string;city?:string}){return this.evaluations.salary(query)}
 @Post('interviews/:interviewId/generate-questions') generateQuestions(@Param('interviewId') id:string,@Body() body:InterviewQuestionGenerateInput,@Query('background') background?:string){const input={...body,interviewId:id};if(background==='true')return this.evaluations.queueInterviewQuestionGeneration(input);return this.evaluations.generateInterviewQuestions(input)}
 @Post('salary-benchmarks') createSalary(@Body() body:any){return this.evaluations.createSalary(body)}
 @Get('analytics') analytics(@Req() request:Request){return this.evaluations.analytics(requestInterviewScope(request))}
}
