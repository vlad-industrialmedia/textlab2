// /api/rewrite — контекстний рерайт фрагмента.
const { validateProtectedKeywords } = require('./_lib/segment');
const { callLLM } = require('./_lib/llm');
const { setCors } = require('./_lib/auth');

module.exports = async function handler(req, res) {
 setCors(res);
 if (req.method === 'OPTIONS') return res.status(200).end();
 if (req.method !== 'POST') return res.status(405).json({ error: 'Только POST' });

 try {
 const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
 const { segmentText, prevContext = '', nextContext = '', seoKeywords = [], creds = {} } = body || {};
 
 if (!segmentText || !segmentText.trim()) return res.status(400).json({ error: 'Пустой фрагмент' });

 const presentKeys = seoKeywords.filter(k =>
 k && segmentText.toLowerCase().includes(k.trim().toLowerCase()));

 const system = `Ти — професійний редактор. Твоє завдання — покращити ЦІЛЬОВИЙ ФРАГМЕНТ тексту.
ПРАВИЛА:
1. Збережи початковий зміст і факти. Не вигадуй нові твердження.
2. НЕ використовуй шаблонні початки речень (наприклад, "Це означає", "Варто зазначити", "Отже").
3. Забезпеч плавний перехід від ПОПЕРЕДНЬОГО КОНТЕКСТУ до ЦІЛЬОВОГО, і від ЦІЛЬОВОГО до НАСТУПНОГО.
4. Уникай "масла масляного" і тавтології.
5. Збережи надані SEO-ключі дослівно.`;

 const userMsg = `ПОПЕРЕДНІЙ КОНТЕКСТ: ${prevContext}\n\nЦІЛЬОВИЙ ФРАГМЕНТ (ПОКРАЩИТИ): ${segmentText}\n\nНАСТУПНИЙ КОНТЕКСТ: ${nextContext}\n\nSEO-КЛЮЧІ: ${JSON.stringify(presentKeys)}`;

 let rewritten = await callLLM(system, userMsg, { maxTokens: 2000, json: false }, creds);

 // Перевірка ключів
 let check = validateProtectedKeywords(rewritten, presentKeys);
 let retried = false;

 if (!check.ok) {
 retried = true;
 const retryMsg = `${userMsg}\n\nУВАГА: у попередній спробі зникли ключі: ${JSON.stringify(check.missing)}. Вони ОБОВ'ЯЗКОВО мають бути в тексті дослівно.`;
 rewritten = await callLLM(system, retryMsg, { maxTokens: 2000, json: false }, creds);
 check = validateProtectedKeywords(rewritten, presentKeys);
 }

 if (!check.ok) {
 return res.status(200).json({
 rewrittenSegment: segmentText,
 applied: false,
 reason: `Рерайт відхилений: не вдалося зберегти ключі ${check.missing.join(', ')}.`,
 });
 }

 return res.status(200).json({ rewrittenSegment: rewritten, applied: true, retried });
 } catch (e) {
 return res.status(500).json({ error: e.message });
 }
};
