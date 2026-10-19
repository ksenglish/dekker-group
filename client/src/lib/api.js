import axios from 'axios';

// In production on Cloudflare Pages, VITE_API_BASE_URL points directly to Render.
// In local dev (no env var), use relative /api which the Vite proxy handles.
const API_BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : '/api';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// ── Telling "your session ended" apart from "the server isn't there" ─────────
//
// These are completely different things and only one of them means the person
// has to log in again. The server restarting — a deploy, or the instance being
// recycled — makes every request fail for about half a minute. Treating that
// as a dead session logged out everybody who happened to be using the app at
// the time, even though the cookie in their browser was good for another week.
//
// Only the server saying no counts. Anything else is the network, and the
// right answer to the network is to wait.
export function isAuthRefusal(err) {
  const status = err?.response?.status;
  return status === 401 || status === 403;
}

// No answer at all, or the platform's proxy saying the thing behind it isn't
// there yet. Either way the request never reached the application, so nothing
// has happened at the far end and asking again is safe.
export function isOutage(err) {
  if (err?.response === undefined) return true;
  return [502, 503, 504].includes(err.response.status);
}

// Reading can be retried; writing cannot.
//
// A GET asks the same question twice and gets the same answer, so riding out a
// restart is free. A POST or a PUT might well have been received and acted on
// before the connection dropped — sending it again could raise the quote
// twice. Those fail and let the person decide.
const OUTAGE_RETRY_DELAYS_MS = [500, 1500, 3000, 6000];

// How long to keep trying before giving the request back to the caller. A
// restart is usually back inside thirty seconds; these add up to about that,
// and then stop rather than hammering a server that is genuinely gone.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

const wait = ms => new Promise(r => setTimeout(r, ms));

// One refresh at a time.
//
// A page coming back to life fires a dozen requests at once, and each one
// getting its own 401 used to start its own refresh. That is a dozen round
// trips where one will do, aimed at a server that has just restarted and is
// the least able to take them.
let inFlight = null;

export function refreshSession() {
  if (!inFlight) {
    inFlight = attemptRefresh().finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function attemptRefresh() {
  let lastError;
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await axios.post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true });
      setAccessToken(data.accessToken);
      return data;
    } catch (err) {
      // The server answered, and the answer was no. The session really is
      // over, so there is nothing to wait for.
      if (isAuthRefusal(err)) throw err;
      lastError = err;
      if (attempt >= RETRY_DELAYS_MS.length) break;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
  // Out of attempts, and still nothing but silence. The session is left
  // exactly as it was: when the server comes back the next request will
  // carry on, which is not true of anyone sent to the login page.
  throw lastError;
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const isAuthEndpoint = original?.url?.includes('/auth/');

    // A restart, met head on. Only reads, and only while there is no answer
    // from the application itself.
    if (original && isOutage(err) && !isAuthEndpoint
        && String(original.method || 'get').toLowerCase() === 'get') {
      const attempt = original._outageAttempt || 0;
      if (attempt < OUTAGE_RETRY_DELAYS_MS.length) {
        original._outageAttempt = attempt + 1;
        await wait(OUTAGE_RETRY_DELAYS_MS[attempt]);
        return api(original);
      }
    }

    if (err.response?.status === 401 && original && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      try {
        const { accessToken: fresh } = await refreshSession();
        original.headers.Authorization = `Bearer ${fresh}`;
        return api(original);
      } catch (refreshErr) {
        // Only a refusal ends the session. A server that could not be reached
        // leaves it alone — the request fails, the page says so, and the next
        // one works once the server is back.
        if (isAuthRefusal(refreshErr)) {
          setAccessToken(null);
          window.location.href = '/login';
        }
        return Promise.reject(refreshErr);
      }
    }
    return Promise.reject(err);
  }
);

export default api;
