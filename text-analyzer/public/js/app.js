// app.js — головний контролер інтерфейсу (v2.0 Full Fix)

const $ = id => document.getElementById(id);
const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const state = {
  text: '',
  analysis: null,
  selectedId: null,
  filter: 'all',
  pins: [],
  seoKeywords: [],
  creds: {} // Сюда будет загружаться API ключ
};

function init() {
  const editor = $('editor');
  if (!editor) return console.error('Editor element not found');
  
  state.text = editor.innerText || '';

  // === 1. ЗАВАНТАЖЕННЯ API КЛЮЧА (FIXED) ===
  // Пытаемся найти input по всем возможным ID
  const apiKeyInput = $('apiKey') || $('groqKey') || $('api-key') || $('key') || document.querySelector('input[type="password"]');
  
  if (apiKeyInput) {
    const loadKey = () => {
      const key = apiKeyInput.value.trim();
      state.creds.groqApiKey = key;
      // Также дублируем в другие возможные поля для совместимости с бэкендом
      state.creds.apiKey = key; 
      state.creds.key = key;
    };

    // Загрузка из localStorage при старте
    const savedKey = localStorage.getItem('groqApiKey') || localStorage.getItem('apiKey');
    if (savedKey) {
      apiKeyInput.value = savedKey;
      loadKey();
    } else {
      loadKey(); // Берем то, что уже введено в поле
    }

    // Слушатели событий
    apiKeyInput.addEventListener('input', loadKey);
    apiKeyInput.addEventListener('change', () => {
      const key = apiKeyInput.value.trim();
      if (key) localStorage.setItem('groqApiKey', key);
    });
  } else {
    console.warn('API Key input not found in DOM');
  }

  // === 2. SEO КЛЮЧІ ===
  const seoInput = $('seoKeys') || $('keywords');
  if (seoInput) {
    seoInput.addEventListener('input', (e) => {
      state.seoKeywords = e.target.value.split(',').map(k => k.trim()).filter(Boolean);
    });
    // Загружаем начальное значение
    state.seoKeywords = seoInput.value.split(',').map(k => k.trim()).filter(Boolean);
  }

  // === 3. ОБРОБКА ВСТАВКИ (PASTE SANITIZER) ===
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    
    let cleanHtml = text;
    if (html && window.sanitizePastedHtml) {
      cleanHtml = window.sanitizePastedHtml(html);
    }
    
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
        range.setStartAfter(lastNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    state.text = editor.innerText;
  });

  editor.addEventListener('input', () => {
    state.text = editor.innerText;
  });

  // === 4. КНОПКИ ТА ТАБИ ===
  const btnAnalyze = $('btnAnalyze');
  if (btnAnalyze) btnAnalyze.addEventListener('click', runAnalysis);
  
  const btnRewrite = $('btnRewrite');
  if (btnRewrite) btnRewrite.addEventListener('click', runRewrite);

  document.querySelectorAll('.tab').forEach(t => 
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  );

  renderMap();
  renderInspector();
}

async function runAnalysis() {
  const btn = $('btnAnalyze');
  if (btn) { btn.disabled = true; btn.innerText = 'Аналіз...'; }
  
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: state.text, 
        seoKeywords: state.seoKeywords, 
        creds: state.creds 
      })
    });
    
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    state.analysis = await res.json();
    
    renderMap();
    renderMetrics();
    renderInspector();
  } catch (e) {
    alert('Помилка аналізу: ' + e.message);
    console.error(e);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = 'Аналізувати'; }
  }
}

