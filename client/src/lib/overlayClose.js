// Props for a modal's backdrop element so it closes on a genuine backdrop
// click — but NOT when a drag that started inside the modal happens to end on
// the backdrop (e.g. selecting text in a field and releasing the mouse
// outside the box, which used to close the modal and wipe out everything
// typed so far).
//
// A click event fires on the nearest common ancestor of where the mouse went
// down and where it came up, so the old `e.target === e.currentTarget` check
// alone can't tell those two cases apart — the overlay is that common
// ancestor either way. Tracking where the mousedown actually landed is what
// distinguishes them.
//
// Deliberately a plain function, not a hook: several of these overlays are
// rendered inside a conditional (`{open && <div …>}`), where calling a hook
// would break the Rules of Hooks. A module-level variable is safe here since
// the browser serialises mouse interactions — only one press is ever in
// flight at a time, even with multiple modals mounted.
//
// Usage: <div className={styles.overlay} {...overlayClose(onClose)}>
let lastMouseDownTarget = null;

export function overlayClose(onClose) {
  return {
    onMouseDown: e => { lastMouseDownTarget = e.target; },
    onClick: e => {
      // Close only when the press *and* the release both landed on the
      // backdrop itself, rather than bubbling up from inside the modal.
      if (e.target === e.currentTarget && lastMouseDownTarget === e.currentTarget) onClose();
      lastMouseDownTarget = null;
    },
  };
}
