/**
 * LLM Council — Dashboard with Split-Screen Iframes
 *
 * Features:
 * - Collapsible sidebar for maximum space
 * - Side-by-side resizable iframe panels with drag handles
 * - Resilient pipeline: skip failed models, proceed with whatever works
 * - File upload support
 * - Retry logic for content script injection
 */

import { MODELS, MSG, DEFAULTS, STORAGE_KEYS } from '../utils/constants.js';
import { buildEvaluationPrompt, DEFAULT_JUDGE_PROMPT } from '../judge/judge-engine.js';
import { parseJudgeResponse } from '../judge/judge-parser.js';

// ── DOM References ───────────────────────────────────────────────────────────

const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const modelsGrid = document.getElementById('models-grid');
const modelCount = document.getElementById('model-count');
const judgeSelect = document.getElementById('judge-select');
const judgeBadge = document.getElementById('judge-badge');
const promptInput = document.getElementById('prompt-input');
const btnSend = document.getElementById('btn-send');
const btnAttach = document.getElementById('btn-attach');
const promptBar = document.getElementById('prompt-bar');
const bannerClose = document.getElementById('banner-close');
const banner = document.getElementById('banner');

const mainContent = document.getElementById('main-content');
const splitScreen = document.getElementById('split-screen');
const splitPanels = document.getElementById('split-panels');

const promptStatus = document.getElementById('prompt-status');
const promptStatusText = document.getElementById('prompt-status-text');

const resultsModal = document.getElementById('results-modal');
const resultsBody = document.getElementById('results-body');
const resultsClose = document.getElementById('results-close');
const resultsCloseBtn = document.getElementById('results-close-btn');
const btnCopyResults = document.getElementById('btn-copy-results');

// ── State ────────────────────────────────────────────────────────────────────

let selectedCouncil = new Set();
let selectedJudge = DEFAULTS.DEFAULT_JUDGE;
let customJudgePrompt = '';
let lastResult = null;
let iframePanels = {};   // panelKey -> { iframe, frameId, panelEl, url, role, modelId, failed, lastActive, suspended }
let currentTabId = null;
let sidebarCollapsed = false;
let attachedFiles = [];
let expandBtn = null;    // floating expand button

// ── Initialize ───────────────────────────────────────────────────────────────

async function init() {
    await loadConfig();
    currentTabId = await getCurrentTabId();

    // Restore drafted prompt and files
    const draft = await chrome.storage.local.get(['llm_draft_prompt', 'llm_attached_files']);
    if (draft.llm_draft_prompt && !promptInput.value) {
        promptInput.value = draft.llm_draft_prompt;
    }
    if (draft.llm_attached_files) {
        attachedFiles = draft.llm_attached_files || [];
    }

    renderModelsGrid();
    renderJudgeDropdown();
    setupEventListeners();
    setupSidebarNav();
    setupSidebarToggle();
    setupJudgePromptUI();
    setupPresets();
    setupSyncManager();
    setupTemplatesManager();
    setupWebDavSync();
    setupThemeToggle();
    updateUI();
    console.log('[LLM Council] Dashboard ready. Tab:', currentTabId);

    // Check if opened via Context Menu / Hotkey Injection
    const pending = await chrome.storage.local.get('council_pending_prompt');
    if (pending.council_pending_prompt) {
        promptInput.value = pending.council_pending_prompt;
        updateUI(); // enable send button
        await chrome.storage.local.remove('council_pending_prompt');
        // Slight delay to ensure UI renders
        setTimeout(() => {
            if (!btnSend.disabled) handleSubmit();
        }, 100);
    }
}

async function getCurrentTabId() {
    return new Promise(r => {
        chrome.tabs.getCurrent(t => {
            if (t && t.id) {
                r(t.id);
            } else {
                chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                    r(tabs && tabs.length > 0 ? tabs[0].id : null);
                });
            }
        });
    });
}

async function loadConfig() {
    const c = await chrome.storage.sync.get([
        STORAGE_KEYS.SELECTED_COUNCIL,
        STORAGE_KEYS.SELECTED_JUDGE,
        STORAGE_KEYS.JUDGE_CUSTOM_PROMPT
    ]);
    if (c[STORAGE_KEYS.SELECTED_COUNCIL]) selectedCouncil = new Set(c[STORAGE_KEYS.SELECTED_COUNCIL]);
    if (c[STORAGE_KEYS.SELECTED_JUDGE]) selectedJudge = c[STORAGE_KEYS.SELECTED_JUDGE];
    customJudgePrompt = c[STORAGE_KEYS.JUDGE_CUSTOM_PROMPT] || '';
}

async function saveConfig() {
    await chrome.storage.sync.set({
        [STORAGE_KEYS.SELECTED_COUNCIL]: [...selectedCouncil],
        [STORAGE_KEYS.SELECTED_JUDGE]: selectedJudge,
        [STORAGE_KEYS.JUDGE_CUSTOM_PROMPT]: customJudgePrompt,
    });
}

// ── Judge Prompt UI ──────────────────────────────────────────────────────────

function setupJudgePromptUI() {
    const textarea = document.getElementById('judge-custom-prompt');
    const btnSave = document.getElementById('btn-save-judge-prompt');
    const btnReset = document.getElementById('btn-reset-judge-prompt');
    const savedIndicator = document.getElementById('judge-prompt-saved');

    if (!textarea) return;

    // Pre-fill with saved custom prompt or default
    textarea.value = customJudgePrompt || DEFAULT_JUDGE_PROMPT;

    btnSave?.addEventListener('click', () => {
        customJudgePrompt = textarea.value.trim();
        saveConfig();
        // Show save feedback
        savedIndicator?.classList.remove('hidden');
        setTimeout(() => savedIndicator?.classList.add('hidden'), 2000);
    });

    btnReset?.addEventListener('click', () => {
        textarea.value = DEFAULT_JUDGE_PROMPT;
        customJudgePrompt = '';
        saveConfig();
        savedIndicator?.classList.remove('hidden');
        savedIndicator.textContent = '↺ Reset to default!';
        setTimeout(() => {
            savedIndicator?.classList.add('hidden');
            savedIndicator.textContent = '✅ Saved!';
        }, 2000);
    });
}

// ── Presets UI ───────────────────────────────────────────────────────────────

function setupPresets() {
    const applyPreset = (modelsList) => {
        selectedCouncil.clear();
        modelsList.forEach(id => {
            if (MODELS[id]) selectedCouncil.add(id);
        });
        saveConfig();
        renderModelsGrid();
        updateUI();
    };

    document.getElementById('preset-all')?.addEventListener('click', () => {
        applyPreset(Object.keys(MODELS).filter(id => id !== 'judge'));
    });

    document.getElementById('preset-coding')?.addEventListener('click', () => {
        applyPreset(['chatgpt', 'claude', 'deepseek', 'qwen', 'copilot']);
    });

    document.getElementById('preset-writing')?.addEventListener('click', () => {
        applyPreset(['chatgpt', 'claude', 'gemini', 'kimi', 'notebooklm']);
    });

    document.getElementById('preset-clear')?.addEventListener('click', () => {
        applyPreset([]);
    });
}

// ── Google Sync Manager ──────────────────────────────────────────────────────

function setupSyncManager() {
    const btnEnable = document.getElementById('btn-enable-sync');
    const btnDisable = document.getElementById('btn-disable-sync');
    const syncInfo = document.getElementById('sync-account-info');
    const syncEmail = document.getElementById('sync-email');
    const syncAvatar = document.getElementById('sync-avatar');

    const updateSyncUI = (userInfo) => {
        if (userInfo) {
            btnEnable.style.display = 'none';
            syncInfo.style.display = 'flex';
            syncEmail.textContent = userInfo.email;
            syncAvatar.src = userInfo.picture || '../icons/icon48.png';
        } else {
            btnEnable.style.display = 'flex';
            syncInfo.style.display = 'none';
            syncEmail.textContent = '';
            syncAvatar.src = '';
        }
    };

    const fetchUserInfo = (token) => {
        fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    console.error('[LLM Council] Sync UserInfo error:', data.error);
                    chrome.identity.removeCachedAuthToken({ token });
                    updateSyncUI(null);
                } else {
                    updateSyncUI(data);
                    chrome.storage.local.set({ llm_sync_profile: data });
                }
            })
            .catch(err => {
                console.error('[LLM Council] Sync fetch failed:', err);
            });
    };

    // Check cached state on load
    chrome.storage.local.get('llm_sync_profile').then(res => {
        if (res.llm_sync_profile) {
            updateSyncUI(res.llm_sync_profile);
            // Verify token is still good silently
            chrome.identity.getAuthToken({ interactive: false }, (token) => {
                if (token) fetchUserInfo(token);
                else {
                    updateSyncUI(null);
                    chrome.storage.local.remove('llm_sync_profile');
                }
            });
        }
    });

    btnEnable?.addEventListener('click', () => {
        const originalText = btnEnable.querySelector('.nav-label').textContent;
        btnEnable.querySelector('.nav-label').textContent = 'Connecting...';

        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError || !token) {
                console.error('[LLM Council] Sync Auth Error:', chrome.runtime.lastError?.message);
                btnEnable.querySelector('.nav-label').textContent = 'Sync Failed';
                setTimeout(() => btnEnable.querySelector('.nav-label').textContent = originalText, 3000);
                return;
            }
            fetchUserInfo(token);
            btnEnable.querySelector('.nav-label').textContent = originalText;
        });
    });

    btnDisable?.addEventListener('click', () => {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            if (token) {
                chrome.identity.removeCachedAuthToken({ token }, () => {
                    const url = `https://accounts.google.com/o/oauth2/revoke?token=${token}`;
                    fetch(url).then(() => {
                        chrome.storage.local.remove('llm_sync_profile');
                        updateSyncUI(null);
                    }).catch(() => {
                        chrome.storage.local.remove('llm_sync_profile');
                        updateSyncUI(null);
                    });
                });
            } else {
                chrome.storage.local.remove('llm_sync_profile');
                updateSyncUI(null);
            }
        });
    });
}

