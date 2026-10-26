import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, ref, Teleport, watch } from 'vue';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

let activeApp = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

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

async function requestJson(path, { body, headers, method, signal, timeoutMs = 15000 } = {}) {
  const requestHeaders = identityHeaders();
  if (headers) Object.entries(headers).forEach(([key, value]) => requestHeaders.set(key, value));
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(apiUrl(path), { body, method: method || 'GET', headers: requestHeaders, signal: controller.signal });
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

function shanghaiDateTimeMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  if (/Z$|[+-]\d{2}:\d{2}$/.test(raw)) return Date.parse(raw);
  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!matched) return Date.parse(raw);
  return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), Number(matched[4]) - 8, Number(matched[5]), Number(matched[6] || 0));
}

function formatShanghaiDateTime(value) {
  const timestamp = shanghaiDateTimeMs(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

function scheduleText(task) {
  if (!task?.cron) return task?.schedule || '未设置';
  try {
    return window.taskSchedule.compile(window.taskSchedule.parse(task.cron)).schedule;
  } catch {
    return task.schedule || task.cron;
  }
}

function statusText(task) {
  if (task.enabled === false) return '已停用';
  if (task.lastStatus === 'success') return '运行正常';
  if (task.lastStatus === 'failed') return '执行失败';
  return '已启用';
}

function statusClass(status) {
  return status === 'success' ? 'done' : status === 'failed' ? 'failed' : '';
}

function notify(message, type = 'info') {
  let region = document.getElementById('rf-notification-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'rf-notification-region';
    region.className = 'rf-notification-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-label', '操作消息');
    document.body.appendChild(region);
  }
  const item = document.createElement('div');
  item.className = `rf-notification ${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.innerHTML = `<i>${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</i><div><strong>${type === 'success' ? '操作成功' : type === 'error' ? '操作未完成' : '操作提示'}</strong><p>${escapeHtml(message)}</p></div><button type="button" aria-label="关闭提示">×</button>`;
  item.querySelector('button')?.addEventListener('click', () => item.remove());
  region.appendChild(item);
  if (type !== 'error') window.setTimeout(() => item.remove(), 8000);
}

const ScheduledTasksPage = {
  setup() {
    const tasks = ref([]);
    const runs = ref([]);
    const loading = ref(true);
    const error = ref('');
    const activeDialog = ref('');
    const templates = ref([]);
    const selectedTemplate = ref(null);
    const editTask = ref(null);
    const creatingTask = ref(false);
    const enabled = ref(true);
    const saving = ref(false);
    const editError = ref('');
    const runningTasks = ref(new Set());
    const schedulePickerRoot = ref(null);
    let schedulePicker = null;
    let taskController = null;
    let disposed = false;

    const availableTemplates = computed(() => templates.value.filter((template) => template.available));

    function setRunning(taskName, running) {
      const next = new Set(runningTasks.value);
      if (running) next.add(taskName);
      else next.delete(taskName);
      runningTasks.value = next;
    }

    async function loadTasks() {
      const controller = new AbortController();
      taskController?.abort();
      taskController = controller;
      loading.value = true;
      error.value = '';
      try {
        const data = await requestJson('api/studio-tasks', { signal: controller.signal });
        if (disposed || controller.signal.aborted) return;
        tasks.value = data.tasks || [];
        runs.value = data.recentRuns || [];
      } catch (requestError) {
        if (disposed || requestError?.name === 'AbortError') return;
        error.value = conciseError(requestError);
      } finally {
        if (taskController === controller) {
          taskController = null;
          loading.value = false;
        }
      }
    }

    async function openTemplateDialog() {
      activeDialog.value = 'templates';
      templates.value = [];
      try {
        const data = await requestJson('api/studio-tasks/templates');
        if (disposed || activeDialog.value !== 'templates') return;
        templates.value = data.templates || [];
      } catch (requestError) {
        if (disposed || activeDialog.value !== 'templates') return;
        notify(`任务模板读取失败：${conciseError(requestError)}`, 'error');
        activeDialog.value = '';
      }
    }

    function openEditDialog(template, task = null) {
      selectedTemplate.value = template;
      editTask.value = task;
      creatingTask.value = !task;
      enabled.value = task?.enabled !== false;
      editError.value = '';
      saving.value = false;
      activeDialog.value = 'edit';
    }

    function closeDialog() {
      activeDialog.value = '';
      schedulePicker = null;
      selectedTemplate.value = null;
      editTask.value = null;
      editError.value = '';
      saving.value = false;
    }

    async function saveSchedule() {
      if (saving.value || !schedulePicker) return;
      editError.value = '';
      saving.value = true;
      try {
        const config = { ...schedulePicker.value(), enabled: enabled.value };
        const taskName = selectedTemplate.value?.name;
        await requestJson(`api/studio-tasks/${encodeURIComponent(taskName)}/config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        notify(`任务「${taskName}」已保存：${config.schedule}${config.enabled ? '' : '（已停用）'}`, 'success');
        closeDialog();
        await loadTasks();
      } catch (requestError) {
        editError.value = `保存失败：${conciseError(requestError)}。设置已保留，请检查后重试。`;
      } finally {
        saving.value = false;
      }
    }

    async function toggleTask(task) {
      try {
        await requestJson(`api/studio-tasks/${encodeURIComponent(task.name)}/config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: task.enabled === false }),
        });
        notify(`任务「${task.name}」已${task.enabled === false ? '启用' : '停用'}`, 'success');
        await loadTasks();
      } catch (requestError) {
        notify(`操作失败：${conciseError(requestError)}`, 'warning');
      }
    }

    async function waitForJob(jobId, taskName) {
      if (!jobId) throw new Error('后台任务未返回 jobId');
      const deadline = Date.now() + 600000;
      let failures = 0;
      while (Date.now() < deadline && !disposed) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        let job;
        try {
          job = await requestJson(`api/jobs/${encodeURIComponent(jobId)}`);
          failures = 0;
        } catch (requestError) {
          failures += 1;
          if ([400, 401, 403, 404].includes(Number(requestError?.status)) || failures >= 3) throw requestError;
          continue;
        }
        if (job.status === 'done') return job.data || { status: 'failed', error: '任务没有返回执行结果' };
        if (job.status === 'failed') throw new Error(job.error || '后台处理失败');
      }
      if (disposed) throw new Error('页面已切换，任务仍在后台执行');
      throw new Error(`任务「${taskName}」仍在后台执行，请稍后查看最近执行记录，勿重复执行`);
    }

    async function runTask(task) {
      if (runningTasks.value.has(task.name)) return;
      setRunning(task.name, true);
      try {
        const started = await requestJson(`api/studio-tasks/${encodeURIComponent(task.name)}/run-now`, { method: 'POST' });
        const result = await waitForJob(started.jobId, task.name);
        notify(`任务「${task.name}」执行${result.status === 'success' ? '成功' : '失败'}`, result.status === 'success' ? 'success' : 'warning');
        await loadTasks();
      } catch (requestError) {
        notify(`任务执行失败：${conciseError(requestError)}`, 'warning');
      } finally {
        setRunning(task.name, false);
      }
    }

    watch(activeDialog, async (dialog) => {
      schedulePicker = null;
      if (dialog !== 'edit') return;
      await nextTick();
      if (activeDialog.value !== 'edit' || !schedulePickerRoot.value) return;
      const template = selectedTemplate.value || {};
      const cron = editTask.value?.cron || template.defaultCron || '0 20 * * *';
      schedulePicker = window.taskSchedule?.mount(schedulePickerRoot.value, cron, escapeHtml, editTask.value?.timezone || template.timezone);
    });

    onMounted(() => {
      window.refreshScheduledTasksPage = loadTasks;
      loadTasks();
    });

    onBeforeUnmount(() => {
      disposed = true;
      taskController?.abort();
      delete window.refreshScheduledTasksPage;
    });

    return () => {
      if (loading.value) return <div class="rf-dialog-loading">正在加载定时任务…</div>;
      if (error.value) {
        return (
          <div class="rf-dialog-empty">
            <strong>加载失败</strong>
            <p>{error.value}</p>
            <button class="btn-soft" type="button" onClick={loadTasks}>重新加载</button>
          </div>
        );
      }

      return (
        <div>
          <div class="rf-tasks-toolbar">
            <button class="btn-primary" id="rf-task-create-btn" type="button" data-task-create="" data-required-action="manage_system" onClick={openTemplateDialog}>+ 新建任务</button>
          </div>
          <div class="rf-tasks-layout">
            <section class="rf-tasks-list">
              <div class="rf-tasks-section-title"><strong>任务列表</strong><small>共 {tasks.value.length} 个任务</small></div>
              <div class="rf-tasks-grid">
                {tasks.value.length ? tasks.value.map((task) => {
                  const taskStatusClass = statusClass(task.lastStatus);
                  const running = runningTasks.value.has(task.name);
                  return (
                    <article class={`rf-task-card ${taskStatusClass} ${task.enabled === false ? 'disabled' : ''}`} key={task.name}>
                      <div class="rf-task-card-head">
                        <strong>{task.name}</strong>
                        <span class={`rf-task-status ${taskStatusClass}`}>{statusText(task)}</span>
                      </div>
                      <p class="rf-task-desc">{task.description || '无描述'}</p>
                      <div class="rf-task-meta">
                        <span class="ts-list-schedule">{scheduleText(task)}</span>
                        <span class="ts-timezone">{task.timezone || '以任务服务时区为准'}</span>
                        <span>已执行：{Number(task.runCount || 0)} 次</span>
                        {task.lastRunAt ? <span>上次执行：{formatShanghaiDateTime(task.lastRunAt)}</span> : null}
                      </div>
                      {task.lastError ? <div class="rf-task-error">{task.lastError}</div> : null}
                      <div class="rf-task-actions">
                        <button class="btn-soft" type="button" data-task-run={task.name} data-required-action="manage_system" disabled={running} onClick={() => runTask(task)}>{running ? '执行中…' : '手动执行'}</button>
                        <button class="btn-soft" type="button" data-task-edit={task.name} data-required-action="manage_system" onClick={() => openEditDialog(templates.value.find((item) => item.name === task.name) || { name: task.name, description: task.description, timezone: task.timezone }, task)}>编辑</button>
                        <button class="btn-soft" type="button" data-task-toggle={task.name} data-enabled={task.enabled === false ? '0' : '1'} data-required-action="manage_system" onClick={() => toggleTask(task)}>{task.enabled === false ? '启用' : '停用'}</button>
                      </div>
                    </article>
                  );
                }) : <div class="rf-dialog-empty"><p>暂无定时任务，点击"新建任务"从模板创建</p></div>}
              </div>
            </section>
            <aside class="rf-tasks-runs">
              <div class="rf-tasks-section-title"><strong>最近执行</strong><small>最近 {runs.value.length} 条</small></div>
              <div class="rf-task-runs-list">
                {runs.value.length ? runs.value.map((run) => {
                  const runStatusClass = statusClass(run.status);
                  const duration = run.durationMs ? `${(Number(run.durationMs) / 1000).toFixed(1)}秒` : '';
                  return (
                    <article class={`rf-task-run ${runStatusClass}`} key={`${run.task}-${run.startedAt}-${run.status}`}>
                      <div>
                        <strong>{run.task || '未命名任务'}</strong>
                        <small>{run.trigger === 'manual' ? '手动执行' : run.trigger === 'cron' ? '定时执行' : run.trigger || '历史执行'} · {formatShanghaiDateTime(run.startedAt) || ''}{duration ? ` · ${duration}` : ''}</small>
                      </div>
                      <span>{run.status}</span>
                      {run.error ? <p>{run.error}</p> : null}
                    </article>
                  );
                }) : <div class="rf-dialog-empty"><p>暂无执行记录</p></div>}
              </div>
            </aside>
          </div>

          <Teleport to="body">
            {activeDialog.value ? (
              <div class="rf-dialog-backdrop" id="rf-talent-dialog">
                <section class={`rf-dialog ${activeDialog.value === 'templates' ? 'wide' : 'normal'}`} role="dialog" aria-modal="true" aria-labelledby="rf-dialog-title">
                  <button class="rf-dialog-close" type="button" aria-label="关闭对话框" onClick={closeDialog}>×</button>
                  {activeDialog.value === 'templates' ? (
                    <div>
                      <header class="rf-dialog-head">
                        <div><span>SCHEDULED TASKS</span><h2 id="rf-dialog-title">先选要执行的任务</h2><p>下一步设置每天、每周、每月或间隔执行，不需要填写代码。</p></div>
                      </header>
                      <div class="rf-task-templates-grid">
                        {availableTemplates.value.length ? availableTemplates.value.map((template) => {
                          const exists = tasks.value.some((task) => task.name === template.name);
                          return (
                            <article class="rf-task-template-card" key={template.name}>
                              <div class="rf-task-template-head"><strong>{template.name}</strong><span class="rf-task-template-badge">{exists ? '已添加' : '可创建'}</span></div>
                              <p>{template.description}</p>
                              <button class="btn-primary" type="button" data-task-select={template.name} data-required-action="manage_system" onClick={() => openEditDialog(template, tasks.value.find((task) => task.name === template.name))}>{exists ? '修改执行计划' : '设置执行时间'}</button>
                            </article>
                          );
                        }) : <div class="rf-dialog-empty">暂无可用模板</div>}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <header class="rf-dialog-head">
                        <div><span>SCHEDULED TASKS</span><h2 id="rf-dialog-title">{creatingTask.value ? '创建任务' : '执行时间'}：{selectedTemplate.value?.name}</h2><p>{editTask.value?.description || selectedTemplate.value?.description || '选择执行方式，系统自动保存对应计划。'}</p></div>
                      </header>
                      <div id="rf-task-schedule-picker" ref={schedulePickerRoot}></div>
                      <label class="ts-enabled">
                        <input id="rf-task-edit-enabled" type="checkbox" checked={enabled.value} onChange={(event) => { enabled.value = event.target.checked; }} />启用此任务（关闭后保留计划，但不自动执行）
                      </label>
                      <p class="ts-error" id="rf-task-edit-error" role="alert">{editError.value}</p>
                      <button class="btn-primary ts-save" id="rf-task-edit-save" type="button" data-required-action="manage_system" disabled={saving.value} onClick={saveSchedule}>{saving.value ? '正在保存…' : creatingTask.value ? '创建并保存' : '保存'}</button>
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </Teleport>
        </div>
      );
    };
  },
};

window.mountScheduledTasksPage = () => {
  const root = document.getElementById('scheduled-tasks-root');
  if (!root) return false;
  if (activeApp) {
    window.refreshScheduledTasksPage?.();
    return true;
  }
  activeApp = createApp(ScheduledTasksPage);
  activeApp.mount(root);
  return true;
};

window.unmountScheduledTasksPage = () => {
  activeApp?.unmount();
  activeApp = null;
};
