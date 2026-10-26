import { Controller, Get, Module, NotFoundException, Param } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'

export interface JobAccess { userId: string; pagesAny?: string[]; actionsAny?: string[] }
export const jobAccessContext = new AsyncLocalStorage<JobAccess>()

export type JobStatus = 'running' | 'done' | 'failed'
export interface JobRecord { id: string; status: JobStatus; progress: string; data?: any; error?: string; createdAt: string }

class JobRegistry {
  private records = new Map<string, JobRecord>()
  private access = new Map<string, JobAccess>()
  private publicJobs = new Set<string>()

  start(handler: (progress: (message: string) => void) => Promise<any>, options?: { publicPolling?: boolean }): string {
    const id = `job_${randomUUID().replaceAll('-', '')}`
    const record: JobRecord = { id, status: 'running', progress: '任务已创建', createdAt: new Date().toISOString() }
    this.records.set(id, record)
    const access = jobAccessContext.getStore()
    if (access) this.access.set(id, structuredClone(access))
    if (options?.publicPolling) this.publicJobs.add(id)
    void (async () => {
      try {
        record.data = await handler((message) => { record.progress = message })
        record.status = 'done'
        record.progress = '解析完成'
      } catch (error) {
        record.status = 'failed'
        record.progress = '解析失败'
        record.error = error instanceof Error ? error.message : String(error)
        console.error(`[ResumeFlow job ${id}] ${record.error}`)
      }
    })()
    return id
  }

  get(id: string) { return this.records.get(id) }
  getAccess(id: string) { return this.access.get(id) }
  isPublic(id: string) { return this.publicJobs.has(id) }
}

export const jobs = new JobRegistry()

@Controller('api/jobs')
class JobsController {
  @Get(':id')
  get(@Param('id') id: string) {
    const job = jobs.get(id)
    if (!job) throw new NotFoundException('解析任务不存在或已过期')
    return job
  }
}

@Module({ controllers: [JobsController] })
export class JobsModule {}
