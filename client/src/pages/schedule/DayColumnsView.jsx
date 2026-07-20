import { useState, useEffect, useRef } from 'react';
import styles from './Schedule.module.css';
import { formatJobNumber } from '../../lib/formatJobNumber';

// A free, self-built "one column per team member" Day view — replaces
// FullCalendar's resource-timegrid plugin, which requires a paid Premium
// licence for exactly this layout (vertical resource columns).
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 20.5; // 8:30pm, matches the old slotMaxTime
const PX_PER_HOUR = 60;
const TOTAL_HEIGHT = (DAY_END_HOUR - DAY_START_HOUR) * PX_PER_HOUR;
// Short appointments get stretched to this height so Job #/Name/Address/Notes all
// have room to render — capped per-event to the gap before the next tile in its lane
// (see assignLanes) so stretching never overlaps a back-to-back appointment.
const MIN_DETAIL_HEIGHT = 46;
const HOURS = Array.from({ length: Math.ceil(DAY_END_HOUR) - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);

function pad2(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function formatHour(h) {
  const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour12}${h >= 12 ? 'pm' : 'am'}`;
}
function timeToMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60 + m) - DAY_START_HOUR * 60;
}
function minToHHMM(minsSinceStart) {
  const total = minsSinceStart + DAY_START_HOUR * 60;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}
function minToPx(mins) { return (mins / 60) * PX_PER_HOUR; }
function pxToMin(px) { return (px / PX_PER_HOUR) * 60; }
function snap15(mins) { return Math.round(mins / 15) * 15; }

// Lay overlapping events out side-by-side within a column
function assignLanes(events) {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin);
  const laneEnds = [];
  const laneEvents = [];
  const placed = sorted.map(ev => {
    let lane = laneEnds.findIndex(end => end <= ev.startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); laneEvents.push([]); }
    laneEnds[lane] = ev.endMin;
    laneEvents[lane].push(ev);
    return { ...ev, lane };
  });
  const totalLanes = laneEnds.length || 1;
  return placed.map(ev => {
    const nextInLane = laneEvents[ev.lane][laneEvents[ev.lane].indexOf(ev) + 1];
    // How far this tile can stretch before it would run into the next one below it
    const availableMin = nextInLane ? nextInLane.startMin - ev.startMin : Infinity;
    return { ...ev, totalLanes, availableMin };
  });
}

export default function DayColumnsView({ date, events, resources, canEdit, onEventClick, onSlotClick, onSaveMove }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const isToday = dateStr(date) === dateStr(now);
  const nowOffsetPx = isToday ? minToPx((now.getHours() * 60 + now.getMinutes()) - DAY_START_HOUR * 60) : null;

  const dayKey = dateStr(date);
  const dayEvents = events.filter(e => e.dateKey === dayKey);

  // Clicking empty space opens the "add note" tool, defaulted to the clicked time
  function handleSlotClick(e, resourceId) {
    if (e.target.closest(`.${styles.dayEvent}`)) return; // clicks on events are handled separately
    if (!canEdit) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetMin = snap15(pxToMin(e.clientY - rect.top));
    onSlotClick(dayKey, resourceId, minToHHMM(Math.max(0, offsetMin)));
  }

  return (
    <div className={styles.dayView}>
      <div className={styles.dayHeaderRow}>
        <div className={styles.dayTimeGutterHeader} />
        {resources.map(r => (
          <div key={r.id} className={styles.dayColumnHeader}>{r.title}</div>
        ))}
      </div>
      <div className={styles.dayAllDayRow}>
        <div className={styles.dayTimeGutterLabel}>all-day</div>
        {resources.map(r => (
          <div key={r.id} className={styles.dayAllDayCell}>
            {dayEvents.filter(e => e.resourceId === r.id && e.allDay).map(e => (
              <div key={e.id} className={styles.dayAllDayEvent}
                style={{ background: e.backgroundColor, borderColor: e.borderColor, color: e.textColor }}
                onClick={() => onEventClick(e.extendedProps)}>
                {e.title}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className={styles.dayGridRow}>
        <div className={styles.dayTimeGutter} style={{ height: TOTAL_HEIGHT }}>
          {HOURS.map(h => (
            <div key={h} className={styles.dayHourLabel} style={{ top: (h - DAY_START_HOUR) * PX_PER_HOUR }}>
              {formatHour(h)}
            </div>
          ))}
        </div>
        {resources.map(r => {
          const timed = assignLanes(
            dayEvents
              .filter(e => e.resourceId === r.id && !e.allDay)
              .map(e => {
                const startTime = e.extendedProps.start_time || e.extendedProps.note_start_time;
                const endTime = e.extendedProps.end_time || e.extendedProps.note_end_time;
                return { ...e, startMin: timeToMin(startTime), endMin: endTime ? timeToMin(endTime) : timeToMin(startTime) + 30 };
              })
          );
          return (
            <DayColumn key={r.id} resourceId={r.id} height={TOTAL_HEIGHT}
              onClick={e => handleSlotClick(e, r.id)}>
              {HOURS.map(h => (
                <div key={h} className={styles.dayGridLine} style={{ top: (h - DAY_START_HOUR) * PX_PER_HOUR }} />
              ))}
              {isToday && nowOffsetPx != null && nowOffsetPx >= 0 && nowOffsetPx <= TOTAL_HEIGHT && (
                <div className={styles.dayNowLine} style={{ top: nowOffsetPx }} />
              )}
              {timed.map(e => (
                <DayEvent key={e.id} appt={e} canEdit={canEdit && e.extendedProps.type !== 'note'}
                  onClick={() => onEventClick(e.extendedProps)}
                  onSaveMove={(payload) => onSaveMove(e.extendedProps.schedId, payload)}
                  dayKey={dayKey} />
              ))}
            </DayColumn>
          );
        })}
      </div>
    </div>
  );
}

function DayColumn({ resourceId, height, onClick, children }) {
  return (
    <div className={styles.dayColumn} data-resource-id={resourceId} style={{ height }} onClick={onClick}>
      {children}
    </div>
  );
}

function DayEvent({ appt, canEdit, onClick, onSaveMove, dayKey }) {
  const elRef = useRef(null);
  const [drag, setDrag] = useState(null); // { top, height } while actively dragging/resizing — overrides computed position
  const isNote = appt.extendedProps.type === 'note';
  const jobNumber = !isNote && formatJobNumber(appt.extendedProps);
  const customerName = !isNote && appt.extendedProps.customer_name;
  const address = !isNote && appt.extendedProps.site_address;
  const notes = !isNote && appt.extendedProps.notes;

  const top = drag?.top ?? minToPx(appt.startMin);
  const stretchTo = isNote ? 18 : Math.min(MIN_DETAIL_HEIGHT, minToPx(appt.availableMin ?? Infinity));
  const height = drag?.height ?? Math.max(18, stretchTo, minToPx(appt.endMin - appt.startMin));
  const width = 100 / appt.totalLanes;
  const left = appt.lane * width;

  function startMove(e) {
    if (!canEdit) return;
    e.preventDefault();
    const startY = e.clientY;
    const startTop = minToPx(appt.startMin);
    const durationPx = minToPx(appt.endMin - appt.startMin);
    let moved = false;
    let finalTop = startTop;
    let finalResourceId = appt.resourceId;

    function onMove(ev) {
      const deltaY = ev.clientY - startY;
      if (Math.abs(deltaY) > 3) moved = true;
      let newTop = Math.max(0, startTop + deltaY);
      newTop = minToPx(snap15(pxToMin(newTop)));
      finalTop = newTop;
      const colEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-resource-id]');
      if (colEl) finalResourceId = colEl.dataset.resourceId;
      setDrag({ top: newTop, height: durationPx });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDrag(null);
      if (!moved) { onClick(); return; }
      const newStartMin = pxToMin(finalTop);
      const newEndMin = newStartMin + (appt.endMin - appt.startMin);
      onSaveMove({
        scheduled_date: dayKey,
        start_time: minToHHMM(newStartMin),
        end_time: minToHHMM(newEndMin),
        user_id: finalResourceId,
      });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startResize(e) {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startHeight = minToPx(appt.endMin - appt.startMin);
    let moved = false;
    let finalHeight = startHeight;

    function onMove(ev) {
      const deltaY = ev.clientY - startY;
      if (Math.abs(deltaY) > 3) moved = true;
      let newHeight = Math.max(15, startHeight + deltaY);
      newHeight = minToPx(Math.max(15, snap15(pxToMin(newHeight))));
      finalHeight = newHeight;
      setDrag({ top: minToPx(appt.startMin), height: newHeight });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDrag(null);
      if (!moved) return;
      onSaveMove({
        scheduled_date: dayKey,
        start_time: minToHHMM(appt.startMin),
        end_time: minToHHMM(appt.startMin + pxToMin(finalHeight)),
      });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div ref={elRef} className={styles.dayEvent}
      style={{
        top, height, left: `${left}%`, width: `calc(${width}% - 2px)`,
        background: appt.backgroundColor, borderColor: appt.borderColor, color: appt.textColor,
        cursor: isNote ? 'pointer' : 'grab',
      }}
      title={isNote ? appt.title : [appt.title, address, notes].filter(Boolean).join('\n')}
      onMouseDown={isNote ? undefined : startMove}
      onClick={isNote ? onClick : undefined}>
      {isNote ? (
        <span className={styles.dayEventTitle}>{appt.title}</span>
      ) : (
        <>
          <span className={styles.dayEventTitle}>{jobNumber}{customerName ? ` ${customerName}` : ''}</span>
          {address && <span className={styles.dayEventAddress}>📍 {address}</span>}
          {notes && <span className={styles.dayEventNotes}>📝 {notes}</span>}
        </>
      )}
      {canEdit && <div className={styles.dayEventResizeHandle} onMouseDown={startResize} />}
    </div>
  );
}
