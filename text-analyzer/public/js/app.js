// app.js — головний контролер інтерфейсу.

const $ = id => document.getElementById(id);
const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const state = {
 text: '',
 analysis: null,
 selectedId: null,
 filter: 'all',
 pins: [],
 seoKeywords: [],
 creds: {}
};

function init() {
 const editor = $('editor');
  // === ЗАВАНТАЖЕННЯ API КЛЮЧА ===
  const apiKeyInput = $('apiKey'); // <-- Если у тебя input называется по-другому, замени 'apiKey' на правильный id
  if (apiKeyInput) {
    const loadKey = () => {
      state.creds.groqApiKey = apiKeyInput.value;
    };
    apiKeyInput.addEventListener('input', loadKey);
    
    // Загрузка из localStorage, если ключ сохранялся
    const savedKey = localStorage.getItem('groqApiKey');
    if (savedKey) {
      apiKeyInput.value = savedKey;
      state.creds.groqApiKey = savedKey;
    } else {
      loadKey(); // Загрузить из input, если в localStorage нет
    }
    
    // Сохранение в localStorage при изменении
    apiKeyInput.addEventListener('change', () => {
      localStorage.setItem('groqApiKey', apiKeyInput.value);
    });
  }
 
 state.text = editor.innerText || '';
 
 // === ПЕРЕХВАТ ВСТАВКИ (PASTE) ===
 editor.addEventListener('paste', (e) => {
   e.preventDefault();
   const html = e.clipboardData.getData('text/html');
   const text = e.clipboardData.getData('text/plain');
   
   let cleanHtml = text;
   if (html) {
     cleanHtml = window.sanitizePastedHtml ? window.sanitizePastedHtml(html) : text;
   }
   
   // Вставляємо очищений HTML
   const selection = window.getSelection();
   if (selection.rangeCount) {
     const range = selection.getRangeAt(0);
     range.deleteContents();
     const temp = document.createElement('div');
     temp.innerHTML = cleanHtml;
     const frag = document.createDocumentFragment();
     let node, lastNode;
     while ((node = temp.firstChild)) {
       lastNode = frag.appendChild(node);
     }
     range.insertNode(frag);
     if (lastNode) {
       range = range.cloneRange();
       range.setStartAfter(lastNode);
       range.collapse(true);
       selection.removeAllRanges();
       selection.addRange(range);
     }
   }
   // Оновлюємо стан тексту
   state.text = editor.innerText;
 });

 editor.addEventListener('input', () => {
   state.text = editor.innerText;
 });

 document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
 $('btnAnalyze').addEventListener('click', runAnalysis);
 $('btnRewrite').addEventListener('click', runRewrite);
 $('btnPin').addEventListener('click', togglePin);
 
 // Завантаження ключів
 $('seoKeys').addEventListener('input', (e) => {
   state.seoKeywords = e.target.value.split(',').map(k => k.trim()).filter(Boolean);
 });

 renderMap();
 renderInspector();
}

async function runAnalysis() {
 $('btnAnalyze').disabled = true;
 $('btnAnalyze').innerText = 'Аналіз...';
 try {
   const res = await fetch('/api/analyze', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ text: state.text, seoKeywords: state.seoKeywords, creds: state.creds })
   });
   state.analysis = await res.json();
   renderMap();
   renderMetrics();
   renderInspector();
 } catch (e) {
   alert('Помилка аналізу: ' + e.message);
 } finally {
   $('btnAnalyze').disabled = false;
   $('btnAnalyze').innerText = 'Аналізувати';
 }
}

async function runRewrite() {
 if (!state.selectedId || !state.analysis) return alert('Оберіть фрагмент для рерайту.');
 
 const seg = state.analysis.segments.find(s => s.id === state.selectedId);
 if (!seg) return;
 
 const idx = state.analysis.segments.indexOf(seg);
 const prevCtx = idx > 0 ? state.analysis.segments[idx-1].text : '';
 const nextCtx = idx < state.analysis.segments.length - 1 ? state.analysis.segments[idx+1].text : '';

 $('btnRewrite').disabled = true;
 $('btnRewrite').innerText = 'Покращення...';
 
 try {
   const res = await fetch('/api/rewrite', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       segmentText: seg.text,
       prevContext: prevCtx,
       nextContext: nextCtx,
       seoKeywords: state.seoKeywords,
       creds: state.creds
     })
   });
   const data = await res.json();
   
   if (data.applied && data.rewrittenSegment) {
     // Замінюємо тільки цільовий фрагмент у тексті
     state.text = state.text.slice(0, seg.startOffset) + data.rewrittenSegment + state.text.slice(seg.endOffset);
     $('editor').innerText = state.text;
     await runAnalysis(); // Перезапускаємо аналіз для оновлення офсетів
   } else {
     alert(data.reason || 'Рерайт не застосовано.');
   }
 } catch (e) {
   alert('Помилка рерайту: ' + e.message);
 } finally {
   $('btnRewrite').disabled = false;
   $('btnRewrite').innerText = 'Покращити ШІ';
 }
}

