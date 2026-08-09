import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './BarcodeScanner.module.css';

// Formats worth looking for: maker barcodes off a box are usually EAN/UPC, our
// own printed labels are Code 128.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'];

const detectorSupported = () => typeof window !== 'undefined' && 'BarcodeDetector' in window;

// Camera scanner with a typed-entry fallback.
//
// Uses the browser's built-in BarcodeDetector, which Chrome on Android has —
// that's what the team is on, and it means no scanning library in the bundle.
// Anywhere it's missing (notably iOS Safari) the box below still takes a code
// typed or entered with a bluetooth scanner gun, so this never dead-ends.
export default function BarcodeScanner({ onScan, onClose, title = 'Scan', hint }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(null);
  const lastScanRef = useRef({ code: null, at: 0 });

  const [manual, setManual] = useState('');
  const [error, setError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const supported = detectorSupported();

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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
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
          if (found?.length) emit(found[0].rawValue);
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
  }, [supported, emit]);

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
