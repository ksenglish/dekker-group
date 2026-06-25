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

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const isAuthEndpoint = original.url?.includes('/auth/');
    if (err.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      try {
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true });
        setAccessToken(data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        setAccessToken(null);
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