function togglePin() {
 if (!state.selectedId) return;
 const idx = state.pins.indexOf(state.selectedId);
 if (idx > -1) {
   state.pins.splice(idx, 1);
 } else {
   state.pins.push(state.selectedId);
 }
 renderMap();
 renderInspector();
}

function selectSegment(id) {
 state.selectedId = id;
 document.querySelectorAll('.seg').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
 renderInspector();
}

function switchTab(tab) {
 document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
 $('viewRender').style.display = tab === 'render' ? 'block' : 'none';
 $('viewInspector').style.display = tab === 'inspector' ? 'block' : 'none';
}

function renderMetrics() {
 if (!state.analysis) return;
 const d = state.analysis;
 const meta = window.METRICS_META || {};
 const order = window.METRICS_ORDER || Object.keys(meta);
 
 let html = '';
 for (const key of order) {
   const m = meta[key];
   if (!m) continue;
   const val = d[key];
   if (val === null || val === undefined) continue;
   
   let color = '#58a6ff';
   if (m.direction === 'low') {
     if (val <= m.good) color = '#4dd0a7';
     else if (val <= m.warn) color = '#e3b341';
     else color = '#f85149';
   } else {
     if (val >= m.good) color = '#4dd0a7';
     else if (val >= m.warn) color = '#e3b341';
     else color = '#f85149';
   }
   
   html += `<div class="metric" title="${esc(m.tip || '')}\n\n${esc(m.zones || '')}" style="border-left: 4px solid ${color};">
     <div class="metric-label">${m.label}</div>
     <div class="metric-val" style="color:${color}">${Math.round(val)}${m.unit || ''}</div>
   </div>`;
 }
 $('metricsList').innerHTML = html;
}

function renderMap() {
 if (!state.analysis) { $('docRender').innerHTML = 'Немає даних.'; return; }
 const { segments, highlights } = state.analysis;
 const hlMap = {}; (highlights || []).forEach(h => hlMap[h.id] = h);
 let html = ''; let cursor = 0; const text = state.text;
 
 for (const seg of segments) {
   if (seg.startOffset > cursor) html += esc(text.slice(cursor, seg.startOffset));
   let h = hlMap[seg.id];
   let type = h && h.type && h.type !== 'clean' ? h.type : '';
   
   // Якщо є фільтр, показуємо тільки обраний тип
   if (state.filter !== 'all' && type !== state.filter && !state.pins.includes(seg.id)) type = '';
   if (state.pins.includes(seg.id)) type = 'pinned'; // Пріоритет піну
   if (state.filter !== 'all' && state.filter !== 'pinned' && state.pins.includes(seg.id) && type !== state.filter) type = 'pinned';

   let tooltipText = '';
   if (h && h.type !== 'clean') {
     const hlMeta = window.HIGHLIGHT_META || {};
     const meta = hlMeta[h.type] || {};
     tooltipText = (meta.label || h.type) + ': ' + (h.details || meta.desc || '');
   }
   if (state.pins.includes(seg.id)) tooltipText = 'Закріплений фрагмент. Клікніть "Відкріпити" в інспекторі.';
   
   const isSelected = seg.id === state.selectedId ? 'selected' : '';
   html += `<span class="seg ${type} ${isSelected}" data-id="${seg.id}" title="${esc(tooltipText)}">${esc(text.slice(seg.startOffset, seg.endOffset))}</span>`;
   cursor = seg.endOffset;
 }
 if (cursor < text.length) html += esc(text.slice(cursor));
 $('docRender').innerHTML = html;
 document.querySelectorAll('.seg').forEach(el => el.addEventListener('click', () => selectSegment(el.dataset.id)));
}

