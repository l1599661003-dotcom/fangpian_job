import { computed, createApp, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';

let activeApp = null;
let activeLoad = null;
let referralCache = { expiresAt: 0, referrals: [], analytics: {} };

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

async function requestJson(path, { signal, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(apiUrl(path), { headers: identityHeaders(), signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('json') ? await response.json() : { message: await response.text() };
    if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join('；') : data.message || `请求失败 (${response.status})`);
    return data;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function maskPhone(value) {
  const phone = text(value);
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '';
}

function formatDate(value) {
  return text(value).slice(0, 10);
}

function validityClass(value) {
  if (value === '有效') return 'ok';
  if (value === '无效') return 'bad';
  return 'pending';
}

const ReferralOverviewPage = {
  setup() {
    const referrals = ref([]);
    const analytics = ref({});
    const loading = ref(true);
    const error = ref('');
    const keyword = ref('');
    const validity = ref('全部');
    const page = ref(1);
    const pageSize = 8;
    let requestController = null;
    let disposed = false;

    const summary = computed(() => [
      { label: '内推简历', value: Number(analytics.value.total || 0), note: '全部提交记录', tone: '' },
      { label: '有效内推', value: Number(analytics.value.valid || 0), note: `${Number(analytics.value.total || 0) ? Math.round((Number(analytics.value.valid || 0) / Number(analytics.value.total)) * 100) : 0}% 有效率`, tone: 'ok' },
      { label: '重复待判断', value: Number(analytics.value.duplicate || 0), note: '需要负责人确认', tone: 'warn' },
      { label: '奖励待发放', value: Number(analytics.value.rewardPending || 0), note: '已满足规则待处理', tone: '' },
      { label: '已发放金额', value: Number(analytics.value.rewardPaid || 0), note: '累计奖励金额（元）', tone: 'ok' },
    ]);

    const filteredReferrals = computed(() => {
      const query = keyword.value.trim().toLowerCase();
      return referrals.value.filter((item) => {
        const validityPass = validity.value === '全部' || text(item.validity || '待确认') === validity.value;
        const haystack = [item.candidateName, item.role, item.referrer, item.department, item.status, item.progress]
          .map((value) => text(value).toLowerCase()).join(' ');
        return validityPass && (!query || haystack.includes(query));
      });
    });

    const totalPages = computed(() => Math.max(1, Math.ceil(filteredReferrals.value.length / pageSize)));
    const visibleReferrals = computed(() => {
      const current = Math.min(page.value, totalPages.value);
      return filteredReferrals.value.slice((current - 1) * pageSize, current * pageSize);
    });

    async function load(force = false) {
      if (!force && Date.now() < referralCache.expiresAt) {
        referrals.value = referralCache.referrals;
        analytics.value = referralCache.analytics;
        loading.value = false;
        error.value = '';
        return true;
      }
      const controller = new AbortController();
      requestController?.abort();
      requestController = controller;
      loading.value = true;
      error.value = '';
      try {
        const [referralsResult, analyticsResult] = await Promise.all([
          requestJson('api/referrals', { signal: controller.signal }),
          requestJson('api/referrals/analytics', { signal: controller.signal }),
        ]);
        if (disposed || controller.signal.aborted) return false;
        referrals.value = referralsResult.referrals || [];
        analytics.value = analyticsResult || {};
        referralCache = { expiresAt: Date.now() + 15000, referrals: referrals.value, analytics: analytics.value };
        return true;
      } catch (requestError) {
        if (disposed || requestError?.name === 'AbortError') return false;
        error.value = conciseError(requestError);
        return false;
      } finally {
        if (requestController === controller) {
          requestController = null;
          loading.value = false;
        }
      }
    }

    activeLoad = load;

    watch([keyword, validity], () => { page.value = 1; });

    onMounted(() => { load(false); });
    onBeforeUnmount(() => {
      disposed = true;
      requestController?.abort();
      activeLoad = null;
    });

    return () => {
      if (loading.value) {
        return (
          <div class="rf-ref-overview-loading" role="status">
            <i aria-hidden="true"></i>
            <strong>正在读取内推数据…</strong>
            <small>同时获取记录与奖励统计</small>
          </div>
        );
      }
      if (error.value) {
        return (
          <div class="rf-ref-overview-error" role="alert">
            <strong>内推数据读取失败</strong>
            <p>{error.value}</p>
            <button class="btn-soft" type="button" data-ref-overview-retry onClick={() => load(true)}>重新加载</button>
          </div>
        );
      }

      return (
        <div class="rf-ref-overview">
          <section class="rf-ref-hero">
            <div>
              <span>EMPLOYEE REFERRAL</span>
              <h2>内推动态一屏掌握</h2>
              <p>候选人扫码或员工直接上传后，系统自动归属推荐人、进入查重和评审流程。</p>
            </div>
            <button class="btn-soft" type="button" data-ref-overview-refresh disabled={loading.value} onClick={() => load(true)}>刷新数据</button>
          </section>

          <div class="rf-ref-metrics">
            {summary.value.map((metric) => (
              <article class={metric.tone} key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.note}</small>
              </article>
            ))}
          </div>

          <section class="rf-ref-list-panel">
            <header>
              <div>
                <strong>内推记录</strong>
                <small>{filteredReferrals.value.length} 条 · 第 {Math.min(page.value, totalPages.value)} / {totalPages.value} 页</small>
              </div>
              <label>
                <span>搜索</span>
                <input
                  type="search"
                  value={keyword.value}
                  onInput={(event) => { keyword.value = event.currentTarget.value; }}
                  placeholder="候选人 / 岗位 / 推荐人 / 部门"
                  aria-label="搜索内推记录"
                />
              </label>
            </header>

            <div class="rf-ref-filters" role="group" aria-label="有效性筛选">
              {['全部', '待确认', '有效', '无效'].map((item) => (
                <button class={validity.value === item ? 'active' : ''} type="button" onClick={() => { validity.value = item; }}>{item}</button>
              ))}
            </div>

            {visibleReferrals.value.length ? (
              <div class="rf-ref-table-shell">
                <table class="rf-ref-table">
                  <thead>
                    <tr><th>候选人</th><th>意向岗位</th><th>推荐人</th><th>部门</th><th>有效性</th><th>状态</th><th>推荐时间</th></tr>
                  </thead>
                  <tbody>
                    {visibleReferrals.value.map((item, index) => (
                      <tr
                        key={item.id || `${item.candidateId}-${index}`}
                        class={{ 'referral-record-clickable': Boolean(item.candidateId) }}
                        data-ref-record-candidate={item.candidateId || undefined}
                        tabindex={item.candidateId ? 0 : undefined}
                        aria-label={item.candidateId ? `点击查看${item.candidateName || '候选人'}的简历` : undefined}
                      >
                        <td>
                          <strong>{item.candidateName || '解析中'}</strong>
                          {!item.candidateId ? <small>待解析</small> : null}
                        </td>
                        <td>{item.role || '岗位待关联'}</td>
                        <td>
                          {item.referrer || '—'}
                          {maskPhone(item.referrerMobile) ? <small>{maskPhone(item.referrerMobile)}</small> : null}
                        </td>
                        <td>{item.department || '—'}</td>
                        <td><span class={`rf-ref-validity ${validityClass(item.validity)}`}>{item.validity || '待确认'}</span></td>
                        <td>
                          {item.status || '—'}
                          {item.progress ? <small>{item.progress}</small> : null}
                        </td>
                        <td>{formatDate(item.recommendedAt) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div class="rf-ref-empty">
                <strong>{referrals.value.length ? '没有符合筛选条件的记录' : '暂无内推记录'}</strong>
                <p>{referrals.value.length ? '调整搜索关键词或有效性条件后再试。' : '候选人扫码上传或员工直接上传后，记录会自动出现在这里。'}</p>
              </div>
            )}

            {filteredReferrals.value.length > pageSize ? (
              <footer>
                <button class="btn-soft" type="button" disabled={page.value <= 1} onClick={() => { page.value = Math.max(1, page.value - 1); }}>上一页</button>
                <span>第 {page.value} / {totalPages.value} 页</span>
                <button class="btn-soft" type="button" disabled={page.value >= totalPages.value} onClick={() => { page.value = Math.min(totalPages.value, page.value + 1); }}>下一页</button>
              </footer>
            ) : null}
          </section>
        </div>
      );
    };
  },
};

window.mountReferralOverview = ({ force = false } = {}) => {
  const root = document.getElementById('referral-qr-summary');
  if (!root) return Promise.resolve(false);
  if (!activeApp) {
    activeApp = createApp(ReferralOverviewPage);
    activeApp.mount(root);
    return Promise.resolve(true);
  }
  return Promise.resolve(activeLoad?.(force) ?? false);
};

window.refreshReferralOverview = () => {
  referralCache = { expiresAt: 0, referrals: [], analytics: {} };
  return window.mountReferralOverview({ force: true });
};
