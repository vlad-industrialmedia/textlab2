// auth.js — тільки CORS. Токен-захист прибрано: ключ LLM вводить клієнт,
// сервер лише проксує виклик до провайдера.

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

module.exports = { setCors };
