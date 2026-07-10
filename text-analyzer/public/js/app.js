// app.js — Стабільна версія з обробкою помилок та автопідхопленням ключа.

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
  console.log('🚀 TextLab App Initialized');
  
  try {
    const editor = $('editor');
    if (editor) state.text = editor.innerText || '';

    // === 1. API КЛЮЧ ===
    const possibleKeyIds = ['apiKey', 'groqKey', 'api-key', 'key', 'creds', 'groq-api-key', 'api_key'];
    let apiKeyInput = null;
    
    for (const id of possibleKeyIds) {
      const el = $(id);
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        apiKeyInput = el;
        console.log(`🔑 Found API Key input: ${id}`);
        break;
      }
    }

    if (apiKeyInput) {
      const updateKeyState = () => {
        state.creds.groqApiKey = apiKeyInput.value.trim();
      };

      const savedKey = localStorage.getItem('groqApiKey');
      if (savedKey) {
        apiKeyInput.value = savedKey;
        state.creds.groqApiKey = savedKey;
      } else {
        updateKeyState();
      }

      apiKeyInput.addEventListener('input', updateKeyState);
      apiKeyInput.addEventListener('change', () => {
        const val = apiKeyInput.value.trim();
        if (val) localStorage.setItem('groqApiKey', val);
        else localStorage.removeItem('groqApiKey');
      });
    } else {
      console.warn('⚠️ API Key input not found!');
    }

    // === 2. КНОПКА ПЕРЕВІРКИ ===
    const possibleCheckBtnIds = ['checkKey', 'btnCheck', 'verify', 'check-key', 'test-key'];
    for (const id of possibleCheckBtnIds) {
      const btn = $(id);
      if (btn) {
        console.log(`✅ Found Check Button: ${id}`);
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          if (apiKeyInput) state.creds.groqApiKey = apiKeyInput.value.trim();
          
          btn.disabled = true;
          const originalText = btn.innerText;
          btn.innerText = 'Перевірка...';
          
          try {
            const res = await fetch('/api/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                text: 'Тестове повідомлення.', 
                creds: state.creds 
              })
            });
            
            if (res.ok) alert('✅ Ключ працює!');
            else alert('❌ Помилка: ' + await res.text());
          } catch (err) {
            alert('❌ Мережева помилка: ' + err.message);
          } finally {
            btn.disabled = false;
            btn.innerText = originalText;
          }
        });
        break;
      }
    }

    // === 3. ВСТАВКА ТЕКСТУ (PASTE) ===
    if (editor) {
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
    }

    // === 4. ОСНОВНІ КНОПКИ ===
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    console.log(`📑 Found ${tabs.length} tabs`);
    
    const btnAnalyze = $('btnAnalyze');
    if (btnAnalyze) {
      btnAnalyze.addEventListener('click', runAnalysis);
      console.log('🔘 Found Analyze button');
    }
    
    const btnRewrite = $('btnRewrite');
    if (btnRewrite) {
      btnRewrite.addEventListener('click', runRewrite);
      console.log('✍️ Found Rewrite button');
    }
    
    const seoKeysInput = $('seoKeys');
    if (seoKeysInput) {
      seoKeysInput.addEventListener('input', (e) => {
        state.seoKeywords = e.target.value.split(',').map(k => k.trim()).filter(Boolean);
      });
    }

    renderMap();
    renderInspector();
    console.log('🏁 Init finished successfully');

  } catch (error) {
    console.error('💥 CRITICAL ERROR IN INIT:', error);
    alert('Помилка ініціалізації додатку. Перевірте консоль (F12).');
  }
}

async function runAnalysis() {
  try {
    const savedKey = localStorage.getItem('groqApiKey');
    if (savedKey && !state.creds.groqApiKey) state.creds.groqApiKey = savedKey;

    const btn = $('btnAnalyze');
    if (btn) { btn.disabled = true; btn.innerText = 'Аналіз...'; }
    
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: state.text, 
        seoKeywords: state.seoKeywords, 
        creds: state.creds 
      })
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    
    state.analysis = await res.json();
    renderMap();
    renderMetrics();
    renderInspector();
  } catch (e) {
    console.error(e);
    alert('Помилка аналізу: ' + e.message);
  } finally {
    const btn = $('btnAnalyze');
    if (btn) { btn.disabled = false; btn.innerText = 'Аналізувати'; }
  }
}

async function runRewrite() {
  try {
    if (!state.selectedId || !state.analysis) return alert('Оберіть фрагмент для рерайту.');
    
    const seg = state.analysis.segments.find(s => s.id === state.selectedId);
    if (!seg) return;
    
    const idx = state.analysis.segments.indexOf(seg);
    const prevCtx = idx > 0 ? state.analysis.segments[idx - 1].text : '';
    const nextCtx = idx < state.analysis.segments.length - 1 ? state.analysis.segments[idx + 1].text : '';

    const btn = $('btnRewrite');
    if (btn) { btn.disabled = true; btn.innerText = 'Покращення...'; }
    
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
    
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    
    if (data.applied && data.rewrittenSegment) {
      state.text = state.text.slice(0, seg.startOffset) + data.rewrittenSegment + state.text.slice(seg.endOffset);
      const editor = $('editor');
      if (editor) editor.innerText = state.text;
      await runAnalysis();
    } else {
      alert(data.reason || 'Рерайт не застосовано.');
    }
  } catch (e) {
    console.error(e);
    alert('Помилка рерайту: ' + e.message);
  } finally {
    const btn = $('btnRewrite');
    if (btn) { btn.disabled = false; btn.innerText = 'Покращити ШІ'; }
  }
}

