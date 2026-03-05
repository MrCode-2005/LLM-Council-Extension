/**
 * LLM Council — Constants & Configuration
 */

// ── Supported AI Models ─────────────────────────────────────────────────────

export const MODELS = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    matchPatterns: ['chatgpt.com', 'chat.openai.com'],
    icon: '🤖',
    color: '#10a37f'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/app',
    matchPatterns: ['gemini.google.com'],
    icon: '✨',
    color: '#4285f4'
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    matchPatterns: ['perplexity.ai'],
    icon: '🔍',
    color: '#22b8cf'
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    url: 'https://grok.com/',
    matchPatterns: ['grok.com', 'x.com/i/grok'],
    icon: '⚡',
    color: '#1d9bf0'
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    url: 'https://claude.ai/new',
    matchPatterns: ['claude.ai'],
    icon: '🧠',
    color: '#D97757'
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    matchPatterns: ['chat.deepseek.com'],
    icon: '🐋',
    color: '#1B65F3'
  },
  copilot: {
    id: 'copilot',
    name: 'Copilot',
    url: 'https://copilot.microsoft.com/',
    matchPatterns: ['copilot.microsoft.com'],
    icon: '💡',
    color: '#1A73E8'
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen',
    url: 'https://chat.qwen.ai/',
    matchPatterns: ['chat.qwen.ai', 'chat.qwenlm.ai'],
    icon: '🟣',
    color: '#6c47fb'
  },
  notebooklm: {
    id: 'notebooklm',
    name: 'NotebookLM',
    url: 'https://notebooklm.google.com/',
    matchPatterns: ['notebooklm.google.com'],
    icon: '📓',
    color: '#22b8cf'
  },
  aistudio: {
    id: 'aistudio',
    name: 'AI Studio',
    url: 'https://aistudio.google.com/app/prompts/new_chat',
    matchPatterns: ['aistudio.google.com'],
    icon: '⚙️',
    color: '#4285f4'
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    url: 'https://kimi.com/',
    matchPatterns: ['kimi.moonshot.cn', 'kimi.com', 'www.kimi.com'],
    icon: '🌙',
    color: '#3d3d3d'
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    url: 'https://chat.mistral.ai/',
    matchPatterns: ['chat.mistral.ai'],
    icon: '🌪️',
    color: '#f97316'
  },
  poe: {
    id: 'poe',
    name: 'Poe',
    url: 'https://poe.com/',
    matchPatterns: ['poe.com'],
    icon: '🎭',
    color: '#7f56d9'
  },
  zai: {
    id: 'zai',
    name: 'Z.ai',
    url: 'https://chat.z.ai/',
    matchPatterns: ['z.ai', 'chat.z.ai'],
    icon: 'Z',
    color: '#1a1a1a'
  }
};

// ── Message Types ────────────────────────────────────────────────────────────

export const MSG = {
  // Popup → Service Worker
  ASK_COUNCIL: 'ASK_COUNCIL',
  REAUTHENTICATE_JUDGE: 'REAUTHENTICATE_JUDGE',
  GET_STATUS: 'GET_STATUS',

  // Service Worker → Content Script
  INJECT_PROMPT: 'INJECT_PROMPT',
  EXTRACT_RESPONSE: 'EXTRACT_RESPONSE',

  // Content Script → Service Worker
  PROMPT_SENT: 'PROMPT_SENT',
  RESPONSE_READY: 'RESPONSE_READY',
  INJECTION_FAILED: 'INJECTION_FAILED',

  // Service Worker → Popup
  STATUS_UPDATE: 'STATUS_UPDATE',
  ALL_RESPONSES_COLLECTED: 'ALL_RESPONSES_COLLECTED',
  JUDGE_RESULT: 'JUDGE_RESULT',
  ERROR: 'ERROR'
};

// ── Response Statuses ────────────────────────────────────────────────────────

export const RESPONSE_STATUS = {
  PENDING: 'pending',
  INJECTING: 'injecting',
  WAITING: 'waiting',
  COMPLETE: 'complete',
  FAILED: 'failed',
  TIMEOUT: 'timeout'
};

// ── Judge Isolation Modes ────────────────────────────────────────────────────

export const JUDGE_MODE = {
  SAME_SESSION: 'same-session',
  INCOGNITO: 'incognito',
  SEPARATE_WINDOW: 'separate-window'
};

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULTS = {
  COUNCIL_TIMEOUT_MS: 120_000,   // 2 minutes per model
  JUDGE_TIMEOUT_MS: 180_000,     // 3 minutes for judge
  MIN_COUNCIL: 2,
  MAX_COUNCIL: 14,
  DEFAULT_JUDGE: 'gemini',       // Gemini is default judge
  JUDGE_MODE: JUDGE_MODE.INCOGNITO,
  POLL_INTERVAL_MS: 2_000,       // DOM polling interval
  INJECTION_DELAY_MS: 1_500      // delay between model injections
};

// ── Storage Keys ─────────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  SELECTED_COUNCIL: 'selectedCouncil',
  SELECTED_JUDGE: 'selectedJudge',
  JUDGE_ISOLATION_MODE: 'judgeIsolationMode',
  JUDGE_CUSTOM_PROMPT: 'judgeCustomPrompt',
  LAST_PROMPT: 'lastPrompt',
  HISTORY: 'history'
};
