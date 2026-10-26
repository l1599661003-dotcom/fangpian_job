(() => {
  const app = document.getElementById('talent-app');
  if (!app) return;
  const mobile = window.matchMedia('(max-width: 760px)');
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    jobs: '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V4h8v3M3 12h18M10 12v3h4v-3"/>',
    people: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a4 4 0 0 1 0 8m2 3a6 6 0 0 1 3 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6m10-6v6M3 11h18m-13 4h3m3 0h3m-9 3h3"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    offer: '<path d="M6 3h9l4 4v14H6ZM14 3v5h5M9 12h7m-7 4h5"/>',
    referral: '<path d="M12 3v12m-4-8 4-4 4 4M5 12H3v9h18v-9h-2"/>',
    analytics: '<path d="M4 3v18h17M8 17v-4m5 4V8m5 9V4"/>',
    settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
    back: '<path d="m14 5-7 7 7 7"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.grid}</svg>`;
  const destinations = [
    { page: 'overview', label: '工作台', access: 'home', icon: 'home', group: '招聘工作', tab: true },
    { page: 'jobs', label: '岗位', access: 'positions', icon: 'jobs', group: '招聘工作', tab: true },
    { page: 'resume-archive', label: '人才', access: 'candidates', icon: 'people', group: '招聘工作', tab: true },
    { page: 'interviews', label: '面试', access: 'interviews', icon: 'calendar', group: '招聘工作', tab: true },
    { page: 'question-bank', label: '题库', access: 'interviews', icon: 'grid', group: '招聘工作' },
    { page: 'offers', label: 'Offer 管理', access: 'offers', icon: 'offer', group: '招聘工作' },
    { page: 'referral', label: '内部推荐', access: 'referrals', icon: 'referral', group: '招聘工作' },
    { page: 'points', label: '积分排行', access: 'points', icon: 'analytics', group: '招聘工作' },
    { page: 'analytics', label: '数据分析', access: 'analytics', icon: 'analytics', group: '管理与工具' },
    { page: 'scheduled-tasks', label: '定时任务', access: 'scheduled_tasks', icon: 'calendar', group: '管理与工具' },
    { page: 'resume-api', label: '开发者中心', access: 'resume_api', icon: 'grid', group: '管理与工具' },
    { page: 'settings', label: '设置', access: 'settings', icon: 'settings', group: '管理与工具' },
  ];
  let allowed = new Set();
  let currentPage = app.dataset.activePage || 'overview';
  let pageHistory = [];
  let returning = false;
  const permitted = item => allowed.has('*') || allowed.has(item.access);
  const header = document.createElement('header');
  header.className = 'rf-appbar';
  header.innerHTML = `<button type="button" data-mobile-back aria-label="返回上一页">${icon('back')}</button><div><small>FANGPIAN · 人才管理</small><strong data-mobile-title>工作台</strong></div><button type="button" data-mobile-menu aria-label="打开我的工作台" aria-haspopup="dialog">${icon('grid')}</button>`;
  header.querySelector('[data-mobile-title]').setAttribute('role', 'heading');
  header.querySelector('[data-mobile-title]').setAttribute('aria-level', '1');
  app.querySelector('.main').prepend(header);
  const tabbar = document.createElement('nav');
  tabbar.className = 'rf-app-tabs';
  tabbar.setAttribute('aria-label', '手机主导航');
  app.append(tabbar);
  const menu = document.createElement('dialog');
  menu.className = 'rf-app-menu';
  menu.setAttribute('aria-labelledby', 'rf-app-menu-title');
  menu.innerHTML = `<header><div><small>MY WORKSPACE</small><h2 id="rf-app-menu-title">我的工作台</h2></div><button type="button" data-mobile-close aria-label="关闭工作台菜单">×</button></header><div class="rf-app-account"><span data-mobile-avatar></span><div><strong data-mobile-name></strong><small data-mobile-role></small></div></div><div data-mobile-destinations></div><footer><button type="button" data-mobile-admin>组织与权限</button><button type="button" data-mobile-logout>退出登录</button></footer>`;
  app.append(menu);
  const shortcuts = document.createElement('nav');
  shortcuts.className = 'rf-app-shortcuts';
  shortcuts.setAttribute('aria-label', '工作台快捷入口');
  app.querySelector('#page-overview .page-head')?.after(shortcuts);

  function renderNavigation() {
    const visible = destinations.filter(permitted);
    tabbar.innerHTML = visible.filter(item => item.tab || visible.length === 1).map(item => `<button type="button" data-mobile-page="${item.page}" ${currentPage === item.page ? 'aria-current="page"' : ''}>${icon(item.icon)}<span>${item.label}</span></button>`).join('') + `<button type="button" data-mobile-menu aria-label="更多功能" aria-haspopup="dialog" ${!visible.some(item => (item.tab || visible.length === 1) && item.page === currentPage) ? 'aria-current="page"' : ''}>${icon('grid')}<span>更多</span></button>`;
    menu.querySelector('[data-mobile-destinations]').innerHTML = ['招聘工作', '管理与工具'].map(group => {
      const items = visible.filter(item => item.group === group);
      return items.length ? `<section><h3>${group}</h3><div>${items.map(item => `<button type="button" data-mobile-page="${item.page}" ${currentPage === item.page ? 'aria-current="page"' : ''}>${icon(item.icon)}<span>${item.label}</span><i aria-hidden="true">›</i></button>`).join('')}</div></section>` : '';
    }).join('');
    shortcuts.innerHTML = visible.filter(item => ['resume-archive', 'interviews', 'offers', 'referral'].includes(item.page)).map(item => `<button type="button" data-mobile-page="${item.page}">${icon(item.icon)}<span>${item.label}</span></button>`).join('');
    const destination = destinations.find(item => item.page === currentPage);
    header.querySelector('[data-mobile-title]').textContent = destination?.label || document.querySelector(`#page-${CSS.escape(currentPage)} h1`)?.textContent || '工作台';
    header.querySelector('[data-mobile-back]').hidden = Boolean(destination?.tab || visible.length === 1);
    tabbar.hidden = !visible.length;
  }

  function openMenu() {
    if (!mobile.matches || menu.open) return;
    menu.querySelector('[data-mobile-name]').textContent = app.querySelector('.current-user-meta strong')?.textContent || '当前用户';
    menu.querySelector('[data-mobile-role]').textContent = app.querySelector('.current-user-meta > span')?.textContent || '';
    menu.querySelector('[data-mobile-avatar]').textContent = menu.querySelector('[data-mobile-name]').textContent.slice(0, 1);
    const admin = app.querySelector('.topbar [data-access-admin]');
    menu.querySelector('[data-mobile-admin]').hidden = !admin || admin.hidden || admin.classList.contains('rf-access-hidden') || admin.classList.contains('rf-permission-hidden');
    menu.querySelector('[data-mobile-logout]').hidden = !app.querySelector('[data-auth-logout]');
    menu.showModal();
  }

  app.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-mobile-menu')) openMenu();
    if (button.hasAttribute('data-mobile-close')) menu.close();
    if (button.hasAttribute('data-mobile-page')) {
      const destination = destinations.find(item => item.page === button.dataset.mobilePage);
      if (!destination || !permitted(destination)) return;
      if (tabbar.contains(button)) pageHistory = [];
      if (menu.open) menu.close();
      window.setPage?.(destination.page);
    }
    if (button.hasAttribute('data-mobile-back')) {
      const previous = pageHistory.pop() || destinations.find(permitted)?.page;
      if (previous) { returning = true; window.setPage?.(previous); returning = false; }
    }
    if (button.hasAttribute('data-mobile-admin') || button.hasAttribute('data-mobile-logout')) {
      const target = app.querySelector(button.hasAttribute('data-mobile-admin') ? '.topbar [data-access-admin]' : '[data-auth-logout]');
      if (!target || target.hidden || target.classList.contains('rf-access-hidden') || target.classList.contains('rf-permission-hidden')) return;
      menu.close();
      target.click();
    }
  });
  menu.addEventListener('click', event => { if (event.target === menu) menu.close(); });
  mobile.addEventListener('change', () => { if (!mobile.matches && menu.open) menu.close(); });
  document.addEventListener('resumeflow:access', event => {
    allowed = new Set(event.detail.pages);
    if (menu.open) menu.close();
    pageHistory = [];
    renderNavigation();
  });
  document.addEventListener('resumeflow:page', event => {
    const next = event.detail.page === 'resume-parse' ? 'resume-archive' : event.detail.page;
    if (next !== currentPage && !returning) pageHistory.push(currentPage);
    currentPage = next;
    renderNavigation();
  });

  function enhanceContent() {
    app.querySelectorAll('.rf-talent-filter-panel, .analysis-filter-bar').forEach(panel => {
      if (panel.parentElement.classList.contains('rf-mobile-disclosure')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'rf-mobile-disclosure';
      wrapper.dataset.collapsed = 'true';
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = `${icon('settings')}<span>筛选条件</span><span data-filter-summary>展开</span>`;
      button.addEventListener('click', () => {
        const expanded = wrapper.dataset.collapsed === 'true';
        wrapper.dataset.collapsed = String(!expanded);
        button.setAttribute('aria-expanded', String(expanded));
        button.querySelector('[data-filter-summary]').textContent = expanded ? '收起' : '展开';
      });
      panel.before(wrapper);
      wrapper.append(button, panel);
    });
    app.querySelectorAll('.page table').forEach(table => {
      const headers = [...table.querySelectorAll('thead th')];
      const eligible = headers.length > 0 && !table.closest('.calendar-shell') && !table.querySelector('[colspan], [rowspan]');
      table.classList.toggle('rf-mobile-record-table', eligible);
      if (!eligible) return;
      table.querySelectorAll('tbody tr').forEach(row => {
        [...row.children].forEach((cell, index) => {
          cell.dataset.mobileLabel = headers[index]?.textContent.trim() || (cell.querySelector('button, a') ? '操作' : '选择');
        });
      });
    });
  }
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; enhanceContent(); });
  }).observe(app.querySelector('.content'), { childList: true, subtree: true });
  let pointerActive = false;
  const updateInputFocus = () => {
    if (pointerActive) return;
    document.body.classList.toggle('rf-mobile-input-focus', Boolean(document.activeElement?.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, select')));
  };
  document.addEventListener('pointerdown', () => { pointerActive = true; }, true);
  const finishPointer = () => setTimeout(() => { pointerActive = false; updateInputFocus(); }, 0);
  document.addEventListener('pointerup', finishPointer, true);
  document.addEventListener('pointercancel', finishPointer, true);
  window.addEventListener('blur', () => { pointerActive = false; updateInputFocus(); });
  document.addEventListener('focusin', updateInputFocus);
  document.addEventListener('focusout', () => setTimeout(updateInputFocus, 0));
  enhanceContent();
})();
