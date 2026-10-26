export interface CandidateEmailDetail {
  label: string
  value: string
  sub?: string
}

export interface CandidateEmailLink {
  label: string
  href: string
}

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const textBlock = (value: string) => escapeHtml(value).replace(/\r?\n/g, '<br>')

export function candidateEmailCard(input: {
  candidateName: string
  title: string
  brandSub?: string
  intro: string[]
  details: CandidateEmailDetail[]
  note?: string
  noteTitle?: string
  primaryLink?: CandidateEmailLink
  secondaryLinks?: CandidateEmailLink[]
  footer?: string
}) {
  const details = input.details.filter(item => item.value)
  const detailRows = details.map((item, index) => `
    <tr>
      <td width="84" style="width:84px;padding:13px 14px 13px 0;${index === details.length - 1 ? '' : 'border-bottom:1px solid #eeeeea;'}vertical-align:top;font-size:13px;line-height:1.7;color:#8a8a84;">${escapeHtml(item.label)}</td>
      <td style="padding:13px 0;${index === details.length - 1 ? '' : 'border-bottom:1px solid #eeeeea;'}vertical-align:top;font-size:15px;line-height:1.7;font-weight:600;color:#222;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(item.value)}${item.sub ? `<div style="margin-top:4px;font-size:12px;line-height:1.6;font-weight:400;color:#8a8a84;">${escapeHtml(item.sub)}</div>` : ''}</td>
    </tr>`).join('')
  const secondaryLinks = (input.secondaryLinks || []).filter(item => item.href)
  return `
  <div style="margin:0;padding:18px 8px;background-color:#f5f4f1;color:#26332c;font-family:'PingFang SC','Microsoft YaHei','Hiragino Sans GB',Arial,sans-serif;-webkit-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;table-layout:fixed;background-color:#ffffff;">
      <tr>
        <td style="padding:30px 24px 20px;border-bottom:1px solid #eeeeea;">
          <div style="font-size:13px;line-height:1.4;font-weight:700;color:#233e36;letter-spacing:.12em;">方片新媒体</div>
          <div style="margin-top:5px;font-size:10px;line-height:1.5;letter-spacing:.28em;color:#9c9c94;">${escapeHtml(input.brandSub || 'FANGPIAN · CAREERS')}</div>
          <h1 style="margin:24px 0 0;font-size:24px;line-height:1.45;font-weight:700;color:#222;letter-spacing:.01em;">${escapeHtml(input.title)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <p style="margin:0;font-size:16px;line-height:1.7;font-weight:600;color:#222;">${escapeHtml(input.candidateName)}，你好：</p>
          ${input.intro.map(paragraph => `<p style="margin:12px 0 0;font-size:14px;line-height:1.9;color:#555550;">${textBlock(paragraph)}</p>`).join('')}
          ${details.length ? `<div style="margin:26px 0 0;padding-bottom:8px;font-size:11px;line-height:1.5;letter-spacing:.18em;color:#9c9c94;">关键信息</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-top:1px solid #eeeeea;">${detailRows}</table>` : ''}
          ${input.note ? `<div style="margin-top:20px;padding:15px 16px;background-color:#faf7f0;border-left:3px solid #b8a06a;"><div style="font-size:11px;line-height:1.6;letter-spacing:.14em;color:#9b7f43;">${escapeHtml(input.noteTitle || '说明')}</div><div style="margin-top:6px;font-size:13px;line-height:1.9;color:#5f563d;overflow-wrap:anywhere;word-break:break-word;">${textBlock(input.note)}</div></div>` : ''}
          ${input.primaryLink ? `<div style="margin-top:28px;padding:18px;background-color:#f5f5f1;">
            <div style="font-size:13px;line-height:1.9;color:#41413c;">请打开专属页面完成后续确认。</div>
            <div style="margin-top:16px;"><a href="${escapeHtml(input.primaryLink.href)}" style="display:block;padding:14px 22px;background-color:#233e36;color:#ffffff;text-decoration:none;border-radius:7px;font-size:15px;line-height:1.4;font-weight:700;text-align:center;mso-line-height-rule:exactly;">${escapeHtml(input.primaryLink.label)}&nbsp;→</a></div>
            <p style="margin:14px 0 0;font-size:12px;line-height:1.9;color:#8a8a84;">按钮无法打开时，请复制下方链接到浏览器访问：<br><a href="${escapeHtml(input.primaryLink.href)}" style="color:#316552;word-break:break-all;overflow-wrap:anywhere;">${escapeHtml(input.primaryLink.href)}</a></p>
          </div>` : ''}
          ${secondaryLinks.length ? `<div style="margin-top:20px;">${secondaryLinks.map(link => `<div style="margin-top:10px;"><a href="${escapeHtml(link.href)}" style="display:block;padding:12px 18px;background-color:#ffffff;border:1px solid #dcdcd4;border-radius:7px;color:#316552;text-decoration:none;font-size:13px;line-height:1.5;font-weight:600;text-align:center;">${escapeHtml(link.label)}&nbsp;↗</a></div>`).join('')}</div>` : ''}
          <div style="margin-top:22px;padding-top:18px;border-top:1px solid #eeeeea;font-size:13px;line-height:1.9;color:#555550;">${escapeHtml(input.footer || '方片新媒体招聘团队')}</div>
        </td>
      </tr>
    </table>
  </div>`.trim()
}
