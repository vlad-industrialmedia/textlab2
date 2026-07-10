// app.js — Textlab v5
const $ = (id) => document.getElementById(id);
let state = { text: '', analysis: null, activeSeg: null, filter: 'all', pins: [] };
// pins: [{start, end, text}] — закріплені фрагменти (offset у markdown-тексті)

const M = () => window.METRICS_META;
const ORDER = () => window.METRICS_ORDER;
const HL = () => window.HIGHLIGHT_META;

const KEY_HINTS = {
  gemini: 'Ключ: aistudio.google.com → Get API key. Безкоштовно, без картки.',
  openrouter: 'Ключ: openrouter.ai/keys. Моделі з «:free» безкоштовні.',
  anthropic: 'Ключ: console.anthropic.com. Платно.',
  groq: 'Ключ: console.groq.com. Безкоштовно, показує ліміти.',
};

// ── Креди ─────────────────────────────────────────────────────────
function currentModel() {
  const sel = $('modelSelect').value;
  return sel === '__custom__' ? $('modelCustom').value.trim() : sel;
}
function creds() { return { provider: $('provider').value, apiKey: $('apiKey').value.trim(), model: currentModel() }; }
function saveCreds() {
  localStorage.setItem('textlab_creds', JSON.stringify({
    provider: $('provider').value, apiKey: $('apiKey').value,
    model: $('modelSelect').value, modelCustom: $('modelCustom').value,
  }));
}
function fillModels(provider, selected) {
  const list = window.PROVIDER_MODELS[provider] || [];
  let html = list.map(m => `<option value="${m.id}">${m.label}</option>`).join('');
  html += `<option value="__custom__">Інша (вписати)…</option>`;
  $('modelSelect').innerHTML = html;
  if (selected && [...$('modelSelect').options].some(o => o.value === selected)) $('modelSelect').value = selected;
  toggleCustomModel();
}
function toggleCustomModel() { $('modelCustom').style.display = $('modelSelect').value === '__custom__' ? 'block' : 'none'; }
function loadCreds() {
  const c = JSON.parse(localStorage.getItem('textlab_creds') || '{}');
  if (c.provider) $('provider').value = c.provider;
  fillModels($('provider').value, c.model);
  if (c.apiKey) $('apiKey').value = c.apiKey;
  if (c.modelCustom) $('modelCustom').value = c.modelCustom;
  updateKeyHint();
}
function updateKeyHint() { $('keyHint').textContent = KEY_HINTS[$('provider').value] || ''; }
$('provider').addEventListener('change', () => { updateKeyHint(); fillModels($('provider').value); saveCreds(); $('validateStatus').textContent=''; });
$('modelSelect').addEventListener('change', () => { toggleCustomModel(); saveCreds(); });
['apiKey', 'modelCustom'].forEach(id => $(id).addEventListener('change', saveCreds));

// ── Перевірка ключа ───────────────────────────────────────────────
$('validateBtn').addEventListener('click', async () => {
  if (!$('apiKey').value.trim()) return setValidate('Введіть ключ', 'err');
  const btn = $('validateBtn'); btn.disabled = true; setValidate('перевірка…');
  try {
    const r = await api('validate', {});
    if (r.ok) setValidate(`✓ працює (${r.latencyMs} мс)`, 'ok');
    else setValidate('✗ ' + (r.error || 'не працює'), 'err');
  } catch (e) { setValidate('✗ ' + e.message, 'err'); }
  finally { btn.disabled = false; }
});
function setValidate(msg, cls) { const s = $('validateStatus'); s.textContent = msg; s.className = 'status' + (cls === 'ok' ? ' ok' : cls === 'err' ? ' err' : ''); }

// ── helpers ───────────────────────────────────────────────────────
function keywords() { return $('seoKeywords').value.split(',').map(s => s.trim()).filter(Boolean); }
function seed() { return $('seedKeyword').value.trim(); }
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function editorText() { return window.getEditorMarkdown($('editor')); }

