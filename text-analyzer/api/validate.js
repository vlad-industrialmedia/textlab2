// /api/validate — перевірка валідності ключа: мінімальний запит до провайдера.
const { callLLM } = require('./_lib/llm');
const { setCors } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Тільки POST' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { creds = {} } = body || {};
    if (!creds.apiKey) return res.status(200).json({ ok: false, error: 'Ключ не введено' });

    // Мінімальний запит — просимо відповісти одним словом
    const t0 = Date.now();
    const reply = await callLLM(
      'Reply with exactly one word: OK',
      'ping',
      { maxTokens: 10, json: false },
      creds
    );
    const ms = Date.now() - t0;
    return res.status(200).json({ ok: true, provider: creds.provider, latencyMs: ms, sample: (reply || '').slice(0, 40) });
  } catch (e) {
    // Розбираємо типові помилки для зрозумілого повідомлення
    let msg = e.message || 'Невідома помилка';
    if (/401|403|invalid|unauthor|api key/i.test(msg)) msg = 'Ключ невірний або не має доступу';
    else if (/429|quota|rate/i.test(msg)) msg = 'Вичерпано ліміт запитів (спробуйте пізніше)';
    else if (/model/i.test(msg)) msg = 'Невірна назва моделі';
    return res.status(200).json({ ok: false, error: msg });
  }
};
