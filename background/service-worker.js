/**
 * LLM Council — Background Service Worker
 *
 * Minimal service worker that:
 * 1. Opens the dashboard tab when extension icon is clicked
 * 2. Handles keep-alive for the extension
 *
 * All pipeline logic (iframe creation, prompt injection, polling,
 * judge evaluation) is handled by dashboard.js directly.
 */

// ── Open Dashboard Tab on Icon Click ─────────────────────────────────────────

chrome.action.onClicked.addListener(async () => {
    const dashboardUrl = chrome.runtime.getURL('dashboard/index.html');
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(t => t.url?.startsWith(dashboardUrl));

    if (existing) {
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
    } else {
        await chrome.tabs.create({ url: dashboardUrl });
    }
});

// ── Keep-Alive ───────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'council-keepalive') {
        // Keep-alive ping — no-op
    }
});

// ── Keyboard Shortcuts (Commands) ─────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'open-council') {
        const dashboardUrl = chrome.runtime.getURL('dashboard/index.html');
        const tabs = await chrome.tabs.query({});
        const existing = tabs.find(t => t.url?.startsWith(dashboardUrl));

        if (existing) {
            await chrome.tabs.update(existing.id, { active: true });
            await chrome.windows.update(existing.windowId, { focused: true });
        } else {
            await chrome.tabs.create({ url: dashboardUrl });
        }
    }
});

// ── Context Menus + Content Script Re-injection on Install/Update ─────────────

const AI_SITE_PATTERNS = [
    'https://chat.openai.com/*', 'https://chatgpt.com/*',
    'https://gemini.google.com/*', 'https://www.perplexity.ai/*',
    'https://perplexity.ai/*', 'https://grok.com/*', 'https://x.com/i/grok*',
    'https://claude.ai/*', 'https://chat.deepseek.com/*',
    'https://copilot.microsoft.com/*', 'https://chat.qwen.ai/*',
    'https://chat.qwenlm.ai/*', 'https://notebooklm.google.com/*',
    'https://aistudio.google.com/*', '*://*.kimi.moonshot.cn/*',
    '*://*.kimi.com/*', '*://*.mistral.ai/*', '*://*.poe.com/*', '*://*.z.ai/*'
];

chrome.runtime.onInstalled.addListener(async () => {
    chrome.contextMenus.create({
        id: "ask-council",
        title: "Ask LLM Council",
        contexts: ["selection"]
    });

    // Re-inject content scripts into all existing AI chat tabs
    // so users don't have to manually refresh after install/update
    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (!tab.url || !tab.id) continue;
            const matches = AI_SITE_PATTERNS.some(pattern => {
                const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
                return regex.test(tab.url);
            });
            if (!matches) continue;

            try {
                // Try to inject the content script
                await chrome.scripting.insertCSS({
                    target: { tabId: tab.id, allFrames: true },
                    files: ['content-scripts/quick-compare.css']
                });
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: true },
                    files: ['content-scripts/injector.js']
                });
            } catch (err) {
                // If injection fails (e.g. page not loaded), show a notification on that tab
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: () => {
                            if (document.getElementById('llm-council-refresh-banner')) return;
                            const banner = document.createElement('div');
                            banner.id = 'llm-council-refresh-banner';
                            banner.innerHTML = `
                                <div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:center;gap:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:llmSlideDown .3s ease-out">
                                    <span style="font-size:18px">🔄</span>
                                    <span><strong>LLM Council</strong> was just updated. Please <strong>refresh this page</strong> to enable Export & Ask Council buttons.</span>
                                    <button onclick="location.reload()" style="background:#fff;color:#4f46e5;border:none;padding:6px 16px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;white-space:nowrap">Refresh Now</button>
                                    <button onclick="this.closest('#llm-council-refresh-banner').remove()" style="background:transparent;border:1px solid rgba(255,255,255,0.4);color:#fff;padding:6px 12px;border-radius:6px;font-weight:500;cursor:pointer;font-size:13px">Dismiss</button>
                                </div>
                                <style>@keyframes llmSlideDown{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}</style>
                            `;
                            document.body.appendChild(banner);
                        }
                    });
                } catch (_) {
                    // Can't even inject the banner — page is fully restricted
                }
            }
        }
    } catch (e) {
        console.warn('LLM Council: Failed to re-inject content scripts:', e);
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "ask-council" && info.selectionText) {
        // Save the selected text to storage so the dashboard can pick it up
        await chrome.storage.local.set({ 'council_pending_prompt': info.selectionText });

        const dashboardUrl = chrome.runtime.getURL('dashboard/index.html');
        const tabs = await chrome.tabs.query({});
        const existing = tabs.find(t => t.url?.startsWith(dashboardUrl));

        if (existing) {
            await chrome.tabs.update(existing.id, { active: true });
            await chrome.windows.update(existing.windowId, { focused: true });
        } else {
            await chrome.tabs.create({ url: dashboardUrl });
        }
    }
});

// ── In-Site Quick Compare Message Listener ────────────────────────────────────

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.action === 'open_dashboard') {
        if (message.prompt) {
            await chrome.storage.local.set({ 'council_pending_prompt': message.prompt });
        }

        const dashboardUrl = chrome.runtime.getURL('dashboard/index.html');
        const tabs = await chrome.tabs.query({});
        const existing = tabs.find(t => t.url?.startsWith(dashboardUrl));

        // Ensure we open a new tab if it's not active, or focus it if it is.
        if (existing) {
            await chrome.tabs.update(existing.id, { active: true });
            await chrome.windows.update(existing.windowId, { focused: true });
        } else {
            await chrome.tabs.create({ url: dashboardUrl });
        }
    }

    if (message.action === 'open_export') {
        if (message.data) {
            await chrome.storage.local.set({ 'council_export_data': message.data });
        }

        const exportUrl = chrome.runtime.getURL('dashboard/export.html');
        const tabs = await chrome.tabs.query({});
        const existing = tabs.find(t => t.url?.startsWith(exportUrl));

        if (existing) {
            await chrome.tabs.update(existing.id, { active: true });
            await chrome.windows.update(existing.windowId, { focused: true });
            // Reload to pick up new data
            await chrome.tabs.reload(existing.id);
        } else {
            await chrome.tabs.create({ url: exportUrl });
        }
    }
});

// ── Image Proxy for Export (bypasses CORS) ────────────────────────────────────
// MUST be a separate, non-async listener so `return true` works synchronously
// to keep the sendResponse channel open.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fetch_image') {
        fetch(message.url)
            .then(response => response.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => sendResponse({ success: true, dataUrl: reader.result });
                reader.readAsDataURL(blob);
            })
            .catch(e => {
                sendResponse({ success: false, error: e.message });
            });
        return true; // Keeps the message channel open for async sendResponse
    }
});
