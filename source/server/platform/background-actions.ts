import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor, UnauthorizedException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { defer, lastValueFrom, Observable, of } from 'rxjs'
import { jobAccessContext, jobs } from './jobs'

export const BACKGROUND_ACTION_PATHS = [
  /^\/api\/recruitment\/(?:monthly-demands|department-demands)$/,
  /^\/api\/recruitment\/department-demands\/[^/]+\/pause$/,
  /^\/api\/recruitment\/approvals\/[^/]+\/[^/]+\/decision$/,
  /^\/api\/talents\/[^/]+\/(?:communications|review|wecom-review-share|stage)$/,
  /^\/api\/interview-evaluations\/interviews\/[^/]+\/(?:feedback|decision|notes)$/,
  /^\/api\/interview-evaluations\/public$/,
  /^\/api\/public\/interviews\/communication$/,
  /^\/api\/interviews\/wecom\/resources\/sync$/,
  /^\/api\/interviews\/appointments\/[^/]+\/(?:retry-invitation|result|sync-calendar)$/,
  /^\/api\/offers$/,
  /^\/api\/offers\/[^/]+\/(?:submit|approval|generate-file|send-email|response-link|negotiate)$/,
]

@Injectable()
export class BackgroundActionsInterceptor implements NestInterceptor {
  private requests = new Map<string, { jobId: string; createdAt: number }>()

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle()
    const request = context.switchToHttp().getRequest()
    const requestId = request.headers['x-background-action']
    if (request.method !== 'POST' || !requestId || !BACKGROUND_ACTION_PATHS.some(pattern => pattern.test(request.path))) return next.handle()
    if (typeof requestId !== 'string' || !/^[\w-]{16,80}$/.test(requestId)) throw new BadRequestException('后台操作请求标识无效')
    const resolved = request.recruitmentAccess
    const publicPolling = ['/api/interview-evaluations/public', '/api/public/interviews/communication'].includes(request.path)
    if (!publicPolling && !resolved) throw new UnauthorizedException('请先登录后再操作')
    const key = createHash('sha256').update(JSON.stringify([resolved?.identity.userId || '', request.path, request.query, request.body, requestId])).digest('hex')
    const existing = this.requests.get(key)
    if (existing && jobs.get(existing.jobId)) return of({ jobId: existing.jobId, status: 'running' })
    const start = () => jobs.start(async progress => {
      progress('正在处理并保存，请勿重复提交…')
      return lastValueFrom(defer(() => next.handle()))
    }, { publicPolling })
    const policy = request.recruitmentAccessPolicy
    const jobId = resolved ? jobAccessContext.run({ userId: resolved.identity.userId, pagesAny: policy?.pagesAny, actionsAny: policy?.actionsAny }, start) : start()
    this.requests.set(key, { jobId, createdAt: Date.now() })
    for (const [entryKey, entry] of this.requests) {
      if (Date.now() - entry.createdAt > 86400000 && jobs.get(entry.jobId)?.status !== 'running') this.requests.delete(entryKey)
    }
    return of({ jobId, status: 'running' })
  }
}
