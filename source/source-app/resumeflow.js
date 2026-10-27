(() => {
  const supported = ['.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff'];
  const apiUrl = (path) => new URL(path.replace(/^\//, ''), new URL('.', window.location.href)).toString();
  const state = {
    file: null, resumes: [], talents: [], talentOverview: null, jobMap: [], talentDetails: {}, activeId: '',
    talentPageSize: 25,
    talentFilters: { q: '', job: '全部岗位', status: '全部状态', source: '全部来源', tag: '全部标签', importer: '', age: '全部年龄', region: '全部地区', score: '全部评分' }, talentSearchDraft: '',
    archiveMode: 'api', archiveMessage: '', apiConfig: null, codeTab: 'curl', resumeVersionData: null, resumeBatchId: '', resumeBatchConfirmItems: [], analysisVersionData: null, analysisComparison: null,
    duplicateCases: [], duplicateCase: null, duplicateResult: null,
    reviewQueue: null, communicationTemplates: [], activeCommunicationCandidateId: '',
    assessmentData: null, assessmentPublic: null, assessmentSaveTimer: null,
    interviewData: null,
    selectedInterviewId: '',
    evaluationData: null,
    offerData: null, backgroundData: [], backgroundCandidateId: '', backgroundSelectedId: '', lifecycleData: null, lifecycleCandidateId: '', lifecycleSelectedId: '', referralData: null, messageData: null, governanceData: null, jobs: [], jobCatalogLoaded: false, jobFormOptions: null, monthlyDemands: [], jobSelectedIds: new Set(), positionOptions: [], positionOptionsPromise: null, accessAdminData: null, currentAccess: null, referralListCache: null, talentPage: 1, talentTotal: 0, talentTotalPages: 1, talentLoadSequence: 0, talentDetailLoadSequence: 0, talentSearchLoading: false, showTalentAdvancedFilters: false, avatarBackfillStarted: false,
  };
  const initialApplicationState = structuredClone(state);
  let accessEpoch = 0;
  const requestButtonLocks = new WeakMap();
  let dialogReturnFocus = null;
  let interviewerOutsideClickHandler = null;
  const requiredDialogFieldIds = new Set([
    'rf-owner-name','rf-owner-reason','rf-review-opinion','rf-review-evidence','rf-comm-channel','rf-comm-result','rf-comm-summary',
    'rf-question-category','rf-question-title','rf-question-score','rf-template-assessment-name','rf-template-assessment-category','rf-template-assessment-duration',
    'rf-interviewer-user-id','rf-interviewer-name','rf-interviewer-department','rf-availability-interviewer','rf-availability-start','rf-availability-end',
    'rf-room-name','rf-room-location','rf-interview-start','rf-interview-end','rf-feedback-user-id','rf-feedback-name','rf-feedback-candidate-rating','rf-feedback-ai-summary','rf-feedback-interviewer-evaluation',
    'rf-final-decision-reason','rf-offer-role','rf-offer-department','rf-offer-location','rf-offer-start','rf-offer-base','rf-offer-template',
    'rf-bg-contact-name','rf-bg-contact-relation','rf-bg-verify-type','rf-bg-verify-result','rf-bg-verify-source','rf-bg-risk-title','rf-bg-risk-description',
    'rf-bg-conclusion','rf-bg-conclusion-opinion','gov-rating-reason','gov-rating-evidence','rf-stage-reason',
    'msg-tpl-name','msg-tpl-category','msg-tpl-content','msg-rule-name','msg-rule-template','msg-rule-recipient-type','msg-owner-title','msg-owner-text',
    'ref-campaign-name','ref-campaign-role','ref-campaign-department','ref-campaign-expiry','ref-rule-name','ref-rule-amount',
    'life-prob-score','life-prob-manager','life-follow-reason','life-follow-feedback',
  ]);
  const accessPageOptions = {
    home: '首页', positions: '岗位', candidates: '人才档案', resume_api: '开发者中心', interviews: '面试', offers: 'Offer管理',
    referrals: '内部推荐', points: '积分排行', scheduled_tasks: '定时任务', analytics: '数据分析', settings: '组织与权限',
  };
  const accessActionOptions = [
    { code: 'view_dashboard', label: '首页 · 查看工作台' },
    { code: 'create_demand', label: '岗位 · 新建/修改招聘需求' },
    { code: 'manage_positions', label: '岗位 · 新建/编辑/发布岗位' },
    { code: 'edit_candidate', label: '人才 · 导入/编辑/删除人才简历' },
    { code: 'review_candidate', label: '人才 · 业务评审与招聘决策' },
    { code: 'advance_application', label: '人才 · 推进招聘阶段' },
    { code: 'arrange_interview', label: '面试 · 安排/改期/取消面试' },
    { code: 'manage_assessments', label: '面试 · 题库/测评/AI分析管理' },
    { code: 'submit_interview_feedback', label: '面试 · 填写面试评价' },
    { code: 'manage_offer', label: 'Offer · 创建/编辑/发送Offer' },
    { code: 'review_offer', label: 'Offer · 审批Offer' },
    { code: 'manage_background', label: '人才 · 背调管理' },
    { code: 'manage_employee_lifecycle', label: '人才 · 入转离与试用期管理' },
    { code: 'complete_resource_task', label: '流程 · 完成分配给我的任务' },
    { code: 'manage_referrals', label: '内推 · 活动/记录/奖励管理' },
    { code: 'manage_messages', label: '消息 · 模板/规则/发送管理' },
    { code: 'manage_governance', label: '流程 · SLA/评级/审计管理' },
    { code: 'export_authorized_data', label: '数据 · 导出授权数据' },
    { code: 'manage_resume_api', label: '开发者中心 · 管理API密钥' },
    { code: 'request_sensitive_access', label: '隐私 · 申请敏感字段解锁' },
    { code: 'manage_access_control', label: '系统 · 组织与角色权限管理' },
    { code: 'manage_system', label: '系统 · 运行状态/定时任务/全量任务' },
  ];
  const accessActionSelectors = {
    create_demand: ['[data-action="monthly-demand"]', '[data-rf-demand-edit]', '[data-dept-new]', '[data-dept-demand]', '[data-dept-pause]', '[data-dept-confirm-pause]', '#rf-save-demand'],
    manage_positions: ['[data-action="new-job"]', '[data-action="add-position-group"]', '[data-rf-job-edit]', '[data-rf-job-offline]', '[data-rf-job-publish]', '[data-rf-job-batch]', '.rf-job-select', '.rf-job-select-all', '[data-rf-job-selection-clear]'],
    edit_candidate: [
      '[data-action="new-applicant"]', '[data-action="resume-search"]', '[data-action="bulk-screening"]', '[data-action="new-talent"]',
      '[data-action="talent-active"]', '[data-action="talent-inventory"]', '#rf-start', '#rf-batch-open', '[data-rf-batch-upload]',
      '[data-rf-batch-retry]', '[data-rf-review-resume]', '[data-rf-resume-review]', '[data-rf-submit-resume-review]', '[data-rf-reparse-resume]',
      '[data-rf-rename-talent]', '[data-rf-submit-talent-name]',
      '[data-rf-word]', '[data-rf-talent-word]', '[data-resume-version-activate]', '[data-version-confirm]', '[data-rf-delete]', '[data-rf-delete-talent-resume]',
      '[data-rf-delete-talent]', '[data-rf-owner]', '[data-rf-save-owner]', '[data-rf-birth-year]', '[data-rf-save-birth-year]', '[data-rf-contact-lock]',
      '[data-rf-communication]', '[data-rf-queue-communication]', '[data-rf-save-communication]', '[data-rf-comm-transcript-extract]', '[data-rf-sync-followups]',
    ],
    review_candidate: ['[data-rf-wecom]', '[data-rf-wecom-submit]', '[data-rf-queue-review]', '[data-rf-submit-review]', '[data-rf-submit-decision]', '[data-rf-confirm-ai]'],
    advance_application: ['[data-rf-advance]', '[data-rf-stage-action]'],
    arrange_interview: [
      '[data-rf-schedule-interview]', '[data-rf-schedule-current]', '[data-rf-create-interview]', '[data-rf-cancel-interview]', '[data-rf-confirm-cancel-interview]',
      '[data-rf-retry-interview]', '[data-rf-send-result]', '[data-rf-review-reschedule]', '[data-rf-approve-reschedule]', '[data-rf-reject-reschedule]',
      '[data-rf-new-interviewer]', '[data-rf-save-interviewer]', '[data-rf-new-availability]', '[data-rf-save-availability]', '[data-rf-new-room]',
      '[data-rf-save-room]', '[data-rf-sync-wecom-resources]', '[data-rf-sync-wecom-rooms]', '[data-rf-lookup-wecom-user]',
    ],
    manage_assessments: [
      '[data-action="screening-rule"]', '[data-action="ai-screen"]', '[data-action="ai-interview"]', '[data-action="ai-review"]', '[data-rf-ai-versions]',
      '[data-rf-open-analysis-versions]', '[data-ai-rerun]', '[data-rf-correct-ai]', '[data-ai-correct-submit]', '[data-rf-ai-draft]', '[data-ai-generate]',
      '[data-rf-correct-match]', '[data-match-correct-submit]',
      '[data-rf-background]', '[data-rf-new-question]', '[data-rf-save-question]', '[data-rf-new-template]', '[data-rf-save-assessment-template]',
      '[data-rf-publish-template]', '[data-rf-invite-assessment]', '[data-rf-select-invite-template]', '[data-rf-submit-assessment-review]',
      '[data-rf-generate-flow-questions]', '[data-rf-export-interview-questions]',
      '[data-rf-regenerate-questions]', '[data-qb-import]', '[data-qb-edit]', '[data-qb-status]',
    ],
    submit_interview_feedback: ['[data-rf-open-interview-feedback]', '[data-rf-write-feedback]', '[data-rf-generate-interview-ai]', '[data-rf-submit-feedback]', '[data-interview-evaluation-form] button'],
    manage_offer: [
      '[data-action="offer-template-manager"]',
      '[data-rf-save-offer-template]', '[data-rf-send-offer-email]', '[data-offer-action]', '[data-rf-confirm-onboard]',
    ],
    manage_background: ['[data-rf-open-background]', '[data-bg-new]', '[data-bg-save-create]', '[data-bg-action]', '[data-bg-submit-action]'],
    manage_employee_lifecycle: [
      '[data-rf-lifecycle]', '[data-onboard-submit]', '[data-life-new]', '[data-life-action]', '[data-life-submit]', '[data-life-verify-doc]',
      '[data-life-probation]', '[data-life-followup]', '[data-life-generate-followups]',
    ],
    complete_resource_task: ['[data-life-complete-task]', '[data-gov-complete]'],
    view_referrals: ['[data-referral-workbench]'],
    create_referral_campaign: ['[data-referral-upload]', '[data-referral-poster]'],
    manage_referrals: [
      '[data-ref-rule]', '[data-ref-submit]', '[data-ref-valid]', '[data-ref-invalid]',
      '[data-ref-evaluate]', '[data-ref-pay]',
    ],
    manage_messages: [
      '[data-action="invite-script"]', '[data-action^="template-"]', '[data-msg-compose]', '[data-msg-template]', '[data-msg-rule]', '[data-msg-owner]',
      '[data-msg-submit]', '[data-msg-send]', '[data-msg-retry]', '[data-msg-toggle]', '[data-msg-scan]',
    ],
    manage_governance: [
      '[data-rf-duplicates]', '[data-rf-scan-duplicates]', '[data-rf-merge]', '[data-rf-not-duplicate]', '[data-rf-undo-merge]', '[data-rf-release-stale]',
      '[data-rf-governance]', '[data-gov-sla]', '[data-gov-remind]', '[data-gov-escalate]', '[data-gov-rate]', '[data-gov-save-rating]',
    ],
    export_authorized_data: ['[data-action="export-month"]', '[data-action="download-report"]', '[data-overview-export-xlsx]', '[data-analytics-export]'],
    manage_resume_api: ['#rf-rotate-key'],
    manage_access_control: [
      '[data-access-admin]', '[data-access-mutate]', '[data-access-org]', '[data-access-user]', '[data-access-user-batch]', '[data-access-user-mobile]',
      '[data-access-binding]', '[data-access-user-binding]', '[data-access-revoke]', '[data-access-decision]', '[data-access-sync-tianji]', '[data-access-sync-wecom]',
      '[data-access-submit]', '[data-role-permission-save]',
    ],
    manage_system: [
      '[data-action="save-settings"]', '[data-system-status]', '[data-system-refresh]', '[data-system-db-retry]', '[data-ai-monitoring]', '[data-ai-rerun-all]',
      '[data-task-create]', '[data-task-select]', '#rf-task-create-btn', '#rf-task-edit-save', '[data-task-edit]', '[data-task-run]', '[data-task-toggle]',
    ],
  };
  let accessPermissionObserver = null;

  function hasAccessAction(action) {
    const actions = Array.isArray(state.currentAccess?.actions) ? state.currentAccess.actions : [];
    return actions.includes('*') || actions.includes(action);
  }

  function permissionMatches(root, selector) {
    const matches = [];
    if (root instanceof Element && root.matches(selector)) matches.push(root);
    if (root?.querySelectorAll) matches.push(...root.querySelectorAll(selector));
    return matches;
  }

  function applyActionPermissions(root = document) {
    for (const [action, selectors] of Object.entries(accessActionSelectors)) {
      for (const selector of selectors) {
        for (const node of permissionMatches(root, selector)) {
          node.dataset.requiredAction = action;
          node.classList.toggle('rf-permission-hidden', !hasAccessAction(action));
          if (!hasAccessAction(action)) node.setAttribute('aria-hidden', 'true');
          else node.removeAttribute('aria-hidden');
        }
      }
    }
    document.querySelectorAll('.access-entry[data-access-admin]').forEach((node) => { node.hidden = !hasAccessAction('manage_access_control'); });
  }

  function installActionPermissionEnforcement() {
    applyActionPermissions(document);
    if (!accessPermissionObserver) {
      accessPermissionObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => { if (node instanceof Element) applyActionPermissions(node); }));
      });
      accessPermissionObserver.observe(document.body, { childList: true, subtree: true });
      document.addEventListener('click', (event) => {
        const target = event.target.closest?.('[data-required-action]');
        if (!target || hasAccessAction(target.dataset.requiredAction)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
  }

  function setRequestButtonBusy(button, busy) {
    if (!(button instanceof HTMLButtonElement)) return;
    const current = requestButtonLocks.get(button) || { count: 0, disabled: button.disabled };
    current.count += busy ? 1 : -1;
    if (busy && current.count === 1) {
      current.disabled = button.disabled;
      button.disabled = true;
      button.classList.add('is-busy');
      button.setAttribute('aria-busy', 'true');
    }
    if (!busy && current.count <= 0) {
      button.disabled = current.disabled;
      button.classList.remove('is-busy');
      button.removeAttribute('aria-busy');
      requestButtonLocks.delete(button);
      return;
    }
    requestButtonLocks.set(button, current);
  }

  const backgroundActionPaths = [
    /^api\/recruitment\/(?:monthly-demands|department-demands)$/,
    /^api\/recruitment\/department-demands\/[^/]+\/pause$/,
    /^api\/recruitment\/approvals\/[^/]+\/[^/]+\/decision$/,
    /^api\/talents\/[^/]+\/(?:communications|review|wecom-review-share|stage)$/,
    /^api\/interview-evaluations\/interviews\/[^/]+\/(?:feedback|decision|notes)$/,
    /^api\/interview-evaluations\/public$/,
    /^api\/public\/interviews\/communication$/,
    /^api\/interviews\/wecom\/resources\/sync$/,
    /^api\/interviews\/appointments\/[^/]+\/(?:retry-invitation|result|sync-calendar)$/,
    /^api\/offers$/,
    /^api\/offers\/[^/]+\/(?:submit|approval|generate-file|send-email|response-link|negotiate)$/,
  ];
  const pendingBackgroundActions = new Map();

  async function requestBackgroundAction(path, options) {
    const key = JSON.stringify([accessEpoch, path, options.body || '']);
    const pending = pendingBackgroundActions.get(key) || { requestId: crypto.randomUUID() };
    if (pending.promise) return pending.promise;
    pendingBackgroundActions.set(key, pending);
    const button = options.initiator || (document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
    const originalLabel = button?.getAttribute('aria-label');
    const progressNode = button?.isConnected ? document.createElement('small') : null;
    if (progressNode) {
      progressNode.className = 'rf-background-action-progress';
      progressNode.setAttribute('role', 'status');
      progressNode.textContent = pending.jobId ? '正在查询上次处理结果…' : '正在后台处理，请勿重复提交…';
      button.after(progressNode);
    }
    setRequestButtonBusy(button, true);
    pending.promise = (async () => {
      try {
        if (!pending.jobId) {
          const headers = new Headers(options.headers || {});
          headers.set('x-background-action', pending.requestId);
          const started = await request(path, { ...options, headers, backgroundRequest: true, timeoutMs: 45000 });
          if (!started.jobId) { pendingBackgroundActions.delete(key); return started; }
          pending.jobId = started.jobId;
        }
        const result = await waitForBackgroundJob(pending.jobId, message => {
          if (button?.isConnected) button.setAttribute('aria-label', message);
          if (progressNode?.isConnected) progressNode.textContent = message;
        });
        pendingBackgroundActions.delete(key);
        return result;
      } catch (error) {
        if (error.jobFailed || [400, 401, 403].includes(error.status)) pendingBackgroundActions.delete(key);
        if (!error.jobFailed && ![400, 401, 403].includes(error.status)) error.message = `${error.message}。处理结果暂未确认，原内容已保留；再次点击将查询同一任务，不会重复提交。`;
        throw error;
      } finally {
        delete pending.promise;
        setRequestButtonBusy(button, false);
        progressNode?.remove();
        if (button?.isConnected) {
          if (originalLabel === null || originalLabel === undefined) button.removeAttribute('aria-label');
          else button.setAttribute('aria-label', originalLabel);
        }
      }
    })();
    return pending.promise;
  }

  async function request(path, options = {}) {
    if (!options.jobQuery && /^(?:api\/jobs\/|api\/interviews\/reschedule-jobs\/)/.test(path) && ['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try { return await request(path, { ...options, jobQuery: true }); }
        catch (error) {
          if ([400, 401, 403, 404].includes(error.status) || attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    }
    if (!options.backgroundRequest && String(options.method || 'GET').toUpperCase() === 'POST' && backgroundActionPaths.some(pattern => pattern.test(path.split('?')[0]))) {
      return requestBackgroundAction(path, options);
    }
    const requestEpoch = accessEpoch;
    const writing = !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase()) && path !== 'api/talents/avatars/backfill';
    if (writing) invalidateTalentSnapshots();
    const initiator = options.initiator || (document.activeElement instanceof HTMLButtonElement && document.activeElement.closest('#rf-talent-dialog .rf-full-detail-dialog') ? null : document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
    setRequestButtonBusy(initiator, true);
    try {
      const headers = new Headers(options.headers || {});
      const identity = window.recruitmentCurrentUser;
      if (identity?.id && !headers.has('x-user-id')) headers.set('x-user-id', encodeURIComponent(String(identity.id)));
      if (identity?.name && !headers.has('x-user-name')) headers.set('x-user-name', encodeURIComponent(String(identity.name)));
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), Number(options.timeoutMs || 15000));
      let response, data;
      try {
        response = await fetch(apiUrl(path), { ...options, headers, signal: options.signal || controller.signal });
        const contentType = response.headers.get('content-type') || '';
        data = contentType.includes('json') ? await response.json() : { message: await response.text() };
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error(writing ? '请求等待超时，处理结果暂未确认，请先查看记录，勿重复提交' : '查询暂时超时，请稍后重试');
        throw error;
      } finally {
        window.clearTimeout(timeout);
      }
      if (requestEpoch !== accessEpoch) throw new Error('登录身份或权限已更新，请重新操作');
      if (!response.ok) {
        if (response.status === 401 && path !== 'api/access/me') void refreshCurrentPermissions();
        const error = new Error(Array.isArray(data.message) ? data.message.join('；') : data.message || `请求失败 (${response.status})`);
        error.status = response.status;
        error.code = data.code || data.error || '';
        error.details = data;
        throw error;
      }
      if (path.startsWith('api/jobs/') && ['done', 'failed'].includes(data.status)) invalidateTalentSnapshots();
      return data;
    } finally {
      if (writing) invalidateTalentSnapshots();
      setRequestButtonBusy(initiator, false);
    }
  }

  async function loadPositionOptions(force = false) {
    if (!force && state.positionOptions.length) return state.positionOptions;
    if (!force && state.positionOptionsPromise) return state.positionOptionsPromise;
    state.positionOptionsPromise = request('api/recruitment/position-options')
      .then((result) => {
        state.positionOptions = result.positions || [];
        return state.positionOptions;
      })
      .finally(() => { state.positionOptionsPromise = null; });
    return state.positionOptionsPromise;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function conciseError(error) {
    const message = String(error?.message || error || '服务暂时不可用');
    if (/^forbidden$/i.test(message.trim())) return '当前打开的是静态预览，登录接口没有启动。请改用 http://127.0.0.1:8080/';
    if (/招聘数据库尚未就绪|缺少 STUDIO_PLATFORM_URL|DATABASE_NOT_READY/.test(message)) return '本地还没有连接招聘数据库，员工账号暂时无法校验。';
    if (/\b404\b/.test(message)) return '接口暂时不可用（404）';
    return message.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function isTalentDialogCurrent(token) {
    return token === talentDialogToken && Boolean(document.getElementById('rf-talent-dialog'));
  }

  function dialogFailure(title, error, retry, token) {
    if (token !== undefined && !isTalentDialogCurrent(token)) return;
    const forbidden = [401, 403].includes(Number(error?.status));
    const heading = forbidden ? '暂无权限访问' : title;
    const description = forbidden ? '当前账号没有查看或操作该模块的权限。如岗位职责发生变化，请联系管理员调整角色与数据范围。' : conciseError(error);
    showTalentDialog(`<div class="rf-dialog-error ${forbidden ? 'permission' : ''}"><i>${forbidden ? '🔒' : '!'}</i><strong>${escapeHtml(heading)}</strong><p>${escapeHtml(description)}</p><div>${retry && !forbidden ? '<button class="btn-primary" data-rf-error-retry type="button">重新加载</button>' : ''}<button class="btn-soft" data-rf-error-close type="button">关闭</button></div></div>`, 'wide');
    document.querySelector('[data-rf-error-retry]')?.addEventListener('click', retry);
    document.querySelector('[data-rf-error-close]')?.addEventListener('click', cancelTalentDialog);
  }

  function notifyUser(message, type = 'info', retry, actionLabel = '重试') {
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
    item.innerHTML = `<i>${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</i><div><strong>${type === 'success' ? '操作成功' : type === 'error' ? '操作未完成' : '操作提示'}</strong><p>${escapeHtml(message)}</p></div>${retry ? `<button type="button" data-rf-notify-retry>${escapeHtml(actionLabel)}</button>` : ''}<button type="button" data-rf-notify-close aria-label="关闭提示">×</button>`;
    region.appendChild(item);
    let dismissTimer;
    const pauseDismiss = () => window.clearTimeout(dismissTimer);
    const close = () => { pauseDismiss(); item.remove(); };
    const scheduleDismiss = () => {
      pauseDismiss();
      if (retry || type === 'error' || item.matches(':hover') || item.contains(document.activeElement)) return;
      dismissTimer = window.setTimeout(close, 8000);
    };
    item.querySelector('[data-rf-notify-close]')?.addEventListener('click', close);
    item.querySelector('[data-rf-notify-retry]')?.addEventListener('click', () => { close(); retry(); });
    item.addEventListener('pointerenter', pauseDismiss);
    item.addEventListener('pointerleave', scheduleDismiss);
    item.addEventListener('focusin', pauseDismiss);
    item.addEventListener('focusout', scheduleDismiss);
    scheduleDismiss();
  }

  function installNotificationBridge() {
    if (window.__resumeFlowNotificationBridge) return;
    window.__resumeFlowNotificationBridge = true;
    window.alert = (message) => {
      const value = String(message || '操作提示');
      notifyUser(value, /失败|错误|无法|未完成/.test(value) ? 'error' : /完成|成功|已生成|已更新/.test(value) ? 'success' : 'info');
    };
  }

  function validateDialogForm(messageNode) {
    const root = document.querySelector('.rf-dialog');
    if (!root) return true;
    requiredDialogFieldIds.forEach((id) => {
      const field = document.getElementById(id);
      const nativeCombobox = field instanceof HTMLSelectElement && field.classList.contains('rf-combobox-native');
      if (field && root.contains(field) && !nativeCombobox) field.required = true;
    });
    const fields = [...root.querySelectorAll('input[required], select[required], textarea[required]')];
    let firstInvalid = null;
    fields.forEach((field) => {
      const invalid = !field.checkValidity() || (field.type !== 'checkbox' && !String(field.value || '').trim());
      field.classList.toggle('field-error', invalid);
      field.toggleAttribute('aria-invalid', invalid);
      if (invalid && !firstInvalid) firstInvalid = field;
    });
    if (!firstInvalid) return true;
    firstInvalid.focus();
    const label = firstInvalid.closest('label')?.querySelector('span')?.textContent?.replace('*', '').trim() || '必填项';
    if (messageNode) {
      messageNode.textContent = `请填写${label}后再提交。`;
      messageNode.classList.add('error');
    }
    return false;
  }

  function renderParse(surface = 'page') {
    const inDialog = surface === 'dialog';
    const root = inDialog ? document.getElementById('rf-resume-import-root') : document.getElementById('resumeflow-parse-root');
    if (!root) return;
    root.innerHTML = `
      <div class="rf-parse-command ${inDialog ? 'rf-parse-command-dialog' : ''}">
        <header class="rf-parse-command-head">
          <div class="rf-parse-command-copy">
            <div class="rf-kicker">RESUME INTAKE</div>
            ${inDialog ? '<h2>导入简历</h2>' : '<h1>解析简历</h1>'}
            <p>上传后自动解析、评分和匹配岗位；如需人工指定岗位，可在完成后修正并重跑。</p>
          </div>
        </header>
        <div class="rf-parse-layout ${inDialog ? 'is-compact' : ''}">
          <section class="rf-upload-panel">
            <div class="rf-upload-title"><div><span>单份解析</span><h2>选择简历文件</h2></div><small>单份最大 10MB</small></div>
            <input id="rf-file-input" type="file" hidden accept="${supported.join(',')}" />
            <div class="rf-drop" id="rf-drop" tabindex="0" role="button" aria-label="选择简历文件">
              <div class="rf-upload-icon">↑</div>
              <strong>${state.file ? '简历已准备好' : '拖拽简历到这里'}</strong>
              <small>也可点击下方按钮从本地选择文件</small>
              <button class="rf-select-button" id="rf-select-file" type="button">${state.file ? '重新选择文件' : '选择简历文件'}</button>
            </div>
            <div id="rf-file-info">${state.file ? fileInfo(state.file) : ''}</div>
            <label class="rf-import-push-option" for="rf-suppress-group-push">
              <input id="rf-suppress-group-push" type="checkbox" name="suppressGroupPush">
              <span><strong>不往群里推送</strong><small>勾选后，本次导入评分完成只入库；如需评审，可稍后在人才档案手动推送。</small></span>
            </label>
            <div class="rf-upload-actions">
              <button class="btn-primary" id="rf-start" ${state.file ? '' : 'disabled'}>上传并解析</button>
              <button class="btn-soft rf-batch-entry" id="rf-batch-open" type="button"><span>批量上传</span><small>1—500 份</small></button>
              <button class="btn-soft" id="rf-clear" ${state.file ? '' : 'disabled'}>清除</button>
            </div>
            <div class="rf-progress" id="rf-progress">${stepsHtml()}</div>
            <section class="rf-batch-history" aria-label="最近批量上传">
              <header><h3>最近批量任务</h3><button type="button" data-rf-batch-history-refresh>刷新</button></header>
              <div id="rf-batch-history-list" aria-live="polite">正在获取最近批次…</div>
            </section>
          </section>
          ${inDialog ? '' : `
            <aside class="rf-parse-guide" aria-label="解析说明">
              <div class="rf-parse-guide-head"><span>处理说明</span><strong>解析后确认岗位</strong><p>可人工指定目标岗位，也可交给 AI 根据岗位库推荐。</p></div>
              <ol class="rf-parse-flow">
                <li><b>01</b><div><strong>核验文件</strong><small>检查格式、大小与可读取性</small></div></li>
                <li><b>02</b><div><strong>提取信息</strong><small>读取姓名、联系方式、经历与技能</small></div></li>
                <li><b>03</b><div><strong>建立主档</strong><small>去重后写入统一的人才档案</small></div></li>
                <li><b>04</b><div><strong>确认岗位</strong><small>人工选择优先，未选择由 AI 推荐</small></div></li>
              </ol>
              <div class="rf-parse-formats"><span>支持格式</span><p>PDF · DOC · DOCX · ODT · RTF · TXT · JPG · PNG</p></div>
            </aside>
          `}
        </div>
      </div>
      ${inDialog ? '' : '<section class="rf-result-panel" id="rf-result"><div><span>PARSE RESULT</span><h2>解析结果</h2></div><p>完成后会在这里显示已提取的字段，并同步进入人才档案。</p></section>'}`;
    bindParse(surface);
  }

  function openResumeImportDialog() {
    state.file = null;
    showTalentDialog('<div id="rf-resume-import-root" class="rf-resume-import-root"></div>', 'wide rf-resume-import-dialog');
    renderParse('dialog');
  }

  function openResumeImporterFromAnywhere() {
    if (!window.canOpenRecruitmentPage?.('resume-archive') || !hasAccessAction('edit_candidate')) return;
    if (!document.getElementById('page-resume-archive')?.classList.contains('active')) window.setPage?.('resume-archive');
    window.setTimeout(openResumeImportDialog, 0);
  }

  function fileInfo(file) {
    const ext = file.name.includes('.') ? `.${file.name.split('.').pop().toLowerCase()}` : '-';
    return `<div class="rf-file"><span><strong>${escapeHtml(file.name)}</strong><span class="rf-muted">格式 ${escapeHtml(ext)} · ${formatBytes(file.size)}</span></span><span class="rf-status">已选择</span></div>`;
  }

  function stepsHtml(active = -1, error = '') {
    const labels = ['文件核验', '读取内容', '信息提取', '保存档案', '自动AI评分'];
    return labels.map((label, index) => `
      <div class="rf-step ${error && index === active ? 'error' : index < active ? 'done' : index === active ? 'active' : ''}">
        <b>${index < active ? '✓' : error && index === active ? '!' : index + 1}</b><span>${escapeHtml(index === active && error ? error : label)}</span>
      </div>`).join('');
  }

  function bindParse(surface = 'page') {
    const input = document.getElementById('rf-file-input');
    const drop = document.getElementById('rf-drop');
    const select = (event) => { event?.stopPropagation(); input.click(); };
    drop.addEventListener('click', select);
    document.getElementById('rf-select-file').addEventListener('click', select);
    drop.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') select(event); });
    input.addEventListener('change', () => chooseFile(input.files?.[0], surface));
    ['dragenter', 'dragover'].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove('dragging'); }));
    drop.addEventListener('drop', (event) => chooseFile(event.dataTransfer?.files?.[0], surface));
    document.getElementById('rf-clear').addEventListener('click', () => { state.file = null; renderParse(surface); });
    document.getElementById('rf-start').addEventListener('click', () => parseFile(surface));
    document.getElementById('rf-batch-open').addEventListener('click', openResumeBatchDialog);
    document.querySelector('[data-rf-batch-history-refresh]')?.addEventListener('click', () => loadResumeBatchHistory());
    void loadResumeBatchHistory();
  }

  function chooseFile(file, surface = 'page') {
    if (!file) return;
    const ext = file.name.includes('.') ? `.${file.name.split('.').pop().toLowerCase()}` : '';
    if (!supported.includes(ext)) return showParseError('不支持的简历格式');
    if (!file.size) return showParseError('简历文件为空');
    if (file.size > 10 * 1024 * 1024) return showParseError('简历文件不能超过 10MB');
    state.file = file;
    renderParse(surface);
  }

  function showParseError(message) {
    const result = document.getElementById('rf-result');
    if (result) result.innerHTML = `<div><span>PARSE ERROR</span><h2>解析未完成</h2></div><div class="rf-error">${escapeHtml(message)}，请重新选择文件。</div>`;
  }

  async function parseFile(surface = 'page') {
    if (!state.file) return;
    const button = document.getElementById('rf-start');
    const progress = document.getElementById('rf-progress');
    button.disabled = true;
    button.textContent = '正在上传…';
    try {
      progress.innerHTML = stepsHtml(0);
      const form = new FormData();
      form.append('file', state.file);
      const identity = window.recruitmentCurrentUser || {};
      form.append('operator', identity.name || '');
      form.append('operatorUserId', identity.id || '');
      form.append('suppressGroupPush', document.getElementById('rf-suppress-group-push')?.checked ? 'true' : 'false');
      const started = await request('api/resumes/parse-upload', { method: 'POST', body: form });
      const result = await waitForBackgroundJob(started.jobId, message => {
        const index = /保存|上传/.test(message) ? 0 : /OCR|文字|PDF|Office|转换/.test(message) ? 1 : /提取/.test(message) ? 2 : /数据库|写入|人才档案/.test(message) ? 3 : 1;
        if (progress.isConnected) progress.innerHTML = stepsHtml(index);
      }, { timeoutMessage: '简历仍在后台解析，请稍后查看人才档案，勿重复上传。' });
      if (progress.isConnected) progress.innerHTML = stepsHtml(4);
      state.file = null;
      openResumePositionConfirm([result]);
    } catch (error) {
      showParseError(error.message || '解析失败');
      progress.innerHTML = stepsHtml(0, error.message || '解析失败');
    } finally {
      button.disabled = false;
      button.textContent = '再次解析';
    }
  }

  async function openResumePositionConfirm(rawItems = []) {
    const seen = new Set();
    const items = rawItems.filter((item) => {
      const candidateId = String(item?.candidateId || '').trim(), resumeId = String(item?.resumeId || item?.id || '').trim();
      if (!candidateId || !resumeId) return false;
      const key = `${candidateId}:${resumeId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!items.length) return;

    let positions = [];
    try { positions = await loadPositionOptions(); }
    catch (error) { console.warn('岗位目录暂时不可用', error); }
    const positionOptions = positions.map((position) => `<option value="${escapeHtml(position.id)}">${escapeHtml(position.name)}${position.department ? ` · ${escapeHtml(position.department)}` : ''}</option>`).join('');
    showTalentDialog(`
      <header class="rf-dialog-head rf-analysis-confirm-head">
        <div><span>AI ANALYSIS</span><h2>AI已开始，可修正岗位</h2><p>系统已自动开始AI评分；选择岗位后会按你的选择重新分析，不选择则由 AI 根据岗位库推荐。</p></div>
      </header>
      <div class="rf-analysis-confirm">
        <div class="rf-analysis-confirm-summary" id="rf-analysis-summary" aria-live="polite"></div>
        <div class="rf-analysis-confirm-list">
          ${items.map((item, index) => `
            <article>
              <div>
                <strong>${escapeHtml(item.name || item.candidateName || item.fileName || item.candidateId || '未识别姓名')}</strong>
                <small>${escapeHtml(item.fileName || item.sourceFileName || '')}${item.candidateId ? ` · 候选人 ${escapeHtml(item.candidateId)}` : ''}</small>
              </div>
              <label>
                <span>目标岗位</span>
                <select data-rf-analysis-position data-candidate-id="${escapeHtml(item.candidateId)}" data-resume-id="${escapeHtml(item.resumeId || item.id)}" aria-label="选择${escapeHtml(item.name || item.fileName || '候选人')}的目标岗位">
                  <option value="">交给 AI 推荐</option>
                  ${positionOptions}
                </select>
              </label>
            </article>
          `).join('')}
        </div>
        <div class="rf-dialog-actions">
          <button class="btn-soft" data-rf-analysis-later type="button">保留AI推荐</button>
          <button class="btn-primary" data-rf-analysis-start type="button">按所选岗位重新分析</button>
        </div>
        <p class="rf-dialog-message" id="rf-analysis-message" aria-live="polite"></p>
      </div>
    `, 'wide');

    const summary = document.getElementById('rf-analysis-summary');
    const selects = [...document.querySelectorAll('[data-rf-analysis-position]')];
    const updateSummary = () => {
      const selected = selects.filter(select => select.value).length;
      summary.textContent = `已解析 ${items.length} 份 · 已选岗位 ${selected} 份 · 交给 AI ${items.length - selected} 份`;
    };
    selects.forEach((select) => select.addEventListener('change', updateSummary));
    updateSummary();

    document.querySelector('[data-rf-analysis-later]')?.addEventListener('click', () => {
      closeTalentDialog();
      notifyUser('简历已入库，AI评分已自动开始。', 'info');
      window.setPage?.('resume-archive');
      loadTalentArchive();
    });
    document.querySelector('[data-rf-analysis-start]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget, message = document.getElementById('rf-analysis-message');
      button.disabled = true;
      message.textContent = '正在启动 AI 分析队列…';
      message.classList.remove('error');
      try {
        const payload = { items: selects.map((select) => ({ candidateId: select.dataset.candidateId, resumeId: select.dataset.resumeId, positionId: select.value })) };
        const result = await request('api/resumes/analysis/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeoutMs: 30000,
        });
        closeTalentDialog();
        notifyUser(`已按所选岗位重新分析 ${Number(result.total || items.length)} 份简历，可在人才档案查看进度。`, 'success');
        window.setPage?.('resume-archive');
        loadTalentArchive();
      } catch (error) {
        button.disabled = false;
        message.textContent = error.message || 'AI分析启动失败';
        message.classList.add('error');
      }
    });
  }

  function renderResumeBatchHistory(batches) {
    const container = document.getElementById('rf-batch-history-list');
    if (!container) return;
    const items = Array.isArray(batches) ? batches : [];
    container.innerHTML = items.length ? items.map((batch) => `
      <article class="${Number(batch.failed || 0) ? 'failed' : ''}">
        <div>
          <strong>${escapeHtml(batch.name || batch.id)}</strong>
          <small>${escapeHtml(batch.creator || '系统导入')} · 成功${Number(batch.succeeded || 0)} · 失败${Number(batch.failed || 0)} · ${escapeHtml(batch.status || '处理中')}</small>
        </div>
        <button type="button" data-rf-batch-detail="${escapeHtml(batch.id)}">查看明细</button>
      </article>
    `).join('') : '<p>暂无批量上传记录。</p>';
    container.querySelectorAll('[data-rf-batch-detail]').forEach((button) => {
      button.addEventListener('click', () => openResumeBatchDetail(button.dataset.rfBatchDetail));
    });
  }

  async function loadResumeBatchHistory() {
    const container = document.getElementById('rf-batch-history-list');
    if (!container) return;
    try {
      const result = await request('api/resumes/batches?limit=5');
      renderResumeBatchHistory(Array.isArray(result) ? result : result?.batches || []);
    } catch (error) {
      container.innerHTML = `<p>最近批次暂时无法读取：${escapeHtml(conciseError(error))}</p>`;
    }
  }

  async function openResumeBatchDetail(batchId) {
    if (!batchId) return;
    try {
      const detail = await request(`api/resumes/batches/${encodeURIComponent(batchId)}`);
      state.resumeBatchId = detail.id;
      state.resumeBatchDialogOpen = true;
      state.resumeBatchConfirmItems = [...((detail.items || []).filter((item) => item.status === '已完成' && item.candidateId && item.resumeId))];
      renderResumeBatchProgress(detail, true);
    } catch (error) {
      notifyUser(error.message || '批量任务明细打开失败', 'error', () => openResumeBatchDetail(batchId));
    }
  }

  let batchSelectedFiles = [];

  function openResumeBatchDialog() {
    batchSelectedFiles = [];
    state.resumeBatchDialogOpen = true;
    showTalentDialog(`<header class="rf-dialog-head"><div><span>BATCH RESUME IMPORT</span><h2>批量上传简历</h2><p>单个批次最多500份，每份不超过10MB。可多次选择文件，系统会自动累加。后台异步排队执行，单个文件失败不会阻断其他文件。</p></div></header><div class="rf-dialog-form"><label class="wide"><span>批次名称</span><input id="rf-batch-name" value="简历批量导入-${new Date().toISOString().slice(0, 10)}"></label><div class="rf-batch-file-pickers"><label class="wide rf-batch-file-picker"><span>选择简历文件</span><input id="rf-batch-files" type="file" multiple accept="${supported.join(',')}"><strong>选择文件（可多次选择）</strong><small>PDF · DOC · DOCX · 图片等</small></label><label class="wide rf-batch-file-picker"><span>选择文件夹</span><input id="rf-batch-folder" type="file" webkitdirectory directory multiple><strong>选择整个文件夹</strong><small>自动识别文件夹内的简历文件</small></label></div><label class="wide rf-import-push-option" for="rf-batch-suppress-group-push"><input id="rf-batch-suppress-group-push" type="checkbox" name="suppressGroupPush"><span><strong>不往群里推送</strong><small>本批全部评分完成后只入库；如需评审，可稍后在人才档案手动推送。</small></span></label></div><div class="rf-batch-validation" id="rf-batch-validation" aria-live="polite">请选择需要解析的简历文件。</div><div class="rf-batch-selected" id="rf-batch-selected"><p>尚未选择文件</p></div><div class="rf-dialog-actions"><button class="btn-soft" data-rf-batch-clear type="button" disabled>清空全部</button><button class="btn-primary" data-rf-batch-upload type="button" disabled>开始批量解析</button></div><p class="rf-dialog-message" id="rf-batch-upload-message" aria-live="polite"></p>`, 'wide');
    const input = document.getElementById('rf-batch-files'), button = document.querySelector('[data-rf-batch-upload]'), clearBtn = document.querySelector('[data-rf-batch-clear]');
    input.addEventListener('change', () => {
      const newFiles = [...(input.files || [])];
      // Merge new files into batchSelectedFiles, dedup by name+size
      const existingKeys = new Set(batchSelectedFiles.map(f => f.name + '|' + f.size));
      for (const nf of newFiles) {
        const key = nf.name + '|' + nf.size;
        if (!existingKeys.has(key)) {
          batchSelectedFiles.push(nf);
          existingKeys.add(key);
        }
      }
      // Reset input value so same file can be re-selected
      input.value = '';
      renderBatchFileList();
    });
    const folderInput = document.getElementById('rf-batch-folder');
    if (folderInput) {
      folderInput.addEventListener('change', () => {
        const allFiles = [...(folderInput.files || [])];
        // Filter only supported resume files from the folder
        const newFiles = allFiles.filter(f => {
          const ext = '.' + String(f.name || '').split('.').pop().toLowerCase();
          return supported.includes(ext) && f.size > 0;
        });
        const existingKeys = new Set(batchSelectedFiles.map(f => f.name + '|' + f.size));
        for (const nf of newFiles) {
          const key = nf.name + '|' + nf.size;
          if (!existingKeys.has(key)) {
            batchSelectedFiles.push(nf);
            existingKeys.add(key);
          }
        }
        folderInput.value = '';
        if (allFiles.length && !newFiles.length) {
          const validation = document.getElementById('rf-batch-validation');
          validation.className = 'rf-batch-validation error';
          validation.textContent = `文件夹中有 ${allFiles.length} 个文件，但没有找到支持的简历格式。`;
        }
        renderBatchFileList();
      });
    }
    clearBtn.addEventListener('click', () => {
      batchSelectedFiles = [];
      renderBatchFileList();
    });
    function renderBatchFileList() {
      batchSelectedFiles.sort((left, right) => Number(isInvalidBatchResumeFile(right)) - Number(isInvalidBatchResumeFile(left)));
      const files = batchSelectedFiles, invalid = files.filter(isInvalidBatchResumeFile), validation = document.getElementById('rf-batch-validation'), selectedDiv = document.getElementById('rf-batch-selected');
      button.disabled = !files.length;
      clearBtn.disabled = !files.length;
      validation.className = `rf-batch-validation${files.length > 500 || invalid.length ? ' error' : files.length ? ' ready' : ''}`;
      validation.textContent = !files.length
        ? '请选择需要解析的简历文件。'
        : files.length > 500
          ? `当前已选 ${files.length} 份，单批最多 500 份；请移除部分文件后再开始。`
          : invalid.length
            ? `发现 ${invalid.length} 份异常文件：请移除标红文件后再开始。支持 Word（DOC/DOCX）和 PDF。`
            : `文件校验通过：${files.length} 份简历已准备好，可开始后台解析。`;
      selectedDiv.innerHTML = files.length ? `<header><strong>${files.length}份文件</strong><span>总计 ${formatBytes(files.reduce((sum, file) => sum + file.size, 0))}</span></header><div>${files.map((file, index) => `<article class="${invalid.includes(file) ? 'invalid' : ''}"><b>${index + 1}</b><span><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}${invalid.includes(file) ? ` · ${batchResumeFileError(file)}` : ' · 可解析'}</small></span><button class="rf-batch-del" data-rf-batch-del="${index}" type="button">✕</button></article>`).join('')}</div>` : '<p>尚未选择文件</p>';
      // Bind delete buttons
      selectedDiv.querySelectorAll('[data-rf-batch-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.rfBatchDel, 10);
          batchSelectedFiles.splice(idx, 1);
          renderBatchFileList();
        });
      });
    }
    button.addEventListener('click', submitResumeBatch);
  }

  function batchResumeFileError(file) {
    const extension = `.${String(file?.name || '').split('.').pop() || ''}`.toLowerCase();
    if (!file?.size) return '文件为空';
    if (file.size > 10 * 1024 * 1024) return '单份超过 10MB';
    if (!supported.includes(extension)) return `不支持 ${extension === '.' ? '无扩展名' : extension.toUpperCase()} 格式`;
    return '文件不符合要求';
  }

  function isInvalidBatchResumeFile(file) {
    const extension = `.${String(file?.name || '').split('.').pop() || ''}`.toLowerCase();
    return !file?.size || file.size > 10 * 1024 * 1024 || !supported.includes(extension);
  }

  function showResumeBatchQueuedDialog(batchName, total, uploadStatus = '') {
    state.resumeBatchDialogOpen = true;
    showTalentDialog(`
      <header class="rf-dialog-head">
        <div><span>BATCH IMPORT</span><h2>批次已创建</h2><p>${escapeHtml(batchName)} · 共${total}份简历</p></div>
      </header>
      <section class="rf-batch-queued" aria-live="polite">
        <div class="rf-batch-queued-icon">⏳</div>
        <strong data-rf-batch-queued-status>${escapeHtml(uploadStatus || '正在上传原始文件')}</strong>
        <p>原始文件传输完成后，系统会自动开始后台解析、入库和通知。你可以关闭这个窗口继续使用系统，但请保持本页面打开，不要关闭浏览器。</p>
      </section>
      <div class="rf-dialog-actions">
        <button class="btn-primary" data-rf-batch-queued-close type="button">知道了，先去忙别的</button>
      </div>
    `, 'wide');
    document.querySelector('[data-rf-batch-queued-close]')?.addEventListener('click', closeTalentDialog);
  }

  async function submitResumeBatch() {
    const files = [...batchSelectedFiles], message = document.getElementById('rf-batch-upload-message');
    if (!files.length || files.length > 500) { message.textContent = '请选择1至500份简历。'; message.classList.add('error'); return; }
    const invalid = files.filter(isInvalidBatchResumeFile);
    if (invalid.length) {
      message.textContent = `无法创建批次：请先移除 ${invalid.length} 份标红文件（例如 Office 临时文件、空文件、格式不支持或超过10MB的文件）。`;
      message.classList.add('error');
      document.getElementById('rf-batch-validation')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    // 所有网络分片归属同一个批次；解析只在上传完成后启动一次。
    const batchName = document.getElementById('rf-batch-name')?.value.trim() || `简历批量导入-${new Date().toISOString().slice(0, 10)}`;
    const suppressGroupPush = document.getElementById('rf-batch-suppress-group-push')?.checked === true;
    const button = document.querySelector('[data-rf-batch-upload]');
    state.resumeBatchConfirmItems = [];
    try {
      button.disabled = true; message.textContent = '正在创建批次并上传前一组文件…'; message.classList.remove('error');
      const chunks = [];
      for (let offset = 0; offset < files.length; offset += 20) chunks.push(files.slice(offset, offset + 20));
      let batchId = '';
      for (let index = 0; index < chunks.length; index += 1) {
        const isFinalChunk = index === chunks.length - 1;
        const form = new FormData();
        chunks[index].forEach((file) => form.append('files', file));
        if (!batchId) form.append('name', batchName); else form.append('batchId', batchId);
        form.append('expectedTotal', String(files.length));
        form.append('finalize', isFinalChunk ? 'true' : 'false');
        const identity = window.recruitmentCurrentUser || {};
        form.append('operator', identity.name || ''); form.append('operatorUserId', identity.id || ''); form.append('suppressGroupPush', suppressGroupPush ? 'true' : 'false');
        const started = await request('api/resumes/batch-upload', { method: 'POST', body: form, timeoutMs: 120000 });
        batchId = started.batchId;
        state.resumeBatchId = batchId;
        const uploadedCount = Math.min((index + 1) * 20, files.length);
        const statusText = isFinalChunk
          ? '原始文件上传完成，后台解析已启动'
          : `原始文件上传中 ${uploadedCount}/${files.length}（第${index + 1}/${chunks.length}组）`;
        if (index === 0) showResumeBatchQueuedDialog(batchName, files.length, statusText);
        else {
          const statusNode = document.querySelector('[data-rf-batch-queued-status]');
          if (statusNode?.isConnected) statusNode.textContent = statusText;
          else if (!isFinalChunk) notifyUser(statusText, 'info');
        }
      }
      notifyUser('原始文件上传完成，后台解析已开始。', 'success');
      setTimeout(() => { void pollResumeBatch(batchId, '', true, { background: true }); }, 1200);
    } catch (error) {
      const errorText = error.message || '批量上传创建失败';
      if (message?.isConnected) {
        message.textContent = errorText;
        message.classList.add('error');
        button.disabled = false;
      } else {
        if (batchId) {
          notifyUser(
            `批量文件传输中断：${errorText}。批次已创建但文件未全部上传，请查看批次明细。`,
            'error',
            () => openResumeBatchDetail(batchId),
            '查看批次',
          );
        } else {
          notifyUser(`批量上传创建失败：${errorText}`, 'error');
        }
      }
    }
  }

  async function pollResumeBatch(batchId, jobId = '', isFinalBatch = true, options = {}) {
    const background = options.background === true;
    let consecutiveErrors = 0;
    // 分批上传期间弹窗会被进度渲染反复替换，不能用弹窗 DOM 或当前 batchId 作为循环退出条件。
    while (true) {
      try {
        const detail = await request(`api/resumes/batches/${encodeURIComponent(batchId)}`);
        // 批量进度以 Teable 中的批次主表和批次项为唯一事实来源。
        // JobRegistry 是进程内状态，重启或多实例时可能丢失，不能覆盖持久化进度。
        consecutiveErrors = 0;
        const finished = ['已完成', '部分失败', '全部失败'].includes(detail.status);
        if (finished) {
          state.resumeBatchConfirmItems = [...state.resumeBatchConfirmItems, ...(detail.items || []).filter((item) => item.status === '已完成' && item.candidateId && item.resumeId)];
        }
        renderResumeBatchProgress(detail, !background || state.resumeBatchDialogOpen !== false);
        if (finished) {
          if (background) {
            const failedCount = Number(detail.failed || 0);
            notifyUser(
              `批量解析完成：成功${Number(detail.succeeded || 0)}份，失败${failedCount}份，AI评分已自动开始。`,
              failedCount ? 'info' : 'success',
              failedCount ? () => openResumeBatchDetail(detail.id) : undefined,
              '查看失败明细',
            );
          }
          void loadResumeBatchHistory();
          return detail;
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
      } catch (error) {
        consecutiveErrors += 1;
        // 后台重启或短暂网关抖动时继续等，不把正在运行的批次页面冻结在旧进度。
        if (consecutiveErrors === 1 || consecutiveErrors % 5 === 0) notifyUser(`批量进度暂时读取失败，正在自动重试（第${consecutiveErrors}次）。`, 'info');
        await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, 1_500 * consecutiveErrors)));
      }
    }
  }

  function renderResumeBatchProgress(detail, render = true) {
    const offerMode = document.getElementById('page-offers')?.classList.contains('active') === true;
    const processed = Number(detail.succeeded || 0) + Number(detail.failed || 0), uploaded = Number(detail.uploaded || 0), total = Number(detail.total || 0), uploadingPhase = ['待处理', '上传中'].includes(detail.status) && uploaded < total;
    const percent = total ? Math.round((uploadingPhase ? uploaded : processed) / total * 100) : 0;
    const progressLabel = uploadingPhase ? `上传中 ${uploaded}/${total}` : `解析中 ${processed}/${total}`;
    const retryable = Number(detail.retryable || 0), needsReupload = Number(detail.needsReupload || 0);
    const failedItems = (detail.items || []).filter((item) => item.status === '失败');
    const orderedItems = [...failedItems, ...(detail.items || []).filter((item) => item.status !== '失败')];
    const recoveryNote = needsReupload ? `<p class="rf-batch-recovery-note">其中 ${needsReupload} 份在任务中断前尚未保存原文件，需要重新上传；${retryable ? `${retryable} 份已保留，可直接重试。` : ''}</p>` : '';
    const jobError = detail.jobError ? `<p class="rf-dialog-message error">后台任务错误：${escapeHtml(detail.jobError)}</p>` : detail.jobProgress ? `<p class="rf-dialog-message">${escapeHtml(detail.jobProgress)}</p>` : '';
    const successfulItems = state.resumeBatchConfirmItems;
    const failureSummary = failedItems.length ? `<section class="rf-batch-failure-summary" aria-label="失败明细"><header><strong>失败明细</strong><span>${failedItems.length} 份待处理</span></header><p>失败文件已置顶，可查看具体原因后统一重试；原文件未保留的文件需重新上传。</p></section>` : '';
    const itemHtml = (item) => `<article class="${item.status === '失败' ? 'failed' : item.status === '已完成' ? 'done' : ''}"><b>${Number(item.sequence)}</b><div><strong>${escapeHtml(item.fileName)}</strong><small>${formatBytes(Number(item.fileSize || 0))} · 尝试 ${Number(item.attempts || 0)} 次${item.sourceUrl ? ' · 原文件已保留' : ' · 原文件未保留'}${item.candidateId ? ` · 人才ID ${escapeHtml(item.candidateId)}` : ''}</small>${item.error ? `<p>${escapeHtml(item.error)}</p>` : ''}</div><span>${escapeHtml(item.status)}</span></article>`;
    if (render !== false && state.resumeBatchDialogOpen !== false) {
      state.resumeBatchDialogOpen = true;
      if (!offerMode && state.resumeBatchId === detail.id) {
        showTalentDialog(`<header class="rf-dialog-head"><div><span>BATCH IMPORT RESULT</span><h2>批量导入结果</h2><p>${escapeHtml(detail.name || detail.id)} · ${escapeHtml(detail.status)}${detail.creator ? ` · 上传人：${escapeHtml(detail.creator)}` : ''}</p></div><a class="btn-soft" href="${escapeHtml(apiUrl(`api/resumes/batches/${detail.id}/export`))}" target="_blank" rel="noopener">导出CSV</a></header><div class="rf-review-metrics rf-batch-metrics"><article><span>总文件</span><strong>${total}</strong></article><article><span>已成功</span><strong>${Number(detail.succeeded || 0)}</strong></article><article class="warn"><span>失败</span><strong>${Number(detail.failed || 0)}</strong></article><article><span>${uploadingPhase ? '已上传' : '处理中'}</span><strong>${uploadingPhase ? uploaded : Number(detail.running || 0)}</strong></article></div><div class="rf-batch-progress"><div><i style="width:${percent}%"></i></div><span>${percent}% · ${progressLabel}</span></div>${jobError}${recoveryNote}${failureSummary}<div class="rf-batch-result-list">${orderedItems.map(itemHtml).join('')}</div><div class="rf-dialog-actions">${retryable ? `<button class="btn-soft" data-rf-batch-retry type="button">重试 ${retryable} 份已保留文件</button>` : ''}${successfulItems.length ? '<button class="btn-primary" data-rf-batch-continue type="button">选择岗位并修正AI分析</button>' : ''}<button class="btn-soft" data-rf-batch-finish type="button">返回人才库</button></div><p class="rf-dialog-message" id="rf-batch-retry-message"></p>`, 'wide');
      }
      document.querySelector('#rf-talent-dialog .rf-dialog-close')?.addEventListener('click', () => { state.resumeBatchDialogOpen = false; });
    }
    document.querySelector('[data-rf-batch-retry]')?.addEventListener('click', () => retryResumeBatch(detail.id));
    document.querySelector('[data-rf-batch-continue]')?.addEventListener('click', () => openResumePositionConfirm(successfulItems));
    document.querySelector('[data-rf-batch-finish]')?.addEventListener('click', () => { state.resumeBatchId = ''; closeTalentDialog(); window.setPage?.('resume-archive'); loadTalentArchive(); });
  }

  async function retryResumeBatch(batchId) {
    const message = document.getElementById('rf-batch-retry-message'), button = document.querySelector('[data-rf-batch-retry]');
    try {
      button.disabled = true; message.textContent = '正在重新处理失败文件…';
      await request(`api/resumes/batches/${encodeURIComponent(batchId)}/retry`, { method: 'POST' });
      state.resumeBatchId = batchId;
      await pollResumeBatch(batchId);
    } catch (error) { message.textContent = error.message || '失败文件重试未启动'; message.classList.add('error'); button.disabled = false; }
  }

  function showResult(item, surface = 'page') {
    const analysis = item.analysis || {};
    const scores = analysis.scores || {};
    const matches = item.matches || [];
    document.getElementById('rf-result').innerHTML = `
      <div class="rf-result-head"><div><span>PARSED PROFILE</span><h2>${escapeHtml(item.name || '未识别姓名')}</h2><p>${item.duplicate ? '已识别为现有人才并合并新简历' : '已建立人才主档'} · 基础信息已入库，可在人才档案中按需生成人才画像与岗位匹配</p></div><button class="btn-primary" id="rf-open-archive">进入人才档案</button></div>
      ${analysis.summary ? `<section class="rf-parse-ai-preview"><div><span>AI 人才摘要</span><strong>${escapeHtml(analysis.summary)}</strong><small>${escapeHtml(analysis.confidence || '低')}置信度 · 不自动淘汰候选人</small></div><div class="rf-parse-score-row">${[['业务', scores.business], ['管理', scores.management], ['逻辑', scores.logic], ['沟通', scores.communication]].map(([label, value]) => `<article><span>${label}</span><strong>${Number(value || 0)}</strong></article>`).join('')}</div>${matches.length ? `<div class="rf-parse-matches"><span>推荐岗位</span>${matches.map((match) => `<b>${escapeHtml(match.positionName)} · ${Number(match.score || 0)}分</b>`).join('')}</div>` : ''}</section>` : ''}
      <details class="rf-parse-fields"><summary>查看结构化简历字段</summary><div class="rf-result-grid">${fields(item).slice(0, 12).map(([label, value]) => fieldHtml(label, value)).join('')}</div></details>`;
    document.getElementById('rf-open-archive').addEventListener('click', () => {
      state.activeId = item.candidateId || item.id;
      if (surface === 'dialog') closeTalentDialog();
      window.setPage?.('resume-archive');
      loadTalentArchive();
    });
  }

  function fields(item) {
    // 只展示招聘人员需要核对的结构化信息。OCR 原文仍保留在服务端，
    // 供解析、去重、AI 分析及图片转 Word 使用，但不作为人才档案字段暴露。
    return [['姓名', item.name], ['年龄', item.age], ['电话', item.phone], ['邮箱', item.email], ['微信', item.wechat], ['地址', item.address], ['求职意向', item.jobIntention], ['工作年限', item.yearsOfExperience], ['自我评价', item.selfEvaluation], ['技能证书', item.skillsCertificates], ['教育背景', item.educationBackground], ['工作经历', item.workExperience], ['源文件名', item.sourceFileName], ['源文件地址', item.sourceFileUrl]];
  }

  function fieldHtml(label, value) {
    return `<div class="rf-field"><span>${escapeHtml(label)}</span><div>${escapeHtml(value ?? '') || '—'}</div></div>`;
  }

  function legacyRows() {
    return (window.resumeFlowLegacyTalents || []).map((item) => ({
      id: `legacy-${item.id}`,
      originalId: item.id,
      sourceKind: 'legacy',
      name: item.name,
      age: item.age === '-' ? null : item.age,
      gender: item.gender,
      phone: '',
      email: '',
      wechat: '',
      address: '',
      jobIntention: item.tags?.[0] || '',
      yearsOfExperience: item.experience === '-' ? '' : item.experience,
      selfEvaluation: '',
      skillsCertificates: (item.tags || []).join('、'),
      educationBackground: item.degree === '-' ? '' : item.degree,
      workExperience: '',
      sourceFileName: '',
      sourceFileUrl: '',
      rawText: '',
      company: item.company,
      status: item.status,
      group: item.group,
      owner: item.owner,
      latest: item.latest,
      createdTime: item.reserveTime,
    }));
  }

  function archiveRows() {
    const parsed = state.resumes.map((item) => ({ ...item, sourceKind: 'parsed' }));
    // 不论来自新解析简历还是历史人才库，人才档案统一按首次入库时间倒序。
    // 时间缺失的历史档案置后，避免它们因为字符串比较被排到最新记录之前。
    return [...parsed, ...legacyRows()].sort((left, right) => {
      const leftTime = Date.parse(String(left.createdTime || '')) || 0;
      const rightTime = Date.parse(String(right.createdTime || '')) || 0;
      return rightTime - leftTime
        || String(right.createdTime || '').localeCompare(String(left.createdTime || ''))
        || String(right.id || '').localeCompare(String(left.id || ''));
    });
  }

  async function loadArchive(showLoading = true) {
    const root = document.getElementById('resumeflow-archive-root');
    if (!root) return;
    if (talentDialogStack.length) {
      talentDialogStack.forEach((item) => item.remove());
      talentDialogStack = [];
      document.getElementById('rf-talent-dialog')?.remove();
    }
    if (showLoading) root.innerHTML = `<div class="rf-archive-loading">正在加载人才档案…</div>`;
    try {
      state.resumes = (await request('api/resumes')).resumes || [];
      renderArchive();
    } catch (error) {
      state.resumes = [];
      renderArchive();
      root.insertAdjacentHTML('afterbegin', `<div class="rf-inline-warning">已显示系统原有档案；解析档案暂时无法读取：${escapeHtml(conciseError(error))}</div>`);
    }
  }

  function renderArchive(filter = '') {
    const root = document.getElementById('resumeflow-archive-root');
    if (!root) return;
    const all = archiveRows();
    const keyword = filter.trim().toLowerCase();
    const rows = all.filter((item) => [item.name, item.phone, item.email, item.jobIntention, item.sourceFileName, item.company, item.skillsCertificates].join('|').toLowerCase().includes(keyword));
    if (!rows.some((item) => item.id === state.activeId)) state.activeId = rows[0]?.id || '';
    const active = rows.find((item) => item.id === state.activeId) || null;
    root.innerHTML = `
      <header class="rf-archive-head">
        <div><div class="rf-kicker">TALENT ARCHIVE</div><h1>人才档案</h1><p>集中查看、检索和核对所有候选人信息</p></div>
        <div class="rf-archive-tools"><label><span>⌕</span><input id="rf-search" placeholder="搜索姓名、职位或联系方式" value="${escapeHtml(filter)}"></label><strong>${rows.length}<small>份简历</small></strong></div>
      </header>
      <div class="rf-archive-shell">
        <aside class="rf-archive-list">
          <div class="rf-list-title"><span>最近入库</span><button id="rf-refresh" type="button">刷新</button></div>
          <div class="rf-candidate-list">${rows.length ? rows.map((item) => candidateRow(item, item.id === state.activeId)).join('') : '<div class="rf-list-empty">暂无匹配的人才档案</div>'}</div>
        </aside>
        <main class="rf-profile">${active ? detailHtml(active) : '<div class="rf-profile-empty">请先上传并解析简历，或清除搜索条件。</div>'}</main>
      </div>`;
    document.getElementById('rf-search').addEventListener('input', (event) => renderArchive(event.target.value));
    document.getElementById('rf-refresh').addEventListener('click', () => loadArchive());
    root.querySelectorAll('[data-rf-view]').forEach((button) => button.addEventListener('click', () => { state.activeId = button.dataset.rfView; renderArchive(filter); }));
    root.querySelector('[data-rf-delete]')?.addEventListener('click', (event) => deleteResume(event.currentTarget.dataset.rfDelete, event.currentTarget));
    root.querySelectorAll('[data-rf-word]').forEach((button) => button.addEventListener('click', () => convertResumeToWord(button.dataset.rfWord, button.dataset.force === 'true')));
    root.querySelectorAll('[data-rf-review-resume]').forEach((button) => button.addEventListener('click', () => openResumeReview(button.dataset.rfReviewResume, active, 'archive')));
    root.querySelector('[data-rf-resume-versions]')?.addEventListener('click', (event) => openResumeVersions(event.currentTarget.dataset.rfResumeVersions));
  }

  function candidateRow(item, active) {
    const initial = (item.name || '候').trim().slice(0, 1);
    const summary = item.jobIntention || item.company || item.skillsCertificates || '岗位信息待补充';
    return `<button class="rf-candidate ${active ? 'active' : ''}" data-rf-view="${escapeHtml(item.id)}" type="button">
      <span class="rf-candidate-avatar">${escapeHtml(initial)}</span>
      <span class="rf-candidate-copy"><strong>${escapeHtml(item.name || '未识别姓名')}</strong><small>${escapeHtml(summary)}${item.yearsOfExperience ? ` · ${escapeHtml(item.yearsOfExperience)}` : ''}</small><em>${item.sourceKind === 'parsed' ? '简历解析' : escapeHtml(item.group || '系统档案')}</em></span>
      <span class="rf-candidate-arrow">›</span>
    </button>`;
  }

  function detailSection(title, content) {
    return `<section class="rf-profile-section"><h3>${escapeHtml(title)}</h3>${content ? `<div class="rf-section-copy">${escapeHtml(content)}</div>` : '<div class="rf-section-empty">暂无记录</div>'}</section>`;
  }

  function sectionFromRawText(rawText, headings) {
    const content = resumeSectionText(rawText, headings);
    return content || (rawText ? '' : '');
  }

  function resumeSectionText(rawText, headings) {
    const text = String(rawText || '').replace(/\r\n?/g, '\n');
    for (const heading of headings) {
      const pattern = new RegExp(`(?:^|\\n)\\s*(?:${heading})\\s*[:：]?\\s*(?=\\n|$)`, 'i');
      const match = pattern.exec(text);
      if (!match) continue;
      const start = match.index + match[0].length;
      const next = text.slice(start).search(/\n\s*(?:教育经历|教育背景|工作经历|工作经验|项目经历|项目经验|技能特长|技能与证书|自我评价)\s*[:：]?\s*(?=\n|$)/i);
      const value = (next >= 0 ? text.slice(start, start + next) : text.slice(start)).trim();
      if (value) return value;
    }
    return '';
  }

  function isImageResume(item) {
    return /\.(?:jpe?g|png|webp|bmp|gif|tiff?)$/i.test(item?.sourceFileName || '');
  }

  function profileAvatar(item, className = 'rf-profile-avatar') {
    const initial = (item?.name || '候').trim().slice(0, 1);
    const avatarUrl = String(item?.avatarUrl || '').trim();
    if (className === 'rf-candidate-avatar') {
      return `<span class="${className}">${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(item?.name || '候选人')}头像">` : escapeHtml(initial)}</span>`;
    }
    return `<button type="button" class="${className}" data-rf-avatar-preview="${escapeHtml(avatarUrl)}" aria-label="查看头像大图">${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(item?.name || '候选人')}头像">` : escapeHtml(initial)}</button>`;
  }

  function resumeWarningsHtml(item) {
    const warnings = Array.isArray(item.qualityWarnings) ? item.qualityWarnings.filter(value => typeof value === 'string' && value.trim()) : [];
    if (!warnings.length) return '';
    const reviewed = ['已修正', '已确认'].includes(item.resumeReviewStatus || item.reviewStatus);
    return `<section class="rf-resume-quality" role="status"><strong>${reviewed ? '解析提示 · 已人工复核' : '解析结果有待核对项'}</strong><p>以下内容不能仅凭自动识别结果判断，请对照原始简历，在「复核简历字段」中确认或修正。</p><ul>${warnings.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>`;
  }

  function detailHtml(item) {
    const initial = (item.name || '候').trim().slice(0, 1);
    const chips = [item.age ? `${item.age} 岁` : '', item.yearsOfExperience || '', item.educationBackground || ''].filter(Boolean);
    const contact = [item.phone, item.email, item.wechat ? `微信 ${item.wechat}` : '', item.address].filter(Boolean);
    const isParsed = item.sourceKind === 'parsed';
    return `
      <div class="rf-profile-top">
        <div class="rf-profile-identity">${profileAvatar(item)}<div><div class="rf-profile-name"><h2>${escapeHtml(item.name || '未识别姓名')}</h2>${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')}</div><strong>${escapeHtml(item.jobIntention || item.company || '求职意向待补充')}</strong><p>${contact.length ? contact.map(escapeHtml).join(' · ') : '联系方式待补充'}</p></div></div>
        <div class="rf-profile-actions">${item.sourceFileUrl ? `<a href="${escapeHtml(item.sourceFileUrl)}" target="_blank" rel="noopener">原始文件 ↗</a>` : '<button type="button" disabled>无原始文件</button>'}${item.editableWordUrl ? `<a href="${escapeHtml(item.editableWordUrl)}" target="_blank" rel="noopener">可编辑Word ↗</a>` : ''}${isParsed && item.candidateId ? `<button data-rf-resume-versions="${escapeHtml(item.candidateId)}" type="button">附件版本</button>` : ''}${isParsed ? `<button data-rf-review-resume="${escapeHtml(item.id)}" type="button">${item.reviewStatus === '待复核' || !item.reviewStatus ? '人工复核字段' : '查看/再次复核'}</button>` : ''}${isParsed && isImageResume(item) ? `<button data-rf-word="${escapeHtml(item.id)}" data-force="${item.editableWordUrl ? 'true' : 'false'}" type="button">${item.wordConversionStatus === '转换失败' ? '重试Word转换' : item.editableWordUrl ? '重新生成Word' : '生成可编辑Word'}</button>` : ''}${isParsed ? `<button class="danger" data-rf-delete="${escapeHtml(item.id)}" type="button">删除</button>` : ''}</div>
      </div>
      ${isParsed ? `<section class="rf-resume-review-status ${item.reviewStatus === '已修正' ? 'corrected' : ''}"><div><span>字段人工复核</span><strong>${escapeHtml(item.reviewStatus || '待复核')}</strong><small>${item.correctionSummary ? '已保存字段修正依据和审计记录' : '请对照原始简历核对结构化字段'}</small></div><button type="button" data-rf-review-resume="${escapeHtml(item.id)}">开始复核</button></section>` : ''}
      ${isImageResume(item) ? `<section class="rf-word-status ${item.wordConversionStatus === '转换失败' ? 'failed' : ''}"><div><span>图片简历转Word</span><strong>${escapeHtml(item.wordConversionStatus || '尚未生成')}</strong><small>${item.editableWordUrl ? `版本 ${Number(item.wordConversionVersion || 1)} · ${escapeHtml(item.wordConvertedAt || '')}` : escapeHtml(item.wordConversionError || 'OCR文字将整理为可编辑DOCX，生成后仍需人工核对。')}</small></div>${item.editableWordUrl ? `<a href="${escapeHtml(item.editableWordUrl)}" target="_blank" rel="noopener">下载 ${escapeHtml(item.editableWordFileName || '可编辑简历.docx')}</a>` : ''}</section>` : ''}
      ${resumeWarningsHtml(item)}
      <div class="rf-profile-grid">
        ${detailSection('教育背景', item.educationBackground)}
        ${detailSection('技能与证书', item.skillsCertificates)}
      </div>
      ${detailSection('工作经历', item.workExperience || (item.company && item.company !== '待补充' ? `最近公司：${item.company}` : ''))}
      ${detailSection('自我评价', item.selfEvaluation)}
      <div class="rf-profile-meta">档案来源：${isParsed ? '简历解析' : escapeHtml(item.group || '系统原有人才档案')}${item.createdTime ? ` · 入库时间 ${escapeHtml(item.createdTime)}` : ''}</div>`;
  }

  async function deleteResume(id, button) {
    const item = state.resumes.find((row) => row.id === id);
    if (!id) { notifyUser('未找到要删除的简历记录。', 'error'); return; }
    if (!window.confirm(`确认删除“${item?.name || '该候选人'}”的当前简历？\n如果还有其他简历版本，系统会自动切换；如果没有其他简历，该人才将从人才库隐藏。`)) return;
    try {
      const result = await request(`api/resumes/${encodeURIComponent(id)}`, { method: 'DELETE', initiator: button });
      state.activeId = '';
      await loadArchive();
      notifyUser(result?.candidateStatus === '保留人才' ? '简历已删除，已切换到其他简历版本。' : '简历已删除，该人才已从人才库隐藏。', 'success');
    } catch (error) {
      notifyUser(error.message || '操作失败', 'error');
    }
  }

  async function archiveTalent(candidateId) {
    const talent = state.talentDetails[candidateId] || state.talents.find((row) => row.id === candidateId);
    if (!candidateId || !talent) return;
    const reason = window.prompt(`确认删除“${talent.name || '该人才'}”的人才档案？\n请在删除原因中写明判断依据；删除后档案将从人才库隐藏。`, '人工确认删除人才档案');
    if (!reason) return;
    try {
      await request(`api/talents/${encodeURIComponent(candidateId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: '删除', reason, operator: '当前用户' }) });
      state.activeId = '';
      delete state.talentDetails[candidateId];
      closeTalentDialog();
      await loadTalentArchive(false);
      notifyUser('人才档案已删除。', 'success');
    } catch (error) {
      notifyUser(error.message || '删除失败', 'error');
    }
  }

  async function deleteTalentResume(resumeId, candidateId, button) {
    const resolvedCandidateId = candidateId || state.activeId;
    const talent = state.talentDetails[resolvedCandidateId] || state.talents.find((row) => row.id === resolvedCandidateId);
    if (!resumeId) { notifyUser('未找到要删除的简历记录。', 'error'); return; }
    if (!resolvedCandidateId) { notifyUser('未找到该简历对应的人才档案，请刷新页面后重试。', 'error'); return; }
    if (!window.confirm(`确认删除“${talent?.name || '该候选人'}”的当前简历？\n如果还有其他简历版本，将自动切换到最近的版本；如果没有其他简历，该人才将从人才库隐藏。`)) return;
    try {
      const result = await request(`api/resumes/${encodeURIComponent(resumeId)}`, { method: 'DELETE', initiator: button });
      delete state.talentDetails[resolvedCandidateId];
      if (result?.candidateStatus === '已从人才库隐藏') {
        state.activeId = '';
        closeTalentDialog(false);
        await loadTalentArchive(false);
        notifyUser('简历已删除，该人才已从人才库隐藏。', 'success');
        return;
      }
      state.activeId = resolvedCandidateId;
      await loadTalentArchive(false);
      state.activeId = resolvedCandidateId;
      await loadTalentDetail(resolvedCandidateId, false);
      notifyUser('简历已删除，已自动切换到最近的简历版本。', 'success');
    } catch (error) {
      notifyUser(error.message || '删除失败', 'error');
    }
  }

  async function convertResumeToWord(id, force = false) {
    if (force && !window.confirm('重新生成会创建新的Word版本并更新下载地址，确认继续？')) return;
    try {
      notifyUser(force ? '正在重新生成可编辑Word…' : '正在生成可编辑Word…', 'info');
      const converted = await request(`api/resumes/${encodeURIComponent(id)}/convert-to-word`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force, operator: '当前用户' }) });
      const index = state.resumes.findIndex((item) => item.id === id);
      if (index >= 0) state.resumes[index] = converted;
      renderArchive(document.getElementById('rf-search')?.value || '');
      notifyUser('可编辑Word已生成，可直接下载并人工修改。', 'success');
    } catch (error) { notifyUser(error.message || '可编辑Word生成失败', 'error', () => convertResumeToWord(id, force)); }
  }

  async function reparseTalentResume(resumeId) {
    if (!resumeId) { notifyUser('该人才没有可重新识别的当前简历。', 'error'); return; }
    const loading = showGlobalLoading('正在重新识别当前简历…');
    try {
      loading('正在读取原始文件并执行 OCR…');
      const started = await request(`api/resumes/${encodeURIComponent(resumeId)}/reparse`, { method: 'POST' });
      if (!started?.jobId) throw new Error('重新识别任务未启动');
      await waitForBackgroundJob(started.jobId, loading, { timeoutMessage: '重新识别仍在后台处理，请稍后刷新查看结果，勿重复发起。' });
      hideGlobalLoading();
      if (state.activeId) await loadTalentDetail(state.activeId, false);
      await loadTalentArchive(false);
      notifyUser('简历已重新识别完成，请核对姓名和基础字段。', 'success');
    } catch (error) {
      hideGlobalLoading();
      setTalentMessage(error.message || '重新识别失败', true);
      notifyUser(error.message || '重新识别失败', 'error', () => reparseTalentResume(resumeId));
    }
  }

  function openTalentNameDialog(candidateId) {
    if (!candidateId) {
      notifyUser('该人才没有可修改的名称。', 'error');
      return;
    }

    const talent = state.talentDetails[candidateId]
      || state.talents.find((item) => item.id === candidateId)
      || {};
    const currentName = talent.name || '';

    showTalentDialog(`
      <header class="rf-dialog-head">
        <div>
          <span>TALENT NAME</span>
          <h2>修改人才名称</h2>
          <p>用于人才档案、招聘流程和消息展示；不会修改原始简历文件名。</p>
        </div>
      </header>
      <div class="rf-dialog-form">
        <label class="wide">
          <span>人才姓名 <b>*</b></span>
          <input id="rf-talent-name" maxlength="50" value="${escapeHtml(currentName)}" placeholder="例如：林悦"><small class="rf-schedule-error" hidden></small>
        </label>
      </div>
      <div class="rf-dialog-actions">
        <button class="btn-primary" data-rf-submit-talent-name type="button">保存人才名称</button>
      </div>
      <p class="rf-dialog-message" id="rf-talent-name-message"></p>
    `, 'wide');

    const input = document.getElementById('rf-talent-name');
    document.querySelector('[data-rf-submit-talent-name]')
      ?.addEventListener('click', () => submitTalentName(candidateId));
    input?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submitTalentName(candidateId);
    });
  }

  async function submitTalentName(candidateId) {
    const input = document.getElementById('rf-talent-name');
    const message = document.getElementById('rf-talent-name-message');
    const name = String(input?.value || '').trim();

    markScheduleField(input, name ? '' : '请填写人才姓名');
    if (!name) { input?.focus(); return; }

    try {
      message.textContent = '正在保存人才名称并同步档案…';
      message.classList.remove('error');

      const result = await request(`api/talents/${encodeURIComponent(candidateId)}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      let detail = result.talent;
      if (!detail) {
        await loadTalentDetail(candidateId, false);
        detail = state.talentDetails[candidateId];
      }
      if (detail) {
        state.talentDetails[candidateId] = detail;
        closeTalentDialog(false);
        showTalentDialog(`<div class="rf-full-detail-dialog">${talentDetailHtml(detail)}</div>`, 'full');
        bindTalentArchive();
      } else {
        closeTalentDialog(false);
      }

      notifyUser(`人才名称已更新：${result.name || name}`, 'success');
    } catch (error) {
      message.textContent = error.message || '人才名称保存失败';
      message.classList.add('error');
    }
  }

  async function convertTalentResumeToWord(resumeId, force = false) {
    if (force && !window.confirm('重新生成会创建新的Word版本并更新人才档案下载地址，确认继续？')) return;
    try {
      setTalentMessage(force ? '正在重新生成可编辑Word…' : '正在把图片简历生成可编辑Word…');
      const converted = await request(`api/resumes/${encodeURIComponent(resumeId)}/convert-to-word`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force, operator: '当前用户' }) });
      if (state.activeId) {
        const current = state.talentDetails[state.activeId] || {};
        state.talentDetails[state.activeId] = { ...current, ...converted, latestResumeId: current.latestResumeId || resumeId };
      }
      await loadTalentDetail(state.activeId);
      setTalentMessage('可编辑Word已生成，可从档案顶部下载。');
      notifyUser('图片简历已转换为可编辑Word。', 'success');
    } catch (error) { setTalentMessage(error.message || '可编辑Word生成失败', true); notifyUser(error.message || '可编辑Word生成失败', 'error', () => convertTalentResumeToWord(resumeId, force)); }
  }

  const resumeReviewFields = [
    ['name', '姓名', 'input'], ['age', '出生年月日', 'date'], ['phone', '电话', 'input'], ['email', '邮箱', 'input'],
    ['wechat', '微信', 'input'], ['address', '所在地', 'input'], ['gender', '性别', 'select'], ['yearsOfExperience', '工作年限', 'input'],
    ['educationBackground', '教育背景', 'textarea'], ['skillsCertificates', '技能与证书', 'textarea'], ['workExperience', '工作经历', 'textarea'], ['selfEvaluation', '自我评价', 'textarea'],
    ['jobIntention', '求职意向', 'input'], ['currentCompany', '当前公司', 'input'], ['currentRole', '当前职位', 'input'],
  ];

  function openResumeReview(resumeId, item = {}, context = 'archive') {
    if (state.activeId && context === 'talent') item = state.talentDetails[state.activeId] || item;
    const fields = resumeReviewFields.map(([key, label, type]) => {
      const value = item[key] ?? '', masked = /\*/.test(String(value));
      let control;
      if (type === 'select') {
        control = `<select id="rf-review-${key}" data-review-key="${key}" ${masked ? 'disabled' : ''}>${['', '男', '女'].map((option) => `<option value="${escapeHtml(option)}" ${String(value) === option ? 'selected' : ''}>${escapeHtml(option || '请选择')}</option>`).join('')}</select>`;
      } else if (type === 'textarea') {
        control = `<textarea id="rf-review-${key}" data-review-key="${key}" ${masked ? 'disabled' : ''}>${escapeHtml(value)}</textarea>`;
      } else {
        control = `<input id="rf-review-${key}" data-review-key="${key}" type="${type}" value="${escapeHtml(value)}" ${masked ? 'disabled' : ''}>`;
      }
      return `<label class="${type === 'textarea' ? 'wide' : ''}"><span>${escapeHtml(label)}${masked ? '（当前权限下不可修改）' : ''}</span>${control}</label>`;
    }).join('');
    showTalentDialog(`<header class="rf-dialog-head"><div><span>RESUME FIELD REVIEW</span><h2>人工复核简历字段</h2><p>请逐项对照原始简历核对结构化字段。系统只修改已展示的字段，原始文件会始终保留。</p></div></header><div class="rf-dialog-form rf-resume-review-form">${fields}</div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-submit-resume-review type="button">保存人工复核</button></div><p class="rf-dialog-message" id="rf-review-message"></p>`, 'wide');
    document.querySelector('[data-rf-submit-resume-review]')?.addEventListener('click', () => submitResumeReview(resumeId, context));
  }

  async function submitResumeReview(resumeId, context) {
    const message = document.getElementById('rf-review-message');
    const fields = {};
    document.querySelectorAll('[data-review-key]:not([disabled])').forEach((node) => {
      if (node.dataset.reviewKey === 'age') {
        fields[node.dataset.reviewKey] = node.value ? Math.floor((Date.now() - new Date(`${node.value}T00:00:00Z`).getTime()) / (365.2425 * 24 * 60 * 60 * 1000)) : '';
      } else {
        fields[node.dataset.reviewKey] = node.value;
      }
    });
    try {
      message.textContent = '正在保存字段差异、人才主档同步和审计记录…'; message.classList.remove('error');
      const result = await request(`api/resumes/${encodeURIComponent(resumeId)}/review`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields, reason: '人工复核确认', operator: '当前用户' }) });
      if (context === 'archive') {
        const index = state.resumes.findIndex((item) => item.id === resumeId);
        if (index >= 0) state.resumes[index] = result.resume;
        closeTalentDialog(); renderArchive(document.getElementById('rf-search')?.value || '');
      } else { closeTalentDialog(); await loadTalentDetail(state.activeId); }
      notifyUser(result.changes?.length ? `已修正${result.changes.length}个字段并同步人才主档` : '字段已人工确认，无需修正', 'success');
    } catch (error) { message.textContent = error.message || '人工复核保存失败'; message.classList.add('error'); }
  }

  async function openResumeVersions(candidateId) {
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取该人才的全部简历附件版本…</div>', 'wide');
    try {
      state.resumeVersionData = await request(`api/resumes/candidates/${encodeURIComponent(candidateId || 'resume_a')}/versions`);
      if (!isTalentDialogCurrent(token)) return;
      renderResumeVersions();
    } catch (error) { dialogFailure('简历版本读取失败', error, () => openResumeVersions(candidateId), token); }
  }

  function renderResumeVersions() {
    const data = state.resumeVersionData || { candidateId: '', total: 0, versions: [] };
    showTalentDialog(`<header class="rf-dialog-head"><div><span>RESUME ATTACHMENT VERSIONS</span><h2>简历附件版本</h2><p>每次上传的新简历都保留独立附件和解析记录；切换当前版本不会删除任何历史文件。</p></div><div class="rf-assessment-head-actions"><b>${Number(data.total || 0)}个版本</b></div></header><div class="rf-resume-version-list">${(data.versions || []).map((version) => `<article class="${version.isCurrent ? 'current' : ''}"><div class="rf-resume-version-number"><span>V${Number(version.version || 0)}</span><small>${version.isCurrent ? '当前使用' : '历史版本'}</small></div><div><strong>${escapeHtml(version.fileName || '未命名简历')}</strong><p>${escapeHtml(version.note || version.source || '简历上传')}</p><small>${escapeHtml(version.createdAt || '')} · ${escapeHtml(version.fileType || '未知格式')} · ${formatBytes(Number(version.fileSize || 0))} · ${escapeHtml(version.reviewStatus || '待复核')}</small></div><aside>${version.fileUrl ? `<a href="${escapeHtml(version.fileUrl)}" target="_blank" rel="noopener">查看附件</a>` : ''}${version.isCurrent ? '<b>当前版本</b>' : `<button type="button" data-resume-version-activate="${escapeHtml(version.id)}">设为当前</button>`}</aside></article>`).join('') || '<div class="rf-dialog-empty"><p>该人才暂无简历版本记录。</p></div>'}</div><div class="rf-version-policy"><strong>版本规则</strong><p>相同指纹重复上传不会新增版本；不同文件按V1、V2顺序保存。切换当前版本必须填写原因并写入审计日志。</p></div>`, 'wide');
    document.querySelectorAll('[data-resume-version-activate]').forEach((button) => button.addEventListener('click', () => openResumeVersionActivation(button.dataset.resumeVersionActivate)));
  }

  function openResumeVersionActivation(versionId) {
    const version = state.resumeVersionData?.versions?.find((item) => item.id === versionId);
    if (!version) return;
    showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-version-back>← 返回版本列表</button><span>ACTIVATE RESUME VERSION</span><h2>将V${Number(version.version)}设为当前简历</h2><p>人才档案和后续人工查看将优先读取该版本，历史版本仍保留。</p></div></header><div class="rf-version-target"><strong>${escapeHtml(version.fileName)}</strong><small>${escapeHtml(version.createdAt || '')} · ${formatBytes(Number(version.fileSize || 0))}</small></div><div class="rf-dialog-form"><label class="wide"><span>切换原因</span><textarea id="rf-version-reason" placeholder="例如：负责人确认应以候选人最新补充的中文简历为准"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-version-confirm type="button">确认切换当前版本</button></div><p class="rf-dialog-message" id="rf-version-message"></p>`, 'wide');
    document.querySelector('[data-version-back]')?.addEventListener('click', renderResumeVersions);
    document.querySelector('[data-version-confirm]')?.addEventListener('click', () => activateResumeVersion(versionId));
  }

  async function activateResumeVersion(versionId) {
    const reason = document.getElementById('rf-version-reason')?.value.trim() || '', message = document.getElementById('rf-version-message');
    if (!reason) { message.textContent = '请填写切换当前简历版本的原因。'; message.classList.add('error'); return; }
    try {
      message.textContent = '正在切换当前版本并保存审计…'; message.classList.remove('error');
      state.resumeVersionData = await request(`api/resumes/versions/${encodeURIComponent(versionId)}/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, operator: '当前用户' }) });
      if (state.activeId) await loadTalentDetail(state.activeId, false);
      renderResumeVersions();
      notifyUser('当前简历版本已切换，历史附件继续保留。', 'success');
    } catch (error) { message.textContent = error.message || '简历版本切换失败'; message.classList.add('error'); }
  }

  function fallbackTalent(item, index) {
    const sourceKind = item.sourceKind || (String(item.id).startsWith('legacy-') ? 'legacy' : 'parsed');
    const candidateId = sourceKind === 'parsed' ? String(item.candidateId || '') : '';
    const skills = String(item.skillsCertificates || '').split(/[、,，；;\n]+/).filter(Boolean);
    const role = item.jobIntention || item.tags?.[0] || item.company || '岗位待匹配';
    const score = Math.max(52, Math.min(92, 66 + skills.length * 3 + (item.workExperience ? 7 : 0)));
    const managementEvidence = /管理|带领|团队|负责人/.test(item.workExperience || '')
      ? '工作经历中包含团队管理或负责人相关描述，建议面试核实实际带队规模。'
      : '简历中暂未发现明确带队规模，需要在面试中确认。';
    return {
      ...item,
      id: candidateId || item.id || `fallback-${index}`,
      candidateId,
      latestResumeId: item.latestResumeId || (sourceKind === 'parsed' ? item.id : ''),
      sourceKind,
      source: sourceKind === 'parsed' ? '简历解析' : item.group || '系统档案',
      status: item.status || 'AI分析中',
      talentPool: item.group || '公司人才库',
      owner: item.owner || '待分配',
      skills,
      tags: skills.map((name) => ({ name, category: '技能标签', source: '原始档案', confidence: 65, evidence: '来自简历技能字段', reviewStatus: '待人工确认' })),
      bestMatchRole: role,
      bestMatchScore: score,
      matches: [{ positionName: role, score, skillScore: score, experienceScore: Math.max(50, score - 3), managementScore: /管理|带领|团队|负责人/.test(item.workExperience || '') ? 70 : 48, businessScore: score, reason: `根据现有技能、经历与求职意向，初步推荐至${role}。`, gaps: '建议由负责人结合岗位必备条件进行人工复核。', confidence: '中', reviewStatus: '待人工确认' }],
      analysis: {
        summary: `${item.name || '该候选人'}当前主要方向为${role}，系统已根据现有简历内容生成初步画像，等待业务群评审。`,
        strengths: skills.length ? [`具备${skills.slice(0, 3).join('、')}等相关能力。`] : ['已有基础人才档案，可继续补充技能和项目结果。'],
        risks: [managementEvidence, '岗位匹配结果为初步建议，不能代替人工招聘判断。'],
        scores: { business: score, management: /管理|带领|团队|负责人/.test(item.workExperience || '') ? 70 : 48, logic: 64, communication: 66, overall: score },
        evidence: { business: item.workExperience || '工作经历待补充。', management: managementEvidence, logic: '需要通过结构化面试问题进一步验证。', communication: '需要通过意向沟通和面试进一步验证。' },
        confidence: item.workExperience ? '中' : '低', reviewStatus: '待人工确认',
      },
      timeline: [{ to: '人才入库', action: sourceKind === 'parsed' ? '简历解析入库' : '历史档案导入', operator: '系统', time: item.createdTime || item.reserveTime || '', source: '系统' }],
    };
  }

  function fallbackTalentRows() {
    const unique = new Map();
    archiveRows().map(fallbackTalent).forEach((item) => {
      const key = item.candidateId || item.id;
      if (!unique.has(key)) unique.set(key, item);
    });
    return [...unique.values()];
  }

  function fallbackJobMap(rows) {
    const grouped = new Map();
    rows.forEach((item) => (item.matches || []).forEach((match) => {
      const current = grouped.get(match.positionName) || { role: match.positionName, count: 0, highScore: 0, total: 0 };
      current.count += 1;
      current.total += Number(match.score || 0);
      if (Number(match.score || 0) >= 80) current.highScore += 1;
      grouped.set(match.positionName, current);
    }));
    return [...grouped.values()].map((item) => ({ ...item, average: Math.round(item.total / item.count) })).sort((a, b) => b.count - a.count);
  }

  function fallbackOverview(rows) {
    return {
      total: rows.length,
      pendingReview: rows.filter((item) => item.analysis?.reviewStatus === '待人工确认').length,
      highMatch: rows.filter((item) => Number(item.bestMatchScore) >= 80).length,
      referral: rows.filter((item) => String(item.source).includes('内推')).length,
      duplicatePending: rows.filter((item) => String(item.duplicateStatus).includes('疑似')).length,
    };
  }

  function filterFallbackTalents(rows) {
    const keyword = state.talentFilters.q.trim().toLowerCase();
    const importer = state.talentFilters.importer.trim().toLowerCase();
    const rangeMatches = (value, filter) => {
      const label = String(filter || '');
      if (!label || label.startsWith('全部')) return true;
      const values = (label.match(/\d+/g) || []).map(Number);
      if (!values.length) return true;
      return label.includes('以上') ? Number(value || 0) >= values[0] : Number(value || 0) >= values[0] && Number(value || 0) <= (values[1] ?? values[0]);
    };
    return rows.filter((item) => {
      const haystack = [item.name, item.phone, item.email, item.wechat, item.company, item.currentCompany, item.currentRole, item.jobIntention, item.address, item.educationBackground, item.skills?.join(' '), item.matches?.map((match) => match.positionName).join(' ')].join('|').toLowerCase();
      const importerHaystack = [item.importedBy, item.referrer].filter(Boolean).join('|').toLowerCase();
      return (!keyword || haystack.includes(keyword))
        && (!importer || importerHaystack.includes(importer))
        && (state.talentFilters.job === '全部岗位' || item.matches?.some((match) => match.positionName === state.talentFilters.job))
        && (state.talentFilters.status === '全部状态' || item.employmentStatus === state.talentFilters.status)
        && (state.talentFilters.source === '全部来源' || item.source === state.talentFilters.source)
        && (state.talentFilters.tag === '全部标签' || item.tags?.some((tag) => tag.name === state.talentFilters.tag))
        && rangeMatches(item.age, state.talentFilters.age)
        && (state.talentFilters.region === '全部地区' || item.address === state.talentFilters.region)
        && rangeMatches(item.bestMatchScore, state.talentFilters.score);
    });
  }

  function setTalentSearchLoading(loading) {
    state.talentSearchLoading = Boolean(loading);
    const button = document.getElementById('rf-search-submit');
    const search = document.getElementById('rf-search');
    const shell = document.querySelector('.rf-talent-shell');
    const list = document.querySelector('.rf-talent-cards');
    const feedback = document.getElementById('rf-talent-search-feedback');
    if (button) {
      button.disabled = state.talentSearchLoading;
      button.classList.toggle('is-loading', state.talentSearchLoading);
      button.innerHTML = state.talentSearchLoading ? '<i class="rf-search-spinner" aria-hidden="true"></i><span>查询中</span>' : '查询';
    }
    search?.setAttribute('aria-busy', String(state.talentSearchLoading));
    shell?.setAttribute('aria-busy', String(state.talentSearchLoading));
    list?.classList.toggle('is-searching', state.talentSearchLoading);
    if (feedback) feedback.hidden = !state.talentSearchLoading;
  }

  const talentListSnapshots = new Map();
  let talentSnapshotRevision = 0;

  function invalidateTalentSnapshots() {
    talentSnapshotRevision += 1;
    talentListSnapshots.clear();
  }

  function applyTalentArchiveResult(result) {
    state.talents = result.talents || [];
    state.talentTotal = Number(result.total ?? state.talents.length);
    state.talentPage = Number(result.page || state.talentPage);
    state.talentPageSize = Number(result.pageSize || state.talentPageSize);
    state.talentTotalPages = Number(result.totalPages || Math.max(1, Math.ceil(state.talentTotal / state.talentPageSize)));
    state.talentOverview = { ...fallbackOverview(state.talents), ...(result.overview || {}) };
    state.jobMap = result.jobMap || fallbackJobMap(state.talents);
    state.archiveMode = 'api';
    state.archiveMessage = '';
    if (!state.talents.some(item => item.id === state.activeId)) state.activeId = '';
    renderTalentArchive();
  }

  async function loadTalentArchive(showLoading = true, force = false) {
    const root = document.getElementById('resumeflow-archive-root');
    if (!root) return;
    if (force) invalidateTalentSnapshots();
    const revision = talentSnapshotRevision;
    const params = new URLSearchParams(Object.entries({ ...state.talentFilters, page: state.talentPage, pageSize: state.talentPageSize }).filter(([, value]) => value && !String(value).startsWith('全部') && value !== '0'));
    const cacheKey = `${accessEpoch}:${window.recruitmentCurrentUser?.id || ''}:${params}`;
    const snapshot = talentListSnapshots.get(cacheKey);
    const reusable = snapshot && Date.now() - snapshot.savedAt < 30000;
    if (reusable) { applyTalentArchiveResult(structuredClone(snapshot.result)); setTalentSearchLoading(true); }
    else if (showLoading) root.innerHTML = `<div class="rf-archive-loading">正在整理人才主档与岗位匹配…</div>`;
    else setTalentSearchLoading(true);
    const sequence = ++state.talentLoadSequence;
    const positionOptionsPromise = loadPositionOptions(force).catch(() => []);
    try {
      if (force) params.set('refresh', '1');
      const result = await request(`api/talents${params.toString() ? `?${params}` : ''}`);
      await positionOptionsPromise;
      if (sequence !== state.talentLoadSequence) return;
      if (revision === talentSnapshotRevision) {
        talentListSnapshots.delete(cacheKey);
        talentListSnapshots.set(cacheKey, { savedAt: Date.now(), result: structuredClone(result) });
        while (talentListSnapshots.size > 8) talentListSnapshots.delete(talentListSnapshots.keys().next().value);
      }
      // 首屏只加载一页轻量人才摘要；完整档案在用户点击某个人才后再读取。
      // 不能因为打开列表而额外加载第一份简历的 OCR、版本和全流程历史。
      if (!reusable || JSON.stringify(snapshot.result) !== JSON.stringify(result)) applyTalentArchiveResult(result);
      void syncStoredAvatarUrlsOnce();
    } catch (error) {
      if (sequence !== state.talentLoadSequence) return;
      if ([401, 403].includes(error.status)) {
        invalidateTalentSnapshots();
        state.talents = [];
        root.innerHTML = `<div class="rf-inline-warning">${escapeHtml(conciseError(error))}</div>`;
        return;
      }
      if (reusable && revision === talentSnapshotRevision) {
        state.archiveMessage = `暂时显示上次查询结果，更新失败：${conciseError(error)}。可点击刷新重试。`;
        renderTalentArchive();
        return;
      }
      try { state.resumes = (await request('api/resumes')).resumes || []; } catch { state.resumes = []; }
      const allFallbackTalents = fallbackTalentRows();
      state.talents = filterFallbackTalents(allFallbackTalents);
      state.talentTotal = state.talents.length; state.talentPage = 1; state.talentTotalPages = 1;
      state.talentOverview = fallbackOverview(allFallbackTalents);
      state.jobMap = fallbackJobMap(allFallbackTalents);
      state.archiveMode = 'fallback';
      state.archiveMessage = `当前显示可用的历史人才档案；统一人才接口暂时无法读取：${conciseError(error)}`;
      if (!state.talents.some((item) => item.id === state.activeId)) state.activeId = '';
      renderTalentArchive();
    } finally {
      if (sequence === state.talentLoadSequence) setTalentSearchLoading(false);
    }
  }

  async function syncStoredAvatarUrlsOnce() {
    const storageKey = 'resumeflow-stored-avatar-backfill-v1';
    if (state.avatarBackfillStarted || state.archiveMode !== 'api' || window.localStorage.getItem('resumeflow-stored-avatar-backfill-v1')) return;
    state.avatarBackfillStarted = true;
    try {
      if (window.localStorage.getItem(storageKey)) return;
      const started = await request('api/talents/avatars/backfill', { method: 'POST' });
      if (!started?.jobId) return;
      for (let attempt = 0; attempt < 180; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const job = await request(`api/jobs/${encodeURIComponent(started.jobId)}`);
        if (job.status === 'done') {
          window.localStorage.setItem(storageKey, new Date().toISOString());
          if (Number(job.data?.synced || 0) > 0) {
            notifyUser(`已补齐 ${Number(job.data.synced)} 位人才的简历头像。`, 'success');
          }
          return;
        }
        if (job.status === 'failed') return;
      }
    } catch {
      // 头像是增强展示；同步失败不会影响人才档案读取或继续上传简历。
    }
  }

  const talentDetailRequests = new Map();
  function fetchTalentDetail(candidateId) {
    if (!talentDetailRequests.has(candidateId)) {
      const pending = request(`api/talents/${encodeURIComponent(candidateId)}`).finally(() => talentDetailRequests.delete(candidateId));
      talentDetailRequests.set(candidateId, pending);
    }
    return talentDetailRequests.get(candidateId);
  }

  async function openTalentDetailDialog(candidateId) {
    const cached = state.talentDetails[candidateId];
    const summary = state.talents.find((item) => item.id === candidateId);
    const token = cached ? null : showTalentDialog(`<section class="rf-dialog-loading">正在加载完整简历…</section>`, 'full');
    state.activeId = candidateId;
    const sequence = ++state.talentDetailLoadSequence;
    try {
      let detail = await fetchTalentDetail(candidateId);
      if (sequence !== state.talentDetailLoadSequence) return;
      if (token !== null && !isTalentDialogCurrent(token)) return;
      state.archiveMode = 'api';
      if (cached) detail = { ...detail, latestResumeId: detail.latestResumeId || summary?.latestResumeId || cached.latestResumeId || '' };
      if (summary?.latestResumeId) detail.latestResumeId = detail.latestResumeId || summary.latestResumeId;
      if (summary?.sourceFileUrl) detail.sourceFileUrl = detail.sourceFileUrl || summary.sourceFileUrl;
      storeTalentDetail(detail);
      renderTalentArchive({ preserveListScroll: true });
      document.querySelectorAll('.rf-dialog-backdrop').forEach((layer) => {
        if (isTalentDialogLoading(layer)) layer.remove();
      });
      talentDialogStack = talentDialogStack.filter((layer) => layer.isConnected && !isTalentDialogLoading(layer));
      showTalentDialog(`<div class="rf-full-detail-dialog">${talentDetailHtml(detail)}</div>`, 'full');
      const dialog = document.getElementById('rf-talent-dialog');
      const shell = dialog?.querySelector('.rf-dialog');
      bindTalentArchive();
      dialog?.querySelectorAll('[data-rf-detail-anchor]').forEach((button) => button.addEventListener('click', () => {
        const target = shell?.querySelector(`#${CSS.escape(button.dataset.rfDetailAnchor)}`);
        if (!shell || !target) return;
        dialog.querySelectorAll('[data-rf-detail-anchor]').forEach((tab) => tab.classList.toggle('active', tab === button));
        shell.scrollTo({ top: target.offsetTop - shell.offsetTop - 58, behavior: 'smooth' });
      }));
      dialog?.querySelector('[data-rf-more-toggle]')?.focus({ preventScroll: true });
    } catch (error) {
      if (sequence !== state.talentDetailLoadSequence) return;
      if (token !== null && !isTalentDialogCurrent(token)) return;
      closeTalentDialog(false);
      showTalentDialog(`<div class="rf-dialog-empty"><strong>简历详情加载失败</strong><p>${escapeHtml(conciseError(error))}</p></div>`);
    }
  }

  async function loadTalentDetail(candidateId, preserveListScroll = true) {
    const selected = state.talents.find((item) => item.id === candidateId);
    // 历史静态档案没有后端候选人 ID，保留其本地摘要即可；
    // 解析简历 fallback 行仍然有 candidateId，需要继续请求统一详情接口。
    if (!candidateId || selected?.sourceKind === 'legacy' || (state.archiveMode === 'fallback' && !selected?.candidateId)) return;
    const sequence = ++state.talentDetailLoadSequence;
    try {
      let detail = await fetchTalentDetail(candidateId);
      if (sequence !== state.talentDetailLoadSequence || state.activeId !== candidateId) return;
      if (selected?.latestResumeId) detail.latestResumeId = detail.latestResumeId || selected.latestResumeId;
      if (selected?.sourceFileUrl) detail.sourceFileUrl = detail.sourceFileUrl || selected.sourceFileUrl;
      const cachedDetail = state.talentDetails[candidateId] || {};
      detail.editableWordUrl = detail.editableWordUrl || cachedDetail.editableWordUrl || '';
      detail.editableWordFileName = detail.editableWordFileName || cachedDetail.editableWordFileName || '';
      detail.editableWordUrl = detail.editableWordUrl || state.talentDetails[candidateId]?.editableWordUrl || '';
      detail.editableWordFileName = detail.editableWordFileName || state.talentDetails[candidateId]?.editableWordFileName || '';
      storeTalentDetail(detail);
      renderTalentArchive({ preserveListScroll });
      if (state.activeId === candidateId && document.getElementById('rf-talent-dialog')?.querySelector('.rf-full-detail-dialog')) {
        showTalentDialog(`<div class="rf-full-detail-dialog">${talentDetailHtml(detail)}</div>`, 'full');
        bindTalentArchive();
        document.querySelector('[data-rf-more-toggle]')?.focus({ preventScroll: true });
      }
    } catch (error) {
      if (sequence !== state.talentDetailLoadSequence || state.activeId !== candidateId) return;
      state.archiveMessage = `人才详情暂时无法刷新：${conciseError(error)}`;
      renderTalentArchive({ preserveListScroll });
    }
  }

  function talentOptions(values, current, allLabel) {
    return [allLabel, ...new Set(values.filter(Boolean))].map((value) => `<option ${value === current ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
  }

  function scoreTone(score) {
    return Number(score) >= 80 ? 'high' : Number(score) >= 65 ? 'medium' : 'low';
  }

  function safeGender(value) {
    return value === '男' || value === '女' ? value : '';
  }

  function storeTalentDetail(detail) {
    const candidateId = detail?.id || detail?.candidateId;
    if (!candidateId) return;
    state.talentDetails[candidateId] = detail;
    const index = state.talents.findIndex((item) => item.id === candidateId);
    if (index < 0) return;
    const summary = state.talents[index];
    state.talents[index] = {
      ...summary,
      tags: Array.isArray(detail.tags) ? detail.tags : summary.tags,
      skills: Array.isArray(detail.skills) ? detail.skills : summary.skills,
      analysis: detail.analysis ?? summary.analysis,
      matches: Array.isArray(detail.matches) ? detail.matches : summary.matches,
      bestMatchScore: detail.bestMatchScore ?? summary.bestMatchScore,
      bestMatchRole: detail.bestMatchRole ?? summary.bestMatchRole,
      updatedTime: detail.updatedTime || summary.updatedTime,
    };
  }

  function renderTalentArchive(options = {}) {
    const root = document.getElementById('resumeflow-archive-root');
    if (!root || !options.closeDialogs && document.querySelector('#rf-talent-dialog .rf-full-detail-dialog')) return;
    const previousListScrollTop = options.preserveListScroll
      ? root.querySelector('.rf-candidate-list')?.scrollTop
      : null;
    const overview = state.talentOverview || fallbackOverview(state.talents);
    const statuses = state.talents.map((item) => item.status);
    const sources = state.talents.map((item) => item.source);
    const tags = state.talents.flatMap((item) => (item.tags || []).map((tag) => tag.name));
    const activeFilterCount = Object.entries(state.talentFilters).filter(([key, value]) => {
      if (!value) return false;
      return key === 'q' ? Boolean(String(value).trim()) : !String(value).startsWith('全部');
    }).length;
    const advancedFilterCount = ['age', 'region', 'score'].filter((key) => {
      const value = state.talentFilters[key];
      return value && !String(value).startsWith('全部');
    }).length;
    const jobFilterValues = state.positionOptions.length
      ? state.positionOptions.map((position) => position.name)
      : state.jobMap.map((item) => item.role);
    root.innerHTML = `
      ${state.archiveMessage ? `<div class="rf-inline-warning">${escapeHtml(state.archiveMessage)}</div>` : ''}
      <header class="page-head rf-talent-page-head">
        <div><h1>人才档案</h1><p>从 AI 匹配到入职的招聘流程工作台</p></div>
        <div class="head-actions rf-talent-head-actions"><button class="btn-primary rf-import-resume" id="rf-import-resume" type="button"><i aria-hidden="true">＋</i>导入简历</button></div>
      </header>
      <section class="rf-talent-filterbar">
        <div class="rf-talent-dashboard-summary" aria-label="当前人才概况">
          <article><strong>${state.talentTotal}</strong><span>人才总数</span></article>
          <article><strong>${overview.pendingReview}</strong><span>待确认</span></article>
          <article><strong>${overview.highMatch}</strong><span>高匹配</span></article>
          <article><strong>${overview.referral}</strong><span>内部推荐</span></article>
          <button data-rf-duplicates type="button"><strong>${overview.duplicatePending}</strong><span>疑似重复</span></button>
        </div>
        <div class="rf-talent-filter-panel">
          <div class="rf-talent-filter-heading">
            <div><strong>筛选人才</strong><span>${activeFilterCount ? `已启用 ${activeFilterCount} 个筛选条件` : '先选择常用条件，再点击查询更新列表'}</span></div>
            <div class="rf-talent-filter-actions"><button class="btn-soft rf-filter-reset" id="rf-reset-filter" type="button">清空筛选</button><button class="btn-soft rf-advanced-filter" id="rf-advanced-filter" type="button" aria-expanded="${state.showTalentAdvancedFilters}" aria-controls="rf-talent-advanced-row"><span>更多筛选</span>${advancedFilterCount ? `<em>${advancedFilterCount}</em>` : ''}<i aria-hidden="true">⌄</i></button></div>
          </div>
          <div class="rf-talent-list-tools" role="search"><label class="rf-list-search"><span class="sr-only">按姓名搜索人才</span><i aria-hidden="true">⌕</i><input id="rf-search" type="search" placeholder="输入候选人姓名" value="${escapeHtml(state.talentSearchDraft)}" aria-label="按姓名搜索人才" autocomplete="off" enterkeyhint="search" aria-busy="${state.talentSearchLoading}"></label><button class="btn-primary rf-list-search-submit${state.talentSearchLoading ? ' is-loading' : ''}" id="rf-search-submit" type="button" ${state.talentSearchLoading ? 'disabled' : ''}>${state.talentSearchLoading ? '<i class="rf-search-spinner" aria-hidden="true"></i><span>查询中</span>' : '查询'}</button><button id="rf-refresh" type="button" title="刷新人才列表" aria-label="刷新人才列表">↻</button></div>
          <div class="rf-talent-filter-tools">
            <label><span>岗位</span><select id="rf-job-filter">${talentOptions(jobFilterValues, state.talentFilters.job, '全部岗位')}</select></label>
            <label><span>在职状态</span><select id="rf-status-filter">${talentOptions(['在职','离职','未入职'], state.talentFilters.status, '全部状态')}</select></label>
            <label><span>人才来源</span><select id="rf-source-filter">${talentOptions(sources, state.talentFilters.source, '全部来源')}</select></label>
            <label><span>导入人 / 内推人</span><input id="rf-importer-filter" type="search" value="${escapeHtml(state.talentFilters.importer)}" placeholder="输入姓名搜索" autocomplete="off" enterkeyhint="search" aria-label="按导入人或内推人搜索人才"></label>
          </div>
          <div class="rf-talent-advanced-row" id="rf-talent-advanced-row" ${state.showTalentAdvancedFilters ? '' : 'hidden'}>
            <label><span>年龄</span><select id="rf-age-filter">${talentOptions(['18-25岁','26-30岁','31-35岁','36岁以上'], state.talentFilters.age, '全部年龄')}</select></label>
            <label><span>地区</span><select id="rf-region-filter">${talentOptions([...new Set(state.talents.map((item) => item.address).filter(Boolean))], state.talentFilters.region, '全部地区')}</select></label>
            <label><span>AI 评分</span><select id="rf-score-filter">${talentOptions(['90-100分','80-89分','70-79分','60-69分','0-59分'], state.talentFilters.score, '全部评分')}</select></label>
          </div>
        </div>
      </section>
      <section class="rf-archive-shell rf-talent-shell rf-talent-list-mode" aria-busy="${state.talentSearchLoading}">
        <div class="rf-talent-search-feedback" id="rf-talent-search-feedback" role="status" aria-live="polite" ${state.talentSearchLoading ? '' : 'hidden'}><i class="rf-search-spinner" aria-hidden="true"></i><span>正在搜索人才，请稍候…</span></div>
        <div class="rf-candidate-list rf-talent-cards${state.talentSearchLoading ? ' is-searching' : ''}">${state.talents.length ? state.talents.map((item) => talentCandidateRow(item, false)).join('') : '<div class="rf-list-empty">当前条件下暂无人才<br><small>可以清除筛选条件后重试</small></div>'}</div>
        <nav class="rf-talent-pager" aria-label="人才档案分页"><button type="button" data-rf-talent-page="1" ${state.talentPage <= 1 ? 'disabled' : ''}>首页</button><button type="button" data-rf-talent-page="${state.talentPage - 1}" ${state.talentPage <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${state.talentPage} / ${state.talentTotalPages} 页<small>共 ${state.talentTotal} 位</small></span><button type="button" data-rf-talent-page="${state.talentPage + 1}" ${state.talentPage >= state.talentTotalPages ? 'disabled' : ''}>下一页</button><button type="button" data-rf-talent-page="${state.talentTotalPages}" ${state.talentPage >= state.talentTotalPages ? 'disabled' : ''}>尾页</button></nav>
      </section>`;
    bindTalentArchive();
    if (Number.isFinite(previousListScrollTop)) {
      requestAnimationFrame(() => {
        const list = root.querySelector('.rf-candidate-list');
        if (list) list.scrollTop = previousListScrollTop;
      });
    }
  }

  function formatTalentEntryTime(value) {
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return value ? String(value).slice(0, 10) : '待补充';
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function talentWorkRows(item) {
    const rawText = item?.rawText || '';
    const text = String(item?.workExperience || (rawText && !rawText.includes('完整简历原文将在打开详情时按需加载') ? rawText : '') || '').replace(/\r\n?/g, '\n');
    const headingMatch = text.match(/(?:^|\n)\s*(?:工作经历|工作经验)\s*[:：]?\s*(?=\n|$)/i);
    const section = headingMatch ? text.slice(headingMatch.index + headingMatch[0].length) : text;
    const nextHeading = section.search(/\n\s*(?:教育经历|教育背景|项目经历|项目经验|技能特长|技能与证书|自我评价)\s*[:：]?\s*(?=\n|$)/i);
    const lines = (nextHeading >= 0 ? section.slice(0, nextHeading) : section).split('\n').map((line) => line.trim()).filter(Boolean);
    const rangePattern = /((?:19|20)\d{2}\s*[年.\/-]\s*(?:\d{1,2}\s*月)?\s*(?:[-—~至]|to)\s*(?:(?:19|20)\d{2}\s*[年.\/-]\s*(?:\d{1,2}\s*月)?|现在|至今|present))/gi;
    const inlinePattern = /((?:19|20)\d{2}\s*[年.\/-]\s*(?:\d{1,2}\s*月)?\s*(?:[-—~至]|to)\s*(?:(?:19|20)\d{2}\s*[年.\/-]\s*(?:\d{1,2}\s*月)?|现在|至今|present))\s*[:：，,、-]?\s*([^\n]+)/i;
    const rows = [];
    for (const line of lines) {
      if (rows.length >= 2) break;
      const inlineMatch = line.match(inlinePattern);
      if (inlineMatch) {
        const tail = inlineMatch[2].trim();
        const parts = tail.split(/[|｜·\/]/, 2).map((value) => value.trim()).filter(Boolean);
        rows.push({ period: inlineMatch[1].replace(/\s+/g, ''), company: parts[0] || item?.currentCompany || '公司待补充', role: parts[1] || item?.currentRole || '' });
        continue;
      }
      const rangeMatch = [...line.matchAll(rangePattern)][0];
      if (!rangeMatch) continue;
      const tail = line.slice(rangeMatch[0].length).replace(/^[\s：:，,、|-]+/, '');
      const parts = tail.split(/[|｜·\/]/, 2).map((value) => value.trim()).filter(Boolean);
      rows.push({ period: rangeMatch[1].replace(/\s+/g, ''), company: parts[0] || item?.currentCompany || '公司待补充', role: parts[1] || item?.currentRole || '' });
    }
    if (!rows.length && section.trim()) {
      const parts = section.split('\n')[0].split(/[|｜]/, 2).map((value) => value.trim()).filter(Boolean);
      const period = (section.match(/(?:19|20)\d{2}(?:\.\d{1,2})?\s*[-—~至]+\s*(?:至今|现在|(?:19|20)\d{2})/) || [''])[0];
      if (parts[0]) return [{ period, company: parts[0], role: parts[1] || item?.currentRole || '' }];
    }
    if (!rows.length) {
      const company = item?.currentCompany || item?.company || '';
      const role = item?.currentRole || item?.position || '';
      return [{ period: '', company: company || '--', role }];
    }
    return rows;
  }

  function talentEducationLevel(value) {
    const text = String(value || '');
    if (/博士/.test(text)) return '博士';
    if (/硕士|研究生/.test(text)) return '硕士';
    if (/本科|大学本科/.test(text)) return '本科';
    if (/大专|专科/.test(text)) return '专科';
    if (/高中|中专|中技/.test(text)) return '高中';
    return text ? '学历待确认' : '';
  }

  function talentCandidateRow(item, active) {
    const gender = safeGender(item.gender);
    const tags = (item.tags || []).map((tag) => typeof tag === 'string' ? tag : tag?.name).filter((tag) => tag && tag !== '待生成');
    const labelTags = tags.length ? tags.slice(0, 3) : (item.skills || []).slice(0, 3);
    const strengths = (item.analysis?.strengths || []).slice(0, 1);
    const matchedRole = item.matches?.[0]?.positionName || '';
    const employmentStatus = item.employmentStatus || '未入职';
    const employmentStatusClass = employmentStatus === '在职' ? ' active' : employmentStatus === '离职' ? ' left' : ' pending';
    const meta = [
      item.age ? `${item.age}岁` : '年龄待补充',
      item.yearsOfExperience || '工作年限待补充',
      talentEducationLevel(item.educationBackground) || '学历待补充',
      item.importedBy ? `导入人 ${item.importedBy}` : '',
      item.referrer ? `内推人 ${item.referrer}` : '',
    ].map((value) => `<span>${escapeHtml(value)}</span>`).join('<i class="rf-meta-divider">\u2502</i>');
    const tagsHtml = labelTags.length
      ? labelTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')
      : '<span class="empty">AI标签待生成</span>';
    const strengthHtml = strengths.length
      ? `<span class="rf-talent-strengths"><b>优势</b>${strengths.map((value) => `<em>${escapeHtml(value)}</em>`).join('')}</span>`
      : '<span class="rf-talent-strengths empty"><b>优势</b><em>暂无明确优势</em></span>';
    const latestWecomReview = item.wecomReviews?.[0] || null;
    const stageAction = !item.analysis?.id
      ? { label: 'AI分析', kind: 'ai' }
      : latestWecomReview?.claimedDepartment
        ? { label: '安排面试', kind: 'interview' }
        : latestWecomReview
          ? { label: '评审中', kind: 'detail' }
          : { label: '业务群评审', kind: 'review' };
    const workRows = talentWorkRows(item).map((row) => `
      <article class="rf-talent-work-row">
        <b>${escapeHtml(row.period || '时间待补充')}</b>
        <strong>${escapeHtml(row.company)}</strong>
        ${row.role ? `<span>${escapeHtml(row.role)}</span>` : ''}
      </article>`).join('');
    return `<button class="rf-candidate rf-talent-candidate ${active ? 'active' : ''}" data-rf-talent="${escapeHtml(item.id)}" type="button">
      ${profileAvatar(item, 'rf-candidate-avatar')}
      <span class="rf-talent-card-main">
        <span class="rf-candidate-name"><strong>${escapeHtml(item.name || '未识别姓名')}</strong><span class="rf-employment-status${employmentStatusClass}">${escapeHtml(employmentStatus)}</span><time datetime="${escapeHtml(item.createdTime || '')}">${escapeHtml(formatTalentEntryTime(item.createdTime))}</time></span>
        <span class="rf-talent-meta">${meta}</span>
        ${strengthHtml}
        <span class="rf-talent-tags">${tagsHtml}</span>
      </span>
      <span class="rf-talent-card-resume"><span class="rf-talent-card-title">工作经历</span>${workRows}</span>
      <span class="rf-talent-card-side"><b class="rf-match-score ${scoreTone(item.bestMatchScore)}">${Number(item.bestMatchScore || 0)}分</b><span>${escapeHtml(matchedRole || '岗位待匹配')}</span><em class="rf-talent-stage-action" data-rf-stage-action="${escapeHtml(item.id)}" data-rf-stage-kind="${escapeHtml(stageAction.kind)}">${escapeHtml(stageAction.label)}</em></span>
    </button>`;
  }

  function scoreCard(label, value, evidence) {
    return `<article class="rf-score-card"><div><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong></div><div class="rf-score-track"><i style="width:${Math.max(0, Math.min(100, Number(value || 0)))}%"></i></div><p>${escapeHtml(evidence || '证据不足，需要面试确认。')}</p></article>`;
  }

  function talentDetailHtml(item) {
    const analysis = item.analysis || {};
    const scores = analysis.scores || {};
    const evidence = analysis.evidence || {};
    const matches = item.matches || [];
    const manualCorrection = matches[0]?.manualCorrection || null;
    const tags = item.tags || [];
    const timeline = item.timeline || [];
    const wecomReviews = item.wecomReviews || [];
    const latestWecomReview = wecomReviews[0] || null;
    const overallScore = Number(matches[0]?.score || scores.overall || 0);
    const flow = item.flowEvidence || {};
    const flowSteps = [
      { name: 'AI分析', done: Boolean(analysis.id), current: !analysis.id, detail: analysis.id ? `已完成 · ${overallScore}分 · ${analysis.confidence || '低'}置信度` : '点击一次生成评分、岗位匹配和标签', action: analysis.id ? '重新AI分析' : '生成分析', actionType: analysis.id ? 'data-rf-ai-versions' : 'data-rf-ai-versions', disabled: false },
      { name: '业务群评审', done: Boolean(latestWecomReview?.claimedDepartment), current: Boolean(!latestWecomReview?.claimedDepartment), detail: latestWecomReview ? `${latestWecomReview.status || '评审中'} · ${Number(latestWecomReview.responseCount || 0)} 条反馈` : '可直接推送业务群', action: '查看进度', actionType: 'data-rf-wecom', disabled: false },
      { name: '意向沟通', done: Number(flow.communications || 0) > 0, current: false, detail: Number(flow.communications || 0) ? `已完成 · ${Number(flow.communications)} 条沟通记录` : '可直接记录沟通', action: Number(flow.communications || 0) > 0 ? '查看沟通' : '记录沟通', actionType: 'data-rf-communication', disabled: false, pushStep: 'communication' },
      { name: '约面', done: Number(flow.interviews || 0) > 0, current: false, detail: flow.interview ? `${flow.interview.status || '已预约'} · ${flow.interview.startedAt || '时间待补充'}` : '可直接安排面试', action: '安排面试', actionType: 'data-rf-schedule-interview', disabled: false, pushStep: 'interview' },
      { name: '面试题', done: flow.interviewQuestionStatus === '已发布', current: Boolean(flow.interview && flow.interviewQuestionStatus !== '已发布'), detail: flow.interviewQuestionStatus === '已发布' ? '题目已生成，开场提醒已发送链接' : flow.interviewQuestionStatus === '已生成待推送' ? '题目已生成，开始前10分钟发送链接' : flow.interviewQuestionStatus === '生成中' ? '正在自动生成' : flow.interviewQuestionStatus === '生成失败' ? '自动生成失败，可重新触发' : flow.interview ? '面试创建后自动生成' : '创建面试后自动生成', action: ['已发布', '已生成待推送'].includes(flow.interviewQuestionStatus) ? '查看题目' : flow.interviewQuestionStatus === '生成失败' ? '重新生成' : '生成面试题', actionType: ['已发布', '已生成待推送'].includes(flow.interviewQuestionStatus) ? 'data-rf-open-flow-questions' : 'data-rf-generate-flow-questions', disabled: !flow.interview, pushStep: 'interview_question', pushDisabled: !flow.interview },
      { name: '面试评价', done: Number(flow.interviewFeedback || 0) > 0, current: false, detail: flow.interviewFeedbackItem ? `${flow.interviewFeedbackItem.candidateRating ? `${flow.interviewFeedbackItem.candidateRating}级 · ` : ''}${flow.interviewFeedbackItem.conclusion || '已提交'} · ${flow.interviewFeedbackItem.score || 0}分` : '可直接填写面试评价', action: '填写评价', actionType: 'data-rf-open-interview-feedback', disabled: false, pushStep: 'interview_evaluation', pushDisabled: !flow.interview },
      { name: '发Offer', done: Boolean(flow.offer), current: false, detail: flow.offer ? `${flow.offer.status || '已创建'} · ${flow.offer.response || '待答复'}` : '可直接创建Offer', action: 'Offer管理', actionType: 'data-action="open-offer"', disabled: false, pushStep: 'offer', pushDisabled: !(flow.offer || Number(flow.interviewFeedback || 0) > 0) },
      { name: '入职', done: Boolean(flow.onboarding?.actualDate), current: false, detail: flow.onboarding ? `${flow.onboarding.actualDate ? `已到岗 ${flow.onboarding.actualDate}` : flow.onboarding.status || '办理中'} · ${flow.onboarding.probation || '试用期待确认'}` : '一键确认候选人已入职', action: flow.onboarding?.actualDate ? '查看入职' : '确认入职', actionType: flow.onboarding?.actualDate ? 'data-rf-lifecycle' : 'data-rf-confirm-onboard', disabled: false, pushStep: 'onboarding', pushDisabled: !flow.onboarding },
      { name: '入职评价', done: flow.onboardingReview?.status === '已完成', current: Boolean(flow.onboarding?.actualDate && flow.onboardingReview?.status !== '已完成'), detail: flow.onboardingReview ? (flow.onboardingReview.status === '已完成' ? `${flow.onboardingReview.performanceRating || '待评级'} · ${flow.onboardingReview.growthLevel || '成长等级待补充'} · ${flow.onboardingReview.actualDate || '已完成'}` : `计划 ${flow.onboardingReview.plannedDate || '入职满一个月'} · 到期自动提醒岗位HR`) : (flow.onboarding?.actualDate ? '到岗满一个月后自动提醒岗位HR' : '确认入职后自动生成'), action: flow.onboardingReview ? (flow.onboardingReview.status === '已完成' ? '查看评价' : '填写评价') : '等待入职', actionType: 'data-rf-lifecycle', disabled: !flow.onboardingReview, pushStep: 'onboarding_evaluation', pushDisabled: !flow.onboarding },
      { name: '离职', done: Boolean(flow.offboarding?.actualDate), current: false, detail: flow.offboarding ? `${flow.offboarding.actualDate ? `已离职 ${flow.offboarding.actualDate}` : flow.offboarding.status || '办理中'} · ${flow.offboarding.reason || '原因待补充'}` : '可直接进入生命周期', action: '生命周期', actionType: 'data-rf-lifecycle', disabled: false },
      { name: '回访', done: flow.followup?.status === '已完成', current: false, detail: flow.followup ? `${flow.followup.status || '待回访'} · ${flow.followup.result || flow.followup.plannedDate || '时间待补充'}` : '可直接进入生命周期', action: '查看回访', actionType: 'data-rf-lifecycle', disabled: false },
    ];
    const flowStepHtml = (step, index, candidate) => {
      const contextAttrs = step.actionType === 'data-rf-open-interview-feedback'
        ? ` data-rf-candidate-id="${escapeHtml(candidate.candidateId || candidate.id || '')}" data-rf-interview-id="${escapeHtml(flow.interview?.id || '')}"`
        : '';
      return `<article class="${step.done ? 'done' : step.current ? 'current' : ''}" aria-label="${escapeHtml(`${step.name} · ${step.done ? '已完成' : '未完成'} · ${step.detail}`)}"><i>${index + 1}</i><div><strong>${escapeHtml(step.name)}</strong><span class="rf-flow-actions"><button type="button" ${step.actionType}${contextAttrs} ${step.disabled ? 'disabled' : ''}>${escapeHtml(step.action)}</button>${step.pushStep ? `<button type="button" data-rf-flow-wecom="${escapeHtml(step.pushStep)}" ${step.pushDisabled ? 'disabled' : ''}>推送企微</button>` : ''}</span></div></article>`;
    };
    const gender = safeGender(item.gender);
    const tagText = tags.slice(0, 5).map((tag) => tag.name).join('、') || '待生成';
    return `
      <section class="rf-talent-basic-card">
        <div class="rf-profile-top rf-talent-profile-top">
          <div class="rf-profile-identity">${profileAvatar(item)}<div><div class="rf-profile-name"><h2>${escapeHtml(item.name || '未识别姓名')}</h2><b class="rf-profile-score">${overallScore}分<b>综合评分</b></b></div><div class="rf-profile-quick-facts">${[gender || '', item.phone || '', item.age ? `${item.age}岁` : '', item.yearsOfExperience || '', item.currentCompany || '', item.currentRole || '', item.address || '', item.employmentStatus || '', item.tianjiHireDate ? `入职 ${formatTalentEntryTime(item.tianjiHireDate)}` : '', item.tianjiLeaveDate ? `离职 ${formatTalentEntryTime(item.tianjiLeaveDate)}` : '', item.source || '', item.importedBy ? `导入人 ${item.importedBy}` : '', item.latestApplicationTime ? `最近投递 ${formatTalentEntryTime(item.latestApplicationTime)}` : item.createdTime ? `首次入库 ${formatTalentEntryTime(item.createdTime)}` : ''].filter(Boolean).map((value) => `<span>${escapeHtml(value)}</span>`).join('<i>|</i>') || '待补充'}</div></div></div>
          <div class="rf-profile-job-intent"><div><span>适配岗位</span><strong>${escapeHtml(matches[0]?.positionName || item.jobIntention || '岗位匹配待生成')}</strong>${manualCorrection ? `<small>人工修正：${escapeHtml(manualCorrection.previousPositionName || '原岗位未记录')} → ${escapeHtml(matches[0]?.positionName || '')} · ${escapeHtml(manualCorrection.operator || '人工')} · ${escapeHtml(manualCorrection.reason || '')}</small>` : ''}</div><label class="rf-profile-tag-pill"><b>人才标签：</b>${escapeHtml(tagText)}</label></div>
          <div class="rf-profile-stage-actions">${analysis.id ? '' : '<button class="btn-soft" type="button" data-rf-ai-versions>AI分析</button>'}<div class="rf-more-actions"><button type="button" class="btn-soft" data-rf-more-toggle aria-expanded="false">更多操作</button><div class="rf-more-menu" data-rf-more-menu hidden><button type="button" data-rf-correct-ai>修正AI标签/评分</button><button type="button" data-rf-correct-match>人工修改适配岗位</button>${item.latestResumeId || item.resumeId ? `<button type="button" data-rf-resume-review="${escapeHtml(item.latestResumeId || item.resumeId)}">复核简历字段</button>` : ''}<button type="button" data-rf-reparse-resume="${escapeHtml(item.latestResumeId || item.resumeId || '')}">重新识别简历</button><button type="button" data-rf-rename-talent>修改人才名称</button><button type="button" data-rf-open-background>发起背调</button>${item.sourceFileUrl ? `<a href="${escapeHtml(item.sourceFileUrl)}" target="_blank" rel="noopener">查看原始简历</a>` : ''}${item.editableWordUrl ? `<a href="${escapeHtml(item.editableWordUrl)}" target="_blank" rel="noopener">可编辑Word ↗</a>` : ''}${item.latestResumeId || item.resumeId ? `<button type="button" class="danger" data-rf-delete-talent-resume="${escapeHtml(item.latestResumeId || item.resumeId)}" data-rf-delete-candidate="${escapeHtml(item.candidateId || item.id || state.activeId || '')}">删除简历</button>` : ''}${item.candidateId ? `<button type="button" class="danger" data-rf-delete-talent>删除人才档案</button>` : ''}</div>
        </div>
        <div class="rf-detail-overview" id="rf-detail-basic">
        </div>
      </section>
      <section class="rf-evaluation-workbench" id="rf-detail-evaluation">
        <div class="rf-section-title"><div><span>TALENT DECISION FLOW</span><strong>招聘流程</strong></div><small>10个核心阶段 · 状态来自真实业务记录</small></div>
        <div class="rf-evaluation-steps rf-flow-steps">${flowSteps.map((step, index) => flowStepHtml(step, index, item)).join('')}</div>
      </section>
      <section class="rf-resume-detail-panel" id="rf-detail-resume">
        <div class="rf-section-title"><div><span>RESUME DETAILS</span><strong>简历详细信息</strong></div><small>按原始简历结构整理，便于快速阅读与人工复核</small></div>
        ${resumeWarningsHtml(item)}
        <div class="rf-resume-section-grid">
          <article class="rf-resume-section-card">${detailSection('教育背景', item.educationBackground)}</article>
          <article class="rf-resume-section-card">${detailSection('自我评价', item.selfEvaluation)}</article>
          <article class="rf-resume-section-card wide">${detailSection('工作经历', item.workExperience || sectionFromRawText(item.rawText, ['工作经历', '工作经验']))}</article>
          <article class="rf-resume-section-card">${detailSection('技能与证书', (item.skills || []).join('、'))}</article>
          <article class="rf-resume-section-card">${detailSection('项目亮点', analysis.summary || resumeSectionText(item.rawText, ['项目经历', '项目经验']))}</article>
        </div>
      </section>
      <section class="rf-ai-summary">
        <div class="rf-section-title"><div><span>AI 人才画像</span><strong>${escapeHtml(analysis.summary || '等待生成完整人才画像')}</strong></div><b>${escapeHtml(analysis.confidence || '低')}置信度 · ${escapeHtml(analysis.reviewStatus || '待人工确认')}</b></div>
        <div class="rf-score-grid">
          ${scoreCard('业务能力', scores.business, evidence.business)}
          ${scoreCard('管理能力', scores.management, evidence.management)}
          ${scoreCard('逻辑能力', scores.logic, evidence.logic)}
          ${scoreCard('沟通协作', scores.communication, evidence.communication)}
        </div>
        <div class="rf-insight-columns">
          <article><span>优势</span>${(analysis.strengths || []).length ? `<ul>${analysis.strengths.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : '<p>暂无明确优势证据</p>'}</article>
          <article class="risk"><span>面试待确认</span>${(analysis.risks || []).length ? `<ul>${analysis.risks.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : '<p>暂无待确认项</p>'}</article>
        </div>
      </section>
`;
  }

  function bindTalentArchive() {
    const search = document.getElementById('rf-search');
    const filterValue = (id, fallback) => document.getElementById(id)?.value || fallback;
    const applyFilters = () => {
      if (state.talentSearchLoading) return;
      state.talentSearchDraft = search?.value.trim() || '';
      state.talentFilters = {
        ...state.talentFilters,
        q: state.talentSearchDraft,
        job: filterValue('rf-job-filter', '全部岗位'),
        status: filterValue('rf-status-filter', '全部状态'),
        source: filterValue('rf-source-filter', '全部来源'),
        tag: filterValue('rf-tag-filter', '全部标签'),
        importer: filterValue('rf-importer-filter', ''),
        age: filterValue('rf-age-filter', '全部年龄'),
        region: filterValue('rf-region-filter', '全部地区'),
        score: filterValue('rf-score-filter', '全部评分'),
      };
      state.talentPage = 1;
      void loadTalentArchive(false);
    };
    document.getElementById('rf-import-resume')?.addEventListener('click', openResumeImportDialog);
    document.getElementById('rf-advanced-filter')?.addEventListener('click', (event) => {
      state.showTalentAdvancedFilters = !state.showTalentAdvancedFilters;
      event.currentTarget.setAttribute('aria-expanded', String(state.showTalentAdvancedFilters));
      const advancedRow = document.getElementById('rf-talent-advanced-row');
      if (advancedRow) advancedRow.hidden = !state.showTalentAdvancedFilters;
    });
    document.getElementById('rf-search-submit')?.addEventListener('click', applyFilters);
    search?.addEventListener('input', () => { state.talentSearchDraft = search.value; });
    search?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applyFilters(); } });
    document.querySelector('.rf-talent-filter-panel')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement)) return;
      event.preventDefault();
      applyFilters();
    });
    document.getElementById('rf-refresh')?.addEventListener('click', () => loadTalentArchive(true, true));
    document.getElementById('rf-reset-filter')?.addEventListener('click', () => { state.talentSearchDraft = ''; state.talentFilters = { q: '', job: '全部岗位', status: '全部状态', source: '全部来源', tag: '全部标签', importer: '', age: '全部年龄', region: '全部地区', score: '全部评分' }; state.showTalentAdvancedFilters = false; state.talentPage = 1; loadTalentArchive(false); });
    document.querySelectorAll('[data-rf-talent-page]:not([disabled])').forEach((button) => button.addEventListener('click', () => { state.talentPage = Number(button.dataset.rfTalentPage); loadTalentArchive(); }));
    document.querySelector('[data-rf-duplicates]')?.addEventListener('click', openDuplicateWorkbench);
    const talentButtons = rootQueryAll('[data-rf-talent]');
    talentButtons.forEach((button, index) => {
      button.addEventListener('click', () => openTalentDetailDialog(button.dataset.rfTalent));
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTalentDetailDialog(button.dataset.rfTalent); return; }
        const targetIndex = event.key === 'ArrowDown' ? Math.min(talentButtons.length - 1, index + 1) : event.key === 'ArrowUp' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? talentButtons.length - 1 : -1;
        if (targetIndex < 0) return;
        event.preventDefault();
        talentButtons[targetIndex]?.focus();
      });
    });
    document.querySelector('[data-rf-advance]')?.addEventListener('click', advanceTalentStage);
    document.querySelector('[data-rf-confirm-ai]')?.addEventListener('click', confirmTalentAi);
    document.querySelector('[data-rf-correct-ai]')?.addEventListener('click', openAnalysisCorrectionForm);
    document.querySelector('[data-rf-correct-match]')?.addEventListener('click', openMatchCorrectionForm);
    document.querySelectorAll('[data-rf-ai-versions]').forEach((button) => button.addEventListener('click', () => submitFirstAnalysis()));
    document.querySelector('[data-rf-owner]')?.addEventListener('click', openOwnershipDialog);
    document.querySelectorAll('[data-rf-birth-year]').forEach((button) => button.addEventListener('click', openBirthYearDialog));
    document.querySelector('[data-rf-open-background]')?.addEventListener('click', () => openBackgroundWorkbench(state.activeId));
    document.querySelector('[data-rf-resume-versions]')?.addEventListener('click', (event) => openResumeVersions(event.currentTarget.dataset.rfResumeVersions));
    document.querySelector('[data-rf-open-analysis-versions]')?.addEventListener('click', () => openAnalysisVersions(state.activeId));
    document.querySelector('[data-rf-resume-review]')?.addEventListener('click', (event) => openResumeReview(event.currentTarget.dataset.rfResumeReview, state.talentDetails[state.activeId] || {}, 'talent'));
    document.querySelector('[data-rf-reparse-resume]')?.addEventListener('click', (event) => reparseTalentResume(event.currentTarget.dataset.rfReparseResume));
    document.querySelector('[data-rf-rename-talent]')?.addEventListener('click', (event) => openTalentNameDialog(event.currentTarget.dataset.rfRenameTalent || state.activeId));
    const wordButton = document.querySelector('[data-rf-talent-word]');
    if (wordButton) wordButton.addEventListener('click', () => convertTalentResumeToWord(wordButton.dataset.rfTalentWord, wordButton.dataset.force === 'true'));
    document.querySelector('[data-rf-delete-talent-resume]')?.addEventListener('click', (event) => deleteTalentResume(event.currentTarget.dataset.rfDeleteTalentResume, event.currentTarget.dataset.rfDeleteCandidate, event.currentTarget));
    document.querySelector('[data-rf-delete-talent]')?.addEventListener('click', () => archiveTalent(state.activeId));
    document.querySelector('[data-rf-invite-assessment]')?.addEventListener('click', () => openAssessmentInvite(state.activeId));
    document.querySelectorAll('[data-rf-schedule-interview]:not([disabled])').forEach((button) => button.addEventListener('click', () => openScheduleInterview(state.activeId)));
    document.querySelector('[data-rf-background]')?.addEventListener('click', () => openBackgroundWorkbench(state.activeId));
    document.querySelector('[data-rf-governance]')?.addEventListener('click', () => openTalentGovernance(state.activeId));
    document.querySelectorAll('[data-rf-assessment-result]').forEach((button) => button.addEventListener('click', () => openSubmissionDetail(button.dataset.rfAssessmentResult)));
    document.querySelector('[data-rf-contact-lock]')?.addEventListener('click', toggleContactLock);
    document.querySelectorAll('[data-rf-wecom]:not([disabled])').forEach((button) => button.addEventListener('click', () => openWecomTalentReviewDialog(state.activeId)));
    document.querySelectorAll('[data-rf-communication]:not([disabled])').forEach((button) => button.addEventListener('click', () => openCommunicationDialog(state.activeId)));
    document.querySelectorAll('[data-rf-generate-flow-questions]:not([disabled])').forEach((button) => button.addEventListener('click', (event) => generateInterviewQuestions(state.talentDetails[state.activeId]?.flowEvidence?.interview?.id, event.currentTarget)));
    document.querySelectorAll('[data-rf-open-flow-questions]:not([disabled])').forEach((button) => button.addEventListener('click', () => openInterviewQuestionReview(state.talentDetails[state.activeId]?.flowEvidence?.interview?.id)));
    document.querySelectorAll('[data-rf-flow-wecom]:not([disabled])').forEach((button) => button.addEventListener('click', () => pushTalentFlowWecom(button.dataset.rfFlowWecom, button)));
    document.querySelectorAll('[data-rf-lifecycle]:not([disabled])').forEach((button) => button.addEventListener('click', () => openLifecycleWorkbench(state.activeId)));
    document.querySelectorAll('[data-rf-confirm-onboard]:not([disabled])').forEach((button) => button.addEventListener('click', confirmTalentOnboard));
    document.querySelectorAll('[data-action="open-offer"]:not([disabled])').forEach((button) => button.addEventListener('click', () => openTalentOfferDialog(state.activeId)));
        document.querySelectorAll('[data-rf-stage-action]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const candidateId = button.dataset.rfStageAction || '';
      const kind = button.dataset.rfStageKind || 'detail';
      state.activeId = candidateId;
      if (kind === 'ai') submitFirstAnalysis();
      else if (kind === 'review') openWecomTalentReviewDialog(candidateId, true);
      else if (kind === 'interview') openScheduleInterview(candidateId, true);
      else openTalentDetailDialog(candidateId);
    }));
  }

  async function openWecomTalentReviewDialog(candidateId, stack) {
    let talent = state.talentDetails[candidateId] || state.talents.find((item) => item.id === candidateId) || {};
    const analysis = talent.analysis || {};
    if (!analysis.id) { notifyUser('请先生成评分、岗位匹配和标签，再推送企微评审', 'info'); return; }
    const token = showTalentDialog('<div class="rf-dialog-loading">正在同步评审记录…</div>', 'wide', stack);
    let syncMessage = '';
    try {
      const detail = await fetchTalentDetail(candidateId);
      if (!isTalentDialogCurrent(token)) return;
      talent = detail;
      storeTalentDetail(detail);
    } catch (error) {
      if (!isTalentDialogCurrent(token)) return;
      if (!state.talentDetails[candidateId]) {
        dialogFailure('评审记录读取失败', error, () => openWecomTalentReviewDialog(candidateId, stack), token);
        return;
      }
      talent = state.talentDetails[candidateId];
      syncMessage = '评审记录同步失败，当前显示本地缓存；请稍后重新打开核对。';
    }
    try {
      const options = await request('api/recruitment/form-options');
      if (!isTalentDialogCurrent(token)) return;
      state.jobFormOptions = options;
    } catch (error) {
      if (!state.jobFormOptions) syncMessage = `${syncMessage ? `${syncMessage} ` : ''}接收人选项读取失败，单独发送暂不可选。`;
    }
    const name = escapeHtml(talent.name || '候选人');
    const employees = state.jobFormOptions?.employees || [];
    const recipientOptions = employees.map((item) => `<option value="${escapeHtml(item.id)}" ${item.tianjiWechatId ? '' : 'disabled'}>${escapeHtml(item.name)}${item.department ? ` · ${escapeHtml(item.department)}` : ''}${item.tianjiWechatId ? '' : ' · 未配置私信ID'}</option>`).join('');
    const latestWecomReview = talent.wecomReviews?.[0] || null;
    const reviewResponses = latestWecomReview?.responses || [];
    const responseList = reviewResponses.length ? reviewResponses.map((response, idx) => `<div class="rf-wecom-response-item"><span class="rf-wecom-response-num">${idx + 1}</span><div class="rf-wecom-response-body"><div class="rf-wecom-response-head"><b class="${response.decision === '适合' ? 'rf-decision-yes' : response.decision === '不适合' ? 'rf-decision-no' : 'rf-decision-other'}">${escapeHtml(response.decision)}</b><strong>${escapeHtml(response.reviewer || '匿名')}</strong><small>${escapeHtml(response.department || '部门未填')}${response.position ? ` · ${escapeHtml(response.position)}` : ''}</small></div>${response.comment ? `<p>${escapeHtml(response.comment)}</p>` : ''}<span class="rf-wecom-response-time">${escapeHtml(response.submittedAt || '')} · ${escapeHtml(response.processing || '')}</span></div></div>`).join('') : '<div class="rf-wecom-no-response">暂无反馈记录，等待群成员提交评审意见。</div>';
    showTalentDialog(`<section class="rf-wecom-send-dialog"><header class="rf-dialog-head"><div><span>INTERNAL TALENT REVIEW</span><h2>推送企微评审</h2></div></header>
<aside class="rf-wecom-response-panel"><header><strong>评审人反馈记录</strong><small>${reviewResponses.length} 条</small></header><div class="rf-wecom-response-list">${responseList}</div></aside>
<section class="rf-wecom-send-footer"><div class="rf-wecom-send-settings"><fieldset class="rf-wecom-channel-picker"><legend>发送通道</legend><label><input type="checkbox" id="rf-wecom-group-enabled" checked><span>群聊推送</span></label><label><input type="checkbox" id="rf-wecom-direct-enabled"><span>单独提醒</span></label></fieldset><label class="rf-wecom-webhook-input" id="rf-wecom-webhook-field"><span>企微机器人Key</span><input id="rf-wecom-webhook-key" placeholder="留空使用默认机器人"></label><label class="rf-wecom-webhook-input rf-wecom-field-hidden" id="rf-wecom-recipient-field"><span>接收人</span><select id="rf-wecom-recipient"><option value="">请选择接收人</option>${recipientOptions}</select></label></div><div class="rf-dialog-actions rf-wecom-send-actions"><button class="btn-soft" data-rf-wecom-cancel type="button">取消</button><button class="btn-primary" data-rf-wecom-submit type="button">确认推送</button></div><p class="rf-dialog-message${syncMessage ? ' error' : ''}" id="rf-wecom-message" aria-live="polite">${escapeHtml(syncMessage)}</p></section></section>`, 'wide', stack);
    document.querySelector('[data-rf-wecom-cancel]')?.addEventListener('click', cancelTalentDialog);
    const updateSendMode = () => {
      const group = document.getElementById('rf-wecom-group-enabled')?.checked;
      const direct = document.getElementById('rf-wecom-direct-enabled')?.checked;
      document.getElementById('rf-wecom-webhook-field')?.classList.toggle('rf-wecom-field-hidden', !group);
      document.getElementById('rf-wecom-recipient-field')?.classList.toggle('rf-wecom-field-hidden', !direct);
    };
    document.getElementById('rf-wecom-group-enabled')?.addEventListener('change', updateSendMode);
    document.getElementById('rf-wecom-direct-enabled')?.addEventListener('change', updateSendMode);
    updateSendMode();
    document.querySelector('[data-rf-wecom-submit]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (button.disabled) return;
      const message = document.getElementById('rf-wecom-message');
      const token = talentDialogToken;
      const group = document.getElementById('rf-wecom-group-enabled')?.checked;
      const direct = document.getElementById('rf-wecom-direct-enabled')?.checked;
      const recipientId = document.getElementById('rf-wecom-recipient')?.value || '';
      const recipient = employees.find((item) => item.id === recipientId);
      if (!group && !direct) {
        message.textContent = '请至少选择一个发送通道';
        message.classList.add('error');
        return;
      }
      if (direct && !recipientId) {
        message.textContent = '请选择单独提醒的接收人';
        message.classList.add('error');
        return;
      }
      button.disabled = true; message.classList.remove('error'); message.textContent = '正在生成在线简历并推送企微群…';
      if (group && direct) message.textContent = '正在生成在线简历并推送群聊与企微私信…';
      else if (direct) message.textContent = '正在生成在线简历并发送企微私信…';
      try {
        const requestBody = { expiresInDays: 30, operator: '当前用户', forceSend: true };
        if (group && direct) Object.assign(requestBody, { sendMode: 'both', directUserIds: [recipientId], webhookKey: document.getElementById('rf-wecom-webhook-key')?.value.trim() || '' });
        else if (direct) Object.assign(requestBody, { sendMode: 'direct', directUserIds: [recipientId] });
        else Object.assign(requestBody, { sendMode: 'group', webhookKey: document.getElementById('rf-wecom-webhook-key')?.value.trim() || '' });
        const result = await request(`api/talents/${encodeURIComponent(candidateId)}/wecom-review-share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
        if (!isTalentDialogCurrent(token)) return;
        if (result.sent !== true) {
          message.textContent = `本次未发送：${result.message || '未收到发送成功确认，请刷新后重试。'}`;
          message.classList.add('error');
          return;
        }
        await loadTalentDetail(candidateId).catch(() => notifyUser('企微消息已发送，但档案刷新失败；请稍后刷新，无需重复推送。', 'info'));
        if (!isTalentDialogCurrent(token)) return;
        if (result.partial) notifyUser(`部分发送通道失败：${result.message || '请稍后在消息记录中查看错误。'}`, 'error');
        const successTitle = group && direct ? '企微评审已群发并单独提醒' : direct ? '企微评审已发送' : '企微评审已推送';
        const successDescription = group && direct ? `群成员和${escapeHtml(recipient?.name || '接收人')}都会收到评审入口，可直接打开在线简历并提交意见。` : direct ? `${escapeHtml(recipient?.name || '接收人')}点击"进入简历评审"后，会直接打开独立的在线简历与一键评审页面。` : '群成员点击"进入简历评审"后，会直接打开独立的在线简历与一键评审页面。';
        showTalentDialog(`<section class="rf-wecom-send-success"><i>✓</i><span>${successTitle}</span><h2>${name} 已进入部门评审</h2><p>${successDescription}</p><div><a class="btn-primary" href="${escapeHtml(result.reviewUrl || '#')}" target="_blank" rel="noopener">打开评审页验证 ↗</a><button class="btn-soft" data-rf-wecom-success-close type="button">完成</button></div><small>链接仅限公司内部使用，请勿转发给无关人员。</small></section>`);
        document.querySelector('[data-rf-wecom-success-close]')?.addEventListener('click', cancelTalentDialog);
      } catch (error) {
        if (!isTalentDialogCurrent(token)) return;
        message.textContent = conciseError(error); message.classList.add('error');
      } finally { button.disabled = false; }
    });
  }

  function rootQueryAll(selector) {
    return [...(document.getElementById('resumeflow-archive-root')?.querySelectorAll(selector) || [])];
  }

  function setTalentMessage(message, error = false) {
    const node = document.getElementById('rf-action-message')
      || document.querySelector('#rf-talent-dialog .rf-dialog-message');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', error);
  }

  function isTalentDialogLoading(layer) {
    return Boolean(layer?.querySelector(':scope > .rf-dialog > .rf-dialog-loading'));
  }

  function cancelTalentDialog() {
    if (talentDialogStack.length) returnTalentDialog();
    else closeTalentDialog();
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !document.getElementById('rf-talent-dialog')) return;
    event.preventDefault();
    cancelTalentDialog();
  });

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-rf-open-interview-feedback]') : null;
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    openTalentInterviewFeedback(button.dataset.rfCandidateId || undefined, button.dataset.rfInterviewId || undefined);
  });

  function returnTalentDialog() {
    const current = talentDialogStack.pop();
    if (!current) { closeTalentDialog(); return; }
    current.remove();
    talentDialogToken += 1;
    while (talentDialogStack.length) {
      const previous = talentDialogStack.at(-1);
      if (isTalentDialogLoading(previous)) {
        talentDialogStack.pop();
        previous.remove();
        continue;
      }
      previous.classList.remove('rf-dialog-stack-hidden');
      previous.id = 'rf-talent-dialog';
      previous.querySelector('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])')?.focus();
      return;
    }
    closeTalentDialog();
  }

  let talentDialogStack = [];
  let talentDialogToken = 0;

  function closeTalentDialog(restoreFocus = true) {
    talentDialogToken += 1;
    state.resumeBatchDialogOpen = false;
    document.getElementById('rf-talent-dialog')?.remove();
    while (talentDialogStack.length) {
      const item = talentDialogStack.pop();
      item?.remove();
    }
    if (restoreFocus && dialogReturnFocus instanceof HTMLElement && document.contains(dialogReturnFocus)) dialogReturnFocus.focus();
    if (restoreFocus) dialogReturnFocus = null;
  }

  function showTalentDialog(content, size = '', stack) {
    const existing = talentDialogStack.at(-1) || document.getElementById('rf-talent-dialog');
    const parentIsTalentDetail = Boolean(existing?.querySelector('.rf-full-detail-dialog'));
    const nextIsTalentDetail = content.includes('rf-full-detail-dialog');
    const shouldStack = stack ?? (parentIsTalentDetail && !nextIsTalentDetail);
    const existingIsLoading = isTalentDialogLoading(existing);
    const replaceLoading = existingIsLoading;
    if (existing) {
      if (replaceLoading) {
        talentDialogStack = talentDialogStack.filter((item) => item !== existing);
        existing.remove();
      } else if (shouldStack) {
        existing.classList.add('rf-dialog-stack-hidden');
        // 隐藏的父级弹窗不能再占用唯一 id，否则 getElementById 会命中它并导致重复弹窗。
        existing.removeAttribute('id');
      } else {
        talentDialogStack = talentDialogStack.filter((item) => item !== existing);
        existing.remove();
      }
    }
    if (!talentDialogStack.length) dialogReturnFocus = document.activeElement;
    const token = ++talentDialogToken;
    document.body.insertAdjacentHTML('beforeend', `<div class="rf-dialog-backdrop" id="rf-talent-dialog"><section class="rf-dialog ${size}" role="dialog" aria-modal="true" aria-labelledby="rf-dialog-title"><button class="rf-dialog-close" type="button" aria-label="关闭对话框">×</button>${content}</section></div>`);
    const dialog = document.getElementById('rf-talent-dialog');
    talentDialogStack = talentDialogStack.filter((item) => item !== dialog);
    talentDialogStack.push(dialog);
    const heading = dialog.querySelector('h2');
    if (heading) heading.id = 'rf-dialog-title'; else dialog.querySelector('.rf-dialog')?.setAttribute('aria-label', '人才管理操作对话框');
    dialog.querySelectorAll('.rf-dialog-message').forEach((message) => {
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');
      message.setAttribute('aria-atomic', 'true');
    });
    applyActionPermissions(dialog);
    dialog.querySelector('.rf-dialog-close')?.addEventListener('click', cancelTalentDialog);
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('header .rf-dialog-back')) {
        event.preventDefault();
        cancelTalentDialog();
        return;
      }
      const button = event.target.closest('[data-rf-more-toggle]');
      if (!button) return;
      const menu = button.closest('#rf-talent-dialog')?.querySelector('[data-rf-more-menu]');
      const open = menu?.hidden;
      if (menu) menu.hidden = !open;
      button.setAttribute('aria-expanded', String(Boolean(open)));
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter((node) => !node.hidden && node.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    requestAnimationFrame(() => {
      const firstField = dialog.querySelector('[autofocus], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
      firstField?.focus();
    });
    return token;
  }
  function showGlobalLoading(message) {
    document.getElementById('rf-global-loading')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div id="rf-global-loading" class="rf-global-loading" role="status" aria-live="polite"><div class="rf-global-loading-panel"><i></i><strong>正在处理</strong><span>${escapeHtml(message || '请稍候…')}</span></div></div>`);
    return (nextMessage) => { const node = document.querySelector('#rf-global-loading span'); if (node && nextMessage) node.textContent = nextMessage; };
  }
  function hideGlobalLoading() { document.getElementById('rf-global-loading')?.remove(); }

  async function openDuplicateWorkbench() {
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，接口可用后才能处理疑似重复人才。', true);
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取疑似重复队列…</div>', 'wide');
    try {
      const result = await request('api/talents/duplicates?status=待处理');
      if (!isTalentDialogCurrent(token)) return;
      state.duplicateCases = result.cases || [];
      renderDuplicateQueue();
    } catch (error) { dialogFailure('查重队列读取失败', error, openDuplicateWorkbench, token); }
  }

  function renderDuplicateQueue() {
    showTalentDialog(`
      <header class="rf-dialog-head"><div><span>TALENT DEDUPLICATION</span><h2>疑似重复人才</h2><p>系统只提出疑似关系，由人工核对后决定合并或保留两份独立档案。</p></div><button class="btn-soft" data-rf-scan-duplicates type="button">重新扫描</button></header>
      <div class="rf-duplicate-queue">${state.duplicateCases.length ? state.duplicateCases.map((item) => `<button type="button" data-rf-case="${escapeHtml(item.id)}"><span><b>${escapeHtml(item.left?.name || item.leftName || '人才A')}</b><i>VS</i><b>${escapeHtml(item.right?.name || item.rightName || '人才B')}</b></span><strong>${Number(item.score || 0)}<small>相似分</small></strong><p>${(item.reasons || []).map(escapeHtml).join(' · ') || '姓名或履历存在相似项'}</p><em>进入人工核对 ›</em></button>`).join('') : '<div class="rf-dialog-empty"><strong>当前没有待处理的疑似重复档案</strong><p>新增简历入库时会自动查重，也可以点击“重新扫描”检查存量人才。</p></div>'}</div>`, 'wide');
    document.querySelector('[data-rf-scan-duplicates]')?.addEventListener('click', scanDuplicates);
    document.querySelectorAll('[data-rf-case]').forEach((button) => button.addEventListener('click', () => openDuplicateCase(button.dataset.rfCase)));
  }

  async function scanDuplicates() {
    try {
      await request('api/talents/duplicates/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operator: '当前用户' }) });
      await openDuplicateWorkbench();
    } catch (error) { notifyUser(error.message || '查重扫描失败', 'error', scanDuplicates); }
  }

  async function openDuplicateCase(caseId) {
    const token = showTalentDialog('<div class="rf-dialog-loading">正在生成字段对比…</div>', 'wide');
    try {
      state.duplicateCase = await request(`api/talents/duplicates/${encodeURIComponent(caseId)}`);
      if (!isTalentDialogCurrent(token)) return;
      state.duplicateResult = null;
      renderDuplicateCase();
    } catch (error) { dialogFailure('字段对比读取失败', error, () => openDuplicateCase(caseId), token); }
  }

  function renderDuplicateCase() {
    const item = state.duplicateCase;
    const left = item.left || {};
    const right = item.right || {};
    showTalentDialog(`
      <header class="rf-dialog-head"><div><button class="rf-dialog-back" data-rf-duplicate-back type="button">← 返回队列</button><span>人工查重 · ${Number(item.score || 0)} 相似分</span><h2>${escapeHtml(left.name || '人才A')} 与 ${escapeHtml(right.name || '人才B')}</h2><p>先选择保留的主档，再为有差异的字段决定采用哪一份。所有关联简历、应聘和流程记录会迁移到主档。</p></div></header>
      <div class="rf-primary-choice"><span>保留为人才主档</span><label><input type="radio" name="rf-primary" value="${escapeHtml(left.id)}" checked> ${escapeHtml(left.name || left.id)} · ${escapeHtml(left.updatedTime || '时间待补充')}</label><label><input type="radio" name="rf-primary" value="${escapeHtml(right.id)}"> ${escapeHtml(right.name || right.id)} · ${escapeHtml(right.updatedTime || '时间待补充')}</label></div>
      <div class="rf-compare-table"><div class="rf-compare-head"><span>字段</span><strong>${escapeHtml(left.name || '人才A')}</strong><strong>${escapeHtml(right.name || '人才B')}</strong></div>${(item.comparison || []).map((field) => `<div class="${field.same ? 'same' : ''}"><span>${escapeHtml(field.label)}</span><label><input type="radio" name="rf-field-${escapeHtml(field.key)}" value="primary" checked><b>${escapeHtml(Array.isArray(field.left) ? field.left.join('、') : field.left || '空')}</b></label><label><input type="radio" name="rf-field-${escapeHtml(field.key)}" value="secondary"><b>${escapeHtml(Array.isArray(field.right) ? field.right.join('、') : field.right || '空')}</b></label></div>`).join('')}</div>
      <label class="rf-dialog-note"><span>人工判断依据 <b>*</b></span><textarea id="rf-duplicate-reason" placeholder="例如：手机号一致，工作经历为同一人的新旧版本；或姓名相同但学校和联系方式完全不同。"></textarea></label>
      <div class="rf-dialog-actions"><button class="btn-soft danger" data-rf-not-duplicate type="button">确认不是同一人</button><button class="btn-primary" data-rf-merge type="button">确认合并档案</button></div>
      <p class="rf-dialog-message" id="rf-duplicate-message"></p>`, 'wide');
    document.querySelector('[data-rf-duplicate-back]')?.addEventListener('click', renderDuplicateQueue);
    document.querySelector('[data-rf-merge]')?.addEventListener('click', mergeDuplicateCase);
    document.querySelector('[data-rf-not-duplicate]')?.addEventListener('click', excludeDuplicateCase);
  }

  function duplicateMessage(message, error = false) {
    const node = document.getElementById('rf-duplicate-message');
    if (node) { node.textContent = message; node.classList.toggle('error', error); }
  }

  async function mergeDuplicateCase() {
    const item = state.duplicateCase;
    const reason = document.getElementById('rf-duplicate-reason')?.value.trim() || '';
    if (!reason) return duplicateMessage('请先填写人工判断依据。', true);
    const primaryCandidateId = document.querySelector('input[name="rf-primary"]:checked')?.value;
    const leftIsPrimary = primaryCandidateId === item.left.id;
    const fieldSources = {};
    (item.comparison || []).forEach((field) => {
      const selected = document.querySelector(`input[name="rf-field-${CSS.escape(field.key)}"]:checked`)?.value || 'primary';
      fieldSources[field.key] = selected === 'primary' ? 'primary' : 'secondary';
      if (!leftIsPrimary) fieldSources[field.key] = fieldSources[field.key] === 'primary' ? 'secondary' : 'primary';
    });
    try {
      duplicateMessage('正在合并字段并迁移关联记录…');
      const result = await request(`api/talents/duplicates/${encodeURIComponent(item.id)}/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ primaryCandidateId, fieldSources, reason, operator: '当前用户' }) });
      state.duplicateResult = result;
      showTalentDialog(`<div class="rf-operation-result"><i>✓</i><span>人才档案已合并</span><h2>已保留主档并迁移 ${Number(result.migratedRecords || 0)} 条关联记录</h2><p>副档已归档，不会继续出现在人才主列表。合并事件和字段选择均已留痕。</p><div><button class="btn-soft" data-rf-undo-merge type="button">撤销本次合并</button><button class="btn-primary" data-rf-merge-done type="button">完成</button></div><small id="rf-undo-message"></small></div>`);
      document.querySelector('[data-rf-undo-merge]')?.addEventListener('click', undoDuplicateMerge);
      document.querySelector('[data-rf-merge-done]')?.addEventListener('click', async () => { closeTalentDialog(); await loadTalentArchive(false); });
    } catch (error) { duplicateMessage(error.message || '人才合并失败', true); }
  }

  async function excludeDuplicateCase() {
    const reason = document.getElementById('rf-duplicate-reason')?.value.trim() || '';
    if (!reason) return duplicateMessage('请填写确认不是同一人的判断依据。', true);
    try {
      duplicateMessage('正在保存人工判断…');
      await request(`api/talents/duplicates/${encodeURIComponent(state.duplicateCase.id)}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result: 'not_duplicate', note: reason, operator: '当前用户' }) });
      await loadTalentArchive(false);
      await openDuplicateWorkbench();
    } catch (error) { duplicateMessage(error.message || '保存判断失败', true); }
  }

  async function undoDuplicateMerge() {
    const reason = window.prompt('请填写撤销合并原因。系统仅在主档合并后未被继续修改时允许安全撤销：');
    if (!reason) return;
    const message = document.getElementById('rf-undo-message');
    try {
      if (message) message.textContent = '正在恢复两份人才档案和关联记录…';
      const result = await request(`api/talents/merges/${encodeURIComponent(state.duplicateResult.mergeId)}/undo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, operator: '当前用户' }) });
      if (message) message.textContent = `已撤销，恢复 ${Number(result.restoredRecords || 0)} 条关联记录。`;
      document.querySelector('[data-rf-undo-merge]')?.setAttribute('disabled', 'disabled');
      await loadTalentArchive(false);
    } catch (error) { if (message) message.textContent = error.message || '撤销失败'; }
  }

  function openOwnershipDialog() {
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，接口可用后才能分配负责人。', true);
    const item = state.talentDetails[state.activeId] || state.talents.find((row) => row.id === state.activeId) || {};
    showTalentDialog(`<header class="rf-dialog-head"><div><span>人才协作</span><h2>分配人才负责人</h2><p>负责人主导后续沟通与流程推进，所有变更都会留痕。</p></div></header><div class="rf-dialog-form"><label><span>负责人姓名</span><input id="rf-owner-name" value="${escapeHtml(item.owner === '待分配' ? '' : item.owner || '')}" placeholder="请输入负责人姓名"></label><label><span>负责人账号 ID（选填）</span><input id="rf-owner-id" value="${escapeHtml(item.ownerUserId || '')}" placeholder="用于账号唯一识别"></label><label class="wide"><span>分配原因</span><textarea id="rf-owner-reason" placeholder="例如：由数据中台招聘负责人持续跟进"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-save-owner type="button">保存负责人</button></div><p class="rf-dialog-message" id="rf-owner-message"></p>`);
    document.querySelector('[data-rf-save-owner]')?.addEventListener('click', saveOwnership);
  }

  async function saveOwnership() {
    const owner = document.getElementById('rf-owner-name')?.value.trim() || '';
    const ownerUserId = document.getElementById('rf-owner-id')?.value.trim() || '';
    const reason = document.getElementById('rf-owner-reason')?.value.trim() || '';
    const message = document.getElementById('rf-owner-message');
    if (!owner || !reason) { if (message) { message.textContent = '请填写负责人和分配原因。'; message.classList.add('error'); } return; }
    try {
      state.talentDetails[state.activeId] = await request(`api/talents/${encodeURIComponent(state.activeId)}/ownership`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner, ownerUserId, reason, operator: '当前用户' }) });
      closeTalentDialog();
      await loadTalentArchive(false);
    } catch (error) { if (message) { message.textContent = error.message || '负责人分配失败'; message.classList.add('error'); } }
  }

  function openBirthYearDialog() {
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，接口可用后才能修正出生年份。', true);
    const item = state.talentDetails[state.activeId] || {};
    const signals = item.birthYearConflict?.signals || [];
    const evidence = signals.length ? signals.map((signal) => `<li><strong>${Number(signal.year)}年</strong><span>${escapeHtml(signal.source)}</span></li>`).join('') : '<li><span>当前简历和主档没有可比较的年份信号，请根据候选人确认或有效材料填写。</span></li>';
    showTalentDialog(`<header class="rf-dialog-head"><div><span>DATA REVIEW</span><h2>核对出生年份</h2><p>系统只保存出生年份，页面年龄按当前年份动态计算。人工修正不会用于AI评分。</p></div></header><div class="rf-birth-evidence"><strong>现有依据</strong><ul>${evidence}</ul></div><div class="rf-dialog-form"><label><span>确认出生年份</span><input id="rf-birth-year" type="number" min="1946" max="2011" value="${item.birthYear || ''}" placeholder="例如 1996"></label><label><span>修正后当前年龄</span><input id="rf-birth-age-preview" value="${item.birthYear ? new Date().getFullYear() - Number(item.birthYear) : ''}" disabled></label><label class="wide"><span>核对依据与修正原因</span><textarea id="rf-birth-reason" placeholder="例如：候选人确认出生年份为1996年，原简历年龄为旧年份数据"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-save-birth-year type="button">确认并保存</button></div><p class="rf-dialog-message" id="rf-birth-message"></p>`);
    document.getElementById('rf-birth-year')?.addEventListener('input', (event) => { document.getElementById('rf-birth-age-preview').value = event.target.value ? String(new Date().getFullYear() - Number(event.target.value)) : ''; });
    document.querySelector('[data-rf-save-birth-year]')?.addEventListener('click', saveBirthYear);
  }

  async function saveBirthYear() {
    const birthYear = Number(document.getElementById('rf-birth-year')?.value || 0), reason = document.getElementById('rf-birth-reason')?.value.trim() || '';
    const message = document.getElementById('rf-birth-message');
    if (!birthYear || !reason) { message.textContent = '请填写出生年份和核对依据。'; message.classList.add('error'); return; }
    try {
      message.textContent = '正在保存人工修正和审计记录…'; message.classList.remove('error');
      state.talentDetails[state.activeId] = await request(`api/talents/${encodeURIComponent(state.activeId)}/birth-year`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ birthYear, reason, operator: '当前用户' }) });
      closeTalentDialog();
      await loadTalentArchive(false);
      notifyUser('出生年份已人工确认，年龄将按当前年份动态计算。', 'success');
    } catch (error) { message.textContent = error.message || '出生年份保存失败'; message.classList.add('error'); }
  }

  async function toggleContactLock() {
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，接口可用后才能占用联系权限。', true);
    const item = state.talentDetails[state.activeId] || {};
    const lock = item.contactLock || {};
    const active = lock.status === '生效中' && (!lock.expiresAt || Date.parse(lock.expiresAt) > Date.now());
    try {
      setTalentMessage(active ? '正在释放联系锁…' : '正在锁定人才联系权限…');
      if (active) await request(`api/talents/${encodeURIComponent(state.activeId)}/contact-lock/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '当前用户结束本次联系操作', operator: '当前用户' }) });
      else await request(`api/talents/${encodeURIComponent(state.activeId)}/contact-lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operator: '当前用户', durationMinutes: 60 }) });
      await loadTalentDetail(state.activeId);
      setTalentMessage(active ? '联系锁已释放，其他招聘人员可以继续跟进。' : '已锁定 60 分钟，请在联系结束后及时释放。');
    } catch (error) { setTalentMessage(error.message || '联系状态更新失败', true); }
  }

  async function openStaleOwnershipDialog() {
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，接口可用后才能检查长期未跟进人才。', true);
    const token = showTalentDialog('<div class="rf-dialog-loading">正在检查负责人名下长期未跟进的人才…</div>');
    try {
      const result = await request('api/talents/ownership/release-stale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inactiveDays: 14, dryRun: true, operator: '当前用户' }) });
      if (!isTalentDialogCurrent(token)) return;
      showTalentDialog(`<header class="rf-dialog-head"><div><span>OWNERSHIP GOVERNANCE</span><h2>长期未跟进人才释放</h2><p>默认检查连续14天无沟通、无流程处理的人才。Offer、背调、待入职和已入职阶段不会自动释放。</p></div></header><div class="rf-stale-summary"><strong>${Number(result.total || 0)}</strong><span>位人才符合释放条件</span></div><div class="rf-stale-list">${(result.candidates || []).length ? result.candidates.map((item) => `<article><div><strong>${escapeHtml(item.name || '未识别姓名')}</strong><small>当前负责人：${escapeHtml(item.owner || '待分配')}</small></div><span>最近活动<br>${escapeHtml(item.lastActivityAt || '无记录')}</span></article>`).join('') : '<div class="rf-dialog-empty"><strong>当前无需释放</strong><p>负责人名下人才均在规则周期内有有效跟进。</p></div>'}</div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-release-stale type="button" ${result.total ? '' : 'disabled'}>确认释放至公共人才池</button></div><p class="rf-dialog-message" id="rf-stale-message"></p>`);
      document.querySelector('[data-rf-release-stale]')?.addEventListener('click', releaseStaleOwnership);
    } catch (error) { dialogFailure('长期未跟进人才检查失败', error, openStaleOwnershipDialog, token); }
  }

  async function releaseStaleOwnership() {
    const message = document.getElementById('rf-stale-message');
    try {
      if (message) message.textContent = '正在释放人才归属并记录审计…';
      const result = await request('api/talents/ownership/release-stale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inactiveDays: 14, dryRun: false, operator: '当前用户' }) });
      if (message) message.textContent = `已释放 ${Number(result.released || 0)} 位人才至公共人才池。`;
      document.querySelector('[data-rf-release-stale]')?.setAttribute('disabled', 'disabled');
      await loadTalentArchive(false);
    } catch (error) { if (message) { message.textContent = error.message || '释放失败'; message.classList.add('error'); } }
  }

  async function openReviewWorkbench() {
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，接口可用后才能进入审查工作台。', true);
    const token = showTalentDialog('<div class="rf-dialog-loading">正在整理业务群评审队列和逾期跟进…</div>', 'wide');
    try {
      const [queue, followUps] = await Promise.all([request('api/talents/review-queue'), request('api/talents/follow-ups/overdue')]);
      if (!isTalentDialogCurrent(token)) return;
      state.reviewQueue = { ...queue, followUps };
      renderReviewWorkbench();
    } catch (error) { dialogFailure('审查工作台读取失败', error, openReviewWorkbench, token); }
  }

  function renderReviewWorkbench() {
    const queue = state.reviewQueue || { items: [], followUps: { items: [] } };
    showTalentDialog(`
      <header class="rf-dialog-head"><div><span>BUSINESS GROUP REVIEW</span><h2>业务群评审工作台</h2><p>AI完成岗位匹配和评分后推送业务群，由业务人员判断是否适合当前岗位。</p></div><button class="btn-soft" data-rf-sync-followups type="button">同步跟进待办</button></header>
      <div class="rf-review-metrics"><article><span>待审查</span><strong>${Number(queue.total || 0)}</strong></article><article><span>高匹配</span><strong>${Number(queue.highMatch || 0)}</strong></article><article><span>风险待确认</span><strong>${Number(queue.riskPending || 0)}</strong></article><article><span>等待超3天</span><strong>${Number(queue.overdue || 0)}</strong></article><article class="warn"><span>逾期跟进</span><strong>${Number(queue.followUps?.overdue || 0)}</strong></article></div>
      <div class="rf-review-layout"><section><div class="rf-review-title"><strong>审查队列</strong><small>按AI匹配、风险和等待时间综合排序</small></div><div class="rf-review-list">${(queue.items || []).length ? queue.items.map((item) => `<article><div class="rf-review-person"><span>${escapeHtml((item.name || '候').slice(0, 1))}</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.positionName)} · ${escapeHtml(item.source)}</small></div></div><div class="rf-review-score"><b>${Number(item.matchScore || 0)}</b><small>匹配分</small></div><div class="rf-review-flags">${item.waitingDays ? `<span>等待${item.waitingDays}天</span>` : ''}${(item.risks || []).length ? `<em>${item.risks.length}项风险</em>` : '<span>无明显风险</span>'}</div><button type="button" data-rf-queue-review="${escapeHtml(item.candidateId)}">评审结论</button><button type="button" class="soft" data-rf-queue-communication="${escapeHtml(item.candidateId)}">记录沟通</button></article>`).join('') : '<div class="rf-dialog-empty"><strong>当前没有待审查人才</strong><p>新解析入库的人才会自动进入业务群评审队列。</p></div>'}</div></section><aside><div class="rf-review-title"><strong>跟进提醒</strong><small>${Number(queue.followUps?.total || 0)}项待处理</small></div><div class="rf-followup-list">${(queue.followUps?.items || []).length ? queue.followUps.items.slice(0, 8).map((item) => `<button type="button" data-rf-followup="${escapeHtml(item.candidateId)}" class="${item.overdue ? 'overdue' : ''}"><strong>${escapeHtml(item.name || '未识别姓名')}</strong><span>${escapeHtml(item.title)}</span><small>${item.overdue ? '已逾期 · ' : ''}${escapeHtml(item.deadline || '')}</small></button>`).join('') : '<div class="rf-dialog-empty"><p>当前没有待跟进提醒。</p></div>'}</div></aside></div>`, 'wide');
    document.querySelectorAll('[data-rf-queue-review]').forEach((button) => button.addEventListener('click', () => openReviewForm(button.dataset.rfQueueReview)));
    document.querySelectorAll('[data-rf-queue-communication], [data-rf-followup]').forEach((button) => button.addEventListener('click', () => openCommunicationDialog(button.dataset.rfQueueCommunication || button.dataset.rfFollowup)));
    document.querySelector('[data-rf-sync-followups]')?.addEventListener('click', syncFollowUps);
  }

  function openReviewForm(candidateId) {
    const item = (state.reviewQueue?.items || []).find((row) => row.candidateId === candidateId);
    if (!item) return;
    const profile = item.profile || {};
    const analysis = profile.analysis || {};
    showTalentDialog(`
      <header class="rf-dialog-head"><div><button class="rf-dialog-back" data-rf-review-back type="button">← 返回业务群评审</button><span>业务群评审</span><h2>${escapeHtml(item.name)} · ${escapeHtml(item.positionName)}</h2><p>AI匹配 ${Number(item.matchScore || 0)} 分，置信度 ${escapeHtml(item.confidence || '低')}。请根据岗位需要判断是否适合。</p></div></header>
      <div class="rf-review-evidence"><section><strong>AI提示的优势</strong>${(item.strengths || []).length ? `<ul>${item.strengths.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : '<p>暂无明确优势证据</p>'}</section><section class="risk"><strong>AI提示风险</strong>${(item.risks || []).length ? item.risks.map((value, index) => `<label><span>${escapeHtml(value)}</span><select data-rf-risk="${index}"><option value="待后续确认">待后续确认</option><option value="负责人已核实">负责人已核实</option><option value="可接受风险">可接受风险</option><option value="不可接受风险">不可接受风险</option></select></label>`).join('') : '<p>暂无AI风险提示</p>'}</section></div>
      <div class="rf-review-form"><label><span>评审结论 <b>*</b></span><select id="rf-review-decision"><option value="">请选择评审结论</option><option>通过</option><option>退回</option><option>储备</option><option>淘汰</option></select><small class="rf-schedule-error" hidden></small></label><label class="wide"><span>判断证据（每行一条）</span><textarea id="rf-review-evidence" placeholder="例如：有3年同岗位经验，项目职责和招聘需求一致"></textarea></label><label class="wide"><span>审查意见 <b>*</b></span><textarea id="rf-review-opinion" placeholder="说明为什么做出该结论，以及下一环节需要继续确认什么"></textarea><small class="rf-schedule-error" hidden></small></label><div class="rf-dialog-actions rf-review-actions"><button class="btn-soft" data-rf-review-back type="button">返回</button><button class="btn-primary" data-rf-submit-review type="button">提交审查结论</button></div><p class="rf-dialog-message" id="rf-review-message"></p></div>`, 'wide');
    document.querySelectorAll('[data-rf-review-back]').forEach((button) => button.addEventListener('click', renderReviewWorkbench));
    ['rf-review-decision', 'rf-review-opinion'].forEach((id) => {
      const node = document.getElementById(id);
      node?.addEventListener('input', () => clearScheduleFieldError(node));
      node?.addEventListener('change', () => clearScheduleFieldError(node));
    });
    document.querySelector('[data-rf-submit-review]')?.addEventListener('click', () => confirmAssessment(item));
  }

  async function confirmAssessment(item) {
    const decision = document.getElementById('rf-review-decision')?.value || '';
    const opinion = document.getElementById('rf-review-opinion')?.value.trim() || '';
    const evidence = (document.getElementById('rf-review-evidence')?.value || '').split('\n').map((value) => value.trim()).filter(Boolean);
    const riskFeedback = {};
    document.querySelectorAll('[data-rf-risk]').forEach((select, index) => { riskFeedback[(item.risks || [])[index] || `风险${index + 1}`] = select.value; });
    const decisionNode = document.getElementById('rf-review-decision');
    const opinionNode = document.getElementById('rf-review-opinion');
    markScheduleField(decisionNode, decision ? '' : '请选择评审结论');
    markScheduleField(opinionNode, opinion ? '' : '请填写审查意见');
    const message = document.getElementById('rf-review-message');
    if (!decision || !opinion) {
      (decision ? opinionNode : decisionNode)?.focus();
      return;
    }
    try {
      if (message) message.textContent = '正在保存业务群评审结论…';
      const result = await request(`api/talents/${encodeURIComponent(item.candidateId)}/assessment`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result: decision, note: opinion, operator: '当前用户' }) });
      if (result?.talent) state.talentDetails[item.candidateId] = result.talent;
      await loadTalentArchive(false);
      await openReviewWorkbench();
    } catch (error) { if (message) { message.textContent = error.message || '评审提交失败'; message.classList.add('error'); } }
  }

  async function syncFollowUps() {
    try { await request('api/talents/follow-ups/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operator: '当前用户' }) }); await openReviewWorkbench(); }
    catch (error) { notifyUser(error.message || '跟进待办同步失败', 'error', syncFollowUps); }
  }

  async function openCommunicationDialog(candidateId) {
    if (!candidateId) return;
    state.activeCommunicationCandidateId = candidateId;
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取沟通模板和历史记录…</div>', 'wide');
    const isStale = () => token !== talentDialogToken;
    try {
      const [templates, history, formOptions] = await Promise.all([
        request('api/talents/communication-templates'),
        request(`api/talents/${encodeURIComponent(candidateId)}/communications`),
        request('api/recruitment/form-options').catch(() => ({ employees: [] })),
      ]);
      if (isStale()) return;
      state.communicationTemplates = templates.templates || [];
      state.communicationHrOptions = formOptions.employees || [];
      state.communicationDefaultHr = history.defaultHr || {};
      const talent = state.talentDetails[candidateId] || state.talents.find((row) => row.id === candidateId) || (state.reviewQueue?.items || []).find((row) => row.candidateId === candidateId)?.profile || {};
      if (!isStale()) renderCommunicationDialog(talent, history.communications || []);
    } catch (error) { if (!isStale()) dialogFailure('沟通工作台读取失败', error, () => openCommunicationDialog(candidateId)); }
  }

  function countInterviewEvaluationCharacters(value) {
    return Array.from(String(value || '').replace(/\s/g, '')).length;
  }

  function bindInterviewEvaluationCounter(textarea, counter) {
    if (!textarea || !counter) return;
    const update = () => {
      const count = countInterviewEvaluationCharacters(textarea.value);
      counter.textContent = count >= 50 ? `已达标 · ${count}字` : `还差${50 - count}字 · 当前${count}/50字`;
    };
    textarea.addEventListener('input', update);
    update();
  }

  function communicationHistoryDetail(record) {
    const passed = ['推进面试', '约定面试', '通过'].includes(record.result);
    const operator = record.operator && !['当前用户', '意向沟通填写', '候选人自填'].includes(record.operator) ? record.operator : '未记录明确人员';
    const fields = [
      ['沟通HR', operator], ...(passed ? [['通过HR（本次沟通）', operator]] : []),
      ['沟通结果', record.result], ['沟通时间', record.occurredAt], ['沟通方式', record.channel], ['沟通方向', record.direction],
      ['完整摘要', record.summary], ['接通状态', record.answerStatus], ['兴趣度', record.interestLevel], ['在职状态', record.jobStatus],
      ['到岗时间', record.entryTime], ['离职原因', record.leaveReason], ['离职原因详情', record.leaveReasonDetail],
      ['婚姻状况', record.maritalStatus], ['居住区域', record.homeAddress], ['主要职责', record.workContent],
      ['当前薪酬整体情况', record.currentSalaryInfo], ['候选人关注点', record.candidateConcerns],
      ['当前加班强度', record.overtimeIntensity], ['加班接受度', record.overtimeAttitude], ['约面形式', record.interviewType],
      ['约面时间', record.interviewTime], ['淘汰/拒绝原因', record.rejectionReason], ['下一步行动', record.nextAction],
      ['下次跟进时间', record.nextFollowUpAt], ['再联系时间', record.recontactAt], ['沟通备注', record.notes],
    ];
    return `<dl class="rf-comm-history-detail">${fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '未记录')}</dd></div>`).join('')}</dl>`;
  }

  function renderCommunicationDialog(talent, history) {
    const defaultHr = state.communicationDefaultHr || {};
    const hrOptions = [...(state.communicationHrOptions || [])];
    if (defaultHr.id && !hrOptions.some((item) => item.id === defaultHr.id)) hrOptions.unshift({ id: defaultHr.id, name: defaultHr.name || defaultHr.id, department: '岗位负责HR' });
    const selectedHr = hrOptions.find((item) => item.id === defaultHr.id);
    state.communicationHrOptions = hrOptions;
    showTalentDialog(`
      <header class="rf-dialog-head"><div><span>INTENT COMMUNICATION</span><h2>记录与 ${escapeHtml(talent.name || '候选人')} 的沟通</h2><p>保存事实摘要、沟通结果和下一步时间。可粘贴电话或沟通文字，AI解析后仍需人工确认。</p></div></header>
      <section class="rf-comm-transcript">
        <label for="rf-comm-transcript-text"><span>AI解析沟通原文</span></label>
        <textarea id="rf-comm-transcript-text" rows="4" placeholder="例如：候选人已提离职，对岗位感兴趣，希望12月后到岗，目前薪资14k..."></textarea>
        <div class="rf-comm-transcript-actions"><button class="btn-soft" data-rf-comm-transcript-extract type="button">AI解析并填充</button><small id="rf-comm-transcript-status">只填充文本中明确提到的内容。</small></div>
      </section>
      <div class="rf-communication-layout"><section><div class="rf-dialog-form">
<label><span>沟通时间 <b>*</b></span><input id="rf-comm-time" type="datetime-local" value="${new Date().toISOString().slice(0,16)}"></label>
	<div class="rf-comm-hr-picker"><label for="rf-comm-hr"><span>沟通HR <b>*</b></span></label><select id="rf-comm-hr"><option value="">请选择沟通HR</option>${hrOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedHr?.id ? 'selected' : ''}>${escapeHtml(item.name)}${item.department ? ` · ${escapeHtml(item.department)}` : ''}</option>`).join('')}</select></div>
<label><span>沟通方式 <b>*</b></span><select id="rf-comm-channel"><option value="">请选择</option><option>电话</option><option>微信</option><option>邮件</option><option>短信</option><option>当面</option><option>其他</option></select></label>
<label><span>接通状态 <b>*</b></span><select id="rf-comm-answer-status"><option value="">请选择</option><option>已接通</option><option>未接听</option><option>拒接</option><option>关机</option><option>空号</option><option>微信回复</option></select></label>
<label><span>兴趣度 <b>*</b></span><select id="rf-comm-interest"><option value="">请选择</option><option>高</option><option>中</option><option>低</option><option>拒绝</option></select></label>
<label><span>在职状态 <b>*</b></span><select id="rf-comm-job-status"><option value="">请选择</option><option>已离职</option><option>在职已提离职</option><option>在职未提离职</option><option>应届生</option></select></label>
<label><span>到岗时间 <b>*</b></span><select id="rf-comm-entry-time"><option value="">请选择</option><option>随时</option><option>一周内</option><option>两周内</option><option>一个月内</option><option>不确定</option></select></label>
<label><span>离职原因 <b>*</b></span><select id="rf-comm-leave-reason"><option value="">请选择</option><option>薪资</option><option>发展</option><option>管理</option><option>家庭</option><option>通勤</option><option>公司变动</option><option>其他</option></select></label>
<label class="wide"><span>离职原因详情 <b>*</b></span><textarea id="rf-comm-leave-detail" rows="2" placeholder="打字记录具体离职背景和细节"></textarea></label>
<label><span>婚姻状况 <b>*</b></span><select id="rf-comm-marital"><option value="">请选择</option><option>已婚</option><option>未婚</option><option>其他</option></select></label>
<label class="wide"><span>居住区域 <b>*</b></span><textarea id="rf-comm-home" rows="2" placeholder="打字记录大致区域，用于判断通勤"></textarea></label>
<label class="wide"><span>主要职责 <b>*</b></span><textarea id="rf-comm-work" rows="3" placeholder="记录主要职责、是否带团队、项目成果"></textarea></label>
<label class="wide"><span>当前薪酬整体情况 <b>*</b></span><textarea id="rf-comm-salary" rows="3" placeholder="请填写底薪、提成/绩效、奖金、年终奖等完整薪酬总包信息"></textarea></label>
<label class="wide"><span>候选人关注点/顾虑 <b>*</b></span><textarea id="rf-comm-concerns" rows="3" placeholder="最关心的2-3个问题、犹豫点、底线条件"></textarea></label>
<label class="wide"><span>当前公司加班强度 <b>*</b></span><textarea id="rf-comm-overtime-intensity" rows="2" placeholder="上下班时间、加班频率、调休情况"></textarea></label>
<label class="wide"><span>对加班的看法/接受度 <b>*</b></span><textarea id="rf-comm-overtime-attitude" rows="2" placeholder="能接受什么强度、底线、期望补偿方式"></textarea></label>
<label><span>约面形式 <b>*</b></span><select id="rf-comm-interview-type"><option>待定</option><option>线上</option><option>线下</option></select></label>
<label><span>约面时间 <b>*</b></span><input id="rf-comm-interview-time" type="datetime-local"></label>
<label><span>沟通结果 <b>*</b></span><select id="rf-comm-result"><option value="">请选择</option><option>推进面试</option><option>放入人才库</option><option>淘汰</option><option>二次沟通</option></select></label>
<label class="wide"><span>淘汰原因 <b data-rf-comm-reject-star hidden>*</b></span><select id="rf-comm-reject-reason"><option value="">请选择</option><option>薪资不匹配</option><option>地点不匹配</option><option>已入职</option><option>无兴趣</option><option>经验不足</option><option>其他</option></select></label>
<label class="wide"><span>微信号（选填）</span><input id="rf-comm-wechat" value="${escapeHtml(talent.wechat || '')}" placeholder="录入后自动检查是否与其他人才重复"><small id="rf-wechat-check"></small></label>
<label class="wide"><span>沟通备注</span><textarea id="rf-comm-notes" rows="2" placeholder="一句话总结关键信息，便于快速回顾"></textarea></label>
</div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-save-communication type="button">保存沟通记录</button></div><p class="rf-dialog-message" id="rf-comm-message"></p></section><aside><div class="rf-review-title"><strong>历史沟通</strong><small>${history.length}条</small></div><div class="rf-communication-log">${history.length ? history.map((record) => `<details class="rf-comm-history"><summary><strong>${escapeHtml(record.result || record.type)} · ${escapeHtml(record.channel)}</strong><p>${escapeHtml(record.summary)}</p><small>${escapeHtml(record.occurredAt || '')} · ${escapeHtml(record.operator || '未记录')}</small><span class="rf-comm-history-open">查看完整记录</span></summary>${communicationHistoryDetail(record)}</details>`).join('') : '<div class="rf-dialog-empty"><p>暂无历史沟通记录。</p></div>'}</div></aside></div>`, 'wide');
    document.querySelectorAll('#rf-comm-time, #rf-comm-hr, #rf-comm-channel, #rf-comm-answer-status, #rf-comm-interest, #rf-comm-job-status, #rf-comm-entry-time, #rf-comm-leave-reason, #rf-comm-leave-detail, #rf-comm-marital, #rf-comm-home, #rf-comm-work, #rf-comm-salary, #rf-comm-concerns, #rf-comm-overtime-intensity, #rf-comm-overtime-attitude, #rf-comm-interview-type, #rf-comm-interview-time, #rf-comm-result, #rf-comm-reject-reason').forEach((node) => {
      node.closest('label, .rf-comm-hr-picker')?.insertAdjacentHTML('beforeend', '<small class="rf-schedule-error" hidden></small>');
      node.addEventListener('input', () => clearScheduleFieldError(node));
      node.addEventListener('change', () => clearScheduleFieldError(node));
    });
    document.getElementById('rf-comm-interview-type')?.querySelector('option')?.setAttribute('value', '');
    document.getElementById('rf-comm-interview-type').value = '';
    document.getElementById('rf-comm-result')?.addEventListener('change', () => {
      const rejectStar = document.querySelector('[data-rf-comm-reject-star]');
      if (rejectStar) rejectStar.hidden = document.getElementById('rf-comm-result')?.value !== '淘汰';
    });
    document.getElementById('rf-comm-wechat')?.addEventListener('blur', checkCommunicationWechat);
    document.querySelector('[data-rf-comm-transcript-extract]')?.addEventListener('click', extractCommunicationTranscript);
    document.querySelector('[data-rf-save-communication]')?.addEventListener('click', saveCommunication);
  }

  async function waitForBackgroundJob(jobId, progress = () => {}, options = {}) {
    const deadline = Date.now() + (options.timeoutMs || 600000);
    let failures = 0;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      let job;
      try {
        job = await request(`api/jobs/${encodeURIComponent(jobId)}`, { jobQuery: true });
        failures = 0;
      } catch (error) {
        failures += 1;
        if ([400, 401, 403, 404].includes(error.status) || failures >= 3) {
          error.jobId = jobId;
          throw error;
        }
        progress('网络暂时不稳定，正在重新查询处理进度，请勿重复提交…');
        continue;
      }
      if (job.status === 'done') return job.data;
      if (job.status === 'failed') {
        const error = new Error(job.error || '后台处理失败');
        error.jobFailed = true;
        throw error;
      }
      progress(`${job.progress || '正在后台处理'}（无需重复点击）`);
    }
    const error = new Error(options.timeoutMessage || '任务仍在后台处理，请稍后查看处理结果，勿重复提交。');
    error.jobId = jobId;
    throw error;
  }

  async function requestCommunicationExtraction(path, transcript, status) {
    if (transcript.length > 20000) throw new Error('文本最多20000字，请精简后再解析');
    const started = await request(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, background: true }), timeoutMs: 45000,
    });
    if (!started.jobId) return started;
    return waitForBackgroundJob(started.jobId, message => { if (status) status.textContent = message; }, {
      timeoutMs: 240000, timeoutMessage: '解析等待超时，原文已保留，可稍后重试或手动填写。',
    });
  }

  async function extractCommunicationTranscript() {
    const transcript = document.getElementById('rf-comm-transcript-text')?.value.trim() || '';
    const status = document.getElementById('rf-comm-transcript-status');
    const button = document.querySelector('[data-rf-comm-transcript-extract]');
    if (!transcript) {
      if (status) { status.textContent = '请先粘贴沟通文字记录。'; status.classList.add('error'); }
      return;
    }
    if (button) button.disabled = true;
    if (status) { status.textContent = 'AI正在解析沟通记录…'; status.classList.remove('error'); }
    try {
      const result = await requestCommunicationExtraction('api/talents/communications/transcript-extract', transcript, status);
      if (!button?.isConnected) return;
      const extraction = result.extraction || {};
      const setSelect = (id, value) => {
        const node = document.getElementById(id);
        if (node && value) node.value = value;
      };
      const setText = (id, value) => {
        const node = document.getElementById(id);
        if (node && value) node.value = value;
      };
      setSelect('rf-comm-channel', extraction.channel);
      setSelect('rf-comm-answer-status', extraction.answerStatus);
      setSelect('rf-comm-interest', extraction.interestLevel);
      setSelect('rf-comm-job-status', extraction.jobStatus);
      setSelect('rf-comm-entry-time', extraction.entryTime);
      setSelect('rf-comm-leave-reason', extraction.leaveReason);
      setSelect('rf-comm-marital', extraction.maritalStatus);
      setSelect('rf-comm-interview-type', extraction.interviewType);
      setSelect('rf-comm-result', extraction.result);
      setSelect('rf-comm-reject-reason', extraction.rejectionReason);
      setText('rf-comm-interview-time', extraction.interviewTime);
      setText('rf-comm-leave-detail', extraction.leaveReasonDetail);
      setText('rf-comm-home', extraction.homeAddress);
      setText('rf-comm-work', extraction.workContent);
      setText('rf-comm-salary', extraction.currentSalaryInfo);
      setText('rf-comm-concerns', extraction.candidateConcerns);
      setText('rf-comm-overtime-intensity', extraction.overtimeIntensity);
      setText('rf-comm-overtime-attitude', extraction.overtimeAttitude);
      setText('rf-comm-notes', extraction.notes);
      if (status) status.textContent = '解析完成：仅填充明确提到的内容，请检查后再保存。';
    } catch (error) {
      if (status) { status.textContent = `${conciseError(error)}。原文和已填写内容已保留，可重试或手动填写。`; status.classList.add('error'); }
    } finally {
      if (button) button.disabled = false;
    }
  }

  function applyCommunicationTemplate(event) {
    const template = state.communicationTemplates.find((item) => item.id === event.target.value);
    if (template) document.getElementById('rf-comm-summary').value = template.content;
  }

  async function checkCommunicationWechat() {
    const value = document.getElementById('rf-comm-wechat')?.value.trim() || '';
    const node = document.getElementById('rf-wechat-check');
    if (!value || !node) return;
    try {
      const result = await request(`api/talents/communications/wechat-check?wechat=${encodeURIComponent(value)}&candidateId=${encodeURIComponent(state.activeCommunicationCandidateId)}`);
      node.textContent = result.duplicate ? `发现与 ${result.matches.map((item) => item.name || item.candidateId).join('、')} 的档案重复，请先核对` : '未发现其他人才使用该微信号';
      node.classList.toggle('error', result.duplicate);
    } catch (error) { node.textContent = conciseError(error); }
  }

  function schedulingEntryUrl(candidateId) {
    const url = new URL('.', window.location.href);
    url.searchParams.set('flow_action', 'schedule');
    url.searchParams.set('candidate_id', candidateId);
    return url.toString();
  }

  function showCommunicationCompletion(candidateId, publicPage = false) {
    document.getElementById('rf-communication-complete')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'rf-communication-complete';
    dialog.className = 'rf-communication-complete';
    dialog.setAttribute('aria-labelledby', 'rf-communication-complete-title');
    dialog.setAttribute('aria-describedby', 'rf-communication-complete-description');
    const canSchedule = Boolean(candidateId && (publicPage || (window.canOpenRecruitmentPage?.('interviews') && hasAccessAction('arrange_interview'))));
    dialog.innerHTML = `<div class="rf-public-success"><i aria-hidden="true">✓</i><h2 id="rf-communication-complete-title">已提交</h2><p id="rf-communication-complete-description">请留意系统消息</p>${canSchedule ? '<button type="button" class="btn-primary" data-communication-schedule autofocus>直接约面</button>' : ''}<button type="button" class="${canSchedule ? 'btn-soft' : 'btn-primary'}" data-communication-dismiss ${canSchedule ? '' : 'autofocus'}>知道了</button></div>`;
    document.body.append(dialog);
    dialog.querySelector('[data-communication-dismiss]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-communication-schedule]')?.addEventListener('click', () => {
      const target = schedulingEntryUrl(candidateId);
      if (publicPage) { window.location.assign(target); return; }
      if (!window.canOpenRecruitmentPage?.('interviews') || !hasAccessAction('arrange_interview')) return notifyUser('当前账号没有安排面试的权限，请联系招聘负责人。', 'info');
      dialog.close();
      window.history.replaceState({}, '', target);
      window.setPage?.('interviews');
      void openScheduleInterview(candidateId);
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
  }

  async function saveCommunication() {
    const candidateId = state.activeCommunicationCandidateId;
    const submit = document.querySelector('[data-rf-save-communication]');
    if (submit?.disabled) return;
    const resultValue = document.getElementById('rf-comm-result')?.value || '';
    const channel = document.getElementById('rf-comm-channel')?.value || '';
    const interestLevel = document.getElementById('rf-comm-interest')?.value || '';
    const jobStatus = document.getElementById('rf-comm-job-status')?.value || '';
    const leaveReason = document.getElementById('rf-comm-leave-reason')?.value || '';
    const answerStatus = document.getElementById('rf-comm-answer-status')?.value || '';
    const rejectReason = document.getElementById('rf-comm-reject-reason')?.value || '';
    const transcript = document.getElementById('rf-comm-transcript-text')?.value.trim() || '';
    const summary = [
      interestLevel ? `兴趣度:${interestLevel}` : '',
      jobStatus ? `在职状态:${jobStatus}` : '',
      document.getElementById('rf-comm-entry-time')?.value ? `到岗时间:${document.getElementById('rf-comm-entry-time').value}` : '',
      document.getElementById('rf-comm-salary')?.value.trim() ? `薪酬:${document.getElementById('rf-comm-salary').value.trim()}` : '',
      document.getElementById('rf-comm-concerns')?.value.trim() ? `关注点:${document.getElementById('rf-comm-concerns').value.trim()}` : '',
      document.getElementById('rf-comm-notes')?.value.trim() ? `备注:${document.getElementById('rf-comm-notes').value.trim()}` : '',
    ].filter(Boolean).join('；');
    const payload = {
      type: '意向沟通', channel, direction: '呼出',
      summary: summary, result: resultValue,
      nextAction: '', nextFollowUpAt: document.getElementById('rf-comm-interview-time')?.value || '',
      wechat: document.getElementById('rf-comm-wechat')?.value.trim() || '', templateId: '',
      rejectionReason: resultValue === '淘汰' ? rejectReason : '', recontactAt: '',
      operatorUserId: document.getElementById('rf-comm-hr')?.value || '',
      operator: (state.communicationHrOptions || []).find((item) => item.id === document.getElementById('rf-comm-hr')?.value)?.name || '',
      answerStatus, interestLevel, jobStatus, entryTime: document.getElementById('rf-comm-entry-time')?.value || '',
      leaveReason, leaveReasonDetail: document.getElementById('rf-comm-leave-detail')?.value.trim() || '',
      maritalStatus: document.getElementById('rf-comm-marital')?.value || '',
      homeAddress: document.getElementById('rf-comm-home')?.value.trim() || '',
      workContent: document.getElementById('rf-comm-work')?.value.trim() || '',
      currentSalaryInfo: document.getElementById('rf-comm-salary')?.value.trim() || '',
      candidateConcerns: document.getElementById('rf-comm-concerns')?.value.trim() || '',
      overtimeIntensity: document.getElementById('rf-comm-overtime-intensity')?.value.trim() || '',
      overtimeAttitude: document.getElementById('rf-comm-overtime-attitude')?.value.trim() || '',
      interviewType: document.getElementById('rf-comm-interview-type')?.value || '',
      interviewTime: document.getElementById('rf-comm-interview-time')?.value || '',
      notes: transcript || document.getElementById('rf-comm-notes')?.value.trim() || '',
    };
    const message = document.getElementById('rf-comm-message');
    const communicationChecks = [
      ['rf-comm-time', '请选择沟通时间'],
      ['rf-comm-hr', '请选择沟通HR'],
      ['rf-comm-channel', '请选择沟通方式'],
      ['rf-comm-answer-status', '请选择接通状态'],
      ['rf-comm-interest', '请选择兴趣度'],
      ['rf-comm-job-status', '请选择在职状态'],
      ['rf-comm-entry-time', '请选择到岗时间'],
      ['rf-comm-leave-reason', '请选择离职原因'],
      ['rf-comm-leave-detail', '请填写离职原因详情'],
      ['rf-comm-marital', '请选择婚姻状况'],
      ['rf-comm-home', '请填写居住区域'],
      ['rf-comm-work', '请填写主要职责'],
      ['rf-comm-salary', '请填写当前薪酬整体情况'],
      ['rf-comm-concerns', '请填写候选人关注点或顾虑'],
      ['rf-comm-overtime-intensity', '请填写当前公司加班强度'],
      ['rf-comm-overtime-attitude', '请填写对加班的看法或接受度'],
      ['rf-comm-interview-type', '请选择约面形式'],
      ['rf-comm-interview-time', '请选择约面时间'],
      ['rf-comm-result', '请选择沟通结果'],
    ];
    if (resultValue === '淘汰') communicationChecks.push(['rf-comm-reject-reason', '请选择淘汰原因']);
    let firstCommunicationError = null;
    communicationChecks.forEach(([id, error]) => {
      const node = document.getElementById(id);
      const invalid = !String(node?.value || '').trim();
      markScheduleField(node, invalid ? error : '');
      if (invalid && !firstCommunicationError) firstCommunicationError = node;
    });
    if (resultValue !== '淘汰') markScheduleField(document.getElementById('rf-comm-reject-reason'), '');
    if (firstCommunicationError) {
      const focusTarget = firstCommunicationError.closest('.rf-combobox')?.querySelector('.rf-combobox-input') || firstCommunicationError;
      focusTarget.focus();
      scheduleFieldHost(firstCommunicationError)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    try {
      if (submit) submit.disabled = true;
      if (message) message.textContent = '正在保存沟通记录…';
      const saved = await request(`api/talents/${encodeURIComponent(candidateId)}/communications`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      closeTalentDialog(false);
      showCommunicationCompletion(saved.candidateId || candidateId);
      void loadTalentArchive(false).catch(() => notifyUser('沟通已提交，列表刷新失败，请稍后刷新查看。', 'info'));
    } catch (error) { if (submit) submit.disabled = false; if (message) { message.textContent = error.message || '沟通记录保存失败'; message.classList.add('error'); } }
  }

  async function createCommunicationTemplate() {
    const name = document.getElementById('rf-template-name')?.value.trim() || '';
    const category = document.getElementById('rf-template-category')?.value || '';
    const content = document.getElementById('rf-template-content')?.value.trim() || '';
    if (!name || !content) return notifyUser('请填写模板名称和模板内容', 'info');
    try {
      await request('api/talents/communication-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, category, content, status: '启用', operator: '当前用户' }) });
      await openCommunicationDialog(state.activeCommunicationCandidateId);
    } catch (error) { notifyUser(error.message || '模板保存失败', 'error', createCommunicationTemplate); }
  }

  async function openAssessmentWorkbench() {
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，接口可用后才能管理在线测评。', true);
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取题库、题单和候选人提交记录…</div>', 'wide');
    try {
      const [questions, templates, submissions, positions] = await Promise.all([
        request('api/assessments/questions'), request('api/assessments/templates'), request('api/assessments/submissions'), loadPositionOptions(),
      ]);
      if (!isTalentDialogCurrent(token)) return;
      state.assessmentData = { questions: questions.questions || [], templates: templates.templates || [], submissions: submissions.submissions || [], positions };
      renderAssessmentWorkbench();
    } catch (error) { dialogFailure('测评工作台读取失败', error, openAssessmentWorkbench, token); }
  }

  function renderAssessmentWorkbench() {
    const data = state.assessmentData || { questions: [], templates: [], submissions: [] };
    const submitted = data.submissions.filter((item) => ['已提交','已评分'].includes(item.status));
    showTalentDialog(`
      <header class="rf-dialog-head"><div><span>ONLINE ASSESSMENT</span><h2>在线测评与信息收集</h2><p>题目先进入草稿和人工审核，再发布给候选人。AI出题和评分均为辅助草稿，不直接替代人工决策。</p></div><div class="rf-assessment-head-actions"><button class="btn-soft" data-rf-ai-draft type="button">AI生成当前人才题单</button><button class="btn-primary" data-rf-new-question type="button">新增题目</button></div></header>
      <div class="rf-review-metrics"><article><span>题库题目</span><strong>${data.questions.length}</strong></article><article><span>题单模板</span><strong>${data.templates.length}</strong></article><article><span>已发布题单</span><strong>${data.templates.filter((item) => item.status === '已发布').length}</strong></article><article><span>答题中</span><strong>${data.submissions.filter((item) => item.status === '答题中').length}</strong></article><article class="warn"><span>待人工评分</span><strong>${submitted.filter((item) => item.status !== '已评分').length}</strong></article></div>
      <div class="rf-assessment-columns"><section><div class="rf-review-title"><strong>题单模板</strong><button data-rf-new-template type="button">组合新题单</button></div><div class="rf-assessment-template-list">${data.templates.length ? data.templates.map((item) => `<article><div><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.position || item.category)} · ${item.questions?.length || 0}题 · ${Number(item.durationMinutes || 0)}分钟 · ${Number(item.totalScore || 0)}分</p><small>${escapeHtml(item.status)} · v${Number(item.version || 1)}</small></div><div>${item.status !== '已发布' ? `<button data-rf-publish-template="${escapeHtml(item.id)}" type="button">审核并发布</button>` : `<button data-rf-invite-template="${escapeHtml(item.id)}" type="button">邀请当前人才</button>`}</div></article>`).join('') : '<div class="rf-dialog-empty"><p>暂无题单，可先新增题目后组合题单。</p></div>'}</div></section><section><div class="rf-review-title"><strong>题库</strong><small>文本 / 单选 / 多选 / 文件</small></div><div class="rf-question-bank-list">${data.questions.length ? data.questions.slice(0, 30).map((item) => `<article><span>${escapeHtml({text:'文本',single:'单选',multiple:'多选',file:'文件'}[item.type] || item.type)}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)} · ${Number(item.score || 0)}分 · ${item.required ? '必答' : '选答'} · ${escapeHtml(item.source || '人工')}</small></div><em>${escapeHtml(item.status)}</em></article>`).join('') : '<div class="rf-dialog-empty"><p>题库暂无题目。</p></div>'}</div></section><section><div class="rf-review-title"><strong>候选人提交</strong><small>${data.submissions.length}次邀请</small></div><div class="rf-submission-list">${data.submissions.length ? data.submissions.map((item) => `<button type="button" data-rf-submission="${escapeHtml(item.id)}"><div><strong>${escapeHtml(item.candidateName || '候选人')}</strong><small>${escapeHtml(item.templateName || '测评题单')} · ${escapeHtml(item.status)}</small></div><span>${Number(item.finalScore || item.aiScore || item.completion || 0)}<small>${item.finalScore || item.aiScore ? '分' : '%完成'}</small></span></button>`).join('') : '<div class="rf-dialog-empty"><p>暂无测评邀请记录。</p></div>'}</div></section></div>`, 'wide');
    document.querySelector('[data-rf-new-question]')?.addEventListener('click', openQuestionForm);
    document.querySelector('[data-rf-new-template]')?.addEventListener('click', openTemplateForm);
    document.querySelector('[data-rf-ai-draft]')?.addEventListener('click', generateAssessmentDraft);
    document.querySelectorAll('[data-rf-publish-template]').forEach((button) => button.addEventListener('click', () => publishAssessmentTemplate(button.dataset.rfPublishTemplate)));
    document.querySelectorAll('[data-rf-invite-template]').forEach((button) => button.addEventListener('click', () => createAssessmentInvite(state.activeId, button.dataset.rfInviteTemplate)));
    document.querySelectorAll('[data-rf-submission]').forEach((button) => button.addEventListener('click', () => openSubmissionDetail(button.dataset.rfSubmission)));
  }

  function openQuestionForm() {
    showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-rf-assessment-back type="button">← 返回测评工作台</button><span>QUESTION BANK</span><h2>新增题库题目</h2><p>题目默认保存为草稿，进入题单并经过人工发布后候选人才可看到。</p></div></header><div class="rf-dialog-form"><label><span>题目分类</span><input id="rf-question-category" placeholder="岗位能力 / 信息收集 / 逻辑能力"></label><label><span>题型</span><select id="rf-question-type"><option value="text">文本题</option><option value="single">单选题</option><option value="multiple">多选题</option><option value="file">文件上传题</option></select></label><label class="wide"><span>题干</span><textarea id="rf-question-title" placeholder="请输入清晰、无歧视且与岗位相关的问题"></textarea></label><label class="wide"><span>选项（单选/多选时每行一项）</span><textarea id="rf-question-options"></textarea></label><label><span>满分</span><input id="rf-question-score" type="number" min="1" max="100" value="10"></label><label><span>是否必答</span><select id="rf-question-required"><option value="true">必答</option><option value="false">选答</option></select></label><label class="wide"><span>参考答案或人工评分要点</span><textarea id="rf-question-reference"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-save-question type="button">保存题目草稿</button></div><p class="rf-dialog-message" id="rf-question-message"></p>`);
    document.querySelector('[data-rf-assessment-back]')?.addEventListener('click', renderAssessmentWorkbench);
    document.querySelector('[data-rf-save-question]')?.addEventListener('click', saveAssessmentQuestion);
  }

  async function saveAssessmentQuestion() {
    const payload = { category: document.getElementById('rf-question-category')?.value.trim() || '', type: document.getElementById('rf-question-type')?.value || 'text', title: document.getElementById('rf-question-title')?.value.trim() || '', options: (document.getElementById('rf-question-options')?.value || '').split('\n').map((value) => value.trim()).filter(Boolean), referenceAnswer: document.getElementById('rf-question-reference')?.value.trim() || '', score: Number(document.getElementById('rf-question-score')?.value || 10), required: document.getElementById('rf-question-required')?.value === 'true', source: '人工', status: '草稿', operator: '当前用户' };
    const message = document.getElementById('rf-question-message');
    try { await request('api/assessments/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await openAssessmentWorkbench(); }
    catch (error) { if (message) { message.textContent = error.message || '题目保存失败'; message.classList.add('error'); } }
  }

  function openTemplateForm() {
    const questions = state.assessmentData?.questions || [];
    const positions = state.assessmentData?.positions || state.positionOptions || [];
    if (!positions.length) return notifyUser('当前部门暂无可选择的岗位，不能创建岗位题单。', 'info');
    const preferredRole = state.talents.find((item) => item.id === state.activeId)?.bestMatchRole || '';
    const selectedPosition = positions.find((item) => item.name === preferredRole) || positions[0];
    showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-rf-assessment-back type="button">← 返回测评工作台</button><span>ASSESSMENT TEMPLATE</span><h2>组合岗位题单</h2><p>选择题库题目组成题单，保存后仍需人工审核发布。</p></div></header><div class="rf-dialog-form"><label><span>题单名称</span><input id="rf-template-assessment-name" placeholder="例如：产品经理一面前测评"></label><label><span>题单分类</span><input id="rf-template-assessment-category" value="岗位测评"></label><label><span>适用岗位</span><select id="rf-template-assessment-position">${positions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedPosition?.id ? 'selected' : ''}>${escapeHtml(item.department || '未分配部门')} · ${escapeHtml(item.name)}</option>`).join('')}</select></label><label><span>限时分钟</span><input id="rf-template-assessment-duration" type="number" value="30"></label><label class="wide"><span>答题说明</span><textarea id="rf-template-assessment-instructions">请独立完成，答案将用于辅助后续面试，不作为自动淘汰依据。</textarea></label></div><div class="rf-question-picker">${questions.length ? questions.map((item) => `<label><input type="checkbox" value="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)} · ${Number(item.score || 0)}分</small></span></label>`).join('') : '<div class="rf-dialog-empty"><p>请先创建题库题目。</p></div>'}</div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-save-assessment-template type="button">保存题单草稿</button></div><p class="rf-dialog-message" id="rf-assessment-template-message"></p>`);
    document.querySelector('[data-rf-assessment-back]')?.addEventListener('click', renderAssessmentWorkbench);
    document.querySelector('[data-rf-save-assessment-template]')?.addEventListener('click', saveAssessmentTemplate);
  }

  async function saveAssessmentTemplate() {
    const questionIds = [...document.querySelectorAll('.rf-question-picker input:checked')].map((node) => node.value);
    const positionId = document.getElementById('rf-template-assessment-position')?.value || '';
    const position = (state.assessmentData?.positions || state.positionOptions || []).find((item) => item.id === positionId);
    const payload = { name: document.getElementById('rf-template-assessment-name')?.value.trim() || '', category: document.getElementById('rf-template-assessment-category')?.value.trim() || '', positionId, position: position?.name || '', durationMinutes: Number(document.getElementById('rf-template-assessment-duration')?.value || 30), instructions: document.getElementById('rf-template-assessment-instructions')?.value.trim() || '', questionIds, operator: '当前用户' };
    const message = document.getElementById('rf-assessment-template-message');
    try { await request('api/assessments/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await openAssessmentWorkbench(); }
    catch (error) { if (message) { message.textContent = error.message || '题单保存失败'; message.classList.add('error'); } }
  }

  async function generateAssessmentDraft() {
    if (!state.activeId) return notifyUser('请先在人才列表选择候选人', 'info');
    const token = showTalentDialog('<div class="rf-dialog-loading">AI正在根据简历和岗位JD生成题目草稿，完成后仍需人工审核…</div>');
    try {
      const started = await request('api/assessments/templates/generate-draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateId: state.activeId, count: 5, operator: '当前用户' }) });
      await waitForBackgroundJob(started.jobId);
      if (isTalentDialogCurrent(token)) await openAssessmentWorkbench();
    } catch (error) { if (isTalentDialogCurrent(token)) showTalentDialog(`<div class="rf-dialog-error"><strong>AI题目草稿生成失败</strong><p>${escapeHtml(conciseError(error))}</p></div>`); }
  }

  async function publishAssessmentTemplate(templateId) {
    try { await request(`api/assessments/templates/${encodeURIComponent(templateId)}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operator: '当前用户' }) }); await openAssessmentWorkbench(); }
    catch (error) { notifyUser(error.message || '题单发布失败', 'error', () => publishAssessmentTemplate(templateId)); }
  }

  async function openAssessmentInvite(candidateId) {
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取可用的已发布题单…</div>');
    try {
      const result = await request('api/assessments/templates?status=已发布');
      if (!isTalentDialogCurrent(token)) return;
      const talent = state.talentDetails[candidateId] || state.talents.find((item) => item.id === candidateId) || {};
      showTalentDialog(`<header class="rf-dialog-head"><div><span>ASSESSMENT INVITE</span><h2>邀请 ${escapeHtml(talent.name || '候选人')} 完成测评</h2><p>链接包含一次性安全Token，原始Token只会在创建时返回，请通过确认后的沟通渠道发送。</p></div></header><div class="rf-invite-template-list">${(result.templates || []).length ? result.templates.map((item) => `<button type="button" data-rf-select-invite-template="${escapeHtml(item.id)}"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.position || item.category)} · ${item.questions?.length || 0}题 · ${Number(item.durationMinutes || 0)}分钟</small></div><span>选择 ›</span></button>`).join('') : '<div class="rf-dialog-empty"><strong>暂无已发布题单</strong><p>请先在在线测评工作台审核并发布题单。</p></div>'}</div>`, 'wide');
      document.querySelectorAll('[data-rf-select-invite-template]').forEach((button) => button.addEventListener('click', () => createAssessmentInvite(candidateId, button.dataset.rfSelectInviteTemplate)));
    } catch (error) { dialogFailure('题单读取失败', error, () => openAssessmentInvite(candidateId), token); }
  }

  async function createAssessmentInvite(candidateId, templateId) {
    if (!candidateId) return notifyUser('请先选择候选人', 'info');
    try {
      const result = await request('api/assessments/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateId, templateId, expiresHours: 72, operator: '当前用户' }) });
      const link = new URL(result.path, window.location.href).toString();
      showTalentDialog(`<div class="rf-operation-result"><i>✓</i><span>测评邀请已创建</span><h2>${escapeHtml(result.candidateName)} · ${escapeHtml(result.templateName)}</h2><p>链接将在 ${escapeHtml(result.expiresAt)} 过期。候选人正式提交后无法再次作答。</p><div class="rf-secure-link"><input id="rf-assessment-link" readonly value="${escapeHtml(link)}"><button class="btn-primary" data-rf-copy-assessment-link type="button">复制安全链接</button></div><small>系统仅保存Token哈希；请勿把链接发布到公开群或无关人员可见的位置。</small></div>`);
      document.querySelector('[data-rf-copy-assessment-link]')?.addEventListener('click', async () => { await navigator.clipboard.writeText(link); document.querySelector('[data-rf-copy-assessment-link]').textContent = '已复制'; });
    } catch (error) { notifyUser(error.message || '测评邀请创建失败', 'error', () => createAssessmentInvite(candidateId, templateId)); }
  }

  async function openSubmissionDetail(inviteId) {
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取候选人答案和评分记录…</div>', 'wide');
    try {
      const item = await request(`api/assessments/submissions/${encodeURIComponent(inviteId)}`);
      if (!isTalentDialogCurrent(token)) return;
      showTalentDialog(`<header class="rf-dialog-head"><div><span>ASSESSMENT REVIEW</span><h2>${escapeHtml(item.candidateName || '候选人')} · ${escapeHtml(item.templateName || '在线测评')}</h2><p>${escapeHtml(item.status)} · 完成度 ${Number(item.completion || 0)}% · 用时 ${Math.round(Number(item.durationSeconds || 0) / 60)}分钟 · 异常事件 ${(item.anomalies || []).length}条</p></div></header><div class="rf-assessment-score-summary"><article><span>AI建议分</span><strong>${Number(item.aiScore || 0)}</strong><small>${escapeHtml(item.aiScoreStatus || '等待评分')}</small></article><article><span>人工最终分</span><strong>${Number(item.finalScore || 0)}</strong><small>${escapeHtml(item.conclusion || '待人工确认')}</small></article></div><div class="rf-answer-review-list">${(item.questions || []).map((entry, index) => `<article><header><span>${index + 1}</span><div><strong>${escapeHtml(entry.question?.title || '题目已删除')}</strong><small>${escapeHtml(entry.question?.category || '')} · 满分${Number(entry.question?.score || 0)}</small></div></header><p>${entry.answer?.fileUrl ? `<a href="${escapeHtml(entry.answer.fileUrl)}" target="_blank" rel="noopener">查看附件：${escapeHtml(entry.answer.fileName || '答题附件')}</a>` : escapeHtml(Array.isArray(entry.answer?.value) ? entry.answer.value.join('、') : entry.answer?.value || '未作答')}</p><footer>AI建议 ${Number(entry.answer?.aiScore || 0)}分 · ${escapeHtml(entry.answer?.aiComment || '等待AI评分或仅供人工判断')}</footer></article>`).join('')}</div>${['已提交','已评分'].includes(item.status) ? `<div class="rf-review-form"><label><span>人工最终分</span><input id="rf-assessment-final-score" type="number" min="0" max="100" value="${Number(item.finalScore || item.aiScore || 0)}"></label><label><span>人工结论</span><select id="rf-assessment-conclusion"><option>进入面试</option><option>通过</option><option>待复核</option><option>储备</option><option>不通过</option></select></label><label><span>人工评语</span><textarea id="rf-assessment-comment" placeholder="说明评分依据、优势和后续面试需要核实的内容"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-submit-assessment-review type="button">确认人工评分</button></div><p class="rf-dialog-message" id="rf-assessment-review-message"></p>` : ''}`, 'wide');
      document.querySelector('[data-rf-submit-assessment-review]')?.addEventListener('click', () => submitAssessmentReview(inviteId));
    } catch (error) { dialogFailure('测评详情读取失败', error, () => openSubmissionDetail(inviteId), token); }
  }

  async function submitAssessmentReview(inviteId) {
    const payload = { finalScore: Number(document.getElementById('rf-assessment-final-score')?.value || 0), conclusion: document.getElementById('rf-assessment-conclusion')?.value || '待复核', comment: document.getElementById('rf-assessment-comment')?.value.trim() || '', operator: '当前用户' };
    const message = document.getElementById('rf-assessment-review-message');
    if (!payload.comment) { if (message) { message.textContent = '请填写人工评分依据。'; message.classList.add('error'); } return; }
    try { await request(`api/assessments/submissions/${encodeURIComponent(inviteId)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await openSubmissionDetail(inviteId); }
    catch (error) { if (message) { message.textContent = error.message || '人工评分保存失败'; message.classList.add('error'); } }
  }

  async function openInterviewWorkbench() {
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，接口可用后才能管理面试排期。', true);
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取面试官、会议室和预约日历…</div>', 'wide');
    try {
      const [interviewers, rooms, availability, appointments] = await Promise.all([request('api/interviews/interviewers'), request('api/interviews/rooms'), request('api/interviews/availability'), request('api/interviews/appointments')]);
      if (!isTalentDialogCurrent(token)) return;
      state.interviewData = { interviewers: interviewers.interviewers || [], rooms: rooms.rooms || [], availability: availability.availability || [], appointments: appointments.appointments || [] };
      renderInterviewWorkbench();
    } catch (error) { dialogFailure('约面工作台读取失败', error, openInterviewWorkbench, token); }
  }

  function renderInterviewWorkbench() {
    const data = state.interviewData || { interviewers: [], rooms: [], appointments: [], availability: [] };
    const today = localDateValue(new Date());
    showTalentDialog(`<header class="rf-dialog-head"><div><span>INTERVIEW SCHEDULING</span><h2>约面、会议室与企微同步</h2><p>先校验面试官可用时间和会议室占用，再保存本地预约并尝试同步企微。外部失败不会伪造成功。</p></div><div class="rf-assessment-head-actions"><button class="btn-soft" data-rf-sync-wecom-resources type="button">同步企微会议室</button><button class="btn-primary" data-rf-schedule-current type="button">预约当前人才</button></div></header><div class="rf-review-metrics"><article><span>面试官</span><strong>${data.interviewers.length}</strong></article><article><span>会议室</span><strong>${data.rooms.length}</strong></article><article><span>今日面试</span><strong>${data.appointments.filter((item) => shanghaiDateTimeParts(item.startAt).date === today).length}</strong></article><article><span>待发送邮件</span><strong>${data.appointments.filter((item) => item.syncStatus === '同步失败').length}</strong></article><article class="warn"><span>企微同步失败</span><strong>${data.appointments.filter((item) => item.syncStatus === '同步失败').length}</strong></article></div><div class="rf-interview-columns"><section><div class="rf-review-title"><strong>面试日历</strong><button data-rf-check-reminders type="button">检查提醒</button></div><div class="rf-appointment-list">${data.appointments.length ? data.appointments.map((item) => `<article><time><strong>${escapeHtml(shanghaiDateTimeParts(item.startAt).shortDate)}</strong><span>${escapeHtml(shanghaiDateTimeParts(item.startAt).time)}</span></time><div><strong>${escapeHtml(item.candidateName || '候选人')} · ${escapeHtml(item.round)}</strong><p>${escapeHtml(item.mode)} · ${escapeHtml(item.room?.name || item.location || item.meetingUrl || '地点待定')}</p><small>${(item.interviewers || []).map((person) => escapeHtml(person.name)).join('、') || '面试官待定'} · ${escapeHtml(item.confirmationStatus)} · ${escapeHtml(item.syncStatus)}</small>${item.syncError ? `<em>${escapeHtml(item.syncError)}</em>` : ''}</div><aside>${item.reschedule?.status === '待审批' ? `<button class="btn-soft" data-rf-review-reschedule="${escapeHtml(item.id)}">处理改期</button>` : ''}${item.syncStatus === '同步失败' ? `<button data-rf-retry-interview="${escapeHtml(item.id)}">重试同步</button>` : ''}<button class="danger" data-rf-cancel-interview="${escapeHtml(item.id)}">取消</button></aside></article>`).join('') : '<div class="rf-dialog-empty"><p>暂无面试预约。</p></div>'}</div></section><aside><div class="rf-resource-card"><div class="rf-review-title"><strong>面试官池</strong><button data-rf-new-interviewer>新增</button></div>${data.interviewers.map((item) => `<p><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.department || '')} · ${(item.roles || []).map(escapeHtml).join('、')}</span><small>${escapeHtml(item.status)} · 每日最多${Number(item.maxPerDay || 0)}场</small></p>`).join('') || '<div class="rf-dialog-empty"><p>暂无面试官。</p></div>'}</div><div class="rf-resource-card"><div class="rf-review-title"><strong>会议室资源</strong><button data-rf-new-room>新增</button></div>${data.rooms.map((item) => `<p><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.location || '')} ${escapeHtml(item.floor || '')} · ${Number(item.capacity || 0)}人</span><small>${escapeHtml(item.status)} · ${escapeHtml(item.syncStatus)}</small></p>`).join('') || '<div class="rf-dialog-empty"><p>尚未同步企微会议室。点击上方“同步企微会议室”。</p></div>'}</div></aside></div><p class="rf-dialog-message" id="rf-interview-workbench-message"></p>`, 'wide');
    document.querySelector('[data-rf-schedule-current]')?.addEventListener('click', () => openScheduleInterview(state.activeId));
    const manageInterviewers = document.querySelector('[data-rf-new-interviewer]');
    if (manageInterviewers) { manageInterviewers.closest('.rf-review-title')?.querySelector('strong') && (manageInterviewers.closest('.rf-review-title').querySelector('strong').textContent = '组织面试官'); manageInterviewers.textContent = '去配置'; manageInterviewers.addEventListener('click', openAccessAdministration); }
    const interviewerResourceTitle = document.querySelector('.rf-resource-card .rf-review-title');
    interviewerResourceTitle?.insertAdjacentHTML('beforeend', '<button data-rf-new-availability type="button">可用时间</button>');
    document.querySelector('[data-rf-new-availability]')?.addEventListener('click', openAvailabilityForm);
    document.querySelector('[data-rf-new-room]')?.addEventListener('click', openMeetingRoomForm);
    document.querySelector('[data-rf-sync-wecom-resources]')?.addEventListener('click', syncWecomResources);
    document.querySelector('[data-rf-check-reminders]')?.addEventListener('click', checkInterviewReminders);
    document.querySelectorAll('[data-rf-review-reschedule]').forEach((button) => button.addEventListener('click', () => openRescheduleApproval(button.dataset.rfReviewReschedule)));
    document.querySelectorAll('[data-rf-retry-interview]').forEach((button) => button.addEventListener('click', () => retryInterviewSync(button.dataset.rfRetryInterview)));
    data.appointments.filter((item) => item.status === '已取消' || item.confirmationStatus === '已取消' || item.status === '已完成').forEach((item) => {
      const button = document.querySelector(`[data-rf-cancel-interview="${CSS.escape(String(item.id))}"]`);
      if (!button) return;
      const completed = item.status === '已完成';
      if (completed) {
        button.outerHTML = `<button class="btn-soft" data-rf-send-result="${escapeAttr(item.id)}">发送面试结果</button>`;
      } else {
        button.outerHTML = `<span class="rf-appointment-state cancelled">已取消</span>`;
      }
    });
    document.querySelectorAll('[data-rf-cancel-interview]').forEach((button) => button.addEventListener('click', () => cancelInterview(button.dataset.rfCancelInterview)));
    document.querySelectorAll('[data-rf-send-result]').forEach((button) => button.addEventListener('click', () => openSendInterviewResult(button.dataset.rfSendResult)));
  }
  async function openRescheduleApproval(interviewId) {
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取改期申请和会议室…</div>', 'wide');
    try {
      const [detail, rooms] = await Promise.all([request(`api/interviews/appointments/${encodeURIComponent(interviewId)}`), request('api/interviews/rooms')]);
      if (!isTalentDialogCurrent(token)) return;
      const appointment = detail.appointment || {}, reschedule = appointment.reschedule || {};
      const pending = reschedule.status === '待审批' && appointment.confirmationStatus === '改期审批中';
      const preferred = (reschedule.preferredTimes || []).filter(Boolean);
      const duration = Math.max(30 * 60 * 1000, shanghaiDateTimeMs(appointment.endAt) - shanghaiDateTimeMs(appointment.startAt));
      const suggestedStartMs = preferred.length ? shanghaiDateTimeMs(preferred[0]) : shanghaiDateTimeMs(appointment.startAt);
      const suggestedEndMs = suggestedStartMs + duration;
      const statusText = pending ? '待HR确认' : reschedule.status || '已处理';
      showTalentDialog(`<header class="rf-dialog-head rf-reschedule-review-head"><div><span>RESCHEDULE REVIEW</span><h2>确认面试改期</h2><p>候选人只能提交申请；旧日程在HR确认之前保持有效。批准后系统会更新企微日程并重新发送候选人信息完善链接。</p></div><b>${escapeHtml(statusText)}</b></header><section class="rf-reschedule-review-summary"><article><span>候选人</span><strong>${escapeHtml(appointment.candidateName || '候选人')}</strong><small>${escapeHtml(appointment.role || '岗位待确认')} · ${escapeHtml(appointment.round || '本轮')}</small></article><article><span>当前安排</span><strong>${escapeHtml(formatShanghaiDateTime(appointment.startAt))}</strong><small>${escapeHtml(appointment.room?.name || appointment.location || '地点待确认')}</small></article><article class="wide"><span>改期原因</span><strong>${escapeHtml(reschedule.reason || '未填写')}</strong><small>候选人期望：${preferred.map((value) => escapeHtml(formatShanghaiDateTime(value))).join('、') || '未填写'}</small></article></section>${pending ? `<div class="rf-dialog-form rf-reschedule-approval-form"><input id="rf-interview-mode" type="hidden" value="${escapeHtml(appointment.mode || '')}"><label><span>新开始时间（北京时间）</span><input id="rf-interview-start" type="datetime-local" value="${escapeHtml(shanghaiDateTimeValue(suggestedStartMs))}"></label><label><span>新结束时间</span><input id="rf-interview-end" type="datetime-local" value="${escapeHtml(shanghaiDateTimeValue(suggestedEndMs))}"></label><label class="rf-interview-room-field"><span>会议室</span><select id="rf-interview-room">${interviewRoomOptions(rooms.rooms || [], appointment.room?.id || '')}</select></label><label><span>面试地点 / 视频链接</span><input id="rf-reschedule-location" value="${escapeHtml(appointment.location || appointment.meetingUrl || '')}"></label><section class="wide rf-room-availability-panel"><div><strong>新时段会议室</strong><small id="rf-room-availability-note">批准前请查询企微会议室实时状态。</small></div><button class="btn-soft" data-rf-refresh-room-availability type="button">查询会议室</button></section><label class="wide"><span>HR处理说明</span><textarea id="rf-reschedule-decision-note" placeholder="例如：已与候选人确认新时间，或说明暂不同意的原因。"></textarea></label></div><div class="rf-dialog-actions rf-reschedule-review-actions"><button class="btn-soft danger" data-rf-reject-reschedule type="button">保持原安排</button><button class="btn-primary" data-rf-approve-reschedule type="button">批准并更新日程</button></div><p class="rf-dialog-message" id="rf-reschedule-review-message"></p>` : `<div class="rf-operation-result rf-reschedule-processed"><i>✓</i><span>改期申请已处理</span><h2>${escapeHtml(statusText)}</h2><p>${escapeHtml(reschedule.decisionNote || (reschedule.status === '已批准' ? '新安排已发送给候选人。' : '原面试安排保持不变。'))}</p></div>`}`, 'wide');
      if (!pending) return;
      const message = document.getElementById('rf-reschedule-review-message');
      const account = window.recruitmentCurrentUser || {};
      const submitDecision = async (decision) => {
        const approve = decision === '批准', button = document.querySelector(approve ? '[data-rf-approve-reschedule]' : '[data-rf-reject-reschedule]');
        try {
          if (button) button.disabled = true;
          const startValue = document.getElementById('rf-interview-start')?.value || '', endValue = document.getElementById('rf-interview-end')?.value || '';
          if (approve) { const error = validateSingleInterviewRange(startValue, endValue); if (error) throw new Error(error); }
          if (message) { message.textContent = approve ? '正在更新企微日程并发送新安排邮件…' : '正在保留原面试安排…'; message.classList.remove('error'); }
          const payload = { decision, note: document.getElementById('rf-reschedule-decision-note')?.value.trim() || '', operator: account.name || '当前用户', operatorUserId: account.id || '' };
          if (approve) Object.assign(payload, { startAt: shanghaiDateTimeIso(startValue), endAt: shanghaiDateTimeIso(endValue), meetingRoomId: interviewRoomIdFrom(document.getElementById('rf-interview-room')?.value), location: document.getElementById('rf-reschedule-location')?.value.trim() || appointment.location || '' });
          const started = await request(`api/interviews/appointments/${encodeURIComponent(interviewId)}/reschedule-decision`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
          const result = await pollRescheduleDecisionJob(started.jobId, message);
          if (approve && result.email?.status !== '已发送') notifyUser(`改期已保存，但候选人新链接未发送：${result.email?.message || '请检查企微同步'}`, 'error');
          else notifyUser(approve ? '改期已批准，新日程和候选人邮件已处理。' : '已保留原面试安排。', 'success');
          await openRescheduleApproval(interviewId);
        } catch (error) { if (button) button.disabled = false; if (message) { message.textContent = conciseError(error); message.classList.add('error'); } }
      };
      document.querySelector('[data-rf-refresh-room-availability]')?.addEventListener('click', () => refreshMeetingRoomAvailability().catch((error) => { if (message) { message.textContent = conciseError(error); message.classList.add('error'); } }));
      document.querySelector('[data-rf-reject-reschedule]')?.addEventListener('click', () => submitDecision('拒绝'));
      document.querySelector('[data-rf-approve-reschedule]')?.addEventListener('click', () => submitDecision('批准'));
    } catch (error) { dialogFailure('改期申请读取失败', error, () => openRescheduleApproval(interviewId), token); }
  }
  async function pollRescheduleDecisionJob(jobId, message) {
    if (!jobId) throw new Error('改期处理任务创建失败。');
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const job = await request(`api/interviews/reschedule-jobs/${encodeURIComponent(jobId)}`);
      if (message && job.progress) message.textContent = job.progress;
      if (job.status === 'done') return job.data || {};
      if (job.status === 'failed') throw new Error(job.error || '改期处理失败');
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    throw new Error('企微日程或邮件处理时间较长，任务仍在后台执行；可稍后重新打开该改期申请查看状态。');
  }
  function openSendInterviewResult(interviewId) {
    const appointment = (state.interviewData?.appointments || []).find((item) => item.id === interviewId) || {};
    const candidateName = appointment.candidateName || '该候选人';
    const round = appointment.round || '本轮';
    showTalentDialog(`<header class="rf-dialog-head"><div><span>INTERVIEW RESULT</span><h2>发送面试结果</h2><p>面试预约时已发送过面试通知；这里仅用于通知候选人最终面试结果。系统将通过企业微信邮件发送给候选人。</p></div></header><div class="rf-feedback-summary"><article><span>候选人</span><strong>${escapeHtml(candidateName)}</strong></article><article><span>面试轮次</span><strong>${escapeHtml(round)}</strong></article></div><div class="rf-dialog-form"><label><span>面试结果 <b>*</b></span><select id="rf-result-outcome"><option value="通过">通过</option><option value="不通过">不通过</option><option value="进入下一轮">进入下一轮</option><option value="储备">储备</option></select></label><label class="wide"><span>通知方式</span><select id="rf-result-channel" disabled><option>邮箱</option></select></label><label class="wide"><span>结果说明</span><textarea id="rf-result-note" rows="5" placeholder="系统将向候选人发送面试结果和后续安排，例如后续面试时间、需要准备的资料等。"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-soft" data-rf-result-close type="button">取消</button><button class="btn-primary" data-rf-result-submit type="button">发送面试结果</button></div><p class="rf-dialog-message" id="rf-result-message"></p>`, 'wide');
    document.querySelector('[data-rf-result-close]')?.addEventListener('click', cancelTalentDialog);
    document.querySelector('[data-rf-result-submit]')?.addEventListener('click', () => submitInterviewResult(interviewId));
  }
  async function submitInterviewResult(interviewId) {
    const result = document.getElementById('rf-result-outcome')?.value || '';
    const note = document.getElementById('rf-result-note')?.value.trim() || '';
    const message = document.getElementById('rf-result-message');
    const submit = document.querySelector('[data-rf-result-submit]');
    if (!result) { if (message) { message.textContent = '请选择面试结果。'; message.classList.add('error'); } return; }
    try {
      if (message) { message.textContent = '正在通过企微邮件发送面试结果…'; message.classList.remove('error'); }
      if (submit) submit.disabled = true;
      const res = await request(`api/interviews/appointments/${encodeURIComponent(interviewId)}/result`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ result, note, operator:'当前用户' }) });
      await openInterviewWorkbench();
      if (res.status === '已发送') notifyUser(`面试结果已通过邮件发送给${res.recipient || '候选人'}。`, 'success');
      else notifyUser(`面试结果邮件发送失败：${res.message || '请稍后重试'}`, 'error');
    } catch (error) {
      if (submit) submit.disabled = false;
      if (message) { message.textContent = error.message || '发送失败'; message.classList.add('error'); }
    }
  }

  function openInterviewerForm() {
    showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-rf-interview-back>← 返回约面工作台</button><span>INTERVIEWER POOL</span><h2>新增或更新面试官</h2><p>企微成员 ID 用于把面试官加入企业微信日程；可按姓名查询后直接带入。</p></div></header><div class="rf-dialog-form"><label><span>企业微信成员 ID</span><input id="rf-interviewer-user-id" placeholder="查询后自动带入"></label><label><span>姓名</span><input id="rf-interviewer-name" placeholder="输入姓名后查询企微成员"></label><label class="wide"><span>企微成员检索</span><div><button class="btn-soft" type="button" data-rf-lookup-wecom-user>按姓名查询企微 ID</button><small id="rf-interviewer-wecom-results">请先输入姓名；重名时请选择所属部门正确的成员。</small></div></label><label><span>部门</span><input id="rf-interviewer-department"></label><label><span>每日最大面试数</span><input id="rf-interviewer-max" type="number" value="4"></label><label class="wide"><span>擅长岗位（顿号或逗号分隔）</span><input id="rf-interviewer-roles"></label><label class="wide"><span>可面轮次</span><input id="rf-interviewer-rounds" value="一面、二面"></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-save-interviewer>保存面试官</button></div><p id="rf-interviewer-message" class="rf-dialog-message"></p>`);
    document.querySelector('[data-rf-interview-back]')?.addEventListener('click', renderInterviewWorkbench);
    document.querySelector('[data-rf-lookup-wecom-user]')?.addEventListener('click', lookupWecomInterviewer);
    document.querySelector('[data-rf-save-interviewer]')?.addEventListener('click', saveInterviewer);
  }

  async function lookupWecomInterviewer() {
    const name = document.getElementById('rf-interviewer-name')?.value.trim() || '';
    const results = document.getElementById('rf-interviewer-wecom-results');
    if (!name) { if (results) results.textContent = '请先输入面试官姓名。'; return; }
    try {
      if (results) results.textContent = '正在查询企业微信成员…';
      const response = await request('api/interviews/wecom/users/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: name }) });
      const users = response.users || [];
      if (!users.length) { if (results) results.textContent = '未找到匹配成员，请核对姓名或到企业微信通讯录确认。'; return; }
      if (results) results.innerHTML = users.map((user) => `<button type="button" class="btn-soft" data-rf-select-wecom-user="${escapeHtml(user.userId)}" data-rf-select-wecom-name="${escapeHtml(user.name)}">使用 ${escapeHtml(user.name)} · ${escapeHtml((user.departments || []).join('、') || user.position || '部门待确认')}</button>`).join(' ');
      document.querySelectorAll('[data-rf-select-wecom-user]').forEach((button) => button.addEventListener('click', () => {
        document.getElementById('rf-interviewer-user-id').value = button.dataset.rfSelectWecomUser || '';
        const nameInput = document.getElementById('rf-interviewer-name');
        if (nameInput && !nameInput.value.trim()) nameInput.value = button.dataset.rfSelectWecomName || '';
        if (results) results.textContent = `已选择企微成员 ID：${button.dataset.rfSelectWecomUser || ''}`;
      }));
    } catch (error) { if (results) results.textContent = error.message || '企微成员查询失败'; }
  }

  async function saveInterviewer() { const split = (value) => value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean); const payload = { userId: document.getElementById('rf-interviewer-user-id')?.value.trim(), name: document.getElementById('rf-interviewer-name')?.value.trim(), department: document.getElementById('rf-interviewer-department')?.value.trim(), roles: split(document.getElementById('rf-interviewer-roles')?.value || ''), rounds: split(document.getElementById('rf-interviewer-rounds')?.value || ''), maxPerDay: Number(document.getElementById('rf-interviewer-max')?.value || 4), status: '启用' }; try { await request('api/interviews/interviewers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); await openInterviewWorkbench(); } catch(error){document.getElementById('rf-interviewer-message').textContent=error.message||'保存失败'} }

  function openAvailabilityForm() {
    const people = state.interviewData?.interviewers || [];
    showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-rf-interview-back type="button">← 返回约面工作台</button><span>INTERVIEWER AVAILABILITY</span><h2>维护面试官可用时间</h2><p>预约时如果该面试官维护过可用时间，系统只允许选择落在可用区间内的时段。</p></div></header><div class="rf-dialog-form"><label><span>面试官</span><select id="rf-availability-interviewer">${people.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}</select></label><label><span>时间来源</span><select id="rf-availability-source"><option>人工维护</option><option>企微日历同步</option></select></label><label><span>开始时间</span><input id="rf-availability-start" type="datetime-local"></label><label><span>结束时间</span><input id="rf-availability-end" type="datetime-local"></label><label class="wide"><span>重复规则（选填）</span><input id="rf-availability-repeat" placeholder="例如：每周一、三 14:00-18:00"></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-save-availability type="button">保存可用时间</button></div><p class="rf-dialog-message" id="rf-availability-message"></p>`);
    document.querySelector('[data-rf-interview-back]')?.addEventListener('click', renderInterviewWorkbench);
    document.querySelector('[data-rf-save-availability]')?.addEventListener('click', saveAvailability);
  }

  async function saveAvailability() {
    const payload = { interviewerId: document.getElementById('rf-availability-interviewer')?.value || '', startAt: shanghaiDateTimeIso(document.getElementById('rf-availability-start')?.value || ''), endAt: shanghaiDateTimeIso(document.getElementById('rf-availability-end')?.value || ''), repeatRule: document.getElementById('rf-availability-repeat')?.value.trim() || '', source: document.getElementById('rf-availability-source')?.value || '人工维护' };
    const message = document.getElementById('rf-availability-message');
    try { await request('api/interviews/availability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); await openInterviewWorkbench(); }
    catch (error) { if (message) { message.textContent = error.message || '可用时间保存失败'; message.classList.add('error'); } }
  }

  function openMeetingRoomForm() { showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-rf-interview-back>← 返回约面工作台</button><span>MEETING ROOM</span><h2>新增会议室资源</h2></div></header><div class="rf-dialog-form"><label><span>会议室名称</span><input id="rf-room-name"></label><label><span>办公地点</span><input id="rf-room-location"></label><label><span>楼层</span><input id="rf-room-floor"></label><label><span>容纳人数</span><input id="rf-room-capacity" type="number" value="6"></label><label class="wide"><span>设备（顿号或逗号分隔）</span><input id="rf-room-equipment" placeholder="电视、白板、视频会议"></label><label class="wide"><span>企微外部资源ID（选填）</span><input id="rf-room-external"></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-save-room>保存会议室</button></div><p id="rf-room-message" class="rf-dialog-message"></p>`); document.querySelector('[data-rf-interview-back]')?.addEventListener('click',renderInterviewWorkbench); document.querySelector('[data-rf-save-room]')?.addEventListener('click',saveMeetingRoom) }
  async function saveMeetingRoom(){const split=(value)=>value.split(/[、,，]/).map(x=>x.trim()).filter(Boolean);const payload={name:document.getElementById('rf-room-name')?.value.trim(),location:document.getElementById('rf-room-location')?.value.trim(),floor:document.getElementById('rf-room-floor')?.value.trim(),capacity:Number(document.getElementById('rf-room-capacity')?.value||6),equipment:split(document.getElementById('rf-room-equipment')?.value||''),externalResourceId:document.getElementById('rf-room-external')?.value.trim(),status:'可用'};try{await request('api/interviews/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});await openInterviewWorkbench()}catch(error){document.getElementById('rf-room-message').textContent=error.message||'保存失败'}}

  function interviewRoomIdFrom(value) { return value === '__no_room__' ? '' : value || ''; }
  function interviewRoomOptions(rooms, selected = '') {
    return [`<option value="">请选择会议室</option>`, `<option value="__no_room__" ${selected === '__no_room__' ? 'selected' : ''}>不选择会议室</option>`, ...(rooms || []).map((item) => {
      const status = item.status || '待选择时间';
      const source = item.source === '企微实时' ? '企微实时' : item.source === '企微待确认' ? '待企微确认' : '';
      return `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''} ${item.reservable === false ? 'disabled' : ''}>${escapeHtml(item.name)} · ${Number(item.capacity || 0)}人 · ${escapeHtml(status)}${source ? ` · ${source}` : ''}</option>`;
    })].join('');
  }

  function applyInterviewMode() {
    document.querySelector('.rf-interview-room-field')?.removeAttribute('hidden');
    document.querySelector('.rf-room-availability-panel')?.removeAttribute('hidden');
  }

  function normalizedInterviewRole(value) { return String(value || '').replace(/[\s/｜|·、,，()（）]/g, '').toLowerCase(); }
  function interviewerMatchesRole(interviewerRoles, candidateRole) {
    const target = normalizedInterviewRole(candidateRole);
    return Boolean(target) && (interviewerRoles || []).some((role) => {
      const current = normalizedInterviewRole(role);
      return current && (target.includes(current) || current.includes(target));
    });
  }

  const MAX_SINGLE_INTERVIEW_DURATION_MS = 8 * 60 * 60 * 1000;
  const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
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
  function shanghaiDateTimeIso(value) {
    const timestamp = shanghaiDateTimeMs(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
  }
  function shanghaiDateTimeValue(value) {
    const timestamp = shanghaiDateTimeMs(value);
    return Number.isFinite(timestamp) ? new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 16) : '';
  }
  function shanghaiDateTimeParts(value) {
    const local = shanghaiDateTimeValue(value);
    return { date: local.slice(0, 10), shortDate: local.slice(5, 10), time: local.slice(11, 16), value: local };
  }
  function formatShanghaiDateTime(value) {
    const parts = shanghaiDateTimeParts(value);
    return parts.value ? `${parts.date} ${parts.time}` : '';
  }
  function localDateValue(date) { return shanghaiDateTimeValue(date).slice(0, 10); }
  function upcomingInterviewTimeRange() {
    const slotMs = 15 * 60 * 1000;
    const startMs = Math.ceil((Date.now() + 1) / slotMs) * slotMs;
    const start = shanghaiDateTimeValue(startMs);
    return { date: start.slice(0, 10), currentStartTime: start.slice(11, 16) };
  }
  function interviewStartOptions(selected) {
    return '<option value="">请选择</option>' + Array.from({ length: 96 }, (_, index) => {
      const hour = String(Math.floor(index / 4)).padStart(2, '0');
      const minute = String((index % 4) * 15).padStart(2, '0');
      const value = `${hour}:${minute}`;
      return `<option value="${value}"${value === selected ? ' selected' : ''}>${value}</option>`;
    }).join('');
  }
  function interviewDurationOptions(selectedMinutes) {
    return '<option value="">请选择</option>' + [
      [15, '15 分钟'], [30, '30 分钟'], [60, '1 小时'],
      [90, '1.5 小时'], [120, '2 小时'], [180, '3 小时'], [240, '4 小时'], [480, '8 小时'],
    ].map(([minutes, label]) => `<option value="${minutes}"${minutes === selectedMinutes ? ' selected' : ''}>${label}</option>`).join('');
  }
  function formatInterviewDuration(minutes) {
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60), rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  }
  function syncInterviewTimeFields() {
    const date = document.getElementById('rf-interview-date')?.value || '', startTime = document.getElementById('rf-interview-time')?.value || '';
    const durationMinutes = Number(document.getElementById('rf-interview-duration')?.value || 0);
    const start = document.getElementById('rf-interview-start'), end = document.getElementById('rf-interview-end');
    if (!date || !startTime || !durationMinutes || !start || !end) return;
    const startAt = shanghaiDateTimeMs(`${date}T${startTime}`);
    if (!Number.isFinite(startAt)) return;
    const endAt = startAt + durationMinutes * 60 * 1000;
    const endTime = shanghaiDateTimeValue(endAt).slice(11, 16);
    start.value = `${date}T${startTime}`; end.value = datetimeLocalValue(endAt);
    const preview = document.getElementById('rf-interview-time-preview');
    if (preview) preview.textContent = `${date.replaceAll('-', '.')} · ${startTime}-${endTime} · ${formatInterviewDuration(durationMinutes)} · 北京时间`;
  }
  function datetimeLocalValue(timestamp) {
    return shanghaiDateTimeValue(timestamp);
  }
  function validateSingleInterviewRange(startAt, endAt) {
    const start = shanghaiDateTimeMs(startAt);
    const end = shanghaiDateTimeMs(endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '结束时间必须晚于开始时间。';
    if (end - start > MAX_SINGLE_INTERVIEW_DURATION_MS) return '单场面试时段最长 8 小时；这里不是多日日期范围，请选择具体的开始和结束时间。';
    if (start <= Date.now()) return '开始时间已过去或已开始，请选择当前时间之后的具体时段再查询会议室。';
    return '';
  }

  const roomAvailabilityRequests = new Map();
  function showRoomAuthorizationHelp(error) {
    const note = document.getElementById('rf-room-availability-note');
    const panel = note?.closest('.rf-room-availability-panel');
    if (!panel || !/\b850003\b|authorization\s+expired|企微认证已过期/i.test(error?.message || String(error))) return;
    document.getElementById('rf-room-auth-help')?.remove();
    note.textContent = '企微认证已过期，暂时无法查询会议室。';
    const help = document.createElement('section');
    help.id = 'rf-room-auth-help';
    help.className = 'wide rf-room-auth-help';
    help.setAttribute('role', 'status');
    help.innerHTML = '<div><strong>联系高子云完成企微验证</strong><p>面试信息已保留。点击后通过天玑发送提醒，验证恢复后再查询即可。</p></div><button type="button" class="btn-soft" data-rf-contact-wecom-admin>联系高子云</button><p data-rf-auth-notice-status aria-live="polite"></p>';
    panel.after(help);
    const button = help.querySelector('button'), status = help.querySelector('[data-rf-auth-notice-status]');
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true; button.textContent = '正在通知…'; status.textContent = '正在通过天玑发送提醒，请勿重复点击。';
      try {
        const started = await request('api/interviews/wecom/authorization-notice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const result = await pollInterviewResource(started, progress => { status.textContent = progress; }, '通知发送');
        if (!['已发送', '已跳过'].includes(result?.status)) throw new Error(result?.message || '未收到明确发送成功回执，请稍后重试');
        button.textContent = '已通知高子云'; status.textContent = result.message || '已通过天玑通知高子云，请等待她完成企微验证。';
      } catch (noticeError) {
        button.disabled = false; button.textContent = '重试通知高子云'; status.textContent = `通知未成功：${conciseError(noticeError)}`;
      }
    });
  }

  async function pollInterviewResource(started, progress = () => {}, operation = '会议室查询') {
    if (!started.jobId) return started;
    return waitForBackgroundJob(started.jobId, progress, { timeoutMessage: `${operation}耗时较长，任务仍在后台运行，请稍后刷新查看结果，勿重复提交。` });
  }
  let roomAvailabilitySequence = 0;
  let roomAvailabilityTimer;
  function scheduleMeetingRoomAvailability() {
    window.clearTimeout(roomAvailabilityTimer);
    roomAvailabilitySequence += 1;
    const roomSelect = document.getElementById('rf-interview-room');
    if (roomSelect?.dataset.source === 'wecom') {
      roomSelect.value = '';
      delete roomSelect.dataset.selectionId;
    }
    const button = document.querySelector('[data-rf-refresh-room-availability]');
    if (button) { button.disabled = false; button.textContent = '查询'; }
    roomAvailabilityTimer = window.setTimeout(() => refreshMeetingRoomAvailability().catch(() => {}), 450);
  }

  async function refreshMeetingRoomAvailability() {
    window.clearTimeout(roomAvailabilityTimer);
    const mode = document.getElementById('rf-interview-mode')?.value;
    const startAt = document.getElementById('rf-interview-start')?.value || '';
    const endAt = document.getElementById('rf-interview-end')?.value || '';
    const roomSelect = document.getElementById('rf-interview-room');
    const note = document.getElementById('rf-room-availability-note');
    if (!roomSelect) return null;
    if (!mode) {
      if (note) { note.textContent = '请先选择面试方式，再查询会议室。'; note.classList.add('warning'); }
      return null;
    }
    const rangeError = validateSingleInterviewRange(startAt, endAt);
    if (rangeError) { if (note) note.textContent = rangeError; note?.classList.add('warning'); return null; }
    const sequence = ++roomAvailabilitySequence;
    const isCurrent = () => sequence === roomAvailabilitySequence && roomSelect === document.getElementById('rf-interview-room') && document.getElementById('rf-interview-mode')?.value === mode && document.getElementById('rf-interview-start')?.value === startAt && document.getElementById('rf-interview-end')?.value === endAt;
    const button = document.querySelector('[data-rf-refresh-room-availability]');
    if (button) { button.disabled = true; button.textContent = '查询中'; }
    document.getElementById('rf-room-auth-help')?.remove();
    if (note) { note.textContent = '正在获取企微会议室，可继续填写其他信息…'; note.classList.remove('warning'); }
    const params = new URLSearchParams({ startAt: shanghaiDateTimeIso(startAt), endAt: shanghaiDateTimeIso(endAt) });
    if (roomSelect.dataset.source === 'wecom') {
      params.set('source', 'wecom');
    }
    const key = params.toString();
    try {
      if (!roomAvailabilityRequests.has(key)) {
        const pending = request(`api/interviews/rooms/availability?${key}&background=true`).then(started => pollInterviewResource(started)).finally(() => roomAvailabilityRequests.delete(key));
        roomAvailabilityRequests.set(key, pending);
      }
      const result = await roomAvailabilityRequests.get(key);
      if (!isCurrent()) return null;
      roomSelect.innerHTML = interviewRoomOptions(result.rooms, roomSelect.value);
      roomSelect.dataset.selectionId = result.selectionId || '';
      if (note) {
        const free = (result.rooms || []).filter((room) => room.reservable).length;
        note.textContent = result.source === '企微实时'
          ? roomSelect.dataset.source === 'wecom' ? result.message || `已获取企微会议室：${free} 间空闲，创建企微日程前会再次校验。` : `企微实时校验完成：${free} 间可预约。保存时会再次校验。`
          : `${result.message || '当前按本系统排期校验'}${result.action ? ` ${result.action}` : ''}`;
        note.classList.toggle('warning', result.source !== '企微实时');
      }
      return result;
    } catch (error) {
      if (!isCurrent()) return null;
      roomSelect.innerHTML = '<option value="">查询失败，请重新查询会议室</option>';
      delete roomSelect.dataset.selectionId;
      if (note) { note.textContent = conciseError(error); note.classList.add('warning'); }
      showRoomAuthorizationHelp(error);
      throw error;
    } finally {
      if (sequence === roomAvailabilitySequence && button?.isConnected) { button.disabled = false; button.textContent = '查询'; }
    }
  }

  function openInterviewCandidateRecovery(initialPhone = '', errorMessage = '') {
    showTalentDialog(`<header class="rf-dialog-head"><div><span>安排面试</span><h2>匹配本次面试候选人</h2><p>本次入口未能定位候选人。填写候选人手机号即可匹配，无需从名单中选择；请勿填写招聘人员手机号。</p></div></header><form id="rf-interview-recovery-form"><div class="rf-dialog-form"><label class="wide"><span>候选人手机号</span><input name="phone" type="tel" inputmode="tel" autocomplete="off" value="${escapeHtml(initialPhone)}" required placeholder="候选人的完整11位手机号"></label></div><p class="rf-dialog-message" role="status" data-recovery-message>${escapeHtml(errorMessage)}</p><div class="rf-dialog-actions"><button type="submit" class="btn-primary">匹配并继续安排</button></div></form>`, 'wide');
    const form = document.getElementById('rf-interview-recovery-form');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button'), message = form.querySelector('[data-recovery-message]');
      if (button.disabled) return;
      const token = talentDialogToken;
      try {
        button.disabled = true; message.textContent = '正在匹配候选人…';
        const result = await request('api/interviews/scheduling-candidate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: new FormData(form).get('phone') }) });
        if (isTalentDialogCurrent(token)) await openScheduleInterview(result.candidate.id, result.candidate);
      } catch (error) { if (isTalentDialogCurrent(token)) { message.textContent = conciseError(error); button.disabled = false; } }
    });
  }

  async function openScheduleInterview(candidateId = '', candidateHint = null) {
    if (!candidateId) return openInterviewCandidateRecovery();
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取候选人、面试官和会议室…</div>', 'wide');
    const isStale = () => token !== talentDialogToken;
    try {
      const [interviewers, rooms, current] = await Promise.all([
        request('api/interviews/interviewers'),
        Promise.resolve({ rooms: [] }),
        candidateHint?.id === candidateId ? candidateHint : state.talentDetails[candidateId] || (window.canOpenRecruitmentPage?.('resume-archive') ? fetchTalentDetail(candidateId) : request('api/interviews/scheduling-candidate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateId }) }).then(result => result.candidate)),
      ]);
      if (isStale()) return;
      if (current.id !== candidateId) throw new Error('候选人信息读取失败，请从人才档案或安排面试待办重新进入。');
      const selectedCandidateId = candidateId;
      showTalentDialog(`<header class="rf-dialog-head"><div><span>INTERVIEW INVITATION</span><h2>创建面试邀请</h2><p>确认后将先创建企业微信日程，再向候选人发送正式的面试邀请邮件。</p></div></header><div class="rf-dialog-form"><label class="wide"><span>本次面试候选人</span><input id="rf-interview-candidate" type="hidden" value="${escapeHtml(selectedCandidateId)}"><input value="${escapeHtml(current.name || '未识别姓名')}" readonly aria-label="本次面试候选人"><small>${escapeHtml(current.bestMatchRole || current.jobIntention || current.role || '岗位待确认')} · 已绑定当前候选人，无需选择</small></label><label><span>面试轮次</span><select id="rf-interview-round"><option>一面</option><option>二面</option><option>加面</option></select></label><label><span>面试方式</span><select id="rf-interview-mode"><option>线下面试</option><option>线上面试</option></select></label><label><span>开始时间</span><input id="rf-interview-start" type="datetime-local"></label><label><span>结束时间（单场最多 8 小时）</span><input id="rf-interview-end" type="datetime-local"></label><label class="rf-interview-room-field"><span>会议室 <b>*</b></span><span class="rf-room-query"><select id="rf-interview-room" required data-placeholder="输入会议室名称搜索">${interviewRoomOptions(rooms.rooms || [])}</select><button class="btn-soft" data-rf-refresh-room-availability type="button" aria-label="查询会议室">查询</button></span><small id="rf-room-availability-note">${(rooms.rooms || []).length ? '请选择单场面试的具体开始和结束时间（最长 8 小时）。' : '请先填写面试时间，再查询当前时段的会议室。'}</small><small class="rf-schedule-error" hidden></small></label><label class="wide rf-interviewer-field"><span>面试官 <b>*</b></span><select id="rf-interviewer-select" multiple required data-placeholder="输入姓名或角色搜索并添加面试官">${(interviewers.interviewers || []).map((item) => `<option value="${escapeHtml(item.id)}" data-wecom-id="${escapeHtml(item.wecomUserId || '')}" data-roles="${escapeHtml((item.roles || []).join('|'))}">${escapeHtml(item.name)}</option>`).join('')}</select><small id="rf-interviewer-role-note"></small><small class="rf-schedule-error" hidden></small></label><label class="wide"><span>给候选人的备注（可选）</span><textarea id="rf-interview-note" placeholder="例如：请提前10分钟到达，并携带作品集或案例材料。"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-create-interview type="button">创建企微日程并发送邮件</button></div><p id="rf-create-interview-message" class="rf-dialog-message"></p>`, 'wide');
      // 把原来的两个 datetime-local 输入收敛为「日期 + 开始时间 + 面试时长」，
      // 实际接口仍使用隐藏的开始/结束值，保留既有的企微实时校验契约。
      const candidateEmailOption = document.createElement('label');
      candidateEmailOption.className = 'wide rf-send-email-option';
      candidateEmailOption.innerHTML = '<input id="rf-send-candidate-email" type="checkbox" checked><span>发送候选人邀请邮件</span>';
      document.getElementById('rf-interview-note')?.closest('label')?.after(candidateEmailOption);
      const defaultInterviewTime = upcomingInterviewTimeRange();
      const defaultDate = defaultInterviewTime.date;
      document.querySelector('.rf-dialog-form')?.classList.add('rf-schedule-main');
      const startLabel = document.getElementById('rf-interview-start')?.closest('label');
      const endLabel = document.getElementById('rf-interview-end')?.closest('label');
      startLabel?.replaceWith(Object.assign(document.createElement('section'), { className: 'wide rf-schedule-time', innerHTML: `<label data-schedule-field="date"><span>面试日期 <b>*</b></span><input id="rf-interview-date" type="date" min="${localDateValue(new Date())}" value="${defaultDate}" required><small class="rf-schedule-error" hidden></small></label><label data-schedule-field="time"><span>开始时间（北京时间） <b>*</b></span><select id="rf-interview-time" required data-placeholder="请选择开始时间">${interviewStartOptions('')}</select><small class="rf-schedule-error" hidden></small></label><label data-schedule-field="duration"><span>面试时长 <b>*</b></span><select id="rf-interview-duration" required data-placeholder="请选择面试时长">${interviewDurationOptions(0)}</select><small class="rf-schedule-error" hidden></small></label><input id="rf-interview-start" type="hidden"><input id="rf-interview-end" type="hidden">` }));
      endLabel?.remove();
      const modeSelect = document.getElementById('rf-interview-mode');
      if (modeSelect) {
        modeSelect.required = true;
        modeSelect.value = '';
        modeSelect.dataset.placeholder = '请选择面试方式';
        modeSelect.insertAdjacentHTML('afterbegin', '<option value="">请选择</option>');
        const modeLabel = modeSelect.closest('label');
        const modeTitle = modeLabel?.querySelector('span');
        if (modeTitle && !modeTitle.querySelector('b')) modeTitle.insertAdjacentHTML('beforeend', ' <b>*</b>');
        if (modeLabel && !modeLabel.querySelector('.rf-schedule-error')) modeLabel.insertAdjacentHTML('beforeend', '<small class="rf-schedule-error" hidden></small>');
        modeLabel?.setAttribute('data-schedule-field', 'mode');
      }
      const roundLabel = document.getElementById('rf-interview-round')?.closest('label');
      const roundTitle = roundLabel?.querySelector('span');
      if (roundTitle && !roundTitle.querySelector('b')) roundTitle.insertAdjacentHTML('beforeend', ' <b>*</b>');
      document.getElementById('rf-interview-time')?.addEventListener('pointerdown', () => {
        const startSelect = document.getElementById('rf-interview-time');
        if (!startSelect?.value) {
          startSelect.value = upcomingInterviewTimeRange().currentStartTime;
          syncInterviewTimeFields();
        }
      });
      document.querySelector('.rf-schedule-main')?.addEventListener('input', (event) => clearScheduleFieldError(event.target));
      document.querySelector('.rf-schedule-main')?.addEventListener('change', (event) => clearScheduleFieldError(event.target));
      const scheduleHeader = document.querySelector('.rf-dialog-head');
      scheduleHeader?.classList.add('rf-schedule-head');
      if (scheduleHeader?.querySelector('span')) scheduleHeader.querySelector('span').textContent = '安排面试';
      if (scheduleHeader?.querySelector('h2')) scheduleHeader.querySelector('h2').textContent = `为${current.name || '当前候选人'}安排面试`;
      if (scheduleHeader?.querySelector('p')) scheduleHeader.querySelector('p').textContent = '确认时间和面试官后发送邀请，处理结果会在这里显示。';
      const scheduleForm = document.querySelector('.rf-dialog-form.rf-schedule-main');
      scheduleForm?.closest('.rf-dialog')?.classList.add('rf-invitation-editor');
      const historyItems = await request(`api/interviews/appointments?candidateId=${encodeURIComponent(selectedCandidateId)}`).then((result) => result.appointments || []).catch(() => []);
      const historyAside = document.createElement('aside');
      historyAside.className = 'rf-schedule-history';
      historyAside.innerHTML = `<header><b>历史约面</b><span>${historyItems.length} 条</span></header>${historyItems.length ? `<div>${[...historyItems].sort((left, right) => String(right.startAt || '').localeCompare(String(left.startAt || ''))).map((item) => {
        const when = shanghaiDateTimeParts(item.startAt);
        const place = item.room?.name || item.location || item.meetingUrl || '地点待定';
        const people = (item.interviewers || []).map((person) => person.name).filter(Boolean).join('、') || '面试官待定';
        return `<article><time><strong>${escapeHtml(when.shortDate || '日期待定')}</strong><span>${escapeHtml(when.time || '')}</span></time><div><strong>${escapeHtml(item.round || '面试')}</strong><em>${escapeHtml(item.status || item.confirmationStatus || '待确认')}</em><p>${escapeHtml(item.mode || '方式待定')} · ${escapeHtml(place)}</p><small>${escapeHtml(people)}</small></div></article>`;
      }).join('')}</div>` : '<p class="rf-schedule-history-empty">暂无历史约面记录</p>'}`;
      if (scheduleForm) {
        const scheduleLayout = document.createElement('div');
        scheduleLayout.className = 'rf-schedule-workspace';
        scheduleForm.before(scheduleLayout);
        scheduleLayout.append(scheduleForm, historyAside);
      }
      const candidateField = document.getElementById('rf-interview-candidate')?.closest('label');
      candidateField?.classList.add('rf-invitation-person');
      const scheduleActions = document.querySelector('.rf-dialog-actions');
      const scheduleMessage = document.getElementById('rf-create-interview-message');
      if (scheduleForm && scheduleActions) {
        scheduleForm.append(scheduleActions);
        scheduleActions.classList.add('rf-schedule-actions');
        scheduleActions.innerHTML = '<button class="btn-soft" data-rf-cancel-schedule type="button">返回</button><button class="btn-primary" data-rf-create-interview type="button">确认并发送邀请</button>';
        scheduleMessage?.classList.add('rf-schedule-message');
        scheduleMessage?.setAttribute('role', 'status');
        scheduleMessage?.setAttribute('aria-live', 'polite');
        scheduleMessage?.setAttribute('tabindex', '-1');
      }
      const queryRoomsButton = document.querySelector('[data-rf-refresh-room-availability]');
      if (queryRoomsButton) { queryRoomsButton.textContent = '查询'; queryRoomsButton.classList.add('rf-query-rooms'); }
      document.querySelector('[data-rf-sync-wecom-rooms]')?.remove();
      const roomSelect = document.getElementById('rf-interview-room');
      if (roomSelect) roomSelect.dataset.source = 'wecom';
      const roomNote = document.getElementById('rf-room-availability-note');
      if (roomNote) roomNote.textContent = '选择面试时间后，系统将获取该时段企微会议室的空闲与占用状态。';
      syncInterviewTimeFields();
      const interviewerRoleNote = document.getElementById('rf-interviewer-role-note');
      const candidateRole = current.bestMatchRole || current.jobIntention || current.role || '';
      const matchedInterviewerCount = [...document.querySelectorAll('#rf-interviewer-select option')].filter((option) => interviewerMatchesRole((option.dataset.roles || '').split('|').filter(Boolean), candidateRole)).length;
      if (interviewerRoleNote) interviewerRoleNote.textContent = candidateRole ? (matchedInterviewerCount ? `可搜索全部面试官；其中 ${matchedInterviewerCount} 位适配“${candidateRole}”。` : `当前岗位“${candidateRole}”暂无角色匹配，可搜索全部面试官。`) : '输入姓名或角色即可搜索面试官。';
      document.getElementById('rf-interview-mode')?.addEventListener('change', () => { applyInterviewMode(); scheduleMeetingRoomAvailability(); });
      const interviewerSelect = document.getElementById('rf-interviewer-select');
      const interviewerRoleNoteNode = document.getElementById('rf-interviewer-role-note');
      if (interviewerSelect && interviewerRoleNoteNode) {
        const selectedNames = document.createElement('small');
        selectedNames.id = 'rf-interviewer-selected';
        selectedNames.className = 'rf-interviewer-selected';
        selectedNames.setAttribute('aria-live', 'polite');
        (interviewerSelect.closest('.rf-combobox') || interviewerRoleNoteNode).before(selectedNames);
        const renderSelectedNames = () => {
          const names = [...interviewerSelect.selectedOptions].map((option) => option.textContent.trim());
          selectedNames.textContent = names.length ? `已选面试官：${names.join('、')}（${names.length} 人）` : '尚未选择面试官';
          selectedNames.classList.toggle('is-filled', names.length > 0);
        };
        interviewerSelect.addEventListener('change', renderSelectedNames);
        renderSelectedNames();
      }
      ['rf-interview-date', 'rf-interview-time', 'rf-interview-duration'].forEach((id) => document.getElementById(id)?.addEventListener('change', () => { syncInterviewTimeFields(); scheduleMeetingRoomAvailability(); }));
      document.querySelector('[data-rf-refresh-room-availability]')?.addEventListener('click', () => refreshMeetingRoomAvailability().catch(() => {}));
      document.querySelector('[data-rf-sync-wecom-rooms]')?.addEventListener('click', () => syncWecomRoomsForSchedule(selectedCandidateId));
      document.querySelector('[data-rf-cancel-schedule]')?.addEventListener('click', cancelTalentDialog);
      document.querySelector('[data-rf-create-interview]')?.addEventListener('click', createInterview);
      applyInterviewMode();
    } catch (error) { showTalentDialog(`<div class="rf-dialog-error"><strong>资源读取失败</strong><p>${escapeHtml(conciseError(error))}</p></div>`); }
  }

  function scheduleFieldHost(node) {
    return node?.closest('[data-schedule-field], .rf-interview-room-field, .rf-interviewer-field, label, .rf-comm-hr-picker') || null;
  }

  function markScheduleField(node, error) {
    const host = scheduleFieldHost(node);
    if (!host) return;
    host.classList.toggle('is-invalid', Boolean(error));
    const message = host.querySelector('.rf-schedule-error');
    if (message) {
      message.hidden = !error;
      message.textContent = error || '';
    }
  }

  function clearScheduleFieldError(node) {
    const host = scheduleFieldHost(node);
    if (!host?.classList.contains('is-invalid')) return;
    const multiSelect = host.querySelector('select[multiple]');
    if (multiSelect) {
      if (multiSelect.selectedOptions.length) markScheduleField(multiSelect, '');
      return;
    }
    const control = host.querySelector('input:not([type="hidden"]), select, textarea');
    if (control && !String(control.value || '').trim()) return;
    markScheduleField(control || node, '');
  }

  function validateScheduleForm() {
    const checks = [
      ['rf-interview-mode', '请选择面试方式'],
      ['rf-interview-date', '请选择面试日期'],
      ['rf-interview-time', '请选择开始时间'],
      ['rf-interview-duration', '请选择面试时长'],
      ['rf-interview-room', '请选择会议室'],
      ['rf-interviewer-select', '请选择面试官'],
    ];
    let firstInvalid = null;
    checks.forEach(([id, error]) => {
      const node = document.getElementById(id);
      const invalid = node?.multiple ? !node.selectedOptions.length : !String(node?.value || '').trim();
      markScheduleField(node, invalid ? error : '');
      if (invalid && !firstInvalid) firstInvalid = node;
    });
    const rangeError = validateSingleInterviewRange(document.getElementById('rf-interview-start')?.value || '', document.getElementById('rf-interview-end')?.value || '');
    if (!firstInvalid && rangeError) {
      const timeNode = document.getElementById('rf-interview-time');
      markScheduleField(timeNode, rangeError);
      firstInvalid = timeNode;
    }
    if (firstInvalid) {
      const focusTarget = firstInvalid.closest('.rf-combobox')?.querySelector('.rf-combobox-input') || firstInvalid;
      focusTarget.focus();
      scheduleFieldHost(firstInvalid)?.scrollIntoView({ block: 'nearest' });
    }
    return !firstInvalid;
  }

  async function createInterview() {
    const candidateId = document.getElementById('rf-interview-candidate')?.value || '';
    const mode = document.getElementById('rf-interview-mode')?.value || '';
    const roomId = interviewRoomIdFrom(document.getElementById('rf-interview-room')?.value);
    const message = document.getElementById('rf-create-interview-message');
    const submit = document.querySelector('[data-rf-create-interview]');
    if (submit?.disabled) return;
    const candidateName = document.querySelector('[aria-label="本次面试候选人"]')?.value || '候选人';
    const scheduleSummary = document.getElementById('rf-interview-time-preview')?.textContent || '';
    if (!validateScheduleForm()) return;
    const loading = showGlobalLoading('正在校验会议室并创建企微日程…');
    try {
      if (submit) { submit.disabled = true; submit.dataset.originalText = submit.textContent; submit.textContent = '正在创建日程并发送邮件…'; }
      if (!candidateId) throw new Error('未找到本次面试的候选人，请重新打开面试安排。');
      const interviewerSelect = document.getElementById('rf-interviewer-select');
      const interviewerOptions = [...(interviewerSelect?.selectedOptions || [])];
      const interviewerIds = interviewerOptions.map((option) => option.value).filter(Boolean);
      const publicUrl = new URL(window.location.href); publicUrl.search = ''; publicUrl.hash = '';
      const roomSelect = document.getElementById('rf-interview-room');
      const meetingRoomSelectionId = roomId ? roomSelect?.dataset.selectionId || '' : '';
      if (roomId && roomSelect?.dataset.source === 'wecom' && !meetingRoomSelectionId) throw new Error('请先查询当前时段的企微会议室，再确认邀请。');
      const interviewerWecomIds = interviewerOptions.map((option) => option.dataset.wecomId || '').filter(Boolean);
      if (!interviewerIds.length || interviewerWecomIds.length !== interviewerIds.length) throw new Error('所选面试官未配置企微成员 ID，请先在组织与权限中同步。');
      const payload = { candidateId, round: document.getElementById('rf-interview-round')?.value, mode, startAt: shanghaiDateTimeIso(document.getElementById('rf-interview-start')?.value), endAt: shanghaiDateTimeIso(document.getElementById('rf-interview-end')?.value), timezone: 'Asia/Shanghai', meetingRoomId: roomId, location: '山东省烟台市莱山区方片新媒体', interviewerIds, ...(interviewerWecomIds.length ? { interviewerWecomIds } : {}), ...(meetingRoomSelectionId ? { meetingRoomSelectionId } : {}), note: document.getElementById('rf-interview-note')?.value.trim(), sendCandidateEmail: document.getElementById('rf-send-candidate-email')?.checked !== false, operator: '当前用户', publicUrl: publicUrl.toString() };
      if (message) { message.textContent = '正在创建企微日程并发送邀请，请勿重复提交…'; message.classList.remove('error'); }
      loading('正在创建企微日程并发送邀请邮件，请稍候…');
      if (!submit.dataset.requestId) submit.dataset.requestId = crypto.randomUUID();
      const started = submit.dataset.jobId ? { jobId: submit.dataset.jobId } : await request(`api/interviews/appointments?background=true&requestId=${encodeURIComponent(submit.dataset.requestId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (started.jobId) submit.dataset.jobId = started.jobId;
      const result = started.jobId ? await pollInterviewCreation(started.jobId, (progress) => { loading(progress); if (message?.isConnected) message.textContent = progress; }) : started;
      hideGlobalLoading();
      document.dispatchEvent(new CustomEvent('resumeflow:interview-created', { detail: { interviewId: result.interviewId } }));
      const calendarOk = result.sync?.status === '已同步', emailOk = ['已发送', '未发送'].includes(result.email?.status), completeOk = calendarOk && emailOk;
     const questionStatus = result.questionJob?.status === 'running' ? '已开始生成' : result.questionJob?.status || '已发布';
     showTalentDialog(`<div class="rf-operation-result rf-invitation-result ${completeOk ? 'is-success' : 'is-warning'}" role="status" aria-live="polite"><i>${completeOk ? '✓' : '!'}</i><span>面试邀请处理结果</span><h2>${completeOk ? (result.email?.status === '已发送' ? '面试邀请已发送' : '企微日程已创建，邮件已跳过') : '面试处理未完成'}</h2><p class="rf-invitation-summary">${escapeHtml(candidateName)}<br>${escapeHtml(scheduleSummary)}</p><div class="rf-invitation-receipt"><article class="${calendarOk ? 'done' : 'failed'}"><b>01</b><div><strong>创建企微日程</strong><small>${escapeHtml(result.sync?.status || '未完成')}${result.sync?.message ? ` · ${escapeHtml(result.sync.message)}` : ''}</small></div></article><article class="${emailOk ? 'done' : 'failed'}"><b>02</b><div><strong>发送候选人邮件</strong><small>${escapeHtml(result.email?.status || '未发送')}${result.email?.message ? ` · ${escapeHtml(result.email.message)}` : ''}</small></div></article><article class="done"><b>03</b><div><strong>生成面试题</strong><small>${escapeHtml(questionStatus)} · 已预生成，开始前 10 分钟发送链接</small></div></article></div><p>${completeOk ? '面试题已预生成；面试前 10 分钟将发给面试官，面试结束后再发送评价入口。' : '请按错误信息修正后重新提交；本次未生成有效面试记录。'}</p><div class="rf-dialog-actions"><button class="btn-primary" data-rf-invitation-done type="button">知道了</button><button class="btn-soft" data-rf-open-interview-page type="button">查看面试排期</button></div></div>`);
      document.querySelector('[data-rf-invitation-done]')?.addEventListener('click', closeTalentDialog);
      document.querySelector('[data-rf-open-interview-page]')?.addEventListener('click', () => { closeTalentDialog(false); window.setPage?.('interviews'); });
      notifyUser(completeOk ? `${candidateName}的面试处理完成，面试题已预生成，将在开始前 10 分钟发送。` : '面试处理未完成，请按提示修正后重新提交。', completeOk ? 'success' : 'info');
    } catch (error) {
      hideGlobalLoading();
      if (submit && error.jobFailed) { delete submit.dataset.jobId; delete submit.dataset.requestId; }
      if (submit) { submit.disabled = false; submit.textContent = submit.dataset.jobId ? '重新查看处理结果' : submit.dataset.originalText || '确认并发送邀请'; }
      const errorMessage = error.message || '提交结果暂时无法确认，请先查看面试排期，确认是否已创建。';
      if (message) { message.textContent = errorMessage; message.classList.add('error'); message.setAttribute('role', 'alert'); }
      notifyUser(errorMessage, 'error');
    }
  }

  async function pollInterviewCreation(jobId, progress) {
    try {
      return await waitForBackgroundJob(jobId, progress, { timeoutMessage: '任务仍在后台处理，可点击“重新查看处理结果”，不会重复创建面试。' });
    } catch (error) {
      if (!/系统未生成面试记录/.test(error.message)) error.message = `${error.message.replace(/[。.]+$/, '')}。请先查看面试排期确认已保存的步骤，勿重复创建。`;
      throw error;
    }
  }

  async function pushTalentFlowWecom(step, button) {
    if (!step || button?.disabled) return;
    const originalText = button?.textContent || '';
    try {
      if (button) { button.disabled = true; button.textContent = '推送中…'; }
      const candidateId = state.talentDetails[state.activeId]?.candidateId || state.activeId;
      const identity = window.recruitmentCurrentUser || {};
      const result = await request(`api/talents/${encodeURIComponent(candidateId)}/flow-wecom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, operator: identity.name || '当前用户', operatorUserId: identity.id || '' }),
      });
      const status = result?.result?.status || result?.status || '';
      notifyUser(['已发送', '已跳过'].includes(status) ? `企微推送已完成：${status}` : `企微推送未完成：${status || '请查看消息记录'}`, ['已发送', '已跳过'].includes(status) ? 'success' : 'error');
    } catch (error) {
      notifyUser(`企微推送失败：${conciseError(error)}`, 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = originalText || '推送企微'; }
    }
  }

  async function generateInterviewQuestions(interviewId, button, regenerate = false) {
    if (!interviewId) { showTalentDialog('<div class="rf-dialog-error"><strong>生成失败</strong><p>请先安排面试，再生成面试题。</p></div>'); return; }
    const originalText = button?.textContent || '';
    let questionDialogToken = talentDialogToken;
    if (button) { button.disabled = true; button.textContent = '正在生成面试题…'; }
    try {
    const token = showTalentDialog('<header class="rf-dialog-head"><div><span>INTERVIEW QUESTIONS</span><h2>正在准备本次面试题</h2><p id="rf-question-generation-progress" role="status" aria-live="polite">读取岗位基础题与个人题库…</p></div></header><div class="qb-empty">面试创建后，系统组合题单并推送给面试官。可关闭此窗口，任务继续处理。</div>', 'wide');
      questionDialogToken = token;
      const started = await request(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/generate-questions?background=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 12, operator: '当前用户', regenerate }), initiator: button });
      await pollInterviewResource(started, progress => { const node = document.getElementById('rf-question-generation-progress'); if (isTalentDialogCurrent(token) && node) node.textContent = progress; }, '面试题生成');
      if (isTalentDialogCurrent(token)) await openInterviewQuestionReview(interviewId);
    } catch (error) {
      if (!isTalentDialogCurrent(questionDialogToken)) return;
      showTalentDialog(`<div class="rf-dialog-error"><strong>面试题暂未完成</strong><p>${escapeHtml(conciseError(error))}</p><button class="btn-soft" data-rf-retry-questions type="button">查看当前题单</button></div>`);
      document.querySelector('[data-rf-retry-questions]')?.addEventListener('click', () => openInterviewQuestionReview(interviewId));
    } finally { if (button) { button.disabled = false; button.textContent = originalText; } }
  }

  async function syncWecomResources(){const message=document.getElementById('rf-interview-workbench-message');try{const result=await request('api/interviews/wecom/resources/sync',{method:'POST'});if(result.status==='已连接'){await openInterviewWorkbench()}else if(message)message.textContent=`${result.message||'企微会议室同步未完成'}${result.action?` ${result.action}`:''}`}catch(error){if(message)message.textContent=error.message}}
  async function syncWecomRoomsForSchedule(){
    const button=document.querySelector('[data-rf-sync-wecom-rooms]');
    if(button?.disabled)return;
    const note=document.getElementById('rf-room-availability-note');
    const roomSelect=document.getElementById('rf-interview-room');
    const startAt=document.getElementById('rf-interview-start')?.value||'';
    const endAt=document.getElementById('rf-interview-end')?.value||'';
    const show=(message,warning=true)=>{if(!note)return;note.textContent=message;note.classList.toggle('warning',warning)};
    try{
      if(!startAt||!endAt){show('请先填写开始时间和结束时间，再查询企业微信的可用会议室。',true);return}
      const rangeError=validateSingleInterviewRange(startAt,endAt);
      if(rangeError){show(rangeError,true);return}
      if(button){button.disabled=true;button.textContent='同步中…'}
      show('正在同步企微会议室资源，请稍候…',false);
      const started=await request('api/interviews/wecom/resources/sync?background=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({startAt:shanghaiDateTimeIso(startAt),endAt:shanghaiDateTimeIso(endAt)})});
      const result=await pollInterviewResource(started,message=>show(message,false));
      if(roomSelect!==document.getElementById('rf-interview-room')||startAt!==document.getElementById('rf-interview-start')?.value||endAt!==document.getElementById('rf-interview-end')?.value)return;
      if(result.status!=='已连接'||!Number(result.syncedCount)){
        show(`${result.message||'企微会议室同步未完成'}${result.action?` ${result.action}`:''}`,true);
        return;
      }
      const selected=roomSelect?.value||'';
      const rooms=await request('api/interviews/rooms');
      if(roomSelect)roomSelect.innerHTML=interviewRoomOptions(rooms.rooms||[],selected);
      show(`已同步 ${Number(result.syncedCount)} 间企微会议室。请填写面试时间后点击“查询空闲状态”进行实时校验。`,false);
    }catch(error){show(error.message||'企微会议室同步失败，请稍后重试。',true)}
    finally{if(button?.isConnected){button.disabled=false;button.textContent='查询并同步会议室'}}
  }
  async function checkInterviewReminders(){await request('api/interviews/reminders/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator:'当前用户'})});await openInterviewWorkbench()}
  async function retryInterviewSync(id){await request(`api/interviews/appointments/${encodeURIComponent(id)}/retry-sync`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator:'当前用户'})});await openInterviewWorkbench()}
  function cancelInterview(id) {
    const appointment = (state.interviewData?.appointments || []).find((item) => item.id === id) || {};
    const candidateName = appointment.candidateName || '该候选人';
    const schedule = [formatShanghaiDateTime(appointment.startAt), appointment.round || ''].filter(Boolean).join(' · ');
    showTalentDialog(`<header class="rf-dialog-head rf-cancel-interview-head"><div><span>CANCEL INTERVIEW</span><h2>取消面试预约</h2><p>取消后，本系统排期会立即释放；如该预约已有企微日程，系统会同时尝试取消企微日程。</p></div></header><section class="rf-cancel-interview-summary"><strong>${escapeHtml(candidateName)}</strong><span>${escapeHtml(schedule || '面试时间待确认')}</span><small>请填写原因，系统会保留在该面试记录中。</small></section><div class="rf-dialog-form rf-cancel-interview-form"><label class="wide"><span>取消原因 <b>*</b></span><textarea id="rf-cancel-interview-reason" required autofocus placeholder="例如：候选人主动取消、岗位需求调整、改期后重新预约"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-soft" data-rf-cancel-interview-close type="button">暂不取消</button><button class="danger" data-rf-confirm-cancel-interview type="button">确认取消面试</button></div><p class="rf-dialog-message" id="rf-cancel-interview-message"></p>`, 'rf-cancel-interview-dialog');
    document.querySelector('[data-rf-cancel-interview-close]')?.addEventListener('click', cancelTalentDialog);
    document.querySelector('[data-rf-confirm-cancel-interview]')?.addEventListener('click', () => submitInterviewCancellation(id));
  }

  async function submitInterviewCancellation(id) {
    const reason = document.getElementById('rf-cancel-interview-reason')?.value.trim() || '';
    const message = document.getElementById('rf-cancel-interview-message');
    const submit = document.querySelector('[data-rf-confirm-cancel-interview]');
    if (!reason) {
      if (message) { message.textContent = '请填写取消原因后再提交。'; message.classList.add('error'); }
      document.getElementById('rf-cancel-interview-reason')?.focus();
      return;
    }
    try {
      if (message) { message.textContent = '正在取消本系统排期，并同步处理企微日程…'; message.classList.remove('error'); }
      if (submit) submit.disabled = true;
      const result = await request(`api/interviews/appointments/${encodeURIComponent(id)}/cancel`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({reason,operator:'当前用户'}) });
      await openInterviewWorkbench();
      if (result.sync?.status === '同步失败') notifyUser(`面试已在本系统取消，但企微日程未能同步取消：${result.sync.message || '请稍后在面试排期中重试同步。'}`, 'error');
      else notifyUser('面试已取消，排期已释放。', 'success');
    } catch (error) {
      if (message) { message.textContent = error.message || '取消面试失败，请稍后重试。'; message.classList.add('error'); }
      if (submit) submit.disabled = false;
    }
  }

  async function openEvaluationWorkbench(){if(state.archiveMode!=='api')return setTalentMessage('当前为离线档案预览，接口可用后才能填写面试评价。',true);const token=showTalentDialog('<div class="rf-dialog-loading">正在读取面试、模板和评价分析…</div>','wide');try{const[workbench,templates,analytics]=await Promise.all([request('api/interview-evaluations/workbench'),request('api/interview-evaluations/templates'),request('api/interview-evaluations/analytics')]);if(!isTalentDialogCurrent(token))return;state.evaluationData={...workbench,templates:templates.templates||[],analytics};renderEvaluationWorkbench()}catch(error){dialogFailure('面试评价工作台读取失败',error,openEvaluationWorkbench,token)}}
  async function openInterviewQuestionReview(interviewId){
    if(!interviewId){
      showTalentDialog('<div class="rf-dialog-error"><strong>面试题链接不完整</strong><p>链接缺少本次面试编号，无法确定题单。请从原始面试题消息重新打开完整链接，或联系招聘负责人获取新链接。</p></div>')
      return
    }
    const token=showTalentDialog('<div class="rf-dialog-loading">正在读取本次面试题目…</div>','wide')
    try{
      const item=await request(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/questions`)
      if(!isTalentDialogCurrent(token))return
      const questions=Array.isArray(item.questions)?item.questions:[]
      const regenerateLabel = item.status === '已发布' ? '重新生成题单' : '生成 / 重试';
      showTalentDialog(`<header class="rf-dialog-head"><div><span>INTERVIEW QUESTIONS</span><h2>${escapeHtml(item.candidateName||'候选人')} · 面试题</h2><p>${escapeHtml(item.role||'通用岗位')} · ${escapeHtml(item.round||'本轮')}</p></div></header><section class="rf-question-sheet"><div class="qb-review-summary"><strong>${questions.length} 道题</strong><span>${escapeHtml(item.status||'待生成')}</span><span>岗位基础 · 面试官补充 · AI定向追问</span></div><section class="rf-interview-question-review">${questions.length?window.renderInterviewQuestionCards(questions,escapeHtml):'<div class="qb-empty"><strong>暂未生成面试题</strong><p>面试创建后会自动生成；正在生成时可稍后刷新，不必重复操作。</p></div>'}</section><div class="qb-card-actions"><button class="btn-soft" data-rf-refresh-questions type="button">刷新题单</button>${questions.length?`<button class="btn-soft" data-rf-print-interview-questions type="button">打印 / 保存 PDF</button><button class="btn-soft" data-rf-export-interview-questions="${escapeHtml(interviewId)}" type="button">导出 Word</button>`:''}${item.status !== '生成中' ? `<button class="btn-primary" data-rf-regenerate-questions type="button">${regenerateLabel}</button>` : ''}</div><p class="rf-dialog-message" id="rf-interview-question-export-message"></p></section>`,'wide')
      document.querySelector('[data-rf-refresh-questions]')?.addEventListener('click',()=>openInterviewQuestionReview(interviewId))
      document.querySelector('[data-rf-regenerate-questions]')?.addEventListener('click',event=>generateInterviewQuestions(interviewId,event.currentTarget,item.status==='已发布'))
      document.querySelector('[data-rf-export-interview-questions]')?.addEventListener('click',(event)=>exportInterviewQuestions(interviewId,event.currentTarget))
      document.querySelector('[data-rf-print-interview-questions]')?.addEventListener('click',printInterviewQuestions)
    }catch(error){dialogFailure('面试题读取失败',error,()=>openInterviewQuestionReview(interviewId),token)}
  }
  function printInterviewQuestions(){
    const layer=document.getElementById('rf-talent-dialog')
    if(!layer)return
    const finish=()=>{document.body.classList.remove('rf-printing');layer.classList.remove('rf-printing')}
    document.body.classList.add('rf-printing');layer.classList.add('rf-printing')
    window.addEventListener('afterprint',finish,{once:true})
    window.print()
    window.setTimeout(finish,1000)
  }
  async function exportInterviewQuestions(interviewId,button){
    const message=document.getElementById('rf-interview-question-export-message'),label=button?.textContent||'导出 Word'
    try{
      if(button){button.disabled=true;button.textContent='正在生成 Word…'}
      if(message){message.textContent='正在生成可打印的面试题文档…';message.classList.remove('error')}
      const identity=window.recruitmentCurrentUser||{},headers={}
      if(identity.id)headers['x-user-id']=encodeURIComponent(String(identity.id))
      if(identity.name)headers['x-user-name']=encodeURIComponent(String(identity.name))
      const response=await fetch(apiUrl(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/questions/export`),{credentials:'include',headers})
      if(!response.ok){const contentType=response.headers.get('content-type')||'',body=contentType.includes('json')?await response.json():{message:await response.text()};throw new Error(Array.isArray(body.message)?body.message.join('；'):body.message||`导出失败 (${response.status})`)}
      const blob=await response.blob(),disposition=response.headers.get('content-disposition')||'',encodedName=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1],fallbackName=disposition.match(/filename="?([^";]+)"?/i)?.[1]
      let fileName=fallbackName||'面试题.docx';if(encodedName){try{fileName=decodeURIComponent(encodedName)}catch{}}
      const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=fileName;document.body.appendChild(anchor);anchor.click();anchor.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000)
      if(message)message.textContent='Word 文档已生成并开始下载。'
    }catch(error){if(message){message.textContent=conciseError(error);message.classList.add('error')}}finally{if(button){button.disabled=false;button.textContent=label}}
  }
  function renderEvaluationWorkbench(){const data=state.evaluationData||{items:[],analytics:{interviewers:[]}};showTalentDialog(`<header class="rf-dialog-head"><div><span>INTERVIEW EVALUATION</span><h2>面试评价与招聘决策</h2><p>面试官独立提交评价，AI纪要只做草稿；招聘负责人汇总多人意见后作最终决策。</p></div><button class="btn-soft" data-rf-check-evaluation-sla>检查评价催交</button></header><div class="rf-review-metrics"><article><span>面试记录</span><strong>${Number(data.total||0)}</strong></article><article><span>待评价</span><strong>${Number(data.pendingFeedback||0)}</strong></article><article><span>结构化模板</span><strong>${(data.templates||[]).length}</strong></article><article><span>已提交评价</span><strong>${(data.items||[]).reduce((s,x)=>s+Number(x.feedbackCount||0),0)}</strong></article><article class="warn"><span>意见待决策</span><strong>${(data.items||[]).filter(x=>x.feedbackCount>0&&x.evaluationStatus!=='已完成').length}</strong></article></div><div class="rf-evaluation-layout"><section><div class="rf-review-title"><strong>面试工作台</strong><small>测评结果、模板和评价进度统一展示</small></div><div class="rf-evaluation-list">${(data.items||[]).length?data.items.map(item=>`<article><div><strong>${escapeHtml(item.candidateName||'候选人')} · ${escapeHtml(item.round)}</strong><p>${escapeHtml(item.role||'岗位待定')} · ${escapeHtml(formatShanghaiDateTime(item.startAt))}</p><small>测评 ${Number(item.assessment?.score||0)}分 · 已交 ${Number(item.feedbackCount||0)}/${(item.interviewerIds||[]).length} · ${escapeHtml(item.evaluationStatus||'未开始')}</small></div><span>${escapeHtml(item.template?.name||'通用面试模板')}</span><button data-rf-write-feedback="${escapeHtml(item.id)}">填写评价</button><button class="soft" data-rf-view-aggregate="${escapeHtml(item.id)}">汇总决策</button></article>`).join(''):'<div class="rf-dialog-empty"><p>暂无面试记录。</p></div>'}</div></section><aside><div class="rf-review-title"><strong>面试官质量</strong><small>当前可用代理口径</small></div><div class="rf-interviewer-analytics">${(data.analytics?.interviewers||[]).map(item=>`<article><strong>${escapeHtml(item.name||item.userId)}</strong><span>平均 ${Number(item.averageScore||0)}分</span><small>提交${Number(item.submitted||0)}份 · 准确率 ${item.accuracy===null?'样本不足':`${item.accuracy}%`}</small></article>`).join('')||'<div class="rf-dialog-empty"><p>暂无足够评价样本。</p></div>'}</div></aside></div>`,'wide');document.querySelector('[data-rf-check-evaluation-sla]')?.addEventListener('click',checkEvaluationSla);document.querySelectorAll('[data-rf-write-feedback]').forEach(b=>b.addEventListener('click',()=>openFeedbackForm(b.dataset.rfWriteFeedback)));document.querySelectorAll('[data-rf-view-aggregate]').forEach(b=>b.addEventListener('click',()=>openEvaluationAggregate(b.dataset.rfViewAggregate)))}
  async function checkEvaluationSla(){await request('api/interview-evaluations/feedback-sla/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator:'当前用户'})});await openEvaluationWorkbench()}
  async function openTalentInterviewFeedback(candidateId = '', interviewId = '') {
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，接口可用后才能填写面试评价。', true);
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取面试评价信息…</div>', 'wide');
    const isStale = () => token !== talentDialogToken;
    try {
      const workbench = await request('api/interview-evaluations/workbench');
      if (isStale()) return;
      state.evaluationData = { ...state.evaluationData, ...workbench, templates: workbench.templates || [] };
      const items = workbench.items || [];
      const detail = state.talentDetails[candidateId] || state.talentDetails[state.activeId] || {};
      const effectiveCandidateId = detail.candidateId || candidateId || state.activeId;
      let effectiveInterviewId = interviewId || detail.flowEvidence?.interview?.id || flowInterviewIdForActiveCandidate(items);
      if (!effectiveInterviewId && effectiveCandidateId) {
        const appointments = await request(`api/interviews/appointments?candidateId=${encodeURIComponent(effectiveCandidateId)}`);
        effectiveInterviewId = appointments.appointments?.sort((a, b) => String(b.startAt || '').localeCompare(String(a.startAt || '')))[0]?.id || '';
      }
      if (!effectiveInterviewId) {
        showTalentDialog('<div class="rf-dialog-empty"><strong>暂无面试记录</strong><p>请先为该人才安排面试，然后再填写评价。</p></div>', 'wide');
        return;
      }
      if (!isStale()) await openFeedbackForm(effectiveInterviewId);
    } catch (error) {
      if (!isStale()) dialogFailure('面试评价信息读取失败', error, openTalentInterviewFeedback);
    }
  }

  function flowInterviewIdForActiveCandidate(items) {
    const candidateId = state.talentDetails[state.activeId]?.candidateId || state.activeId;
    return (items || []).filter((item) => item.candidateId === candidateId).sort((a, b) => String(b.startAt || '').localeCompare(String(a.startAt || '')))[0]?.id || '';
  }
  async function openFeedbackFormLegacy(interviewId){const item=(state.evaluationData?.items||[]).find(x=>x.id===interviewId);if(!item)return;const token=talentDialogToken;const template=item.template||{questions:[],dimensions:[]};let salary={benchmarks:[]};try{salary=await request(`api/interview-evaluations/salary-benchmarks?role=${encodeURIComponent(item.role||'')}`)}catch{}if(!isTalentDialogCurrent(token))return;showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-rf-evaluation-back>← 返回评价工作台</button><span>STRUCTURED INTERVIEW</span><h2>${escapeHtml(item.candidateName)} · ${escapeHtml(template.name||'面试评价')}</h2><p>最近测评 ${Number(item.assessment?.score||0)}分；薪酬参考 ${salary.benchmarks?.length?`${salary.benchmarks[0].min}-${salary.benchmarks[0].max} 元/月`:'暂无可靠数据'}。</p></div></header><div class="rf-interview-question-list">${(template.questions||[]).map((q,index)=>`<article data-eval-question="${escapeHtml(q.id||`q${index+1}`)}"><span>${index+1}</span><div><strong>${escapeHtml(q.question)}</strong><small>${escapeHtml(q.followUp||q.observation||'请记录事实证据')}</small><textarea placeholder="记录候选人回答和可核验事实"></textarea></div></article>`).join('')||'<div class="rf-dialog-empty"><p>当前模板暂无结构化问题，可在模板管理中补充。</p></div>'}</div><label class="rf-dialog-note"><span>面试记录 / 纪要原文</span><textarea id="rf-interview-raw-notes" placeholder="记录关键问答、事实、数据和待确认项"></textarea></label><div class="rf-evaluation-score-grid">${[['professional','专业能力'],['communication','沟通能力'],['execution','执行能力'],['culture','文化匹配'],['potential','发展潜力']].map(([key,label])=>`<label><span>${label}</span><input data-eval-score="${key}" type="number" min="0" max="100" value="70"></label>`).join('')}</div><div class="rf-dialog-form"><label><span>推荐结论</span><select id="rf-feedback-recommendation"><option>通过</option><option>加面</option><option>储备</option><option>待讨论</option><option>淘汰</option></select></label><label><span>面试官用户ID</span><input id="rf-feedback-user-id" value="current_interviewer"></label><label><span>面试官姓名</span><input id="rf-feedback-name" value="当前面试官"></label><label class="wide"><span>候选人优势</span><textarea id="rf-feedback-strengths"></textarea></label><label class="wide"><span>风险与待核实项</span><textarea id="rf-feedback-risks"></textarea></label><label class="wide"><span>完整面试评价</span><textarea id="rf-feedback-comment"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-soft" data-rf-generate-interview-ai>生成AI纪要草稿</button><button class="btn-primary" data-rf-submit-feedback>独立提交并锁定评价</button></div><p class="rf-dialog-message" id="rf-feedback-message"></p>`,'wide');document.querySelector('[data-rf-evaluation-back]')?.addEventListener('click',renderEvaluationWorkbench);document.querySelector('[data-rf-generate-interview-ai]')?.addEventListener('click',()=>generateInterviewAi(interviewId));document.querySelector('[data-rf-submit-feedback]')?.addEventListener('click',()=>submitInterviewFeedback(interviewId))}
  async function importInterviewFeedbackFile(event) {
    const input = event.currentTarget;
    const status = document.getElementById('rf-feedback-transcript-file-status');
    const textarea = document.getElementById('rf-feedback-transcript');
    const file = input?.files?.[0];
    if (!file || !textarea) return;
    if (file.size > 1024 * 1024) {
      if (status) { status.textContent = '文件超过1MB，请粘贴需要的面试内容。'; status.classList.add('error'); }
      input.value = '';
      return;
    }
    try {
      const content = await file.text();
      if (content.length > 20000) throw new Error('文件内容最多20000字');
      textarea.value = content.trim();
      if (status) { status.textContent = `已导入：${file.name} · ${content.length}字`; status.classList.remove('error'); }
    } catch (error) {
      if (status) { status.textContent = error.message || '文件读取失败'; status.classList.add('error'); }
    }
  }

  function startInterviewFeedbackVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const textarea = document.getElementById('rf-feedback-transcript');
    const status = document.getElementById('rf-feedback-transcript-status');
    const button = document.querySelector('[data-rf-feedback-voice]');
    if (!textarea || !status || !button) return;
    if (!SpeechRecognition) {
      status.textContent = '当前浏览器不支持语音输入，请使用手机输入法语音键，或直接粘贴文字。';
      status.classList.add('error');
      return;
    }
    const recognition = new SpeechRecognition();
    const originalText = textarea.value.trim();
    let finalText = '';
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      button.disabled = true;
      button.textContent = '正在听…';
      status.textContent = '请直接说面试表现、优势、风险、是否通过，以及是否适合其他岗位。';
      status.classList.remove('error');
    };
    recognition.onresult = (event) => {
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const value = event.results[index][0]?.transcript || '';
        if (event.results[index].isFinal) finalText += value;
        else interimText += value;
      }
      textarea.value = [originalText, finalText, interimText].filter(Boolean).join(originalText ? '\n' : '');
    };
    recognition.onerror = (event) => {
      status.textContent = event.error === 'not-allowed' ? '未获得麦克风权限，请允许后重试。' : '语音输入中断，请重试或使用手机输入法语音键。';
      status.classList.add('error');
    };
    recognition.onend = () => {
      button.disabled = false;
      button.textContent = '开始口述';
      if (!status.classList.contains('error')) status.textContent = textarea.value.trim() ? '口述已转为文字，可点击“AI解析并填充”。' : '没有识别到内容，请重试。';
    };
    recognition.start();
  }

  async function extractInterviewFeedback(interviewId) {
    const transcriptField = document.getElementById('rf-feedback-transcript');
    const transcript = transcriptField?.value.trim() || '';
    const status = document.getElementById('rf-feedback-transcript-status');
    const button = document.querySelector('[data-rf-feedback-extract]');
    if (!transcript) {
      if (status) { status.textContent = '请先粘贴会议总结或面试记录。'; status.classList.add('error'); }
      return;
    }
    if (button) button.disabled = true;
    if (status) { status.textContent = 'AI正在整理面试结论和面试总结…'; status.classList.remove('error'); }
    try {
      const result = await requestCommunicationExtraction(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/feedback-extract`, transcript, status);
      if (!button?.isConnected) return;
      const extraction = result.extraction || {};
      const setValue = (id, value) => {
        const node = document.getElementById(id);
        if (node) node.value = value || '';
      };
      setValue('rf-feedback-recommendation', extraction.recommendation);
      const aiSummary = String(extraction.comment || '').trim();
      if (!aiSummary) throw new Error('AI未生成面试总结，请补充会议记录后重试。');
      setValue('rf-feedback-ai-summary', aiSummary);
      if (transcriptField) transcriptField.dataset.convertedTranscript = transcript;
      if (status) status.textContent = '解析完成：AI面试总结已更新；面试官评价仍由你填写，不会被覆盖。';
    } catch (error) {
      if (status) { status.textContent = conciseError(error); status.classList.add('error'); }
    } finally {
      if (button) button.disabled = false;
    }
  }

  function interviewFeedbackHistoryDetail(record) {
    const fields = [
      ['面试轮次', record.round], ['面试时间', formatShanghaiDateTime(record.interviewStartAt)],
      ['面试官', record.interviewer], ['候选人评级', record.candidateRating],
      ['最终结论', record.finalDecision || record.recommendation], ['AI面试总结', record.aiSummary],
      ['面试官评价', record.interviewerEvaluation], ['会议总结 / 粘贴原文', record.notes],
      ['提交时间', formatShanghaiDateTime(record.submittedAt)],
    ];
    return `<dl class="rf-comm-history-detail">${fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '未记录')}</dd></div>`).join('')}</dl>`;
  }

  async function openFeedbackForm(interviewId) {
    let item = (state.evaluationData?.items || []).find((x) => x.id === interviewId);
    if (!item) {
      const token = showTalentDialog('<div class="rf-dialog-loading">正在同步面试评价记录…</div>', 'wide');
      try {
        const workbench = await request('api/interview-evaluations/workbench');
        if (!isTalentDialogCurrent(token)) return;
        state.evaluationData = { ...state.evaluationData, ...workbench, templates: workbench.templates || [] };
        item = (workbench.items || []).find((x) => x.id === interviewId);
      } catch (error) {
        if (isTalentDialogCurrent(token)) dialogFailure('面试评价记录同步失败', error, () => openFeedbackForm(interviewId));
        return;
      }
    }
    if (!item) {
      showTalentDialog('<div class="rf-dialog-error"><strong>未找到本次面试</strong><p>记录可能已被取消或删除，请返回工作台刷新后再试。</p></div>', 'wide');
      return;
    }
    let feedbackHistory = [];
    let feedbackHistoryError = '';
    try {
      const historyResult = await request(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/feedback`);
      feedbackHistory = historyResult.history || historyResult.feedback || [];
    } catch (error) {
      feedbackHistoryError = conciseError(error);
    }
    const currentInterviewer = window.recruitmentCurrentUser || {};
    showTalentDialog(`
      <header class="rf-dialog-head"><div><button class="rf-dialog-back" data-rf-evaluation-back>← 返回评价工作台</button><span>INTERVIEW FEEDBACK</span><h2>${escapeHtml(item.candidateName || '候选人')} · 面试评价</h2><p>AI面试总结供参考；候选人评级和面试官评价由面试官确认填写。</p></div></header>
      <div class="rf-feedback-summary"><article><span>候选人</span><strong>${escapeHtml(item.candidateName || '候选人')}</strong></article><article><span>面试轮次</span><strong>${escapeHtml(item.round || '未填写')}</strong></article></div>
      <div class="rf-feedback-workspace">
       <section class="rf-feedback-compose">
        <div class="rf-dialog-form rf-feedback-dialog-form">
        <section class="wide rf-demand-ai-panel rf-feedback-ai-panel">
          <div class="rf-demand-ai-head"><i>AI</i><div><strong>会议总结转AI面试总结</strong><p>只整理原文中的事实，不会生成或覆盖面试官评价。</p></div></div>
          <textarea id="rf-feedback-transcript" rows="7" maxlength="20000" placeholder="粘贴会议总结或面试过程记录。"></textarea>
          <div class="rf-demand-ai-tools">
            <button class="btn-primary" data-rf-feedback-extract type="button">会议总结转评价</button>
          </div>
          <small id="rf-feedback-transcript-status">请粘贴会议总结并点击按钮生成AI面试总结，再填写面试官评价。</small>
        </section>
        <label data-feedback-field="recommendation"><span>面试结论 <b>*</b></span><select id="rf-feedback-recommendation" required><option value="">请选择面试结论</option><option>通过</option><option>加面</option><option>储备</option><option>待讨论</option><option>淘汰</option></select><small class="rf-schedule-error" hidden></small></label>
        <label data-feedback-field="rating"><span>候选人评级 <b>*</b></span><select id="rf-feedback-candidate-rating" required><option value="">请选择评级</option><option value="S">S</option><option value="a">a</option><option value="b">b</option><option value="c">c</option><option value="z">z</option></select><small class="rf-schedule-error" hidden></small></label>
        <label class="wide" data-feedback-field="summary"><span>AI面试总结 <b>*</b></span><textarea id="rf-feedback-ai-summary" rows="5" required placeholder="请先点击“会议总结转评价”生成，再核对或修改"></textarea><small class="rf-schedule-error" hidden></small></label>
        <label class="wide" data-feedback-field="evaluation"><span>面试官评价 <b>*</b></span><textarea id="rf-feedback-interviewer-evaluation" rows="7" required placeholder="至少填写50字，结合候选人实际回答、岗位匹配度、优势与风险给出独立评价；AI不会生成或覆盖此项。"></textarea><small id="rf-feedback-interviewer-count" aria-live="polite"></small><small class="rf-schedule-error" hidden></small></label>
        <input type="hidden" id="rf-feedback-user-id" value="${escapeHtml(currentInterviewer.id || '')}"><input type="hidden" id="rf-feedback-name" value="${escapeHtml(currentInterviewer.name || '')}">
        </div>
        <div class="rf-dialog-actions rf-feedback-submit-actions"><button class="btn-primary" data-rf-submit-feedback type="button">提交面试评价</button></div><p class="rf-dialog-message" id="rf-feedback-message"></p>
       </section>
       <aside class="rf-feedback-history-panel"><div class="rf-review-title"><strong>历史面试评价</strong><small>${feedbackHistory.length}条</small></div><div class="rf-communication-log rf-feedback-history-list">${feedbackHistoryError ? `<div class="rf-dialog-empty"><p>历史评价读取失败</p><small>${escapeHtml(feedbackHistoryError)}</small></div>` : feedbackHistory.length ? feedbackHistory.map((record) => `<details class="rf-comm-history rf-interview-feedback-history"><summary><strong>${escapeHtml(record.finalDecision || record.recommendation || '待填写结论')} · ${escapeHtml(record.candidateRating || '未评级')}</strong><p>${escapeHtml(record.interviewerEvaluation || record.aiSummary || '暂无评价内容')}</p><small>${escapeHtml(record.round || '面试')} · ${escapeHtml(record.interviewer || '未记录面试官')} · ${escapeHtml(formatShanghaiDateTime(record.submittedAt) || '')}</small><span class="rf-comm-history-open">查看完整记录</span></summary>${interviewFeedbackHistoryDetail(record)}</details>`).join('') : '<div class="rf-dialog-empty"><p>暂无历史面试评价。</p></div>'}</div></aside>
      </div>
    `, 'wide');
    const transcriptField = document.getElementById('rf-feedback-transcript');
    const interviewerEvaluationField = document.getElementById('rf-feedback-interviewer-evaluation');
    bindInterviewEvaluationCounter(interviewerEvaluationField, document.getElementById('rf-feedback-interviewer-count'));
    transcriptField?.addEventListener('input', () => {
      if (!transcriptField.dataset.convertedTranscript || transcriptField.dataset.convertedTranscript === transcriptField.value.trim()) return;
      delete transcriptField.dataset.convertedTranscript;
      const status = document.getElementById('rf-feedback-transcript-status');
      if (status) status.textContent = '会议记录已修改，请重新点击“会议总结转评价”生成AI面试总结。';
    });
    document.querySelector('#rf-talent-dialog .rf-dialog')?.classList.add('rf-feedback-dialog');
    ['rf-feedback-recommendation', 'rf-feedback-candidate-rating', 'rf-feedback-ai-summary', 'rf-feedback-interviewer-evaluation', 'rf-feedback-transcript'].forEach((id) => {
      const node = document.getElementById(id);
      const clear = (event) => {
        clearScheduleFieldError(event.currentTarget);
        if (id === 'rf-feedback-transcript' && String(event.currentTarget.value || '').trim()) {
          event.currentTarget.closest('.rf-feedback-ai-panel')?.classList.remove('is-invalid');
        }
      };
      node?.addEventListener('input', clear);
      node?.addEventListener('change', clear);
    });
    document.querySelector('[data-rf-evaluation-back]')?.addEventListener('click', renderEvaluationWorkbench);
    document.querySelector('[data-rf-feedback-extract]')?.addEventListener('click', () => extractInterviewFeedback(interviewId));
    document.querySelector('[data-rf-submit-feedback]')?.addEventListener('click', () => submitInterviewFeedback(interviewId));
  }

  async function generateInterviewAi(interviewId) {
    const message = document.getElementById('rf-feedback-message');
    try {
      await request(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: document.getElementById('rf-interview-raw-notes')?.value || '', operator: '当前用户' }),
      });
      const started = await request(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/ai-draft`, { method: 'POST' });
      if (message) message.textContent = 'AI正在生成纪要草稿…';
      await waitForBackgroundJob(started.jobId, progress => { if (message?.isConnected) message.textContent = progress; });
      if (message?.isConnected) message.textContent = 'AI纪要草稿已生成并标记待人工确认。';
    } catch (error) {
      if (message) { message.textContent = error.message || 'AI生成失败'; message.classList.add('error'); }
    }
  }
  async function submitInterviewFeedback(interviewId) {
    const interviewerEvaluation = document.getElementById('rf-feedback-interviewer-evaluation')?.value.trim() || '';
    const payload = {
      interviewerUserId: document.getElementById('rf-feedback-user-id')?.value.trim(),
      interviewer: document.getElementById('rf-feedback-name')?.value.trim(),
      candidateRating: document.getElementById('rf-feedback-candidate-rating')?.value,
      scores: {}, recommendation: document.getElementById('rf-feedback-recommendation')?.value,
      otherRoles: '', strengths: '', risks: '',
      aiSummary: document.getElementById('rf-feedback-ai-summary')?.value.trim(),
      interviewerEvaluation, comment: interviewerEvaluation,
      notes: document.getElementById('rf-feedback-transcript')?.value.trim(), questionAnswers: {},
      evidence: { source: '面试评价' }, operator: window.recruitmentCurrentUser?.name || '当前用户',
    };
    const message = document.getElementById('rf-feedback-message');
    const transcriptField = document.getElementById('rf-feedback-transcript');
    const recommendationNode = document.getElementById('rf-feedback-recommendation');
    const ratingNode = document.getElementById('rf-feedback-candidate-rating');
    const summaryNode = document.getElementById('rf-feedback-ai-summary');
    const evaluationNode = document.getElementById('rf-feedback-interviewer-evaluation');
    const evaluationLength = countInterviewEvaluationCharacters(payload.interviewerEvaluation);
    const summaryReady = Boolean(payload.notes && transcriptField?.dataset.convertedTranscript === payload.notes && payload.aiSummary);
    markScheduleField(recommendationNode, payload.recommendation ? '' : '请选择面试结论');
    markScheduleField(ratingNode, payload.candidateRating ? '' : '请选择候选人评级');
    markScheduleField(summaryNode, summaryReady ? '' : '请先生成并核对AI面试总结');
    transcriptField?.closest('.rf-feedback-ai-panel')?.classList.toggle('is-invalid', !summaryReady);
    markScheduleField(evaluationNode, evaluationLength >= 50 ? '' : `请至少填写50字，当前${evaluationLength}字`);
    if (!payload.interviewerUserId || !payload.interviewer) { if (message) message.textContent = '无法识别当前面试官身份，请重新登录后再提交'; return; }
    const firstInvalid = [
      [summaryReady, transcriptField],
      [payload.recommendation, recommendationNode],
      [payload.candidateRating, ratingNode],
      [evaluationLength >= 50, evaluationNode],
    ].find(([ok]) => !ok)?.[1];
    if (firstInvalid) {
      const focusTarget = firstInvalid.closest('.rf-combobox')?.querySelector('.rf-combobox-input') || firstInvalid;
      focusTarget?.focus();
      scheduleFieldHost(firstInvalid)?.scrollIntoView({ block: 'nearest' });
      if (message) message.textContent = '';
      return;
    }
    try {
      const result = await request(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const handoff = result.handoff || {};
      const followup = handoff.status === '已通知HR'
        ? (handoff.nextStep === '安排加面' ? '已通知岗位HR安排加面。' : '已通知岗位HR填写Offer。')
        : handoff.status === '已通知候选人' ? '淘汰结果邮件已发送给候选人。'
          : handoff.status === '等待其他面试官评价' ? `已提交 ${result.submitted || 1}/${result.expected || 1} 份评价，等待其他面试官完成后再自动处理。`
            : handoff.status === '等待最终决策' ? '面试官意见存在分歧，暂不推送；请招聘负责人确认最终结论。'
              : handoff.status === '无需处理' ? '该结论已记录，不触发后续推送。'
                : handoff.status === '待重试' ? `评价已保存，但后续通知未完成：${handoff.message || '请稍后重试。'}`
                  : '评价已保存。';
      showTalentDialog(`<section class="rf-feedback-result"><i>✓</i><span>INTERVIEW FEEDBACK</span><h2>面试评价已提交</h2><p>${escapeHtml(followup)}</p><button class="btn-primary" data-rf-feedback-result-back type="button">返回面试评价工作台</button></section>`, 'wide');
      document.querySelector('[data-rf-feedback-result-back]')?.addEventListener('click', renderEvaluationWorkbench);
    } catch (error) {
      if (message) { message.textContent = error.message || '评价提交失败'; message.classList.add('error'); }
    }
  }
  async function openEvaluationAggregate(interviewId){const token=talentDialogToken;try{const aggregate=await request(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/aggregate`);if(!isTalentDialogCurrent(token))return;showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-rf-evaluation-back>← 返回评价工作台</button><span>HIRING DECISION</span><h2>多人评价汇总与决策</h2><p>${Number(aggregate.count||0)}位面试官已提交；有分歧时必须在决策原因中说明如何处理。</p></div></header><div class="rf-assessment-score-summary"><article><span>综合均分</span><strong>${Number(aggregate.scores?.overall||0)}</strong><small>${Object.entries(aggregate.recommendations||{}).map(([k,v])=>`${k}${v}票`).join(' · ')}</small></article><article><span>意见分歧</span><strong>${Object.keys(aggregate.disagreements||{}).length?'有':'无'}</strong><small>${Object.entries(aggregate.disagreements||{}).map(([k,v])=>`${k}${v}票`).join(' · ')||'当前意见一致'}</small></article></div><div class="rf-review-evidence"><section><strong>共同优势</strong><ul>${(aggregate.strengths||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></section><section class="risk"><strong>风险与待核实项</strong><ul>${(aggregate.risks||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></section></div><div class="rf-dialog-form"><label><span>最终决策</span><select id="rf-final-decision"><option>通过</option><option>加面</option><option>储备</option><option>淘汰</option></select></label><label class="wide"><span>决策原因</span><textarea id="rf-final-decision-reason" placeholder="结合面试证据、测评结果和意见分歧说明决策依据"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-submit-decision>确认招聘决策</button></div><p id="rf-decision-message" class="rf-dialog-message"></p>`,'wide');document.querySelector('[data-rf-evaluation-back]')?.addEventListener('click',renderEvaluationWorkbench);document.querySelector('[data-rf-submit-decision]')?.addEventListener('click',()=>submitInterviewDecision(interviewId))}catch(error){if(isTalentDialogCurrent(token))showTalentDialog(`<div class="rf-dialog-error"><strong>评价汇总失败</strong><p>${escapeHtml(conciseError(error))}</p></div>`)}}
  async function submitInterviewDecision(interviewId){const payload={decision:document.getElementById('rf-final-decision')?.value,reason:document.getElementById('rf-final-decision-reason')?.value.trim(),operator:'当前用户'};const message=document.getElementById('rf-decision-message');try{await request(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/decision`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});await openEvaluationWorkbench()}catch(error){if(message){message.textContent=error.message||'决策保存失败';message.classList.add('error')}}}

  function offerHonorificFromGender(gender) {
    const value = safeGender(gender);
    return value === '男' ? '先生' : value === '女' ? '女士' : '';
  }
  function offerHonorificField(gender, honorific = '') {
    const selected = honorific || offerHonorificFromGender(gender);
    return `<label><span>称谓 <b>*</b></span><select id="rf-offer-honorific" required><option value="">请选择</option>${['先生', '女士'].map((item) => `<option value="${item}" ${item === selected ? 'selected' : ''}>${item}</option>`).join('')}</select></label>`;
  }
  function offerReportingAndValidityFields(values = {}) {
    return `<label><span>汇报上级 *</span><input id="rf-offer-reporting-to" value="${escapeHtml(values.reportingTo || '')}" placeholder="例如：张三（部门负责人）" required></label><label><span>有效期开始 *</span><input id="rf-offer-valid-from" type="date" value="${escapeHtml(values.validFrom || localDateValue(Date.now()))}" required></label><label><span>有效期结束 *</span><input id="rf-offer-valid-to" type="date" value="${escapeHtml(values.validTo || localDateValue(Date.now() + 14 * 86400000))}" required></label>`;
  }

  function readOfferReportingAndValidity() {
    return { reportingTo: document.getElementById('rf-offer-reporting-to')?.value.trim() || '', validFrom: document.getElementById('rf-offer-valid-from')?.value || '', validTo: document.getElementById('rf-offer-valid-to')?.value || '' };
  }

  function offerReportingAndValidityError({ reportingTo, validFrom, validTo }) {
    if (!reportingTo) return '请填写汇报上级';
    if (!validFrom || !validTo || validTo < validFrom) return '请填写本通知书有效期，结束日期不能早于开始日期';
    return '';
  }

  function offerSalaryField(id, label, value = '', placeholder = '') {
    return `<label><span>${escapeHtml(label)}</span><input id="${escapeHtml(id)}" type="number" min="0" inputmode="decimal" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"></label>`;
  }

  function offerOptionalSalaryField(id, label, included = false, amount = '') {
    const displayLabel = id === 'rf-offer-commission' ? '其他（元/月）' : label;
    return `<label class="rf-offer-optional-field"><span>${escapeHtml(displayLabel)}</span><span class="rf-offer-optional-toggle"><input id="${escapeHtml(id)}-included" type="checkbox" ${included ? 'checked' : ''}><span>包含</span></span><input id="${escapeHtml(id)}" type="text" value="${escapeHtml(included ? amount : '')}" placeholder="请输入金额" disabled></label>`;
  }

  function readOfferAmount(id) {
    const input = document.getElementById(id);
    if (!input || input.closest('label')?.hidden) return null;
    const value = Number(input.value.trim());
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function collectOfferSalary(internship) {
    const baseSalary = readOfferAmount('rf-offer-base');
    const performanceIncluded = !internship && document.getElementById('rf-offer-performance-included')?.checked === true;
    const commissionIncluded = !internship && document.getElementById('rf-offer-commission-included')?.checked === true;
    const performanceSalary = performanceIncluded ? readOfferAmount('rf-offer-performance') : undefined;
    const commissionSalary = commissionIncluded ? readOfferAmount('rf-offer-commission') : undefined;
    return {
      baseSalary,
      performanceIncluded,
      commissionIncluded,
      performanceSalary,
      commissionSalary,
      structure: internship
        ? { 日薪: baseSalary ?? 0 }
        : {
            底薪: baseSalary ?? 0,
            ...(performanceIncluded ? { 绩效: performanceSalary ?? 0 } : {}),
            ...(commissionIncluded ? { 其他: commissionSalary ?? 0 } : {}),
          },
    };
  }

  function offerSalaryError(salary) {
    if (salary.baseSalary === null || salary.baseSalary === undefined) return '请填写底薪';
    if (salary.baseSalary <= 0) return '底薪必须大于0';
    if (salary.performanceIncluded && (salary.performanceSalary === null || salary.performanceSalary === undefined)) return '请填写绩效金额';
    if (salary.commissionIncluded && (salary.commissionSalary === null || salary.commissionSalary === undefined)) return '请填写其他金额';
    return '';
  }

  function bindOfferSalaryToggles() {
    ['performance', 'commission'].forEach((key) => {
      const includedInput = document.getElementById(`rf-offer-${key}-included`);
      const amountInput = document.getElementById(`rf-offer-${key}`);
      if (!includedInput || !amountInput) return;
      const update = () => {
        amountInput.disabled = !includedInput.checked;
        if (!includedInput.checked) amountInput.value = '';
      };
      includedInput.addEventListener('change', update);
      update();
    });
  }

  function bindOfferEmailOption(form) {
    const option = form?.querySelector('[data-offer-email-option]');
    const submitButton = form?.querySelector('button[type="submit"]');
    if (!option || !submitButton) return;
    const syncLabel = () => {
      submitButton.textContent = offerSubmitLabel(form);
    };
    option.addEventListener('change', syncLabel);
    syncLabel();
  }
  function offerSubmitLabel(form) {
    if (form?.dataset.offerId) return '重新生成 PDF 并预览';
    const sendAfterCreate = Boolean(form?.querySelector('[data-offer-email-option]')?.checked);
    return sendAfterCreate ? '创建并发送 Offer' : '创建 Offer';
  }

  async function openTalentOfferDialog(candidateId) {
    if (!candidateId) return;
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，接口可用后才能创建 Offer。', true);
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取候选人和 Offer 信息…</div>', 'wide');
    try {
      const [result, positions, templateResult] = await Promise.all([
        request('api/talents?page=1&pageSize=100').catch(() => ({ talents: [] })),
        loadPositionOptions(),
        request('api/offers/templates'),
      ]);
      if (!isTalentDialogCurrent(token)) return;
      state.offerData = { ...(state.offerData || {}), candidates: result.talents || [], positions, templates: templateResult.templates || [] };
      await ensureOfferCandidate(candidateId);
      if (!isTalentDialogCurrent(token)) return;
      renderTalentOfferDialog(candidateId);
    } catch (error) {
      if (isTalentDialogCurrent(token)) dialogFailure('Offer 信息读取失败', error, () => openTalentOfferDialog(candidateId), token);
    }
  }

  function renderTalentOfferDialog(candidateId) {
    const active = state.talentDetails[candidateId] || state.talents.find((item) => item.id === candidateId) || {};
    const candidate = (state.offerData?.candidates || []).find((item) => item.id === candidateId) || active;
    const positions = state.offerData?.positions || state.positionOptions || [];
    const templates = sortOfferTemplates(state.offerData?.templates || []);
    if (!positions.length) return notifyUser(context.interviewId ? '本次面试未找到关联岗位，请联系招聘负责人核实。' : '当前部门暂无可选择的岗位，不能创建 Offer。', 'info');
    if (!templates.length) return notifyUser('当前没有可用的 Offer 模板，请先到 Offer 管理中创建模板。', 'info');
    const preferredRole = active.bestMatchRole || active.jobIntention || candidate.bestMatchRole || candidate.jobIntention || '';
    const selectedPosition = positions.find((item) => item.id === active.matches?.[0]?.positionId) || positions.find((item) => item.name === preferredRole) || positions[0];
    const selectedTemplate = templates.find((item) => item.type === '社招') || templates[0];
    showTalentDialog(`
      <header class="rf-dialog-head"><div><h2>为 ${escapeHtml(active.name || candidate.name || '候选人')} 创建 Offer</h2></div></header>
      <form id="rf-talent-offer-form" class="rf-offer-create-form">
        <input id="rf-offer-candidate" type="hidden" value="${escapeHtml(candidateId)}">
        <div class="rf-offer-form-grid">
            <label class="wide"><span>选择模板 <b>*</b></span><select id="rf-offer-template" required>${templates.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedTemplate.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.type)}</option>`).join('')}</select><small id="rf-offer-template-note">${escapeHtml(selectedTemplate.description || '已选择模板，将按模板字段自动调整。')}</small></label>
            ${offerHonorificField(active.gender || candidate.gender)}<label><span>岗位名称 <b>*</b></span><select id="rf-offer-role" required>${positions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedPosition?.id ? 'selected' : ''}>${escapeHtml(item.department || '未分配部门')} · ${escapeHtml(item.name)}</option>`).join('')}</select></label>
            <label><span>入职日期 <b>*</b></span><input id="rf-offer-start" type="date" value="${localDateValue(Date.now() + 7 * 86400000)}" required></label>${offerReportingAndValidityFields()}
            <label><span>工作地点 <b>*</b></span><input id="rf-offer-location" value="${escapeHtml(selectedPosition?.location || '山东省烟台市')}"></label>
            <label><span>部门</span><input id="rf-offer-department" value="${escapeHtml(selectedPosition?.department || '')}" readonly></label>
            ${offerSalaryField('rf-offer-base', '底薪（元/月）', '', '请输入固定底薪')}
            <label><span>试用期（月数与薪资比例）</span><input id="rf-offer-probation" type="text" value="3个月，试用期薪资100%" placeholder="例如：3个月，试用期薪资80%"></label>
            ${offerOptionalSalaryField('rf-offer-performance', '绩效（元/月）')}
            ${offerOptionalSalaryField('rf-offer-commission', '其他（元/月）')}
        </div>
        <div class="rf-dialog-actions rf-offer-actions"><label class="rf-offer-email-toggle"><input type="checkbox" data-offer-email-option checked><span>发送候选人邮箱</span></label><div><button class="btn-soft" data-rf-talent-offer-cancel type="button">取消</button><button class="btn-primary" type="submit">创建并发送 Offer</button></div></div>
        <p id="rf-offer-message" class="rf-dialog-message"></p>
      </form>`,'wide');
    document.getElementById('rf-offer-template')?.addEventListener('change', (event) => {
      const template = templates.find((item) => item.id === event.currentTarget.value) || selectedTemplate;
      updateOfferTemplateFields(template.type, template);
      const note = document.getElementById('rf-offer-template-note');
      if (note) note.textContent = template.description || '已选择模板，将按模板字段自动调整。';
    });
    document.querySelector('[data-rf-talent-offer-cancel]')?.addEventListener('click', cancelTalentDialog);
    document.getElementById('rf-offer-role')?.addEventListener('change', (event) => {
      const position = positions.find((item) => item.id === event.currentTarget.value);
      const department = document.getElementById('rf-offer-department');
      const location = document.getElementById('rf-offer-location');
      if (department) department.value = position?.department || '';
      if (location && position?.location) location.value = position.location;
    });
    document.getElementById('rf-talent-offer-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveTalentOffer(candidateId);
    });
    bindOfferEmailOption(document.getElementById('rf-talent-offer-form'));
    bindOfferSalaryToggles();
    updateOfferTemplateFields(selectedTemplate.type, selectedTemplate);
  }

  async function saveTalentOffer(candidateId) {
    const templateId = document.getElementById('rf-offer-template')?.value || '';
    const template = (state.offerData?.templates || []).find((item) => item.id === templateId) || { id: templateId, type: '社招' };
    const type = template.type || '社招';
    const internship = type === '实习';
    const positionId = document.getElementById('rf-offer-role')?.value || '';
    const position = (state.offerData?.positions || state.positionOptions || []).find((item) => item.id === positionId);
    const message = document.getElementById('rf-offer-message');
    const salary = collectOfferSalary(internship);
    const salaryError = offerSalaryError(salary);
    if (salaryError) {
      if (message) { message.textContent = salaryError; message.classList.add('error'); }
      return;
    }
    const payload = {
      candidateId,
      positionId,
      role: position?.name || '',
      department: position?.department || '',
      location: document.getElementById('rf-offer-location')?.value.trim(),
      baseSalary: salary.baseSalary ?? 0,
      performanceSalary: salary.performanceIncluded ? salary.performanceSalary : undefined,
      commission: salary.commissionIncluded ? salary.commissionSalary : undefined,
      bonusMonths: 0,
      startDate: document.getElementById('rf-offer-start')?.value,
      ...readOfferReportingAndValidity(),
      probationMonths: internship ? '' : document.getElementById('rf-offer-probation')?.value.trim(),
      salaryStructure: salary.structure,
      candidateHonorific: document.getElementById('rf-offer-honorific')?.value || '',
      templateId: template.id || type,
      operator: '当前用户',
    };
    const candidate = (state.offerData?.candidates || []).find((item) => item.id === candidateId) || state.talentDetails[candidateId] || {};
    const recipient = candidate.email?.trim();
    const sourceForm = document.getElementById('rf-talent-offer-form');
    const sendEmailAfterCreate = Boolean(sourceForm?.querySelector('[data-offer-email-option]')?.checked);
    try {
      if (!payload.role || !payload.startDate) throw new Error('请填写岗位名称和入职日期');
      if (!payload.candidateHonorific) throw new Error('请选择候选人称谓（先生或女士）');
      const scheduleError = offerReportingAndValidityError(payload);
      if (scheduleError) throw new Error(scheduleError);
      if (sendEmailAfterCreate && !recipient) throw new Error('候选人没有邮箱，无法发送 Offer 邮件');
      showTalentOfferDraftPreview({
        payload,
        candidateName: candidate.name || '候选人',
        recipient,
        internship,
        sourceForm,
        sendEmailAfterCreate,
      });
    } catch (error) {
      if (message) { message.textContent = error.message || 'Offer 生成失败'; message.classList.add('error'); }
    }
  }

  function renderOfferPage(content){const root=document.getElementById('offer-management-root');if(!root)return null;root.innerHTML=`<div class="rf-offer-page-surface">${content}</div>`;return root}
  let offerViewSequence = 0;
  async function openOfferManagement() {
    const root = document.getElementById('offer-management-root');
    if (!root) return;
    const sequence = ++offerViewSequence;
    const epoch = accessEpoch;
    root.innerHTML = '<div class="rf-offer-page-loading" role="status">正在读取 Offer 记录…</div>';
    try {
      const result = await request('api/offers');
      if (sequence !== offerViewSequence || epoch !== accessEpoch) return;
      state.offerData = { offers: result.offers || [], templates: [], candidates: [], positions: [] };
      renderOfferManagement();
    } catch (error) {
      if (sequence !== offerViewSequence || epoch !== accessEpoch) return;
      root.innerHTML = `<div class="rf-offer-page-error" role="alert"><strong>Offer管理读取失败</strong><p>${escapeHtml(conciseError(error))}</p><button class="btn-secondary" data-rf-offer-retry type="button">重新加载</button></div>`;
      root.querySelector('[data-rf-offer-retry]')?.addEventListener('click', openOfferManagement);
    }
  }
  function offerTemplateFieldCatalog(type='社招') {
    const shared = [
      { key: 'location', label: '工作地点', inputType: 'text', placeholder: '例如：山东省烟台市' },
      { key: 'startDate', label: '入职日期', inputType: 'date', required: true, locked: true },
      { key: 'baseSalary', label: type === '实习' ? '实习日薪（元/天）' : '底薪（元/月）', inputType: 'number', required: true, locked: true },
      { key: 'probationMonths', label: '试用期（月数与薪资比例）', inputType: 'text', placeholder: '例如：3个月，试用期薪资80%' },
    ];
    if (type === '实习') return shared;
    return [shared[0], shared[1], shared[2],
      { key: 'performanceSalary', label: '绩效月薪（元）', inputType: 'text' },
      { key: 'commission', label: '其他（元）', inputType: 'text' },
      shared[3]];
  }
  function normalizeOfferTemplateFields(template={}) {
    const catalog = offerTemplateFieldCatalog(template.type || '社招');
    const source = Array.isArray(template.fields) && template.fields.length ? template.fields : catalog;
    const normalized = source.map((field) => {
      const definition = catalog.find((item) => item.key === field.key);
      return definition ? { ...definition, ...field, inputType: definition.inputType, label: field.label || definition.label, required: definition.locked ? true : Boolean(field.required), enabled: definition.locked ? true : field.enabled !== false } : null;
    }).filter(Boolean);
    catalog.filter((field) => field.locked && !normalized.some((item) => item.key === field.key)).forEach((field) => normalized.push({ ...field, enabled: true }));
    if ((template.type || '社招') === '社招'
      && source.some((field) => ['allowance', 'probationSalaryRate', 'backgroundRequired', 'retentionInfo'].includes(field.key))
      && !normalized.some((field) => field.key === 'commission')) {
      normalized.push(catalog.find((field) => field.key === 'commission'));
    }
    return normalized;
  }
  function sortOfferTemplates(templates){return [...(templates||[])].sort((a,b)=>(a.type||'社招').localeCompare(b.type||'社招')||(Date.parse(b.updatedAt||b.createdAt||'')||0)-(Date.parse(a.updatedAt||a.createdAt||'')||0)||(a.name||'').localeCompare(b.name||''))}
  function offerSalarySummary(item) {
    if (item.dailySalary) return `日薪 ${Number(item.dailySalary || 0).toLocaleString('zh-CN')} 元/天`;
    const parts = [`底薪 ${Number(item.baseSalary || 0).toLocaleString('zh-CN')} 元/月`];
    if (item.performanceIncluded) parts.push(`绩效 ${Number(item.performanceSalary || 0).toLocaleString('zh-CN')} 元/月`);
    if (item.commissionIncluded) parts.push(`其他 ${Number(item.commission || 0).toLocaleString('zh-CN')} 元/月`);
    return parts.join(' + ');
  }

  function offerStatusMeta(item, sentStatuses) {
    if (item.response === '接受') return { text: '候选人已接受', tone: 'accepted' };
    if (item.response === '拒绝') return { text: '候选人已拒绝', tone: 'rejected' };
    if (item.sendStatus === '发送失败') return { text: '邮件发送失败', tone: 'failed' };
    if (sentStatuses.has(item.sendStatus)) return { text: '等待候选人答复', tone: 'sent' };
    if (item.fileUrl) return { text: '待推送邮箱', tone: 'waiting' };
    return { text: 'PDF 生成中', tone: 'draft' };
  }

  function renderOfferManagement() {
    const data = state.offerData || { offers: [], templates: [], candidates: [] };
    const templates = sortOfferTemplates(data.templates);
    const sentStatuses = new Set(['已发送', '候选人已答复']);
    state.offerData = { ...data, templates };
    const waiting = data.offers.filter(item => item.fileUrl && !item.response && !sentStatuses.has(item.sendStatus)).length;
    const sent = data.offers.filter(item => sentStatuses.has(item.sendStatus) || Boolean(item.response)).length;
    const accepted = data.offers.filter(item => item.response === '接受').length;
    const records = data.offers.map(item => {
      const status = offerStatusMeta(item, sentStatuses);
      const initial = String(item.candidateName || '候').slice(0, 1);
      return `<article class="rf-offer-record" data-status="${escapeHtml(status.tone)}">
        <div class="rf-offer-record-main">
          <span class="rf-offer-avatar">${escapeHtml(initial)}</span>
          <div class="rf-offer-record-info">
            <div class="rf-offer-record-title">
              <strong>${escapeHtml(item.candidateName || '候选人')}</strong>
              <em>${escapeHtml(item.templateType || '社招')}</em>
              <span class="rf-offer-status">${escapeHtml(status.text)}</span>
            </div>
            <p>${escapeHtml(item.role || '未填写岗位')} · ${escapeHtml(item.department || '未填写部门')}</p>
            <div class="rf-offer-record-meta">
              <span>入职 ${escapeHtml(item.startDate || '未填写')}</span>
              <span>${escapeHtml(offerSalarySummary(item))}</span>
              <span>编号 ${escapeHtml(item.offerNumber || item.id || '生成中')}</span>
            </div>
          </div>
        </div>
        <aside>${offerActionButtons(item)}</aside>
      </article>`;
    }).join('');
    const root = renderOfferPage(`
      <section class="rf-offer-overview">
        <header class="rf-offer-overview-head">
          <div>
            <span>OFFER LEDGER</span>
            <strong>Offer历史记录</strong>
            <p>招聘流程生成的录用通知、发送进度和候选人答复都在这里沉淀。</p>
          </div>
        </header>
        <div class="rf-offer-metrics">
          <article><span>Offer 总数</span><strong>${data.offers.length}</strong><small>全部生成记录</small></article>
          <article><span>待推送邮箱</span><strong>${waiting}</strong><small>PDF 已生成</small></article>
          <article><span>已推送</span><strong>${sent}</strong><small>已发送或已有答复</small></article>
          <article><span>候选人已接受</span><strong>${accepted}</strong><small>最终接受录用</small></article>
        </div>
      </section>
      <section class="rf-offer-history">
        <header class="rf-offer-history-head">
          <div><h3>录用台账</h3><p>按候选人查看岗位、部门、入职、薪酬和当前状态。</p></div>
          <span>${data.offers.length} 条记录</span>
        </header>
        <div class="rf-offer-list">${data.offers.length ? records : `<article class="rf-offer-empty"><strong>暂无 Offer 历史记录</strong><p>招聘流程推进到发 Offer 后，系统生成的记录会显示在这里。</p></article>`}</div>
      </section>`);
    if (!root) return;
    root.querySelectorAll('[data-offer-action]').forEach(button => button.addEventListener('click', () => handleOfferAction(button.dataset.offerId, button.dataset.offerAction)));
  }

  async function ensureOfferCandidate(candidateId){
    if(!candidateId)return
    const data=state.offerData||{candidates:[]}
    if((data.candidates||[]).some(item=>item.id===candidateId))return
    try{
      const detail=await request(`api/talents/${encodeURIComponent(candidateId)}`)
      const candidate={id:detail.candidateId||detail.id||candidateId,name:detail.name||'未识别姓名',phone:detail.phone||detail.mobile||'',email:detail.email||'',bestMatchRole:detail.bestMatchRole||detail.jobIntention||'',jobIntention:detail.jobIntention||''}
      state.offerData={...state.offerData,candidates:[...(state.offerData?.candidates||[]).filter(item=>item.id!==candidate.id),candidate]}
    }catch{}
  }

  function offerTemplateTypeLabel(inputType){return({text:'单行文字',number:'数字',date:'日期',select:'下拉选择',textarea:'多行文字'})[inputType]||'单行文字'}
  function renderOfferTemplatePreview(fields){const control=(field)=>field.inputType==='textarea'?`<textarea disabled placeholder="${escapeHtml(field.placeholder||'请输入内容')}"></textarea>`:field.inputType==='select'?`<select disabled>${(field.options||['请选择']).map(item=>`<option>${escapeHtml(item)}</option>`).join('')}</select>`:`<input disabled type="${field.inputType==='number'?'number':field.inputType==='date'?'date':'text'}" placeholder="${escapeHtml(field.placeholder||'请输入'+field.label)}">`;return `<div class="rf-template-preview-person"><span>候选人</span><strong>张晓晨</strong><small>系统自动读取人才档案</small></div><div class="rf-template-preview-person"><span>岗位</span><strong>商务经理</strong><small>系统自动读取认领岗位</small></div><div class="rf-template-preview-fields">${fields.filter(field=>field.enabled!==false).map(field=>`<label><span>${escapeHtml(field.label)}${field.required?' *':''}</span>${control(field)}</label>`).join('')}</div>`}
  async function openOfferTemplateManager(selectedId = '') {
    const sequence = ++offerViewSequence;
    const epoch = accessEpoch;
    const root = renderOfferPage('<div class="rf-offer-page-loading" role="status">正在读取 Offer 模板…</div>');
    try {
      await loadOfferTemplates();
      if (sequence !== offerViewSequence || epoch !== accessEpoch) return;
      const templates = sortOfferTemplates(state.offerData?.templates);
      const first = templates.find(item => item.id === selectedId) || templates.find(item => item.type === '社招') || templates[0] || { type: '社招', name: '新建社招 Offer 模板', fields: offerTemplateFieldCatalog('社招') };
      showOfferTemplateEditor(first, templates, { isNew: !first.id });
    } catch (error) {
      if (!root || sequence !== offerViewSequence || epoch !== accessEpoch) return;
      root.innerHTML = `<div class="rf-offer-page-error" role="alert"><strong>Offer模板读取失败</strong><p>${escapeHtml(conciseError(error))}</p><button class="btn-secondary" data-template-retry type="button">重新加载模板</button><button class="btn-soft" data-template-history type="button">返回 Offer 管理</button></div>`;
      root.querySelector('[data-template-retry]')?.addEventListener('click', () => openOfferTemplateManager(selectedId));
      root.querySelector('[data-template-history]')?.addEventListener('click', openOfferManagement);
    }
  }
  function showOfferTemplateEditor(template,templates,options={}){
    const selected={...template,type:template?.type==='实习'?'实习':'社招'};
    const isNew=options.isNew===true||!selected.id;
    selected.fields=normalizeOfferTemplateFields(selected);
    const catalog=offerTemplateFieldCatalog(selected.type);
    const fieldRows=selected.fields.map((field,index)=>`<article class="rf-template-field-row${field.locked?' locked':''}" data-template-field-row data-field-key="${escapeHtml(field.key)}"><span class="rf-template-field-order">${index+1}</span><label><span>字段名称</span><input data-template-field-label value="${escapeHtml(field.label)}"></label><div class="rf-template-field-kind"><span>字段类型</span><strong>${escapeHtml(offerTemplateTypeLabel(field.inputType))}</strong></div><label class="rf-template-required"><input type="checkbox" data-template-field-required ${field.required?'checked':''} ${field.locked?'disabled':''}><span>设为必填</span></label>${field.locked?'<span class="rf-template-field-fixed">固定字段</span>':`<button type="button" data-template-field-remove="${escapeHtml(field.key)}">移除</button>`}</article>`).join('');
    const available=catalog.filter(field=>!selected.fields.some(item=>item.key===field.key));
    const root=renderOfferPage(`<header class="rf-offer-view-head"><div><button class="rf-dialog-back" data-offer-template-back type="button">← 返回 Offer 管理</button><span>OFFER TEMPLATE</span><h2>${isNew?'新建 Offer 模板':'模板管理'}</h2><p>用可视化字段配置决定 HR 发 Offer 时需要填写什么，右侧会同步预览最终表单。</p></div><button class="btn-primary rf-template-new-button" data-template-create type="button">＋ 新建模板</button></header><section class="rf-offer-template-layout"><aside class="rf-offer-template-nav"><span>模板列表</span><button class="rf-template-create-entry" data-template-create type="button"><strong>＋ 新建模板</strong><small>创建新的实习或社招表单</small></button>${templates.map(item=>`<button type="button" class="${item.id===selected.id?'active':''}" data-template-edit-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name||item.type+'模板')}</strong><small>${escapeHtml(item.type)} · ${normalizeOfferTemplateFields(item).length}个字段</small></button>`).join('')}</aside><div class="rf-offer-template-editor"><section class="rf-template-meta-card"><div><span>模板基本信息</span><h3>先命名，再配置需要填写的字段</h3></div><div class="rf-offer-form-grid"><label><span>模板名称 *</span><input id="rf-template-name" value="${escapeHtml(selected.name||'')}"></label><label><span>适用类型 *</span><select id="rf-template-type" ${isNew?'':'disabled'}><option value="社招" ${selected.type==='社招'?'selected':''}>社招</option><option value="实习" ${selected.type==='实习'?'selected':''}>实习</option></select></label><label class="rf-form-block"><span>使用说明</span><textarea id="rf-template-description" rows="3" placeholder="告诉 HR 这个模板适用于什么场景">${escapeHtml(selected.description||selected.content||'')}</textarea></label></div></section><div class="rf-template-builder-grid"><section class="rf-template-builder"><header><div><span>表单字段</span><h3>设置字段名称和是否必填</h3></div><div class="rf-template-add-field"><select data-template-add-select ${available.length?'':'disabled'}>${available.length?available.map(field=>`<option value="${escapeHtml(field.key)}">${escapeHtml(field.label)}</option>`).join(''):'<option>没有更多可添加字段</option>'}</select><button type="button" data-template-add-field ${available.length?'':'disabled'}>添加字段</button></div></header><div class="rf-template-field-list">${fieldRows}</div><div class="rf-template-builder-note">候选人和岗位由系统自动带入；入职日期与薪资属于生成通知书的固定必填字段，不能移除。</div></section><aside class="rf-template-preview"><header><span>实时预览</span><h3>HR 实际填写效果</h3></header><div data-template-preview>${renderOfferTemplatePreview(selected.fields)}</div></aside></div><div class="rf-offer-actions"><button class="btn-primary" data-rf-save-offer-template type="button">${isNew?'创建模板':'保存模板'}</button><button class="btn-soft" data-offer-template-back type="button">取消</button></div><p class="rf-offer-form-message" id="rf-template-message"></p></div></section>`);
    if(!root)return;
    const collectFields=()=>[...root.querySelectorAll('[data-template-field-row]')].map(row=>{const definition=catalog.find(item=>item.key===row.dataset.fieldKey)||{};return{...definition,key:row.dataset.fieldKey,label:row.querySelector('[data-template-field-label]')?.value.trim()||definition.label||'',required:Boolean(row.querySelector('[data-template-field-required]')?.checked),enabled:true}});
    const currentDraft=()=>({...selected,name:root.querySelector('#rf-template-name')?.value.trim()||'',type:root.querySelector('#rf-template-type')?.value||selected.type,description:root.querySelector('#rf-template-description')?.value.trim()||'',fields:collectFields()});
    const refreshPreview=()=>{const preview=root.querySelector('[data-template-preview]');if(preview)preview.innerHTML=renderOfferTemplatePreview(collectFields())};
    root.querySelectorAll('[data-offer-template-back]').forEach(button=>button.addEventListener('click',openOfferManagement));
    root.querySelectorAll('[data-template-create]').forEach(button=>button.addEventListener('click',()=>showOfferTemplateEditor({type:'社招',name:'新建社招 Offer 模板',description:'',fields:offerTemplateFieldCatalog('社招')},templates,{isNew:true})));
    root.querySelectorAll('[data-template-edit-id]').forEach(button=>button.addEventListener('click',()=>{const next=templates.find(item=>item.id===button.dataset.templateEditId);if(next)showOfferTemplateEditor(next,templates)}));
    root.querySelector('#rf-template-type')?.addEventListener('change',(event)=>{const type=event.currentTarget.value;showOfferTemplateEditor({...currentDraft(),type,name:`新建${type} Offer 模板`,fields:offerTemplateFieldCatalog(type)},templates,{isNew:true})});
    root.querySelectorAll('[data-template-field-label],[data-template-field-required]').forEach(input=>input.addEventListener('input',refreshPreview));
    root.querySelectorAll('[data-template-field-remove]').forEach(button=>button.addEventListener('click',()=>{const draft=currentDraft();draft.fields=draft.fields.filter(field=>field.key!==button.dataset.templateFieldRemove);showOfferTemplateEditor(draft,templates,{isNew})}));
    root.querySelector('[data-template-add-field]')?.addEventListener('click',()=>{const key=root.querySelector('[data-template-add-select]')?.value,definition=catalog.find(field=>field.key===key);if(!definition)return;const draft=currentDraft();draft.fields.push({...definition,enabled:true});showOfferTemplateEditor(draft,templates,{isNew})});
    root.querySelector('[data-rf-save-offer-template]')?.addEventListener('click',async()=>{const message=root.querySelector('#rf-template-message'),draft=currentDraft();if(!draft.name){message.textContent='请填写模板名称';message.classList.add('error');return}showGlobalLoading(isNew?'正在创建 Offer 模板…':'正在保存 Offer 模板…');try{const saved=await request(isNew?'api/offers/templates':`api/offers/templates/${encodeURIComponent(selected.id)}`,{method:isNew?'POST':'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:draft.name,type:draft.type,description:draft.description,fields:draft.fields,operator:'当前用户'})});hideGlobalLoading();notifyUser(isNew?'Offer 模板已创建':'Offer 模板已保存','success');await openOfferManagement();openOfferTemplateManager(saved.id)}catch(error){hideGlobalLoading();if(message){message.textContent=error.message||(isNew?'模板创建失败':'模板保存失败');message.classList.add('error')}}})
  }
  function offerActionButtons(item){if(!item.fileUrl)return`<button data-offer-action="file" data-offer-id="${escapeHtml(item.id)}">重新生成PDF</button>`;const view=`<a href="${escapeHtml(item.fileUrl)}" target="_blank" rel="noopener">查看PDF</a>`;if(item.response||['已发送','候选人已答复'].includes(item.sendStatus))return view;return`${view}<button data-offer-action="send" data-offer-id="${escapeHtml(item.id)}">${item.sendStatus==='发送失败'?'重试发送':'发送给候选人'}</button><button class="soft" data-offer-action="edit" data-offer-id="${escapeHtml(item.id)}">调整薪资</button>`}
  async function loadOfferTemplates() {
    if (state.offerData?.templates?.length) return;
    const result = await request('api/offers/templates');
    state.offerData = { ...state.offerData, templates: result.templates || [] };
  }

  async function openOfferForm(candidateId = '', context = {}) {
    ++offerViewSequence;
    showGlobalLoading('正在加载 Offer 填写信息…');
    try {
      if (context.interviewId) {
        const linked = await request('api/offers/interview-context', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interviewId: context.interviewId, candidateId, applicationId: context.applicationId || '', positionId: context.positionId || '' }),
        });
        await loadOfferTemplates();
        context = { ...context, candidateId: linked.candidate.id, applicationId: linked.applicationId, positionId: linked.position.id, interviewOfferContext: linked };
        state.offerData = { ...state.offerData, positions: [linked.position], candidates: [linked.candidate] };
      } else {
        const [, positions, candidateResult] = await Promise.all([
          loadOfferTemplates(), loadPositionOptions(),
          candidateId ? ensureOfferCandidate(candidateId) : request('api/talents?page=1&pageSize=100'),
        ]);
        state.offerData = { ...state.offerData, positions: positions || [], candidates: candidateId ? state.offerData?.candidates || [] : candidateResult?.talents || [] };
      }
    } catch (error) {
      notifyUser(`填写信息加载失败，请重试：${conciseError(error)}`, 'error');
      return;
    } finally {
      hideGlobalLoading();
    }
    const data = state.offerData || { templates: [], candidates: [], positions: [] };
    const candidates = data.candidates || [];
    const positions = data.positions || state.positionOptions || [];
    const templates = sortOfferTemplates(data.templates || []);
    const selectedCandidateId = context.interviewOfferContext?.candidate?.id || candidateId;
    if (!positions.length) return notifyUser('当前部门暂无可选择的岗位，不能创建 Offer。', 'info');
    if (!templates.length) return notifyUser('当前没有可用的 Offer 模板，请先创建模板。', 'info');
    if (selectedCandidateId && !candidates.some((item) => item.id === selectedCandidateId)) return notifyUser('指定候选人未加载成功，请重新打开 HR 待办。', 'error');
    if (context.positionId && !positions.some((item) => item.id === context.positionId)) return notifyUser('面试关联岗位信息不一致，请重新打开 HR 待办。', 'error');
    const requestedCandidateId = selectedCandidateId || state.activeId;
    const active = state.talentDetails[requestedCandidateId] || state.talents.find((item) => item.id === requestedCandidateId) || candidates.find((item) => item.id === requestedCandidateId);
    const defaultCandidate = active || candidates[0] || {};
    const preferredRole = active?.bestMatchRole || active?.jobIntention || defaultCandidate.bestMatchRole || defaultCandidate.jobIntention || '';
    const selectedPosition = positions.find((item) => item.id === context.positionId) || positions.find((item) => item.id === active?.matches?.[0]?.positionId) || positions.find((item) => item.name === preferredRole) || positions[0];
    const selectedTemplate = templates.find((item) => item.type === '社招') || templates[0];
    const root = renderOfferPage(`<header class="rf-offer-view-head"><div><button class="rf-dialog-back" data-rf-offer-back type="button">← 返回 Offer 管理</button><h2>新建 Offer</h2></div></header><form class="rf-offer-create-form" id="rf-offer-create-form"><div class="rf-offer-form-grid"><label><span>选择候选人 <b>*</b></span><select id="rf-offer-candidate">${candidates.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === defaultCandidate.id ? 'selected' : ''}>${escapeHtml(item.name || '未识别姓名')} · ${escapeHtml(item.phone || '未填写手机号')}</option>`).join('')}</select>${data.candidateLoadError ? `<small class="rf-form-warning">候选人数据暂不可用：${escapeHtml(data.candidateLoadError)}</small>` : ''}</label>${offerHonorificField(defaultCandidate.gender)}<label><span>模板 <b>*</b></span><select id="rf-offer-template">${templates.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedTemplate.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.type)}</option>`).join('')}</select></label><label><span>岗位名称 <b>*</b></span><select id="rf-offer-role">${positions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedPosition?.id ? 'selected' : ''}>${escapeHtml(item.department || '未分配部门')} · ${escapeHtml(item.name)}</option>`).join('')}</select></label><label><span>部门</span><input id="rf-offer-department" value="${escapeHtml(selectedPosition?.department || '')}" readonly></label><label><span>工作地点</span><input id="rf-offer-location" value="${escapeHtml(selectedPosition?.location || '山东省烟台市')}"></label><label><span>入职日期 <b>*</b></span><input id="rf-offer-start" type="date" value="${localDateValue(Date.now() + 7 * 86400000)}"></label>${offerReportingAndValidityFields()}${offerSalaryField('rf-offer-base', '底薪（元/月）', '', '请输入固定底薪')}${offerOptionalSalaryField('rf-offer-performance', '绩效（元/月）')}${offerOptionalSalaryField('rf-offer-commission', '提成（元/月）')}<label><span>试用期（月数与薪资比例）</span><input id="rf-offer-probation" type="text" value="3个月，试用期薪资100%" placeholder="例如：3个月，试用期薪资80%"></label></div><div class="rf-offer-actions"><label class="rf-offer-email-toggle"><input type="checkbox" data-offer-email-option checked><span>发送候选人邮箱</span></label><div><button class="btn-soft" type="button" data-rf-offer-back>取消</button><button class="btn-primary" type="submit">生成 Offer 并预览</button></div></div><p id="rf-offer-message" class="rf-offer-form-message"></p></form>`);
if (!root) return;
    root.querySelector('#rf-offer-create-form').dataset.applicationId = context.applicationId || '';
    root.querySelector('#rf-offer-create-form').dataset.interviewId = context.interviewId || '';
    if (context.interviewId) {
      root.querySelector('#rf-offer-candidate').disabled = true;
      root.querySelector('#rf-offer-role').disabled = Boolean(context.positionId);
    }
    root.querySelector('#rf-offer-template')?.addEventListener('change', (event) => { const template = templates.find((item) => item.id === event.currentTarget.value) || selectedTemplate; updateOfferTemplateFields(template.type, template); });
    root.querySelector('#rf-offer-candidate')?.addEventListener('change', (event) => { const picked = candidates.find((item) => item.id === event.currentTarget.value); const honorific = root.querySelector('#rf-offer-honorific'); if (honorific) honorific.value = offerHonorificFromGender(picked?.gender); });
    root.querySelector('#rf-offer-role')?.addEventListener('change', (event) => {
      const position = positions.find((item) => item.id === event.currentTarget.value);
      root.querySelector('#rf-offer-department').value = position?.department || '';
      if (position?.location) root.querySelector('#rf-offer-location').value = position.location;
    });
    root.querySelectorAll('[data-rf-offer-back]').forEach((button) => button.addEventListener('click', renderOfferManagement));
    root.querySelector('#rf-offer-create-form')?.addEventListener('submit', (event) => { event.preventDefault(); saveOffer(); });
    bindOfferEmailOption(root.querySelector('#rf-offer-create-form'));
    bindOfferSalaryToggles();
    updateOfferTemplateFields(selectedTemplate.type, selectedTemplate);
  }
  function updateOfferTemplateFields(type,template={}){const fields=normalizeOfferTemplateFields({...template,type}),fieldMap=new Map(fields.filter(field=>field.enabled!==false).map(field=>[field.key,field])),controls={location:'rf-offer-location',startDate:'rf-offer-start',baseSalary:'rf-offer-base',performanceSalary:'rf-offer-performance',commission:'rf-offer-commission',probationMonths:'rf-offer-probation'};Object.entries(controls).forEach(([key,id])=>{const input=document.getElementById(id),label=input?.closest('label'),field=fieldMap.get(key);if(!input||!label)return;label.hidden=!field;input.required=Boolean(field?.required);if(field){const title=label.querySelector(':scope > span');if(title)title.innerHTML=`${escapeHtml(field.label)}${field.required?' <b>*</b>':''}`}})}

  function offerSalaryPreviewText(payload, internship) {
    const salaryParts = internship
      ? [`日薪 ${Number(payload.baseSalary || 0)} 元`]
      : [`底薪 ${Number(payload.baseSalary || 0)} 元/月`];
    if (!internship && payload.performanceSalary !== undefined) salaryParts.push(`绩效 ${Number(payload.performanceSalary || 0)} 元/月`);
    if (!internship && payload.commission !== undefined) salaryParts.push(`其他 ${Number(payload.commission || 0)} 元/月`);
    return salaryParts.join(' + ');
  }

  async function submitOfferForPreview({ payload, candidateName, recipient, sourceForm, sendEmailAfterCreate, beforePreview }) {
    const existingOfferId = sourceForm?.dataset.offerId || '';
    const submitButton = sourceForm?.querySelector('button[type="submit"]');
    if (!sourceForm || sourceForm.dataset.saving === 'true') return null;
    sourceForm.dataset.saving = 'true';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = existingOfferId ? '正在重新生成 PDF…' : '正在生成 PDF…';
    }
    showGlobalLoading(existingOfferId ? '正在重新生成 Offer PDF…' : '正在生成 Offer PDF…');
    try {
      const created = existingOfferId
        ? await request(`api/offers/${encodeURIComponent(existingOfferId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await request('api/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!created.offerId || !created.fileUrl) throw new Error('Offer 已创建，但 PDF 信息未完整返回。请到 Offer 管理核对记录后再操作，勿重复创建。');
      sourceForm.dataset.offerId = created.offerId;
      if (beforePreview) await beforePreview();
      if (sendEmailAfterCreate || existingOfferId) {
        renderOfferPreview({ offer: created, payload, candidateName, recipient, sendEmailAfterCreate, sourceForm });
      } else {
        await openOfferManagement();
        notifyUser('Offer 已生成，未发送邮件；可在 Offer 管理中手动发送。', 'success');
      }
      return created;
    } catch (error) {
      hideGlobalLoading();
      const message = sourceForm.querySelector('.rf-offer-form-message, .rf-dialog-message');
      if (message) {
        message.textContent = error.message || 'Offer PDF 生成失败';
        message.classList.add('error');
        message.scrollIntoView({ block: 'nearest' });
      } else {
        notifyUser(error.message || 'Offer PDF 生成失败', 'error');
      }
      return null;
    } finally {
      hideGlobalLoading();
      sourceForm.dataset.saving = 'false';
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = offerSubmitLabel(sourceForm);
      }
    }
  }

  function showOfferDraftPreview(options) {
    return submitOfferForPreview(options);
  }

  function showTalentOfferDraftPreview(options) {
    const { sourceForm } = options;
    return submitOfferForPreview({
      ...options,
      beforePreview: () => {
        closeTalentDialog(false);
        window.setPage?.('offers', { silent: true });
      },
      sourceForm,
    });
  }

  async function saveOffer() {
    const form = document.getElementById('rf-offer-create-form');
    if (!form || form.dataset.saving === 'true') return;
    const templateId = document.getElementById('rf-offer-template')?.value || '';
    const template = (state.offerData?.templates || []).find(item => item.id === templateId) || { id: templateId, type: '社招' };
    const internship = template.type === '实习';
    const candidateId = document.getElementById('rf-offer-candidate')?.value;
    const positionId = document.getElementById('rf-offer-role')?.value || '';
    const position = (state.offerData?.positions || state.positionOptions || []).find(item => item.id === positionId);
    const message = document.getElementById('rf-offer-message');
    const salary = collectOfferSalary(internship);
    const salaryError = offerSalaryError(salary);
    if (salaryError) {
      if (message) { message.textContent = salaryError; message.classList.add('error'); message.scrollIntoView({ block: 'nearest' }); }
      return;
    }
    const payload = {
      candidateId, interviewId: form.dataset.interviewId || '', applicationId: form.dataset.applicationId || '', positionId,
      role: position?.name || '',
      department: position?.department || '',
      location: document.getElementById('rf-offer-location')?.value.trim(),
      baseSalary: salary.baseSalary ?? 0,
      performanceSalary: salary.performanceIncluded ? salary.performanceSalary : undefined,
      commission: salary.commissionIncluded ? salary.commissionSalary : undefined,
      bonusMonths: 0,
      startDate: document.getElementById('rf-offer-start')?.value,
      ...readOfferReportingAndValidity(),
      probationMonths: internship ? '' : document.getElementById('rf-offer-probation')?.value.trim(),
      salaryStructure: salary.structure,
      candidateHonorific: document.getElementById('rf-offer-honorific')?.value || '',
      templateId: template.id || template.type, operator: '当前用户',
    };
    const candidate = (state.offerData?.candidates || []).find(item => item.id === candidateId);
    const recipient = candidate?.email?.trim();
    const sendEmailAfterCreate = Boolean(form?.querySelector('[data-offer-email-option]')?.checked);
    try {
      if (!payload.candidateHonorific) throw new Error('请选择候选人称谓（先生或女士）');
      if (!position) throw new Error(form.dataset.interviewId ? '面试关联岗位信息未加载，请重新打开 HR 待办' : '请选择一个可管理范围内的岗位');
      const scheduleError = offerReportingAndValidityError(payload);
      if (scheduleError) throw new Error(scheduleError);
      if (sendEmailAfterCreate && !recipient) throw new Error('候选人没有邮箱，无法发送 Offer 邮件');
      showOfferDraftPreview({
        payload,
        candidateName: candidate?.name || '候选人',
        recipient,
        internship,
        sourceForm: form,
        sendEmailAfterCreate,
      });
    } catch (error) {
      if (message) {
        message.textContent = error.message || 'Offer 生成失败';
        message.classList.add('error');
        message.scrollIntoView({ block: 'nearest' });
      }
    }
  }
  function renderOfferPreview({ offer, payload, candidateName, recipient, sendEmailAfterCreate, sourceForm }) {
    const internship = offer.templateType === '实习';
    const salary = offerSalaryPreviewText(payload, internship);
    const root = renderOfferPage(`<header class="rf-offer-view-head"><div><button class="rf-dialog-back" data-offer-preview-later type="button">← 返回 Offer 管理</button><button class="btn-soft rf-offer-preview-edit" data-offer-preview-edit type="button">返回修改</button><span>OFFER REVIEW</span><h2>发送前预览</h2><p>Offer PDF 已生成。请先打开核对文件，如需调整可返回修改并重新生成 PDF，确认无误后再发送。</p></div><strong class="rf-offer-preview-status">待 HR 核对</strong></header><div class="rf-offer-preview-layout"><section class="rf-offer-preview-summary"><span>录用信息核对</span><h3>${escapeHtml(candidateName)}</h3><dl><div><dt>应聘岗位</dt><dd>${escapeHtml(payload.role)}</dd></div><div><dt>所属部门</dt><dd>${escapeHtml(payload.department || '—')}</dd></div><div><dt>工作地点</dt><dd>${escapeHtml(payload.location || '—')}</dd></div><div><dt>计划入职</dt><dd>${escapeHtml(payload.startDate || '—')}</dd></div><div><dt>${internship ? '薪酬' : '薪酬结构'}</dt><dd>${escapeHtml(salary)}</dd></div>${!internship ? `<div><dt>试用期</dt><dd>${escapeHtml(payload.probationMonths || '—')}</dd></div>` : ''}<div><dt>Offer 编号</dt><dd>${escapeHtml(offer.offerNumber || '生成中')}</dd></div></dl></section><section class="rf-offer-preview-document"><header><div><span>PDF 文件预览</span><strong>${escapeHtml(offer.fileName || '录用通知书.pdf')}</strong></div><a href="${escapeHtml(offer.fileUrl)}" target="_blank" rel="noopener">新窗口打开</a></header><iframe title="录用通知书 PDF 预览" src="${escapeHtml(offer.fileUrl)}" loading="eager"></iframe></section></div><form class="rf-offer-preview-send" id="rf-offer-preview-send-form" data-offer-id="${escapeHtml(offer.offerId)}"><div class="rf-offer-form-grid"><label><span>候选人邮箱 *</span><input id="rf-offer-preview-email" type="email" value="${escapeHtml(recipient)}" required></label><label><span>答复有效期（小时）</span><input id="rf-offer-preview-expiry" type="number" value="72" min="1" max="168"></label><label class="rf-form-block"><span>邮件备注</span><textarea id="rf-offer-preview-note" placeholder="可补充报到联系人或其他提醒"></textarea></label></div><label class="rf-offer-preview-confirm"><input id="rf-offer-preview-ack" type="checkbox" required ${sendEmailAfterCreate ? 'checked' : ''}><span>我已核对录用通知书 PDF 和候选人邮箱，确认发送。</span></label><div class="rf-offer-actions"><button class="btn-primary" type="submit">确认并发送 Offer</button><button class="btn-soft" type="button" data-offer-preview-later>返回 Offer 管理</button></div><p class="rf-offer-form-message" id="rf-offer-preview-message" role="status"></p></form>`);
    if (!root) return;
    root.querySelector('[data-offer-preview-edit]')?.addEventListener('click', () => {
      const surface = root.querySelector('.rf-offer-page-surface');
      const submitButton = sourceForm?.querySelector('button[type="submit"]');
      if (!surface || !sourceForm) return;
      if (submitButton) submitButton.textContent = offerSubmitLabel(sourceForm);
      surface.replaceChildren(sourceForm);
      sourceForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const form = root.querySelector('#rf-offer-preview-send-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.dataset.sending === 'true') return;
      const button = form.querySelector('button[type="submit"]');
      const message = form.querySelector('#rf-offer-preview-message');
      const offerId = form.dataset.offerId;
      form.dataset.sending = 'true';
      if (button) { button.disabled = true; button.textContent = '正在发送…'; }
      showGlobalLoading('正在发送 Offer 答复链接…');
      try {
        const sent = await request(`api/offers/${encodeURIComponent(offerId)}/send-email`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: form.querySelector('#rf-offer-preview-email').value.trim(),
            expiresHours: Number(form.querySelector('#rf-offer-preview-expiry').value || 72),
            note: form.querySelector('#rf-offer-preview-note').value.trim(),
            operator: '当前用户',
          }),
        });
        hideGlobalLoading();
        if (sendEmailAfterCreate) {
          const status = root.querySelector('.rf-offer-preview-status');
          if (status) status.textContent = '邮件已发送';
          if (button) { button.disabled = true; button.textContent = '邮件已发送'; }
          form.querySelectorAll('input, textarea').forEach((control) => { control.disabled = true; });
          if (message) message.textContent = `Offer 邮件已发送至 ${sent.recipient}，可继续核对 PDF 内容。`;
        } else {
          notifyUser(`Offer 邮件已发送至 ${sent.recipient}`, 'success');
          await openOfferManagement();
        }
      } catch (error) {
        hideGlobalLoading();
        if (message) { message.textContent = error.message || 'Offer 邮件发送失败'; message.classList.add('error'); }
        if (sendEmailAfterCreate) {
          const status = root.querySelector('.rf-offer-preview-status');
          if (status) status.textContent = '自动发送失败';
        }
        form.dataset.sending = 'false';
        if (button) { button.disabled = false; button.textContent = '重试发送 Offer'; }
      }
    });
    root.querySelectorAll('[data-offer-preview-later]').forEach(button => button.addEventListener('click', openOfferManagement));
  }
  async function handleOfferAction(offerId,action){showGlobalLoading(action==='file'?'正在生成录用通知书 PDF…':'正在处理Offer…');try{if(action==='submit')await request(`api/offers/${offerId}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator:'当前用户'})});else if(action.startsWith('approve-'))await request(`api/offers/${offerId}/approval`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve',node:action.replace('approve-',''),opinion:'审批信息已核对，同意进入下一节点',operator:'当前用户'})});else if(action==='file')await request(`api/offers/${offerId}/generate-file`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator:'当前用户'})});else if(action==='send'){hideGlobalLoading();return openOfferEmailForm(offerId)}else if(action==='edit'){hideGlobalLoading();return openOfferEditForm(offerId)}hideGlobalLoading();await openOfferManagement()}catch(error){hideGlobalLoading();notifyUser(error.message||'Offer操作失败','error')}}
  function openOfferEmailForm(offerId){const offer=(state.offerData?.offers||[]).find(item=>item.id===offerId)||{};showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-offer-back>← 返回 Offer 管理</button><span>SEND OFFER</span><h2>发送录用通知书</h2><p>邮件会发送安全答复链接，候选人可在线查看完整 Offer 并确认答复。</p></div></header><div class="rf-dialog-form"><label><span>候选人邮箱 *</span><input id="rf-offer-email" value="${escapeHtml(offer.candidateEmail||'')}"></label><label><span>答复有效期（小时）</span><input id="rf-offer-expiry" type="number" value="72" min="1" max="168"></label><label class="wide"><span>邮件备注</span><textarea id="rf-offer-note" placeholder="可补充报到联系人或其他提醒"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-rf-send-offer-email>确认发送邮件</button></div><p class="rf-dialog-message" id="rf-offer-email-message"></p>`,'wide');document.querySelector('[data-offer-back]')?.addEventListener('click',openOfferManagement);document.querySelector('[data-rf-send-offer-email]')?.addEventListener('click',async()=>{const button=document.querySelector('[data-rf-send-offer-email]'),message=document.getElementById('rf-offer-email-message');button.disabled=true;button.textContent='正在发送答复链接…';message.textContent='正在处理，请勿关闭页面。';showGlobalLoading('正在发送 Offer 答复链接…');try{const result=await request(`api/offers/${encodeURIComponent(offerId)}/send-email`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient:document.getElementById('rf-offer-email').value.trim(),expiresHours:Number(document.getElementById('rf-offer-expiry').value||72),note:document.getElementById('rf-offer-note').value.trim(),operator:'当前用户'})});hideGlobalLoading();closeTalentDialog(false);notifyUser(`Offer邮件已发送至 ${result.recipient}`,'success');await openOfferManagement()}catch(error){hideGlobalLoading();message.textContent=error.message||'Offer邮件发送失败';message.classList.add('error');button.disabled=false;button.textContent='确认发送邮件'}})}
  async function openOfferEditForm(offerId) {
    const offer = (state.offerData?.offers || []).find(item => item.id === offerId);
    if (!offer) return notifyUser('Offer 记录不存在，请刷新 Offer 管理后重试。', 'error');
    ++offerViewSequence;
    showGlobalLoading('正在加载 Offer 信息…');
    let positions;
    try {
      [, positions] = await Promise.all([loadOfferTemplates(), loadPositionOptions()]);
    } catch (error) {
      notifyUser(`Offer 模板或岗位加载失败，请重试：${conciseError(error)}`, 'error');
      return;
    } finally {
      hideGlobalLoading();
    }
    const templates = sortOfferTemplates(state.offerData?.templates || []);
    if (!templates.length) return notifyUser('当前没有可用的 Offer 模板，请先创建模板。', 'info');
    const loadedPositions = positions || [];
    const positionOptions = offer.positionId && !loadedPositions.some(item => item.id === offer.positionId) ? [{ id: offer.positionId, name: offer.role, department: offer.department }, ...loadedPositions] : loadedPositions;
    const currentPosition = positionOptions.find(item => item.id === offer.positionId);
    state.offerData = { ...state.offerData, positions: positionOptions, candidates: [{ id: offer.candidateId, name: offer.candidateName, email: offer.candidateEmail }] };
    const selectedTemplate = templates.find(item => item.id === offer.templateId) || templates.find(item => item.type === offer.templateType) || templates[0];
    const root = renderOfferPage(`<header class="rf-offer-view-head"><div><button class="rf-dialog-back" data-rf-offer-back type="button">← 返回 Offer 管理</button><h2>修改 Offer</h2><p>候选人已锁定。岗位可按需更换，部门随岗位自动带出；保存后会重新生成 PDF，确认无误再发送给候选人。</p></div></header><form class="rf-offer-create-form" id="rf-offer-create-form" data-offer-id="${escapeHtml(offer.id)}"><div class="rf-offer-form-grid"><label><span>候选人</span><select id="rf-offer-candidate" disabled><option value="${escapeHtml(offer.candidateId)}">${escapeHtml(offer.candidateName || '未识别姓名')}${offer.candidateEmail ? ` · ${escapeHtml(offer.candidateEmail)}` : ''}</option></select></label>${offerHonorificField('', offer.candidateHonorific)}<label><span>模板 <b>*</b></span><select id="rf-offer-template">${templates.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selectedTemplate.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.type)}</option>`).join('')}</select></label><label><span>岗位名称 <b>*</b></span><select id="rf-offer-role" required>${currentPosition ? '' : '<option value="" selected disabled>请选择岗位</option>'}${positionOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === offer.positionId ? 'selected' : ''}>${escapeHtml(item.department || '未分配部门')} · ${escapeHtml(item.name)}</option>`).join('')}</select></label><label><span>部门</span><input id="rf-offer-department" value="${escapeHtml(currentPosition?.department || '')}" readonly></label><label><span>工作地点</span><input id="rf-offer-location" value="${escapeHtml(offer.location)}"></label><label><span>入职日期 <b>*</b></span><input id="rf-offer-start" type="date" value="${escapeHtml(offer.startDate)}"></label>${offerReportingAndValidityFields({ reportingTo: offer.reportingTo, validFrom: offer.validFrom, validTo: offer.validTo })}${offerSalaryField('rf-offer-base', '底薪（元/月）', offer.dailySalary || offer.baseSalary || '', '请输入固定底薪')}${offerOptionalSalaryField('rf-offer-performance', '绩效（元/月）', offer.performanceIncluded, offer.performanceSalary)}${offerOptionalSalaryField('rf-offer-commission', '提成（元/月）', offer.commissionIncluded, offer.commission)}<label><span>试用期（月数与薪资比例）</span><input id="rf-offer-probation" type="text" value="${escapeHtml(offer.probationMonths)}" placeholder="例如：3个月，试用期薪资80%"></label></div><div class="rf-offer-actions"><label class="rf-offer-email-toggle"><input type="checkbox" data-offer-email-option checked><span>发送候选人邮箱</span></label><div><button class="btn-soft" type="button" data-rf-offer-back>取消</button><button class="btn-primary" type="submit">重新生成 PDF 并预览</button></div></div><p id="rf-offer-message" class="rf-offer-form-message"></p></form>`);
    if (!root) return;
    root.querySelector('#rf-offer-template')?.addEventListener('change', (event) => { const template = templates.find((item) => item.id === event.currentTarget.value) || selectedTemplate; updateOfferTemplateFields(template.type, template); });
    root.querySelector('#rf-offer-role')?.addEventListener('change', (event) => {
      const position = positionOptions.find(item => item.id === event.currentTarget.value);
      root.querySelector('#rf-offer-department').value = position?.department || '';
      if (position?.location) root.querySelector('#rf-offer-location').value = position.location;
    });
    root.querySelectorAll('[data-rf-offer-back]').forEach((button) => button.addEventListener('click', openOfferManagement));
    root.querySelector('#rf-offer-create-form')?.addEventListener('submit', (event) => { event.preventDefault(); saveOffer(); });
    bindOfferSalaryToggles();
    updateOfferTemplateFields(selectedTemplate.type, selectedTemplate);
  }

  async function openBackgroundWorkbench(candidateId){if(state.archiveMode!=='api')return setTalentMessage('当前为离线档案预览，接口可用后才能管理背调。',true);state.backgroundCandidateId=candidateId||'';const token=showTalentDialog('<div class="rf-dialog-loading">正在读取背调任务、核验项和风险证据…</div>','wide');try{const result=await request(`api/background-checks${state.backgroundCandidateId?`?candidateId=${encodeURIComponent(state.backgroundCandidateId)}`:''}`);if(!isTalentDialogCurrent(token))return;state.backgroundData=result.checks||[];renderBackgroundWorkbench()}catch(error){dialogFailure('背调工作台读取失败',error,()=>openBackgroundWorkbench(state.backgroundCandidateId),token)}}
  function backgroundActions(item){if(['已通过','已终止'].includes(item.status))return item.reportUrl?`<a href="${escapeHtml(item.reportUrl)}" target="_blank">查看报告</a>`:'';let html='';if(item.authorizationStatus!=='已授权')html+='<button data-bg-action="authorize">记录授权</button>';else{html+='<button data-bg-action="contact">联系人</button><button data-bg-action="verify">录入核验</button><button data-bg-action="risk">风险项</button>';if(!item.externalTaskId)html+='<button class="soft" data-bg-action="external">发起八方背调</button>';else html+='<button class="soft" data-bg-action="sync">同步八方状态</button>';if((item.verifications||[]).length)html+='<button class="soft" data-bg-action="report">生成报告</button>';if(item.reportUrl)html+='<button data-bg-action="conclude">确认结论</button>'}return html}
  function renderBackgroundWorkbench(){const rows=state.backgroundData||[],selected=rows.find(x=>x.id===state.backgroundSelectedId)||rows[0];state.backgroundSelectedId=selected?.id||'';showTalentDialog(`<header class="rf-dialog-head"><div><span>BACKGROUND CHECK</span><h2>背调授权、核验与结论</h2><p>已在候选人授权范围内接入八方锦程测试环境；可发起订单、同步状态并接收报告。</p></div><button class="btn-primary" data-bg-new type="button">为当前人才发起背调</button></header><div class="rf-review-metrics"><article><span>背调任务</span><strong>${rows.length}</strong></article><article><span>待授权</span><strong>${rows.filter(x=>x.authorizationStatus!=='已授权').length}</strong></article><article><span>核验中</span><strong>${rows.filter(x=>['信息收集中','核验中','外部核验中'].includes(x.status)).length}</strong></article><article class="warn"><span>异常待决策</span><strong>${rows.filter(x=>x.status==='异常待决策').length}</strong></article><article><span>已通过</span><strong>${rows.filter(x=>x.status==='已通过').length}</strong></article></div><div class="rf-background-layout"><aside class="rf-background-list">${rows.length?rows.map(item=>`<button class="${item.id===selected?.id?'active':''}" data-bg-select="${escapeHtml(item.id)}"><strong>${escapeHtml(item.candidateName||'候选人')}</strong><span>${escapeHtml(item.number)}</span><small>${escapeHtml(item.status)} · ${escapeHtml(item.riskLevel||'待评估')}</small></button>`).join(''):'<div class="rf-dialog-empty"><strong>暂无背调任务</strong><p>通常在候选人接受Offer并进入背调阶段后创建。</p></div>'}</aside><main>${selected?backgroundDetailHtml(selected):'<div class="rf-dialog-empty"><p>请选择或新建背调任务。</p></div>'}</main></div>`,'wide');document.querySelector('[data-bg-new]')?.addEventListener('click',openBackgroundCreate);document.querySelectorAll('[data-bg-select]').forEach(button=>button.addEventListener('click',()=>{state.backgroundSelectedId=button.dataset.bgSelect;renderBackgroundWorkbench()}));document.querySelectorAll('[data-bg-action]').forEach(button=>button.addEventListener('click',()=>openBackgroundAction(selected.id,button.dataset.bgAction)))}
  function backgroundDetailHtml(item){return `<section class="rf-background-card"><header><div><span>${escapeHtml(item.number)}</span><h3>${escapeHtml(item.candidateName||'候选人')} · ${escapeHtml(item.status)}</h3><p>授权：${escapeHtml(item.authorizationStatus)} · 外部同步：${escapeHtml(item.syncStatus||'未发起')}${item.externalStatus?` · 八方状态：${escapeHtml(item.externalStatus)}`:''}${item.packageName?` · 套餐：${escapeHtml(item.packageName)}`:''} · 风险：${escapeHtml(item.riskLevel||'待评估')}</p></div>${item.reportUrl?`<a href="${escapeHtml(item.reportUrl)}" target="_blank">报告 v${Number(item.reportVersion||1)} ↗</a>`:''}</header>${item.syncError?`<div class="rf-boundary-note"><strong>八方同步异常</strong><p>${escapeHtml(item.syncError)}</p></div>`:''}<div class="rf-background-scope">${(item.scopes||[]).map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div><div class="rf-background-actions">${backgroundActions(item)}</div></section><section class="rf-background-columns"><article><div class="rf-review-title"><strong>联系人</strong><small>${(item.contacts||[]).length} 人</small></div>${(item.contacts||[]).map(x=>`<div class="rf-background-row"><strong>${escapeHtml(x.name)}</strong><p>${escapeHtml(x.company||'公司待补充')} ${escapeHtml(x.role||'')}</p><small>${escapeHtml(x.status)} · ${escapeHtml(x.phone||x.email||'')}</small></div>`).join('')||'<p class="rf-background-empty">尚未录入背调联系人</p>'}</article><article><div class="rf-review-title"><strong>履历与表现核验</strong><small>${(item.verifications||[]).length} 项</small></div>${(item.verifications||[]).map(x=>`<div class="rf-background-row"><strong>${escapeHtml(x.type)} · ${escapeHtml(x.consistency)}</strong><p>${escapeHtml(x.company||'')} ${escapeHtml(x.role||'')} · ${escapeHtml(x.result)}</p><small>离职：${escapeHtml(x.leavingReason||'待补充')} · 表现：${escapeHtml(x.performance||'待补充')}</small></div>`).join('')||'<p class="rf-background-empty">尚未完成核验</p>'}</article></section><section class="rf-background-risks"><div class="rf-review-title"><strong>风险与证据</strong><small>${(item.risks||[]).length} 项</small></div>${(item.risks||[]).map(x=>`<article data-level="${escapeHtml(x.level)}"><span>${escapeHtml(x.level)}</span><div><strong>${escapeHtml(x.title)}</strong><p>${escapeHtml(x.description)}</p><small>${escapeHtml(x.evidenceSummary)} · ${(x.attachments||[]).length} 个附件</small></div></article>`).join('')||'<p class="rf-background-empty">当前未记录风险项；没有记录不代表不存在风险。</p>'}</section>${item.conclusion&&item.conclusion!=='待确认'?`<section class="rf-background-conclusion"><span>人工结论</span><strong>${escapeHtml(item.conclusion)}</strong><p>${escapeHtml(item.conclusionSummary)}</p><small>${escapeHtml(item.confirmer||'')} · ${escapeHtml(item.confirmedAt||'')}</small></section>`:''}`}
  function openBackgroundCreate(){const talent=state.talentDetails[state.activeId]||state.talents.find(x=>x.id===state.activeId)||{};if(!state.activeId)return window.alert('请先在人才列表选择候选人');showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-bg-back>← 返回背调工作台</button><span>NEW BACKGROUND CHECK</span><h2>为 ${escapeHtml(talent.name||'当前人才')} 发起背调</h2><p>默认范围覆盖身份学历、工作履历、离职原因、表现和管理能力，可按实际岗位缩减。</p></div></header><div class="rf-dialog-form"><label class="wide"><span>核验范围</span><div class="rf-background-checks">${['身份与学历','工作履历','离职原因','工作表现','管理与带队能力'].map(x=>`<label><input type="checkbox" value="${x}" checked><span>${x}</span></label>`).join('')}</div></label><label><span>外部服务商</span><input id="rf-bg-provider" placeholder="未接通可留空"></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-bg-save-create>创建并等待授权</button></div><p class="rf-dialog-message" id="rf-bg-message"></p>`,'wide');document.querySelector('[data-bg-back]')?.addEventListener('click',renderBackgroundWorkbench);document.querySelector('[data-bg-save-create]')?.addEventListener('click',async()=>{try{await request('api/background-checks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:state.activeId,scopes:[...document.querySelectorAll('.rf-background-checks input:checked')].map(x=>x.value),provider:document.getElementById('rf-bg-provider').value.trim(),operator:'当前用户'})});await openBackgroundWorkbench(state.backgroundCandidateId)}catch(error){document.getElementById('rf-bg-message').textContent=error.message}})}
  function openBackgroundAction(id,action){const item=(state.backgroundData||[]).find(x=>x.id===id);if(!item)return;const heads={authorize:['记录候选人授权','候选人授权是开展背调的前提。'],contact:['录入背调联系人','仅录入候选人提供或合法取得的联系人。'],verify:['录入核验结果','分别记录候选人声明、核验事实和证据来源。'],risk:['新增风险项','风险必须附证据摘要，不能只记录主观判断。'],external:['发起八方锦程背调','选择套餐后，系统会用候选人姓名、性别和手机号创建测试订单。'],conclude:['人工确认背调结论','结论会推动应聘流程，必须填写判断依据。']}[action];if(action==='report')return runBackgroundSimple(id,'generate-report');let form='';if(action==='sync')return runBackgroundSimple(id,'sync-external');if(action==='authorize')form=`<label><span>授权状态</span><select id="rf-bg-auth-status"><option>已授权</option><option>拒绝授权</option><option>已撤回</option></select></label><label><span>授权方式</span><select id="rf-bg-auth-method"><option>电子签署</option><option>纸质授权书</option><option>邮件确认</option><option>现场确认</option></select></label><label class="wide"><span>授权文件地址（可选）</span><input id="rf-bg-auth-file"></label><label class="wide"><span>说明</span><textarea id="rf-bg-auth-note"></textarea></label>`;if(action==='contact')form=`<label><span>姓名</span><input id="rf-bg-contact-name"></label><label><span>关系</span><input id="rf-bg-contact-relation" placeholder="直属上级/HR/同事"></label><label><span>公司</span><input id="rf-bg-contact-company"></label><label><span>职位</span><input id="rf-bg-contact-role"></label><label><span>电话</span><input id="rf-bg-contact-phone"></label><label><span>邮箱</span><input id="rf-bg-contact-email"></label><label class="wide"><span>备注</span><textarea id="rf-bg-contact-note"></textarea></label>`;if(action==='verify')form=`<label><span>核验类型</span><select id="rf-bg-verify-type"><option>工作履历</option><option>离职原因</option><option>工作表现</option><option>管理与带队能力</option><option>学历身份</option></select></label><label><span>一致性</span><select id="rf-bg-verify-consistency"><option>一致</option><option>部分一致</option><option>不一致</option><option>待确认</option></select></label><label><span>公司</span><input id="rf-bg-verify-company"></label><label><span>岗位</span><input id="rf-bg-verify-role"></label><label class="wide"><span>核验结果</span><textarea id="rf-bg-verify-result"></textarea></label><label class="wide"><span>离职原因</span><textarea id="rf-bg-verify-leaving"></textarea></label><label class="wide"><span>工作表现</span><textarea id="rf-bg-verify-performance"></textarea></label><label class="wide"><span>带队与管理表现</span><textarea id="rf-bg-verify-management"></textarea></label><label class="wide"><span>证据来源</span><input id="rf-bg-verify-source" placeholder="例如：直属上级电话核验，2026-08-28"></label>`;if(action==='risk')form=`<label><span>风险类型</span><select id="rf-bg-risk-type"><option>履历差异</option><option>离职原因</option><option>工作表现</option><option>诚信风险</option><option>其他</option></select></label><label><span>风险等级</span><select id="rf-bg-risk-level"><option>低</option><option>中</option><option>高</option><option>严重</option></select></label><label class="wide"><span>风险标题</span><input id="rf-bg-risk-title"></label><label class="wide"><span>风险说明</span><textarea id="rf-bg-risk-description"></textarea></label><label class="wide"><span>证据摘要</span><textarea id="rf-bg-risk-evidence"></textarea></label><label class="wide"><span>证据附件（可选，最大15MB）</span><input id="rf-bg-risk-file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"></label>`;if(action==='external')form=`<label class="wide"><span>八方背调套餐 <b>*</b></span><select id="rf-bg-package"><option value="">正在加载八方套餐…</option></select></label><div class="rf-boundary-note wide"><strong>测试环境说明</strong><p>订单将发送到 beta.gdbf.com。系统只提交候选人姓名、性别、手机号和岗位信息，不会上传简历原文。</p></div>`;if(action==='conclude')form=`<label><span>人工结论</span><select id="rf-bg-conclusion"><option>通过</option><option>有条件通过</option><option>异常待决策</option><option>终止录用</option></select></label><label class="wide"><span>结论依据</span><textarea id="rf-bg-conclusion-opinion" placeholder="说明报告证据、风险处置和最终判断"></textarea></label>`;showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-bg-back>← 返回背调工作台</button><span>BACKGROUND CHECK ACTION</span><h2>${heads[0]}</h2><p>${heads[1]}</p></div></header><div class="rf-dialog-form">${form}</div><div class="rf-dialog-actions"><button class="btn-primary" data-bg-submit-action>确认提交</button></div><p class="rf-dialog-message" id="rf-bg-action-message"></p>`,'wide');document.querySelector('[data-bg-back]')?.addEventListener('click',renderBackgroundWorkbench);document.querySelector('[data-bg-submit-action]')?.addEventListener('click',()=>submitBackgroundAction(id,action));if(action==='external')loadBackgroundPackages()}
  function loadBackgroundPackages() {
    const select = document.getElementById('rf-bg-package');
    if (!select) return;
    select.innerHTML = '<option value="">正在加载八方套餐…</option>';
    request('api/background-checks/packages').then((result) => {
      const packages = result.packages || [], items = result.items || [];
      const options = packages.map((item) => `<option value="${escapeHtml(item.packageId)}">${escapeHtml(item.packageName)} · ${Number(item.packagePrice || 0)}元${item.packageItems ? ` · ${escapeHtml(item.packageItems)}` : ''}</option>`).join('');
      const itemOptions = items.map((item) => `<option value="${escapeHtml(item.itemId)}">${escapeHtml(item.itemName)} · ${Number(item.itemPrice || 0)}元</option>`).join('');
      select.innerHTML = (options || itemOptions) ? `${options}<optgroup label="附加项">${itemOptions}</optgroup>` : '<option value="">八方未返回可用套餐</option>';
      select.value = packages[0]?.packageId || items[0]?.itemId || '';
    }).catch((error) => { select.innerHTML = `<option value="">八方套餐加载失败：${escapeHtml(error.message)}</option>`; });
  }
  async function submitBackgroundAction(id,action){let path='',payload={operator:'当前用户'};if(action==='authorize'){path='authorization';payload={...payload,status:document.getElementById('rf-bg-auth-status').value,method:document.getElementById('rf-bg-auth-method').value,fileUrl:document.getElementById('rf-bg-auth-file').value.trim(),note:document.getElementById('rf-bg-auth-note').value.trim()}}if(action==='contact'){path='contacts';payload={...payload,name:document.getElementById('rf-bg-contact-name').value.trim(),relationship:document.getElementById('rf-bg-contact-relation').value.trim(),company:document.getElementById('rf-bg-contact-company').value.trim(),role:document.getElementById('rf-bg-contact-role').value.trim(),phone:document.getElementById('rf-bg-contact-phone').value.trim(),email:document.getElementById('rf-bg-contact-email').value.trim(),note:document.getElementById('rf-bg-contact-note').value.trim()}}if(action==='verify'){path='verifications';payload={...payload,type:document.getElementById('rf-bg-verify-type').value,consistency:document.getElementById('rf-bg-verify-consistency').value,company:document.getElementById('rf-bg-verify-company').value.trim(),role:document.getElementById('rf-bg-verify-role').value.trim(),result:document.getElementById('rf-bg-verify-result').value.trim(),leavingReason:document.getElementById('rf-bg-verify-leaving').value.trim(),performance:document.getElementById('rf-bg-verify-performance').value.trim(),managementPerformance:document.getElementById('rf-bg-verify-management').value.trim(),evidenceSource:document.getElementById('rf-bg-verify-source').value.trim()}}if(action==='risk'){path='risks';payload={...payload,type:document.getElementById('rf-bg-risk-type').value,level:document.getElementById('rf-bg-risk-level').value,title:document.getElementById('rf-bg-risk-title').value.trim(),description:document.getElementById('rf-bg-risk-description').value.trim(),evidenceSummary:document.getElementById('rf-bg-risk-evidence').value.trim()}}if(action==='external'){path='external-request';payload={...payload,packageId:document.getElementById('rf-bg-package').value};if(!payload.packageId){document.getElementById('rf-bg-action-message').textContent='请选择八方背调套餐';return}}if(action==='conclude'){path='conclusion';payload={...payload,conclusion:document.getElementById('rf-bg-conclusion').value,opinion:document.getElementById('rf-bg-conclusion-opinion').value.trim()}}const loading=showGlobalLoading(action==='external'?'正在创建八方锦程订单…':action==='sync'?'正在同步八方锦程状态…':'正在提交背调操作…');try{loading('等待八方接口返回…');const result=action==='external'?await new Promise(async(resolve,reject)=>{try{const started=await request(`api/background-checks/${id}/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return resolve(await waitForBackgroundJob(started.jobId,loading,{timeoutMessage:'背调订单仍在后台创建，请稍后手动同步，勿重复创建。'}))}catch(error){reject(error)}}):await request(`api/background-checks/${id}/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(action==='risk'){const file=document.getElementById('rf-bg-risk-file')?.files?.[0];if(file){const form=new FormData();form.append('file',file);form.append('riskId',result.riskId);form.append('operator','当前用户');loading('正在上传证据附件…');await request(`api/background-checks/${id}/evidence`,{method:'POST',body:form})}}hideGlobalLoading();if(action==='external')notifyUser(`八方订单已创建：${result.orderId}`,'success');if(action==='sync')notifyUser('八方订单状态已同步','success');await openBackgroundWorkbench(state.backgroundCandidateId)}catch(error){hideGlobalLoading();notifyUser(error.message||'背调操作失败','error')}}
  async function runBackgroundSimple(id,path){const loading=showGlobalLoading(path==='sync-external'?'正在同步八方锦程订单状态…':'正在生成背调报告…');try{loading('正在请求八方接口…');const result=await request(`api/background-checks/${id}/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator:'当前用户'})});hideGlobalLoading();if(path==='sync-external')notifyUser(result.externalStatus?`八方状态：${result.externalStatus}`:'八方状态已同步','success');else notifyUser('背调报告已生成','success');await openBackgroundWorkbench(state.backgroundCandidateId)}catch(error){hideGlobalLoading();notifyUser(error.message||'背调操作失败','error',()=>runBackgroundSimple(id,path))}}

  async function openLifecycleWorkbench(candidateId){if(state.archiveMode!=='api')return setTalentMessage('当前为离线档案预览，接口可用后才能管理员工生命周期。',true);state.lifecycleCandidateId=candidateId||'';const token=showTalentDialog('<div class="rf-dialog-loading">正在读取待入职、试用期、离职和回访数据…</div>','wide');const isStale=()=>token!==talentDialogToken;try{const[data,analytics]=await Promise.all([request(`api/employee-lifecycle${state.lifecycleCandidateId?`?candidateId=${encodeURIComponent(state.lifecycleCandidateId)}`:''}`),request('api/employee-lifecycle/analytics')]);if(isStale())return;state.lifecycleData={...data,analytics};renderLifecycleWorkbench()}catch(error){if(!isStale())dialogFailure('员工生命周期工作台读取失败',error,()=>openLifecycleWorkbench(state.lifecycleCandidateId))}}
  function renderLifecycleWorkbench(){const data=state.lifecycleData||{onboardings:[],overview:{},analytics:{}},rows=data.onboardings||[],selected=rows.find(x=>x.id===state.lifecycleSelectedId)||rows[0];state.lifecycleSelectedId=selected?.id||'';showTalentDialog(`<header class="rf-dialog-head"><div><span>EMPLOYEE LIFECYCLE</span><h2>入职、试用期、离职与回访</h2><p>以候选人为主线管理资料、协同任务、实际到岗、转正、离职交接和人才回流。</p></div><div class="rf-assessment-head-actions"><button class="btn-soft" data-life-generate-followups>生成到期回访</button><button class="btn-primary" data-life-new>新建待入职单</button></div></header><div class="rf-review-metrics"><article><span>待入职</span><strong>${Number(data.overview?.pending||0)}</strong></article><article><span>在职/试用</span><strong>${Number(data.overview?.active||0)+Number(data.overview?.probation||0)}</strong></article><article><span>离职处理中</span><strong>${Number(data.overview?.offboarding||0)}</strong></article><article class="warn"><span>待回访</span><strong>${Number(data.overview?.followups||0)}</strong></article><article><span>已完成回访</span><strong>${Number(data.analytics?.completedFollowups||0)}</strong></article></div><div class="rf-life-layout"><aside class="rf-life-list">${rows.length?rows.map(x=>`<button class="${x.id===selected?.id?'active':''}" data-life-select="${escapeHtml(x.id)}"><strong>${escapeHtml(x.candidateName||'候选人')}</strong><span>${escapeHtml(x.role||'岗位待补充')} · ${escapeHtml(x.department||'')}</span><small>${escapeHtml(x.status)} · 资料${Number(x.documentProgress||0)}% · 任务${Number(x.taskProgress||0)}%</small></button>`).join(''):'<div class="rf-dialog-empty"><strong>暂无员工生命周期记录</strong><p>可从已接受Offer或已通过背调的人才创建待入职单。</p></div>'}</aside><main>${selected?lifecycleDetailHtml(selected,data.analytics):'<div class="rf-dialog-empty"><p>请选择或新建入职单。</p></div>'}</main></div>`,'wide');document.querySelector('[data-life-new]')?.addEventListener('click',openLifecycleCreate);document.querySelector('[data-life-generate-followups]')?.addEventListener('click',async()=>{try{const r=await request('api/employee-lifecycle/followups/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator:'当前用户'})});window.alert(`已生成 ${r.created||0} 条回访任务`);await openLifecycleWorkbench(state.lifecycleCandidateId)}catch(e){window.alert(e.message)}});document.querySelectorAll('[data-life-select]').forEach(b=>b.addEventListener('click',()=>{state.lifecycleSelectedId=b.dataset.lifeSelect;renderLifecycleWorkbench()}));bindLifecycleActions(selected)}
  function lifecycleDetailHtml(item,analytics){
    const off=item.offboarding;
    const probationHtml=(item.probations||[]).map(x=>{
      const monthlySummary=x.type==='入职一月评价'&&x.status==='已完成'?` · ${escapeHtml(x.performanceRating||'待评级')} · ${escapeHtml(x.growthLevel||'成长等级待补充')}`:'';
      const regularSummary=x.recommendation?` · ${escapeHtml(x.recommendation)}`:'';
      const appraisal=x.type==='入职一月评价'&&x.appraisal?`<small>${escapeHtml(x.appraisal)}</small>`:'';
      return `<article><span>${escapeHtml(x.plannedDate)}</span><div><strong>${escapeHtml(x.type)}</strong><small>${escapeHtml(x.status)}${monthlySummary}${regularSummary}</small>${appraisal}</div>${x.status==='待处理'?`<button data-life-probation="${escapeHtml(x.id)}">填写</button>`:'<i>✓</i>'}</article>`;
    }).join('');
    return `<section class="rf-life-card"><header><div><span>${escapeHtml(item.number)}</span><h3>${escapeHtml(item.candidateName)} · ${escapeHtml(item.status)}</h3><p>${escapeHtml(item.department)} ${escapeHtml(item.role)} · 计划入职 ${escapeHtml(item.plannedStartDate)}${item.actualStartDate?` · 到岗 ${escapeHtml(item.actualStartDate)}`:''}</p></div><aside><b>${Number(item.documentProgress||0)}%</b><small>资料</small><b>${Number(item.taskProgress||0)}%</b><small>任务</small></aside></header><div class="rf-life-actions"><button data-life-action="document">上传资料</button><button data-life-action="task">新增协同任务</button>${!item.externalTaskId?'<button class="soft" data-life-action="external">入职系统接口</button>':''}${!item.actualStartDate?'<button data-life-action="arrival">确认到岗</button>':''}${item.actualStartDate&&!off?'<button class="danger" data-life-action="offboarding">发起离职</button>':''}</div></section><div class="rf-life-columns"><section><div class="rf-review-title"><strong>入职资料</strong><small>${(item.documents||[]).length}份</small></div>${(item.documents||[]).map(x=>`<article class="rf-life-row"><div><strong>${escapeHtml(x.type)} · ${escapeHtml(x.name)}</strong><small>${escapeHtml(x.status)}${x.note?` · ${escapeHtml(x.note)}`:''}</small></div><aside><a href="${escapeHtml(x.url)}" target="_blank">查看</a>${x.status==='待核验'?`<button data-life-verify-doc="${escapeHtml(x.id)}">核验通过</button>`:''}</aside></article>`).join('')||'<p class="rf-background-empty">尚未上传入职资料</p>'}</section><section><div class="rf-review-title"><strong>协同任务</strong><small>${(item.tasks||[]).filter(x=>x.status!=='已完成').length}项待办</small></div>${(item.tasks||[]).map(x=>`<article class="rf-life-row"><div><strong>${escapeHtml(x.category)} · ${escapeHtml(x.name)}</strong><small>${escapeHtml(x.status)} · ${escapeHtml(x.owner||'待分配')} · ${escapeHtml((x.dueAt||'').slice(0,10))}</small></div>${x.status!=='已完成'?`<button data-life-complete-task="${escapeHtml(x.id)}">完成</button>`:'<i>✓</i>'}</article>`).join('')}</section></div><section class="rf-life-probation"><div class="rf-review-title"><strong>试用期与转正</strong><small>${escapeHtml(item.regularizationStatus||'待试用')} · 结束 ${escapeHtml(item.probationEndDate||'待到岗后计算')}</small></div><div>${probationHtml||'<p class="rf-background-empty">确认到岗后自动生成一周、一月和转正节点。</p>'}</div></section>${off?offboardingHtml(item,off):''}<section class="rf-life-followups"><div class="rf-review-title"><strong>回访与人才回流</strong><small>${(item.followups||[]).length}条</small></div>${(item.followups||[]).map(x=>`<article><time>${escapeHtml(x.plannedDate)}</time><div><strong>${escapeHtml(x.type)} · ${escapeHtml(x.status)}</strong><p>${escapeHtml(x.result||'等待回访')} ${x.feedback?`· ${escapeHtml(x.feedback)}`:''}</p><small>${x.ratingAfter?`评级 ${escapeHtml(x.ratingAfter)} · `:''}${escapeHtml(x.returnIntent||'')}</small></div>${x.status==='待回访'?`<button data-life-followup="${escapeHtml(x.id)}">记录回访</button>`:'<i>✓</i>'}</article>`).join('')||'<p class="rf-background-empty">离职完成后自动生成30天和90天回访。</p>'}</section><section class="rf-life-analytics"><strong>离职与回访原因概览</strong><div>${Object.entries(analytics?.offboardingReasons||{}).map(([k,v])=>`<span>${escapeHtml(k)} <b>${v}</b></span>`).join('')||'<span>暂无离职样本</span>'}</div></section>`;
  }
  function offboardingHtml(item,off){const feedbackStatus=off.questionBankStatus||'待处理',feedbackText=feedbackStatus==='已完成'?`已自动反哺 ${Number(off.questionBankCount||0)} 道面试题`:feedbackStatus==='处理中'?'正在根据离职原因优化面试官题库':feedbackStatus==='失败'?'题库反哺失败，可点击重试':'确认离职或提交离职面谈后自动优化题库';return `<section class="rf-life-offboarding"><header><div><span>${escapeHtml(off.number)}</span><strong>${escapeHtml(off.type)} · ${escapeHtml(off.status)}</strong><p>${escapeHtml(off.reasonCategory)} · ${escapeHtml(off.reason)}</p></div><small>${escapeHtml(off.returnFlag)}</small></header><div class="rf-life-handover"><span>工作交接 ${escapeHtml(off.handover)}</span><span>资产归还 ${escapeHtml(off.assets)}</span><span>账号关闭 ${escapeHtml(off.accounts)}</span></div><div class="rf-life-question-feedback ${feedbackStatus==='失败'?'failed':feedbackStatus==='已完成'?'done':''}"><div><strong>面试题库持续优化</strong><span>${escapeHtml(feedbackText)}</span>${off.questionBankError?`<small>${escapeHtml(off.questionBankError)}</small>`:''}</div>${feedbackStatus==='失败'?`<button data-life-question-retry="${escapeHtml(off.id)}" type="button">重新反哺</button>`:''}</div><div class="rf-life-actions">${!(off.interviews||[]).length?'<button data-life-action="exit-interview">填写离职面谈</button>':''}${off.status!=='已离职'?'<button class="danger" data-life-action="complete-offboarding">确认离职完成</button>':''}</div>${(off.interviews||[]).map(x=>`<div class="rf-exit-note"><strong>面谈：${escapeHtml(x.mainReason)}</strong><p>${escapeHtml(x.suggestions||'暂无改进建议')}</p><small>${escapeHtml(x.date)} · ${escapeHtml(x.interviewer)} · 回流意愿 ${escapeHtml(x.willingToReturn)}</small></div>`).join('')}</section>`}
  function bindLifecycleActions(item){if(!item)return;document.querySelectorAll('[data-life-action]').forEach(b=>b.addEventListener('click',()=>openLifecycleAction(item,b.dataset.lifeAction)));document.querySelectorAll('[data-life-question-retry]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;b.textContent='正在提交…';try{await request(`api/employee-lifecycle/offboarding/${encodeURIComponent(b.dataset.lifeQuestionRetry)}/question-bank/retry`,{method:'POST'});notifyUser('题库反哺任务已重新提交','success');await openLifecycleWorkbench(state.lifecycleCandidateId)}catch(error){b.disabled=false;b.textContent='重新反哺';notifyUser(error.message||'题库反哺重试失败','error')}}));document.querySelectorAll('[data-life-complete-task]').forEach(b=>b.addEventListener('click',async()=>{await request(`api/employee-lifecycle/onboarding/${item.id}/tasks/${b.dataset.lifeCompleteTask}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note:'任务已完成并经办人确认',operator:'当前用户'})});await openLifecycleWorkbench(state.lifecycleCandidateId)}));document.querySelectorAll('[data-life-verify-doc]').forEach(b=>b.addEventListener('click',async()=>{await request(`api/employee-lifecycle/onboarding/${item.id}/documents/${b.dataset.lifeVerifyDoc}/verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'已核验',note:'资料内容已核对',operator:'当前用户'})});await openLifecycleWorkbench(state.lifecycleCandidateId)}));document.querySelectorAll('[data-life-probation]').forEach(b=>b.addEventListener('click',()=>openProbationForm(item,b.dataset.lifeProbation)));document.querySelectorAll('[data-life-followup]').forEach(b=>b.addEventListener('click',()=>openFollowupForm(b.dataset.lifeFollowup)))}
  async function openLifecycleCreate(){
    if(!state.activeId)return window.alert('请先选择候选人');
    try {
      const positions=await loadPositionOptions(),talent=state.talentDetails[state.activeId]||state.talents.find(x=>x.id===state.activeId)||{};
      if(!positions.length)return notifyUser('当前部门暂无可选择的岗位，不能建立入职单。','info');
      const preferred=talent.bestMatchRole||talent.jobIntention||'',selected=positions.find(x=>x.id===talent.matches?.[0]?.positionId)||positions.find(x=>x.name===preferred)||positions[0],tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
      lifeForm('建立待入职清单','确认计划日期后，系统自动生成资料、工位、设备、账号和培训任务。',`<label><span>计划入职日期</span><input id="life-start" type="date" min="${tomorrow}" value="${tomorrow}"></label><label><span>岗位</span><select id="life-role">${positions.map(x=>`<option value="${escapeHtml(x.id)}" ${x.id===selected?.id?'selected':''}>${escapeHtml(x.department||'未分配部门')} · ${escapeHtml(x.name)}</option>`).join('')}</select></label><label><span>部门</span><input id="life-department" value="${escapeHtml(selected?.department||'')}" readonly></label><label><span>直属负责人</span><input id="life-manager"></label><label><span>工作地点</span><input id="life-location" value="${escapeHtml(selected?.location||'')}"></label>`,async()=>{const positionId=document.getElementById('life-role').value,position=positions.find(x=>x.id===positionId);await request('api/employee-lifecycle/onboarding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidateId:state.activeId,positionId,plannedStartDate:document.getElementById('life-start').value,role:position?.name||'',department:position?.department||'',manager:document.getElementById('life-manager').value.trim(),location:document.getElementById('life-location').value.trim(),operator:'当前用户'})});await openLifecycleWorkbench(state.lifecycleCandidateId)});
      document.getElementById('life-role')?.addEventListener('change',(event)=>{const position=positions.find(x=>x.id===event.currentTarget.value);document.getElementById('life-department').value=position?.department||'';if(position?.location)document.getElementById('life-location').value=position.location});
    } catch(error) { notifyUser(error.message||'岗位数据加载失败','error',openLifecycleCreate); }
  }
  function openLifecycleAction(item,action){if(action==='document')return lifeForm('上传入职资料','文件进入应用对象存储，上传后仍需人工核验。',`<label><span>资料类型</span><select id="life-doc-type"><option>身份证明</option><option>学历证明</option><option>银行卡</option><option>离职证明</option><option>体检报告</option><option>其他资料</option></select></label><label class="wide"><span>选择文件（最大15MB）</span><input id="life-doc-file" type="file"></label>`,async()=>{const file=document.getElementById('life-doc-file').files[0];if(!file)throw new Error('请选择文件');const form=new FormData();form.append('file',file);form.append('type',document.getElementById('life-doc-type').value);form.append('operator','当前用户');await request(`api/employee-lifecycle/onboarding/${item.id}/documents`,{method:'POST',body:form});await openLifecycleWorkbench(state.lifecycleCandidateId)});if(action==='task')return lifeForm('新增协同任务','用于补充工位、设备、账号、培训或部门自定义事项。',`<label><span>分类</span><select id="life-task-category"><option>工位</option><option>设备</option><option>账号</option><option>培训</option><option>部门协同</option></select></label><label><span>任务名称</span><input id="life-task-name"></label><label><span>负责人</span><input id="life-task-owner"></label><label><span>截止时间</span><input id="life-task-due" type="datetime-local"></label><label class="wide"><span>说明</span><textarea id="life-task-description"></textarea></label>`,async()=>{await request(`api/employee-lifecycle/onboarding/${item.id}/tasks`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:document.getElementById('life-task-category').value,name:document.getElementById('life-task-name').value.trim(),owner:document.getElementById('life-task-owner').value.trim(),dueAt:document.getElementById('life-task-due').value,description:document.getElementById('life-task-description').value.trim(),operator:'当前用户'})});await openLifecycleWorkbench(state.lifecycleCandidateId)});if(action==='external')return lifeForm('生成入职系统请求','只输出最小必要数据，未配置OA/HR系统时不会伪造同步成功。',`<label class="wide"><span>目标系统</span><input id="life-external-system" placeholder="例如：企业微信人事、飞书人事或内部OA"></label><div class="rf-boundary-note wide"><strong>接口边界</strong><p>请求包含候选人ID、计划入职日期、部门和岗位；真实发送与结果回填需后续连接具体系统。</p></div>`,async()=>{const r=await request(`api/employee-lifecycle/onboarding/${item.id}/external-request`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system:document.getElementById('life-external-system').value.trim(),operator:'当前用户'})});window.alert(r.boundary);await openLifecycleWorkbench(state.lifecycleCandidateId)});if(action==='arrival')return lifeForm('确认实际到岗','确认后自动推进为已入职、回写需求HC并生成试用期节点。',`<label><span>实际到岗日期</span><input id="life-arrival-date" type="date" value="${new Date().toISOString().slice(0,10)}"></label><label><span>试用期月数</span><input id="life-probation-months" type="number" value="3"></label><label class="wide"><span>确认说明</span><textarea id="life-arrival-note" placeholder="例如：本人已到岗，入职资料核验完成"></textarea></label>`,async()=>{await request(`api/employee-lifecycle/onboarding/${item.id}/arrival`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actualDate:document.getElementById('life-arrival-date').value,probationMonths:Number(document.getElementById('life-probation-months').value||3),note:document.getElementById('life-arrival-note').value.trim(),operator:'当前用户'})});await openLifecycleWorkbench(state.lifecycleCandidateId)});if(action==='offboarding')return lifeForm('发起离职流程','记录离职分类和回流建议，交接未完成前不能确认离职。',`<label><span>离职类型</span><select id="life-off-type"><option>主动离职</option><option>协商解除</option><option>试用期不通过</option><option>合同到期</option><option>公司解除</option></select></label><label><span>原因分类</span><select id="life-off-category"><option>职业发展</option><option>薪酬福利</option><option>管理关系</option><option>工作内容</option><option>家庭个人</option><option>绩效不符</option><option>组织调整</option><option>其他</option></select></label><label><span>计划离职日期</span><input id="life-off-date" type="date"></label><label><span>人才回流</span><select id="life-off-return"><option value="true">建议回流</option><option value="false">暂不回流</option></select></label><label class="wide"><span>离职原因说明</span><textarea id="life-off-reason"></textarea></label>`,async()=>{await request('api/employee-lifecycle/offboarding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({onboardingId:item.id,type:document.getElementById('life-off-type').value,reasonCategory:document.getElementById('life-off-category').value,reason:document.getElementById('life-off-reason').value.trim(),plannedDate:document.getElementById('life-off-date').value,returnToPool:document.getElementById('life-off-return').value==='true',operator:'当前用户'})});await openLifecycleWorkbench(state.lifecycleCandidateId)});if(action==='exit-interview')return openExitInterview(item);if(action==='complete-offboarding')return lifeForm('确认离职完成','工作交接、资产归还和账号关闭均完成后，系统结束流程并生成30/90天回访。',`<label><span>实际离职日期</span><input id="life-off-actual" type="date" value="${new Date().toISOString().slice(0,10)}"></label>${['handover','assets','accounts'].map((x,i)=>`<label><span>${['工作交接','资产归还','账号关闭'][i]}</span><select id="life-${x}"><option>已完成</option><option>待处理</option></select></label>`).join('')}`,async()=>{await request(`api/employee-lifecycle/offboarding/${item.offboarding.id}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actualDate:document.getElementById('life-off-actual').value,handover:document.getElementById('life-handover').value,assets:document.getElementById('life-assets').value,accounts:document.getElementById('life-accounts').value,operator:'当前用户'})});await openLifecycleWorkbench(state.lifecycleCandidateId)})}
  function openProbationForm(item,reviewId){
    const review=(item.probations||[]).find(x=>x.id===reviewId)||{};
    if(review.type==='入职一月评价')return lifeForm('填写入职一月评价','新人入职满一个月后，由岗位HR填写述职评级、成长等级和述职评价。',`<label><span>述职评级 *</span><select id="life-performance-rating" required><option value="">请选择</option><option ${review.performanceRating==='S'?'selected':''}>S</option><option ${review.performanceRating==='A'?'selected':''}>A</option><option ${review.performanceRating==='B'?'selected':''}>B</option></select></label><label><span>新人成长等级 *</span><input id="life-growth-level" list="life-growth-level-options" value="${escapeHtml(review.growthLevel||'')}" required placeholder="请选择或输入"><datalist id="life-growth-level-options"><option value="快速成长"><option value="稳定成长"><option value="达到预期"><option value="需要辅导"></datalist></label><label class="wide"><span>述职评价 *</span><textarea id="life-appraisal" required placeholder="请填写工作成果、适应情况、成长表现和后续培养建议">${escapeHtml(review.appraisal||'')}</textarea></label>`,async()=>{await request(`api/employee-lifecycle/onboarding/${item.id}/probation/${reviewId}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({performanceRating:document.getElementById('life-performance-rating').value,growthLevel:document.getElementById('life-growth-level').value.trim(),appraisal:document.getElementById('life-appraisal').value.trim(),operator:'当前用户'})});await openLifecycleWorkbench(state.lifecycleCandidateId)});
    lifeForm('填写试用期节点','评价和转正建议会保留在员工生命周期中。',`<label><span>绩效评分</span><input id="life-prob-score" type="number" min="0" max="100" value="${Number(review.score||0)||''}"></label><label><span>转正建议</span><select id="life-prob-recommend"><option>继续观察</option><option>转正</option><option>延长试用</option><option>不予转正</option></select></label><label class="wide"><span>负责人评价</span><textarea id="life-prob-manager">${escapeHtml(review.managerReview||'')}</textarea></label><label class="wide"><span>员工反馈</span><textarea id="life-prob-feedback"></textarea></label>`,async()=>{await request(`api/employee-lifecycle/onboarding/${item.id}/probation/${reviewId}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score:Number(document.getElementById('life-prob-score').value||0),recommendation:document.getElementById('life-prob-recommend').value,managerReview:document.getElementById('life-prob-manager').value.trim(),employeeFeedback:document.getElementById('life-prob-feedback').value.trim(),operator:'当前用户'})});await openLifecycleWorkbench(state.lifecycleCandidateId)})
  }
  function openExitInterview(item){lifeForm('记录离职面谈','提交后系统会在后台分析离职原因，将原面试遗漏问题自动加入对应面试官的后续题单。',`<label><span>面谈日期</span><input id="life-exit-date" type="date" value="${new Date().toISOString().slice(0,10)}"></label><label><span>面谈人</span><input id="life-exit-interviewer" value="当前用户"></label><label><span>离职主因</span><input id="life-exit-main"></label><label><span>是否愿意回流</span><select id="life-exit-return"><option value="true">愿意</option><option value="false">暂不愿意</option></select></label><label class="wide"><span>改进建议</span><textarea id="life-exit-suggestions"></textarea></label><label><span>真实去向</span><input id="life-exit-destination"></label><label><span>回流条件</span><input id="life-exit-conditions"></label>`,async()=>{const result=await request(`api/employee-lifecycle/offboarding/${item.offboarding.id}/interview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({interviewDate:document.getElementById('life-exit-date').value,interviewer:document.getElementById('life-exit-interviewer').value.trim(),mainReason:document.getElementById('life-exit-main').value.trim(),suggestions:document.getElementById('life-exit-suggestions').value.trim(),destination:document.getElementById('life-exit-destination').value.trim(),willingToReturn:document.getElementById('life-exit-return').value==='true',returnConditions:document.getElementById('life-exit-conditions').value.trim(),confidentiality:'HR可见'} )});notifyUser(result.questionBankStatus==='处理中'?'离职面谈已保存，正在后台优化面试题库':'离职面谈已保存','success');await openLifecycleWorkbench(state.lifecycleCandidateId)})}
  function openFollowupForm(followupId){lifeForm('填写回访记录','记录真实原因和反馈，可同步调整人才评级及回流意向。',`<label><span>渠道</span><select id="life-follow-channel"><option>电话</option><option>微信</option><option>邮件</option><option>当面</option></select></label><label><span>结果</span><select id="life-follow-result"><option>已完成</option><option>暂未联系上</option><option>拒绝回访</option><option>需要再次联系</option></select></label><label><span>满意度 0-10</span><input id="life-follow-score" type="number" min="0" max="10"></label><label><span>回流意向</span><select id="life-follow-return"><option>积极</option><option>可沟通</option><option>暂不考虑</option><option>明确拒绝</option></select></label><label><span>调整后人才评级</span><select id="life-follow-rating"><option value="">不调整</option><option>A级</option><option>B级</option><option>C级</option></select></label><label class="wide"><span>回访原因</span><input id="life-follow-reason"></label><label class="wide"><span>反馈内容</span><textarea id="life-follow-feedback"></textarea></label>`,async()=>{await request(`api/employee-lifecycle/followups/${followupId}/record`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:document.getElementById('life-follow-channel').value,result:document.getElementById('life-follow-result').value,satisfaction:Number(document.getElementById('life-follow-score').value||0),returnIntent:document.getElementById('life-follow-return').value,ratingAfter:document.getElementById('life-follow-rating').value,reason:document.getElementById('life-follow-reason').value.trim(),feedback:document.getElementById('life-follow-feedback').value.trim(),operator:'当前用户'})});await openLifecycleWorkbench(state.lifecycleCandidateId)})}
  function lifeForm(title,description,fields,submit){showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-life-back>← 返回员工生命周期</button><span>EMPLOYEE LIFECYCLE ACTION</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></header><div class="rf-dialog-form">${fields}</div><div class="rf-dialog-actions"><button class="btn-primary" data-life-submit>确认提交</button></div><p class="rf-dialog-message" id="life-message"></p>`,'wide');document.querySelector('[data-life-back]')?.addEventListener('click',renderLifecycleWorkbench);document.querySelector('[data-life-submit]')?.addEventListener('click',async()=>{const message=document.getElementById('life-message');if(!validateDialogForm(message))return;try{message.textContent='正在提交…';message.classList.remove('error');await submit()}catch(error){message.textContent=error.message||'操作失败';message.classList.add('error')}})}

  async function openGovernanceWorkbench(){if(state.archiveMode!=='api')return setTalentMessage('当前为离线档案预览，接口可用后才能使用流程治理。',true);const token=showTalentDialog('<div class="rf-dialog-loading">正在读取阶段规则、SLA、待办和审计日志…</div>','wide');try{const[rules,mine,team,audits]=await Promise.all([request('api/governance/stage-rules'),request('api/governance/tasks?scope=mine&userId=%E5%BD%93%E5%89%8D%E7%94%A8%E6%88%B7'),request('api/governance/tasks?scope=team'),request('api/governance/audits')]);if(!isTalentDialogCurrent(token))return;state.governanceData={rules:rules.rules||[],mine:mine.tasks||[],team:team.tasks||[],mineOverdue:mine.overdue||0,teamOverdue:team.overdue||0,audits:audits.items||[]};renderGovernanceWorkbench()}catch(error){dialogFailure('流程治理工作台读取失败',error,openGovernanceWorkbench,token)}}
  function renderGovernanceWorkbench(){const data=state.governanceData||{rules:[],mine:[],team:[],audits:[]},openTasks=data.team.filter(x=>x.status!=='已完成');showTalentDialog(`<header class="rf-dialog-head"><div><span>WORKFLOW GOVERNANCE</span><h2>流程规则、SLA、待办与审计</h2><p>人工推进必须满足合法转换和进入/退出条件；逾期会生成待办并按时长升级。</p></div><div class="rf-assessment-head-actions"><button class="btn-soft" data-gov-audit-filter>筛选审计</button><button class="btn-primary" data-gov-sla>扫描阶段SLA</button></div></header><div class="rf-review-metrics"><article><span>阶段规则</span><strong>${data.rules.length}</strong></article><article><span>我的待办</span><strong>${data.mine.filter(x=>x.status!=='已完成').length}</strong></article><article class="warn"><span>我的逾期</span><strong>${Number(data.mineOverdue||0)}</strong></article><article><span>团队待办</span><strong>${openTasks.length}</strong></article><article class="warn"><span>团队逾期</span><strong>${Number(data.teamOverdue||0)}</strong></article></div><div class="rf-gov-layout"><section><div class="rf-review-title"><strong>我的待办与团队待办</strong><small>${openTasks.length}项处理中</small></div><div class="rf-gov-tasks">${openTasks.map(x=>`<article class="${x.overdue?'overdue':''}"><div><span>${escapeHtml(x.type)} · ${escapeHtml(x.priority)}</span><strong>${escapeHtml(x.title)}</strong><p>${escapeHtml(x.description)}</p><small>${escapeHtml(x.owner||'待分配')} · 截止 ${escapeHtml(x.deadline||'未设置')} · 升级${Number(x.escalation||0)}级</small></div><aside><button data-gov-remind="${escapeHtml(x.id)}">提醒</button><button data-gov-escalate="${escapeHtml(x.id)}">升级</button><button class="primary" data-gov-complete="${escapeHtml(x.id)}">完成</button></aside></article>`).join('')||'<div class="rf-dialog-empty"><p>当前没有待处理任务。</p></div>'}</div></section><aside><div class="rf-review-title"><strong>合法阶段转换</strong><small>${data.rules.filter(x=>x.status==='启用').length}条启用</small></div><div class="rf-gov-rules">${data.rules.map(x=>`<article><strong>${escapeHtml(x.from)} → ${escapeHtml(x.to)}</strong><span>SLA ${Number(x.slaHours)}小时 · ${escapeHtml(x.ownerRole)}</span><small>进入：${(x.entryConditions||[]).map(escapeHtml).join('、')}<br>退出：${(x.exitConditions||[]).map(escapeHtml).join('、')}</small></article>`).join('')}</div></aside></div><section class="rf-gov-audits"><div class="rf-review-title"><strong>最近操作审计</strong><small>${data.audits.length}条</small></div>${data.audits.slice(0,30).map(x=>`<article><time>${escapeHtml(x.time)}</time><div><strong>${escapeHtml(x.action)} · ${escapeHtml(x.objectType)}</strong><p>${escapeHtml(x.objectId)}${x.reason?` · ${escapeHtml(x.reason)}`:''}</p><small>${escapeHtml(x.operator||'系统')} · ${escapeHtml(x.result||'')}</small></div></article>`).join('')||'<div class="rf-dialog-empty"><p>暂无审计日志。</p></div>'}</section>`,'wide');document.querySelector('[data-gov-sla]')?.addEventListener('click',scanGovernanceSla);document.querySelector('[data-gov-audit-filter]')?.addEventListener('click',openAuditFilter);document.querySelectorAll('[data-gov-remind]').forEach(b=>b.addEventListener('click',()=>governanceTaskAction(b.dataset.govRemind,'remind','已向当前处理人发出提醒')));document.querySelectorAll('[data-gov-escalate]').forEach(b=>b.addEventListener('click',()=>governanceTaskAction(b.dataset.govEscalate,'escalate','任务逾期或影响招聘进度，升级处理')));document.querySelectorAll('[data-gov-complete]').forEach(b=>b.addEventListener('click',()=>governanceTaskAction(b.dataset.govComplete,'complete','事项已经处理完成并核对结果')))}
  async function scanGovernanceSla(){try{const result=await request('api/governance/sla/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator:'当前用户'})});notifyUser(`SLA扫描完成：检查${result.checked||0}，新建${result.created||0}，升级${result.escalated||0}`,'success');await openGovernanceWorkbench()}catch(error){notifyUser(error.message||'SLA扫描失败','error',scanGovernanceSla)}}
  async function governanceTaskAction(id,action,note){try{await request(`api/governance/tasks/${id}/action`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,note,operator:'当前用户'})});notifyUser('待办状态已更新','success');await openGovernanceWorkbench()}catch(error){notifyUser(error.message||'待办操作失败','error',()=>governanceTaskAction(id,action,note))}}
  function openAuditFilter(){showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-gov-back>← 返回流程治理</button><span>AUDIT SEARCH</span><h2>检索对象级审计日志</h2><p>可按对象、操作人和时间范围查找修改前后摘要。</p></div></header><div class="rf-dialog-form"><label><span>对象类型</span><input id="gov-audit-type" placeholder="人才 / Offer / 背调"></label><label><span>对象ID</span><input id="gov-audit-id"></label><label><span>操作人</span><input id="gov-audit-operator"></label><label><span>开始时间</span><input id="gov-audit-from" type="datetime-local"></label><label><span>结束时间</span><input id="gov-audit-to" type="datetime-local"></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-gov-search>查询</button></div><div id="gov-audit-results"></div>`,'wide');document.querySelector('[data-gov-back]')?.addEventListener('click',renderGovernanceWorkbench);document.querySelector('[data-gov-search]')?.addEventListener('click',async()=>{const params=new URLSearchParams({objectType:document.getElementById('gov-audit-type').value.trim(),objectId:document.getElementById('gov-audit-id').value.trim(),operator:document.getElementById('gov-audit-operator').value.trim(),from:document.getElementById('gov-audit-from').value,to:document.getElementById('gov-audit-to').value});const result=await request(`api/governance/audits?${params}`);document.getElementById('gov-audit-results').innerHTML=`<div class="rf-gov-audits">${(result.items||[]).map(x=>`<article><time>${escapeHtml(x.time)}</time><div><strong>${escapeHtml(x.action)} · ${escapeHtml(x.objectType)}</strong><p>${escapeHtml(x.objectId)} · ${escapeHtml(x.reason||'')}</p><small>${escapeHtml(x.operator)} · ${escapeHtml(x.result)}</small></div></article>`).join('')||'<div class="rf-dialog-empty"><p>当前条件下没有日志。</p></div>'}</div>`})}
  async function openTalentGovernance(candidateId){if(!candidateId)return;const token=showTalentDialog('<div class="rf-dialog-loading">正在汇总合法阶段、评级历史和完整时间线…</div>','wide');try{const[allowed,timeline,ratings]=await Promise.all([request(`api/governance/talents/${encodeURIComponent(candidateId)}/allowed-transitions`),request(`api/governance/talents/${encodeURIComponent(candidateId)}/timeline`),request(`api/governance/talents/${encodeURIComponent(candidateId)}/rating-history`)]);if(!isTalentDialogCurrent(token))return;const talent=state.talentDetails[candidateId]||state.talents.find(x=>x.id===candidateId)||{};showTalentDialog(`<header class="rf-dialog-head"><div><span>TALENT GOVERNANCE</span><h2>${escapeHtml(talent.name||'当前人才')}的流程与历史</h2><p>当前阶段：${escapeHtml(allowed.current||talent.status||'待确认')}。未满足的进入条件会阻止人工推进。</p></div><div class="rf-assessment-head-actions"><a class="btn-soft" href="${escapeHtml(apiUrl(`api/governance/talents/${encodeURIComponent(candidateId)}/export`))}" target="_blank">导出CSV</a><button class="btn-primary" data-gov-rate>调整评级</button></div></header><section class="rf-gov-allowed"><div class="rf-review-title"><strong>可推进阶段与实时条件</strong><small>${allowed.allowed?.length||0}个</small></div>${(allowed.allowed||[]).map(x=>`<article><div><strong>${escapeHtml(allowed.current)} → ${escapeHtml(x.stage)}</strong><small>SLA ${Number(x.slaHours)}小时</small></div><ul>${(x.checks||[]).length?x.checks.map(c=>`<li class="${c.passed?'pass':'fail'}">${c.passed?'✓':'!'} ${escapeHtml(c.name)} · ${escapeHtml(c.detail)}</li>`).join(''):'<li class="pass">✓ 当前规则无额外数据条件</li>'}</ul></article>`).join('')||'<div class="rf-dialog-empty"><p>当前阶段没有可用的人工转换，可能已结束或需走专用业务动作。</p></div>'}</section><div class="rf-gov-talent-grid"><section><div class="rf-review-title"><strong>人才评级历史</strong><small>${ratings.events?.length||0}次</small></div>${(ratings.events||[]).map(x=>`<article><strong>${escapeHtml(x.before)} → ${escapeHtml(x.after)}</strong><p>${escapeHtml(x.reason)}</p><small>${escapeHtml(x.operator)} · ${escapeHtml(x.time)}</small></article>`).join('')||'<div class="rf-dialog-empty"><p>暂无评级历史。</p></div>'}</section><section><div class="rf-review-title"><strong>完整时间线</strong><small>${timeline.total||0}条</small></div><div class="rf-gov-timeline">${(timeline.events||[]).map(x=>`<article><i></i><div><span>${escapeHtml(x.type)}</span><strong>${escapeHtml(x.title)}</strong><p>${escapeHtml(x.detail||'')}</p><small>${escapeHtml(x.time)} · ${escapeHtml(x.operator||'系统')}</small></div></article>`).join('')||'<div class="rf-dialog-empty"><p>暂无生命周期记录。</p></div>'}</div></section></div>`,'wide');document.querySelector('[data-gov-rate]')?.addEventListener('click',()=>openRatingForm(candidateId))}catch(error){if(isTalentDialogCurrent(token))showTalentDialog(`<div class="rf-dialog-error"><strong>人才治理档案读取失败</strong><p>${escapeHtml(conciseError(error))}</p></div>`,'wide')}}
  function openRatingForm(candidateId){showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-gov-talent-back>← 返回治理档案</button><span>TALENT RATING</span><h2>调整人才评级</h2><p>评级必须填写原因和证据，并保留不可变历史。</p></div></header><div class="rf-dialog-form"><label><span>新评级</span><select id="gov-rating"><option>S</option><option>A</option><option>B</option><option>C</option><option>D</option></select></label><label class="wide"><span>评级原因</span><textarea id="gov-rating-reason"></textarea></label><label class="wide"><span>评级证据（每行一条）</span><textarea id="gov-rating-evidence"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-primary" data-gov-save-rating>保存评级</button></div><p class="rf-dialog-message" id="gov-rating-message"></p>`,'wide');document.querySelector('[data-gov-talent-back]')?.addEventListener('click',()=>openTalentGovernance(candidateId));document.querySelector('[data-gov-save-rating]')?.addEventListener('click',async()=>{const message=document.getElementById('gov-rating-message');try{await request(`api/governance/talents/${candidateId}/rating`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating:document.getElementById('gov-rating').value,reason:document.getElementById('gov-rating-reason').value.trim(),evidence:document.getElementById('gov-rating-evidence').value.split('\n').map(x=>x.trim()).filter(Boolean),operator:'当前用户'})});await openTalentGovernance(candidateId)}catch(error){message.textContent=error.message}})}

  async function openMessageWorkbench(){if(state.archiveMode!=='api')return setTalentMessage('当前为离线档案预览，接口可用后才能使用消息中心。',true);const token=showTalentDialog('<div class="rf-dialog-loading">正在读取企微连接、消息、模板和触发规则…</div>','wide');try{const[connection,messages,templates,rules]=await Promise.all([request('api/messages/connection'),request('api/messages'),request('api/messages/templates'),request('api/messages/rules/list')]);if(!isTalentDialogCurrent(token))return;state.messageData={connection,messages:messages.messages||[],templates:templates.templates||[],rules:rules.rules||[]};renderMessageWorkbench()}catch(error){dialogFailure('消息中心读取失败',error,openMessageWorkbench,token)}}
  function renderMessageWorkbench(){const data=state.messageData||{connection:{},messages:[],templates:[],rules:[]},failed=data.messages.filter(x=>x.status==='发送失败').length;showTalentDialog(`<header class="rf-dialog-head"><div><span>MESSAGE CENTER</span><h2>企业微信消息与内部通知</h2><p>外发前必须预览并确认。群消息自动遮蔽联系方式、薪酬、背调和内部评价。</p></div><div class="rf-assessment-head-actions"><button class="btn-soft" data-msg-owner>Owner告警</button><button class="btn-soft" data-msg-rule>触发规则</button><button class="btn-soft" data-msg-template>新建模板</button><button class="btn-primary" data-msg-compose>新建消息</button></div></header><section class="rf-msg-connection ${data.connection.status==='已连接'?'ok':'fail'}"><div><i></i><strong>企业微信${escapeHtml(data.connection.status||'未检查')}</strong><p>${escapeHtml(data.connection.status==='已连接'?'应用Owner企微凭证可用。':data.connection.message||'连接状态未知')}</p></div><small>${escapeHtml(data.connection.status==='已连接'?`检查时间 ${data.connection.checkedAt||''}`:data.connection.action||'请检查连接器')}</small><button data-msg-refresh>重新检查</button></section><div class="rf-review-metrics"><article><span>消息总数</span><strong>${data.messages.length}</strong></article><article><span>待确认</span><strong>${data.messages.filter(x=>x.confirmationStatus==='待确认').length}</strong></article><article><span>已发送</span><strong>${data.messages.filter(x=>x.status==='已发送').length}</strong></article><article class="warn"><span>发送失败</span><strong>${failed}</strong></article><article><span>启用规则</span><strong>${data.rules.filter(x=>x.status==='启用').length}</strong></article></div><section class="rf-msg-list"><div class="rf-review-title"><strong>发送记录与草稿</strong><small>${data.messages.length}条</small></div>${data.messages.map(x=>`<article><div><strong>${escapeHtml(x.category)} · ${escapeHtml(x.channel)}</strong><p>${escapeHtml(x.content)}</p><small>${escapeHtml(x.status)} · ${escapeHtml(x.recipientType)} ${escapeHtml(x.recipientAddress||'应用Owner')} · ${escapeHtml(x.createdAt)}</small>${x.maskedFields?.length?`<em>已脱敏：${x.maskedFields.map(escapeHtml).join('、')}</em>`:''}${x.error?`<b>${escapeHtml(x.error)}</b>`:''}</div><aside>${x.status==='草稿'?`<button data-msg-review="${escapeHtml(x.id)}">查看并发送</button>`:''}${x.status==='发送失败'?`<button class="danger" data-msg-retry="${escapeHtml(x.id)}">重试</button>`:''}</aside></article>`).join('')||'<div class="rf-dialog-empty"><p>暂无消息，可先创建预览草稿。</p></div>'}</section><div class="rf-msg-bottom"><section><div class="rf-review-title"><strong>消息模板</strong><small>${data.templates.length}个</small></div>${data.templates.map(x=>`<p><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml(x.category)} · ${escapeHtml(x.channel)}</span><small>${escapeHtml(x.sensitivePolicy)}</small></p>`).join('')}</section><section><div class="rf-review-title"><strong>条件触发规则</strong><button data-msg-scan>立即扫描</button></div>${data.rules.map(x=>`<p><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml(x.eventType)} · ${escapeHtml(x.mode)}</span><small>${escapeHtml(x.status)} · 命中${Number(x.hitCount||0)}次</small><button data-msg-toggle="${escapeHtml(x.id)}" data-status="${x.status==='启用'?'停用':'启用'}">${x.status==='启用'?'停用':'启用'}</button></p>`).join('')||'<div class="rf-dialog-empty"><p>暂无触发规则。</p></div>'}</section></div>`,'wide');document.querySelector('[data-msg-refresh]')?.addEventListener('click',openMessageWorkbench);document.querySelector('[data-msg-compose]')?.addEventListener('click',()=>openMessageComposer(state.activeId));document.querySelector('[data-msg-template]')?.addEventListener('click',openMessageTemplateForm);document.querySelector('[data-msg-rule]')?.addEventListener('click',openMessageRuleForm);document.querySelector('[data-msg-owner]')?.addEventListener('click',openOwnerAlertForm);document.querySelector('[data-msg-scan]')?.addEventListener('click',scanMessageRules);document.querySelectorAll('[data-msg-review]').forEach(b=>b.addEventListener('click',()=>reviewExistingMessage(b.dataset.msgReview)));document.querySelectorAll('[data-msg-retry]').forEach(b=>b.addEventListener('click',()=>retryMessage(b.dataset.msgRetry)));document.querySelectorAll('[data-msg-toggle]').forEach(b=>b.addEventListener('click',()=>toggleMessageRule(b.dataset.msgToggle,b.dataset.status)))}
  function openMessageComposer(candidateId,initialCategory){const templates=state.messageData?.templates||[],categories=['优质简历','公司介绍','岗位介绍','测评邀请','面试通知','Offer通知','入职通知','回访通知','内推奖励'],category=initialCategory||'公司介绍';showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-msg-back>← 返回消息中心</button><span>MESSAGE PREVIEW</span><h2>创建消息预览</h2><p>系统先生成脱敏草稿，下一步才允许确认发送。</p></div></header><div class="rf-dialog-form"><label><span>业务类型</span><select id="msg-category">${categories.map(x=>`<option ${x===category?'selected':''}>${x}</option>`).join('')}</select></label><label><span>发送渠道</span><select id="msg-channel"><option ${category==='优质简历'?'selected':''}>企业微信群</option><option ${category!=='优质简历'?'selected':''}>企业微信单聊</option><option>Owner通知</option></select></label><label><span>消息模板</span><select id="msg-template">${templates.map(x=>`<option value="${escapeHtml(x.id)}" data-category="${escapeHtml(x.category)}">${escapeHtml(x.name)} · ${escapeHtml(x.channel)}</option>`).join('')}</select></label><label><span>接收类型</span><select id="msg-recipient-type"><option>招聘群</option><option>候选人</option><option>员工</option><option>应用Owner</option></select></label><label class="wide"><span>群聊ID / 企微成员 userid</span><input id="msg-recipient" placeholder="单聊填写企微内部成员 userid；Owner通知无需填写"></label><label class="wide"><span>自定义内容（留空使用模板）</span><textarea id="msg-content" placeholder="支持模板变量，例如 {{候选人姓名}}、{{岗位名称}}、{{简历链接}}"></textarea></label></div><div class="rf-boundary-note"><strong>敏感字段策略</strong><p>企业微信群默认严格脱敏；指定成员单聊只发送工作所需信息；当前单聊对象必须是企业微信内部成员 userid。</p></div><div class="rf-dialog-actions"><button class="btn-primary" data-msg-preview>生成预览</button></div><p class="rf-dialog-message" id="msg-message"></p>`,'wide');const categorySelect=document.getElementById('msg-category'),templateSelect=document.getElementById('msg-template'),channel=document.getElementById('msg-channel');const syncTemplate=()=>{const wanted=categorySelect.value,option=[...templateSelect.options].find(o=>o.dataset.category===wanted);if(option)templateSelect.value=option.value;if(wanted==='优质简历')channel.value='企业微信群';else if(wanted==='回访通知')channel.value='Owner通知';else channel.value='企业微信单聊'};categorySelect.addEventListener('change',syncTemplate);syncTemplate();document.querySelector('[data-msg-back]')?.addEventListener('click',renderMessageWorkbench);document.querySelector('[data-msg-preview]')?.addEventListener('click',async()=>{const message=document.getElementById('msg-message');try{const result=await request('api/messages/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({templateId:templateSelect.value,category:categorySelect.value,channel:channel.value,recipientType:document.getElementById('msg-recipient-type').value,recipientAddress:document.getElementById('msg-recipient').value.trim(),candidateId:candidateId||'',content:document.getElementById('msg-content').value.trim(),operator:'当前用户'})});renderMessagePreview(result)}catch(error){message.textContent=error.message}})}
  function renderMessagePreview(item){showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-msg-compose-back>← 修改消息</button><span>SEND CONFIRMATION</span><h2>发送前最终确认</h2><p>${escapeHtml(item.warning)}</p></div></header><section class="rf-msg-preview"><header><span>${escapeHtml(item.channel)}</span><strong>${escapeHtml(item.recipientAddress||'应用Owner')}</strong></header><pre>${escapeHtml(item.content)}</pre>${item.maskedFields?.length?`<div>已自动遮蔽：${item.maskedFields.map(escapeHtml).join('、')}</div>`:'<small>未检测到需要遮蔽的敏感字段</small>'}</section><label class="rf-msg-confirm"><input type="checkbox" id="msg-confirm"><span>我已核对接收人、内容、链接和脱敏结果，确认发送。</span></label><div class="rf-dialog-actions"><button class="btn-primary" data-msg-send>确认发送</button></div><p class="rf-dialog-message" id="msg-send-message"></p>`,'wide');document.querySelector('[data-msg-compose-back]')?.addEventListener('click',()=>openMessageComposer(state.activeId));document.querySelector('[data-msg-send]')?.addEventListener('click',async()=>{const message=document.getElementById('msg-send-message');if(!document.getElementById('msg-confirm').checked)return message.textContent='请勾选确认后再发送';try{message.textContent='正在发送…';await request(`api/messages/${item.messageId}/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,operator:'当前用户'})});await openMessageWorkbench()}catch(error){message.textContent=error.message}})}
  function reviewExistingMessage(id){const item=state.messageData?.messages.find(x=>x.id===id);if(item)renderMessagePreview({messageId:item.id,content:item.content,maskedFields:item.maskedFields,channel:item.channel,recipientAddress:item.recipientAddress,warning:'这是已保存草稿，请再次核对后发送。'})}
  async function retryMessage(id){try{await request(`api/messages/${id}/retry`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator:'当前用户'})});notifyUser('消息重试已提交','success');await openMessageWorkbench()}catch(error){notifyUser(error.message||'重试失败','error',()=>retryMessage(id))}}
  function openMessageTemplateForm(){messageForm('新建消息模板','模板变量在预览时从人才、面试、测评、Offer、入职和回访数据中填充。',`<label><span>模板名称</span><input id="msg-tpl-name"></label><label><span>消息分类</span><input id="msg-tpl-category"></label><label><span>适用渠道</span><select id="msg-tpl-channel"><option>企业微信群</option><option>企业微信单聊</option><option>Owner通知</option></select></label><label><span>适用对象</span><input id="msg-tpl-audience"></label><label class="wide"><span>模板内容</span><textarea id="msg-tpl-content"></textarea></label>`,async()=>{await request('api/messages/templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('msg-tpl-name').value.trim(),category:document.getElementById('msg-tpl-category').value.trim(),channel:document.getElementById('msg-tpl-channel').value,audience:document.getElementById('msg-tpl-audience').value.trim(),content:document.getElementById('msg-tpl-content').value.trim(),operator:'当前用户'})});await openMessageWorkbench()})}
  function openMessageRuleForm(){const templates=state.messageData?.templates||[];messageForm('新建条件触发规则','规则可仅生成草稿，自动发送必须显式选择并配置接收地址。',`<label><span>规则名称</span><input id="msg-rule-name"></label><label><span>事件类型</span><select id="msg-rule-event"><option>高匹配人才</option><option>面试临近</option><option>回访到期</option></select></label><label><span>模板</span><select id="msg-rule-template">${templates.map(x=>`<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join('')}</select></label><label><span>渠道</span><select id="msg-rule-channel"><option>企业微信群</option><option>企业微信单聊</option><option>Owner通知</option></select></label><label><span>执行模式</span><select id="msg-rule-mode"><option>仅生成草稿</option><option>自动发送</option></select></label><label><span>接收类型</span><input id="msg-rule-recipient-type" value="招聘群"></label><label class="wide"><span>接收地址</span><input id="msg-rule-recipient" placeholder="Owner通知可留空"></label><label><span>最低匹配分 / 临近小时</span><input id="msg-rule-threshold" type="number" value="85"></label>`,async()=>{const eventType=document.getElementById('msg-rule-event').value,value=Number(document.getElementById('msg-rule-threshold').value||0),conditions=eventType==='高匹配人才'?{minScore:value}:eventType==='面试临近'?{withinHours:value}:{asOf:new Date().toISOString().slice(0,10)};await request('api/messages/rules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('msg-rule-name').value.trim(),eventType,conditions,templateId:document.getElementById('msg-rule-template').value,channel:document.getElementById('msg-rule-channel').value,recipientType:document.getElementById('msg-rule-recipient-type').value.trim(),recipientAddress:document.getElementById('msg-rule-recipient').value.trim(),mode:document.getElementById('msg-rule-mode').value,status:'启用',priority:50,operator:'当前用户'})});await openMessageWorkbench()})}
  function openOwnerAlertForm(){messageForm('发送应用Owner内部告警','该通知只发送给应用主人，不可指定其他接收人。',`<label class="wide"><span>告警标题</span><input id="msg-owner-title" value="人才管理系统告警"></label><label class="wide"><span>告警内容</span><textarea id="msg-owner-text"></textarea></label>`,async()=>{await request('api/messages/owner-alert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:document.getElementById('msg-owner-title').value.trim(),text:document.getElementById('msg-owner-text').value.trim(),operator:'当前用户'})});await openMessageWorkbench()})}
  async function scanMessageRules(){try{const result=await request('api/messages/rules/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operator:'当前用户'})});notifyUser(`扫描完成：命中${result.hits||0}，草稿${result.drafts||0}，发送${result.sent||0}，失败${result.failed||0}`,'success');await openMessageWorkbench()}catch(error){notifyUser(error.message||'规则扫描失败','error',scanMessageRules)}}
  async function toggleMessageRule(id,status){try{await request(`api/messages/rules/${id}/toggle`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});notifyUser(`规则已${status}`,'success');await openMessageWorkbench()}catch(error){notifyUser(error.message||'规则状态更新失败','error',()=>toggleMessageRule(id,status))}}
  function messageForm(title,description,fields,submit){showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-msg-back>← 返回消息中心</button><span>MESSAGE CENTER ACTION</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></header><div class="rf-dialog-form">${fields}</div><div class="rf-dialog-actions"><button class="btn-primary" data-msg-submit>确认提交</button></div><p class="rf-dialog-message" id="msg-form-message"></p>`,'wide');document.querySelector('[data-msg-back]')?.addEventListener('click',renderMessageWorkbench);document.querySelector('[data-msg-submit]')?.addEventListener('click',async()=>{const message=document.getElementById('msg-form-message');if(!validateDialogForm(message))return;try{message.textContent='正在提交…';message.classList.remove('error');await submit()}catch(error){message.textContent=error.message||'操作失败';message.classList.add('error')}})}

  async function openReferralWorkbench(){const token=showTalentDialog('<div class="rf-dialog-loading">正在读取内推活动、记录、奖励和渠道数据…</div>','wide');try{const[referrals,campaigns,rules,analytics]=await Promise.all([request('api/referrals'),request('api/referrals/campaigns'),request('api/referrals/reward-rules'),request('api/referrals/analytics')]);if(!isTalentDialogCurrent(token))return;state.referralData={referrals:referrals.referrals||[],campaigns:campaigns.campaigns||[],rules:rules.rules||[],analytics};renderReferralWorkbench()}catch(error){dialogFailure('内推工作台读取失败',error,openReferralWorkbench,token)}}

  function referralCampaignToken(campaign) {
    if (!campaign) return '';
    if (campaign.token) return String(campaign.token);
    try {
      const url = new URL(campaign.publicUrl || campaign.publicBaseUrl || '');
      return url.searchParams.get('referral_token') || '';
    } catch {
      return '';
    }
  }

  async function openReferralDirectUpload() {
    const access = state.currentAccess;
    const account = accessAccount(access);
    const referrerName = account.name;
    const referrerUserId = account.id;
    const referrerMobile = account.mobile;
    const referrerDepartment = (access?.account?.departments || [])[0] || '';
    if (!referrerName || referrerName === '当前用户') {
      showTalentDialog('<div class="rf-dialog-empty"><strong>无法识别当前登录员工</strong><p>请先完成登录或身份验证，再直接上传内推简历。</p></div>', 'wide');
      return;
    }

    const loadingToken = showTalentDialog('<div class="rf-dialog-loading">正在准备直接上传内推…</div>', 'wide');
    let positions = [];
    let referralToken = '';
    try {
      const [positionsResult, campaignsResult] = await Promise.all([
        request('api/referrals/positions'),
        request('api/referrals/campaigns'),
      ]);
      if (!isTalentDialogCurrent(loadingToken)) return;
      positions = positionsResult.positions || [];
      const campaigns = campaignsResult.campaigns || [];
      let campaign = campaigns.find(item => item.status === '启用' && item.referrerUserId === referrerUserId)
        || campaigns.find(item => item.status === '启用' && item.referrerName === referrerName);
      referralToken = referralCampaignToken(campaign);
      if (!referralToken) {
        if (!referrerMobile) throw new Error('当前员工缺少手机号，无法创建个人内推活动');
        const base = new URL(window.location.href);
        base.search = '';
        base.hash = '';
        campaign = await request('api/referrals/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${referrerName}内推`,
            role: '全部岗位',
            department: '',
            publicBaseUrl: base.toString(),
            referrerName,
            referrerMobile,
            referrerDepartment,
            referrerUserId,
            operator: referrerName,
            operatorUserId: referrerUserId,
          }),
        });
        referralToken = referralCampaignToken(campaign);
      }
      if (!referralToken) throw new Error('个人内推活动缺少上传凭证，请重新生成海报后再试');
      if (!positions.length) throw new Error('当前没有可选的在招岗位');
    } catch (error) {
      if (isTalentDialogCurrent(loadingToken)) dialogFailure('直接上传准备失败', error, openReferralDirectUpload, loadingToken);
      return;
    }

    const dialogToken = showTalentDialog(`
      <header class="rf-dialog-head">
        <div>
          <span>EMPLOYEE REFERRAL UPLOAD</span>
          <h2>直接上传内推简历</h2>
          <p>由${escapeHtml(referrerName)}作为推荐人，上传后与扫码内推共用同一条解析、查重和岗位关联链路。</p>
        </div>
      </header>
      <form id="rf-referral-direct-form" class="rf-dialog-form rf-referral-upload-form">
        <label><span>候选人姓名 *</span><input name="candidateName" required autocomplete="name" placeholder="请填写真实姓名"></label>
        <label><span>手机号 *</span><input name="candidatePhone" required inputmode="tel" maxlength="11" autocomplete="tel" placeholder="11位手机号"></label>
        <label class="wide"><span>意向岗位 *</span><select name="intendedPositionId" required>${positions.map(position => `<option value="${escapeHtml(position.id)}">${escapeHtml(position.name)} · ${escapeHtml(position.department || '未分配部门')}</option>`).join('')}</select></label>
        <div class="wide rf-referral-upload-drop" data-referral-upload-drop tabindex="0" role="button" aria-label="拖拽或点击选择简历文件">
          <span>上传简历 *</span>
          <input id="rf-referral-direct-file" type="file" hidden accept="${supported.join(',')}" aria-label="选择简历文件">
          <div><strong data-referral-upload-file>拖拽简历到这里，或点击选择文件</strong><small>支持 PDF、Word、图片，单个不超过10MB</small></div>
        </div>
        <label class="wide rf-ref-consent"><input name="consent" type="checkbox" required><span>我确认已获得候选人同意，并同意将简历用于本次招聘流程。</span></label>
      </form>
      <div class="rf-dialog-actions">
        <button class="btn-primary" data-referral-upload-submit>提交内推简历</button>
      </div>
      <p class="rf-dialog-message" id="rf-referral-upload-message" role="status" aria-live="polite"></p>
    `, 'wide');

    const form = document.getElementById('rf-referral-direct-form');
    const fileInput = document.getElementById('rf-referral-direct-file');
    const dropZone = form.querySelector('[data-referral-upload-drop]');
    const fileLabel = form.querySelector('[data-referral-upload-file]');
    const message = document.getElementById('rf-referral-upload-message');
    const submitButton = document.querySelector('[data-referral-upload-submit]');
    let selectedFile = null;

    const chooseFile = (file) => {
      if (!file) return;
      const extension = file.name.includes('.') ? `.${file.name.split('.').pop().toLowerCase()}` : '';
      if (!supported.includes(extension)) {
        message.textContent = `不支持${extension || '该文件'}格式，请上传 PDF、Word 或图片简历。`;
        message.classList.add('error');
        return;
      }
      if (!file.size) {
        message.textContent = '简历文件为空，请重新选择。';
        message.classList.add('error');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        message.textContent = '简历文件不能超过10MB。';
        message.classList.add('error');
        return;
      }
      selectedFile = file;
      fileLabel.textContent = file.name;
      message.textContent = '';
      message.classList.remove('error');
    };

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      fileInput.click();
    });
    fileInput.addEventListener('change', () => chooseFile(fileInput.files?.[0]));
    ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragging');
    }));
    dropZone.addEventListener('drop', (event) => chooseFile(event.dataTransfer?.files?.[0]));

    submitButton.addEventListener('click', async () => {
      if (form.dataset.submitting === 'true' || !isTalentDialogCurrent(dialogToken)) return;
      const candidatePhone = form.elements.candidatePhone.value.replace(/\s|-/g, '');
      if (!form.reportValidity() || !selectedFile) {
        message.textContent = selectedFile ? '请完成必填信息并确认招聘用途。' : '请先选择简历文件。';
        message.classList.add('error');
        if (!selectedFile) dropZone.focus();
        return;
      }
      if (!/^1[3-9]\d{9}$/.test(candidatePhone)) {
        message.textContent = '请填写正确的手机号。';
        message.classList.add('error');
        form.elements.candidatePhone.focus();
        return;
      }

      const data = new FormData(form);
      data.delete('consent');
      data.set('file', selectedFile);
      data.append('intendedPositionName', form.elements.intendedPositionId.selectedOptions[0]?.textContent || '');
      form.dataset.submitting = 'true';
      submitButton.disabled = true;
      submitButton.textContent = '正在上传并处理…';
      message.classList.remove('error');
      try {
        message.textContent = '正在上传简历并检查重复，请勿重复提交…';
        const started = await request(`api/public/referrals/${encodeURIComponent(referralToken)}/submit`, { method: 'POST', body: data, timeoutMs: 60000 });
        const result = await waitForBackgroundJob(started.jobId, (progress) => {
          if (message.isConnected) message.textContent = progress;
        }, { timeoutMessage: '简历仍在后台解析，请勿重复提交，可稍后在内推记录中查看。' });
        const trackingPath = new URL(result.trackingPath, window.location.href).toString();
        state.referralListCache = null;
        await window.refreshReferralOverview?.();
        showTalentDialog(`
          <section class="rf-public-ref-success rf-referral-upload-result">
            <i aria-hidden="true">✓</i>
            <strong>内推简历已提交</strong>
            <p>简历已解析、入库并进入${escapeHtml(result.status || '待负责人确认')}。</p>
            <small>查重状态：${escapeHtml(result.duplicateStatus || '已检查')}</small>
            <a class="btn-primary" href="${escapeHtml(trackingPath)}">查看内推进度</a>
          </section>
        `, 'wide');
      } catch (error) {
        message.textContent = `${conciseError(error)}。填写内容与所选文件仍保留。`;
        message.classList.add('error');
        message.scrollIntoView({ block: 'nearest' });
      } finally {
        if (form.isConnected) {
          form.dataset.submitting = 'false';
          submitButton.disabled = false;
          submitButton.textContent = '提交内推简历';
        }
      }
    });
  }

  async function openReferralPoster() {
    const access = state.currentAccess;
    const account = accessAccount(access);
    const currentUserName = account.name;
    const currentUserId = account.id;
    const currentUserMobile = account.mobile;
    if (!currentUserName || currentUserName === '当前用户') {
      showTalentDialog('<div class="rf-dialog-empty"><strong>无法识别当前登录用户</strong><p>请先完成登录或身份验证后再生成个人内推海报。</p></div>', 'wide');
      return;
    }
    const token = showTalentDialog('<div class="rf-dialog-loading">正在生成你的内推海报…</div>', 'wide');
    try {
      const [campaignsResult, positionsResult, orderResult] = await Promise.all([
        request('api/referrals/campaigns'),
        request('api/referrals/positions'),
        request('api/recruitment/referral-poster-order')
      ]);
      if (!isTalentDialogCurrent(token)) return;
      const availablePositions = positionsResult.positions || [];
      const positionsById = new Map(availablePositions.map((position) => [position.id, position]));
      const orderedPositionIds = orderResult.positionIds || [];
      const allPositions = orderedPositionIds.map((positionId) => positionsById.get(positionId)).filter(Boolean);
      const existingCampaigns = campaignsResult.campaigns || [];
      const referrerName = currentUserName;
      const referrerMobile = currentUserMobile;
      const referrerDepartment = (access?.account?.departments || [])[0] || '';
      const existing = existingCampaigns.find((c) => c.referrerName === referrerName && c.status === '启用');
      if (!allPositions.length) {
        showTalentDialog('<div class="rf-dialog-empty"><strong>本月暂无在招需求</strong><p>当前公司月份没有可用于内推海报的在招需求岗位。</p></div>', 'wide');
        return;
      }

      const renderPosterSelection = (selectedIds) => {
        const selectedCount = selectedIds.size;
        const pickerToken = showTalentDialog(`<header class="rf-dialog-head"><div><span>招聘海报管理 · ${escapeHtml(orderResult.month || '')}</span><h2>选择海报展示岗位</h2><p>按本月需求排序，最多选 5 个。选择仅影响海报内容，扫码页面仍展示全部在招岗位。</p></div></header><section class="rf-referral-poster-picker"><div class="rf-referral-poster-toolbar"><strong>本月在招需求</strong><b data-ref-poster-count aria-live="polite">已选 ${selectedCount}/5</b></div><label class="rf-referral-poster-search"><input type="search" data-ref-poster-search aria-label="搜索岗位" placeholder="搜索岗位或部门" autocomplete="off"></label><div class="rf-referral-poster-list" role="group" aria-label="选择海报展示岗位">${allPositions.map((position, index) => `<label class="rf-referral-poster-option" data-ref-poster-option data-search="${escapeHtml(`${position.name} ${position.department || ''}`.toLocaleLowerCase())}"><input type="checkbox" data-ref-poster-position="${escapeHtml(position.id)}" ${selectedIds.has(position.id) ? 'checked' : ''}><span><strong>${escapeHtml(position.name)}</strong><small>${escapeHtml(position.department || '未分配部门')} · ${position.salaryText ? escapeHtml(position.salaryText) : (position.minSalary || position.maxSalary) ? `${position.minSalary || 0}-${position.maxSalary || 0}元` : '薪资面议'}</small></span><b>${index + 1}</b></label>`).join('')}</div><div class="rf-dialog-actions rf-referral-poster-actions"><button class="btn-primary" data-ref-generate-poster type="button">生成海报（${selectedCount}）</button></div><p class="rf-dialog-message" data-ref-poster-message aria-live="polite"></p></section>`, 'wide');
        const dialog = document.getElementById('rf-talent-dialog');
        const checkboxes = [...dialog.querySelectorAll('[data-ref-poster-position]')];
        const countLabel = dialog.querySelector('[data-ref-poster-count]');
        const generateButton = dialog.querySelector('[data-ref-generate-poster]');
        const message = dialog.querySelector('[data-ref-poster-message]');
        const updateSelection = () => {
          const count = checkboxes.filter((checkbox) => checkbox.checked).length;
          countLabel.textContent = `已选 ${count}/5`;
          generateButton.textContent = `生成海报（${count}）`;
          generateButton.disabled = count === 0;
          checkboxes.forEach((checkbox) => { checkbox.disabled = !checkbox.checked && count >= 5; });
        };
        checkboxes.forEach((checkbox) => checkbox.addEventListener('change', updateSelection));
        dialog.querySelector('[data-ref-poster-search]')?.addEventListener('input', (event) => {
          const query = event.currentTarget.value.trim().toLocaleLowerCase();
          dialog.querySelectorAll('[data-ref-poster-option]').forEach((option) => {
            option.hidden = query !== '' && !option.dataset.search.includes(query);
          });
        });
        updateSelection();
        generateButton.addEventListener('click', async () => {
          const selectedPositionIds = new Set(checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.dataset.refPosterPosition));
          const selectedPositions = allPositions.filter((position) => selectedPositionIds.has(position.id));
          if (!selectedPositions.length || !isTalentDialogCurrent(pickerToken)) return;
          generateButton.disabled = true;
          generateButton.textContent = '正在生成海报…';
          checkboxes.forEach((checkbox) => { checkbox.disabled = true; });
          message.textContent = '正在准备专属二维码与海报…';
          try {
            let campaign = existing;
            if (!campaign) {
              const base = new URL(window.location.href); base.search = ''; base.hash = '';
              const created = await request('api/referrals/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: referrerName + '内推', role: '全部岗位', department: '', publicBaseUrl: base.toString(), referrerName, referrerMobile, referrerDepartment, referrerUserId: currentUserId, operator: referrerName, operatorUserId: currentUserId }) });
              campaign = { qrCode: created.qrCode, publicUrl: created.publicUrl, status: '启用', expiresAt: '', referrerName, referrerMobileMasked: referrerMobile ? referrerMobile.slice(0,3) + '****' + referrerMobile.slice(-4) : '', referrerDepartment };
            }
            if (!isTalentDialogCurrent(pickerToken)) return;
            const qr = escapeHtml(campaign.qrCode || '');
            const url = escapeHtml(campaign.publicUrl || '');
            const posterId = 'poster-me';
            showTalentDialog(`<header class="rf-dialog-head"><div><span>招聘海报管理</span><h2>我的招聘海报</h2><p>这是你的专属招聘海报，候选人扫码后填写姓名、手机号并上传简历，系统自动归属给你。</p></div></header><div class="rf-poster-page"><article class="rf-xhs-poster" id="${posterId}"><div class="rf-xhs-poster-dark"><div class="rf-xhs-poster-brand"><strong>方片新媒体</strong><span>招聘</span></div><div class="rf-xhs-poster-person"><div class="rf-xhs-poster-avatar" aria-hidden="true"></div><p>我是${escapeHtml(referrerName)}，我帮你内部推荐</p></div><div class="rf-xhs-poster-jobs">${selectedPositions.map((position) => `<div class="rf-xhs-poster-job"><strong>${escapeHtml(position.name)}</strong><small>${escapeHtml(position.responsibilities ? position.responsibilities.slice(0, 20) + (position.responsibilities.length > 20 ? '...' : '') : '方片新媒体')}</small></div>`).join('')}</div><div class="rf-xhs-poster-tiger-wrap"><img class="rf-xhs-poster-tiger" src="./uploads/image-1.png" alt="方片品牌老虎"></div></div><div class="rf-xhs-poster-light"><div class="rf-xhs-poster-qr-float"><img src="${qr}" alt="二维码"></div><p class="rf-xhs-poster-qr-tip">长按识别二维码查看职位详情</p></div></article><div class="rf-xhs-poster-actions"><button class="btn-soft" data-ref-copy-url="${url}" type="button">复制链接</button><button class="btn-primary" data-ref-download-poster type="button">保存海报</button></div></div>`, 'wide');
            document.querySelector('[data-ref-copy-url]')?.addEventListener('click', async (event) => {
              const link = event.currentTarget?.dataset?.refCopyUrl || url;
              try {
                await navigator.clipboard.writeText(link);
                notifyUser('链接已复制', 'success');
              } catch (error) {
                console.error(error); notifyUser('链接复制失败，请重试', 'error');
              }
            });
            document.querySelector('[data-ref-download-poster]')?.addEventListener('click', async (event) => {
              const card = document.getElementById(posterId);
              if (!card || typeof window.htmlToImage?.toJpeg !== 'function') return notifyUser('图片生成组件未加载', 'error');
              const button = event.currentTarget; const original = button.textContent; button.disabled = true; button.textContent = '正在生成…';
              try {
                const dataUrl = await window.htmlToImage.toJpeg(card, { quality: 0.94, backgroundColor: '#fffdf8', pixelRatio: 2, skipFonts: true });
                const link = document.createElement('a');
                link.href = dataUrl; link.download = `方片新媒体-${referrerName}-内推海报.jpg`; link.click();
                notifyUser('海报图片已保存', 'success');
              } catch (error) {
                console.error(error); notifyUser('海报图片生成失败，请重试', 'error');
              } finally {
                button.disabled = false; button.textContent = original;
              }
            });
          } catch (error) {
            if (!isTalentDialogCurrent(pickerToken)) return;
            message.textContent = `${conciseError(error)}。岗位选择已保留，可以重试。`;
            generateButton.disabled = false;
            generateButton.textContent = `重试生成（${selectedPositions.length}）`;
            checkboxes.forEach((checkbox) => { checkbox.disabled = !checkbox.checked && selectedPositions.length >= 5; });
          }
        });
      };

      renderPosterSelection(new Set(allPositions.slice(0, 5).map((position) => position.id)));
    } catch (error) {
      dialogFailure('海报生成失败', error, openReferralPoster, token);
    }
  }

  async function loadOverviewPage() {
    return window.mountOverviewPage?.({
      request,
      escapeHtml,
      notifyUser,
      showTalentDialog,
      initialPeriod: state.overviewPeriod,
      initialMonth: state.overviewSelectedMonth,
      initialArrivalSort: state.overviewArrivalSort,
      onStateChange: (next) => {
        state.overviewPeriod = next.period;
        state.overviewSelectedMonth = next.selectedMonth;
        state.overviewArrivalSort = next.arrivalSort;
      },
    });
  }

  async function refreshJobsPage(month = '') {
    const monthInput = document.getElementById('job-month-filter');
    if (month && monthInput) monthInput.value = month;
    if (!document.getElementById('page-jobs')?.classList.contains('active')) {
      window.setPage?.('jobs');
      return;
    }
    await loadJobsPage();
  }

  async function loadJobsPage() {
    const wrap = document.getElementById('jobs-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="rf-dialog-loading">正在读取公司岗位库…</div>';
    try {
      const [data, demands] = await Promise.all([
        request('api/recruitment?view=positions'),
        request(`api/recruitment/monthly-demands${document.getElementById('job-month-filter')?.value ? `?month=${encodeURIComponent(document.getElementById('job-month-filter').value)}` : ''}`),
      ]);
      state.jobs = data.positions || [];
      state.positionOptions = state.jobs;
      state.monthlyDemands = demands.demands || [];
      const validIds = new Set(state.jobs.map((item) => item.id));
      state.jobSelectedIds = new Set([...state.jobSelectedIds].filter((id) => validIds.has(id)));
      state.jobCatalogLoaded = true;
      renderJobsTable();
    } catch (error) {
      state.jobs = [];
      wrap.innerHTML = `<div class="rf-dialog-empty"><strong>岗位库暂不可用</strong><p>${escapeHtml(conciseError(error))}</p></div>`;
    }
  }

  function scheduleMonthRange(month) {
    return window.companyCalendar?.monthRange(month) || null;
  }

  function formatScheduleTimeRange(startAt, endAt) {
    const start = shanghaiDateTimeParts(startAt);
    const end = shanghaiDateTimeParts(endAt);
    if (!start.value || !end.value) return '-';
    const sameDay = start.date === end.date;
    return sameDay
      ? `${start.shortDate.replace('-', '月')}日 ${start.time}–${end.time}`
      : `${start.shortDate.replace('-', '月')}日 ${start.time}–${end.shortDate.replace('-', '月')}日 ${end.time}`;
  }

  function currentMonthValue() {
    return window.companyCalendar?.monthForDate(new Date()) || localDateValue(new Date()).slice(0, 7);
  }

  function renderInterviewMonthLabel() {
    const input = document.getElementById('interview-month-filter');
    const label = input?.closest('.schedule-month-field')?.querySelector('[data-interview-month-picker]');
    if (!input || !label) return;
    const [year, month] = String(input.value || currentMonthValue()).split('-').map(Number);
    if (year && month) label.textContent = `${year}年${month}月`;
  }

  function setInterviewMonth(value) {
    const input = document.getElementById('interview-month-filter');
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function renderInterviewMonthPanel(year) {
    const panel = document.getElementById('interview-month-panel');
    const input = document.getElementById('interview-month-filter');
    if (!panel || !input) return;
    const selected = String(input.value || currentMonthValue());
    const selectedYear = Number(selected.slice(0, 4));
    const selectedMonth = Number(selected.slice(5, 7));
    panel.innerHTML = `<header><button type="button" data-interview-picker-year="-1" aria-label="上一年">‹</button><strong>${year}年</strong><button type="button" data-interview-picker-year="1" aria-label="下一年">›</button></header><div class="months">${Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const selectedClass = year === selectedYear && month === selectedMonth ? ' is-selected' : '';
      return `<button type="button" data-interview-picker-month="${year}-${String(month).padStart(2, '0')}" class="${selectedClass.trim()}">${month}月</button>`;
    }).join('')}</div>`;
    panel.querySelectorAll('[data-interview-picker-year]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      renderInterviewMonthPanel(year + Number(button.dataset.interviewPickerYear));
    }));
    panel.querySelectorAll('[data-interview-picker-month]').forEach((button) => button.addEventListener('click', () => {
      setInterviewMonth(button.dataset.interviewPickerMonth);
      closeInterviewMonthPanel();
    }));
  }

  function closeInterviewMonthPanel() {
    const panel = document.getElementById('interview-month-panel');
    const trigger = document.querySelector('[data-interview-month-picker]');
    if (panel) panel.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function renderInterviewSchedule(data) {
    const root = document.getElementById('interview-schedule-root');
    if (!root) return;
    const scopeDescription = document.querySelector('#page-interviews .page-head p');
    if (scopeDescription && data.visibility) scopeDescription.textContent = data.visibility === 'mine'
      ? '仅展示你参与或组织的面试，日程与统计均按本人范围计算。'
      : '管理员视图：查看全部面试安排、面试官、方式和当前状态。';
    const monthInput = document.getElementById('interview-month-filter');
    const [year, month] = String(monthInput?.value || currentMonthValue()).split('-').map(Number);
    const range = scheduleMonthRange(monthInput?.value || currentMonthValue());
    const items = data.appointments || [];
    const total = Number(data.total ?? items.length);
    const eventsByDate = new Map();
    items.forEach((item) => {
      const dateKey = shanghaiDateTimeParts(item.startAt).date;
      if (!dateKey) return;
      if (!eventsByDate.has(dateKey)) eventsByDate.set(dateKey, []);
      eventsByDate.get(dateKey).push(item);
    });
    const [startYear, startMonth, startDay] = range.startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = range.endDate.split('-').map(Number);
    const firstDay = new Date(Date.UTC(startYear, startMonth - 1, startDay));
    const daysInMonth = (Date.UTC(endYear, endMonth - 1, endDay) - firstDay.getTime()) / 86_400_000 + 1;
    const leadingCells = firstDay.getUTCDay();
    const trailingCells = (7 - ((leadingCells + daysInMonth) % 7)) % 7;
    const todayKey = shanghaiDateTimeParts(new Date()).date;
    const selectedId = items.some((item) => item.id === state.selectedInterviewId) ? state.selectedInterviewId : '';
    state.selectedInterviewId = selectedId;
    const interviewVisualState = (item) => {
      const status = item.status || item.confirmationStatus || '';
      const evaluated = interviewEvaluationState(item).evaluated;
      if (status === '已取消' || item.confirmationStatus === '已取消') return { key: 'cancelled', label: '已取消', evaluated: false };
      if (evaluated) return { key: 'evaluated', label: '已评价', evaluated: true };
      const started = Date.parse(item.startAt) <= Date.now();
      return started
        ? { key: 'pending-evaluation', label: '待评价', evaluated: false }
        : { key: 'upcoming', label: '待面试', evaluated: false };
    };
    const eventHtml = (item) => {
      const visual = interviewVisualState(item);
      const eventClass = ` is-${visual.key}${item.id === selectedId ? ' is-selected' : ''}`;
      const time = shanghaiDateTimeParts(item.startAt).time;
      const candidateName = item.candidateName || '候选人';
      const interviewers = (item.interviewers || []).map((interviewer) => interviewer.name || interviewer).filter(Boolean).join('、') || '面试官待分配';
      const place = item.room?.name || item.location || '地点待确认';
      const summary = [candidateName, item.round || '', item.mode || '', interviewers, place, visual.label].filter(Boolean).join(' · ');
      const mark = visual.evaluated ? '<i class="evaluation-check" aria-hidden="true">✓</i>' : '';
      return `<button class="calendar-event${eventClass}" type="button" data-interview-schedule-id="${escapeHtml(item.id)}" aria-pressed="${item.id === selectedId ? 'true' : 'false'}" title="${escapeHtml(summary)}"><span>${mark}${escapeHtml(time)} ${escapeHtml(candidateName)}</span><small>${escapeHtml(item.round || '面试')} · ${escapeHtml(interviewers)}</small><small>${escapeHtml(place)}</small><small>${escapeHtml(visual.label)}</small></button>`;
    };
    let cells = '';
    for (let index = 0; index < leadingCells; index += 1) cells += '<div class="empty"></div>';
    for (let offset = 0; offset < daysInMonth; offset += 1) {
      const date = new Date(Date.UTC(startYear, startMonth - 1, startDay + offset));
      const dateKey = date.toISOString().slice(0, 10);
      const events = eventsByDate.get(dateKey) || [];
      cells += `<div class="${dateKey === todayKey ? 'today-cell' : ''}"><span class="calendar-date ${dateKey === todayKey ? 'today' : ''}">${date.getUTCDate()}</span>${events.map(eventHtml).join('')}</div>`;
    }
    for (let index = 0; index < trailingCells; index += 1) cells += '<div class="empty"></div>';
    const agendaHtml = [...eventsByDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([dateKey, dayItems]) => {
      const date = new Date(`${dateKey}T00:00:00+08:00`);
      const dateLabel = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short' }).format(date);
      return `<section class="interview-agenda-day"><header><strong>${escapeHtml(dateLabel)}</strong><span>${dayItems.length} 场</span></header><div>${dayItems.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)).map((item) => {
        const visual = interviewVisualState(item);
        const statusClass = ` is-${visual.key}${item.id === selectedId ? ' is-selected' : ''}`;
        const time = shanghaiDateTimeParts(item.startAt).time;
        const interviewers = (item.interviewers || []).map((interviewer) => interviewer.name || interviewer).filter(Boolean).join('、') || '面试官待分配';
        const mark = visual.evaluated ? '<i class="evaluation-check" aria-hidden="true">✓</i>' : '';
        return `<button class="interview-agenda-item${statusClass}" type="button" data-interview-agenda-id="${escapeHtml(item.id)}" aria-pressed="${item.id === selectedId ? 'true' : 'false'}"><time>${escapeHtml(time)}<small>${escapeHtml(shanghaiDateTimeParts(item.endAt).time || '')}</small></time><span><strong>${mark}${escapeHtml(item.candidateName || '候选人')} · ${escapeHtml(item.round || '面试')}</strong><small>${escapeHtml(item.role || '岗位待确认')}</small><small>${escapeHtml(item.mode || '方式待确认')} · ${escapeHtml(interviewers)}</small><small class="interview-agenda-location">${escapeHtml(item.room?.name || item.location || '地点待确认')}</small></span><em>${escapeHtml(visual.label)}</em></button>`;
      }).join('')}</div></section>`;
    }).join('');
    root.innerHTML = `
      <div class="interview-mobile-summary" aria-label="本月面试概况"><div><small>本月安排</small><strong>${Number(total)}<span>场</span></strong></div><div><small>待同步</small><strong>${items.filter(item => !['已取消', '已完成'].includes(item.status) && item.syncStatus === '同步失败').length}<span>场</span></strong></div><div><small>已完成</small><strong>${items.filter(item => item.status === '已完成').length}<span>场</span></strong></div></div>
      <div class="schedule-calendar-head"><strong>${year}年${month}月 · ${range.label}</strong><span>共 ${Number(total)} 场面试</span></div>
      <div class="calendar-shell"><div class="monthly-calendar">
        <div class="weekdays">${['周日','周一','周二','周三','周四','周五','周六'].map((day) => `<div>${day}</div>`).join('')}</div>
        <div class="calendar-days">${cells}</div>
      </div></div>
      <div class="interview-mobile-agenda">${agendaHtml || '<div class="rf-dialog-empty"><strong>本月暂无面试</strong><p>切换月份可查看其他日程。</p></div>'}</div>`;
    root.querySelectorAll('[data-interview-schedule-id], [data-interview-agenda-id]').forEach((button) => button.addEventListener('click', () => {
      const appointmentId = button.dataset.interviewScheduleId || button.dataset.interviewAgendaId;
      const appointment = items.find((item) => item.id === appointmentId);
      if (appointment) selectInterviewForEvaluation(appointment);
    }));
    if (selectedId) {
      const selected = items.find((item) => item.id === selectedId);
      if (selected) renderInterviewEvaluationPanel(selected);
    } else {
      clearInterviewEvaluationPanel();
    }
  }

  function clearInterviewEvaluationPanel() {
    const panel = document.getElementById('interview-evaluation-panel');
    const status = document.getElementById('interview-evaluation-status');
    const body = document.getElementById('interview-evaluation-body');
    if (panel) panel.hidden = true;
    if (status) status.innerHTML = '';
    if (body) body.innerHTML = '';
  }

  function interviewEvaluationState(appointment, history = []) {
    const submitted = (history || []).filter((record) => record.submittedAt || record.recommendation || record.interviewerEvaluation || record.finalDecision);
    const status = appointment.evaluationStatus || '';
    const evaluated = ['已完成', '部分已提交'].includes(status) || submitted.length > 0;
    return {
      evaluated,
      label: evaluated ? '已评价' : '未评价',
      detail: evaluated
        ? (status === '部分已提交' ? `已收到 ${submitted.length || 1} 份评价，仍有面试官未提交` : `已收到 ${submitted.length || 1} 份评价`)
        : '本场面试还没有提交评价',
    };
  }

  function selectInterviewForEvaluation(appointment) {
    state.selectedInterviewId = appointment.id;
    document.querySelectorAll('#interview-schedule-root [data-interview-schedule-id], #interview-schedule-root [data-interview-agenda-id]').forEach((button) => {
      const selected = (button.dataset.interviewScheduleId || button.dataset.interviewAgendaId) === appointment.id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    renderInterviewEvaluationPanel(appointment);
    document.getElementById('interview-evaluation-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function renderInterviewEvaluationPanel(appointment) {
    const panel = document.getElementById('interview-evaluation-panel');
    const statusNode = document.getElementById('interview-evaluation-status');
    const body = document.getElementById('interview-evaluation-body');
    if (!panel || !statusNode || !body) return;
    const requestId = appointment.id;
    state.selectedInterviewId = requestId;
    panel.hidden = false;
    const preliminary = interviewEvaluationState(appointment);
    statusNode.innerHTML = `<span class="${preliminary.evaluated ? 'is-done' : 'is-pending'}">${escapeHtml(preliminary.label)}</span><small>正在读取评价记录…</small>`;
    body.innerHTML = '<div class="rf-dialog-loading">正在读取本场面试评价…</div>';
    let history = [];
    let historyError = '';
    try {
      const result = await request(`api/interview-evaluations/interviews/${encodeURIComponent(requestId)}/feedback`);
      history = (result.history || result.feedback || []).filter((record) => !record.interviewId || record.interviewId === requestId);
    } catch (error) {
      historyError = conciseError(error);
    }
    if (state.selectedInterviewId !== requestId || !body.isConnected) return;
    const evaluation = interviewEvaluationState(appointment, history);
    const interviewers = (appointment.interviewers || []).map((item) => item.name || item).filter(Boolean).join('、') || '面试官待分配';
    const currentInterviewer = window.recruitmentCurrentUser || {};
    statusNode.innerHTML = `<span class="${evaluation.evaluated ? 'is-done' : 'is-pending'}">${escapeHtml(evaluation.label)}</span><small>${escapeHtml(evaluation.detail)}</small>`;
    body.innerHTML = `
      <header>
        <div><span>INTERVIEW EVALUATION</span><h2>${escapeHtml(appointment.candidateName || '候选人')} · ${escapeHtml(appointment.round || '面试')}</h2><p>${escapeHtml(formatScheduleTimeRange(appointment.startAt, appointment.endAt))} · ${escapeHtml(appointment.role || '岗位待确认')} · ${escapeHtml(interviewers)}</p></div>
        <button class="btn-soft" type="button" data-interview-evaluation-detail>查看日程</button>
      </header>
      <div class="interview-evaluation-layout">
        <form class="interview-evaluation-form" data-interview-evaluation-form>
          <label><span>面试结论 <b>*</b></span><select name="recommendation" required><option value="">请选择面试结论</option>${['通过', '加面', '储备', '待讨论', '淘汰'].map((item) => `<option>${item}</option>`).join('')}</select></label>
          <label><span>候选人评级 <b>*</b></span><select name="candidateRating" required><option value="">请选择评级</option>${['S', 'a', 'b', 'c', 'z'].map((item) => `<option value="${item}">${item}</option>`).join('')}</select></label>
          <label class="wide"><span>会议总结</span><textarea name="notes" rows="4" maxlength="20000" placeholder="粘贴会议总结后，可生成 AI 面试总结"></textarea><button class="btn-soft" type="button" data-interview-evaluation-extract>会议总结转评价</button><small data-interview-evaluation-extract-status>AI 只整理会议事实，不会覆盖面试官评价。</small></label>
          <label class="wide"><span>AI面试总结 <b>*</b></span><textarea name="aiSummary" rows="4" required placeholder="先生成并核对 AI 面试总结"></textarea></label>
          <label class="wide"><span>面试官评价 <b>*</b></span><textarea name="interviewerEvaluation" rows="6" required placeholder="至少填写50字，结合实际回答、岗位匹配度、优势和风险给出独立评价"></textarea><small data-interview-evaluation-count></small></label>
          <div class="interview-evaluation-actions"><button class="btn-primary" type="submit">提交面试评价</button><p data-interview-evaluation-message></p></div>
        </form>
        <aside><div class="interview-evaluation-history-head"><strong>本场评价记录</strong><span>${history.length} 条</span></div><div class="interview-evaluation-history">${historyError ? `<p class="is-error">${escapeHtml(historyError)}</p>` : history.length ? history.map((record) => `<article><strong>${escapeHtml(record.finalDecision || record.recommendation || '已提交')} · ${escapeHtml(record.candidateRating || '未评级')}</strong><p>${escapeHtml(record.interviewerEvaluation || record.aiSummary || '暂无评价内容')}</p><small>${escapeHtml(record.interviewer || '未记录面试官')} · ${escapeHtml(formatShanghaiDateTime(record.submittedAt) || '')}</small></article>`).join('') : '<p>暂无评价记录。</p>'}</div></aside>
      </div>`;
    body.querySelector('[data-interview-evaluation-detail]')?.addEventListener('click', () => openInterviewScheduleDetail(appointment));
    const form = body.querySelector('[data-interview-evaluation-form]');
    bindInterviewEvaluationCounter(form?.interviewerEvaluation, form?.querySelector('[data-interview-evaluation-count]'));
    form?.querySelector('[data-interview-evaluation-extract]')?.addEventListener('click', () => extractScheduleInterviewFeedback(requestId, form));
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      submitScheduleInterviewFeedback(requestId, form, currentInterviewer);
    });
  }

  async function extractScheduleInterviewFeedback(interviewId, form) {
    const status = form.querySelector('[data-interview-evaluation-extract-status]');
    const button = form.querySelector('[data-interview-evaluation-extract]');
    const notes = form.notes?.value.trim() || '';
    if (!notes) {
      if (status) status.textContent = '请先粘贴会议总结。';
      return;
    }
    if (button) button.disabled = true;
    if (status) status.textContent = 'AI 正在整理面试总结…';
    try {
      const result = await requestCommunicationExtraction(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/feedback-extract`, notes, status);
      if (!form.isConnected) return;
      const extraction = result.extraction || {};
      if (form.recommendation && extraction.recommendation) form.recommendation.value = extraction.recommendation;
      if (!String(extraction.comment || '').trim()) throw new Error('AI 未生成面试总结，请补充会议记录后重试。');
      form.aiSummary.value = extraction.comment;
      form.notes.dataset.convertedNotes = notes;
      if (status) status.textContent = '已生成 AI 面试总结，请核对后再提交。';
    } catch (error) {
      if (status) status.textContent = conciseError(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function submitScheduleInterviewFeedback(interviewId, form, interviewer) {
    const message = form.querySelector('[data-interview-evaluation-message]');
    const button = form.querySelector('button[type="submit"]');
    const interviewerEvaluation = form.interviewerEvaluation?.value.trim() || '';
    const notes = form.notes?.value.trim() || '';
    const payload = {
      interviewerUserId: interviewer.id || '',
      interviewer: interviewer.name || '',
      candidateRating: form.candidateRating?.value || '',
      scores: {},
      recommendation: form.recommendation?.value || '',
      otherRoles: '', strengths: '', risks: '',
      aiSummary: form.aiSummary?.value.trim() || '',
      interviewerEvaluation,
      comment: interviewerEvaluation,
      notes,
      questionAnswers: {},
      evidence: { source: '日程面试评价' },
      operator: interviewer.name || '当前用户',
    };
    const evaluationLength = countInterviewEvaluationCharacters(interviewerEvaluation);
    const summaryReady = Boolean(notes && form.notes?.dataset.convertedNotes === notes && payload.aiSummary);
    if (!payload.interviewerUserId || !payload.interviewer) {
      if (message) message.textContent = '无法识别当前面试官身份，请重新登录后再提交。';
      return;
    }
    if (!payload.recommendation || !payload.candidateRating || !summaryReady || evaluationLength < 50) {
      if (message) message.textContent = !summaryReady ? '请先用会议总结生成并核对 AI 面试总结。' : evaluationLength < 50 ? `面试官评价至少 50 字，当前 ${evaluationLength} 字。` : '请完整填写面试结论和候选人评级。';
      return;
    }
    try {
      if (button) button.disabled = true;
      if (message) message.textContent = '正在提交评价…';
      await request(`api/interview-evaluations/interviews/${encodeURIComponent(interviewId)}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const appointments = state.interviewData?.appointments || [];
      const current = appointments.find((item) => item.id === interviewId);
      if (current) current.evaluationStatus = '已完成';
      notifyUser('面试评价已提交。', 'success');
      await renderInterviewEvaluationPanel(current || { id: interviewId, evaluationStatus: '已完成' });
    } catch (error) {
      if (message) message.textContent = conciseError(error);
      if (button) button.disabled = false;
    }
  }

  function openInterviewScheduleDetail(appointment) {
    const status = appointment.status || appointment.confirmationStatus || '待确认';
    const cancellable = !['已取消', '已完成'].includes(status);
    const interviewers = (appointment.interviewers || []).map((item) => item.name || item).filter(Boolean).join('、') || '待分配';
    const room = appointment.room?.name || appointment.location || (appointment.mode === '线上面试' ? '线上面试' : '地点待确认');
    const meetingLink = /^https?:\/\//i.test(String(appointment.meetingUrl || ''))
      ? `<a href="${escapeHtml(appointment.meetingUrl)}" target="_blank" rel="noopener">打开会议链接 ↗</a>`
      : '';
    showTalentDialog(`<header class="rf-dialog-head rf-schedule-detail-head"><div><span>INTERVIEW SCHEDULE</span><h2>${escapeHtml(appointment.candidateName || '候选人')} · ${escapeHtml(appointment.round || '面试')}</h2><p>${escapeHtml(formatScheduleTimeRange(appointment.startAt, appointment.endAt))} · ${escapeHtml(status)}</p></div><b class="rf-schedule-status ${status === '已取消' ? 'cancelled' : status === '已完成' ? 'done' : ''}">${escapeHtml(status)}</b></header><section class="rf-schedule-detail-grid"><article><span>面试方式</span><strong>${escapeHtml(appointment.mode || '待确认')}</strong></article><article><span>面试官</span><strong>${escapeHtml(interviewers)}</strong></article><article><span>地点 / 会议室</span><strong>${escapeHtml(room)}</strong>${meetingLink}</article><article><span>候选人确认</span><strong>${escapeHtml(appointment.confirmationStatus || '待确认')}</strong></article></section>${appointment.note ? `<section class="rf-schedule-detail-note"><span>备注</span><p>${escapeHtml(appointment.note)}</p></section>` : ''}${appointment.syncStatus === '同步失败' ? `<p class="rf-dialog-message error" role="alert">${escapeHtml(appointment.syncError || '企微日程同步失败')}</p><button class="btn-primary" type="button" data-interview-recover="retry-sync">重试${status === '已取消' ? '取消会议' : '日程同步'}</button>` : ''}${appointment.syncStatus === '已同步' && ['待确认', '待重新确认'].includes(appointment.confirmationStatus) && status !== '已取消' ? '<button class="btn-soft" type="button" data-interview-recover="retry-invitation">重新发送邀请邮件</button>' : ''}<p id="rf-interview-recovery-message" role="status"></p><div class="rf-dialog-actions"><button class="btn-soft" type="button" data-interview-schedule-close>返回日程</button>${cancellable ? `<button class="danger" type="button" data-interview-schedule-cancel="${escapeHtml(appointment.id)}">取消面试</button>` : ''}</div>`, 'wide', false);
    document.querySelectorAll('[data-interview-recover]').forEach((button) => button.addEventListener('click', async () => {
      const message = document.getElementById('rf-interview-recovery-message');
      button.disabled = true;
      message.textContent = '正在处理，请勿重复操作…';
      try {
        const result = await request(`api/interviews/appointments/${encodeURIComponent(appointment.id)}/${button.dataset.interviewRecover}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operator: 'HR手动恢复' }) });
        if (!['已同步', '已发送', '无需发送'].includes(result.status)) throw new Error(result.message || '处理未完成，请稍后重试');
        notifyUser(button.dataset.interviewRecover === 'retry-invitation' ? '邀请邮件已处理' : '企微日程同步成功', 'success');
        const latest = await request(`api/interviews/appointments?candidateId=${encodeURIComponent(appointment.candidateId || '')}`);
        openInterviewScheduleDetail(latest.appointments?.find((item) => item.id === appointment.id) || appointment);
      } catch (error) { message.textContent = conciseError(error); button.disabled = false; }
    }));
    document.querySelector('[data-interview-schedule-close]')?.addEventListener('click', () => closeTalentDialog());
    document.querySelector('[data-interview-schedule-cancel]')?.addEventListener('click', () => openInterviewScheduleCancellation(appointment));
  }

  function openInterviewScheduleCancellation(appointment) {
    showTalentDialog(`<header class="rf-dialog-head rf-cancel-interview-head"><div><span>CANCEL INTERVIEW</span><h2>取消${escapeHtml(appointment.candidateName || '候选人')}的面试</h2><p>${escapeHtml(formatScheduleTimeRange(appointment.startAt, appointment.endAt))} · 取消后将释放面试官和会议室排期。</p></div></header><div class="rf-dialog-form rf-cancel-interview-form"><label class="wide"><span>取消原因 <b>*</b></span><textarea id="rf-schedule-cancel-reason" required autofocus placeholder="例如：候选人主动取消、岗位需求调整、需要重新排期"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-soft" type="button" data-interview-schedule-cancel-back>暂不取消</button><button class="danger" type="button" data-interview-schedule-cancel-confirm>确认取消面试</button></div><p class="rf-dialog-message" id="rf-schedule-cancel-message"></p>`, 'wide', false);
    document.querySelector('[data-interview-schedule-cancel-back]')?.addEventListener('click', () => openInterviewScheduleDetail(appointment));
    document.querySelector('[data-interview-schedule-cancel-confirm]')?.addEventListener('click', () => submitInterviewScheduleCancellation(appointment.id));
  }

  async function submitInterviewScheduleCancellation(interviewId) {
    const reason = document.getElementById('rf-schedule-cancel-reason')?.value.trim() || '';
    const message = document.getElementById('rf-schedule-cancel-message');
    const button = document.querySelector('[data-interview-schedule-cancel-confirm]');
    if (!reason) {
      if (message) { message.textContent = '请填写取消原因后再提交。'; message.classList.add('error'); }
      document.getElementById('rf-schedule-cancel-reason')?.focus();
      return;
    }
    try {
      if (message) { message.textContent = '正在取消本系统排期，并同步处理企微日程…'; message.classList.remove('error'); }
      if (button) button.disabled = true;
      const result = await request(`api/interviews/appointments/${encodeURIComponent(interviewId)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, operator: window.recruitmentCurrentUser?.name || '当前用户' }) });
      closeTalentDialog();
      await loadInterviewSchedulePage();
      if (result.sync?.status === '同步失败') notifyUser(`面试已在本系统取消，但企微日程未同步：${result.sync.message || '请稍后重试同步。'}`, 'error');
      else notifyUser('面试已取消，日历排期已更新。', 'success');
    } catch (error) {
      if (message) { message.textContent = conciseError(error); message.classList.add('error'); }
      if (button) button.disabled = false;
    }
  }

  async function loadInterviewSchedulePage() {
    const monthInput = document.getElementById('interview-month-filter');
    const root = document.getElementById('interview-schedule-root');
    if (!monthInput || !root) return;
    if (!monthInput.value) monthInput.value = currentMonthValue();
    const range = scheduleMonthRange(monthInput.value);
    if (!range) {
      root.innerHTML = '<div class="rf-dialog-empty"><strong>月份无效</strong><p>请选择有效的年月后再查看排期。</p></div>';
      return;
    }
    monthInput.title = `${monthInput.value} 公司月份：${range.startDate} 至 ${range.endDate}`;
    root.innerHTML = '<div class="rf-dialog-loading">正在读取日程排期…</div>';
    try {
      const params = new URLSearchParams({ from: range.start, to: range.end });
      const data = await request(`api/interviews/appointments?${params.toString()}`);
      renderInterviewSchedule(data);
    } catch (error) {
      root.innerHTML = `<div class="rf-dialog-empty"><strong>日程排期暂不可用</strong><p>${escapeHtml(conciseError(error))}</p></div>`;
    }
  }

  function renderJobsTable() {
    const wrap = document.getElementById('jobs-table-wrap');
    if (!wrap) return;
    const summary = document.getElementById('jobs-summary');
    const resultCount = document.getElementById('jobs-result-count');
    const keyword = (document.getElementById('job-keyword-filter')?.value || '').trim().toLowerCase();
    const selectedMonth = document.getElementById('job-month-filter')?.value || '';
    const demandMap = new Map((state.monthlyDemands || []).filter((item) => !selectedMonth || item.month === selectedMonth).map((item) => [item.positionId, item]));
    const activeDemandFor = (item) => {
      const demand = demandMap.get(item.id);
      return demand && Number(demand.headcount || 0) > 0 && !['已停用', '审批驳回'].includes(demand.status) && demand.approvalStatus !== '已驳回' ? demand : null;
    };
    const demandPriority = (item) => {
      const demand = activeDemandFor(item);
      if (!demand) return 4;
      return ({ 紧急: 0, 高: 0, 重要: 1, 中: 1, 储备: 2, 一般: 2, 低: 2 }[demand.priority] ?? 3);
    };
    const statusPriority = (item) => item.status === '招聘中' ? 0 : item.status === '待发布' ? 1 : 2;
    const rows = (state.jobs || []).slice().sort((left, right) => demandPriority(left) - demandPriority(right) || statusPriority(left) - statusPriority(right) || (left.department || '').localeCompare(right.department || '', 'zh-CN') || (left.name || '').localeCompare(right.name || '', 'zh-CN')).filter((item) => {
      if (!keyword) return true;
      const demand = demandMap.get(item.id);
      const haystack = [item.name, item.code, item.department, item.owner, item.recruiter, item.backupRecruiter, item.responsibilities, item.requirements, (item.tags || []).join(' '), demand?.positionName].join('|').toLowerCase();
      return haystack.includes(keyword);
    });
    const totalPositions = (state.jobs || []).length;
    const recruitingPositions = (state.jobs || []).filter((item) => item.status === '招聘中').length;
    const pendingApprovals = (state.jobs || []).filter((item) => (item.approvalStatus || '待审批') === '待审批').length;
    const demandHeadcount = Array.from(demandMap.values()).reduce((total, item) => total + Number(item.headcount || 0), 0);
    const selectedRange = selectedMonth ? window.companyCalendar?.monthRange(selectedMonth) : null;
    const monthLabel = selectedMonth ? `${selectedMonth.slice(0, 4)}年${Number(selectedMonth.slice(5, 7))}月${selectedRange ? `（${selectedRange.label}）` : ''}` : '当前月份';
    if (summary) summary.innerHTML = `
      <article><span class="rf-job-summary-mark total" aria-hidden="true">岗</span><div><small>岗位总数</small><strong>${totalPositions}</strong><em>公司岗位库</em></div></article>
      <article><span class="rf-job-summary-mark active" aria-hidden="true">招</span><div><small>招聘中</small><strong>${recruitingPositions}</strong><em>正在接收候选人</em></div></article>
      <article><span class="rf-job-summary-mark pending" aria-hidden="true">审</span><div><small>待审批</small><strong>${pendingApprovals}</strong><em>等待审批人处理</em></div></article>
      <article><span class="rf-job-summary-mark demand" aria-hidden="true">需</span><div><small>${escapeHtml(monthLabel)}需求</small><strong>${demandHeadcount}</strong><em>计划招聘人数</em></div></article>`;
    if (resultCount) resultCount.textContent = keyword ? `找到 ${rows.length} 个岗位` : `共 ${rows.length} 个岗位 · 按紧急、重要、储备排序`;
    if (!rows.length) {
      wrap.innerHTML = `<div class="rf-dialog-empty"><strong>暂无岗位</strong><p>${keyword ? '没有匹配的岗位，换个关键词试试。' : '点击右上角“新增岗位”建立公司岗位库。'}</p></div>`;
      return;
    }
    const selectedCount = state.jobSelectedIds.size;
    const allCurrentSelected = rows.length > 0 && rows.every((item) => state.jobSelectedIds.has(item.id));
    wrap.innerHTML = `<div class="rf-job-batch-bar">
      <label class="rf-job-select-all"><input type="checkbox" data-rf-job-select-all ${allCurrentSelected ? 'checked' : ''}><span>全选当前列表</span></label>
      <div><strong>已选 ${selectedCount} 个岗位</strong><button class="btn-soft" data-rf-job-batch="publish" type="button" ${selectedCount ? '' : 'disabled'}>批量开放</button><button class="btn-soft danger" data-rf-job-batch="offline" type="button" ${selectedCount ? '' : 'disabled'}>批量暂停</button><button class="text-btn" data-rf-job-selection-clear type="button" ${selectedCount ? '' : 'disabled'}>清空选择</button></div>
    </div><div class="rf-job-card-grid">
      ${rows.map((item) => {
        const demand = activeDemandFor(item);
        const approvalStatus = item.approvalStatus || '待审批';
        const demandStatus = demand?.approvalStatus || demand?.status || '';
        const isRecruiting = item.status === '招聘中';
        const isSelected = state.jobSelectedIds.has(item.id);
        const priority = ({ 高: '紧急', 中: '重要', 低: '储备', 一般: '储备' }[demand?.priority] || demand?.priority || '');
        const priorityClass = priority === '紧急' ? 'priority-urgent' : priority === '重要' ? 'priority-important' : priority === '储备' ? 'priority-normal' : 'priority-none';
        const approvalClass = approvalStatus === '已通过' ? 'approved' : approvalStatus === '已驳回' ? 'rejected' : 'pending';
        const publishButton = isRecruiting
          ? `<button type="button" class="danger" data-rf-job-offline="${escapeHtml(item.id)}">暂停招聘</button>`
          : `<button type="button" disabled>${item.status === '已下线' ? '已暂停招聘' : demand?.approvalStatus === '已驳回' ? '需求审批未通过' : '等待需求审批'}</button>`;
        return `<article class="rf-job-card ${priorityClass} ${isRecruiting ? 'is-recruiting' : ''} ${isSelected ? 'is-selected' : ''}" data-rf-job-card="${escapeHtml(item.id)}">
          <header>
            <div class="rf-job-card-eyebrow"><label class="rf-job-select"><input type="checkbox" data-rf-job-select="${escapeHtml(item.id)}" ${isSelected ? 'checked' : ''}><span>选择</span></label><span>${escapeHtml(item.department || '未分配部门')}</span>${item.category ? `<i>${escapeHtml(item.category)}</i>` : ''}</div>
            <div class="rf-job-card-status"><span class="${approvalClass}">${escapeHtml(approvalStatus)}</span><span class="${isRecruiting ? 'active' : 'inactive'}">${escapeHtml(item.status || '待发布')}</span></div>
            <h2>${escapeHtml(item.name || '未命名岗位')}</h2>
            <p>${escapeHtml(item.salaryText || (item.minSalary || item.maxSalary ? `${item.minSalary || 0}-${item.maxSalary || 0}` : '薪资面议'))}</p>
          </header>
          <div class="rf-job-card-body">
            <section class="rf-job-demand ${demand ? '' : 'empty'}">
              <div><span>${escapeHtml(monthLabel)}需求</span>${demand ? `<b>${escapeHtml(({ 一般: '储备', 低: '储备', 高: '紧急', 中: '重要' })[demand.priority] || demand.priority || '储备')} · ${escapeHtml(demandStatus || '已确认')}</b>` : '<b>未配置</b>'}</div>
              ${demand ? `<strong>${Number(demand.headcount || 0)}<small>人</small></strong><em>更新于 ${escapeHtml((demand.updatedAt || '').slice(0, 10) || '最近')}</em>` : '<strong>—</strong><em>可点击下方按钮补充需求</em>'}
              ${demand?.demandRequirement ? `<p class="rf-job-demand-requirement"><b>需求要求</b>${escapeHtml(demand.demandRequirement)}</p>` : ''}
            </section>
            <section class="rf-job-owners">
              <div><span>业务负责人</span><strong>${escapeHtml(item.owner || '待补充')}</strong></div>
              <div><span>招聘HR</span><strong class="${item.recruiter ? '' : 'missing'}">${escapeHtml(item.recruiter || '待绑定')}</strong>${item.backupRecruiter ? `<small>备用：${escapeHtml(item.backupRecruiter)}</small>` : ''}</div>
            </section>
          </div>
          <footer class="rf-job-row-actions">
            <button type="button" data-rf-demand-edit="${escapeHtml(item.id)}">编辑需求</button>
            <button type="button" data-rf-job-edit="${escapeHtml(item.id)}">编辑岗位</button>
            ${publishButton}
          </footer>
        </article>`;
      }).join('')}
    </div>`;
    document.querySelector('[data-rf-job-select-all]')?.addEventListener('change', (event) => {
      rows.forEach((item) => event.currentTarget.checked ? state.jobSelectedIds.add(item.id) : state.jobSelectedIds.delete(item.id));
      renderJobsTable();
    });
    document.querySelectorAll('[data-rf-job-select]').forEach((checkbox) => checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.jobSelectedIds.add(checkbox.dataset.rfJobSelect);
      else state.jobSelectedIds.delete(checkbox.dataset.rfJobSelect);
      renderJobsTable();
    }));
    document.querySelector('[data-rf-job-selection-clear]')?.addEventListener('click', () => {
      state.jobSelectedIds.clear();
      renderJobsTable();
    });
    document.querySelectorAll('[data-rf-job-batch]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.rfJobBatch === 'offline') openJobBatchPauseDialog();
      else handleJobBatchAction('publish', button);
    }));
    document.querySelectorAll('[data-rf-demand-edit]').forEach((button) => button.addEventListener('click', () => {
      const position = state.jobs.find((item) => item.id === button.dataset.rfDemandEdit);
      if (position) openMonthlyDemandDialog(position);
    }));
    document.querySelectorAll('[data-rf-job-edit]').forEach((button) => button.addEventListener('click', () => {
      const position = state.jobs.find((item) => item.id === button.dataset.rfJobEdit);
      if (position) openJobDialog('edit', position);
    }));
    document.querySelectorAll('[data-rf-job-publish]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      handlePositionAction('publish', button.dataset.rfJobPublish, button);
    }));
    document.querySelectorAll('[data-rf-job-offline]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      handlePositionAction('offline', button.dataset.rfJobOffline, button);
    }));
  }

  async function handleJobBatchAction(action, button, reason = '') {
    const ids = [...state.jobSelectedIds];
    if (!ids.length) return notifyUser('请先选择需要操作的岗位', 'info');
    const operator = window.recruitmentCurrentUser?.name || '当前用户';
    const endpoint = action === 'publish' ? 'api/recruitment/positions/batch-publish' : 'api/recruitment/positions/batch-offline';
    try {
      const result = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, reason, operator }), initiator: button });
      state.jobSelectedIds.clear();
      if (action === 'offline') closeTalentDialog();
      const changed = Number(action === 'publish' ? result.published : result.offline) || 0;
      const skipped = Number(result.skipped || 0);
      const failed = Number(result.failed || 0);
      notifyUser(`${action === 'publish' ? '批量开放' : '批量暂停'}完成：成功 ${changed}，跳过 ${skipped}${failed ? `，失败 ${failed}` : ''}`, failed ? 'error' : 'success');
      await refreshJobsPage();
    } catch (error) {
      const message = document.getElementById('rf-job-batch-message');
      if (message) { message.textContent = conciseError(error); message.classList.add('error'); }
      else notifyUser(conciseError(error), 'error');
    }
  }

  function openJobBatchPauseDialog() {
    const count = state.jobSelectedIds.size;
    if (!count) return notifyUser('请先选择需要暂停的岗位', 'info');
    showTalentDialog(`<header class="rf-dialog-head"><div><span>BATCH POSITION ACTION</span><h2>批量暂停招聘</h2><p>将暂停已选择的 ${count} 个岗位。暂停属于招聘运营操作，不发送审批消息。</p></div></header><div class="rf-dialog-form"><label class="wide"><span>暂停原因</span><textarea id="rf-job-batch-reason" placeholder="例如：本月编制已满，暂时停止招聘"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-soft" data-rf-dialog-cancel type="button">取消</button><button class="btn-primary" data-rf-job-batch-confirm type="button">确认暂停</button></div><p class="rf-dialog-message" id="rf-job-batch-message"></p>`, 'wide');
    document.querySelector('[data-rf-dialog-cancel]')?.addEventListener('click', () => closeTalentDialog());
    document.querySelector('[data-rf-job-batch-confirm]')?.addEventListener('click', (event) => {
      const reason = document.getElementById('rf-job-batch-reason')?.value.trim() || '';
      const message = document.getElementById('rf-job-batch-message');
      if (!reason) { message.textContent = '请填写暂停原因'; message.classList.add('error'); return; }
      handleJobBatchAction('offline', event.currentTarget, reason);
    });
  }

  async function handlePositionAction(action, id, button) {
    const operator = window.recruitmentCurrentUser?.name || '当前用户';
    const actionUrl = action === 'publish'
      ? `api/recruitment/positions/${encodeURIComponent(id)}/publish`
      : `api/recruitment/positions/${encodeURIComponent(id)}/offline`;
    const body = action === 'publish' ? { operator } : { reason: '手动暂停', operator };
    try {
      const result = await request(actionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), initiator: button });
      const position = result.position || (state.jobs || []).find((item) => item.id === id) || {};
      position.status = action === 'publish' ? (position.status || result.position?.status || '招聘中') : (position.status || '已下线');
      const target = (state.jobs || []).find((item) => item.id === id);
      if (target) target.status = action === 'publish' ? '招聘中' : '已下线';
      state.jobSelectedIds.delete(id);
      notifyUser(action === 'publish' ? '岗位已开放，招聘需求已生效' : '岗位已暂停，无需审批', 'success');
      renderJobsTable();
    } catch (error) {
      notifyUser(conciseError(error), 'error', () => handlePositionAction(action, id, button));
    }
  }

  async function openRecruitmentApproval(type, id) {
    showTalentDialog('<div class="rf-dialog-loading">正在读取招聘审批详情…</div>', 'wide');
    try {
      const item = await request(`api/recruitment/approvals/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
      const isPosition = item.type === 'position';
      const details = isPosition
        ? [['岗位', item.title], ['部门', item.department], ['负责人', item.owner], ['招聘人数', `${Number(item.headcount || 0)}人`], ['薪资', item.salaryText || '待补充']]
        : [['需求', item.title], ['部门', item.department], ['负责人', item.owner], ['需求人数', `${Number(item.headcount || 0)}人`], ['需求类型', item.demandType || '新增需求'], ['优先级', ({ 一般: '储备', 低: '储备', 高: '紧急', 中: '重要' })[item.priority] || item.priority || '储备'], ['期望到岗', item.expectedArrivalDate || '待补充'], ['最晚到岗', item.latestArrivalDate || '未填写']];
      const pending = item.approvalStatus === '待审批';
      showTalentDialog(`<header class="rf-dialog-head"><div><span>RECRUITMENT APPROVAL</span><h2>${isPosition ? '新增岗位审批' : '新增招聘需求审批'}</h2><p>该申请只有指定企微审批人同意后，才能生效或发布。</p></div><b>${escapeHtml(item.approvalStatus || '待审批')}</b></header><div class="rf-review-metrics">${details.map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></article>`).join('')}</div><section class="rf-detail-info-card"><h3>申请信息</h3><p><strong>申请人：</strong>${escapeHtml(item.applicant || '当前用户')}</p><p><strong>提交时间：</strong>${escapeHtml(formatShanghaiDateTime(item.submittedAt) || '刚刚')}</p>${!isPosition && item.demandRequirement ? `<p><strong>需求要求：</strong>${escapeHtml(item.demandRequirement)}</p>` : ''}${!isPosition && item.note ? `<p><strong>需求说明：</strong>${escapeHtml(item.note)}</p>` : ''}${isPosition && item.responsibilities ? `<p><strong>工作职责：</strong>${escapeHtml(item.responsibilities)}</p>` : ''}${isPosition && item.requirements ? `<p><strong>任职要求：</strong>${escapeHtml(item.requirements)}</p>` : ''}</section>${pending ? `<div class="rf-dialog-form"><label class="wide"><span>审批意见</span><textarea id="rf-recruitment-approval-opinion" placeholder="通过时可选；驳回时必须说明原因"></textarea></label></div><div class="rf-dialog-actions"><button class="btn-soft danger" data-rf-recruitment-decision="驳回" type="button">驳回</button><button class="btn-primary" data-rf-recruitment-decision="通过" type="button">同意</button></div><p class="rf-dialog-message" id="rf-recruitment-approval-message"></p>` : `<div class="rf-operation-result"><i>${item.approvalStatus === '已通过' ? '✓' : '!'}</i><span>审批已完成</span><h2>${escapeHtml(item.approvalStatus)}</h2><p>${escapeHtml(item.opinion || (item.approvalStatus === '已通过' ? '申请已通过。' : '申请已驳回。'))}</p></div>`}`, 'wide');
      document.querySelectorAll('[data-rf-recruitment-decision]').forEach((button) => button.addEventListener('click', async () => {
        const decision = button.dataset.rfRecruitmentDecision, opinion = document.getElementById('rf-recruitment-approval-opinion')?.value.trim() || '', message = document.getElementById('rf-recruitment-approval-message');
        if (decision === '驳回' && !opinion) { message.textContent = '驳回时请填写审批意见'; message.classList.add('error'); return; }
        try {
          button.disabled = true; message.classList.remove('error'); message.textContent = '正在提交审批…';
          const result = await request(`api/recruitment/approvals/${encodeURIComponent(type)}/${encodeURIComponent(id)}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, opinion }), initiator: button });
          notifyUser(decision === '通过' ? (isPosition ? '岗位审批已通过' : result.positionAutoPublished ? '招聘需求审批已通过，岗位已自动发布' : '招聘需求审批已通过，岗位已处于招聘中') : '申请已驳回', decision === '通过' ? 'success' : 'error');
          await openRecruitmentApproval(type, id);
        } catch (error) { button.disabled = false; message.textContent = conciseError(error); message.classList.add('error'); }
      }));
    } catch (error) {
      showTalentDialog(`<div class="rf-dialog-empty"><strong>无法打开招聘审批</strong><p>${escapeHtml(conciseError(error))}</p></div>`, 'wide');
    }
  }

  async function importDemandTranscriptFile(event) {
    const input = event.currentTarget;
    const status = document.getElementById('rf-demand-transcript-file-status');
    const textarea = document.getElementById('rf-demand-transcript-text');
    const file = input?.files?.[0];
    if (!file || !textarea) return;
    if (file.size > 1024 * 1024) {
      if (status) { status.textContent = '文件超过1MB，请粘贴需要的需求内容。'; status.classList.add('error'); }
      input.value = '';
      return;
    }
    try {
      const content = await file.text();
      if (content.length > 20000) throw new Error('文件内容最多20000字');
      textarea.value = content.trim();
      if (status) { status.textContent = `已导入：${file.name} · ${content.length}字`; status.classList.remove('error'); }
    } catch (error) {
      if (status) { status.textContent = error.message || '文件读取失败'; status.classList.add('error'); }
    }
  }

  function startDemandVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const textarea = document.getElementById('rf-demand-transcript-text');
    const status = document.getElementById('rf-demand-transcript-status');
    const button = document.querySelector('[data-rf-demand-voice]');
    if (!textarea || !status || !button) return;
    if (!SpeechRecognition) {
      status.textContent = '当前浏览器不支持语音输入，请使用手机输入法语音键，或直接粘贴文字。';
      status.classList.add('error');
      return;
    }
    const recognition = new SpeechRecognition();
    const originalText = textarea.value.trim();
    let finalText = '';
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      button.disabled = true;
      button.textContent = '正在听…';
      status.textContent = '请直接描述：哪个月、什么岗位、需要几人、紧急程度和到岗时间。';
      status.classList.remove('error');
    };
    recognition.onresult = (event) => {
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const value = event.results[index][0]?.transcript || '';
        if (event.results[index].isFinal) finalText += value;
        else interimText += value;
      }
      textarea.value = [originalText, finalText, interimText].filter(Boolean).join(originalText ? '\n' : '');
    };
    recognition.onerror = (event) => {
      status.textContent = event.error === 'not-allowed' ? '未获得麦克风权限，请允许后重试。' : '语音输入中断，请重试或使用手机输入法语音键。';
      status.classList.add('error');
    };
    recognition.onend = () => {
      button.disabled = false;
      button.textContent = '开始口述';
      if (!status.classList.contains('error')) status.textContent = textarea.value.trim() ? '口述已转为文字，可点击“AI解析并填充”。' : '没有识别到内容，请重试。';
    };
    recognition.start();
  }

  async function extractDemandTranscript(endpoint = 'api/recruitment/monthly-demands/transcript-extract') {
    const transcript = document.getElementById('rf-demand-transcript-text')?.value.trim() || '';
    const status = document.getElementById('rf-demand-transcript-status');
    const button = document.querySelector('[data-rf-demand-transcript-extract]');
    if (!transcript) {
      if (status) { status.textContent = '请先口述、粘贴或导入招聘需求内容。'; status.classList.add('error'); }
      return;
    }
    if (button) button.disabled = true;
    if (status) { status.textContent = 'AI正在识别岗位、人数和到岗计划…'; status.classList.remove('error'); }
    try {
      const result = await requestCommunicationExtraction(typeof endpoint === 'string' ? endpoint : 'api/recruitment/monthly-demands/transcript-extract', transcript, status);
      if (!button?.isConnected) return;
      const extraction = result.extraction || {};
      const setValue = (id, value) => {
        const node = document.getElementById(id);
        if (node && value !== undefined && value !== null && String(value) !== '') node.value = value;
      };
      setValue('rf-demand-month', extraction.month);
      const positionOption = [...(document.getElementById('rf-demand-position')?.options || [])].find((option) => option.value === extraction.positionId);
      if (positionOption) setValue('rf-demand-position', extraction.positionId);
      setValue('rf-demand-headcount', extraction.headcount);
      setValue('rf-demand-type', extraction.demandType);
      setValue('rf-demand-priority', extraction.priority);
      setValue('rf-demand-arrival', extraction.expectedArrivalDate);
      setValue('rf-demand-latest-arrival', extraction.latestArrivalDate);
      setValue('rf-demand-note', extraction.note);
      if (status) {
        status.textContent = extraction.positionName && !extraction.matchedPosition
          ? `已解析其他字段，但“${extraction.positionName}”未唯一匹配当前部门岗位，请手动选择岗位。`
          : '解析完成：仅填充原话中明确提到的内容，请核对后保存。';
        status.classList.toggle('error', Boolean(extraction.positionName && !extraction.matchedPosition));
      }
    } catch (error) {
      if (status) { status.textContent = conciseError(error); status.classList.add('error'); }
    } finally {
      if (button) button.disabled = false;
    }
  }

  function openDemandDepartmentSummary(month, positionId) {
    const selected = (state.jobs || []).find((item) => item.id === positionId);
    const department = selected?.department || '当前部门';
    const jobs = (state.jobs || []).filter((item) => !selected?.department || item.department === selected.department);
    const demandMap = new Map((state.monthlyDemands || []).filter((item) => item.month === month).map((item) => [item.positionId, item]));
    const activeCount = jobs.filter((item) => item.status === '招聘中').length;
    const totalDemand = jobs.reduce((sum, item) => sum + Number(demandMap.get(item.id)?.headcount || 0), 0);
    showTalentDialog(`
      <section class="rf-demand-summary">
        <header class="rf-dialog-head"><div><span>DEPARTMENT HIRING PLAN</span><h2>${escapeHtml(department)} · ${escapeHtml(month)} 招聘计划</h2><p>需求已保存。这里汇总本部门岗位和本月人数，方便继续补录或现场核对。</p></div><b>已保存</b></header>
        <div class="rf-demand-summary-metrics"><article><span>部门岗位</span><strong>${jobs.length}</strong></article><article><span>招聘中</span><strong>${activeCount}</strong></article><article><span>本月需求</span><strong>${totalDemand}</strong></article></div>
        <div class="rf-demand-summary-list">${jobs.map((job) => {
          const demand = demandMap.get(job.id);
          return `<article class="${demand ? 'has-demand' : 'empty'}"><div><span>${escapeHtml(job.department || department)}</span><strong>${escapeHtml(job.name || '未命名岗位')}</strong></div><aside><b>${demand ? `${Number(demand.headcount || 0)}人` : '未录入'}</b><small>${demand ? `${escapeHtml(({ 一般: '储备', 低: '储备', 高: '紧急', 中: '重要' })[demand.priority] || demand.priority || '储备')} · ${escapeHtml(demand.demandType || '新增需求')} · ${escapeHtml(demand.approvalStatus || demand.status || '待审批')}` : escapeHtml(job.status || '待发布')}</small></aside></article>`;
        }).join('') || '<div class="rf-dialog-empty"><p>当前部门暂无岗位。</p></div>'}</div>
        <div class="rf-dialog-actions"><button class="btn-soft" data-rf-demand-summary-close type="button">完成，返回岗位库</button><button class="btn-primary" data-rf-demand-summary-continue type="button">继续录入其他岗位</button></div>
      </section>
    `, 'wide');
    document.querySelector('[data-rf-demand-summary-close]')?.addEventListener('click', closeTalentDialog);
    document.querySelector('[data-rf-demand-summary-continue]')?.addEventListener('click', () => {
      const next = jobs.find((item) => !demandMap.has(item.id)) || jobs[0] || selected;
      openMonthlyDemandDialog(next || null);
    });
  }

  function openMonthlyDemandDialog(position = null, context = null) {
    const jobs = context?.jobs || state.jobs || [];
    if (!jobs.length) return notifyUser('当前部门暂无可选择的岗位，请联系管理员确认岗位归属。', 'info');
    const month = context?.month || document.getElementById('job-month-filter')?.value || document.getElementById('overview-month-filter')?.value || currentMonthValue();
    showTalentDialog(`
      <header class="rf-dialog-head"><div><span>MONTHLY DEMAND</span><h2>${position ? '新建/调整需求' : '新建需求'}</h2><p>可以直接口述或粘贴业务需求，AI只填充明确提到的字段，再由你确认保存。</p></div></header>
      <div class="rf-dialog-form rf-demand-dialog-form">
        <section class="wide rf-demand-ai-panel">
          <div class="rf-demand-ai-head"><i>AI</i><div><strong>口述需求，自动填表</strong><p>例如：下个月商务开发要3个人，比较紧急，希望10月15日前到岗，因为新业务线要启动。</p></div></div>
          <textarea id="rf-demand-transcript-text" rows="4" maxlength="20000" placeholder="点击“开始口述”，或粘贴业务部门的原话。没有提到的内容不会自动编造。"></textarea>
          <div class="rf-demand-ai-tools">
            <button class="btn-soft" data-rf-demand-voice type="button">开始口述</button>
            <label class="btn-soft rf-demand-file-button">导入文字<input id="rf-demand-transcript-file" type="file" accept=".txt,.md,text/plain,text/markdown"></label>
            <button class="btn-primary" data-rf-demand-transcript-extract type="button">AI解析并填充</button>
          </div>
          <small id="rf-demand-transcript-file-status"></small>
          <small id="rf-demand-transcript-status">支持手机浏览器语音输入；如果浏览器不支持，可直接使用手机输入法的语音键。</small>
        </section>
        <label data-demand-field="rf-demand-month"><span>需求月份 <b>*</b></span><input id="rf-demand-month" type="month" value="${escapeHtml(month)}" required><small class="rf-demand-error" hidden></small></label>
        <label data-demand-field="rf-demand-position"><span>岗位 <b>*</b></span><select id="rf-demand-position" required><option value="">请选择岗位</option>${jobs.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.department || '未分配部门')} · ${escapeHtml(item.name || '未命名岗位')}</option>`).join('')}</select><small class="rf-demand-error" hidden></small></label>
        <label data-demand-field="rf-demand-headcount"><span>需求数量 <b>*</b></span><input id="rf-demand-headcount" type="number" min="1" step="1" value="" placeholder="请输入人数" required><small class="rf-demand-error" hidden></small></label>
        <label data-demand-field="rf-demand-type"><span>需求类型 <b>*</b></span><select id="rf-demand-type" required><option value="">请选择需求类型</option><option value="新增需求">新增需求</option><option value="储备需求">储备需求</option></select><small class="rf-demand-error" hidden></small></label>
        <label data-demand-field="rf-demand-priority"><span>优先级 <b>*</b></span><select id="rf-demand-priority" required><option value="">请选择优先级</option>${['紧急','重要','储备'].map(item => `<option value="${item}">${item}</option>`).join('')}</select><small class="rf-demand-error" hidden></small></label>
        <label data-demand-field="rf-demand-arrival"><span>期望到岗日期 <b>*</b></span><input id="rf-demand-arrival" type="date" value="" required><small class="rf-demand-error" hidden></small></label>
        <label data-demand-field="rf-demand-latest-arrival"><span>最晚到岗日期 <b>*</b></span><input id="rf-demand-latest-arrival" type="date" value="" required><small class="rf-demand-error" hidden></small></label>
        <label class="wide" data-demand-field="rf-demand-requirement"><span>需求要求（本月岗位定向要求） <b>*</b></span><textarea id="rf-demand-requirement" required placeholder="只填本月这个岗位的定向要求，例如业务方向、重点项目、优先能力或到岗节奏"></textarea><small>和岗位库里的工作职责、任职要求分开维护，用于本次招聘。</small><small class="rf-demand-error" hidden></small></label>
        <label class="wide" data-demand-field="rf-demand-note"><span>需求说明（审批用） <b>*</b></span><textarea id="rf-demand-note" required placeholder="请说明招聘背景、人员用途和审批人需要了解的信息"></textarea><small>该内容会展示在审批页面和审批通知中。</small><small class="rf-demand-error" hidden></small></label>
      </div>
      <div class="rf-dialog-actions">${context ? '<button class="btn-soft" id="rf-demand-back" type="button">返回部门工作台</button>' : ''}<button class="btn-primary" id="rf-save-demand" type="button">保存需求</button></div>
      <p class="rf-dialog-message" id="rf-demand-message"></p>
    `, 'wide');
    document.querySelector('#rf-talent-dialog .rf-dialog')?.classList.add('rf-demand-dialog');
    const existingDemand = (context?.demands || state.monthlyDemands || []).find(item => item.month === month && item.positionId === document.getElementById('rf-demand-position').value);
    if (existingDemand) {
      document.getElementById('rf-demand-headcount').value = Number(existingDemand.headcount || 1);
      document.getElementById('rf-demand-type').value = existingDemand.demandType || '新增需求';
      document.getElementById('rf-demand-priority').value = ({ 高: '紧急', 中: '重要', 低: '储备', 一般: '储备' }[existingDemand.priority] || existingDemand.priority || '储备');
      document.getElementById('rf-demand-arrival').value = existingDemand.expectedArrivalDate || '';
      document.getElementById('rf-demand-latest-arrival').value = existingDemand.latestArrivalDate || '';
      document.getElementById('rf-demand-requirement').value = existingDemand.demandRequirement || '';
      document.getElementById('rf-demand-note').value = existingDemand.note || '';
    }
    const fillSelectedDemand = () => {
      const selected = jobs.find(item => item.id === document.getElementById('rf-demand-position').value);
      const demand = (context?.demands || state.monthlyDemands || []).find(item => item.positionId === selected?.id && item.month === document.getElementById('rf-demand-month').value);
      document.getElementById('rf-demand-headcount').value = demand?.headcount ?? '';
      document.getElementById('rf-demand-type').value = demand?.demandType || '';
      document.getElementById('rf-demand-priority').value = ({ 一般: '储备', 高: '紧急', 中: '重要', 低: '储备' })[demand?.priority] || demand?.priority || '';
      document.getElementById('rf-demand-arrival').value = demand?.expectedArrivalDate || '';
      document.getElementById('rf-demand-latest-arrival').value = demand?.latestArrivalDate || '';
      document.getElementById('rf-demand-requirement').value = demand?.demandRequirement || '';
      document.getElementById('rf-demand-note').value = demand?.note || '';
    };
    document.getElementById('rf-demand-position').addEventListener('change', fillSelectedDemand);
    document.getElementById('rf-demand-month').addEventListener('change', fillSelectedDemand);
    document.getElementById('rf-demand-transcript-file')?.addEventListener('change', importDemandTranscriptFile);
    document.querySelector('[data-rf-demand-voice]')?.addEventListener('click', startDemandVoiceInput);
    document.querySelector('[data-rf-demand-transcript-extract]')?.addEventListener('click', () => extractDemandTranscript(context ? `${context.endpoint}/transcript-extract` : undefined));
    document.getElementById('rf-demand-back')?.addEventListener('click', () => context?.onBack());
    const demandDialogToken = talentDialogToken;
    const demandFieldError = (id) => document.querySelector(`[data-demand-field="${id}"] .rf-demand-error`);
    const clearDemandFieldError = (id) => {
      document.querySelector(`[data-demand-field="${id}"]`)?.classList.remove('is-invalid');
      const error = demandFieldError(id);
      if (error) { error.hidden = true; error.textContent = ''; }
    };
    const showDemandValidation = (issues) => {
      document.querySelectorAll('[data-demand-field]').forEach((field) => clearDemandFieldError(field.dataset.demandField));
      issues.forEach(([id, text]) => {
        document.querySelector(`[data-demand-field="${id}"]`)?.classList.add('is-invalid');
        const error = demandFieldError(id);
        if (error) { error.hidden = false; error.textContent = text; }
      });
      document.querySelector(`[data-demand-field="${issues[0]?.[0]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    document.querySelectorAll('[data-demand-field]').forEach((field) => {
      field.addEventListener('input', () => clearDemandFieldError(field.dataset.demandField));
      field.addEventListener('change', () => clearDemandFieldError(field.dataset.demandField));
    });
    document.getElementById('rf-save-demand')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      if (button.disabled) return;
      const message = document.getElementById('rf-demand-message');
      try {
        const demandMonth = document.getElementById('rf-demand-month')?.value.trim() || '';
        const expectedArrivalDate = document.getElementById('rf-demand-arrival')?.value || '';
        const latestArrivalDate = document.getElementById('rf-demand-latest-arrival')?.value || '';
        const demandRequirement = document.getElementById('rf-demand-requirement')?.value.trim() || '';
        const note = document.getElementById('rf-demand-note')?.value.trim() || '';
        const headcountValue = document.getElementById('rf-demand-headcount')?.value || '';
        const headcount = Number(headcountValue);
        const issues = [
          ['rf-demand-month', demandMonth, '请选择需求月份'],
          ['rf-demand-position', document.getElementById('rf-demand-position')?.value, '请选择岗位'],
          ['rf-demand-headcount', headcountValue && Number.isInteger(headcount) && headcount >= 1, '请填写大于 0 的整数'],
          ['rf-demand-type', document.getElementById('rf-demand-type')?.value, '请选择需求类型'],
          ['rf-demand-priority', document.getElementById('rf-demand-priority')?.value, '请选择优先级'],
          ['rf-demand-arrival', expectedArrivalDate, '请选择期望到岗日期'],
          ['rf-demand-latest-arrival', latestArrivalDate, '请选择最晚到岗日期'],
          ['rf-demand-requirement', demandRequirement, '请填写本月岗位定向要求'],
          ['rf-demand-note', note, '请填写审批用的需求说明'],
        ].filter(([, value]) => !value).map(([id, , text]) => [id, text]);
        if (latestArrivalDate && expectedArrivalDate && latestArrivalDate < expectedArrivalDate) issues.push(['rf-demand-latest-arrival', '不能早于期望到岗日期']);
        if (issues.length) { showDemandValidation(issues); if (message) message.textContent = ''; return; }
        button.disabled = true; button.textContent = '正在保存…';
        const result = await request(context?.endpoint || 'api/recruitment/monthly-demands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          month: demandMonth,
          positionId: document.getElementById('rf-demand-position')?.value,
          headcount,
          demandType: document.getElementById('rf-demand-type')?.value,
          priority: document.getElementById('rf-demand-priority')?.value,
          expectedArrivalDate: document.getElementById('rf-demand-arrival')?.value,
          latestArrivalDate,
          demandRequirement,
          note,
          operator: window.recruitmentCurrentUser?.name || '当前用户',
        }) });
        const notificationStatus = result.approvalNotification?.status || '未发送';
        const notificationError = result.approvalNotification?.error ? `：${String(result.approvalNotification.error).slice(0, 120)}` : '';
        const notificationPending = ['待发送', '发送中'].includes(notificationStatus);
        const openText = result.positionAutoPublished ? '，岗位已默认开放招聘' : '';
        notifyUser(notificationStatus === '已发送' ? `${result.month} ${result.positionName} 需求已保存${openText}，企微已通知审批人` : notificationPending ? `${result.month} ${result.positionName} 需求已保存${openText}，企微通知正在后台发送` : `${result.month} ${result.positionName} 需求已保存${openText}；企微通知${notificationStatus}${notificationError}`, notificationStatus === '已发送' || notificationPending ? 'success' : 'error');
        if (context) { if (isTalentDialogCurrent(demandDialogToken)) await context.onSaved(result); }
        else { await refreshJobsPage(result.month); openDemandDepartmentSummary(result.month, result.positionId); }
      } catch (error) { if (message) { message.textContent = conciseError(error); message.classList.add('error'); } }
      finally { button.disabled = false; button.textContent = '保存需求'; }
    });
  }

  async function openJobDialog(mode = 'new', position = null) {
    showTalentDialog('<div class="rf-dialog-loading">正在读取部门和招聘负责人…</div>', 'normal');
    const loadingToken = talentDialogToken;
    try {
      const options = await request('api/recruitment/form-options');
      if (!isTalentDialogCurrent(loadingToken)) return;
      state.jobFormOptions = options;
    } catch (error) {
      if (isTalentDialogCurrent(loadingToken)) {
        closeTalentDialog();
        notifyUser(`负责人选项读取失败，请重新打开：${conciseError(error)}`, 'error');
      }
      return;
    }
    const isEdit = mode === 'edit';
    showTalentDialog('<div id="rf-job-dialog-root"></div>', 'wide rf-job-vue-dialog');
    const root = document.getElementById('rf-job-dialog-root');
    if (!window.mountJobDialog || !root) {
      closeTalentDialog();
      notifyUser('岗位表单组件未加载，请刷新页面后重试', 'error');
      return;
    }
    window.mountJobDialog(root, {
      mode,
      position,
      options: state.jobFormOptions,
      onSubmit: async (body, initiator) => {
        const result = isEdit
          ? await request(`api/recruitment/positions/${encodeURIComponent(position.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), initiator })
          : await request('api/recruitment/positions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), initiator });
        const notificationStatus = result?.approvalNotification?.status || '';
        const notificationError = result?.approvalNotification?.error ? `：${String(result.approvalNotification.error).slice(0, 120)}` : '';
        notifyUser(isEdit ? '岗位已保存' : notificationStatus === '已发送' ? '岗位已提交审批，企微已通知审批人' : `岗位已保存为待审批；企微通知${notificationStatus || '未发送'}${notificationError}`, isEdit || notificationStatus === '已发送' ? 'success' : 'error');
        window.unmountJobDialog?.();
        closeTalentDialog();
        await refreshJobsPage();
      },
    });
  }

  function bindOverviewJobsPages() {
    state.overviewPeriod = ['day', 'week', 'month'].includes(state.overviewPeriod) ? state.overviewPeriod : 'day';
    state.overviewSelectedMonth = state.overviewSelectedMonth || currentMonthValue();
    const jobMonthInput = document.getElementById('job-month-filter');
    if (jobMonthInput && !jobMonthInput.value) jobMonthInput.value = currentMonthValue();
    const updateJobMonthPeriod = () => {
      const range = window.companyCalendar?.monthRange(jobMonthInput?.value || currentMonthValue());
      if (jobMonthInput && range) jobMonthInput.title = `公司统计区间：${range.startDate} 至 ${range.endDate}`;
    };
    updateJobMonthPeriod();
    jobMonthInput?.addEventListener('change', async () => { if (state.jobCatalogLoaded) await loadJobsPage(); });
    document.getElementById('job-keyword-filter')?.addEventListener('input', () => renderJobsTable());
    document.querySelector('[data-action="sync-company-position-catalog"]')?.addEventListener('click', async (event) => {
      try {
        const result = await request('api/recruitment/positions/company-catalog/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operator: window.recruitmentCurrentUser?.name || '当前用户' }), initiator: event.currentTarget });
        notifyUser(`岗位同步完成：新增 ${Number(result.created || 0)}，更新 ${Number(result.updated || 0)}`, 'success');
        await loadJobsPage();
      } catch (error) { notifyUser(`岗位同步失败：${conciseError(error)}`, 'error'); }
    });
    document.querySelector('[data-action="new-job"]')?.addEventListener('click', async () => {
      if (!state.jobCatalogLoaded) await loadJobsPage();
      openJobDialog('new');
    });
    document.querySelector('[data-action="monthly-demand"]')?.addEventListener('click', async () => {
      if (!state.jobCatalogLoaded) await loadJobsPage();
      openMonthlyDemandDialog(null);
    });
  }

  async function loadScheduledTasks() {
    window.mountScheduledTasksPage?.();
  }

  async function loadReferralQrSummary() {
    await window.mountReferralOverview?.();
  }

  function renderReferralWorkbench() {
    const data = state.referralData || { referrals: [], campaigns: [], rules: [], analytics: {} };
    showTalentDialog(`
      <header class="rf-dialog-head"><div><span>EMPLOYEE REFERRAL</span><h2>推荐记录与奖励</h2><p>候选人扫码后填写姓名、手机号并上传简历，系统自动标记内推来源并归属奖励。</p></div><div class="rf-assessment-head-actions"><button class="btn-soft" data-ref-rule>奖励规则</button></div></header>
      <div class="rf-review-metrics"><article><span>内推简历</span><strong>${Number(data.analytics.total || 0)}</strong></article><article><span>有效内推</span><strong>${Number(data.analytics.valid || 0)}</strong></article><article class="warn"><span>重复待判断</span><strong>${Number(data.analytics.duplicate || 0)}</strong></article><article><span>奖励待发放</span><strong>${Number(data.analytics.rewardPending || 0)}</strong></article><article><span>已发现金额</span><strong>${Number(data.analytics.rewardPaid || 0)}</strong></article></div>
      <section class="rf-ref-list"><div class="rf-review-title"><strong>内推记录</strong><small>${data.referrals.length}条</small></div>${data.referrals.map((item) => `<article ${item.candidateId ? `class="rf-ref-record-clickable" data-ref-record-candidate="${escapeHtml(item.candidateId)}" tabindex="0" aria-label="点击查看${escapeHtml(item.candidateName || '候选人')}的简历"` : ''}><div><strong>${escapeHtml(item.candidateName || '解析中')} · ${escapeHtml(item.role || '岗位待关联')}</strong><p>推荐人 ${escapeHtml(item.referrer)}${item.referrerMobile ? ` · ${escapeHtml(item.referrerMobile.slice(0, 3))}****${escapeHtml(item.referrerMobile.slice(-4))}` : ''}${item.department ? ` · ${escapeHtml(item.department)}` : ''}</p><small>${escapeHtml(item.status)} · ${escapeHtml(item.progress)} · ${escapeHtml(item.duplicateStatus || '待查重')}</small></div><span>${escapeHtml(item.validity)}</span><aside>${!['有效', '无效'].includes(item.validity) ? `<button data-ref-valid="${escapeHtml(item.id)}">确认有效</button><button class="danger" data-ref-invalid="${escapeHtml(item.id)}">判定无效</button>` : ''}${item.validity === '有效' ? `<button class="soft" data-ref-evaluate="${escapeHtml(item.id)}">计算奖励</button>` : ''}${(item.rewards || []).filter((reward) => reward.status === '待发放').map((reward) => `<button data-ref-pay="${escapeHtml(reward.id)}">发放${Number(reward.amount || 0)}元</button>`).join('')}</aside></article>`).join('') || '<div class="rf-dialog-empty"><p>暂无内推记录。</p></div>'}</section>
      <div class="rf-ref-bottom"><section><div class="rf-review-title"><strong>奖励规则</strong><small>${data.rules.length}条</small></div>${data.rules.map((item) => `<p><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.stage)} · ${Number(item.amount || 0)}元 / ${Number(item.points || 0)}积分</span><small>${escapeHtml(item.role || '全部岗位')} · ${escapeHtml(item.status)}</small></p>`).join('') || '<div class="rf-dialog-empty"><p>暂无奖励规则。</p></div>'}</section><section><div class="rf-review-title"><strong>渠道效果</strong><small>按二维码</small></div>${(data.analytics.byCampaign || []).map((item) => `<p><strong>${escapeHtml(item.name)}</strong><span>${Number(item.submissions || 0)}份 · 有效${Number(item.valid || 0)} · 无效${Number(item.invalid || 0)}</span><small>${escapeHtml(item.role)}</small></p>`).join('') || '<div class="rf-dialog-empty"><p>暂无渠道样本。</p></div>'}</section></div>
    `, 'wide');
    document.querySelector('[data-ref-rule]')?.addEventListener('click', openReferralRuleForm);
    document.querySelectorAll('[data-ref-copy]').forEach((button) => button.addEventListener('click', () => navigator.clipboard.writeText(button.dataset.refCopy)));
    document.querySelectorAll('[data-ref-valid]').forEach((button) => button.addEventListener('click', () => decideReferral(button.dataset.refValid, '有效')));
    document.querySelectorAll('[data-ref-invalid]').forEach((button) => button.addEventListener('click', () => decideReferral(button.dataset.refInvalid, '无效')));
    document.querySelectorAll('[data-ref-evaluate]').forEach((button) => button.addEventListener('click', () => referralSimple(`api/referrals/${button.dataset.refEvaluate}/evaluate-rewards`, { operator: '当前用户' })));
    document.querySelectorAll('[data-ref-pay]').forEach((button) => button.addEventListener('click', () => referralSimple(`api/referrals/rewards/${button.dataset.refPay}/pay`, { note: '奖励资格和金额已核对，确认发放', operator: '当前用户' })));
  }
  function openReferralCampaignForm(){}
  function openReferralRuleForm(){referralForm('新建内推奖励规则','奖励只在内推有效并满足流程阶段后生成待发放记录。',`<label><span>规则名称</span><input id="ref-rule-name"></label><label><span>奖励阶段</span><select id="ref-rule-stage"><option>简历有效</option><option>面试通过</option><option>接受Offer</option><option>正式入职</option><option>入职留存</option></select></label><label><span>适用岗位</span><input id="ref-rule-role" placeholder="留空表示全部岗位"></label><label><span>奖励类型</span><select id="ref-rule-type"><option>现金</option><option>积分</option><option>现金+积分</option></select></label><label><span>现金金额</span><input id="ref-rule-amount" type="number" value="1000"></label><label><span>奖励积分</span><input id="ref-rule-points" type="number" value="0"></label><label><span>留存天数</span><input id="ref-rule-days" type="number" value="90"></label><label class="wide"><span>说明</span><textarea id="ref-rule-description"></textarea></label>`,async()=>{await request('api/referrals/reward-rules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('ref-rule-name').value.trim(),stage:document.getElementById('ref-rule-stage').value,role:document.getElementById('ref-rule-role').value.trim(),type:document.getElementById('ref-rule-type').value,amount:Number(document.getElementById('ref-rule-amount').value||0),points:Number(document.getElementById('ref-rule-points').value||0),retentionDays:Number(document.getElementById('ref-rule-days').value||0),description:document.getElementById('ref-rule-description').value.trim(),operator:'当前用户'})});await openReferralWorkbench()})}
  async function decideReferral(id,decision){const reason=decision==='有效'?'推荐关系、重复情况和候选人授权已核对':'重复内推或不符合活动规则';await referralSimple(`api/referrals/${id}/validity`,{decision,reason,operator:'当前用户'})}
  async function referralSimple(path,payload){try{await request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});notifyUser('内推记录已更新','success');await openReferralWorkbench()}catch(error){notifyUser(error.message||'内推操作失败','error',()=>referralSimple(path,payload))}}
  function referralForm(title,description,fields,submit){showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-ref-back>← 返回内推工作台</button><span>EMPLOYEE REFERRAL ACTION</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></header><div class="rf-dialog-form">${fields}</div><div class="rf-dialog-actions"><button class="btn-primary" data-ref-submit>确认提交</button></div><p class="rf-dialog-message" id="ref-message"></p>`,'wide');document.querySelector('[data-ref-back]')?.addEventListener('click',renderReferralWorkbench);document.querySelector('[data-ref-submit]')?.addEventListener('click',async()=>{const message=document.getElementById('ref-message');if(!validateDialogForm(message))return;try{message.textContent='正在提交…';message.classList.remove('error');await submit()}catch(error){message.textContent=error.message||'操作失败';message.classList.add('error')}})}

  async function renderPublicReferral(token){
    document.body.className = 'rf-public-assessment-body rf-referral-brand-page';
    document.body.innerHTML = '<main class="rf-public-referral"><div class="rf-dialog-loading">正在安全加载内推活动…</div></main>';
    try {
      const item = await request(`api/public/referrals/${encodeURIComponent(token)}`);
      const positions = item.positions || [];
      const referrer = item.referrer || {};
      const refName = escapeHtml(referrer.name || '方片新媒体');
      const refDept = escapeHtml(referrer.department || '');
      const positionsHtml = positions.length ? positions.map((p, i) => `<article class="rf-ref-position-card"><header><span class="rf-ref-pos-num">${i + 1}</span><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.department || '')}</small></div></header>${p.responsibilities ? `<div class="rf-ref-pos-body"><span>岗位职责</span><p>${escapeHtml(p.responsibilities)}</p></div>` : ''}${p.requirements ? `<div class="rf-ref-pos-body"><span>任职要求</span><p>${escapeHtml(p.requirements)}</p></div>` : ''}<div class="rf-ref-pos-salary">${p.salaryText ? escapeHtml(p.salaryText) : p.minSalary || p.maxSalary ? `${p.minSalary || 0}-${p.maxSalary || 0}元` : '薪资面议'}</div></article>`).join('') : '';

      document.querySelector('.rf-public-referral').innerHTML = `
        <header class="rf-xhs-public-hero">
          <img class="rf-referral-building" src="./uploads/building.jpg" alt="方片新媒体办公大楼">
          <div class="rf-referral-brand-copy"><span>人才招聘 · 员工内推</span><h1>方片新媒体</h1><p>期待与你，成为同事</p></div>
        </header>
        ${referrer.bound ? `<div class="rf-xhs-public-intro"><div><strong>我是${refName}，我帮你内部推荐</strong>${refDept ? `<small>${refDept}</small>` : ''}</div></div>` : ''}
        ${positions.length ? `<section class="rf-ref-positions"><div class="rf-ref-positions-title"><strong>招聘岗位</strong><small>共${positions.length}个岗位</small></div><div class="rf-ref-positions-list">${positionsHtml}</div></section>` : '<div class="rf-dialog-empty"><p>暂无在招岗位。</p></div>'}
        <section class="rf-public-referral-form-section">
          <div class="rf-public-form-title"><div><strong>投递简历</strong></div></div>
          <form id="rf-referral-form" class="rf-public-referral-form">
            <label><span>候选人姓名 *</span><input name="candidateName" required autocomplete="name" placeholder="请填写真实姓名"></label>
            <label><span>手机号 *</span><input name="candidatePhone" required inputmode="tel" maxlength="11" autocomplete="tel" placeholder="11位手机号"></label>
            <label class="wide"><span>意向岗位 *</span><select name="intendedPositionId" required>${positions.length ? positions.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === item.positionId ? 'selected' : ''}>${escapeHtml(p.name)} · ${escapeHtml(p.department || '未分配部门')}</option>`).join('') : '<option value="">暂无岗位</option>'}</select></label>
            <div class="wide rf-public-ref-file" data-public-ref-drop tabindex="0" role="button" aria-label="拖拽或点击选择简历文件">
              <span>上传简历 *</span>
              <input name="file" type="file" hidden accept="${supported.join(',')}" aria-label="选择简历文件">
              <div><strong>拖拽简历到这里，或点击选择文件</strong><small>支持 PDF、Word 和图片，单个不超过10MB</small></div>
            </div>
            <label class="wide rf-ref-consent"><input name="consent" type="checkbox" required><span>我确认信息真实，并同意将简历用于本次招聘流程。</span></label>
          </form>
          <button class="btn-primary rf-public-ref-submit-btn" data-public-ref-submit>提交内推简历</button>
          <p id="rf-public-ref-message" role="status" aria-live="polite"></p>
        </section>`;
      document.querySelector('[data-public-ref-submit]').addEventListener('click', () => submitPublicReferral(token));
      const publicReferralDrop = document.querySelector('[data-public-ref-drop]');
      const publicReferralInput = document.querySelector('#rf-referral-form input[name="file"]');
      const setPublicReferralFile = (file) => {
        if (!file) return;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        publicReferralInput.files = transfer.files;
        document.querySelector('.rf-public-ref-file strong').textContent = file.name;
      };
      publicReferralDrop.addEventListener('click', () => publicReferralInput.click());
      publicReferralDrop.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        publicReferralInput.click();
      });
      publicReferralInput.addEventListener('change', (event) => {
        if (event.target.files[0]) document.querySelector('.rf-public-ref-file strong').textContent = event.target.files[0].name;
      });
      ['dragenter', 'dragover'].forEach((name) => publicReferralDrop.addEventListener(name, (event) => {
        event.preventDefault();
        publicReferralDrop.classList.add('dragging');
      }));
      ['dragleave', 'drop'].forEach((name) => publicReferralDrop.addEventListener(name, (event) => {
        event.preventDefault();
        publicReferralDrop.classList.remove('dragging');
      }));
      publicReferralDrop.addEventListener('drop', (event) => setPublicReferralFile(event.dataTransfer?.files?.[0]));
    } catch (error) {
      document.querySelector('.rf-public-referral').innerHTML = `<div class="rf-public-failed"><strong>无法打开内推活动</strong><p>${escapeHtml(conciseError(error))}</p></div>`;
    }
  }
  async function submitPublicReferral(token) {
    const form = document.getElementById('rf-referral-form');
    if (!form || form.dataset.submitting === 'true') return;
    const message = document.getElementById('rf-public-ref-message');
    const button = document.querySelector('[data-public-ref-submit]');
    const candidatePhone = form.elements.candidatePhone.value.replace(/\s|-/g, '');
    if (!form.reportValidity()) { message.textContent = '请完成必填信息、选择简历并确认招聘用途。'; return; }
    if (!form.elements.candidateName.value.trim()) { message.textContent = '请填写候选人姓名'; form.elements.candidateName.focus(); return; }
    if (!/^1[3-9]\d{9}$/.test(candidatePhone)) { message.textContent = '请填写正确的手机号'; form.elements.candidatePhone.focus(); return; }
    if (!form.elements.file.files.length) { message.textContent = '请选择简历文件'; form.querySelector('[data-public-ref-drop]').focus(); return; }
    const data = new FormData(form);
    data.delete('consent');
    data.append('intendedPositionName', form.elements.intendedPositionId.selectedOptions[0]?.textContent || '');
    form.dataset.submitting = 'true';
    button.disabled = true;
    button.textContent = '正在上传并处理…';
    try {
      message.textContent = '正在上传简历并检查重复，请勿重复提交…';
      const result = await request(`api/public/referrals/${encodeURIComponent(token)}/submit`, { method: 'POST', body: data, timeoutMs: 60000 });
      await pollReferralJob(result.jobId, message);
    } catch (error) {
      message.textContent = `${error.message || '内推提交失败'}。填写内容与所选文件仍保留。`;
      message.scrollIntoView({ block: 'nearest' });
    } finally {
      form.dataset.submitting = 'false';
      button.disabled = false;
      button.textContent = '提交内推简历';
    }
  }
  async function pollReferralJob(jobId,message){const data=await waitForBackgroundJob(jobId,progress=>{if(message?.isConnected)message.textContent=progress;},{timeoutMessage:'简历仍在后台解析，请勿重复提交，可稍后查看内推进度。'});{const link=new URL(data.trackingPath,window.location.href).toString();document.querySelector('.rf-public-referral').innerHTML=`<div class="rf-public-ref-success"><i>✓</i><strong>内推简历已提交</strong><p>简历已经解析、入库并进入${escapeHtml(data.status)}。</p><small>查重状态：${escapeHtml(data.duplicateStatus)}</small><a class="btn-primary" href="${escapeHtml(link)}">查看内推进度</a><em>请妥善保存进度链接，有效期90天。</em></div>`;return}}
  async function renderReferralTracking(token){document.body.className='rf-public-assessment-body';document.body.innerHTML='<main class="rf-public-referral"><div class="rf-dialog-loading">正在读取内推进度…</div></main>';try{const item=await request(`api/public/referrals/track/${encodeURIComponent(token)}`);document.querySelector('.rf-public-referral').innerHTML=`<div class="rf-ref-track"><span>REFERRAL TRACKING</span><h1>${escapeHtml(item.candidateName||'候选人')} · ${escapeHtml(item.role||'内推岗位')}</h1><div><strong>${escapeHtml(item.progress)}</strong><small>${escapeHtml(item.status)} · ${escapeHtml(item.validity)}</small></div><p>查重状态：${escapeHtml(item.duplicateStatus||'待检查')}</p><small>推荐时间 ${escapeHtml(item.recommendedAt)} · 最近更新 ${escapeHtml(item.updatedAt)}</small><aside>${escapeHtml(item.privacy)}</aside></div>`}catch(error){document.querySelector('.rf-public-referral').innerHTML=`<div class="rf-public-failed"><strong>无法查看内推进度</strong><p>${escapeHtml(conciseError(error))}</p></div>`}}

  function publicOfferSalaryText(item) {
    const salary = item.salary || {};
    if (salary.daily) return { total: Number(salary.daily), detail: `日薪 ${Number(salary.daily)} 元` };
    const parts = [`底薪 ${Number(salary.base || 0)} 元/月`];
    if (salary.performanceIncluded) parts.push(`绩效 ${Number(salary.performance || 0)} 元/月`);
    if (salary.commissionIncluded) parts.push(`其他 ${Number(salary.commission || 0)} 元/月`);
    return { total: Number(salary.total || 0), detail: parts.join(' + ') };
  }
  async function renderPublicOffer(token){document.body.className='rf-public-assessment-body';document.body.innerHTML='<main class="rf-public-offer"><div class="rf-dialog-loading">正在安全加载录用通知…</div></main>';try{const item=await request(`api/public/offers/${encodeURIComponent(token)}`);const salary=publicOfferSalaryText(item);const answered=Boolean(item.response);document.querySelector('.rf-public-offer').innerHTML=`<header><span>FANGPIAN OFFER</span><h1>录用通知书</h1><p>${escapeHtml(item.candidateName)}，很高兴向你发出 ${escapeHtml(item.role)} 岗位的录用邀请。</p></header><section class="rf-public-offer-grid"><div><span>Offer编号</span><strong>${escapeHtml(item.offerNumber)}</strong></div><div><span>部门 / 地点</span><strong>${escapeHtml(item.department)} · ${escapeHtml(item.location)}</strong></div><div><span>月度薪资</span><strong>${Number(salary.total)} 元</strong><small>${escapeHtml(salary.detail)}</small></div><div><span>入职日期</span><strong>${escapeHtml(item.startDate)}</strong><small>试用期 ${escapeHtml(item.probationMonths || '—')}</small></div></section><div class="rf-public-offer-actions"><a class="btn-soft" href="${escapeHtml(item.fileUrl)}" target="_blank">查看完整Offer文件</a>${answered?'':'<button class="btn-primary" data-public-offer-accept>接受Offer</button><button class="btn-soft danger" data-public-offer-reject>拒绝Offer</button>'}</div>${answered?`<div class="rf-public-success"><i>✓</i><strong>已提交：${escapeHtml(item.response)}</strong><p>Offer文件可随时在上方查看。</p><small>本链接不能重复答复。</small></div>`:'<textarea id="rf-public-offer-note" placeholder="可选：填写答复说明"></textarea><p id="rf-public-offer-message"></p>'}`;if(!answered){document.querySelector('[data-public-offer-accept]').addEventListener('click',()=>respondPublicOffer(token,'accept'));document.querySelector('[data-public-offer-reject]').addEventListener('click',()=>respondPublicOffer(token,'reject'))}}catch(error){document.querySelector('.rf-public-offer').innerHTML=`<div class="rf-public-failed"><strong>无法打开Offer</strong><p>${escapeHtml(conciseError(error))}</p></div>`}}
  async function respondPublicOffer(token, response) {
    const root = document.querySelector('.rf-public-offer');
    if (!root || root.dataset.responding === 'true') return;
    const message = document.getElementById('rf-public-offer-message');
    const buttons = [...root.querySelectorAll('[data-public-offer-accept], [data-public-offer-reject]')];
    root.dataset.responding = 'true';
    buttons.forEach(button => { button.disabled = true; });
    message.setAttribute('aria-live', 'polite');
    message.textContent = '正在提交答复，请不要关闭页面…';
    try {
      const result = await request(`api/public/offers/${encodeURIComponent(token)}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response, note: document.getElementById('rf-public-offer-note')?.value.trim() || '' }) });
      root.innerHTML = `<div class="rf-public-success"><i>✓</i><strong>已提交：${escapeHtml(result.response)}</strong><p>招聘流程已进入 ${escapeHtml(result.targetStage)}，招聘负责人会继续与你联系。</p><small>本链接不能重复答复。</small></div>`;
      root.scrollIntoView({ block: 'start' });
    } catch (error) {
      message.textContent = `${error.message || '答复失败'}。说明已保留，请重试。`;
      message.scrollIntoView({ block: 'nearest' });
      buttons.forEach(button => { button.disabled = false; });
    } finally {
      root.dataset.responding = 'false';
    }
  }

  // 候选人从邮件链接进入的第一屏：预约信息和基本信息完善收在一个安全链接内。
  async function renderPublicInterview(token) {
    document.body.className = 'rf-public-assessment-body rf-invitation-page';
    document.body.innerHTML = '<main class="rf-public-interview"><div class="rf-dialog-loading">正在安全加载面试邀请…</div></main>';
    try {
      const item = await request(`api/public/interviews/${encodeURIComponent(token)}`);
      const profile = item.candidateProfile || {};
      const value = (key) => escapeHtml(profile[key] || '');
      const confirmationStatus = item.confirmationStatus || '已确认';
      const confirmed = item.status !== '已取消' && confirmationStatus !== '已取消' && confirmationStatus !== '已拒绝';
      const reschedulePending = confirmationStatus === '改期审批中' || item.reschedule?.status === '待审批';
      const confirmationTitle = reschedulePending ? '改期申请已提交' : '面试已安排';
      const confirmationDetail = reschedulePending
        ? '招聘负责人会与你确认新时间。在收到新的安排前，原面试安排仍然有效。'
        : '请核对面试安排并按约定时间参加；如需调整，可在本页申请改期。';
      const preferredTimes = (item.reschedule?.preferredTimes || []).filter(Boolean);

      document.querySelector('.rf-public-interview').innerHTML = `
        <header class="rf-public-invite-hero">
          <span class="rf-invitation-brand">方片新媒体 <small>FANGPIAN · CAREERS</small></span>
          <div class="rf-invitation-eyebrow">面试邀请函</div>
          <h1>${escapeHtml(confirmationTitle)}</h1>
          <p>${escapeHtml(`${item.candidateName || '候选人'}，${confirmationDetail}`)}</p>
          <div class="rf-public-invite-mark"><small>第一次见面，从了解彼此开始</small></div>
        </header>
        <div class="rf-invitation-section-heading"><h2>与你的面试安排</h2><span>${escapeHtml(item.round || '面试')} · ${escapeHtml(item.mode || '线下面试')}</span></div>
        <section class="rf-public-interview-card rf-public-invite-card">
          <div><span>面试时间</span><strong>${escapeHtml(formatShanghaiDateTime(item.startAt))}</strong><small>北京时间${item.endAt ? ` · 结束于 ${escapeHtml(formatShanghaiDateTime(item.endAt))}` : ''}</small></div>
          <div><span>面试地点</span><strong>${escapeHtml(item.location || '山东省烟台市莱山区方片新媒体')}</strong><small>${escapeHtml(item.mode || '线下面试')}</small>${/^https?:\/\//i.test(item.meetingUrl || '') ? `<a class="rf-public-meeting-link" href="${escapeHtml(item.meetingUrl)}" target="_blank" rel="noopener">进入会议 ↗</a>` : ''}</div>
          <div><span>面试官</span><strong>${(item.interviewers || []).map(escapeHtml).join('、') || '待确认'}</strong><small>期待与你交流</small></div>
          <div><span>温馨提示</span><strong>${escapeHtml(item.note || '请提前 10 分钟做好准备')}</strong><small>${item.preparationStatus === '已提交' ? '基本信息已提交，可在下方更新' : '请在下方补充基本信息'}</small></div>
        </section>
        <section class="rf-public-confirmation-state ${reschedulePending ? 'pending' : 'confirmed'}"><i>${reschedulePending ? '…' : '✓'}</i><div><span>${escapeHtml(reschedulePending ? '改期审批中' : '面试已确认')}</span><strong>${escapeHtml(confirmationTitle)}</strong><p>${escapeHtml(confirmationDetail)}</p>${!reschedulePending && item.confirmedAt ? `<small>创建时间：${escapeHtml(formatShanghaiDateTime(item.confirmedAt))}</small>` : ''}${reschedulePending ? `<small>申请原因：${escapeHtml(item.reschedule?.reason || '')}${preferredTimes.length ? ` · 期望 ${preferredTimes.map((time) => escapeHtml(formatShanghaiDateTime(time))).join('、')}` : ''}</small>` : ''}</div></section>
        <section class="rf-public-preparation-intro"><b>面试前的小准备</b><p>请补充年龄、工作年限、学历、性别和手机号，方便招聘团队确认面试资料。</p><span>约 1 分钟 · 仅用于本次招聘流程</span></section>
        <form id="rf-public-interview-preparation" class="rf-public-preparation-form">
          <section><div class="rf-public-form-title"><b>01</b><div><strong>完善基本信息</strong><small>只需补充以下五项信息，已有内容会自动带入。</small></div></div>
            <div class="rf-public-preparation-grid">
              <label><span>手机号 *</span><input name="phone" inputmode="tel" maxlength="11" value="${value('phone')}" required></label>
              <label><span>年龄 *</span><input name="age" type="number" min="16" max="80" value="${value('age')}" required></label>
              <label><span>工作年限 *</span><input name="yearsOfExperience" value="${value('yearsOfExperience')}" placeholder="如：3年 / 应届" required></label>
              <label><span>最高学历 *</span><select name="highestEducation" required><option value="">请选择</option>${['高中及以下', '大专', '本科', '硕士', '博士', '其他'].map((option) => '<option value="' + escapeHtml(option) + '" ' + (profile.highestEducation === option ? 'selected' : '') + '>' + escapeHtml(option) + '</option>').join('')}</select></label>
              <label><span>性别 *</span><select name="gender" required><option value="">请选择</option>${['男', '女'].map((option) => '<option value="' + escapeHtml(option) + '" ' + (profile.gender === option ? 'selected' : '') + '>' + escapeHtml(option) + '</option>').join('')}</select></label>
            </div>
          </section>
          <footer class="rf-public-preparation-actions"><div><strong>提交后自动保存</strong><small>${reschedulePending ? '当前处于改期审批中，仍可补充或更新基本信息。' : '信息仅用于面试资料，不改变你的面试安排。'}</small></div><div><button class="btn-primary" type="submit">${item.preparationStatus === '已提交' ? '更新基本信息' : '提交基本信息'}</button></div></footer>
        </form>
        ${confirmed ? `<section class="rf-public-reschedule" hidden><header><strong>申请改期</strong><small>提交后会立即通知HR群；HR批准前，当前面试安排不会变更。</small></header><label><span>改期原因 *</span><textarea id="rf-public-reschedule-reason" placeholder="请说明无法按原安排参加的原因"></textarea></label><label><span>期望面试时间 *</span><input id="rf-public-preferred-time" type="datetime-local" min="${localDateValue(new Date())}T00:00"></label><button class="btn-primary" data-public-submit-reschedule type="button">提交给HR确认</button></section>` : ''}
        <div class="rf-public-interview-footer"><button class="rf-public-text-action" data-public-interview-reschedule>时间不便，申请改期</button><span>方片新媒体招聘团队</span></div><p id="rf-public-interview-message"></p>`;
      const message = () => document.getElementById('rf-public-interview-message');
      document.getElementById('rf-public-interview-preparation')?.addEventListener('submit', (event) => submitInterviewPreparation(event, token));
      const revealResponse = selector => {
        const section = document.querySelector(selector);
        section.hidden = false;
        section.scrollIntoView({ block: 'start', behavior: 'auto' });
        section.querySelector('textarea')?.focus({ preventScroll: true });
      };
      document.querySelector('[data-public-interview-reschedule]')?.addEventListener('click', () => revealResponse('.rf-public-reschedule'));
      document.querySelector('[data-public-submit-reschedule]')?.addEventListener('click', async (event) => { const button = event.currentTarget, reason = document.getElementById('rf-public-reschedule-reason')?.value.trim() || '', preferred = document.getElementById('rf-public-preferred-time')?.value || ''; try { if (!reason) throw new Error('请填写改期原因。'); if (!preferred) throw new Error('请选择期望面试时间。'); button.disabled = true; button.textContent = '正在提交并通知HR群…'; await request(`api/public/interviews/${encodeURIComponent(token)}/reschedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, preferredTimes: [shanghaiDateTimeIso(preferred)] }) }); await renderPublicInterview(token); } catch (error) { button.disabled = false; button.textContent = '提交给HR确认'; message().textContent = conciseError(error); } });
    } catch (error) { const reason = conciseError(error); document.querySelector('.rf-public-interview').innerHTML = reason.includes('已取消') ? `<div class="rf-public-success"><i>✕</i><strong>本次面试已取消</strong><p>该面试安排已取消，此链接已失效。如有疑问请联系招聘负责人。</p></div>` : `<div class="rf-public-failed"><strong>无法打开面试邀请</strong><p>${escapeHtml(reason)}</p></div>`; }
  }

  async function submitInterviewPreparation(event, token) {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form), message = document.getElementById('rf-public-interview-message');
    const button = form.querySelector('button[type="submit"]');
    const buttonLabel = button?.textContent || '';
    const profile = Object.fromEntries(['phone', 'yearsOfExperience', 'highestEducation', 'gender', 'age'].map((key) => [key, String(data.get(key) || '').trim()]));
    try {
      if (button) button.disabled = true;
      if (button) button.textContent = '正在保存基本信息…';
      if (message) message.textContent = '正在安全保存基本信息…';
      await request(`api/public/interviews/${encodeURIComponent(token)}/preparation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) });
      await renderPublicInterview(token);
    } catch (error) { if (message) message.textContent = conciseError(error); if (button) { button.disabled = false; button.textContent = buttonLabel; } }
  }

  async function renderPublicCommunication(token) {
    document.body.className='rf-public-assessment-body rf-public-communication-body';
    document.body.innerHTML='<main class="rf-public-assessment"><div class="rf-dialog-loading">正在安全加载意向沟通表单…</div></main>';
    try {
      const item = await request(`api/public/interviews/communication?token=${encodeURIComponent(token)}`);
      const groups = [
        {
          title: '联系结果',
          description: '先记录本次联系是否有效，以及候选人的基础意向。',
          fields: [
            ['channel','沟通渠道','select',['电话','微信','邮件','短信','当面','其他']],
            ['answerStatus','接通状态','select',['已接通','未接听','拒接','关机','空号','微信回复']],
            ['interestLevel','兴趣度','select',['高','中','低','拒绝']],
            ['jobStatus','在职状态','select',['已离职','在职已提离职','在职未提离职','应届生']],
            ['result','沟通结果','select',['推进面试','放入人才库','淘汰','二次沟通']],
          ],
        },
        {
          title: '到岗与离职',
          description: '了解候选人的变动原因和可到岗节奏。',
          fields: [
            ['entryTime','可到岗时间','text'],
            ['leaveReason','离职原因','select',['薪资','发展','管理','家庭','通勤','公司变动','其他']],
            ['leaveReasonDetail','离职原因详情','textarea'],
          ],
        },
        {
          title: '经历与关注点',
          description: '补充岗位判断需要的事实，未提到的内容可以留空。',
          fields: [
            ['homeAddress','居住区域','textarea'],
            ['workContent','主要职责','textarea'],
            ['currentSalaryInfo','当前薪酬整体情况','textarea'],
            ['candidateConcerns','候选人关注点/顾虑','textarea'],
          ],
        },
        {
          title: '工作节奏与约面',
          description: '确认工作节奏接受度，并记录候选人的面试安排。',
          fields: [
            ['overtimeIntensity','当前公司加班强度','textarea'],
            ['overtimeAttitude','对加班的看法/接受度','textarea'],
            ['interviewType','约面形式','select',['待定','线上','线下']],
            ['interviewTime','方便面试时间','text'],
            ['notes','沟通备注','textarea'],
          ],
        },
      ];
      const placeholders = {
        entryTime: '例如：两周内 / 随时到岗',
        interviewTime: '例如：工作日 19:00 后',
        leaveReasonDetail: '记录候选人提到的具体原因',
        homeAddress: '记录大致居住区域或通勤情况',
        workContent: '概括当前岗位的核心职责',
        currentSalaryInfo: '记录候选人主动提到的薪酬构成',
        candidateConcerns: '例如：薪资、发展空间、通勤距离',
        overtimeIntensity: '记录当前公司的加班频率和时长',
        overtimeAttitude: '记录候选人对工作节奏的真实态度',
        notes: '补充本次沟通的重点、语气或后续事项',
      };
      const requiredFields = new Set(['channel', 'answerStatus', 'interestLevel', 'jobStatus', 'result']);
      const control = ([key,label,type,options]) => {
        const required = requiredFields.has(key);
        const title = `${label}${required ? ' <b>*</b>' : ''}`;
        if (type === 'select') return `<label><span>${title}</span><select name="${key}" ${required ? 'required' : ''}><option value="">请选择</option>${(options||[]).map(x=>`<option value="${x}">${x}</option>`).join('')}</select></label>`;
        if (type === 'textarea') return `<label class="rf-public-textarea"><span>${title}</span><textarea name="${key}" ${required ? 'required' : ''} placeholder="${escapeHtml(placeholders[key] || '请记录沟通中提到的内容')}"></textarea></label>`;
        return `<label><span>${title}</span><input name="${key}" type="text" ${required ? 'required' : ''} placeholder="${escapeHtml(placeholders[key] || '')}"></label>`;
      };
      const expiryDate = new Date(item.expiresAt);
      const expiryText = Number.isNaN(expiryDate.getTime()) ? item.expiresAt : expiryDate.toLocaleString('zh-CN', { hour12: false });
      document.querySelector('.rf-public-assessment').innerHTML=`
        <header class="rf-public-communication-hero">
          <div>
            <span class="rf-public-communication-eyebrow"><i></i> RECRUITMENT WORKFLOW</span>
            <h1>意向沟通记录</h1>
            <p>把通话或其他沟通方式中确认到的信息快速沉淀下来，为后续约面提供依据。</p>
          </div>
          <aside class="rf-public-communication-candidate">
            <small>当前候选人</small>
            <strong>${escapeHtml(item.candidateName)}</strong>
            <span>${escapeHtml(item.role || '岗位待确认')}</span>
            <em>有效至 ${escapeHtml(expiryText || '待确认')}</em>
          </aside>
        </header>
        <form id="rf-public-communication" class="rf-public-preparation-form rf-public-communication-form">
          <div class="rf-public-communication-scroll">
            <section class="rf-public-communication-intro">
              <div><b>沟通提示</b><p>只填写候选人明确提到的内容；未提到的字段可以留空，不需要猜测。</p></div>
              <span>预计 3–5 分钟</span>
            </section>
            <section class="rf-public-communication-ai">
              <label class="rf-public-communication-ai-label" for="rf-public-communication-transcript">AI解析沟通原文</label>
              <textarea id="rf-public-communication-transcript" maxlength="20000" placeholder="例如：电话已接通，候选人目前在职已提离职，对岗位兴趣较高，预计两周内到岗，目前薪资……"></textarea>
              <div class="rf-public-communication-ai-tools">
                <button type="button" data-rf-public-communication-extract><span>AI解析并填充</span></button>
              </div>
              <p id="rf-public-communication-extract-status" aria-live="polite">解析后请人工检查，未提到的字段会保持为空。</p>
            </section>
            ${groups.map((group, index) => `
              <section class="rf-public-communication-section">
                <div class="rf-public-form-title">
                  <b>${String(index + 1).padStart(2, '0')}</b>
                  <div><strong>${escapeHtml(group.title)}</strong><small>${escapeHtml(group.description)}</small></div>
                </div>
                <div class="rf-public-preparation-grid">${group.fields.map(control).join('')}</div>
              </section>`).join('')}
          </div>
          <footer class="rf-public-preparation-actions rf-public-communication-actions">
            <div><strong>提交后自动推进流程</strong><small>系统会保存沟通记录，并向招聘团队发送约面提醒。</small><p id="rf-public-communication-message"></p></div>
            <button class="btn-primary" type="submit">提交意向沟通</button>
          </footer>
        </form>`;
      const form = document.getElementById('rf-public-communication');
      const transcript = document.getElementById('rf-public-communication-transcript');
      const extractStatus = document.getElementById('rf-public-communication-extract-status');
      const extractButton = document.querySelector('[data-rf-public-communication-extract]');
      extractButton?.addEventListener('click', async () => {
        const content = transcript?.value.trim() || '';
        if (!content) {
          if (extractStatus) { extractStatus.textContent = '请先粘贴沟通文字。'; extractStatus.classList.add('error'); }
          transcript?.focus();
          return;
        }
        extractButton.disabled = true;
        extractStatus?.classList.remove('error', 'success');
        if (extractStatus) extractStatus.textContent = 'AI正在分析沟通内容，请稍候…';
        try {
          const result = await requestCommunicationExtraction(`api/public/interviews/communication/extract?token=${encodeURIComponent(token)}`, content, extractStatus);
          if (!form.isConnected) return;
          const extraction = result.extraction || {};
          let filled = 0;
          const fill = (name, value) => {
            if (!value) return;
            const field = form.elements.namedItem(name);
            if (!field) return;
            if (field.tagName === 'SELECT' && ![...field.options].some((option) => option.value === value)) return;
            field.value = value;
            field.closest('label')?.classList.add('is-ai-filled');
            filled += 1;
          };
          ['channel','answerStatus','interestLevel','jobStatus','result','entryTime','leaveReason','leaveReasonDetail','homeAddress','workContent','currentSalaryInfo','candidateConcerns','overtimeIntensity','overtimeAttitude','interviewType','interviewTime','notes'].forEach((name) => fill(name, extraction[name]));
          if (extractStatus) {
            extractStatus.textContent = filled ? `解析完成，已自动填写 ${filled} 项。请检查后再提交。` : '解析完成，但文本中没有识别到可填写的信息。';
            extractStatus.classList.toggle('success', filled > 0);
          }
        } catch (error) {
          if (extractStatus) { extractStatus.textContent = `${conciseError(error)}。原文和已填写内容已保留，可重试或手动填写。`; extractStatus.classList.add('error'); }
        } finally {
          extractButton.disabled = false;
        }
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submittedForm = event.currentTarget, message = document.getElementById('rf-public-communication-message'), button = submittedForm.querySelector('button[type="submit"]');
        const payload = Object.fromEntries(new FormData(submittedForm).entries());
        const transcript = document.getElementById('rf-public-communication-transcript')?.value.trim() || '';
        if (transcript) payload.notes = transcript;
        try { button.disabled=true; message.textContent='正在提交…'; const saved = await request(`api/public/interviews/communication?token=${encodeURIComponent(token)}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...payload, candidateId:item.candidateId }) }); submittedForm.dataset.mobileDirty = 'false'; document.querySelector('.rf-public-assessment').innerHTML = '<div class="rf-public-success"><i aria-hidden="true">✓</i><strong>意向沟通已提交</strong><p id="rf-public-communication-message">已提交，请留意系统消息</p></div>'; window.scrollTo({ top: 0, behavior: 'auto' }); showCommunicationCompletion(saved.candidateId || item.candidateId, true); } catch (error) { message.textContent=conciseError(error); button.disabled=false; }
      });
    } catch (error) {
      document.querySelector('.rf-public-assessment').innerHTML=`<div class="rf-public-failed"><strong>无法打开意向沟通表单</strong><p>${escapeHtml(conciseError(error))}</p></div>`;
    }
  }

  async function renderPublicEvaluation(token) {
    document.body.className = 'rf-public-assessment-body';
    document.body.innerHTML = '<main class="rf-public-assessment"><div class="rf-dialog-loading">正在安全加载面试评价表…</div></main>';
    try {
      const item = await request(`api/interview-evaluations/public?token=${encodeURIComponent(token)}`);
      document.querySelector('.rf-public-assessment').innerHTML = `
        <header>
          <div><span>FANGPIAN INTERVIEW REVIEW</span><h1>面试评价</h1><p>${escapeHtml(item.candidateName || '候选人')} · ${escapeHtml(item.role || '岗位待确认')} · ${escapeHtml(item.round || '本轮')}</p><small>面试官：${escapeHtml(item.interviewerName || '待确认')} · 面试时间：${escapeHtml(formatShanghaiDateTime(item.startAt) || '待确认')}</small></div>
        </header>
        <form id="rf-public-evaluation-form" class="rf-public-preparation-form">
          <section class="rf-public-interview-record"><div class="rf-public-form-title"><b>记</b><div><strong>面试过程记录 / 会议总结</strong><small>粘贴完整记录后生成评价；停止输入后会自动保存草稿。</small></div></div>
            <textarea name="transcript" maxlength="20000" rows="8" placeholder="记录关键问答、候选人原话和事实证据，或粘贴会议转写 / 总结。"></textarea>
            <div class="rf-public-record-actions"><button class="btn-primary" data-public-record-extract type="button">会议总结转评价</button></div>
            <p data-public-record-status role="status" aria-live="polite">尚未修改，可随时保存过程记录。</p>
          </section>
          <section><div class="rf-public-form-title"><b>01</b><div><strong>面试结论</strong><small>AI会从记录中提取，可人工确认或修改。</small></div></div>
            <div class="rf-public-preparation-grid"><label><span>面试结论 *</span><select name="recommendation" required><option value="">请选择</option><option>通过</option><option>淘汰</option><option>加面</option><option>储备</option><option>待讨论</option></select></label><label><span>候选人评级 *</span><select name="candidateRating" required><option value="">请选择评级</option><option value="S">S</option><option value="a">a</option><option value="b">b</option><option value="c">c</option><option value="z">z</option></select></label></div>
          </section>
          <section><div class="rf-public-form-title"><b>02</b><div><strong>AI面试总结 *</strong><small>需先使用会议总结转换生成，可人工调整；不会代替面试官评价。</small></div></div>
            <label class="rf-public-textarea"><textarea name="aiSummary" rows="5" placeholder="请先点击“会议总结转评价”生成，再核对或修改"></textarea></label>
          </section>
          <section><div class="rf-public-form-title"><b>03</b><div><strong>面试官评价 *（至少50字）</strong><small>请由面试官本人填写，可自行修改；此项不由AI生成。</small></div></div>
            <label class="rf-public-textarea"><textarea name="interviewerEvaluation" required rows="7" placeholder="至少填写50字，结合实际回答、岗位匹配度、优势与风险独立评价"></textarea><small data-interviewer-evaluation-count aria-live="polite"></small></label>
          </section>
          <footer class="rf-public-preparation-actions"><div><strong>提交后链接立即失效</strong><small>提交前请确认面试结论和评价内容准确。</small></div><button class="btn-primary" type="submit">提交面试评价</button></footer>
        </form><p id="rf-public-evaluation-message"></p>`;
      const evaluationForm = document.getElementById('rf-public-evaluation-form');
      const recordStatus = evaluationForm.querySelector('[data-public-record-status]');
      const interviewerEvaluationField = evaluationForm.elements.interviewerEvaluation;
      const collectDraft = () => {
        const draft = Object.fromEntries(new FormData(evaluationForm).entries());
        draft.questionAnswers = {};
        return draft;
      };
      let convertedTranscript = '';
      if (item.draft) {
        Object.entries(item.draft).forEach(([key, value]) => { const field = evaluationForm.elements.namedItem(key); if (field && typeof value === 'string') field.value = value; });
        if (item.draft.comment && !item.draft.aiSummary) evaluationForm.elements.aiSummary.value = item.draft.comment;
        recordStatus.textContent = '已恢复上次草稿；提交前请重新点击“会议总结转评价”生成AI面试总结。';
      }
      bindInterviewEvaluationCounter(interviewerEvaluationField, evaluationForm.querySelector('[data-interviewer-evaluation-count]'));
      let saveTimer;
      let saveChain = Promise.resolve();
      let submitting = false;
      const saveDraft = () => {
        clearTimeout(saveTimer);
        if (submitting) return saveChain;
        const draft = collectDraft();
        recordStatus.textContent = '正在保存草稿…';
        saveChain = saveChain.catch(() => {}).then(async () => {
          await request(`api/interview-evaluations/public/draft?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
          recordStatus.textContent = `草稿已保存 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
        }).catch((error) => { recordStatus.textContent = `草稿保存失败：${conciseError(error)}。请稍后重试。`; throw error; });
        return saveChain;
      };
      evaluationForm.addEventListener('input', (event) => {
        if (submitting) return;
        if (event.target === evaluationForm.elements.transcript && convertedTranscript && evaluationForm.elements.transcript.value.trim() !== convertedTranscript) convertedTranscript = '';
        recordStatus.textContent = convertedTranscript ? '内容已修改，等待自动保存…' : '记录变化后需重新生成AI面试总结；内容将自动保存。';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveDraft().catch(() => {}), 1000);
      });
      evaluationForm.querySelector('[data-public-record-extract]').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const transcript = evaluationForm.elements.transcript.value.trim();
        if (!transcript) { recordStatus.textContent = '请先填写面试记录或粘贴会议总结。'; evaluationForm.elements.transcript.focus(); return; }
        try {
          button.disabled = true;
          await saveDraft();
          recordStatus.textContent = '正在整理会议总结，请稍候…';
          const result = await requestCommunicationExtraction(`api/interview-evaluations/public/extract?token=${encodeURIComponent(token)}`, transcript, recordStatus);
          if (!evaluationForm.isConnected) return;
          const aiSummary = String(result.extraction?.comment || '').trim();
          if (!aiSummary) throw new Error('AI未生成面试总结，请补充会议记录后重试。');
          if (result.extraction?.recommendation) evaluationForm.elements.recommendation.value = result.extraction.recommendation;
          evaluationForm.elements.aiSummary.value = aiSummary;
          convertedTranscript = transcript;
          await saveDraft();
          recordStatus.textContent = '已生成AI面试总结；请核对后，再填写面试官评价。';
          evaluationForm.elements.aiSummary.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch (error) { recordStatus.textContent = conciseError(error); }
        finally { button.disabled = false; }
      });
      evaluationForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const message = document.getElementById('rf-public-evaluation-message');
        const button = form.querySelector('button[type="submit"]');
        const data = new FormData(form);
        const body = {
          scores: {}, recommendation: String(data.get('recommendation') || ''), candidateRating: String(data.get('candidateRating') || ''),
          aiSummary: String(data.get('aiSummary') || '').trim(), interviewerEvaluation: String(data.get('interviewerEvaluation') || '').trim(),
          otherRoles: '', strengths: '', risks: '', comment: String(data.get('interviewerEvaluation') || '').trim(),
          notes: String(data.get('transcript') || ''), questionAnswers: {}, evidence: { transcript: String(data.get('transcript') || '') },
        };
        const transcript = body.notes.trim();
        if (!transcript || convertedTranscript !== transcript || !body.aiSummary) {
          message.textContent = '请粘贴会议总结并点击“会议总结转评价”生成AI面试总结后再提交。';
          evaluationForm.elements.transcript.focus();
          return;
        }
        const evaluationLength = countInterviewEvaluationCharacters(body.interviewerEvaluation);
        if (evaluationLength < 50) {
          message.textContent = `面试官评价至少填写50字（不含空白），当前${evaluationLength}字。`;
          interviewerEvaluationField.focus();
          return;
        }
        try {
          button.disabled = true;
          submitting = true;
          clearTimeout(saveTimer);
          await saveChain.catch(() => {});
          message.textContent = '正在提交评价，请不要关闭页面…';
          const result = await request(`api/interview-evaluations/public?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          const score = Number(result.overall || 0);
          document.querySelector('.rf-public-assessment').innerHTML = `<div class="rf-public-success"><i>✓</i><strong>面试评价已提交</strong><p>候选人评级：${escapeHtml(body.candidateRating)}。${score ? `本次综合评分：${score} 分。` : ''}感谢你完成面试评价。</p><small>本链接已经失效，无需重复提交。</small></div>`;
        } catch (error) {
          button.disabled = false;
          submitting = false;
          message.textContent = conciseError(error);
        }
      });
    } catch (error) {
      document.querySelector('.rf-public-assessment').innerHTML = `<div class="rf-public-failed"><strong>无法打开面试评价表</strong><p>${escapeHtml(conciseError(error))}</p><small>请联系招聘负责人确认链接是否过期或已提交。</small></div>`;
    }
  }

  async function renderPublicOnboardingReview(token) {
    document.body.className = 'rf-public-assessment-body';
    document.body.innerHTML = '<main class="rf-public-assessment"><div class="rf-dialog-loading">正在安全加载入职评价表…</div></main>';
    try {
      const item = await request(`api/employee-lifecycle/reviews/public?token=${encodeURIComponent(token)}`);
      const isMonthlyReview = item.nodeType === '入职一月评价';
      const reviewFields = isMonthlyReview ? `
            <div class="rf-public-preparation-grid rf-onboarding-review-grid">
              <label><span>述职评级 *</span><select name="performanceRating" required><option value="">请选择</option>${['S','A','B'].map((value) => `<option ${item.performanceRating === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
              <label><span>新人成长等级 *</span><input name="growthLevel" list="rf-growth-levels" value="${escapeHtml(item.growthLevel || '')}" required placeholder="请选择或输入成长等级"><datalist id="rf-growth-levels"><option value="快速成长"><option value="稳定成长"><option value="达到预期"><option value="需要辅导"></datalist></label>
            </div>
            <label class="rf-public-textarea"><span>述职评价 *</span><textarea name="appraisal" required placeholder="请填写新人入职一个月后的工作成果、适应情况、成长表现和后续培养建议">${escapeHtml(item.appraisal || '')}</textarea></label>` : `
            <label><span>绩效评分 *</span><input name="score" type="number" min="0" max="100" value="${Number(item.score || 0) || ''}" required placeholder="0-100"></label>
            <label class="rf-public-textarea"><span>负责人评价 *</span><textarea name="managerReview" required placeholder="请填写工作表现、适应情况、优势和需要支持的地方">${escapeHtml(item.managerReview || '')}</textarea></label>
            <label class="rf-public-textarea"><span>员工反馈</span><textarea name="employeeFeedback" placeholder="可填写员工本人反馈、诉求或沟通记录">${escapeHtml(item.employeeFeedback || '')}</textarea></label>
            <label><span>后续建议 *</span><select name="recommendation" required><option value="">请选择</option>${['继续观察','转正','延长试用期','不予转正'].map((value) => `<option ${item.recommendation === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>`;
      document.querySelector('.rf-public-assessment').innerHTML = `
        <header><div><span>FANGPIAN EMPLOYEE REVIEW</span><h1>${escapeHtml(item.nodeType || '入职评价')}</h1><p>${escapeHtml(item.candidateName || '员工')} · ${escapeHtml(item.role || '岗位待确认')} · ${escapeHtml(item.department || '部门待确认')}</p><small>计划日期：${escapeHtml(item.plannedDate || '待确认')}</small></div></header>
        <form id="rf-public-onboarding-review-form" class="rf-public-preparation-form">
          <section><div class="rf-public-form-title"><b>01</b><div><strong>${isMonthlyReview ? '新人入职一个月述职评价' : '入职阶段评价'}</strong><small>${isMonthlyReview ? '请填写述职评级、新人成长等级和述职评价，结果会进入人才档案。' : '请根据实际工作表现填写，评价会写入员工生命周期记录。'}</small></div></div>${reviewFields}</section>
          <footer class="rf-public-preparation-actions"><div><strong>提交后链接立即失效</strong><small>请确认评价内容准确后再提交。</small></div><button class="btn-primary" type="submit">提交入职评价</button></footer>
        </form><p id="rf-public-onboarding-review-message"></p>`;
      document.getElementById('rf-public-onboarding-review-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const message = document.getElementById('rf-public-onboarding-review-message');
        const button = form.querySelector('button[type="submit"]');
        const data = new FormData(form);
        try {
          button.disabled = true;
          message.textContent = '正在提交入职评价，请不要关闭页面…';
          const body = isMonthlyReview
            ? { performanceRating: String(data.get('performanceRating') || ''), growthLevel: String(data.get('growthLevel') || '').trim(), appraisal: String(data.get('appraisal') || '').trim(), operator: '入职评价链接' }
            : { score: Number(data.get('score')), managerReview: String(data.get('managerReview') || '').trim(), employeeFeedback: String(data.get('employeeFeedback') || '').trim(), recommendation: String(data.get('recommendation') || ''), operator: '入职评价链接' };
          const result = await request(`api/employee-lifecycle/reviews/public?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          document.querySelector('.rf-public-assessment').innerHTML = `<div class="rf-public-success"><i>✓</i><strong>入职评价已提交</strong><p>${isMonthlyReview ? `述职评级 ${escapeHtml(result.performanceRating || '')}，新人成长等级 ${escapeHtml(result.growthLevel || '')}。` : '员工生命周期记录已更新，感谢你的填写。'}</p><small>本链接已经失效，无需重复提交。</small></div>`;
        } catch (error) {
          button.disabled = false;
          message.textContent = conciseError(error);
        }
      });
    } catch (error) {
      document.querySelector('.rf-public-assessment').innerHTML = `<div class="rf-public-failed"><strong>无法打开入职评价表</strong><p>${escapeHtml(conciseError(error))}</p><small>请联系招聘负责人确认链接是否过期或已提交。</small></div>`;
    }
  }

  async function renderPublicOnboardingArrival(token) {
    document.body.className = 'rf-public-assessment-body';
    document.body.innerHTML = '<main class="rf-public-assessment"><div class="rf-dialog-loading">正在安全加载到岗确认表…</div></main>';
    try {
      const item = await request(`api/employee-lifecycle/onboarding/arrival/public?token=${encodeURIComponent(token)}`);
      document.querySelector('.rf-public-assessment').innerHTML = `
        <header><div><span>FANGPIAN ONBOARDING</span><h1>确认到岗状态</h1><p>${escapeHtml(item.candidateName || '候选人')} · ${escapeHtml(item.role || '岗位待确认')} · ${escapeHtml(item.department || '部门待确认')}</p><small>计划入职日期：${escapeHtml(item.plannedStartDate || '待确认')}</small></div></header>
        <form id="rf-public-arrival-form" class="rf-public-preparation-form">
          <section><div class="rf-public-form-title"><b>01</b><div><strong>请确认候选人是否已到岗</strong><small>确认后系统会自动进入试用期和入职评价流程。</small></div></div>
            <label><span>到岗状态 *</span><select name="arrived" required><option value="">请选择</option><option value="yes">已到岗</option><option value="no">未到岗</option></select></label>
            <label><span>实际到岗日期</span><input name="actualDate" type="date" value="${escapeHtml(item.plannedStartDate || new Date().toISOString().slice(0, 10))}"></label>
            <label><span>试用期月数</span><input name="probationMonths" type="number" min="1" max="12" value="3"></label>
            <label class="rf-public-textarea"><span>确认说明 *</span><textarea name="note" required placeholder="例如：已于今日办理入职并到岗；如未到岗请说明原因">${escapeHtml(item.note || '')}</textarea></label>
          </section>
          <footer class="rf-public-preparation-actions"><div><strong>提交后链接立即失效</strong><small>请确认信息真实准确。</small></div><button class="btn-primary" type="submit">提交到岗确认</button></footer>
        </form><p id="rf-public-arrival-message"></p>`;
      document.getElementById('rf-public-arrival-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const message = document.getElementById('rf-public-arrival-message');
        const button = form.querySelector('button[type="submit"]');
        const data = new FormData(form);
        const arrived = data.get('arrived') === 'yes';
        try {
          button.disabled = true;
          message.textContent = '正在保存到岗状态，请不要关闭页面…';
          await request(`api/employee-lifecycle/onboarding/arrival/public?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arrived, actualDate: String(data.get('actualDate') || '').trim(), probationMonths: Number(data.get('probationMonths') || 3), note: String(data.get('note') || '').trim(), operator: '到岗确认链接' }) });
          document.querySelector('.rf-public-assessment').innerHTML = `<div class="rf-public-success"><i>✓</i><strong>到岗状态已提交</strong><p>${arrived ? '系统已进入试用期和入职评价流程。' : '系统已记录未到岗状态，招聘团队会继续跟进。'}</p><small>本链接已经失效，无需重复提交。</small></div>`;
        } catch (error) {
          button.disabled = false;
          message.textContent = conciseError(error);
        }
      });
    } catch (error) {
      document.querySelector('.rf-public-assessment').innerHTML = `<div class="rf-public-failed"><strong>无法打开到岗确认表</strong><p>${escapeHtml(conciseError(error))}</p><small>请联系招聘负责人确认链接是否过期或已提交。</small></div>`;
    }
  }

  async function renderPublicAssessment(token) {
    document.body.className = 'rf-public-assessment-body';
    document.body.innerHTML = '<main class="rf-public-assessment"><div class="rf-dialog-loading">正在安全加载测评题单…</div></main>';
    try {
      state.assessmentPublic = await request(`api/public/assessments/${encodeURIComponent(token)}`);
      const item = state.assessmentPublic;
      document.querySelector('.rf-public-assessment').innerHTML = `<header><div><span>FANGPIAN TALENT ASSESSMENT</span><h1>${escapeHtml(item.template.name)}</h1><p>${escapeHtml(item.candidateName || '候选人')}，请独立完成以下内容。答案会自动保存，正式提交后不能修改。</p></div><aside><strong>${item.questions.length}</strong><span>道题 · ${Number(item.template.durationMinutes || 0)}分钟</span><small>链接有效至 ${escapeHtml(item.expiresAt)}</small></aside></header><section class="rf-public-instructions">${escapeHtml(item.template.instructions || '请根据真实经历作答，不要提交原公司机密或他人隐私。')}</section><form id="rf-public-assessment-form">${item.questions.map(publicQuestionHtml).join('')}</form><footer><div><span id="rf-public-save-status">答案将在输入后自动保存</span><progress id="rf-public-progress" max="100" value="0"></progress></div><button class="btn-primary" id="rf-public-submit" type="button">正式提交测评</button></footer><p id="rf-public-message"></p>`;
      bindPublicAssessment(token);
      updatePublicProgress();
    } catch (error) {
      document.querySelector('.rf-public-assessment').innerHTML = `<div class="rf-public-failed"><strong>无法打开测评</strong><p>${escapeHtml(conciseError(error))}</p><small>请联系招聘负责人确认链接是否过期或已经提交。</small></div>`;
    }
  }

  function publicQuestionHtml(item) {
    const saved = item.savedAnswer?.value;
    const head = `<header><span>${item.order}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category)} · ${Number(item.score || 0)}分 ${item.required ? '· 必答' : '· 选答'}</small></div></header>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}`;
    if (item.type === 'single') return `<article class="rf-public-question" data-question-id="${escapeHtml(item.id)}" data-type="single" data-required="${item.required}">${head}<div class="rf-public-options">${item.options.map((option) => `<label><input type="radio" name="q-${escapeHtml(item.id)}" value="${escapeHtml(option)}" ${saved === option ? 'checked' : ''}><span>${escapeHtml(option)}</span></label>`).join('')}</div></article>`;
    if (item.type === 'multiple') return `<article class="rf-public-question" data-question-id="${escapeHtml(item.id)}" data-type="multiple" data-required="${item.required}">${head}<div class="rf-public-options">${item.options.map((option) => `<label><input type="checkbox" value="${escapeHtml(option)}" ${Array.isArray(saved) && saved.includes(option) ? 'checked' : ''}><span>${escapeHtml(option)}</span></label>`).join('')}</div></article>`;
    if (item.type === 'file') return `<article class="rf-public-question" data-question-id="${escapeHtml(item.id)}" data-type="file" data-required="${item.required}">${head}<label class="rf-public-file"><input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png"><strong>${item.savedAnswer?.fileName ? `已上传 ${escapeHtml(item.savedAnswer.fileName)}` : '选择不超过10MB的附件'}</strong><small>请勿上传原公司机密或他人隐私</small></label></article>`;
    return `<article class="rf-public-question" data-question-id="${escapeHtml(item.id)}" data-type="text" data-required="${item.required}">${head}<textarea placeholder="请结合真实经历完整作答">${escapeHtml(saved || '')}</textarea></article>`;
  }

  function bindPublicAssessment(token) {
    const form = document.getElementById('rf-public-assessment-form');
    form.addEventListener('input', () => { updatePublicProgress(); clearTimeout(state.assessmentSaveTimer); state.assessmentSaveTimer = setTimeout(() => savePublicAnswers(token), 700); });
    form.querySelectorAll('input[type="file"]').forEach((input) => input.addEventListener('change', () => uploadPublicAnswerFile(token, input)));
    document.getElementById('rf-public-submit').addEventListener('click', () => submitPublicAssessment(token));
    const sendEvent = (type, detail = {}) => fetch(apiUrl(`api/public/assessments/${encodeURIComponent(token)}/events`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, detail, clientTime: new Date().toISOString() }), keepalive: true }).catch(() => {});
    window.addEventListener('blur', () => sendEvent('页面失焦'));
    window.addEventListener('focus', () => sendEvent('页面恢复'));
    window.addEventListener('offline', () => sendEvent('网络离线'));
    window.addEventListener('online', () => sendEvent('网络恢复'));
    document.addEventListener('copy', () => sendEvent('复制'));
    document.addEventListener('paste', () => sendEvent('粘贴'));
  }

  function collectPublicAnswers() {
    return [...document.querySelectorAll('.rf-public-question')].filter((node) => node.dataset.type !== 'file').map((node) => {
      const type = node.dataset.type; let value = '';
      if (type === 'text') value = node.querySelector('textarea')?.value.trim() || '';
      if (type === 'single') value = node.querySelector('input:checked')?.value || '';
      if (type === 'multiple') value = [...node.querySelectorAll('input:checked')].map((input) => input.value);
      return { questionId: node.dataset.questionId, value };
    });
  }

  async function savePublicAnswers(token) {
    const status = document.getElementById('rf-public-save-status');
    try { if (status) status.textContent = '正在自动保存…'; const result = await request(`api/public/assessments/${encodeURIComponent(token)}/answers`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: collectPublicAnswers(), clientTime: new Date().toISOString() }) }); if (status) status.textContent = `已自动保存 · 完成度 ${Number(result.completion || 0)}%`; }
    catch (error) { if (status) status.textContent = `自动保存失败：${conciseError(error)}`; }
  }

  async function uploadPublicAnswerFile(token, input) {
    const question = input.closest('.rf-public-question'); const file = input.files?.[0]; if (!file) return;
    const label = question.querySelector('.rf-public-file strong');
    try { if (label) label.textContent = '正在安全上传…'; const form = new FormData(); form.append('file', file); await request(`api/public/assessments/${encodeURIComponent(token)}/files/${encodeURIComponent(question.dataset.questionId)}`, { method: 'POST', body: form }); question.dataset.uploaded = 'true'; if (label) label.textContent = `已上传 ${file.name}`; updatePublicProgress(); }
    catch (error) { if (label) label.textContent = conciseError(error); input.value = ''; }
  }

  function updatePublicProgress() {
    const questions = [...document.querySelectorAll('.rf-public-question')];
    const done = questions.filter((node) => node.dataset.type === 'file' ? node.dataset.uploaded === 'true' || node.querySelector('.rf-public-file strong')?.textContent.startsWith('已上传') : (() => { const answer = collectPublicAnswers().find((item) => item.questionId === node.dataset.questionId)?.value; return Array.isArray(answer) ? answer.length : Boolean(answer); })()).length;
    const percent = questions.length ? Math.round(done / questions.length * 100) : 0;
    const progress = document.getElementById('rf-public-progress'); if (progress) progress.value = percent;
  }

  async function submitPublicAssessment(token) {
    const message = document.getElementById('rf-public-message');
    const missing = [...document.querySelectorAll('.rf-public-question[data-required="true"]')].filter((node) => node.dataset.type === 'file' ? node.dataset.uploaded !== 'true' && !node.querySelector('.rf-public-file strong')?.textContent.startsWith('已上传') : (() => { const answer = collectPublicAnswers().find((item) => item.questionId === node.dataset.questionId)?.value; return Array.isArray(answer) ? !answer.length : !answer; })());
    if (missing.length) { missing[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); missing[0].classList.add('missing'); if (message) message.textContent = `还有 ${missing.length} 道必答题未完成。`; return; }
    try { await savePublicAnswers(token); document.getElementById('rf-public-submit').disabled = true; if (message) message.textContent = '正在正式提交，请不要关闭页面…'; const result = await request(`api/public/assessments/${encodeURIComponent(token)}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientTime: new Date().toISOString() }) }); document.querySelector('.rf-public-assessment').innerHTML = `<div class="rf-public-success"><i>✓</i><strong>测评已正式提交</strong><p>用时 ${Math.round(Number(result.durationSeconds || 0) / 60)} 分钟。招聘负责人会结合简历、沟通和人工评分继续处理。</p><small>本链接已经失效，无需重复提交。</small></div>`; }
    catch (error) { document.getElementById('rf-public-submit').disabled = false; if (message) message.textContent = error.message || '提交失败'; }
  }

  async function advanceTalentStage() {
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，发布环境接口可用后才能推进流程。', true);
    const stage = document.getElementById('rf-next-stage')?.value || '';
    const reason = document.getElementById('rf-stage-reason')?.value || '';
    try {
      setTalentMessage('正在保存流程记录…');
      await request(`api/governance/talents/${encodeURIComponent(state.activeId)}/transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage, reason, operator: '当前用户' }) });
      state.talentDetails[state.activeId] = await request(`api/talents/${encodeURIComponent(state.activeId)}`);
      await loadTalentArchive(false);
      setTalentMessage('流程已按合法转换规则推进，并写入不可变生命周期事件。');
    } catch (error) { setTalentMessage(error.message || '流程推进失败', true); }
  }

  async function openAnalysisVersions(candidateId) {
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取AI分析版本和差异…</div>', 'wide');
    try {
      state.analysisVersionData = await request(`api/talents/${encodeURIComponent(candidateId)}/assessment-versions`);
      if (!isTalentDialogCurrent(token)) return;
      state.analysisComparison = state.analysisVersionData.total >= 2 ? await request(`api/talents/${encodeURIComponent(candidateId)}/assessment-versions/compare`) : null;
      if (!isTalentDialogCurrent(token)) return;
      renderAnalysisVersions();
    } catch (error) { dialogFailure('AI分析版本读取失败', error, () => openAnalysisVersions(candidateId), token); }
  }

  function analysisScoreRows(scores = {}, delta = null) {
    const labels = { business: '业务', management: '管理', logic: '逻辑', communication: '沟通', overall: '综合' };
    return Object.entries(labels).map(([key, label]) => `<span><small>${label}</small><strong>${Number(scores[key] || 0)}</strong>${delta ? `<em class="${Number(delta[key] || 0) > 0 ? 'up' : Number(delta[key] || 0) < 0 ? 'down' : ''}">${Number(delta[key] || 0) > 0 ? '+' : ''}${Number(delta[key] || 0)}</em>` : ''}</span>`).join('');
  }

  function renderAnalysisVersions() {
    const data = state.analysisVersionData || { versions: [] }, comparison = state.analysisComparison;
    showTalentDialog(`<header class="rf-dialog-head"><div><span>AI ANALYSIS VERSIONS</span><h2>AI分析版本与差异</h2><p>AI画像由用户在人才档案中按需生成；每次运行都会保留版本、证据和人工确认历史。</p></div><button class="btn-primary" data-ai-rerun type="button">${data.total ? '重新运行AI分析' : '生成人才画像与岗位匹配'}</button></header><div class="rf-ai-version-list">${(data.versions || []).map((version, index) => `<article class="${index === 0 ? 'current' : ''}"><header><div><span>${escapeHtml(version.versionName || `talent-v${version.version}`)}</span><strong>${escapeHtml(version.type || 'AI分析')}</strong></div><b class="${version.runStatus === '规则降级' ? 'warn' : ''}">${escapeHtml(version.runStatus || '成功')}</b></header><p>${escapeHtml(version.summary || '暂无摘要')}</p><div class="rf-ai-version-scores">${analysisScoreRows(version.scores)}</div><footer><span>${escapeHtml(version.confidence || '低')}置信度 · ${escapeHtml(version.reviewStatus || '待人工确认')}</span><small>${escapeHtml(version.modelVersion || '')} · ${Number(version.durationMs || 0)}ms · ${escapeHtml(version.createdAt || '')}</small></footer>${version.reason ? `<aside>运行原因：${escapeHtml(version.reason)}</aside>` : ''}${version.error ? `<aside class="error">降级原因：${escapeHtml(version.error)}</aside>` : ''}</article>`).join('')}</div>${comparison ? `<section class="rf-ai-comparison"><div class="rf-review-title"><strong>${escapeHtml(comparison.from.versionName)} → ${escapeHtml(comparison.to.versionName)}</strong><small>最新两版差异</small></div><div class="rf-ai-version-scores delta">${analysisScoreRows(comparison.to.scores, comparison.scoreDelta)}</div><div class="rf-ai-diff-grid"><article><strong>技能变化</strong><p>新增：${(comparison.skills.added || []).map(escapeHtml).join('、') || '无'}</p><p>移除：${(comparison.skills.removed || []).map(escapeHtml).join('、') || '无'}</p></article><article><strong>推荐岗位变化</strong><p>新增：${(comparison.recommendedRoles.added || []).map(escapeHtml).join('、') || '无'}</p><p>移除：${(comparison.recommendedRoles.removed || []).map(escapeHtml).join('、') || '无'}</p></article><article><strong>风险变化</strong><p>新增：${(comparison.risks.added || []).map(escapeHtml).join('、') || '无'}</p><p>已移除：${(comparison.risks.removed || []).map(escapeHtml).join('、') || '无'}</p></article></div></section>` : `<div class="rf-inline-warning">${data.total ? '当前只有一个AI分析版本，重跑后可查看分数、技能、岗位和风险差异。' : '当前尚未生成人才画像。点击右上角按钮后，系统才会运行AI分析和岗位匹配。'}</div>`}`, 'wide');
    document.querySelector('[data-ai-rerun]')?.addEventListener('click', submitFirstAnalysis);
    document.querySelector('[data-ai-generate]')?.addEventListener('click', submitFirstAnalysis);
  }

  async function submitAllAnalysis() {
    const queueStatus = await request('api/talents/ai-queue/status');
    if (Number(queueStatus.pending || 0) > 0 || queueStatus.running) {
      notifyUser(`AI分析队列正在运行，剩余${Number(queueStatus.pending || 0)}条`, 'info');
      return;
    }
    const result = await request('api/talents/assessment-rerun-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'AI分析规则更新后全量重跑', operator: window.recruitmentCurrentUser?.name || '当前用户' }),
    });
    notifyUser(result.message || '全量AI重跑已启动', 'info');
  }

  async function submitFirstAnalysis() {
    let token = showTalentDialog('<div class="rf-dialog-loading">正在生成人才画像与岗位匹配，请稍候…</div>', 'wide');
    try {
      const started = await request(`api/talents/${encodeURIComponent(state.activeId)}/assessment-rerun`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '首次生成', operator: '当前用户' }) });
      const result = await waitForBackgroundJob(started.jobId, progress => {
        if (isTalentDialogCurrent(token)) token = showTalentDialog(`<div class="rf-dialog-loading">${escapeHtml(progress)}</div>`, 'wide');
      }, { timeoutMessage: 'AI分析仍在后台处理，请稍后在AI版本中查看结果，勿重复生成。' });
      if (!isTalentDialogCurrent(token)) return;
      storeTalentDetail(result.talent);
      renderTalentArchive({ preserveListScroll: true });
      closeTalentDialog();
      openTalentDetailDialog(state.activeId);
      notifyUser(`AI分析${result.version}版本已生成，状态：${result.runStatus}`, result.runStatus === '成功' ? 'success' : 'info');
    } catch (error) { dialogFailure('AI分析生成失败', error, () => openAnalysisVersions(state.activeId), token); }
  }

  function analysisListText(values) { return (values || []).join('\n'); }

  function openAnalysisCorrectionForm() {
    const item = state.talentDetails[state.activeId] || {}, analysis = item.analysis || {}, scores = analysis.scores || {};
    showTalentDialog(`<header class="rf-dialog-head"><div><span>HUMAN REVIEW</span><h2>人工修正AI标签和评分</h2><p>AI原始结论会永久保留；这里保存的是当前生效的人工修正值，并要求填写证据和原因。</p></div></header>${analysis.corrected ? `<div class="rf-inline-warning">当前版本已在 ${escapeHtml(analysis.correction?.correctedAt || '')} 由 ${escapeHtml(analysis.correction?.operator || '人工')} 修正：${escapeHtml(analysis.correction?.reason || '')}</div>` : ''}<div class="rf-dialog-form rf-ai-correction-form"><label class="wide"><span>人才摘要</span><textarea id="rf-ai-correct-summary">${escapeHtml(analysis.summary || '')}</textarea></label><div class="rf-ai-correction-scores"><label><span>业务能力</span><input id="rf-ai-score-business" type="number" min="0" max="100" value="${Number(scores.business || 0)}"></label><label><span>管理能力</span><input id="rf-ai-score-management" type="number" min="0" max="100" value="${Number(scores.management || 0)}"></label><label><span>逻辑能力</span><input id="rf-ai-score-logic" type="number" min="0" max="100" value="${Number(scores.logic || 0)}"></label><label><span>沟通协作</span><input id="rf-ai-score-communication" type="number" min="0" max="100" value="${Number(scores.communication || 0)}"></label><label><span>综合建议</span><input id="rf-ai-score-overall" type="number" min="0" max="100" value="${Number(scores.overall || 0)}"></label></div><label><span>技能标签</span><textarea id="rf-ai-correct-skills" placeholder="每行一个标签">${escapeHtml(analysisListText(analysis.skills))}</textarea></label><label><span>推荐岗位</span><textarea id="rf-ai-correct-roles" placeholder="每行一个岗位">${escapeHtml(analysisListText(analysis.recommendedRoles))}</textarea></label><label><span>优势</span><textarea id="rf-ai-correct-strengths" placeholder="每行一项">${escapeHtml(analysisListText(analysis.strengths))}</textarea></label><label><span>待确认风险</span><textarea id="rf-ai-correct-risks" placeholder="每行一项">${escapeHtml(analysisListText(analysis.risks))}</textarea></label><label class="wide"><span>人工修正原因与依据 <b>*</b></span><textarea id="rf-ai-correct-reason" placeholder="例如：负责人已核对原始简历和项目证明，AI将参与人数误判为直接管理人数"></textarea><small class="rf-schedule-error" hidden></small></label></div><label class="rf-msg-confirm"><input id="rf-ai-correct-confirm" type="checkbox"><span>我已核对简历或面试证据，并确认本次人工修正不会基于年龄、性别等无关因素。</span></label><div class="rf-dialog-actions"><button class="btn-primary" data-ai-correct-submit type="button">保存人工修正</button></div><p class="rf-dialog-message" id="rf-ai-correct-message"></p>`, 'wide');
    document.querySelector('[data-ai-correct-submit]')?.addEventListener('click', submitAnalysisCorrection);
    document.querySelector('#rf-talent-dialog')?.querySelectorAll('#rf-ai-correct-reason, #rf-match-position, #rf-match-reason, #rf-talent-name').forEach((node) => {
      if (node.dataset.moreBound) return;
      node.dataset.moreBound = '1';
      node.closest('label')?.insertAdjacentHTML('beforeend', node.closest('label')?.querySelector('.rf-schedule-error') ? '' : '');
      node.addEventListener('input', () => clearScheduleFieldError(node));
      node.addEventListener('change', () => clearScheduleFieldError(node));
    });

  }

  async function submitAnalysisCorrection() {
    const message = document.getElementById('rf-ai-correct-message'), reason = document.getElementById('rf-ai-correct-reason')?.value.trim() || '';
    markScheduleField(document.getElementById('rf-ai-correct-reason'), reason ? '' : '请填写人工修正原因与依据');
    if (!reason) { document.getElementById('rf-ai-correct-reason')?.focus(); return; }
    if (!document.getElementById('rf-ai-correct-confirm')?.checked) { message.textContent = '请确认已完成证据核对。'; message.classList.add('error'); return; }
    const lines = (id) => [...new Set((document.getElementById(id)?.value || '').split(/[\n,，、；;]+/).map((value) => value.trim()).filter(Boolean))];
    const score = (key) => Number(document.getElementById(`rf-ai-score-${key}`)?.value || 0);
    const body = { reason, operator: '当前用户', summary: document.getElementById('rf-ai-correct-summary')?.value.trim() || '', skills: lines('rf-ai-correct-skills'), recommendedRoles: lines('rf-ai-correct-roles'), strengths: lines('rf-ai-correct-strengths'), risks: lines('rf-ai-correct-risks'), scores: { business: score('business'), management: score('management'), logic: score('logic'), communication: score('communication'), overall: score('overall') } };
    try {
      message.textContent = '正在保存人工覆盖值和审计记录…'; message.classList.remove('error');
      const candidateId = state.activeId;
      const result = await request(`api/talents/${encodeURIComponent(candidateId)}/assessment-correction`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      storeTalentDetail(result.talent); closeTalentDialog(false); renderTalentArchive(); await openTalentDetailDialog(candidateId);
      notifyUser(`已人工修正：${(result.changedFields || []).join('、')}`, 'success');
    } catch (error) { message.textContent = error.message || '人工修正保存失败'; message.classList.add('error'); }
  }

  async function openMatchCorrectionForm() {
    const item = state.talentDetails[state.activeId] || {};
    let positions;
    try { positions = await loadPositionOptions(); }
    catch (error) { return notifyUser(error.message || '岗位数据加载失败', 'error', openMatchCorrectionForm); }
    if (!positions.length) return notifyUser('暂无可选择的岗位，请先在岗位库中维护岗位。', 'error', openMatchCorrectionForm);
    const currentMatch = item.matches?.[0] || null;
    const selectedPosition = positions.find((position) => position.id === currentMatch?.positionId || position.name === currentMatch?.positionName) || positions[0];
    const positionOptions = positions.map((position) => `<option value="${escapeHtml(position.id)}" data-search="${escapeHtml(`${position.name} ${position.department || ''}`)}" ${selectedPosition?.id === position.id ? 'selected' : ''}>${escapeHtml(position.name)}${position.department ? ` · ${escapeHtml(position.department)}` : ''}</option>`).join('');
    showTalentDialog(`<header class="rf-dialog-head"><div><span>MANUAL MATCH REVIEW</span><h2>人工修改适配岗位</h2><p>只覆盖这份简历当前生效的适配岗位；AI原始推荐和修改原因会保留，方便后续追溯。</p></div></header>${currentMatch?.manualCorrection ? `<div class="rf-inline-warning">当前人工修正：${escapeHtml(currentMatch.manualCorrection.previousPositionName || '原岗位未记录')} → ${escapeHtml(currentMatch.positionName || '')}，原因：${escapeHtml(currentMatch.manualCorrection.reason || '')}</div>` : ''}<div class="rf-dialog-form rf-match-correction-form"><label class="wide"><span>新的适配岗位 <b>*</b></span><select id="rf-match-position" required>${positionOptions}</select><small class="rf-schedule-error" hidden></small></label><label class="wide"><span>修改原因与依据 <b>*</b></span><textarea id="rf-match-reason" placeholder="例如：候选人近三年集中在财务共享中心与全盘账务，原始简历和沟通记录更支持财务BP岗位"></textarea><small class="rf-schedule-error" hidden></small></label></div><div class="rf-dialog-actions"><button class="btn-soft" data-match-correct-cancel type="button">取消</button><button class="btn-primary" data-match-correct-submit type="button">保存适配岗位</button></div><p class="rf-dialog-message" id="rf-match-correct-message"></p>`, 'wide');
    document.querySelector('[data-match-correct-cancel]')?.addEventListener('click', () => openTalentDetailDialog(state.activeId));
    document.querySelector('[data-match-correct-submit]')?.addEventListener('click', submitMatchCorrection);
  }

  async function submitMatchCorrection() {
    const message = document.getElementById('rf-match-correct-message');
    const positionId = document.getElementById('rf-match-position')?.value || '';
    const reason = document.getElementById('rf-match-reason')?.value.trim() || '';
    const positionNode = document.getElementById('rf-match-position');
    const reasonNode = document.getElementById('rf-match-reason');
    markScheduleField(positionNode, positionId ? '' : '请选择新的适配岗位');
    markScheduleField(reasonNode, reason ? '' : '请填写修改原因与依据');
    if (!positionId || !reason) { (positionId ? reasonNode : positionNode)?.focus(); return; }
    try {
      message.textContent = '正在保存人工适配岗位和审计记录…';
      message.classList.remove('error');
      const candidateId = state.activeId;
      const result = await request(`api/talents/${encodeURIComponent(candidateId)}/match-correction`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          positionId, reason,
          operator: window.recruitmentCurrentUser?.name || '当前用户',
          operatorUserId: window.recruitmentCurrentUser?.id || '',
        }),
      });
      storeTalentDetail(result.talent);
      closeTalentDialog(false);
      renderTalentArchive({ preserveListScroll: true });
      await openTalentDetailDialog(candidateId);
      notifyUser(`适配岗位已人工修正为：${result.positionName}`, 'success');
    } catch (error) {
      message.textContent = error.message || '人工修改适配岗位保存失败';
      message.classList.add('error');
    }
  }

  async function confirmTalentOnboard() {
    const candidateId = state.activeId;
    if (!candidateId) return;
    const talent = state.talentDetails[candidateId] || state.talents.find((row) => row.id === candidateId) || {};
    const today = new Date().toISOString().slice(0, 10);
    let positions;
    try { positions = await loadPositionOptions(); }
    catch (error) { return notifyUser(error.message || '岗位数据加载失败', 'error', confirmTalentOnboard); }
    const selectedPosition = positions.find((position) => position.id === talent.matches?.[0]?.positionId) || positions.find((position) => position.name === talent.matches?.[0]?.positionName || position.name === talent.bestMatchRole || position.name === talent.jobIntention) || positions[0] || null;
    const positionOptions = positions.map((position) => `<option value="${escapeHtml(position.id)}" ${selectedPosition?.id === position.id ? 'selected' : ''}>${escapeHtml(position.name)}${position.department ? ` · ${escapeHtml(position.department)}` : ''}</option>`).join('');
    const expectedRole = talent.bestMatchRole || talent.jobIntention || '';
    const fallbackOption = !positions.length && expectedRole ? `<option value="${escapeHtml(expectedRole)}" selected>${escapeHtml(expectedRole)}</option>` : '';
    if (!positionOptions && !fallbackOption) return notifyUser('暂无可选择的入职岗位，请先在招聘管理中创建岗位。', 'error');
    showTalentDialog(`<header class="rf-dialog-head"><button class="rf-dialog-back" data-onboard-back type="button">← 返回人才档案</button><span>CONFIRM ONBOARDING</span><h2>确认入职</h2><p>请先选择本次入职岗位，确认后候选人状态将更新为已入职。</p></header><div class="rf-dialog-form"><label class="wide"><span>入职岗位 *</span><select id="rf-onboard-position" required>${positionOptions || fallbackOption}</select></label></div><div class="rf-dialog-actions"><button class="btn-soft" data-onboard-cancel type="button">取消</button><button class="btn-primary" data-onboard-submit type="button">确认入职</button></div><p class="rf-dialog-message" id="rf-onboard-message"></p>`, 'wide', true);
    document.querySelector('[data-onboard-back]')?.addEventListener('click', returnTalentDialog);
    document.querySelector('[data-onboard-cancel]')?.addEventListener('click', returnTalentDialog);
    document.querySelector('[data-onboard-submit]')?.addEventListener('click', () => confirmTalentOnboardSubmit(candidateId, today));
  }

  async function confirmTalentOnboardSubmit(candidateId, today) {
    const message = document.getElementById('rf-onboard-message');
    const selectedId = document.getElementById('rf-onboard-position')?.value || '';
    let positions;
    try { positions = await loadPositionOptions(); }
    catch (error) { if (message) { message.textContent = error.message || '岗位数据加载失败'; message.classList.add('error'); } return; }
    const position = positions.find((row) => row.id === selectedId) || null;
    if (!position && !selectedId) { if (message) { message.textContent = '请选择入职岗位'; message.classList.add('error'); } return; }
    try {
      if (message) { message.textContent = '正在创建入职记录…'; message.classList.remove('error'); }
      const created = await request('api/employee-lifecycle/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId,
          positionId: position?.id || selectedId,
          plannedStartDate: today,
          role: position?.name || selectedId,
          department: position?.department || '',
          operator: '当前用户',
        }),
      });
      if (message) message.textContent = '正在确认到岗…';
      await request(`api/employee-lifecycle/onboarding/${encodeURIComponent(created.onboardingId)}/arrival`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualDate: today,
          probationMonths: 3,
          note: '在人才档案中一键确认入职',
          operator: '当前用户',
        }),
      });
      closeTalentDialog(false);
      await loadTalentDetail(candidateId, false);
      await openTalentDetailDialog(candidateId);
      notifyUser('已确认入职。', 'success');
    } catch (error) {
      const message = String(error.message || '');
      if (message.includes('已有进行中的入职流程')) {
        const data = await request(`api/employee-lifecycle?candidateId=${encodeURIComponent(candidateId)}`);
        const onboarding = (data.onboardings || []).find((row) => !row.actualStartDate);
        if (!onboarding) return notifyUser(message || '该人才已有入职记录', 'error');
        await request(`api/employee-lifecycle/onboarding/${encodeURIComponent(onboarding.id)}/arrival`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actualDate: today, probationMonths: 3, note: '在人才档案中一键确认入职', operator: '当前用户' }),
        });
        closeTalentDialog(false);
        await loadTalentDetail(candidateId, false);
        await openTalentDetailDialog(candidateId);
        notifyUser('已确认入职。', 'success');
        return;
      }
      notifyUser(message || '确认入职失败', 'error', confirmTalentOnboard);
    }
  }

  async function confirmTalentAi() {
    if (state.archiveMode !== 'api') return setTalentMessage('当前为离线档案预览，发布环境接口可用后才能确认AI建议。', true);
    try {
      setTalentMessage('正在保存人工确认…');
      state.talentDetails[state.activeId] = await request(`api/talents/${encodeURIComponent(state.activeId)}/assessment`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result: '人工已确认', note: '负责人确认当前AI画像可用于后续筛选，最终录用仍以面试结果为准。' }) });
      renderTalentArchive();
      setTalentMessage('AI建议已由人工确认。');
    } catch (error) { setTalentMessage(error.message || '确认失败', true); }
  }

  function systemStatusBadge(ok, ready = '正常', failed = '待处理') {
    return `<span class="rf-system-badge ${ok ? 'ok' : 'warn'}">${escapeHtml(ok ? ready : failed)}</span>`;
  }

  function systemUptime(seconds) {
    const value = Math.max(0, Number(seconds || 0));
    const days = Math.floor(value / 86400), hours = Math.floor(value % 86400 / 3600), minutes = Math.floor(value % 3600 / 60);
    return [days ? `${days}天` : '', hours ? `${hours}小时` : '', `${minutes}分钟`].filter(Boolean).join(' ');
  }

  async function openSystemStatus() {
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取应用版本、运行环境和数据库状态…</div>', 'wide');
    try {
      const data = await request('api/health/system');
      if (!isTalentDialogCurrent(token)) return;
      const runtime = data.runtime || {}, build = data.build || {}, config = data.configuration || {}, database = data.database || {}, dependencies = data.dependencies || [];
      showTalentDialog(`
        <header class="rf-dialog-head"><div><span>SYSTEM STATUS</span><h2>系统版本与运行状态</h2><p>仅展示配置是否就绪，不返回平台令牌、Base ID或任何密钥值。</p></div><button class="btn-soft" data-system-refresh>重新检查</button></header>
        <div class="rf-review-metrics rf-system-metrics"><article><span>应用版本</span><strong>${escapeHtml(data.version || '未知')}</strong><small>${escapeHtml(data.environment || '')}</small></article><article><span>数据库</span><strong>${Number(database.initializedTables || 0)}/${Number(database.expectedTables || 0)}</strong><small>${escapeHtml(database.status || '')}</small></article><article><span>运行时长</span><strong>${escapeHtml(systemUptime(runtime.uptimeSeconds))}</strong><small>${escapeHtml(runtime.node || '')}</small></article><article><span>生产入口</span><strong>${runtime.productionEntryPresent ? '已包含' : '缺失'}</strong><small>${escapeHtml(runtime.productionEntry || '')}</small></article></div>
        <div class="rf-system-grid">
          <section><div class="rf-review-title"><strong>构建与运行</strong><small>${escapeHtml(data.checkedAt || '')}</small></div><dl><div><dt>生产入口</dt><dd>${escapeHtml(runtime.productionEntry || '')}${systemStatusBadge(runtime.productionEntryPresent)}</dd></div><div><dt>静态前端</dt><dd>dist/client/index.html${systemStatusBadge(runtime.staticClientPresent)}</dd></div><div><dt>Node / 平台</dt><dd>${escapeHtml(runtime.node || '')} · ${escapeHtml(runtime.platform || '')} ${escapeHtml(runtime.architecture || '')}</dd></div><div><dt>启动时间</dt><dd>${escapeHtml(runtime.startedAt || '')}</dd></div><div><dt>包管理器</dt><dd>${escapeHtml(build.packageManager || '未声明')}</dd></div><div><dt>发布标识</dt><dd>${escapeHtml(build.releaseId || build.revision || '预览环境未提供')}</dd></div></dl></section>
          <section><div class="rf-review-title"><strong>平台配置</strong><small>只显示就绪状态</small></div><dl><div><dt>平台SDK</dt><dd>${systemStatusBadge(config.platformUrl)}</dd></div><div><dt>应用令牌</dt><dd>${systemStatusBadge(config.appToken)}</dd></div><div><dt>Teable绑定</dt><dd>${systemStatusBadge(config.teableBinding)}</dd></div><div><dt>权限模式</dt><dd>${escapeHtml(config.accessControlMode || 'audit')}${systemStatusBadge(config.accessControlMode === 'strict', '严格模式', '审计模式')}</dd></div><div><dt>用户身份头</dt><dd>${escapeHtml(config.trustedIdentityHeaders?.userId || '')}</dd></div><div><dt>姓名身份头</dt><dd>${escapeHtml(config.trustedIdentityHeaders?.userName || '')}</dd></div></dl></section>
        </div>
        <section class="rf-system-dependencies"><div class="rf-review-title"><strong>运行依赖</strong><small>${dependencies.length}项</small></div><div>${dependencies.map((item) => `<span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.version)}</small></span>`).join('') || '<p>未读取到依赖清单。</p>'}</div></section>
        ${database.ready ? '' : `<div class="rf-system-alert"><strong>数据库尚未就绪</strong><p>${escapeHtml(database.error || '请检查平台变量、应用令牌和绑定Base。')}</p><button class="btn-primary" data-system-db-retry>重试数据库初始化</button></div>`}
      `, 'wide');
      document.querySelector('[data-system-refresh]')?.addEventListener('click', openSystemStatus);
      document.querySelector('[data-system-db-retry]')?.addEventListener('click', async () => { try { await request('api/health/database/retry', { method: 'POST' }); await openSystemStatus(); } catch (error) { notifyUser(conciseError(error), 'error'); } });
    } catch (error) {
      dialogFailure('系统状态读取失败', error, openSystemStatus, token);
    }
  }

  async function openAiMonitoring(days = 30) {
    const token = showTalentDialog('<div class="rf-dialog-loading">正在汇总AI成功率、耗时、成本估算和失败原因…</div>', 'wide');
    try {
      const data = await request(`api/talents/ai-monitoring?days=${Number(days || 30)}`), summary = data.summary || {};
      if (!isTalentDialogCurrent(token)) return;
      const tokenText = (value) => Number(value || 0).toLocaleString('zh-CN');
      showTalentDialog(`<header class="rf-dialog-head"><div><span>AI OPERATIONS</span><h2>AI分析运行监控</h2><p>统计人才分析调用的成功、规则降级、耗时和用量。成本为估算值，不等同于模型供应商账单。</p></div><label class="rf-ai-monitor-range"><span>统计范围</span><select data-ai-monitor-days><option value="7" ${data.rangeDays === 7 ? 'selected' : ''}>近7天</option><option value="30" ${data.rangeDays === 30 ? 'selected' : ''}>近30天</option><option value="90" ${data.rangeDays === 90 ? 'selected' : ''}>近90天</option></select></label></header><div class="rf-review-metrics rf-ai-monitor-metrics"><article><span>分析总数</span><strong>${Number(summary.total || 0)}</strong><small>成功 ${Number(summary.success || 0)}</small></article><article class="${Number(summary.fallback || 0) ? 'warn' : ''}"><span>规则降级</span><strong>${Number(summary.fallback || 0)}</strong><small>需优先人工复核</small></article><article><span>成功率</span><strong>${Number(summary.successRate || 0)}%</strong><small>非成功 ${Number(summary.failed || 0)}</small></article><article><span>平均 / P95</span><strong>${Number(summary.averageDurationMs || 0)}ms</strong><small>P95 ${Number(summary.p95DurationMs || 0)}ms</small></article><article><span>估算成本</span><strong>¥${Number(summary.estimatedCost || 0).toFixed(4)}</strong><small>${data.pricingConfigured ? '已配置估算单价' : '未配置单价，暂记0元'}</small></article></div><section class="rf-ai-monitor-usage"><div><span>输入估算Token</span><strong>${tokenText(summary.inputTokens)}</strong></div><div><span>输出估算Token</span><strong>${tokenText(summary.outputTokens)}</strong></div><p>${escapeHtml(data.costBasis || '')}</p></section>${(data.alerts || []).length ? `<section class="rf-ai-monitor-alerts"><div class="rf-review-title"><strong>运行告警</strong><small>${data.alerts.length}项</small></div>${data.alerts.map((alert) => `<article class="${alert.level === '高' ? 'high' : ''}"><b>${escapeHtml(alert.level)} · ${escapeHtml(alert.type)}</b><p>${escapeHtml(alert.message)}</p></article>`).join('')}</section>` : '<div class="rf-inline-warning">当前统计范围内未触发失败率、规则降级或慢调用告警。</div>'}<div class="rf-ai-monitor-grid"><section><div class="rf-review-title"><strong>失败原因</strong><small>按次数排序</small></div>${(data.errors || []).length ? `<div class="rf-ai-monitor-errors">${data.errors.map((item) => `<p><strong>${Number(item.count)}</strong><span>${escapeHtml(item.message)}</span></p>`).join('')}</div>` : '<div class="rf-dialog-empty"><p>暂无失败或降级原因。</p></div>'}</section><section><div class="rf-review-title"><strong>最近运行</strong><small>最多50条</small></div><div class="rf-ai-monitor-runs">${(data.recent || []).map((run) => `<article class="${run.status === '成功' ? '' : 'warn'}"><div><strong>${escapeHtml(run.version)} · ${escapeHtml(run.type)}</strong><span>${escapeHtml(run.status)} · ${Number(run.durationMs || 0)}ms</span></div><small>${escapeHtml(run.candidateId)} · ${escapeHtml(run.model || '')} · ${escapeHtml(run.completedAt || '')}</small>${run.error ? `<p>${escapeHtml(run.error)}</p>` : ''}</article>`).join('') || '<div class="rf-dialog-empty"><p>当前范围内暂无AI分析运行记录。</p></div>'}</div></section></div>`, 'wide');
      document.querySelector('[data-ai-monitor-days]')?.addEventListener('change', (event) => openAiMonitoring(Number(event.target.value)));
    } catch (error) { dialogFailure('AI运行监控读取失败', error, () => openAiMonitoring(days), token); }
  }

  async function openAccessAdministration() {
    const token = showTalentDialog('<div class="rf-dialog-loading">正在读取组织、用户、角色和隐私审批…</div>', 'wide');
    try {
      state.accessAdminData = await request('api/access/administration');
      if (!isTalentDialogCurrent(token)) return;
      renderAccessAdministration();
    } catch (error) {
      dialogFailure('权限管理读取失败', error, openAccessAdministration, token);
    }
  }

  function accessOrganizationPath(organizationId, organizations) {
    const byId = new Map(organizations.map((item) => [String(item.id), item]));
    const path = [];
    let current = byId.get(String(organizationId));
    const visited = new Set();
    while (current && !visited.has(String(current.id))) {
      visited.add(String(current.id));
      if (current.status !== '停用') path.unshift(current.name);
      const parentId = accessOrganizationParentId(current, organizations, byId);
      current = parentId ? byId.get(parentId) : null;
    }
    return path.join(' / ');
  }

  function accessOrganizationParentId(organization, organizations, byId = new Map(organizations.map((item) => [String(item.id), item]))) {
    const company = organizations.find((item) => item.type === '事业部' && item.name === '方片' && item.status !== '停用');
    const companyId = company ? String(company.id) : '';
    const organizationId = String(organization.id);
    if (organizationId === companyId) return '';
    let parentId = String(organization.parentId || '');
    const visited = new Set();
    while (parentId && parentId !== organizationId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.status !== '停用') return parentId;
      parentId = String(parent.parentId || '');
    }
    return companyId;
  }

  function accessDepartmentOptions(organizations, options = {}) {
    return organizations
      .filter((item) => (options.includeBusinessUnits || item.type === '部门') && (options.includeInactive || item.status !== '停用'))
      .map((item) => ({ ...item, path: accessOrganizationPath(item.id, organizations) || item.name }))
      .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'));
  }

  function accessUserDepartmentIds(user, organizations) {
    const activeDepartments = organizations.filter((item) => item.type === '部门' && item.status !== '停用');
    const activeIds = new Set(activeDepartments.map((item) => String(item.id)));
    const ids = [...new Set((Array.isArray(user.departmentIds) ? user.departmentIds : []).map(String).filter((id) => activeIds.has(id)))];
    if (ids.length) return ids;
    const names = Array.isArray(user.departments) ? user.departments : [];
    const matchedIds = activeDepartments.filter((item) => names.includes(String(item.name))).map((item) => String(item.id));
    return matchedIds.length === 1 ? matchedIds : [];
  }

  function accessUserGrantDepartmentIds(user, organizations) {
    const activeDepartments = organizations.filter((item) => item.type === '部门' && item.status !== '停用');
    const activeIds = new Set(activeDepartments.map((item) => String(item.id)));
    const departmentIds = [...new Set((Array.isArray(user.departmentIds) ? user.departmentIds : []).map(String).filter((id) => activeIds.has(id)))];
    if (departmentIds.length) return departmentIds.slice(0, 1);
    const departmentNames = Array.isArray(user.departments) ? user.departments.map(String).filter(Boolean) : [];
    const matchedIds = [...new Set(activeDepartments.filter((item) => departmentNames.includes(String(item.name))).map((item) => String(item.id)))];
    return matchedIds.length === 1 ? matchedIds : [];
  }

  function renderAccessOrganizationTree(organizations, users) {
    const allNodes = organizations.filter((item) => item.type === '事业部' || item.type === '部门');
    const nodes = allNodes.filter((item) => item.status !== '停用');
    const byId = new Map(allNodes.map((item) => [String(item.id), item]));
    const parentById = new Map(nodes.map((item) => [String(item.id), accessOrganizationParentId(item, allNodes, byId)]));
    const childrenByParent = new Map();
    for (const item of nodes) {
      const parentId = parentById.get(String(item.id)) || '';
      childrenByParent.set(parentId, [...(childrenByParent.get(parentId) || []), item]);
    }
    for (const children of childrenByParent.values()) children.sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || left.name.localeCompare(right.name, 'zh-CN'));
    const descendants = (organizationId) => {
      const ids = new Set([String(organizationId)]);
      const pending = [String(organizationId)];
      while (pending.length) {
        const parentId = pending.pop();
        for (const child of childrenByParent.get(parentId) || []) {
          const childId = String(child.id);
          if (!ids.has(childId)) { ids.add(childId); pending.push(childId); }
        }
      }
      return ids;
    };
    const departmentCount = (organizationId) => {
      const ids = descendants(organizationId);
      return users.filter((user) => accessUserDepartmentIds(user, organizations).some((id) => ids.has(id))).length;
    };
    const renderNodes = (items, depth = 0) => items.map((item) => {
      const itemId = String(item.id), children = childrenByParent.get(itemId) || [];
      const title = escapeHtml(item.name), path = accessOrganizationPath(itemId, organizations);
      const manager = users.find((user) => String(user.id) === String(item.ownerUserId));
      const employeeCount = departmentCount(itemId);
      const searchText = [item.name, path, manager?.name, item.owner].filter(Boolean).join(' ');
      const actions = item.type === '部门' ? `<div class="rf-access-tree-actions"><button class="btn-soft" data-access-open-department="${escapeHtml(itemId)}" type="button">查看员工</button><button class="btn-soft" data-access-org-edit="${escapeHtml(itemId)}" data-access-mutate type="button">编辑部门</button></div>` : '';
      const summary = `<summary><span>${title}</span><small>${item.type === '部门' ? '部门' : '组织'}</small><b>${employeeCount} 人</b></summary>`;
      const info = `<div class="rf-access-tree-info"><span>${escapeHtml(path)}</span>${item.type === '部门' ? `<small>负责人：${escapeHtml(manager?.name || item.owner || '未设置')}</small>` : ''}${actions}</div>`;
      if (children.length) return `<details class="rf-access-tree-branch" data-access-department-card data-access-department-search-text="${escapeHtml(searchText)}" ${depth === 0 ? 'open' : ''}>${summary}${info}<div class="rf-access-tree-children">${renderNodes(children, depth + 1)}</div></details>`;
      if (item.type === '部门') return `<article class="rf-access-tree-leaf" data-access-department-card data-access-department-search-text="${escapeHtml(searchText)}"><div class="rf-access-tree-leaf-main"><div><strong>${title}</strong><small>${escapeHtml(path)}</small></div><b>${employeeCount} 人</b></div><div class="rf-access-tree-info"><small>负责人：${escapeHtml(manager?.name || item.owner || '未设置')}</small>${actions}</div></article>`;
      return `<article class="rf-access-tree-leaf rf-access-tree-static" data-access-department-card data-access-department-search-text="${escapeHtml(searchText)}"><div class="rf-access-tree-leaf-main"><div><strong>${title}</strong><small>${escapeHtml(path)}</small></div><b>${employeeCount} 人</b></div></article>`;
    }).join('');
    const nodeIds = new Set(nodes.map((item) => String(item.id)));
    const roots = nodes.filter((item) => {
      const parentId = parentById.get(String(item.id));
      return !parentId || !nodeIds.has(parentId);
    });
    return renderNodes(roots) || '<div class="rf-dialog-empty"><p>暂无启用部门，可先新增部门。</p></div>';
  }

  function renderAccessAdministration() {
    const data = state.accessAdminData || { roles: [], bindings: [], users: [], organizations: [], sensitiveRequests: [] };
    const enabledRoles = data.roles.filter((role) => role.status === '启用');
    const enabledRoleCodes = new Set(enabledRoles.map((role) => role.code));
    const activeBindings = data.bindings.filter((item) => enabledRoleCodes.has(item.roleCode) && item.status === '启用' && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()));
    const pending = data.sensitiveRequests.filter((item) => item.status === '待审批');
    const pendingUsers = data.users.filter((item) => item.status === '待开通');
    const roleName = (code) => data.roles.find((role) => role.code === code)?.name || code;
    const tabs = ['employees', 'departments', 'roles', 'approvals', 'loginActivity'];
    const currentTab = tabs.includes(state.accessAdminTab) ? state.accessAdminTab : 'employees';
    state.accessAdminTab = currentTab;
    const departments = accessDepartmentOptions(data.organizations).filter((item) => item.type === '部门');
    const activeUserIds = new Set(data.users.filter((user) => user.status !== '停用').map((user) => String(user.id)));
    const selectedAccessUsers = new Set((state.accessSelectedUserIds || []).map(String).filter((userId) => activeUserIds.has(userId)));
    const activeBindingRows = data.bindings.filter((item) => item.status === '启用' && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()));
    const roleLevelWeight = { L4: 0, L3: 1, L2: 2, L1: 3 };
    const dataScopeLabels = { all: '全公司', business_unit: '所属事业部', assigned_departments: '所属部门', assigned_interviews: '本人面试', self: '仅本人' };
    const sortedRoles = [...data.roles].sort((roleA, roleB) => {
      const statusDifference = (roleA.status === '启用' ? 0 : 1) - (roleB.status === '启用' ? 0 : 1);
      if (statusDifference) return statusDifference;
      const levelDifference = (roleLevelWeight[roleA.level] ?? 9) - (roleLevelWeight[roleB.level] ?? 9);
      if (levelDifference) return levelDifference;
      return String(roleA.name || roleA.code).localeCompare(String(roleB.name || roleB.code), 'zh-Hans-CN');
    });
    const renderAccessRoleCard = (role) => {
      const roleBindings = activeBindingRows.filter((item) => item.roleCode === role.code);
      const memberCount = new Set(roleBindings.map((item) => item.userId)).size;
      const pageNames = role.pages?.includes('*') ? ['全部页面'] : (role.pages || []).map((page) => accessPageOptions[page] || page);
      const shownPages = pageNames.slice(0, 3);
      const roleInitial = String(role.name || role.code || '角').trim().slice(0, 1) || '角';
      return `<article class="rf-access-role-card ${role.status === '启用' ? '' : 'inactive'}"><header class="rf-access-role-head"><div class="rf-access-role-avatar" aria-hidden="true">${escapeHtml(roleInitial)}</div><div class="rf-access-role-identity"><div class="rf-access-role-name"><h3>${escapeHtml(role.name)}</h3><span class="rf-access-status ${role.status === '启用' ? 'active' : ''}">${escapeHtml(role.status || '未启用')}</span></div><p>${escapeHtml(accessRoleDescription(role))}</p></div><button class="btn-primary" data-access-role-permission="${escapeHtml(role.code)}" data-access-mutate type="button">配置权限</button></header><div class="rf-access-role-facts"><span><small>数据范围</small><b>${escapeHtml(dataScopeLabels[role.dataScope] || role.dataScope || '仅本人')}</b></span><span><small>员工</small><b>${memberCount} 人</b></span></div><div class="rf-access-role-scope"><span class="rf-access-role-kind">${escapeHtml(role.level || 'L1')} · ${role.system ? '系统' : '自定义'}</span>${shownPages.length ? shownPages.map((name) => `<span>${escapeHtml(name)}</span>`).join('') : '<em>尚未配置页面权限</em>'}${pageNames.length > shownPages.length ? `<span>另有 ${pageNames.length - shownPages.length} 项</span>` : ''}</div><footer class="rf-access-role-actions"><button class="rf-access-role-mini" data-access-open-role="${escapeHtml(role.code)}" type="button" aria-label="查看成员" ${memberCount ? '' : 'disabled'}>成员</button><button class="rf-access-role-mini" data-access-role-edit="${escapeHtml(role.code)}" data-access-mutate type="button" aria-label="编辑角色">编辑</button><button class="rf-access-role-mini ${role.status === '启用' ? 'danger' : 'active'}" data-access-role-status="${escapeHtml(role.code)}" data-access-status="${role.status === '启用' ? '停用' : '启用'}" data-access-mutate type="button" aria-label="${role.status === '启用' ? '停用角色' : '启用角色'}" ${role.code === 'system_admin' ? 'disabled title="超级管理员不能停用"' : ''}>${role.status === '启用' ? '停用' : '启用'}</button></footer></article>`;
    };
    const enabledRoleCards = sortedRoles.filter((role) => role.status === '启用').map(renderAccessRoleCard);
    const disabledRoleCards = sortedRoles.filter((role) => role.status !== '启用').map(renderAccessRoleCard);
    const activeRoleCodes = new Set(sortedRoles.filter((role) => role.status === '启用').map((role) => role.code));
    const roleMemberCount = new Set(activeBindingRows.filter((item) => activeRoleCodes.has(item.roleCode)).map((item) => item.userId)).size;
    const renderRoleGroup = (title, hint, cards) => cards.length ? `<section class="rf-access-role-group"><header><h4>${title}</h4><small>${hint}</small></header><div class="rf-access-role-grid">${cards.join('')}</div></section>` : '';
    showTalentDialog(`
      <header class="rf-dialog-head rf-access-dialog-head"><div><span>PEOPLE · STRUCTURE · ACCESS</span><h2>组织与权限</h2><p>先确定员工归属，再配置角色能看到什么、能操作什么。</p></div><div class="rf-assessment-head-actions"><div data-access-actions-for="employees" ${currentTab === 'employees' ? '' : 'hidden'}><details class="rf-access-sync-menu"><summary>同步信息</summary><div><button class="btn-soft" data-access-sync-tianji type="button">同步天玑状态</button><button class="btn-soft" data-access-sync-wecom type="button">同步企微 ID</button></div></details><button class="btn-soft" data-access-user-batch data-access-mutate type="button">批量导入</button><button class="btn-primary" data-access-user data-access-mutate type="button">新增员工</button></div><div data-access-actions-for="departments" ${currentTab === 'departments' ? '' : 'hidden'}><button class="btn-primary" data-access-org data-access-mutate type="button">新增部门</button></div><div data-access-actions-for="roles" ${currentTab === 'roles' ? '' : 'hidden'}><button class="btn-primary" data-access-role-create data-access-mutate type="button">新增角色</button></div></div></header>
      <div class="rf-access-summary" aria-label="管理概览"><article><span>员工档案</span><strong>${data.users.length}</strong><small>含全部账号状态</small></article><article class="${pendingUsers.length ? 'warn' : ''}"><span>待开通</span><strong>${pendingUsers.length}</strong><small>等待分配访问权限</small></article><article><span>启用部门</span><strong>${departments.length}</strong><small>按组织树归属</small></article><article class="${pending.length ? 'warn' : ''}"><span>待审批</span><strong>${pending.length}</strong><small>敏感字段临时申请</small></article></div>
      <nav class="rf-access-tabs" role="tablist" aria-label="组织与权限管理"><button type="button" role="tab" data-access-tab="employees" aria-selected="${currentTab === 'employees'}" class="${currentTab === 'employees' ? 'active' : ''}"><span>员工</span><b>${data.users.length}</b></button><button type="button" role="tab" data-access-tab="departments" aria-selected="${currentTab === 'departments'}" class="${currentTab === 'departments' ? 'active' : ''}"><span>部门</span><b>${departments.length}</b></button><button type="button" role="tab" data-access-tab="roles" aria-selected="${currentTab === 'roles'}" class="${currentTab === 'roles' ? 'active' : ''}"><span>角色</span><b>${data.roles.length}</b></button><button type="button" role="tab" data-access-tab="approvals" aria-selected="${currentTab === 'approvals'}" class="${currentTab === 'approvals' ? 'active' : ''}"><span>审批</span><b>${pending.length}</b></button><button type="button" role="tab" data-access-tab="loginActivity" aria-selected="${currentTab === 'loginActivity'}" class="${currentTab === 'loginActivity' ? 'active' : ''}"><span>登录动态</span><b data-login-online-count>—</b></button></nav>
      <section class="rf-access-view" data-access-view="employees" ${currentTab === 'employees' ? '' : 'hidden'}><div class="rf-access-view-heading"><div><h3>员工档案</h3><p>搜索员工后编辑资料、追加多个角色；现有权限不会被批量操作覆盖。</p></div><small data-access-visible-count>显示 ${data.users.length} 名员工</small></div><div class="rf-access-employee-toolbar"><label class="rf-access-search-field"><span>快速查找</span><input type="search" data-access-user-search placeholder="姓名、手机号、邮箱、部门或企微 ID" autocomplete="off"></label><label><span>账号状态</span><select data-access-user-status><option value="all">全部状态</option><option value="启用">正常使用</option><option value="待开通">待开通</option><option value="停用">已停用</option></select></label><label><span>所属部门</span><select data-access-department-filter><option value="">全部部门</option>${departments.map((item) => `<option value="${escapeHtml(item.id)}" ${String(state.accessEmployeeDepartmentFilter || '') === String(item.id) ? 'selected' : ''}>${escapeHtml(item.path)}</option>`).join('')}</select></label><label><span>已分配角色</span><select data-access-role-filter><option value="">全部角色</option>${enabledRoles.map((role) => `<option value="${escapeHtml(role.code)}" ${state.accessEmployeeRoleFilter === role.code ? 'selected' : ''}>${escapeHtml(role.name)}</option>`).join('')}</select></label></div><div class="rf-access-list-toolbar"><label class="rf-access-select-visible"><input type="checkbox" data-access-select-visible><span>全选当前筛选结果</span></label><small>只会选中可授权的启用账号</small></div><div class="rf-access-selection-tools" data-access-selection-tools ${selectedAccessUsers.size ? '' : 'hidden'}><span data-access-selected-count aria-live="polite">已选 ${selectedAccessUsers.size} 人</span><button class="btn-soft" data-access-clear-selection type="button">清空选择</button><button class="btn-primary" data-access-bulk-binding data-access-mutate type="button" ${selectedAccessUsers.size ? '' : 'disabled'}>批量分配角色</button></div><div class="rf-access-list">${data.users.map((user) => { const bindings = activeBindings.filter((item) => item.userId === user.id), departmentId = user.departmentIds?.[0], department = (departmentId ? accessOrganizationPath(departmentId, data.organizations) : '') || user.departments?.[0] || '暂未归属部门', userStatus = user.status || '待开通', roleCodes = bindings.map((item) => item.roleCode), searchText = [user.name, user.id, user.mobile, user.email, user.employeeNumber, user.tianjiWechatId, user.wecomUserId, department, ...(user.departments || []), ...roleCodes.map(roleName)].filter(Boolean).join(' '); return `<article class="rf-access-user-card ${userStatus === '待开通' ? 'pending-user' : ''}" data-access-user-row="${escapeHtml(user.id)}" data-access-user-search="${escapeHtml(searchText)}" data-access-user-status="${escapeHtml(userStatus)}" data-access-user-departments="${escapeHtml(accessUserDepartmentIds(user, data.organizations).join(' '))}" data-access-user-roles="${escapeHtml(roleCodes.join(' '))}"><div class="rf-access-user-main"><label class="rf-access-user-select"><input type="checkbox" data-access-user-select value="${escapeHtml(user.id)}" aria-label="选择${escapeHtml(user.name || user.id)}" ${selectedAccessUsers.has(String(user.id)) ? 'checked' : ''} ${userStatus === '停用' ? 'disabled' : ''}><span></span></label><div class="rf-access-user-avatar" aria-hidden="true">${escapeHtml(String(user.name || user.id).trim().slice(0, 1) || '员')}</div><div class="rf-access-user-details"><div class="rf-access-user-head"><strong>${escapeHtml(user.name || user.id)}</strong><span class="rf-access-status ${userStatus === '启用' ? 'active' : ''}">${escapeHtml(userStatus)}</span></div><p>${escapeHtml(department)}</p><div class="rf-access-role-chips">${bindings.length ? bindings.map((item) => `<span class="rf-access-role-chip"><b>${escapeHtml(roleName(item.roleCode))}</b><button class="danger" data-access-revoke="${escapeHtml(item.id)}" type="button" aria-label="移除${escapeHtml(roleName(item.roleCode))}权限">×</button></span>`).join('') : '<em>尚未配置权限</em>'}</div><small>${user.mobile ? `手机号：${escapeHtml(user.mobile)}` : `账号：${escapeHtml(user.id)}`} · 天玑：${escapeHtml(user.tianjiEmployeeStatus || '未匹配')} · ${user.tianjiWechatId ? `企微私信 ID：${escapeHtml(user.tianjiWechatId)}` : '未同步企微成员 ID'}</small></div></div><div class="rf-access-user-actions"><button class="btn-soft" data-access-user-mobile="${escapeHtml(user.id)}" type="button">编辑资料</button><button class="btn-primary" data-access-user-binding="${escapeHtml(user.id)}" type="button">分配角色</button></div></article>`; }).join('') || '<div class="rf-dialog-empty"><p>暂无系统用户。</p></div>'}</div></section>
      <section class="rf-access-view" data-access-view="departments" ${currentTab === 'departments' ? '' : 'hidden'}><div class="rf-access-view-heading"><div><h3>部门架构</h3><p>按公司层级查看组织；点“查看员工”直接进入该部门人员列表。</p></div><label class="rf-access-department-search"><span>搜索部门或负责人</span><input type="search" data-access-department-search placeholder="输入部门名、上级或负责人"></label></div><div class="rf-access-tree-workspace"><div class="rf-access-tree-panel"><div class="rf-access-tree-heading"><strong>组织树</strong><small>数字为该组织下员工数</small></div><div class="rf-access-tree" aria-label="部门层级">${renderAccessOrganizationTree(data.organizations, data.users)}</div></div><aside class="rf-access-tree-guide"><span>维护提示</span><strong>先选对上级，再设置负责人</strong><p>新增或编辑部门时，可维护部门名称、上级部门、负责人和启用状态。停用前系统会检查是否仍有员工或启用中的下级部门。</p><small>员工调部门请在员工资料中联系管理员处理，避免角色数据范围不同步。</small></aside></div></section>
      <section class="rf-access-view rf-access-roles-view" data-access-view="roles" ${currentTab === 'roles' ? '' : 'hidden'}><div class="rf-access-view-heading"><div><h3>角色与访问范围</h3><p>角色决定菜单、操作和敏感字段；同一员工的多个角色权限会合并。</p></div></div><div class="rf-access-role-metrics"><article><span>启用角色</span><strong>${enabledRoleCards.length}</strong></article><article><span>停用角色</span><strong>${disabledRoleCards.length}</strong></article><article><span>覆盖员工</span><strong>${roleMemberCount}</strong></article><article><span>自定义角色</span><strong>${sortedRoles.filter((role) => !role.system).length}</strong></article></div>${renderRoleGroup('启用中', '优先展示当前可分配的角色', enabledRoleCards)}${renderRoleGroup('已停用', '保留绑定与审计，可重新启用', disabledRoleCards)}${sortedRoles.length ? '' : '<div class="rf-dialog-empty"><p>暂无可配置角色。</p></div>'}<aside data-role-permission-panel><div class="rf-role-editor-empty"><strong>选择一个角色开始维护</strong><p>查看成员可定位到员工；配置权限可调整该角色的页面、按钮和字段范围。</p></div></aside></section>
      <section class="rf-access-view" data-access-view="approvals" ${currentTab === 'approvals' ? '' : 'hidden'}><div class="rf-access-view-heading"><div><h3>敏感字段审批</h3><p>审批通过后仅临时解锁，最长 24 小时。</p></div></div><div class="rf-access-requests">${data.sensitiveRequests.map((item) => `<article class="${item.status === '待审批' ? 'pending' : ''}"><div><span>${escapeHtml(item.status)}</span><strong>${escapeHtml(item.applicant)} · 人才 ${escapeHtml(item.candidateId)}</strong><p>${escapeHtml(item.reason)}</p><small>${(item.fields || []).map(escapeHtml).join('、')} · ${escapeHtml(item.createdAt)}</small></div><aside>${item.status === '待审批' ? `<button data-access-decision="${escapeHtml(item.id)}" data-decision="驳回" class="danger">驳回</button><button data-access-decision="${escapeHtml(item.id)}" data-decision="通过">限时通过</button>` : `<small>${escapeHtml(item.approver || '')}${item.expiresAt ? ` · 至 ${escapeHtml(item.expiresAt)}` : ''}</small>`}</aside></article>`).join('') || '<div class="rf-dialog-empty"><p>暂无敏感字段申请。</p></div>'}</div></section>`, 'wide');
    document.querySelector('[data-access-view="approvals"]')?.insertAdjacentHTML('afterend', `<section class="rf-access-view rf-login-activity-view" data-access-view="loginActivity" ${currentTab === 'loginActivity' ? '' : 'hidden'}><div class="rf-access-view-heading"><div><h3>登录动态</h3><p>按员工去重统计登录历史；已登录且页面在前台，最近 3 分钟收到心跳则显示在线。</p></div><button class="btn-soft" type="button" data-login-activity-refresh>刷新动态</button></div><div data-login-activity-content role="status" aria-live="polite"><div class="rf-login-activity-loading"><i></i><span>打开此页后读取登录动态</span></div></div></section>`);
    document.querySelector('[data-access-org]')?.addEventListener('click', () => openAccessOrganizationForm());
    document.querySelector('[data-access-role-create]')?.addEventListener('click', () => openAccessRoleForm());
    document.querySelectorAll('[data-access-role-edit]').forEach((button) => button.addEventListener('click', () => openAccessRoleForm(button.dataset.accessRoleEdit)));
    document.querySelectorAll('[data-access-role-status]').forEach((button) => button.addEventListener('click', () => openAccessRoleStatusForm(button.dataset.accessRoleStatus, button.dataset.accessStatus)));
    document.querySelectorAll('[data-access-role-permission]').forEach((button) => button.addEventListener('click', () => renderRolePermissionInline(button.dataset.accessRolePermission)));
    const setAccessTab = (tab) => {
      state.accessAdminTab = tab;
      document.querySelectorAll('[data-access-tab]').forEach((button) => {
        const active = button.dataset.accessTab === tab;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('[data-access-view]').forEach((view) => { view.hidden = view.dataset.accessView !== tab; });
      document.querySelectorAll('[data-access-actions-for]').forEach((actions) => { actions.hidden = actions.dataset.accessActionsFor !== tab; });
      if (tab === 'loginActivity') loadLoginActivity();
    };
    document.querySelectorAll('[data-access-tab]').forEach((button) => button.addEventListener('click', () => setAccessTab(button.dataset.accessTab)));
    const formatLoginTime = (value) => {
      const parsed = Date.parse(value || '');
      return Number.isFinite(parsed) ? new Date(parsed).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '暂无记录';
    };
    const renderLoginActivity = (activity) => {
      const content = document.querySelector('[data-login-activity-content]');
      if (!content) return;
      const onlineUsers = Array.isArray(activity.onlineUsers) ? activity.onlineUsers : [];
      const loggedInUsers = Array.isArray(activity.loggedInUsers) ? activity.loggedInUsers : [];
      const personCard = (user, compact = false) => `<article class="rf-login-activity-person ${user.isOnline ? 'online' : ''} ${compact ? 'compact' : ''}" data-login-user-card data-login-user-search="${escapeHtml([user.name, user.department].join(' '))}"><span class="rf-login-activity-avatar" aria-hidden="true">${escapeHtml(String(user.name || '员').trim().slice(0, 1))}</span><div class="rf-login-activity-person-main"><strong>${escapeHtml(user.name || '未知员工')}</strong><small>${escapeHtml(user.department || '暂未归属部门')}</small></div><span class="rf-login-activity-state ${user.isOnline ? 'online' : ''}"><i></i>${user.isOnline ? '在线' : '离线'}</span><time datetime="${escapeHtml(user.lastActiveAt || '')}">${escapeHtml(formatLoginTime(user.lastActiveAt))}</time></article>`;
      content.innerHTML = `<div class="rf-login-activity-metrics"><article><span>登录过的员工</span><strong>${Number(activity.loggedInUserCount) || 0}</strong><small>按员工去重累计</small></article><article class="online"><span>当前在线</span><strong>${Number(activity.onlineUserCount) || 0}</strong><small>已登录且前台页面在线</small></article></div><section class="rf-login-activity-section"><div class="rf-login-activity-section-head"><div><h4>当前在线人员</h4><p>员工页面在前台时每分钟上报；点击“刷新动态”查看最新名单</p></div><span class="rf-login-activity-live-label"><i></i>在线快照</span></div><div class="rf-login-activity-online-list">${onlineUsers.length ? onlineUsers.map((user) => personCard(user)).join('') : '<div class="rf-login-activity-empty"><strong>暂时没有在线员工</strong><span>员工进入系统后会自动出现在这里。</span></div>'}</div></section><section class="rf-login-activity-section"><div class="rf-login-activity-section-head"><div><h4>登录过的员工</h4><p>最近活动优先显示，可搜索姓名或部门</p></div><label class="rf-login-activity-search"><span class="sr-only">搜索员工</span><input type="search" data-login-activity-search placeholder="搜索姓名或部门" autocomplete="off"></label></div><div class="rf-login-activity-history-list" data-login-activity-history>${loggedInUsers.length ? loggedInUsers.map((user) => personCard(user, true)).join('') : '<div class="rf-login-activity-empty"><strong>还没有登录记录</strong><span>员工登录后会自动开始统计。</span></div>'}</div><p class="rf-login-activity-updated">数据更新时间：${escapeHtml(formatLoginTime(activity.generatedAt))}</p></section>`;
      const onlineCount = document.querySelector('[data-login-online-count]');
      if (onlineCount) onlineCount.textContent = String(Number(activity.onlineUserCount) || 0);
      content.querySelector('[data-login-activity-search]')?.addEventListener('input', (event) => {
        const query = String(event.currentTarget.value || '').trim().toLocaleLowerCase();
        content.querySelectorAll('[data-login-user-card]').forEach((card) => { card.hidden = Boolean(query) && !String(card.dataset.loginUserSearch || '').toLocaleLowerCase().includes(query); });
      });
    };
    async function loadLoginActivity() {
      const content = document.querySelector('[data-login-activity-content]');
      if (!content) return;
      content.innerHTML = '<div class="rf-login-activity-loading"><i></i><span>正在读取登录动态…</span></div>';
      const refreshButton = document.querySelector('[data-login-activity-refresh]');
      if (refreshButton) { refreshButton.disabled = true; refreshButton.textContent = '刷新中…'; }
      try {
        renderLoginActivity(await request('api/access/login-activity', { timeoutMs: 10000 }));
      } catch (error) {
        content.innerHTML = `<div class="rf-login-activity-error"><strong>登录动态暂时读取失败</strong><span>${escapeHtml(conciseError(error))}</span><button class="btn-soft" type="button" data-login-activity-retry>重试</button></div>`;
        content.querySelector('[data-login-activity-retry]')?.addEventListener('click', loadLoginActivity);
      } finally {
        if (refreshButton) { refreshButton.disabled = false; refreshButton.textContent = '刷新动态'; }
      }
    }
    document.querySelector('[data-login-activity-refresh]')?.addEventListener('click', loadLoginActivity);
    if (currentTab === 'loginActivity') loadLoginActivity();
    const applyAccessUserFilters = () => {
      const query = String(document.querySelector('[data-access-user-search]')?.value || '').trim().toLocaleLowerCase();
      const status = document.querySelector('[data-access-user-status]')?.value || 'all';
      const departmentId = document.querySelector('[data-access-department-filter]')?.value || '';
      const roleCode = document.querySelector('[data-access-role-filter]')?.value || '';
      const rows = [...document.querySelectorAll('.rf-access-list > article[data-access-user-row]')];
      let visibleCount = 0;
      for (const row of rows) {
        const queryMatch = !query || String(row.dataset.accessUserSearch || '').toLocaleLowerCase().includes(query);
        const statusMatch = status === 'all' || row.dataset.accessUserStatus === status;
        const departmentMatch = !departmentId || String(row.dataset.accessUserDepartments || '').split(' ').includes(departmentId);
        const roleMatch = !roleCode || String(row.dataset.accessUserRoles || '').split(' ').includes(roleCode);
        row.hidden = !(queryMatch && statusMatch && departmentMatch && roleMatch);
        if (!row.hidden) visibleCount += 1;
      }
      const visibleCountNode = document.querySelector('[data-access-visible-count]');
      if (visibleCountNode) visibleCountNode.textContent = `显示 ${visibleCount} 名员工`;
      const visibleChecks = rows.filter((row) => !row.hidden).map((row) => row.querySelector('[data-access-user-select]')).filter((input) => input && !input.disabled);
      const selectVisible = document.querySelector('[data-access-select-visible]');
      if (selectVisible) {
        selectVisible.checked = visibleChecks.length > 0 && visibleChecks.every((input) => input.checked);
        selectVisible.indeterminate = visibleChecks.some((input) => input.checked) && !selectVisible.checked;
      }
    };
    document.querySelector('[data-access-user-search]')?.addEventListener('input', applyAccessUserFilters);
    document.querySelector('[data-access-user-status]')?.addEventListener('change', applyAccessUserFilters);
    document.querySelector('[data-access-department-filter]')?.addEventListener('change', (event) => { state.accessEmployeeDepartmentFilter = event.currentTarget.value; applyAccessUserFilters(); });
    document.querySelector('[data-access-role-filter]')?.addEventListener('change', (event) => { state.accessEmployeeRoleFilter = event.currentTarget.value; applyAccessUserFilters(); });
    document.querySelector('[data-access-department-search]')?.addEventListener('input', (event) => {
      const query = String(event.currentTarget.value || '').trim().toLocaleLowerCase();
      const cards = [...document.querySelectorAll('[data-access-department-card]')];
      for (const card of cards) {
        const ownMatch = !query || String(card.dataset.accessDepartmentSearchText || '').toLocaleLowerCase().includes(query);
        const descendantMatch = query && [...card.querySelectorAll('[data-access-department-card]')].some((child) => String(child.dataset.accessDepartmentSearchText || '').toLocaleLowerCase().includes(query));
        card.hidden = Boolean(query && !ownMatch && !descendantMatch);
        if (query && descendantMatch && card.tagName === 'DETAILS') card.open = true;
      }
    });
    document.querySelectorAll('[data-access-org-edit]').forEach((button) => button.addEventListener('click', () => openAccessOrganizationForm(button.dataset.accessOrgEdit)));
    document.querySelectorAll('[data-access-open-department]').forEach((button) => button.addEventListener('click', () => {
      state.accessEmployeeDepartmentFilter = button.dataset.accessOpenDepartment;
      state.accessEmployeeRoleFilter = '';
      const departmentFilter = document.querySelector('[data-access-department-filter]');
      const roleFilter = document.querySelector('[data-access-role-filter]');
      if (departmentFilter) departmentFilter.value = state.accessEmployeeDepartmentFilter;
      if (roleFilter) roleFilter.value = '';
      setAccessTab('employees');
      applyAccessUserFilters();
    }));
    document.querySelectorAll('[data-access-open-role]').forEach((button) => button.addEventListener('click', () => {
      state.accessEmployeeRoleFilter = button.dataset.accessOpenRole;
      state.accessEmployeeDepartmentFilter = '';
      const roleFilter = document.querySelector('[data-access-role-filter]');
      const departmentFilter = document.querySelector('[data-access-department-filter]');
      if (roleFilter) {
        const roleCode = button.dataset.accessOpenRole;
        if (![...roleFilter.options].some((option) => option.value === roleCode)) {
          const option = document.createElement('option');
          option.value = roleCode;
          option.textContent = `${roleName(roleCode)}（已停用）`;
          roleFilter.append(option);
        }
        roleFilter.value = state.accessEmployeeRoleFilter;
      }
      if (departmentFilter) departmentFilter.value = '';
      setAccessTab('employees');
      applyAccessUserFilters();
    }));
    applyAccessUserFilters();
    const saveAccessSelection = () => {
      state.accessSelectedUserIds = [...document.querySelectorAll('[data-access-user-select]:checked')].map((input) => input.value);
      const count = state.accessSelectedUserIds.length;
      const countNode = document.querySelector('[data-access-selected-count]');
      const batchButton = document.querySelector('[data-access-bulk-binding]');
      const selectionTools = document.querySelector('[data-access-selection-tools]');
      if (countNode) countNode.textContent = `已选 ${count} 人`;
      if (batchButton) batchButton.disabled = count === 0;
      if (selectionTools) selectionTools.hidden = count === 0;
      applyAccessUserFilters();
    };
    document.querySelectorAll('[data-access-user-select]').forEach((input) => input.addEventListener('change', saveAccessSelection));
    document.querySelector('[data-access-select-visible]')?.addEventListener('change', (event) => {
      document.querySelectorAll('.rf-access-list > article[data-access-user-row]').forEach((row) => {
        const input = row.querySelector('[data-access-user-select]');
        if (input && !input.disabled && !row.hidden) input.checked = event.currentTarget.checked;
      });
      saveAccessSelection();
    });
    document.querySelector('[data-access-clear-selection]')?.addEventListener('click', () => {
      document.querySelectorAll('[data-access-user-select]').forEach((input) => { input.checked = false; });
      saveAccessSelection();
    });
    saveAccessSelection();
    const selectedUserIds = () => state.accessSelectedUserIds || [];
    document.querySelector('[data-access-bulk-binding]')?.addEventListener('click', () => openAccessBindingForm(selectedUserIds()));
    document.querySelector('[data-access-user]')?.addEventListener('click', openAccessUserForm);
    document.querySelector('[data-access-user-batch]')?.addEventListener('click', openAccessUserBatchImport);
    document.querySelectorAll('[data-access-user-mobile]').forEach((button) => button.addEventListener('click', () => openAccessUserMobileForm(button.dataset.accessUserMobile)));
    document.querySelector('[data-access-sync-tianji]')?.addEventListener('click', syncAccessTianjiUsers);
    document.querySelector('[data-access-sync-wecom]')?.addEventListener('click', syncAccessWecomUsers);
    document.querySelector('[data-access-binding]')?.addEventListener('click', () => openAccessBindingForm(selectedUserIds()));
    document.querySelectorAll('[data-access-user-binding]').forEach((button) => button.addEventListener('click', () => openAccessBindingForm([button.dataset.accessUserBinding])));
    document.querySelectorAll('[data-access-revoke]').forEach((button) => button.addEventListener('click', () => openAccessRevokeForm(button.dataset.accessRevoke)));

    document.querySelectorAll('[data-access-decision]').forEach((button) => button.addEventListener('click', () => decideSensitiveAccess(button.dataset.accessDecision, button.dataset.decision)));
  }

  function accessAdminForm(title, description, fields, submit, submitLabel = '保存') {
    showTalentDialog(`<header class="rf-dialog-head"><div><button class="rf-dialog-back" data-access-back>← 返回权限管理</button><span>ACCESS CONTROL</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></header><div class="rf-dialog-form rf-access-form-body">${fields}</div><div class="rf-dialog-actions rf-access-form-actions"><button class="btn-soft" data-access-cancel type="button">取消</button><button class="btn-primary" data-access-submit data-access-submit-label="${escapeHtml(submitLabel)}" type="button">${escapeHtml(submitLabel)}</button></div><p class="rf-dialog-message" id="rf-access-message" aria-live="polite"></p>`, 'wide', true);
    document.querySelector('[data-access-back]')?.addEventListener('click', cancelTalentDialog);
    document.querySelector('[data-access-cancel]')?.addEventListener('click', cancelTalentDialog);
    document.querySelector('[data-access-submit]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget, message = document.getElementById('rf-access-message'), label = button.dataset.accessSubmitLabel || submitLabel;
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = '正在保存…';
      message.textContent = '正在保存，请稍候…';
      message.classList.remove('error');
      try {
        await submit();
        await refreshCurrentPermissions();
        if (!hasAccessAction('manage_access_control') || !window.canOpenRecruitmentPage?.('settings')) return;
        state.accessAdminData = await request('api/access/administration');
        returnTalentDialog();
        renderAccessAdministration();
      } catch (error) {
        message.textContent = conciseError(error);
        message.classList.add('error');
        button.disabled = false;
        button.textContent = label;
      }
    });
  }

  function openAccessOrganizationForm(organizationId = '') {
    const data = state.accessAdminData || { organizations: [], users: [] };
    const organization = data.organizations.find((item) => String(item.id) === String(organizationId));
    const descendants = new Set(organization ? [String(organization.id)] : []);
    let foundDescendant = true;
    while (foundDescendant) {
      foundDescendant = false;
      for (const item of data.organizations) {
        if (descendants.has(String(item.parentId || '')) && !descendants.has(String(item.id))) {
          descendants.add(String(item.id));
          foundDescendant = true;
        }
      }
    }
    const departments = accessDepartmentOptions(data.organizations, { includeBusinessUnits: true }).filter((item) => !descendants.has(String(item.id)));
    const employees = data.users.filter((item) => item.status !== '停用');
    const editing = Boolean(organization);
    const parentId = String(organization?.parentId || '');
    accessAdminForm(editing ? '编辑部门' : '新增部门', editing ? '更新部门名称、所属层级和负责人。停用部门前请先安排好员工及下级部门。' : '设置部门名称、上级部门和负责人；部门路径会自动按组织架构显示。', `<label class="wide"><span>部门名称 *</span><input id="access-org-name" value="${escapeHtml(organization?.name || '')}" placeholder="例如：内容运营部"></label><label><span>上级部门</span><select id="access-org-parent"><option value="">无（一级部门）</option>${departments.map((item) => `<option value="${escapeHtml(item.id)}" ${String(item.id) === parentId ? 'selected' : ''}>${escapeHtml(item.path)}</option>`).join('')}</select></label><label><span>部门负责人</span><select id="access-org-owner"><option value="">暂不设置</option>${employees.map((item) => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(organization?.ownerUserId || '') ? 'selected' : ''}>${escapeHtml(item.name || item.id)}${item.mobile ? ` · ${escapeHtml(item.mobile)}` : ''}</option>`).join('')}</select><small>负责人从已登记员工中选择。</small></label>${editing ? `<label><span>部门状态</span><select id="access-org-status"><option value="启用" ${organization.status !== '停用' ? 'selected' : ''}>启用</option><option value="停用" ${organization.status === '停用' ? 'selected' : ''}>停用</option></select></label>` : ''}`, () => {
      const name = document.getElementById('access-org-name').value.trim(), parent = document.getElementById('access-org-parent'), owner = document.getElementById('access-org-owner'), status = document.getElementById('access-org-status');
      if (!name) throw new Error('请填写部门名称');
      if (parent.value && descendants.has(parent.value)) throw new Error('上级部门不能选择本部门或其下级部门');
      const ownerName = owner.value ? (owner.selectedOptions[0]?.textContent?.split(' · ')[0]?.trim() || '') : '';
      return request('api/access/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: organization?.id, type: '部门', name, parentId: parent.value, ownerUserId: owner.value, owner: ownerName, status: status?.value || '启用' }) });
    }, editing ? '保存部门' : '创建部门');
  }

  function openAccessUserForm() {
    const data = state.accessAdminData || { organizations: [], users: [] }, departments = accessDepartmentOptions(data.organizations || []);
    accessAdminForm('添加员工', '登记员工基础资料；企微成员ID同时用于招聘流程个人私信。', `<label><span>姓名 *</span><input id="access-user-name" autocomplete="name" placeholder="请输入员工姓名"></label><label><span>手机号 *</span><input id="access-user-mobile" inputmode="numeric" maxlength="11" autocomplete="tel" placeholder="请输入11位手机号"></label><label><span>企微成员ID（个人私信ID）</span><input id="access-user-tianji-wechat" placeholder="例如 LISIQI"><small>同步企微成员ID后会自动带出，也可手动填写。</small></label><label class="wide"><span>部门 *</span><select id="access-user-dept"><option value="">请选择所属部门</option>${departments.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.path)}</option>`).join('')}</select></label>`, () => {
      const dept = document.getElementById('access-user-dept'), name = document.getElementById('access-user-name').value.trim(), mobile = document.getElementById('access-user-mobile').value.replace(/\s|-/g, ''), tianjiWechatId = document.getElementById('access-user-tianji-wechat').value.trim();
      if (!name) throw new Error('请填写员工姓名');
      if (!/^1[3-9]\d{9}$/.test(mobile)) throw new Error('请填写正确的11位手机号');
      if (!dept.value) throw new Error('请选择所属部门');
      const duplicate = data.users.find((item) => String(item.name || '').trim() === name && String(item.mobile || '').replace(/\s|-/g, '') === mobile);
      if (duplicate) throw new Error(`姓名“${name}”和手机号“${mobile}”已存在员工账号，请勿重复新增`);
      const sameMobile = data.users.find((item) => String(item.mobile || '').replace(/\s|-/g, '') === mobile);
      if (sameMobile) throw new Error(`手机号“${mobile}”已绑定员工“${sameMobile.name || '未命名员工'}”，请核对后再新增`);
      const selectedDepartment = departments.find((item) => String(item.id) === dept.value);
      return request('api/access/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mobile, tianjiWechatId, departmentIds: [dept.value], departments: [selectedDepartment?.name || dept.selectedOptions[0]?.textContent || ''] }) });
    });
  }

  function openAccessUserMobileForm(userId) {
    const user = (state.accessAdminData?.users || []).find((item) => item.id === userId);
    if (!user) return;
    const departments = accessDepartmentOptions(state.accessAdminData?.organizations || []);
    const departmentId = user.departmentIds?.[0], department = (departmentId ? accessOrganizationPath(departmentId, state.accessAdminData?.organizations || []) : '') || user.departments?.[0] || '暂未归属部门';
    accessAdminForm('编辑员工资料', `更新“${user.name || user.id}”的基础资料；修改部门后会同步该员工启用中的角色数据范围。`, `<label><span>姓名 *</span><input id="access-user-name-edit" autocomplete="name" value="${escapeHtml(user.name || '')}" placeholder="请输入员工姓名"></label><label><span>工号</span><input id="access-user-number-edit" autocomplete="off" value="${escapeHtml(user.employeeNumber || '')}" placeholder="选填"></label><label><span>手机号 *</span><input id="access-user-mobile-edit" inputmode="numeric" maxlength="11" autocomplete="tel" value="${escapeHtml(user.mobile || '')}" placeholder="请输入11位手机号"></label><label><span>邮箱</span><input id="access-user-email-edit" type="email" autocomplete="email" value="${escapeHtml(user.email || '')}" placeholder="选填"></label><label class="wide"><span>部门 *</span><select id="access-user-dept-edit"><option value="">请选择所属部门</option>${departments.map((item) => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(departmentId || '') ? 'selected' : ''}>${escapeHtml(item.path)}</option>`).join('')}</select><small>当前部门：${escapeHtml(department)}。调整后立即影响岗位、首页等部门数据范围。</small></label><label class="wide"><span>企微成员 ID（个人私信 ID）</span><input id="access-user-tianji-wechat-edit" value="${escapeHtml(user.tianjiWechatId || user.wecomUserId || '')}" placeholder="例如 LISIQI"><small>用于企微通讯录匹配和招聘流程个人私信。</small></label><p class="rf-access-inherit-note wide">保存后仍使用原有员工账号 ID，不会重新创建账号，也不会移除已配置的角色权限。</p>`, () => {
      const name = document.getElementById('access-user-name-edit').value.trim();
      const mobile = document.getElementById('access-user-mobile-edit').value.replace(/\s|-/g, '');
      const email = document.getElementById('access-user-email-edit').value.trim();
      const employeeNumber = document.getElementById('access-user-number-edit').value.trim();
      const tianjiWechatId = document.getElementById('access-user-tianji-wechat-edit').value.trim();
      const dept = document.getElementById('access-user-dept-edit'), selectedDepartment = departments.find((item) => String(item.id) === String(dept.value));
      if (!name) throw new Error('请填写员工姓名');
      if (!/^1[3-9]\d{9}$/.test(mobile)) throw new Error('请填写正确的11位手机号');
      if (!dept.value) throw new Error('请选择所属部门');
      const duplicate = (state.accessAdminData?.users || []).find((item) => item.id !== user.id && String(item.mobile || '').replace(/\s|-/g, '') === mobile);
      if (duplicate) throw new Error(`手机号“${mobile}”已绑定员工“${duplicate.name || '未命名员工'}”，请核对后再修改`);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请填写有效的邮箱地址');
      return request('api/access/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.id, name, mobile, employeeNumber, email, wecomUserId: user.wecomUserId, tianjiWechatId, businessUnitId: user.businessUnitId, businessUnit: user.businessUnit, departmentIds: [dept.value], departments: [selectedDepartment?.name || ''], status: user.status, source: '管理员修改员工资料' }) });
    }, '保存资料');
  }

  function parseEmployeeBatchText(value) {
    const rows = String(value || '').split(/\r?\n/).map((raw, index) => {
      const line = raw.trim();
      if (!line) return null;
      if (/^(姓名|名字|员工姓名)\s+(手机号|手机|电话)$/i.test(line)) return null;
      let parts = line.split(/[\t,，;；]/).map((item) => item.trim()).filter(Boolean);
      if (parts.length < 2) {
        const matched = line.match(/^(.*?)\s+(1[3-9]\d{9})$/);
        parts = matched ? [matched[1].trim(), matched[2]] : parts;
      }
      const name = parts[0] || '', mobile = String(parts[1] || '').replace(/\s|-/g, '');
      if (/^(姓名|名字|员工姓名)$/i.test(name) && /^(手机号|手机|电话)$/i.test(mobile)) return null;
      return { line: index + 1, name, mobile, valid: Boolean(name) && /^1[3-9]\d{9}$/.test(mobile) };
    }).filter(Boolean);
    return rows;
  }

  function openAccessUserBatchImport() {
    const organizations = state.accessAdminData?.organizations || [], departments = accessDepartmentOptions(organizations);
    accessAdminForm('批量导入员工', '从 Excel 复制“姓名、手机号”两列后直接粘贴即可；本批员工会统一归属到你选择的一个部门。单次最多500人。', `<label class="wide"><span>所属部门 *</span><select id="access-batch-user-dept"><option value="">请选择所属部门</option>${departments.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.path)}</option>`).join('')}</select></label><label class="wide"><span>员工名单 *</span><textarea id="access-batch-user-text" rows="11" placeholder="姓名\t手机号\n张三\t13800138000\n李四\t13900139000"></textarea><small>支持 Excel 两列直接粘贴，也支持“姓名,手机号”或“姓名 手机号”；首行“姓名、手机号”会自动忽略。</small></label><div class="rf-access-import-preview" id="access-batch-user-preview">粘贴名单后将显示可导入人数。</div>`, async () => {
      const dept = document.getElementById('access-batch-user-dept'), rows = parseEmployeeBatchText(document.getElementById('access-batch-user-text').value), invalid = rows.filter((item) => !item.valid);
      if (!dept.value) throw new Error('请选择所属部门');
      if (!rows.length) throw new Error('请粘贴至少一名员工的姓名和手机号');
      if (rows.length > 500) throw new Error('单次最多导入500名员工，请拆分后重试');
      if (invalid.length) throw new Error(`第 ${invalid.slice(0, 5).map((item) => item.line).join('、')} 行姓名或手机号不正确，请修正后重试`);
      const selectedDepartment = departments.find((item) => String(item.id) === dept.value);
      const result = await request('api/access/users/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ departmentId: dept.value, department: selectedDepartment?.name || dept.selectedOptions[0]?.textContent || '', items: rows.map((item) => ({ name: item.name, mobile: item.mobile })) }) });
      if (result.failed) throw new Error(`已导入 ${result.succeeded}/${result.total} 名员工；失败：${result.results.filter((item) => item.status === 'failed').slice(0, 3).map((item) => `${item.name || `第${item.index}行`}（${item.message}）`).join('；')}`);
      notifyUser(`已成功导入 ${result.succeeded} 名员工`, 'success');
    }, '开始导入');
    const preview = () => { const rows = parseEmployeeBatchText(document.getElementById('access-batch-user-text')?.value), valid = rows.filter((item) => item.valid).length, invalid = rows.length - valid, node = document.getElementById('access-batch-user-preview'); if (node) { node.className = `rf-access-import-preview${invalid || rows.length > 500 ? ' error' : valid ? ' ready' : ''}`; node.textContent = !rows.length ? '粘贴名单后将显示可导入人数。' : rows.length > 500 ? `当前 ${rows.length} 人，单次最多导入500人。` : invalid ? `识别到 ${valid} 名有效员工，${invalid} 行格式不正确。` : `已识别 ${valid} 名员工，格式正确，可开始导入。`; } };
    document.getElementById('access-batch-user-text')?.addEventListener('input', preview);
  }

  function openAccessBindingForm(selectedUserIds = []) {
    const data = state.accessAdminData || { users: [], roles: [], bindings: [], organizations: [] };
    const users = data.users.filter((item) => item.status !== '停用');
    const roles = data.roles.filter((item) => item.status === '启用');
    const selectedIds = new Set((Array.isArray(selectedUserIds) ? selectedUserIds : [selectedUserIds]).map(String).filter(Boolean));
    const employeeRows = users.map((user) => {
      const departmentId = user.departmentIds?.[0], department = (departmentId ? accessOrganizationPath(departmentId, data.organizations) : '') || user.departments?.[0] || '未分配部门';
      const search = [user.name, user.id, user.mobile, department, user.status].filter(Boolean).join(' ');
      return `<label class="rf-access-pick-option" data-access-pick-user data-access-pick-search="${escapeHtml(search)}"><input type="checkbox" name="access-binding-user" value="${escapeHtml(user.id)}" ${selectedIds.has(String(user.id)) ? 'checked' : ''}><span><strong>${escapeHtml(user.name || user.id)}</strong><small>${escapeHtml(department)}${user.mobile ? ` · ${escapeHtml(user.mobile)}` : ''} · ${escapeHtml(user.status || '待开通')}</small></span></label>`;
    }).join('');
    const roleOptions = roles.map((role) => `<label class="rf-access-role-option"><input type="checkbox" name="access-binding-role" value="${escapeHtml(role.code)}"><span><strong>${escapeHtml(role.name)}</strong><small>${escapeHtml(accessRoleDescription(role))}</small></span></label>`).join('');
    accessAdminForm('批量追加员工权限', '可同时选择多名员工和多个角色；只新增缺少的角色，不会覆盖或撤销已有权限。', `<section class="rf-access-assignment-section"><div class="rf-access-assignment-heading"><div><strong>选择员工</strong><small>支持搜索、全选当前结果；停用账号不能授权。</small></div><span data-access-assignment-user-count>已选 0 人</span></div><div class="rf-access-pick-toolbar"><input id="access-assignment-search" type="search" placeholder="搜索姓名、部门或手机号" autocomplete="off"><label><input type="checkbox" id="access-assignment-select-visible"><span>全选当前结果</span></label></div><div class="rf-access-pick-list">${employeeRows || '<p class="rf-access-no-options">暂无可授权员工。</p>'}</div></section><section class="rf-access-assignment-section"><div class="rf-access-assignment-heading"><div><strong>追加角色</strong><small>同一员工多个角色的权限会叠加，请按最小必要原则选择。</small></div><span data-access-assignment-role-count>已选 0 个角色</span></div><div class="rf-access-role-grid">${roleOptions || '<p class="rf-access-no-options">暂无启用的权限角色。</p>'}</div></section><div class="rf-access-assignment-summary" aria-live="polite"><strong data-access-assignment-summary>请选择员工和角色</strong><p data-access-assignment-note>系统会自动沿用员工当前部门范围。</p></div>`, async () => {
      const selectedUsers = [...document.querySelectorAll('[name="access-binding-user"]:checked')].map((input) => input.value);
      const selectedRoles = [...document.querySelectorAll('[name="access-binding-role"]:checked')].map((input) => input.value);
      if (!selectedUsers.length) throw new Error('请至少选择一名员工');
      if (!selectedRoles.length) throw new Error('请至少选择一个权限角色');
      if (selectedUsers.length * selectedRoles.length > 200) throw new Error('单次最多新增200条角色绑定，请减少员工或角色后分批操作');
      const result = await request('api/access/role-bindings/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userIds: selectedUsers, roleCodes: selectedRoles }) });
      state.accessSelectedUserIds = [];
      notifyUser(`权限追加完成：新增 ${Number(result.assigned || 0)} 项，跳过已拥有 ${Number(result.alreadyHad || 0)} 项${result.activatedUsers ? `；待开通账号已启用 ${Number(result.activatedUsers)} 个` : ''}`, result.assigned || result.alreadyHad ? 'success' : 'warning');
    }, '确认追加权限');
    const userChecks = [...document.querySelectorAll('[name="access-binding-user"]')];
    const roleChecks = [...document.querySelectorAll('[name="access-binding-role"]')];
    const updateSummary = () => {
      const selectedUsers = userChecks.filter((input) => input.checked).map((input) => users.find((user) => String(user.id) === input.value)).filter(Boolean);
      const selectedRoles = roleChecks.filter((input) => input.checked).map((input) => input.value);
      const pairCount = selectedUsers.length * selectedRoles.length;
      const bindingKeys = new Set(data.bindings.filter((item) => item.status === '启用' && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now())).map((item) => `${item.userId}\u0000${item.roleCode}`));
      const alreadyHad = selectedUsers.reduce((count, user) => count + selectedRoles.filter((roleCode) => bindingKeys.has(`${user.id}\u0000${roleCode}`)).length, 0);
      const noDepartment = selectedUsers.filter((user) => !accessUserGrantDepartmentIds(user, data.organizations).length);
      const pendingUsers = selectedUsers.filter((user) => user.status === '待开通').length;
      const userCount = document.querySelector('[data-access-assignment-user-count]');
      const roleCount = document.querySelector('[data-access-assignment-role-count]');
      const summary = document.querySelector('[data-access-assignment-summary]');
      const note = document.querySelector('[data-access-assignment-note]');
      const submitButton = document.querySelector('[data-access-submit]');
      if (userCount) userCount.textContent = `已选 ${selectedUsers.length} 人`;
      if (roleCount) roleCount.textContent = `已选 ${selectedRoles.length} 个角色`;
      if (summary) summary.textContent = pairCount ? `共 ${pairCount} 项，预计新增 ${pairCount - alreadyHad} 项${alreadyHad ? `，跳过已拥有 ${alreadyHad} 项` : ''}` : '请选择员工和角色';
      if (note) note.textContent = noDepartment.length ? `${noDepartment.slice(0, 3).map((user) => user.name || user.id).join('、')}${noDepartment.length > 3 ? '等员工' : ''}尚未归属有效部门，需先完善资料。` : pendingUsers ? `其中 ${pendingUsers} 名员工待开通；按现有授权流程，完成授权后账号会启用。` : '权限会限定在员工当前部门范围内；已有角色保持不变。';
      if (submitButton) submitButton.disabled = !selectedUsers.length || !selectedRoles.length || pairCount > 200 || noDepartment.length > 0;
    };
    document.getElementById('access-assignment-search')?.addEventListener('input', (event) => {
      const query = String(event.currentTarget.value || '').trim().toLocaleLowerCase();
      document.querySelectorAll('[data-access-pick-user]').forEach((item) => { item.hidden = !String(item.dataset.accessPickSearch || '').toLocaleLowerCase().includes(query); });
      const selectVisible = document.getElementById('access-assignment-select-visible');
      if (selectVisible) {
        const visibleChecks = userChecks.filter((input) => !input.closest('[data-access-pick-user]')?.hidden);
        selectVisible.checked = visibleChecks.length > 0 && visibleChecks.every((input) => input.checked);
        selectVisible.indeterminate = visibleChecks.some((input) => input.checked) && !selectVisible.checked;
      }
    });
    document.getElementById('access-assignment-select-visible')?.addEventListener('change', (event) => {
      userChecks.forEach((input) => { if (!input.closest('[data-access-pick-user]')?.hidden) input.checked = event.currentTarget.checked; });
      updateSummary();
    });
    [...userChecks, ...roleChecks].forEach((input) => input.addEventListener('change', updateSummary));
    updateSummary();
  }

  function openAccessRoleForm(code = '') {
    const role = (state.accessAdminData?.roles || []).find((item) => item.code === code);
    const editing = Boolean(role);
    const levels = [
      ['L1', 'L1 · 基础使用'],
      ['L2', 'L2 · 业务操作'],
      ['L3', 'L3 · 业务管理'],
      ['L4', 'L4 · 高级管理'],
    ];
    const dataScopes = [
      ['self', '仅本人'],
      ['assigned_interviews', '本人参与的面试'],
      ['assigned_departments', '所属部门'],
      ['business_unit', '所属事业部'],
      ['all', '全公司'],
    ];
    const permissionFields = editing ? '<p class="rf-access-inherit-note wide">菜单、按钮和字段权限请在保存基础信息后，返回角色列表点“配置权限”维护。</p>' : `<label class="wide"><span>菜单权限 *</span><div class="rf-permission-checks">${Object.entries(accessPageOptions).map(([key, label]) => `<label><input type="checkbox" name="role-page" value="${key}"><span>${label}</span></label>`).join('')}</div></label><label class="wide"><span>字段权限</span><div class="rf-permission-checks">${[['salary', '薪资'], ['contacts', '联系方式'], ['resume', '简历原文']].map(([key, label]) => `<label><input type="checkbox" name="role-field" value="${key}"><span>${label}</span></label>`).join('')}</div></label><label class="wide"><span>按钮权限 *</span><div class="rf-permission-checks">${accessActionOptions.map((item) => `<label><input type="checkbox" name="role-action" value="${item.code}"><span>${item.label}</span></label>`).join('')}</div></label>`;
    accessAdminForm(editing ? `编辑角色 · ${role.name}` : '新增角色', editing ? '维护角色名称、说明、层级和数据范围；角色编码创建后不可修改。' : '设置角色基础信息和初始权限；角色编码创建后不可修改。', `<label><span>角色编码 *</span><input id="access-role-code" value="${escapeHtml(editing ? role.code : '')}" ${editing ? 'disabled' : 'autocomplete="off"'} placeholder="例如 recruitment_support"></label><label><span>角色名称 *</span><input id="access-role-name" value="${escapeHtml(editing ? role.name : '')}" maxlength="30" placeholder="例如：招聘支持"></label><label><span>角色层级 *</span><select id="access-role-level">${levels.map(([value, label]) => `<option value="${value}" ${editing && role.level === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label><span>数据范围 *</span><select id="access-role-scope">${dataScopes.map(([value, label]) => `<option value="${value}" ${editing && role.dataScope === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="wide"><span>角色说明</span><textarea id="access-role-description" rows="3" maxlength="300" placeholder="说明这个角色给谁用、边界是什么">${escapeHtml(editing ? role.description : '')}</textarea></label>${permissionFields}`, async () => {
      const name = document.getElementById('access-role-name')?.value.trim() || '';
      const level = document.getElementById('access-role-level')?.value || 'L1';
      const dataScope = document.getElementById('access-role-scope')?.value || 'self';
      const description = document.getElementById('access-role-description')?.value.trim() || '';
      if (editing) {
        await request(`api/access/roles/${encodeURIComponent(code)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, level, dataScope, description }) });
        return;
      }
      const roleCode = document.getElementById('access-role-code')?.value.trim() || '';
      const sensitiveFields = {};
      document.querySelectorAll('[name="role-field"]').forEach((input) => { sensitiveFields[input.value] = input.checked ? 'full' : 'hidden'; });
      const body = {
        code: roleCode,
        name,
        level,
        dataScope,
        description,
        pages: [...document.querySelectorAll('[name="role-page"]:checked')].map((input) => input.value),
        actions: [...document.querySelectorAll('[name="role-action"]:checked')].map((input) => input.value),
        sensitiveFields,
      };
      await request('api/access/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }, editing ? '保存角色信息' : '创建角色');
  }

  function openAccessRoleStatusForm(code, status) {
    const role = (state.accessAdminData?.roles || []).find((item) => item.code === code);
    if (!role || !['启用', '停用'].includes(status)) return;
    const disabling = status === '停用';
    accessAdminForm(`${disabling ? '停用' : '启用'}角色 · ${role.name}`, disabling ? '停用后该角色立即不再生效，已有员工绑定和操作记录会保留，可随时重新启用。' : '启用后已绑定该角色的员工会立即恢复对应权限。', `<p class="rf-access-inherit-note">${disabling ? '系统不会删除员工绑定。若员工还绑定其他角色，权限仍会按其他角色合并计算。' : '请确认角色权限范围仍然符合当前岗位职责。'}</p>`, () => request(`api/access/roles/${encodeURIComponent(code)}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }), disabling ? '确认停用' : '确认启用');
  }

  function openRolePermissionForm(code) {
    const role = (state.accessAdminData?.roles || []).find((item) => item.code === code); if (!role) return;
    const fields = { "salary": "薪资", "contacts": "联系方式",   "resume": "简历原文" };
    accessAdminForm(`配置角色权限 · ${role.name}`, '配置当前角色的菜单、字段和按钮权限；同一员工绑定多个角色时，权限会合并。仅内部推荐的员工请只保留普通员工角色。', `<div class="rf-permission-editor"><label class="wide"><span>菜单权限</span><div class="rf-permission-checks">${Object.entries(accessPageOptions).map(([key,label]) => `<label><input type="checkbox" name="role-page" value="${key}" ${role.pages?.includes('*') || role.pages?.includes(key) || key === 'positions' && role.pages?.includes('jobs') ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></label><label class="wide"><span>字段权限</span><div class="rf-permission-checks">${Object.entries(fields).map(([key,label]) => `<label><input type="checkbox" name="role-field" value="${key}" ${String(role.sensitiveFields?.[key] ?? 'hidden') !== 'hidden' ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></label><label class="wide"><span>按钮权限</span><div class="rf-permission-checks">${accessActionOptions.map((item) => `<label><input type="checkbox" name="role-action" value="${item.code}" ${role.actions?.includes('*') || role.actions?.includes(item.code) ? 'checked' : ''}><span>${item.label}</span></label>`).join('')}</div></label></div>`, async () => { const sensitiveFields = {}; document.querySelectorAll('[name="role-field"]').forEach((input) => { sensitiveFields[input.value] = input.checked ? 'full' : 'hidden'; }); await request(`api/access/roles/${encodeURIComponent(code)}/permissions`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ pages:[...document.querySelectorAll('[name="role-page"]:checked')].map((item) => item.value), actions:[...document.querySelectorAll('[name="role-action"]:checked')].map((item) => item.value), sensitiveFields }) }); await openAccessAdministration(); }, '保存角色权限');
  }

  function renderRolePermissionInline(code) {
    const role = (state.accessAdminData?.roles || []).find((item) => item.code === code); const panel = document.querySelector('[data-role-permission-panel]'); if (!role || !panel) return;
    const fields = { salary:'薪资', contacts:'联系方式', resume:'简历原文' };
    const pageChecks = Object.entries(accessPageOptions).map(([key, label]) => `<label><input name="role-page" value="${key}" type="checkbox" ${role.pages?.includes('*') || role.pages?.includes(key) || key === 'positions' && role.pages?.includes('jobs') ? 'checked' : ''}><span>${label}</span></label>`).join('');
    const fieldChecks = Object.entries(fields).map(([key, label]) => `<label><input name="role-field" value="${key}" type="checkbox" ${String(role.sensitiveFields?.[key] ?? 'hidden') !== 'hidden' ? 'checked' : ''}><span>${label}</span></label>`).join('');
    const actionChecks = accessActionOptions.map((item) => `<label><input name="role-action" value="${item.code}" type="checkbox" ${role.actions?.includes('*') || role.actions?.includes(item.code) ? 'checked' : ''}><span>${item.label}</span></label>`).join('');
    panel.innerHTML = `<div class="rf-role-editor-head"><div><span>ROLE PERMISSIONS</span><h3>${escapeHtml(role.name)}</h3><p>${escapeHtml(accessRoleDescription(role))}</p></div><button class="btn-primary" data-role-permission-save type="button">保存权限</button></div><p class="rf-access-inherit-note">多个启用角色的权限会合并。只需要内部推荐时，请确保员工没有绑定其他授予更多菜单的角色。</p><section><h4>菜单权限</h4><div class="rf-permission-checks">${pageChecks}</div></section><section><h4>字段权限</h4><div class="rf-permission-checks">${fieldChecks}</div></section><section><h4>按钮权限</h4><div class="rf-permission-checks">${actionChecks}</div></section><p class="rf-dialog-message" data-role-permission-message></p>`;
    panel.querySelector('[data-role-permission-save]')?.addEventListener('click', async (event) => { const button = event.currentTarget; button.disabled = true; button.textContent = '保存中…'; const sensitiveFields = {}; panel.querySelectorAll('[name="role-field"]').forEach((input) => { sensitiveFields[input.value] = input.checked ? 'full' : 'hidden'; }); try { await request(`api/access/roles/${encodeURIComponent(code)}/permissions`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ pages:[...panel.querySelectorAll('[name="role-page"]:checked')].map((item)=>item.value), actions:[...panel.querySelectorAll('[name="role-action"]:checked')].map((item)=>item.value), sensitiveFields }) }); panel.querySelector('[data-role-permission-message]').textContent='角色权限已保存'; await refreshCurrentPermissions(); if (hasAccessAction('manage_access_control')) await openAccessAdministration(); } catch(error) { button.disabled=false; button.textContent='保存权限'; panel.querySelector('[data-role-permission-message]').textContent=error.message; } });
  }
  function openAccessRevokeForm(bindingId) {
    accessAdminForm('移除员工权限', '移除后立即生效，该员工将不能再使用该角色对应的菜单和操作。', `<p class="rf-access-inherit-note">系统会自动记录本次权限移除，无需额外填写原因。</p>`, () => request(`api/access/role-bindings/${encodeURIComponent(bindingId)}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '管理员移除员工权限' }) }));
  }

  async function syncAccessWecomUsers() {
    const button = document.querySelector('[data-access-sync-wecom]');
    const loading = showGlobalLoading('正在准备同步企微成员 ID…');
    try {
      if (button) { button.disabled = true; button.textContent = '正在创建同步任务…'; }
      const started = await request('api/access/users/wecom/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      for (let attempt = 0; attempt < 360; attempt += 1) {
        const job = await request(`api/jobs/${encodeURIComponent(started.jobId)}`);
        if (button) button.textContent = job.progress || '正在同步企微成员 ID…'; loading(job.progress || '正在同步企微成员 ID…');
        if (job.status === 'done') {
          const result = job.data || {}, pending = (result.ambiguous?.length || 0) + (result.notFound?.length || 0) + (result.failed?.length || 0);
          notifyUser(`企微成员 ID 同步完成：通讯录更新 ${Number(result.synced || 0)} 人，兼容回填 ${Number(result.normalized || 0)} 人，已一致 ${Number(result.unchanged || 0)} 人${pending ? `，${pending} 人待人工处理` : ''}`, pending ? 'warning' : 'success');
          hideGlobalLoading(); await openAccessAdministration();
          return;
        }
        if (job.status === 'failed') throw new Error(job.error || '企微成员 ID 同步失败');
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      throw new Error('同步任务仍在进行，请稍后重新打开组织与权限查看结果');
    } catch (error) { hideGlobalLoading(); notifyUser(conciseError(error), 'error'); if (button) { button.disabled = false; button.textContent = '同步企微成员 ID'; } }
  }

  async function syncAccessTianjiUsers() {
    const button = document.querySelector('[data-access-sync-tianji]');
    const loading = showGlobalLoading('正在读取天玑花名册…');
    try {
      if (button) { button.disabled = true; button.textContent = '正在同步天玑状态…'; }
      const started = await request('api/access/users/tianji/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      for (let attempt = 0; attempt < 360; attempt += 1) {
        const job = await request(`api/jobs/${encodeURIComponent(started.jobId)}`);
        if (button) button.textContent = job.progress || '正在同步天玑员工状态…'; loading(job.progress || '正在同步天玑员工状态…');
        if (job.status === 'done') { const r = job.data || {}, pending = Number(r.missing || 0) + Number(r.ambiguous || 0); hideGlobalLoading(); notifyUser(`天玑员工状态同步完成：花名册 ${Number(r.roster || 0)} 人，人才库匹配 ${Number(r.matched || 0)} 人，在职 ${Number(r.active || 0)} 人，离职 ${Number(r.left || 0)} 人，入职日期 ${Number(r.hireDateSynced || 0)} 人，离职日期 ${Number(r.leaveDateSynced || 0)} 人${Number(r.lifecycleUpdated || 0) ? `，更新入离职记录 ${Number(r.lifecycleUpdated || 0)} 人` : ''}${pending ? `，${pending} 人未匹配且保留原状态` : ''}`, pending ? 'warning' : 'success'); await openAccessAdministration(); return; }
        if (job.status === 'failed') throw new Error(job.error || '天玑员工状态同步失败');
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      throw new Error('同步任务仍在进行，请稍后重新打开组织与权限查看结果');
    } catch (error) { hideGlobalLoading(); notifyUser(conciseError(error), 'error'); if (button) { button.disabled = false; button.textContent = '同步天玑员工状态'; } }
  }

  async function decideSensitiveAccess(requestId, decision) {
    const opinion = decision === '通过' ? '业务目的与最小必要范围已核对，限时授权两小时。' : '申请目的或字段范围不符合最小必要原则。';
    try { await request(`api/access/sensitive-requests/${encodeURIComponent(requestId)}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, opinion, durationHours: 2 }) }); await openAccessAdministration(); } catch (error) { notifyUser(conciseError(error), 'error'); }
  }

  function loadPointsPage() {
    window.mountPointsRankingPage?.();
  }

  function loadAnalyticsPage() {
    window.mountAnalyticsPage?.();
  }

  async function loadApiPage() {
    window.mountResumeApiPage?.();
  }

  function accessRoleDescription(role, fallback = '按角色配置的系统权限') {
    if (role?.code === 'department_leader') return '可查看员工档案所属部门组织范围内的招聘看板、岗位和招聘HR；页面及操作权限仍由管理员配置。';
    return role?.description || role?.dataScope || fallback;
  }

  const accessRoleNames = {
    system_admin: '系统管理员', recruiter: '招聘专员', referrer: '内推人', hrbp: 'HRBP', interviewer: '面试官', business_manager: '业务助理', department_leader: '部门负责人',
    ai_operations: 'AI运营', administration: '行政', executive: '管理层', candidate: '候选人',
  };

  function accessAccount(access) {
    const account = access?.account || {};
    return {
      id: access?.userId || account.id || '',
      name: access?.userName || account.name || access?.userId || '当前用户',
      mobile: account.mobile || '',
      organization: [account.businessUnit, ...(account.departments || [])].filter(Boolean).join(' · '),
    };
  }

  function renderAuthState(access) {
    const panel = document.getElementById('auth-panel');
    if (!panel) return;
    const account = accessAccount(access);
    const identityCard = access?.authenticated ? `<div class="auth-account"><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(account.id || '企业身份已识别')}</span></div>` : '';
    const refresh = '<button class="auth-secondary" data-auth-refresh type="button">重新检测身份</button>';
    if (access?.accessState === 'unregistered') {
      panel.innerHTML = `<div class="auth-state"><div class="auth-state-icon">✓</div><h2>企业身份已确认</h2><p>你的身份还没有加入人才管理系统。提交开通申请后，由管理员分配部门和角色。</p>${identityCard}<div class="auth-actions"><button class="auth-primary" data-auth-apply type="button">申请开通系统</button>${refresh}</div></div>`;
    } else if (access?.accessState === 'pending') {
      panel.innerHTML = `<div class="auth-state"><div class="auth-state-icon warn">…</div><h2>开通申请待处理</h2><p>管理员审核并配置权限后即可进入。系统不会因为提交申请而自动开放人才数据。</p>${identityCard}<div class="auth-actions">${refresh}</div></div>`;
    } else if (access?.accessState === 'no_role') {
      panel.innerHTML = `<div class="auth-state"><div class="auth-state-icon warn">!</div><h2>账号尚未配置权限</h2><p>账号已经启用，但还没有可用权限。请联系管理员在“组织与权限”中完成配置。</p>${identityCard}<div class="auth-actions">${refresh}</div></div>`;
    } else if (access?.accessState === 'profile_incomplete') {
      renderFirstLoginProfile(access);
      return;
    } else if (access?.accessState === 'disabled') {
      panel.innerHTML = `<div class="auth-state"><div class="auth-state-icon danger">×</div><h2>账号已停用</h2><p>当前企业身份对应的系统账号已停用。如属于职责调整，请联系系统管理员重新开通。</p>${identityCard}<div class="auth-actions">${refresh}</div></div>`;
    } else {
      renderEmployeeLogin();
      return;
    }
    panel.querySelector('[data-auth-refresh]')?.addEventListener('click', initializeIdentity);
    panel.querySelector('[data-auth-apply]')?.addEventListener('click', () => renderAccessApplication(access));
  }

  function renderEmployeeLogin() {
    const panel = document.getElementById('auth-panel');
    if (!panel) return;
    panel.innerHTML = `<form class="auth-apply-form auth-login-form" id="auth-login-form"><div class="auth-state-icon">人</div><h2>员工登录</h2><p>请输入管理员已开通的姓名和手机号。验证成功后系统会记住当前设备，之后进入应用无需重复填写。</p><div class="auth-form-grid"><label><span>姓名 *</span><input name="name" required autocomplete="name" placeholder="请输入真实姓名"></label><label><span>手机号 *</span><input name="mobile" inputmode="tel" maxlength="11" required autocomplete="tel" placeholder="请输入11位手机号"></label></div><div class="auth-login-note"><strong>无需账号密码</strong><span>账号、角色和权限由管理员在“组织与权限”中统一维护。</span></div><p class="auth-message" id="auth-login-message"></p><div class="auth-actions"><button class="auth-primary" type="submit">登录并进入系统</button></div></form>`;
    panel.querySelector('#auth-login-form')?.addEventListener('submit', submitEmployeeLogin);
  }

  async function submitEmployeeLogin(event) {
    event.preventDefault();
    const form = event.currentTarget, message = document.getElementById('auth-login-message');
    const payload = Object.fromEntries(new FormData(form).entries()), name = String(payload.name || '').trim(), mobile = String(payload.mobile || '').replace(/\s|-/g, '');
    if (!name) { message.textContent = '请填写姓名。'; message.classList.add('error'); return; }
    if (!/^1[3-9]\d{9}$/.test(mobile)) { message.textContent = '请填写正确的11位手机号。'; message.classList.add('error'); return; }
    const submit = form.querySelector('button[type="submit"]');
    try {
      submit.disabled = true; message.classList.remove('error'); message.textContent = '正在验证员工账号…';
      await request('api/access/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mobile }), initiator: submit });
      await initializeIdentity();
    } catch (error) {
      message.textContent = conciseError(error); message.classList.add('error'); submit.disabled = false;
    }
  }

  function renderAccessApplication(access) {
    const panel = document.getElementById('auth-panel');
    if (!panel) return;
    const account = accessAccount(access);
    panel.innerHTML = `<form class="auth-apply-form" id="auth-apply-form"><h2>申请开通系统</h2><p>姓名和企业身份由系统自动读取。手机号首次登录必须填写，用于账号识别和内推归属。</p><div class="auth-account"><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(account.id)}</span></div><div class="auth-form-grid"><label><span>所在部门</span><input name="department" placeholder="例如：产品部"></label><label><span>申请用途</span><select name="purpose"><option>招聘业务</option><option>部门招聘审批</option><option>参与面试</option><option>内部推荐</option><option>数据查看</option></select></label><label><span>企业邮箱</span><input name="email" type="email" placeholder="选填"></label><label><span>手机号 *</span><input name="mobile" inputmode="tel" maxlength="11" required placeholder="请输入11位手机号"></label><label class="wide"><span>申请原因 *</span><textarea name="reason" required placeholder="请说明你的岗位职责和需要使用的功能"></textarea></label></div><p class="auth-message" id="auth-apply-message"></p><div class="auth-actions"><button class="auth-primary" type="submit">提交申请</button><button class="auth-secondary" data-auth-back type="button">返回</button></div></form>`;
    panel.querySelector('[data-auth-back]')?.addEventListener('click', () => renderAuthState(access));
    panel.querySelector('#auth-apply-form')?.addEventListener('submit', submitAccessApplication);
  }

  async function submitAccessApplication(event) {
    event.preventDefault();
    const form = event.currentTarget, message = document.getElementById('auth-apply-message');
    const payload = Object.fromEntries(new FormData(form).entries());
    if (!/^1[3-9]\d{9}$/.test(String(payload.mobile || '').replace(/\s|-/g, ''))) { message.textContent = '请填写正确的11位手机号。'; message.classList.add('error'); return; }
    if (!String(payload.reason || '').trim()) { message.textContent = '请填写申请原因。'; message.classList.add('error'); return; }
    const submit = form.querySelector('button[type="submit"]');
    try {
      submit.disabled = true; message.classList.remove('error'); message.textContent = '正在提交开通申请…';
      await request('api/access/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), initiator: submit });
      const latest = await request('api/access/me');
      state.currentAccess = latest; renderAuthState(latest);
    } catch (error) {
      message.textContent = conciseError(error); message.classList.add('error'); submit.disabled = false;
    }
  }

  function renderFirstLoginProfile(access) {
    const panel = document.getElementById('auth-panel');
    if (!panel) return;
    const account = accessAccount(access);
    panel.innerHTML = `<form class="auth-apply-form auth-profile-form" id="auth-profile-form"><div class="auth-state-icon">1</div><h2>完成首次登录资料</h2><p>请确认姓名并填写手机号。系统使用“姓名 + 手机号”识别员工、归属内推二维码并避免重复账号。</p><div class="auth-form-grid"><label><span>姓名 *</span><input name="name" value="${escapeHtml(account.name)}" required autocomplete="name"></label><label><span>手机号 *</span><input name="mobile" inputmode="tel" maxlength="11" required autocomplete="tel" placeholder="请输入11位手机号"></label></div><p class="auth-message" id="auth-profile-message"></p><div class="auth-actions"><button class="auth-primary" type="submit">保存并进入系统</button><button class="auth-secondary" data-auth-refresh type="button">重新检测身份</button></div></form>`;
    panel.querySelector('[data-auth-refresh]')?.addEventListener('click', initializeIdentity);
    panel.querySelector('#auth-profile-form')?.addEventListener('submit', submitFirstLoginProfile);
  }

  async function submitFirstLoginProfile(event) {
    event.preventDefault();
    const form = event.currentTarget, message = document.getElementById('auth-profile-message'), payload = Object.fromEntries(new FormData(form).entries()), mobile = String(payload.mobile || '').replace(/\s|-/g, '');
    if (!String(payload.name || '').trim()) { message.textContent = '请填写姓名。'; message.classList.add('error'); return; }
    if (!/^1[3-9]\d{9}$/.test(mobile)) { message.textContent = '请填写正确的11位手机号。'; message.classList.add('error'); return; }
    const submit = form.querySelector('button[type="submit"]');
    try {
      submit.disabled = true; message.classList.remove('error'); message.textContent = '正在保存首次登录资料…';
      await request('api/access/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: String(payload.name).trim(), mobile }), initiator: submit });
      await initializeIdentity();
    } catch (error) {
      message.textContent = conciseError(error); message.classList.add('error'); submit.disabled = false;
    }
  }

  let flowActionHandled = false;

  function resolveAuthReturnUrl() {
    const raw = new URLSearchParams(window.location.search).get('auth_return') || '';
    if (!raw) return '';
    try {
      const target = new URL(raw, window.location.href);
      return target.origin === window.location.origin ? target.toString() : '';
    } catch {
      return '';
    }
  }

  async function applyFlowAction() {
    if (flowActionHandled) return;
    const params = new URLSearchParams(window.location.search.replace(/&amp;/g, '&'));
    const action = params.has('interview_questions') ? 'questions' : params.get('flow_action') || '';
    if (!action) return;
    flowActionHandled = true;
    let candidateId = params.get('candidate_id') || params.get('candidateId') || '';
    const interviewId = params.get('interview_questions') || params.get('interview_id') || params.get('interviewId') || '';
    const approvalType = params.get('approval_type') || '';
    const approvalId = params.get('approval_id') || '';
    const demandMonth = params.get('demand_month') || '';
    const overviewMonth = params.get('overview_month') || '';
    try {
      const destinations = { schedule: 'interviews', questions: 'interviews', evaluation: 'interviews', decision: 'interviews', reschedule: 'interviews', interview_status: 'interviews', offer: 'offers', onboarding: 'resume-archive', recruitment_approval: 'jobs', demand: 'jobs', overview: 'overview' };
      const requiredActions = { schedule: 'arrange_interview', evaluation: 'submit_interview_feedback', decision: 'review_candidate', reschedule: 'arrange_interview', offer: 'manage_offer', onboarding: 'manage_employee_lifecycle', demand: 'create_demand' };
      const allowedDestinations = action === 'onboarding' ? ['resume-archive', 'overview'] : action === 'recruitment_approval' ? ['jobs', 'overview'] : [destinations[action]];
      if (!destinations[action] || !allowedDestinations.some(page => window.canOpenRecruitmentPage?.(page)) || (requiredActions[action] && !hasAccessAction(requiredActions[action]))) {
        notifyUser('当前账号没有此页面或操作的权限，请联系管理员。', 'error');
        return;
      }
      if (action === 'schedule') {
        window.setPage?.('interviews');
        const phone = params.get('candidate_phone') || params.get('candidatePhone') || params.get('phone') || params.get('mobile') || '';
        if (phone || interviewId) {
          const token = showTalentDialog('<div class="rf-dialog-loading">正在匹配本次面试候选人…</div>', 'wide');
          try {
            const result = await request('api/interviews/scheduling-candidate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateId, interviewId, phone }) });
            candidateId = result.candidate.id;
            if (isTalentDialogCurrent(token)) await openScheduleInterview(result.candidate.id, result.candidate);
          } catch (error) { if (isTalentDialogCurrent(token)) openInterviewCandidateRecovery(phone, conciseError(error)); }
        } else await openScheduleInterview(candidateId);
      } else if (action === 'questions') {
        window.setPage?.('interviews');
        state.activeId = candidateId || state.activeId;
        await openInterviewQuestionReview(interviewId);
      } else if (action === 'evaluation') {
        await openEvaluationWorkbench();
        if (interviewId) openFeedbackForm(interviewId);
      } else if (action === 'decision') {
        window.setPage?.('interviews');
        if (interviewId) await openEvaluationAggregate(interviewId);
      } else if (action === 'reschedule') {
        window.setPage?.('interviews');
        if (interviewId) await openRescheduleApproval(interviewId);
      } else if (action === 'interview_status') {
        window.setPage?.('interviews');
        const result = await request(`api/interviews/appointments?candidateId=${encodeURIComponent(candidateId)}`);
        const appointment = result.appointments?.find((item) => item.id === interviewId);
        if (!appointment) throw new Error('未找到这场面试，请联系招聘负责人核实');
        openInterviewScheduleDetail(appointment);
      } else if (action === 'offer') {
        window.setPage?.('offers');
        await openOfferManagement();
        openOfferForm(candidateId, { interviewId, positionId: params.get('position_id') || '', applicationId: params.get('application_id') || '' });
      } else if (action === 'onboarding') {
        state.activeId = candidateId || state.activeId;
        await openLifecycleWorkbench(candidateId);
      } else if (action === 'recruitment_approval') {
        window.setPage?.('jobs');
        if (approvalType && approvalId) await openRecruitmentApproval(approvalType, approvalId);
      } else if (action === 'demand') {
        window.setPage?.('jobs');
        const monthInput = document.getElementById('job-month-filter');
        if (monthInput && /^\d{4}-\d{2}$/.test(demandMonth)) monthInput.value = demandMonth;
        await window.openDepartmentDemandWorkbench({ request, escapeHtml, showTalentDialog, isTalentDialogCurrent, openMonthlyDemandDialog, notifyUser }, /^\d{4}-(0[1-9]|1[0-2])$/.test(demandMonth) ? demandMonth : currentMonthValue());
      } else if (action === 'overview') {
        window.setPage?.('overview');
        if (/^\d{4}-\d{2}$/.test(overviewMonth)) {
          state.overviewPeriod = 'month';
          state.overviewSelectedMonth = overviewMonth;
        }
        await loadOverviewPage();
      }
    } finally {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('flow_action');
      cleanUrl.searchParams.delete('candidate_id');
      ['candidateId', 'interviewId', 'candidate_phone', 'candidatePhone', 'phone', 'mobile'].forEach(key => cleanUrl.searchParams.delete(key));
      cleanUrl.searchParams.delete('interview_id');
      cleanUrl.searchParams.delete('approval_type');
      cleanUrl.searchParams.delete('approval_id');
      cleanUrl.searchParams.delete('demand_month');
      cleanUrl.searchParams.delete('overview_month');
      if (action === 'schedule' && candidateId) {
        cleanUrl.searchParams.set('flow_action', 'schedule');
        cleanUrl.searchParams.set('candidate_id', candidateId);
        if (interviewId) cleanUrl.searchParams.set('interview_id', interviewId);
      }
      if (action === 'questions') {
        for (const key of [...cleanUrl.searchParams.keys()]) {
          if (key.startsWith('amp;')) cleanUrl.searchParams.delete(key);
        }
        cleanUrl.searchParams.delete('evaluation_token');
        cleanUrl.searchParams.set('interview_questions', interviewId);
      }
      window.history.replaceState({}, '', cleanUrl.toString());
    }
  }

  let loginHeartbeatInFlight = false;
  let lastLoginHeartbeatAt = 0;
  async function sendLoginHeartbeat() {
    const now = Date.now();
    if (loginHeartbeatInFlight || document.hidden || !document.body.classList.contains('auth-ready') || now - lastLoginHeartbeatAt < 55000) return;
    loginHeartbeatInFlight = true;
    lastLoginHeartbeatAt = now;
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const identity = window.recruitmentCurrentUser;
    if (identity?.id) headers.set('x-user-id', encodeURIComponent(String(identity.id)));
    if (identity?.name) headers.set('x-user-name', encodeURIComponent(String(identity.name)));
    try {
      await fetch(apiUrl('api/access/heartbeat'), { method: 'POST', headers, body: '{}', keepalive: true });
    } catch {
      lastLoginHeartbeatAt = 0;
    } finally {
      loginHeartbeatInFlight = false;
    }
  }

  function activateApplication(access) {
    state.currentAccess = access;
    window.recruitmentAccess = access;
    const account = accessAccount(access);
    window.recruitmentCurrentUser = { id: account.id, name: account.name };
    document.body.classList.remove('auth-checking', 'auth-blocked');
    document.body.classList.add('auth-ready');
    void sendLoginHeartbeat();
    const app = document.getElementById('talent-app');
    app?.setAttribute('aria-hidden', 'false');
    window.applyAuthenticatedAccess?.(access);
    installActionPermissionEnforcement();
    const userCard = document.querySelector('.current-user-card');
    if (userCard) {
      const name = account.name || '当前用户';
      const avatar = userCard.querySelector('.avatar');
      const nameNode = userCard.querySelector('.current-user-meta strong');
      if (avatar) avatar.textContent = name.slice(0, 1);
      if (nameNode) nameNode.textContent = name;
      const roleNode = userCard.querySelector('.current-user-meta > span');
      if (roleNode) roleNode.textContent = `${account.departments?.[0] || '招聘团队'} · 当前登录人`;
    }
    if (userCard && !userCard.querySelector('[data-auth-logout]')) {
      const logout = document.createElement('button');
      logout.type = 'button';
      logout.className = 'auth-logout-button';
      logout.dataset.authLogout = '';
      logout.textContent = '退出';
      logout.addEventListener('click', logoutEmployeeSession);
      userCard.appendChild(logout);
    }
  }

  async function logoutEmployeeSession() {
    try { await request('api/access/logout', { method: 'POST' }); } catch (error) { notifyUser(error.message || '退出失败，请重试', 'error'); return; }
    resetApplicationAccess();
    window.recruitmentCurrentUser = null;
    window.recruitmentAccess = null;
    state.currentAccess = null;
    document.body.classList.remove('auth-ready', 'auth-checking');
    document.body.classList.add('auth-blocked');
    document.getElementById('talent-app')?.setAttribute('aria-hidden', 'true');
    document.querySelector('[data-auth-logout]')?.remove();
    renderEmployeeLogin();
  }

  function resetApplicationAccess() {
    invalidateTalentSnapshots();
    accessEpoch += 1;
    const talentLoadSequence = state.talentLoadSequence + 1;
    const talentDetailLoadSequence = state.talentDetailLoadSequence + 1;
    window.clearTimeout(state.assessmentSaveTimer);
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, structuredClone(initialApplicationState), { talentLoadSequence, talentDetailLoadSequence });
    closeTalentDialog(false);
    window.recruitmentCurrentUser = null;
    window.recruitmentAccess = null;
    state.currentAccess = null;
    window.unmountResumeApiPage?.();
    window.unmountPointsRankingPage?.();
    window.unmountScheduledTasksPage?.();
    window.unmountAnalyticsPage?.();
    window.applyAuthenticatedAccess?.(null);
    applyActionPermissions();
  }

  let refreshingPermissions = false;
  async function refreshCurrentPermissions() {
    if (refreshingPermissions || !document.body.classList.contains('auth-ready')) return;
    const refreshEpoch = accessEpoch;
    refreshingPermissions = true;
    try {
      const access = await request('api/access/me', { timeoutMs: 7000 });
      if (refreshEpoch !== accessEpoch || !document.body.classList.contains('auth-ready')) return;
      if (!access.authenticated || !access.authorized) {
        resetApplicationAccess();
        document.body.classList.remove('auth-ready');
        document.body.classList.add('auth-blocked');
        renderAuthState(access);
      } else if (JSON.stringify(access) !== JSON.stringify(state.currentAccess)) {
        const previousPage = document.getElementById('talent-app')?.dataset.activePage;
        resetApplicationAccess();
        activateApplication(access);
        if (previousPage && document.getElementById('talent-app')?.dataset.activePage !== previousPage) window.setPage?.(previousPage);
      }
    } catch {
      if (refreshEpoch !== accessEpoch) return;
    } finally { refreshingPermissions = false; }
  }
  window.addEventListener('focus', () => { refreshCurrentPermissions(); void sendLoginHeartbeat(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshCurrentPermissions(); void sendLoginHeartbeat(); } });
  window.setInterval(() => { if (!document.hidden) { refreshCurrentPermissions(); void sendLoginHeartbeat(); } }, 60000);

  async function initializeIdentity() {
    resetApplicationAccess();
    const panel = document.getElementById('auth-panel');
    document.body.classList.remove('auth-ready');
    document.body.classList.add('auth-checking');
    if (panel) panel.innerHTML = '<div class="auth-loading"><i></i><strong>正在检查登录状态</strong><p>请稍候，系统正在读取当前设备的员工会话和角色权限。</p></div>';
    try {
      // 身份接口异常时不能让整个应用永久停留在 loading；测试环境尤其可能没有注入 Studio 身份头。
      const access = await Promise.race([
        request('api/access/me', { timeoutMs: 7000 }),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error('身份接口响应超时')), 8000)),
      ]);
      state.currentAccess = access;
      if (access.authenticated && access.authorized) {
        activateApplication(access);
        const returnUrl = resolveAuthReturnUrl();
        if (returnUrl) { window.location.replace(returnUrl); return true; }
        await applyFlowAction();
        return true;
      }
      document.body.classList.remove('auth-checking'); document.body.classList.add('auth-blocked'); renderAuthState(access); return false;
    } catch (error) {
      document.body.classList.remove('auth-checking'); document.body.classList.add('auth-blocked');
      renderAuthState({ authenticated: false, accessState: 'identity_unavailable' });
      return false;
    }
  }

  async function init() {
    installNotificationBridge();
    const referralToken = new URLSearchParams(window.location.search).get('referral_token');
    if (referralToken) { renderPublicReferral(referralToken); return; }
    const referralTracking = new URLSearchParams(window.location.search).get('referral_tracking');
    if (referralTracking) { renderReferralTracking(referralTracking); return; }
    const offerToken = new URLSearchParams(window.location.search).get('offer_token');
    if (offerToken) { renderPublicOffer(offerToken); return; }
    const interviewToken = new URLSearchParams(window.location.search).get('interview_token');
    if (interviewToken) { renderPublicInterview(interviewToken); return; }
    const evaluationToken = new URLSearchParams(window.location.search).get('evaluation_token');
    const questionParams = new URLSearchParams(window.location.search.replace(/&amp;/g, '&'));
    const questionIntent = questionParams.has('interview_questions') || questionParams.get('flow_action') === 'questions';
    if (evaluationToken && !questionIntent) { renderPublicEvaluation(evaluationToken); return; }
    const onboardingReviewToken = new URLSearchParams(window.location.search).get('onboarding_review_token');
    if (onboardingReviewToken) { renderPublicOnboardingReview(onboardingReviewToken); return; }
    const onboardingArrivalToken = new URLSearchParams(window.location.search).get('onboarding_arrival_token');
    if (onboardingArrivalToken) { renderPublicOnboardingArrival(onboardingArrivalToken); return; }
    const assessmentToken = new URLSearchParams(window.location.search).get('assessment_token');
    if (assessmentToken) { renderPublicAssessment(assessmentToken); return; }
    const communicationToken = new URLSearchParams(window.location.search).get('token');
    if (window.location.pathname.endsWith('/communication') && communicationToken) { renderPublicCommunication(communicationToken); return; }
    document.addEventListener('resumeflow:page', (event) => {
      const page = event.detail?.page;
      // 兼容旧的解析简历链接和历史快捷入口；新入口统一打开人才档案的导入弹窗。
      if (page === 'resume-parse') openResumeImporterFromAnywhere();
      if (page === 'resume-archive') loadTalentArchive();
      if (page === 'resume-api') loadApiPage();
      if (page === 'question-bank') window.mountQuestionBankPage?.({ request, escapeHtml, notifyUser, showTalentDialog, pollInterviewResource: (started, progress) => pollInterviewResource(started, progress, '题库导入') });
      if (page === 'scheduled-tasks') loadScheduledTasks();
      if (page === 'analytics') loadAnalyticsPage();
      if (page === 'overview') loadOverviewPage();
      if (page === 'points') loadPointsPage();
      if (page === 'jobs') loadJobsPage();
      if (page === 'interviews') loadInterviewSchedulePage();
      if (page === 'settings') bindOverviewJobsPages();
      if (page === 'offers' && new URLSearchParams(window.location.search).get('flow_action') !== 'offer') openOfferManagement();
    });
    window.resumeFlowOpenImporter = openResumeImporterFromAnywhere;
    document.querySelectorAll('[data-action="open-offer"]').forEach(button => button.addEventListener('click', openOfferManagement));
    document.querySelectorAll('[data-action="offer-template-manager"]').forEach(button => button.addEventListener('click', () => openOfferTemplateManager()));
    // 登录成功会立即恢复上次访问的页面，因此必须先注册页面监听器。
    // 否则首次直接恢复到人才档案时，页面已激活但不会触发人才数据加载。
    const authenticated = await initializeIdentity();
    bindOverviewJobsPages();
    if (authenticated) await applyFlowAction();
    document.getElementById('interview-month-filter')?.addEventListener('change', () => {
      renderInterviewMonthLabel();
      loadInterviewSchedulePage();
    });
    renderInterviewMonthLabel();
    document.querySelector('[data-interview-month-picker]')?.addEventListener('click', () => {
      const panel = document.getElementById('interview-month-panel');
      const trigger = document.querySelector('[data-interview-month-picker]');
      if (!panel || !trigger) return;
      const opening = panel.hidden;
      if (!opening) {
        closeInterviewMonthPanel();
        return;
      }
      const input = document.getElementById('interview-month-filter');
      renderInterviewMonthPanel(Number(String(input.value || currentMonthValue()).slice(0, 4)));
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.schedule-month-field')) closeInterviewMonthPanel();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeInterviewMonthPanel();
    });
    document.querySelectorAll('[data-interview-month-step]').forEach(button => button.addEventListener('click', () => {
      const input = document.getElementById('interview-month-filter');
      const [year, month] = (input.value || currentMonthValue()).split('-').map(Number);
      const next = new Date(Date.UTC(year, month - 1 + Number(button.dataset.interviewMonthStep), 1));
      input.value = next.toISOString().slice(0, 7);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }));
    document.querySelectorAll('[data-access-admin]').forEach((button) => button.addEventListener('click', openAccessAdministration));
    document.querySelectorAll('[data-system-status]').forEach((button) => button.addEventListener('click', openSystemStatus));
    document.querySelectorAll('[data-ai-monitoring]').forEach((button) => button.addEventListener('click', () => openAiMonitoring(30)));
    document.querySelectorAll('[data-ai-rerun-all]').forEach((button) => button.addEventListener('click', () => submitAllAnalysis().catch((error) => notifyUser(`全量AI重跑启动失败：${conciseError(error)}`, 'error'))));
    document.addEventListener('click', (event) => {
      const referralRecord = event.target.closest('[data-ref-record-candidate]');
      const recordAction = event.target.closest('button, a, input, select, textarea, label, summary');
      if (referralRecord && !recordAction) {
        event.preventDefault();
        openTalentDetailDialog(referralRecord.dataset.refRecordCandidate);
        return;
      }
      const workbenchButton = event.target.closest('[data-referral-workbench]');
      if (workbenchButton) {
        event.preventDefault();
        openReferralWorkbench();
        return;
      }
      const directUploadButton = event.target.closest('[data-referral-upload]');
      if (directUploadButton) {
        event.preventDefault();
        openReferralDirectUpload();
        return;
      }
      const posterButton = event.target.closest('[data-referral-poster]');
      if (posterButton) {
        event.preventDefault();
        openReferralPoster();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const referralRecord = event.target.closest('[data-ref-record-candidate]');
      if (!referralRecord || event.target !== referralRecord) return;
      event.preventDefault();
      openTalentDetailDialog(referralRecord.dataset.refRecordCandidate);
    });
    document.addEventListener('resumeflow:page', (event) => { if (event.detail?.page === 'referral') loadReferralQrSummary(); });
    if (document.getElementById('page-referral')?.classList.contains('active')) loadReferralQrSummary();
    if (document.getElementById('page-overview')?.classList.contains('active')) loadOverviewPage();
    if (document.getElementById('page-points')?.classList.contains('active')) loadPointsPage();
    if (document.getElementById('page-jobs')?.classList.contains('active')) loadJobsPage();
    if (location.hash === '#resume-parse') openResumeImporterFromAnywhere();
    if (location.hash === '#resume-archive') window.setPage?.('resume-archive');
    if (location.hash === '#resume-api') window.setPage?.('resume-api');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