function togglePin() {
  if (!state.selectedId) return;
  const idx = state.pins.indexOf(state.selectedId);
  if (idx > -1) state.pins.splice(idx, 1);
  else state.pins.push(state.selectedId);
  
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
  try {
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
    const metricsList = $('metricsList');
    if (metricsList) metricsList.innerHTML = html;
  } catch (e) { console.error('Error in renderMetrics:', e); }
}

function renderMap() {
  try {
    if (!state.analysis) { 
      const docRender = $('docRender');
      if (docRender) docRender.innerHTML = 'Немає даних.'; 
      return; 
    }
    
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
      
      if (state.filter !== 'all' && type !== state.filter && !state.pins.includes(seg.id)) type = '';
      if (state.pins.includes(seg.id)) type = 'pinned';
      if (state.filter !== 'all' && state.filter !== 'pinned' && state.pins.includes(seg.id) && type !== state.filter) type = 'pinned';

      let tooltipText = '';
      if (h && h.type !== 'clean') {
        const hlMeta = window.HIGHLIGHT_META || {};
        const meta = hlMeta[h.type] || {};
        tooltipText = (meta.label || h.type) + ': ' + (h.details || meta.desc || '');
      }
      if (state.pins.includes(seg.id)) tooltipText = 'Закріплений фрагмент.';
      
      const isSelected = seg.id === state.selectedId ? 'selected' : '';
      html += `<span class="seg ${type} ${isSelected}" data-id="${seg.id}" title="${esc(tooltipText)}">${esc(text.slice(seg.startOffset, seg.endOffset))}</span>`;
      cursor = seg.endOffset;
    }
    
    if (cursor < text.length) html += esc(text.slice(cursor));
    
    const docRender = $('docRender');
    if (docRender) docRender.innerHTML = html;
    
    document.querySelectorAll('.seg').forEach(el => el.addEventListener('click', () => selectSegment(el.dataset.id)));
  } catch (e) { console.error('Error in renderMap:', e); }
}

function renderInspector() {
  try {
    const inspEmpty = $('inspEmpty');
    const inspContent = $('inspContent');
    
    if (!state.analysis) {
      if (inspEmpty) inspEmpty.style.display = 'block';
      if (inspContent) inspContent.innerHTML = '';
      return;
    }
    
    if (inspEmpty) inspEmpty.style.display = 'none';
    
    const d = state.analysis;
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
    
    if (state.filter !== 'all') {
      legendHtml += `<div class="legend-item" data-type="all" style="border-left: 4px solid #8b949e; cursor:pointer;">
        <span>Показати все</span>
      </div>`;
    }
    legendHtml += '</div>';

    let detailsHtml = '';
    if (state.selectedId) {
      const seg = d.segments.find(s => s.id === state.selectedId);
      const h = (d.highlights || []).find(h => h.id === state.selectedId);
      const isPinned = state.pins.includes(state.selectedId);
      
      detailsHtml += `<div class="seg-details">
        <h3>Обраний фрагмент</h3>
        <p class="seg-text">"${esc(seg ? seg.text.slice(0, 100) + '...' : '')}"</p>
        <button id="btnPinDynamic" class="btn-action">${isPinned ? '📌 Відкріпити' : '📍 Закріпити'}</button>`;
        
      if (h && h.type !== 'clean') {
        const meta = hlMeta[h.type] || {};
        detailsHtml += `<div class="issue-block" style="border-left: 4px solid ${meta.color};">
          <strong>${meta.label || h.type}</strong>
          <p>${esc(h.details || meta.desc || '')}</p>
          ${(h.suggestions || []).length ? '<ul>' + h.suggestions.map(s => `<li>${esc(s)}</li>`).join('') + '</ul>' : ''}
        </div>`;
      }
      detailsHtml += `</div>`;
    }

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
      overviewHtml += `<h3>Готові сніпети для цитування</h3>` + d.aiCitationSnippets.map(s => `<div class="snippet">"${esc(s)}"</div>`).join('');
    }

    if (inspContent) inspContent.innerHTML = legendHtml + detailsHtml + overviewHtml;

    setTimeout(() => {
      const pinBtn = $('btnPinDynamic');
      if (pinBtn) pinBtn.addEventListener('click', togglePin);
    }, 0);

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
  } catch (e) { console.error('Error in renderInspector:', e); }
}

document.addEventListener('DOMContentLoaded', init);
