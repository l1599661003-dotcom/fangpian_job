import http from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const staticDir = path.join(root, '..', 'client')
const port = Number(process.env.PORT || 3000)

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const aliases = new Map([
  ['/candidate', '/方片招聘网站原型.html'],
  ['/candidate/', '/方片招聘网站原型.html'],
  ['/meeting-room', '/会议室预订原型.html'],
  ['/meeting-room/', '/会议室预订原型.html'],
])

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(body)
}

async function resolveFile(pathname) {
  const aliasedPath = aliases.get(pathname) || pathname
  const decodedPath = decodeURIComponent(aliasedPath)
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '')
  const requestedPath = path.resolve(staticDir, relativePath)

  if (requestedPath !== staticDir && !requestedPath.startsWith(`${staticDir}${path.sep}`)) return null

  try {
    const metadata = await stat(requestedPath)
    if (metadata.isFile()) return requestedPath
    if (metadata.isDirectory()) {
      const directoryIndex = path.join(requestedPath, 'index.html')
      if ((await stat(directoryIndex)).isFile()) return directoryIndex
    }
  } catch {
    // Unknown client-side routes fall back to the restored single-page application.
  }

  return !path.extname(relativePath) ? path.join(staticDir, 'index.html') : null
}

const server = http.createServer(async (request, response) => {
  if (!request.url || !['GET', 'HEAD'].includes(request.method || 'GET')) {
    sendText(response, 405, 'Method Not Allowed')
    return
  }

  let pathname
  try {
    pathname = new URL(request.url, 'http://localhost').pathname
  } catch {
    sendText(response, 400, 'Bad Request')
    return
  }

  const filePath = await resolveFile(pathname)
  if (!filePath) {
    sendText(response, 404, 'Not Found')
    return
  }

  try {
    const metadata = await stat(filePath)
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': metadata.size,
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    })
    if (request.method === 'HEAD') response.end()
    else createReadStream(filePath).pipe(response)
  } catch (error) {
    console.error(error)
    sendText(response, 500, 'Internal Server Error')
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Fangpian recruitment platform listening on ${port}`)
})

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
