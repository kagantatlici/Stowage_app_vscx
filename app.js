import { buildDefaultTanks, buildT10Tanks, computePlan, computePlanMaxRemaining, computePlanMinTanksAggressive, computePlanSingleWingAlternative } from './engine/stowage.js';

// Simple state
let tanks = buildDefaultTanks();
let parcels = [
  { id: 'P1', name: 'naphtha', total_m3: 42288.300, density_kg_m3: 710, temperature_c: 20, color: '#ef4444' }
];

// UI helpers
const tankEditorEl = document.getElementById('tank-editor');
const parcelEditorEl = document.getElementById('parcel-editor');
const btnCompute = document.getElementById('btn-compute');
// Demo load buttons removed from UI
const btnAddParcel = document.getElementById('btn-add-parcel');
const btnAddCenter = document.getElementById('btn-add-center');
const summaryEl = document.getElementById('summary');
const svgContainer = document.getElementById('svg-container');
const layoutGrid = document.getElementById('layout-grid');
const traceEl = document.getElementById('trace');
const warnsEl = document.getElementById('warnings');
const allocTableEl = document.getElementById('alloc-table');
const parcelTableEl = document.getElementById('parcel-table');
const cfgNameInput = document.getElementById('cfg-name');
const cfgSelect = document.getElementById('cfg-select');
const btnSaveCfg = document.getElementById('btn-save-cfg');
const btnLoadCfg = document.getElementById('btn-load-cfg');
const btnDelCfg = document.getElementById('btn-del-cfg');
const btnExportJson = document.getElementById('btn-export-json');
const variantSelect = document.getElementById('plan-variant');

// Local storage helpers for configs and last state
const LS_PRESETS = 'stowage_presets_v1';
const LS_LAST = 'stowage_last_v1';

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(LS_PRESETS) || '{}'); } catch { return {}; }
}
function savePresets(p) {
  localStorage.setItem(LS_PRESETS, JSON.stringify(p));
}
function refreshPresetSelect() {
  const presets = loadPresets();
  const names = Object.keys(presets).sort((a,b)=>a.localeCompare(b));
  cfgSelect.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
}
function persistLastState() {
  localStorage.setItem(LS_LAST, JSON.stringify({ tanks, parcels }));
}
function restoreLastState() {
  try {
    const raw = localStorage.getItem(LS_LAST);
    if (!raw) return;
    const { tanks: t, parcels: p } = JSON.parse(raw);
    if (Array.isArray(t) && Array.isArray(p)) {
      tanks = t;
      parcels = p;
    }
  } catch {}
}

