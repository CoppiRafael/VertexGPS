let P = [];
let S = [];
let G = [];
let T3 = [];
let metrics = null;
let routeMap = null;
let zS = 0;
let zE = 0;
let rawRoutePoints = [];
let autoSectors = [];
let customSectors = [];
let sectorNotes = {};
let currentBriefingId = null;
let pendingBriefingOverrides = null;
let hasLoadedGpx = false;
let activityAnalysis = null;

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function haversine(a, b) {
  const radius = 6371000;
  const toRadians = (value) => value * Math.PI / 180;
  const dLat = toRadians(b.la - a.la);
  const dLon = toRadians(b.lo - a.lo);
  const lat1 = toRadians(a.la);
  const lat2 = toRadians(b.la);
  const part = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(part), Math.sqrt(1 - part));
}

function pointGrade(index) {
  let before = index;
  let after = index;
  while (before > 0 && P[index].d - P[before].d < 35) before -= 1;
  while (after < P.length - 1 && P[after].d - P[index].d < 35) after += 1;
  const distance = P[after].d - P[before].d;
  return distance > 0 ? ((P[after].e - P[before].e) / distance) * 100 : 0;
}

function smoothElevation(points) {
  return points.map((point, index) => {
    let start = index;
    let end = index;
    while (start > 0 && !points[start].breakBefore && point.d - points[start - 1].d <= 25) start -= 1;
    while (end < points.length - 1 && !points[end + 1].breakBefore && points[end + 1].d - point.d <= 25) end += 1;
    const values = points.slice(start, end + 1).map((candidate) => candidate.e);
    return { ...point, e: values.reduce((sum, value) => sum + value, 0) / values.length };
  });
}

function buildAnalysis(rawPoints, fileName) {
  rawRoutePoints = rawPoints.map((point) => ({ la: point.la, lo: point.lo, e: point.e, t: point.t || null, breakBefore: Boolean(point.breakBefore) }));
  const missingElevation = rawPoints.filter((point) => !Number.isFinite(point.e)).length;
  const elevationJumps = rawPoints.slice(1).filter((point, index) => Number.isFinite(point.e) && Number.isFinite(rawPoints[index].e) && Math.abs(point.e - rawPoints[index].e) > 30).length;
  const hasElevation = rawPoints.some((point) => Number.isFinite(point.e));
  const points = rawPoints.map((point) => ({ ...point, e: Number.isFinite(point.e) ? point.e : 0 }));
  let distance = 0;

  points.forEach((point, index) => {
    if (index && !point.breakBefore) distance += haversine(points[index - 1], point);
    point.d = distance;
  });

  P = smoothElevation(points);
  let gain = 0;
  let loss = 0;
  P.forEach((point, index) => {
    if (!index || point.breakBefore) return;
    const delta = point.e - P[index - 1].e;
    if (delta > 0) gain += delta;
    else loss += Math.abs(delta);
  });

  const elevation = P.map((point) => point.e);
  const distanceKm = distance / 1000;
  const maxElevation = Math.max(...elevation);
  const minElevation = Math.min(...elevation);
  const startEndDistance = haversine(P[0], P[P.length - 1]);
  const loopThreshold = Math.max(100, distance * 0.015);

  metrics = {
    fileName,
    pointCount: P.length,
    distance,
    distanceKm,
    gain,
    loss,
    maxElevation,
    minElevation,
    range: maxElevation - minElevation,
    vertical: distanceKm ? gain / distanceKm : 0,
    effort: distanceKm + gain / 100,
    hasElevation,
    startEndDistance,
    isLoop: startEndDistance <= loopThreshold,
    quality: { missingElevation, elevationJumps, hasTime: rawPoints.filter((point) => Number.isFinite(point.t)).length > 1 },
  };

  buildGradients();
  buildSplits();
  buildRouteSectors();
}

function buildGradients() {
  G = [];
  let nextDistance = 0;
  P.forEach((point, index) => {
    if (point.d < nextDistance && index !== P.length - 1) return;
    G.push({ d: point.d / 1000, g: Math.max(-50, Math.min(50, pointGrade(index))), e: point.e });
    nextDistance = point.d + 45;
  });
}

function buildSplits() {
  const count = Math.max(1, Math.ceil(metrics.distanceKm));
  S = Array.from({ length: count }, (_, index) => {
    const start = index * 1000;
    const end = Math.min((index + 1) * 1000, metrics.distance);
    const subset = P.filter((point) => point.d >= start && point.d <= end);
    const section = subset.length ? subset : [P[Math.min(P.length - 1, index)]];
    let gain = 0;
    let loss = 0;
    section.forEach((point, cursor) => {
      if (!cursor || point.breakBefore) return;
      const delta = point.e - section[cursor - 1].e;
      if (delta > 0) gain += delta;
      else loss += Math.abs(delta);
    });
    const grades = G.filter((gradient) => gradient.d * 1000 >= start && gradient.d * 1000 <= end).map((gradient) => gradient.g);
    const distanceInSection = Math.max(1, section.at(-1).d - section[0].d);
    return {
      km: index + 1,
      start,
      end,
      g: Math.round(gain),
      l: Math.round(loss),
      mn: Math.round(Math.min(...section.map((point) => point.e))),
      mx: Math.round(Math.max(...section.map((point) => point.e))),
      ag: ((section.at(-1).e - section[0].e) / distanceInSection) * 100,
      mg: grades.length ? Math.max(...grades) : 0,
      ng: grades.length ? Math.min(...grades) : 0,
    };
  });
  T3 = [...S].sort((a, b) => b.g - a.g).slice(0, Math.min(3, S.length));
}

function buildRouteSectors() {
  const candidates = S.map((split) => {
    const type = split.g >= 45 || (split.ag >= 6 && split.g > split.l) ? 'climb' : split.l >= 45 || (split.ag <= -6 && split.l > split.g) ? 'descent' : null;
    return { ...split, type };
  }).filter((split) => split.type);
  autoSectors = [];
  candidates.forEach((split) => {
    const previous = autoSectors.at(-1);
    if (previous && previous.type === split.type && previous.end === split.start) {
      previous.end = split.end;
      previous.g += split.g;
      previous.l += split.l;
      previous.mn = Math.min(previous.mn, split.mn);
      previous.mx = Math.max(previous.mx, split.mx);
      previous.gradeTotal += split.ag;
      previous.parts += 1;
      previous.peak = previous.type === 'climb' ? Math.max(previous.peak, split.mg) : Math.min(previous.peak, split.ng);
    } else {
      autoSectors.push({ id: `auto-${split.km}`, type: split.type, start: split.start, end: split.end, g: split.g, l: split.l, mn: split.mn, mx: split.mx, gradeTotal: split.ag, parts: 1, peak: split.type === 'climb' ? split.mg : split.ng });
    }
  });
  autoSectors = autoSectors.map((sector) => ({ ...sector, ag: sector.gradeTotal / sector.parts })).filter((sector) => sector.g >= 45 || sector.l >= 45);
}