async function api(path, body, signal) {
  const res = await fetch('/api/' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, creds: creds() }), signal,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Помилка ' + res.status);
  return data;
}
function toast(msg, ms = 2600) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }

// ── Тулбар редактора ──────────────────────────────────────────────
document.querySelectorAll('.tb-btn').forEach(btn => {
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const cmd = btn.dataset.cmd;
    const map = { h1: 'H1', h2: 'H2', h3: 'H3', p: 'P' };
    if (map[cmd]) document.execCommand('formatBlock', false, map[cmd]);
    else if (cmd === 'bold') document.execCommand('bold');
    else if (cmd === 'ul') document.execCommand('insertUnorderedList');
    else if (cmd === 'ol') document.execCommand('insertOrderedList');
    $('editor').focus();
  });
});
// Вставка як чистий текст (без чужих стилів)
$('editor').addEventListener('paste', (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});

// ── Tabs ──────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    ['editor', 'render', 'simulate'].forEach(n => $('tab-' + n).style.display = n === tab.dataset.tab ? 'block' : 'none');
    if (tab.dataset.tab === 'render') { renderFilter(); renderLegend(); renderMap(); }
  });
});

// ── Analyze ───────────────────────────────────────────────────────
let analyzeController = null, timerInterval = null;
$('analyzeBtn').addEventListener('click', async () => {
  const text = editorText();
  if (!text.trim()) return toast('Введіть текст');
  if (!$('apiKey').value.trim()) return toast('Введіть API-ключ ліворуч');
  if (text.split(/\s+/).length < 40) toast('Порада: на текстах <40 слів метрики нестабільні');

  const btn = $('analyzeBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Аналіз…';
  $('cancelBtn').style.display = 'inline-block'; setStatus(''); startTimer();
  analyzeController = new AbortController();
  try {
    const data = await api('analyze', { text, seoKeywords: keywords(), seedKeyword: seed() }, analyzeController.signal);
    state.text = text; state.analysis = data; state.filter = 'all';
    applyPinsToHighlights();
    renderMetrics(data); renderInspectorOverview(data); renderFilter(); renderLegend(); renderMap();
    renderRateLimit(data.rateLimit); saveHistory(text, data);
    if (data.llmError) setStatus('Статистика готова; семантика недоступна: ' + data.llmError, true);
    else setStatus('Готово · ' + data.segments.length + ' сегментів · ' + creds().provider);
    document.querySelector('.tab[data-tab="render"]').click();
  } catch (e) {
    if (e.name === 'AbortError') setStatus('Аналіз перервано', true);
    else { toast(e.message); setStatus(e.message, true); }
  } finally { stopTimer(); btn.disabled = false; btn.textContent = 'Проаналізувати'; $('cancelBtn').style.display = 'none'; analyzeController = null; }
});
$('cancelBtn').addEventListener('click', () => { if (analyzeController) analyzeController.abort(); });
function setStatus(msg, err) { const s = $('statusMsg'); s.textContent = msg; s.className = 'status' + (err ? ' err' : ''); }
function startTimer() { const t0 = Date.now(); $('timer').textContent = '0.0 с'; timerInterval = setInterval(() => $('timer').textContent = ((Date.now()-t0)/1000).toFixed(1)+' с', 100); }
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } setTimeout(() => $('timer').textContent = '', 2000); }

$('clearBtn').addEventListener('click', () => {
  $('editor').innerHTML = ''; state = { text: '', analysis: null, activeSeg: null, filter: 'all', pins: [] };
  $('metrics').innerHTML = ''; $('docRender').innerHTML = ''; $('inspContent').innerHTML = '';
  $('filterRow').innerHTML = ''; $('inspEmpty').style.display = 'block'; $('ratelimit').style.display = 'none';
});

