// markdown.js — конвертація між contenteditable-HTML і markdown.

function htmlToMarkdown(root) {
 let md = '';
 function inlineFormat(node) {
   let res = '';
   for (const child of node.childNodes) {
     if (child.nodeType === 3) { res += child.textContent; continue; }
     if (child.nodeType !== 1) continue;
     const t = child.tagName.toLowerCase();
     if (t === 'strong' || t === 'b') res += '**' + inlineFormat(child) + '**';
     else if (t === 'em' || t === 'i') res += '*' + inlineFormat(child) + '*';
     else if (t === 'a') res += '[' + inlineFormat(child) + '](' + (child.getAttribute('href') || '') + ')';
     else if (t === 'br') res += '\n';
     else res += inlineFormat(child);
   }
   return res;
 }

 function walk(node) {
 for (const child of node.childNodes) {
 if (child.nodeType === 3) { md += child.textContent; continue; }
 if (child.nodeType !== 1) continue;
 const tag = child.tagName.toLowerCase();
 
 if (tag === 'h1') { md += '# ' + inlineFormat(child).trim() + '\n\n'; }
 else if (tag === 'h2') { md += '## ' + inlineFormat(child).trim() + '\n\n'; }
 else if (tag === 'h3') { md += '### ' + inlineFormat(child).trim() + '\n\n'; }
 else if (tag === 'ul') { 
   for (const li of child.querySelectorAll(':scope > li')) md += '- ' + inlineFormat(li).trim() + '\n'; 
   md += '\n'; 
 }
 else if (tag === 'ol') { 
   let i = 1; 
   for (const li of child.querySelectorAll(':scope > li')) md += (i++) + '. ' + inlineFormat(li).trim() + '\n'; 
   md += '\n'; 
 }
 else if (tag === 'p' || tag === 'div') { 
   const t = inlineFormat(child).trim(); 
   if (t) md += t + '\n\n'; 
   else md += '\n'; 
 }
 else if (tag === 'br') { md += '\n'; }
 else if (tag === 'strong' || tag === 'b') { md += '**' + inlineFormat(child) + '**'; }
 else if (tag === 'em' || tag === 'i') { md += '*' + inlineFormat(child) + '*'; }
 else if (tag === 'a') { md += '[' + inlineFormat(child) + '](' + (child.getAttribute('href') || '') + ')'; }
 else { walk(child); }
 }
 }
 
 walk(root);
 return md.replace(/\n{3,}/g, '\n\n').trim();
}

function markdownToHtml(md) {
 const lines = (md || '').split('\n');
 let html = '', listType = null;
 const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
 
 for (let raw of lines) {
 const line = raw.trimEnd();
 if (/^#\s+/.test(line)) { closeList(); html += `<h1>${inlineMd(line.replace(/^#\s+/, ''))}</h1>`; }
 else if (/^##\s+/.test(line)) { closeList(); html += `<h2>${inlineMd(line.replace(/^##\s+/, ''))}</h2>`; }
 else if (/^###\s+/.test(line)) { closeList(); html += `<h3>${inlineMd(line.replace(/^###\s+/, ''))}</h3>`; }
 else if (/^[-*]\s+/.test(line)) { 
   if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; } 
   html += `<li>${inlineMd(line.replace(/^[-*]\s+/, ''))}</li>`; 
 }
 else if (/^\d+\.\s+/.test(line)) { 
   if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; } 
   html += `<li>${inlineMd(line.replace(/^\d+\.\s+/, ''))}</li>`; 
 }
 else if (line.trim() === '') { closeList(); }
 else { closeList(); html += `<p>${inlineMd(line)}</p>`; }
 }
 closeList();
 return html || '';
}

function inlineMd(s) { 
  let res = escapeHtml(s);
  res = res.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  res = res.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  res = res.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return res;
}

function escapeHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// === НОВЕ: ОЧИЩЕННЯ HTML ПРИ ВСТАВЦІ ===
function sanitizePastedHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const allowed = ['H1','H2','H3','P','UL','OL','LI','STRONG','B','EM','I','A','BR'];
    
    function clean(node) {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 3) continue; 
            if (child.nodeType !== 1) { child.remove(); continue; }
            if (!allowed.includes(child.tagName)) {
                while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
                child.remove();
            } else {
                for (const attr of Array.from(child.attributes)) {
                    if (child.tagName === 'A' && attr.name === 'href') continue;
                    child.removeAttribute(attr.name);
                }
                clean(child);
            }
        }
    }
    clean(doc.body);
    return doc.body.innerHTML;
}

function getEditorMarkdown(el) { return htmlToMarkdown(el); }
function setEditorMarkdown(el, md) { el.innerHTML = markdownToHtml(md); }

window.htmlToMarkdown = htmlToMarkdown;
window.markdownToHtml = markdownToHtml;
window.getEditorMarkdown = getEditorMarkdown;
window.setEditorMarkdown = setEditorMarkdown;
window.sanitizePastedHtml = sanitizePastedHtml;
