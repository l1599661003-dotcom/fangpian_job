import { Fragment, computed, createApp, h, onBeforeUnmount, ref, watch } from 'vue';

let activeApp = null;
let activeLoad = null;
let activeSync = null;
let dependencies = null;
let requestSequence = 0;
let activeLoadPromise = null;
let activeLoadKey = '';

const metricDefinitions = [
  { key: 'resumes', label: '简历入库', detailsKey: 'resumeUploads', empty: '该周期暂无简历入库记录' },
  { key: 'interviews', label: '面试场次', detailsKey: 'interviewDetails', empty: '该周期暂无面试场次' },
  { key: 'offers', label: '已发 Offer', detailsKey: 'offerDetails', empty: '该周期暂无已发送 Offer' },
  { key: 'arrived', label: '实际到岗', detailsKey: 'arrivalDetails', empty: '该周期暂无实际到岗记录' },
];

function text(value) {
  return String(value ?? '').trim();
}

function fallbackEscape(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function currentMonthValue() {
  if (typeof window.companyCalendar?.monthForDate === 'function') return window.companyCalendar.monthForDate(new Date());
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiDateTimeMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const raw = text(value);
  if (!raw) return Number.NaN;
  if (/Z$|[+-]\d{2}:\d{2}$/.test(raw)) return Date.parse(raw);
  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!matched) return Date.parse(raw);
  return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), Number(matched[4]) - 8, Number(matched[5]), Number(matched[6] || 0));
}

function formatShanghaiDateTime(value) {
  const timestamp = shanghaiDateTimeMs(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 16) : '';
}

