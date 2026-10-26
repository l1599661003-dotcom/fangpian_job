import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'

const font = 'Source Han Sans CN'
const text = (value: unknown) => String(value ?? '').trim()
const run = (value: unknown, options: Record<string, unknown> = {}) => new TextRun({ text: text(value), font, size: 21, ...options })
const lineBorder = { bottom: { color: 'D8D1C4', style: BorderStyle.SINGLE, size: 4, space: 2 } }

export type InterviewQuestionDocument = {
  candidateName?: string
  role?: string
  round?: string
  status?: string
  startAt?: string
  generatedAt?: string
  interviewerNames?: string[]
  questions?: Array<{ question?: string; dimension?: string; source?: string; why?: string; observation?: string }>
}

function formatShanghaiDateTime(value: unknown) {
  const date = new Date(text(value))
  if (!Number.isFinite(date.getTime())) return '待确认'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)
}

function metadataCell(label: string, value: unknown, labelCell = false) {
  return new TableCell({
    width: { size: labelCell ? 16 : 34, type: WidthType.PERCENTAGE },
    shading: labelCell ? { fill: 'F4EBD9' } : undefined,
    children: [new Paragraph({ spacing: { before: 80, after: 80 }, children: [run(value || '待确认', labelCell ? { bold: true, color: '76551B' } : { color: '3D3426' })] })],
  })
}

export async function createInterviewQuestionWord(data: InterviewQuestionDocument) {
  const questions = Array.isArray(data.questions) ? data.questions : []
  const children: Array<Paragraph | Table> = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [run('方片新媒体', { bold: true, size: 18, color: 'A27625', characterSpacing: 90 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [run('结构化面试题', { bold: true, size: 36, color: '2C2418' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [run(`${text(data.candidateName) || '候选人'} · ${text(data.role) || '通用岗位'} · ${text(data.round) || '本轮面试'}`, { size: 22, color: '726652' })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [metadataCell('候选人', '候选人', true), metadataCell('候选人', data.candidateName), metadataCell('面试岗位', '面试岗位', true), metadataCell('面试岗位', data.role)] }),
        new TableRow({ children: [metadataCell('面试轮次', '面试轮次', true), metadataCell('面试轮次', data.round), metadataCell('面试时间', '面试时间', true), metadataCell('面试时间', formatShanghaiDateTime(data.startAt))] }),
        new TableRow({ children: [metadataCell('面试官', '面试官', true), metadataCell('面试官', (data.interviewerNames || []).join('、') || '待确认'), metadataCell('题目状态', '题目状态', true), metadataCell('题目状态', data.status || '已生成')] }),
      ],
    }),
    new Paragraph({ spacing: { before: 260, after: 120 }, children: [run('使用说明', { bold: true, size: 25, color: '76551B' })] }),
    new Paragraph({ spacing: { after: 260, line: 330 }, children: [run('请围绕题目追问事实、行动和结果，并记录可验证证据。题目由岗位模板、意向沟通和历史补充题生成，面试官可根据现场情况调整顺序。', { color: '6F6556' })] }),
  ]

  questions.forEach((question, index) => {
    children.push(
      new Paragraph({ keepNext: true, spacing: { before: index ? 260 : 80, after: 90 }, children: [run(`${index + 1}. `, { bold: true, size: 27, color: 'A27625' }), run(question.question || '题目待补充', { bold: true, size: 25, color: '2E281F' })] }),
      new Paragraph({ spacing: { after: 100 }, children: [run(`${text(question.dimension) || '结构化面试'} · ${text(question.source) || '面试题库'}`, { size: 18, color: '8A7C68' })] }),
    )
    if (text(question.why)) children.push(new Paragraph({ spacing: { after: 80 }, children: [run('追问原因：', { bold: true, color: '665332' }), run(question.why, { color: '51493D' })] }))
    if (text(question.observation)) children.push(new Paragraph({ spacing: { after: 100 }, children: [run('观察要点：', { bold: true, color: '665332' }), run(question.observation, { color: '51493D' })] }))
    children.push(new Paragraph({ spacing: { before: 80, after: 50 }, children: [run('面试记录', { bold: true, color: '665332' })] }))
    for (let line = 0; line < 3; line += 1) children.push(new Paragraph({ border: lineBorder, spacing: { before: 80, after: 120 }, children: [run(' ')] }))
    children.push(new Paragraph({ spacing: { after: 80 }, children: [run('评分：____ / 10    证据充分度：□ 高  □ 中  □ 低', { size: 19, color: '746A5C' })] }))
  })

  children.push(
    new Paragraph({ spacing: { before: 300, after: 80 }, border: { top: { color: 'D8D1C4', style: BorderStyle.SINGLE, size: 4, space: 8 } }, children: [run(`生成时间：${formatShanghaiDateTime(data.generatedAt || new Date().toISOString())}`, { size: 17, color: '918677' })] }),
    new Paragraph({ children: [run('说明：本面试题由系统辅助生成，正式使用前请面试官结合岗位实际进行人工核对。', { size: 17, color: '918677', italics: true })] }),
  )

  const document = new Document({
    styles: { default: { document: { run: { font, size: 21 }, paragraph: { spacing: { line: 320 } } } } },
    sections: [{ properties: { page: { margin: { top: 850, right: 850, bottom: 850, left: 850 } } }, children }],
  })
  return Packer.toBuffer(document)
}