function renderTankEditor() {
  const rows = tanks.map((t, idx) => {
    return `<tr>
      <td><input value="${t.id}" data-idx="${idx}" data-field="id" style="width:90px"/></td>
      <td>
        <select data-idx="${idx}" data-field="side">
          <option value="port" ${t.side==='port'?'selected':''}>port</option>
          <option value="starboard" ${t.side==='starboard'?'selected':''}>starboard</option>
          <option value="center" ${t.side==='center'?'selected':''}>center</option>
        </select>
      </td>
      <td><input type="number" step="1" min="0" value="${t.volume_m3}" data-idx="${idx}" data-field="volume_m3" style="width:90px"/></td>
      <td><input type="number" step="1" min="0" max="100" value="${Math.round((t.min_pct||0)*100)}" data-idx="${idx}" data-field="min_pct_pct" style="width:70px"/></td>
      <td><input type="number" step="1" min="0" max="100" value="${Math.round((t.max_pct||0)*100)}" data-idx="${idx}" data-field="max_pct_pct" style="width:70px"/></td>
      <td><input type="checkbox" ${t.included?'checked':''} data-idx="${idx}" data-field="included"/></td>
      <td class="row-controls"><button data-act="del-tank" data-idx="${idx}">Delete</button></td>
    </tr>`;
  }).join('');
  tankEditorEl.innerHTML = `
    <table>
      <thead>
        <tr><th>Tank ID</th><th>Side</th><th>Volume (m³)</th><th>Min %</th><th>Max %</th><th>Incl.</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  tankEditorEl.querySelectorAll('input,select').forEach(el => {
    el.addEventListener('change', (e) => {
      const target = e.target;
      const idx = Number(target.getAttribute('data-idx'));
      let field = target.getAttribute('data-field');
      let val = target.type === 'checkbox' ? target.checked : target.value;
      if (field === 'volume_m3') val = Number(val);
      if (field === 'min_pct_pct') { field = 'min_pct'; val = Math.max(0, Math.min(100, Number(val)))/100; }
      if (field === 'max_pct_pct') { field = 'max_pct'; val = Math.max(0, Math.min(100, Number(val)))/100; }
      tanks[idx] = { ...tanks[idx], [field]: field==='included' ? (target.checked) : val };
      persistLastState();
      render();
    });
  });
  tankEditorEl.querySelectorAll('button[data-act="del-tank"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = Number(btn.getAttribute('data-idx'));
      tanks.splice(idx, 1);
      persistLastState();
      render();
    });
  });
}

function renderParcelEditor() {
  const rows = parcels.map((p, idx) => {
    return `<tr>
      <td><input value="${p.id}" data-idx="${idx}" data-field="id" style="width:70px"/></td>
      <td><input value="${p.name}" data-idx="${idx}" data-field="name" style="width:120px"/></td>
      <td><input type="number" step="1" min="0" value="${p.total_m3 ?? ''}" data-idx="${idx}" data-field="total_m3" style="width:90px" ${p.fill_remaining? 'disabled':''}/></td>
      <td><input type="checkbox" ${p.fill_remaining?'checked':''} data-idx="${idx}" data-field="fill_remaining" ${idx===parcels.length-1 ? '' : 'disabled'}/></td>
      <td><input type="number" step="0.001" min="0" value="${((p.density_kg_m3||0)/1000).toFixed(3)}" data-idx="${idx}" data-field="density_g_cm3" style="width:80px"/></td>
      <td><input type="number" step="1" value="${p.temperature_c}" data-idx="${idx}" data-field="temperature_c" style="width:70px"/></td>
      <td><input type="color" value="${p.color || '#888888'}" data-idx="${idx}" data-field="color"/></td>
      <td class="row-controls"><button data-act="del-parcel" data-idx="${idx}">Delete</button></td>
    </tr>`;
  }).join('');
  parcelEditorEl.innerHTML = `
    <table>
      <thead>
        <tr><th>Parcel No.</th><th>Name</th><th>Total (m³)</th><th>Fill Remaining</th><th>Density (g/cm³)</th><th>T (°C)</th><th>Color</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  parcelEditorEl.querySelectorAll('input').forEach(el => {
    el.addEventListener('change', (e) => {
      const target = e.target;
      const idx = Number(target.getAttribute('data-idx'));
      const field = target.getAttribute('data-field');
      let val = target.type === 'checkbox' ? target.checked : target.value;
      if (field === 'temperature_c') val = Number(val);
      if (field === 'density_g_cm3') {
        // accept comma decimals and convert g/cm3 to kg/m3
        const txt = String(val).replace(',', '.');
        const gcm3 = Number(txt);
        val = isNaN(gcm3) ? parcels[idx].density_kg_m3 : gcm3 * 1000;
      }
      if (field === 'total_m3') val = val === '' ? undefined : Number(val);
      // Ensure unique parcel IDs; auto-adjust duplicates
      if (field === 'id') {
        let base = String(val).trim() || `P${idx+1}`;
        let unique = base;
        let n = 2;
        while (parcels.some((p, i) => i !== idx && p.id === unique)) {
          unique = `${base}_${n++}`;
        }
        if (unique !== val) {
          val = unique;
          target.value = unique;
        }
      }
      // Ensure only last parcel can be fill_remaining
      if (field === 'fill_remaining' && val === true && idx !== parcels.length - 1) return;
      const mappedField = field === 'density_g_cm3' ? 'density_kg_m3' : field;
      parcels[idx] = { ...parcels[idx], [mappedField]: val };
      // If fill_remaining is toggled true, clear total_m3
      if (field === 'fill_remaining') {
        if (val) parcels[idx].total_m3 = undefined;
      }
      persistLastState();
      render();
    });
  });
  parcelEditorEl.querySelectorAll('button[data-act="del-parcel"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-idx'));
      parcels.splice(idx, 1);
      // Ensure last parcel has fill_remaining enabled state preserved only if it was last
      if (parcels.length > 0) {
        parcels = parcels.map((p, i) => i === parcels.length - 1 ? p : { ...p, fill_remaining: false });
      }
      persistLastState();
      render();
    });
  });
}

