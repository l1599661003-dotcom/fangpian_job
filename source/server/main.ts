import 'reflect-metadata'
import { BadRequestException, Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.enableCors()
  app.useGlobalFilters({
    catch(exception: any, host: any) {
      const response = host.switchToHttp().getResponse()
      const status = typeof exception?.getStatus === 'function' ? exception.getStatus() : 500
      const payload = typeof exception?.getResponse === 'function' ? exception.getResponse() : null
      const message = typeof payload === 'string' ? payload : payload?.message || (status >= 500 ? '服务器处理失败' : exception?.message)
      if (status >= 500) new Logger('HttpError').error(exception?.stack || exception)
      response.status(status).json({ statusCode: status, message, error: payload?.error || (status >= 500 ? 'Internal Server Error' : 'Request Error') })
    },
  } as any)
  const port = Number(process.env.PORT || 3000)
  await app.listen(port, '0.0.0.0')
  new Logger('Bootstrap').log(`ResumeFlow server listening on ${port}`)
}

bootstrap().catch((error) => {
  if (error instanceof BadRequestException) console.error(error.message)
  else console.error(error)
  process.exit(1)
})
