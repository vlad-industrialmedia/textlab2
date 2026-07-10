// /api/analyze — трёхэтапный анализ: препроцессинг → статистика → LLM-семантика.
const { segmentSentences, findProtectedSpans } = require('./_lib/segment');
const { computeStats, detectWeakSegments } = require('./_lib/stats');
const { callLLM, getRateLimit } = require('./_lib/llm');
const { ANALYZE_SYSTEM } = require('./_lib/prompts');
const { setCors } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Только POST' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { text, seoKeywords = [], seedKeyword = '', creds = {} } = body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: 'Пустой текст' });

    // Этап 1: препроцессинг
    const segments = segmentSentences(text);
    const protectedSpans = findProtectedSpans(text, seoKeywords);

    // Этап 2: статистика (детерминированная математика)
    const stats = computeStats(text, segments);

    // Этап 3: LLM-семантика поверх готовых метрик
    const llmInput = JSON.stringify({
      segments: segments.map(s => ({ id: s.id, text: s.text })),
      seoKeywords,
      seedKeyword,
      stats: {
        perplexityScore: stats.perplexityScore,
        burstinessScore: stats.burstinessScore,
        passiveDensity: stats.passiveDensity,
        factDensity: stats.factDensity,
        aiScoreMath: stats.aiScoreMath,
      },
    });

    let semantic = {};
    let llmError = null;
    try {
      semantic = await callLLM(ANALYZE_SYSTEM, llmInput, { maxTokens: 6000, json: true }, creds);
    } catch (e) {
      llmError = e.message;
    }

    // Сборка AI Fingerprints из математики
    const fingerprints = [];
    if (stats.burstinessScore < 40) fingerprints.push({ marker: 'Zero Burstiness', severity: stats.burstinessScore < 25 ? 'high' : 'medium', description: 'Предложения слишком одинаковой длины — признак машинного ритма' });
    if (stats.perplexityScore < 30) fingerprints.push({ marker: 'Predictable Tokens', severity: 'high', description: 'Высокая предсказуемость последовательности слов' });
    if (stats.passiveDensity > 30) fingerprints.push({ marker: 'Passive Voice Overuse', severity: stats.passiveDensity > 50 ? 'high' : 'medium', description: `Пассивный залог в ${stats.passiveDensity}% предложений` });
    if (stats.aiTransitions.length >= 2) fingerprints.push({ marker: 'Template Transitions', severity: stats.aiTransitions.length >= 4 ? 'high' : 'medium', description: `Шаблонных переходов: ${stats.aiTransitions.length}` });

    // Объединённый AI score: математика + семантический сигнал от LLM (если есть)
    const aiScore = stats.aiScoreMath;
    const confidence = clampConfidence(stats, segments.length);

    // Об'єднуємо підсвітку LLM з код-детектором «вузьких» місць.
    // Код підстраховує: навіть якщо LLM не позначила ритм/передбачуваність — код позначить.
    const weak = detectWeakSegments(segments);
    const llmHl = semantic.highlights ?? [];
    const byId = {}; llmHl.forEach(h => { byId[h.id] = h; });
    for (const [id, f] of Object.entries(weak)) {
      const existing = byId[id];
      // Якщо LLM уже дала цьому сегменту вагому проблему — не перекриваємо
      if (existing && existing.type && !['clean'].includes(existing.type)) continue;
      const type = f.predictable ? 'predictable' : 'rhythm';
      const details = f.predictable
        ? 'Порожні підсилювачі або штампи («якісний», «ефективний», «сучасний», «дуже») роблять текст передбачуваним. Замініть на конкретику.'
        : 'Речення близьке за довжиною до сусідніх — монотонний ритм. Спробуйте розбити на два коротких або, навпаки, злити.';
      const merged = { id, type, score: 55, issue: f.predictable ? 'Штампи/підсилювачі' : 'Монотонний ритм', details, suggestions: [], source: 'code' };
      if (existing) byId[id] = merged; else { llmHl.push(merged); byId[id] = merged; }
    }
    const highlights = llmHl;

    return res.status(200).json({
      segments,
      protectedSpans,
      // математические метрики
      aiScore,
      confidenceScore: confidence,
      perplexityScore: stats.perplexityScore,
      burstinessScore: stats.burstinessScore,
      lexicalDiversity: stats.lexicalDiversity,
      mtld: stats.mtld,
      passiveDensity: stats.passiveDensity,
      factDensity: stats.factDensity,
      redundancyScore: stats.redundancyScore,
      readability: readabilityFrom(stats),
      aiFingerprints: fingerprints,
      aiTransitions: stats.aiTransitions,
      // семантические метрики от LLM (с фолбэком)
      geoScore: semantic.geoScore ?? null,
      informationGain: semantic.informationGain ?? null,
      logicalFlowScore: semantic.logicalFlowScore ?? null,
      semanticSeoScore: semantic.semanticSeoScore ?? null,
      helpfulContentScore: semantic.helpfulContentScore ?? null,
      citationPotential: semantic.citationPotential ?? null,
      llmReadiness: semantic.llmReadiness ?? null,
      highlights,
      aiCitationSnippets: semantic.aiCitationSnippets ?? [],
      logicFlaws: semantic.logicFlaws ?? [],
      entities: semantic.entities ?? { found: [], coverage: null, missing: [] },
      topicCoverage: semantic.topicCoverage ?? { covered: [], missing: [] },
      queryCoverage: semantic.queryCoverage ?? { seedKeyword, covered: [], missing: [] },
      semanticOutliers: semantic.semanticOutliers ?? [],
      recommendations: semantic.recommendations ?? [],
      rateLimit: getRateLimit(),
      llmError, // null если LLM отработал; текст ошибки если только статистика
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

function readabilityFrom(stats) {
  // Простая читабельность: штраф за длинные предложения и пассив
  let r = 100;
  if (stats.avgSentenceLength > 20) r -= (stats.avgSentenceLength - 20) * 2;
  r -= stats.passiveDensity * 0.3;
  return Math.max(0, Math.min(100, Math.round(r)));
}

function clampConfidence(stats, nSeg) {
  // Уверенность выше на длинных текстах
  let c = 50 + Math.min(40, nSeg * 3);
  return Math.min(95, c);
}
