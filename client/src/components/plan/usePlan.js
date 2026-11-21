import { useState, useCallback, useMemo } from 'react';

// The drawing a calculator is working on.
//
// Normally its own: open the Urban fence calculator in the Sales Presenter and
// the plan starts empty and belongs to it. But a drawing saved on a job is a
// drawing in its own right — somebody measured a back yard with it — and when
// a calculator is pointed at one of those, the two have to be the same plan
// rather than two copies that drift apart the moment a wall is moved.
//
// So a calculator takes `plan` and `onPlanChange` when somebody else owns the
// drawing, and keeps its own when nobody does. Everything below that line is
// identical either way, which is the point: there is one fence calculator, not
// one for the presenter and another for the job.

const EMPTY = { points: [], closed: false, objects: [] };

const settle = (next, now) => (typeof next === 'function' ? next(now) : next);

export default function usePlan(plan, onPlanChange) {
  const [own, setOwn] = useState(EMPTY);
  const controlled = !!plan && typeof onPlanChange === 'function';
  const current = controlled ? { ...EMPTY, ...plan } : own;

  const setPlan = useCallback(next => {
    if (controlled) onPlanChange(settle(next, { ...EMPTY, ...plan }));
    else setOwn(now => ({ ...EMPTY, ...settle(next, now) }));
  }, [controlled, onPlanChange, plan]);

  // One field at a time, because that is how the calculators already read:
  // setPoints(ps => setTurnAt(ps, i, 90)) and the rest.
  const part = useCallback((key, next) => {
    setPlan(now => ({ ...now, [key]: settle(next, now[key]) }));
  }, [setPlan]);

  return useMemo(() => ({
    points: current.points || [],
    closed: !!current.closed,
    objects: current.objects || [],
    setPlan,
    setPoints: next => part('points', next),
    setClosed: next => part('closed', next),
    setObjects: next => part('objects', next),
  }), [current.points, current.closed, current.objects, setPlan, part]);
}
