// export.js — генерація автономного HTML-звіту з підсвічуванням і рекомендаціями.
// Файл самодостатній: інлайновий CSS + текст із <span>, клік показує діагностику.

function buildHtmlReport(text, analysis) {
  const M = window.METRICS_META, ORDER = window.METRICS_ORDER, HL = window.HIGHLIGHT_META;
  const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Метрики
  const metricsHtml = ORDER.map(k => {
    const meta = M[k]; const v = analysis[k];
    if (v === null || v === undefined) return '';
    const cls = zoneClass(k, v, meta);
    return `<div class="metric ${cls}"><div class="ml">${esc(meta.label)}</div><div class="mv">${v}${meta.unit||''}</div><div class="mz">${esc(meta.zones)}</div></div>`;
  }).join('');

  // Карта тексту
  const hlMap = {}; (analysis.highlights || []).forEach(h => hlMap[h.id] = h);
  let doc = ''; let cursor = 0;
  for (const seg of analysis.segments) {
    if (seg.startOffset > cursor) doc += esc(text.slice(cursor, seg.startOffset));
    const h = hlMap[seg.id];
    const type = h && h.type && h.type !== 'clean' ? h.type : '';
    if (type) {
      const det = esc(h.details || '');
      const sug = (h.suggestions || []).map(s => esc(s)).join(' | ');
      doc += `<span class="seg ${type}" data-det="${det}" data-sug="${sug}" data-type="${type}">${esc(text.slice(seg.startOffset, seg.endOffset))}</span>`;
    } else {
      doc += esc(text.slice(seg.startOffset, seg.endOffset));
    }
    cursor = seg.endOffset;
  }
  if (cursor < text.length) doc += esc(text.slice(cursor));

  // Легенда
  const legend = Object.entries(HL).map(([k, v]) =>
    `<span class="lg"><i style="background:${v.color}"></i>${esc(v.label)}</span>`).join('');

  // Рекомендації
  const recs = (analysis.recommendations || []).map(r => {
    const imp = r.expectedImpact ? Object.entries(r.expectedImpact).map(([k, v]) => `${k} ${v}`).join(' · ') : '';
    return `<div class="rec ${r.priority||''}"><b>${esc(r.title||'')}</b><p>${esc(r.description||'')}</p>${imp?`<span class="imp">${esc(imp)}</span>`:''}</div>`;
  }).join('');

  // Логічні вади
  const flaws = (analysis.logicFlaws || []).map(f =>
    `<div class="rec high"><b>${esc(f.type||'')}</b> <span class="sid">${esc(f.segmentId||'')}</span><p>${esc(f.explanation||'')}</p><p class="fix">→ ${esc(f.fix||'')}</p></div>`).join('');

  // Сніпети
  const snips = (analysis.aiCitationSnippets || []).map(s => `<li>${esc(s)}</li>`).join('');

  return `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Textlab — звіт</title>
<style>
:root{--bg:#0e1116;--panel:#161b22;--elev:#1c232d;--bd:#2a323d;--ink:#e6edf3;--dim:#8b98a5;--faint:#5c6672;--acc:#4dd0a7}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6;padding:32px;max-width:1000px;margin:0 auto}
h1{font-size:20px;margin-bottom:4px}.sub{color:var(--faint);font-size:13px;margin-bottom:24px}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px}
.metric{background:var(--elev);border:1px solid var(--bd);border-radius:8px;padding:12px}
.metric .ml{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-family:monospace}
.metric .mv{font-size:22px;font-weight:600;margin:3px 0;font-family:monospace}
.metric .mz{font-size:10px;color:var(--dim);line-height:1.4}
.metric.good .mv{color:var(--acc)}.metric.warn .mv{color:#f0883e}.metric.bad .mv{color:#db6d6d}
.legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px;font-size:12px;color:var(--dim)}
.legend .lg{display:inline-flex;align-items:center;gap:5px}.legend i{width:10px;height:10px;border-radius:2px;display:inline-block}
.doc{background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:26px 30px;font-size:15px;line-height:1.9;white-space:pre-wrap;word-wrap:break-word;margin-bottom:24px}
.seg{border-radius:3px;padding:1px 0;cursor:pointer;border-bottom:2px solid transparent}
.seg.ai{border-bottom-color:#a371f7;background:rgba(163,113,247,.08)}
.seg.low_geo{border-bottom-color:#58a6ff;background:rgba(88,166,255,.07)}
.seg.logic_flaw{border-bottom-color:#f0883e;background:rgba(240,136,62,.08)}
.seg.low_relevance{border-bottom-color:#db6d6d;background:rgba(219,109,109,.08)}
.seg.rhythm{border-bottom-color:#e3b341;background:rgba(227,179,65,.08)}
.seg.predictable{border-bottom-color:#6cb6ff;background:rgba(108,182,255,.07)}
.seg.citation{border-bottom-color:#4dd0a7;background:rgba(77,208,167,.10)}
.seg.pinned{border-bottom-color:#2f7a63;background:rgba(47,122,99,.15)}
.seg:hover{filter:brightness(1.3)}
h2{font-size:14px;font-family:monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin:24px 0 12px}
.rec{border-left:3px solid var(--bd);padding:8px 12px;margin-bottom:10px;background:var(--elev);border-radius:0 6px 6px 0}
.rec.critical{border-left-color:#db6d6d}.rec.high{border-left-color:#f0883e}.rec.medium{border-left-color:#58a6ff}
.rec b{font-size:13px}.rec p{font-size:12px;color:var(--dim);margin-top:3px}.rec .imp{font-family:monospace;font-size:10px;color:var(--acc)}
.rec .fix{color:var(--acc)}.rec .sid{font-family:monospace;font-size:10px;color:var(--faint)}
ul{margin-left:20px;font-size:13px;color:var(--dim)}ul li{margin-bottom:6px}
#pop{position:fixed;max-width:340px;background:#0a0d12;border:1px solid #3d4856;border-radius:8px;padding:12px 14px;font-size:12px;line-height:1.5;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,.5);display:none}
#pop .pt{font-family:monospace;font-size:10px;text-transform:uppercase;color:var(--acc);margin-bottom:5px}
#pop .ps{margin-top:7px;padding-top:7px;border-top:1px solid var(--bd);color:var(--dim)}
</style></head><body>
<h1>Textlab — звіт аудиту</h1>
<div class="sub">${new Date().toLocaleString('uk')} · ${analysis.segments.length} сегментів</div>
<div class="metrics">${metricsHtml}</div>
<div class="legend">${legend}</div>
<h2>Карта розмітки <span style="font-weight:400;font-size:11px;text-transform:none">— клікніть на підсвічене речення</span></h2>
<div class="doc">${doc}</div>
${snips?`<h2>Готові сніпети для цитування</h2><ul>${snips}</ul>`:''}
${flaws?`<h2>Логічні вади</h2>${flaws}`:''}
${recs?`<h2>Рекомендації</h2>${recs}`:''}
<div id="pop"></div>
<script>
document.querySelectorAll('.seg').forEach(function(el){
  el.addEventListener('click',function(e){
    var p=document.getElementById('pop');
    var types={ai:'ШІ-патерн',rhythm:'Монотонний ритм',predictable:'Штампи',low_geo:'Несамодостатнє',citation:'Цінне — не видаляй',logic_flaw:'Логіка',low_relevance:'Нерелевантне',pinned:'Закріплено'};
    var sug=el.dataset.sug?'<div class="ps"><b>Варіанти:</b> '+el.dataset.sug+'</div>':'';
    p.innerHTML='<div class="pt">'+(types[el.dataset.type]||'')+'</div>'+el.dataset.det+sug;
    p.style.display='block';
    var x=Math.min(e.clientX+12,window.innerWidth-360),y=Math.min(e.clientY+12,window.innerHeight-160);
    p.style.left=x+'px';p.style.top=y+'px';
    e.stopPropagation();
  });
});
document.addEventListener('click',function(){document.getElementById('pop').style.display='none';});
<\/script>
</body></html>`;
}

function zoneClass(key, v, meta) {
  if (typeof v !== 'number') return '';
  if (meta.direction === 'low') {
    if (v <= meta.good) return 'good';
    if (v <= meta.warn) return 'warn';
    return 'bad';
  } else {
    if (v >= meta.good) return 'good';
    if (v >= meta.warn) return 'warn';
    return 'bad';
  }
}

window.buildHtmlReport = buildHtmlReport;
window.zoneClass = zoneClass;
