(() => {
  const mobile = window.matchMedia('(max-width: 760px)');
  const formSelector = '.rf-public-preparation-form, #rf-public-assessment-form, #rf-referral-form, #rf-offer-create-form, .rf-dialog-form';
  const formStates = new WeakMap();
  let sectionNumber = 0;
  let scheduled = false;
  const visible = node => node.getClientRects().length > 0 && !node.closest('[hidden]');
  const isFilled = field => {
    const multiSelect = field.closest('.rf-combobox')?.querySelector('select[multiple]');
    return multiSelect ? multiSelect.selectedOptions.length > 0 : field.validity.valid;
  };
  const moveTo = node => {
    if (!node) return;
    node.scrollIntoView({ block: 'start', behavior: 'auto' });
    const field = node.matches('input,select,textarea') ? node : node.querySelector('input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled])');
    field?.focus({ preventScroll: true });
  };

  function updateForm(form) {
    const state = formStates.get(form);
    if (!state) return;
    const assessment = form.id === 'rf-public-assessment-form';
    const required = assessment
      ? [...form.querySelectorAll('.rf-public-question[data-required="true"]')]
      : [...form.querySelectorAll('input[required],select[required],textarea[required]')].filter(field => !field.disabled && visible(field));
    const missing = required.filter(field => {
      if (!assessment) return !isFilled(field);
      if (field.dataset.type === 'file') return field.dataset.uploaded !== 'true' && !field.querySelector('.rf-public-file strong')?.textContent.startsWith('已上传');
      if (['single', 'multiple'].includes(field.dataset.type)) return !field.querySelector('input:checked');
      return !field.querySelector('textarea')?.value.trim();
    });
    const label = required.length ? `${assessment ? '必答题' : '必填项'} ${required.length - missing.length} / ${required.length}` : '按实际情况填写，提交前请核对';
    if (state.summary.textContent !== label) state.summary.textContent = label;
    state.check.hidden = !missing.length;
    state.missing = missing;
  }

  function enhanceForm(form) {
    if (formStates.has(form)) { updateForm(form); return; }
    if (form.matches('.rf-dialog-form') && form.querySelectorAll('input:not([type="hidden"]),select,textarea').length < 6) return;
    const panel = document.createElement('nav');
    panel.className = 'rf-mobile-form-map';
    panel.setAttribute('aria-label', '填写导航');
    const heading = document.createElement('div');
    const summary = document.createElement('strong');
    const check = document.createElement('button');
    check.type = 'button';
    check.textContent = '定位待填项';
    heading.append(summary, check);
    panel.append(heading);
    const links = document.createElement('div');
    links.className = 'rf-mobile-section-links';
    const sections = [...form.querySelectorAll(':scope > section, :scope > .rf-public-communication-scroll > section, :scope > article.rf-public-question')].filter(section => section.querySelector('input,select,textarea'));
    sections.forEach((section, index) => {
      if (!section.id) section.id = `rf-mobile-section-${++sectionNumber}`;
      const link = document.createElement('button');
      link.type = 'button';
      link.textContent = section.querySelector('.rf-public-form-title strong,h2,h3,header strong')?.textContent.trim() || `第 ${index + 1} 部分`;
      link.setAttribute('aria-controls', section.id);
      link.addEventListener('click', () => moveTo(section));
      links.append(link);
    });
    if (sections.length > 1) panel.append(links);
    if (!sections.length && form.querySelectorAll('label').length >= 6) {
      const index = document.createElement('details');
      index.className = 'rf-mobile-field-index';
      const title = document.createElement('summary');
      title.textContent = '查看填写项，快速定位';
      const fields = document.createElement('div');
      form.querySelectorAll('label').forEach(label => {
        const field = label.querySelector('input:not([type="hidden"]),select,textarea');
        const text = label.querySelector(':scope > span')?.textContent.trim();
        if (!field || !text || field.disabled || label.hidden) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.addEventListener('click', () => { index.open = false; moveTo(field); });
        fields.append(button);
      });
      index.append(title, fields);
      panel.append(index);
    }
    form.prepend(panel);
    formStates.set(form, { summary, check, missing: [] });
    check.addEventListener('click', () => {
      updateForm(form);
      const field = formStates.get(form).missing[0];
      moveTo(field);
      field?.reportValidity?.();
    });
    updateForm(form);
  }

  function enhanceWriter(field) {
    if (field.dataset.mobileWriter) return;
    field.dataset.mobileWriter = 'true';
    const tools = document.createElement('div');
    tools.className = 'rf-mobile-writer-tools';
    const count = document.createElement('span');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '展开输入区';
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      const expanded = field.classList.toggle('rf-mobile-writing');
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = expanded ? '收起输入区' : '展开输入区';
      moveTo(field);
    });
    const update = () => { count.textContent = `已输入 ${field.value.length} 字 · 解析后请核对`; };
    field.addEventListener('input', update);
    update();
    tools.append(count, button);
    field.after(tools);
  }

  function jumpButton(container, target, label) {
    if (!container || !target || container.querySelector('.rf-mobile-jump')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rf-mobile-jump';
    button.textContent = label;
    button.addEventListener('click', () => moveTo(target));
    container.append(button);
  }

  function enhance() {
    document.querySelectorAll(formSelector).forEach(enhanceForm);
    document.querySelectorAll('#rf-comm-transcript-text, #rf-public-communication-transcript, #rf-public-evaluation-form textarea[name="transcript"], #rf-feedback-transcript-text').forEach(enhanceWriter);
    jumpButton(document.querySelector('.review-toolbar'), document.querySelector('#review-action'), '查看后填写评审');
    jumpButton(document.querySelector('.rf-public-preparation-intro'), document.querySelector('#rf-public-interview-preparation'), '填写面试资料');
    jumpButton(document.querySelector('.rf-xhs-public-intro') || document.querySelector('.rf-xhs-public-hero'), document.querySelector('#rf-referral-form'), '直接投递简历');
    document.querySelectorAll('.rf-ref-position-card').forEach((card, index) => {
      if (card.querySelector('.rf-mobile-jump')) return;
      const select = document.querySelector('#rf-referral-form select[name="intendedPositionId"]');
      const option = select?.options[index];
      if (!option) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rf-mobile-jump';
      button.textContent = '投递这个岗位';
      button.addEventListener('click', () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        moveTo(document.getElementById('rf-referral-form'));
      });
      card.append(button);
    });
    document.querySelectorAll('.rf-job-batch-bar').forEach(bar => {
      bar.classList.toggle('rf-mobile-batch-empty', !bar.querySelector('[data-rf-job-batch]:not(:disabled)'));
    });
    document.querySelectorAll('[id^="rf-public-"][id$="message"], .rf-dialog-message').forEach(message => {
      if (!message.hasAttribute('aria-live')) message.setAttribute('aria-live', 'polite');
    });
    const offerNote = document.getElementById('rf-public-offer-note');
    const offerActions = document.querySelector('.rf-public-offer-actions');
    if (mobile.matches && offerNote && offerActions && !offerNote.closest('label')) {
      const label = document.createElement('label');
      label.className = 'rf-mobile-offer-note';
      const title = document.createElement('span');
      title.textContent = '答复说明（选填）';
      offerActions.before(label);
      label.append(title, offerNote);
    }
  }

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; enhance(); });
  };
  document.addEventListener('input', event => {
    const form = event.target.closest(formSelector);
    if (form) { form.dataset.mobileDirty = 'true'; updateForm(form); }
  });
  document.addEventListener('change', event => {
    const form = event.target.closest(formSelector);
    if (form) form.dataset.mobileDirty = 'true';
    schedule();
  });
  window.addEventListener('beforeunload', event => {
    if (!mobile.matches) return;
    const dirty = [...document.querySelectorAll('form[data-mobile-dirty="true"]')].some(form => visible(form) && !['rf-public-evaluation-form', 'rf-public-assessment-form'].includes(form.id));
    if (dirty) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('resumeflow:page', schedule);
  document.addEventListener('invalid', event => {
    if (mobile.matches && event.target.closest(formSelector)) moveTo(event.target);
  }, true);
  mobile.addEventListener('change', schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  enhance();
})();