// ── Prompt Templates Manager ───────────────────────────────────────────────────

let promptTemplates = [];

function setupTemplatesManager() {
    const btnAddTemplate = document.getElementById('btn-add-template');
    const templatesList = document.getElementById('templates-list');

    const modal = document.getElementById('template-modal');
    const btnClose = document.getElementById('template-close');
    const btnCancel = document.getElementById('template-cancel-btn');
    const btnSave = document.getElementById('template-save-btn');

    const inputId = document.getElementById('template-id');
    const inputName = document.getElementById('template-name');
    const inputOrder = document.getElementById('template-order');
    const inputContent = document.getElementById('template-content');

    const loadTemplates = async () => {
        const data = await chrome.storage.sync.get('llm_prompt_templates');
        promptTemplates = data.llm_prompt_templates || [];
        promptTemplates.sort((a, b) => a.order - b.order);
        renderTemplatesSettings();
        window.dispatchEvent(new Event('templates-loaded')); // Signal to render in UI
    };

    const saveTemplates = async () => {
        promptTemplates.sort((a, b) => a.order - b.order);
        await chrome.storage.sync.set({ llm_prompt_templates: promptTemplates });
        renderTemplatesSettings();
        window.dispatchEvent(new Event('templates-loaded'));
    };

    const renderTemplatesSettings = () => {
        if (!templatesList) return;
        templatesList.innerHTML = '';
        if (promptTemplates.length === 0) {
            templatesList.innerHTML = '<span style="color: var(--text-muted); font-size: 13px;">No templates saved yet.</span>';
            return;
        }

        promptTemplates.forEach(tpl => {
            const card = document.createElement('div');
            card.className = 'template-card';
            card.innerHTML = `
                <div class="template-card-header">
                    <span class="template-card-title">${escapeHtml(tpl.name)}</span>
                    <button class="btn btn-sm btn-delete-template" data-id="${escapeHtml(tpl.id)}" style="background: transparent; color: var(--text-muted); border: none; padding: 4px; font-size: 14px;">✕</button>
                </div>
                <span class="template-card-order">Display Order: ${tpl.order}</span>
                <div class="template-card-content">${escapeHtml(tpl.content)}</div>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-template')) return;
                openModal(tpl);
            });

            const deleteBtn = card.querySelector('.btn-delete-template');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete template "${tpl.name}"?`)) {
                        promptTemplates = promptTemplates.filter(t => t.id !== tpl.id);
                        saveTemplates();
                    }
                });
            }

            templatesList.appendChild(card);
        });
    };

    const openModal = (tpl = null) => {
        if (tpl) {
            inputId.value = tpl.id;
            inputName.value = tpl.name;
            inputOrder.value = tpl.order;
            inputContent.value = tpl.content;
        } else {
            inputId.value = '';
            inputName.value = '';
            inputOrder.value = promptTemplates.length + 1;
            inputContent.value = '';
        }
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
    };

    btnAddTemplate?.addEventListener('click', () => openModal());
    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);

    btnSave?.addEventListener('click', () => {
        const name = inputName.value.trim();
        const content = inputContent.value.trim();
        const order = parseInt(inputOrder.value) || 1;

        if (!name || !content) {
            alert("Name and Content are required.");
            return;
        }

        const id = inputId.value || Date.now().toString();
        const existingIdx = promptTemplates.findIndex(t => t.id === id);

        const newTpl = { id, name, order, content };

        if (existingIdx >= 0) {
            promptTemplates[existingIdx] = newTpl;
        } else {
            promptTemplates.push(newTpl);
        }

        saveTemplates();
        closeModal();
    });

    loadTemplates();
}