async function runRewrite() {
  if (!state.selectedId || !state.analysis) return alert('Оберіть фрагмент для рерайту.');
  
  const seg = state.analysis.segments.find(s => s.id === state.selectedId);
  if (!seg) return;
  
  const idx = state.analysis.segments.indexOf(seg);
  const prevCtx = idx > 0 ? state.analysis.segments[idx-1].text : '';
  const nextCtx = idx < state.analysis.segments.length - 1 ? state.analysis.segments[idx+1].text : '';

  const btn = $('btnRewrite');
  if (btn) { btn.disabled = true; btn.innerText = 'Покращення...'; }
  
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
    
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const data = await res.json();
    
    if (data.applied && data.rewrittenSegment) {
      state.text = state.text.slice(0, seg.startOffset) + data.rewrittenSegment + state.text.slice(seg.endOffset);
      $('editor').innerText = state.text;
      await runAnalysis();
    } else {
      alert(data.reason || 'Рерайт не застосовано.');
    }
  } catch (e) {
    alert('Помилка рерайту: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = 'Покращити ШІ'; }
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
  const viewRender = $('viewRender');
  const viewInspector = $('viewInspector');
  if (viewRender) viewRender.style.display = tab === 'render' ? 'block' : 'none';
  if (viewInspector) viewInspector.style.display = tab === 'inspector' ? 'block' : 'none';
}

function renderMetrics() {
  if (!state.analysis) return;
  const d = state.analysis;
  const meta = window.METRICS_META || {};
  const order = window.METRICS_ORDER || Object.keys(meta);
  const container = $('metricsList');
  if (!container) return;
  
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
  container.innerHTML = html;
}

function renderMap() {
  const container = $('docRender');
  if (!container) return;
  
  if (!state.analysis) { container.innerHTML = 'Немає даних.'; return; }
  
  const { segments, highlights } = state.analysis;
  const hlMap = {}; 
  (highlights || []).forEach(h => hlMap[h.id] = h);
  
  let html = ''; 
  let cursor = 0; 
  const text = state.text;
  
  for (const seg of segments) {
    if (seg.startOffset > cursor) html += esc(text.slice(cursor, seg.startOffset));
    
    let h = hlMap[seg.id];
    let type = h && h.type && h.type !== 'clean' ? h.type : '';
    
    const isPinned = state.pins.includes(seg.id);
    if (isPinned) type = 'pinned';
    else if (state.filter !== 'all' && type !== state.filter) type = '';

    let tooltipText = '';
    if (isPinned) {
      tooltipText = 'Закріплений фрагмент. Клікніть "Відкріпити" в інспекторі.';
    } else if (h && h.type !== 'clean') {
      const hlMeta = window.HIGHLIGHT_META || {};
      const meta = hlMeta[h.type] || {};
      tooltipText = (meta.label || h.type) + ': ' + (h.details || meta.desc || '');
    }
    
    const isSelected = seg.id === state.selectedId ? 'selected' : '';
    html += `<span class="seg ${type} ${isSelected}" data-id="${seg.id}" title="${esc(tooltipText)}">${esc(text.slice(seg.startOffset, seg.endOffset))}</span>`;
    cursor = seg.endOffset;
  }
  
  if (cursor < text.length) html += esc(text.slice(cursor));
  container.innerHTML = html;
  
  document.querySelectorAll('.seg').forEach(el => 
    el.addEventListener('click', () => selectSegment(el.dataset.id))
  );
}

function renderInspector() {
  const emptyEl = $('inspEmpty');
  const contentEl = $('inspContent');
  if (!contentEl) return;
  
  if (!state.analysis) {
    if (emptyEl) emptyEl.style.display = 'block';
    contentEl.innerHTML = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  
  const d = state.analysis;
  const hlMeta = window.HIGHLIGHT_META || {};
  
  // Считаем количество каждого типа
  const counts = {};
  Object.keys(hlMeta).forEach(k => counts[k] = 0);
  counts['pinned'] = (state.pins || []).length;
  (d.highlights || []).forEach(h => { if (counts[h.type] !== undefined) counts[h.type]++; });

  // Легенда с фильтрами
  let legendHtml = '<div class="legend-grid">';
  for (const [type, meta] of Object.entries(hlMeta)) {
    const count = counts[type] || 0;
    const isActive = state.filter === type ? 'active-filter' : '';
    legendHtml += `<div class="legend-item ${isActive}" data-type="${type}" style="border-left: 4px solid ${meta.color}; cursor:pointer;">
      <span>${meta.label}</span> <b>(${count})</b>
    </div>`;
  }
  if (state.filter !== 'all') {
    legendHtml += `<div class="legend-item" data-type="all" style="border-left: 4px solid #8b949e; cursor:pointer;">
      <span>Показати все</span>
    </div>`;
  }
  legendHtml += '</div>';

  // Детали выбранного сегмента
  let detailsHtml = '';
  if (state.selectedId) {
    const seg = d.segments.find(s => s.id === state.selectedId);
    const h = (d.highlights || []).find(h => h.id === state.selectedId);
    const isPinned = state.pins.includes(state.selectedId);
    
    detailsHtml += `<div class="seg-details">
      <h3>Обраний фрагмент</h3>
      <p class="seg-text">"${esc(seg ? seg.text.slice(0, 150) + (seg.text.length > 150 ? '...' : '') : '')}"</p>
      <button id="btnPinAction" class="btn-action">${isPinned ? '📌 Відкріпити' : '📍 Закріпити'}</button>`;
      
    if (h && h.type !== 'clean') {
      const meta = hlMeta[h.type] || {};
      detailsHtml += `<div class="issue-block" style="border-left: 4px solid ${meta.color}; margin-top:10px;">
        <strong>${meta.label || h.type}</strong>
        <p>${esc(h.details || meta.desc || '')}</p>
        ${(h.suggestions || []).length ? '<ul>' + h.suggestions.map(s => `<li>${esc(s)}</li>`).join('') + '</ul>' : ''}
      </div>`;
    }
    detailsHtml += `</div>`;
  }

  // Обзор маркеров и сниппетов
  let overviewHtml = '';
  if (d.aiFingerprints && d.aiFingerprints.length) {
    overviewHtml += `<h3>ШІ-маркери</h3>` + d.aiFingerprints.map(f => {
      let hlType = 'ai';
      if (f.marker.includes('Burstiness')) hlType = 'rhythm';
      else if (f.marker.includes('Predictable')) hlType = 'predictable';
      return `<span class="fingerprint clickable" data-hl="${hlType}" style="cursor:pointer; text-decoration:underline; margin-right:8px;">${esc(f.marker)} <span class="severity">${f.severity}</span></span>`;
    }).join('') + `<div class="clear"></div>`;
  }

  if (d.aiCitationSnippets && d.aiCitationSnippets.length) {
    overviewHtml += `<h3>Готові сніпети для цитування</h3>` + d.aiCitationSnippets.map(s=>`<div class="snippet">"${esc(s)}"</div>`).join('');
  }

  contentEl.innerHTML = legendHtml + detailsHtml + overviewHtml;

  // Привязываем события после рендера
  setTimeout(() => {
    const pinBtn = $('btnPinAction');
    if (pinBtn) pinBtn.addEventListener('click', togglePin);

    document.querySelectorAll('.legend-item').forEach(el => {
      el.addEventListener('click', () => {
        state.filter = el.dataset.type;
        renderMap();
        renderInspector();
      });
    });

    document.querySelectorAll('.fingerprint.clickable').forEach(el => {
      el.addEventListener('click', () => {
        state.filter = el.dataset.hl;
        switchTab('render');
        renderMap();
        renderInspector();
      });
    });
  }, 0);
}

document.addEventListener('DOMContentLoaded', init);
