// Display a job's reference number consistently across the app.
// Imported Tradify jobs keep their original number (e.g. "JB00885");
// jobs created in the app are shown as "JB#####" from the internal sequence.
export function formatJobNumber(job) {
  if (!job) return '';
  if (job.external_ref) return job.external_ref;
  if (job.job_number != null && job.job_number !== '') {
    return 'JB' + String(job.job_number).padStart(5, '0');
  }
  return '';
}
