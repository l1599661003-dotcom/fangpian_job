import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import { RoleAccessService } from './role-access.service'
import { jobs } from '../../platform/jobs'

export interface AccessRoutePolicy { pagesAny?: string[]; actionsAny?: string[]; sensitiveRead?: boolean; public?: boolean }

export function resolveAccessPolicy(method: string, path: string): AccessRoutePolicy {
  const verb = method.toUpperCase()
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(verb)
  if (!path.startsWith('/api/')) return { public: true }
  if (/^\/api\/public(\/|$)/.test(path) || /^\/api\/(interview-evaluations\/public|employee-lifecycle\/reviews\/public|employee-lifecycle\/onboarding\/arrival\/public)(\/|$)/.test(path) || ['/api/access/me', '/api/access/login', '/api/access/logout', '/api/access/heartbeat', '/api/access/apply', '/api/access/profile'].includes(path)) return { public: true }
  if (['GET', 'HEAD'].includes(verb) && ['/api/health', '/api/health/database'].includes(path)) return { public: true }
  if (path.startsWith('/api/health/')) return { pagesAny: ['settings'], actionsAny: ['manage_system'] }
  if (path.startsWith('/api/studio-tasks')) return { pagesAny: ['scheduled_tasks'], actionsAny: write ? ['manage_system'] : [] }
  if (path.startsWith('/api/access/')) return { pagesAny: ['settings'], actionsAny: ['manage_access_control'], sensitiveRead: true }
  if (path.startsWith('/api/recruitment')) {
    if (path.startsWith('/api/recruitment/department-demands')) return { pagesAny: ['positions'], actionsAny: write ? ['create_demand'] : [] }
    if (path === '/api/recruitment/referral-poster-order') return { pagesAny: ['referrals'] }
    if (path === '/api/recruitment/position-options') return { pagesAny: ['home', 'positions', 'candidates', 'interviews', 'offers'] }
    if (path.includes('/approvals/')) return { pagesAny: ['home', 'positions'] }
    if (path.includes('/positions') || path.includes('/channels') || path.includes('/collection-tasks')) return { pagesAny: ['positions'], actionsAny: write ? ['manage_positions'] : [] }
    if (path.includes('/monthly-demands')) return { pagesAny: ['positions'], actionsAny: write ? ['create_demand'] : [] }
    return { pagesAny: ['home', 'positions'] }
  }
  if (path.startsWith('/api/talents')) {
    let actionsAny: string[] = []
    if (write) {
      if (/\/review$|\/wecom-review-share$/.test(path)) actionsAny = ['review_candidate']
      else if (/\/stage$/.test(path)) actionsAny = ['advance_application']
      else if (/avatars\/backfill|release-expired|release-stale|assessment-rerun-all/.test(path)) actionsAny = ['manage_system']
      else if (/assessment|job-rematch|batch-auto-analyze/.test(path)) actionsAny = ['manage_assessments']
      else if (/duplicates|\/merges\//.test(path)) actionsAny = ['manage_governance']
      else actionsAny = ['edit_candidate']
    } else if (path.includes('/ai-monitoring') || path.includes('/ai-queue/status')) {
      actionsAny = ['manage_system']
    }
    return { pagesAny: ['candidates'], actionsAny, sensitiveRead: verb === 'GET' && /^\/api\/talents\/[^/]+$/.test(path) }
  }
  if (path.startsWith('/api/assessments')) return { pagesAny: ['interviews', 'candidates'], actionsAny: write ? ['manage_assessments'] : [] }
  if (path.startsWith('/api/interview-evaluations')) {
    let actionsAny: string[] = []
    if (write) {
      if (/\/feedback$|\/feedback-extract$|\/notes$|\/ai-draft$/.test(path)) actionsAny = ['submit_interview_feedback']
      else if (/\/decision$/.test(path)) actionsAny = ['review_candidate']
      else actionsAny = ['manage_assessments']
    }
    return { pagesAny: ['interviews'], actionsAny, sensitiveRead: verb === 'GET' }
  }
  if (path.startsWith('/api/interviews')) return { pagesAny: ['interviews'], actionsAny: write ? ['arrange_interview'] : [], sensitiveRead: verb === 'GET' && path.split('/').length > 3 }
  if (path.startsWith('/api/offers')) {
    const actionsAny = !write ? [] : path.endsWith('/approval') ? ['review_offer'] : ['manage_offer']
    return { pagesAny: ['offers'], actionsAny, sensitiveRead: verb === 'GET' }
  }
  if (path.startsWith('/api/background-checks')) return { pagesAny: ['candidates'], actionsAny: write ? ['manage_background'] : [], sensitiveRead: method === 'GET' }
  if (path.startsWith('/api/employee-lifecycle')) {
    const actionsAny = !write ? [] : path.includes('/tasks/') && path.endsWith('/complete') ? ['complete_resource_task', 'manage_employee_lifecycle'] : ['manage_employee_lifecycle']
    return { pagesAny: ['candidates', 'home'], actionsAny, sensitiveRead: verb === 'GET' }
  }
  if (path.startsWith('/api/referrals')) {
    const actionsAny = !write ? [] : path.endsWith('/campaigns') ? ['create_referral_campaign', 'manage_referrals'] : ['manage_referrals']
    return { pagesAny: ['referrals'], actionsAny }
  }
  if (path.startsWith('/api/messages')) return { pagesAny: ['home'], actionsAny: write ? ['manage_messages'] : [], sensitiveRead: method === 'GET' }
  if (path.startsWith('/api/governance')) {
    let actionsAny: string[] = []
    if (write) {
      if (path.includes('/transition')) actionsAny = ['advance_application']
      else if (path.includes('/tasks/') && path.endsWith('/action')) actionsAny = ['complete_resource_task', 'manage_governance']
      else actionsAny = ['manage_governance']
    }
    return { pagesAny: path.includes('/audits') ? ['settings'] : ['candidates', 'analytics'], actionsAny, sensitiveRead: verb === 'GET' && (path.includes('/audits') || path.includes('/timeline') || path.includes('/rating-history')) }
  }
  if (path.startsWith('/api/analytics')) return { pagesAny: ['analytics'], actionsAny: path.includes('/export') ? ['export_authorized_data'] : [], sensitiveRead: path.includes('/drilldown') || path.includes('/export') }
  if (path.startsWith('/api/resumes')) {
    if (path.includes('/api-config')) return { pagesAny: ['resume_api'], actionsAny: ['manage_resume_api'] }
    if (/\/(?:identity-backfill|backfill-identity)$/.test(path)) return { pagesAny: ['resume_parse'], actionsAny: ['manage_system'] }
    return { pagesAny: ['candidates', 'resume_parse'], actionsAny: write ? ['edit_candidate'] : [] }
  }
  if (/^\/api\/jobs\/[^/]+$/.test(path) && ['GET', 'HEAD'].includes(verb)) return {}
  return { pagesAny: ['settings'], actionsAny: ['manage_system'] }
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly access: RoleAccessService) {}
  async canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true
    const request = context.switchToHttp().getRequest<Request>(), policy = resolveAccessPolicy(request.method, request.path)
    if (policy.public) return true
    const jobId = ['GET', 'HEAD'].includes(request.method.toUpperCase()) ? /^\/api\/jobs\/([^/]+)$/.exec(request.path)?.[1] : undefined
    if (jobId && jobs.isPublic(jobId)) return true
    const resolved = await this.access.getRequestAccess(request.headers as Record<string, string | string[] | undefined>)
    if (!resolved) throw new UnauthorizedException('未获取到可信登录身份')
    ;(request as any).recruitmentAccess = resolved
    ;(request as any).recruitmentAccessPolicy = policy
    if (jobId) {
      const jobAccess = jobs.getAccess(jobId)
      if (!jobAccess || jobAccess.userId !== resolved.identity.userId) throw new ForbiddenException('无权读取其他用户或系统后台任务')
      if (jobAccess.pagesAny?.length && !jobAccess.pagesAny.some((page) => this.access.hasPage(resolved.profile, page))) throw new ForbiddenException('该任务的页面权限已被收回')
      if (jobAccess.actionsAny?.length && !jobAccess.actionsAny.some((action) => this.access.hasAction(resolved.profile, action))) throw new ForbiddenException('该任务的操作权限已被收回')
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase()) && /^\/api\/referrals\/(?!campaigns$)/.test(request.path) && !resolved.profile.dataScopes.some((scope) => ['all', 'business_unit', 'assigned_departments'].includes(scope.type)) && !resolved.profile.actions.includes('*')) throw new ForbiddenException('个人内推权限不能审核内推或管理奖励')
    if (policy.pagesAny?.length && !policy.pagesAny.some((page) => this.access.hasPage(resolved.profile, page))) throw new ForbiddenException(`当前角色没有页面权限：${policy.pagesAny.join(' / ')}`)
    if (policy.actionsAny?.length && !policy.actionsAny.some((action) => this.access.hasAction(resolved.profile, action))) throw new ForbiddenException(`当前角色没有操作权限：${policy.actionsAny.join(' / ')}`)
    if (/^\/api\/interviews\/(appointments|scheduling-candidate|reschedule-jobs|reminders)(\/|$)/.test(request.path)
      || /^\/api\/interview-evaluations\/(workbench|analytics|interviews|feedback-sla|before-interviews)(\/|$)/.test(request.path)) {
      const scope = await this.access.interviewScope(resolved.identity, resolved.profile)
      ;(request as any).interviewAccessScope = scope
      const interviewId = /^\/api\/interviews\/appointments\/([^/]+)/.exec(request.path)?.[1]
        || /^\/api\/interview-evaluations\/interviews\/([^/]+)/.exec(request.path)?.[1]
        || (request.path === '/api/interviews/scheduling-candidate' ? request.body?.interviewId : '')
      if (interviewId) await this.access.assertInterviewAccess(String(interviewId), scope)
      const rescheduleJobId = /^\/api\/interviews\/reschedule-jobs\/([^/]+)$/.exec(request.path)?.[1]
      if (rescheduleJobId && jobs.getAccess(rescheduleJobId)?.userId !== resolved.identity.userId) throw new ForbiddenException('无权读取其他用户的改期任务')
      if (!scope.all && /\/(reminders|feedback-sla|before-interviews)\/check$/.test(request.path)) throw new ForbiddenException('仅管理员可以执行全局面试检查')
      if (!scope.all && request.method === 'POST' && /\/interviews\/[^/]+\/feedback$/.test(request.path) && !scope.userIds.includes(String(request.body?.interviewerUserId || ''))) throw new ForbiddenException('不能代替其他面试官提交评价')
    }
    this.access.rememberRequestAccess(request.headers, resolved)
    return true
  }
}
