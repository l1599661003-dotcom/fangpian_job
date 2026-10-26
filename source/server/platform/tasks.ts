// 定时任务平台框架 — 让应用用一行 defineTask() 声明一个会按时自动执行的后台任务,
// 执行记录与"交付物(产出文件)"自动落到应用自带的 Teable, Studio 开发页「定时任务」TAB
// 直接读这两张表展示, 并能远程停用/启用。
//
// ⚠️ 只有"发布后的应用"会按时**自动**执行 (见 EXECUTE_TASKS)。开发/预览态 (在 Studio 编辑器里
//    跑的 session pod) 只登记+展示任务, 不起 cron —— 否则会与发布 pod 同 tick 双跑。
//    **但预览态可以手动触发**, 这是发布前验证任务真能跑通的正确姿势 (必须实际触发一次验证,
//    不要只看代码"应该没问题" —— 预览态 curl 通不代表发布态可用, 反之亦然):
//      curl -X POST "http://localhost:${PORT:-4001}/api/studio-tasks/<任务名(URL编码)>/run-now"
//    同步等执行完, 返回 { status: 'success'|'failed', durationMs, artifacts, error }; 执行记录
//    照常落 Teable (Trigger=manual), Studio「定时任务」TAB 可见。发布态该端点也在，
//    由应用统一登录和 manage_system 权限保护，浏览器无需接触平台密钥。
//
// ⚠️ handler 里不要吞错: 失败就让异常抛出去 —— 框架会把这次执行记成 failed (Error 进 Teable,
//    Studio TAB 可见, 任务行 LastStatus/LastError 同步更新)。try/catch 后静默 return 会把失败
//    伪装成 success, 用户完全无感 (真实事故教训)。要重试/降级可以, 但最终没做成就必须抛。
//
// ⚠️ 为什么用平台框架而不是自己 setInterval / node-cron:
//   - 应用 pod 的本地磁盘是临时的, 自己记执行历史/产物 = 重启即丢。这里把历史和文件
//     分别落 Teable 和对象存储 (storage SDK), 才真正持久, 且 Studio 能展示。
//   - 停用/启用是写 Teable 的 Enabled 字段 (单一事实源), 框架按它实时启停 cron,
//     Studio 那个开关才真正生效。
//
// ⚠️ 真相源 = Teable, 不是代码:
//   defineTask 里的 cron/schedule/description 只是"种子默认值" —— 只在任务第一次出现时
//   写进 Teable。之后用户能在 Studio「定时任务」页改 cron/频率/描述/启停/删除, 这些以
//   Teable 为准, 框架每 ~30s 据此 reschedule。代码改了某字段才会再同步过去 (按字段比较,
//   不覆盖用户的改动; 机制见 reconcileMeta)。所以: 改已存在任务的频率, 改代码或改页面都行;
//   "删除"是 Teable 打墓碑 (Deleted), 要彻底去掉请把这段 defineTask 代码也删掉。
//   handler (业务逻辑) 只能在代码里写, 这是 Studio 页面无法"新建"任务的原因。
//
// 用法 (AI 在 server/tasks/ 下建一个文件, 任意命名):
//
//   import { defineTask } from '../platform/tasks'
//
//   defineTask({
//     name: '每日销售汇总',                       // 唯一标识, 建后别改 (改名=新任务, 历史断开)
//     description: '每天 9 点汇总昨日订单, 导出 Excel',
//     cron: '0 9 * * *',                          // 标准 5 段 cron (分 时 日 月 周); 6 段则首段为秒
//     schedule: '每天 09:00',                      // 人读频率, 展示在 Studio (与 cron 含义一致)
//     handler: async ({ deliver, log }) => {
//       const buf = await buildXlsx()             // 你的业务逻辑
//       await deliver('2026-06-04-销售汇总.xlsx', buf)  // 产出文件 = 交付物, 自动传对象存储+记录
//       log('已生成昨日报表')
//     },
//   })
//
// 然后在 app.module.ts 的 business-modules 段 import { TasksModule } 并加进 imports 即可
// (ScheduleModule.forRoot() 也要在 imports 里, 见 app.module.ts 注释)。
//
// 交付物 (deliver) 说明:
//   - deliver(filename, bytes, contentType?) 把文件传到对象存储, 返回 { name, url, size }。
//   - 一次执行可多次 deliver, 全部记进这次 run 的 Artifacts; Studio TAB 按文件名展示+可下载。
//   - 文件实体在对象存储/CDN, Teable 只存清单 (文件名 + url + 大小), 不存二进制。
//   - ★兜底: handler 执行期间**直接用 storage SDK 传的文件也会自动记成交付物** ——
//     不必为了让它显示出来专门改写成 deliver。收尾时框架会 HEAD 一次做实(确认真传上去了、
//     顺便取大小), 没传成功的不登记。单次执行最多自动登记 20 份。
//     deliver 仍是推荐写法: 它当场返回 url 和 size, 也不依赖 HEAD 能不能打通。

