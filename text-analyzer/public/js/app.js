// app.js — Финальная версия с защитой от ошибок рендеринга

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

const METRICS_CONFIG = {
  aiScore: { label: 'AI Score', unit: '%', direction: 'low', good: 35, warn: 60 },
  burstinessScore: { label: 'Ритм', unit: '', direction: 'high', good: 55, warn: 35 },
  perplexityScore: { label: 'Непередбачуваність', unit: '', direction: 'high', good: 45, warn: 25 },
  geoScore: { label: 'GEO', unit: '', direction: 'high', good: 60, warn: 40 },
  factDensity: { label: 'Факти', unit: '%', direction: 'high', good: 30, warn: 15 },
};

const HIGHLIGHT_CONFIG = {
  ai: { color: '#a371f7', label: 'ШІ-патерн' },
  rhythm: { color: '#e3b341', label: 'Монотонний ритм' },
  predictable: { color: '#6cb6ff', label: 'Штампи' },
  citation: { color: '#4dd0a7', label: 'Цінне' },
  logic_flaw: { color: '#f0883e', label: 'Логіка' },
  low_relevance: { color: '#db6d6d', label: 'Нерелевантне' },
  pinned: { color: '#2f7a63', label: 'Закріплено' },
};

function init() {
  console.log('🚀 TextLab Init...');
  
  try {
    const editor = $('editor');
    if (!editor) { console.error('❌ #editor not found'); return; }
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
        updateModelSelect();
      });
    }

    // Model
    updateModelSelect();
    const modelSelect = $('modelSelect');
    if (modelSelect) {
      modelSelect.addEventListener('change', () => { state.creds.model = modelSelect.value; });
    }

    // Validate button
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

  } catch (err) {
    console.error('💥 INIT ERROR:', err);
  }
}

function updateModelSelect() {
  const modelSelect = $('modelSelect');
  if (!modelSelect) return;
  
  const models = {
    groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    openai: ['gpt-4o-mini', 'gpt-4o'],
    anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
    gemini: ['gemini-1.5-flash', 'gemini-1.5-pro']
  };
  
  const provider = state.creds.provider || 'groq';
  const providerModels = models[provider] || models.groq;
  
  modelSelect.innerHTML = providerModels.map(m => `<option value="${m}">${m}</option>`).join('');
  state.creds.model = providerModels[0];
}

async function runAnalysis() {
  const btn = $('analyzeBtn');
  if (!btn) return;
  
  const apiKeyInput = $('apiKey');
  if (apiKeyInput) state.creds.apiKey = apiKeyInput.value.trim();
  
  console.log('📤 Sending analysis request...');
  btn.disabled = true; 
  btn.innerText = 'Аналіз...';
  
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
    console.log('✅ Analysis complete:', state.analysis);
    
    renderMetrics();
    renderMap();
    renderInspector();
  } catch (e) { 
    console.error('❌ Analysis Error:', e);
    alert('Error: ' + e.message); 
  } finally { 
    btn.disabled = false; 
    btn.innerText = 'Проаналізувати'; 
  }
}

function togglePin() {
  if (!state.selectedId) return;
  const i = state.pins.indexOf(state.selectedId);
  if (i > -1) state.pins.splice(i, 1);
  else state.pins.push(state.selectedId);
  renderMap();
  renderInspector();
}

function selectSegment(id) {
  state.selectedId = id;
  document.querySelectorAll('.seg').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
  renderInspector();
}

function renderMetrics() {
  const container = $('metrics');
  if (!container) { console.warn('⚠️ #metrics not found'); return; }
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
    
    html += `<div class="metric" style="border-left: 4px solid ${color};">
      <div class="metric-label">${m.label}</div>
      <div class="metric-value" style="color:${color}">${Math.round(val)}${m.unit || ''}</div>
    </div>`;
  }
  
  container.innerHTML = html;
  console.log('✅ Metrics rendered');
}

function renderMap() {
  const container = $('docRender');
  if (!container) { console.warn('⚠️ #docRender not found'); return; }
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
    html += `<span class="seg ${type} ${isSelected}" data-id="${seg.id}">${esc(state.text.slice(seg.startOffset, seg.endOffset))}</span>`;
    cursor = seg.endOffset;
  }
  
  if (cursor < state.text.length) html += esc(state.text.slice(cursor));
  container.innerHTML = html;
  
  document.querySelectorAll('.seg').forEach(el => {
    el.addEventListener('click', () => selectSegment(el.dataset.id));
  });
  
  console.log('✅ Map rendered');
}

function renderInspector() {
  const container = $('inspContent');
  if (!container) { console.warn('⚠️ #inspContent not found'); return; }
  if (!state.analysis) { container.innerHTML = ''; return; }
  
  const d = state.analysis;
  let html = '';
  
  if (state.selectedId) {
    const seg = d.segments.find(s => s.id === state.selectedId);
    const h = (d.highlights || []).find(h => h.id === state.selectedId);
    const isPinned = state.pins.includes(state.selectedId);
    
    html += `<div class="seg-details">
      <h3>Фрагмент</h3>
      <p>"${esc(seg?.text.slice(0, 100))}..."</p>`;
    
    if (h && h.type !== 'clean') {
      const meta = HIGHLIGHT_CONFIG[h.type] || {};
      html += `<div class="issue-block" style="border-left: 4px solid ${meta.color || '#58a6ff'};">
        <strong>${meta.label || h.type}</strong>
        <p>${esc(h.details || '')}</p>
      </div>`;
    }
    
    html += `</div>`;
  }
  
  if (d.recommendations && d.recommendations.length) {
    html += `<h3>Рекомендації</h3>`;
    html += d.recommendations.map(r => `<div class="rec"><strong>${esc(r.title || '')}</strong><p>${esc(r.description || '')}</p></div>`).join('');
  }
  
  container.innerHTML = html;
  console.log('✅ Inspector rendered');
}

document.addEventListener('DOMContentLoaded', init);
