// app.js — Полностью адаптирован под textlab2/index.html
// ID элементов взяты напрямую из твоего HTML: analyzeBtn, rewriteBtn, apiKeyInput, seoKeywords

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

// Встроенная конфигурация, чтобы не зависеть от внешних файлов
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
  pinned: { color: '#2f7a63', label: 'Закріплено' },
};

function init() {
  console.log('🚀 TextLab Init Start...');
  
  try {
    // 1. РЕДАКТОР
    const editor = $('editor');
    if (!editor) throw new Error('Element #editor not found in HTML!');
    state.text = editor.innerText || '';

    // 2. API КЛЮЧ (ID: apiKeyInput из твоего HTML)
    const apiKeyInput = $('apiKeyInput');
    if (apiKeyInput) {
      const savedKey = localStorage.getItem('groqApiKey');
      if (savedKey) {
        apiKeyInput.value = savedKey;
        state.creds.groqApiKey = savedKey;
      } else {
        state.creds.groqApiKey = apiKeyInput.value.trim();
      }
      
      apiKeyInput.addEventListener('input', () => {
        state.creds.groqApiKey = apiKeyInput.value.trim();
        localStorage.setItem('groqApiKey', apiKeyInput.value.trim());
      });
      console.log('✅ API Key bound');
    }

    // 3. КНОПКА ПРОВЕРКИ (ID: checkKeyBtn из твоего HTML)
    const checkBtn = $('checkKeyBtn');
    if (checkBtn) {
      checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        checkBtn.innerText = '...';
        try {
          const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Test', creds: state.creds })
          });
          alert(res.ok ? '✅ Ключ працює!' : '❌ Помилка: ' + await res.text());
        } catch (e) { alert('❌ Мережева помилка'); }
        finally { checkBtn.disabled = false; checkBtn.innerText = 'Проверить'; }
      });
    }

    // 4. ТАБЫ (Работаем с твоими <a class="tab-link" href="#view...">)
    const tabs = document.querySelectorAll('.tab-link');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        // Убираем активный класс у всех ссылок
        tabs.forEach(t => t.classList.remove('active'));
        // Добавляем текущей
        tab.classList.add('active');
        
        // Скрываем все блоки view
        document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
        
        // Показываем нужный блок по href
        const targetId = tab.getAttribute('href').substring(1); // убираем #
        const targetView = $(targetId);
        if (targetView) {
          targetView.style.display = 'block';
          console.log(`Switched to ${targetId}`);
        }
      });
    });

    // 5. ГЛАВНЫЕ КНОПКИ (ID: analyzeBtn, rewriteBtn из твоего HTML)
    const analyzeBtn = $('analyzeBtn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', runAnalysis);
      console.log('✅ Analyze Btn bound');
    } else {
      console.error('❌ #analyzeBtn NOT FOUND');
    }
    
    const rewriteBtn = $('rewriteBtn');
    if (rewriteBtn) {
      rewriteBtn.addEventListener('click', runRewrite);
      console.log('✅ Rewrite Btn bound');
    }

    // 6. SEO КЛЮЧИ (ID: seoKeywords из твоего HTML)
    const seoInput = $('seoKeywords');
    if (seoInput) {
      seoInput.addEventListener('input', (e) => {
        state.seoKeywords = e.target.value.split(',').map(k => k.trim()).filter(Boolean);
      });
    }

    // 7. ВСТАВКА ТЕКСТА (PASTE) - Чистка HTML
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

    renderMap();
    renderInspector();
    console.log('🏁 Init Finished Successfully');

  } catch (err) {
    console.error('💥 INIT CRASH:', err);
    alert('Critical Error: ' + err.message + '. Check Console F12.');
  }
}

async function runAnalysis() {
  const btn = $('analyzeBtn');
  if (!btn) return;
  btn.disabled = true; btn.innerText = 'Аналіз...';
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: state.text, seoKeywords: state.seoKeywords, creds: state.creds })
    });
    if (!res.ok) throw new Error(await res.text());
    state.analysis = await res.json();
    renderMap();
    renderMetrics();
    renderInspector();
  } catch (e) { alert('Error: ' + e.message); }
  finally { btn.disabled = false; btn.innerText = 'Аналізувати'; }
}

