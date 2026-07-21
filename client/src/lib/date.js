// Local (not UTC) "YYYY-MM-DD" formatting. `Date#toISOString().slice(0, 10)`
// converts to UTC first, which silently shifts the date back a day for any
// local time before UTC midnight — i.e. most of the morning in NZ (UTC+12/+13).
// Use this wherever a DATE-only value (not a timestamp) is meant to represent
// today/this local calendar day.
export function toLocalDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
