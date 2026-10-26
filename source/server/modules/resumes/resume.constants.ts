export const RESUME_TABLE = 'resume_extraction_records'
export const API_SETTINGS_TABLE = 'resume_api_settings'
export const MAX_FILE_SIZE = 10 * 1024 * 1024
// 浏览器一次提交的批量上限。解析仍由后台以小并发队列执行，避免单批任务占用过久。
export const MAX_BATCH_FILES = 500
export const SUPPORTED_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt',
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff',
] as const

export const RESUME_FIELDS = [
  ['姓名', 'singleLineText'], ['性别', 'singleLineText'], ['年龄', 'number'], ['电话', 'singleLineText'], ['邮箱', 'singleLineText'],
  ['微信', 'singleLineText'], ['地址', 'singleLineText'], ['自我评价', 'longText'], ['技能证书', 'longText'],
  ['教育背景', 'longText'], ['工作经历', 'longText'], ['求职意向', 'singleLineText'], ['工作年限', 'singleLineText'],
  ['当前公司', 'singleLineText'], ['当前职位', 'singleLineText'],
  ['解析质量JSON', 'longText'],
  ['源文件名', 'singleLineText'], ['源文件地址', 'singleLineText'], ['OCR原文', 'longText'], ['简历指纹', 'singleLineText'],
  ['头像地址', 'singleLineText'], ['头像提取状态', 'singleLineText'],
  ['可编辑Word文件名', 'singleLineText'], ['可编辑Word地址', 'singleLineText'], ['Word转换状态', 'singleLineText'],
  ['Word转换错误', 'longText'], ['Word转换版本', 'number'], ['Word转换人用户ID', 'singleLineText'],
  ['Word转换人', 'singleLineText'], ['Word转换时间', 'singleLineText'],
] as const

export const API_FIELDS = [
  ['配置名称', 'singleLineText'], ['API Key', 'singleLineText'], ['状态', 'singleLineText'],
  ['创建时间', 'singleLineText'], ['更新时间', 'singleLineText'],
] as const
