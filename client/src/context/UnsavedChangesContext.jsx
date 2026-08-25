import { createContext, useContext, useRef, useCallback } from 'react';

// A page with unsaved work registers a guard here; the sidebar checks it
// before navigating away.
//
// React Router 6 only offers useBlocker on a data router, and this app uses
// BrowserRouter, so there's no supported way to block a route change from
// inside the page itself. Having the nav ask instead covers the realistic exit
// — clicking somewhere else in the app — while beforeunload covers closing the
// tab. Kept in a ref so registering a guard doesn't re-render the whole shell.
const UnsavedChangesContext = createContext({ setGuard: () => {}, confirmLeave: () => true });

export function UnsavedChangesProvider({ children }) {
  const guardRef = useRef(null);

  // Stable, so a page can safely list it as an effect dependency
  const setGuard = useCallback(fn => { guardRef.current = fn; }, []);

  // True to proceed. No guard registered means nothing to lose.
  const confirmLeave = useCallback(() => {
    if (!guardRef.current) return true;
    const ok = guardRef.current();
    // Leaving means abandoning that page — drop the guard so a later
    // navigation isn't challenged by a page that has already gone.
    if (ok) guardRef.current = null;
    return ok;
  }, []);

  return (
    <UnsavedChangesContext.Provider value={{ setGuard, confirmLeave }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  return useContext(UnsavedChangesContext);
}
