// app.js — Полная версия со всеми функциями

const $ = id => document.getElementById(id);
const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const state = {
  text: '',
  analysis: null,
  selectedId: null,
  filter: 'all',
  pins: [],
  seoKeywords: [],
  seedKeyword: '',
  creds: { provider: 'groq', model: 'llama-3.3-70b-versatile' }
};

const METRICS_CONFIG = window.METRICS_META || {
  aiScore: { label: 'AI Score', unit: '%', direction: 'low', good: 35, warn: 60, tip: 'Ймовірність ШІ-генерації' },
  burstinessScore: { label: 'Ритм', unit: '', direction: 'high', good: 55, warn: 35, tip: 'Варіативність довжини речень' },
  perplexityScore: { label: 'Непередбачуваність', unit: '', direction: 'high', good: 45, warn: 25, tip: 'Складність лексики' },
  geoScore: { label: 'GEO', unit: '', direction: 'high', good: 60, warn: 40, tip: 'Готовність до цитування' },
  factDensity: { label: 'Факти', unit: '%', direction: 'high', good: 30, warn: 15, tip: 'Щільність конкретики' },
};

const HIGHLIGHT_CONFIG = window.HIGHLIGHT_META || {
  ai: { color: '#a371f7', label: 'ШІ-патерн', desc: 'Машинна ознака: пасив, нагромадження іменників, кліше' },
  rhythm: { color: '#e3b341', label: 'Монотонний ритм', desc: 'Речення схоже за довжиною на сусідні' },
  predictable: { color: '#6cb6ff', label: 'Штампи', desc: 'Порожні підсилювачі й «зализана» лексика' },
  citation: { color: '#4dd0a7', label: 'Цінне', desc: 'Ідеальне для цитування ШІ-пошуком' },
  logic_flaw: { color: '#f0883e', label: 'Логіка', desc: 'Суперечність або втрачена засновка' },
  low_relevance: { color: '#db6d6d', label: 'Нерелевантне', desc: 'Слабко стосується теми' },
  pinned: { color: '#2f7a63', label: 'Закріплено', desc: 'Зафіксований фрагмент' },
};