function liters(n) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

function renderSummaryAndSvg(result) {
  if (summaryEl) summaryEl.innerHTML = '';
  if (svgContainer) svgContainer.innerHTML = '';
  if (layoutGrid) layoutGrid.innerHTML = '';
  if (warnsEl) warnsEl.textContent = '';
  if (traceEl) traceEl.innerHTML = '';
  if (allocTableEl) allocTableEl.innerHTML = '';
  if (parcelTableEl) parcelTableEl.innerHTML = '';
  let allocations = [];
  let diagnostics = null;
  let reasoningTrace = [];
  if (result) {
    allocations = result.allocations || [];
    diagnostics = result.diagnostics || null;
    const { port_weight_mt, starboard_weight_mt, imbalance_pct, balance_status, warnings, errors } = diagnostics || {};
    if (diagnostics) {
      reasoningTrace = diagnostics.reasoning_trace || [];
      const dir = (port_weight_mt||0) > (starboard_weight_mt||0) ? 'port' : ((port_weight_mt||0) < (starboard_weight_mt||0) ? 'starboard' : 'even');
      const warnLine = balance_status === 'Balanced'
        ? 'Balanced'
        : `Warning imbalance ${(imbalance_pct||0).toFixed(2)}%${dir==='even'?'':` (list to ${dir})`}`;
      if (summaryEl) summaryEl.innerHTML = `
        <div class="summary-bar" style="display:flex; flex-direction:column; gap:6px;">
          <div>Port <b>${(port_weight_mt||0).toFixed(2)}</b> MT</div>
          <div>${warnLine}</div>
          <div>Starboard <b>${(starboard_weight_mt||0).toFixed(2)}</b> MT</div>
        </div>
      `;
      const warnLines = [];
      (warnings || []).forEach(w => {
        if (!/Reserved small-tank buffer pairs/.test(w)) warnLines.push('• ' + w);
      });
      (diagnostics.errors || []).forEach(w => warnLines.push('✖ ' + w));
      if (warnsEl) warnsEl.textContent = warnLines.join('\n');
    }
  }

  // Larger, card-like ship layout (HTML/CSS)
  const includedTanks = tanks.filter(t => t.included);
  const pairMap = {};
  includedTanks.forEach(t => {
    const m = /COT(\d+)/.exec(t.id);
    const idx = m ? Number(m[1]) : 0;
    if (!pairMap[idx]) pairMap[idx] = { port: null, starboard: null, centers: [] };
    if (t.side === 'port') pairMap[idx].port = t;
    else if (t.side === 'starboard') pairMap[idx].starboard = t;
    else if (t.side === 'center') pairMap[idx].centers.push(t);
  });
  const pairIndices = Object.keys(pairMap).map(n => Number(n)).sort((a,b)=>a-b);

  const byTank = Object.create(null);
  allocations.forEach(a => { byTank[a.tank_id] = a; });

  const ship = document.createElement('div');
  ship.className = 'ship';
  ship.innerHTML = `
    <div class="bow"><div class="triangle"></div></div>
    <div class="hull" id="hull"></div>
    <div class="stern"></div>
  `;
  const hull = ship.querySelector('#hull');
  pairIndices.forEach(idx => {
    const row = document.createElement('div');
    row.className = 'tank-row';
    const hasCenter = pairMap[idx].centers && pairMap[idx].centers.length > 0;
    const port = pairMap[idx].port;
    const star = pairMap[idx].starboard;
    const centerOnly = hasCenter && !port && !star;
    if (centerOnly) {
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '1fr';
    } else if (hasCenter) {
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '1fr 1fr 1fr';
      row.style.gap = '0px';
    }
    // Port cell
    if (port && !centerOnly) {
      const cellP = document.createElement('div');
      cellP.className = 'tank-cell';
      const a = byTank[port.id];
      const parcel = a ? parcels.find(p=>p.id===a.parcel_id) : null;
      if (parcel) cellP.style.background = '#0f1a3a';
      cellP.innerHTML = `
        <div class="id">${port.id}</div>
        ${a ? `
          <div class="meta">${parcel?.name || a.parcel_id}</div>
          <div class="meta">Vol: ${a.assigned_m3.toFixed(0)} m³</div>
          <div class="meta">Fill: ${(a.fill_pct*100).toFixed(1)}%</div>
          <div class="fillbar"><div style="height:${(a.fill_pct*100).toFixed(1)}%; background:${parcel?.color || '#3b82f6'}"></div></div>
        ` : `
          <div class="empty-hint">Cargo</div>
          <div class="empty-hint">Volume</div>
          <div class="empty-hint">%</div>
        `}
      `;
      if (parcel) cellP.style.boxShadow = `inset 0 0 0 9999px ${parcel.color}18`;
      row.appendChild(cellP);
    }
    // Center cell(s) if any
    if (hasCenter) {
      const centers = pairMap[idx].centers.sort((a,b)=>a.id.localeCompare(b.id));
      const cellC = document.createElement('div');
      cellC.className = 'tank-cell';
      if (centerOnly) {
        cellC.style.gridColumn = '1 / span 1';
        // Single full-width center: render like a side cell and color the full cell
        const ct = centers[0];
        const a = byTank[ct.id];
        const parcel = a ? parcels.find(p=>p.id===a.parcel_id) : null;
        cellC.innerHTML = `
          <div class="id">${ct.id}</div>
          ${a ? `
            <div class="meta">${parcel?.name || a.parcel_id}</div>
            <div class="meta">Vol: ${a.assigned_m3.toFixed(0)} m³</div>
            <div class="meta">Fill: ${(a.fill_pct*100).toFixed(1)}%</div>
            <div class="fillbar"><div style="height:${(a.fill_pct*100).toFixed(1)}%; background:${parcel?.color || '#3b82f6'}"></div></div>
          ` : `
            <div class="empty-hint">Cargo</div>
            <div class="empty-hint">Volume</div>
            <div class="empty-hint">%</div>
          `}
        `;
        if (a) {
          cellC.style.background = '#0f1a3a';
          if (parcel?.color) cellC.style.boxShadow = `inset 0 0 0 9999px ${parcel.color}18`;
        }
      } else {
        centers.forEach((ct, i) => {
          const a = byTank[ct.id];
          const parcel = a ? parcels.find(p=>p.id===a.parcel_id) : null;
          const block = document.createElement('div');
          block.className = 'tank-cell';
          block.style.minHeight = '100px';
          block.style.marginBottom = i < centers.length-1 ? '6px' : '0';
          block.innerHTML = `
            <div class="id">${ct.id}</div>
            ${a ? `
              <div class="meta">${parcel?.name || a.parcel_id}</div>
              <div class="meta">Vol: ${a.assigned_m3.toFixed(0)} m³</div>
              <div class="meta">Fill: ${(a.fill_pct*100).toFixed(1)}%</div>
              <div class="fillbar"><div style="height:${(a.fill_pct*100).toFixed(1)}%; background:${parcel?.color || '#3b82f6'}"></div></div>
            ` : `
              <div class="empty-hint">Cargo</div>
              <div class="empty-hint">Volume</div>
              <div class="empty-hint">%</div>
            `}
          `;
          if (a) {
            block.style.background = '#0f1a3a';
            if (parcel?.color) block.style.boxShadow = `inset 0 0 0 9999px ${parcel.color}18`;
          }
          cellC.appendChild(block);
        });
      }
      row.appendChild(cellC);
    }
    // Starboard cell
    if (star && !centerOnly) {
      const cellS = document.createElement('div');
      cellS.className = 'tank-cell';
      const a = byTank[star.id];
      const parcel = a ? parcels.find(p=>p.id===a.parcel_id) : null;
      cellS.innerHTML = `
        <div class="id">${star.id}</div>
        ${a ? `
          <div class="meta">${parcel?.name || a.parcel_id}</div>
          <div class="meta">Vol: ${a.assigned_m3.toFixed(0)} m³</div>
          <div class="meta">Fill: ${(a.fill_pct*100).toFixed(1)}%</div>
          <div class="fillbar"><div style="height:${(a.fill_pct*100).toFixed(1)}%; background:${parcel?.color || '#3b82f6'}"></div></div>
        ` : `
          <div class="empty-hint">Cargo</div>
          <div class="empty-hint">Volume</div>
          <div class="empty-hint">%</div>
        `}
      `;
      if (parcel) cellS.style.boxShadow = `inset 0 0 0 9999px ${parcel.color}18`;
      row.appendChild(cellS);
    }
    hull.appendChild(row);
  });
  const wrap = document.createElement('div');
  wrap.appendChild(ship);
  if (layoutGrid) layoutGrid.appendChild(wrap);

  // Legend with per-parcel totals
  const legend = document.createElement('div');
  legend.className = 'legend';
  parcels.forEach(p => {
    // calc totals actually assigned (not requested)
    const assignedVol = allocations.filter(a => a.parcel_id === p.id).reduce((s,a)=>s+a.assigned_m3,0);
    const assignedWt = allocations.filter(a => a.parcel_id === p.id).reduce((s,a)=>s+a.weight_mt,0);
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="sw" style="background:${p.color || '#888'}"></div>
      <div>
        <div style="font-size:13px; font-weight:600;">${p.name} (${p.id})</div>
        <div class="meta">${assignedVol.toFixed(0)} m³ | ${assignedWt.toFixed(1)} MT</div>
      </div>
    `;
    legend.appendChild(item);
  });
  // Insert summary above legend for vertical alignment with parcel list
  if (layoutGrid && summaryEl) layoutGrid.appendChild(summaryEl);
  if (layoutGrid) layoutGrid.appendChild(legend);

  // Only render tables when allocations exist (after compute)
  if (allocations.length > 0) {
    // Capacity metrics (no commingling): remaining usable = sum Cmax of unused tanks
    const used = new Set(allocations.map(a => a.tank_id));
    let cmaxUsed = 0, cmaxFree = 0, assignedUsed = 0;
    includedTanks.forEach(t => {
      const cmax = t.volume_m3 * t.max_pct;
      if (used.has(t.id)) cmaxUsed += cmax; else cmaxFree += cmax;
    });
    allocations.forEach(a => { assignedUsed += a.assigned_m3; });
    const deadSpace = Math.max(0, cmaxUsed - assignedUsed);
    // Free symmetric pair capacity
    let freePairCap = 0;
    Object.keys(pairMap).forEach(k => {
      const pr = pairMap[k];
      if (pr.port && pr.starboard && !used.has(pr.port.id) && !used.has(pr.starboard.id)) {
        freePairCap += pr.port.volume_m3 * pr.port.max_pct + pr.starboard.volume_m3 * pr.starboard.max_pct;
      }
    });
    const capDiv = document.createElement('div');
    capDiv.className = 'capacity-bar';
    capDiv.innerHTML = `
      <div class="cap-item"><span>Remaining Capacity</span><b>${cmaxFree.toFixed(0)} m³</b></div>
      <div class="cap-item"><span>Unusable</span><b>${deadSpace.toFixed(0)} m³</b></div>
    `;
    if (summaryEl) summaryEl.appendChild(capDiv);

    // Allocations table
    const totalVol = allocations.reduce((s,a)=>s+a.assigned_m3,0);
    const totalWt = allocations.reduce((s,a)=>s+a.weight_mt,0);
    const rows = allocations.map(a => {
      const tank = includedTanks.find(t => t.id === a.tank_id);
      const parcel = parcels.find(p => p.id === a.parcel_id);
      return `<tr>
        <td>${a.tank_id}</td>
        <td>${tank?.side || ''}</td>
        <td>${parcel?.name || a.parcel_id}</td>
        <td style="text-align:right;">${a.assigned_m3.toFixed(0)}</td>
        <td style="text-align:right;">${(a.fill_pct*100).toFixed(1)}%</td>
        <td style="text-align:right;">${a.weight_mt.toFixed(1)}</td>
      </tr>`;
    }).join('');
    if (allocTableEl) allocTableEl.innerHTML = `
      <table class="table">
        <thead><tr><th>Tank</th><th>Side</th><th>Parcel</th><th style="text-align:right;">Vol (m³)</th><th style="text-align:right;">Fill %</th><th style="text-align:right;">Weight (MT)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">Totals</td><td style="text-align:right;">${totalVol.toFixed(0)}</td><td></td><td style="text-align:right;">${totalWt.toFixed(1)}</td></tr></tfoot>
      </table>
    `;

    // Parcels summary table
    const parcelRows = parcels.map(p => {
      const vol = allocations.filter(a => a.parcel_id === p.id).reduce((s,a)=>s+a.assigned_m3,0);
      const wt = allocations.filter(a => a.parcel_id === p.id).reduce((s,a)=>s+a.weight_mt,0);
      return `<tr>
        <td><span class="sw" style="display:inline-block; vertical-align:middle; margin-right:6px; background:${p.color || '#888'}"></span>${p.name}</td>
        <td>${p.id}</td>
        <td style="text-align:right;">${p.density_kg_m3}</td>
        <td style="text-align:right;">${vol.toFixed(0)}</td>
        <td style="text-align:right;">${wt.toFixed(1)}</td>
      </tr>`;
    }).join('');
    const parcelTotalVol = allocations.reduce((s,a)=>s+a.assigned_m3,0);
    const parcelTotalWt = allocations.reduce((s,a)=>s+a.weight_mt,0);
  if (parcelTableEl) parcelTableEl.innerHTML = `
      <table class="table">
        <thead><tr><th>Parcel</th><th>ID</th><th style="text-align:right;">ρ (kg/m³)</th><th style="text-align:right;">Assigned Vol (m³)</th><th style="text-align:right;">Weight (MT)</th></tr></thead>
        <tbody>${parcelRows}</tbody>
        <tfoot><tr><td colspan="3">Totals</td><td style="text-align:right;">${parcelTotalVol.toFixed(0)}</td><td style="text-align:right;">${parcelTotalWt.toFixed(1)}</td></tr></tfoot>
      </table>
    `;
  }

  // trace
  // Reasoning trace hidden in UI
}

let variantsCache = null;
let selectedVariantKey = 'min_k';

function computeVariants() {
  ensureUniqueParcelIDs();
  const vMin = computePlan(tanks, parcels);
  const vMax = computePlanMaxRemaining(tanks, parcels);
  const vAgg = computePlanMinTanksAggressive(tanks, parcels);
  const vWing = computePlanSingleWingAlternative(tanks, parcels);
  return {
    min_k: { id: 'Min Tanks', res: vMin },
    max_remaining: { id: 'Max Remaining', res: vMax },
    min_k_aggressive: { id: 'Min Tanks (Aggressive)', res: vAgg },
    single_wing: { id: 'Single-Wing (Ballast)', res: vWing }
  };
}

function fillVariantSelect() {
  if (!variantSelect) return;
  function planSig(res) {
    return res.allocations.map(a => `${a.tank_id}:${a.parcel_id}:${a.assigned_m3.toFixed(3)}`).sort().join('|');
  }
  function tankCount(res) {
    return new Set(res.allocations.map(a => a.tank_id)).size;
  }
  const order = ['min_k','single_wing','min_k_aggressive','max_remaining'];
  const seen = new Map();
  const entries = [];
  for (const key of order) {
    const v = variantsCache[key];
    const sig = planSig(v.res);
    if (seen.has(sig)) continue; // skip identical plan
    seen.set(sig, key);
    entries.push({ key, tanks: tankCount(v.res) });
  }
  const minTanks = Math.min(...entries.map(e => e.tanks));
  const opts = [];
  let minAssigned = false;
  for (const e of entries) {
    let label;
    if (e.tanks === minTanks && !minAssigned) {
      label = `Minimum Tanks (${e.tanks} tanks)`;
      minAssigned = true;
    } else if (e.key === 'max_remaining') {
      label = `Maximum Remaining (${e.tanks} tanks)`;
    } else if (e.tanks === minTanks && minAssigned) {
      label = `Alternative (${e.tanks} tanks)`;
    } else {
      label = `Alternative (${e.tanks} tanks)`;
    }
    opts.push({ key: e.key, label });
  }
  if (!opts.find(o => o.key === selectedVariantKey)) selectedVariantKey = opts[0]?.key || 'min_k';
  variantSelect.innerHTML = opts.map(o => `<option value="${o.key}" ${o.key===selectedVariantKey?'selected':''}>${o.label}</option>`).join('');
}

function computeAndRender() {
  variantsCache = computeVariants();
  fillVariantSelect();
  const v = variantsCache[selectedVariantKey] || variantsCache['min_k'];
  persistLastState();
  renderSummaryAndSvg(v.res);
}

function ensureUniqueParcelIDs() {
  const seen = new Set();
  parcels = parcels.map((p, idx) => {
    let base = String(p.id || `P${idx+1}`).trim();
    if (!base) base = `P${idx+1}`;
    let unique = base;
    let n = 2;
    while (seen.has(unique)) unique = `${base}_${n++}`;
    seen.add(unique);
    return { ...p, id: unique };
  });
}

// No alternative panel; variants selectable via the Plan Options dropdown

function render() {
  renderTankEditor();
  renderParcelEditor();
  // Live layout preview based on current tank config
  renderSummaryAndSvg(null);
}

btnCompute.addEventListener('click', computeAndRender);
if (variantSelect) {
  variantSelect.addEventListener('change', () => {
    selectedVariantKey = variantSelect.value;
    if (!variantsCache) variantsCache = computeVariants();
    const v = variantsCache[selectedVariantKey] || variantsCache['min_k'];
    renderSummaryAndSvg(v.res);
  });
}
// Demo handlers removed
btnAddParcel.addEventListener('click', () => {
  // Ensure only the last parcel can be fill_remaining
  parcels = parcels.map((p, i) => i === parcels.length - 1 ? p : { ...p, fill_remaining: false });
  const idx = parcels.length + 1;
  parcels.push({ id: `P${idx}`, name: `Parcel ${idx}`, total_m3: 0, density_kg_m3: 800, temperature_c: 20, color: '#a855f7' });
  persistLastState();
  render();
});
btnAddCenter.addEventListener('click', () => {
  // Add a center tank with next index number
  const ids = tanks.map(t => t.id);
  let maxIdx = 0;
  ids.forEach(id => { const m = /COT(\d+)/.exec(id); if (m) maxIdx = Math.max(maxIdx, Number(m[1])); });
  const next = maxIdx > 0 ? maxIdx : 1;
  tanks.push({ id: `COT${next}C`, volume_m3: 1000, min_pct: 0.5, max_pct: 0.98, included: true, side: 'center' });
  persistLastState();
  render();
});

// Initial render
restoreLastState();
refreshPresetSelect();
render();

// Config preset actions
btnSaveCfg.addEventListener('click', () => {
  const name = (cfgNameInput.value || '').trim();
  if (!name) { alert('Enter a config name'); return; }
  const presets = loadPresets();
  if (presets[name] && !confirm('Overwrite existing config?')) return;
  // Only save tanks (exclude ephemeral fields)
  const clean = tanks.map(t => ({ id: t.id, volume_m3: t.volume_m3, min_pct: t.min_pct, max_pct: t.max_pct, included: t.included, side: t.side }));
  presets[name] = clean;
  savePresets(presets);
  refreshPresetSelect();
  cfgSelect.value = name;
  // remember the name in the input for clarity
  cfgNameInput.value = name;
});
btnLoadCfg.addEventListener('click', () => {
  const name = cfgSelect.value;
  if (!name) return;
  const presets = loadPresets();
  const conf = presets[name];
  if (!Array.isArray(conf)) return;
  tanks = conf.map(t => ({ ...t }));
  persistLastState();
  render();
});
btnDelCfg.addEventListener('click', () => {
  const name = cfgSelect.value;
  if (!name) return;
  if (!confirm(`Delete config '${name}'?`)) return;
  const presets = loadPresets();
  delete presets[name];
  savePresets(presets);
  refreshPresetSelect();
});

// Export current scenario (tanks + parcels + computed plan)
btnExportJson.addEventListener('click', async () => {
  const data = { tanks, parcels, result: computePlan(tanks, parcels) };
  const text = JSON.stringify(data, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    alert('Copied plan JSON to clipboard. Paste it here.');
  } catch (e) {
    console.log(text);
    alert('Could not copy automatically. JSON printed to console.');
  }
});

// Expose small debug API for console usage
window.stowage = {
  getState: () => ({ tanks, parcels }),
  compute: () => computePlan(tanks, parcels),
  export: () => JSON.stringify({ tanks, parcels, result: computePlan(tanks, parcels) }, null, 2)
};

// expose engine variants
window.stowageEngine = { computePlanMaxRemaining, computePlanMinTanksAggressive };