// ── Метрики (усі клікабельні там, де є підсвітка) ────────────────
function renderMetrics(d) {
  $('metrics').innerHTML = ORDER().map(k => {
    const meta = M()[k]; const v = d[k];
    const empty = (v === null || v === undefined);
    const cls = empty ? '' : window.zoneClass(k, v, meta);
    const clickable = (!empty && meta.highlightType) ? 'clickable' : '';
    return `<div class="metric ${cls} ${clickable}" data-key="${k}" ${meta.highlightType?`data-hl="${meta.highlightType}"`:''}>
      <div class="m-help">?</div><div class="m-label">${esc(meta.label)}</div>
      ${empty ? `<div class="m-val m-empty">—</div>` : `<div class="m-val">${v}${meta.unit||''}</div><div class="m-bar"><span style="width:${Math.min(100,v)}%"></span></div>`}
    </div>`;
  }).join('');
  document.querySelectorAll('.metric').forEach(el => {
    el.addEventListener('mouseenter', (e) => showTooltip(el.dataset.key, e));
    el.addEventListener('mousemove', moveTooltip);
    el.addEventListener('mouseleave', hideTooltip);
    if (el.classList.contains('clickable')) el.addEventListener('click', () => { state.filter = el.dataset.hl; document.querySelector('.tab[data-tab="render"]').click(); });
  });
}
function showTooltip(key, e) { const meta = M()[key]; if (!meta) return; const tt = $('tooltip'); tt.innerHTML = `<div class="tt-title">${esc(meta.label)}</div><div>${esc(meta.tip)}</div><div class="tt-zones">${esc(meta.zones)}</div>`; tt.style.display = 'block'; moveTooltip(e); }
function moveTooltip(e) { const tt = $('tooltip'); if (tt.style.display === 'none') return; tt.style.left = Math.min(e.clientX+14, window.innerWidth-320)+'px'; tt.style.top = Math.min(e.clientY+14, window.innerHeight-160)+'px'; }
function hideTooltip() { $('tooltip').style.display = 'none'; }

// ── Фільтр ────────────────────────────────────────────────────────
function renderFilter() {
  if (!state.analysis) { $('filterRow').innerHTML = ''; return; }
  const counts = {};
  (state.analysis.highlights || []).forEach(h => { if (h.type && h.type !== 'clean') counts[h.type] = (counts[h.type]||0)+1; });
  const present = Object.keys(HL()).filter(t => counts[t] || t === 'pinned');
  let html = `<span class="fl-label">показати:</span><button class="filter-btn ${state.filter==='all'?'active':''}" data-f="all">усі</button>`;
  for (const t of present) html += `<button class="filter-btn ${state.filter===t?'active':''}" data-f="${t}">${esc(HL()[t].label)} <span class="hi-count">${counts[t]||0}</span></button>`;
  $('filterRow').innerHTML = html;
  document.querySelectorAll('.filter-btn').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.f; renderFilter(); renderMap(); }));
}
function renderLegend() { $('legend').innerHTML = Object.values(HL()).map(v => `<span><i style="background:${v.color}"></i>${esc(v.label)}</span>`).join(''); }

// ── Карта (по offset) ─────────────────────────────────────────────
function renderMap() {
 if (!state.analysis) { $('docRender').innerHTML = 'Немає даних.'; return; }
 const { segments, highlights } = state.analysis;
 const hlMap = {}; (highlights || []).forEach(h => hlMap[h.id] = h);
 let html = ''; let cursor = 0; const text = state.text;
 
 for (const seg of segments) {
   if (seg.startOffset > cursor) html += esc(text.slice(cursor, seg.startOffset));
   const h = hlMap[seg.id];
   let type = h && h.type && h.type !== 'clean' ? h.type : '';
   if (state.filter !== 'all' && type !== state.filter) type = '';
   
   // === ДОДАВАННЯ ПІДКАЗКИ ПРИ НАВЕДЕННІ ===
   let tooltipText = '';
   if (h && h.type !== 'clean') {
     const meta = HL()[h.type] || {};
     tooltipText = (meta.label || h.type) + ': ' + (h.details || meta.desc || '');
   }
   
   html += `<span class="seg ${type}" data-id="${seg.id}" title="${esc(tooltipText)}">${esc(text.slice(seg.startOffset, seg.endOffset))}</span>`;
   cursor = seg.endOffset;
 }
 if (cursor < text.length) html += esc(text.slice(cursor));
 $('docRender').innerHTML = html;
 document.querySelectorAll('.seg').forEach(el => el.addEventListener('click', () => selectSegment(el.dataset.id)));
}