function formatPace(seconds) {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function suggestedPace(split) {
  return formatPace(Math.max(270, Math.min(900, 365 + split.ag * 8 + split.g * 1.7)));
}

function terrainFor(split) {
  if (split.ag > 10) return 'Subida forte';
  if (split.ag > 4) return 'Subida';
  if (split.ag < -10) return 'Descida íngreme';
  if (split.ag < -4) return 'Descida';
  return 'Plano / ondulado';
}

function gradeColor(grade) {
  if (grade > 15) return '#f85149';
  if (grade > 5) return '#f0883e';
  if (grade > -5) return '#bc8cff';
  if (grade > -10) return '#58a6ff';
  return '#39d4dd';
}

function setHtml(id, value) {
  document.getElementById(id).innerHTML = value;
}

function renderSummary() {
  const unit = (value, label) => `${value}<span class="su">${label}</span>`;
  setHtml('metricDistance', unit(decimal.format(metrics.distanceKm), 'km'));
  setHtml('metricGain', unit(`+${number.format(metrics.gain)}`, 'm'));
  setHtml('metricLoss', unit(`−${number.format(metrics.loss)}`, 'm'));
  setHtml('metricMaxElevation', unit(number.format(metrics.maxElevation), 'm'));
  setHtml('metricEffort', unit(decimal.format(metrics.effort), 'km-e'));
  setHtml('metricVertical', unit(number.format(metrics.vertical), 'm/km'));
  setHtml('extMax', `${number.format(metrics.maxElevation)}<span class="ext-unit"> m</span>`);
  setHtml('extMin', `${number.format(metrics.minElevation)}<span class="ext-unit"> m</span>`);
  setHtml('extRange', `${number.format(metrics.range)}<span class="ext-unit"> m</span>`);
  setHtml('extVertical', `${number.format(metrics.vertical)}<span class="ext-unit"> m D+/km</span>`);

  document.getElementById('routeTitle').textContent = metrics.fileName.replace(/\.gpx$/i, '').replace(/[_-]+/g, ' ').toUpperCase();
  document.getElementById('routeMeta').textContent = `${metrics.fileName} · ${number.format(metrics.pointCount)} pontos GPS processados`;
  document.getElementById('routeType').textContent = metrics.isLoop ? 'Rota circular' : 'Rota linear';
  document.getElementById('elevationStatus').textContent = metrics.hasElevation ? 'Altimetria disponível' : 'Sem elevação no arquivo';
  document.getElementById('mapFooter').innerHTML = `<span>${decimal.format(metrics.distanceKm)} km</span><span>${number.format(metrics.gain)} m D+</span><span>fechamento: ${number.format(metrics.startEndDistance)} m</span>`;

  const mainClimb = T3[0];
  const insights = [
    ['Carga vertical', `${number.format(metrics.vertical)} m de subida por quilômetro.`],
    ['Amplitude altimétrica', `${number.format(metrics.range)} m entre ${number.format(metrics.minElevation)} m e ${number.format(metrics.maxElevation)} m.`],
    ['Geometria da rota', metrics.isLoop ? `A chegada fica a ${number.format(metrics.startEndDistance)} m da largada: circuito.` : `A chegada fica a ${number.format(metrics.startEndDistance)} m da largada: rota linear.`],
    ['Trecho decisivo', mainClimb ? `Km ${mainClimb.km}: +${mainClimb.g} m, média de ${mainClimb.ag.toFixed(1)}%.` : 'Dados insuficientes para destacar um setor.'],
  ];
  document.getElementById('routeInsights').innerHTML = `<div class="side-eye">Leitura rápida</div><div class="side-title">Resumo do desafio</div>${insights.map(([title, description], index) => `<div class="side-item"><div class="si-num">0${index + 1}</div><div class="si-title">${title}</div><div class="si-desc">${description}</div></div>`).join('')}`;
}

function renderTopThree() {
  const container = document.getElementById('top3Grid');
  container.innerHTML = T3.map((split, index) => `<div class="top3-card"><div class="t3-num">0${index + 1}</div><div class="t3-km">Km ${split.km - 1}–${Math.min(split.km, metrics.distanceKm).toFixed(1)}</div><div class="t3-val">+${split.g}<span class="t3-unit"> m</span></div><div class="t3-desc">${terrainFor(split)} · média ${split.ag.toFixed(1)}% · pico ${split.mg.toFixed(1)}%</div></div>`).join('');
}

function renderZoom() {
  const container = document.getElementById('elevationZoom');
  const total = metrics.distanceKm;
  const ranges = [['Completo', 'all']];
  const step = total / 3;
  for (let index = 0; index < 3; index += 1) {
    const start = index * step;
    const end = Math.min(total, (index + 1) * step);
    ranges.push([`Km ${start.toFixed(1)}–${end.toFixed(1)}`, [start, end]]);
  }
  container.innerHTML = '';
  ranges.forEach(([label, range], index) => {
    const button = document.createElement('button');
    button.className = `zbtn${index === 0 ? ' on' : ''}`;
    button.textContent = label;
    button.addEventListener('click', () => setZ(range, button));
    container.appendChild(button);
  });
}

function initMap() {
  if (routeMap) routeMap.remove();
  routeMap = L.map('map', { zoomControl: true, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(routeMap);
  const track = P.map((point) => [point.la, point.lo]);
  L.polyline(track, { color: '#3fb950', weight: 4, opacity: 0.9 }).addTo(routeMap);
  const start = P[0];
  const end = P.at(-1);
  const peak = P.reduce((highest, point) => point.e > highest.e ? point : highest);
  L.circleMarker([start.la, start.lo], { radius: 8, color: '#3fb950', fillColor: '#3fb950', fillOpacity: 1, weight: 2 }).bindPopup(`<b>Início</b><br>${number.format(start.e)} m`).addTo(routeMap);
  L.circleMarker([end.la, end.lo], { radius: 8, color: '#f85149', fillColor: '#f85149', fillOpacity: 1, weight: 2 }).bindPopup(`<b>Fim</b><br>${number.format(end.e)} m`).addTo(routeMap);
  L.circleMarker([peak.la, peak.lo], { radius: 6, color: '#e3b341', fillColor: '#e3b341', fillOpacity: 1, weight: 2 }).bindPopup(`<b>Pico</b><br>${number.format(peak.e)} m`).addTo(routeMap);
  let nextKm = 1;
  P.forEach((point) => {
    if (point.d / 1000 >= nextKm && nextKm < Math.ceil(metrics.distanceKm)) {
      L.circleMarker([point.la, point.lo], { radius: 3, color: '#fff', fillColor: '#fff', fillOpacity: 0.8, weight: 1 }).bindTooltip(`Km ${nextKm}`).addTo(routeMap);
      nextKm += 1;
    }
  });
  routeMap.fitBounds(L.latLngBounds(track).pad(0.06));
}

function analyzeSegment(startKm, endKm) {
  const start = Math.max(0, Math.min(startKm, metrics.distanceKm));
  const end = Math.max(start, Math.min(endKm, metrics.distanceKm));
  const points = P.filter((point) => point.d >= start * 1000 && point.d <= end * 1000);
  if (points.length < 2) return;
  let gain = 0;
  let loss = 0;
  points.forEach((point, index) => {
    if (!index || point.breakBefore) return;
    const delta = point.e - points[index - 1].e;
    if (delta > 0) gain += delta;
    else loss += Math.abs(delta);
  });
  const grades = G.filter((gradient) => gradient.d >= start && gradient.d <= end).map((gradient) => gradient.g);
  const distance = Math.max(.01, end - start);
  const averageGrade = (points.at(-1).e - points[0].e) / (distance * 1000) * 100;
  const maxGrade = grades.length ? Math.max(...grades) : 0;
  const minGrade = grades.length ? Math.min(...grades) : 0;
  const peakGrade = Math.abs(maxGrade) > Math.abs(minGrade) ? maxGrade : minGrade;
  document.getElementById('segmentResult').innerHTML = `<div class="segment-metric"><span>Distância</span><strong>${distance.toFixed(2)} km</strong></div><div class="segment-metric"><span>Ganho</span><strong class="up">+${number.format(gain)} m</strong></div><div class="segment-metric"><span>Perda</span><strong class="dn">−${number.format(loss)} m</strong></div><div class="segment-metric"><span>Altitude</span><strong>${number.format(Math.min(...points.map((point) => point.e)))}–${number.format(Math.max(...points.map((point) => point.e)))} m</strong></div><div class="segment-metric"><span>Grade média</span><strong style="color:${gradeColor(averageGrade)}">${averageGrade >= 0 ? '+' : ''}${averageGrade.toFixed(1)}%</strong></div><div class="segment-metric"><span>Maior variação</span><strong style="color:${gradeColor(peakGrade)}">${peakGrade >= 0 ? '+' : ''}${peakGrade.toFixed(1)}%</strong></div>`;
  setZ([start, end], null);
}

function renderAutomaticSplits() {
  const container = document.getElementById('autoSplits');
  container.innerHTML = '';
  S.forEach((split) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'auto-split';
    card.innerHTML = `<strong>Km ${split.km}</strong><span>+${split.g} m · −${split.l} m</span><small>${split.ag >= 0 ? '+' : ''}${split.ag.toFixed(1)}% médio</small>`;
    card.addEventListener('click', () => {
      document.getElementById('segmentStart').value = (split.start / 1000).toFixed(2);
      document.getElementById('segmentEnd').value = (split.end / 1000).toFixed(2);
      analyzeSegment(split.start / 1000, split.end / 1000);
      document.querySelectorAll('.auto-split').forEach((item) => item.classList.remove('on'));
      card.classList.add('on');
    });
    container.appendChild(card);
  });
}

function drawVerticalLoadChart() {
  const canvas = document.getElementById('verticalC');
  const width = canvas.parentElement.getBoundingClientRect().width;
  if (!width) return;
  const height = 240;
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
  const padding = { t: 18, r: 12, b: 30, l: 40 };
  const chartWidth = width - padding.l - padding.r;
  const chartHeight = height - padding.t - padding.b;
  const maxValue = Math.max(...S.flatMap((split) => [split.g, split.l]), 1);
  const middle = padding.t + chartHeight / 2;
  ctx.strokeStyle = '#1d3326'; ctx.beginPath(); ctx.moveTo(padding.l, middle); ctx.lineTo(width - padding.r, middle); ctx.stroke();
  const slot = chartWidth / S.length;
  const barWidth = Math.max(3, slot * .32);
  S.forEach((split, index) => {
    const center = padding.l + index * slot + slot / 2;
    const upHeight = split.g / maxValue * chartHeight / 2;
    const downHeight = split.l / maxValue * chartHeight / 2;
    ctx.fillStyle = '#f0883e'; ctx.fillRect(center - barWidth - 1, middle - upHeight, barWidth, upHeight);
    ctx.fillStyle = '#58a6ff'; ctx.fillRect(center + 1, middle, barWidth, downHeight);
    ctx.fillStyle = '#657d6b'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillText(split.km, center, height - 12);
  });
  ctx.fillStyle = '#f0883e'; ctx.textAlign = 'left'; ctx.font = '9px JetBrains Mono'; ctx.fillText('D+', padding.l, 12);
  ctx.fillStyle = '#58a6ff'; ctx.fillText('D−', padding.l + 30, 12);
}

function setupElevationAnalysis() {
  const startInput = document.getElementById('segmentStart');
  const endInput = document.getElementById('segmentEnd');
  const end = Math.min(1, metrics.distanceKm);
  startInput.max = metrics.distanceKm.toFixed(2);
  endInput.max = metrics.distanceKm.toFixed(2);
  startInput.value = '0';
  endInput.value = end.toFixed(2);
  document.getElementById('segmentAnalyze').onclick = () => analyzeSegment(Number(startInput.value), Number(endInput.value));
  renderAutomaticSplits();
  analyzeSegment(0, end);
}

function setZ(value, button) {
  document.querySelectorAll('.zbtn').forEach((item) => item.classList.remove('on'));
  if (button) button.classList.add('on');
  if (value === 'all') {
    zS = 0;
    zE = metrics.distance;
  } else {
    zS = value[0] * 1000;
    zE = value[1] * 1000;
  }
  drawElevation();
}

function drawElevation() {
  const canvas = document.getElementById('elC');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.parentElement.getBoundingClientRect().width;
  const height = 320;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
  const padding = { t: 24, r: 12, b: 32, l: 48 };
  const chartWidth = width - padding.l - padding.r;
  const chartHeight = height - padding.t - padding.b;
  const points = P.filter((point) => point.d >= zS && point.d <= zE);
  if (points.length < 2) return;
  const minD = points[0].d;
  const maxD = points.at(-1).d;
  const minE = Math.min(...points.map((point) => point.e)) - 15;
  const maxE = Math.max(...points.map((point) => point.e)) + 15;
  const x = (distance) => padding.l + ((distance - minD) / Math.max(1, maxD - minD)) * chartWidth;
  const y = (elevation) => padding.t + chartHeight - ((elevation - minE) / Math.max(1, maxE - minE)) * chartHeight;
  ctx.clearRect(0, 0, width, height);
  const elevationStep = maxE - minE > 300 ? 100 : maxE - minE > 100 ? 50 : 20;
  for (let elevation = Math.ceil(minE / elevationStep) * elevationStep; elevation <= maxE; elevation += elevationStep) {
    ctx.strokeStyle = '#21262d'; ctx.beginPath(); ctx.moveTo(padding.l, y(elevation)); ctx.lineTo(width - padding.r, y(elevation)); ctx.stroke();
    ctx.fillStyle = '#484f58'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'right'; ctx.fillText(`${Math.round(elevation)}m`, padding.l - 6, y(elevation) + 3);
  }
  const gradient = ctx.createLinearGradient(0, padding.t, 0, height - padding.b);
  gradient.addColorStop(0, 'rgba(63,185,80,.25)'); gradient.addColorStop(1, 'rgba(63,185,80,.02)');
  ctx.beginPath(); ctx.moveTo(x(points[0].d), y(points[0].e)); points.forEach((point) => ctx.lineTo(x(point.d), y(point.e))); ctx.lineTo(x(points.at(-1).d), height - padding.b); ctx.lineTo(x(points[0].d), height - padding.b); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.strokeStyle = '#3fb950'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x(points[0].d), y(points[0].e)); points.forEach((point) => ctx.lineTo(x(point.d), y(point.e))); ctx.stroke();
  const tooltip = document.getElementById('ctt');
  canvas.onmousemove = (event) => {
    const bounds = canvas.getBoundingClientRect();
    const mouseX = event.clientX - bounds.left;
    const distance = minD + ((mouseX - padding.l) / chartWidth) * (maxD - minD);
    if (distance < minD || distance > maxD) { tooltip.style.display = 'none'; return; }
    const point = points.reduce((closest, candidate) => Math.abs(candidate.d - distance) < Math.abs(closest.d - distance) ? candidate : closest);
    const index = P.indexOf(point);
    const grade = pointGrade(index);
    document.getElementById('cd1').textContent = `${(point.d / 1000).toFixed(2)} km`;
    document.getElementById('ce1').textContent = `${number.format(point.e)} m`;
    const gradeValue = document.getElementById('cg1'); gradeValue.textContent = `${grade >= 0 ? '+' : ''}${grade.toFixed(1)}%`; gradeValue.style.color = gradeColor(grade);
    tooltip.style.display = 'block'; tooltip.style.left = `${Math.min(mouseX + 14, width - 180)}px`; tooltip.style.top = `${y(point.e) - 40}px`;
  };
  canvas.onmouseleave = () => { tooltip.style.display = 'none'; };
}

function initSplits() {
  const body = document.getElementById('sBody');
  body.innerHTML = '';
  S.forEach((split) => {
    const pace = suggestedPace(split);
    const row = document.createElement('tr');
    row.innerHTML = `<td>${split.km}</td><td style="font-family:Inter;font-weight:400;color:var(--tx2);font-size:11px">${terrainFor(split)}</td><td class="up">+${split.g}m</td><td class="dn">−${split.l}m</td><td style="color:${gradeColor(split.ag)}">${split.ag >= 0 ? '+' : ''}${split.ag.toFixed(1)}%</td><td style="color:${gradeColor(split.mg)}">${split.mg >= 0 ? '+' : ''}${split.mg.toFixed(0)}%</td><td>${split.mn}–${split.mx}m</td><td style="color:#e3b341">${pace}</td><td><input type="text" value="${pace}"></td><td class="acum" style="color:var(--em)">—</td>`;
    row.querySelector('input').addEventListener('input', calcTotal);
    body.appendChild(row);
  });
  calcTotal();
}

function paceSeconds(value) {
  const parts = value.split(':');
  return parts.length === 2 && Number.isFinite(Number(parts[0])) && Number.isFinite(Number(parts[1])) ? Number(parts[0]) * 60 + Number(parts[1]) : NaN;
}

function timeLabel(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return hours ? `${hours}h${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function calcTotal() {
  let total = 0;
  document.querySelectorAll('#sBody input').forEach((input, index) => {
    const seconds = paceSeconds(input.value);
    const accumulated = document.querySelectorAll('.acum')[index];
    if (Number.isNaN(seconds)) { accumulated.textContent = '—'; return; }
    total += seconds; accumulated.textContent = timeLabel(total);
  });
  const average = total / S.length;
  document.getElementById('totBar').innerHTML = `<div class="tot"><div class="tot-l">Tempo estimado</div><div class="tot-v" style="color:var(--em)">${timeLabel(total)}</div></div><div class="tot"><div class="tot-l">Pace médio</div><div class="tot-v" style="color:#e3b341">${formatPace(average)}<span style="font-size:14px;color:var(--tx2)"> /km</span></div></div><div class="tot"><div class="tot-l">Base do cálculo</div><div class="tot-v" style="font-size:18px">${decimal.format(metrics.distanceKm)} km</div></div>`;
}

function notesStorageKey() {
  return `vertex-notes:${metrics.fileName}:${Math.round(metrics.distance)}`;
}

function savedNotes() {
  try { return JSON.parse(localStorage.getItem(notesStorageKey())) || {}; }
  catch { return {}; }
}

function saveNotes(notes) {
  localStorage.setItem(notesStorageKey(), JSON.stringify(notes));
}

function initSplits() {
  const body = document.getElementById('sBody');
  const notes = savedNotes();
  body.innerHTML = '';
  S.forEach((split) => {
    const pace = suggestedPace(split);
    const row = document.createElement('tr');
    row.innerHTML = `<td>${split.km}</td><td style="font-family:Inter;font-weight:400;color:var(--tx2);font-size:11px">${terrainFor(split)}</td><td class="up">+${split.g}m</td><td class="dn">−${split.l}m</td><td style="color:${gradeColor(split.ag)}">${split.ag >= 0 ? '+' : ''}${split.ag.toFixed(1)}%</td><td style="color:${gradeColor(split.mg)}">${split.mg >= 0 ? '+' : ''}${split.mg.toFixed(0)}%</td><td>${split.mn}–${split.mx}m</td><td style="color:#e3b341">${pace}</td><td><input class="pace-input" type="text" value="${pace}" aria-label="Pace do km ${split.km}"></td><td class="acum" style="color:var(--em)">—</td>`;
    const noteCell = document.createElement('td');
    const noteInput = document.createElement('input');
    noteInput.className = 'note-input';
    noteInput.type = 'text';
    noteInput.placeholder = 'Ex.: trilha solta, bastões';
    noteInput.value = notes[split.km] || '';
    noteInput.setAttribute('aria-label', `Anotação do km ${split.km}`);
    noteInput.addEventListener('input', () => { notes[split.km] = noteInput.value; saveNotes(notes); });
    noteCell.appendChild(noteInput);
    row.appendChild(noteCell);
    row.querySelector('.pace-input').addEventListener('input', calcTotal);
    body.appendChild(row);
  });
  calcTotal();
}

function calcTotal() {
  let total = 0;
  document.querySelectorAll('#sBody .pace-input').forEach((input, index) => {
    const seconds = paceSeconds(input.value);
    const accumulated = document.querySelectorAll('.acum')[index];
    if (Number.isNaN(seconds)) { accumulated.textContent = '—'; return; }
    total += seconds;
    accumulated.textContent = timeLabel(total);
  });
  const average = total / S.length;
  document.getElementById('totBar').innerHTML = `<div class="tot"><div class="tot-l">Tempo estimado</div><div class="tot-v" style="color:var(--em)">${timeLabel(total)}</div></div><div class="tot"><div class="tot-l">Pace médio</div><div class="tot-v" style="color:#e3b341">${formatPace(average)}<span style="font-size:14px;color:var(--tx2)"> /km</span></div></div><div class="tot"><div class="tot-l">Base do cálculo</div><div class="tot-v" style="font-size:18px">${decimal.format(metrics.distanceKm)} km</div></div>`;
}

function drawGradients() {
  const strip = document.getElementById('gStrip');
  const stats = document.getElementById('gStats');
  strip.innerHTML = ''; stats.innerHTML = '';
  const categories = { strongUp: 0, up: 0, flat: 0, down: 0, strongDown: 0 };
  G.forEach((gradient) => {
    const section = document.createElement('div'); section.className = 'gs'; section.style.flex = '1'; section.style.background = gradeColor(gradient.g); section.title = `${gradient.d.toFixed(2)} km · ${gradient.g >= 0 ? '+' : ''}${gradient.g.toFixed(1)}%`; strip.appendChild(section);
    if (gradient.g > 15) categories.strongUp += 1; else if (gradient.g > 5) categories.up += 1; else if (gradient.g > -5) categories.flat += 1; else if (gradient.g > -10) categories.down += 1; else categories.strongDown += 1;
  });
  const labels = [['Subida forte >15%', categories.strongUp, 'var(--red)'], ['Subida 5–15%', categories.up, 'var(--org)'], ['Plano ±5%', categories.flat, 'var(--pur)'], ['Descida −5 a −10%', categories.down, 'var(--blu)'], ['Descida forte <−10%', categories.strongDown, '#39d4dd']];
  stats.innerHTML = labels.map(([label, amount, color]) => `<div class="gst"><div class="gv" style="color:${color}">${(amount / G.length * 100).toFixed(1)}%</div><div class="gl">${label}</div><div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--tx3);margin-top:2px">~${(amount / G.length * metrics.distanceKm).toFixed(1)} km</div></div>`).join('');
  document.getElementById('gradientAxis').innerHTML = Array.from({ length: 6 }, (_, index) => `<span>${(metrics.distanceKm / 5 * index).toFixed(index ? 1 : 0)} km</span>`).join('');
  drawGradientChart();
}