// ── WebDAV Sync Manager ────────────────────────────────────────────────────────
function setupWebDavSync() {
    const toggleSync = document.getElementById('sync-webdav-enable');
    const inputUrl = document.getElementById('webdav-url');
    const inputUser = document.getElementById('webdav-username');
    const inputPass = document.getElementById('webdav-password');
    const btnTogglePass = document.getElementById('webdav-toggle-password');
    const btnSave = document.getElementById('btn-sync-save');
    const btnRestore = document.getElementById('btn-sync-restore');
    const statusInd = document.getElementById('sync-status-indicator');

    if (!toggleSync || !inputUrl) return;

    // Load saved settings
    chrome.storage.local.get(['llm_webdav_config'], (res) => {
        const conf = res.llm_webdav_config || {};
        toggleSync.checked = conf.enabled || false;
        inputUrl.value = conf.url || '';
        inputUser.value = conf.username || '';
        inputPass.value = conf.password ? atob(conf.password) : '';
    });

    // ── Ask Council Button Settings ──
    const askCouncilEnabled = document.getElementById('setting-ask-council-enabled');
    const askCouncilColor = document.getElementById('setting-ask-council-color');
    const askCouncilSize = document.getElementById('setting-ask-council-size');
    const askCouncilPosition = document.getElementById('setting-ask-council-position');

    if (askCouncilEnabled) {
        chrome.storage.local.get(['askCouncilEnabled', 'askCouncilColor', 'askCouncilSize', 'askCouncilPosition'], (prefs) => {
            askCouncilEnabled.checked = prefs.askCouncilEnabled !== false;
            askCouncilColor.value = prefs.askCouncilColor || '#8951d6';
            askCouncilSize.value = prefs.askCouncilSize || 'medium';
            askCouncilPosition.value = prefs.askCouncilPosition || 'bottom';
        });

        const saveAskCouncilPrefs = () => {
            chrome.storage.local.set({
                askCouncilEnabled: askCouncilEnabled.checked,
                askCouncilColor: askCouncilColor.value,
                askCouncilSize: askCouncilSize.value,
                askCouncilPosition: askCouncilPosition.value
            });
        };

        askCouncilEnabled.addEventListener('change', saveAskCouncilPrefs);
        askCouncilColor.addEventListener('input', saveAskCouncilPrefs);
        askCouncilSize.addEventListener('change', saveAskCouncilPrefs);
        askCouncilPosition.addEventListener('change', saveAskCouncilPrefs);
    }

    // ── Export Button Settings ──
    const exportBtnEnabled = document.getElementById('setting-export-btn-enabled');
    const exportBtnColor = document.getElementById('setting-export-btn-color');
    const exportBtnSize = document.getElementById('setting-export-btn-size');
    const exportBtnPosition = document.getElementById('setting-export-btn-position');

    if (exportBtnEnabled) {
        chrome.storage.local.get(['exportBtnEnabled', 'exportBtnColor', 'exportBtnSize', 'exportBtnPosition'], (prefs) => {
            exportBtnEnabled.checked = prefs.exportBtnEnabled !== false;
            exportBtnColor.value = prefs.exportBtnColor || '#0ea5e9';
            exportBtnSize.value = prefs.exportBtnSize || 'medium';
            exportBtnPosition.value = prefs.exportBtnPosition || 'bottom';
        });

        const saveExportBtnPrefs = () => {
            chrome.storage.local.set({
                exportBtnEnabled: exportBtnEnabled.checked,
                exportBtnColor: exportBtnColor.value,
                exportBtnSize: exportBtnSize.value,
                exportBtnPosition: exportBtnPosition.value
            });
        };

        exportBtnEnabled.addEventListener('change', saveExportBtnPrefs);
        exportBtnColor.addEventListener('input', saveExportBtnPrefs);
        exportBtnSize.addEventListener('change', saveExportBtnPrefs);
        exportBtnPosition.addEventListener('change', saveExportBtnPrefs);
    }

    const saveSettingsLocally = () => {
        const config = {
            enabled: toggleSync.checked,
            url: inputUrl.value.trim(),
            username: inputUser.value.trim(),
            password: btoa(inputPass.value) // Simple base64 encoding
        };
        chrome.storage.local.set({ llm_webdav_config: config });
        return config;
    };

    toggleSync.addEventListener('change', saveSettingsLocally);

    btnTogglePass.addEventListener('click', (e) => {
        e.preventDefault();
        const type = inputPass.getAttribute('type') === 'password' ? 'text' : 'password';
        inputPass.setAttribute('type', type);

        // Toggle icon visually
        const svg = btnTogglePass.querySelector('svg');
        if (type === 'text') {
            svg.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
        } else {
            svg.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
        }
    });

    const setStatus = (msg, color) => {
        statusInd.textContent = msg;
        statusInd.style.color = color;
        setTimeout(() => { statusInd.textContent = ''; }, 3000);
    };

    const getAuthHeader = (config) => {
        const token = btoa(`${config.username}:${atob(config.password)}`);
        return `Basic ${token}`;
    };

    // Push local to cloud
    btnSave.addEventListener('click', async () => {
        const config = saveSettingsLocally();
        if (!config.enabled || !config.url) {
            setStatus('WebDAV URL required and sync must be enabled', '#ef4444');
            return;
        }

        btnSave.disabled = true;
        btnSave.textContent = 'Saving...';

        try {
            // Gather all config from sync and local
            const syncData = await chrome.storage.sync.get(null);
            const localData = await chrome.storage.local.get(['LLM_COUNCIL_CONFIG']); // Only sync specific local bits if needed

            const payload = JSON.stringify({ sync: syncData, local: localData }, null, 2);

            // Assuming WebDAV server creates/overwrites file at URL
            const targetUrl = config.url.endsWith('/') ? `${config.url}llm-council-sync.json` : `${config.url}/llm-council-sync.json`;

            const res = await fetch(targetUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': getAuthHeader(config),
                    'Content-Type': 'application/json'
                },
                body: payload
            });

            if (res.ok || res.status === 201 || res.status === 204) {
                setStatus('Backup successful! ✓', '#22c55e');
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (err) {
            console.error('[WebDAV Sync]', err);
            setStatus(`Error: ${err.message}`, '#ef4444');
        } finally {
            btnSave.disabled = false;
            btnSave.textContent = 'Save';
        }
    });

    // Pull cloud to local
    btnRestore.addEventListener('click', async () => {
        const config = saveSettingsLocally();
        if (!config.enabled || !config.url) {
            setStatus('WebDAV URL required and sync must be enabled', '#ef4444');
            return;
        }

        if (!confirm('This will overwrite your local settings with the cloud backup. Proceed?')) {
            return;
        }

        btnRestore.disabled = true;
        btnRestore.textContent = 'Restoring...';

        try {
            const targetUrl = config.url.endsWith('/') ? `${config.url}llm-council-sync.json` : `${config.url}/llm-council-sync.json`;

            const res = await fetch(targetUrl, {
                method: 'GET',
                headers: { 'Authorization': getAuthHeader(config) },
                cache: 'no-store'
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();

            if (data.sync) await chrome.storage.sync.set(data.sync);
            if (data.local) await chrome.storage.local.set(data.local);

            setStatus('Restored successfully! ✓', '#22c55e');

            // Reload dashboard state
            setTimeout(() => window.location.reload(), 1500);

        } catch (err) {
            console.error('[WebDAV Sync]', err);
            setStatus(`Error: ${err.message}`, '#ef4444');
        } finally {
            btnRestore.disabled = false;
            btnRestore.textContent = 'Restore from cloud';
        }
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// SIDEBAR — Collapsible
// ══════════════════════════════════════════════════════════════════════════════

function setupSidebarToggle() {
    // Create floating expand button (hidden initially)
    expandBtn = document.createElement('button');
    expandBtn.className = 'sidebar-expand-btn hidden';
    expandBtn.textContent = '☰';
    expandBtn.title = 'Expand sidebar';
    expandBtn.addEventListener('click', toggleSidebar);
    document.body.appendChild(expandBtn);

    sidebarToggle?.addEventListener('click', toggleSidebar);
}

function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    sidebar.classList.toggle('collapsed', sidebarCollapsed);
    document.body.classList.toggle('sidebar-hidden', sidebarCollapsed);
    expandBtn.classList.toggle('hidden', !sidebarCollapsed);
}

// Auto-collapse sidebar when split-screen is shown
function collapseSidebar() {
    if (!sidebarCollapsed) {
        sidebarCollapsed = true;
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-hidden');
        expandBtn.classList.remove('hidden');
    }
}

function expandSidebar() {
    if (sidebarCollapsed) {
        sidebarCollapsed = false;
        sidebar.classList.remove('collapsed');
        document.body.classList.remove('sidebar-hidden');
        expandBtn.classList.add('hidden');
    }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderModelsGrid() {
    modelsGrid.innerHTML = '';
    for (const [id, model] of Object.entries(MODELS)) {
        const card = document.createElement('div');
        card.className = `model-card${selectedCouncil.has(id) ? ' selected' : ''}`;
        card.dataset.modelId = id;
        card.innerHTML = `
      <div class="model-checkbox-visual"></div>
      <span class="model-icon">${model.icon}</span>
      <span class="model-name">${model.name}</span>
    `;
        card.addEventListener('click', () => toggleModel(id));
        modelsGrid.appendChild(card);
    }
}

function renderJudgeDropdown() {
    judgeSelect.innerHTML = '';
    for (const [id, model] of Object.entries(MODELS)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `${model.icon} ${model.name}`;
        if (id === selectedJudge) opt.selected = true;
        judgeSelect.appendChild(opt);
    }
}

// ── Model Selection ──────────────────────────────────────────────────────────

function toggleModel(id) {
    if (selectedCouncil.has(id)) selectedCouncil.delete(id);
    else if (selectedCouncil.size < DEFAULTS.MAX_COUNCIL) selectedCouncil.add(id);
    updateUI();
    saveConfig();
}

function updateUI() {
    const n = selectedCouncil.size;
    const ok = n >= DEFAULTS.MIN_COUNCIL && n <= DEFAULTS.MAX_COUNCIL;
    modelCount.textContent = `${n} selected`;
    modelCount.className = `model-count${ok ? ' valid' : n > DEFAULTS.MAX_COUNCIL ? ' over' : ''}`;
    document.querySelectorAll('.model-card').forEach(c => c.classList.toggle('selected', selectedCouncil.has(c.dataset.modelId)));
    const jm = MODELS[selectedJudge];
    if (jm) judgeBadge.textContent = jm.name;
    btnSend.disabled = !ok || !promptInput.value.trim();

    // Auto-expand textarea
    promptInput.style.height = '20px'; // Reset to calculate exact scroll height
    if (!promptInput.value.trim()) {
        promptInput.style.height = '20px';
    } else {
        promptInput.style.height = promptInput.scrollHeight + 'px';
    }
}

// ── Sidebar Navigation ──────────────────────────────────────────────────────

let backToTaskContainer = null;
let backToTaskBtn = null;
let terminateTaskBtn = null;
let taskIsRunning = false;
let currentLayoutMode = 'side-by-side';

function setupSidebarNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const v = item.dataset.view;
            if (!v) return;

            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.view').forEach(vw => vw.classList.remove('active'));
            const target = document.getElementById(`view-${v}`);
            if (target) target.classList.add('active');

            // Hide split screen but show "back to task" if a task is running
            if (splitScreen.style.display === 'flex') {
                splitScreen.style.display = 'none';
                showBackToTaskButton();
            }
        });
    });
}

// ── Theme Toggle ────────────────────────────────────────────────────────────