async function runRewrite() {
  if (!state.selectedId || !state.analysis) return alert('Оберіть фрагмент для рерайту.');
  const seg = state.analysis.segments.find(s => s.id === state.selectedId);
  if (!seg) return;
  
  const idx = state.analysis.segments.indexOf(seg);
  const prev = idx > 0 ? state.analysis.segments[idx-1].text : '';
  const next = idx < state.analysis.segments.length-1 ? state.analysis.segments[idx+1].text : '';

  const btn = $('rewriteBtn');
  if (btn) { btn.disabled = true; btn.innerText = 'Покращення...'; }
  try {
    const res = await fetch('/api/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segmentText: seg.text, prevContext: prev, nextContext: next, seoKeywords: state.seoKeywords, creds: state.creds })
    });
    const data = await res.json();
    if (data.applied && data.rewrittenSegment) {
      state.text = state.text.slice(0, seg.startOffset) + data.rewrittenSegment + state.text.slice(seg.endOffset);
      $('editor').innerText = state.text;
      await runAnalysis();
    } else { alert(data.reason || 'Рерайт не застосовано.'); }
  } catch (e) { alert('Error: ' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.innerText = 'Покращити ШІ'; } }
}

function togglePin() {
  if (!state.selectedId) return;
  const i = state.pins.indexOf(state.selectedId);
  if (i > -1) state.pins.splice(i, 1); else state.pins.push(state.selectedId);
  renderMap(); renderInspector();
}

function selectSegment(id) {
  state.selectedId = id;
  document.querySelectorAll('.seg').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
  renderInspector();
}

function renderMetrics() {
  const container = $('metricsList');
  if (!container || !state.analysis) return;
  
  const d = state.analysis;
  let html = '';
  for (const [key, m] of Object.entries(METRICS_CONFIG)) {
    const val = d[key]; 
    if (val == null) continue;
    
    let color = '#58a6ff';
    if (m.direction === 'low') {
      if (val <= m.good) color = '#4dd0a7'; else if (val <= m.warn) color = '#e3b341'; else color = '#f85149';
    } else {
      if (val >= m.good) color = '#4dd0a7'; else if (val >= m.warn) color = '#e3b341'; else color = '#f85149';
    }
    html += `<div class="metric-card" style="border-left: 4px solid ${color};"><div class="metric-label">${m.label}</div><div class="metric-value" style="color:${color}">${Math.round(val)}${m.unit||''}</div></div>`;
  }
  container.innerHTML = html;
}

function renderMap() {
  const container = $('docRender');
  if (!container) return;
  if (!state.analysis) { container.innerHTML = 'Немає даних.'; return; }
  
  const { segments, highlights } = state.analysis;
  const hlMap = {}; (highlights||[]).forEach(h => hlMap[h.id] = h);
  let html = ''; let cursor = 0;
  
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
  document.querySelectorAll('.seg').forEach(el => el.addEventListener('click', () => selectSegment(el.dataset.id)));
}

function renderInspector() {
  const container = $('inspectorContent');
  if (!container) return;
  if (!state.analysis) { container.innerHTML = ''; return; }
  
  const d = state.analysis;
  const counts = { ai:0, rhythm:0, predictable:0, citation:0, logic_flaw:0 };
  (d.highlights||[]).forEach(h => { if(counts[h.type]!==undefined) counts[h.type]++; });
  
  let legend = '<div class="legend-grid">';
  for (const [type, meta] of Object.entries(HIGHLIGHT_CONFIG)) {
    legend += `<div class="legend-item" data-type="${type}" style="border-left:4px solid ${meta.color};cursor:pointer;" onclick="state.filter='${type}';renderMap();renderInspector();"><span>${meta.label}</span> <b>(${counts[type]||0})</b></div>`;
  }
  legend += '</div>';

  let details = '';
  if (state.selectedId) {
    const seg = d.segments.find(s => s.id === state.selectedId);
    const isPinned = state.pins.includes(state.selectedId);
    details = `<div class="seg-details"><h3>Фрагмент</h3><p>"${esc(seg?.text.slice(0,50))}..."</p><button id="btnPinDyn" class="btn-action">${isPinned?'📌 Відкріпити':'📍 Закріпити'}</button></div>`;
    setTimeout(() => { const b=$('btnPinDyn'); if(b) b.onclick=togglePin; }, 0);
  }

  container.innerHTML = legend + details;
}

document.addEventListener('DOMContentLoaded', init);
