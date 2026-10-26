import { BadRequestException, Injectable } from '@nestjs/common'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { storage } from '../../platform/storage'
import { ocr } from '../../platform/mcp'
import { MAX_FILE_SIZE, SUPPORTED_EXTENSIONS } from './resume.constants'
import { dateTokens, meaningfulResumeText } from './resume-quality'

const execFileAsync = promisify(execFile)
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff'])
const officeExtensions = new Set(['.doc', '.docx', '.odt', '.rtf'])

type AvatarCandidate = { bytes: Buffer; extension: string; contentType: string; width: number; height: number; score: number }

@Injectable()
export class ResumeFileService {
  validate(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('请选择简历文件')
    if (!file.buffer?.length) throw new BadRequestException('简历文件为空')
    if (file.size > MAX_FILE_SIZE || file.buffer.length > MAX_FILE_SIZE) throw new BadRequestException('简历文件不能超过 10MB')
    const extension = extname(file.originalname).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.includes(extension as any)) throw new BadRequestException('不支持的简历格式')
    if (file.mimetype?.startsWith('image/') && !imageExtensions.has(extension)) throw new BadRequestException('文件扩展名与 MIME 类型不一致')
    if (extension === '.pdf' && !file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new BadRequestException('文件内容不是有效的 PDF，请勿只修改扩展名')
    return extension
  }

  async saveOriginal(file: Express.Multer.File) {
    const safeName = file.originalname.replace(/[^\p{L}\p{N}._-]+/gu, '_')
    return storage.upload(`resumes/${randomUUID()}_${safeName}`, file.mimetype || 'application/octet-stream', file.buffer)
  }

