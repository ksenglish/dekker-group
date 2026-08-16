// Parsing Tradify's "Time" column.
//
// A job export puts every labour entry for a job in a single cell, like:
//
//   Pup Smith - 2026-07-29 8:00 hrs 08:40 to 16:40
//
// and when a job has several, Tradify runs them together with no separator at
// all — "…08:40 to 16:40Jacob Ohlson - 2026-07-29 7:50 hrs 08:50 to 16:40".
// So entries are matched globally rather than split on anything.
//
// The name is matched non-greedily and cannot span a newline, which is what
// stops it swallowing the tail of the entry before it.
const ENTRY_RE =
  /([^\n]+?)\s+-\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s*hrs\s+(\d{1,2}):(\d{2})\s+to\s+(\d{1,2}):(\d{2})/g;

const pad = n => String(n).padStart(2, '0');
const round2 = n => Math.round(n * 100) / 100;

/**
 * Pulls labour entries out of a Tradify Time cell.
 *
 * Returns { entries, unparsed } where each entry is
 *   { who, date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM', hours, crossesMidnight, statedHours, elapsedHours }
 *
 * `hours` is Tradify's own stated duration — that's what was billed — and
 * `elapsedHours` is what start/end actually span. They agree in every export
 * seen so far; when they don't, the entry carries both so the difference can
 * be reported rather than silently resolved.
 */
function parseTimeLog(text) {
  const entries = [];
  if (!text || typeof text !== 'string') return { entries, unparsed: [] };

  ENTRY_RE.lastIndex = 0;
  let match;
  let lastEnd = 0;
  const gaps = [];

  while ((match = ENTRY_RE.exec(text)) !== null) {
    // Anything between the previous match and this one is text the pattern
    // didn't understand — worth surfacing rather than dropping on the floor.
    if (match.index > lastEnd) {
      const gap = text.slice(lastEnd, match.index).trim();
      if (gap) gaps.push(gap);
    }
    lastEnd = match.index + match[0].length;

    const [, whoRaw, date, durH, durM, startH, startM, endH, endM] = match;
    const who = whoRaw.trim();
    if (!who) continue;

    const start = `${pad(startH)}:${startM}`;
    const end = `${pad(endH)}:${endM}`;

    const startMins = Number(startH) * 60 + Number(startM);
    const endMins = Number(endH) * 60 + Number(endM);
    // An entry finishing before it starts ran past midnight.
    const crossesMidnight = endMins < startMins;
    const elapsedMins = crossesMidnight ? endMins + 24 * 60 - startMins : endMins - startMins;

    const statedHours = round2(Number(durH) + Number(durM) / 60);
    const elapsedHours = round2(elapsedMins / 60);

    entries.push({
      who,
      date,
      start,
      end,
      crossesMidnight,
      statedHours,
      elapsedHours,
      // Trust Tradify's own figure, falling back to the span when it says zero.
      hours: statedHours > 0 ? statedHours : elapsedHours,
    });
  }

  const tail = text.slice(lastEnd).trim();
  if (tail) gaps.push(tail);

  return { entries, unparsed: gaps };
}

module.exports = { parseTimeLog, ENTRY_RE };
