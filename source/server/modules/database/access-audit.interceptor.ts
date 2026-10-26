import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import type { Request } from 'express'
import { catchError, from, map, mergeMap, Observable, throwError } from 'rxjs'
import { AccessRoutePolicy } from './access.guard'
import { RequestIdentity, RoleAccessProfile, RoleAccessService } from './role-access.service'
import { jobAccessContext } from '../../platform/jobs'

type AuditedRequest = Request & {
  recruitmentAccess?: { identity: RequestIdentity; profile: RoleAccessProfile }
  recruitmentAccessPolicy?: AccessRoutePolicy
}

@Injectable()
export class AccessAuditInterceptor implements NestInterceptor {
  constructor(private readonly access: RoleAccessService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle()
    const request = context.switchToHttp().getRequest<AuditedRequest>(), resolved = request.recruitmentAccess, policy = request.recruitmentAccessPolicy
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase()), shouldAudit = Boolean(resolved && (write || policy?.sensitiveRead))
    if (!resolved) return next.handle()
    const groups: Array<'contacts' | 'salary' | 'resume'> = []
    if (/^\/api\/(resumes|interviews|interview-evaluations|offers|background-checks|employee-lifecycle|referrals|messages)(\/|$)/.test(request.path)) groups.push('contacts')
    if (/^\/api\/(offers|interview-evaluations|analytics)(\/|$)/.test(request.path)) groups.push('salary')
    if (request.path.startsWith('/api/resumes')) groups.push('resume')
    const scoped = new Observable((subscriber) => jobAccessContext.run({ userId: resolved.identity.userId, pagesAny: policy?.pagesAny, actionsAny: policy?.actionsAny }, () => next.handle().subscribe(subscriber)))
    const response = scoped.pipe(map((value) => groups.length ? this.access.redactSensitiveResponse(value, resolved.profile, groups) : value))
    if (!shouldAudit) return response
    const action = write ? '修改业务数据' : '读取敏感业务数据'
    return response.pipe(
      mergeMap((value) => from(this.access.auditAccess(resolved.profile, resolved.identity.userName, request, action, '成功')).pipe(map(() => value))),
      catchError((error) => from(this.access.auditAccess(resolved.profile, resolved.identity.userName, request, action, '失败', error instanceof Error ? error.message : String(error))).pipe(mergeMap(() => throwError(() => error)))),
    )
  }
}
