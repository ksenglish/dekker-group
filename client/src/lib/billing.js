// An entry only counts as billable if it has a job attached AND its billing
// rate (when one's set) actually charges — e.g. Travel is often logged at
// $0/hr against a job, so it shouldn't count as billable hours.
export function isBillable(entry, billingRates) {
  if (!entry.job_id) return false;
  if (!entry.billing_rate_id) return true;
  const rate = billingRates.find(r => r.id === entry.billing_rate_id);
  return rate ? parseFloat(rate.rate) > 0 : true;
}