import {
  Module, Injectable, OnModuleInit, OnModuleDestroy,
  Controller, Get, Post, Patch, Param, Body,
  NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common'
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule'
import { CronJob, CronTime } from 'cron'

import { teable } from './teable'
import { ReadCache } from './read-cache'
import { storage } from './storage'
import { jobs } from './jobs'
import { AsyncLocalStorage } from 'node:async_hooks'

// ---- 执行期间的「上传登记簿」: 让走 storage SDK 传上去的文件也算交付物 ----
//
// ⚠️ 为什么整段内联在本文件里, 不拆成单独模块:
//   本文件是**会被平台 overlay 进存量 app** 的四个框架文件之一
//   (session-runtime 的 task_framework_overlay.py 只下发 tasks/jobs/im/mcp 四个)。
//   拆出去的话, 存量 app 收到的新 tasks.ts 会 import 一个它那儿根本不存在的文件 →
//   tsc 报错 → tsc-watch 永不 onSuccess → server 不监听 → 预览 503「启动不了」。
//   (同一形态的真实事故见本文件 overlay 脚本里 8vva 那一段。)
//   同理也不能改 storage.ts —— 它不在下发清单里, 改了对存量 app 等于没改。
//   所以这里用**运行时包装** storage.getUploadUrl: 不依赖 storage.ts 的内容, 存量 app 照样生效。
//
// ⚠️ 为什么用 AsyncLocalStorage 而不是模块级变量:
//   多个任务的 cron 可能撞在同一分钟并发跑, 模块级变量会把 A 任务的上传记到 B 名下 ——
//   而且不报错, 只表现为"交付物列表里多了几个不认识的文件"。ALS 跟着 async 调用链走。
//   包装是全局一次性的, 但**只在任务执行的 ALS 作用域里**才记账 ——
//   普通 HTTP 请求里的上传落在作用域外, 是彻底的空操作。

interface NotedUpload { name: string; url: string; at: string }

/** 单次执行最多自动登记多少个。交付物那一列是给人看的清单, 不是文件系统。 */
const AUTO_ARTIFACT_CAP = 20

class UploadScope {
  readonly items: NotedUpload[] = []
  dropped = 0
  note(u: NotedUpload): void {
    if (this.items.length >= AUTO_ARTIFACT_CAP) { this.dropped++; return }
    this.items.push(u)
  }
}

const uploadALS = new AsyncLocalStorage<UploadScope>()

// 一次性包装 storage.getUploadUrl。重复 import 不会二次包装 (加了标记位)。
const _storageAny = storage as any
if (!_storageAny.__taskArtifactHooked) {
  const orig = _storageAny.getUploadUrl.bind(storage)
  _storageAny.getUploadUrl = async (filename: string, contentType: string, expiresIn?: number) => {
    const res = await orig(filename, contentType, expiresIn)
    try {
      uploadALS.getStore()?.note({ name: filename, url: res?.cdnUrl || '', at: new Date().toISOString() })
    } catch { /* 登记失败绝不能影响上传本身 —— 这是兜底功能, 不是主链路 */ }
    return res
  }
  _storageAny.__taskArtifactHooked = true
}

/**
 * HEAD 确认对象真的在, 返回字节数; 确认不到返回 null。
 *
 * 拿不到 Content-Length 但 HEAD 是 2xx 时返回 0 —— 文件确实存在, 只是大小未知,
 * "大小显示 0"好过"整条交付物不显示"。
 *
 * ★★ 必须重试 (2026-09-01 dev 真机实测才发现):
 *   刚 PUT 上去的对象在 CDN 边缘还没有, 紧接着 HEAD 会失败。实测同一个任务
 *   **第一次执行交付物被丢掉、第二次才登记上** —— 而第一次那个 URL 事后再 HEAD 是 200。
 *   日报类任务每天只跑一次, 每次都是"新对象的第一次访问", 落到这个窗口里就等于
 *   **这个功能对它永远不生效**, 而且悄无声息。只试一次是不够的。
 *   退避总时长控制在 ~7s: 比 CDN 回源取一次的时间宽裕, 又不会把任务收尾拖长太多。
 */
async function headContentLength(url: string): Promise<number | null> {
  const backoffMs = [0, 500, 1500, 2500, 2500]
  for (let i = 0; i < backoffMs.length; i++) {
    if (backoffMs[i]) await new Promise(r => setTimeout(r, backoffMs[i]))
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const len = Number(res.headers.get('content-length') || '')
        return Number.isFinite(len) && len >= 0 ? len : 0
      }
    } catch {
      // 网络抖动/超时 —— 继续重试, 别在这里就放弃
    }
  }
  return null
}

// ---- 两张 Teable 表的稳定表名 (建后绝不改, 改名=指向新空表, 历史读不到) ----
const TASKS_TABLE = 'ScheduledTasks'      // 任务注册表 + 控制面 (Studio TAB 主列表)
const RUNS_TABLE = 'ScheduledTaskRuns'    // 每次执行的历史记录

// 控制同步周期: 每隔这么久读一次 Teable 的 Enabled, 据此启停 cron。
// Studio 开关写 Teable → 最长这么久后在 pod 内生效。
const CONTROL_SYNC_MS = 30_000

// 默认时区: 应用用户基本在国内, cron 按北京时间解读最符合直觉。可在 defineTask 里覆盖。
const DEFAULT_TZ = process.env.TZ || 'Asia/Shanghai'

// 日期字段的格式化: 必须带时间 (HH:mm)。Teable 对 date 字段按**显示精度**排序,
// 默认只到"天"→ desc 拿"最新一天"而非"最新一条", 依赖时序的查询全歪 (dev 实测)。
// 只影响新建字段; 存量表字段格式在 Teable 页面手工改或另行迁移。
const DATE_TIME_OPTS = {
  formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: DEFAULT_TZ },
}

