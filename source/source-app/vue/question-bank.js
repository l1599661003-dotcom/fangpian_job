import { computed, createApp, h, onBeforeUnmount, onMounted, ref } from 'vue';

let activeApp = null;
let activeLoad = null;
let dependencies = null;
let requestSequence = 0;

function text(value) {
  return String(value ?? '').trim();
}

function statusOptions() {
  return [
    ['', '全部状态'],
    ['已发布', '已启用'],
    ['草稿', '待审核'],
    ['已停用', '已停用'],
  ];
}

const QuestionBankPage = {
  setup() {
    const filters = ref({ scope: 'position', positionId: '', status: '' });
    const keyword = ref('');
    const loading = ref(true);
    const error = ref('');
    const data = ref({ positions: [], questions: [], feedbackJobs: [] });

    const writable = computed(() => {
      const actions = window.recruitmentAccess?.actions || [];
      return actions.includes('*') || actions.includes('manage_assessments');
    });

    const canRetryFeedback = computed(() => {
      const actions = window.recruitmentAccess?.actions || [];
      return actions.some((action) => ['*', 'manage_employee_lifecycle'].includes(action));
    });

    const filteredQuestions = computed(() => {
      const query = keyword.value.trim().toLowerCase();
      if (!query) return data.value.questions;
      return data.value.questions.filter((question) => {
        const haystack = [question.title, question.position, question.category]
          .map((value) => text(value).toLowerCase())
          .join(' ');
        return haystack.includes(query);
      });
    });

    const draftCount = computed(() => data.value.questions.filter((question) => question.status === '草稿').length);

    function query() {
      return new URLSearchParams({
        scope: filters.value.scope,
        positionId: filters.value.positionId,
        status: filters.value.status,
      }).toString();
    }

    async function load() {
      const sequence = ++requestSequence;
      loading.value = true;
      error.value = '';
      try {
        const result = await dependencies.request(`api/assessments/bank?${query()}`);
        if (sequence !== requestSequence) return;
        data.value = {
          positions: result.positions || [],
          questions: result.questions || [],
          feedbackJobs: result.feedbackJobs || [],
        };
      } catch (requestError) {
        if (sequence !== requestSequence) return;
        error.value = text(requestError?.message || requestError || '题库读取失败');
      } finally {
        if (sequence === requestSequence) loading.value = false;
      }
    }

    function updateScope(scope) {
      if (filters.value.scope === scope) return;
      filters.value.scope = scope;
      load();
    }

    function updateFilter(key, value) {
      filters.value[key] = value;
      load();
    }

    function clearFiltersAndRetry() {
      filters.value.positionId = '';
      filters.value.status = '';
      load();
    }

    async function retryFeedback(job, event) {
      try {
        await dependencies.request(`api/employee-lifecycle/${job.type}/${encodeURIComponent(job.id)}/question-bank/retry`, {
          method: 'POST',
          initiator: event?.currentTarget,
        });
        dependencies.notifyUser('已检查题库完善任务，请稍后刷新查看', 'success');
        await load();
      } catch (requestError) {
        dependencies.notifyUser(text(requestError?.message || requestError), 'error');
      }
    }

    async function updateStatus(question, event) {
      const status = question.status === '已发布' ? '已停用' : '已发布';
      const confirmed = window.confirm(status === '已发布'
        ? '确认已审核题目内容并启用？后续面试将可使用此题。'
        : '停用后不再用于新的面试，已有题单不受影响。确认停用？');
      if (!confirmed) return;
      try {
        await dependencies.request(`api/assessments/bank/${encodeURIComponent(question.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
          initiator: event?.currentTarget,
        });
        dependencies.notifyUser('题目状态已更新', 'success');
        await load();
      } catch (requestError) {
        dependencies.notifyUser(text(requestError?.message || requestError), 'error');
      }
    }

    function openEdit(question) {
      const escape = (value) => dependencies.escapeHtml(String(value ?? ''));
      dependencies.showTalentDialog(`<header class="rf-dialog-head"><div><span>QUESTION EDITOR</span><h2>完善题目</h2><p>仅修改题库；已生成的面试题单保持不变。</p></div></header><div class="rf-dialog-form"><label class="wide">题目<textarea id="qb-edit-title" rows="5">${escape(question.title)}</textarea></label><label class="wide">观察要点 / 参考答案<textarea id="qb-edit-answer" rows="5">${escape(question.referenceAnswer)}</textarea></label></div><div class="rf-dialog-actions"><button class="btn-primary" id="qb-edit-save">保存修改</button></div><p id="qb-edit-message" role="status"></p>`, 'wide');
      const saveButton = document.getElementById('qb-edit-save');
      saveButton.onclick = async (event) => {
        const message = document.getElementById('qb-edit-message');
        try {
          message.textContent = '正在保存…';
          await dependencies.request(`api/assessments/bank/${encodeURIComponent(question.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: document.getElementById('qb-edit-title').value,
              referenceAnswer: document.getElementById('qb-edit-answer').value,
            }),
            initiator: event.currentTarget,
          });
          message.textContent = '已保存，可以关闭此窗口。';
          await load();
        } catch (requestError) {
          message.textContent = text(requestError?.message || requestError);
        }
      };
    }

    function openImport() {
      const escape = (value) => dependencies.escapeHtml(String(value ?? ''));
      let preview = [];
      let fingerprint = '';
      let fileQuestions = null;
      dependencies.showTalentDialog(`<header class="rf-dialog-head"><div><span>IMPORT QUESTIONS</span><h2>导入${filters.value.scope === 'personal' ? '我的题库' : '岗位基础题库'}</h2><p>先选择岗位，再预览确认。每次最多 200 道；同一题库的重复题自动跳过。</p></div></header><div class="rf-dialog-form qb-import-form"><label class="wide">所属岗位<select id="qb-import-position"><option value="">请选择岗位</option>${data.value.positions.map((position) => `<option value="${escape(position.id)}" ${position.id === filters.value.positionId ? 'selected' : ''}>${escape(position.department)} · ${escape(position.name)}</option>`).join('')}</select></label><label class="wide">Excel / CSV / TXT 文件<input id="qb-file" type="file" accept=".xlsx,.xls,.csv,.txt"><small>表头：题目、维度、参考答案、说明；也可直接粘贴，每行一道题。</small></label><button class="btn-soft" type="button" id="qb-template">下载 Excel 模板</button><label class="wide">题目内容<textarea id="qb-import-text" rows="8" placeholder="请介绍一次最有代表性的项目，说明你的职责和结果。"></textarea></label></div><p id="qb-import-message" role="status" aria-live="polite"></p><div id="qb-import-preview" class="qb-question-cards"></div><div class="rf-dialog-actions qb-import-actions"><button class="btn-soft" id="qb-preview">预览检查</button><button class="btn-primary" id="qb-confirm" disabled>确认导入并启用</button></div>`, 'wide');
      const textarea = document.getElementById('qb-import-text');
      const message = document.getElementById('qb-import-message');
      const confirmButton = document.getElementById('qb-confirm');
      const pasteButton = document.createElement('button');
      pasteButton.type = 'button';
      pasteButton.className = 'btn-soft';
      pasteButton.textContent = '清空文件，改为粘贴题目';
      pasteButton.hidden = true;
      textarea.parentElement.append(pasteButton);
      const invalidate = () => {
        preview = [];
        fingerprint = '';
        confirmButton.disabled = true;
        document.getElementById('qb-import-preview').innerHTML = '';
      };
      textarea.oninput = invalidate;
      pasteButton.onclick = () => {
        fileQuestions = null;
        textarea.readOnly = false;
        textarea.value = '';
        document.getElementById('qb-file').value = '';
        pasteButton.hidden = true;
        invalidate();
        message.textContent = '请粘贴题目，每行一道。';
        textarea.focus();
      };
      document.getElementById('qb-import-position').onchange = invalidate;
      document.getElementById('qb-template').onclick = () => {
        const workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, window.XLSX.utils.aoa_to_sheet([['题目', '维度', '参考答案', '说明'], ['请说明一次项目的目标、行动和结果。', '专业能力', '关注具体职责、数据证据与复盘', '可结合岗位追问']]), '岗位题库');
        window.XLSX.writeFile(workbook, '岗位基础题库导入模板.xlsx');
      };
      document.getElementById('qb-file').onchange = async (event) => {
        invalidate();
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          if (file.size > 2 * 1024 * 1024) throw new Error('文件不能超过2MB');
          if (/\.txt$/i.test(file.name)) {
            textarea.value = await file.text();
            fileQuestions = null;
            textarea.readOnly = false;
            pasteButton.hidden = true;
          } else {
            const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
            if (!rows.length || !Object.hasOwn(rows[0], '题目')) throw new Error('请使用模板表头：题目、维度、参考答案、说明');
            fileQuestions = rows.map((row) => ({ title: row['题目'], category: row['维度'], referenceAnswer: row['参考答案'], description: row['说明'] }));
            textarea.value = fileQuestions.map((row) => row.title).join('\n');
            textarea.readOnly = true;
            pasteButton.hidden = false;
          }
          message.textContent = '已读取文件，请点击“预览检查”查看题目、参考答案和说明。';
        } catch (fileError) {
          message.textContent = text(fileError?.message || fileError);
        }
      };
      document.getElementById('qb-preview').onclick = () => {
        try {
          invalidate();
          if (!document.getElementById('qb-import-position').value) throw new Error('请先选择岗位');
          const value = textarea.value.trim();
          const rows = fileQuestions || (value.startsWith('[') ? JSON.parse(value) : value.split('\n').filter((line) => line.trim()).map((line) => ({ title: line.trim() })));
          if (!Array.isArray(rows) || !rows.length || rows.length > 200 || rows.some((row) => !text(row?.title) || text(row.title).length > 2000)) throw new Error('请提供1–200道有效题目，每道题最多2000字');
          const seen = new Set();
          preview = rows.filter((row) => {
            const key = text(row.title).normalize('NFKC').replace(/\s+/g, ' ');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          fingerprint = textarea.value;
          document.getElementById('qb-import-preview').innerHTML = preview.map((question, index) => window.renderInterviewQuestionCard(question, index, escape)).join('');
          message.textContent = `预览 ${preview.length} 道题，文件内重复 ${rows.length - preview.length} 道；已有题目将在保存时去重。`;
          confirmButton.disabled = false;
        } catch (previewError) {
          message.textContent = text(previewError?.message || previewError);
        }
      };
      confirmButton.onclick = async () => {
        if (!preview.length || fingerprint !== textarea.value) return;
        confirmButton.disabled = true;
        const positionId = document.getElementById('qb-import-position').value;
        const questions = [...preview];
        try {
          message.textContent = '正在导入，请勿重复提交…';
          const started = await dependencies.request('api/assessments/bank/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ positionId, scope: filters.value.scope, questions }),
            initiator: confirmButton,
          });
          const result = await dependencies.pollInterviewResource(started, (progress) => {
            message.textContent = progress;
          });
          message.textContent = `已导入 ${result.created} 道，跳过重复 ${result.skipped} 道，失败 ${result.failed} 道。${result.failed ? '内容已保留，可重试；成功题目不会重复导入。' : '已启用，可用于后续面试。'}`;
          if (result.errors?.length) message.textContent += result.errors.map((item) => `第${item.row}行：${item.message}`).join('；');
          confirmButton.disabled = !result.failed;
          await load();
        } catch (importError) {
          message.textContent = `导入未确认完成：${text(importError?.message || importError)}。内容已保留，重试会检查重复题。`;
          confirmButton.disabled = false;
        }
      };
    }

    function questionCard(question, index) {
      const hasEvidence = question.description || question.why || question.observation || question.referenceAnswer;
      return (
        <article class="qb-card" key={question.id || `${question.title}-${index}`}>
          <div class="qb-card-number">{String(index + 1).padStart(2, '0')}</div>
          <div class="qb-card-body">
            <div class="qb-tags">
              <span>{question.category || question.dimension || '结构化面试'}</span>
              <span>{question.source || '岗位基础题'}</span>
              {question.status ? <span>{question.status}</span> : null}
            </div>
            <h3>{question.title || question.question}</h3>
            {question.position ? <p class="qb-role">{question.position}</p> : null}
            {hasEvidence ? (
              <details>
                <summary>查看追问提示与观察要点</summary>
                {question.description || question.why ? <p>{question.description || question.why}</p> : null}
                {question.observation || question.referenceAnswer ? (
                  <div class="qb-evidence">
                    <b>观察要点 / 参考答案</b>
                    <p>{question.observation || question.referenceAnswer}</p>
                  </div>
                ) : null}
              </details>
            ) : (
              <p class="qb-muted">结合候选人的具体经历追问，记录可核验的事实。</p>
            )}
            {writable.value ? (
              <div class="qb-card-actions">
                <button class="btn-soft" type="button" data-qb-edit={question.id} onClick={() => openEdit(question)}>编辑</button>
                <button class="btn-soft" type="button" data-qb-status={question.id} onClick={(event) => updateStatus(question, event)}>
                  {question.status === '已发布' ? '停用' : '审核并启用'}
                </button>
              </div>
            ) : null}
          </div>
        </article>
      );
    }

    onMounted(load);
    onBeforeUnmount(() => {
      requestSequence += 1;
    });

    activeLoad = load;

    return () => {
      if (loading.value && !data.value.questions.length) {
        return <div class="rf-dialog-loading" role="status">正在读取岗位和题库…</div>;
      }

      if (error.value && !data.value.questions.length) {
        return (
          <div class="rf-dialog-empty">
            <strong>题库读取失败</strong>
            <p>{error.value}</p>
            <button class="btn-soft" type="button" data-qb-retry onClick={load}>重试</button>
            <button class="btn-soft" type="button" data-qb-reset onClick={clearFiltersAndRetry}>清除筛选并重试</button>
          </div>
        );
      }

      return (
        <div class="qb-page-vue">
          <header class="qb-header">
            <div>
              <span>INTERVIEW KNOWLEDGE</span>
              <h1>把经验，变成下一次好问题</h1>
              <p>岗位基础题优先使用；未配置时由 AI 补充。入职评价、离职复盘形成待审核建议。</p>
            </div>
            {writable.value ? <button class="btn-primary" type="button" data-qb-import onClick={openImport}>导入题目</button> : null}
          </header>
          <div class="qb-tabs" role="group" aria-label="题库分类">
            <button type="button" data-qb-scope="position" aria-pressed={filters.value.scope === 'position'} onClick={() => updateScope('position')}>岗位基础题库</button>
            <button type="button" data-qb-scope="personal" aria-pressed={filters.value.scope === 'personal'} onClick={() => updateScope('personal')}>我的题库</button>
          </div>
          <section class="qb-toolbar">
            <label>
              所属岗位
              <select id="qb-position" value={filters.value.positionId} onChange={(event) => updateFilter('positionId', event.target.value)}>
                <option value="">全部授权岗位</option>
                {data.value.positions.map((position) => (
                  <option key={position.id} value={position.id}>{position.department} · {position.name}</option>
                ))}
              </select>
            </label>
            <label>
              题目状态
              <select id="qb-status" value={filters.value.status} onChange={(event) => updateFilter('status', event.target.value)}>
                {statusOptions().map(([value, label]) => (
                  <option key={value || 'all'} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              搜索题目
              <input id="qb-search" type="search" placeholder="题目、岗位或维度" value={keyword.value} onInput={(event) => { keyword.value = event.target.value; }} />
            </label>
          </section>
          <div class="qb-summary">
            <strong>{data.value.questions.length} 道题</strong>
            <span>{draftCount.value} 道待审核</span>
            <small>{filters.value.scope === 'personal' ? '仅显示分配给你本人的面试题；其他面试官不可代为修改。' : '按具体岗位配置，不会覆盖已有面试题快照。'}</small>
          </div>
          {data.value.feedbackJobs.length ? (
            <section class="qb-feedback-jobs">
              <strong>题库完善任务</strong>
              {data.value.feedbackJobs.map((job) => (
                <div key={`${job.type}-${job.id}`}>
                  <span>{job.label} · {job.status}</span>
                  {job.error ? <p>{job.error}</p> : null}
                  {canRetryFeedback.value ? (
                    <button class="btn-soft" type="button" data-qb-feedback-retry={job.id} data-kind={job.type} onClick={(event) => retryFeedback(job, event)}>重试 / 检查状态</button>
                  ) : (
                    <small>如任务失败，请联系负责HR重试。</small>
                  )}
                </div>
              ))}
              <button class="btn-soft" type="button" data-qb-refresh onClick={load}>刷新任务状态</button>
            </section>
          ) : null}
          <div id="qb-cards" class="qb-question-cards">
            {filteredQuestions.value.length ? filteredQuestions.value.map((question, index) => questionCard(question, index)) : (
              <div class="qb-empty">
                <strong>还没有匹配的题目</strong>
                <p>导入岗位基础题后优先使用；未配置岗位基础题时，确认面试后由 AI 生成。</p>
              </div>
            )}
          </div>
        </div>
      );
    };
  },
};

window.mountQuestionBankPage = (options) => {
  const root = document.getElementById('question-bank-root');
  dependencies = options;
  if (!root) return Promise.resolve(false);
  if (!activeApp) {
    activeApp = createApp(QuestionBankPage);
    activeApp.mount(root);
  }
  return activeLoad?.() ?? Promise.resolve(false);
};

window.unmountQuestionBankPage = () => {
  activeApp?.unmount();
  activeApp = null;
  activeLoad = null;
  dependencies = null;
};
