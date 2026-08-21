// SmartVent sizing, as used by the Sales Presenter's positive pressure
// calculator.
//
// This mirrors PP_TABLE in client/src/pages/presenter/SalesPresenter.jsx — the
// presenter keeps its own copy because it runs in the browser. If a model or a
// band changes, change it in BOTH places.
//
// `family` splits the systems the way the website presents them: positive
// pressure pushes filtered air in from the roof space, balanced pressure
// brings air in and takes stale air out through a heat exchanger.
const SMARTVENT_TABLE = [
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 1,    houseMax: 100,  outlets: 1,   model: 'SV01L+' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 1,    houseMax: 100,  outlets: 2,   model: 'SV02L+' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 1,    houseMax: 100,  outlets: 3,   model: 'SV02L+ with 1 Extension Kit' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 101,  houseMax: 280,  outlets: 4,   model: 'SV04L+' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 101,  houseMax: 280,  outlets: 5,   model: 'SV04L+ with 1 Extension Kit' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 101,  houseMax: 280,  outlets: 6,   model: 'SV04L+ with 2 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 281,  houseMax: 560,  outlets: 6,   model: 'SV06L+' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 281,  houseMax: 560,  outlets: 7,   model: 'SV06L+ with 1 Extension Kit' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 281,  houseMax: 560,  outlets: 8,   model: 'SV06L+ with 2 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 281,  houseMax: 560,  outlets: 9,   model: 'SV06L+ with 3 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 281,  houseMax: 560,  outlets: 10,  model: 'SV06L+ with 4 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 281,  houseMax: 560,  outlets: 11,  model: 'SV06L+ with 5 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Lite+',                 houseMin: 281,  houseMax: 560,  outlets: 12,  model: 'SV06L+ with 6 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 1,    houseMax: 100,  outlets: 1,   model: 'SV01P3' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 1,    houseMax: 100,  outlets: 2,   model: 'SV02P3' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 1,    houseMax: 100,  outlets: 3,   model: 'SV02P3 with 1 Extension Kit' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 101,  houseMax: 280,  outlets: 4,   model: 'SV04P3' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 101,  houseMax: 280,  outlets: 5,   model: 'SV04P3 with 1 Extension Kit' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 101,  houseMax: 280,  outlets: 6,   model: 'SV04P3 with 2 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 281,  houseMax: 560,  outlets: 6,   model: 'SV06P3' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 281,  houseMax: 560,  outlets: 7,   model: 'SV06P3 with 1 Extension Kit' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 281,  houseMax: 560,  outlets: 8,   model: 'SV06P3 with 2 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 281,  houseMax: 560,  outlets: 9,   model: 'SV06P3 with 3 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 281,  houseMax: 560,  outlets: 10,  model: 'SV06P3 with 4 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 281,  houseMax: 560,  outlets: 11,  model: 'SV06P3 with 5 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive3',             houseMin: 281,  houseMax: 560,  outlets: 12,  model: 'SV06P3 with 6 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 1,    houseMax: 100,  outlets: 2,   model: 'SV02AD' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 1,    houseMax: 100,  outlets: 3,   model: 'SV02AD with 1 Extension Kit' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 101,  houseMax: 280,  outlets: 4,   model: 'SV04AD' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 101,  houseMax: 280,  outlets: 5,   model: 'SV04AD with 1 Extension Kit' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 101,  houseMax: 280,  outlets: 6,   model: 'SV04AD with 2 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 281,  houseMax: 560,  outlets: 6,   model: 'SV06AD' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 281,  houseMax: 560,  outlets: 7,   model: 'SV06AD with 1 Extension Kit' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 281,  houseMax: 560,  outlets: 8,   model: 'SV06AD with 2 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 281,  houseMax: 560,  outlets: 9,   model: 'SV06AD with 3 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 281,  houseMax: 560,  outlets: 10,  model: 'SV06AD with 4 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 281,  houseMax: 560,  outlets: 11,  model: 'SV06AD with 5 Extension Kits' },
  { family: 'positive',  system: 'SmartVent Positive Advance',      houseMin: 281,  houseMax: 560,  outlets: 12,  model: 'SV06AD with 6 Extension Kits' },
  { family: 'balanced',  system: 'SmartVent Synergy 3',             houseMin: 1,    houseMax: 150,  outlets: 3,   model: 'SYN1015AD' },
  { family: 'balanced',  system: 'SmartVent Synergy 3',             houseMin: 1,    houseMax: 150,  outlets: 4,   model: 'SYN1015AD with 1 Extension Kit' },
  { family: 'balanced',  system: 'SmartVent Synergy 3',             houseMin: 151,  houseMax: 250,  outlets: 3,   model: 'SYN2025AD' },
  { family: 'balanced',  system: 'SmartVent Synergy 3',             houseMin: 151,  houseMax: 250,  outlets: 4,   model: 'SYN2025AD with 1 Extension Kit' },
  { family: 'balanced',  system: 'SmartVent Synergy 3',             houseMin: 151,  houseMax: 250,  outlets: 5,   model: 'SYN2025AD with 2 Extension Kits' },
  { family: 'balanced',  system: 'SmartVent Synergy 3',             houseMin: 251,  houseMax: 350,  outlets: 3,   model: 'SYN3035AD' },
  { family: 'balanced',  system: 'SmartVent Synergy 3',             houseMin: 251,  houseMax: 350,  outlets: 4,   model: 'SYN3035AD with 1 Extension Kit' },
  { family: 'balanced',  system: 'SmartVent Synergy 3',             houseMin: 251,  houseMax: 350,  outlets: 5,   model: 'SYN3035AD with 2 Extension Kits' },
  { family: 'balanced',  system: 'SmartVent Synergy 3',             houseMin: 251,  houseMax: 350,  outlets: 6,   model: 'SYN3035AD with 3 Extension Kits' },
  { family: 'balanced',  system: 'SmartVent Balance',               houseMin: 1,    houseMax: 150,  outlets: 3,   model: 'BAL205' },
  { family: 'balanced',  system: 'SmartVent Balance',               houseMin: 1,    houseMax: 150,  outlets: 4,   model: 'BAL205 with 1 Extension Kit' },
  { family: 'balanced',  system: 'SmartVent Balance',               houseMin: 1,    houseMax: 150,  outlets: 5,   model: 'BAL205 with 2 Extension Kit' },
  { family: 'balanced',  system: 'SmartVent Balance',               houseMin: 151,  houseMax: 250,  outlets: 5,   model: 'BAL405' },
  { family: 'balanced',  system: 'SmartVent Balance',               houseMin: 151,  houseMax: 250,  outlets: 6,   model: 'BAL405 with 1 Extension Kit' },
];

const FAMILIES = {
  positive: { slug: 'positive-pressure', label: 'Positive pressure' },
  balanced: { slug: 'balanced-pressure', label: 'Balanced pressure' },
};

const systemsIn = family => [...new Set(SMARTVENT_TABLE.filter(r => r.family === family).map(r => r.system))];

// House size and outlet count pick a model. An exact band match wins; failing
// that an outlet-only match is offered, which is what the presenter does when a
// house is outside the size bands but the outlet count still says something.
function findModel({ family, system, houseSize, outlets }) {
  let rows = SMARTVENT_TABLE;
  if (family) rows = rows.filter(r => r.family === family);
  if (system) rows = rows.filter(r => r.system === system);
  if (!(outlets > 0)) return null;

  const exact = houseSize > 0
    ? rows.find(r => houseSize >= r.houseMin && houseSize <= r.houseMax && r.outlets === outlets)
    : null;
  return exact || rows.find(r => r.outlets === outlets) || null;
}

const maxHouseSize = family =>
  Math.max(...SMARTVENT_TABLE.filter(r => !family || r.family === family).map(r => r.houseMax));

module.exports = { SMARTVENT_TABLE, FAMILIES, systemsIn, findModel, maxHouseSize };