// ── Інспектор сегмента ────────────────────────────────────────────
function selectSegment(id) {
  state.activeSeg = id;
  document.querySelectorAll('.seg').forEach(e => e.classList.toggle('active', e.dataset.id === id));
  const d = state.analysis;
  const h = (d.highlights || []).find(x => x.id === id);
  const seg = d.segments.find(x => x.id === id);
  $('inspEmpty').style.display = 'none';
  if (!h || h.type === 'clean') {
    $('inspContent').innerHTML = `<div class="card"><h3><span class="seg-id">${id}</span></h3><div class="details">Проблем не виявлено.</div><div style="font-size:13px;color:var(--ink-dim)">"${esc(seg.text)}"</div></div>`;
    return;
  }
  const meta = HL()[h.type] || {};
  const isPositive = h.type === 'citation' || h.type === 'pinned';
  const sugg = (h.suggestions || []).map((s, i) => `<div class="suggestion">${esc(s)}<div class="s-actions"><button class="btn btn-sm" onclick="applyRewrite('${id}',${i})">Застосувати</button></div></div>`).join('');
  $('inspContent').innerHTML = `<div class="card">
    <h3><span class="tag ${h.type}">${esc(meta.label||h.type)}</span><span class="seg-id">${id}${h.issue?' · '+esc(h.issue):''}</span></h3>
    <div style="font-size:11px;color:var(--ink-faint);margin-bottom:8px">${esc(meta.desc||'')}</div>
    <div class="details">${esc(h.details || '')}</div>
    <div style="font-size:12px;color:var(--ink-dim);margin-bottom:10px;padding:8px;background:var(--bg);border-radius:6px">"${esc(seg.text)}"</div>
    ${sugg || ''}
    ${!isPositive ? `<div class="btn-row" style="margin-top:6px"><button class="btn btn-ghost btn-sm" onclick="rewriteSegment('${id}')">Переписати через ШІ</button></div>` : ''}
  </div>`;
}

window.applyRewrite = function (id, sIdx) {
  const h = state.analysis.highlights.find(x => x.id === id);
  const seg = state.analysis.segments.find(x => x.id === id);
  replaceSegmentByOffset(seg, h.suggestions[sIdx]);
};
window.rewriteSegment = async function (id) {
  const seg = state.analysis.segments.find(x => x.id === id);
  if (isPinned(seg.startOffset, seg.endOffset)) return toast('Фрагмент закріплено — рерайт вимкнено');
  toast('Переписую…');
  try {
    const r = await api('rewrite', { text: seg.text, seoKeywords: keywords(), goal: 'humanize' });
    if (!r.applied) return toast(r.reason || 'Рерайт відхилено');
    replaceSegmentByOffset(seg, r.rewritten);
    toast('Замінено' + (r.retried ? ' (з 2-ї спроби)' : ''));
  } catch (e) { toast(e.message); }
};