function gradientBand(grade) {
  if (grade > 15) return { id: 'up-steep', label: 'Subida forte', color: '#f85149' };
  if (grade > 5) return { id: 'up', label: 'Subida', color: '#f0883e' };
  if (grade > -5) return { id: 'flat', label: 'Plano / ondulado', color: '#bc8cff' };
  if (grade > -10) return { id: 'down', label: 'Descida', color: '#58a6ff' };
  return { id: 'down-steep', label: 'Descida forte', color: '#39d4dd' };
}

function sustainedGradientRuns() {
  const runs = [];
  let active = null;
  G.forEach((sample, index) => {
    const band = gradientBand(sample.g);
    const next = G[index + 1];
    const end = next ? next.d : metrics.distanceKm;
    if (!active || active.band.id !== band.id) {
      if (active) runs.push(active);
      active = { id: `run-${index}`, band, start: sample.d, end, grades: [sample.g] };
    } else {
      active.end = end;
      active.grades.push(sample.g);
    }
  });
  if (active) runs.push(active);
  return runs.map((run) => ({ ...run, length: Math.max(0, run.end - run.start), average: run.grades.reduce((sum, grade) => sum + grade, 0) / run.grades.length, peak: run.band.id.startsWith('down') ? Math.min(...run.grades) : Math.max(...run.grades) })).filter((run) => run.band.id !== 'flat' && run.length >= .12);
}