function setupThemeToggle() {
    const btnThemeToggle = document.getElementById('btn-theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const themeLabel = btnThemeToggle?.querySelector('.nav-label');

    if (!btnThemeToggle) return;

    // Set initial icon and label based on HTML class (set by inline <head> script)
    if (document.documentElement.classList.contains('dark-theme')) {
        if (themeIcon) themeIcon.textContent = '☀️';
        if (themeLabel) themeLabel.textContent = 'Light Mode';
        chrome.storage.local.set({ council_theme: 'dark' });
    } else {
        if (themeIcon) themeIcon.textContent = '🌙';
        if (themeLabel) themeLabel.textContent = 'Dark Mode';
        chrome.storage.local.set({ council_theme: 'light' });
    }

    btnThemeToggle.addEventListener('click', () => {
        const isDark = document.documentElement.classList.toggle('dark-theme');
        if (themeIcon) themeIcon.textContent = isDark ? '☀️' : '🌙';
        if (themeLabel) themeLabel.textContent = isDark ? 'Light Mode' : 'Dark Mode';
        const themeStr = isDark ? 'dark' : 'light';
        localStorage.setItem('council_theme', themeStr);
        chrome.storage.local.set({ council_theme: themeStr });
    });
}

function createBackToTaskButton() {
    if (backToTaskContainer) return;

    backToTaskContainer = document.createElement('div');
    backToTaskContainer.className = 'back-to-task-container hidden';

    backToTaskBtn = document.createElement('button');
    backToTaskBtn.className = 'btn-back-to-task';
    backToTaskBtn.innerHTML = `<span class="pulse-dot"></span> Back to Running Task`;
    backToTaskBtn.addEventListener('click', returnToTask);

    terminateTaskBtn = document.createElement('button');
    terminateTaskBtn.className = 'btn-terminate-task';
    terminateTaskBtn.innerHTML = `✕ Stop Task`;
    terminateTaskBtn.title = `End task and close all models`;
    terminateTaskBtn.addEventListener('click', terminateTask);

    backToTaskContainer.appendChild(backToTaskBtn);
    backToTaskContainer.appendChild(terminateTaskBtn);
    document.body.appendChild(backToTaskContainer);
}

function showBackToTaskButton() {
    if (!backToTaskContainer) createBackToTaskButton();
    // Only show if there are active panels
    const activePanels = Object.values(iframePanels).filter(p => !p.failed);
    if (activePanels.length > 0) {
        backToTaskBtn.innerHTML = `<span class="pulse-dot"></span> Back to Running Task (${activePanels.length} models)`;
        backToTaskContainer.classList.remove('hidden');
        taskIsRunning = true;
    }
}

function hideBackToTaskButton() {
    if (backToTaskContainer) backToTaskContainer.classList.add('hidden');
    taskIsRunning = false;
}

function returnToTask() {
    // Hide all views, show split screen
    document.querySelectorAll('.view').forEach(vw => vw.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    splitScreen.style.display = 'flex';
    hideBackToTaskButton();
    collapseSidebar();
}

function terminateTask() {
    goBackToHome();
}

// ── Event Listeners ──────────────────────────────────────────────────────────

function saveDraftState() {
    chrome.storage.local.set({
        llm_draft_prompt: promptInput.value,
        // Files can be large; Chrome local storage allows 5MB which is usually plenty for document drafts.
        // We catch errors just in case they upload massive files and blow quota.
        llm_attached_files: attachedFiles.slice(0, 3)
    }).catch(() => console.warn('Draft too large to save'));
}

function setupEventListeners() {
    window.addEventListener('beforeunload', (e) => {
        if (splitScreen.style.display === 'flex' && Object.keys(iframePanels).length > 0) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    promptInput.addEventListener('input', () => {
        updateUI();
        saveDraftState();
    });
    promptInput.addEventListener('input', updateUI);
    promptInput.addEventListener('keydown', (e) => {
        // Submit on Enter, but allow Shift+Enter for new lines
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!btnSend.disabled) handleSubmit();
        }
    });

    // ── Draggable Prompt Bar ──
    const dragHandle = document.getElementById('prompt-bar-drag-handle');
    if (dragHandle && promptBar) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        dragHandle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = promptBar.getBoundingClientRect();
            promptBar.style.transform = 'none';
            promptBar.style.left = rect.left + 'px';
            promptBar.style.top = rect.top + 'px';
            promptBar.style.bottom = 'auto';
            promptBar.style.right = 'auto';

            initialLeft = rect.left;
            initialTop = rect.top;

            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let destX = initialLeft + dx;
            let destY = initialTop + dy;
            const maxX = window.innerWidth - promptBar.offsetWidth;
            const maxY = window.innerHeight - promptBar.offsetHeight;

            promptBar.style.left = Math.max(0, Math.min(destX, maxX)) + 'px';
            promptBar.style.top = Math.max(0, Math.min(destY, Math.max(0, maxY))) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.userSelect = '';
            }
        });
    }
    btnSend.addEventListener('click', handleSubmit);

    // New action buttons
    const btnLayout = document.getElementById('btn-layout');
    if (btnLayout) {
        btnLayout.addEventListener('click', () => {
            const modes = ['auto', 'side-by-side', 'grid-3-col', 'grid'];
            const nextIdx = (modes.indexOf(currentLayoutMode) + 1) % modes.length;
            currentLayoutMode = modes[nextIdx];

            // Generate Title Case label
            const label = currentLayoutMode.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            btnLayout.title = `Toggle Layout (${label})`;
            showStatus(`Layout changed to: ${label}`);
            hideStatusAfterDelay(2000);

            if (splitScreen.style.display === 'flex') {
                updateSplitPanelsLayout();
            }
        });
    }

    const btnAddAgent = document.getElementById('btn-add-agent');
    if (btnAddAgent) {
        btnAddAgent.addEventListener('click', () => {
            document.querySelector('[data-view="home"]')?.click();
            expandSidebar();
        });
    }

    const btnExport = document.getElementById('btn-export');


    if (btnExport) {
        btnExport.addEventListener('click', async () => {
            const exportData = {
                prompt: promptInput.value.trim(),
                timestamp: Date.now(),
                responses: []
            };

            const originalBtnText = btnExport.innerHTML;
            btnExport.innerHTML = `⏳ Preparing...`;
            btnExport.disabled = true;

            // Gather standard models
            for (const id of selectedCouncil) {
                const panel = iframePanels[id];
                if (panel && panel.frameId) {
                    try {
                        const r = await extractFromFrame(panel.frameId);
                        if (r.response) {
                            exportData.responses.push({ id, text: r.response });
                        }
                    } catch (e) { console.error('Extraction failed for', id); }
                }
            }

            // Gather judge if present
            if (selectedJudge) {
                const judgeId = `judge-${selectedJudge}`;
                if (lastResult && lastResult.rawText) {
                    exportData.responses.push({ id: judgeId, text: lastResult.rawText });
                } else {
                    const panel = iframePanels[judgeId];
                    if (panel && panel.frameId) {
                        try {
                            const r = await extractFromFrame(panel.frameId);
                            if (r.response) exportData.responses.push({ id: judgeId, text: r.response });
                        } catch (e) { }
                    }
                }
            }

            // Save and open
            await chrome.storage.local.set({ 'council_export_data': exportData });
            chrome.tabs.create({ url: 'dashboard/export.html' });

            // Restore button
            btnExport.innerHTML = originalBtnText;
            btnExport.disabled = false;
        });
    }

    // File upload
    if (btnAttach) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*,.pdf,.txt,.md,.csv,.json';
        fileInput.style.display = 'none';
        fileInput.multiple = true;
        document.body.appendChild(fileInput);
        btnAttach.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            const files = [...e.target.files];
            if (!files.length) return;

            // Clear previous attachments to avoid infinite stacking
            attachedFiles = [];
            let names = [];

            files.forEach(f => {
                const reader = new FileReader();
                reader.onload = ev => {
                    attachedFiles.push({
                        name: f.name,
                        type: f.type || 'application/octet-stream',
                        dataUrl: ev.target.result
                    });
                    names.push(f.name);

                    // Once all files are processed, update the UI
                    if (attachedFiles.length === files.length) {
                        const cur = promptInput.value.trim();
                        // Strip previous attachment tags if they exist so it's clean
                        const cleanPrompt = cur.replace(/\[Attached:\s.*?\]\n?/g, '');
                        promptInput.value = `[Attached: ${names.join(', ')}]\n${cleanPrompt}`;
                        updateUI();
                        saveDraftState();
                    }
                };
                reader.readAsDataURL(f);
            });
            fileInput.value = '';
        });
    }

    judgeSelect.addEventListener('change', () => { selectedJudge = judgeSelect.value; updateUI(); saveConfig(); });
    bannerClose?.addEventListener('click', () => banner.classList.add('hidden'));

    // Save draft state on input
    promptInput.addEventListener('input', saveDraftState);

    resultsClose?.addEventListener('click', () => {
        resultsModal.style.display = 'none';
        resetModalPosition();
    });
    resultsCloseBtn?.addEventListener('click', () => {
        resultsModal.style.display = 'none';
        resetModalPosition();
    });
    btnCopyResults?.addEventListener('click', copyResults);

    // ── Draggable Modal ──────────────────────────────────────────────
    setupDraggableModal();
}

function resetModalPosition() {
    resultsModal.style.top = '50%';
    resultsModal.style.left = '50%';
    resultsModal.style.transform = 'translate(-50%, -50%)';
}

