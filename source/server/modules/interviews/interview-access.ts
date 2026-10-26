import { ForbiddenException } from '@nestjs/common'
import type { Request } from 'express'
import type { TeableRecord } from '../../platform/teable'

export interface InterviewAccessScope { all: boolean; userIds: string[] }

export function canReadInterview(row: TeableRecord, scope?: InterviewAccessScope): boolean {
  if (!scope || scope.all) return true
  let interviewers: unknown = []
  try { interviewers = JSON.parse(String(row.fields['面试官用户IDJSON'] || '[]')) } catch {}
  const assigned = Array.isArray(interviewers) ? interviewers.map(String) : []
  const organizer = String(row.fields['组织者用户ID'] || '')
  return scope.userIds.some(userId => Boolean(userId) && (assigned.includes(userId) || organizer === userId))
}

export function requestInterviewScope(request: Request): InterviewAccessScope {
  const scope = (request as Request & { interviewAccessScope?: InterviewAccessScope }).interviewAccessScope
  if (!scope) throw new ForbiddenException('未获取到可信面试访问范围')
  return scope
}
