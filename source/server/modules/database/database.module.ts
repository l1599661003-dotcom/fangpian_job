import { Global, Module } from '@nestjs/common'
import { DatabaseService } from './database.service'
import { RoleAccessService } from './role-access.service'
import { DatabaseController } from './database.controller'
import { AccessController } from './access.controller'
import { AccessAdminController } from './access-admin.controller'
import { AccessAdminService } from './access-admin.service'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AccessGuard } from './access.guard'
import { AccessAuditInterceptor } from './access-audit.interceptor'
import { BackgroundActionsInterceptor } from '../../platform/background-actions'

@Global()
@Module({
  controllers: [DatabaseController, AccessController, AccessAdminController],
  providers: [DatabaseService, RoleAccessService, AccessAdminService, { provide: APP_GUARD, useClass: AccessGuard }, { provide: APP_INTERCEPTOR, useClass: BackgroundActionsInterceptor }, { provide: APP_INTERCEPTOR, useClass: AccessAuditInterceptor }],
  exports: [DatabaseService, RoleAccessService, AccessAdminService],
})
export class DatabaseModule {}
