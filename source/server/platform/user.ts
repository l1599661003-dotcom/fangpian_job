import type { Request } from 'express'

// Studio 反代时会注入 X-Studio-User-* 头, 后续真 OIDC 接通这里就同步切.
// 业务代码统一通过 getStudioUser(req) 拿当前用户, 不直接读 header.
export interface StudioUser {
  id: string
  name: string
  teamId: string
}

export function getStudioUser(req: Request): StudioUser | null {
  const id = (req.headers['x-studio-user-id'] as string) || ''
  if (!id) return null
  return {
    id,
    name: (req.headers['x-studio-user-name'] as string) || '',
    teamId: (req.headers['x-studio-team-id'] as string) || '',
  }
}
