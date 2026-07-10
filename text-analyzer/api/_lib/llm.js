// _lib/llm.js — Універсальний виклик LLM з підтримкою клієнтських ключів.

const fetch = require('node-fetch');

// Маппінг моделей для різних провайдерів
const MODEL_MAP = {
  groq: 'llama-3.3-70b-versatile', // Використовуємо потужну модель з великим вікном
  openai: 'gpt-4o-mini',
};

async function callLLM(systemPrompt, userPrompt, opts = {}, creds = {}) {
  const provider = creds.provider || process.env.LLM_PROVIDER || 'groq';
  const apiKey = creds.groqApiKey || creds.apiKey || process.env.GROQ_API_KEY;
  
  if (!apiKey) throw new Error('API Key is missing. Please provide it in the input field.');

  const model = creds.model || MODEL_MAP[provider] || MODEL_MAP.groq;
  const maxTokens = opts.maxTokens || 2000;
  const temperature = opts.temperature || 0.3;

  let url, headers, body;

  if (provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature,
    };
    if (opts.json) {
      body.response_format = { type: 'json_object' };
    }
  } else {
    // Fallback for OpenAI if needed
    url = 'https://api.openai.com/v1/chat/completions';
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature,
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) throw new Error('Empty response from LLM');

    if (opts.json) {
      try {
        return JSON.parse(content);
      } catch (e) {
        console.error('JSON Parse Error:', e, 'Content:', content);
        throw new Error('Failed to parse JSON response from LLM');
      }
    }
    
    return content;
  } catch (e) {
    throw e;
  }
}

function getRateLimit() {
  // Заглушка, так як Groq не повертає ліміти у хедерах так само як OpenAI
  return { remaining: 'unknown', reset: 'unknown' };
}

module.exports = { callLLM, getRateLimit };