function setupDraggableModal() {
    const header = resultsModal?.querySelector('.results-header');
    if (!header) return;

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
        // Don't drag if clicking the close button
        if (e.target.closest('.results-close')) return;

        isDragging = true;

        // Get current computed position
        const rect = resultsModal.getBoundingClientRect();

        // Remove the transform centering and set absolute position
        resultsModal.style.transform = 'none';
        resultsModal.style.top = rect.top + 'px';
        resultsModal.style.left = rect.left + 'px';

        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        resultsModal.style.left = (startLeft + dx) + 'px';
        resultsModal.style.top = (startTop + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// ── Export Modal Logic ────────────────────────────────────────────────────────



// ══════════════════════════════════════════════════════════════════════════════
// SUBMIT — RESILIENT PIPELINE
// ══════════════════════════════════════════════════════════════════════════════

async function handleSubmit() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    const councilIds = [...selectedCouncil];
    if (councilIds.length < DEFAULTS.MIN_COUNCIL) return;

    // Save prompt text for next time
    chrome.storage.sync.set({ [STORAGE_KEYS.LAST_PROMPT]: prompt });

    // Save to history
    if (typeof addToHistory === 'function') {
        addToHistory(prompt, councilIds);
    }

    // Collapse sidebar & switch to split view
    collapseSidebar();
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    splitScreen.style.display = 'flex';

    showStatus('Loading AI sites...');

    const panels = [
        ...councilIds.map(id => ({ id, role: 'council' })),
        { id: selectedJudge, role: 'judge' }
    ];

    createResizablePanels(panels);

    // Wake up any suspended panels before proceeding
    let neededWake = false;
    for (const [key, panel] of Object.entries(iframePanels)) {
        if (panel.suspended && !panel.failed) {
            wakePanel(key);
            neededWake = true;
        }
    }

    // Give them a moment to start reloading if we had to wake any
    if (neededWake) {
        showStatus('Waking suspended sites...');
        await delay(1500);
    }

    // Wait for loads — detect which ones fail early
    showStatus('Waiting for sites to load...');
    await waitForIframeLoads(panels);

    // Discover frames — multiple rounds for slow-loading sites
    showStatus('Connecting to AI sites...');
    for (let round = 1; round <= 3; round++) {
        await discoverFrameIds();
        const undiscovered = Object.entries(iframePanels)
            .filter(([, p]) => !p.frameId && !p.failed).length;
        if (undiscovered === 0) break;
        console.log(`[LLM Council] Discovery round ${round}: ${undiscovered} still unconnected`);
        await delay(1500);
    }

    // Log state
    for (const [k, p] of Object.entries(iframePanels)) {
        console.log(`[LLM Council] ${k}: frameId=${p.frameId}, failed=${p.failed}`);
    }

    // ── PARALLEL injection: send to ALL models at once ──
    showStatus('Sending prompt to all models simultaneously...');
    const councilResponses = {};

    // Build injection promises for all eligible models
    const injectionPromises = councilIds.map(async (cid) => {
        const panel = iframePanels[cid];

        if (!panel || panel.failed) {
            console.warn(`[LLM Council] Skipping ${cid} — iframe failed`);
            updatePanelStatus(cid, '⛔ Skipped');
            return { id: cid, success: false };
        }

        // If no frameId yet, try one last discovery just for this model
        if (!panel.frameId) {
            console.log(`[LLM Council] ${cid}: no frameId, retrying discovery...`);
            await delay(2000);
            await discoverFrameIds();
        }

        if (!panel.frameId) {
            console.warn(`[LLM Council] Skipping ${cid} — no frame connection`);
            updatePanelStatus(cid, '❌ No connection');
            return { id: cid, success: false };
        }

        updatePanelStatus(cid, '⏳ Injecting...');
        try {
            const cleanPrompt = prompt.replace(/\[Attached:\s.*?\]\n?/g, '').trim();
            await injectAndSend(panel.frameId, cleanPrompt, attachedFiles);
            updatePanelStatus(cid, '⏳ Waiting...');
            return { id: cid, success: true };
        } catch (e) {
            console.error(`[LLM Council] Inject failed for ${cid}:`, e);
            updatePanelStatus(cid, '❌ Failed');
            return { id: cid, success: false };
        }
    });

    // Fire ALL injections at once — no waiting between them
    const results = await Promise.allSettled(injectionPromises);
    const injectedCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;

    if (injectedCount === 0) {
        showStatus('No models accepted the prompt. Check console for errors.');
        hideStatusAfterDelay(5000);
        return;
    }

    // ── Poll council responses (only for successfully injected) ──
    showStatus(`Waiting for ${injectedCount} council responses...`);
    await pollForCouncilResponses(councilIds, councilResponses);

    // ── Build evaluation ──
    const responsesArray = councilIds.map(id => ({
        modelName: MODELS[id]?.name || id,
        status: councilResponses[id] ? 'complete' : 'failed',
        response: councilResponses[id] || null,
    }));

    const completed = responsesArray.filter(r => r.status === 'complete');

    if (completed.length === 0) {
        showStatus('No council responses received.');
        hideStatusAfterDelay(5000);
        return;
    }

    // ── Judge evaluation ──
    const judgeKey = `judge-${selectedJudge}`;
    const judgePanel = iframePanels[judgeKey];

    if (!judgePanel || judgePanel.failed || !judgePanel.frameId) {
        showStatus(`Judge (${MODELS[selectedJudge]?.name}) unavailable. Showing raw responses.`);
        lastResult = { parsed: false, rawText: completed.map(r => `${r.modelName}:\n${r.response}`).join('\n\n---\n\n') };
        showResults(lastResult);
        hideStatusAfterDelay(3000);
        return;
    }

    showStatus('Sending evaluation to Judge...');
    const evalPrompt = buildEvaluationPrompt(prompt, responsesArray, customJudgePrompt);

    try {
        await injectAndSend(judgePanel.frameId, evalPrompt);
        updatePanelStatus(judgeKey, '⏳ Evaluating...');
    } catch (e) {
        console.error('[LLM Council] Judge inject failed:', e);
        updatePanelStatus(judgeKey, '❌ Failed');
        showStatus('Judge injection failed. Showing raw responses.');
        lastResult = { parsed: false, rawText: completed.map(r => `${r.modelName}:\n${r.response}`).join('\n\n---\n\n') };
        showResults(lastResult);
        return;
    }

    showStatus('Waiting for Judge verdict...');
    const judgeResponse = await pollFrameForResponse(judgePanel.frameId, DEFAULTS.JUDGE_TIMEOUT_MS);

    if (judgeResponse) {
        const modelNames = completed.map(r => r.modelName);
        const judgeResult = parseJudgeResponse(judgeResponse, modelNames);
        lastResult = judgeResult;
        updatePanelStatus(judgeKey, '✅ Done');
        showStatus('Evaluation complete!');
        hideStatusAfterDelay(2000);
        showResults(judgeResult);
    } else {
        updatePanelStatus(judgeKey, '⏰ Timeout');
        showStatus('Judge timed out. Showing raw responses.');
        lastResult = { parsed: false, rawText: completed.map(r => `${r.modelName}:\n${r.response}`).join('\n\n---\n\n') };
        showResults(lastResult);
        hideStatusAfterDelay(3000);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// RESIZABLE SIDE-BY-SIDE PANELS
// ══════════════════════════════════════════════════════════════════════════════

function createResizablePanels(panels) {
    splitPanels.innerHTML = '';
    splitPanels.className = 'split-panels';
    iframePanels = {};

    let isGrid = false;
    let isGrid3 = false;
    if (currentLayoutMode === 'grid') isGrid = true;
    else if (currentLayoutMode === 'grid-3-col') isGrid3 = true;
    else if (currentLayoutMode === 'side-by-side') { isGrid = false; isGrid3 = false; }
    else {
        isGrid = panels.length > 7;
        isGrid3 = false;
    }

    if (isGrid) {
        splitPanels.classList.add('grid-layout');
    } else if (isGrid3) {
        splitPanels.classList.add('grid-3-layout');
    }

    // Clear any previous explicitly set column widths
    splitPanels.style.removeProperty('--col1');
    splitPanels.style.removeProperty('--col2');
    splitPanels.style.removeProperty('--col3');

    // Back button
    let backBtn = document.querySelector('.btn-back');
    if (!backBtn) {
        backBtn = document.createElement('button');
        backBtn.className = 'btn-back';
        backBtn.textContent = '← Back';
        backBtn.addEventListener('click', goBackToHome);
        document.body.appendChild(backBtn);
    }

    const totalPanels = panels.length;
    const usingGrid = isGrid || isGrid3;
    // Set a default explicit pixel basis of 350px to force scrolling, allowing them to shrink only via the custom handle.
    const flexBasis = usingGrid ? 'auto' : `350px`;

    panels.forEach((p, i) => {
        const panelEl = createSinglePanel(p, flexBasis);
        if (usingGrid && p.role === 'judge') {
            panelEl.classList.add('judge-panel-grid');
        }
        splitPanels.appendChild(panelEl);

        // Add resize handle between panels (only if not grid layout and not last panel)
        if (isGrid3) {
            if (i % 3 !== 2 && i < totalPanels - 1) {
                const handle = document.createElement('div');
                handle.className = 'resize-handle grid-handle';
                handle.dataset.col = i % 3;
                splitPanels.appendChild(handle);
                setupGridResizeHandle(handle);
            }
        } else if (!usingGrid && i < totalPanels - 1) {
            const handle = document.createElement('div');
            handle.className = 'resize-handle';
            handle.dataset.index = i;
            splitPanels.appendChild(handle);
            setupResizeHandle(handle);
        }
    });
}

function updateSplitPanelsLayout() {
    const panels = Object.values(iframePanels);
    if (!panels.length) return;

    let isGrid = false;
    let isGrid3 = false;
    if (currentLayoutMode === 'grid') isGrid = true;
    else if (currentLayoutMode === 'grid-3-col') isGrid3 = true;
    else if (currentLayoutMode === 'side-by-side') { isGrid = false; isGrid3 = false; }
    else {
        isGrid = panels.length > 7;
        isGrid3 = false;
    }

    splitPanels.classList.toggle('grid-layout', isGrid);
    splitPanels.classList.toggle('grid-3-layout', isGrid3);

    // Clear any previous explicitly set column widths
    splitPanels.style.removeProperty('--col1');
    splitPanels.style.removeProperty('--col2');
    splitPanels.style.removeProperty('--col3');

    // Remove existing resize handles
    splitPanels.querySelectorAll('.resize-handle').forEach(h => h.remove());

    const totalPanels = panels.length;
    const usingGrid = isGrid || isGrid3;
    // Set a default explicit pixel basis of 350px to force scrolling, allowing them to shrink only via the custom handle.
    const flexBasis = usingGrid ? 'auto' : `350px`;

    // Process purely DOM children avoiding innerHTML nukes
    const iframes = Array.from(splitPanels.children).filter(el => el.classList.contains('iframe-panel'));

    iframes.forEach((panelEl, i) => {
        panelEl.style.flex = usingGrid ? 'none' : `1 0 ${flexBasis}`;
        if (usingGrid && panelEl.dataset.panelKey.startsWith('judge-')) {
            panelEl.classList.add('judge-panel-grid');
        } else {
            panelEl.classList.remove('judge-panel-grid');
        }

        if (isGrid3) {
            if (i % 3 !== 2 && i < totalPanels - 1) {
                const handle = document.createElement('div');
                handle.className = 'resize-handle grid-handle';
                handle.dataset.col = i % 3;
                panelEl.after(handle);
                setupGridResizeHandle(handle);
            }
        } else if (!usingGrid && i < totalPanels - 1) {
            const handle = document.createElement('div');
            handle.className = 'resize-handle';
            handle.dataset.index = i;
            panelEl.after(handle);
            setupResizeHandle(handle);
        }
    });
}

function createSinglePanel({ id, role }, flexBasis) {
    const model = MODELS[id];
    const panelKey = role === 'judge' ? `judge-${id}` : id;
    const icon = model?.icon || '🤖';
    const name = model?.name || id;
    const url = model?.url || '#';

    const panel = document.createElement('div');
    panel.className = 'iframe-panel';
    panel.id = `panel-${panelKey}`;
    // Force grow but do not shrink automatically on window resize to ensure scrolling triggers natively
    panel.style.flex = flexBasis === 'auto' ? '1 1 auto' : `1 0 ${flexBasis}`;
    panel.dataset.panelKey = panelKey;

    panel.innerHTML = `
    <div class="iframe-panel-header">
      <span class="iframe-panel-icon">${icon}</span>
      <span class="iframe-panel-name">${name}</span>
      <span class="iframe-panel-badge ${role}">${role === 'judge' ? 'JUDGE' : 'COUNCIL'}</span>
      <span class="iframe-panel-status" id="status-${panelKey}">Loading...</span>
      <div class="iframe-panel-actions">
        <button class="iframe-panel-popout" data-panel-key="${panelKey}" title="Open ${name} in new tab">
            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
        </button>
        <button class="iframe-panel-refresh" data-panel-key="${panelKey}" title="Refresh ${name}">
            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        </button>
        <button class="iframe-panel-close" data-panel-key="${panelKey}" title="Close ${name}">✕</button>
      </div>
    </div>
    <div class="iframe-container" style="position: relative; flex: 1; display: flex; flex-direction: column;">
        <iframe src="${url}" id="iframe-${panelKey}" allow="clipboard-read; clipboard-write" style="flex: 1; border: none;"></iframe>
        <div class="iframe-suspended-overlay hidden" id="suspended-${panelKey}">
            <div class="suspended-content">
                <span class="suspended-icon">💤</span>
                <p>Panel suspended to save memory</p>
                <button class="btn btn-primary" id="btn-wake-${panelKey}">Wake Up</button>
            </div>
        </div>
    </div>
    <div class="iframe-panel-loading" id="loading-${panelKey}">
      <div class="spinner"></div>
    </div>
  `;

    // Close button handler
    panel.querySelector('.iframe-panel-close').addEventListener('click', () => closePanel(panelKey));

    // Refresh button handler
    panel.querySelector('.iframe-panel-refresh').addEventListener('click', async () => {
        const p = iframePanels[panelKey];
        if (p && p.iframe) {
            // Get the real current URL via webNavigation (iframe.src doesn't update on internal navigation)
            let currentUrl = p.currentUrl || p.url;
            try {
                const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
                if (frames) {
                    for (const frame of frames) {
                        if (frame.frameId === p.frameId && frame.url && frame.url !== 'about:blank') {
                            currentUrl = frame.url;
                            break;
                        }
                    }
                }
            } catch (e) { /* fallback to stored URL */ }
            p.iframe.src = currentUrl;
            p.lastActive = Date.now();
            p.suspended = false;
            p.loaded = false;
            p.frameId = null; // Will be re-discovered after reload
            updatePanelStatus(panelKey, '🔄 Refreshing...');
            console.log(`[LLM Council] Refreshed panel: ${panelKey} → ${currentUrl}`);

            // Re-discover frame ID once the iframe finishes loading
            p.iframe.addEventListener('load', async () => {
                p.loaded = true;
                // Give the page a moment to settle, then re-discover frames
                setTimeout(async () => {
                    await discoverFrameIds();
                    if (iframePanels[panelKey]?.frameId) {
                        updatePanelStatus(panelKey, '🟢 Connected');
                    } else {
                        updatePanelStatus(panelKey, '🟢 Ready');
                    }
                    hideLoading(panelKey);
                }, 1500);
            }, { once: true });
        }
    });

    // Popout button handler
    panel.querySelector('.iframe-panel-popout').addEventListener('click', () => {
        const frameSrc = iframePanels[panelKey]?.iframe?.src || url;
        chrome.tabs.create({ url: frameSrc });
    });

    // Wake button handler
    panel.querySelector(`#btn-wake-${panelKey}`).addEventListener('click', () => wakePanel(panelKey));

    const iframe = panel.querySelector('iframe');
    iframePanels[panelKey] = {
        iframe: iframe, frameId: null, panelEl: panel,
        url, role, modelId: id, failed: false,
        lastActive: Date.now(), suspended: false,
        loaded: false
    };

    iframe.addEventListener('load', () => {
        if (iframePanels[panelKey]) iframePanels[panelKey].loaded = true;
    }, { once: true });

    // Track activity to prevent suspension
    panel.addEventListener('mousemove', () => {
        if (iframePanels[panelKey] && !iframePanels[panelKey].suspended) {
            iframePanels[panelKey].lastActive = Date.now();
        }
    });

    return panel;
}

// ── Close Panel ──────────────────────────────────────────────────────────────

function closePanel(panelKey) {
    const panel = iframePanels[panelKey];
    if (!panel) return;

    // Mark as failed so polling skips it
    panel.failed = true;
    panel.frameId = null;

    const panelEl = panel.panelEl;
    if (!panelEl) return;

    // Remove adjacent resize handle
    const prevSibling = panelEl.previousElementSibling;
    const nextSibling = panelEl.nextElementSibling;
    if (prevSibling?.classList.contains('resize-handle')) {
        prevSibling.remove();
    } else if (nextSibling?.classList.contains('resize-handle')) {
        nextSibling.remove();
    }

    // Remove the panel itself (this also kills the iframe)
    panelEl.remove();
    delete iframePanels[panelKey];

    // Redistribute remaining panels equally
    const remainingPanels = splitPanels.querySelectorAll('.iframe-panel');
    if (remainingPanels.length === 0) {
        goBackToHome();
        return;
    }
    const newBasis = `${100 / remainingPanels.length}%`;
    remainingPanels.forEach(p => { p.style.flex = `1 1 ${newBasis}`; });

    console.log(`[LLM Council] Closed panel: ${panelKey}. ${remainingPanels.length} remaining.`);
}



function goBackToHome() {
    splitPanels.innerHTML = '';
    iframePanels = {};
    splitScreen.style.display = 'none';
    expandSidebar();
    hideBackToTaskButton();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === 'home'));
    document.getElementById('view-home').classList.add('active');
    document.querySelector('.btn-back')?.remove();
}

// ── Resize Handle Logic ──────────────────────────────────────────────────────

function setupResizeHandle(handle) {
    let startX, leftPanel, rightPanel, leftWidth, rightWidth, totalWidth;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;

        // Find adjacent panels
        leftPanel = handle.previousElementSibling;
        rightPanel = handle.nextElementSibling;
        if (!leftPanel || !rightPanel) return;

        leftWidth = leftPanel.getBoundingClientRect().width;
        rightWidth = rightPanel.getBoundingClientRect().width;
        totalWidth = leftWidth + rightWidth;

        handle.classList.add('active');

        // Add overlay to prevent iframes from stealing mouse events
        const overlay = document.createElement('div');
        overlay.className = 'resize-overlay';
        document.body.appendChild(overlay);

        const onMouseMove = (e) => {
            const dx = e.clientX - startX;
            const newLeft = Math.max(150, leftWidth + dx);
            const newRight = Math.max(150, totalWidth - newLeft);

            leftPanel.style.flex = `0 0 ${newLeft}px`;
            rightPanel.style.flex = `0 0 ${newRight}px`;
        };

        const onMouseUp = () => {
            handle.classList.remove('active');
            overlay.remove();
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

function setupGridResizeHandle(handle) {
    let startX, colIndex, startWidths;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        colIndex = parseInt(handle.dataset.col); // 0 or 1

        // Measure pixel widths of the first row of panels (up to 3)
        const panels = splitPanels.querySelectorAll('.iframe-panel');
        if (panels.length < 2) return;

        startWidths = [
            panels[0]?.getBoundingClientRect().width || 0,
            panels[1]?.getBoundingClientRect().width || 0,
            panels[2]?.getBoundingClientRect().width || 0
        ];

        handle.classList.add('active');
        const overlay = document.createElement('div');
        overlay.className = 'resize-overlay';
        document.body.appendChild(overlay);

        const onMouseMove = (e) => {
            const dx = e.clientX - startX;
            let w0 = startWidths[0];
            let w1 = startWidths[1];
            let w2 = startWidths[2];

            if (colIndex === 0) {
                // dragging handle between col 0 and 1
                let newW0 = Math.max(150, w0 + dx);
                const delta = newW0 - w0;
                let newW1 = w1 - delta;
                if (newW1 < 150) {
                    newW1 = 150;
                }
                const actualDelta = w1 - newW1;
                newW0 = w0 + actualDelta;

                splitPanels.style.setProperty('--col1', `${newW0}fr`);
                splitPanels.style.setProperty('--col2', `${newW1}fr`);
                splitPanels.style.setProperty('--col3', `${w2}fr`);
            } else if (colIndex === 1) {
                // dragging handle between col 1 and 2
                let newW1 = Math.max(150, w1 + dx);
                const delta = newW1 - w1;
                let newW2 = w2 - delta;
                if (newW2 < 150) {
                    newW2 = 150;
                }
                const actualDelta = w2 - newW2;
                newW1 = w1 + actualDelta;

                splitPanels.style.setProperty('--col1', `${w0}fr`);
                splitPanels.style.setProperty('--col2', `${newW1}fr`);
                splitPanels.style.setProperty('--col3', `${newW2}fr`);
            }
        };

        const onMouseUp = () => {
            handle.classList.remove('active');
            overlay.remove();
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// ── Resource Management (Suspend/Wake) ───────────────────────────────────────

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

setInterval(() => {
    const now = Date.now();
    for (const [key, panel] of Object.entries(iframePanels)) {
        // Don't suspend if a task is actively running or if already suspended / failed
        if (!taskIsRunning && !panel.suspended && !panel.failed && (now - panel.lastActive > IDLE_TIMEOUT_MS)) {
            suspendPanel(key);
        }
    }
}, 60000); // Check every minute

async function suspendPanel(panelKey) {
    const panel = iframePanels[panelKey];
    if (!panel || panel.suspended || panel.failed) return;

    // Fetch the REAL current URL from webNavigation before suspending
    try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
        if (frames && panel.frameId) {
            const currentFrame = frames.find(f => f.frameId === panel.frameId);
            if (currentFrame && currentFrame.url && currentFrame.url !== 'about:blank') {
                panel.currentUrl = currentFrame.url;
                console.log(`[LLM Council] Captured real URL for ${panelKey}: ${currentFrame.url}`);
            }
        }
    } catch (e) {
        console.warn(`[LLM Council] Could not get current URL for ${panelKey}:`, e);
    }

    panel.suspended = true;
    panel.lastUrl = panel.currentUrl || panel.url;
    panel.iframe.src = 'about:blank'; // Free memory

    document.getElementById(`iframe-${panelKey}`).style.display = 'none';
    document.getElementById(`suspended-${panelKey}`).classList.remove('hidden');
    updatePanelStatus(panelKey, '💤 Suspended');
    console.log(`[LLM Council] Suspended panel ${panelKey}. Saved URL: ${panel.lastUrl}`);
}

function wakePanel(panelKey) {
    const panel = iframePanels[panelKey];
    if (!panel || !panel.suspended || panel.failed) return;

    panel.suspended = false;
    panel.lastActive = Date.now();
    panel.frameId = null; // Old frameId is invalidated by about:blank

    // Restore the saved URL (same chat) instead of the base URL
    const restoreUrl = panel.lastUrl || panel.url;
    panel.iframe.src = restoreUrl;

    document.getElementById(`iframe-${panelKey}`).style.display = 'block';
    document.getElementById(`suspended-${panelKey}`).classList.add('hidden');
    updatePanelStatus(panelKey, 'Loading...');
    console.log(`[LLM Council] Waking panel ${panelKey} with URL: ${restoreUrl}`);

    // Re-discover frame ID once the iframe finishes loading
    panel.iframe.addEventListener('load', async () => {
        setTimeout(async () => {
            await discoverFrameIds();
            if (iframePanels[panelKey]?.frameId) {
                updatePanelStatus(panelKey, '🟢 Connected');
            } else {
                updatePanelStatus(panelKey, '🟢 Ready');
            }
        }, 1500);
    }, { once: true });
}

// ══════════════════════════════════════════════════════════════════════════════
// IFRAME LOADING — Detect failures early
// ══════════════════════════════════════════════════════════════════════════════

async function waitForIframeLoads(panels) {
    const loadPromises = panels.map(p => {
        const panelKey = p.role === 'judge' ? `judge-${p.id}` : p.id;
        const iframe = document.getElementById(`iframe-${panelKey}`);
        if (!iframe) return Promise.resolve();

        iframePanels[panelKey].iframe = iframe;

        return new Promise(resolve => {
            if (iframePanels[panelKey].loaded || iframePanels[panelKey].failed) {
                hideLoading(panelKey);
                return resolve();
            }

            let loaded = false;

            const timeout = setTimeout(() => {
                if (!loaded) {
                    console.log(`[LLM Council] ${panelKey}: load timeout (slow network)`);
                    updatePanelStatus(panelKey, 'Loaded (slow)');
                    hideLoading(panelKey);
                }
                resolve();
            }, 45000);

            // Interval watchdog: check if it magically loaded but load event was missed
            const watchdog = setInterval(() => {
                if (iframePanels[panelKey].loaded || iframePanels[panelKey].failed) {
                    clearInterval(watchdog);
                    clearTimeout(timeout);
                    hideLoading(panelKey);
                    resolve();
                }
            }, 500);

            iframe.addEventListener('load', () => {
                loaded = true;
                if (iframePanels[panelKey]) iframePanels[panelKey].loaded = true;
                clearTimeout(timeout);
                clearInterval(watchdog);
                hideLoading(panelKey);
                resolve();
            }, { once: true });

            iframe.addEventListener('error', () => {
                loaded = true;
                if (iframePanels[panelKey]) iframePanels[panelKey].failed = true;
                clearTimeout(timeout);
                clearInterval(watchdog);
                markPanelFailed(panelKey, 'Failed to load');
                resolve();
            }, { once: true });
        });
    });

    await Promise.all(loadPromises);
    await delay(4000); // Wait for JS hydration
}

function checkIframeHealth(panelKey) {
    // We can't directly check cross-origin iframe content,
    // but we can check if the frame appears in webNavigation
    // This is done during discoverFrameIds()
}

function markPanelFailed(panelKey, reason) {
    const panel = iframePanels[panelKey];
    if (!panel) return;
    panel.failed = true;
    hideLoading(panelKey);
    updatePanelStatus(panelKey, `⛔ ${reason}`);

    // Add error overlay
    const panelEl = panel.panelEl;
    panelEl.classList.add('error');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'iframe-panel-error';
    errorDiv.innerHTML = `<span>⛔ ${reason}</span><small>This model will be skipped</small>`;
    panelEl.appendChild(errorDiv);
}

function hideLoading(panelKey) {
    const loader = document.getElementById(`loading-${panelKey}`);
    if (loader) loader.style.display = 'none';
}

// ── Frame Discovery ──────────────────────────────────────────────────────────

async function discoverFrameIds() {
    if (!currentTabId) return;

    try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId: currentTabId });
        if (!frames || frames.length === 0) return;

        for (const frame of frames) {
            if (frame.frameId === 0) continue;
            if (!frame.url || frame.url === 'about:blank') continue;

            for (const [panelKey, panel] of Object.entries(iframePanels)) {
                if (panel.frameId || panel.failed) continue;

                const model = MODELS[panel.modelId];
                if (!model) continue;

                const frameUrl = frame.url.toLowerCase();
                let matched = false;

                // Match via matchPatterns
                for (const pattern of (model.matchPatterns || [])) {
                    if (frameUrl.includes(pattern.toLowerCase())) { matched = true; break; }
                }

                // Fallback: domain match
                if (!matched) {
                    try {
                        const pH = new URL(panel.url).hostname;
                        const fH = new URL(frame.url).hostname;
                        if (fH === pH || fH.endsWith('.' + pH) || pH.endsWith('.' + fH)) matched = true;
                    } catch (e) { }
                }

                if (matched) {
                    panel.frameId = frame.frameId;
                    panel.currentUrl = frame.url; // Track the real navigated URL
                    updatePanelStatus(panelKey, '🟢 Connected');
                    console.log(`[LLM Council] ✓ ${panelKey} → frame ${frame.frameId}`);
                    break;
                }
            }
        }

        // Mark panels with no frame discovered as failed
        for (const [key, panel] of Object.entries(iframePanels)) {
            if (!panel.frameId && !panel.failed) {
                // Don't mark as failed yet — give it another chance via retry
            }
        }
    } catch (e) {
        console.error('[LLM Council] Frame discovery error:', e);
    }
}
// ══════════════════════════════════════════════════════════════════════════════
// CONTENT SCRIPT INJECTION & MESSAGING
// ══════════════════════════════════════════════════════════════════════════════

async function injectAndSend(frameId, prompt, files = []) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: currentTabId, frameIds: [frameId] },
                files: ['content-scripts/injector.js']
            });
        } catch (e) {
            console.warn(`[LLM Council] Inject attempt ${attempt}:`, e.message);
            if (!window.__llm_reloading && (e.message.includes('manifest must request permission') || e.message.includes('Cannot access contents of'))) {
                window.__llm_reloading = true;
                if (confirm('LLM Council acquired new website permissions but Chrome requires a hard restart to apply them.\\n\\nClick OK to automatically restart the extension now.')) {
                    chrome.runtime.reload();
                } else {
                    window.__llm_reloading = false;
                }
                return;
            }
        }

        await delay(800 * attempt);

        try {
            const res = await sendMsg(frameId, { type: 'INJECT_PROMPT', prompt, files });
            if (res?.success) return res;
            if (attempt < 3) continue;
            throw new Error(res?.error || 'Injection failed');
        } catch (e) {
            if (attempt === 3) throw e;
            await delay(1500);
        }
    }
}