function renderGradientDetail() {
  const highest = Math.max(...G.map((sample) => sample.g));
  const lowest = Math.min(...G.map((sample) => sample.g));
  const strongUp = gradientBuckets().find((bucket) => bucket.label === '> 15%').distance;
  const strongDown = gradientBuckets().find((bucket) => bucket.label === '< −10%').distance;
  document.getElementById('gradientKeyStats').innerHTML = `<div><span>Pico de subida</span><strong style="color:#f85149">+${highest.toFixed(1)}%</strong></div><div><span>Pico de descida</span><strong style="color:#39d4dd">${lowest.toFixed(1)}%</strong></div><div><span>Subida forte</span><strong>${strongUp.toFixed(2)} km</strong></div><div><span>Descida forte</span><strong>${strongDown.toFixed(2)} km</strong></div>`;
  const runs = sustainedGradientRuns().sort((a, b) => Math.abs(b.average) * b.length - Math.abs(a.average) * a.length).slice(0, 6);
  document.getElementById('gradientRuns').innerHTML = runs.length ? runs.map((run) => `<button class="gradient-run" type="button" data-run="${run.id}"><span style="color:${run.band.color}">${run.band.label}</span><strong>Km ${run.start.toFixed(2)}–${run.end.toFixed(2)}</strong><small>${run.length.toFixed(2)} km · média ${run.average >= 0 ? '+' : ''}${run.average.toFixed(1)}% · pico ${run.peak >= 0 ? '+' : ''}${run.peak.toFixed(1)}%</small></button>`).join('') : '<p class="empty-state">Não há trechos sustentados suficientes para destacar.</p>';
  document.querySelectorAll('[data-run]').forEach((button) => button.addEventListener('click', () => { const run = runs.find((item) => item.id === button.dataset.run); document.getElementById('segmentStart').value = run.start.toFixed(2); document.getElementById('segmentEnd').value = run.end.toFixed(2); analyzeSegment(run.start, run.end); document.querySelector('[data-tab="alt"]')?.click(); }));
}

function drawGradientVolatility() {
  const canvas = document.getElementById('gradientVolatilityC');
  const width = canvas.parentElement.getBoundingClientRect().width;
  if (!width) return;
  const values = S.map((split) => { const grades = G.filter((sample) => sample.d * 1000 >= split.start && sample.d * 1000 <= split.end).map((sample) => sample.g); const average = grades.reduce((sum, grade) => sum + grade, 0) / Math.max(1, grades.length); return Math.sqrt(grades.reduce((sum, grade) => sum + (grade - average) ** 2, 0) / Math.max(1, grades.length)); });
  const height = 230; const dpr = window.devicePixelRatio || 1; const ctx = canvas.getContext('2d'); canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.height = `${height}px`; ctx.scale(dpr, dpr);
  const padding = { t: 18, r: 12, b: 30, l: 38 }; const chartWidth = width - padding.l - padding.r; const chartHeight = height - padding.t - padding.b; const maxValue = Math.max(...values, 1); const slot = chartWidth / values.length;
  [0, .5, 1].forEach((ratio) => { const y = padding.t + chartHeight - ratio * chartHeight; ctx.strokeStyle = '#1d3326'; ctx.beginPath(); ctx.moveTo(padding.l, y); ctx.lineTo(width - padding.r, y); ctx.stroke(); ctx.fillStyle = '#657d6b'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'right'; ctx.fillText(`${(maxValue * ratio).toFixed(1)}%`, padding.l - 4, y + 3); });
  values.forEach((value, index) => { const barWidth = Math.max(4, slot * .6); const barHeight = value / maxValue * chartHeight; const x = padding.l + index * slot + (slot - barWidth) / 2; ctx.fillStyle = value / maxValue > .7 ? '#f0883e' : '#56ce79'; ctx.fillRect(x, padding.t + chartHeight - barHeight, barWidth, barHeight); ctx.fillStyle = '#657d6b'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillText(index + 1, x + barWidth / 2, height - 12); });
}

