import { computed, createApp, h, onBeforeUnmount, onMounted, ref } from 'vue';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const milestoneNames = { interview: '面试', offer: 'Offer', onboard: '入职' };

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

async function requestJson(path, { signal, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(apiUrl(path), { headers: identityHeaders(), signal: controller.signal });
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

function formatMilestoneTime(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const timestamp = shanghaiDateTimeMs(raw);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

const PointsRankingPage = {
  setup() {
    const data = ref(null);
    const loading = ref(true);
    const error = ref('');
    let requestController = null;
    let disposed = false;

    const summary = computed(() => data.value?.summary || {});
    const ranking = computed(() => data.value?.ranking || []);
    const rules = computed(() => data.value?.rules || []);
    const podium = computed(() => ranking.value.slice(0, 3));
    const summaryCards = computed(() => [
      ['总积分', Number(summary.value.totalPoints || 0), `${Number(summary.value.participants || 0)} 位推荐人`],
      ['面试节点', Number(summary.value.interviews || 0), '去重候选人岗位'],
      ['Offer 节点', Number(summary.value.offers || 0), '已发送 Offer'],
      ['入职节点', Number(summary.value.onboardings || 0), '实际到岗'],
    ]);

    async function loadRanking(force = false) {
      if (!force && data.value) return;
      const controller = new AbortController();
      requestController?.abort();
      requestController = controller;
      loading.value = true;
      error.value = '';
      try {
        const result = await requestJson('api/points/ranking', { signal: controller.signal });
        if (disposed || controller.signal.aborted) return;
        data.value = result;
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

    function forceRefresh() {
      loadRanking(true);
    }

    onMounted(() => {
      document.querySelector('[data-points-refresh]')?.addEventListener('click', forceRefresh);
      loadRanking();
    });

    onBeforeUnmount(() => {
      disposed = true;
      requestController?.abort();
      document.querySelector('[data-points-refresh]')?.removeEventListener('click', forceRefresh);
    });

    return () => {
      if (loading.value) return <div class="rf-dialog-loading">正在汇总内推积分…</div>;
      if (error.value) {
        return (
          <div class="points-error">
            <strong>积分排行读取失败</strong>
            <p>{error.value}</p>
            <button class="btn-soft" type="button" data-points-retry onClick={() => loadRanking(true)}>重新加载</button>
          </div>
        );
      }

      const medals = ['冠军', '亚军', '季军'];
      return (
        <div class="points-page-body">
          <section class="points-summary" aria-label="积分概况">
            {summaryCards.value.map(([label, value, note]) => (
              <article key={label}><span>{label}</span><strong>{Number(value || 0)}</strong><small>{note}</small></article>
            ))}
          </section>
          <div class="points-layout">
            <section class="points-board">
              <header>
                <div><strong>推荐人排名</strong><small>按总积分降序，同分并列</small></div>
                <span>共 {ranking.value.length} 人</span>
              </header>
              {podium.value.length ? (
                <div class="points-podium">
                  {podium.value.map((person, index) => (
                    <article key={person.userId || person.name} class={Number(person.rank) === 1 ? 'first' : ''}>
                      <em>{medals[index] || `第 ${Number(person.rank || index + 1)} 名`}</em>
                      <strong>{person.name || '未知推荐人'}</strong>
                      <small>{person.department || '部门待补充'}</small>
                      <b>{Number(person.points || 0)}<i>分</i></b>
                    </article>
                  ))}
                </div>
              ) : null}
              {ranking.value.length ? (
                <div class="points-table" role="table" aria-label="积分排行">
                  <div class="points-table-head" role="row">
                    <span>排名</span><span>推荐人</span><span>面试</span><span>Offer</span><span>入职</span><span>积分</span>
                  </div>
                  {ranking.value.map((person) => (
                    <article class="points-rank-card" key={person.userId || person.name} role="row">
                      <span class={`points-rank-number rank-${Math.min(Number(person.rank || 0), 4)}`}>{Number(person.rank || 0)}</span>
                      <div class="points-person">
                        <strong>{person.name || '未知推荐人'}</strong>
                        <small>{person.department || '部门待补充'} · 中高层 {Number(person.corePoints || 0)} · 普通 {Number(person.normalPoints || 0)}</small>
                      </div>
                      <b>{Number(person.interviews || 0)}</b>
                      <b>{Number(person.offers || 0)}</b>
                      <b>{Number(person.onboardings || 0)}</b>
                      <strong class="points-score">{Number(person.points || 0)}<small>分</small></strong>
                      {person.details?.length ? (
                        <details class="points-detail">
                          <summary>推荐明细 {person.details.length}</summary>
                          <div>
                            {person.details.map((item) => (
                              <p key={`${item.referralId}-${item.milestone}`}>
                                <span>{item.candidateName || '候选人'} · {item.positionName || '岗位待补充'}</span>
                                <b>+{Number(item.points || 0)}</b>
                                <small>{milestoneNames[item.milestone] || item.milestone} · {formatMilestoneTime(item.occurredAt) || '时间待补充'}</small>
                              </p>
                            ))}
                          </div>
                        </details>
                      ) : <span class="points-detail-spacer"></span>}
                    </article>
                  ))}
                </div>
              ) : (
                <div class="points-empty"><strong>暂无积分记录</strong><p>候选人通过内推进入面试后，积分会自动进入排行。</p></div>
              )}
            </section>
            <aside class="points-rules">
              <header><strong>积分规则</strong><small>同一候选人同一岗位只计最早一次</small></header>
              {rules.value.map((rule) => (
                <article key={rule.category}>
                  <strong>{rule.category}</strong>
                  <div>
                    <span><b>{Number(rule.interview || 0)}</b>面试</span>
                    <span><b>{Number(rule.offer || 0)}</b>Offer</span>
                    <span><b>{Number(rule.onboard || 0)}</b>入职</span>
                  </div>
                </article>
              ))}
              <p>推荐人不是该岗位负责人或招聘 HR 时才计分。岗位层级可在岗位编辑中维护，未标记时按普通岗位计算。</p>
            </aside>
          </div>
        </div>
      );
    };
  },
};

window.mountPointsRankingPage = () => {
  const root = document.getElementById('points-root');
  if (!root) return false;
  if (activeApp) return true;
  activeApp = createApp(PointsRankingPage);
  activeApp.mount(root);
  return true;
};

window.unmountPointsRankingPage = () => {
  activeApp?.unmount();
  activeApp = null;
};