// Локальна заміна по offset + локальний перерахунок дешевих метрик (без нового API-виклику)
function replaceSegmentByOffset(seg, replacement) {
  const before = state.text.slice(0, seg.startOffset), after = state.text.slice(seg.endOffset);
  state.text = before + replacement + after;
  window.setEditorMarkdown($('editor'), state.text);
  const delta = replacement.length - (seg.endOffset - seg.startOffset);
  seg.text = replacement; seg.endOffset = seg.startOffset + replacement.length;
  for (const s of state.analysis.segments) if (s.startOffset > seg.startOffset) { s.startOffset += delta; s.endOffset += delta; }
  // зсув закріплень
  for (const p of state.pins) if (p.start > seg.startOffset) { p.start += delta; p.end += delta; }
  const h = state.analysis.highlights.find(x => x.id === seg.id);
  if (h) { h.type = 'clean'; }
  recomputeLocalMetrics();
  renderMap(); renderFilter();
  toast('Оновлено. Метрики ритму перераховано локально; для GEO/логіки — повторний аналіз');
}

// Дешевий локальний перерахунок: ритм, читабельність (без LLM, без API)
function recomputeLocalMetrics() {
  const segs = state.analysis.segments;
  const lens = segs.map(s => (s.text.match(/[A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9]+/gu)||[]).length).filter(l => l>0);
  if (lens.length < 2) return;
  const m = lens.reduce((a,b)=>a+b,0)/lens.length;
  const sd = Math.sqrt(lens.reduce((a,b)=>a+(b-m)**2,0)/(lens.length-1));
  const cv = m>0 ? sd/m : 0;
  state.analysis.burstinessScore = Math.max(0, Math.min(100, Math.round(cv*130)));
  const avg = m;
  let r = 100; if (avg>20) r -= (avg-20)*2; r -= (state.analysis.passiveDensity||0)*0.3;
  state.analysis.readability = Math.max(0, Math.min(100, Math.round(r)));
  renderMetrics(state.analysis);
}

// ── Закріплення фрагментів ────────────────────────────────────────
function isPinned(start, end) { return state.pins.some(p => start < p.end && end > p.start); }
function applyPinsToHighlights() {
  if (!state.analysis) return;
  for (const seg of state.analysis.segments) {
    if (isPinned(seg.startOffset, seg.endOffset)) {
      let h = state.analysis.highlights.find(x => x.id === seg.id);
      if (!h) { h = { id: seg.id, suggestions: [] }; state.analysis.highlights.push(h); }
      h.type = 'pinned'; h.details = 'Фрагмент закріплено — рерайт і авто-заміна його не змінюють.';
    }
  }
}
// Виділення тексту в карті → попап «Закріпити»
document.addEventListener('mouseup', (e) => {
  const pop = $('selPop');
  const sel = window.getSelection();
  const doc = $('docRender');
  if (!state.analysis || !doc.contains(sel.anchorNode) || sel.isCollapsed) { pop.style.display = 'none'; return; }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  pop.style.display = 'block';
  pop.style.left = Math.min(rect.left, window.innerWidth-140) + 'px';
  pop.style.top = (rect.top - 44) + 'px';
});
$('pinBtn').addEventListener('click', () => {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const selected = sel.toString();
  if (!selected.trim()) return;
  // знаходимо offset у markdown-тексті
  const idx = state.text.indexOf(selected);
  if (idx === -1) { toast('Не вдалося прив’язати виділення'); return; }
  const start = idx, end = idx + selected.length;
  // запобігання конфліктам: об’єднуємо з перетином
  const overlapping = state.pins.filter(p => start < p.end && end > p.start);
  const others = state.pins.filter(p => !(start < p.end && end > p.start));
  const ns = Math.min(start, ...overlapping.map(p=>p.start));
  const ne = Math.max(end, ...overlapping.map(p=>p.end));
  state.pins = [...others, { start: ns, end: ne, text: state.text.slice(ns, ne) }];
  applyPinsToHighlights(); renderMap(); renderFilter();
  $('selPop').style.display = 'none'; sel.removeAllRanges();
  toast('Закріплено ' + state.pins.length + ' фрагмент(ів)');
});

