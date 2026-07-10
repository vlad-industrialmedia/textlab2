// /api/simulate — эмуляция ответа генеративного поисковика по фактам текста.
const { callLLM } = require('./_lib/llm');
const { SIMULATE_SYSTEM } = require('./_lib/prompts');
const { setCors } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Только POST' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { text, query, creds = {} } = body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: 'Пустой текст' });
    if (!query || !query.trim()) return res.status(400).json({ error: 'Пустой запрос' });

    const userMsg = `ЗАПРОС ПОЛЬЗОВАТЕЛЯ: ${query}\n\nТЕКСТ ДЛЯ ОТВЕТА:\n${text}`;
    const result = await callLLM(SIMULATE_SYSTEM, userMsg, { maxTokens: 2000, json: true }, creds);

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
