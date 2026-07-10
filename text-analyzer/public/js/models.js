// models.js — перелік моделей по провайдерах для випадаючого списку.
// Актуально на середину 2026; можна вписати свою в поле поруч.
window.PROVIDER_MODELS = {
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (реком., безкошт.)' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (більше лімітів)' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (сильніше, малий безкошт. ліміт)' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (реком.)' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (швидше, більше лімітів)' },
  ],
  openrouter: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B :free (безкошт.)' },
    { id: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash :free (безкошт.)' },
    { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat (дешево)' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (реком.)' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (дешевше)' },
  ],
};