// ── Оглядовий інспектор ───────────────────────────────────────────
function renderInspectorOverview(d) {
 $('inspEmpty').style.display = 'none';
 let html = '';
 
 if (d.aiFingerprints && d.aiFingerprints.length) {
   html += `<h3>ШІ-маркери</h3>` + d.aiFingerprints.map(f => {
     // === МАПІНГ МАРКЕРІВ НА ТИПИ ПІДСВІТКИ ДЛЯ КЛІКАБЕЛЬНОСТІ ===
     let hlType = 'ai';
     if (f.marker.includes('Burstiness')) hlType = 'rhythm';
     else if (f.marker.includes('Predictable')) hlType = 'predictable';
     else if (f.marker.includes('Passive')) hlType = 'ai';
     else if (f.marker.includes('Transition')) hlType = 'ai';
     
     return `<span class="fingerprint clickable" data-hl="${hlType}" style="cursor:pointer; text-decoration:underline;">${esc(f.marker)} <span class="severity">${f.severity}</span></span>`;
   }).join('') + `<div class="clear"></div>`;
 }
 
 if (d.queryCoverage && (d.queryCoverage.covered?.length || d.queryCoverage.missing?.length)) html += `
 <h3>Query Fan-Out</h3>
 ${(d.queryCoverage.covered||[]).map(q=>`<div>✓ ${esc(q)}</div>`).join('')}
 ${(d.queryCoverage.missing||[]).map(q=>`<div>+ ${esc(q)}</div>`).join('')}
 `;
 
 if (d.entities && d.entities.missing?.length) html += `
 <h3>Бракує сутностей</h3>
 ${d.entities.missing.map(e=>`<div>${esc(e)}</div>`).join('')}
 `;
 
 if (d.aiCitationSnippets && d.aiCitationSnippets.length) html += `
 <h3>Готові сніпети для цитування</h3>
 ` + d.aiCitationSnippets.map(s=>`<div class="snippet">"${esc(s)}"</div>`).join('') + `
 `;
 
 if (d.recommendations && d.recommendations.length) html += `
 <h3>Рекомендації</h3>
 ` + d.recommendations.map(r => { 
   const imp = r.expectedImpact ? Object.entries(r.expectedImpact).map(([k,v])=>`${k} ${v}`).join(' · ') : ''; 
   return `<div class="rec"><strong>${esc(r.title||'')}</strong><div>${esc(r.description||'')}</div>${imp?`<div class="impact">${esc(imp)}</div>`:''}</div>`; 
 }).join('') + `
 `;
 
 $('inspContent').innerHTML = html || '<p>Аналіз завершено, критичних зауважень немає.</p>';

 // === ОБРОБКА КЛІКІВ ПО ШІ-МАРКЕРАХ ===
 document.querySelectorAll('.fingerprint.clickable').forEach(el => {
   el.addEventListener('click', () => {
     state.filter = el.dataset.hl;
     document.querySelector('.tab[data-tab="render"]').click();
   });
 });
}

