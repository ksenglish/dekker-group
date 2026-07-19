import { useState, useEffect, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { Link, useSearchParams } from 'react-router-dom';
import { formatJobNumber } from '../../lib/formatJobNumber';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { isAdmin, canAct } from '../../lib/permissions';
import AssignModal from './AssignModal';
import AddNoteModal from './AddNoteModal';
import DayColumnsView from './DayColumnsView';
import styles from './Schedule.module.css';

const APPT_TYPE_LABEL = { sales: 'Sales', operations: 'Operations' };
const APPT_TYPE_COLOURS = { sales: '#5b21b6', operations: '#1e40af' };
// Diaries — which calendar(s) each team member belongs to (set per-user in Users admin)
const DIARIES = ['admin', 'sales', 'operations', 'subcontractor'];
const DIARY_LABEL = { admin: 'Admin', sales: 'Sales', operations: 'Operations', subcontractor: 'Subcontractor' };
const DIARY_COLOURS = { admin: '#b45309', sales: '#5b21b6', operations: '#1e40af', subcontractor: '#0f766e' };
const JOB_STATUSES = ['new', 'quoted', 'scheduled', 'in_progress', 'invoiced', 'complete', 'cancelled'];
const DEFAULT_STATUS_COLOURS = {
  new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
  in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
};
const NOTE_COLOUR = { background: '#fef9c3', border: '#eab308', text: '#713f12' };
// How far ahead an appointment starts fading in from pale to its full status colour
const FADE_WINDOW_HOURS = 120; // 5 days
const MAX_LIGHTEN = 0.72;
// Fixed window notes are fetched for — covers realistic calendar navigation without
// needing to track FullCalendar's active date range (kept fully decoupled — see the
// Month-view bug fix history in this file's git log for why that matters here)
const NOTES_WINDOW_PAST_DAYS = 60;
const NOTES_WINDOW_FUTURE_DAYS = 180;

// Mix a hex colour toward white by `amt` (0 = unchanged, 1 = white)
function lightenHex(hex, amt) {
  const safeAmt = Number.isFinite(amt) ? Math.max(0, Math.min(1, amt)) : 0;
  const h = (hex || '#6b7280').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(full, 16) || 0x6b7280;
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  const mix = c => Math.round(c + (255 - c) * safeAmt);
  return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Combine a schedule row's date + optional start time into a real Date, for time-based fading.
// start_time comes back from Postgres as HH:MM:SS — don't re-append seconds onto it.
function apptDateTime(row) {
  const d = row.scheduled_date.split('T')[0];
  return new Date(`${d}T${row.start_time || '00:00:00'}`);
}

function pad2(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function shiftDay(date, dir) { const d = new Date(date); d.setDate(d.getDate() + dir); return d; }
function formatDayTitle(date) {
  return date.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export default function SchedulePage() {
  const { user } = useAuth();
  const calRef = useRef(null);
  const jumpDateRef = useRef(null);
  const [searchParams] = useSearchParams();
  const [techMap, setTechMap] = useState({});
  const [techRoles, setTechRoles] = useState({});
  const [techDiaries, setTechDiaries] = useState({});
  const [statusColours, setStatusColours] = useState(DEFAULT_STATUS_COLOURS);
  // Sales/operations/subcontractor don't get the diary switcher — the backend
  // already restricts what /schedules returns for them to their own
  // appointments, so filterDiary stays '' (all of what the server sent back)
  // rather than being locked to a diary key; techDiaries is never populated
  // for these roles anyway (GET /users is admin-only), so locking filterDiary
  // to a truthy value here would make every appointment fail the inDiary
  // check below and show nothing.
  const lockedDiary = ['sales', 'operations', 'subcontractor'].includes(user?.role) ? user.role : null;
  const [filterTech, setFilterTech] = useState('');
  const [filterDiary, setFilterDiary] = useState(''); // '' (all) | one of DIARIES
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedNote, setSelectedNote] = useState(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);
  const [addNoteTarget, setAddNoteTarget] = useState(null);
  // Raw rows from the API — recomputed into fcEvents whenever filters, colours, or the clock changes
  const [rawSchedules, setRawSchedules] = useState([]);
  const [rawNotes, setRawNotes] = useState([]);
  const [fcEvents, setFcEvents] = useState([]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const viewKey = user ? `schedule_view_${user.id}` : 'schedule_view';
  // isDayView is a separate flag layered on top of FullCalendar, not one of its own views —
  // FullCalendar itself only ever knows about dayGridMonth/timeGridWeek, exactly as it did
  // before Day view existed, so its own navigation is completely untouched by this feature.
  const [isDayView, setIsDayView] = useState(() => {
    const saved = localStorage.getItem(viewKey);
    return saved === 'day' || saved === 'timeGridDay' || saved === 'resourceTimeGridDay';
  });
  const [dayDate, setDayDate] = useState(() => new Date());

  // Auto-open assign modal if ?job= param present
  useEffect(() => {
    const jobId = searchParams.get('job');
    if (jobId) setAssignTarget({ jobId, date: new Date().toISOString().split('T')[0] });
  }, []);

  useEffect(() => {
    api.get('/users').then(r => {
      const map = {};
      const roles = {};
      const diaries = {};
      r.data.forEach(u => { map[u.id] = u.name; roles[u.id] = u.role; diaries[u.id] = u.diaries || []; });
      setTechMap(map);
      setTechRoles(roles);
      setTechDiaries(diaries);
    }).catch(() => {});
    api.get('/settings/job-status-colours').then(r => setStatusColours(r.data)).catch(() => {});
  }, []);

  // Refresh "now" periodically so upcoming appointments fade in as their time approaches
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    localStorage.setItem(viewKey, isDayView ? 'day' : 'dayGridMonth');
  }, [isDayView]);

  // Colour an appointment by its job status — paler if it's still upcoming,
  // full brightness once its scheduled time has arrived or passed.
  function styleForAppt(row) {
    const base = statusColours[row.status] || DEFAULT_STATUS_COLOURS[row.status] || '#6b7280';
    const hoursUntil = (apptDateTime(row).getTime() - nowTick) / 3600000;
    const lightenAmt = hoursUntil <= 0 ? 0 : Math.min(1, hoursUntil / FADE_WINDOW_HOURS) * MAX_LIGHTEN;
    return {
      background: lightenHex(base, lightenAmt),
      border: base,
      text: lightenAmt > 0.4 ? '#1e293b' : '#ffffff',
    };
  }

  function loadSchedules() {
    api.get('/schedules').then(r => setRawSchedules(r.data)).catch(() => {});
  }

  function loadNotes() {
    const from = toDateStr(shiftDay(new Date(), -NOTES_WINDOW_PAST_DAYS));
    const to = toDateStr(shiftDay(new Date(), NOTES_WINDOW_FUTURE_DAYS));
    api.get('/calendar-notes', { params: { from, to } }).then(r => setRawNotes(r.data)).catch(() => {});
  }

  useEffect(() => { loadSchedules(); loadNotes(); }, []);

  // Diary filter — a person (and their appointments/notes) shows under a diary
  // if that diary is ticked for them in Users admin
  const inDiary = userId => !filterDiary || (techDiaries[userId] || []).includes(filterDiary);

  // Recompute calendar events whenever the raw data, filters, status colours, or clock tick change
  useEffect(() => {
    const apptEvents = rawSchedules
      .filter(s => !filterTech || s.user_id === filterTech)
      .filter(s => inDiary(s.user_id))
      .map(s => {
        const d = s.scheduled_date.split('T')[0]; // strip Postgres timestamp
        const { background, border, text } = styleForAppt(s);
        return {
          id: `sched-${s.id}`,
          // NOTE: don't add top-level `startTime`/`endTime` fields here — those are
          // FullCalendar's own reserved property names for defining recurring events
          // (a time-of-day repeated across a date range). Combined with a normal
          // start/end they made FullCalendar treat every appointment as recurring
          // daily, generating one instance per day across the whole visible range.
          // Use extendedProps.start_time / extendedProps.end_time (below) instead.
          resourceId: s.user_id,
          dateKey: d,
          title: `${formatJobNumber(s)} ${s.customer_name || ''} — ${s.tech_name || ''}`,
          start: s.start_time ? `${d}T${s.start_time}` : d,
          end:   s.end_time   ? `${d}T${s.end_time}`   : undefined,
          allDay: !s.start_time,
          backgroundColor: background,
          borderColor: border,
          textColor: text,
          extendedProps: { ...s, schedId: s.id, type: 'scheduled' },
        };
      });

    const noteEvents = rawNotes
      .filter(n => !filterTech || n.user_id === filterTech)
      .filter(n => inDiary(n.user_id))
      .map(n => {
        const d = n.occurrence_date;
        return {
          id: `note-${n.id}-${d}`,
          resourceId: n.user_id,
          dateKey: d,
          title: `📝 ${n.note}`,
          start: n.start_time ? `${d}T${n.start_time}` : d,
          end:   n.end_time   ? `${d}T${n.end_time}`   : undefined,
          allDay: !n.start_time,
          backgroundColor: NOTE_COLOUR.background,
          borderColor: NOTE_COLOUR.border,
          textColor: NOTE_COLOUR.text,
          extendedProps: { ...n, noteId: n.id, type: 'note', tech_name: n.tech_name },
        };
      });

    setFcEvents([...apptEvents, ...noteEvents]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSchedules, rawNotes, filterTech, filterDiary, techDiaries, statusColours, nowTick]);

  // Persist a change to one appointment's date/time/team member — from the
  // custom Day view's drag/resize (notes aren't draggable, so schedId is always present here)
  async function saveApptChange(schedId, payload) {
    if (!schedId) return;
    try {
      await api.put(`/schedules/${schedId}`, payload);
      loadSchedules();
    } catch { loadSchedules(); }
  }

  async function handleFcEventDrop({ event, revert }) {
    if (event.extendedProps.type === 'note') { revert(); return; } // notes aren't draggable
    const start = event.start;
    const payload = {
      scheduled_date: toDateStr(start),
      start_time: event.allDay ? null : `${pad2(start.getHours())}:${pad2(start.getMinutes())}`,
      end_time: event.allDay || !event.end ? null : `${pad2(event.end.getHours())}:${pad2(event.end.getMinutes())}`,
    };
    try {
      await api.put(`/schedules/${event.extendedProps.schedId}`, payload);
      loadSchedules();
    } catch { revert(); }
  }

  async function handleFcEventResize({ event, revert }) {
    if (event.extendedProps.type === 'note') { revert(); return; }
    const payload = {
      end_time: event.end ? `${pad2(event.end.getHours())}:${pad2(event.end.getMinutes())}` : null,
    };
    try {
      await api.put(`/schedules/${event.extendedProps.schedId}`, payload);
      loadSchedules();
    } catch { revert(); }
  }

  function handleEventClickProps(props) {
    if (props.type === 'note') { setSelectedNote(props); return; }
    setSelectedEvent(props);
    setNotesDraft(props.notes || '');
  }

  function handleEventClick({ event }) { handleEventClickProps(event.extendedProps); }

  // Clicking an empty slot opens the "add note" tool — job appointments are only
  // ever created from the job itself (its own Schedule button, via the ?job= flow below)
  function openAddNote(dateStr, resourceId, time) {
    if (!canAct(user?.role)) return;
    setAddNoteTarget({ date: dateStr, time, userId: resourceId || user?.id });
  }

  function handleFcDateClick({ dateStr }) {
    const [datePart, timePart] = dateStr.split('T');
    openAddNote(datePart, undefined, timePart ? timePart.slice(0, 5) : undefined);
  }

  async function handleSaveNotes() {
    if (!selectedEvent?.schedId) return;
    setSavingNotes(true);
    try {
      await api.put(`/schedules/${selectedEvent.schedId}`, { notes: notesDraft });
      setSelectedEvent(e => ({ ...e, notes: notesDraft }));
      loadSchedules();
    } finally { setSavingNotes(false); }
  }

  function handleEditNote() {
    setAddNoteTarget({ existing: selectedNote });
    setSelectedNote(null);
  }

  // Removes just one date from a recurring note's series
  async function handleDeleteOccurrence() {
    if (!selectedNote?.noteId) return;
    if (!confirm('Delete this occurrence only? Other repeats of this note stay in the diary.')) return;
    await api.post(`/calendar-notes/${selectedNote.noteId}/exclude`, { date: selectedNote.occurrence_date });
    setSelectedNote(null);
    loadNotes();
  }

  async function handleDeleteNote() {
    if (!selectedNote?.noteId) return;
    const isRecurring = selectedNote.recurrence !== 'none';
    if (!confirm(isRecurring ? 'Delete this note and ALL its repeats?' : 'Delete this note?')) return;
    await api.delete(`/calendar-notes/${selectedNote.noteId}`);
    setSelectedNote(null);
    loadNotes();
  }

  // One column per team member for the Day view — filtered to match the
  // team-member dropdown and the selected diary. Sales/operations/
  // subcontractor only ever get their own single column, regardless of the
  // (hidden, for them) diary/team filters.
  const resources = Object.entries(techMap)
    .filter(([id]) => !lockedDiary || id === user.id)
    .filter(([id]) => !filterTech || id === filterTech)
    .filter(([id]) => inDiary(id))
    .map(([id, name]) => ({ id, title: name }));

  function handleAssigned() {
    setAssignTarget(null);
    loadSchedules();
  }

  function handleNoteSaved() {
    setAddNoteTarget(null);
    loadNotes();
  }

  function openJumpToDate() {
    const el = jumpDateRef.current;
    if (!el) return;
    if (el.showPicker) el.showPicker();
    else el.click();
  }

  function handleJumpToDate(e) {
    const val = e.target.value;
    if (!val) return;
    if (isDayView) setDayDate(new Date(`${val}T00:00:00`));
    else calRef.current?.getApi()?.gotoDate(val);
  }

  const canEdit = canAct(user?.role);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Schedule</h1>
        </div>
        <div className={styles.headerActions}>
          {!lockedDiary && Object.keys(techMap).length > 0 && (
            <select className={styles.filterSelect} value={filterTech} onChange={e => setFilterTech(e.target.value)}>
              <option value="">All team members</option>
              {Object.entries(techMap).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
        </div>
      </div>

      {!lockedDiary && (
        <div className={styles.typeFilterRow}>
          <span className={styles.typeFilterLabel}>Diary:</span>
          <div className={styles.typeFilterGroup}>
            <button
              className={`${styles.typeFilterBtn} ${!filterDiary ? styles.typeFilterBtnActive : ''}`}
              onClick={() => setFilterDiary('')}
            >All</button>
            {DIARIES.map(d => (
              <button
                key={d}
                className={`${styles.typeFilterBtn} ${filterDiary === d ? styles.typeFilterBtnActive : ''}`}
                style={filterDiary === d ? { borderColor: DIARY_COLOURS[d], color: DIARY_COLOURS[d], background: DIARY_COLOURS[d] + '12' } : {}}
                onClick={() => setFilterDiary(d)}
              >{DIARY_LABEL[d]}</button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.legend}>
        {JOB_STATUSES.map(s => (
          <div key={s} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: statusColours[s] || DEFAULT_STATUS_COLOURS[s] }} />
            <span style={{ textTransform: 'capitalize' }}>{s.replace('_', ' ')}</span>
          </div>
        ))}
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: NOTE_COLOUR.background, border: `1px solid ${NOTE_COLOUR.border}` }} />
          <span>📝 Note</span>
        </div>
      </div>

      {/* Hidden native date input driving the "jump to date" calendar icon in both toolbars below */}
      <input
        ref={jumpDateRef}
        type="date"
        onChange={handleJumpToDate}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Day view gets its own small toolbar since FullCalendar's native one (used for
          Month/Week below) is hidden along with the rest of FullCalendar while Day is active */}
      {isDayView && (
        <div className={styles.calToolbar}>
          <div className={styles.calToolbarNav}>
            <button className={styles.calNavBtn} onClick={() => setDayDate(d => shiftDay(d, -1))}>‹</button>
            <button className={styles.calNavBtn} onClick={() => setDayDate(d => shiftDay(d, 1))}>›</button>
            <button className={styles.calTodayBtn} onClick={() => setDayDate(new Date())}>Today</button>
            <button className={styles.calNavBtn} onClick={openJumpToDate} title="Jump to date">📅</button>
          </div>
          <div className={styles.calToolbarTitle}>{formatDayTitle(dayDate)}</div>
          <div className={styles.calToolbarViews}>
            <button className={styles.calViewBtn} onClick={() => setIsDayView(false)}>Back to Month/Week</button>
          </div>
        </div>
      )}

      <div className={styles.calendarWrap}>
        <div style={{ display: isDayView ? 'none' : 'block', height: '100%' }}>
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{ left: 'prev,next today jumpToDate', center: 'title', right: 'dayGridMonth,timeGridWeek,dayViewBtn' }}
            customButtons={{
              dayViewBtn: { text: 'Day', click: () => { setDayDate(calRef.current?.getApi()?.getDate() || new Date()); setIsDayView(true); } },
              jumpToDate: { text: '📅', click: openJumpToDate },
            }}
            height="100%"
            expandRows
            editable={canEdit}
            droppable={canEdit}
            eventDrop={handleFcEventDrop}
            eventResize={handleFcEventResize}
            eventClick={handleEventClick}
            dateClick={handleFcDateClick}
            events={fcEvents}
            eventDisplay="block"
            dayMaxEvents={4}
            slotMinTime="07:00:00"
            slotMaxTime="20:30:00"
            nowIndicator
            firstDay={1}
            locale="en-NZ"
            buttonText={{ today: 'Today', month: 'Month', week: 'Week' }}
            eventDidMount={({ el, event }) => { el.title = event.title; }}
          />
        </div>
        {isDayView && (
          <DayColumnsView
            date={dayDate}
            events={fcEvents}
            resources={resources}
            canEdit={canEdit}
            onEventClick={handleEventClickProps}
            onSlotClick={(dateStr, resourceId, time) => openAddNote(dateStr, resourceId, time)}
            onSaveMove={saveApptChange}
          />
        )}
      </div>

      {selectedEvent && (
        <div className={styles.modalOverlay} onClick={() => setSelectedEvent(null)}>
          <div className={styles.eventModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Job {formatJobNumber(selectedEvent)}</h2>
              <button className={styles.modalClose} onClick={() => setSelectedEvent(null)}>✕</button>
            </div>
            <div className={styles.eventDetails}>
              <div className={styles.eventRow}><span>Customer</span><strong>{selectedEvent.customer_name || '—'}</strong></div>
              <div className={styles.eventRow}><span>Type</span><strong>{selectedEvent.job_type?.replace('_',' ')}</strong></div>
              {selectedEvent.tech_name && <div className={styles.eventRow}><span>Team Member</span><strong>{selectedEvent.tech_name}</strong></div>}
              {selectedEvent.appointment_type && (
                <div className={styles.eventRow}><span>Appointment Type</span>
                  <strong style={{ color: APPT_TYPE_COLOURS[selectedEvent.appointment_type] }}>
                    {APPT_TYPE_LABEL[selectedEvent.appointment_type]}
                  </strong>
                </div>
              )}
              <div className={styles.eventRow}><span>Date</span><strong>{new Date(selectedEvent.scheduled_date).toLocaleDateString('en-NZ')}</strong></div>
              {selectedEvent.start_time && <div className={styles.eventRow}><span>Time</span><strong>{selectedEvent.start_time}{selectedEvent.end_time ? ` – ${selectedEvent.end_time}` : ''}</strong></div>}
              {selectedEvent.site_address && <div className={styles.eventRow}><span>Address</span><strong>{selectedEvent.site_address}</strong></div>}
              <div className={styles.eventRow}><span>Status</span>
                <strong style={{ textTransform:'capitalize', color: statusColours[selectedEvent.status] || DEFAULT_STATUS_COLOURS[selectedEvent.status] }}>
                  {selectedEvent.status?.replace('_',' ')}
                </strong>
              </div>
            </div>

            <div className={styles.notesSection}>
              <label>Appointment Notes</label>
              {canEdit ? (
                <>
                  <textarea rows={3} value={notesDraft} onChange={e => setNotesDraft(e.target.value)}
                    placeholder="Notes specific to this appointment (separate from the job's own notes)…" />
                  {notesDraft !== (selectedEvent.notes || '') && (
                    <button className={styles.btnSecondary} onClick={handleSaveNotes} disabled={savingNotes}>
                      {savingNotes ? 'Saving…' : 'Save Notes'}
                    </button>
                  )}
                </>
              ) : (
                <p className={styles.notesReadonly}>{selectedEvent.notes || 'No notes for this appointment.'}</p>
              )}
            </div>

            <div className={styles.modalFooter}>
              <Link to={`/jobs/${selectedEvent.job_id}`} className={styles.btnSecondary} onClick={() => setSelectedEvent(null)}>View Job</Link>
              {isAdmin(user?.role) && selectedEvent.schedId && (
                <button className={styles.btnDanger} onClick={async () => {
                  if (!confirm('Remove this appointment from the schedule?')) return;
                  await api.delete(`/schedules/${selectedEvent.schedId}`);
                  setSelectedEvent(null);
                  loadSchedules();
                }}>Delete Appt</button>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedNote && (
        <div className={styles.modalOverlay} onClick={() => setSelectedNote(null)}>
          <div className={styles.eventModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>📝 Note</h2>
              <button className={styles.modalClose} onClick={() => setSelectedNote(null)}>✕</button>
            </div>
            <div className={styles.eventDetails}>
              <div className={styles.eventRow}><span>Team Member</span><strong>{selectedNote.tech_name}</strong></div>
              <div className={styles.eventRow}><span>Date</span><strong>{new Date(selectedNote.occurrence_date).toLocaleDateString('en-NZ')}</strong></div>
              {selectedNote.start_time && <div className={styles.eventRow}><span>Time</span><strong>{selectedNote.start_time.slice(0,5)}{selectedNote.end_time ? ` – ${selectedNote.end_time.slice(0,5)}` : ''}</strong></div>}
              {selectedNote.recurrence !== 'none' && <div className={styles.eventRow}><span>Repeats</span><strong style={{ textTransform: 'capitalize' }}>{selectedNote.recurrence}</strong></div>}
            </div>
            <div className={styles.notesSection} style={{ borderTop: 'none' }}>
              <p className={styles.notesReadonly}>{selectedNote.note}</p>
            </div>
            <div className={styles.modalFooter}>
              {canEdit && (
                <>
                  <button className={styles.btnSecondary} onClick={handleEditNote}>✏ Edit</button>
                  {selectedNote.recurrence !== 'none' && (
                    <button className={styles.btnDanger} onClick={handleDeleteOccurrence}>Delete This Occurrence</button>
                  )}
                  <button className={styles.btnDanger} onClick={handleDeleteNote}>
                    {selectedNote.recurrence !== 'none' ? 'Delete Series' : 'Delete Note'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {assignTarget && (
        <AssignModal
          date={assignTarget.date}
          jobId={assignTarget.jobId}
          userId={assignTarget.userId}
          techMap={techMap}
          techRoles={techRoles}
          onClose={() => setAssignTarget(null)}
          onAssigned={handleAssigned}
        />
      )}

      {addNoteTarget && (
        <AddNoteModal
          date={addNoteTarget.date}
          time={addNoteTarget.time}
          userId={addNoteTarget.userId}
          existing={addNoteTarget.existing}
          techMap={techMap}
          onClose={() => setAddNoteTarget(null)}
          onSaved={handleNoteSaved}
        />
      )}
    </div>
  );
}
