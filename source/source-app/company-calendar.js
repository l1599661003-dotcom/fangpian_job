(function (root, factory) {
  const calendar = factory();
  if (root) root.companyCalendar = calendar;
  if (typeof module === 'object' && module.exports) module.exports = calendar;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const timezoneOffsetMs = 8 * 60 * 60 * 1000;
  const companyPeriods = {
    2026: [
      ['2026-01-01', '2026-01-25'],
      ['2026-01-25', '2026-02-22'],
      ['2026-02-22', '2026-03-29'],
      ['2026-03-29', '2026-04-26'],
      ['2026-04-26', '2026-05-24'],
      ['2026-05-24', '2026-06-28'],
      ['2026-06-28', '2026-07-26'],
      ['2026-07-26', '2026-08-23'],
      ['2026-08-23', '2026-09-27'],
      ['2026-09-27', '2026-10-25'],
      ['2026-10-25', '2026-11-22'],
      ['2026-11-22', '2027-01-01'],
    ],
  };

  function dateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const part = (name) => parts.find((item) => item.type === name)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function monthRange(monthValue) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(monthValue || ''));
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]);
    const period = companyPeriods[year]?.[month - 1];
    const startAt = period
      ? Date.parse(`${period[0]}T00:00:00+08:00`)
      : Date.UTC(year, month - 1, 1) - timezoneOffsetMs;
    const endAt = period
      ? Date.parse(`${period[1]}T00:00:00+08:00`)
      : Date.UTC(year, month, 1) - timezoneOffsetMs;
    const startDate = dateKey(startAt), endDate = dateKey(endAt - 1);
    const compact = (value) => `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
    return {
      month: `${match[1]}-${match[2]}`,
      start: new Date(startAt).toISOString(),
      end: new Date(endAt).toISOString(),
      startDate,
      endDate,
      label: `${compact(startDate)}–${compact(endDate)}`,
    };
  }

  function monthForDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const year = Number(dateKey(date).slice(0, 4));
    const periods = companyPeriods[year];
    if (periods) {
      const timestamp = date.getTime();
      const index = periods.findIndex(([start, end]) => timestamp >= Date.parse(`${start}T00:00:00+08:00`) && timestamp < Date.parse(`${end}T00:00:00+08:00`));
      if (index >= 0) return `${year}-${String(index + 1).padStart(2, '0')}`;
    }
    return dateKey(date).slice(0, 7);
  }

  function isCompanyMonth(monthValue) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(monthValue || ''));
    return Boolean(match && companyPeriods[Number(match[1])]?.[Number(match[2]) - 1]);
  }

  return { dateKey, monthRange, monthForDate, isCompanyMonth };
});
