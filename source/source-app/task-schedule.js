(() => {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const intervals = { minute: [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30], hour: [1, 2, 3, 4, 6, 8, 12] };
  const pad = value => String(value).padStart(2, '0');
  function parse(cron) {
    const base = { mode: 'advanced', time: '09:00', days: [1], date: 1, unit: 'hour', every: 1, cron };
    const parts = String(cron).trim().split(/\s+/);
    if (parts.length === 6 && parts[0] === '0') parts.shift();
    if (parts.length !== 5) return base;
    const [minute, hour, date, month, day] = parts;
    if (month !== '*') return base;
    const numeric = (value, max) => /^\d+$/.test(value) && Number(value) <= max;
    if (numeric(minute, 59) && numeric(hour, 23)) {
      base.time = `${pad(Number(hour))}:${pad(Number(minute))}`;
      if (date === '*' && day === '*') return { ...base, mode: 'daily' };
      if (date === '*' && /^\d(?:,\d)*$/.test(day) && day.split(',').every(value => Number(value) <= 7)) return { ...base, mode: 'weekly', days: [...new Set(day.split(',').map(value => Number(value) % 7))] };
      if (day === '*' && numeric(date, 31) && Number(date) >= 1) return { ...base, mode: 'monthly', date: Number(date) };
    }
    if (date === '*' && day === '*') {
      const minuteStep = minute === '*' ? 1 : /^\*\/\d+$/.test(minute) ? Number(minute.slice(2)) : 0;
      const hourStep = hour === '*' ? 1 : /^\*\/\d+$/.test(hour) ? Number(hour.slice(2)) : 0;
      if (hour === '*' && intervals.minute.includes(minuteStep)) return { ...base, mode: 'interval', unit: 'minute', every: minuteStep };
      if (minute === '0' && intervals.hour.includes(hourStep)) return { ...base, mode: 'interval', unit: 'hour', every: hourStep };
    }
    return base;
  }
  function compile(state) {
    if (state.mode === 'advanced') {
      const cron = state.cron.trim();
      if (![5, 6].includes(cron.split(/\s+/).length)) throw new Error('Cron 需要 5 或 6 段；不熟悉时请选择常用执行方式。');
      return { cron, schedule: `自定义 Cron：${cron}` };
    }
    if (state.mode === 'interval') {
      if (!intervals[state.unit]?.includes(Number(state.every))) throw new Error('请选择有效的执行间隔');
      return { cron: state.unit === 'minute' ? `*/${state.every} * * * *` : `0 */${state.every} * * *`, schedule: `每 ${state.every} ${state.unit === 'minute' ? '分钟' : '小时'}执行一次` };
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(state.time)) throw new Error('请选择完整的执行时间');
    const [hour, minute] = state.time.split(':').map(Number);
    if (state.mode === 'daily') return { cron: `${minute} ${hour} * * *`, schedule: `每天 ${state.time}` };
    if (state.mode === 'weekly') {
      if (!state.days.length || state.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('请至少选择一个星期');
      const days = [...new Set(state.days)].sort((left, right) => (left || 7) - (right || 7));
      return { cron: `${minute} ${hour} * * ${days.join(',')}`, schedule: `每周${days.map(day => weekdays[day]).join('、')} ${state.time}` };
    }
    if (state.mode === 'monthly' && Number.isInteger(Number(state.date)) && state.date >= 1 && state.date <= 31) return { cron: `${minute} ${hour} ${state.date} * *`, schedule: `每月 ${state.date} 日 ${state.time}` };
    throw new Error('请选择有效的执行日期');
  }
  function mount(root, cron, escapeHtml, timezone) {
    const state = parse(cron);
    const preview = () => {
      const summary = root.querySelector('[data-schedule-summary]');
      try { const result = compile(state); summary.textContent = result.schedule; root.querySelector('[data-schedule-expression]').textContent = result.cron; }
      catch (error) { summary.textContent = error.message; root.querySelector('[data-schedule-expression]').textContent = ''; }
    };
    function render() {
      root.innerHTML = `<div class="ts-modes" role="group" aria-label="执行方式">${[['daily', '每天'], ['weekly', '每周'], ['monthly', '每月'], ['interval', '间隔执行'], ['advanced', '高级 Cron']].map(([mode, label]) => `<button type="button" data-schedule-mode="${mode}" aria-pressed="${state.mode === mode}">${label}</button>`).join('')}</div><div class="ts-fields">
        ${state.mode === 'weekly' ? `<fieldset><legend>每周几执行 · 可多选</legend><div class="ts-weekdays">${[1, 2, 3, 4, 5, 6, 0].map(day => `<button type="button" data-schedule-day="${day}" aria-pressed="${state.days.includes(day)}">周${weekdays[day]}</button>`).join('')}</div><button type="button" class="ts-workdays" data-schedule-workdays>选工作日（周一至周五，不排除节假日）</button></fieldset>` : ''}
        ${state.mode === 'monthly' ? `<label>每月几号<select data-schedule-date>${Array.from({ length: 31 }, (_, index) => `<option value="${index + 1}" ${state.date === index + 1 ? 'selected' : ''}>${index + 1} 日</option>`).join('')}</select></label><p class="ts-hint">选择 29、30、31 日时，没有该日期的月份会跳过，不自动改到月末。</p>` : ''}
        ${['daily', 'weekly', 'monthly'].includes(state.mode) ? `<label>几点执行<input type="time" data-schedule-time value="${state.time}" required></label>` : ''}
        ${state.mode === 'interval' ? `<div class="ts-interval"><label>每隔<select data-schedule-every>${intervals[state.unit].map(every => `<option ${state.every === every ? 'selected' : ''}>${every}</option>`).join('')}</select></label><label>时间单位<select data-schedule-unit><option value="minute" ${state.unit === 'minute' ? 'selected' : ''}>分钟</option><option value="hour" ${state.unit === 'hour' ? 'selected' : ''}>小时</option></select></label></div><p class="ts-hint">按时钟刻度执行：分钟间隔从每小时的 00 分起，小时间隔从每天的 00:00 起；不是从点击保存时开始倒计时。</p>` : ''}
        ${state.mode === 'advanced' ? `<label>自定义 Cron<input id="rf-task-edit-cron" data-schedule-cron value="${escapeHtml(state.cron)}" placeholder="0 9 * * *" spellcheck="false"></label><p class="ts-hint">保留复杂计划，不自动替换。5 段依次为：分、时、日、月、周；也支持带秒的 6 段格式。</p>` : ''}
        </div><div class="ts-preview" role="status" aria-live="polite"><span>执行计划</span><strong data-schedule-summary></strong><small>时区：${escapeHtml(timezone || '以任务服务配置为准')}</small><details><summary>查看技术表达式</summary><code data-schedule-expression></code></details></div>`;
      root.querySelectorAll('[data-schedule-mode]').forEach(button => button.onclick = () => { if (button.dataset.scheduleMode === 'advanced') { try { state.cron = compile(state).cron; } catch {} } state.mode = button.dataset.scheduleMode; render(); });
      root.querySelectorAll('[data-schedule-day]').forEach(button => button.onclick = () => { const day = Number(button.dataset.scheduleDay); state.days = state.days.includes(day) ? state.days.filter(value => value !== day) : [...state.days, day]; button.setAttribute('aria-pressed', String(state.days.includes(day))); preview(); });
      root.querySelector('[data-schedule-workdays]')?.addEventListener('click', () => { state.days = [1, 2, 3, 4, 5]; render(); });
      for (const key of ['time', 'date', 'every', 'cron']) root.querySelector(`[data-schedule-${key}]`)?.addEventListener('input', event => { state[key] = ['date', 'every'].includes(key) ? Number(event.target.value) : event.target.value; preview(); });
      root.querySelector('[data-schedule-unit]')?.addEventListener('change', event => { state.unit = event.target.value; state.every = 1; render(); });
      preview();
    }
    render();
    return { value: () => compile(state) };
  }
  globalThis.taskSchedule = { parse, compile, mount };
})();