function sendMsg(frameId, msg) {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.sendMessage(currentTabId, msg, { frameId }, r => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(r);
            });
        } catch (e) { reject(e); }
    });
}

function extractFromFrame(frameId) {
    return new Promise(resolve => {
        try {
            chrome.tabs.sendMessage(currentTabId, { type: 'EXTRACT_RESPONSE' }, { frameId }, r => {
                if (chrome.runtime.lastError) resolve({ complete: false, response: '' });
                else resolve(r || { complete: false, response: '' });
            });
        } catch (e) { resolve({ complete: false, response: '' }); }
    });
}

// ── Response Polling ─────────────────────────────────────────────────────────

async function pollForCouncilResponses(councilIds, responses) {
    const start = Date.now();
    const pending = new Set(councilIds.filter(id => {
        const p = iframePanels[id];
        return p && !p.failed && p.frameId;
    }));

    while (pending.size > 0 && (Date.now() - start) < DEFAULTS.COUNCIL_TIMEOUT_MS) {
        for (const id of [...pending]) {
            const panel = iframePanels[id];
            if (!panel?.frameId) { pending.delete(id); continue; }

            try {
                const r = await extractFromFrame(panel.frameId);
                if (r.complete && r.response) {
                    responses[id] = r.response;
                    pending.delete(id);
                    updatePanelStatus(id, '✅ Done');
                    showStatus(`${MODELS[id]?.name} responded! (${pending.size} remaining)`);
                }
            } catch (e) { }
        }
        if (pending.size > 0) await delay(DEFAULTS.POLL_INTERVAL_MS);
    }

    for (const id of pending) updatePanelStatus(id, '⏰ Timeout');
}

