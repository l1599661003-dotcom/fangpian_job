(() => {
  window.openDepartmentDemandWorkbench = async (options, initialMonth) => {
    const { request, escapeHtml: escape, showTalentDialog, isTalentDialogCurrent, openMonthlyDemandDialog, notifyUser } = options;
    let month = initialMonth, data, filter = 'active';
    const canEdit = () => window.recruitmentAccess?.actions?.some(action => ['*', 'create_demand'].includes(action));
    const active = position => position.status === '招聘中' && position.recruitmentStatus !== '暂停招聘';
    async function load() {
      const token = showTalentDialog('<div class="rf-dialog-loading" role="status">正在确认所属部门并读取招聘进展…</div>', 'wide');
      try {
        data = await request(`api/recruitment/department-demands?${new URLSearchParams({ month })}`);
        if (!isTalentDialogCurrent(token)) return;
        month = data.month;
        render();
      } catch (error) {
        if (!isTalentDialogCurrent(token)) return;
        showTalentDialog(`<header class="rf-dialog-head"><div><h2>部门招聘工作台</h2></div></header><div class="rf-dialog-empty"><strong>暂时无法读取部门招聘情况</strong><p>${escape(error.message)}</p><button type="button" class="btn-primary" data-dept-retry>重新读取</button></div>`, 'wide');
        document.querySelector('[data-dept-retry]').onclick = load;
      }
    }
    function edit(position) {
      openMonthlyDemandDialog(position, { month, jobs: data.positions.filter(item => item.status !== '已关闭'), demands: data.demands, endpoint: 'api/recruitment/department-demands', onSaved: async result => { month = result.month || month; await load(); }, onBack: load });
    }
    function render() {
      const jobs = data.positions || [];
      const demandsFor = (positionId) => (data.demands || []).filter(item => item.positionId === positionId);
      const activeDemandsFor = (positionId) => demandsFor(positionId).filter(item => !['已停用', '审批驳回'].includes(item.status) && item.approvalStatus !== '已驳回' && Number(item.headcount || 0) > 0);
      const shown = jobs.filter(position => filter === 'all' || (filter === 'active' ? active(position) : position.status === '已下线' || position.recruitmentStatus === '暂停招聘'));
      const title = (data.departments || []).map(item => item.name).join('、') || '我的部门';
      showTalentDialog(`<section class="dd-workbench"><header class="rf-dialog-head"><div><span>DEPARTMENT RECRUITMENT</span><h2>部门招聘工作台</h2><p>${escape(title)} · 根据当前登录账号自动匹配，不按群消息发送人判断。</p></div></header><div class="dd-toolbar"><label>需求月份<input type="month" data-dept-month value="${escape(month)}"></label>${canEdit() ? '<button class="btn-primary" type="button" data-dept-new>新增 / 调整需求</button>' : ''}<button class="btn-soft" type="button" data-dept-refresh>刷新</button></div><div class="dd-metrics"><article><strong>${jobs.filter(active).length}</strong><span>在招岗位</span></article><article><strong>${jobs.filter(active).reduce((sum, job) => sum + activeDemandsFor(job.id).reduce((total, demand) => total + Number(demand.headcount || 0), 0), 0)}</strong><span>本月在招需求人数</span></article></div><div class="dd-tabs" role="group" aria-label="岗位状态">${[['active', '在招岗位'], ['paused', '已暂停'], ['all', '全部部门岗位']].map(([value, label]) => `<button type="button" data-dept-filter="${value}" aria-pressed="${filter === value}">${label}</button>`).join('')}</div><p class="dd-note">需求人数按所选月份显示；应聘、接受 Offer 和到岗为岗位累计数据，不等同于当月达成。暂停招聘会保留原需求与候选人记录。</p><div class="dd-cards">${shown.map(job => {
        const demands = demandsFor(job.id);
        const demandTotal = demands.reduce((total, demand) => total + Number(demand.headcount || 0), 0);
        const demandLines = demands.map(demand => `<p>${escape(demand.demandType || '新增需求')} · ${escape(demand.priority || '储备')} · ${Number(demand.headcount || 0)}人 · ${escape(demand.approvalStatus || demand.status || '待审批')}${demand.expectedArrivalDate ? ` · 期望到岗 ${escape(demand.expectedArrivalDate)}` : ''}${demand.latestArrivalDate ? ` · 最晚到岗 ${escape(demand.latestArrivalDate)}` : ''}</p>`).join('');
        return `<article class="dd-card"><header><div><small>${escape(job.department)}</small><h3>${escape(job.name)}</h3></div><span>${active(job) ? '招聘中' : escape(job.recruitmentStatus === '暂停招聘' ? '已暂停' : job.status)}</span></header><p>业务负责人：${escape(job.owner || '未配置')} · 招聘 HR：${escape([job.recruiter, job.backupRecruiter].filter(Boolean).join(' / ') || '未配置')}</p><div class="dd-progress">${[['本月需求', demands.length ? `${demandTotal} 人` : '未录入'], ['累计应聘', `${Number(job.applicantCount || 0)} 人`], ['已接受 Offer', `${Number(job.acceptedCount || 0)} 人`], ['累计到岗', `${Number(job.arrived || 0)} 人`]].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>${demandLines || '<p>本月尚未录入需求，可直接新增。</p>'}${canEdit() ? `<footer>${job.status !== '已关闭' ? `<button class="btn-primary" type="button" data-dept-demand="${escape(job.id)}">${demands.length ? '调整需求' : '新增需求'}</button>` : ''}${active(job) ? `<button class="btn-soft" type="button" data-dept-pause="${escape(job.id)}">暂停招聘</button>` : ''}</footer>` : ''}</article>`;
      }).join('') || '<div class="rf-dialog-empty"><strong>暂无符合条件的岗位</strong><p>可切换“全部部门岗位”查看或录入需求；如果部门岗位尚未建立，请联系 HR 创建岗位。</p></div>'}</div></section>`, 'wide');
      const monthInput = document.querySelector('[data-dept-month]');
      const companyRange = window.companyCalendar?.monthRange(month);
      if (monthInput && companyRange) monthInput.title = `公司统计区间：${companyRange.startDate} 至 ${companyRange.endDate}`;
      const monthNote = document.querySelector('.dd-note');
      if (monthNote && companyRange) monthNote.textContent = `需求人数按所选公司月份显示（${companyRange.startDate} 至 ${companyRange.endDate}）；应聘、接受 Offer 和到岗为岗位累计数据，不等同于当月达成。暂停招聘会保留原需求与候选人记录。`;
      if (monthInput) monthInput.onchange = event => { if (!event.target.value) return; month = event.target.value; load(); };
      document.querySelector('[data-dept-refresh]').onclick = load;
      document.querySelector('[data-dept-new]')?.addEventListener('click', () => edit(null));
      document.querySelectorAll('[data-dept-filter]').forEach(button => button.onclick = () => { filter = button.dataset.deptFilter; render(); });
      document.querySelectorAll('[data-dept-demand]').forEach(button => button.onclick = () => edit(jobs.find(job => job.id === button.dataset.deptDemand)));
      document.querySelectorAll('[data-dept-pause]').forEach(button => button.onclick = () => pause(jobs.find(job => job.id === button.dataset.deptPause)));
    }
    function pause(job) {
      const token = showTalentDialog(`<header class="rf-dialog-head"><div><span>PAUSE RECRUITMENT</span><h2>暂停 ${escape(job.name)} 的招聘？</h2><p>这是岗位级暂停，不仅针对 ${escape(month)}。不会删除需求或候选人，也不会取消已安排的面试。之后新增／调整有效需求可能重新开放招聘。</p></div></header><label class="dd-reason">暂停原因<textarea id="dd-pause-reason" rows="4" placeholder="例如：本阶段编制已满足，暂缓补招"></textarea></label><p class="rf-dialog-message" id="dd-pause-message"></p><div class="dd-toolbar"><button class="btn-soft" type="button" data-dept-back>返回工作台</button><button class="btn-primary" type="button" data-dept-confirm-pause>确认暂停</button></div>`, 'normal');
      document.querySelector('[data-dept-back]').onclick = render;
      const button = document.querySelector('[data-dept-confirm-pause]'), message = document.getElementById('dd-pause-message');
      button.onclick = async () => {
        if (button.disabled) return;
        const reason = document.getElementById('dd-pause-reason').value.trim();
        if (!reason) { message.textContent = '请填写暂停原因'; return; }
        button.disabled = true; button.textContent = '正在暂停…';
        try {
          await request(`api/recruitment/department-demands/${encodeURIComponent(job.id)}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
          notifyUser('已暂停招聘，原需求和候选人记录均保留', 'success');
          if (isTalentDialogCurrent(token)) await load();
        } catch (error) { message.textContent = `暂停失败：${error.message}。原因已保留，可重试。`; }
        finally { button.disabled = false; button.textContent = '确认暂停'; }
      };
    }
    await load();
  };
})();