  async extractText(file: Express.Multer.File, sourceUrl: string, progress: (message: string) => void, warn: (message: string) => void = () => undefined, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const extension = this.validate(file)
    if (extension === '.txt') {
      progress('正在读取文本简历')
      const encoding = file.buffer[0] === 0xff && file.buffer[1] === 0xfe ? 'utf-16le' : file.buffer[0] === 0xfe && file.buffer[1] === 0xff ? 'utf-16be' : 'utf-8'
      let text: string
      try { text = new TextDecoder(encoding, { fatal: true }).decode(file.buffer) } catch {
        try { text = new TextDecoder('gb18030', { fatal: true }).decode(file.buffer); warn('TXT 使用 GB18030 编码解码，请核对姓名及特殊字符。') } catch { throw new BadRequestException('TXT 编码无法识别，请另存为 UTF-8 后重试') }
      }
      text = text.replace(/^\uFEFF/, '').trim()
      if (!text || !meaningfulResumeText(text)) throw new BadRequestException('TXT 简历没有足够可读取的文字或存在乱码，请检查文件编码')
      return text
    }
    if (imageExtensions.has(extension)) {
      progress('正在进行 OCR 文字识别')
      return this.ocrText(sourceUrl)
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'resumeflow-'))
    const inputPath = join(tempDir, `input${extension}`)
    try {
      await writeFile(inputPath, file.buffer)
      if (extension === '.pdf') {
        progress('正在提取 PDF 文字')
        return await this.checkedPdfText(inputPath, sourceUrl, progress, warn, signal)
      }
      if (officeExtensions.has(extension)) {
        if (extension === '.docx' || extension === '.odt') {
          progress(extension === '.docx' ? '正在读取 Word 文字内容' : '正在读取 ODT 文字内容')
          const directText = await this.archiveDocumentText(inputPath, extension)
          if (directText && meaningfulResumeText(directText) && !(await this.hasEmbeddedDocumentImages(inputPath, extension))) return directText
        }
        progress('正在转换 Office 简历')
        try {
          await execFileAsync('libreoffice', [`-env:UserInstallation=file://${join(tempDir, 'office-profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', tempDir, inputPath], { timeout: 45_000, maxBuffer: 2_000_000 })
        } catch (error) {
          throw new BadRequestException(`文档转换失败：${error instanceof Error ? error.message : 'LibreOffice 执行错误'}`)
        }
        const pdfPath = join(tempDir, 'input.pdf')
        let pdfBytes: Buffer
        try { pdfBytes = await readFile(pdfPath) } catch { throw new BadRequestException('文档转换失败：没有生成 PDF 文件') }
        const converted = await storage.upload(`resumes/converted_${Date.now()}.pdf`, 'application/pdf', pdfBytes)
        return await this.checkedPdfText(pdfPath, converted.cdnUrl, progress, warn, signal)
      }
      throw new BadRequestException('不支持的简历格式')
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async hasEmbeddedDocumentImages(path: string, extension: string) {
    const { stdout } = await execFileAsync('unzip', ['-Z1', path], { timeout: 15_000, maxBuffer: 1_000_000 })
    return extension === '.docx' ? /^word\/media\//m.test(stdout) : /^Pictures\//m.test(stdout)
  }

  private async checkedPdfText(path: string, sourceUrl: string, progress: (message: string) => void, warn: (message: string) => void, signal?: AbortSignal) {
    const text = await this.pdfText(path)
    const metadata = await execFileAsync('pdfinfo', [path], { timeout: 10_000, maxBuffer: 1_000_000 }).then(result => result.stdout).catch(() => '')
    const count = Number(metadata.match(/^Pages:\s*(\d+)/m)?.[1])
    if (!count) {
      progress(text ? 'PDF 文本层不完整，正在进行 OCR' : 'PDF 文本层不可用，正在进行 OCR')
      warn('无法校验 PDF 总页数，OCR 结果需对照原件确认完整性。')
      return this.ocrText(sourceUrl)
    }
    if (count > 30) throw new BadRequestException('简历超过30页，请拆分后上传；系统不会只解析前几页')
    const pages = text.split('\f')
    const imagePages = await this.pdfImagePages(path)
    const result: string[] = []
    for (let index = 0; index < count; index += 1) {
      signal?.throwIfAborted()
      const pageText = pages[index]?.trim() || ''
      const reliable = meaningfulResumeText(pageText)
      if (!reliable && !imagePages.has(index + 1) && await this.isBlankPdfPage(path, index + 1)) {
        warn(`第${index + 1}页：检测为纯空白页，已跳过。`)
        result.push('')
        continue
      }
      if (reliable && !dateTokens(pageText).length && !imagePages.has(index + 1)) { result.push(pageText); continue }
      progress(`正在校验 PDF 第 ${index + 1}/${count} 页${reliable ? '的日期与可见原件' : '的扫描文字'}`)
      try {
        const visual = await this.ocrPdfPage(path, index + 1)
        signal?.throwIfAborted()
        if (!reliable) result.push(visual)
        else if (imagePages.has(index + 1) && visual.replace(/\s/g, '').length > pageText.replace(/\s/g, '').length * 1.5) {
          warn(`第${index + 1}页：包含大幅图片且文本层不完整，已使用整页画面OCR，请核对文字及分区。`)
          result.push(visual)
        }
        else if (JSON.stringify(dateTokens(pageText)) !== JSON.stringify(dateTokens(visual))) {
          warn(`第${index + 1}页：PDF文本层与画面OCR日期不一致，暂保留文本层内容，请打开原件复核日期。`)
          result.push(pageText)
        } else result.push(pageText)
      } catch (error) {
        signal?.throwIfAborted()
        if (!reliable) throw new BadRequestException(`第${index + 1}页识别失败，未保存不完整简历：${error instanceof Error ? error.message : 'OCR失败'}`)
        warn(`第${index + 1}页：画面校验失败，已保留文本层，请人工核对日期及完整性。`)
        result.push(pageText)
      }
    }
    const combined = result.join('\n\f\n')
    if (!meaningfulResumeText(combined)) throw new BadRequestException('PDF 没有足够可识别的简历文字，请检查是否为空白文件')
    return combined
  }

  private async isBlankPdfPage(path: string, page: number) {
    const prefix = `${path}.blank-${page}`
    const imagePath = `${prefix}.pgm`
    try {
      await execFileAsync('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '160', '-gray', path, prefix], { timeout: 10_000, maxBuffer: 1_000_000 })
      const bytes = await readFile(imagePath)
      const header = bytes.subarray(0, 80).toString('ascii').match(/^P5\s+(\d+)\s+(\d+)\s+255\s/)
      if (!header) return false
      const pixels = bytes.subarray(header[0].length)
      return pixels.length === Number(header[1]) * Number(header[2]) && pixels.every(value => value >= 250)
    } catch { return false } finally { await rm(imagePath, { force: true }).catch(() => undefined) }
  }

  private async pdfImagePages(path: string) {
    try {
      const { stdout } = await execFileAsync('pdfimages', ['-list', path], { timeout: 10_000, maxBuffer: 1_000_000 })
      const pages = new Set<number>()
      for (const line of stdout.split('\n')) {
        const columns = line.trim().split(/\s+/)
        if (/^\d+$/.test(columns[0]) && columns[2] === 'image' && Number(columns[3]) >= 600 && Number(columns[4]) >= 500) pages.add(Number(columns[0]))
      }
      return pages
    } catch { return new Set<number>() }
  }

  private async ocrPdfPage(path: string, page: number) {
    const prefix = `${path}.page-${page}`
    const imagePath = `${prefix}.png`
    await execFileAsync('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '2200', '-png', path, prefix], { timeout: 30_000, maxBuffer: 1_000_000 })
    try {
      const bytes = await readFile(imagePath)
      const uploaded = await storage.upload(`resumes/ocr/${randomUUID()}-${page}.png`, 'image/png', bytes)
      return await this.ocrText(uploaded.cdnUrl)
    } finally { await rm(imagePath, { force: true }) }
  }

  /** DOCX/ODT 本身是压缩 XML，优先直接读取正文，速度更快且不依赖 Office 转换进程。 */
  private async archiveDocumentText(path: string, extension: string) {
    const entry = extension === '.docx' ? 'word/document.xml' : 'content.xml'
    try {
      const { stdout } = await execFileAsync('unzip', ['-p', path, entry], { timeout: 15_000, maxBuffer: 12_000_000 })
      const text = stdout
        .replace(/<w:tab\b[^>]*\/>/g, ' ')
        .replace(/<\/w:tc>/g, '\t')
        .replace(/<w:br\b[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<text:line-break\b[^>]*\/>/g, '\n')
        .replace(/<\/text:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code) => {
          const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)
          return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
        })
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      return text.length >= 8 ? text : ''
    } catch {
      return ''
    }
  }

  /**
   * 从 PDF / DOCX / ODT 的嵌入图片中选出最接近证件照比例的图片。
   * 图片型简历不做整页裁切，避免把整张简历误作候选人头像。
   */
  async extractAvatar(file: Express.Multer.File): Promise<string> {
    const extension = this.validate(file)
    if (imageExtensions.has(extension) || extension === '.txt' || extension === '.rtf' || extension === '.doc') return ''
    const tempDir = await mkdtemp(join(tmpdir(), 'resumeflow-avatar-'))
    try {
      const inputPath = join(tempDir, `input${extension}`)
      const imagesPath = join(tempDir, 'images')
      await writeFile(inputPath, file.buffer)
      await mkdir(imagesPath, { recursive: true })
      if (extension === '.pdf') {
        // -png 统一产出可直接浏览的图片；扫描页本身通常不会以嵌入头像形式出现。
        await execFileAsync('pdfimages', ['-png', inputPath, join(imagesPath, 'image')], { timeout: 20_000, maxBuffer: 1_000_000 }).catch(() => undefined)
      } else if (extension === '.docx' || extension === '.odt') {
        const archivePath = extension === '.docx' ? 'word/media/*' : 'Pictures/*'
        await execFileAsync('unzip', ['-qq', '-j', inputPath, archivePath, '-d', imagesPath], { timeout: 20_000, maxBuffer: 1_000_000 }).catch(() => undefined)
      }
      const avatar = await this.pickAvatar(imagesPath)
      if (!avatar) return ''
      const base = basename(file.originalname, extname(file.originalname)).replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'resume'
      const stored = await storage.upload(`resumes/avatars/${Date.now()}_${base}.${avatar.extension}`, avatar.contentType, avatar.bytes)
      return stored.cdnUrl
    } catch {
      // 头像只是展示增强项，不将文档图片格式差异放大为整份简历失败。
      return ''
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async pickAvatar(imagesPath: string): Promise<AvatarCandidate | null> {
    const entries = await readdir(imagesPath, { withFileTypes: true }).catch(() => [])
    const candidates: AvatarCandidate[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const bytes = await readFile(join(imagesPath, entry.name)).catch(() => null)
      if (!bytes) continue
      const meta = this.imageMeta(bytes)
      if (!meta) continue
      const { width, height, extension, contentType } = meta
      const ratio = width / height
      const area = width * height
      // 头像通常为中小尺寸的近方形或竖版图片。排除图标、横向 Logo 与整页背景图。
      if (width < 80 || height < 80 || area < 8_000 || area > 1_800_000 || ratio < 0.55 || ratio > 1.25) continue
      const ratioScore = Math.max(0, 1 - Math.abs(ratio - 0.78) / 0.47) * 100
      const sizeScore = Math.max(0, 1 - Math.abs(Math.log10(area) - 4.6) / 1.7) * 35
      candidates.push({ bytes, extension, contentType, width, height, score: ratioScore + sizeScore })
    }
    return candidates.sort((left, right) => right.score - left.score)[0] || null
  }

  private imageMeta(bytes: Buffer): { width: number; height: number; extension: string; contentType: string } | null {
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), extension: 'png', contentType: 'image/png' }
    }
    if (bytes.length >= 10 && bytes.toString('ascii', 0, 3) === 'GIF') {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8), extension: 'gif', contentType: 'image/gif' }
    }
    if (bytes.length >= 26 && bytes.toString('ascii', 0, 2) === 'BM') {
      return { width: Math.abs(bytes.readInt32LE(18)), height: Math.abs(bytes.readInt32LE(22)), extension: 'bmp', contentType: 'image/bmp' }
    }
    if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.toString('ascii', 12, 16) === 'VP8X') {
      return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3), extension: 'webp', contentType: 'image/webp' }
    }
    if (bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue }
        const marker = bytes[offset + 1]
        const length = bytes.readUInt16BE(offset + 2)
        if (length < 2) break
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5), extension: 'jpg', contentType: 'image/jpeg' }
        }
        offset += 2 + length
      }
    }
    return null
  }

  private async pdfText(path: string) {
    try {
      const metadata = await execFileAsync('pdfinfo', [path], { timeout: 10_000, maxBuffer: 1_000_000 }).then(result => result.stdout).catch(() => '')
      const creator = metadata.match(/^Creator:\s*(.+)$/m)?.[1]?.trim()
      const producer = metadata.match(/^Producer:\s*(.+)$/m)?.[1]?.trim() || ''
      const watermark = metadata.match(/^Keywords:\s*(.+)$/m)?.[1]?.trim() || ''
      const opaqueWatermark = /^(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{30,200}$/.test(watermark)
      const bossResumeSource = creator === 'BOSS直聘' && /直聘简历.*iText/i.test(producer)
      const wpsWatermarkSource = creator === 'WPS 文字' && /modified using iText/i.test(producer) && opaqueWatermark
      const removeDiagonalWatermark = bossResumeSource || wpsWatermarkSource
      const args = removeDiagonalWatermark ? ['-layout', '-nodiag', path, '-'] : ['-layout', path, '-']
      const { stdout } = await execFileAsync('pdftotext', args, { timeout: 30_000, maxBuffer: 12_000_000 })
      const text = opaqueWatermark && removeDiagonalWatermark ? stdout.split(watermark).join('') : stdout
      return text.replace(/\u0000/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code || '') : ''
      if (code === 'ENOENT') return ''
      if (/password|encrypted/i.test(error instanceof Error ? error.message : String(error))) throw new BadRequestException('PDF 已加密或需要密码，请解锁后重新上传')
      throw new BadRequestException(`PDF 文字提取失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  private async ocrText(url: string) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let result: any
    try {
      result = await Promise.race([ocr.recognize(url), new Promise((_, reject) => { timer = setTimeout(() => reject(new BadRequestException('OCR 超时，请稍后重试')), 45_000) })])
    } finally { if (timer) clearTimeout(timer) }
    if (result?.isError || result?.error) throw new BadRequestException('OCR 服务识别失败，请稍后重试')
    if (Array.isArray(result?.content)) {
      const content = result.content.filter((item: any) => item.type === 'text' && typeof item.text === 'string').map((item: any) => item.text).join('\n')
      try { result = JSON.parse(content) } catch { result = { text: content } }
    }
    if (result?.data) result = result.data
    if (result?.isError || result?.error) throw new BadRequestException('OCR 服务识别失败，请稍后重试')
    const content = result?.content || result?.text
    const text = typeof content === 'string' ? content.trim() : ''
    if (!text || !meaningfulResumeText(text)) throw new BadRequestException('OCR 未识别到足够可靠的文字，请检查扫描件清晰度')
    return text
  }
}
