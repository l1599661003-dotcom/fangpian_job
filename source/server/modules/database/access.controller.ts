import { Body, Controller, Get, Headers, Post, Req, Res, UnauthorizedException } from '@nestjs/common'
import type { Request, Response } from 'express'
import { EMPLOYEE_SESSION_COOKIE_EXPIRES_AT, RoleAccessService } from './role-access.service'
import { AccessAdminService } from './access-admin.service'

@Controller('api/access')
export class AccessController {
  constructor(private readonly access: RoleAccessService, private readonly administration: AccessAdminService) {}

  private requestUsesHttps(request: Request) {
    const forwardedProto = request.headers['x-forwarded-proto']
    const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto
    return request.secure || String(protocol || '').split(',')[0]?.trim() === 'https'
  }

  private setSessionCookie(response: Response, token: string, expiresAt: string, request: Request) {
    response.cookie('rf_session', token, {
      httpOnly: true, sameSite: 'lax', secure: this.requestUsesHttps(request), path: '/',
      expires: new Date(expiresAt),
    })
  }

  @Get('me')
  async me(@Headers() headers: Record<string, string | string[] | undefined>, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const identity = await this.access.resolveRequestIdentity(headers)
    const enforcement = process.env.ACCESS_CONTROL_MODE || 'audit'
    if (!identity) return { authenticated: false, authorized: false, accessState: 'identity_unavailable', enforcement, identitySource: 'unavailable', roleCodes: [], pages: [], actions: [], dataScopes: [], sensitiveFields: [] }
    if (identity.source === 'session') {
      const token = this.access.sessionTokenForCookie(headers)
      if (token) this.setSessionCookie(response, token, EMPLOYEE_SESSION_COOKIE_EXPIRES_AT, request)
    }
    const [profile, account] = await Promise.all([this.access.getUserAccess(identity.userId), this.administration.account(identity.userId)])
    const accessState = !account ? 'unregistered' : account.status === '停用' ? 'disabled' : account.status !== '启用' ? 'pending' : !profile.roleCodes.length ? 'no_role' : !account.mobile ? 'profile_incomplete' : 'active'
    if (accessState === 'active' && process.env.LOCAL_EMPLOYEE_LOGIN !== 'true') await this.access.auditAccess(profile, identity.userName, request, '登录并读取当前权限', '成功')
    return { authenticated: true, authorized: accessState === 'active', accessState, enforcement, identitySource: identity.source, ...profile, account, userName: account?.name || identity.userName }
  }

  @Post('login')
  async login(@Body() body: { name?: string; mobile?: string }, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.access.loginWithEmployeeProfile(body || {}, { ip: request.ip || request.socket.remoteAddress || '', userAgent: String(request.headers['user-agent'] || '') })
    this.setSessionCookie(response, result.token, result.expiresAt, request)
    return { authenticated: true, message: '登录成功', expiresAt: result.expiresAt }
  }

  @Post('logout')
  async logout(@Headers() headers: Record<string, string | string[] | undefined>, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.access.logoutSession(headers)
    response.clearCookie('rf_session', { httpOnly: true, sameSite: 'lax', secure: this.requestUsesHttps(request), path: '/' })
    return { loggedOut: true }
  }

  @Post('heartbeat')
  async heartbeat(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.access.recordLoginHeartbeat(headers)
  }

  @Post('apply')
  async apply(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: any) {
    const identity = await this.access.resolveRequestIdentity(headers)
    if (!identity) throw new UnauthorizedException('未获取到可信企业身份，请从企业入口重新进入')
    return this.administration.applyForAccess(identity, body || {})
  }

  @Post('profile')
  async profile(@Headers() headers: Record<string, string | string[] | undefined>, @Body() body: any) {
    const identity = await this.access.resolveRequestIdentity(headers)
    if (!identity) throw new UnauthorizedException('未获取到可信企业身份，请从企业入口重新进入')
    return this.administration.completeProfile(identity, body || {})
  }
}
