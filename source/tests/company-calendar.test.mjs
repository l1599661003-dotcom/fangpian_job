import test from 'node:test';
import assert from 'node:assert/strict';
import companyCalendar from '../dist/company-calendar.js';

test('2026 company months follow the supplied date ranges and use half-open boundaries', () => {
  assert.equal(companyCalendar.monthForDate('2026-09-26T15:59:59.999Z'), '2026-09');
  assert.equal(companyCalendar.monthForDate('2026-09-26T16:00:00.000Z'), '2026-10');
  assert.equal(companyCalendar.monthForDate('2026-10-24T15:59:59.999Z'), '2026-10');
  assert.equal(companyCalendar.monthForDate('2026-10-24T16:00:00.000Z'), '2026-11');
  assert.equal(companyCalendar.monthForDate('2026-09-29T00:00:00+08:00'), '2026-10');

  assert.deepEqual(companyCalendar.monthRange('2026-10'), {
    month: '2026-10',
    start: '2026-09-26T16:00:00.000Z',
    end: '2026-10-24T16:00:00.000Z',
    startDate: '2026-09-27',
    endDate: '2026-10-24',
    label: '9/27–10/24',
  });
});

test('all supplied 2026 company month ranges match the company schedule', () => {
  const expectedRanges = [
    ['2026-01', '2026-01-01', '2026-01-24'],
    ['2026-02', '2026-01-25', '2026-02-21'],
    ['2026-03', '2026-02-22', '2026-03-28'],
    ['2026-04', '2026-03-29', '2026-04-25'],
    ['2026-05', '2026-04-26', '2026-05-23'],
    ['2026-06', '2026-05-24', '2026-06-27'],
    ['2026-07', '2026-06-28', '2026-07-25'],
    ['2026-08', '2026-07-26', '2026-08-22'],
    ['2026-09', '2026-08-23', '2026-09-26'],
    ['2026-10', '2026-09-27', '2026-10-24'],
    ['2026-11', '2026-10-25', '2026-11-21'],
    ['2026-12', '2026-11-22', '2026-12-31'],
  ];

  for (const [month, startDate, endDate] of expectedRanges) {
    const range = companyCalendar.monthRange(month);
    assert.equal(range.startDate, startDate, `${month} start`);
    assert.equal(range.endDate, endDate, `${month} end`);
    assert.equal(companyCalendar.monthForDate(range.start), month, `${month} includes its start`);
    assert.equal(companyCalendar.monthForDate(Date.parse(range.end) - 1), month, `${month} includes the last millisecond`);
  }
});

test('months without a supplied company calendar retain Shanghai calendar-month fallback', () => {
  assert.equal(companyCalendar.monthForDate('2027-01-15T00:00:00+08:00'), '2027-01');
  assert.equal(companyCalendar.monthRange('2027-01').start, '2026-12-31T16:00:00.000Z');
  assert.equal(companyCalendar.isCompanyMonth('2026-10'), true);
  assert.equal(companyCalendar.isCompanyMonth('2027-01'), false);
  assert.equal(companyCalendar.monthRange('2026-13'), null);
});
