(function () {
  const sidebar = document.querySelector('.sidebar');
  const topbarLeft = document.querySelector('.topbar-left');
  if (!sidebar || !topbarLeft) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'mobile-nav-toggle';
  toggle.setAttribute('aria-label', '打开导航菜单');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = '☰';
  topbarLeft.prepend(toggle);

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'mobile-nav-backdrop';
  backdrop.setAttribute('aria-label', '关闭导航菜单');
  document.body.appendChild(backdrop);

  function setOpen(open) {
    document.body.classList.toggle('mobile-nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
    toggle.textContent = open ? '×' : '☰';
  }

  toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('mobile-nav-open')));
  backdrop.addEventListener('click', () => setOpen(false));
  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('.nav-item, .nav-child') && window.innerWidth <= 960) setOpen(false);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
})();