// ── Лічильник лімітів ─────────────────────────────────────────────
function renderRateLimit(rl) {
  const el = $('ratelimit');
  if (!rl || (!rl.remainingRequests && !rl.remainingTokens)) {
    if (creds().provider === 'gemini') { el.style.display = 'block'; el.innerHTML = `<div class="rl-title">Ліміти · gemini</div>Gemini не віддає лічильник через API. Дивіться у <b>aistudio.google.com</b> (безкошт. тир скидається щодня).`; }
    else el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  const parts = [`<div class="rl-title">Ліміти · ${esc(rl.provider||'')}</div>`];
  if (rl.remainingRequests) parts.push(`Запитів лишилось: <b>${esc(rl.remainingRequests)}</b>`);
  if (rl.remainingTokens) parts.push(`Токенів: <b>${esc(rl.remainingTokens)}</b>`);
  if (rl.resetRequests) parts.push(`Оновлення: ${esc(rl.resetRequests)}`);
  el.innerHTML = parts.join('<br>');
}

// ── ШІ-пошук ──────────────────────────────────────────────────────
$('simBtn').addEventListener('click', async () => {
  const q = $('simQuery').value.trim();
  if (!q) return toast('Введіть запит');
  if (!state.text) return toast('Спершу проаналізуйте текст');
  const btn = $('simBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Симуляція…';
  try {
    const r = await api('simulate', { text: state.text, query: q });
    $('simResult').innerHTML = `<div class="card"><h3>Відповідь ШІ-пошуку</h3><div class="details">${esc(r.answer||'')}</div></div>${r.missingData?.length?`<div class="card"><h3>Чого бракує</h3>${r.missingData.map(m=>`<span class="chip miss">${esc(m)}</span>`).join('')}</div>`:''}<div class="metric good" style="max-width:220px"><div class="m-label">Готовність до видачі</div><div class="m-val">${r.readinessScore??'—'}</div></div>`;
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Перевірити у ШІ-пошуку'; }
});

// ── Проєкт ────────────────────────────────────────────────────────
$('saveProjectBtn').addEventListener('click', () => {
  if (!state.analysis) return toast('Немає що зберігати');
  const proj = { version: 5, ts: new Date().toISOString(), text: state.text, analysis: state.analysis, pins: state.pins, seoKeywords: $('seoKeywords').value, seedKeyword: $('seedKeyword').value };
  downloadFile(JSON.stringify(proj, null, 2), 'textlab-project.json', 'application/json'); toast('Проєкт збережено');
});
$('loadProjectBtn').addEventListener('click', () => $('loadProjectInput').click());
$('loadProjectInput').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const proj = JSON.parse(reader.result);
      state.text = proj.text; state.analysis = proj.analysis; state.pins = proj.pins || []; state.filter = 'all';
      window.setEditorMarkdown($('editor'), proj.text);
      if (proj.seoKeywords) $('seoKeywords').value = proj.seoKeywords;
      if (proj.seedKeyword) $('seedKeyword').value = proj.seedKeyword;
      renderMetrics(proj.analysis); renderInspectorOverview(proj.analysis); renderFilter(); renderLegend(); renderMap();
      toast('Проєкт завантажено');
    } catch (err) { toast('Помилка читання файлу'); }
  };
  reader.readAsText(file);
});
$('exportHtmlBtn').addEventListener('click', () => {
  if (!state.analysis) return toast('Немає що експортувати');
  downloadFile(window.buildHtmlReport(state.text, state.analysis), 'textlab-report.html', 'text/html'); toast('HTML-звіт збережено');
});
function downloadFile(content, name, type) { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

// ── Історія ───────────────────────────────────────────────────────
function saveHistory(text, data) {
  const hist = JSON.parse(localStorage.getItem('textlab_history') || '[]');
  hist.unshift({ id: Date.now(), ts: new Date().toISOString(), preview: text.replace(/[#*-]/g,'').slice(0, 60), aiScore: data.aiScore, text, analysis: data });
  localStorage.setItem('textlab_history', JSON.stringify(hist.slice(0, 30))); renderHistory();
}
function renderHistory() {
  const hist = JSON.parse(localStorage.getItem('textlab_history') || '[]');
  $('history').innerHTML = hist.map(h => `<div class="history-item" onclick="loadHistory(${h.id})">${esc(h.preview)}…<div class="hi-meta"><span>${new Date(h.ts).toLocaleString('uk')}</span><span class="hi-score">AI ${h.aiScore}%</span></div></div>`).join('') || '<div style="font-size:12px;color:var(--ink-faint)">Порожньо</div>';
}
window.loadHistory = function (id) {
  const hist = JSON.parse(localStorage.getItem('textlab_history') || '[]');
  const item = hist.find(h => h.id === id); if (!item) return;
  window.setEditorMarkdown($('editor'), item.text); state.text = item.text; state.analysis = item.analysis; state.pins = []; state.filter = 'all';
  renderMetrics(item.analysis); renderInspectorOverview(item.analysis); renderFilter(); renderLegend(); renderMap();
  toast('Завантажено з історії');
};

loadCreds(); renderHistory();
