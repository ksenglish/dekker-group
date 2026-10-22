// Talking to the app instead of typing at it.
//
// This is the browser's own speech recognition, not a service we pay for and
// not anything that goes through our server: the phone or the laptop does the
// listening and hands back text. Nothing is stored, nothing is charged, and
// the only thing the app ever sees is the words.
//
// Support is uneven and always has been. Chrome, Edge and Safari have it;
// Firefox does not, and a locked-down corporate browser may not either. So
// everything here is written to be asked first and used second — the button
// simply isn't drawn where it would not work.

const Recognition = typeof window !== 'undefined'
  && (window.SpeechRecognition || window.webkitSpeechRecognition);

export const speechSupported = () => Boolean(Recognition);

// A single run of listening. Returns a handle with stop() and the callbacks
// wired, or null where the browser cannot do it.
//
// onResult is called as the words firm up: `final` says whether this is the
// browser's final answer or its current guess, which is what lets the box
// fill in live while somebody is still talking.
export function listen({ onResult, onEnd, onError, lang = 'en-NZ' } = {}) {
  if (!Recognition) return null;

  const rec = new Recognition();
  rec.lang = lang;
  // Keep the interim guesses: watching the words appear is how somebody knows
  // it is hearing them, and a silent box feels broken.
  rec.interimResults = true;
  // One utterance. A search is a few words, not dictation, and stopping at the
  // end of a sentence means the microphone is not left open in a pocket.
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let stopped = false;

  rec.onresult = e => {
    let text = '';
    let final = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      if (e.results[i].isFinal) final = true;
    }
    onResult?.(text.trim(), final);
  };

  rec.onerror = e => {
    // "aborted" is what stopping it ourselves looks like, and "no-speech" is
    // somebody changing their mind. Neither is worth putting on screen.
    if (stopped || e.error === 'aborted' || e.error === 'no-speech') return;
    onError?.(
      e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'The microphone is blocked for this site — allow it in your browser settings.'
        : e.error === 'network'
        ? 'Speech recognition needs a connection, and there is none right now.'
        : 'Could not hear that. Try again, or type it.'
    );
  };

  rec.onend = () => { onEnd?.(); };

  try {
    rec.start();
  } catch {
    // start() throws if it is already running, which a double-tap can cause.
    return null;
  }

  return {
    stop() {
      stopped = true;
      try { rec.stop(); } catch { /* already finished */ }
    },
  };
}
