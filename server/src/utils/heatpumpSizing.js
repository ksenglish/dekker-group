// Highwall heat pump sizing bands.
//
// The table itself lives in shared/heatpumpModels.json, read by both this file
// and the Sales Presenter calculator in the browser, so there is one copy to
// update when models change rather than two to keep in step.
//
// Bands are the heating kW each model covers.
const { models: HEATPUMP_MODELS } = require('../../../shared/heatpumpModels.json');

// The public website calculator (GET /api/public/heat-pumps) only offers the
// Rinnai Pro Series 2 range. The shared table now carries Mitsubishi Electric
// as well, but that is the Sales Presenter's to use — adding brands to the
// public site is its own decision, so this keeps exactly what it served before.
//
// The first band starts at 0 rather than the spreadsheet's 0.1, matching what
// the site has always been sent: a room needing under 0.1 kW still gets the
// smallest unit.
const RINNAI_HEATPUMP_TABLE = HEATPUMP_MODELS
  .filter(m => m.brand === 'Rinnai' && m.series === 'Pro Series 2')
  .sort((a, b) => a.kwMax - b.kwMax)
  .map((m, i) => ({
    kwMin: i === 0 ? 0 : m.kwMin,
    kwMax: m.kwMax,
    model: m.model,
    description: m.description,
  }));

const HEATPUMP_MAX_KW = RINNAI_HEATPUMP_TABLE[RINNAI_HEATPUMP_TABLE.length - 1].kwMax;

// Multiplier applied to room volume to get required heating kW.
const INSULATION_MULTIPLIERS = { good: 0.05, average: 0.055, poor: 0.06 };

const bandForKw = (kw) =>
  RINNAI_HEATPUMP_TABLE.find(r => kw >= r.kwMin && kw <= r.kwMax) || null;

module.exports = {
  HEATPUMP_MODELS,
  RINNAI_HEATPUMP_TABLE,
  HEATPUMP_MAX_KW,
  INSULATION_MULTIPLIERS,
  bandForKw,
};
