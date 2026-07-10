// segment.js — Этап 1: препроцессинг (без LLM)
// Сегментация на предложения с сохранением точных offset'ов,
// разметка protected spans (SEO-ключи), базовая токенизация.

// Аббревиатуры, после которых точка НЕ завершает предложение (ru/uk/en)
const ABBREVIATIONS = new Set([
  'т.д', 'т.п', 'т.е', 'т.к', 'др', 'пр', 'см', 'рис', 'табл', 'стр',
  'г', 'гг', 'в', 'вв', 'н.э', 'до н.э', 'ул', 'д', 'кв', 'обл',
  'руб', 'коп', 'млн', 'млрд', 'тыс', 'проф', 'акад', 'доц',
  'напр', 'англ', 'лат', 'греч', 'рус', 'укр',
  'mr', 'mrs', 'dr', 'prof', 'inc', 'ltd', 'etc', 'vs', 'eg', 'ie',
  'ім', 'вул', 'буд', 'кв', 'обл', 'р', 'рр', 'ст', 'см'
]);

/**
 * Разбивает текст на предложения, сохраняя точные символьные offset'ы.
 * Конкатенация всех segment.text + пропущенных пробелов восстанавливает оригинал.
 * @param {string} text
 * @returns {Array<{id:string, text:string, startOffset:number, endOffset:number}>}
 */
function segmentSentences(text) {
  const segments = [];
  let segIndex = 0;

  // Границы абзацев считаем твёрдыми разделителями
  const sentenceEnd = /([.!?…]+)(["'»)\]]*)(\s|$)/g;

  let lastCut = 0;
  let match;

  while ((match = sentenceEnd.exec(text)) !== null) {
    const endPunctPos = match.index;
    const fullEnd = sentenceEnd.lastIndex;

    // Слово перед точкой — проверка на аббревиатуру
    const before = text.slice(lastCut, endPunctPos + match[1].length);
    const lastWord = (before.match(/([A-Za-zА-Яа-яЁёІіЇїЄєҐґ.]+)\.?\s*$/) || [])[1] || '';
    const cleaned = lastWord.replace(/\.$/, '').toLowerCase();

    if (ABBREVIATIONS.has(cleaned)) continue; // не режем на аббревиатуре

    // Одиночная заглавная буква + точка (инициал) — не режем
    if (/\b[A-ZА-ЯЁІЇЄҐ]\.$/.test(before.trim())) continue;

    const raw = text.slice(lastCut, fullEnd);
    const trimmedStart = raw.length - raw.trimStart().length;
    const trimmedEnd = raw.length - raw.trimEnd().length;
    const startOffset = lastCut + trimmedStart;
    const endOffset = fullEnd - trimmedEnd;
    const segText = text.slice(startOffset, endOffset);

    if (segText.trim().length > 0) {
      segments.push({
        id: `seg_${segIndex++}`,
        text: segText,
        startOffset,
        endOffset,
      });
    }
    lastCut = fullEnd;
  }

  // Хвост без завершающей пунктуации
  if (lastCut < text.length) {
    const raw = text.slice(lastCut);
    const trimmedStart = raw.length - raw.trimStart().length;
    const startOffset = lastCut + trimmedStart;
    const segText = text.slice(startOffset).trimEnd();
    if (segText.trim().length > 0) {
      segments.push({
        id: `seg_${segIndex++}`,
        text: segText,
        startOffset,
        endOffset: startOffset + segText.length,
      });
    }
  }

  return segments;
}

/**
 * Разбивка на абзацы по двойным переносам строк.
 */
function segmentParagraphs(text) {
  const paras = [];
  const re = /\n\s*\n/g;
  let last = 0, m, idx = 0;
  while ((m = re.exec(text)) !== null) {
    const chunk = text.slice(last, m.index);
    if (chunk.trim()) paras.push({ id: `par_${idx++}`, text: chunk.trim(), startOffset: last, endOffset: m.index });
    last = re.lastIndex;
  }
  if (last < text.length && text.slice(last).trim()) {
    paras.push({ id: `par_${idx++}`, text: text.slice(last).trim(), startOffset: last, endOffset: text.length });
  }
  return paras;
}

/**
 * Находит все вхождения SEO-ключей и помечает как protected spans.
 * @param {string} text
 * @param {string[]} keywords
 * @returns {Array<{keyword:string, start:number, end:number}>}
 */
function findProtectedSpans(text, keywords = []) {
  const spans = [];
  for (const kw of keywords) {
    if (!kw || !kw.trim()) continue;
    const esc = kw.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc, 'giu');
    let m;
    while ((m = re.exec(text)) !== null) {
      spans.push({ keyword: kw.trim(), start: m.index, end: m.index + m[0].length });
      if (m.index === re.lastIndex) re.lastIndex++; // защита от zero-length
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Проверяет, что все protected spans присутствуют в переписанном тексте.
 * @returns {{ok:boolean, missing:string[]}}
 */
function validateProtectedKeywords(rewritten, keywords = []) {
  const missing = [];
  const lower = rewritten.toLowerCase();
  for (const kw of keywords) {
    if (!kw || !kw.trim()) continue;
    if (!lower.includes(kw.trim().toLowerCase())) missing.push(kw.trim());
  }
  return { ok: missing.length === 0, missing };
}

/** Простая токенизация по словам (ru/uk/en + цифры). */
function tokenize(text) {
  return (text.match(/[A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9]+/gu) || []);
}

module.exports = {
  segmentSentences,
  segmentParagraphs,
  findProtectedSpans,
  validateProtectedKeywords,
  tokenize,
  ABBREVIATIONS,
};