function drawGradientChart() {
  const canvas = document.getElementById('grC'); const ctx = canvas.getContext('2d'); const dpr = window.devicePixelRatio || 1; const width = canvas.parentElement.getBoundingClientRect().width; const height = 180;
  canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.height = `${height}px`; ctx.scale(dpr, dpr);
  const padding = { t: 16, r: 8, b: 24, l: 36 }; const chartWidth = width - padding.l - padding.r; const chartHeight = height - padding.t - padding.b; const maximum = 35;
  const x = (distance) => padding.l + (distance / Math.max(.1, metrics.distanceKm)) * chartWidth; const y = (grade) => padding.t + chartHeight / 2 - (grade / maximum) * chartHeight / 2;
  [-20, -10, 0, 10, 20].forEach((value) => { ctx.strokeStyle = '#21262d'; ctx.beginPath(); ctx.moveTo(padding.l, y(value)); ctx.lineTo(width - padding.r, y(value)); ctx.stroke(); ctx.fillStyle = '#484f58'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'right'; ctx.fillText(`${value > 0 ? '+' : ''}${value}%`, padding.l - 3, y(value) + 3); });
  const barWidth = Math.max(2, chartWidth / G.length - .5);
  G.forEach((gradient) => { const value = Math.max(-maximum, Math.min(maximum, gradient.g)); ctx.fillStyle = gradeColor(value); ctx.fillRect(x(gradient.d), Math.min(y(0), y(value)), barWidth, Math.max(1, Math.abs(y(value) - y(0)))); });
}

function splitLoad(split) {
  return split.g + split.l * 0.35 + Math.max(0, split.ag) * 9;
}

function renderLoadSummary() {
  const ranked = [...S].map((split) => ({ split, value: splitLoad(split) })).sort((a, b) => b.value - a.value);
  const hardest = ranked[0];
  const next = ranked.slice(1, 3).map(({ split }) => `km ${split.km}`).join(' e ');
  document.getElementById('loadSummary').innerHTML = `<div class="load-card"><span>Maior demanda</span><strong>Km ${hardest.split.km}</strong><p>+${hardest.split.g} m, ${hardest.split.l} m de descida e ${hardest.split.ag.toFixed(1)}% médio.</p></div><div class="load-card"><span>Outros pontos de atenção</span><strong>${next || '—'}</strong><p>Planeje o esforço antes desses setores para manter margem técnica e mental.</p></div><div class="load-card"><span>Como ler</span><strong>Carga relativa</strong><p>Subidas pesam mais; descidas entram parcialmente pelo impacto muscular e exigência técnica.</p></div>`;
}

function drawEffortChart() {
  const canvas = document.getElementById('effortC');
  const width = canvas.parentElement.getBoundingClientRect().width;
  if (!width) return;
  const height = 260;
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
  const padding = { t: 22, r: 18, b: 34, l: 42 };
  const chartWidth = width - padding.l - padding.r;
  const chartHeight = height - padding.t - padding.b;
  const values = S.map(splitLoad);
  const maximum = Math.max(...values, 1);
  [0, .5, 1].forEach((ratio) => {
    const y = padding.t + chartHeight - ratio * chartHeight;
    ctx.strokeStyle = '#1d3326'; ctx.beginPath(); ctx.moveTo(padding.l, y); ctx.lineTo(width - padding.r, y); ctx.stroke();
    ctx.fillStyle = '#657d6b'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'right'; ctx.fillText(`${Math.round(maximum * ratio)}`, padding.l - 7, y + 3);
  });
  const slot = chartWidth / S.length;
  const barWidth = Math.max(4, slot * .64);
  S.forEach((split, index) => {
    const value = values[index];
    const barHeight = value / maximum * chartHeight;
    const x = padding.l + index * slot + (slot - barWidth) / 2;
    const y = padding.t + chartHeight - barHeight;
    const gradient = ctx.createLinearGradient(0, y, 0, padding.t + chartHeight);
    gradient.addColorStop(0, split.ag > 8 ? '#f0883e' : '#56ce79');
    gradient.addColorStop(1, '#123722');
    ctx.fillStyle = gradient; ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = '#657d6b'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillText(split.km, x + barWidth / 2, height - 14);
  });
}

function initStrategy() {
  const hardest = T3[0];
  const descent = [...S].sort((a, b) => a.ag - b.ag)[0];
  const cards = [
    { color: 'sc-o', tag: 'Setor-chave', title: `Subida do km ${hardest.km}`, text: `São +${hardest.g} m em aproximadamente 1 km, com gradiente médio de ${hardest.ag.toFixed(1)}%. Controle o esforço e use caminhada forte nos trechos inclinados.`, pace: suggestedPace(hardest) },
    { color: 'sc-b', tag: 'Descida técnica', title: `Descida do km ${descent.km}`, text: `${number.format(descent.l)} m de perda e gradiente médio de ${descent.ag.toFixed(1)}%. Priorize passos curtos e controle para preservar as pernas.`, pace: suggestedPace(descent) },
    { color: 'sc-y', tag: 'Planejamento', title: 'Distribua energia pela rota', text: `O percurso tem ${decimal.format(metrics.distanceKm)} km e ${number.format(metrics.gain)} m de ganho acumulado. Hidrate-se regularmente e deixe margem para os setores mais íngremes.`, pace: formatPace(365 + metrics.vertical * 1.2) },
  ];
  document.getElementById('stratGrid').innerHTML = cards.map((card) => `<div class="scard ${card.color}"><div class="sc-tag">${card.tag}</div><h3>${card.title}</h3><p>${card.text}</p><div class="pace-pill">Ritmo de referência: ${card.pace}/km</div></div>`).join('');
}

function renderRoute() {
  zS = 0; zE = metrics.distance;
  renderSummary(); renderTopThree(); renderZoom(); setupElevationAnalysis(); initMap(); initSplits(); drawGradients(); renderGradientDetail(); renderLoadSummary(); initStrategy();
  if (pendingBriefingOverrides) { applyOverrides(pendingBriefingOverrides); pendingBriefingOverrides = null; }
  renderBriefing();
  renderInsights();
  renderActivity();
  document.querySelectorAll('.tpan').forEach((panel) => panel.classList.remove('on'));
  document.getElementById('tab-geral').classList.add('on');
  document.querySelectorAll('.tab').forEach((tab, index) => tab.classList.toggle('on', index === 0));
}

function parseGpx(text) {
  const documentXml = new DOMParser().parseFromString(text, 'application/xml');
  if (documentXml.querySelector('parsererror')) throw new Error('O arquivo não é um GPX XML válido.');
  let segments = [...documentXml.getElementsByTagNameNS('*', 'trkseg')].map((segment) => [...segment.getElementsByTagNameNS('*', 'trkpt')]);
  if (!segments.length) segments = [[...documentXml.getElementsByTagNameNS('*', 'rtept')]];
  const points = [];
  segments.forEach((segment) => segment.forEach((node, index) => {
    const la = Number(node.getAttribute('lat')); const lo = Number(node.getAttribute('lon')); const ele = Number(node.getElementsByTagNameNS('*', 'ele')[0]?.textContent); const time = Date.parse(node.getElementsByTagNameNS('*', 'time')[0]?.textContent || '');
    if (Number.isFinite(la) && Number.isFinite(lo)) points.push({ la, lo, e: ele, t: Number.isFinite(time) ? time : null, breakBefore: index === 0 && points.length > 0 });
  }));
  if (points.length < 2) throw new Error('O GPX precisa ter pelo menos dois pontos de rota válidos.');
  return points;
}

async function loadGpx(file) {
  if (!file) return;
  const status = document.getElementById('uploadStatus');
  if (!file.name.toLowerCase().endsWith('.gpx')) { status.textContent = 'Escolha um arquivo com extensão .gpx.'; return; }
  status.textContent = `Processando ${file.name}…`;
  try {
    currentBriefingId = null;
    customSectors = [];
    sectorNotes = {};
    pendingBriefingOverrides = null;
    activityAnalysis = null;
    hasLoadedGpx = true;
    buildAnalysis(parseGpx(await file.text()), file.name);
    document.body.classList.add('has-route');
    setupTabs();
    renderRoute();
    status.textContent = `${file.name} analisado localmente com sucesso.`;
  } catch (error) {
    status.textContent = error.message;
    console.error(error);
  }
}

function setupUpload() {
  const input = document.getElementById('gpxFile'); const zone = document.getElementById('dropZone');
  input.addEventListener('change', () => loadGpx(input.files[0]));
  ['dragenter', 'dragover'].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.remove('is-dragging'); }));
  zone.addEventListener('drop', (event) => loadGpx(event.dataTransfer.files[0]));
}

