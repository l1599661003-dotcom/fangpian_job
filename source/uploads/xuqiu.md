请在当前 ARP Studio 应用中开发并融合一个完整的“ResumeFlow 简历智能解析”模块。

目标是让用户通过网页上传简历，系统自动识别文件内容、提取结构化候选人信息、保存原始文件并写入 Teable 数据库；同时提供带 API Key 鉴权的外部接口，供影刀/XBot 或其他系统上传简历并取得解析结果。

请直接完成代码开发、数据库初始化、构建验证和主要流程测试，不要只提供方案、示例代码或伪代码。

一、融合原则
这是融合到当前已有应用中的一个独立业务模块，不得整体覆盖当前项目。

不得删除或破坏当前应用已有页面、导航、接口、数据库表和业务逻辑。

如果当前应用已经有通用布局、导航菜单、前端路由、组件库或设计规范，应把简历模块接入现有体系。

后端使用独立的 ResumesModule，建议放在：

text
server/modules/resumes/
前端拆分为独立页面和组件，不要把全部代码堆进一个 App.tsx。

不允许在源码中硬编码：

text
Teable Base ID
API Key
STUDIO_APP_TOKEN
第三方密钥
对象存储密钥
数据库连接信息
目标应用必须使用自己的数据库绑定、对象存储和 API Key，不能复制其他应用的 Base ID 或密钥。

开发完成后必须实际构建并验证，不要只确认代码看起来正确。

二、页面结构
应用需要提供三个独立功能入口：

智能解析
人才档案
开发者 API
三个功能通过顶部导航或当前应用已有导航进行切换。

不要把三个功能区域纵向全部堆在一个很长的页面中。

页面整体要求：

专业、简洁、现代。
符合招聘、人力资源、人才管理场景。
减少无意义的大面积留白。
不要使用过大的标题和装饰卡片。
页面内容密度适中。
桌面端和手机端都要美观。
不要在页面右上角放没有必要的“解析新简历”按钮。
上传区域本身应该可以更换文件并连续解析新的简历。
三、智能解析页面
实现一个紧凑、专业、操作顺畅的简历上传和解析页面。

需要支持：

点击选择本地简历。
拖拽上传简历。
重新选择文件。
连续上传不同简历。
显示文件名。
显示文件格式。
显示文件大小。
显示上传状态。
显示 OCR 识别状态。
显示信息提取状态。
显示数据库写入状态。
显示解析成功或失败结果。
解析失败后允许重新上传。
解析成功后展示结构化候选人档案。
网页上传不需要用户输入 API Key，也不应该使用外部 API Key 验证网页上传操作。

页面文案应体现：

text
简历智能解析
候选人信息结构化
人才档案沉淀
招聘数据标准化
不要使用过于口语化或夸张的表达，例如：

text
不管什么格式，都变成清晰的人才档案
可以使用更专业的表达，例如：

text
多格式简历智能解析
将非结构化简历转化为标准化候选人档案
自动识别候选人的基本信息、教育背景与工作经历
四、人才档案页面
人才档案页面显示已经成功写入 Teable 数据库的候选人记录。

功能至少包括：

查询候选人列表。
查看候选人详情。
查看结构化字段。
查看原始简历文件。
查看 OCR 原文。
删除候选人记录。
删除前二次确认。
加载状态。
空数据状态。
请求失败状态。
手机端适配。
候选人列表至少显示：

text
姓名
电话
邮箱
求职意向
工作年限
源文件名
创建时间
候选人详情至少显示：

text
姓名
年龄
电话
邮箱
微信
地址
自我评价
技能证书
教育背景
工作经历
求职意向
工作年限
源文件名
源文件地址
OCR原文
页面本身不要求用户输入 API Key。

桌面端可以使用紧凑表格、列表或卡片。

手机端不要强行使用超宽表格，建议使用卡片列表或适合窄屏的布局，不能出现明显横向溢出。

五、开发者 API 页面
开发者 API 页面用于展示外部系统如何调用简历解析接口。

页面需要展示：

当前应用生成的 API Key。
API Key 复制功能。
API Key 轮换功能。
上传简历接口。
查询解析任务接口。
查询支持格式接口。
请求头说明。
curl 调用示例。
Python 调用示例。
影刀/XBot 调用说明。
上传接口响应示例。
任务处理中响应示例。
任务完成响应示例。
任务失败响应示例。
API Key 轮换前需要二次确认，并明确提示：

