// Rinnai highwall heat pump sizing bands.
//
// This mirrors RINNAI_HEATPUMP_TABLE in
// client/src/pages/presenter/SalesPresenter.jsx — the Sales Presenter keeps its
// own copy because it runs in the browser. If the bands or models change,
// change them in BOTH places.
//
// Bands are the heating kW each model covers; a recommended capacity picks the
// first band it falls inside.
const RINNAI_HEATPUMP_TABLE = [
  { kwMin: 0,    kwMax: 2.8, model: 'HSNRTX25', description: 'Rinnai 2.5COOL/2.8HEAT WIFI' },
  { kwMin: 2.81, kwMax: 4,   model: 'HSNRTX35', description: 'Rinnai 3.5COOL/4.0HEAT WIFI' },
  { kwMin: 4.01, kwMax: 5.5, model: 'HSNRTX50', description: 'Rinnai 5.0COOL/5.5HEAT WIFI' },
  { kwMin: 5.51, kwMax: 6.5, model: 'HSNRTX60', description: 'Rinnai 6.0COOL/6.5HEAT WIFI' },
  { kwMin: 6.51, kwMax: 7.5, model: 'HSNRTX70', description: 'Rinnai 7.0COOL/7.5HEAT WIFI' },
  { kwMin: 7.51, kwMax: 8.2, model: 'HSNRTX80', description: 'Rinnai 7.65COOL/8.2HEAT WIFI' },
  { kwMin: 8.21, kwMax: 9.5, model: 'HSNRTX90', description: 'Rinnai 9.0COOL/9.5HEAT WIFI' },
];

const HEATPUMP_MAX_KW = RINNAI_HEATPUMP_TABLE[RINNAI_HEATPUMP_TABLE.length - 1].kwMax;

// Multiplier applied to room volume to get required heating kW.
const INSULATION_MULTIPLIERS = { good: 0.05, average: 0.055, poor: 0.06 };

const bandForKw = (kw) =>
  RINNAI_HEATPUMP_TABLE.find(r => kw >= r.kwMin && kw <= r.kwMax) || null;

module.exports = {
  RINNAI_HEATPUMP_TABLE,
  HEATPUMP_MAX_KW,
  INSULATION_MULTIPLIERS,
  bandForKw,
};
