import { useState, useCallback, useMemo } from 'react';
import api from '../../lib/api';
import RunPlanner from '../../components/plan/RunPlanner';
import { planToDataUrl } from '../../components/plan/planSvg';
import { perimeterOf, areaOf } from '../../components/plan/planGeometry';
import CompositeDeckCalculator from '../presenter/CompositeDeckCalculator';
import UrbanFenceCalculator from '../presenter/UrbanFenceCalculator';
import PalingFenceTakeoff from '../presenter/PalingFenceTakeoff';
import styles from './JobDrawing.module.css';

// Measuring a site, on the job it belongs to.
//
// The drawing tool already existed, but only inside the fence and deck
// calculators — so what somebody measured in a back yard lived as long as that
// tab did, and the next person to want the measurements went and took them
// again. Here it is the job's: named, saved on the Pre-Install Forms tab
// beside the photographs, and opened again whenever anybody wants it.
//
// Picking a calculator does not copy the drawing into the calculator. It hands
// the same plan over — see usePlan — so moving a wall moves it for both, and
// there is still one deck calculator rather than one for the presenter and
// another for here.

const CALCULATORS = [
  {
    key: 'none',
    label: 'No calculator',
    why: 'Just the drawing and its measurements',
  },
  {
    key: 'composite_deck',
    label: 'Composite Deck',
    why: 'Lays the boards in the outline — picture frame, joists, clips',
    Component: CompositeDeckCalculator,
  },
  {
    key: 'urban_fence',
    label: 'Urban Group Fence',
    why: 'Panels along the line, with the posts and gates on it',
    Component: UrbanFenceCalculator,
  },
  {
    key: 'paling_fence',
    label: 'Timber Paling Fence',
    why: 'Posts in the ground, rails and palings off the drawn runs',
    Component: PalingFenceTakeoff,
  },
];

const EMPTY = { points: [], closed: false, objects: [] };

// A name somebody will recognise on the tab a fortnight later.
const tidyName = (name, fallback) => {
  const said = String(name || '').trim().replace(/\.svg$/i, '');
  return said || fallback;
};