// ★ 只有"发布后的生产 pod"才真正按时执行 cron。预览/开发 session pod (STUDIO_INSPECT=1)
// 只登记 + 展示任务 (建表/种子行让 Studio「定时任务」TAB 正常显示), 但绝不起 cron。
// 原因: 开发态 session pod 与发布 pod **共享同一个 Teable base**, 若两者都执行, 同一 tick
// 会双跑 (跨 pod 秒级去重只是 best-effort, 竞态/时钟偏差会漏)。且开发态本就不该产生生产副作用。
// 判据: 发布 pod = NODE_ENV=production 且无 STUDIO_INSPECT; 预览 pod 反之 (二者任一即视为预览)。
const EXECUTE_TASKS = process.env.NODE_ENV === 'production' && !process.env.STUDIO_INSPECT

// ---- defineTask 注册表 (模块级, import 副作用收集) ----

export interface TaskArtifact {
  name: string   // 文件名 (Studio TAB「交付物」列展示这个)
  url: string    // 对象存储/CDN 下载地址
  size: number   // 字节
  at: string     // 产出时间 ISO
}

export interface TaskContext {
  /** 产出一个文件 = 交付物。传 Buffer/Uint8Array/string; 自动传对象存储并记入本次执行。 */
  deliver(filename: string, bytes: Buffer | Uint8Array | string, contentType?: string): Promise<TaskArtifact>
  /** 写一行执行日志 (进 stdout, 便于排查; 不入库)。 */
  log(msg: string): void
  /** 本次计划触发时间 ISO (用于幂等/对账)。 */
  scheduledFor: string
}

export interface TaskDef {
  /** 唯一名称, 任务的稳定身份。建后别改。 */
  name: string
  /** 描述的种子默认值 (展示在 Studio TAB)。建后用户可在 Studio 改, 以 Teable 为准。 */
  description?: string
  /**
   * cron 表达式的种子默认值。5 段=分 时 日 月 周; 6 段则首段为秒。
   * 任务建后用户可在 Studio 改 cron, 以 Teable 为准; 你改这里的代码也会同步过去。
   */
  cron: string
  /**
   * 人类可读执行频率的种子默认值, 展示在 Studio TAB「执行频率」列 (如「每天 09:00」「每 10 分钟」)。
   * 纯展示标签, 不参与调度 (调度只认 cron), 务必与 cron 含义一致。不填则回退显示原始 cron。
   * 建后以 Teable 为准 (用户可改)。
   */
  schedule?: string
  /** 业务逻辑。用 ctx.deliver 产出文件 (交付物)。抛错=本次失败 (会记录, 不影响下次)。 */
  handler: (ctx: TaskContext) => Promise<void> | void
  /** 可选时区, 默认 Asia/Shanghai。 */
  timezone?: string
}

/** 一次执行的结果摘要 (run-now 同步返回; 详情在 Teable ScheduledTaskRuns)。 */
export interface RunResult {
  status: 'success' | 'failed'
  durationMs: number
  artifacts: TaskArtifact[]
  error?: string
  runRecordId: string | null
}

const registry: TaskDef[] = []

/** 声明一个定时任务。在 server/tasks/*.ts 里调用, 被 TasksModule 自动加载执行。 */
export function defineTask(def: TaskDef): void {
  if (!def?.name || !def?.cron || typeof def?.handler !== 'function') {
    console.error('[tasks] defineTask 缺 name/cron/handler, 已忽略:', def?.name)
    return
  }
  if (registry.some(t => t.name === def.name)) {
    console.warn(`[tasks] 任务名重复 "${def.name}", 后者覆盖前者`)
    const i = registry.findIndex(t => t.name === def.name)
    registry[i] = def
    return
  }
  registry.push(def)
}

// ---- 执行引擎 ----

@Injectable()
export class TasksService implements OnModuleInit, OnModuleDestroy {
  private dashboardCache = new ReadCache(2)
  private tasksTableId: string | null = null
  private runsTableId: string | null = null
  // name -> 在 ScheduledTasks 表里的 recordId (更新 RunCount / 状态用)
  private taskRecordId = new Map<string, string>()
  // name -> 当前 live cron job 使用的 cron 表达式 (检测 Teable 改了 cron 后需要 reschedule)
  private currentCron = new Map<string, string>()
  private initialized = false
  private timer: NodeJS.Timeout | null = null
  // 同一进程内防重: name@scheduledFor 正在跑就不再起
  private inFlight = new Set<string>()

  constructor(private readonly scheduler: SchedulerRegistry) {}

