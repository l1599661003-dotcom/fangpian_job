import { computed, createApp, h, onBeforeUnmount, onMounted, ref } from 'vue';

const tabs = [
  { key: 'overview', label: '招聘概览', metric: 'overview' },
  { key: 'achievement', label: '招聘达成', metric: 'hc' },
  { key: 'conversion', label: '招聘转化', metric: 'funnel' },
  { key: 'efficiency', label: '工作效率', metric: 'processing' },
  { key: 'channel', label: '渠道分析', metric: 'channels' },
  { key: 'quality', label: '招聘质量', metric: 'ai-quality' },
  { key: 'turnover', label: '离职分析', metric: 'employment' },
];

const metricNames = {
  hc: 'HC 达成明细', funnel: '招聘漏斗明细', channels: '渠道效果明细', 'ai-quality': 'AI 分数结果明细',
  processing: '处理时效明细', interviewers: '面试官评价明细', offers: 'Offer 明细', employment: '入职与留存明细',
  referrals: '内推效果明细', followups: '回访与回流明细', overview: '招聘总览明细',
};

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

async function requestJson(path, { headers, signal, timeoutMs = 20000 } = {}) {
  const requestHeaders = identityHeaders();
  if (headers) Object.entries(headers).forEach(([key, value]) => requestHeaders.set(key, value));
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(apiUrl(path), { headers: requestHeaders, signal: controller.signal });
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

function defaultFilters() {
  const today = new Date().toISOString().slice(0, 10);
  return { from: `${today.slice(0, 4)}-01-01`, to: today, department: '', role: '', owner: '', channel: '' };
}

function analyticsQuery(filters, extra = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...defaultFilters(), ...filters, ...extra }).forEach(([key, value]) => {
    if (value === '' || value === undefined || value === null) return;
    if (key === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) params.set(key, `${value}T23:59:59.999Z`);
    else params.set(key, String(value));
  });
  return params.toString();
}

function rate(value) {
  return `${Number(value || 0).toFixed(Number(value || 0) % 1 ? 1 : 0)}%`;
}

