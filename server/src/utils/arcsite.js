// Thin client for the ArcSite API (https://api.arcsite.com/v1).
// Push: create/update a Project from a Dekker job. Pull: list/fetch drawings
// attached to that project so they can be downloaded into job_attachments.

const BASE_URL = 'https://api.arcsite.com/v1';

async function arcsiteRequest(method, path, body) {
  const token = process.env.ARCSITE_API_TOKEN;
  if (!token) throw new Error('ARCSITE_API_TOKEN is not configured');

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ArcSite ${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function createOrUpdateProject(project, existingProjectId) {
  if (existingProjectId) {
    return arcsiteRequest('PATCH', `/projects/${existingProjectId}`, project);
  }
  return arcsiteRequest('POST', '/projects', project);
}

// ArcSite refuses a second project with the same name. That is what a job hits
// when its project was created but the id never made it back onto the job.
function isNameTakenError(err) {
  return /POST \/projects failed: 400/.test(err?.message || '') && /already exists/i.test(err.message);
}

// Find the project that belongs to a job when the job has lost (or never kept)
// its id. ArcSite's list endpoint has no search, so this pages through it —
// a few hundred projects is a handful of requests. An exact name match wins;
// otherwise the newest project carrying the job's number, live ones first.
async function findProjectForJob({ name, jobNumber }) {
  const PER_PAGE = 100;
  const byNumber = [];
  for (let page = 1; page <= 50; page++) {
    const rows = await arcsiteRequest('GET', `/projects?per_page=${PER_PAGE}&page=${page}`);
    const list = Array.isArray(rows) ? rows : (rows?.projects || []);
    for (const p of list) {
      if (name && p.name === name) return p;
      if (jobNumber && p.job_number === jobNumber) byNumber.push(p);
    }
    if (list.length < PER_PAGE) break;
  }
  byNumber.sort((a, b) =>
    (a.archived ? 1 : 0) - (b.archived ? 1 : 0) ||
    String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return byNumber[0] || null;
}

async function listProjectDrawings(projectId) {
  const data = await arcsiteRequest('GET', `/projects/${projectId}/drawings`);
  return Array.isArray(data) ? data : (data?.drawings || []);
}

async function getDrawing(drawingId) {
  return arcsiteRequest('GET', `/drawings/${drawingId}`);
}

async function downloadFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

module.exports = {
  createOrUpdateProject, findProjectForJob, isNameTakenError,
  listProjectDrawings, getDrawing, downloadFile,
};
