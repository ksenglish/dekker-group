// Laying timesheet entries out along an hour axis, shared by the job's Time tab
// and the weekly Timesheets page so the two read the same way.

export const minutesInto = iso => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

export function fmtTimeAmPm(iso) {
  return new Date(iso).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' });
}

export function fmtHourMark(h) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h < 12 ? 'am' : 'pm'}`;
}

// An entry that can actually be placed on the axis.
export const isTimed = e => !!(e.start_time && e.end_time);

// Start and end of an entry in minutes from midnight, exactly as logged.
//
// Nothing is padded here. A short entry is kept visible by a minimum bar width
// at render time, which is a display concern; stretching the end time itself
// made a 9:10–9:19 entry reach 9:25 and collide with the 9:20 that followed it,
// reporting an overlap that never happened.
export function spanOf(e) {
  return { start: minutesInto(e.start_time), end: minutesInto(e.end_time) };
}

// The window the hour axis covers, shared across every day being shown so the
// days stay comparable. A full midnight-to-midnight axis spends most of its
// width on hours nobody works, squeezing a day's entries into a sliver — and
// the point of this view is spotting overlaps, which you cannot do at that
// scale. So it is trimmed to the hours actually worked, rounded out to whole
// hours and never narrower than MIN_WINDOW_HOURS, which keeps the proportions
// honest.
const MIN_WINDOW_HOURS = 8;
export function axisWindow(entries) {
  const timed = entries.filter(isTimed);
  if (!timed.length) return { startHour: 6, endHour: 18 };
  let lo = 24 * 60, hi = 0;
  for (const e of timed) {
    const { start, end } = spanOf(e);
    lo = Math.min(lo, start);
    hi = Math.max(hi, end);
  }
  let startHour = Math.max(0, Math.floor(lo / 60) - 1);
  let endHour = Math.min(24, Math.ceil(hi / 60) + 1);
  // Grow to the minimum span, preferring to extend later in the day — work
  // starts early far more often than it runs past midnight.
  while (endHour - startHour < MIN_WINDOW_HOURS) {
    if (endHour < 24) endHour++;
    else if (startHour > 0) startHour--;
    else break;
  }
  return { startHour, endHour };
}

// Hour ticks for the axis, thinned out on wide windows so the labels don't
// collide — every hour normally, every second or third when the span is wide.
export function hourMarks({ startHour, endHour }) {
  const span = endHour - startHour;
  const step = span <= 10 ? 1 : span <= 16 ? 2 : 3;
  const marks = [];
  for (let h = startHour; h <= endHour; h += step) marks.push(h);
  // Close the axis off at the end hour, but only when there's room — appending
  // it next to the previous tick overlaps the two labels.
  if (endHour - marks[marks.length - 1] >= step) marks.push(endHour);
  return marks;
}

// Turns a window into a percentage-of-width function for positioning bars.
export const pctFor = ({ startHour, endHour }) => min =>
  ((min - startHour * 60) / ((endHour - startHour) * 60)) * 100;

// Packs one person's entries for one day into as few rows as possible: an entry
// joins the first row it doesn't collide with. One row means a clean day; more
// than one means their times overlap, which is exactly what this view is for,
// so those entries are flagged rather than quietly stacked.
export function packLanes(entries) {
  const timed = entries
    .filter(isTimed)
    .map(e => ({ entry: e, ...spanOf(e) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const lanes = [];
  for (const item of timed) {
    const lane = lanes.find(l => l[l.length - 1].end <= item.start);
    if (lane) lane.push(item); else lanes.push([item]);
  }
  // Which entries actually clash with another, so only those are marked — a
  // second row can exist without every bar on it being an overlap.
  const clashing = new Set();
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[i].start < timed[j].end && timed[j].start < timed[i].end) {
        clashing.add(timed[i].entry.id); clashing.add(timed[j].entry.id);
      }
    }
  }
  return { lanes, clashing, untimed: entries.filter(e => !isTimed(e)) };
}

// Whether a set of entries contains any overlap, without laying them out —
// for flagging a day in a grid that has no room to show the bars themselves.
export function hasOverlap(entries) {
  return packLanes(entries).clashing.size > 0;
}