const AnalyticsPage = {
  setup() {
    const activeTab = ref('overview');
    const filters = ref(defaultFilters());
    const appliedFilters = ref(defaultFilters());
    const data = ref(null);
    const definitions = ref([]);
    const loading = ref(true);
    const error = ref('');
    const drilldown = ref(null);
    const drilldownLoading = ref(false);
    const drilldownError = ref('');
    const drilldownPage = ref(1);
    const exportMessage = ref('');
    const exporting = ref(false);
    let requestController = null;
    let drilldownController = null;
    let disposed = false;

    const overview = computed(() => data.value?.overview || {});
    const hc = computed(() => data.value?.hc || { summary: {}, rows: [] });
    const funnel = computed(() => data.value?.funnel || { stages: [] });
    const channels = computed(() => data.value?.channels?.rows || []);
    const aiQuality = computed(() => data.value?.aiQuality || { buckets: [] });
    const processing = computed(() => data.value?.processing || { owners: [] });
    const interviewers = computed(() => data.value?.interviewers || { rows: [] });
    const offers = computed(() => data.value?.offers || {});
    const employment = computed(() => data.value?.employment || {});
    const referrals = computed(() => data.value?.referrals || {});
    const followups = computed(() => data.value?.followups || {});
    const maxFunnel = computed(() => Math.max(1, ...funnel.value.stages.map((item) => Number(item.count || 0))));
    const summaryCards = computed(() => [
      ['招聘 HC', Number(overview.value.headcount || 0), `待补 ${Number(overview.value.openHc || 0)}`],
      ['实际到岗', Number(overview.value.arrived || 0), `达成率 ${rate(hc.value.summary?.fulfillmentRate)}`, 'good'],
      ['应聘记录', Number(overview.value.applications || 0), `${Number(data.value?.scope?.candidates || 0)} 位去重候选人`],
      ['Offer 接受率', rate(overview.value.offerAcceptanceRate), `${Number(offers.value.accepted || 0)} 接受 / ${Number(offers.value.sent || 0)} 已发送`],
      ['平均招聘周期', `${Number(overview.value.averageTimeToHireDays || 0)} 天`, '投递至实际到岗'],
    ]);
    const drilldownColumns = computed(() => {
      const rows = drilldown.value?.rows || [];
      return [...new Set(rows.flatMap((row) => Object.keys(row)))];
    });

    function empty(message = '当前筛选范围内暂无数据') {
      return (
        <div class="rf-dialog-empty rf-analytics-empty">
          <p>{message}</p>
          <small>可调整日期、部门、岗位、负责人或渠道后重新查看。</small>
        </div>
      );
    }

    function kpi(label, value, note = '', tone = '') {
      return (
        <article class={tone}>
          <span>{label}</span>
          <strong>{String(value)}</strong>
          {note ? <small>{note}</small> : null}
        </article>
      );
    }

    function section(title, subtitle, metric, content, extraClass = '') {
      return (
        <section class={`rf-analytics-card ${extraClass}`}>
          <header>
            <div><strong>{title}</strong><small>{subtitle}</small></div>
            <button type="button" onClick={() => openDrilldown(metric, 1)}>查看明细</button>
          </header>
          {content}
        </section>
      );
    }

    async function loadDashboard() {
      const controller = new AbortController();
      requestController?.abort();
      requestController = controller;
      loading.value = true;
      error.value = '';
      try {
        const [dashboard, definitionData] = await Promise.all([
          requestJson(`api/analytics/dashboard?${analyticsQuery(appliedFilters.value)}`, { signal: controller.signal }),
          requestJson('api/analytics/definitions', { signal: controller.signal }),
        ]);
        if (disposed || controller.signal.aborted) return;
        data.value = dashboard;
        definitions.value = definitionData.definitions || dashboard.definitions || [];
      } catch (requestError) {
        if (disposed || requestError?.name === 'AbortError') return;
        data.value = null;
        error.value = conciseError(requestError);
      } finally {
        if (requestController === controller) {
          requestController = null;
          loading.value = false;
        }
      }
    }

    function applyFilters() {
      appliedFilters.value = Object.fromEntries(Object.entries(filters.value).map(([key, value]) => [key, String(value || '').trim()]));
      closeDrilldown();
      loadDashboard();
    }

    function resetFilters() {
      filters.value = defaultFilters();
      applyFilters();
    }

    async function openDrilldown(metric, page = 1) {
      const controller = new AbortController();
      drilldownController?.abort();
      drilldownController = controller;
      drilldownLoading.value = true;
      drilldownError.value = '';
      drilldownPage.value = page;
      try {
        const result = await requestJson(`api/analytics/drilldown?${analyticsQuery(appliedFilters.value, { metric, page, pageSize: 20 })}`, { signal: controller.signal });
        if (disposed || controller.signal.aborted) return;
        drilldown.value = { metric, ...result };
      } catch (requestError) {
        if (disposed || requestError?.name === 'AbortError') return;
        drilldown.value = null;
        drilldownError.value = conciseError(requestError);
      } finally {
        if (drilldownController === controller) {
          drilldownController = null;
          drilldownLoading.value = false;
        }
      }
    }

    function closeDrilldown() {
      drilldownController?.abort();
      drilldown.value = null;
      drilldownError.value = '';
      drilldownPage.value = 1;
    }

    async function exportMetric(metric) {
      if (exporting.value) return;
      exportMessage.value = '正在校验权限并生成报表…';
      exporting.value = true;
      try {
        const response = await fetch(apiUrl(`api/analytics/export?${analyticsQuery(appliedFilters.value, { metric })}`), { headers: identityHeaders() });
        if (!response.ok) {
          const contentType = response.headers.get('content-type') || '';
          const body = contentType.includes('json') ? await response.json() : { message: await response.text() };
          if (response.status === 403) throw new Error('当前账号没有报表导出权限，仅管理员或 HR 可以导出。');
          throw new Error(Array.isArray(body.message) ? body.message.join('；') : body.message || `导出失败 (${response.status})`);
        }
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') || '';
        const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `recruitment-${metric}.csv`;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        exportMessage.value = '报表已生成并开始下载。';
      } catch (requestError) {
        exportMessage.value = conciseError(requestError);
      } finally {
        exporting.value = false;
      }
    }

    function handleHeaderExport() {
      exportMetric(tabs.find((tab) => tab.key === activeTab.value)?.metric || 'overview');
    }

    function sectionList() {
      if (activeTab.value === 'overview') {
        return [section('指标口径', '每个指标均提供公式、统计粒度和边界说明', 'overview', definitions.value.length ? (
          <div class="rf-definition-list">
            {definitions.value.map((item) => (
              <details key={item.key || item.name}>
                <summary><strong>{item.name}</strong><span>{item.grain}</span></summary>
                <p>{item.formula}</p>
                <small>{item.note}</small>
              </details>
            ))}
          </div>
        ) : empty('指标口径暂未返回'), 'span-2')];
      }
      if (activeTab.value === 'achievement') {
        return [section('招聘需求与 HC', '当前状态快照；日期筛选限定应聘流程样本', 'hc', hc.value.rows.length ? (
          <div class="rf-analytics-table">
            <table>
              <thead><tr><th>需求 / 岗位</th><th>部门</th><th>负责人</th><th>HC</th><th>到岗</th><th>待补</th><th>达成率</th></tr></thead>
              <tbody>
                {hc.value.rows.slice(0, 8).map((row) => (
                  <tr key={row.positionId || row.name}>
                    <td><strong>{row.name || row.role || '-'}</strong><small>{row.status || ''}</small></td>
                    <td>{row.department || '-'}</td><td>{row.owner || '-'}</td>
                    <td>{Number(row.headcount || 0)}</td><td>{Number(row.arrived || 0)}</td><td>{Number(row.remaining || 0)}</td>
                    <td><b>{rate(row.fulfillmentRate)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : empty(), 'span-2')];
      }
      if (activeTab.value === 'conversion') {
        return [section('招聘漏斗', `整体入职转化 ${rate(funnel.value.overallConversion)}`, 'funnel', funnel.value.stages.length ? (
          <div class="rf-funnel">
            {funnel.value.stages.map((item) => (
              <article key={item.name}>
                <div><strong>{item.name}</strong><span>{Number(item.count || 0)} 人</span></div>
                <i><b style={{ width: `${Math.max(3, Number(item.count || 0) / maxFunnel.value * 100)}%` }}></b></i>
                <small>环节 {rate(item.conversionFromPrevious)} · 总体 {rate(item.conversionFromStart)}</small>
              </article>
            ))}
          </div>
        ) : empty())];
      }
      if (activeTab.value === 'efficiency') {
        return [
          section('负责人 / HR 处理时效', `相邻阶段平均 ${Number(processing.value.overallAverageHours || 0)} 小时`, 'processing', processing.value.owners.length ? (
            <div class="rf-analytics-rank">
              {processing.value.owners.slice(0, 8).map((row) => (
                <article key={row.owner}>
                  <div><strong>{row.owner || '-'}</strong><small>{Number(row.handledTransitions || 0)} 次阶段处理</small></div>
                  <span>{Number(row.averageHours || 0)}h</span>
                  <b class={Number(row.overdueTasks || 0) ? 'warn' : ''}>{Number(row.overdueTasks || 0)} 项逾期</b>
                </article>
              ))}
            </div>
          ) : empty()),
          section('面试官评价质量', '90 天准确率只统计已成熟推荐通过样本', 'interviewers', interviewers.value.rows.length ? (
            <div class="rf-analytics-rank">
              {interviewers.value.rows.slice(0, 8).map((row) => (
                <article key={row.name || row.userId}>
                  <div><strong>{row.name || row.userId || '-'}</strong><small>{Number(row.submitted || 0)} 份评价 · 均分 {Number(row.averageScore || 0)}</small></div>
                  <span>通过建议 {rate(row.recommendPassRate)}</span>
                  <b>{row.retentionAccuracy90 === null ? '样本未成熟' : `90天 ${rate(row.retentionAccuracy90)}`}</b>
                </article>
              ))}
            </div>
          ) : empty()),
        ];
      }
      if (activeTab.value === 'channel') {
        return [section('渠道效果', '有效=当前或历史至少进入意向沟通；入职=实际到岗', 'channels', channels.value.length ? (
          <div class="rf-analytics-table">
            <table>
              <thead><tr><th>渠道</th><th>简历</th><th>有效</th><th>有效率</th><th>入职</th><th>入职率</th></tr></thead>
              <tbody>
                {channels.value.slice(0, 10).map((row) => (
                  <tr key={row.channel}>
                    <td><strong>{row.channel || '-'}</strong></td><td>{Number(row.resumes || 0)}</td><td>{Number(row.valid || 0)}</td>
                    <td>{rate(row.validRate)}</td><td>{Number(row.arrived || 0)}</td><td><b>{rate(row.hireRate)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : empty(), 'span-2')];
      }
      if (activeTab.value === 'quality') {
        return [
          section('AI 分数与流程结果', '展示相关性和样本量，不作为自动淘汰依据', 'ai-quality', aiQuality.value.buckets.length ? (
            <div>
              <div class="rf-ai-buckets">
                {aiQuality.value.buckets.map((row) => (
                  <article key={row.bucket}>
                    <header><strong>{row.bucket} 分</strong><span>{Number(row.sample || 0)} 个样本</span></header>
                    <div><span>面试率 <b>{rate(row.interviewRate)}</b></span><span>通过率 <b>{rate(row.passRate)}</b></span><span>入职率 <b>{rate(row.hireRate)}</b></span></div>
                  </article>
                ))}
              </div>
              <p class="rf-analytics-note">{aiQuality.value.note || ''}</p>
            </div>
          ) : empty(), 'span-2'),
          section('Offer 答复与谈薪', '未发送草稿不进入接受率分母', 'offers', (
            <div>
              <div class="rf-analytics-mini-kpis">
                {kpi('已发送', Number(offers.value.sent || 0))}
                {kpi('答复率', rate(offers.value.responseRate))}
                {kpi('接受率', rate(offers.value.acceptanceRate), `${Number(offers.value.accepted || 0)} 接受`)}
                {kpi('谈薪率', rate(offers.value.negotiationRate), `${Number(offers.value.negotiated || 0)} 份`)}
              </div>
              <div class="rf-analytics-reasons">
                <strong>拒绝原因</strong>
                {offers.value.rejectionReasons?.length ? offers.value.rejectionReasons.slice(0, 5).map((item) => (
                  <p key={item.name || item.value}><span>{item.name || item.value || '未说明'}</span><b>{Number(item.count || 0)}</b></p>
                )) : <small>暂无已记录拒绝原因</small>}
              </div>
            </div>
          )),
          section('内推效果与奖励', '入职率分母仅包含人工确认有效的内推', 'referrals', (
            <div class="rf-analytics-mini-kpis">
              {kpi('内推总数', Number(referrals.value.total || 0))}
              {kpi('有效率', rate(referrals.value.validRate), `${Number(referrals.value.valid || 0)} 份有效`)}
              {kpi('有效内推入职率', rate(referrals.value.hireRate), `${Number(referrals.value.hired || 0)} 人到岗`)}
              {kpi('已发奖励', `¥${Number(referrals.value.rewardPaidAmount || 0).toLocaleString('zh-CN')}`, `${Number(referrals.value.rewardPending || 0)} 笔待发`)}
            </div>
          )),
        ];
      }
      return [
        section('入职、试用期与留存', '未达到观察窗口的样本不进入留存率分母', 'employment', (
          <div>
            <div class="rf-analytics-mini-kpis">
              {kpi('到岗率', rate(employment.value.arrivalRate), `${Number(employment.value.arrived || 0)} / ${Number(employment.value.planned || 0)}`)}
              {kpi('转正率', rate(employment.value.probationPassRate), `${Number(employment.value.probationPassed || 0)} 人`)}
              {kpi('30天留存', rate(employment.value.retention30), `${Number(employment.value.matured30 || 0)} 成熟样本`)}
              {kpi('90天留存', rate(employment.value.retention90), `${Number(employment.value.matured90 || 0)} 成熟样本`)}
            </div>
            <p class="rf-analytics-note">未到岗 {Number(employment.value.noShow || 0)} · 已离职 {Number(employment.value.offboarded || 0)} · 离职率 {rate(employment.value.offboardingRate)}</p>
          </div>
        ), 'span-2'),
        section('回访与人才回流', '跟踪完成率、满意度、回流意向和人才评级变化', 'followups', (
          <div class="rf-analytics-mini-kpis">
            {kpi('回访完成率', rate(followups.value.completionRate), `${Number(followups.value.completed || 0)} / ${Number(followups.value.total || 0)}`)}
            {kpi('平均满意度', Number(followups.value.averageSatisfaction || 0).toFixed(1), '已填写评分样本')}
            {kpi('评级变化', rate(followups.value.ratingChangeRate), `${Number(followups.value.ratingChanges || 0)} 人`)}
            {kpi('回流意向样本', (followups.value.returnIntent || []).reduce((sum, item) => sum + Number(item.count || 0), 0), '按已完成回访统计')}
          </div>
        )),
      ];
    }

    onMounted(() => {
      window.refreshAnalyticsPage = loadDashboard;
      document.querySelector('#page-analytics [data-action="download-report"]')?.addEventListener('click', handleHeaderExport);
      loadDashboard();
    });

    onBeforeUnmount(() => {
      disposed = true;
      requestController?.abort();
      drilldownController?.abort();
      document.querySelector('#page-analytics [data-action="download-report"]')?.removeEventListener('click', handleHeaderExport);
      delete window.refreshAnalyticsPage;
    });

    return () => {
      const filterFields = [
        ['from', '开始日期', 'date'], ['to', '结束日期', 'date'], ['department', '部门', 'text'],
        ['role', '岗位', 'text'], ['owner', '负责人 / HR', 'text'], ['channel', '渠道', 'text'],
      ];
      return (
        <div class="analytics-vue-shell">
          <div class="card analysis-tabs-card">
            <div class="analysis-tabs" role="tablist" aria-label="招聘分析维度">
              {tabs.map((tab) => (
                <button class={`analysis-tab ${activeTab.value === tab.key ? 'active' : ''}`} type="button" key={tab.key} data-analytics-tab={tab.key} aria-pressed={activeTab.value === tab.key} onClick={() => { activeTab.value = tab.key; closeDrilldown(); }}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <form class="card panel-card analysis-filter-bar rf-analytics-filters" onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
            {filterFields.map(([key, label, type]) => (
              <label key={key}>
                <span>{label}</span>
                <input type={type} name={key} value={filters.value[key]} onChange={(event) => { filters.value = { ...filters.value, [key]: event.target.value }; }} />
              </label>
            ))}
            <div>
              <button class="btn-primary" type="submit" disabled={loading.value}>{loading.value ? '查询中…' : '应用筛选'}</button>
              <button class="btn-soft" type="button" onClick={resetFilters}>重置</button>
            </div>
          </form>

          <div class="analysis-banner">
            {data.value ? `${Number(data.value.scope?.candidates || 0)} 位筛选范围候选人 · 生成于 ${data.value.generatedAt || '-'}` : '以去重候选人为主口径，AI 分数仅展示相关性；HC 为当前需求状态快照。'}
          </div>

          <div id="analytics-content">
            {loading.value ? <div class="rf-dialog-loading">正在汇总招聘需求、流程、渠道、Offer 与入离职数据…</div> : null}
            {!loading.value && error.value ? (
              <div class="rf-dialog-empty">
                <strong>数据分析读取失败</strong>
                <p>{error.value}</p>
                <button class="btn-soft" type="button" onClick={loadDashboard}>重新加载</button>
              </div>
            ) : null}
            {!loading.value && !error.value ? (
              <div>
                <div class="rf-analytics-kpis">
                  {summaryCards.value.map(([label, value, note, tone]) => kpi(label, value, note, tone))}
                </div>
                {drilldownError.value ? (
                  <div class="rf-dialog-empty">
                    <strong>指标明细读取失败</strong>
                    <p>{drilldownError.value}</p>
                    <button class="btn-soft" type="button" onClick={() => closeDrilldown()}>返回数据分析</button>
                  </div>
                ) : drilldownLoading.value ? (
                  <div class="rf-dialog-loading">正在读取指标明细…</div>
                ) : drilldown.value ? (
                  <section class="rf-analytics-card span-2">
                    <header>
                      <div><strong>{metricNames[drilldown.value.metric] || drilldown.value.metric}</strong><small>{drilldown.value.definition?.formula || '查看筛选范围内的原始统计明细。'}</small></div>
                      <div>
                        <button class="btn-soft" type="button" onClick={closeDrilldown}>返回数据分析</button>
                        <button class="btn-primary" type="button" data-analytics-export={drilldown.value.metric} disabled={exporting.value} onClick={() => exportMetric(drilldown.value.metric)}>导出 CSV</button>
                      </div>
                    </header>
                    {drilldown.value.rows?.length ? (
                      <div class="rf-drilldown-table">
                        <table>
                          <thead><tr>{drilldownColumns.value.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                          <tbody>
                            {drilldown.value.rows.map((row, index) => (
                              <tr key={index}>{drilldownColumns.value.map((column) => <td key={column}>{String(row[column] ?? '-')}</td>)}</tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : empty('当前指标暂无可下钻明细')}
                    <footer class="rf-analytics-pager">
                      <span>共 {Number(drilldown.value.total || 0)} 条 · 第 {Number(drilldown.value.page || drilldownPage.value)} 页</span>
                      <div>
                        <button class="btn-soft" type="button" disabled={drilldownPage.value <= 1} onClick={() => openDrilldown(drilldown.value.metric, drilldownPage.value - 1)}>上一页</button>
                        <button class="btn-soft" type="button" disabled={drilldownPage.value * Number(drilldown.value.pageSize || 20) >= Number(drilldown.value.total || 0)} onClick={() => openDrilldown(drilldown.value.metric, drilldownPage.value + 1)}>下一页</button>
                      </div>
                    </footer>
                    <p class="rf-dialog-message" role="status">{exportMessage.value}</p>
                  </section>
                ) : (
                  <div class="rf-analytics-grid">{sectionList()}</div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      );
    };
  },
};

window.mountAnalyticsPage = () => {
  const root = document.getElementById('analytics-root');
  if (!root) return false;
  if (activeApp) {
    window.refreshAnalyticsPage?.();
    return true;
  }
  activeApp = createApp(AnalyticsPage);
  activeApp.mount(root);
  return true;
};

window.unmountAnalyticsPage = () => {
  activeApp?.unmount();
  activeApp = null;
};
