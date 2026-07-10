// markdown.js — конвертація між contenteditable-HTML і markdown.
// Аналіз працює з markdown-текстом (offset'и рахуються на ньому),
// а редактор і експорт показують форматування.

// HTML з редактора → markdown-текст
function htmlToMarkdown(root) {
  let md = '';
  function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { md += child.textContent; continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'h1') { md += '# ' + child.textContent.trim() + '\n\n'; }
      else if (tag === 'h2') { md += '## ' + child.textContent.trim() + '\n\n'; }
      else if (tag === 'h3') { md += '### ' + child.textContent.trim() + '\n\n'; }
      else if (tag === 'ul') { for (const li of child.querySelectorAll(':scope > li')) md += '- ' + li.textContent.trim() + '\n'; md += '\n'; }
      else if (tag === 'ol') { let i = 1; for (const li of child.querySelectorAll(':scope > li')) md += (i++) + '. ' + li.textContent.trim() + '\n'; md += '\n'; }
      else if (tag === 'p' || tag === 'div') { const t = child.textContent.trim(); if (t) md += t + '\n\n'; else md += '\n'; }
      else if (tag === 'br') { md += '\n'; }
      else if (tag === 'strong' || tag === 'b') { md += '**' + child.textContent + '**'; }
      else { walk(child); }
    }
  }
  walk(root);
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

// markdown-текст → HTML для редактора
function markdownToHtml(md) {
  const lines = (md || '').split('\n');
  let html = '', listType = null;
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  for (let raw of lines) {
    const line = raw.trimEnd();
    if (/^#\s+/.test(line)) { closeList(); html += `<h1>${escapeHtml(line.replace(/^#\s+/, ''))}</h1>`; }
    else if (/^##\s+/.test(line)) { closeList(); html += `<h2>${escapeHtml(line.replace(/^##\s+/, ''))}</h2>`; }
    else if (/^###\s+/.test(line)) { closeList(); html += `<h3>${escapeHtml(line.replace(/^###\s+/, ''))}</h3>`; }
    else if (/^[-*]\s+/.test(line)) { if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; } html += `<li>${inlineMd(line.replace(/^[-*]\s+/, ''))}</li>`; }
    else if (/^\d+\.\s+/.test(line)) { if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; } html += `<li>${inlineMd(line.replace(/^\d+\.\s+/, ''))}</li>`; }
    else if (line.trim() === '') { closeList(); }
    else { closeList(); html += `<p>${inlineMd(line)}</p>`; }
  }
  closeList();
  return html || '';
}

function inlineMd(s) { return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
function escapeHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Отримати чистий текст (для аналізу offset'и рахуються саме на ньому = markdown)
function getEditorMarkdown(el) { return htmlToMarkdown(el); }
function setEditorMarkdown(el, md) { el.innerHTML = markdownToHtml(md); }

window.htmlToMarkdown = htmlToMarkdown;
window.markdownToHtml = markdownToHtml;
window.getEditorMarkdown = getEditorMarkdown;
window.setEditorMarkdown = setEditorMarkdown;
