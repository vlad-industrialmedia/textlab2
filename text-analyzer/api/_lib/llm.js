// llm.js — абстракция LLM-провайдера.
// Провайдер, ключ и модель приходят от клиента (creds) ИЛИ из переменных окружения (фолбэк).
// creds = { provider, apiKey, model }

const DEFAULT_MODELS = {
  gemini: 'gemini-2.0-flash',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
  anthropic: 'claude-sonnet-4-5',
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o',
};

// Останні побачені ліміти (заповнюються після виклику OpenAI-сумісних провайдерів)
let lastRateLimit = null;
function getRateLimit() { return lastRateLimit; }

function resolveCreds(creds = {}) {
  const provider = creds.provider || process.env.LLM_PROVIDER || 'gemini';
  const apiKey = creds.apiKey || process.env[`${provider.toUpperCase()}_API_KEY`] || '';
  const model = creds.model || process.env.LLM_MODEL || DEFAULT_MODELS[provider] || '';
  return { provider, apiKey, model };
}

async function callAnthropic(system, user, opts, { apiKey, model }) {
  if (!apiKey) throw new Error('Не вказано API-ключ Anthropic');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.anthropic,
      max_tokens: opts.maxTokens || 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || '').join('\n').trim();
  return opts.json ? extractJSON(text) : text;
}

async function callOpenAICompatible(system, user, opts, { apiKey, model }, cfg) {
  if (!apiKey) throw new Error(`Не вказано API-ключ ${cfg.name}`);
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || cfg.defaultModel,
      max_tokens: opts.maxTokens || 4096,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(opts.json && cfg.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  // Витягуємо ліміти із заголовків (Groq/OpenAI їх віддають)
  lastRateLimit = {
    provider: cfg.name.toLowerCase(),
    remainingRequests: res.headers.get('x-ratelimit-remaining-requests'),
    remainingTokens: res.headers.get('x-ratelimit-remaining-tokens'),
    resetRequests: res.headers.get('x-ratelimit-reset-requests'),
    resetTokens: res.headers.get('x-ratelimit-reset-tokens'),
  };
  if (!res.ok) throw new Error(`${cfg.name} API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || '';
  return opts.json ? extractJSON(text) : text;
}

const cfgOpenAI = { name: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', defaultModel: DEFAULT_MODELS.openai, jsonMode: true };
const cfgGroq = { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', defaultModel: DEFAULT_MODELS.groq, jsonMode: true };
const cfgOpenRouter = { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', defaultModel: DEFAULT_MODELS.openrouter, jsonMode: true };

async function callGemini(system, user, opts, { apiKey, model }) {
  if (!apiKey) throw new Error('Не вказано API-ключ Gemini');
  const m = model || DEFAULT_MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
  const genCfg = {
    maxOutputTokens: opts.maxTokens || 4096,
    temperature: 0.4,
    ...(opts.json ? { responseMimeType: 'application/json' } : {}),
  };
  // Вимикаємо thinking-бюджет у 2.5-моделей, інакше вони «з'їдають» токени на роздуми
  // й повертають порожню відповідь.
  if (/2\.5/.test(m)) genCfg.thinkingConfig = { thinkingBudget: 0 };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: genCfg,
    }),
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 500);
    // Дістаємо зрозуміле повідомлення з тіла помилки
    let hint = '';
    if (/API_KEY_INVALID|API key not valid/i.test(errText)) hint = ' — ключ невірний';
    else if (/not found|is not found for API|NOT_FOUND/i.test(errText)) hint = ` — модель "${m}" недоступна цьому ключу`;
    else if (/PERMISSION_DENIED/i.test(errText)) hint = ' — немає доступу (увімкніть Generative Language API)';
    else if (/RESOURCE_EXHAUSTED|quota/i.test(errText)) hint = ' — вичерпано ліміт';
    throw new Error(`Gemini API ${res.status}${hint}: ${errText}`);
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  // Порожня відповідь через фільтри/бюджет
  if (!cand || cand.finishReason === 'SAFETY') {
    throw new Error('Gemini: порожня відповідь (спрацював фільтр безпеки або бюджет токенів). Спробуйте іншу модель.');
  }
  const text = (cand.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini повернув порожній текст. Спробуйте модель gemini-2.0-flash.');
  return opts.json ? extractJSON(text) : text;
}

function extractJSON(text) {
  let clean = text.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first !== -1 && last !== -1) clean = clean.slice(first, last + 1);
  try { return JSON.parse(clean); }
  catch (e) { throw new Error('LLM повернув невалідний JSON: ' + clean.slice(0, 300)); }
}

async function callLLM(system, user, opts = {}, creds = {}) {
  const c = resolveCreds(creds);
  const o = { maxTokens: opts.maxTokens || 4096, json: opts.json || false };
  switch (c.provider) {
    case 'openai':     return callOpenAICompatible(system, user, o, c, cfgOpenAI);
    case 'gemini':     return callGemini(system, user, o, c);
    case 'groq':       return callOpenAICompatible(system, user, o, c, cfgGroq);
    case 'openrouter': return callOpenAICompatible(system, user, o, c, cfgOpenRouter);
    case 'anthropic':  return callAnthropic(system, user, o, c);
    default:           return callGemini(system, user, o, c);
  }
}

module.exports = { callLLM, extractJSON, DEFAULT_MODELS, getRateLimit };