function setupTabs() {
  const tabs = [['geral', 'Visão geral'], ['alt', 'Altimetria'], ['splits', 'Splits por km'], ['grad', 'Gradiente'], ['strat', 'Estratégia']];
  const navigation = document.getElementById('tabNav');
  tabs.forEach(([id, label], index) => { const button = document.createElement('button'); button.className = `tab${index === 0 ? ' on' : ''}`; button.textContent = label; button.addEventListener('click', () => { document.querySelectorAll('.tpan').forEach((panel) => panel.classList.remove('on')); document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('on')); document.getElementById(`tab-${id}`).classList.add('on'); button.classList.add('on'); if (id === 'alt') drawElevation(); if (id === 'grad') drawGradientChart(); if (id === 'geral') setTimeout(() => routeMap.invalidateSize(), 0); }); navigation.appendChild(button); });
}

function setupTabs() {
  const tabs = [['geral', 'Visão geral'], ['alt', 'Altimetria'], ['splits', 'Splits por km'], ['grad', 'Gradiente'], ['carga', 'Carga'], ['strat', 'Estratégia']];
  const navigation = document.getElementById('tabNav');
  navigation.innerHTML = '';
  tabs.forEach(([id, label], index) => {
    const button = document.createElement('button');
    button.className = `tab${index === 0 ? ' on' : ''}`;
    button.textContent = label;
    button.addEventListener('click', () => {
      document.querySelectorAll('.tpan').forEach((panel) => panel.classList.remove('on'));
      document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('on'));
      document.getElementById(`tab-${id}`).classList.add('on');
      button.classList.add('on');
      if (id === 'alt') { drawElevation(); drawVerticalLoadChart(); }
      if (id === 'grad') drawGradientChart();
      if (id === 'carga') drawEffortChart();
      if (id === 'geral') setTimeout(() => routeMap.invalidateSize(), 0);
    });
    navigation.appendChild(button);
  });
}

const BRIEFING_DB = 'vertex-gps-briefings';
const BRIEFING_STORE = 'briefings';

function briefingDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BRIEFING_DB, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(BRIEFING_STORE, { keyPath: 'id' });
      store.createIndex('updatedAt', 'updatedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function briefingStore(action, value) {
  const db = await briefingDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(BRIEFING_STORE, 'readwrite');
    const store = transaction.objectStore(BRIEFING_STORE);
    const request = action === 'list' ? store.getAll() : action === 'get' ? store.get(value) : action === 'delete' ? store.delete(value) : store.put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function profileData() {
  return {
    athleteName: document.getElementById('athleteName').value.trim(),
    eventName: document.getElementById('eventName').value.trim(),
    eventDate: document.getElementById('eventDate').value,
    goalTime: document.getElementById('goalTime').value.trim(),
    technicalLevel: document.getElementById('technicalLevel').value,
    usesPoles: document.getElementById('usesPoles').checked,
  };
}

function populateProfile(profile = {}) {
  document.getElementById('athleteName').value = profile.athleteName || '';
  document.getElementById('eventName').value = profile.eventName || '';
  document.getElementById('eventDate').value = profile.eventDate || '';
  document.getElementById('goalTime').value = profile.goalTime || '';
  document.getElementById('technicalLevel').value = profile.technicalLevel || 'intermediario';
  document.getElementById('usesPoles').checked = Boolean(profile.usesPoles);
}

function splitOverrides() {
  return S.map((split, index) => ({ km: split.km, pace: document.querySelectorAll('#sBody .pace-input')[index]?.value || suggestedPace(split), note: document.querySelectorAll('#sBody .note-input')[index]?.value || '' }));
}

function applyOverrides(overrides = []) {
  overrides.forEach((override, index) => {
    const pace = document.querySelectorAll('#sBody .pace-input')[index];
    const note = document.querySelectorAll('#sBody .note-input')[index];
    if (pace) pace.value = override.pace || pace.value;
    if (note) note.value = override.note || '';
  });
  calcTotal();
}

function sectorStats(sector) {
  const length = (sector.end - sector.start) / 1000;
  const grade = Number.isFinite(sector.ag) ? sector.ag : S.filter((split) => split.start >= sector.start && split.end <= sector.end).reduce((total, split, _, values) => total + split.ag / values.length, 0);
  return { length, grade };
}

function sectorDecision(sector) {
  const profile = profileData();
  const stats = sectorStats(sector);
  if (sector.type === 'climb' || stats.grade >= 6) return profile.usesPoles ? 'Controle o ritmo e use os bastões quando a inclinação tirar eficiência da corrida.' : 'Controle o ritmo; caminhar forte nos trechos mais inclinados preserva energia.';
  if (sector.type === 'descent' || stats.grade <= -6) return profile.technicalLevel === 'iniciante' ? 'Desça com passos curtos e margem de segurança; não persiga tempo neste setor.' : 'Use a descida para recuperar, mantendo passadas curtas e controle técnico.';
  return 'Mantenha esforço constante e prepare-se para o próximo setor de maior carga.';
}

function renderBriefing() {
  const profile = profileData();
  const decisive = [...autoSectors].sort((a, b) => (b.g + b.l * .35) - (a.g + a.l * .35)).slice(0, 3);
  const athlete = profile.athleteName || 'Atleta';
  const goal = profile.goalTime ? `Meta: ${profile.goalTime}.` : 'Defina um tempo-alvo para completar o briefing.';
  const poles = profile.usesPoles ? 'Bastões incluídos na estratégia.' : 'Estratégia sem bastões.';
  document.getElementById('briefingRoute').textContent = `Baseado no GPX: ${metrics.fileName} · ${decimal.format(metrics.distanceKm)} km · +${number.format(metrics.gain)} m D+`;
  document.getElementById('briefingSummary').innerHTML = `<div class="summary-lead"><strong>${athlete}</strong><span>${goal}</span></div><div class="summary-points"><div><b>${number.format(metrics.gain)} m</b><span>de ganho acumulado</span></div><div><b>${decimal.format(metrics.effort)} km-e</b><span>de esforço estimado</span></div><div><b>${decisive.length}</b><span>setores decisivos</span></div></div><p>${poles} O foco deve estar em chegar aos setores críticos com margem de esforço e atenção técnica.</p>`;
  const sectors = [...autoSectors.map((sector) => ({ ...sector, source: 'Automático' })), ...customSectors.map((sector) => ({ ...sector, source: 'Treinador' }))];
  const container = document.getElementById('briefingSectors');
  container.innerHTML = sectors.length ? sectors.map((sector, index) => {
    const stats = sectorStats(sector);
    const name = sector.title || (sector.type === 'descent' ? 'Descida relevante' : 'Subida relevante');
    return `<article class="briefing-sector ${sector.type || 'custom'}"><div class="sector-index">${String(index + 1).padStart(2, '0')} · ${sector.source}</div><h3>${name}</h3><div class="sector-data">Km ${(sector.start / 1000).toFixed(1)}–${(sector.end / 1000).toFixed(1)} · ${stats.length.toFixed(1)} km · <b>+${number.format(sector.g || 0)} m</b> · −${number.format(sector.l || 0)} m</div><p>${sectorDecision(sector)}</p><textarea data-sector-note="${sector.id}" placeholder="Nota do treinador para este setor"></textarea><button type="button" data-sector="${sector.id}">Abrir na altimetria</button></article>`;
  }).join('') : '<p class="empty-state">Carregue uma rota com elevação para detectar setores.</p>';
  container.querySelectorAll('[data-sector]').forEach((button) => button.addEventListener('click', () => {
    const sector = sectors.find((item) => item.id === button.dataset.sector);
    document.getElementById('segmentStart').value = (sector.start / 1000).toFixed(2);
    document.getElementById('segmentEnd').value = (sector.end / 1000).toFixed(2);
    analyzeSegment(sector.start / 1000, sector.end / 1000);
    document.querySelector('[data-tab="alt"]')?.click();
  }));
  container.querySelectorAll('[data-sector-note]').forEach((input) => {
    input.value = sectorNotes[input.dataset.sectorNote] || '';
    input.addEventListener('input', () => { sectorNotes[input.dataset.sectorNote] = input.value; });
  });
}

function addCustomSector() {
  const start = Number(document.getElementById('segmentStart').value) * 1000;
  const end = Number(document.getElementById('segmentEnd').value) * 1000;
  if (!(end > start)) return;
  const affected = S.filter((split) => split.end > start && split.start < end);
  const title = document.getElementById('customSectorTitle').value.trim();
  customSectors.push({ id: `coach-${crypto.randomUUID()}`, title: title || `Setor do treinador · km ${(start / 1000).toFixed(1)}–${(end / 1000).toFixed(1)}`, type: affected.reduce((sum, split) => sum + split.ag, 0) >= 0 ? 'climb' : 'descent', start, end, g: affected.reduce((sum, split) => sum + split.g, 0), l: affected.reduce((sum, split) => sum + split.l, 0), ag: affected.reduce((sum, split) => sum + split.ag, 0) / Math.max(1, affected.length) });
  document.getElementById('customSectorTitle').value = '';
  renderBriefing();
}

function setupCoachControls() {
  document.getElementById('saveCustomSector').onclick = addCustomSector;
  ['athleteName', 'eventName', 'eventDate', 'goalTime', 'technicalLevel', 'usesPoles'].forEach((id) => document.getElementById(id).addEventListener('input', renderBriefing));
  document.getElementById('saveBriefing').onclick = saveBriefing;
  document.getElementById('newBriefing').onclick = newBriefing;
}

async function saveBriefing() {
  const profile = profileData();
  const now = new Date().toISOString();
  const record = { id: currentBriefingId || crypto.randomUUID(), createdAt: currentBriefingId ? undefined : now, updatedAt: now, profile, route: { fileName: metrics.fileName, points: rawRoutePoints }, customSectors, sectorNotes, overrides: splitOverrides() };
  if (currentBriefingId) {
    const previous = await briefingStore('get', currentBriefingId);
    record.createdAt = previous?.createdAt || now;
  }
  await briefingStore('put', record);
  currentBriefingId = record.id;
  document.getElementById('libraryStatus').textContent = 'Briefing salvo localmente.';
  renderLibrary();
}

async function renderLibrary() {
  const records = (await briefingStore('list')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const container = document.getElementById('briefingLibrary');
  container.innerHTML = records.length ? records.map((record) => `<article class="library-item"><div><strong>${record.profile.eventName || record.route.fileName}</strong><span>${record.profile.athleteName || 'Sem atleta'} · atualizado ${new Date(record.updatedAt).toLocaleDateString('pt-BR')}</span></div><div><button data-open="${record.id}">Abrir</button><button data-delete="${record.id}" class="danger">Excluir</button></div></article>`).join('') : '<p class="empty-state">Nenhum briefing salvo neste dispositivo.</p>';
  container.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => loadBriefing(button.dataset.open)));
  container.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', async () => { if (confirm('Excluir este briefing local?')) { await briefingStore('delete', button.dataset.delete); if (currentBriefingId === button.dataset.delete) currentBriefingId = null; renderLibrary(); } }));
}