async function pollFrameForResponse(frameId, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const r = await extractFromFrame(frameId);
            if (r.complete && r.response) return r.response;
        } catch (e) { }
        await delay(DEFAULTS.POLL_INTERVAL_MS);
    }
    return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function updatePanelStatus(k, text) {
    const el = document.getElementById(`status-${k}`);
    if (el) el.textContent = text;
}

function showStatus(text) {
    promptStatus.style.display = 'flex';
    promptStatusText.textContent = text;
}

function hideStatusAfterDelay(ms) {
    setTimeout(() => { promptStatus.style.display = 'none'; }, ms);
}

// ── Results ──────────────────────────────────────────────────────────────────

function showResults(result) {
    resultsBody.innerHTML = '';

    if (result.parsed && result.scores?.length > 0) {
        if (result.winner) {
            const wd = result.scores.find(s => s.modelName === result.winner);
            resultsBody.innerHTML += `
        <div class="result-winner">
          <span class="result-winner-trophy">🏆</span>
          <div class="result-winner-info">
            <span class="result-winner-label">Winner</span>
            <span class="result-winner-name">${result.winner} — ${wd ? wd.total + '/50' : ''}</span>
          </div>
        </div>`;
        }
        const sorted = [...result.scores].sort((a, b) => b.total - a.total);
        for (const s of sorted) {
            const m = Object.values(MODELS).find(x => x.name === s.modelName);
            resultsBody.innerHTML += `
        <div class="result-score-card">
          <div class="result-score-header">
            <span class="result-score-model">${m?.icon || '🤖'} ${s.modelName}</span>
            <span class="result-score-total">${s.total}/50</span>
          </div>
          <div class="result-criteria">
            <div class="result-criterion"><div class="result-criterion-label">Acc</div><div class="result-criterion-score">${s.accuracy}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Dep</div><div class="result-criterion-score">${s.depth}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Cla</div><div class="result-criterion-score">${s.clarity}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Rea</div><div class="result-criterion-score">${s.reasoning}</div></div>
            <div class="result-criterion"><div class="result-criterion-label">Rel</div><div class="result-criterion-score">${s.relevance}</div></div>
          </div>
          ${s.justification ? `<div class="result-justification">"${s.justification}"</div>` : ''}
        </div>`;
        }
    } else {
        resultsBody.innerHTML = `<div class="result-raw">${result.rawText || 'No response received.'}</div>`;
    }

    resultsModal.style.display = 'flex';
}