text
轮换 API Key 后，旧 Key 将无法继续调用接口。
已经接入的影刀、XBot 或其他外部系统需要同步更新 Key。
开发者 API 页面布局要紧凑。

代码示例可以使用：

标签页切换。
折叠面板。
分组卡片。
代码复制按钮。
不要把简单说明拉成一个留白很多的超长页面。

需要明确区分：

网页功能不需要 API Key。
外部 API 必须使用 API Key。
应用发布为公开后，访问网页不需要 Studio 登录。
外部接口仍然需要 X-API-Key。
六、支持的简历文件格式
必须考虑常见简历来源，不能只支持 PDF。

支持以下格式：

text
.pdf
.doc
.docx
.odt
.rtf
.txt
.jpg
.jpeg
.png
.webp
.bmp
.gif
.tif
.tiff
最大文件大小：

text
10MB
处理要求：

PDF 文件通过文本提取或 OCR 识别。

扫描版 PDF 必须能够使用 OCR。

JPG、JPEG、PNG、WEBP、BMP、GIF、TIF、TIFF 图片通过 OCR 识别。

TXT 文件直接读取文本。

TXT 优先按 UTF-8 读取，并合理处理编码异常。

DOC、DOCX、ODT、RTF 可以先通过 LibreOffice 转成 PDF 或文本，然后再进行文本提取或 OCR。

文件为空时返回明确错误。

文件超过 10MB 时返回明确错误。

文件格式不支持时返回明确错误。

转换失败时返回具体错误原因。

不要把这些错误直接变成没有说明的 HTTP 500。

原始简历文件必须保存到目标应用自己的对象存储中。

数据库中的“源文件地址”必须是目标应用对象存储产生的新 URL，不能引用其他应用的临时文件 URL。

七、需要提取的简历字段
从简历中尽可能提取以下字段：

text
姓名
年龄
电话
邮箱
微信
地址
自我评价
技能证书
教育背景
工作经历
求职意向
工作年限
源文件名
源文件地址
OCR原文
简历指纹
后端和前端可以使用下面的数据结构：

typescript
interface ResumeRecord {
  id: string
  name: string
  age: number | null
  phone: string
  email: string
  wechat: string
  address: string
  selfEvaluation: string
  skillsCertificates: string
  educationBackground: string
  workExperience: string
  jobIntention: string
  yearsOfExperience: string
  sourceFileName: string
  sourceFileUrl: string
  rawText: string
  createdTime?: string
}
提取规则：

优先使用大模型进行结构化提取。

大模型必须返回固定 JSON 结构。

对大模型返回结果进行 JSON 解析和字段校验。

不允许直接信任大模型返回的任意文本。

大模型调用失败、超时或返回格式错误时，使用规则提取作为降级方案。

简历中没有的字段返回空字符串或 null。

禁止编造简历中不存在的信息。

数据写入数据库之前，必须再进行一次确定性的字段标准化。

电话、邮箱、年龄等字段必须进行格式校验。

OCR 原文需要完整保留，方便后续复查、重新提取和查重。

八、手机号和邮箱识别优化
必须解决 OCR 把手机号、分隔符和邮箱粘连的问题。

例如原始简历内容是：

text
19563026270 | 3078779598@qq.com
正常结果应该是：

json
{
  "phone": "19563026270",
  "email": "3078779598@qq.com"
}
即使 OCR 把它识别成：

text
195630262703078779598@qq.com
也必须通过确定性规则拆分成：

json
{
  "phone": "19563026270",
  "email": "3078779598@qq.com"
}
标准化逻辑至少覆盖：

半角竖线 |
全角竖线 ｜
空格
斜杠 /
反斜杠 \
逗号
中文逗号
分号
中文分号
连字符
+86 手机号前缀
86 手机号前缀
11 位手机号和邮箱账号被直接连接
邮箱字段中误带手机号
电话字段中误带邮箱
OCR 把分隔符识别成其他符号
电话和邮箱需要分别使用可靠的正则表达式提取。

不要因为一行中包含 @，就把整行原样保存为邮箱。

可以采用下面的处理顺序：

对文本执行 NFKC 标准化。

统一全角和半角标点。

删除或替换常见分隔符。

先搜索标准邮箱。

检查邮箱用户名之前是否粘连 11 位中国大陆手机号。

如果粘连，前 11 位保存为手机号，剩余部分组成邮箱。

