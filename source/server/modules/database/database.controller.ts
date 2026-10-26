import { Controller, Get, Post } from '@nestjs/common'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseService } from './database.service'

@Controller('api/health')
export class DatabaseController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  health() {
    const database = this.database.getHealth()
    return {
      status: database.ready ? 'ok' : 'degraded',
      service: 'fangpian-talent-management',
      time: new Date().toISOString(),
      database,
    }
  }

  @Get('database')
  databaseHealth() {
    return this.database.getHealth()
  }

  @Get('system')
  systemStatus() {
    const root = process.cwd()
    let manifest: any = {}
    try { manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) } catch {}
    const database = this.database.getHealth()
    return {
      service: 'fangpian-talent-management',
      version: process.env.APP_VERSION || manifest.version || 'unknown',
      environment: process.env.NODE_ENV || 'development',
      runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        uptimeSeconds: Math.round(process.uptime()),
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        productionEntry: 'dist/main.js',
        productionEntryPresent: existsSync(join(root, 'dist', 'main.js')),
        staticClientPresent: existsSync(join(root, 'dist', 'client', 'index.html')),
      },
      build: {
        releaseId: process.env.STUDIO_RELEASE_ID || process.env.APP_RELEASE_ID || '',
        revision: process.env.APP_REVISION || process.env.GIT_COMMIT_SHA || '',
        packageManager: manifest.packageManager || '',
      },
      dependencies: Object.entries(manifest.dependencies || {}).map(([name, version]) => ({ name, version })),
      configuration: {
        platformUrl: Boolean(process.env.STUDIO_PLATFORM_URL),
        appToken: Boolean(process.env.STUDIO_APP_TOKEN),
        teableBinding: Boolean(process.env.STUDIO_TEABLE_BASE_ID) || database.ready,
        accessControlMode: process.env.ACCESS_CONTROL_MODE || 'audit',
        trustedIdentityHeaders: {
          userId: process.env.STUDIO_IDENTITY_USER_ID_HEADER || 'x-studio-user-id',
          userName: process.env.STUDIO_IDENTITY_USER_NAME_HEADER || 'x-studio-user-name',
        },
      },
      database,
      checkedAt: new Date().toISOString(),
    }
  }

  @Post('database/retry')
  retryDatabase() {
    return this.database.retryInitialization()
  }
}
