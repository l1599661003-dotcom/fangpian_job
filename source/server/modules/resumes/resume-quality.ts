export function readQualityWarnings(value: unknown): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value
    return Array.isArray(parsed) ? [...new Set(parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())))] : []
  } catch { return [] }
}

export function meaningfulResumeText(text: string) {
  const printable = text.replace(/\s/g, '')
  if (printable.length < 8 || (text.match(/[\uFFFD\u0000-\u0008]/g) || []).length > Math.max(2, printable.length * 0.01)) return false
  return (text.match(/[\u3400-\u9fff]/g) || []).length >= 8 || /(?:experience|education|skills|resume|curriculum|university|engineer|manager|@)/i.test(text)
}

export function dateTokens(text: string) {
  return [...new Set([...text.normalize('NFKC').matchAll(/\b((?:19|20)\d{2})[.\-/年](0?[1-9]|1[0-2])(?:[.\-/月](0?[1-9]|[12]\d|3[01])日?)?(?!\d)/g)]
    .map(match => `${match[1]}-${match[2].padStart(2, '0')}${match[3] ? `-${match[3].padStart(2, '0')}` : ''}`))].sort()
}

export function resumeQualityWarnings(value: { name: string; phone: string; email: string; workExperience: string; educationBackground: string }, rawText: string) {
  const warnings: string[] = []
  if (!value.name) warnings.push('未可靠识别姓名，请核对原件。')
  if (!value.phone && !value.email) warnings.push('未识别到完整手机号或邮箱；可能未提供或已被平台隐藏，请核对原件。')
  if (!value.workExperience) warnings.push('未识别到工作经历；请核对是否为应届生或分区未识别，不代表没有工作经验。')
  if (!value.educationBackground) warnings.push('未识别到教育经历，请核对原件。')
  if (!meaningfulResumeText(rawText)) warnings.push('原文文字质量偏低，请核对是否乱码或内容不完整。')
  if (/(?:教育经历|教育背景|工作经历|专业技能)[ \t]{4,}(?:教育经历|教育背景|工作经历|专业技能)/.test(rawText)) warnings.push('检测到可能的双栏排版，分区阅读顺序需对照原件核实。')
  const phones = new Set(rawText.match(/(?<!\d)1[3-9]\d{9}(?!\d)/g) || [])
  if (phones.size > 1) warnings.push('原文包含多个手机号，请确认候选人本人联系方式，避免使用推荐人或证明人的号码。')
  const years = new Set([...rawText.matchAll(/(\d{1,2})\s*年(?:以上)?\s*(?:工作经验|工作经历)/g)].map(match => match[1]))
  if (years.size > 1) warnings.push('原文的工作年限表述不一致，请核对，不自动推算或改写。')
  for (const line of value.workExperience.split('\n')) {
    const range = line.match(/((?:19|20)\d{2})[.\-/年](\d{1,2})月?\s*[-—–~～至到]\s*((?:19|20)\d{2})[.\-/年](\d{1,2})/)
    if (range && (Number(range[2]) < 1 || Number(range[2]) > 12 || Number(range[4]) < 1 || Number(range[4]) > 12 || Number(range[1]) * 12 + Number(range[2]) > Number(range[3]) * 12 + Number(range[4]))) {
      warnings.push('工作经历存在无效月份或起止时间倒置，请核对原件，不自动改日期。')
      break
    }
  }
  return warnings
}