单独搜索手机号并去除 +86 或 86 前缀。

从邮箱字段中移除手机号。

从电话字段中移除邮箱。

最后分别校验手机号和邮箱格式。

九、Teable 数据库
固定使用下面的表名：

text
resume_extraction_records
必须通过平台 SDK 创建或复用：

typescript
const table = await teable.ensureTable('resume_extraction_records')
禁止：

手写 Base ID。
在代码中写死源应用的 Base ID。
根据用户动态创建表。
根据日期动态创建表。
根据会话动态创建表。
重复创建多个简历表。
多用户、分类或来源区分应该通过字段完成，而不是通过创建多张表完成。

写记录之前必须调用：

typescript
await teable.listFields(tableId)
获取真实字段名。

不能凭记忆猜测字段名称。

数据库字段结构如下：

字段名	Teable 类型
姓名	singleLineText
年龄	number
电话	singleLineText
邮箱	singleLineText
微信	singleLineText
地址	singleLineText
自我评价	longText
技能证书	longText
教育背景	longText
工作经历	longText
求职意向	singleLineText
工作年限	singleLineText
源文件名	singleLineText
源文件地址	singleLineText
OCR原文	longText
简历指纹	singleLineText
如果表已经存在，应复用原表并检查缺失字段。

如果缺少“简历指纹”等后续新增字段，应以兼容方式补充，不要重建表导致原有数据丢失。

十、API Key 配置表
固定使用下面的 API 配置表名：

text
resume_api_settings
该表保存当前目标应用自己的外部 API 配置。

要求：

首次启动时，如果没有 API Key，安全生成一个新的 Key。

建议格式：

text
rf_live_加高强度随机字符串
API Key 必须使用安全随机数生成。

不要在源码中写死 Key。

不要从其他应用导入 API Key。

不要在日志中打印完整 API Key。

开发者 API 页面可以显示当前应用自己的 API Key。

支持轮换 API Key。

轮换后旧 Key 应立即失效。

API Key 只用于外部 API，不用于网页内部操作。

十一、简历查重和幂等写入
不能每次解析都无条件调用 createRecord。

否则用户重复上传同一份简历时，会产生多个重复候选人。

使用完整 OCR 文本生成简历内容指纹。

指纹计算前先执行：

typescript
const normalizedText = rawText
  .normalize('NFKC')
  .replace(/\s+/g, '')
  .toLowerCase()
然后计算：

text
SHA-256
把结果保存到：

text
简历指纹
查重规则：

指纹已经存在时，更新原记录，不新增记录。

指纹不存在时，创建新记录。

历史记录如果没有“简历指纹”，需要读取其“OCR原文”，临时计算指纹并参与查重。

同一份简历重复上传时，应该返回原记录或更新后的记录。

重复上传后数据库记录总数不能增加。

为同一指纹增加进程内 Promise 锁或等效的并发保护。

防止同一份文件同时上传时，两个请求都查询不到记录，然后分别创建两条数据。

不要仅根据姓名查重。

同名候选人可能是不同的人，姓名只能作为辅助判断，内容指纹才是主要幂等依据。

如果同一文件重新解析后提取结果有所改善，应更新原记录的结构化字段和源文件信息。

十二、网页端内部接口
至少实现下面的内部接口：

http
GET /api/resumes
POST /api/resumes/upload-url
POST /api/resumes/process
POST /api/resumes/parse-upload
GET /api/resumes/api-config
POST /api/resumes/api-config/rotate
DELETE /api/resumes/:id
GET /api/jobs/:id
接口说明：

查询人才档案
http
GET /api/resumes
返回：

json
{
  "resumes": [
    {
      "id": "rec_xxx",
      "name": "候选人姓名",
      "age": 30,
      "phone": "19563026270",
      "email": "3078779598@qq.com",
      "wechat": "",
      "address": "",
      "selfEvaluation": "",
      "skillsCertificates": "",
      "educationBackground": "",
      "workExperience": "",
      "jobIntention": "",
      "yearsOfExperience": "",
      "sourceFileName": "resume.pdf",
      "sourceFileUrl": "https://...",
      "rawText": "...",
      "createdTime": "..."
    }
  ]
}
取得上传地址
http
POST /api/resumes/upload-url
可以返回：

json
{
  "uploadUrl": "https://...",
  "cdnUrl": "https://...",
  "objectKey": "resumes/...",
  "contentType": "application/pdf"
}
根据文件 URL 创建解析任务
http
POST /api/resumes/process
Content-Type: application/json
请求：