function renderInspector() {
 if (!state.analysis) {
   $('inspEmpty').style.display = 'block';
   $('inspContent').innerHTML = '';
   return;
 }
 $('inspEmpty').style.display = 'none';
 
 const d = state.analysis;
 
 // === ЛІЧНИКИ ТА ФІЛЬТРИ ===
 const counts = { ai: 0, rhythm: 0, predictable: 0, citation: 0, logic_flaw: 0, low_relevance: 0, low_geo: 0 };
 (d.highlights || []).forEach(h => { if (counts[h.type] !== undefined) counts[h.type]++; });
 counts['pinned'] = (state.pins || []).length;

 let legendHtml = '<div class="legend-grid">';
 const hlMeta = window.HIGHLIGHT_META || {};
 for (const [type, meta] of Object.entries(hlMeta)) {
   const count = counts[type] || 0;
   const isActive = state.filter === type ? 'active-filter' : '';
   legendHtml += `<div class="legend-item ${isActive}" data-type="${type}" style="border-left: 4px solid ${meta.color}; cursor:pointer;">
     <span>${meta.label}</span> <b>(${count})</b>
   </div>`;
 }
 // Додаємо "Скинути фільтр"
 if (state.filter !== 'all') {
   legendHtml += `<div class="legend-item" data-type="all" style="border-left: 4px solid #8b949e; cursor:pointer;">
     <span>Показати все</span>
   </div>`;
 }
 legendHtml += '</div>';

 // === ДЕТАЛІ ОБРАНОГО СЕГМЕНТА ===
 let detailsHtml = '';
 if (state.selectedId) {
   const seg = d.segments.find(s => s.id === state.selectedId);
   const h = (d.highlights || []).find(h => h.id === state.selectedId);
   const isPinned = state.pins.includes(state.selectedId);
   
   detailsHtml += `<div class="seg-details">
     <h3>Обраний фрагмент</h3>
     <p class="seg-text">"${esc(seg ? seg.text.slice(0, 100) + '...' : '')}"</p>
     <button id="btnPin" class="btn-action">${isPinned ? '📌 Відкріпити' : '📍 Закріпити'}</button>`;
     
   if (h && h.type !== 'clean') {
     const meta = hlMeta[h.type] || {};
     detailsHtml += `<div class="issue-block" style="border-left: 4px solid ${meta.color};">
       <strong>${meta.label || h.type}</strong>
       <p>${esc(h.details || meta.desc || '')}</p>
       ${(h.suggestions || []).length ? '<ul>' + h.suggestions.map(s => `<li>${esc(s)}</li>`).join('') + '</ul>' : ''}
     </div>`;
   }
   detailsHtml += `</div>`;
   
   // Перевішуємо обробник для кнопки Pin
   setTimeout(() => {
     const pinBtn = $('btnPin');
     if (pinBtn) pinBtn.addEventListener('click', togglePin);
   }, 0);
 }

 // === РЕКОМЕНДАЦІЇ ТА МАРКЕРИ ===
 let overviewHtml = '';
 if (d.aiFingerprints && d.aiFingerprints.length) {
   overviewHtml += `<h3>ШІ-маркери</h3>` + d.aiFingerprints.map(f => {
     let hlType = 'ai';
     if (f.marker.includes('Burstiness')) hlType = 'rhythm';
     else if (f.marker.includes('Predictable')) hlType = 'predictable';
     return `<span class="fingerprint clickable" data-hl="${hlType}" style="cursor:pointer; text-decoration:underline;">${esc(f.marker)} <span class="severity">${f.severity}</span></span>`;
   }).join('') + `<div class="clear"></div>`;
 }

 if (d.aiCitationSnippets && d.aiCitationSnippets.length) {
   overviewHtml += `<h3>Готові сніпети для цитування</h3>` + d.aiCitationSnippets.map(s=>`<div class="snippet">"${esc(s)}"</div>`).join('');
 }

 $('inspContent').innerHTML = legendHtml + detailsHtml + overviewHtml;

 // === ОБРОБКА КЛІКІВ ПО ФІЛЬТРАХ ===
 document.querySelectorAll('.legend-item').forEach(el => {
   el.addEventListener('click', () => {
     state.filter = el.dataset.type;
     renderMap();
     renderInspector();
   });
 });

 // === ОБРОБКА КЛІКІВ ПО МАРКЕРАХ ===
 document.querySelectorAll('.fingerprint.clickable').forEach(el => {
   el.addEventListener('click', () => {
     state.filter = el.dataset.hl;
     switchTab('render');
     renderMap();
     renderInspector();
   });
 });
}

document.addEventListener('DOMContentLoaded', init);
