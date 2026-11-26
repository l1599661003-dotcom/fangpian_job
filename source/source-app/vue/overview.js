import { Fragment, computed, createApp, h, onBeforeUnmount, ref, watch } from 'vue';

let activeApp = null;
let activeLoad = null;
let activeSync = null;
let dependencies = null;
let requestSequence = 0;
let activeLoadPromise = null;
let activeLoadKey = '';

const metricDefinitions = [
  { key: 'resumes', label: '简历入库', detailsKey: 'resumeUploads', empty: '该周期暂无简历入库记录', unit: '人' },
  { key: 'interviews', label: '面试', detailsKey: 'interviewDetails', empty: '该周期暂无面试记录', unit: '人' },
  { key: 'offers', label: '已发 Offer', detailsKey: 'offerDetails', empty: '该周期暂无已发送 Offer', unit: '人' },
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
    const selectedDepartments = ref(Array.isArray(dependencies?.initialDepartments) ? dependencies.initialDepartments.map(text).filter(Boolean) : []);
    const data = ref(null);
    const loading = ref(true);
    const error = ref('');

    const hiringActivity = computed(() => data.value?.hiringActivity || data.value?.dailyHiring || { date: '', summary: {}, uploaders: [], resumeUploads: [] });
    const activitySummary = computed(() => hiringActivity.value.summary || {});
    const summary = computed(() => data.value?.summary || {});
    const uploaders = computed(() => Array.isArray(hiringActivity.value.uploaders) ? hiringActivity.value.uploaders : []);
    const departmentUploads = computed(() => Array.isArray(hiringActivity.value.departmentUploads) ? hiringActivity.value.departmentUploads : []);
    const periodName = computed(() => ({ day: '今日', week: '本周', month: '所选公司月' })[period.value]);

    const allDepartments = computed(() => {
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
          currentMonthDemand: Number(row.currentMonthDemand || 0),
          carriedDemand: Number(row.carriedDemand || 0),
          carriedFromMonth: row.carriedFromMonth || '',
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

    const departmentOptions = computed(() => [...new Set(allDepartments.value.map((row) => row.department || '未分配部门'))].sort((left, right) => left.localeCompare(right, 'zh-CN')));
    const activeDepartmentFilters = computed(() => selectedDepartments.value.filter((item) => departmentOptions.value.includes(item)));
    const departments = computed(() => activeDepartmentFilters.value.length
      ? allDepartments.value.filter((row) => activeDepartmentFilters.value.includes(row.department || '未分配部门'))
      : allDepartments.value);

    const demandHeadcount = computed(() => departments.value.reduce((total, row) => total + row.demand, 0));
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

    function toggleDepartment(department, checked) {
      const next = new Set(activeDepartmentFilters.value);
      if (checked) next.add(department);
      else next.delete(department);
      selectedDepartments.value = [...next];
    }

    watch([period, selectedMonth, arrivalSort, selectedDepartments], () => {
      dependencies?.onStateChange?.({
        period: period.value,
        selectedMonth: selectedMonth.value,
        arrivalSort: arrivalSort.value,
        departments: selectedDepartments.value,
      });
    });

    function metricDetailHtml(metric, row) {
      const escape = dependencies.escapeHtml || fallbackEscape;
      const tone = metricDefinitions.findIndex((item) => item.key === metric) + 1;
      if (metric === 'resumes') {
        return `<article class="overview-metric-detail tone-${tone}">
          <div><strong>${escape(row.candidateName || '未命名候选人')}</strong><span>${escape(row.department || '未归属部门')} · ${escape(row.uploader || '未记录上传人')}</span></div>
          <dl><div><dt>人数</dt><dd>${Number(row.count || 1)} 人</dd></div><div><dt>简历</dt><dd>${Number(row.count || 1)} 份 · ${escape(row.fileName || '未命名简历')}</dd></div><div><dt>最近时间</dt><dd>${escape(formatShanghaiDateTime(row.uploadedAt) || row.uploadedAt || '未记录')}</dd></div></dl>
          ${row.sourceUrl ? `<a href="${escape(row.sourceUrl)}" target="_blank" rel="noopener">查看原始简历 ↗</a>` : '<span class="overview-metric-miss">仅统计，原始附件按岗位权限查看</span>'}
        </article>`;
      }
      if (metric === 'interviews') {
        return `<article class="overview-metric-detail tone-${tone}">
          <div><strong>${escape(row.candidateName || '未命名候选人')}</strong><span>${escape(row.department || '未分配部门')} · ${escape(row.position || '未命名岗位')}</span></div>
          <dl><div><dt>人数</dt><dd>${Number(row.count || 1)} 人</dd></div><div><dt>面试</dt><dd>${Number(row.count || 1)} 场 · ${escape(row.round || '待定轮次')}</dd></div><div><dt>最近时间</dt><dd>${escape(formatShanghaiDateTime(row.startsAt) || row.startsAt || '未记录')}</dd></div><div><dt>面试官</dt><dd>${escape(row.interviewers || '待定')}</dd></div></dl>
          <em>${escape(row.status || '待确认')}</em>
        </article>`;
      }
      if (metric === 'offers') {
        return `<article class="overview-metric-detail tone-${tone}">
          <div><strong>${escape(row.candidateName || '未命名候选人')}</strong><span>${escape(row.department || '未分配部门')} · ${escape(row.position || '未命名岗位')}</span></div>
          <dl><div><dt>人数</dt><dd>${Number(row.count || 1)} 人</dd></div><div><dt>Offer</dt><dd>${Number(row.count || 1)} 份 · ${escape(row.offerNo || row.offerId || '未生成编号')}</dd></div><div><dt>最近发送</dt><dd>${escape(formatShanghaiDateTime(row.sentAt) || row.sentAt || '未记录')}</dd></div></dl>
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
        <header class="rf-dialog-head overview-metric-dialog-head"><div><span>OVERVIEW DETAIL</span><h2>${escape(definition.label)}明细</h2><p>${escape(periodName.value)} · ${escape(hiringActivity.value?.date || '')} · 共 ${details.length} 人</p></div><b>${escape(periodName.value)}</b></header>
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
        ['简历入库人数', activity.summary?.resumes || 0],
        ['面试人数', activity.summary?.interviews || 0],
        ['已发 Offer 人数', activity.summary?.offers || 0],
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

    function demandGroups() {
      const pending = departments.value.filter((row) => !row.completedAll);
      const completed = departments.value.filter((row) => row.completedAll);
      return [
        { title: '待完成', rows: pending, totalLabel: '待招总计', demand: pending.reduce((sum, row) => sum + row.demand, 0), completed: pending.reduce((sum, row) => sum + row.completed, 0) },
        { title: '已完成', rows: completed, totalLabel: '完成合计', demand: completed.reduce((sum, row) => sum + row.demand, 0), completed: completed.reduce((sum, row) => sum + row.completed, 0) },
      ];
    }

    function exportHiring() {
      if (!window.XLSX) {
        dependencies.notifyUser('Excel组件未加载，请刷新页面后重试。', 'error');
        return;
      }
      const rows = [['部门', '类型', '需求岗位名称', '需求数量', '完成数量', '完成明细']];
      for (const group of demandGroups()) {
        rows.push([group.title, '', '', '', '', '']);
        for (const row of group.rows) rows.push([row.department || '未分配部门', row.reportType || '本月提报', row.role || '未命名岗位', row.demand, row.completed, (row.completedNames || []).join('、')]);
        rows.push([group.totalLabel, '', '', group.demand, group.completed, '']);
      }
      const sheet = window.XLSX.utils.aoa_to_sheet(rows);
      sheet['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 60 }];
      const workbook = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook, sheet, '需求完成');
      window.XLSX.writeFile(workbook, `需求完成-${targetMonthValue.value}.xlsx`);
    }

    function renderDemandDialog() {
      const escape = dependencies.escapeHtml || fallbackEscape;
      const groups = demandGroups().map((group) => `
        <section class="overview-demand-group ${group.title === '已完成' ? 'is-completed' : 'is-pending'}">
          <h3>${escape(group.title)}</h3>
          <table>
            <thead><tr><th>部门</th><th>类型</th><th>需求岗位名称</th><th>需求数量</th><th>完成数量</th><th>完成明细</th></tr></thead>
            <tbody>
              ${group.rows.length ? group.rows.map((row) => `<tr><td>${escape(row.department || '未分配部门')}</td><td><em>${escape(row.reportType || '本月提报')}</em></td><td>${escape(row.role || '未命名岗位')}</td><td>${row.demand}</td><td>${row.completed}</td><td>${(row.completedNames || []).map((name) => `<span>${escape(name || '未命名候选人')}</span>`).join('') || '暂无'}</td></tr>`).join('') : '<tr><td colspan="6">暂无岗位</td></tr>'}
              <tr class="is-total"><td>${escape(group.totalLabel)}</td><td></td><td></td><td>${group.demand}</td><td>${group.completed}</td><td></td></tr>
            </tbody>
          </table>
        </section>`).join('');
      dependencies.showTalentDialog(`
        <header class="rf-dialog-head"><div><span>DEMAND COMPLETION</span><h2>需求完成明细</h2><p>${escape(targetMonthLabel.value)} · 按需求提出时间区分新增、本月和上月提报</p></div><button class="btn-soft" data-overview-demand-export type="button">导出</button></header>
        <div class="overview-demand-sheet">${groups}</div>
      `, 'wide overview-demand-dialog');
      document.querySelector('[data-overview-demand-export]')?.addEventListener('click', exportHiring);
    }

    function metricCard(definition, index) {
      return (
        <button type="button" class={`overview-daily-metric metric-tone-${index + 1}`} data-overview-metric={definition.key} aria-label={`查看${definition.label}明细`} onClick={() => openMetricDialog(definition.key)}>
          <span>{definition.label}</span>
          <strong>{Number(activitySummary.value[definition.key] || 0)}<small>{definition.unit}</small></strong>
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
            <span><small>需求</small><b>{row.demand}</b><em class={`overview-demand-split${row.carriedDemand > 0 ? ' has-carried' : ''}`}>{row.carriedDemand > 0 ? `本月 ${row.currentMonthDemand} · ${row.carriedFromMonth} 延续 ${row.carriedDemand}` : '本月需求'}</em></span>
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
      if (Array.isArray(options.initialDepartments)) selectedDepartments.value = options.initialDepartments.map(text).filter(Boolean);
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
                <button type="button" class="overview-daily-metric metric-tone-4" aria-label="查看需求人数明细" onClick={renderDemandDialog}>
                  <span>需求人数</span>
                  <strong>{demandHeadcount.value}<small>人</small></strong>
                  <small>查看明细</small>
                </button>
              </div>
            </section>
            <section class="overview-target-delivery" aria-label="部门岗位达成">
              <header class="overview-analysis-head">
                <div class="overview-analysis-actions">
                  <details class="overview-department-filter">
                    <summary><span>部门</span><b>{activeDepartmentFilters.value.length ? `已选 ${activeDepartmentFilters.value.length} 个` : '全部部门'}</b></summary>
                    <div>
                      {departmentOptions.value.length ? departmentOptions.value.map((department) => (
                        <label key={department}>
                          <input type="checkbox" checked={activeDepartmentFilters.value.includes(department)} onChange={(event) => toggleDepartment(department, event.target.checked)} />
                          <span>{department}</span>
                        </label>
                      )) : <span>暂无部门</span>}
                      {activeDepartmentFilters.value.length ? <button type="button" onClick={() => { selectedDepartments.value = []; }}>清空</button> : null}
                    </div>
                  </details>
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
