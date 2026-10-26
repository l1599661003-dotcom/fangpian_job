import { computed, createApp, h, onBeforeUnmount, ref } from 'vue';

const codeTabs = [
  { key: 'curl', label: 'curl' },
  { key: 'python', label: 'Python' },
  { key: 'xbot', label: '影刀 / XBot' },
];

const formatTags = ['PDF', 'DOC', 'DOCX', 'JPG', 'PNG', 'WEBP', 'TIFF', 'TXT', 'RTF', 'ODT'];

const featureCards = [
  { tag: 'AUTH', title: 'API Key 鉴权', description: '外部请求必须使用 X-API-Key。Key 不自动过期，主动轮换后旧 Key 立即失效。' },
  { tag: 'ASYNC', title: '异步解析', description: '提交成功返回 HTTP 202 和 jobId，不阻塞业务请求。' },
  { tag: 'POLL', title: '任务查询', description: '建议每 1–2 秒查询一次，完成后从 data 获取结果。' },
  { tag: 'LIMIT', title: '请求限制', description: '单文件最大 10MB，支持 PDF、Word、图片与文本格式。' },
  { tag: 'ERROR', title: '错误码', description: '400 参数或格式错误，401 鉴权失效，404 任务不存在。' },
  { tag: 'RESULT', title: '结果结构', description: '返回候选人字段、源文件地址和数据库记录 ID。' },
];

let selectedCodeTab = 'curl';
let activeApp = null;