  onModuleInit(): void {
    if (registry.length === 0) return // 没有任务就不启动任何后台循环
    // 立即跑一次控制循环, 之后定时跑。init 失败会在下一拍自愈 (平台冷启动/瞬时 401)。
    void this.tick()
    this.timer = setInterval(() => void this.tick(), CONTROL_SYNC_MS)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    if (!EXECUTE_TASKS) {
      console.log('[tasks] 预览/开发态: 已登记任务并展示, 但不自动执行 cron (避免与发布 pod 双跑); '
        + '验证任务用 POST /api/studio-tasks/<name>/run-now 手动触发一次')
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
    for (const name of this.jobName(registry).values()) {
      try {
        const job = this.scheduler.getCronJob(name)
        job.stop()
      } catch { /* 未注册, 忽略 */ }
    }
  }

  private jobName(defs: TaskDef[]): Map<string, string> {
    // cron job 在 SchedulerRegistry 里的注册名, 加前缀避免与应用其它 job 撞名。
    const m = new Map<string, string>()
    for (const d of defs) m.set(d.name, `studio-task:${d.name}`)
    return m
  }

  private async tick(): Promise<void> {
    try {
      // ensureInit 两种模式都跑 (建表 + 种子行 → Studio TAB 能显示任务定义/历史);
      // 但只有发布生产 pod 才 syncControl (真正建/启停/触发 cron)。预览态到此为止。
      await this.ensureInit()
      if (EXECUTE_TASKS) await this.syncControl()
    } catch (e) {
      console.error('[tasks] 控制循环出错 (将在下一拍重试):', (e as Error)?.message || e)
    }
  }

  /** 幂等初始化: 建两张表 + 字段, 注册 (停止态) cron job, 回填任务行。失败不缓存, 下拍重试。 */
  private async ensureInit(): Promise<void> {
    if (this.initialized) return

    const tasks = await teable.ensureTable(TASKS_TABLE)
    const runs = await teable.ensureTable(RUNS_TABLE)
    this.tasksTableId = tasks.id
    this.runsTableId = runs.id

    await this.ensureFields(tasks.id, [
      { name: 'Name', type: 'singleLineText' },
      { name: 'Description', type: 'longText' },
      { name: 'Cron', type: 'singleLineText' },
      { name: 'Schedule', type: 'singleLineText' },
      { name: 'Enabled', type: 'checkbox' },
      // 删除墓碑: 用户在 Studio 删任务时置 true, 控制循环据此停掉并不再起 (代码还在也不复活)。
      { name: 'Deleted', type: 'checkbox' },
      // 代码上次声明的值 (种子基线): 用来区分"代码改了"vs"用户在 Studio 改了"——
      // 代码变 (def.X != CodeX) 才把生效值同步成代码值; 否则保留用户的改动。详见 reconcileMeta。
      { name: 'CodeCron', type: 'singleLineText' },
      { name: 'CodeSchedule', type: 'singleLineText' },
      { name: 'CodeDescription', type: 'longText' },
      { name: 'CreatedAt', type: 'date', options: DATE_TIME_OPTS },
      { name: 'RunCount', type: 'number' },
      { name: 'LastStatus', type: 'singleLineText' },
      { name: 'LastRunAt', type: 'date', options: DATE_TIME_OPTS },
      { name: 'LastDurationMs', type: 'number' },
      { name: 'LastArtifacts', type: 'longText' },
      { name: 'LastError', type: 'longText' },
    ])
    await this.ensureFields(runs.id, [
      { name: 'TaskName', type: 'singleLineText' },
      { name: 'ScheduledFor', type: 'singleLineText' },
      // 触发方式: cron=按时自动 / manual=run-now 手动触发 (预览验证或发布态授权触发)
      { name: 'Trigger', type: 'singleLineText' },
      { name: 'StartedAt', type: 'date', options: DATE_TIME_OPTS },
      { name: 'FinishedAt', type: 'date', options: DATE_TIME_OPTS },
      { name: 'Status', type: 'singleLineText' },
      { name: 'DurationMs', type: 'number' },
      { name: 'Artifacts', type: 'longText' },
      { name: 'Error', type: 'longText' },
    ])

    // 回填 / 复用任务行 (按 Name 找; 不存在才建)。只负责把代码声明 merge 进 Teable;
    // cron job 的注册/启停/reschedule 全部交给 syncControl (它每拍读 Teable 权威值)。
    const existing = await teable.listRecords(tasks.id, { take: 1000 })
    const byName = new Map<string, any>()
    for (const r of existing) byName.set(String(r.fields?.Name || ''), r)

    for (const def of registry) {
      const recId = await this.reconcileMeta(tasks.id, byName.get(def.name), def)
      if (recId) this.taskRecordId.set(def.name, recId)
    }

    this.initialized = true
    console.log(`[tasks] 初始化完成, ${registry.length} 个定时任务已登记 (调度由 Teable 权威驱动)`)
  }

  /**
   * 把代码声明 merge 进 Teable 任务行, 返回 recordId。
   * 真相源 = Teable (用户可在 Studio 改 cron/schedule/description/enabled), 代码只提供 handler
   * 与"种子默认值"。靠 Code* 列区分"代码改了"vs"用户改了":
   *   - 行不存在        → 按代码建行 (生效值 = Code* 基线 = 代码值)。
   *   - def.X != CodeX  → 代码自上次以来改了该字段 → 生效值与 CodeX 一起同步成代码值。
   *   - def.X == CodeX  → 代码没改 → 保留生效值 (用户在 Studio 的改动不被覆盖)。
   *   - CodeX 缺失      → 老行 (本特性前建的) 或用户先建的行 → 只记基线, 不动生效值。
   * 绝不覆盖 Enabled / Deleted (那是用户控制面)。
   */
  private async reconcileMeta(tableId: string, rec: any, def: TaskDef): Promise<string | null> {
    const wantSchedule = def.schedule || def.cron
    if (!rec) {
      const created = await teable.createRecord(tableId, {
        Name: def.name,
        Description: def.description || '',
        Cron: def.cron,
        Schedule: wantSchedule,
        CodeCron: def.cron,
        CodeSchedule: wantSchedule,
        CodeDescription: def.description || '',
        Enabled: true,
        CreatedAt: new Date().toISOString(),
        RunCount: 0,
        LastStatus: '',
      })
      return created.id
    }
    const f = rec.fields || {}
    const patch: Record<string, any> = {}
    this.mergeField(patch, f, 'Cron', 'CodeCron', def.cron)
    this.mergeField(patch, f, 'Schedule', 'CodeSchedule', wantSchedule)
    this.mergeField(patch, f, 'Description', 'CodeDescription', def.description || '')
    if (Object.keys(patch).length) {
      try { await teable.updateRecord(tableId, rec.id, patch) } catch (e) {
        // 非致命 (下拍重试), 但绝不静默 —— 静默吞错让排查无从下手
        console.error(`[tasks] 同步任务行 "${def.name}" 失败 (下拍重试):`, (e as Error)?.message || e)
      }
    }
    return rec.id
  }

  /** 单字段三向 merge, 见 reconcileMeta 说明。把要写的字段塞进 patch。 */
  private mergeField(
    patch: Record<string, any>, fields: any, effKey: string, codeKey: string, codeVal: string,
  ): void {
    const codeStored = fields[codeKey]
    if (codeStored === undefined || codeStored === null) {
      // 没有代码基线 (老行 / 用户先建的行): 只记基线, 采用现有生效值, 不覆盖。
      patch[codeKey] = codeVal
    } else if (String(codeStored) !== String(codeVal)) {
      // 代码改了该字段 → 同步生效值 + 基线。
      patch[effKey] = codeVal
      patch[codeKey] = codeVal
    }
    // 否则 (代码没改) → 保留生效值, 不动。
  }

  private async ensureFields(
    tableId: string,
    want: Array<{ name: string; type: string; options?: Record<string, any> }>,
  ): Promise<void> {
    const fields = await teable.listFields(tableId)
    const have = new Set(fields.map(f => f.name))
    for (const f of want) {
      if (!have.has(f.name)) {
        try { await teable.createField(tableId, f) } catch (e) {
          console.error(`[tasks] 建字段 ${tableId}.${f.name} 失败:`, (e as Error)?.message || e)
        }
      }
    }
  }

  /**
   * 每拍按 Teable (权威) 调和 live cron job —— 让用户在 Studio 改的 cron/启停/删除真正生效。
   * 对每个有 handler 的任务 (registry):
   *   - 行被删 (Deleted) 或没行 → 停掉并移除 job (代码还在也不复活)。
   *   - job 不存在 或 Teable 的 cron 变了 → 用 Teable 的 cron 重新建 job (cron 非法则跳过)。
   *   - 再按 Enabled 启/停。
   */
  private async syncControl(): Promise<void> {
    if (!this.tasksTableId) return
    const rows = await teable.listRecords(this.tasksTableId, { take: 1000 })
    const byName = new Map<string, any>()
    for (const r of rows) byName.set(String(r.fields?.Name || ''), r)

    const jobNames = this.jobName(registry)
    for (const def of registry) {
      const jobName = jobNames.get(def.name)!
      const row = byName.get(def.name)
      const f = row?.fields || {}

      // 墓碑 / 行缺失: 确保没有 live job。
      if (!row || f.Deleted === true) {
        this.removeJob(jobName)
        this.currentCron.delete(def.name)
        continue
      }

      const cron = String(f.Cron || def.cron)
      const enabled = f.Enabled !== false // 缺值视为启用

      // job 不存在或 cron 变了 → 重建 (用 Teable 权威的 cron)。
      if (!this.scheduler.doesExist('cron', jobName) || this.currentCron.get(def.name) !== cron) {
        this.removeJob(jobName)
        let job: CronJob
        try {
          job = new CronJob(cron, () => { void this.runTask(def) }, null, false, def.timezone || DEFAULT_TZ)
        } catch (e) {
          // Teable 里被填了非法 cron (用户手滑): 跳过这拍, 不崩溃; 修正后下拍自愈。
          console.error(`[tasks] 任务 "${def.name}" 的 cron "${cron}" 非法, 本拍跳过:`, (e as Error)?.message || e)
          this.currentCron.delete(def.name)
          continue
        }
        this.scheduler.addCronJob(jobName, job as any)
        this.currentCron.set(def.name, cron)
      }

      // 按 Enabled 启停。
      let job: CronJob
      try { job = this.scheduler.getCronJob(jobName) as any } catch { continue }
      const running = (job as any).running === true || (job as any).isActive === true
      if (enabled && !running) job.start()
      else if (!enabled && running) job.stop()
    }
  }

  /** 停掉并从 SchedulerRegistry 移除一个 cron job (不存在则忽略)。 */
  private removeJob(jobName: string): void {
    try {
      if (this.scheduler.doesExist('cron', jobName)) {
        try { this.scheduler.getCronJob(jobName).stop() } catch { /* ignore */ }
        this.scheduler.deleteCronJob(jobName)
      }
    } catch { /* ignore */ }
  }

  /** cron 触发一个任务: 防重 + 跨 pod 幂等占用, 然后走统一执行路径。 */
  private async runTask(def: TaskDef): Promise<void> {
    if (!this.tasksTableId || !this.runsTableId) return
    const scheduledFor = new Date().toISOString().replace(/\.\d+Z$/, 'Z') // 到秒
    const key = `${def.name}@${scheduledFor}`
    if (this.inFlight.has(key)) return
    this.inFlight.add(key)
    try {
      // 跨 pod 幂等兜底 (滚动更新瞬间可能两个 pod): 同名+同触发秒已有 run 就跳过。
      // Teable 无唯一约束, 这是 best-effort; 务必让任务本身幂等。
      // ★按 ScheduledFor (text, ISO 串字典序=精确时序) 而非 StartedAt (date 字段按显示
      // 精度排序, 默认只到"天", 忙日 >20 条时取不到最新的, 去重会漏)。
      const recent = await teable.listRecords(this.runsTableId, {
        take: 20,
        orderBy: [{ fieldId: 'ScheduledFor', order: 'desc' }],
      }).catch(() => [])
      const dup = recent.some(r => r.fields?.TaskName === def.name && r.fields?.ScheduledFor === scheduledFor)
      if (dup) return

      await this.executeRun(def, scheduledFor, 'cron')
    } finally {
      this.inFlight.delete(key)
    }
  }

  /**
   * 手动触发一次并同步等到执行完 —— 预览态验证任务的唯一途径 (预览不跑 cron), 发布态授权触发。
   * 返回本次执行结果; 任务不存在/正在跑/平台初始化失败都明确报错, 绝不静默。
   */

  // ---- 预设任务模板 ----
  // 每个模板对应 registry 中已 defineTask 的一个 handler。
  // 用户在页面上选模板 + 设置 cron，后端写 Teable 的 Cron/Schedule/Enabled 字段。
  // syncControl 会读 Teable 权威值来启停 cron，所以改完就生效。
  private static readonly TEMPLATES = [
    {
      key: 'batch-ai-analysis',
      name: 'AI岗位匹配补全',
      description: '自动为最新简历缺失AI分析或当前评分为0的人才生成分析，每次最多处理250份',
      defaultCron: '0 19 * * *',
      defaultSchedule: '每天 03:00（北京时间）',
      configurable: true,
    },
  ]

  listTemplates() {
    return TasksService.TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      defaultCron: t.defaultCron,
      defaultSchedule: t.defaultSchedule,
      timezone: registry.find(d => d.name === t.name)?.timezone || DEFAULT_TZ,
      configurable: t.configurable,
      // 标记该模板对应的任务是否已在 registry 中（即代码里有 handler）
      available: registry.some((d) => d.name === t.name),
    }))
  }

  /**
   * 更新任务的 cron/schedule/enabled（写 Teable，syncControl 下一拍生效）。
   * 也可以用来"从模板启用"一个任务：把 Enabled 设 true + 设 cron。
   */
  async updateTaskConfig(name: string, config: { cron?: string; schedule?: string; enabled?: boolean }): Promise<{ name: string; updated: boolean }> {
    await this.ensureInit()
    if (!this.tasksTableId) throw new Error('任务表未初始化')
    
    // 确认任务在 registry 中（有 handler）
    const def = registry.find((t) => t.name === name)
    if (!def) {
      throw new NotFoundException(`任务 "${name}" 不在已注册的任务列表中`)
    }

    // 找 Teable 行
    const rows = await teable.listRecords(this.tasksTableId, { take: 1000 })
    const row = rows.find((r) => String(r.fields?.Name || '') === name)
    if (!row) throw new NotFoundException(`任务 "${name}" 在任务表中不存在`)

    const patch: Record<string, any> = {}
    if (config.cron !== undefined) {
      // 验证 cron 格式（基本校验：5 段或 6 段）
      const parts = config.cron.trim().split(/\s+/)
      if (parts.length < 5 || parts.length > 6) {
        throw new BadRequestException('cron 格式不正确，应为5段标准cron（分 时 日 月 周），如：0 20 * * *')
      }
      try { new CronTime(config.cron.trim(), def.timezone || DEFAULT_TZ) }
      catch { throw new BadRequestException('执行时间无效，请检查分钟、小时、日期或高级 Cron 设置') }
      patch['Cron'] = config.cron.trim()
    }
    if (config.schedule !== undefined) {
      patch['Schedule'] = config.schedule.trim()
    }
    if (config.enabled !== undefined) {
      patch['Enabled'] = config.enabled
    }

    if (Object.keys(patch).length === 0) {
      return { name, updated: false }
    }

    await teable.updateRecord(this.tasksTableId, row.id, patch)
    return { name, updated: true }
  }


  async listForDashboard() {
    const tasks = registry.map((d) => ({ name: d.name, description: d.description || '', cron: d.cron || '', schedule: d.schedule || '', timezone: d.timezone || DEFAULT_TZ }))
    const taskRecords: any[] = []
    const runRecords: any[] = []
    try {
      const [taskRows, recentRows] = await this.dashboardCache.get('dashboard', 5000, [this.tasksTableId, this.runsTableId].filter((table): table is string => Boolean(table)), () => Promise.all([
        this.tasksTableId ? teable.listRecords(this.tasksTableId) : [],
        this.runsTableId ? teable.listRecords(this.runsTableId, { take: 50, orderBy: [{ field: 'StartedAt', order: 'desc' }] }) : [],
      ]))
      if (this.tasksTableId) {
        const rows = taskRows
        for (const row of rows) {
          taskRecords.push({
            name: String(row.fields['Name'] || ''),
            enabled: String(row.fields['Enabled'] ?? 'true') === 'true',
            lastStatus: String(row.fields['LastStatus'] || ''),
            lastRunAt: String(row.fields['LastRunAt'] || ''),
            lastError: String(row.fields['LastError'] || ''),
            runCount: Number(row.fields['RunCount'] || 0),
            cron: String(row.fields['Cron'] || ''),
            schedule: String(row.fields['Schedule'] || ''),
            description: String(row.fields['Description'] || ''),
          })
        }
      }
      if (this.runsTableId) {
        for (const row of recentRows) {
          runRecords.push({
            task: String(row.fields['TaskName'] || ''),
            trigger: String(row.fields['Trigger'] || ''),
            status: String(row.fields['Status'] || ''),
            startedAt: String(row.fields['StartedAt'] || ''),
            durationMs: Number(row.fields['DurationMs'] || 0),
            error: String(row.fields['Error'] || ''),
            artifacts: String(row.fields['Artifacts'] || '[]'),
          })
        }
      }
    } catch (e) {
      // 表可能还没建, 返回空
    }
    // Merge code-defined tasks with Teable records
    const merged = tasks.map((t) => {
      const rec = taskRecords.find((r) => r.name === t.name)
      return rec ? { ...t, ...rec } : { ...t, enabled: true, lastStatus: '', lastRunAt: '', lastError: '', runCount: 0 }
    })
    return { tasks: merged, recentRuns: runRecords }
  }


  async runNow(name: string): Promise<RunResult & { task: string; trigger: 'manual' }> {
    const def = registry.find(t => t.name === name)
    if (!def) {
      throw new NotFoundException(
        `任务 "${name}" 不存在 (已注册: ${registry.map(t => t.name).join(', ') || '无'})`)
    }
    await this.ensureInit() // 幂等; 平台不可用时让错误冒泡成 500, 让触发方看到真实原因
    const key = `${def.name}@manual`
    if (this.inFlight.has(key)) {
      throw new ConflictException(`任务 "${name}" 正在执行中, 等本次结束再触发`)
    }
    this.inFlight.add(key)
    try {
      const scheduledFor = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
      const result = await this.executeRun(def, scheduledFor, 'manual')
      return { task: name, trigger: 'manual', ...result }
    } finally {
      this.inFlight.delete(key)
    }
  }

  /** 统一执行路径 (cron/manual 共用): 记录 run + 跑 handler + 回写。永不 throw, 失败进返回值。 */
  private async executeRun(
    def: TaskDef, scheduledFor: string, trigger: 'cron' | 'manual',
  ): Promise<RunResult> {
    const startedAt = new Date().toISOString()
    let runRecordId: string | null = null
    const artifacts: TaskArtifact[] = []
    // 本次执行的上传登记簿:handler 里经 storage 传上去的文件会记进来, 收尾时做实成交付物。
    const uploadScope = new UploadScope()
    try {
      const runRec = await teable.createRecord(this.runsTableId!, {
        TaskName: def.name,
        ScheduledFor: scheduledFor,
        StartedAt: startedAt,
        Status: 'running',
        Trigger: trigger,
      })
      runRecordId = runRec.id

      const ctx: TaskContext = {
        scheduledFor,
        log: (msg: string) => console.log(`[task:${def.name}] ${msg}`),
        deliver: async (filename, bytes, contentType) => {
          const art = await this.deliver(filename, bytes, contentType)
          artifacts.push(art)
          return art
        },
      }

      // handler 允许是同步的(返回 void), 这里统一包成 async —— ALS 的作用域要覆盖整条 await 链。
      await uploadALS.run(uploadScope, async () => { await def.handler(ctx) })
      await this.absorbScopeUploads(def.name, uploadScope, artifacts)

      const finishedAt = new Date().toISOString()
      const durationMs = Date.parse(finishedAt) - Date.parse(startedAt)
      await this.finishRun(runRecordId, {
        Status: 'success', FinishedAt: finishedAt, DurationMs: durationMs,
        Artifacts: JSON.stringify(artifacts),
      })
      await this.bumpTask(def.name, { status: 'success', durationMs, artifacts, error: '' })
      return { status: 'success', durationMs, artifacts, runRecordId }
    } catch (e) {
      const finishedAt = new Date().toISOString()
      const durationMs = Date.parse(finishedAt) - Date.parse(startedAt)
      const error = String((e as Error)?.stack || (e as Error)?.message || e).slice(0, 4000)
      console.error(`[task:${def.name}] 执行失败:`, error)
      // ★失败的执行也要收:任务往往是"传完文件后面某步炸了", 那几份文件确实产出了,
      //   不收的话用户在失败记录里看到 0 个交付物, 比看到"传了 2 个然后失败"更难排查。
      await this.absorbScopeUploads(def.name, uploadScope, artifacts)
      if (runRecordId) {
        await this.finishRun(runRecordId, {
          Status: 'failed', FinishedAt: finishedAt, DurationMs: durationMs,
          Artifacts: JSON.stringify(artifacts), Error: error,
        })
      }
      await this.bumpTask(def.name, { status: 'failed', durationMs, artifacts, error })
      return { status: 'failed', durationMs, artifacts, error, runRecordId }
    }
  }

  private async deliver(
    filename: string,
    bytes: Buffer | Uint8Array | string,
    contentType?: string,
  ): Promise<TaskArtifact> {
    const body: Buffer = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes)
    const ct = contentType || guessContentType(filename)
    const presign = await storage.getUploadUrl(filename, ct)
    const put = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: presign.contentType ? { 'Content-Type': presign.contentType } : {},
      body: body as any, // Node Buffer 不在 DOM BodyInit 类型里, 运行时 (undici) 支持二进制 PUT
    })
    if (!put.ok) {
      throw new Error(`deliver 上传 "${filename}" 失败: ${put.status} ${await put.text().catch(() => '')}`)
    }
    return { name: filename, url: presign.cdnUrl, size: body.length, at: new Date().toISOString() }
  }

  /**
   * 把「执行期间经 storage 上传的文件」并进这次执行的交付物清单。
   *
   * ★ 为什么不是登记了就直接算数:预签名 ≠ 上传成功。应用可能 PUT 失败, 也可能只是把
   *   uploadUrl 发给了前端而前端根本没传。所以逐个 HEAD 一次做实 —— 对象真的在才登记,
   *   顺便从 Content-Length 拿到真实字节数。**宁可漏记, 也不能让用户点开一个 404。**
   *
   * ★ 按 url 去重:ctx.deliver 内部也走 storage.getUploadUrl, 它产出的那几份已经在
   *   artifacts 里了, 不去重就会每份出现两次。
   *
   * ★ 整段 best-effort:这是兜底功能, 网络抖动/HEAD 被挡都只是少记几份交付物,
   *   绝不能把一次本来成功的执行拖成失败。
   */
  private async absorbScopeUploads(
    taskName: string,
    scope: UploadScope,
    artifacts: TaskArtifact[],
  ): Promise<void> {
    try {
      if (scope.dropped > 0) {
        console.warn(`[task:${taskName}] 本次上传过多, ${scope.dropped} 份未登记进交付物清单`)
      }
      const known = new Set(artifacts.map(a => a.url))
      for (const u of scope.items) {
        if (!u.url || known.has(u.url)) continue
        const size = await headContentLength(u.url)
        if (size === null) {
          // ★必须留痕: 原先这里是彻底静默的 —— 交付物少了一份, 用户和排查的人都无从知道
          //   是"任务没产出"还是"平台没收进来"。这正是本次真机测试暴露出的那种静默失效。
          console.warn(`[task:${taskName}] 交付物 "${u.name}" 确认不到 (HEAD 多次未成功), 本次不登记: ${u.url}`)
          continue
        }
        artifacts.push({ name: u.name, url: u.url, size, at: u.at })
        known.add(u.url)
      }
    } catch (e) {
      console.error(`[task:${taskName}] 登记 storage 上传的交付物失败(不影响本次执行):`,
        (e as Error)?.message || e)
    }
  }

  private async finishRun(runRecordId: string, fields: Record<string, any>): Promise<void> {
    try { await teable.updateRecord(this.runsTableId!, runRecordId, fields) } catch (e) {
      console.error('[tasks] 回写 run 记录失败:', (e as Error)?.message || e)
    }
  }

  private async bumpTask(
    name: string,
    r: { status: string; durationMs: number; artifacts: TaskArtifact[]; error: string },
  ): Promise<void> {
    const recId = this.taskRecordId.get(name)
    if (!recId || !this.tasksTableId) return
    try {
      // 读当前 RunCount 再 +1 (best-effort; 看板数字, 偶发竞态不致命)。
      const cur = await teable.listRecords(this.tasksTableId, { take: 1000 })
        .then(rows => rows.find(x => x.id === recId))
        .catch(() => null)
      const runCount = Number(cur?.fields?.RunCount || 0) + 1
      await teable.updateRecord(this.tasksTableId, recId, {
        RunCount: runCount,
        LastStatus: r.status,
        LastRunAt: new Date().toISOString(),
        LastDurationMs: r.durationMs,
        LastArtifacts: JSON.stringify(r.artifacts),
        LastError: r.error,
      })
    } catch (e) {
      console.error('[tasks] 回写任务行失败:', (e as Error)?.message || e)
    }
  }
}