function conciseError(error) {
  const message = String(error?.message || error || '服务暂时不可用');
  if (/\b404\b/.test(message)) return '接口暂时不可用（404）';
  return message.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function compareArrival(left, right, sortBy) {
  if (!['expectedArrivalDate', 'latestArrivalDate'].includes(sortBy)) return 0;
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
  return (valid(left[sortBy]) ? left[sortBy] : '9999-12-31').localeCompare(valid(right[sortBy]) ? right[sortBy] : '9999-12-31');
}

const OverviewPage = {
  setup() {
    const period = ref(['day', 'week', 'month'].includes(dependencies?.initialPeriod) ? dependencies.initialPeriod : 'day');
    const selectedMonth = ref(/^\d{4}-\d{2}$/.test(text(dependencies?.initialMonth)) ? dependencies.initialMonth : currentMonthValue());
    const arrivalSort = ref(['priority', 'expectedArrivalDate', 'latestArrivalDate'].includes(dependencies?.initialArrivalSort) ? dependencies.initialArrivalSort : 'priority');
    const data = ref(null);
    const loading = ref(true);
    const error = ref('');

    const hiringActivity = computed(() => data.value?.hiringActivity || data.value?.dailyHiring || { date: '', summary: {}, uploaders: [], resumeUploads: [] });
    const activitySummary = computed(() => hiringActivity.value.summary || {});
    const summary = computed(() => data.value?.summary || {});
    const uploaders = computed(() => Array.isArray(hiringActivity.value.uploaders) ? hiringActivity.value.uploaders : []);
    const departmentUploads = computed(() => Array.isArray(hiringActivity.value.departmentUploads) ? hiringActivity.value.departmentUploads : []);
    const periodName = computed(() => ({ day: '今日', week: '本周', month: '所选公司月' })[period.value]);

    const departments = computed(() => {
      const priorityRank = (priority) => ({ 紧急: 0, 高: 0, 重要: 1, 中: 1, 储备: 2, 低: 2 }[priority] ?? 3);
      const normalizePriority = (priority) => ({ 高: '紧急', 中: '重要', 低: '储备', 一般: '储备' }[priority] || priority || '储备');
      return (data.value?.departments || []).map((row) => {
        const demand = Number(row.demand || 0);
        const completed = Number(row.completed || 0);
        return {
          ...row,
          demand,
          completed,
          priority: normalizePriority(row.priority),
          completedNames: Array.isArray(row.completedNames) ? row.completedNames : [],
          remaining: Number.isFinite(Number(row.remaining)) ? Number(row.remaining) : Math.max(0, demand - completed),
          completionRate: Number.isFinite(Number(row.completionRate)) ? Number(row.completionRate) : (demand > 0 ? Math.min(100, Math.round((completed / demand) * 100)) : 0),
          completedAll: typeof row.completedAll === 'boolean' ? row.completedAll : demand > 0 && completed >= demand,
        };
      }).sort((left, right) => Number(left.completedAll) - Number(right.completedAll)
        || compareArrival(left, right, arrivalSort.value)
        || priorityRank(left.priority) - priorityRank(right.priority)
        || (!left.completedAll ? left.completed - right.completed : 0)
        || right.demand - left.demand
        || String(left.department || '').localeCompare(String(right.department || ''), 'zh-CN')
        || String(left.role || '').localeCompare(String(right.role || ''), 'zh-CN'));
    });

    const completedPositionCount = computed(() => departments.value.filter((row) => row.completedAll).length);
    const remainingHeadcount = computed(() => departments.value.reduce((total, row) => total + row.remaining, 0));
    const targetMonthValue = computed(() => data.value?.month || (period.value === 'month' ? selectedMonth.value : currentMonthValue()));
    const targetMonthLabel = computed(() => {
      const range = window.companyCalendar?.monthRange(targetMonthValue.value)?.label;
      return `${targetMonthValue.value}${range ? ` · ${range}` : ''}`;
    });
    const activityScope = computed(() => period.value === 'day' ? '北京时间当日' : period.value === 'week' ? '本周一至周日' : `公司月历 ${targetMonthLabel.value}`);

    function apiUrl(path) {
      return new URL(path.replace(/^\//, ''), new URL('.', window.location.href)).toString();
    }

    async function load() {
      const month = period.value === 'month' ? selectedMonth.value : currentMonthValue();
      const key = `${period.value}:${month}`;
      if (activeLoadPromise && activeLoadKey === key) return activeLoadPromise;
      const sequence = ++requestSequence;
      const promise = (async () => {
        loading.value = !data.value;
        error.value = '';
        try {
          const result = await dependencies.request(`api/recruitment/monthly-hiring?month=${encodeURIComponent(month)}&period=${encodeURIComponent(period.value)}`);
          if (sequence !== requestSequence) return;
          data.value = result;
        } catch (requestError) {
          if (sequence !== requestSequence) return;
          data.value = null;
          error.value = conciseError(requestError);
        } finally {
          if (sequence === requestSequence) loading.value = false;
        }
      })();
      activeLoadPromise = promise;
      activeLoadKey = key;
      try {
        return await promise;
      } finally {
        if (activeLoadPromise === promise) {
          activeLoadPromise = null;
          activeLoadKey = '';
        }
      }
    }

    function setPeriod(value) {
      if (period.value === value) return;
      period.value = value;
      if (value === 'month' && !/^\d{4}-\d{2}$/.test(selectedMonth.value)) selectedMonth.value = currentMonthValue();
      load();
    }

    watch([period, selectedMonth, arrivalSort], () => {
      dependencies?.onStateChange?.({
        period: period.value,
        selectedMonth: selectedMonth.value,
        arrivalSort: arrivalSort.value,
      });
    });

    function metricDetailHtml(metric, row) {
      const escape = dependencies.escapeHtml || fallbackEscape;
      const tone = metricDefinitions.findIndex((item) => item.key === metric) + 1;
      if (metric === 'resumes') {
        return `<article class="overview-metric-detail tone-${tone}">
          <div><strong>${escape(row.candidateName || '未命名候选人')}</strong><span>${escape(row.department || '未归属部门')} · ${escape(row.uploader || '未记录上传人')}</span></div>
          <dl><div><dt>简历</dt><dd>${escape(row.fileName || '未命名简历')}</dd></div><div><dt>时间</dt><dd>${escape(formatShanghaiDateTime(row.uploadedAt) || row.uploadedAt || '未记录')}</dd></div><div><dt>来源</dt><dd>${escape(row.source || '简历上传')}</dd></div></dl>
          ${row.sourceUrl ? `<a href="${escape(row.sourceUrl)}" target="_blank" rel="noopener">查看原始简历 ↗</a>` : '<span class="overview-metric-miss">未找到原始附件</span>'}
        </article>`;
      }
      if (metric === 'interviews') {
        return `<article class="overview-metric-detail tone-${tone}">
          <div><strong>${escape(row.candidateName || '未命名候选人')}</strong><span>${escape(row.department || '未分配部门')} · ${escape(row.position || '未命名岗位')}</span></div>
          <dl><div><dt>面试</dt><dd>${escape(row.round || '待定轮次')} · ${escape(row.method || '待定方式')}</dd></div><div><dt>时间</dt><dd>${escape(formatShanghaiDateTime(row.startsAt) || row.startsAt || '未记录')}</dd></div><div><dt>面试官</dt><dd>${escape(row.interviewers || '待定')}</dd></div><div><dt>地点</dt><dd>${escape(row.location || '待定地点')}</dd></div></dl>
          <em>${escape(row.status || '待确认')}</em>
        </article>`;
      }
      if (metric === 'offers') {
        return `<article class="overview-metric-detail tone-${tone}">
          <div><strong>${escape(row.candidateName || '未命名候选人')}</strong><span>${escape(row.department || '未分配部门')} · ${escape(row.position || '未命名岗位')}</span></div>
          <dl><div><dt>Offer 编号</dt><dd>${escape(row.offerNo || row.offerId || '未生成编号')}</dd></div><div><dt>发送时间</dt><dd>${escape(formatShanghaiDateTime(row.sentAt) || row.sentAt || '未记录')}</dd></div><div><dt>状态</dt><dd>${escape(row.status || '待发送')}</dd></div></dl>
        </article>`;
      }
      return `<article class="overview-metric-detail tone-${tone}">
        <div><strong>${escape(row.candidateName || '未命名候选人')}</strong><span>${escape(row.department || '未分配部门')} · ${escape(row.position || '未命名岗位')}</span></div>
        <dl><div><dt>到岗日期</dt><dd>${escape(row.arrivalDate || '未记录')}</dd></div><div><dt>状态</dt><dd>${escape(row.status || '已到岗')}</dd></div></dl>
      </article>`;
    }

    function renderMetricDialog(dialogState) {
      const escape = dependencies.escapeHtml || fallbackEscape;
      const definition = metricDefinitions.find((item) => item.key === dialogState.metric) || metricDefinitions[0];
      const details = Array.isArray(hiringActivity.value?.[definition.detailsKey]) ? hiringActivity.value[definition.detailsKey] : [];
      const pageSize = 10;
      const pageCount = Math.max(1, Math.ceil(details.length / pageSize));
      const page = Math.min(Math.max(1, Number(dialogState.page) || 1), pageCount);
      const rows = details.slice((page - 1) * pageSize, page * pageSize);
      const rangeStart = details.length ? (page - 1) * pageSize + 1 : 0;
      const rangeEnd = details.length ? Math.min(page * pageSize, details.length) : 0;
      dependencies.showTalentDialog(`
        <header class="rf-dialog-head overview-metric-dialog-head"><div><span>OVERVIEW DETAIL</span><h2>${escape(definition.label)}明细</h2><p>${escape(periodName.value)} · ${escape(hiringActivity.value?.date || '')} · 共 ${details.length} 条</p></div><b>${escape(periodName.value)}</b></header>
        <div class="overview-metric-list">${rows.length ? rows.map((row) => metricDetailHtml(definition.key, row)).join('') : `<div class="rf-dialog-empty overview-metric-empty"><strong>${escape(definition.label)}暂无明细</strong><p>${escape(definition.empty)}</p></div>`}</div>
        <footer class="overview-metric-pager"><span>${details.length ? `第 ${rangeStart}-${rangeEnd} 条 · 第 ${page}/${pageCount} 页` : '暂无记录'}</span><div><button type="button" data-overview-metric-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button><button type="button" data-overview-metric-page="${page + 1}" ${page >= pageCount ? 'disabled' : ''}>下一页</button></div></footer>
      `, 'wide overview-metric-dialog');
      document.querySelectorAll('[data-overview-metric-page]:not([disabled])').forEach((button) => {
        button.addEventListener('click', () => renderMetricDialog({ ...dialogState, page: Number(button.dataset.overviewMetricPage) }));
      });
    }

    function openMetricDialog(metric) {
      renderMetricDialog({ metric, page: 1 });
    }

    function exportActivity() {
      const activity = hiringActivity.value || {};
      const metrics = [
        ['简历入库', activity.summary?.resumes || 0],
        ['面试场次', activity.summary?.interviews || 0],
        ['已发 Offer', activity.summary?.offers || 0],
        ['实际到岗', activity.summary?.arrived || 0],
      ];
      const periodLabel = ({ day: '日', week: '周', month: '月' })[period.value] || '日';
      const content = `统计周期,"${periodLabel}"\n统计范围,"${activity.date || ''}"\n指标,数量\n${metrics.map(([name, value]) => `"${name}",${Number(value || 0)}`).join('\n')}`;
      const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `招聘进度-${periodLabel}-${targetMonthValue.value}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    }

    function exportHiring() {
      if (!window.XLSX) {
        dependencies.notifyUser('Excel组件未加载，请刷新页面后重试。', 'error');
        return;
      }
      const rows = [
        ['部门岗位达成', '', '', '', ''],
        ['月份', data.value?.month || '', '', '', ''],
        ['需求数量', Number(summary.value.demand || 0), '', '', ''],
        ['实际 Offer', Number(summary.value.actualOffers ?? summary.value.offers ?? 0), '', '', ''],
        [],
        ['部门', '招聘岗位', '招聘HR', '备用HR', '需求数量', '实际 Offer', 'Offer 人员', '期望到岗时间', '最晚到岗时间'],
        ...departments.value.map((row) => [row.department || '未分配部门', row.role || '未命名岗位', row.recruiter || '待分配', row.backupRecruiter || '', row.demand, row.completed, (row.completedNames || []).join('、'), row.expectedArrivalDate || '', row.latestArrivalDate || '']),
      ];
      const sheet = window.XLSX.utils.aoa_to_sheet(rows);
      sheet['!cols'] = [{ wch: 16 }, { wch: 26 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 50 }, { wch: 16 }, { wch: 16 }];
      const workbook = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook, sheet, '部门岗位达成');
      window.XLSX.writeFile(workbook, `部门岗位达成-${targetMonthValue.value}.xlsx`);
    }

    function metricCard(definition, index) {
      return (
        <button type="button" class={`overview-daily-metric metric-tone-${index + 1}`} data-overview-metric={definition.key} aria-label={`查看${definition.label}明细`} onClick={() => openMetricDialog(definition.key)}>
          <span>{definition.label}</span>
          <strong>{Number(activitySummary.value[definition.key] || 0)}</strong>
          <small>查看明细</small>
        </button>
      );
    }

    function hiringRow(row, index) {
      const priorityClass = ({ 紧急: 'urgent', 重要: 'important', 储备: 'normal' })[row.priority] || 'normal';
      return (
        <article class={`overview-hiring-row priority-${priorityClass}${row.completedAll ? ' is-completed' : ''}`}>
          <div class="overview-hiring-identity">
            <span class="overview-priority-badge"><i></i>{row.priority}</span>
            <div>
              <small>{row.department || '未分配部门'}</small>
              <strong>{row.role || '未命名岗位'}</strong>
              <span class="overview-hiring-recruiter">招聘HR：{row.recruiter || '待分配'}{row.backupRecruiter ? ` · 备用HR：${row.backupRecruiter}` : ''}</span>
              <span class="overview-hiring-arrival-dates">期望到岗：{row.expectedArrivalDate || '未填写'}<br />最晚到岗：{row.latestArrivalDate || '未填写'}</span>
              <span>{row.completedAll ? '目标月需求已达成' : row.status || '进行中'}</span>
            </div>
          </div>
          <div class="overview-hiring-numbers">
            <span><small>需求</small><b>{row.demand}</b></span>
            <span><small>实际 Offer</small><b>{row.completed}</b></span>
          </div>
          <div class="overview-hiring-progress">
            <div><span>达成进度</span><strong>{row.completionRate}%</strong></div>
            <div class="overview-progress-track"><i style={`width:${Math.max(0, Math.min(100, row.completionRate))}%`}></i></div>
            <small>{row.completedAll ? '已全部完成' : row.completed > 0 ? `已发 Offer ${row.completed} 人，还差 ${row.remaining} 人` : `尚未发 Offer，还差 ${row.remaining} 人`}</small>
          </div>
          <div class="overview-hiring-arrivals">
            <span>已发 Offer 人员</span>
            {row.completedNames.length ? <div>{row.completedNames.map((name) => <em><i>✓</i>{name || '未命名候选人'}</em>)}</div> : <small>暂无 Offer 人员</small>}
          </div>
        </article>
      );
    }

    onBeforeUnmount(() => {
      requestSequence += 1;
    });
    activeLoad = load;
    activeSync = (options = {}) => {
      if (['day', 'week', 'month'].includes(options.initialPeriod)) period.value = options.initialPeriod;
      if (/^\d{4}-\d{2}$/.test(text(options.initialMonth))) selectedMonth.value = options.initialMonth;
      if (['priority', 'expectedArrivalDate', 'latestArrivalDate'].includes(options.initialArrivalSort)) arrivalSort.value = options.initialArrivalSort;
    };

    return () => {
      if (loading.value && !data.value) return <div class="rf-dialog-loading">正在汇总招聘数据…</div>;
      if (error.value && !data.value) {
        return (
          <div class="rf-dialog-empty">
            <strong>招聘数据暂不可用</strong>
            <p>{error.value}</p>
          </div>
        );
      }

      return (
        <div class="overview-dashboard">
          <header class="overview-daily-head">
            <div class="overview-daily-title">
              <span class="overview-daily-kicker">FANGPIAN · RECRUITING</span>
              <h1 id="overview-daily-title">招聘数据总览</h1>
              <p>招聘动态按{activityScope.value}统计；岗位目标按公司月统计。更新于 {formatShanghaiDateTime(data.value?.generatedAt) || '刚刚'}</p>
            </div>
            <div class="overview-period-tools">
              <div class="overview-period-switch" role="group" aria-label="招聘统计周期">
                {[['day', '日'], ['week', '周'], ['month', '月']].map(([value, label]) => (
                  <button type="button" data-overview-period={value} aria-pressed={period.value === value} onClick={() => setPeriod(value)}>{label}</button>
                ))}
              </div>
              <label class={`overview-month-picker${period.value === 'month' ? '' : ' is-hidden'}`}>
                <span>统计月</span>
                <input type="month" id="overview-month-filter" value={selectedMonth.value} aria-label="选择公司统计月" onChange={(event) => { selectedMonth.value = event.target.value || currentMonthValue(); load(); }} />
              </label>
              <button class="btn-soft overview-export-activity" data-action="export-month" type="button" onClick={exportActivity}>导出动态</button>
            </div>
          </header>
          <div class="overview-dashboard-body">
            <section class="overview-period-activity" aria-labelledby="overview-activity-title">
              <header class="overview-section-head">
                <h2 id="overview-activity-title">核心指标</h2>
                <span>{hiringActivity.value.date || periodName.value} · 岗位目标</span>
              </header>
              <div class="overview-daily-metrics" aria-label={`${periodName.value}招聘指标`}>
                {metricDefinitions.map((definition, index) => metricCard(definition, index))}
              </div>
              <div class="overview-hiring-summary" aria-label="部门岗位达成汇总">
                <div><span>需求人数</span><strong>{Number(summary.value.demand || 0)}<small>人</small></strong></div>
                <div><span>本月实际 Offer</span><strong>{Number(summary.value.actualOffers ?? summary.value.offers ?? 0)}<small>人</small></strong></div>
                <div><span>待招聘</span><strong>{remainingHeadcount.value}<small>人</small></strong></div>
                <div><span>已达成岗位</span><strong>{completedPositionCount.value}<small>个</small></strong></div>
              </div>
              <div class="overview-daily-resume-meta">
                <div class="overview-daily-uploader-summary">
                  <span>{periodName.value}来源</span>
                  {uploaders.value.length ? uploaders.value.map((uploader) => <em>{uploader.name} <b>{Number(uploader.count || 0)}份</b></em>) : <small>{periodName.value}暂无简历入库</small>}
                </div>
                <div class="overview-daily-uploader-summary overview-daily-department-summary">
                  <span>{periodName.value}部门</span>
                  {departmentUploads.value.length ? departmentUploads.value.map((department) => <em>{department.department || '未归属部门'} <b>{Number(department.count || 0)}份</b></em>) : <small>{periodName.value}暂无部门入库</small>}
                </div>
              </div>
            </section>
            <section class="overview-target-delivery" aria-label="部门岗位达成">
              <header class="overview-analysis-head">
                <div class="overview-analysis-actions">
                  <label class="overview-arrival-sort">
                    <span>排序</span>
                    <select id="overview-arrival-sort" aria-label="部门岗位达成排序" value={arrivalSort.value} onChange={(event) => { arrivalSort.value = event.target.value; }}>
                      {[['priority', '按优先级'], ['expectedArrivalDate', '按期望到岗'], ['latestArrivalDate', '按最晚到岗']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <div class="overview-priority-legend" aria-label="优先级颜色说明">
                    <span class="urgent"><i></i>紧急</span>
                    <span class="important"><i></i>重要</span>
                    <span class="normal"><i></i>储备</span>
                  </div>
                  <button class="btn-soft" data-overview-export-xlsx type="button" onClick={exportHiring}>导出需求</button>
                </div>
              </header>
              <div class="overview-hiring-board">
                {departments.value.length ? departments.value.map((row, index) => (
                  <Fragment key={`${row.department || ''}-${row.role || ''}-${index}`}>
                    {row.completedAll && (index === 0 || !departments.value[index - 1].completedAll) ? (
                      <div class="overview-completed-divider"><span>已完成需求</span><small>以下岗位目标月需求已全部达成</small></div>
                    ) : null}
                    {hiringRow(row, index)}
                  </Fragment>
                )) : <p class="rf-section-empty">该月份暂无招聘需求或实际 Offer</p>}
              </div>
            </section>
          </div>
        </div>
      );
    };
  },
};

window.mountOverviewPage = (options) => {
  const root = document.getElementById('overview-analysis');
  dependencies = options;
  if (!root) return Promise.resolve(false);
  if (!activeApp) {
    activeApp = createApp(OverviewPage);
    activeApp.mount(root);
  } else {
    activeSync?.(options);
  }
  return activeLoad?.() ?? Promise.resolve(false);
};

window.unmountOverviewPage = () => {
  activeApp?.unmount();
  activeApp = null;
  activeLoad = null;
  activeSync = null;
  activeLoadPromise = null;
  activeLoadKey = '';
  dependencies = null;
};
