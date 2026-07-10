// /api/rewrite — рерайт фрагмента с защитой SEO-ключей и авто-откатом.
const { validateProtectedKeywords } = require('./_lib/segment');
const { callLLM } = require('./_lib/llm');
const { REWRITE_SYSTEM } = require('./_lib/prompts');
const { setCors } = require('./_lib/auth');

module.exports = async function handler(req, res) {
 setCors(res);
 if (req.method === 'OPTIONS') return res.status(200).end();
 if (req.method !== 'POST') return res.status(405).json({ error: 'Только POST' });

 try {
 const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
 const { text, seoKeywords = [], goal = 'humanize', creds = {} } = body || {};
 if (!text || !text.trim()) return res.status(400).json({ error: 'Пустой текст' });

 // === ЗАХИСТ ВІД ПОМИЛКИ 413 ===
 if (text.length > 20000) return res.status(400).json({ error: 'Текст занадто довгий. Будь ласка, скоротіть його до 20 000 символів.' });

 const presentKeys = seoKeywords.filter(k =>
 k && text.toLowerCase().includes(k.trim().toLowerCase()));

 const system = REWRITE_SYSTEM.replace('{seoKeywords}', JSON.stringify(presentKeys));
 const userMsg = `ЦЕЛЬ РЕРАЙТА: ${goal}\nКЛЮЧИ ДЛЯ ДОСЛОВНОГО СОХРАНЕНИЯ: ${JSON.stringify(presentKeys)}\n\nТЕКСТ:\n${text}`;

 let rewritten = await callLLM(system, userMsg, { maxTokens: 2000, json: false }, creds);

 let check = validateProtectedKeywords(rewritten, presentKeys);
 let retried = false;

 if (!check.ok) {
 retried = true;
 const retryMsg = `${userMsg}\n\nВНИМАНИЕ: в предыдущей попытке пропали ключи: ${JSON.stringify(check.missing)}. Эти ключи ОБЯЗАНЫ присутствовать дословно.`;
 rewritten = await callLLM(system, retryMsg, { maxTokens: 2000, json: false }, creds);
 check = validateProtectedKeywords(rewritten, presentKeys);
 }

 if (!check.ok) {
 return res.status(200).json({
 rewritten: text,
 applied: false,
 reason: `Рерайт отклонён: не удалось сохранить ключи ${check.missing.join(', ')}. Возвращён оригинал.`,
 missing: check.missing,
 retried,
 });
 }

 return res.status(200).json({ rewritten, applied: true, retried });
 } catch (e) {
 return res.status(500).json({ error: e.message });
 }
};