function conciseError(error) {
  const message = String(error?.message || error || '服务暂时不可用');
  if (/\b404\b/.test(message)) return '接口暂时不可用（404）';
  return message.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function apiUrl(path) {
  return new URL(path.replace(/^\//, ''), new URL('.', window.location.href)).toString();
}

function identityHeaders() {
  const headers = new Headers({ Accept: 'application/json' });
  const identity = window.recruitmentCurrentUser;
  if (identity?.id) headers.set('x-user-id', encodeURIComponent(String(identity.id)));
  if (identity?.name) headers.set('x-user-name', encodeURIComponent(String(identity.name)));
  return headers;
}

async function requestJson(path, { headers, method, signal, timeoutMs = 15000 } = {}) {
  const requestHeaders = identityHeaders();
  if (headers) Object.entries(headers).forEach(([key, value]) => requestHeaders.set(key, value));
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(apiUrl(path), { method: method || 'GET', headers: requestHeaders, signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('json') ? await response.json() : { message: await response.text() };
    if (!response.ok) {
      const error = new Error(Array.isArray(data.message) ? data.message.join('；') : data.message || `请求失败 (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function notify(message, type = 'info') {
  let region = document.getElementById('rf-notification-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'rf-notification-region';
    region.className = 'rf-notification-region';
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  const item = document.createElement('div');
  item.className = `rf-notification ${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.innerHTML = `<i>${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</i><div><strong>${type === 'success' ? '操作成功' : type === 'error' ? '操作未完成' : '操作提示'}</strong><p>${message.replace(/[&<>"']/g, '')}</p></div><button type="button" aria-label="关闭提示">×</button>`;
  item.querySelector('button')?.addEventListener('click', () => item.remove());
  region.appendChild(item);
  if (type !== 'error') window.setTimeout(() => item.remove(), 8000);
}

const ApiDocumentationPage = {
  setup() {
    const apiConfig = ref(null);
    const configError = ref('');
    const connectionStatus = ref('可先验证当前 Key 和公开接口是否连通。');
    const checking = ref(false);
    const rotating = ref(false);
    const codeTab = ref(selectedCodeTab);
    let disposed = false;
    let configController = null;

    const base = computed(() => new URL('.', window.location.href).toString().replace(/\/$/, ''));
    const apiKey = computed(() => apiConfig.value?.apiKey || '当前环境未返回 API Key');
    const examples = computed(() => {
      const exampleKey = apiConfig.value?.apiKey || '请进入开发者中心获取 API Key';
      return {
        curl: `# 1. 先验证服务地址和 API Key\ncurl '${base.value}/api/public/resumes/formats' \\\n  -H 'X-API-Key: ${exampleKey}' \\\n  -H 'Accept: application/json'\n\n# 2. 上传任意支持格式的简历\ncurl -X POST '${base.value}/api/public/resumes/parse' \\\n  -H 'X-API-Key: ${exampleKey}' \\\n  -H 'Accept: application/json' \\\n  -F 'file=@/path/to/resume.docx'\n\n# 3. 查询解析结果\ncurl '${base.value}/api/public/resumes/jobs/job_xxx' \\\n  -H 'X-API-Key: ${exampleKey}'`,
        python: `import os\nimport time\nimport requests\n\nbase_url = '${base.value}'\napi_key = os.environ['RESUME_API_KEY'].strip()\nheaders = {'X-API-Key': api_key, 'Accept': 'application/json'}\n\ncheck = requests.get(base_url + '/api/public/resumes/formats', headers=headers, timeout=30)\ncheck.raise_for_status()\n\nwith open(file_path, 'rb') as file:\n    response = requests.post(\n        base_url + '/api/public/resumes/parse',\n        headers=headers,\n        files={'file': (os.path.basename(file_path), file)},\n        timeout=60,\n    )\n    response.raise_for_status()\n    started = response.json()\n\nwhile True:\n    response = requests.get(\n        base_url + '/api/public/resumes/jobs/' + started['jobId'],\n        headers=headers,\n        timeout=30,\n    )\n    response.raise_for_status()\n    job = response.json()\n    if job['status'] in ('done', 'failed'):\n        break\n    time.sleep(2)`,
        xbot: `推荐配置：\n1. 在 XBot 全局变量中创建 resume_api_key，粘贴本页当前 Key\n2. 删除“调用流程”节点里写死的旧 api_key，避免旧值覆盖全局变量\n3. 服务地址固定为：${base.value}\n4. main(args) 中先执行 file_path = _resolve_file_path(args)\n5. 再执行 api_key = _get_api_key(args)，优先读取全局变量 resume_api_key\n6. 上传前 GET /api/public/resumes/formats，并在 Header 传 X-API-Key\n7. 校验成功后 POST /api/public/resumes/parse，multipart 文件字段名为 file\n8. 保存 jobId，每隔 1–3 秒 GET /api/public/resumes/jobs/{jobId}\n9. status 为 done 时读取 data，为 failed 时读取 error\n\n完整可用代码：project-docs/xbot-resume-parser.py`,
      };
    });
    const currentExample = computed(() => examples.value[codeTab.value] || examples.value.curl);

    async function loadConfig() {
      const controller = new AbortController();
      configController?.abort();
      configController = controller;
      configError.value = '';
      try {
        const result = await requestJson('api/resumes/api-config', { signal: controller.signal, timeoutMs: 5000 });
        if (disposed || controller.signal.aborted) return;
        apiConfig.value = result;
      } catch (error) {
        if (disposed || error?.name === 'AbortError') return;
        apiConfig.value = null;
        configError.value = conciseError(error);
      } finally {
        if (configController === controller) configController = null;
      }
    }

    async function copyText(value, successMessage) {
      try {
        await navigator.clipboard.writeText(value);
        notify(successMessage, 'success');
      } catch {
        notify('复制失败，请手动选择文本', 'error');
      }
    }

    async function checkConnection() {
      if (!apiConfig.value?.apiKey) return notify('当前环境没有可验证的 API Key', 'error');
      checking.value = true;
      connectionStatus.value = '正在验证公开接口与当前密钥…';
      try {
        const result = await requestJson('api/public/resumes/formats', { headers: { 'X-API-Key': apiConfig.value.apiKey }, timeoutMs: 10000 });
        const formats = Array.isArray(result.supportedExtensions) ? result.supportedExtensions.length : 0;
        connectionStatus.value = `连接正常：鉴权通过，支持 ${formats} 种文件扩展名，单文件最大 ${Number(result.maxFileSizeMB || 10)}MB。`;
        notify('简历解析公开接口连接正常', 'success');
      } catch (error) {
        connectionStatus.value = `连接失败：${conciseError(error)}`;
        notify(`接口连接检查失败：${conciseError(error)}`, 'error');
      } finally {
        checking.value = false;
      }
    }

    async function rotateKey() {
      if (!window.confirm('轮换 API Key 后，旧 Key 将无法继续调用接口。已经接入的外部系统需要同步更新 Key。确认继续？')) return;
      rotating.value = true;
      try {
        apiConfig.value = await requestJson('api/resumes/api-config/rotate', { method: 'POST' });
        configError.value = '';
      } catch (error) {
        notify(error.message || '操作失败', 'error');
      } finally {
        rotating.value = false;
      }
    }

    function selectCodeTab(key) {
      codeTab.value = key;
      selectedCodeTab = key;
    }

    loadConfig();
    onBeforeUnmount(() => {
      disposed = true;
      configController?.abort();
    });

    return () => (
      <div class="rf-api-page">
        {configError.value ? (
          <div class="rf-inline-warning">
            当前环境未返回 API Key，接口文档仍可查看：{configError.value}
            <button type="button" id="rf-api-config-retry" onClick={loadConfig}>重试</button>
          </div>
        ) : null}
        <div class="rf-api-hero">
          <section class="rf-api-intro">
            <div class="rf-kicker">DEVELOPER CENTER</div>
            <h1>将简历解析能力，接入你的业务系统</h1>
            <p>第三方招聘系统、表单或自动化流程可以通过 HTTP 接口上传简历。提交后返回任务 ID，再用任务 ID 查询结构化结果。</p>
            <div class="rf-format-tags">{formatTags.map((item) => <span>{item}</span>)}</div>
            <div class="rf-api-keybox"><b>API KEY</b><div><strong>长期有效，直到主动轮换</strong><span>请求头使用 X-API-Key；轮换后旧 Key 立即失效</span></div></div>
          </section>
          <section class="rf-code-panel">
            <div class="rf-code-head"><div><i></i><span>POST</span><code>/api/public/resumes/parse</code></div><button id="rf-copy-code" type="button" onClick={() => copyText(currentExample.value, '接口示例已复制')}>复制示例</button></div>
            <div class="rf-code-tabs">{codeTabs.map((tab) => <button class={codeTab.value === tab.key ? 'active' : ''} data-code-tab={tab.key} onClick={() => selectCodeTab(tab.key)}>{tab.label}</button>)}</div>
            <pre class="rf-code" id="rf-code">{currentExample.value}</pre>
            <div class="rf-return-fields"><span>完成时返回</span><b>姓名</b><b>联系方式</b><b>教育背景</b><b>工作经历</b><b>技能证书</b></div>
          </section>
        </div>
        <div class="rf-api-cards">
          {featureCards.map((card) => (
            <section key={card.tag}><span>{card.tag}</span><h3>{card.title}</h3><p>{card.description}</p></section>
          ))}
        </div>
        <section class="rf-key-manager">
          <div>
            <span>YOUR API KEY</span>
            <h2>当前应用密钥</h2>
            <p>{apiConfig.value?.validity || '长期有效，直到主动轮换密钥'}。仅用于外部系统调用，请勿写入前端源码或公开日志。</p>
            <small id="rf-api-connection-status">{connectionStatus.value}</small>
          </div>
          <div class="rf-key">
            <code id="rf-api-key">{apiKey.value}</code>
            <button id="rf-copy-key" type="button" onClick={() => copyText(apiKey.value, 'API Key 已复制')}>复制</button>
            <button id="rf-check-api" type="button" disabled={checking.value} onClick={checkConnection}>{checking.value ? '验证中…' : '验证连接'}</button>
            <button id="rf-rotate-key" type="button" disabled={rotating.value} onClick={rotateKey}>{rotating.value ? '轮换中…' : '轮换密钥'}</button>
          </div>
        </section>
      </div>
    );
  },
};

window.mountResumeApiPage = () => {
  const root = document.getElementById('resumeflow-api-root');
  if (!root) return false;
  activeApp?.unmount();
  activeApp = createApp(ApiDocumentationPage);
  activeApp.mount(root);
  return true;
};

window.unmountResumeApiPage = () => {
  activeApp?.unmount();
  activeApp = null;
};