async function loadBriefing(id) {
  const record = await briefingStore('get', id);
  if (!record) return;
  currentBriefingId = record.id;
  hasLoadedGpx = true;
  document.body.classList.add('has-route');
  customSectors = record.customSectors || [];
  sectorNotes = record.sectorNotes || {};
  populateProfile(record.profile);
  pendingBriefingOverrides = record.overrides || [];
  buildAnalysis(record.route.points, record.route.fileName);
  setupTabs();
  renderRoute();
  document.getElementById('libraryStatus').textContent = 'Briefing aberto.';
}

function newBriefing() {
  currentBriefingId = null;
  customSectors = [];
  sectorNotes = {};
  pendingBriefingOverrides = null;
  populateProfile();
  renderRoute();
  document.getElementById('libraryStatus').textContent = 'Novo briefing não salvo.';
}

function setupTabs() {
  const tabs = [['geral', 'Visão geral'], ['alt', 'Altimetria'], ['splits', 'Splits por km'], ['grad', 'Gradiente'], ['carga', 'Carga'], ['strat', 'Estratégia']];
  if (hasLoadedGpx) tabs.push(['briefing', 'Briefing']);
  const navigation = document.getElementById('tabNav');
  navigation.innerHTML = '';
  tabs.forEach(([id, label], index) => {
    const button = document.createElement('button');
    button.dataset.tab = id;
    button.className = `tab${index === 0 ? ' on' : ''}`;
    button.textContent = label;
    button.addEventListener('click', () => {
      document.querySelectorAll('.tpan').forEach((panel) => panel.classList.remove('on'));
      document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('on'));
      document.getElementById(`tab-${id}`).classList.add('on');
      button.classList.add('on');
      if (id === 'alt') { drawElevation(); drawVerticalLoadChart(); }
      if (id === 'grad') drawGradientChart();
      if (id === 'carga') drawEffortChart();
      if (id === 'geral') setTimeout(() => routeMap.invalidateSize(), 0);
    });
    navigation.appendChild(button);
  });
}

function gradientBuckets() {
  const buckets = [{ label: '< −10%', min: -Infinity, max: -10, color: '#39d4dd' }, { label: '−10 a −5%', min: -10, max: -5, color: '#58a6ff' }, { label: '−5 a 5%', min: -5, max: 5, color: '#bc8cff' }, { label: '5 a 10%', min: 5, max: 10, color: '#f0b45f' }, { label: '10 a 15%', min: 10, max: 15, color: '#f0883e' }, { label: '> 15%', min: 15, max: Infinity, color: '#f85149' }].map((bucket) => ({ ...bucket, distance: 0 }));
  G.forEach((sample, index) => {
    const next = G[index + 1];
    const distance = next ? next.d - sample.d : Math.max(0, metrics.distanceKm - sample.d);
    const bucket = buckets.find((item) => sample.g >= item.min && sample.g < item.max);
    if (bucket) bucket.distance += distance;
  });
  return buckets;
}

function drawGradientHistogram() {
  const canvas = document.getElementById('gradientHistogram');
  const width = canvas.parentElement.getBoundingClientRect().width;
  if (!width) return;
  const height = 250; const dpr = window.devicePixelRatio || 1; const ctx = canvas.getContext('2d'); canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.height = `${height}px`; ctx.scale(dpr, dpr);
  const buckets = gradientBuckets(); const padding = { t: 22, r: 12, b: 50, l: 38 }; const chartWidth = width - padding.l - padding.r; const chartHeight = height - padding.t - padding.b; const maximum = Math.max(...buckets.map((bucket) => bucket.distance), .1); const slot = chartWidth / buckets.length;
  [0, .5, 1].forEach((ratio) => { const y = padding.t + chartHeight - ratio * chartHeight; ctx.strokeStyle = '#1d3326'; ctx.beginPath(); ctx.moveTo(padding.l, y); ctx.lineTo(width - padding.r, y); ctx.stroke(); ctx.fillStyle = '#657d6b'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'right'; ctx.fillText(`${(maximum * ratio).toFixed(1)} km`, padding.l - 5, y + 3); });
  buckets.forEach((bucket, index) => { const barWidth = slot * .68; const barHeight = bucket.distance / maximum * chartHeight; const x = padding.l + index * slot + (slot - barWidth) / 2; const y = padding.t + chartHeight - barHeight; ctx.fillStyle = bucket.color; ctx.fillRect(x, y, barWidth, barHeight); ctx.fillStyle = '#a6b8aa'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'center'; const labels = ['<−10', '−10/−5', '−5/5', '5/10', '10/15', '>15']; ctx.fillText(labels[index], x + barWidth / 2, height - 27); ctx.fillText(`${(bucket.distance / metrics.distanceKm * 100).toFixed(0)}%`, x + barWidth / 2, height - 13); });
}

function drawCumulativeChart() {
  const canvas = document.getElementById('cumulativeC'); const width = canvas.parentElement.getBoundingClientRect().width; if (!width) return;
  const height = 250; const dpr = window.devicePixelRatio || 1; const ctx = canvas.getContext('2d'); canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.height = `${height}px`; ctx.scale(dpr, dpr);
  let gain = 0; let loss = 0; const series = P.map((point, index) => { if (index && !point.breakBefore) { const delta = point.e - P[index - 1].e; gain += Math.max(0, delta); loss += Math.max(0, -delta); } return { d: point.d / 1000, gain, loss }; });
  const padding = { t: 18, r: 12, b: 30, l: 40 }; const chartWidth = width - padding.l - padding.r; const chartHeight = height - padding.t - padding.b; const maxValue = Math.max(gain, loss, 1); const x = (d) => padding.l + d / metrics.distanceKm * chartWidth; const y = (value) => padding.t + chartHeight - value / maxValue * chartHeight;
  [0, .5, 1].forEach((ratio) => { const lineY = y(maxValue * ratio); ctx.strokeStyle = '#1d3326'; ctx.beginPath(); ctx.moveTo(padding.l, lineY); ctx.lineTo(width - padding.r, lineY); ctx.stroke(); });
  [['gain', '#f0883e'], ['loss', '#58a6ff']].forEach(([key, color]) => { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); series.forEach((point, index) => { if (index % 8 === 0 || index === series.length - 1) index ? ctx.lineTo(x(point.d), y(point[key])) : ctx.moveTo(x(point.d), y(point[key])); }); ctx.stroke(); });
  ctx.font = '9px JetBrains Mono'; ctx.fillStyle = '#f0883e'; ctx.fillText('D+ acumulado', padding.l, 12); ctx.fillStyle = '#58a6ff'; ctx.fillText('D− acumulado', padding.l + 88, 12);
}

