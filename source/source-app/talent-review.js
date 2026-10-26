(() => {
  const root = document.getElementById('review-app');
  const token = new URLSearchParams(location.search).get('token') || '';
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const api = async (path, options) => { const response = await fetch(path, { credentials: 'include', ...options }); const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(Array.isArray(body.message) ? body.message.join('；') : body.message || '请求失败'); error.status = response.status; throw error; } return body; };
  const content = (value) => `<div class="content">${esc(value || '暂无信息')}</div>`;
  let detail = null;
  let decision = '适合';

  function render() {
    const candidate = detail.candidate || {};
    const analysis = candidate.analysis || {};
    const score = Number(candidate.matches?.[0]?.score || analysis.scores?.overall || 0);
    const positions = detail.positions || [];
    const positionPicker = `<div class="wide review-position-picker" id="position-field"><label for="position">认领岗位 <span aria-hidden="true">*</span></label><p id="position-help">按岗位名称或部门搜索，点击下方岗位完成选择。</p><div class="review-position-search"><input id="position" type="search" placeholder="搜索岗位或部门" autocomplete="off" aria-describedby="position-help" aria-controls="position-options"><button type="button" id="position-clear" aria-label="清空岗位搜索和选择" hidden>清空</button></div><input id="position-id" type="hidden"><div id="position-selected" class="review-position-selected" role="status" hidden></div><p id="position-count" class="review-position-count" role="status"></p><div id="position-options" class="review-position-options" role="group" aria-label="可认领岗位"></div><button type="button" id="position-more" class="review-position-more" hidden>查看更多岗位</button></div>`;
    const avatarFallback = String(candidate.name || '候选人').slice(0, 2);
    const avatarLabel = `${candidate.name || '候选人'}头像`;
    const avatar = candidate.avatarUrl
      ? `<img src="${esc(candidate.avatarUrl)}" alt="${esc(avatarLabel)}">`
      : `<span aria-hidden="true">${esc(avatarFallback)}</span>`;
    const avatarAccessibility = candidate.avatarUrl ? '' : `role="img" aria-label="${esc(avatarLabel)}"`;
    const resumeFacts = [
      ['性别', candidate.gender],
      ['年龄', candidate.age ? `${candidate.age}岁` : ''],
      ['工作年限', candidate.yearsOfExperience],
      ['所在城市', candidate.city],
      ['联系电话', candidate.phone],
      ['电子邮箱', candidate.email],
      ['当前公司', candidate.currentCompany],
      ['当前职位', candidate.currentRole],
    ].map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value || '待补充')}</strong></div>`).join('');
    root.innerHTML = `
      <header class="review-brand-hero"><img src="./uploads/building.jpg" alt="方片新媒体办公大楼"><div><span>人才招聘 · 业务群评审</span><h1>方片新媒体</h1></div></header>
      <div class="review-toolbar"><div class="review-brand"><span>人才简历评审</span></div><button type="button" id="print-resume">打印 / 保存PDF</button></div>
      ${detail.reviewed ? `<div class="claimed-banner">本次简历已完成评审：${esc(detail.review?.department || detail.claimedDepartment || '业务部门')} · ${esc(detail.review?.position || detail.claimedPosition || '已提交意见')}。当前链接仅供查看，不能再提交评审。</div>` : ''}
      <article class="resume-paper">
        <header class="resume-head"><div class="resume-head-main"><div class="resume-avatar" ${avatarAccessibility}>${avatar}</div><div class="resume-head-copy"><small>TALENT PROFILE</small><h1>${esc(candidate.name || '候选人')}</h1><p class="resume-head-mark">${esc(candidate.jobIntention || candidate.matches?.[0]?.positionName || '求职方向待确认')}</p><p class="resume-head-caption">${String(candidate.sourceType || '').includes('内推') ? `内推简历 · 候选人选择岗位：${esc(candidate.selectedPositionName || '待确认')}` : '候选人简历 · 招聘流程评审资料'}</p></div></div><div class="resume-facts">${resumeFacts}</div></header>
        <section class="review-score"><div class="review-score-ring" style="--score:${Math.max(0, Math.min(100, score))}"><strong>${score}</strong><span>综合匹配</span></div><div class="review-summary"><h2>人才摘要</h2><p>${esc(analysis.summary || '该人才尚未形成完整摘要，请结合简历正文人工判断。')}</p><div class="tag-list">${(candidate.skills || []).slice(0, 10).map((item) => `<span>${esc(item)}</span>`).join('') || '<span>技能待补充</span>'}</div></div></section>
        <section class="resume-section"><h2>AI推荐岗位与匹配依据</h2><div class="match-list">${(candidate.matches || []).slice(0, 4).map((item) => `<article><header><strong>${esc(item.positionName)}</strong><b>${Number(item.score || 0)}分</b></header><p>${esc(item.reason || '请结合岗位要求人工确认')}</p></article>`).join('') || '<div class="content">暂无岗位匹配结果</div>'}</div></section>
        <section class="resume-section"><h2>工作经历</h2>${content(candidate.workExperience)}</section>
        <section class="resume-section"><h2>教育背景</h2>${content(candidate.educationBackground)}</section>
        <section class="resume-section"><h2>自我评价</h2>${content(candidate.selfEvaluation)}</section>
        ${candidate.sourceFileUrl ? `<section class="resume-section"><h2>原始简历</h2><a href="${esc(candidate.sourceFileUrl)}" target="_blank" rel="noopener">查看原始文件：${esc(candidate.sourceFileName || '简历')}</a></section>` : ''}
      </article>
      ${detail.reviewed ? `<section class="review-action" id="review-action"><h2>本次评审已完成</h2><div class="review-success"><i>✓</i><h3>${esc(detail.review?.decision === '适合' ? '已认领岗位' : '意见已提交')}</h3><p>评审人：${esc(detail.review?.reviewer || '业务同事')} · ${esc(detail.review?.submittedAt || '')}</p><p>${detail.review?.decision === '适合' ? `认领岗位：${esc(detail.review?.position || detail.claimedPosition || '待确认')}` : '感谢反馈，招聘团队已收到意见。'}</p></div></section>` : `<section class="review-action" id="review-action"><h2>是否适合我的岗位？</h2><p>系统已根据当前登录身份自动填写评审人和所属部门。选择是否适合；选择适合时认领具体岗位。</p><div class="review-identity"><span>评审人</span><strong>${esc(detail.viewer?.name || '当前登录用户')}</strong><span>部门</span><strong>${esc((detail.viewer?.departments || []).join('、') || '已按登录权限识别')}</strong></div><div class="decision-grid"><button class="active" data-decision="适合">适合我的岗位</button><button data-decision="不适合">不适合</button><button data-decision="其他">其他意见</button></div><div class="review-form">${positionPicker}</div><button class="submit-review" id="submit-review">提交评审意见</button><div class="review-note">评审人姓名和部门由系统登录身份自动带出，提交时以服务端登录身份为准。</div></section>`}`;
    document.getElementById('print-resume')?.addEventListener('click', () => window.print());
    const feedback = document.createElement('p');
    feedback.id = 'review-feedback';
    feedback.className = 'review-inline-message';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    if (detail.reviewed) return;
    document.getElementById('submit-review')?.after(feedback);
    document.querySelectorAll('[data-decision]').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
    document.querySelector('.decision-grid')?.addEventListener('click', event => {
      const selected = event.target.closest('[data-decision]');
      if (selected) document.querySelectorAll('[data-decision]').forEach(button => button.setAttribute('aria-pressed', String(button === selected)));
    });
    bindPositionPicker(positions);
    document.querySelectorAll('[data-decision]').forEach((button) => button.addEventListener('click', () => {
      decision = button.dataset.decision;
      document.querySelectorAll('[data-decision]').forEach((item) => item.classList.toggle('active', item === button));
      document.getElementById('position-field').hidden = decision !== '适合';
      document.getElementById('position').removeAttribute('aria-invalid');
      feedback.textContent = '';
    }));
    document.getElementById('submit-review')?.addEventListener('click', submit);
  }

  function bindPositionPicker(positions) {
    const input = document.getElementById('position');
    const selectedId = document.getElementById('position-id');
    const options = document.getElementById('position-options');
    const selection = document.getElementById('position-selected');
    const clear = document.getElementById('position-clear');
    const more = document.getElementById('position-more');
    let limit = 8;
    const labelFor = item => [item.name, item.department].filter(Boolean).join(' · ');
    const renderOptions = () => {
      const query = input.value.trim().toLocaleLowerCase();
      const matches = positions.filter(item => labelFor(item).toLocaleLowerCase().includes(query));
      const selected = positions.find(item => item.id === selectedId.value);
      clear.hidden = !input.value && !selected;
      selection.hidden = !selected;
      selection.textContent = selected ? `已选择：${labelFor(selected)}` : '';
      document.getElementById('position-count').textContent = positions.length ? `找到 ${matches.length} 个岗位${matches.length > limit ? `，当前显示 ${limit} 个` : ''}` : '当前没有可认领岗位';
      options.innerHTML = matches.slice(0, limit).map(item => `<button type="button" class="review-position-option" data-review-position="${esc(item.id)}" aria-pressed="${item.id === selectedId.value}"><span><strong>${esc(item.name || '未命名岗位')}</strong><small>${esc(item.department || '部门待补充')}</small></span><b aria-hidden="true">${item.id === selectedId.value ? '已选 ✓' : '选择'}</b></button>`).join('') || `<p class="review-position-empty">${positions.length ? '没有匹配岗位，请换个关键词，或清空搜索查看全部。' : '当前暂无可认领岗位，请联系招聘 HR 核实岗位状态。'}</p>`;
      more.hidden = matches.length <= limit;
    };
    input.addEventListener('input', () => {
      selectedId.value = '';
      input.removeAttribute('aria-invalid');
      document.getElementById('review-feedback').textContent = '';
      limit = 8;
      renderOptions();
    });
    clear.addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('input'));
      input.focus();
    });
    options.addEventListener('click', event => {
      const button = event.target.closest('[data-review-position]');
      const selected = positions.find(item => item.id === button?.dataset.reviewPosition);
      if (!selected) return;
      selectedId.value = selected.id;
      input.value = labelFor(selected);
      input.removeAttribute('aria-invalid');
      document.getElementById('review-feedback').textContent = '';
      renderOptions();
      options.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    });
    input.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      options.querySelector('button')?.focus();
    });
    more.addEventListener('click', () => {
      const previousLimit = limit;
      limit += 8;
      renderOptions();
      options.querySelectorAll('button')[previousLimit]?.focus();
    });
    renderOptions();
  }

  async function submit() {
    const button = document.getElementById('submit-review');
    if (button.disabled) return;
    const feedback = document.getElementById('review-feedback');
    const positionInput = document.getElementById('position');
    const selectedPosition = decision === '适合' ? detail.positions?.find(item => item.id === document.getElementById('position-id')?.value) : null;
    const positionId = selectedPosition?.id || '';
    if (decision === '适合' && !selectedPosition) {
      feedback.textContent = '请选择准备面试的岗位，点击下方岗位卡片完成选择。';
      positionInput.setAttribute('aria-invalid', 'true');
      positionInput.focus();
      positionInput.scrollIntoView({ block: 'center' });
      return;
    }
    feedback.textContent = '正在提交评审，请稍候…';
    button.disabled = true; button.textContent = '正在提交…';
    const controls = [...document.querySelectorAll('.decision-grid button, .review-form button, .review-form input')];
    controls.forEach(control => { control.disabled = true; });
    try {
      const result = await api(`./api/public/talent-reviews/${encodeURIComponent(token)}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, positionId, position: selectedPosition?.name || '' }) });
      const notificationSent = ['已发送', '已跳过'].includes(result.notification?.status);
      const message = result.claimed ? notificationSent ? '认领已提交，已通知所选岗位的招聘 HR 跟进意向沟通。' : `认领已记录，但 HR 通知未送达：${result.notification?.reason || '请联系招聘管理员检查消息发送记录'}。` : '感谢反馈，招聘团队可在人才档案中查看你的意见。';
      document.getElementById('review-action').innerHTML = `<div class="review-success"><i>✓</i><h2>${result.claimed ? '认领已记录' : '意见已提交'}</h2><p>${esc(message)}</p></div>`;
      document.getElementById('review-action').scrollIntoView({ block: 'start' });
    } catch (error) {
      feedback.textContent = `${error.message || '提交失败'}。已保留你的选择，可以重试。`;
      feedback.scrollIntoView({ block: 'nearest' });
      button.disabled = false;
      controls.forEach(control => { control.disabled = false; });
      button.textContent = '提交评审意见';
    }
  }

  function redirectToSystemLogin() {
    const reviewUrl = new URL(window.location.href);
    const systemUrl = new URL('./', reviewUrl);
    systemUrl.search = '';
    systemUrl.hash = '';
    systemUrl.searchParams.set('auth_return', reviewUrl.toString());
    window.location.replace(systemUrl.toString());
  }

  async function loadDetail() {
    if (!token) { root.innerHTML = '<div class="review-error"><strong>评审链接无效</strong><p>链接中缺少访问凭证，请联系招聘负责人重新推送。</p></div>'; return; }
    try {
      detail = await api(`./api/public/talent-reviews/${encodeURIComponent(token)}`);
      render();
    } catch (error) {
      if (error.status === 401) { redirectToSystemLogin(); return; }
      root.innerHTML = `<div class="review-error"><strong>暂时无法查看</strong><p>${esc(error.message)}</p></div>`;
    }
  }

  void loadDetail();
})();
