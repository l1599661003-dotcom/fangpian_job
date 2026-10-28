(() => {
  const root = document.getElementById('review-app');
  const token = new URLSearchParams(location.search).get('token') || '';
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const api = async (path, options) => { const response = await fetch(path, { credentials: 'include', ...options }); const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(Array.isArray(body.message) ? body.message.join('；') : body.message || '请求失败'); error.status = response.status; throw error; } return body; };
  const content = (value) => `<div class="content">${esc(value || '暂无信息')}</div>`;
  let detail = null;
  let decision = '合适';

  function scoreChart(overall, breakdown) {
    const items = breakdown.items || [];
    if (!breakdown.available || items.length !== 5) return '<p class="score-chart-note">这份分析生成于评分维度上线前，只保留综合评分，没有五项维度明细。</p>';
    const weighted = items.reduce((total, item) => total + Number(item.score) * Number(item.weight), 0) / 100;
    const rows = items.map((item) => `<div class="score-row"><span>${esc(item.name)}</span><i><b style="width:${Math.max(0, Math.min(100, Number(item.score)))}%"></b></i><strong>${Math.round(Number(item.score))}</strong><em>${Number(item.weight)}%</em></div>`).join('');
    return `<div class="score-chart">${rows}<p>综合评分 ${Math.round(Number(overall))} = ${items.map((item) => `${Math.round(Number(item.score))}×${Number(item.weight)}%`).join(' + ')} = ${weighted.toFixed(1)}</p></div>`;
  }

  function render() {
    const candidate = detail.candidate || {};
    const analysis = candidate.analysis || {};
    const score = Number(detail.fitScore || candidate.matches?.[0]?.score || analysis.scores?.overall || 0);
    const reasons = detail.reasons || [];
    const scoreBreakdown = detail.scoreBreakdown || { available: false, items: [] };
    const otherPositions = detail.otherPositions || (candidate.matches || []).slice(1, 4);
    const positions = detail.positions || [];
    const positionPicker = `<div class="wide review-position-picker" id="position-field"><label for="position">认领岗位 <span class="field-required" aria-hidden="true">必填</span></label><p id="position-help">按岗位名称或部门搜索，点击下方岗位完成选择。</p><div class="review-position-search"><input id="position" type="search" placeholder="搜索岗位或部门" autocomplete="off" aria-describedby="position-help" aria-controls="position-options"><button type="button" id="position-clear" aria-label="清空岗位搜索和选择" hidden>清空</button></div><input id="position-id" type="hidden"><div id="position-selected" class="review-position-selected" role="status" hidden></div><p id="position-count" class="review-position-count" role="status"></p><div id="position-options" class="review-position-options" role="group" aria-label="可认领岗位"></div><button type="button" id="position-more" class="review-position-more" hidden>查看更多岗位</button></div>`;
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
        <section class="review-score"><div class="review-score-ring" style="--score:${Math.max(0, Math.min(100, score))}"><strong>${score}</strong><span>综合评分</span></div><div class="review-summary"><h2>评分构成</h2>${scoreChart(score, scoreBreakdown)}<h2>推荐理由</h2><ol class="review-reasons">${reasons.map((item) => `<li>${esc(item)}</li>`).join('') || '<li>请打开简历查看匹配依据</li>'}</ol></div></section>
        ${candidate.sourceFileUrl ? `<section class="resume-section"><h2>原始简历</h2><a href="${esc(candidate.sourceFileUrl)}" target="_blank" rel="noopener">查看原始简历：${esc(candidate.sourceFileName || '简历')}</a></section>` : `<section class="resume-section"><h2>原始简历</h2><div class="content">暂无简历文件</div></section>`}
        <section class="resume-section"><h2>其他适合岗位</h2><div class="match-list">${otherPositions.map((item) => `<article><header><strong>${esc(item.name || item.positionName || '岗位待确认')}</strong><b>${Number(item.score || 0)}分</b></header><p>${esc(item.reason || '可作为备选岗位')}</p></article>`).join('') || '<div class="content">暂无其他推荐岗位</div>'}</div></section>
      </article>
      ${detail.reviewed ? `<section class="review-action" id="review-action"><h2>本次评审已完成</h2><div class="review-success"><i>✓</i><h3>${esc(['合适', '适合', '推荐其他部门'].includes(detail.review?.decision) ? '已提交并通知招聘 HR' : '意见已提交')}</h3><p>评审人：${esc(detail.review?.reviewer || '业务同事')} · ${esc(detail.review?.submittedAt || '')}</p><p>结论：${esc(detail.review?.decision || '已提交')} · ${esc(detail.review?.position || detail.claimedPosition || '未选择岗位')}</p></div></section>` : `<section class="review-action" id="review-action"><h2>这份简历怎么处理？</h2><p>合适时选择岗位并给出至少 2 个可面试时间；推荐其他部门时必须确认目标岗位。</p><div class="review-identity"><span>评审人</span><strong>${esc(detail.viewer?.name || '当前登录用户')}</strong><span>部门</span><strong>${esc((detail.viewer?.departments || []).join('、') || '已按登录权限识别')}</strong></div><div class="decision-grid"><button class="active" data-decision="合适">合适</button><button data-decision="不合适">不合适</button><button data-decision="推荐其他部门">推荐其他部门</button></div><div class="review-form">${positionPicker}<div class="wide" id="reason-field" hidden><label for="reject-reason">不合适原因 <span class="field-required" aria-hidden="true">必填</span></label><p>说明不合适的具体原因，招聘同事会记录在评审意见中。</p><textarea id="reject-reason" maxlength="300" placeholder="例如：经验方向与岗位不匹配"></textarea></div><div class="wide" id="slot-field"><div class="slot-heading"><label>可面试时间 <span class="field-required" aria-hidden="true">必填</span></label><p>至少填写 2 个，需要更多时间可以继续添加。</p></div><div id="slot-list"><label class="slot-item"><span>时间 1</span><input type="text" maxlength="40" placeholder="例如 10月28日 14:00"></label><label class="slot-item"><span>时间 2</span><input type="text" maxlength="40" placeholder="例如 10月29日 10:30"></label></div><button type="button" id="add-slot">添加一个时间</button></div></div><button class="submit-review" id="submit-review">提交评审意见</button><div class="review-note">推荐其他部门会先按你确认的目标岗位提交，不会直接转走。</div></section>`}`;
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
    document.getElementById('slot-field').hidden = decision !== '合适';
    bindPositionPicker(positions);
    document.querySelectorAll('[data-decision]').forEach((button) => button.addEventListener('click', () => {
      decision = button.dataset.decision;
      document.querySelectorAll('[data-decision]').forEach((item) => item.classList.toggle('active', item === button));
      document.getElementById('position-field').hidden = decision === '不合适';
      document.getElementById('slot-field').hidden = decision !== '合适';
      document.getElementById('reason-field').hidden = decision !== '不合适';
      const positionLabel = document.querySelector('#position-field label');
      if (positionLabel?.firstChild) positionLabel.firstChild.textContent = decision === '推荐其他部门' ? '目标岗位 ' : '认领岗位 ';
      document.getElementById('position').removeAttribute('aria-invalid');
      feedback.textContent = '';
    }));
    document.getElementById('add-slot')?.addEventListener('click', () => {
      const list = document.getElementById('slot-list');
      const index = list.querySelectorAll('input').length + 1;
      const item = document.createElement('label');
      item.className = 'slot-item';
      item.innerHTML = `<span>时间 ${index}</span><input type="text" maxlength="40" placeholder="例如 10月30日 16:00">`;
      list.append(item);
      item.querySelector('input').focus();
    });
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
    const needsPosition = decision === '合适' || decision === '推荐其他部门';
    const selectedPosition = needsPosition ? detail.positions?.find(item => item.id === document.getElementById('position-id')?.value) : null;
    const slots = decision === '合适' ? [...document.querySelectorAll('#slot-list input')].map(input => input.value.trim()).filter(Boolean) : [];
    const rejectReason = decision === '不合适' ? document.getElementById('reject-reason').value.trim() : '';
    if (needsPosition && !selectedPosition) {
      feedback.textContent = decision === '推荐其他部门' ? '请先确认要推荐的目标岗位。' : '请选择准备面试的岗位。';
      positionInput.setAttribute('aria-invalid', 'true');
      positionInput.focus();
      positionInput.scrollIntoView({ block: 'center' });
      return;
    }
    if (decision === '不合适' && !rejectReason) {
      feedback.textContent = '请填写不合适的原因。';
      document.getElementById('reject-reason').focus();
      return;
    }
    if (decision === '合适' && slots.length < 2) {
      feedback.textContent = '选择合适时请至少填写 2 个可面试时间。';
      document.querySelector('#slot-list input')?.focus();
      return;
    }
    feedback.textContent = '正在提交评审，请稍候…';
    button.disabled = true; button.textContent = '正在提交…';
    const controls = [...document.querySelectorAll('.decision-grid button, .review-form button, .review-form input')];
    controls.forEach(control => { control.disabled = true; });
    try {
      const result = await api(`./api/public/talent-reviews/${encodeURIComponent(token)}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, positionId: decision === '合适' ? selectedPosition?.id || '' : '', position: decision === '合适' ? selectedPosition?.name || '' : '', targetPositionId: decision === '推荐其他部门' ? selectedPosition?.id || '' : '', availableSlots: slots, comment: rejectReason }) });
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
