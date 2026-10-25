import { useState, useEffect, useRef, useCallback } from 'react';
import { SCAN_FORMATS, looksReal, barcodeVariants } from '../lib/barcode';
import styles from './BarcodeScanner.module.css';

const FORMATS = SCAN_FORMATS;

// How many frames in a row have to agree before a code is accepted.
//
// One frame used to be enough, which is why a bad read went straight through
// to "we haven't seen this one before" and offered to file it against a
// product. A misread comes from one bad moment — a glare, a crease in the
// bag, the camera moving — and almost never repeats with the same wrong
// answer, so asking twice costs a fraction of a second and removes most of it.
const AGREE = 2;

const detectorSupported = () => typeof window !== 'undefined' && 'BarcodeDetector' in window;

const area = box => (box ? (box.width || 0) * (box.height || 0) : 0);

// Camera scanner with a typed-entry fallback.
//
// Uses the browser's built-in BarcodeDetector, which Chrome on Android has —
// that's what the team is on, and it means no scanning library in the bundle.
// Anywhere it's missing (notably iOS Safari) the box below still takes a code
// typed or entered with a bluetooth scanner gun, so this never dead-ends.
// `known` is the set of barcodes the app already holds, used as a fast filter
// so a misread costs nothing. It is not the authority: a code it does not
// contain is checked with the server before being dismissed, because the set
// can be stale, half-loaded or missing entirely, and a barcode that really is
// ours must scan whatever happened to that list.
//
// `verify` is that check — given a code, it returns the code to use, or null.
// Without it the set is all there is; with it, the set is only an optimisation
// and the worst a bad list can do is cost one request per unrecognised code.
export default function BarcodeScanner({
  onScan, onClose, title = 'Scan', hint, known = null, verify = null,
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(null);
  const lastScanRef = useRef({ code: null, at: 0 });
  // The code the last frames agreed on, and how many of them did.
  const agreeRef = useRef({ code: null, seen: 0 });

  const [manual, setManual] = useState('');
  const [error, setError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  // How many reads have been passed over, and the last one of them. The count
  // alone was useless: it could not tell a camera inventing numbers from a
  // real barcode nobody had registered, which is the first thing you want to
  // know when a packet will not scan.
  const [ignored, setIgnored] = useState(0);
  const [lastIgnored, setLastIgnored] = useState(null);
  // Codes the server has already said it does not know. A phantom repeats
  // frame after frame and must not be asked about every time.
  const rejectedRef = useRef(new Set());
  const supported = detectorSupported();

  // The code as we hold it, or null. A product labelled 12-digit must be found
  // by a phone reporting 13, so both ways of writing it are tried.
  const inKnown = useCallback(code => {
    if (!known) return null;
    for (const v of barcodeVariants(code)) if (known.has(v)) return v;
    return null;
  }, [known]);

  // Debounced so one barcode held in frame doesn't fire dozens of times.
  const emit = useCallback(code => {
    const now = Date.now();
    if (lastScanRef.current.code === code && now - lastScanRef.current.at < 2500) return;
    lastScanRef.current = { code, at: now };
    if (navigator.vibrate) navigator.vibrate(60);
    onScan(code);
  }, [onScan]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError('');
    if (!supported) { setError('This device cannot scan with the camera — type the code instead.'); return; }
    try {
      detectorRef.current = detectorRef.current || new window.BarcodeDetector({ formats: FORMATS });
      // Asked for rather than taken as it comes. The default is often 640×480,
      // which is not much to read thin bars off a creased bag with, and the
      // focus is what decides whether the bars are distinct at all. All three
      // are hints: a camera that cannot do them gives what it has.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: 'continuous',
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);

      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const found = await detectorRef.current.detect(videoRef.current);
          // Several barcodes in shot — a shelf, or the next box along. The
          // biggest is the one being held up to the camera.
          const best = (found || [])
            .filter(b => looksReal(b.rawValue, b.format))
            .sort((a, b) => area(b.boundingBox) - area(a.boundingBox))[0];

          if (!best) {
            // Nothing believable this frame. Agreement has to be consecutive,
            // so a gap resets it rather than letting two reads minutes apart
            // count as confirmation of each other.
            agreeRef.current = { code: null, seen: 0 };
          } else if (agreeRef.current.code === best.rawValue) {
            agreeRef.current.seen += 1;
            if (agreeRef.current.seen >= AGREE) {
              agreeRef.current = { code: null, seen: 0 };
              const raw = best.rawValue;
              const held = inKnown(raw);
              if (held) {
                emit(held);
              } else if (verify && !rejectedRef.current.has(raw)) {
                // Not in the list we loaded — which proves nothing, since the
                // list may be stale or may never have arrived. Ask.
                const confirmed = await verify(raw);
                if (confirmed) {
                  emit(confirmed);
                } else {
                  rejectedRef.current.add(raw);
                  setIgnored(n => n + 1);
                  setLastIgnored(raw);
                }
              } else if (!verify) {
                setIgnored(n => n + 1);
                setLastIgnored(raw);
              }
            }
          } else {
            agreeRef.current = { code: best.rawValue, seen: 1 };
          }
        } catch { /* a dropped frame is not worth surfacing */ }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow it in your browser settings, or type the code below.'
          : 'Could not start the camera — type the code below instead.'
      );
      setCameraOn(false);
    }
  }, [supported, emit, inKnown, verify]);

  useEffect(() => {
    if (supported) startCamera();
    return stopCamera;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitManual(e) {
    e.preventDefault();
    const code = manual.trim();
    if (!code) return;
    setManual('');
    onScan(code);
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2>{title}</h2>
          <button className={styles.close} onClick={() => { stopCamera(); onClose(); }}>✕</button>
        </div>

        {hint && <p className={styles.hint}>{hint}</p>}

        <div className={styles.viewport}>
          <video ref={videoRef} className={styles.video} muted playsInline />
          {cameraOn && <div className={styles.reticle} />}
          {!cameraOn && (
            <div className={styles.viewportEmpty}>
              {supported ? 'Camera off' : 'Camera scanning is not available on this device'}
            </div>
          )}
        </div>

        {/* A scanner that is working but says nothing looks broken — and a
            count on its own cannot tell a camera inventing numbers from a real
            barcode nobody registered. So it shows the number. If that matches
            what is printed under the bars, the packet needs adding; if it does
            not, the camera is misreading and it is worth moving the phone. */}
        {ignored > 0 && (
          <div className={styles.ignored}>
            <div>
              {ignored === 1 ? 'Read a code that is not one of ours'
                : `Read ${ignored} codes that are not ours`} — still looking.
            </div>
            {lastIgnored && (
              <div className={styles.ignoredCode}>
                last read: <strong>{lastIgnored}</strong>
              </div>
            )}
            <div className={styles.ignoredHelp}>
              If that matches the number under the bars, the packet is not on the
              price list yet — an admin can add it from Stock. If it does not, it
              is a misread: move the phone a little and hold still.
            </div>
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        {supported && !cameraOn && (
          <button className={styles.btnSecondary} onClick={startCamera}>Start camera</button>
        )}

        <form className={styles.manual} onSubmit={submitManual}>
          <label className={styles.manualLabel}>Or enter the code</label>
          <div className={styles.manualRow}>
            <input
              className={styles.input}
              value={manual}
              onChange={e => setManual(e.target.value)}
              placeholder="Barcode number"
              autoComplete="off"
              // A bluetooth scanner gun types the code then presses Enter,
              // so this field doubles as hardware-scanner input.
              autoFocus={!supported}
            />
            <button type="submit" className={styles.btnPrimary} disabled={!manual.trim()}>Enter</button>
          </div>
        </form>
      </div>
    </div>
  );
}