export default function JobDrawing({ job, jobId, drawing, onClose, onSaved }) {
  // An existing drawing opens on what it was; a new one opens empty.
  const [plan, setPlan] = useState(() => ({
    ...EMPTY,
    ...(drawing?.plan_json || {}),
  }));
  const [name, setName] = useState(() => tidyName(drawing?.filename, ''));
  const [calculator, setCalculator] = useState(() => drawing?.plan_json?.calculator || 'none');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(drawing || null);

  const chosen = CALCULATORS.find(c => c.key === calculator) || CALCULATORS[0];
  const drawn = plan.points.length > 0;

  // Passed to the calculator, which calls it whenever the drawing moves.
  // Stable, so the calculator is not re-made on every keystroke elsewhere.
  const planChanged = useCallback(next => setPlan(next), []);

  const facts = useMemo(() => {
    if (!drawn) return null;
    const around = perimeterOf(plan.points, plan.closed);
    const area = plan.closed && plan.points.length > 2 ? areaOf(plan.points) : 0;
    return { around, area };
  }, [plan, drawn]);

  const fallbackName = job?.job_number
    ? `JB${String(job.job_number).padStart(5, '0')} drawing`
    : 'Site drawing';

  // What the calculator has drawn over the walls, lifted off the live plan so
  // the saved file shows the decking or the posts rather than a bare outline.
  // It is already SVG in metres, which is what the file is drawn in, so it
  // goes straight across. A drawing with no calculator on it has none, and
  // the outline is the whole of it.
  function overlayMarkup() {
    try {
      return document.querySelector('[data-plan-overlay]')?.innerHTML || '';
    } catch { return ''; }
  }

  async function save() {
    if (!drawn) { setErr('Draw something first.'); return; }
    setBusy('save'); setErr('');
    try {
      const title = tidyName(name, fallbackName);
      const body = {
        filename: `${title}.svg`,
        mime_type: 'image/svg+xml',
        data_base64: planToDataUrl({
          ...plan,
          title,
          subtitle: job?.job_number ? `JB${String(job.job_number).padStart(5, '0')}` : '',
          showArea: plan.closed,
          overlay: overlayMarkup(),
        }),
        category: 'pre_install',
        plan_json: { ...plan, calculator: calculator === 'none' ? null : calculator },
      };
      // Saved over itself when it already exists. Without that, every visit
      // left another copy on the tab and nobody could tell which was current.
      const { data } = saved
        ? await api.put(`/jobs/${jobId}/attachments/${saved.id}`, body)
        : await api.post(`/jobs/${jobId}/attachments`, body);
      setSaved(data);
      setName(tidyName(data.filename, title));
      onSaved?.(data);
      return data;
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save the drawing');
      return null;
    } finally { setBusy(''); }
  }

  // A quote off the drawing. The drawing goes on it by default — that is the
  // whole point of having measured it — and whatever the calculator was asked
  // to add goes on as line items. Everything else on the Pre-Install tab is
  // attached the way it always was, from the quote itself.
  async function makeQuote() {
    setBusy('quote'); setErr('');
    try {
      const drawingRow = await save();
      if (!drawingRow) return;
      const { data: quote } = await api.post('/quotes', {
        job_id: jobId,
        customer_id: job?.customer_id || undefined,
      });
      if (picked.length) {
        await api.put(`/quotes/${quote.id}/line-items`, {
          items: picked.map(p => ({
            description: p.description || p.name,
            quantity: p.quantity || 1,
            // onPick hands over a Price List product, whose unit_price is in
            // cents excluding GST. The line items endpoint wants dollars.
            unit_price: (p.unit_price || 0) / 100,
            product_id: p.id || null,
            product_name: p.name || null,
          })),
        });
      }
      await api.put(`/quotes/${quote.id}`, { attachment_ids: [drawingRow.id] });
      window.location.href = `/quotes/${quote.id}`;
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not raise a quote from this drawing');
      setBusy('');
    }
  }

  const Calculator = chosen.Component;

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.naming}>
          <label className={styles.nameField}>
            <span>Drawing name</span>
            <input
              value={name}
              placeholder={fallbackName}
              maxLength={120}
              onChange={e => setName(e.target.value)}
            />
          </label>
          {facts && (
            <span className={styles.facts}>
              {facts.around.toFixed(2)}m around
              {facts.area > 0 ? ` · ${facts.area.toFixed(2)}m²` : ''}
            </span>
          )}
        </div>
        <div className={styles.headActions}>
          {err && <span className={styles.err}>{err}</span>}
          {picked.length > 0 && (
            <span className={styles.pickedCount}>
              {picked.length} {picked.length === 1 ? 'line' : 'lines'} ready for a quote
              <button type="button" onClick={() => setPicked([])}>clear</button>
            </span>
          )}
          <button type="button" className={styles.quiet} onClick={onClose} disabled={busy !== ''}>
            Close
          </button>
          <button type="button" className={styles.secondary}
            disabled={!drawn || busy !== ''} onClick={makeQuote}>
            {busy === 'quote' ? 'Raising…' : 'Create a quote'}
          </button>
          <button type="button" className={styles.primary}
            disabled={!drawn || busy !== ''} onClick={save}>
            {busy === 'save' ? 'Saving…' : saved ? 'Save drawing' : 'Save to Pre-Install Forms'}
          </button>
        </div>
      </header>

      {/* What to work the drawing out as. Changing it changes what is drawn
          over the walls and what the figures beside them say; it never
          changes the walls themselves. */}
      <div className={styles.calcBar} role="radiogroup" aria-label="Calculator">
        {CALCULATORS.map(c => (
          <button key={c.key} type="button" role="radio" aria-checked={calculator === c.key}
            className={calculator === c.key ? styles.calcOn : styles.calc}
            onClick={() => setCalculator(c.key)}>
            <strong>{c.label}</strong>
            <em>{c.why}</em>
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {Calculator ? (
          <Calculator
            fullPage
            plan={plan}
            onPlanChange={planChanged}
            onPick={line => setPicked(p => [...p, line])}
            onQuantityChange={() => {}}
            onRecommend={() => {}}
          />
        ) : (
          <div className={styles.planOnly}>
            <RunPlanner
              points={plan.points}
              closed={plan.closed}
              objects={plan.objects}
              onChange={next => setPlan(now => ({ ...now, ...next }))}
              objectKinds={['gate', 'door', 'window', 'opening']}
              showArea
              fill
              hint="Press and drag out the first wall. Carry on round, finish on the corner you started at to close it, and type over any measurement to make it exact."
            />
          </div>
        )}
      </div>
    </div>
  );
}
