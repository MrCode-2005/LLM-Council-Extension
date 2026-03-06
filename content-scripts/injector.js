/**
 * LLM Council — Content Script (Injector)
 *
 *
 * This script runs in AI site pages. It receives messages from the
 * service worker to inject prompts and extract responses.
 */

(function () {
    'use strict';

    // ── Adapter Registry ──────────────────────────────────────────────────────

    const ADAPTERS = {
        chatgpt: {
            match: () => /chatgpt\.com|chat\.openai\.com/.test(location.hostname),

            getInput: () =>
                document.querySelector('#prompt-textarea') ||
                document.querySelector('div[contenteditable="true"]'),

            setFiles: (files) => {
                const fileInput = document.querySelector('input[type="file"][multiple]') || document.querySelector('input[type="file"]');
                if (!fileInput || !files.length) return false;
                const dt = new DataTransfer();
                files.forEach(f => dt.items.add(base64ToFile(f.dataUrl, f.name, f.type)));
                fileInput.files = dt.files;
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            },

            setPrompt: (el, text) => {
                el.focus();
                if (el.tagName === 'TEXTAREA') {
                    setNativeValue(el, text);
                } else {
                    const p = el.querySelector('p');
                    if (p) p.textContent = text;
                    else el.textContent = text;
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
                }
            },

            submit: () => {
                const btn = document.querySelector('[data-testid="send-button"]') ||
                    document.querySelector('button[aria-label="Send prompt"]') ||
                    document.querySelector('form button[type="submit"]');
                if (isButtonReady(btn)) { btn.click(); return true; }
                return false;
            },

            isComplete: () => {
                const stop = document.querySelector('[data-testid="stop-button"]') ||
                    document.querySelector('[aria-label="Stop generating"]');
                if (stop) return false;
                return document.querySelectorAll('[data-message-author-role="assistant"]').length > 0;
            },

            getResponse: () => {
                const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
                if (!msgs.length) return '';
                const last = msgs[msgs.length - 1];
                return (last.querySelector('.markdown') || last).innerText.trim();
            }
        },

        gemini: {
            match: () => /gemini\.google\.com/.test(location.hostname),

            getInput: () =>
                document.querySelector('.ql-editor[contenteditable="true"]') ||
                document.querySelector('div[contenteditable="true"]'),

            setFiles: (files) => {
                const fileInput = document.querySelector('input[type="file"]');
                const dt = new DataTransfer();
                files.forEach(f => dt.items.add(base64ToFile(f.dataUrl, f.name, f.type)));

                if (fileInput) {
                    fileInput.files = dt.files;
                    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // Gemini listens to paste events on the editor
                const dropTarget = document.querySelector('.ql-editor') || document.querySelector('.text-input-field') || document.body;
                if (dropTarget) {
                    const pasteEvent = new ClipboardEvent('paste', {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: dt
                    });
                    dropTarget.dispatchEvent(pasteEvent);
                }
                return true;
            },

            setPrompt: (el, text) => {
                el.focus();
                if (el.classList.contains('ql-editor')) {
                    el.innerHTML = `<p>${text}</p>`;
                    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
                } else {
                    setNativeValue(el, text);
                }
            },

            submit: () => {
                const btn = document.querySelector('button.send-button') ||
                    document.querySelector('[aria-label="Send message"]') ||
                    document.querySelector('.send-button-container button');
                if (isButtonReady(btn)) { btn.click(); return true; }
                return false;
            },

            isComplete: () => {
                const loading = document.querySelector('mat-progress-bar') ||
                    document.querySelector('.loading-indicator');
                const stop = document.querySelector('[aria-label="Stop response"]');
                if (loading || stop) return false;
                return document.querySelectorAll('.model-response-text, message-content').length > 0;
            },

            getResponse: () => {
                const msgs = document.querySelectorAll('.model-response-text, message-content');
                if (!msgs.length) return '';
                return msgs[msgs.length - 1].innerText.trim();
            }
        },

        perplexity: {
            match: () => /perplexity\.ai/.test(location.hostname),

            getInput: () =>
                document.querySelector('div#ask-input') ||
                document.querySelector('[role="textbox"]') ||
                document.querySelector('textarea[placeholder*="Ask"]') ||
                document.querySelector('textarea'),

            setPrompt: (el, text) => {
                el.focus();
                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    setNativeValue(el, text);
                } else {
                    // contenteditable div
                    el.textContent = '';
                    document.execCommand('insertText', false, text);
                    if (!el.textContent?.trim()) {
                        el.innerHTML = `<p>${text}</p>`;
                    }
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
                }
            },

            submit: () => {
                const btn = document.querySelector('button[aria-label="Submit"]') ||
                    document.querySelector('button.bg-super') ||
                    document.querySelector('button[type="submit"]');
                if (isButtonReady(btn)) { btn.click(); return true; }
                // Try Enter key as fallback
                return false;
            },

            isComplete: () => {
                const loading = document.querySelector('.animate-spin');
                if (loading) return false;
                return document.querySelectorAll('.prose').length > 0;
            },

            getResponse: () => {
                const answers = document.querySelectorAll('.prose');
                if (!answers.length) return '';
                return answers[answers.length - 1].innerText.trim();
            }
        },

        grok: {
            match: () => /grok\.com|x\.com\/i\/grok/.test(location.hostname + location.pathname),

            getInput: () =>
                document.querySelector('textarea[aria-label="Ask Grok anything"]') ||
                document.querySelector('textarea[placeholder*="Ask"]') ||
                document.querySelector('textarea[placeholder*="How can I help you today?"]') ||
                document.querySelector('textarea[placeholder*="Message"]') ||
                document.querySelector('textarea[id="chat-input"]') ||
                document.querySelector('div[contenteditable="true"].ProseMirror') ||
                document.querySelector('div[contenteditable="true"][placeholder*="Ask"]') ||
                document.querySelector('div[contenteditable="true"]') ||
                document.querySelector('textarea'),

            setPrompt: (el, text) => {
                el.focus();
                if (el.classList && el.classList.contains('ProseMirror')) {
                    el.innerHTML = `<p>${text}</p>`;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                } else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    const changed = document.execCommand('insertText', false, text);
                    if (!changed) setNativeValue(el, text);
                } else {
                    el.textContent = '';
                    document.execCommand('insertText', false, text);
                    if (!el.textContent?.trim()) {
                        el.textContent = text;
                    }
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
                }
            },

            submit: () => {
                const btn = document.querySelector('button[aria-label="Submit"]') ||
                    document.querySelector('button[aria-label*="Send"]') ||
                    document.querySelector('button[aria-label*="Grok"]') ||
                    document.querySelector('button[type="submit"]') ||
                    document.querySelector('svg path[d*="M6 11L12 5M12 5L18 11M12 5V19"]')?.closest('button') ||
                    document.querySelector('svg path[d*="M2.01"]')?.closest('button');
                if (isButtonReady(btn)) { btn.click(); return true; }
                return false;
            },

            isComplete: () => {
                const stop = document.querySelector('[aria-label*="Stop"]') ||
                    document.querySelector('button[class*="stop"]');
                if (stop) return false;
                return document.querySelectorAll('[class*="message"][class*="assistant"], [class*="response"], .markdown-body').length > 0;
            },

            getResponse: () => {
                const msgs = document.querySelectorAll('[class*="message"][class*="assistant"], [class*="response"], .markdown-body');
                if (!msgs.length) return '';
                return msgs[msgs.length - 1].innerText.trim();
            }
        },

        claude: {
            match: () => /claude\.ai/.test(location.hostname),
            getInput: () => document.querySelector('.ProseMirror') || document.querySelector('div.ProseMirror') || document.querySelector('div[contenteditable="true"]') || document.querySelector('p[data-placeholder]') || document.querySelector('div[data-placeholder]'),
            setPrompt: (el, text) => {
                el.focus();
                el.innerHTML = `<p>${text}</p>`;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            },
            submit: () => {
                const btn = document.querySelector('button[aria-label*="Send"]') ||
                    document.querySelector('button:has(svg)'); // Claude's button often just has an SVG icon 
                if (isButtonReady(btn)) { btn.click(); return true; }
                return false;
            },
            isComplete: () => {
                const stopBtn = document.querySelector('button[aria-label*="Stop"]') ||
                    document.querySelector('button[aria-label*="stop"]');
                const claudeMsgs = document.querySelectorAll('.font-claude-message, .font-claude-response');
                return !stopBtn && claudeMsgs.length > 0;
            },
            getResponse: () => {
                const msgs = document.querySelectorAll('.font-claude-message, .font-claude-response');
                return msgs.length ? msgs[msgs.length - 1].innerText.trim() : '';
            }
        },

        deepseek: {
            match: () => /chat\.deepseek\.com/.test(location.hostname),
            getInput: () => document.querySelector('textarea#chat-input') || document.querySelector('#chat-input') || document.querySelector('.ds-input') || document.querySelector('div[contenteditable="plaintext-only"]') || document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea'),
            setPrompt: (el, text) => {
                el.focus();
                if (el.tagName === 'TEXTAREA') {
                    setNativeValue(el, text);
                } else {
                    document.execCommand('selectAll', false, null);
                    document.execCommand('insertText', false, text);
                    if (!el.textContent?.trim()) {
                        el.textContent = text;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            },
            submit: () => {
                // ds-icon-button matches both paperclip and send; send is the last one
                const allIconBtns = document.querySelectorAll('div.ds-icon-button');
                const btn = allIconBtns.length > 0 ? allIconBtns[allIconBtns.length - 1] : document.querySelector('div[role="button"]:last-of-type');
                if (isButtonReady(btn)) { btn.click(); return true; }
                return false;
            },
            isComplete: () => {
                const stopBtn = document.querySelector('div[aria-label="Stop"]');
                return !stopBtn && document.querySelectorAll('.ds-markdown').length > 0;
            },
            getResponse: () => {
                const msgs = document.querySelectorAll('.ds-markdown');
                return msgs.length ? msgs[msgs.length - 1].innerText.trim() : '';
            }
        },

        copilot: {
            match: () => /copilot\.microsoft\.com/.test(location.hostname),
            getInput: () => document.querySelector('#userInput') || document.querySelector('textarea.m-0') || document.querySelector('textarea'),
            setPrompt: (el, text) => {
                el.focus();
                setNativeValue(el, text);
            },
            submit: () => {
                // Try multiple selectors for Copilot's submit button
                const btn = document.querySelector('button[aria-label="Submit"]') ||
                    document.querySelector('button[title="Submit"]') ||
                    document.querySelector('div[role="button"][aria-label="Submit"]') ||
                    document.querySelector('button[aria-label*="Send"]') ||
                    document.querySelector('button[data-testid="submit-button"]') ||
                    document.querySelector('button[type="submit"]') ||
                    document.querySelector('button.submit-button') ||
                    document.querySelector('form button');
                if (isButtonReady(btn)) { btn.click(); return true; }

                // Fallback: try pressing Enter on the textarea
                const input = document.querySelector('#userInput') || document.querySelector('textarea');
                if (input && input.value?.trim()) {
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                    return true;
                }
                return false;
            },
            isComplete: () => {
                const stopBtn = document.querySelector('button[aria-label="Stop Responding"]') ||
                    document.querySelector('button[aria-label*="Stop"]') ||
                    document.querySelector('button[aria-label*="stop"]');
                if (stopBtn) return false;
                const responses = document.querySelectorAll('[data-testid="ai-message"], [data-content="ai-message"]');
                if (responses.length > 0) return true;
                const fallback = document.querySelectorAll('.prose, [class*="ai-message"]');
                return fallback.length > 0;
            },
            getResponse: () => {
                let msgs = document.querySelectorAll('[data-testid="ai-message"], [data-content="ai-message"]');
                if (!msgs.length) msgs = document.querySelectorAll('.prose, [class*="ai-message"]');
                return msgs.length ? msgs[msgs.length - 1].innerText.trim() : '';
            }
        },

        qwen: {
            match: () => /chat\.qwen(?:lm)?\.ai/.test(location.hostname),
            getInput: () => document.querySelector('textarea.ant-input') || document.querySelector('textarea'),
            setPrompt: (el, text) => {
                el.focus();
                setNativeValue(el, text);
            },
            submit: () => {
                const btn = document.querySelector('button.send-btn') || document.querySelector('button[aria-label*="Send"]');
                if (isButtonReady(btn)) { btn.click(); return true; }
                return false;
            },
            isComplete: () => {
                // Check for stop button (Qwen uses button.stop-button)
                const stopBtn = document.querySelector('button.stop-button') || document.querySelector('.stop-generating');
                if (stopBtn) return false;
                // Check that a response exists
                const responses = document.querySelectorAll('.qwen-markdown, .qwen-markdown-text, .response-message-content.phase-answer, .markdown-body');
                return responses.length > 0;
            },
            getResponse: () => {
                // Try Qwen's current selectors first, then fall back
                const msgs = document.querySelectorAll('.qwen-markdown, .qwen-markdown-text, .response-message-content.phase-answer, .markdown-body');
                return msgs.length ? msgs[msgs.length - 1].innerText.trim() : '';
            }
        },

        notebooklm: {
            match: () => /notebooklm\.google\.com/.test(location.hostname),
            getInput: async () => {
                const chatTab = Array.from(document.querySelectorAll('.mdc-tab, button, [role="tab"]')).find(el => (el.textContent === 'Chat' || el.innerText === 'Chat' || el.getAttribute('aria-label') === 'Chat'));
                if (chatTab && chatTab.getAttribute('aria-selected') !== 'true' && !chatTab.classList.contains('active')) {
                    chatTab.click();
                    await new Promise(r => setTimeout(r, 500)); // Give NotebookLM DOM time to mount textarea
                }
                return document.querySelector('textarea.query-box-input') ||
                    document.querySelector('textarea[aria-label="Query box"]') ||
                    document.querySelector('.mdc-text-field__input') ||
                    document.querySelector('textarea[aria-label*="Ask"]') ||
                    document.querySelector('div[role="textbox"]') ||
                    document.querySelector('textarea') ||
                    document.querySelector('div[contenteditable="plaintext-only"]') ||
                    document.querySelector('div[contenteditable="true"]') ||
                    document.querySelector('input[placeholder*="Ask"]') ||
                    document.querySelector('input[placeholder*="Search"]') ||
                    document.querySelector('input[type="text"]') ||
                    document.querySelector('input');
            },
            setPrompt: (el, text) => {
                el.focus();
                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    setNativeValue(el, text);
                } else {
                    document.execCommand('selectAll', false, null);
                    document.execCommand('insertText', false, text);
                }
            },
            submit: () => {
                const btn = document.querySelector('button.submit-button') || document.querySelector('button[aria-label="Submit"]') || document.querySelector('button[aria-label*="Send"]') || document.querySelector('button.mdc-icon-button.send');
                if (isButtonReady(btn)) { btn.click(); return true; }
                return false;
            },
            isComplete: () => {
                const loader = document.querySelector('.generating-indicator');
                return !loader && document.querySelectorAll('.message.assistant').length > 0;
            },
            getResponse: () => {
                const msgs = document.querySelectorAll('.message.assistant .model-response');
                return msgs.length ? msgs[msgs.length - 1].innerText.trim() : '';
            }
        },

        aistudio: {
            match: () => /aistudio\.google\.com/.test(location.hostname),
            getInput: () => document.querySelector('textarea[aria-label*="prompt"]') || document.querySelector('ms-prompt-input textarea') || document.querySelector('textarea'),
            setPrompt: (el, text) => {
                el.focus();
                setNativeValue(el, text);
            },
            submit: () => {
                window.__aistudio_pre_submit_count = document.querySelectorAll('ms-text-chunk, .turn-content, .chat-turn-container.model').length;
                const btn = document.querySelector('button.run-button') || document.querySelector('button[aria-label*="Run"]');
                if (isButtonReady(btn)) { btn.click(); return true; }
                // Also try clicking any button whose text includes 'Run'
                const allBtns = document.querySelectorAll('button');
                for (const b of allBtns) {
                    if (b.textContent?.includes('Run') && isButtonReady(b)) { b.click(); return true; }
                }
                return false;
            },
            isComplete: () => {
                const preCount = window.__aistudio_pre_submit_count || 0;
                const currentMsgs = document.querySelectorAll('ms-text-chunk, .chat-turn-container.model');
                if (currentMsgs.length <= preCount) return false;

                // Check if Run button is present (not Stop)
                const allBtns = document.querySelectorAll('button');
                const hasStop = Array.from(allBtns).some(b => b.textContent?.includes('Stop'));
                if (hasStop) return false;

                // Verify response has content
                const chunks = document.querySelectorAll('ms-text-chunk');
                if (chunks.length > 0) {
                    const lastChunk = chunks[chunks.length - 1].innerText?.trim() || '';
                    return lastChunk.length > 10;
                }
                return false;
            },
            getResponse: () => {
                const chunks = document.querySelectorAll('ms-text-chunk');
                if (chunks.length) return chunks[chunks.length - 1].innerText.trim();
                // Fallback
                const turns = document.querySelectorAll('.turn-content');
                return turns.length ? turns[turns.length - 1].innerText.trim() : '';
            }
        },

        kimi: {
            match: () => /kimi\.(moonshot\.cn|com)/.test(location.hostname),
            getInput: () => document.querySelector('.chat-input-editor[role="textbox"]') || document.querySelector('div[contenteditable="plaintext-only"]') || document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea'),
            setPrompt: (el, text) => {
                el.focus();
                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    setNativeValue(el, text);
                } else {
                    document.execCommand('selectAll', false, null);
                    document.execCommand('insertText', false, text);
                }
            },
            submit: () => {
                // Save response count before submission
                window.__kimi_pre_submit_count = document.querySelectorAll('.markdown, .segment-assistant').length;
                const btn = document.querySelector('.send-button-container:not(.disabled)') || document.querySelector('button[aria-label*="Send"]') || document.querySelector('button[data-testid*="send"]');
                if (isButtonReady(btn)) { btn.click(); return true; }
                return false;
            },
            isComplete: () => {
                const preCount = window.__kimi_pre_submit_count || 0;
                const currentMsgs = document.querySelectorAll('.markdown, .segment-assistant');

                // Must have a new response
                if (currentMsgs.length <= preCount) return false;

                // Check if still streaming (stop button visible)
                const stopBtn = document.querySelector('.send-button-container.stop');
                if (stopBtn) return false;

                // Action buttons (copy, regenerate, share, like, dislike) appear when done
                const actionBtns = document.querySelectorAll('.icon-button');
                if (actionBtns.length >= 3) return true;

                // Fallback: response has meaningful content
                const lastMsg = currentMsgs[currentMsgs.length - 1].innerText?.trim() || '';
                return lastMsg.length > 20;
            },
            getResponse: () => {
                const msgs = document.querySelectorAll('.markdown');
                if (!msgs.length) {
                    // Fallback selectors
                    const fallback = document.querySelectorAll('.segment-assistant .segment-content, [class*="message"]');
                    return fallback.length ? fallback[fallback.length - 1].innerText.trim() : '';
                }
                return msgs[msgs.length - 1].innerText.trim();
            }
        },

        mistral: {
            match: () => /chat\.mistral\.ai/.test(location.hostname),
            getInput: () => document.querySelector('.ProseMirror[contenteditable="true"]') || document.querySelector('textarea[placeholder*="Ask"]') || document.querySelector('textarea'),
            setPrompt: (el, text) => {
                el.focus();
                if (el.contentEditable === 'true' || el.classList.contains('ProseMirror')) {
                    // ProseMirror contenteditable div
                    el.innerHTML = `<p>${text}</p>`;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                    setNativeValue(el, text);
                }
            },
            submit: () => {
                const btn = document.querySelector('button[aria-label="Send question"]') || document.querySelector('button[aria-label*="Send"]') || document.querySelector('button[type="submit"]');
                if (isButtonReady(btn)) { btn.click(); return true; }
                return false;
            },
            isComplete: () => {
                const responses = document.querySelectorAll('[data-testid="text-message-part"], [data-message-author-role="assistant"], .markdown-container-style, .prose');
                return responses.length > 0;
            },
            getResponse: () => {
                let msgs = document.querySelectorAll('[data-testid="text-message-part"], .markdown-container-style');
                if (!msgs.length) msgs = document.querySelectorAll('[data-message-author-role="assistant"], .prose');
                return msgs.length ? msgs[msgs.length - 1].innerText.trim() : '';
            }
        },

        zai: {
            match: () => /(?:^|\.)z\.ai$/.test(location.hostname),
            getInput: () => document.querySelector('textarea#chat-input') || document.querySelector('textarea[placeholder*="Send a Message"]') || document.querySelector('textarea'),
            setPrompt: (el, text) => {
                // Save response count BEFORE prompt is sent — this is always called
                window.__zai_pre_submit_count = document.querySelectorAll('.markdown-prose, .chat-assistant').length;
                el.focus();
                setNativeValue(el, text);
            },
            submit: () => {
                const btn = document.querySelector('button#send-message-button') || document.querySelector('button[type="submit"]');
                if (isButtonReady(btn)) { btn.click(); return true; }
                return false;
            },
            isComplete: () => {
                const preCount = window.__zai_pre_submit_count;
                // If setPrompt hasn't been called yet, not complete
                if (preCount === undefined) return false;

                const currentMsgs = document.querySelectorAll('.markdown-prose, .chat-assistant');

                // Must have a NEW response element (more than before submission)
                if (currentMsgs.length <= preCount) return false;

                // Check for 'Skip' button (Z.AI thinking phase)
                const hasSkip = Array.from(document.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Skip');
                if (hasSkip) return false;

                // Check for 'Thinking...' text
                const bodyText = document.body?.innerText || '';
                if (bodyText.includes('Thinking...')) return false;

                // Send button must be back (not replaced by stop button)
                const sendBtn = document.querySelector('button#send-message-button');
                if (!sendBtn) return false;

                // Verify new response has meaningful content
                const lastMsg = currentMsgs[currentMsgs.length - 1].innerText?.trim() || '';
                return lastMsg.length > 20 && !lastMsg.startsWith('Thinking');
            },
            getResponse: () => {
                const msgs = document.querySelectorAll('.markdown-prose, .chat-assistant');
                if (!msgs.length) return '';
                let text = msgs[msgs.length - 1].innerText?.trim() || '';
                // Strip "Thought Process" prefix if present
                text = text.replace(/^Thought Process\s*\n?/i, '').trim();
                return text;
            }
        },

        poe: {
            match: () => /poe\.com/.test(location.hostname),
            getInput: () => document.querySelector('textarea[class*="GrowingTextArea"]') || document.querySelector('textarea'),
            setPrompt: (el, text) => {
                el.focus();
                setNativeValue(el, text);
            },
            submit: () => {
                const btn = document.querySelector('button[class*="ChatMessageInputContainer_sendButton"]') || document.querySelector('button[aria-label="Send message"]') || document.querySelector('.send-button');
                if (isButtonReady(btn)) { btn.click(); return true; }
                return false;
            },
            isComplete: () => {
                return document.querySelectorAll('[class*="Markdown_markdownContainer"]').length > 0;
            },
            getResponse: () => {
                const msgs = document.querySelectorAll('[class*="Markdown_markdownContainer"]');
                return msgs.length ? msgs[msgs.length - 1].innerText.trim() : '';
            }
        }
    };
    // ── Utility ──────────────────────────────────────────────────────────────

    function base64ToFile(dataUrl, filename, mimeType) {
        const arr = dataUrl.split(',');
        const mime = arr[0].match(/:(.*?);/)[1] || mimeType;
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new File([u8arr], filename, { type: mime });
    }

    function setNativeValue(el, value) {
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        )?.set;

        if (setter && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
            setter.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            el.focus();
            document.execCommand('insertText', false, value);
            if (!el.textContent?.trim()) {
                el.textContent = value;
                el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
            }
        }
    }

    function getAdapter() {
        for (const [id, adapter] of Object.entries(ADAPTERS)) {
            if (adapter.match()) return { id, ...adapter };
        }
        return null;
    }

    function isButtonReady(btn) {
        if (!btn) return false;
        if (btn.disabled) return false;
        if (btn.getAttribute('aria-disabled') === 'true' || btn.getAttribute('disabled') !== null) return false;
        if (btn.classList.contains('disabled') || btn.classList.contains('ds-icon-button--disabled')) return false;
        if (window.getComputedStyle(btn).opacity === '0.5' || window.getComputedStyle(btn).opacity === '0.4') return false;
        if (window.getComputedStyle(btn).pointerEvents === 'none') return false;
        return true;
    }

    // ── Message Handler ──────────────────────────────────────────────────────

    // Use a flag to prevent multiple listener registrations
    if (!window.__llm_council_listener_added) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const adapter = getAdapter();
            if (!adapter) {
                sendResponse({ success: false, error: 'No matching adapter for this site' });
                return true;
            }

            (async () => {
                switch (message.type) {
                    case 'INJECT_PROMPT': {
                        try {
                            const input = await Promise.resolve(adapter.getInput());
                            if (!input) {
                                sendResponse({ success: false, error: `${adapter.id}: Input element not found` });
                                return;
                            }

                            const hasFiles = message.files && message.files.length > 0;

                            if (hasFiles) {
                                if (adapter.setFiles) {
                                    adapter.setFiles(message.files);
                                } else {
                                    const dt = new DataTransfer();
                                    message.files.forEach(f => dt.items.add(base64ToFile(f.dataUrl, f.name, f.type)));

                                    const fileInput = document.querySelector('input[type="file"][multiple]') || document.querySelector('input[type="file"]');
                                    if (fileInput) {
                                        fileInput.files = dt.files;
                                        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                                    } else if (input) {
                                        const pasteEvent = new ClipboardEvent('paste', {
                                            bubbles: true,
                                            cancelable: true,
                                            clipboardData: dt
                                        });
                                        input.dispatchEvent(pasteEvent);
                                    }
                                }
                            }

                            adapter.setPrompt(input, message.prompt);

                            // Try submitting periodically to allow file uploads to finish
                            let attempts = 0;
                            let captchaDetected = false;
                            const baseMaxAttempts = hasFiles ? 15 : 6;

                            // ── CAPTCHA Detection & Auto-Click ──
                            function trySolveCaptcha() {
                                let found = false;
                                try {
                                    // 1. Cloudflare Turnstile iframe — click its container (can't access cross-origin iframe internals)
                                    const turnstileFrame = document.querySelector('iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"], iframe[src*="captcha"]');
                                    if (turnstileFrame) {
                                        found = true;
                                        // Click the iframe itself — Turnstile listens for this
                                        turnstileFrame.click();
                                        // Also click the parent container wrapping the iframe
                                        const container = turnstileFrame.closest('.cf-turnstile, [id*="turnstile"], [class*="turnstile"], [class*="captcha"], [class*="challenge"]');
                                        if (container) container.click();
                                    }

                                    // 2. Click any Turnstile widget or input directly on the page
                                    const turnstileWidgets = document.querySelectorAll('.cf-turnstile, [id*="turnstile"], [class*="turnstile"]');
                                    turnstileWidgets.forEach(w => {
                                        found = true;
                                        w.click();
                                        // Try clicking any input/checkbox inside
                                        const cb = w.querySelector('input[type="checkbox"], input');
                                        if (cb) cb.click();
                                    });

                                    // 3. Find any "Verify you are human" text on the page and click its container
                                    const allElements = document.querySelectorAll('div, span, label, button, p');
                                    for (const el of allElements) {
                                        const text = el.textContent?.trim().toLowerCase() || '';
                                        if ((text.includes('verify') && (text.includes('human') || text.includes('you are'))) ||
                                            text === 'verify' || text === 'verify you are human') {
                                            found = true;
                                            el.click();
                                            // Also click the parent — the actual clickable target may be the container
                                            if (el.parentElement) el.parentElement.click();
                                            break;
                                        }
                                    }

                                    // 4. Look for any checkbox-looking elements inside challenge overlays
                                    const challengeOverlays = document.querySelectorAll('[class*="challenge"], [class*="captcha"], [class*="verify"], [id*="challenge"]');
                                    challengeOverlays.forEach(overlay => {
                                        found = true;
                                        overlay.click();
                                        const checkboxes = overlay.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
                                        checkboxes.forEach(cb => cb.click());
                                    });

                                } catch (e) { /* CAPTCHA click attempt failed, continue */ }
                                return found;
                            }

                            const trySubmit = () => {
                                // Attempt to solve CAPTCHA if present
                                const captchaFound = trySolveCaptcha();
                                if (captchaFound && !captchaDetected) {
                                    captchaDetected = true;
                                    console.log('[LLM Council] CAPTCHA detected on', adapter.id, '— attempting to solve, extending retry window');
                                }

                                // Extend retries significantly if we detected a CAPTCHA (need time for verification)
                                const maxAttempts = captchaDetected ? Math.max(baseMaxAttempts, 30) : baseMaxAttempts;

                                const submitted = adapter.submit();
                                if (!submitted) {
                                    attempts++;

                                    // Also try Enter key on every attempt as an additional fallback
                                    if (input) {
                                        input.focus();
                                        input.dispatchEvent(new KeyboardEvent('keydown', {
                                            key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
                                        }));
                                    }

                                    if (attempts < maxAttempts) {
                                        // Use longer interval if CAPTCHA was detected to give time
                                        const retryDelay = captchaDetected ? 2000 : 1000;
                                        setTimeout(trySubmit, retryDelay);
                                        return;
                                    } else {
                                        // Final forcible fallback
                                        const anyBtn = document.querySelector('button[aria-label*="Send"], [data-testid="send-button"], button[type="submit"], button.send-button, form button');
                                        if (anyBtn) anyBtn.click();

                                        input.dispatchEvent(new KeyboardEvent('keydown', {
                                            key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
                                        }));
                                    }
                                }
                            };

                            setTimeout(trySubmit, hasFiles ? 2000 : 800);
                            // Send response immediately — the submit retry runs independently
                            sendResponse({ success: true, model: adapter.id });

                        } catch (e) {
                            sendResponse({ success: false, error: e.message });
                        }
                        break;
                    }

                    case 'EXTRACT_RESPONSE': {
                        try {
                            const complete = adapter.isComplete();
                            const response = complete ? adapter.getResponse() : '';
                            sendResponse({
                                success: true,
                                complete,
                                response,
                                model: adapter.id
                            });
                        } catch (e) {
                            sendResponse({ success: false, error: e.message });
                        }
                        break;
                    }

                    default:
                        sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
                        break;
                }
            })();

            return true;
        });
        window.__llm_council_listener_added = true;
    }

    // ── Proactive CAPTCHA Watcher (Copilot & other sites with Turnstile) ──
    // This watches for CAPTCHA challenges appearing on the page and auto-clicks them
    // before they can block prompt injection or submission.
    if (!window.__llm_council_captcha_watcher && /copilot\.microsoft\.com/.test(location.hostname)) {
        window.__llm_council_captcha_watcher = true;

        function autoClickCaptcha() {
            try {
                // Click Turnstile iframe container
                const turnstileFrame = document.querySelector('iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"], iframe[src*="captcha"]');
                if (turnstileFrame) {
                    turnstileFrame.click();
                    const container = turnstileFrame.closest('.cf-turnstile, [id*="turnstile"], [class*="turnstile"], [class*="captcha"]');
                    if (container) container.click();
                }

                // Click any Turnstile widgets
                document.querySelectorAll('.cf-turnstile, [id*="turnstile"], [class*="turnstile"]').forEach(w => {
                    w.click();
                    const cb = w.querySelector('input[type="checkbox"], input');
                    if (cb) cb.click();
                });

                // Find "Verify you are human" text and click it
                const allEls = document.querySelectorAll('div, span, label, button, p');
                for (const el of allEls) {
                    const text = el.textContent?.trim().toLowerCase() || '';
                    if ((text.includes('verify') && (text.includes('human') || text.includes('you are'))) ||
                        text === 'verify you are human') {
                        el.click();
                        if (el.parentElement) el.parentElement.click();
                        console.log('[LLM Council] Auto-clicked CAPTCHA verification on Copilot');
                        break;
                    }
                }
            } catch (e) { /* silent */ }
        }

        // Check every 2 seconds for CAPTCHA
        setInterval(autoClickCaptcha, 2000);
        // Also check immediately
        setTimeout(autoClickCaptcha, 500);
    }

    // ── In-Site "Quick Compare" & "Export" Buttons ─────────────────────────────

    // We only inject buttons if we are NOT in an iframe
    if (window === window.top) {
        chrome.storage.local.get([
            'askCouncilEnabled', 'askCouncilColor', 'askCouncilSize', 'askCouncilPosition',
            'exportBtnEnabled', 'exportBtnColor', 'exportBtnSize', 'exportBtnPosition'
        ], (prefs) => {
            window.__askCouncilPrefs = {
                enabled: prefs.askCouncilEnabled !== false,
                color: prefs.askCouncilColor || '#8951d6',
                size: prefs.askCouncilSize || 'medium',
                position: prefs.askCouncilPosition || 'bottom'
            };
            window.__exportBtnPrefs = {
                enabled: prefs.exportBtnEnabled !== false,
                color: prefs.exportBtnColor || '#0ea5e9',
                size: prefs.exportBtnSize || 'medium',
                position: prefs.exportBtnPosition || 'bottom'
            };

            // Only set up observer if at least one button is enabled
            if (window.__askCouncilPrefs.enabled || window.__exportBtnPrefs.enabled) {
                if (!window.__llm_council_observer_active) {
                    window.__llm_council_observer_active = true;
                    setupMessageObserver();
                }
            }
        });
    }

    function setupMessageObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.addedNodes.length) {
                    injectQuickCompareButtons();
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(injectQuickCompareButtons, 1000);
    }

    function createStyledBtn(prefs, className) {
        const sizeMap = { small: { font: '11px', pad: '3px 8px', icon: '12' }, medium: { font: '13px', pad: '4px 10px', icon: '14' }, large: { font: '15px', pad: '6px 14px', icon: '16' } };
        const sz = sizeMap[prefs.size] || sizeMap.medium;
        const btn = document.createElement('button');
        btn.className = className;

        const isSide = prefs.position === 'side';
        btn.style.cssText = `
            display: inline-flex; align-items: center; gap: 6px;
            background: transparent; color: ${prefs.color};
            border: 1px solid ${prefs.color}; border-radius: 6px;
            padding: ${sz.pad}; font-family: system-ui, -apple-system, sans-serif;
            font-size: ${sz.font}; font-weight: 500; cursor: pointer;
            transition: all 0.2s ease; opacity: 0.8;
            flex-shrink: 0; white-space: nowrap;
            ${isSide ? 'margin-left: 8px; display: inline-flex;' : 'display: inline-flex; margin-top: 8px; margin-left: 4px;'}
        `;
        btn.addEventListener('mouseenter', () => { btn.style.background = prefs.color; btn.style.color = 'white'; btn.style.opacity = '1'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = prefs.color; btn.style.opacity = '0.8'; });
        return { btn, sz };
    }

    function captureEntireChat(adapter) {
        const site = adapter.id || 'unknown';
        const messages = []; // interleaved {role, text, html, images}

        // Helper: clone element, strip injected buttons AND site UI artifacts, convert images to base64
        function cleanClone(el) {
            const clone = el.cloneNode(true);
            // Remove our injected buttons
            clone.querySelectorAll('.llm-council-inline-btn, .llm-council-export-btn, .llm-council-btn-row').forEach(b => b.remove());
            // Remove copy/action buttons (but keep language labels in code headers)
            clone.querySelectorAll('button[class*="copy"], button[class*="Code"], [class*="result-streaming"]').forEach(b => b.remove());
            // Remove only BUTTONS inside code headers/sticky bars (keep the header text like "C", "Python")
            clone.querySelectorAll('pre button, .code-block button, [class*="sticky"] button, [class*="code-header"] button, [class*="codeblock-header"] button').forEach(b => b.remove());
            // Convert images to base64 data URIs
            const origImgs = el.querySelectorAll('img');
            const cloneImgs = clone.querySelectorAll('img');
            origImgs.forEach((origImg, i) => {
                if (cloneImgs[i]) {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = origImg.naturalWidth || origImg.width || 300;
                        canvas.height = origImg.naturalHeight || origImg.height || 200;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(origImg, 0, 0, canvas.width, canvas.height);
                        const dataUrl = canvas.toDataURL('image/png');
                        cloneImgs[i].src = dataUrl;
                        cloneImgs[i].removeAttribute('srcset');
                        cloneImgs[i].removeAttribute('loading');
                    } catch { /* CORS or tainted canvas - keep original src */ }
                }
            });
            // ── Restructure images for proper grid layout ──
            // ChatGPT wraps each image in its own <div> inside an <a> inside another <div>.
            // We need to: 1) unwrap from <a>, 2) unwrap from individual wrapper divs,
            // 3) make the common parent a flex container.

            // Step 1: Unwrap images from <a> tags
            clone.querySelectorAll('a').forEach(a => {
                const imgs = a.querySelectorAll('img');
                if (imgs.length > 0 && !a.textContent.replace(/\s/g, '').length) {
                    imgs.forEach(img => a.parentNode.insertBefore(img, a));
                    a.remove();
                }
            });

            // Step 2: Find groups of sibling elements that each contain an image
            // Walk up multiple levels to handle deeply nested wrappers
            const processedParents = new Set();
            clone.querySelectorAll('img').forEach(img => {
                // Walk up to find the container whose children each hold images
                let current = img;
                for (let depth = 0; depth < 5; depth++) {
                    const wrapper = current.parentElement;
                    if (!wrapper || wrapper === clone || processedParents.has(wrapper)) break;

                    const parent = wrapper.parentElement;
                    if (!parent || parent === clone || processedParents.has(parent)) break;

                    // Check if parent has multiple children that each hold a single image
                    const children = Array.from(parent.children);
                    const imgHolders = children.filter(child => {
                        if (child.tagName === 'IMG') return true;
                        return child.querySelector('img') && child.querySelectorAll('img').length === 1;
                    });

                    if (imgHolders.length >= 2) {
                        processedParents.add(parent);
                        // Unwrap images from their individual wrapper divs
                        imgHolders.forEach(holder => {
                            if (holder.tagName === 'IMG') return;
                            const hImg = holder.querySelector('img');
                            if (hImg) {
                                hImg.removeAttribute('style');
                                hImg.style.cssText = 'width:calc(33.33% - 6px); height:200px; border-radius:8px; object-fit:cover;';
                                parent.insertBefore(hImg, holder);
                                holder.remove();
                            }
                        });
                        parent.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; align-items:flex-start; margin:8px 0;';
                        parent.dataset.imgContainer = 'true';
                        break; // Found and processed, stop walking up
                    }
                    current = wrapper; // Go one level higher
                }
            });

            // Step 3: Also handle direct sibling images (already unwrapped)
            clone.querySelectorAll('img').forEach(img => {
                const parent = img.parentElement;
                if (!parent || parent.dataset.imgContainer || processedParents.has(parent)) return;
                const directImgs = parent.querySelectorAll(':scope > img');
                if (directImgs.length >= 2) {
                    directImgs.forEach(i => {
                        i.removeAttribute('style');
                        i.style.cssText = 'width:calc(33.33% - 6px); height:200px; border-radius:8px; object-fit:cover;';
                    });
                    parent.style.cssText += 'display:flex; flex-wrap:wrap; gap:8px; align-items:flex-start; margin:8px 0;';
                    parent.dataset.imgContainer = 'true';
                }
            });

            return clone;
        }

        // Build code block HTML by walking the ORIGINAL DOM tree directly.
        // Handles both <pre><code> (classic) and <pre><div> (ChatGPT 2025) structures.
        function inlineCodeStyles(clone, origEl) {
            const origPres = origEl.querySelectorAll('pre');
            const clonePres = clone.querySelectorAll('pre');

            origPres.forEach((origPre, preIdx) => {
                if (!clonePres[preIdx]) return;
                const clonePre = clonePres[preIdx];

                // Copy styles on the <pre> element
                const preCS = getComputedStyle(origPre);
                clonePre.style.backgroundColor = preCS.backgroundColor;
                clonePre.style.color = preCS.color;
                clonePre.style.borderRadius = preCS.borderRadius;
                clonePre.style.overflowX = 'auto';
                clonePre.style.whiteSpace = 'pre';
                clonePre.style.padding = '0';
                clonePre.style.margin = '16px 0';

                // ── Find the code content element ──
                // Strategy 1: Look for <code> inside <pre> (classic structure)
                let origCodeEl = origPre.querySelector('code');
                let cloneCodeEl = clonePre.querySelector('code');

                if (!origCodeEl) {
                    // Strategy 2: ChatGPT 2025 structure
                    // <pre> > <div wrapper> > [<div header (has buttons)>, <div code-body>]
                    // Find code body in ORIGINAL by looking for child div WITHOUT buttons
                    // Then use the SAME positional index in the clone
                    const origWrapper = origPre.querySelector(':scope > div');
                    if (origWrapper) {
                        const children = Array.from(origWrapper.children);
                        let codeBodyIdx = -1;
                        for (let i = 0; i < children.length; i++) {
                            if (children[i].tagName === 'DIV' && !children[i].querySelector('button')) {
                                codeBodyIdx = i;
                                origCodeEl = children[i];
                            }
                        }

                        // Use same positional index in clone
                        const cloneWrapper = clonePre.querySelector(':scope > div');
                        if (cloneWrapper && codeBodyIdx >= 0 && cloneWrapper.children[codeBodyIdx]) {
                            cloneCodeEl = cloneWrapper.children[codeBodyIdx];
                        }
                    }
                    if (!origCodeEl) origCodeEl = origPre;
                    if (!cloneCodeEl) cloneCodeEl = clonePre;
                }

                if (!origCodeEl || !cloneCodeEl) return;

                // ── Walk the ORIGINAL code element's DOM tree ──
                const codeCS = getComputedStyle(origCodeEl);
                const defaultColor = codeCS.color;
                const segments = [];

                function walkNode(node) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const text = node.textContent;
                        if (text.length === 0) return;
                        const parent = node.parentElement;
                        const color = parent ? getComputedStyle(parent).color : defaultColor;
                        const weight = parent ? getComputedStyle(parent).fontWeight : 'normal';
                        const fStyle = parent ? getComputedStyle(parent).fontStyle : 'normal';
                        // Track vertical position for line break detection
                        const top = parent ? parent.offsetTop : 0;
                        segments.push({ text, color, weight, fStyle, top });
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.tagName === 'BUTTON') return;
                        if (node.tagName === 'SVG' || node.tagName === 'svg') return;
                        for (const child of node.childNodes) {
                            walkNode(child);
                        }
                    }
                }
                walkNode(origCodeEl);

                if (segments.length === 0) return;

                // ── Detect line breaks via offsetTop changes ──
                // If text nodes don't contain \n but visual lines exist,
                // offsetTop will change between lines
                const rawText = segments.map(s => s.text).join('');
                const hasNativeNewlines = rawText.includes('\n');

                // ── Build HTML from segments ──
                let codeHTML = '';
                let prevTop = segments[0].top;
                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];

                    // Insert newline when vertical position changes (new visual line)
                    if (!hasNativeNewlines && i > 0 && seg.top !== prevTop && seg.top !== 0) {
                        codeHTML += '\n';
                    }
                    prevTop = seg.top;

                    const escaped = seg.text
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                    let styles = `color:${seg.color}`;
                    if (seg.weight !== '400' && seg.weight !== 'normal') {
                        styles += `;font-weight:${seg.weight}`;
                    }
                    if (seg.fStyle !== 'normal') {
                        styles += `;font-style:${seg.fStyle}`;
                    }
                    codeHTML += `<span style="${styles}">${escaped}</span>`;
                }

                // Replace the clone's code content with rebuilt HTML
                cloneCodeEl.innerHTML = codeHTML;
                cloneCodeEl.style.backgroundColor = codeCS.backgroundColor;
                cloneCodeEl.style.color = defaultColor;
                cloneCodeEl.style.fontFamily = "'Fira Code','Cascadia Code','Consolas',monospace";
                cloneCodeEl.style.fontSize = '13px';
                cloneCodeEl.style.lineHeight = '1.6';
                cloneCodeEl.style.whiteSpace = 'pre';
                cloneCodeEl.style.display = 'block';
                cloneCodeEl.style.padding = '12px';
                cloneCodeEl.style.overflowX = 'auto';
            });
        }

        // Capture user message images
        function captureImages(el) {
            const images = [];
            el.querySelectorAll('img').forEach(img => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth || img.width || 300;
                    canvas.height = img.naturalHeight || img.height || 200;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    images.push(canvas.toDataURL('image/png'));
                } catch { /* CORS */ }
            });
            return images;
        }

        // ── Site-specific interleaved capture ──
        if (site === 'chatgpt') {
            // ChatGPT groups turns in [data-message-author-role] elements
            const allTurns = document.querySelectorAll('[data-message-author-role]');
            allTurns.forEach(turn => {
                const role = turn.getAttribute('data-message-author-role');
                const clone = cleanClone(turn);
                if (role === 'user') {
                    const text = (clone.innerText || '').trim();
                    if (text) messages.push({ role: 'user', text, images: captureImages(turn) });
                } else if (role === 'assistant') {
                    const markdownEl = turn.querySelector('.markdown');
                    if (markdownEl) {
                        const mClone = cleanClone(markdownEl);
                        inlineCodeStyles(mClone, markdownEl);
                        messages.push({ role: 'assistant', text: (mClone.innerText || '').trim(), html: mClone.innerHTML });
                    }
                }
            });
        } else if (site === 'gemini') {
            const turns = document.querySelectorAll('user-query, model-response');
            turns.forEach(turn => {
                const clone = cleanClone(turn);
                if (turn.tagName.toLowerCase() === 'user-query') {
                    const text = (clone.innerText || '').trim();
                    if (text) messages.push({ role: 'user', text, images: captureImages(turn) });
                } else {
                    const md = turn.querySelector('.markdown');
                    if (md) {
                        const mClone = cleanClone(md);
                        inlineCodeStyles(mClone, md);
                        messages.push({ role: 'assistant', text: (mClone.innerText || '').trim(), html: mClone.innerHTML });
                    }
                }
            });
        } else if (site === 'claude') {
            const turns = document.querySelectorAll('[class*="human"], [class*="response"], .font-claude-message, .font-claude-response');
            turns.forEach(turn => {
                const clone = cleanClone(turn);
                const text = (clone.innerText || '').trim();
                if (!text) return;
                const isUser = turn.className.includes('human') || turn.getAttribute('data-message-author-role') === 'user';
                if (isUser) {
                    messages.push({ role: 'user', text, images: captureImages(turn) });
                } else {
                    inlineCodeStyles(clone, turn);
                    messages.push({ role: 'assistant', text, html: clone.innerHTML });
                }
            });
        } else if (site === 'deepseek') {
            // DeepSeek: alternate between user msgs and ds-markdown responses
            const userEls = document.querySelectorAll('[class*="user"]');
            const respEls = document.querySelectorAll('.ds-markdown');
            const maxLen = Math.max(userEls.length, respEls.length);
            for (let i = 0; i < maxLen; i++) {
                if (userEls[i]) {
                    const clone = cleanClone(userEls[i]);
                    const text = (clone.innerText || '').trim();
                    if (text) messages.push({ role: 'user', text, images: captureImages(userEls[i]) });
                }
                if (respEls[i]) {
                    const clone = cleanClone(respEls[i]);
                    inlineCodeStyles(clone, respEls[i]);
                    messages.push({ role: 'assistant', text: (clone.innerText || '').trim(), html: clone.innerHTML });
                }
            }
        } else {
            // Generic fallback (perplexity, grok, etc.): interleave by index
            let userEls = [], respEls = [];
            if (site === 'perplexity') { userEls = document.querySelectorAll('.col-start-2'); respEls = document.querySelectorAll('.prose'); }
            else if (site === 'grok') { userEls = document.querySelectorAll('[class*="message"][class*="user"]'); respEls = document.querySelectorAll('[class*="message"]:not([class*="user"])'); }
            const maxLen = Math.max(userEls.length, respEls.length);
            for (let i = 0; i < maxLen; i++) {
                if (userEls[i]) {
                    const clone = cleanClone(userEls[i]);
                    const text = (clone.innerText || '').trim();
                    if (text) messages.push({ role: 'user', text, images: captureImages(userEls[i]) });
                }
                if (respEls[i]) {
                    const clone = cleanClone(respEls[i]);
                    inlineCodeStyles(clone, respEls[i]);
                    messages.push({ role: 'assistant', text: (clone.innerText || '').trim(), html: clone.innerHTML });
                }
            }
        }

        // Capture chat title from the AI site
        let chatTitle = '';
        if (site === 'chatgpt') {
            const active = document.querySelector('nav a.bg-token-sidebar-surface-secondary, nav [class*="active"]');
            chatTitle = active?.textContent?.trim() || document.title.replace(' | ChatGPT', '').trim();
        } else if (site === 'gemini') {
            chatTitle = document.title.replace(' - Google Gemini', '').trim();
        } else if (site === 'perplexity') {
            chatTitle = document.title.replace(' - Perplexity', '').trim();
        } else if (site === 'grok') {
            chatTitle = document.title.replace(' - Grok', '').trim();
        } else if (site === 'claude') {
            chatTitle = document.title.replace(' - Claude', '').trim();
        } else if (site === 'deepseek') {
            chatTitle = document.title.replace(' - DeepSeek', '').trim();
        }
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (!chatTitle || chatTitle === 'ChatGPT' || chatTitle === 'New chat') {
            chatTitle = (firstUserMsg?.text || '').substring(0, 60).trim() || 'Chat Export';
        }

        // Detect model version
        let modelVersion = '';
        if (site === 'chatgpt') {
            const modelEl = document.querySelector('[class*="model"] button, [data-testid*="model"]');
            modelVersion = modelEl?.textContent?.trim() || '';
        }

        return {
            messages,
            timestamp: new Date().toISOString(),
            source: site,
            chatTitle,
            modelVersion
        };
    }

    function showRefreshBanner() {
        if (document.getElementById('llm-council-refresh-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'llm-council-refresh-banner';
        banner.innerHTML = `
            <div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:center;gap:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:llmSlideDown .3s ease-out">
                <span style="font-size:18px">🔄</span>
                <span><strong>LLM Council</strong> was just updated. Please <strong>refresh this page</strong> to continue using Export & Ask Council.</span>
                <button onclick="location.reload()" style="background:#fff;color:#4f46e5;border:none;padding:6px 16px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;white-space:nowrap">Refresh Now</button>
                <button onclick="this.closest('#llm-council-refresh-banner').remove()" style="background:transparent;border:1px solid rgba(255,255,255,0.4);color:#fff;padding:6px 12px;border-radius:6px;font-weight:500;cursor:pointer;font-size:13px">Dismiss</button>
            </div>
            <style>@keyframes llmSlideDown{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}</style>
        `;
        document.body.appendChild(banner);
    }

    function injectQuickCompareButtons() {
        try {
            const adapter = getAdapter();
            if (!adapter) return;

            const councilPrefs = window.__askCouncilPrefs || { enabled: true, color: '#8951d6', size: 'medium', position: 'bottom' };
            const exportPrefs = window.__exportBtnPrefs || { enabled: true, color: '#0ea5e9', size: 'medium', position: 'bottom' };

            // Find user messages based on the site
            let userMessageSelectors = [];
            if (adapter.id === 'chatgpt') {
                userMessageSelectors = ['[data-message-author-role="user"]'];
            } else if (adapter.id === 'gemini') {
                userMessageSelectors = ['user-query'];
            } else if (adapter.id === 'perplexity') {
                userMessageSelectors = ['.col-start-2'];
            } else if (adapter.id === 'grok') {
                userMessageSelectors = ['[class*="message"][class*="user"]'];
            }

            if (!userMessageSelectors.length) return;

            const msgs = document.querySelectorAll(userMessageSelectors.join(','));

            msgs.forEach(msg => {
                const promptText = (msg.innerText || msg.textContent || '').trim();
                if (!promptText) return;

                // Inject Ask Council button
                if (councilPrefs.enabled && !msg.querySelector('.llm-council-inline-btn')) {
                    const { btn, sz } = createStyledBtn(councilPrefs, 'llm-council-inline-btn');
                    btn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="${sz.icon}" height="${sz.icon}" fill="currentColor">
                        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                    </svg>
                    Ask Council
                `;
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            chrome.runtime.sendMessage({ action: 'open_dashboard', prompt: promptText });
                        } catch (err) {
                            showRefreshBanner();
                        }
                    });

                    if (councilPrefs.position === 'side') {
                        // Make the msg container flex so button sits beside the text
                        msg.style.display = 'flex';
                        msg.style.flexWrap = 'wrap';
                        msg.style.alignItems = 'flex-start';
                        msg.style.gap = '8px';
                        msg.appendChild(btn);
                    } else {
                        // Bottom: append as a block below the message
                        let btnRow = msg.querySelector('.llm-council-btn-row');
                        if (!btnRow) {
                            btnRow = document.createElement('div');
                            btnRow.className = 'llm-council-btn-row';
                            btnRow.style.cssText = 'display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;';
                            msg.appendChild(btnRow);
                        }
                        btnRow.appendChild(btn);
                    }
                }

                // Inject Export button
                if (exportPrefs.enabled && !msg.querySelector('.llm-council-export-btn')) {
                    const { btn: expBtn, sz: expSz } = createStyledBtn(exportPrefs, 'llm-council-export-btn');
                    expBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" width="${expSz.icon}" height="${expSz.icon}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Export
                `;
                    expBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            const chatData = captureEntireChat(adapter);
                            chrome.runtime.sendMessage({ action: 'open_export', data: chatData });
                        } catch (err) {
                            showRefreshBanner();
                        }
                    });

                    if (exportPrefs.position === 'side') {
                        msg.style.display = 'flex';
                        msg.style.flexWrap = 'wrap';
                        msg.style.alignItems = 'flex-start';
                        msg.style.gap = '8px';
                        msg.appendChild(expBtn);
                    } else {
                        let btnRow = msg.querySelector('.llm-council-btn-row');
                        if (!btnRow) {
                            btnRow = document.createElement('div');
                            btnRow.className = 'llm-council-btn-row';
                            btnRow.style.cssText = 'display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;';
                            msg.appendChild(btnRow);
                        }
                        btnRow.appendChild(expBtn);
                    }
                }
            });
        } catch (e) {
            // Extension context invalidated — silently ignore
            if (!e.message?.includes('Extension context invalidated')) console.warn('LLM Council:', e);
        }
    }

})(); 
