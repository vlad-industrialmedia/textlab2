// stats.js — Этап 2: статистический анализ (детерминированная математика, без LLM)
const { tokenize } = require('./segment');

// ── Вспомогательные ──────────────────────────────────────────────
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
}
function stdev(arr) { return Math.sqrt(variance(arr)); }
function clamp(x, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, x)); }

// ── Burstiness ───────────────────────────────────────────────────
// Живой текст чередует короткие и длинные предложения → высокая дисперсия длин.
// ИИ выдаёт ровные предложения → низкая дисперсия. Возвращаем 0-100 (выше = «живее»).
function burstiness(sentenceLengths) {
  if (sentenceLengths.length < 2) return 50;
  const m = mean(sentenceLengths);
  const sd = stdev(sentenceLengths);
  const cv = m > 0 ? sd / m : 0; // коэффициент вариации
  // cv ~0.2 (ровно, ИИ) → низкий балл; cv ~0.7+ (живо) → высокий
  return clamp(Math.round(cv * 130));
}

// ── Type-Token Ratio ─────────────────────────────────────────────
function ttr(tokens) {
  if (!tokens.length) return 0;
  const types = new Set(tokens.map(t => t.toLowerCase()));
  return types.size / tokens.length;
}

// ── MTLD (Measure of Textual Lexical Diversity) ──────────────────
// Устойчивее TTR к длине текста. Порог фактора = 0.72 (стандарт McCarthy).
function mtld(tokens, threshold = 0.72) {
  if (tokens.length < 10) return tokens.length; // мало данных
  const compute = (seq) => {
    let factors = 0, types = new Set(), tokenCount = 0;
    for (const tok of seq) {
      tokenCount++;
      types.add(tok.toLowerCase());
      const factorTTR = types.size / tokenCount;
      if (factorTTR <= threshold) {
        factors++;
        types = new Set();
        tokenCount = 0;
      }
    }
    if (tokenCount > 0) {
      const partialTTR = types.size / tokenCount;
      const remaining = (1 - partialTTR) / (1 - threshold);
      factors += remaining;
    }
    return factors > 0 ? seq.length / factors : seq.length;
  };
  const forward = compute(tokens);
  const backward = compute([...tokens].reverse());
  return (forward + backward) / 2;
}

// ── Пассивный залог (эвристика ru/uk/en) ─────────────────────────
function passiveDensity(sentences) {
  if (!sentences.length) return 0;
  // ru/uk: причастия на -н/-т + «был/была/было/были», возвратные «-ся» в пассиве
  const passiveRe = /\b(\w+(?:ется|ется|ются|ится|ался|илась|илось|ались))\b|\b(был[аио]?|будет|были)\s+\w+(нн?ый|нн?ая|нн?ое|нн?ые|т[ыаоые]й?|н[оаы])\b|\b(is|are|was|were|be|been|being)\s+\w+(ed|en)\b/iu;
  let hits = 0;
  for (const s of sentences) if (passiveRe.test(s.text)) hits++;
  return Math.round((hits / sentences.length) * 100);
}

// ── Клише-переходы ИИ ────────────────────────────────────────────
const AI_TRANSITIONS = [
  'таким образом', 'важно отметить', 'следует отметить', 'следует подчеркнуть',
  'в данном контексте', 'тем не менее', 'более того', 'в заключение',
  'в современном мире', 'играет важную роль', 'стоит отметить', 'необходимо отметить',
  'варто зазначити', 'слід зазначити', 'таким чином', 'важливо відзначити',
  'у сучасному світі', 'відіграє важливу роль', 'крім того',
  'furthermore', 'moreover', 'it is important to note', 'in conclusion',
  'in today\'s world', 'plays a crucial role', 'it is worth noting'
];
function countAITransitions(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const t of AI_TRANSITIONS) {
    let idx = lower.indexOf(t);
    while (idx !== -1) { found.push({ phrase: t, index: idx }); idx = lower.indexOf(t, idx + 1); }
  }
  return found;
}

// ── Perplexity-прокси через биграммную частотность внутри текста ──
// Настоящий perplexity требует внешней LM с logprobs. Здесь — детерминированный
// прокси: насколько предсказуемы биграммы относительно самого текста + штраф
// за клише. Не абсолютная величина, а сравнимый внутри корпуса сигнал 0-100
// (ниже = предсказуемее = «машиннее»).
function perplexityProxy(tokens) {
  if (tokens.length < 20) return 50;
  const lower = tokens.map(t => t.toLowerCase());
  const uni = {}, bi = {};
  for (let i = 0; i < lower.length; i++) {
    uni[lower[i]] = (uni[lower[i]] || 0) + 1;
    if (i > 0) { const k = lower[i - 1] + ' ' + lower[i]; bi[k] = (bi[k] || 0) + 1; }
  }
  let sumLog = 0, n = 0;
  for (let i = 1; i < lower.length; i++) {
    const prev = lower[i - 1], cur = lower[i];
    const k = prev + ' ' + cur;
    // P(cur|prev) со сглаживанием
    const p = (bi[k] || 0 + 0.1) / (uni[prev] + 0.1 * Object.keys(uni).length);
    const pp = p > 0 ? p : 1e-6;
    sumLog += -Math.log2(pp);
    n++;
  }
  const avgSurprisal = n ? sumLog / n : 0;
  // Нормализация: типичный диапазон 2-14 бит → 0-100
  return clamp(Math.round(((avgSurprisal - 2) / 12) * 100));
}

