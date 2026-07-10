// _lib/llm.js — Універсальний виклик LLM з підтримкою всіх провайдерів.

const fetch = require('node-fetch');

const MODEL_MAP = {
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-1.5-flash',
  openrouter: 'openai/gpt-4o-mini'
};

async function callLLM(systemPrompt, userPrompt, opts = {}, creds = {}) {
  const provider = creds.provider || 'groq';
  const apiKey = creds.apiKey || process.env[`${provider.toUpperCase()}_API_KEY`];
  
  if (!apiKey) throw new Error(`API Key for ${provider} is missing`);

  const model = creds.model || MODEL_MAP[provider];
  const maxTokens = opts.maxTokens || 2000;
  const temperature = opts.temperature || 0.3;

  let url, headers, body;

  if (provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    body = { model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: maxTokens, temperature };
    if (opts.json) body.response_format = { type: 'json_object' };
  } 
  else if (provider === 'openai' || provider === 'openrouter') {
    url = provider === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    if (provider === 'openrouter') headers['HTTP-Referer'] = 'https://textlab2.vercel.app';
    body = { model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], max_tokens: maxTokens, temperature };
    if (opts.json) body.response_format = { type: 'json_object' };
  } 
  else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
    body = { model, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] };
  } 
  else if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    body = { contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }], generationConfig: { maxOutputTokens: maxTokens, temperature } };
  }

  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${provider} API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    let content;

    if (provider === 'anthropic') {
      content = data.content?.[0]?.text;
    } else if (provider === 'gemini') {
      content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    } else {
      content = data.choices?.[0]?.message?.content;
    }

    if (!content) throw new Error('Empty response from LLM');

    if (opts.json) {
      try { return JSON.parse(content); }
      catch (e) { throw new Error('Failed to parse JSON: ' + content.slice(0, 200)); }
    }
    
    return content;
  } catch (e) {
    throw e;
  }
}

function getRateLimit() {
  return { remaining: 'unknown', reset: 'unknown' };
}

module.exports = { callLLM, getRateLimit };