json
{
  "fileUrl": "https://...",
  "fileName": "resume.pdf"
}
返回：

json
{
  "jobId": "job_xxx"
}
浏览器直接上传并解析
http
POST /api/resumes/parse-upload
Content-Type: multipart/form-data
表单字段：

text
file
返回：

json
{
  "jobId": "job_xxx"
}
查询当前 API 配置
http
GET /api/resumes/api-config
返回：

json
{
  "apiKey": "rf_live_xxx",
  "uploadEndpoint": "/api/public/resumes/parse",
  "statusEndpoint": "/api/public/resumes/jobs/{jobId}",
  "headerName": "X-API-Key",
  "maxFileSizeMB": 10,
  "supportedExtensions": [
    ".pdf",
    ".doc",
    ".docx",
    ".odt",
    ".rtf",
    ".txt",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff"
  ]
}
轮换 API Key
http
POST /api/resumes/api-config/rotate
返回新的 API 配置。

删除人才档案
http
DELETE /api/resumes/:id
网页端上传和人才档案查询不使用外部 API Key 鉴权。

上传、OCR、文档转换、AI 提取和数据库写入通过后台任务执行。

创建任务的 HTTP 接口需要快速返回 jobId，前端通过轮询任务状态显示进度。

Controller、Service 和平台调用错误必须转换为可读的 HTTP JSON 响应。

不要使用前端假数据或前端兜底掩盖后端的 404、405、500 等问题。

十三、外部公开 API
实现下面三个外部接口：