function copyResults() {
    if (!lastResult) return;
    let t = '📊 LLM Council Evaluation\n\n';
    if (lastResult.parsed) {
        if (lastResult.winner) t += `🏆 Winner: ${lastResult.winner}\n\n`;
        for (const s of lastResult.scores) {
            t += `${s.modelName}: ${s.total}/50 (Acc:${s.accuracy} Dep:${s.depth} Cla:${s.clarity} Rea:${s.reasoning} Rel:${s.relevance})\n`;
            if (s.justification) t += `  "${s.justification}"\n`;
        }
    } else { t += lastResult.rawText || 'No results.'; }
    navigator.clipboard.writeText(t).then(() => {
        btnCopyResults.textContent = '✅ Copied!';
        setTimeout(() => btnCopyResults.textContent = '📋 Copy', 2000);
    });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Init ─────────────────────────────────────────────────────────────────────

init();

// ══════════════════════════════════════════════════════════════════════════════
// HISTORY VIEW
// ══════════════════════════════════════════════════════════════════════════════

const historyList = document.getElementById('history-list');
const btnClearHistory = document.getElementById('btn-clear-history');
const historySearchInput = document.getElementById('history-search-input');
let promptHistory = [];

async function loadHistory() {
    try {
        const data = await chrome.storage.sync.get(STORAGE_KEYS.HISTORY);
        promptHistory = data[STORAGE_KEYS.HISTORY] || [];
        renderHistory();
    } catch (e) { console.error("Could not load history", e); }
}

async function addToHistory(prompt, modelsUsed) {
    promptHistory.unshift({
        id: Date.now().toString(),
        prompt: prompt,
        models: modelsUsed,
        timestamp: new Date().toISOString()
    });
    // Keep max 100 items
    if (promptHistory.length > 100) promptHistory.pop();

    await chrome.storage.sync.set({ [STORAGE_KEYS.HISTORY]: promptHistory });
    renderHistory();
}

async function deleteHistoryItem(id) {
    promptHistory = promptHistory.filter(item => item.id !== id);
    await chrome.storage.sync.set({ [STORAGE_KEYS.HISTORY]: promptHistory });
    renderHistory();
}

async function clearHistory() {
    if (!confirm('Are you sure you want to clear your entire prompt history?')) return;
    promptHistory = [];
    await chrome.storage.sync.set({ [STORAGE_KEYS.HISTORY]: promptHistory });
    renderHistory();
}

function renderHistory(searchQuery = '') {
    if (!historyList) return;
    historyList.innerHTML = '';

    const filtered = promptHistory.filter(h =>
        h.prompt.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (filtered.length === 0) {
        historyList.innerHTML = `<p class="placeholder-text">${searchQuery ? 'No prompts match your search.' : 'No previous queries yet. Your prompt history will appear here.'}</p>`;
        return;
    }

    filtered.forEach(item => {
        const date = new Date(item.timestamp);
        const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

        const modelTags = (item.models || []).map(m => {
            const modelName = MODELS[m]?.name || m;
            return `<span class="history-model-tag">${modelName}</span>`;
        }).join('');

        const el = document.createElement('div');
        el.className = 'history-item';
        el.innerHTML = `
            <div class="history-item-top">
                <div class="history-item-prompt">${escapeHTML(item.prompt)}</div>
                <div class="history-item-meta">
                    <span class="history-item-time">${dateStr}</span>
                    <div class="history-actions">
                        <button class="history-action-btn delete" data-id="${item.id}" title="Delete">🗑️</button>
                    </div>
                </div>
            </div>
            <div class="history-item-models">
                ${modelTags}
            </div>
        `;

        // Clicking the item fills the prompt but doesn't auto submit
        el.addEventListener('click', (e) => {
            if (e.target.closest('.history-action-btn')) return;
            promptInput.value = item.prompt;
            document.querySelectorAll('.nav-item')[0].click(); // Go to New Prompt
            promptInput.focus();
        });

        const delBtn = el.querySelector('.delete');
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteHistoryItem(item.id);
        });

        historyList.appendChild(el);
    });
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}

// History Event Listeners
if (btnClearHistory) {
    btnClearHistory.addEventListener('click', clearHistory);
}

if (historySearchInput) {
    historySearchInput.addEventListener('input', (e) => {
        renderHistory(e.target.value);
    });
}

// Load on start
loadHistory();

// ── External Event Listeners ───────────────────────────────────────────────────
window.addEventListener('templates-loaded', () => {
    const bar = document.getElementById('prompt-templates-bar');
    if (!bar) return;

    // Clear existing tags but keep the label
    bar.innerHTML = '<span class="template-label">Template:</span>';

    if (typeof promptTemplates === 'undefined' || promptTemplates.length === 0) {
        bar.style.display = 'none';
        return;
    }

    bar.style.display = 'flex';

    promptTemplates.forEach(tpl => {
        const btn = document.createElement('button');
        btn.className = 'template-tag';
        btn.textContent = tpl.name;

        btn.addEventListener('click', () => {
            const c = promptInput.value.trim();
            const t = tpl.content;

            if (t.includes('{query}')) {
                promptInput.value = t.replace(/{query}/g, c || '[Your Prompt Here]');
            } else {
                promptInput.value = c ? `${c}\n\n${t}` : t;
            }

            promptInput.focus();
            updateUI();
            saveDraftState();
        });

        bar.appendChild(btn);
    });
});