function guessContentType(filename: string): string {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  const map: Record<string, string> = {
    json: 'application/json', csv: 'text/csv', txt: 'text/plain', html: 'text/html',
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel', zip: 'application/zip',
  }
  return map[ext] || 'application/octet-stream'
}

// 手动触发端点: POST /api/studio-tasks/:name/run-now —— 预览态验证定时任务的唯一途径
// (预览不自动跑 cron)。该接口由应用统一 AccessGuard 限制为拥有 manage_system 权限的登录员工，
// 前端不接触 STUDIO_APP_TOKEN，避免发布态按钮永远无法使用。
// 手动执行只负责启动后台任务并立即返回 jobId，前端轮询 /api/jobs/:id，避免长任务撞网关超时。
@Controller('api/studio-tasks')
class StudioTasksController {
  constructor(private readonly svc: TasksService) {}

  @Get()
  async list() {
    return this.svc.listForDashboard()
  }

  @Get('templates')
  async templates() {
    return { templates: this.svc.listTemplates() }
  }

  @Patch(':name/config')
  async updateConfig(@Param('name') name: string, @Body() body: { cron?: string; schedule?: string; enabled?: boolean }) {
    return this.svc.updateTaskConfig(name, body)
  }

  @Post(':name/run-now')
  async runNow(@Param('name') name: string) {
    const jobId = jobs.start(async (progress) => {
      progress(`正在执行任务「${name}」`)
      return this.svc.runNow(name)
    })
    return { jobId, status: 'running' }
  }
}

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [TasksService],
  controllers: [StudioTasksController],
})
export class TasksModule {}