function init() {
  console.log('🚀 TextLab Init...');
  
  const editor = $('editor');
  if (!editor) return;
  state.text = editor.innerText || '';

  // API Key
  const apiKeyInput = $('apiKey');
  if (apiKeyInput) {
    const savedKey = localStorage.getItem('apiKey');
    if (savedKey) { apiKeyInput.value = savedKey; state.creds.apiKey = savedKey; }
    apiKeyInput.addEventListener('input', () => {
      state.creds.apiKey = apiKeyInput.value.trim();
      localStorage.setItem('apiKey', apiKeyInput.value.trim());
    });
  }

  // Provider
  const providerSelect = $('provider');
  if (providerSelect) {
    state.creds.provider = providerSelect.value;
    providerSelect.addEventListener('change', () => {
      state.creds.provider = providerSelect.value;
      if (window.updateModelSelect) window.updateModelSelect();
    });
  }

  // Model
  if (window.updateModelSelect) window.updateModelSelect();
  const modelSelect = $('modelSelect');
  if (modelSelect) {
    modelSelect.addEventListener('change', () => { state.creds.model = modelSelect.value; });
  }

  // Validate
  const validateBtn = $('validateBtn');
  if (validateBtn) {
    validateBtn.addEventListener('click', async () => {
      validateBtn.disabled = true;
      const status = $('validateStatus');
      if (status) status.innerText = 'Перевірка...';
      try {
        const res = await fetch('/api/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creds: state.creds })
        });
        const data = await res.json();
        if (status) status.innerText = data.ok ? `✅ OK (${data.latencyMs}ms)` : '❌ ' + (data.error || 'Error');
      } catch (e) { if (status) status.innerText = '❌ Network Error'; }
      finally { validateBtn.disabled = false; }
    });
  }

  // SEO Keywords
  const seoInput = $('seoKeywords');
  if (seoInput) {
    seoInput.addEventListener('input', (e) => {
      state.seoKeywords = e.target.value.split(',').map(k => k.trim()).filter(Boolean);
    });
  }

  // Seed Keyword
  const seedInput = $('seedKeyword');
  if (seedInput) {
    seedInput.addEventListener('input', (e) => { state.seedKeyword = e.target.value.trim(); });
  }

  // Tabs
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const targetTab = tab.dataset.tab;
      document.querySelectorAll('section[id^="tab-"]').forEach(s => s.style.display = 'none');
      const targetSection = $('tab-' + targetTab);
      if (targetSection) targetSection.style.display = 'block';
    });
  });

  // Main buttons
  const analyzeBtn = $('analyzeBtn');
  if (analyzeBtn) analyzeBtn.addEventListener('click', runAnalysis);
  
  const clearBtn = $('clearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      editor.innerText = '';
      state.text = '';
      state.analysis = null;
      renderMap();
      renderMetrics();
      renderInspector();
    });
  }

  // Pin button
  const pinBtn = $('pinBtn');
  if (pinBtn) pinBtn.addEventListener('click', togglePin);

  // Simulation
  const simBtn = $('simBtn');
  if (simBtn) simBtn.addEventListener('click', runSimulation);

  // Export buttons
  const saveProjectBtn = $('saveProjectBtn');
  if (saveProjectBtn) {
    saveProjectBtn.addEventListener('click', () => {
      if (window.exportProject) {
        window.exportProject(state);
      } else {
        // Fallback если export.js не загружен
        const data = JSON.stringify(state, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'textlab-project.json';
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }

  const loadProjectBtn = $('loadProjectBtn');
  const loadProjectInput = $('loadProjectInput');
  if (loadProjectBtn && loadProjectInput) {
    loadProjectBtn.addEventListener('click', () => loadProjectInput.click());
    loadProjectInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      if (window.importProject) {
        window.importProject(file, state);
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            Object.assign(state, data);
            if (data.text) editor.innerText = data.text;
            renderMap();
            renderMetrics();
            renderInspector();
            alert('✅ Проєкт завантажено');
          } catch (err) {
            alert('❌ Помилка завантаження: ' + err.message);
          }
        };
        reader.readAsText(file);
      }
    });
  }

  const exportHtmlBtn = $('exportHtmlBtn');
  if (exportHtmlBtn) {
    exportHtmlBtn.addEventListener('click', () => {
      if (window.exportHtml) {
        window.exportHtml(state);
      } else {
        // Fallback экспорт HTML
        if (!state.analysis) return alert('Спочатку проаналізуйте текст');
        
        let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TextLab Report</title>
          <style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;padding:20px}
          .metric{display:inline-block;margin:10px;padding:15px;border-left:4px solid #58a6ff;background:#f6f8fa}
          .seg{padding:2px 4px;margin:2px 0;display:inline-block}
          .ai{background:#a371f7;color:white} .rhythm{background:#e3b341} .predictable{background:#6cb6ff}
          .citation{background:#4dd0a7} .logic_flaw{background:#f0883e;color:white} .low_relevance{background:#db6d6d;color:white}
          .pinned{border:2px solid #2f7a63} h1{color:#333} h2{color:#555}</style></head><body>
          <h1>TextLab — Звіт аналізу</h1>
          <h2>Метрики</h2><div>`;
        
        for (const [key, m] of Object.entries(METRICS_CONFIG)) {
          const val = state.analysis[key];
          if (val == null) continue;
          html += `<div class="metric"><strong>${m.label}:</strong> ${Math.round(val)}${m.unit || ''}</div>`;
        }
        
        html += `</div><h2>Текст з розміткою</h2><div>`;
        
        const { segments, highlights } = state.analysis;
        const hlMap = {};
        (highlights || []).forEach(h => hlMap[h.id] = h);
        
        let cursor = 0;
        for (const seg of segments) {
          if (seg.startOffset > cursor) html += esc(state.text.slice(cursor, seg.startOffset));
          let h = hlMap[seg.id];
          let type = h && h.type && h.type !== 'clean' ? h.type : '';
          html += `<span class="seg ${type}">${esc(state.text.slice(seg.startOffset, seg.endOffset))}</span>`;
          cursor = seg.endOffset;
        }
        if (cursor < state.text.length) html += esc(state.text.slice(cursor));
        
        html += `</div><h2>Рекомендації</h2><ul>`;
        if (state.analysis.recommendations) {
          state.analysis.recommendations.forEach(r => {
            html += `<li><strong>${esc(r.title || '')}</strong>: ${esc(r.description || '')}</li>`;
          });
        }
        html += `</ul></body></html>`;
        
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'textlab-report.html';
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }

  // Paste handler
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    let cleanHtml = text;
    if (html && window.sanitizePastedHtml) cleanHtml = window.sanitizePastedHtml(html);
    
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const temp = document.createElement('div');
      temp.innerHTML = cleanHtml;
      const frag = document.createDocumentFragment();
      let node, lastNode;
      while ((node = temp.firstChild)) lastNode = frag.appendChild(node);
      range.insertNode(frag);
      if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    state.text = editor.innerText;
  });

  editor.addEventListener('input', () => { state.text = editor.innerText; });

  // Toolbar
  document.querySelectorAll('.tb-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'h1') document.execCommand('formatBlock', false, 'h1');
      else if (cmd === 'h2') document.execCommand('formatBlock', false, 'h2');
      else if (cmd === 'h3') document.execCommand('formatBlock', false, 'h3');
      else if (cmd === 'bold') document.execCommand('bold');
      else if (cmd === 'ul') document.execCommand('insertUnorderedList');
      else if (cmd === 'ol') document.execCommand('insertOrderedList');
      else if (cmd === 'p') document.execCommand('formatBlock', false, 'p');
    });
  });

  renderMap();
  renderMetrics();
  renderInspector();
  console.log('🏁 Init Done');
}

async function runAnalysis() {
  const btn = $('analyzeBtn');
  if (!btn) return;
  
  const apiKeyInput = $('apiKey');
  if (apiKeyInput) state.creds.apiKey = apiKeyInput.value.trim();
  
  btn.disabled = true; 
  btn.innerText = 'Аналіз...';
  const statusMsg = $('statusMsg');
  if (statusMsg) statusMsg.innerText = 'Аналіз...';
  
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: state.text, 
        seoKeywords: state.seoKeywords,
        seedKeyword: state.seedKeyword,
        creds: state.creds 
      })
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    
    state.analysis = await res.json();
    renderMetrics();
    renderMap();
    renderInspector();
    
    if (statusMsg) statusMsg.innerText = '✅ Готово';
    setTimeout(() => { if (statusMsg) statusMsg.innerText = ''; }, 3000);
  } catch (e) { 
    console.error('❌ Analysis Error:', e);
    alert('Error: ' + e.message); 
    if (statusMsg) statusMsg.innerText = '❌ Помилка';
  } finally { 
    btn.disabled = false; 
    btn.innerText = 'Проаналізувати'; 
  }
}

async function runSimulation() {
  const query = $('simQuery')?.value.trim();
  if (!query) return alert('Введіть запит');
  if (!state.analysis) return alert('Спочатку проаналізуйте текст');
  
  const btn = $('simBtn');
  if (btn) { btn.disabled = true; btn.innerText = 'Симуляція...'; }
  
  try {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: state.text, 
        query,
        creds: state.creds 
      })
    });
    
    const data = await res.json();
    const result = $('simResult');
    if (result) {
      result.innerHTML = `<div class="sim-output"><h3>Результат симуляції</h3><pre>${esc(JSON.stringify(data, null, 2))}</pre></div>`;
    }
  } catch (e) { 
    alert('Error: ' + e.message); 
  } finally { 
    if (btn) { btn.disabled = false; btn.innerText = 'Перевірити у ШІ-пошуку'; }
  }
}

function togglePin() {
  if (!state.selectedId) return;
  const i = state.pins.indexOf(state.selectedId);
  if (i > -1) state.pins.splice(i, 1);
  else state.pins.push(state.selectedId);
  
  const selPop = $('selPop');
  if (selPop) selPop.style.display = 'none';
  
  renderMap();
  renderInspector();
}

function selectSegment(id) {
  state.selectedId = id;
  document.querySelectorAll('.seg').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
  
  const selPop = $('selPop');
  if (selPop) {
    const rect = event.target.getBoundingClientRect();
    selPop.style.display = 'block';
    selPop.style.left = (rect.left + window.scrollX) + 'px';
    selPop.style.top = (rect.bottom + window.scrollY + 5) + 'px';
  }
  
  renderInspector();
}

function renderMetrics() {
  const container = $('metrics');
  if (!container) return;
  if (!state.analysis) { container.innerHTML = ''; return; }
  
  const d = state.analysis;
  let html = '';
  
  for (const [key, m] of Object.entries(METRICS_CONFIG)) {
    const val = d[key];
    if (val == null) continue;
    
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
    
    html += `<div class="metric" style="border-left: 4px solid ${color};" title="${esc(m.tip || '')}">
      <div class="metric-label">${m.label}</div>
      <div class="metric-value" style="color:${color}">${Math.round(val)}${m.unit || ''}</div>
    </div>`;
  }
  
  container.innerHTML = html;
}

function renderMap() {
  const container = $('docRender');
  if (!container) return;
  if (!state.analysis) { container.innerHTML = ''; return; }
  
  const { segments, highlights } = state.analysis;
  const hlMap = {};
  (highlights || []).forEach(h => hlMap[h.id] = h);
  
  let html = '';
  let cursor = 0;
  
  for (const seg of segments) {
    if (seg.startOffset > cursor) html += esc(state.text.slice(cursor, seg.startOffset));
    
    let h = hlMap[seg.id];
    let type = h && h.type && h.type !== 'clean' ? h.type : '';
    
    if (state.filter !== 'all' && type !== state.filter && !state.pins.includes(seg.id)) type = '';
    if (state.pins.includes(seg.id)) type = 'pinned';
    
    const isSelected = seg.id === state.selectedId ? 'selected' : '';
    
    // Добавляем тултип
    let tooltip = '';
    if (h && h.type !== 'clean') {
      const meta = HIGHLIGHT_CONFIG[h.type] || {};
      tooltip = `${meta.label || h.type}: ${h.details || meta.desc || ''}`;
    }
    if (state.pins.includes(seg.id)) tooltip = '📌 Закріплений фрагмент';
    
    html += `<span class="seg ${type} ${isSelected}" data-id="${seg.id}" title="${esc(tooltip)}">${esc(state.text.slice(seg.startOffset, seg.endOffset))}</span>`;
    cursor = seg.endOffset;
  }
  
  if (cursor < state.text.length) html += esc(state.text.slice(cursor));
  container.innerHTML = html;
  
  document.querySelectorAll('.seg').forEach(el => {
    el.addEventListener('click', () => selectSegment(el.dataset.id));
  });
  
  renderFilters();
  renderLegend();
}

function renderFilters() {
  const filterRow = $('filterRow');
  if (!filterRow || !state.analysis) return;
  
  const counts = { all: 0, ai: 0, rhythm: 0, predictable: 0, citation: 0, logic_flaw: 0, low_relevance: 0, pinned: state.pins.length };
  (state.analysis.highlights || []).forEach(h => {
    if (counts[h.type] !== undefined) counts[h.type]++;
    counts.all++;
  });
  
  let html = `<div class="filter-item ${state.filter === 'all' ? 'active' : ''}" data-type="all" style="border-left: 3px solid #8b949e; cursor: pointer;">Всі (${counts.all})</div>`;
  
  for (const [type, meta] of Object.entries(HIGHLIGHT_CONFIG)) {
    const count = counts[type] || 0;
    const isActive = state.filter === type ? 'active' : '';
    html += `<div class="filter-item ${isActive}" data-type="${type}" style="border-left: 3px solid ${meta.color}; cursor: pointer;">${meta.label} (${count})</div>`;
  }
  
  filterRow.innerHTML = html;
  
  filterRow.querySelectorAll('.filter-item').forEach(el => {
    el.addEventListener('click', () => {
      state.filter = el.dataset.type;
      renderMap();
    });
  });
}

function renderLegend() {
  const legend = $('legend');
  if (!legend || !state.analysis) return;
  
  let html = '<div class="legend-grid">';
  for (const [type, meta] of Object.entries(HIGHLIGHT_CONFIG)) {
    html += `<div class="legend-item" style="border-left: 4px solid ${meta.color};">
      <strong>${meta.label}</strong>
      <span class="legend-desc">${meta.desc || ''}</span>
    </div>`;
  }
  html += '</div>';
  
  legend.innerHTML = html;
}

function renderInspector() {
  const container = $('inspContent');
  const inspEmpty = $('inspEmpty');
  if (!container) return;
  
  if (!state.analysis) {
    if (inspEmpty) inspEmpty.style.display = 'block';
    container.innerHTML = '';
    return;
  }
  
  if (inspEmpty) inspEmpty.style.display = 'none';
  
  const d = state.analysis;
  let html = '';
  
  // Детали выбранного сегмента
  if (state.selectedId) {
    const seg = d.segments.find(s => s.id === state.selectedId);
    const h = (d.highlights || []).find(h => h.id === state.selectedId);
    const isPinned = state.pins.includes(state.selectedId);
    
    html += `<div class="seg-details">
      <h3>Обраний фрагмент</h3>
      <p class="seg-text">"${esc(seg?.text || '')}"</p>`;
    
    if (h && h.type !== 'clean') {
      const meta = HIGHLIGHT_CONFIG[h.type] || {};
      html += `<div class="issue-block" style="border-left: 4px solid ${meta.color || '#58a6ff'};">
        <strong>${meta.label || h.type}</strong>
        <p>${esc(h.details || meta.desc || '')}</p>
        ${(h.suggestions || []).length ? '<div class="suggestions"><strong>Покращення:</strong><ul>' + h.suggestions.map(s => `<li>${esc(s)}</li>`).join('') + '</ul></div>' : ''}
      </div>`;
    }
    
    html += `</div>`;
  }
  
  // Рекомендации
  if (d.recommendations && d.recommendations.length) {
    html += `<h3>Рекомендації</h3>`;
    html += d.recommendations.map(r => `<div class="rec">
      <strong>${esc(r.title || '')}</strong>
      <p>${esc(r.description || '')}</p>
      ${r.expectedImpact ? `<div class="impact">Очікуваний ефект: ${esc(JSON.stringify(r.expectedImpact))}</div>` : ''}
    </div>`).join('');
  }
  
  // Сниппеты для цитирования
  if (d.aiCitationSnippets && d.aiCitationSnippets.length) {
    html += `<h3>Готові сніпети для цитування</h3>`;
    html += d.aiCitationSnippets.map(s => `<div class="snippet">"${esc(s)}"</div>`).join('');
  }
  
  // Сущности
  if (d.entities) {
    html += `<h3>Сутності</h3>`;
    if (d.entities.found && d.entities.found.length) {
      html += `<div><strong>Знайдено:</strong> ${d.entities.found.join(', ')}</div>`;
    }
    if (d.entities.missing && d.entities.missing.length) {
      html += `<div><strong>Бракує:</strong> ${d.entities.missing.join(', ')}</div>`;
    }
  }
  
  // Покрытие тем
  if (d.topicCoverage) {
    html += `<h3>Покриття теми</h3>`;
    if (d.topicCoverage.covered && d.topicCoverage.covered.length) {
      html += `<div><strong>Розкрито:</strong> ${d.topicCoverage.covered.join(', ')}</div>`;
    }
    if (d.topicCoverage.missing && d.topicCoverage.missing.length) {
      html += `<div><strong>Не розкрито:</strong> ${d.topicCoverage.missing.join(', ')}</div>`;
    }
  }
  
  // AI Fingerprints
  if (d.aiFingerprints && d.aiFingerprints.length) {
    html += `<h3>ШІ-маркери</h3>`;
    html += d.aiFingerprints.map(f => `<div class="fingerprint">
      <strong>${esc(f.marker)}</strong> <span class="severity">(${f.severity})</span>
      <p>${esc(f.description || '')}</p>
    </div>`).join('');
  }
  
  container.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', init);