http
POST /api/public/resumes/parse
GET /api/public/resumes/jobs/:jobId
GET /api/public/resumes/formats
所有 /api/public/resumes/* 接口必须校验请求头：

http
X-API-Key: rf_live_xxx
需要注意：

public 表示可以从公网调用，不表示不鉴权。

应用发布为公开后，访问网页不需要 Studio 登录。

外部 API 仍然需要当前目标应用自己的 X-API-Key。

缺失 Key 时返回 401。

Key 错误或已经被轮换时返回 401 或 403。

错误响应必须是 JSON。

不能返回 Studio 登录页面。

不能返回 Nginx HTML 错误页。

不要使用 Studio 登录状态、Cookie 或浏览器 Session 作为外部 API 的鉴权方式。

外部上传接口
请求：

http
POST /api/public/resumes/parse
Content-Type: multipart/form-data
X-API-Key: rf_live_xxx
表单字段：

text
file
成功时返回 HTTP 202：

json
{
  "jobId": "job_xxx",
  "status": "running"
}
文件校验失败时返回合适的 4xx 状态码，例如：

json
{
  "statusCode": 400,
  "message": "不支持的简历格式",
  "error": "Bad Request"
}
外部任务查询接口
请求：

http
GET /api/public/resumes/jobs/job_xxx
X-API-Key: rf_live_xxx
处理中返回：

json
{
  "id": "job_xxx",
  "status": "running",
  "progress": "正在识别简历文字"
}
完成后返回：

json
{
  "id": "job_xxx",
  "status": "done",
  "progress": "解析完成",
  "data": {
    "id": "rec_xxx",
    "name": "候选人姓名",
    "age": 30,
    "phone": "19563026270",
    "email": "3078779598@qq.com",
    "wechat": "",
    "address": "",
    "selfEvaluation": "",
    "skillsCertificates": "",
    "educationBackground": "",
    "workExperience": "",
    "jobIntention": "",
    "yearsOfExperience": "",
    "sourceFileName": "resume.pdf",
    "sourceFileUrl": "https://目标应用对象存储地址/...",
    "rawText": "..."
  }
}
失败时返回：

json
{
  "id": "job_xxx",
  "status": "failed",
  "progress": "解析失败",
  "error": "具体错误原因"
}
任务不存在时返回 404 JSON 错误。

查询支持格式
请求：

http
GET /api/public/resumes/formats
X-API-Key: rf_live_xxx
返回：

json
{
  "maxFileSizeMB": 10,
  "supportedExtensions": [
    ".pdf",
    ".doc",
    ".docx",
    ".odt",
    ".rtf",
    ".txt",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff"
  ]
}
十四、影刀/XBot 调用兼容
外部接口需要能够被 Python requests 和影刀/XBot 调用。

典型调用流程：

本地读取简历文件。

以 multipart/form-data 上传文件。

请求头传入 X-API-Key。

上传接口返回 jobId。

每隔 1 至 3 秒查询任务状态。

状态为 done 时取得结构化数据。

状态为 failed 时返回具体错误。

达到最长等待时间时停止轮询并返回超时错误。

Python 调用方式应兼容：

python
with open(file_path, "rb") as file_object:
    response = requests.post(
        API_BASE_URL + "/api/public/resumes/parse",
        headers={
            "X-API-Key": api_key,
            "Accept": "application/json",
        },
        files={
            "file": (
                os.path.basename(file_path),
                file_object,
                content_type,
            )
        },
        timeout=60,
    )
然后轮询：

python
response = requests.get(
    API_BASE_URL + "/api/public/resumes/jobs/" + job_id,
    headers={
        "X-API-Key": api_key,
        "Accept": "application/json",
    },
    timeout=30,
)
接口字段必须保持稳定，尤其是：

text
jobId
status
progress
data
error
十五、ARP Studio 平台能力规范
Teable
必须通过当前项目的：

text
server/platform/teable.ts
调用 Teable。

固定使用：

typescript
teable.ensureTable('resume_extraction_records')
不要直接写 Base ID。

对象存储
使用：

text
server/platform/storage.ts
上传并持久化原始简历文件。

原始文件必须保存，不能只保存临时上传地址。

OCR 和 MCP
应用运行时需要使用 OCR 或其他 MCP 能力时，必须通过：

text
server/platform/mcp.ts
统一调用平台接口：

http
POST ${STUDIO_PLATFORM_URL}/mcp/call
Authorization: Bearer ${STUDIO_APP_TOKEN}
Content-Type: application/json
请求体格式：

json
{
  "tool": "对应的MCP工具名",
  "args": {}
}
禁止：

安装 @modelcontextprotocol/sdk。
应用自己连接 MCP Server。
拼接不存在的 /platform/ocr/*。
拼接不存在的 /platform/feishu/*。
拼接不存在的 /mcp/studio。
自己创建另一套 MCP 客户端。
如果当前项目已有 server/platform/mcp.ts，必须复用并补充，不得重复创建第二套封装。

大模型
对话式或结构化提取调用优先使用当前项目已有的：

text
server/platform/llm.ts
一次性结构化抽取也可以使用平台允许的 DeepSeek 调用。

密钥不能写进源码。

大模型调用失败时必须有规则降级方案。

后台任务
OCR、Word 转换、AI 提取、批量迁移等长耗时操作必须使用：

text
server/platform/jobs.ts
不能在同步 HTTP 接口里一直等待解析完成。

原因是已发布应用的网关对响应时间有限制。

正确流程是：

text
上传请求
  ↓
创建后台任务
  ↓
立即返回 jobId
  ↓
后台执行 OCR、AI 提取和数据库写入
  ↓
调用方轮询任务状态
如果当前项目已经有 JobsModule，应该复用，不要重复实现第二套任务系统。

十六、后端模块建议
建议模块结构如下：

text
server/modules/resumes/
├── resumes.module.ts
├── resumes.controller.ts
├── public-resume-api.controller.ts
├── resumes.service.ts
├── resume-file.service.ts
├── resume-api-key.service.ts
├── resume.types.ts
└── resume.constants.ts
职责建议：

resumes.controller.ts
负责网页内部接口：

text
/api/resumes/*
public-resume-api.controller.ts
负责外部接口：

text
/api/public/resumes/*
并执行 X-API-Key 鉴权。

resumes.service.ts
负责：

OCR 文本结构化提取。
字段标准化。
电话邮箱纠错。
简历指纹计算。
数据库查重。
创建或更新记录。
查询和删除人才档案。
resume-file.service.ts
负责：

文件类型判断。
文件大小校验。
文档转换。
OCR。
TXT 读取。
原始文件上传对象存储。
创建后台解析任务。
resume-api-key.service.ts
负责：

初始化 API Key 配置表。
生成 API Key。
验证 API Key。
查询 API Key。
轮换 API Key。
避免在日志中暴露 Key。
十七、响应式和视觉要求
整体风格要求：

text
专业
克制
现代
紧凑
适合招聘和人才管理场景
具体要求：

三个页面通过顶部导航切换。
桌面端主要内容区域设置合理最大宽度。
不要把内容无限拉宽。
减少无意义的大标题。
减少大面积上下留白。
减少没有信息价值的大卡片。
开发者 API 页面要紧凑。
代码示例可以折叠或使用标签切换。
上传区域要有明确的拖拽状态。
按钮需要有 hover 状态。
表单需要有 focus 状态。
上传中按钮需要 disabled 和 loading 状态。
解析进度需要清晰可见。
错误提示需要醒目但不要粗暴。
手机端导航可以横向滚动、折叠或使用适合窄屏的菜单。
手机端上传按钮要容易点击。
手机端候选人列表不要依赖宽表格。
手机端详情内容不能超出屏幕。
长文本需要合理换行。
邮箱、文件地址等长内容不能撑破布局。
对话框和抽屉在手机端不能超出视口。
至少检查以下宽度：

text
1440px
1024px
768px
390px
360px
不要在右上角添加无实际价值的“解析新简历”按钮。

十八、错误处理
至少处理下面的异常：

文件类错误
文件不存在。
文件为空。
文件格式不支持。
文件超过 10MB。
文件扩展名和 MIME 类型明显不一致。
文件内容读取失败。
对象存储错误
上传失败。
返回地址为空。
文件 URL 无法读取。
临时地址过期。
OCR 错误
OCR 调用失败。
OCR 返回空内容。
OCR 返回格式异常。
PDF 页面过多或识别超时。
扫描件清晰度不足。
文档转换错误
LibreOffice 不可用。
DOC/DOCX 转换失败。
转换后的 PDF 不存在。
临时文件清理失败。
大模型错误
请求失败。
请求超时。
响应不是 JSON。
JSON 字段类型错误。
内容被 Markdown 代码块包裹。
返回了简历中不存在的信息。
数据库错误
Teable 表创建失败。
表不存在。
字段缺失。
字段类型不一致。
查询失败。
创建失败。
更新失败。
删除失败。
读取空值时发生异常。
任务错误
后台任务不存在。
任务执行失败。
任务状态未知。
任务等待超时。
任务结果为空。
API Key 错误
请求头不存在。
Key 为空。
Key 不正确。
Key 已被轮换。
API 配置表不存在。
并发错误
同一简历并发上传。
同一指纹同时写入。
两个请求同时创建重复记录。
发布和路由错误
接口路径错误导致 404。
请求方法错误导致 405。
路由前缀重复。
发布环境反向代理路径错误。
接口返回 Studio 登录页。
接口返回 Nginx HTML 错误页。
所有后端异常应记录足够的服务端日志。

对调用方返回的错误必须是可理解的 JSON。

不要靠前端假成功、静态数据或捕获后静默忽略来掩盖后端问题。

十九、数据安全要求
简历包含敏感个人信息，包括：

text
姓名
手机号
邮箱
微信
家庭地址
教育经历
工作经历
原始简历文件
OCR全文
需要遵守以下要求：

不要在服务端日志中打印完整简历内容。

不要在日志中打印完整 API Key。

不要把候选人数据写进源码。

不要把真实候选人信息放进前端静态文件。

不要把 API Key 写进 .env 或 .env.example。

如果需要环境密钥，写入工作区根目录 .env.local。

.env.example 只允许保留空的变量名和说明。

数据迁移完成后，删除工作区中的临时迁移文件和一次性迁移接口。

API 错误响应不能泄露平台 Token、数据库配置或服务器本地路径。

二十、如果需要迁移现有 ResumeFlow 数据
如果工作区同时上传了 ResumeFlow 融合迁移包，请读取迁移包中的：

text
README.md
INTEGRATION_PROMPT.md
manifest.json
checksums.json
source-snapshot/
integration-module/
migration/
融合规则：

以 integration-module 作为模块化合并参考。

不要使用 source-snapshot 整体覆盖目标应用。

保留目标应用原有功能。

目标应用继续使用自己的 STUDIO_TEABLE_BASE_ID。

不允许写死源应用 Base ID。

不导入源应用的 resume_api_settings。

不导入源应用 API Key。

目标应用必须自行生成新的 API Key。

原始简历文件需要重新上传到目标应用对象存储。

数据库中的“源文件地址”需要重写为目标应用的新 URL。

导入文件前校验 SHA-256。

按“简历指纹”执行幂等导入。

目标数据库中已经存在相同指纹时更新记录，不重复新增。

先执行 dryRun=true。

dry run 全部通过后再执行 dryRun=false。

迁移属于长耗时操作，必须放入后台任务。

迁移完成后删除一次性迁移模块和本地敏感数据目录。

最后重新构建、启动并验证。

如果目标应用已经有自己的候选人数据，不能直接清空目标表。

需要合并导入，并通过简历指纹避免重复。

二十一、实际验证要求
开发完成后必须实际执行以下验证：

构建验证
运行：

bash
pnpm run build
必须确保前端和 NestJS 后端均构建成功。

不能留下 TypeScript 编译错误。

路由验证
启动预览后检查 NestJS 日志，确认至少注册了：

text
GET    /api/resumes
POST   /api/resumes/upload-url
POST   /api/resumes/process
POST   /api/resumes/parse-upload
GET    /api/resumes/api-config
POST   /api/resumes/api-config/rotate
DELETE /api/resumes/:id
POST   /api/public/resumes/parse
GET    /api/public/resumes/jobs/:id
GET    /api/public/resumes/formats
GET    /api/jobs/:id
文件解析验证
至少实际验证：

一份 PDF 简历。
一份 DOCX 简历。
一份图片简历。
每种文件都需要完成：

text
上传原始文件
文本识别
结构化提取
字段标准化
指纹计算
数据库写入
前端结果展示
联系方式验证
使用包含下面内容的简历进行测试：

text
19563026270 | 3078779598@qq.com
结果必须是：

json
{
  "phone": "19563026270",
  "email": "3078779598@qq.com"
}
还要模拟 OCR 粘连结果：

text
195630262703078779598@qq.com
仍然必须正确拆分。

查重验证
同一份简历连续上传两次。

需要确认：

第二次上传可以完成。
第二次返回原记录或更新后的记录。
数据库记录总数不增加。
不产生两个相同的“简历指纹”。
并发上传相同文件也不产生重复记录。
网页验证
确认：

智能解析页面可以上传和更换文件。
解析进度正常显示。
解析结果正常显示。
人才档案读取的是真实数据库数据。
候选人详情正常。
原始文件可以打开。
删除操作正常。
开发者 API 页面能够显示和复制 Key。
API Key 可以轮换。
网页功能不要求输入 API Key。
外部 API 验证
不带 X-API-Key 调用：

http
POST /api/public/resumes/parse
必须返回 401 或 403 JSON 错误。

使用错误 Key 调用，也必须返回 401 或 403。

使用正确 Key 上传简历时，必须返回：

text
HTTP 202
jobId
status
然后轮询：

http
GET /api/public/resumes/jobs/:jobId
直到状态变成：

text
done
需要确认：

返回结构化候选人数据。
数据已经写入数据库。
原始文件已经写入对象存储。
任务失败时能够返回具体错误。
接口不会返回登录页面或 HTML 错误。
响应式验证
检查：

text
1440px
1024px
768px
390px
360px
重点确认：

没有明显大面积空白。
没有横向滚动。
导航可正常切换。
上传按钮不被遮挡。
候选人卡片不溢出。
详情内容正常换行。
开发者 API 代码块在手机端可以查看。
弹窗和抽屉没有超出屏幕。
二十二、最终交付要求
开发完成后，请明确报告：

新增了哪些文件。

修改了哪些文件。

前端三个页面分别如何访问。

后端注册了哪些接口。

创建或复用了哪些 Teable 表。

每张表包含哪些字段。

简历文件保存到了哪里。

OCR、Word 转换和 AI 提取分别如何实现。

手机号和邮箱粘连问题如何修复。

简历指纹如何计算。

重复上传如何避免新增重复记录。

并发上传如何防止重复写入。

网页功能为什么不需要 API Key。

外部 API 如何校验 X-API-Key。

API Key 在哪里查看和轮换。

pnpm run build 是否通过。

PDF、DOCX、图片解析测试结果。

重复上传测试前后的数据库数量。

外部 API 无 Key、错误 Key、正确 Key 的测试结果。

桌面端和 390px 手机端的页面测试结果。

如果执行了迁移，报告：

text
迁移记录数量
迁移源文件数量
成功数量
失败数量
合并数量
跳过数量
文件哈希校验结果
说明仍然存在的限制，或者需要应用主人完成的配置。
最终回复中禁止输出：

text
真实 API Key
STUDIO_APP_TOKEN
数据库密钥
平台密钥
候选人的完整敏感信息
请直接开始检查当前项目并实施开发。不要只回复开发计划。开发完成后执行构建和真实接口验证，再提交最终结果。