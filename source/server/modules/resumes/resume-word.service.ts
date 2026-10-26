import { Injectable } from '@nestjs/common'
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { ResumeRecord } from './resume.types'

const font = 'Source Han Sans CN'
const text = (value: unknown) => String(value ?? '').trim()
const lines = (value: unknown) => text(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
const run = (value: unknown, options: Record<string, unknown> = {}) => new TextRun({ text: text(value), font, size: 21, ...options })

@Injectable()
export class ResumeWordService {
  async create(resume: ResumeRecord) {
    const children: Array<Paragraph | Table> = [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [run(resume.name || '未识别姓名', { bold: true, size: 34, color: '193D31' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: [run(resume.jobIntention || '个人简历', { size: 22, color: '527663' })] }),
      this.basicInformation(resume),
    ]

    this.section(children, '求职意向', resume.jobIntention)
    this.section(children, '教育背景', resume.educationBackground)
    this.section(children, '工作经历', resume.workExperience)
    this.section(children, '技能与证书', resume.skillsCertificates)
    this.section(children, '自我评价', resume.selfEvaluation)
    this.section(children, 'OCR 识别原文', resume.rawText, true)
    children.push(new Paragraph({ spacing: { before: 260 }, children: [run('说明：本文件由人才管理系统依据 OCR 和结构化字段生成，内容可编辑；使用前请人工核对原始简历。', { size: 17, color: '7A8A82', italics: true })] }))

    const document = new Document({
      styles: {
        default: { document: { run: { font, size: 21 }, paragraph: { spacing: { line: 330 } } } },
        paragraphStyles: [{ id: 'ResumeHeading', name: 'Resume Heading', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font, bold: true, size: 25, color: '225B43' }, paragraph: { spacing: { before: 260, after: 100 }, border: { bottom: { color: 'A7BDB2', style: BorderStyle.SINGLE, size: 6, space: 4 } } } }],
      },
      sections: [{ properties: { page: { margin: { top: 900, right: 900, bottom: 900, left: 900 } } }, children }],
    })
    return Packer.toBuffer(document)
  }

  private basicInformation(resume: ResumeRecord) {
    const values = [
      ['年龄', resume.age ? `${resume.age}岁` : '待补充'],
      ['工作年限', resume.yearsOfExperience || '待补充'],
      ['电话', resume.phone || '待补充'],
      ['邮箱', resume.email || '待补充'],
      ['微信', resume.wechat || '待补充'],
      ['所在地', resume.address || '待补充'],
    ]
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: values.reduce<TableRow[]>((rows, item, index) => {
        if (index % 2) return rows
        const pair = [item, values[index + 1]]
        rows.push(new TableRow({ children: pair.flatMap(([label, value]) => [
          new TableCell({ width: { size: 16, type: WidthType.PERCENTAGE }, shading: { fill: 'EEF5F1' }, children: [new Paragraph({ children: [run(label, { bold: true, color: '315C48' })] })] }),
          new TableCell({ width: { size: 34, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [run(value)] })] }),
        ]) }))
        return rows
      }, []),
    })
  }

  private section(children: Array<Paragraph | Table>, title: string, content: unknown, preserveLines = false) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, style: 'ResumeHeading', children: [run(title, { bold: true, size: 25, color: '225B43' })] }))
    const paragraphs = lines(content)
    if (!paragraphs.length) {
      children.push(new Paragraph({ children: [run('待补充', { color: '8B9892' })] }))
      return
    }
    for (const value of preserveLines ? paragraphs : paragraphs) {
      children.push(new Paragraph({ spacing: { after: 70 }, children: [run(value)] }))
    }
  }
}
