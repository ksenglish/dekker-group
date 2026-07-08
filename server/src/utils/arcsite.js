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

module.exports = { createOrUpdateProject, listProjectDrawings, getDrawing, downloadFile };