function renderInsights() {
  const matrix = document.getElementById('sectorMatrix');
  matrix.innerHTML = autoSectors.length ? autoSectors.map((sector, index) => { const stats = sectorStats(sector); const load = sector.g + sector.l * .35 + Math.max(0, stats.grade) * 9; return `<tr><td>${index + 1}</td><td>${sector.type === 'climb' ? 'Subida' : 'Descida'}</td><td>${(sector.start / 1000).toFixed(1)}–${(sector.end / 1000).toFixed(1)}</td><td>${stats.length.toFixed(1)} km</td><td class="up">+${sector.g} m</td><td class="dn">−${sector.l} m</td><td>${stats.grade >= 0 ? '+' : ''}${stats.grade.toFixed(1)}%</td><td>${sector.peak >= 0 ? '+' : ''}${sector.peak.toFixed(1)}%</td><td>${number.format(load)}</td></tr>`; }).join('') : '<tr><td colspan="9">Nenhum setor contínuo relevante foi detectado.</td></tr>';
  const quality = metrics.quality;
  const qualityItems = [['Elevação', quality.missingElevation ? `${quality.missingElevation} pontos sem altitude` : 'Altitude disponível em todos os pontos', quality.missingElevation ? 'alert' : 'ok'], ['Variações bruscas', quality.elevationJumps ? `${quality.elevationJumps} saltos >30 m entre pontos` : 'Sem saltos verticais relevantes', quality.elevationJumps ? 'alert' : 'ok'], ['Timestamps', quality.hasTime ? 'Horários presentes no GPX' : 'Sem horários; análise de ritmo indisponível', quality.hasTime ? 'ok' : 'neutral']];
  document.getElementById('qualityReport').innerHTML = qualityItems.map(([title, text, state]) => `<article class="quality-item ${state}"><strong>${title}</strong><span>${text}</span></article>`).join('');
}

function analyzeActivity(rawPoints, fileName) {
  const points = rawPoints.filter((point) => Number.isFinite(point.t)).map((point) => ({ ...point }));
  let distance = 0; const segments = []; const byGrade = [{ label: 'Descida', min: -Infinity, max: -5, seconds: 0, distance: 0 }, { label: 'Plano', min: -5, max: 5, seconds: 0, distance: 0 }, { label: 'Subida', min: 5, max: 15, seconds: 0, distance: 0 }, { label: 'Subida forte', min: 15, max: Infinity, seconds: 0, distance: 0 }];
  points.forEach((point, index) => { if (index && !point.breakBefore) { const segmentDistance = haversine(points[index - 1], point); const seconds = (point.t - points[index - 1].t) / 1000; distance += segmentDistance; if (seconds > 0 && segmentDistance > 2) { const pace = seconds / (segmentDistance / 1000); if (pace >= 120 && pace <= 3600) segments.push({ d: distance / 1000, pace, grade: (point.e - points[index - 1].e) / segmentDistance * 100, seconds, distance: segmentDistance }); } } point.d = distance; });
  segments.forEach((segment) => { const bucket = byGrade.find((item) => segment.grade >= item.min && segment.grade < item.max); if (bucket) { bucket.seconds += segment.seconds; bucket.distance += segment.distance; } });
  const elapsed = points.length > 1 ? (points.at(-1).t - points[0].t) / 1000 : null;
  const moving = segments.reduce((total, segment) => total + segment.seconds, 0);
  return { fileName, points, segments, byGrade, distanceKm: distance / 1000, elapsed, moving, averagePace: moving && distance ? moving / (distance / 1000) : null };
}

function drawActivityChart() {
  if (!activityAnalysis?.segments.length) return;
  const canvas = document.getElementById('activityC'); const width = canvas.parentElement.getBoundingClientRect().width; if (!width) return;
  const height = 280; const dpr = window.devicePixelRatio || 1; const ctx = canvas.getContext('2d'); canvas.width = width * dpr; canvas.height = height * dpr; canvas.style.height = `${height}px`; ctx.scale(dpr, dpr);
  const segments = activityAnalysis.segments; const paces = segments.map((segment) => segment.pace); const minPace = Math.floor(Math.min(...paces) / 60) * 60; const maxPace = Math.ceil(Math.max(...paces) / 60) * 60; const padding = { t: 20, r: 14, b: 32, l: 46 }; const chartWidth = width - padding.l - padding.r; const chartHeight = height - padding.t - padding.b; const x = (d) => padding.l + d / activityAnalysis.distanceKm * chartWidth; const y = (pace) => padding.t + (pace - minPace) / Math.max(1, maxPace - minPace) * chartHeight;
  [0, .5, 1].forEach((ratio) => { const pace = minPace + ratio * (maxPace - minPace); const lineY = y(pace); ctx.strokeStyle = '#1d3326'; ctx.beginPath(); ctx.moveTo(padding.l, lineY); ctx.lineTo(width - padding.r, lineY); ctx.stroke(); ctx.fillStyle = '#657d6b'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'right'; ctx.fillText(`${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, '0')}`, padding.l - 5, lineY + 3); });
  ctx.beginPath(); segments.forEach((segment, index) => index ? ctx.lineTo(x(segment.d), y(segment.pace)) : ctx.moveTo(x(segment.d), y(segment.pace))); ctx.strokeStyle = '#56ce79'; ctx.lineWidth = 2; ctx.stroke();
}

function renderActivity() {
  if (!activityAnalysis) return;
  const hasTime = Boolean(activityAnalysis.elapsed && activityAnalysis.averagePace);
  const gradePaces = activityAnalysis.byGrade.filter((bucket) => bucket.distance > 0).map((bucket) => `<div><span>${bucket.label}</span><strong>${formatPace(bucket.seconds / (bucket.distance / 1000))} /km</strong></div>`).join('');
  document.getElementById('activitySummary').innerHTML = `<div><span>Rota planejada</span><strong>${decimal.format(metrics.distanceKm)} km</strong></div><div><span>Atividade gravada</span><strong>${decimal.format(activityAnalysis.distanceKm)} km</strong></div><div><span>Tempo total</span><strong>${hasTime ? timeLabel(activityAnalysis.elapsed) : 'Sem timestamps'}</strong></div><div><span>Pace em movimento</span><strong>${hasTime ? `${formatPace(activityAnalysis.averagePace)} /km` : 'Indisponível'}</strong></div>${gradePaces}`;
}

async function loadActivity(file) {
  if (!file) return;
  const status = document.getElementById('activityStatus');
  if (!hasLoadedGpx) { status.textContent = 'Carregue primeiro o GPX do percurso para comparar uma atividade.'; return; }
  if (!file.name.toLowerCase().endsWith('.gpx')) { status.textContent = 'Escolha um GPX de atividade.'; return; }
  try { activityAnalysis = analyzeActivity(parseGpx(await file.text()), file.name); status.textContent = activityAnalysis.elapsed ? `Atividade ${file.name} pronta para comparação.` : `Atividade carregada, mas sem timestamps para análise de ritmo.`; setupTabs(); renderActivity(); }
  catch (error) { status.textContent = error.message; }
}

function setupUpload() {
  const input = document.getElementById('gpxFile'); const zone = document.getElementById('dropZone'); const activity = document.getElementById('activityFile');
  input.addEventListener('change', () => loadGpx(input.files[0])); activity.addEventListener('change', () => loadActivity(activity.files[0]));
  ['dragenter', 'dragover'].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.remove('is-dragging'); }));
  zone.addEventListener('drop', (event) => loadGpx(event.dataTransfer.files[0]));
}

function setupTabs() {
  const tabs = [['geral', 'Visão geral'], ['alt', 'Altimetria'], ['splits', 'Splits por km'], ['grad', 'Gradiente'], ['carga', 'Carga'], ['insights', 'Insights'], ['strat', 'Estratégia']];
  if (activityAnalysis) tabs.push(['comparison', 'Comparação']);
  if (hasLoadedGpx) tabs.push(['briefing', 'Briefing']);
  const navigation = document.getElementById('tabNav'); navigation.innerHTML = '';
  tabs.forEach(([id, label], index) => { const button = document.createElement('button'); button.dataset.tab = id; button.className = `tab${index === 0 ? ' on' : ''}`; button.textContent = label; button.addEventListener('click', () => { document.querySelectorAll('.tpan').forEach((panel) => panel.classList.remove('on')); document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('on')); document.getElementById(`tab-${id}`).classList.add('on'); button.classList.add('on'); if (id === 'alt') { drawElevation(); drawVerticalLoadChart(); } if (id === 'grad') { drawGradientChart(); drawGradientVolatility(); } if (id === 'carga') drawEffortChart(); if (id === 'insights') { drawGradientHistogram(); drawCumulativeChart(); } if (id === 'comparison') drawActivityChart(); if (id === 'geral') setTimeout(() => routeMap.invalidateSize(), 0); }); navigation.appendChild(button); });
}

document.addEventListener('vertex:ready', () => {
  document.body.classList.remove('has-route');
  setupTabs(); setupUpload(); setupCoachControls(); populateProfile();
});
