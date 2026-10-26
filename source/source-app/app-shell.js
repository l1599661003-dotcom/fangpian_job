(() => {
  const app = document.getElementById('talent-app');
  const pages = [...document.querySelectorAll('.page[data-page], .page[id^="page-"]')];
  const navItems = [...document.querySelectorAll('[data-page]')].filter((node) => node.matches('.nav-item, .nav-child'));
  const pageName = (page) => String(page || '').replace(/^page-/, '');
  const accessPageForNav = {
    overview: 'home',
    jobs: 'positions',
    applicants: 'candidates',
    'resume-parse': 'candidates',
    'resume-detail': 'candidates',
    'resume-archive': 'candidates',
    'resume-api': 'resume_api',
    interviews: 'interviews',
    'question-bank': 'interviews',
    offers: 'offers',
    referral: 'referrals',
    points: 'points',
    'scheduled-tasks': 'scheduled_tasks',
    analytics: 'analytics',
    settings: 'settings',
  };
  let currentAccess = null;

  function canOpenPage(page) {
    if (!currentAccess) return false;
    const allowed = new Set(Array.isArray(currentAccess.pages) ? currentAccess.pages : []);
    const accessPage = accessPageForNav[pageName(page)] || pageName(page);
    return allowed.has('*') || allowed.has(accessPage);
  }

  function setPage(page, options = {}) {
    const requested = pageName(page);
    const target = requested === 'resume-parse'
      ? document.getElementById('page-resume-archive')
      : document.getElementById(`page-${requested}`) || document.getElementById('page-overview');
    if (!target) return false;
    if (!canOpenPage(target.id)) return false;
    const targetNav = navItems.find((node) => pageName(node.dataset.page) === pageName(target.id));
    if (targetNav?.hidden) return false;
    pages.forEach((node) => node.classList.toggle('active', node === target));
    navItems.forEach((node) => node.classList.toggle('active', pageName(node.dataset.page) === pageName(target.id)));
    app?.setAttribute('data-active-page', pageName(target.id));
    if (window.matchMedia('(max-width: 1180px)').matches) {
      requestAnimationFrame(() => {
        if (!targetNav) return;
        if (window.matchMedia('(max-width: 760px)').matches) {
          const navGroup = targetNav.closest('.nav-group');
          if (!navGroup) return;
          const left = targetNav.offsetLeft - ((navGroup.clientWidth - targetNav.offsetWidth) / 2);
          navGroup.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
          return;
        }
        targetNav.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      });
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    if (!options.silent) {
      document.dispatchEvent(new CustomEvent('resumeflow:page', { detail: { page: requested === 'resume-parse' ? requested : pageName(target.id) } }));
    }
    return true;
  }

  function applyAuthenticatedAccess(access) {
    const previousPage = app?.getAttribute('data-active-page');
    currentAccess = access || null;
    const allowed = new Set(Array.isArray(access?.pages) ? access.pages : []);
    const unrestricted = allowed.has('*');
    navItems.forEach((node) => {
      const page = pageName(node.dataset.page);
      const accessPage = accessPageForNav[page] || page;
      const denied = !unrestricted && !allowed.has(accessPage);
      node.hidden = denied;
      node.classList.toggle('rf-access-hidden', denied);
    });
    pages.forEach((node) => {
      const permitted = canOpenPage(node.id);
      node.toggleAttribute('data-access-denied', !permitted);
      node.classList.toggle('rf-access-hidden', !permitted);
      if (!permitted) node.classList.remove('active');
    });
    const firstVisibleNav = navItems.find((node) => !node.hidden);
    if (firstVisibleNav) {
      if (!previousPage || !canOpenPage(previousPage) || !pages.some((node) => node.classList.contains('active'))) setPage(firstVisibleNav.dataset.page);
    } else {
      pages.forEach((node) => node.classList.remove('active'));
      app?.setAttribute('data-active-page', '');
    }
    document.dispatchEvent(new CustomEvent('resumeflow:access', { detail: { pages: access?.pages || [] } }));
  }

  window.setPage = setPage;
  window.canOpenRecruitmentPage = canOpenPage;
  window.applyAuthenticatedAccess = applyAuthenticatedAccess;

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.nav-item[data-page], .nav-child[data-page]');
    if (!button || button.hidden || button.disabled) return;
    event.preventDefault();
    setPage(button.dataset.page);
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (!pages.some((node) => node.classList.contains('active'))) setPage('overview');
  }, { once: true });
})();