// ── Fact density: доля предложений с проверяемой конкретикой ──────
function factDensity(sentences) {
  if (!sentences.length) return 0;
  const factRe = /\d|\b(процент|відсот|percent|%|году|року|year|according|згідно|согласно|isbn|http|www|\$|€|₴|грн|руб)\b/iu;
  let hits = 0;
  for (const s of sentences) if (factRe.test(s.text)) hits++;
  return Math.round((hits / sentences.length) * 100);
}

// ── Сборка полного статотчёта ────────────────────────────────────
function computeStats(text, sentences) {
  const allTokens = tokenize(text);
  const sentenceLengths = sentences.map(s => tokenize(s.text).length).filter(l => l > 0);

  const b = burstiness(sentenceLengths);
  const _ttr = ttr(allTokens);
  const _mtld = mtld(allTokens);
  const passive = passiveDensity(sentences);
  const transitions = countAITransitions(text);
  const perplexity = perplexityProxy(allTokens);
  const facts = factDensity(sentences);

  // Redundancy: повтор биграмм
  const bigrams = {};
  const lt = allTokens.map(t => t.toLowerCase());
  for (let i = 1; i < lt.length; i++) { const k = lt[i-1]+' '+lt[i]; bigrams[k] = (bigrams[k]||0)+1; }
  const repeated = Object.values(bigrams).filter(v => v > 2).length;
  const redundancy = clamp(Math.round((repeated / Math.max(1, Object.keys(bigrams).length)) * 400));

  // AI score (математическая часть): низкий perplexity + низкий burstiness +
  // много клише + высокий пассив → выше вероятность ИИ.
  const aiMath = clamp(Math.round(
    0.35 * (100 - perplexity) +
    0.30 * (100 - b) +
    0.20 * Math.min(100, transitions.length * 15) +
    0.15 * passive
  ));

  return {
    tokenCount: allTokens.length,
    sentenceCount: sentences.length,
    avgSentenceLength: Math.round(mean(sentenceLengths) * 10) / 10,
    sentenceLengthStdev: Math.round(stdev(sentenceLengths) * 10) / 10,
    burstinessScore: b,
    ttr: Math.round(_ttr * 1000) / 1000,
    mtld: Math.round(_mtld * 10) / 10,
    lexicalDiversity: clamp(Math.round((_mtld / 100) * 100)), // норм. к 0-100
    passiveDensity: passive,
    perplexityScore: perplexity,
    factDensity: facts,
    redundancyScore: redundancy,
    aiTransitions: transitions,
    aiScoreMath: aiMath,
    sentenceLengths,
  };
}

module.exports = {
  computeStats, burstiness, ttr, mtld, passiveDensity,
  countAITransitions, perplexityProxy, factDensity, AI_TRANSITIONS,
  mean, stdev, clamp, detectWeakSegments,
};

// ── Підсвічування «вузьких» місць на рівні сегментів (код, миттєво) ──
// Доповнює LLM-підсвітку: навіть без LLM показує проблемні речення.
function detectWeakSegments(segments) {
  const lens = segments.map(s => tokenize(s.text).length);
  const m = mean(lens.filter(l => l > 0));
  const flags = {}; // id -> { rhythm?, predictable? }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const len = lens[i];
    if (len === 0) continue;
    const f = {};

    // Ритм: речення близьке за довжиною до обох сусідів (монотонність)
    const prev = lens[i - 1], next = lens[i + 1];
    const near = (a, b) => a && b && Math.abs(a - b) <= 3;
    if ((near(len, prev) && near(len, next)) ||
        (near(len, prev) && i === segments.length - 1) ||
        (near(len, next) && i === 0)) {
      if (Math.abs(len - m) <= 4) f.rhythm = true; // і близьке до середнього
    }

    // Передбачуваність: порожні підсилювачі / штампи (без \b — він ламається на кирилиці)
    const cliche = /(^|[^а-яёіїєґ])(дуже|надзвичайно|якісн|ефективн|сучасн|унікальн|широкий спектр|цілий ряд|очень|качественн|эффективн|современн|уникальн)/iu;
    if (cliche.test(seg.text)) f.predictable = true;

    if (Object.keys(f).length) flags[seg.id] = f;
  }
  return flags;
}
