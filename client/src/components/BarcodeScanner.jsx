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
// `known` is the set of barcodes the app already holds. Given one, the camera
// only reports codes in it — anything else is a misread and is passed over in
// silence, which is what a supermarket scanner does and what makes this
// reliable. Left out (the Add New Barcode flow), anything readable is
// reported, because an unrecognised code is the whole point there.
export default function BarcodeScanner({ onScan, onClose, title = 'Scan', hint, known = null }) {
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
  // How many reads have been passed over for not matching anything we hold.
  // Shown so a scanner that is working but silent does not look broken.
  const [ignored, setIgnored] = useState(0);
  const supported = detectorSupported();

  // The code as we hold it, or null when we do not hold it at all. A product
  // labelled 12-digit must be found by a phone reporting 13, so both ways of
  // writing the same barcode are tried.
  const recognise = useCallback(code => {
    if (!known) return code;
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
              const held = recognise(best.rawValue);
              if (held) emit(held);
              // Not one of ours. Almost certainly a misread, so the camera
              // simply keeps looking rather than offering to file it.
              else setIgnored(n => n + 1);
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
  }, [supported, emit, recognise]);

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

        {/* A scanner that is working but says nothing looks broken. This says
            it is reading, and that what it read was not one of ours. */}
        {known && ignored > 0 && (
          <div className={styles.ignored}>
            {ignored === 1 ? 'A code was read but ' : `${ignored} codes were read but `}
            {ignored === 1 ? 'is not' : 'are not'} one of ours — still looking.
            {ignored >= 3 && ' If the packet really is new, an admin can add it under Stock.'}
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
