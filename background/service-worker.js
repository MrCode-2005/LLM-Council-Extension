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

// ── Context Menus (Right-Click) ───────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "ask-council",
        title: "Ask LLM Council",
        contexts: ["selection"]
    });
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
