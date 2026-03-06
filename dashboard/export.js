import { MODELS } from '../utils/constants.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 0. Sync App Theme (Background)
    const { council_theme } = await chrome.storage.local.get('council_theme');
    const appTheme = council_theme || 'light';

    document.body.classList.remove('app-light', 'app-dark');
    document.body.classList.add(`app-${appTheme}`);

    // Set initial document theme
    const docWrapper = document.getElementById('export-document');
    docWrapper.classList.add('theme-light');

    document.querySelectorAll('[data-theme]').forEach(b => {
        b.classList.toggle('active', b.dataset.theme === 'light');
    });

    // 1. Get Data from storage (chunked to handle large data)
    let data;
    const meta = await chrome.storage.local.get('council_export_chunk_count');
    if (meta.council_export_chunk_count) {
        const count = meta.council_export_chunk_count;
        const keys = [];
        for (let i = 0; i < count; i++) keys.push(`council_export_chunk_${i}`);
        const chunks = await chrome.storage.local.get(keys);
        let jsonStr = '';
        for (let i = 0; i < count; i++) jsonStr += (chunks[`council_export_chunk_${i}`] || '');
        try { data = JSON.parse(jsonStr); } catch (e) { data = null; }
    } else {
        // Backward compat: try old single-key format
        const dataObj = await chrome.storage.local.get('council_export_data');
        data = dataObj.council_export_data;
    }

    if (!data) {
        document.getElementById('responses-vibe').innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                No export data found. Please run a prompt on the dashboard first.
            </div>`;
        return;
    }

    // 2. Render Data
    renderContent(data);

    // 3. Setup Interactivity
    setupToolbar();
    setupDockInteractions(data);
    setupContentListPopup(data);
});

function renderContent(data) {
    const container = document.getElementById('responses-vibe');
    let html = '';

    // Set the document title to chat title if available
    if (data.chatTitle) {
        const docTitle = document.getElementById('doc-title');
        if (docTitle) docTitle.textContent = data.chatTitle;
    }

    // AI source icons mapping
    const sourceIcons = {
        chatgpt: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.677l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
        gemini: '✨',
        perplexity: '🔍',
        grok: '🤖',
        claude: '🟤',
        deepseek: '🌊'
    };
    const sourceNames = {
        chatgpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity',
        grok: 'Grok', claude: 'Claude', deepseek: 'DeepSeek'
    };

    const sourceSite = data.source || 'unknown';
    const sourceIcon = sourceIcons[sourceSite] || '🤖';
    const sourceName = sourceNames[sourceSite] || sourceSite;
    const modelVer = data.modelVersion || '';
    const displayLabel = modelVer ? `${sourceName} ${modelVer}` : sourceName;

    // Check for new interleaved messages format vs legacy format
    const msgList = data.messages || [];

    // If legacy format (prompt + responses), convert to messages array
    if (!data.messages && data.prompt) {
        msgList.push({ role: 'user', text: data.prompt, images: data.promptImages || [] });
        if (data.responses) {
            data.responses.forEach(res => {
                msgList.push({ role: 'assistant', text: res.text, html: res.html, modelId: res.id });
            });
        }
    }

    if (msgList.length === 0) {
        html += `<div style="text-align: center; color: var(--text-muted);">No content to display.</div>`;
    }

    // Render each message in interleaved order
    msgList.forEach((msg, index) => {
        if (msg.role === 'user') {
            // User prompt bubble (right-aligned)
            let promptImagesHTML = '';
            if (msg.images && msg.images.length > 0) {
                const gridClass = msg.images.length >= 3 ? 'prompt-images-grid' : 'prompt-images-inline';
                promptImagesHTML = `<div class="${gridClass}">` +
                    msg.images.map(src => `<img src="${src}" class="prompt-img">`).join('') + '</div>';
            }

            html += `
                <div class="vibe-user-req selected" id="block-${index}">
                    <input type="checkbox" class="vibe-checkbox" data-id="${index}" checked>
                    <div class="vibe-user-header">
                        <span>You Asked</span>
                        <div class="vibe-avatar">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <circle cx="12" cy="8" r="4"/>
                                <path d="M5.5 21a6.5 6.5 0 0 1 13 0"/>
                            </svg>
                        </div>
                    </div>
                    ${promptImagesHTML}
                    <div class="vibe-prompt-bubble">${escapeHTML(msg.text)}</div>
                </div>
            `;
        } else {
            // AI response block — resolve per-message model info
            const msgModelId = msg.modelId || data.source || 'unknown';
            const cleanModelId = msgModelId.replace('judge-', '');
            const modelInfo = MODELS[cleanModelId];
            const isJudge = msgModelId.startsWith('judge-');
            const msgIcon = modelInfo ? modelInfo.icon : (sourceIcons[cleanModelId] || '🤖');
            const msgName = modelInfo ? modelInfo.name : (sourceNames[cleanModelId] || cleanModelId);
            const msgLabel = isJudge ? `Judge: ${msgName}` : msgName;

            let contentHTML;
            if (msg.html) {
                contentHTML = `<div class="rich-content">${msg.html}</div>`;
            } else {
                contentHTML = parseThinking(escapeHTML(msg.text));
            }

            html += `
                <div class="vibe-block selected" id="block-${index}">
                    <input type="checkbox" class="vibe-checkbox" data-id="${index}" checked>
                    <div class="vibe-header vibe-ai-header">
                        <div class="vibe-ai-icon">${msgIcon}</div>
                        <span class="vibe-name">${msgLabel}</span>
                        <span class="vibe-time" style="margin-left: auto; font-size: 12px; color: var(--text-muted);">${formatTimestamp(data.timestamp)}</span>
                    </div>
                    <div class="vibe-content">
                        ${contentHTML}
                    </div>
                </div>
            `;
        }

        // Add divider between messages (but not after the last one)
        if (index < msgList.length - 1) {
            html += '<div class="vibe-divider"></div>';
        }
    });

    container.innerHTML = html;
    updateCounter();

    // Apply saved image/code settings
    applyImageSettings();
    applyCodeSettings();

    // ── Post-process: Add per-image checkboxes in the left margin ──
    document.querySelectorAll('.vibe-block').forEach(block => {
        const rc = block.querySelector('.rich-content');
        if (!rc) return;
        const imgs = Array.from(rc.querySelectorAll('img'));
        if (imgs.length === 0) return;

        // Create a checkbox for each image
        const cbPairs = imgs.map(img => {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.className = 'img-cb';
            block.appendChild(cb);

            cb.addEventListener('change', () => {
                img.style.display = cb.checked ? '' : 'none';
                // Reposition checkboxes after hiding/showing an image
                requestAnimationFrame(positionAll);
            });

            return { img, cb };
        });

        // Position all checkboxes after images have loaded
        const positionAll = () => {
            // Don't reposition during export (src swaps trigger load events)
            if (window.__exportInProgress) return;

            const blockRect = block.getBoundingClientRect();

            // Build positions for ALL checkboxes.
            // For visible images: use actual position and save it.
            // For hidden images: use last saved position so they stay near their image.
            const allPositions = cbPairs.map(pair => {
                if (pair.img.style.display !== 'none') {
                    const imgRect = pair.img.getBoundingClientRect();
                    const imgTop = imgRect.top - blockRect.top;
                    pair._lastImgTop = imgTop; // save for when hidden
                    return { pair, imgTop };
                } else {
                    // Use last known position (from when image was visible)
                    return { pair, imgTop: pair._lastImgTop ?? 0 };
                }
            });

            // Group by approximate same top (within 20px = same row)
            allPositions.sort((a, b) => a.imgTop - b.imgTop);
            let currentRowTop = -Infinity;
            let rowIndex = 0;

            allPositions.forEach(pos => {
                if (Math.abs(pos.imgTop - currentRowTop) > 20) {
                    currentRowTop = pos.imgTop;
                    rowIndex = 0;
                }

                const top = pos.imgTop + (rowIndex * 26);
                pos.pair.cb.style.top = top + 'px';
                pos.pair.cb.style.display = '';
                rowIndex++;
            });
        };

        // Wait for all images in this block to load, then position
        let loadedCount = 0;
        const totalImgs = imgs.length;
        const onLoad = () => {
            loadedCount++;
            if (loadedCount >= totalImgs) {
                requestAnimationFrame(positionAll);
            }
        };

        imgs.forEach(img => {
            if (img.complete && img.naturalHeight > 0) {
                onLoad();
            } else {
                img.addEventListener('load', onLoad);
                img.addEventListener('error', onLoad);
            }
        });

        window.addEventListener('resize', positionAll);
    });

    // Setup checkbox listeners for visual fading
    document.querySelectorAll('.vibe-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const blockId = `block-${e.target.dataset.id}`;
            const block = document.getElementById(blockId);
            if (e.target.checked) {
                block.classList.add('selected');
            } else {
                block.classList.remove('selected');
            }
            updateCounter();
            checkAllStatus();
        });
    });
}

// Apply image settings from storage
function applyImageSettings() {
    chrome.storage.local.get(['exportImgSize', 'exportImgPosition', 'exportImgBorder', 'exportImgBorderColor', 'exportImgEnabled'], (prefs) => {
        const doc = document.getElementById('export-document');
        if (!doc) return;
        const size = prefs.exportImgSize || 'original';
        const position = prefs.exportImgPosition || 'inline';
        const border = prefs.exportImgBorder !== false;
        const borderColor = prefs.exportImgBorderColor || '#e5e7eb';
        const enabled = prefs.exportImgEnabled !== false;

        doc.dataset.imgSize = size;
        doc.dataset.imgPosition = position;
        doc.dataset.imgBorder = border ? 'on' : 'off';
        doc.style.setProperty('--img-border-color', borderColor);

        if (!enabled) {
            doc.classList.add('hide-images');
        } else {
            doc.classList.remove('hide-images');
        }
    });
}

// Apply code settings from storage
function applyCodeSettings() {
    chrome.storage.local.get(['exportCodeTheme', 'exportCodeSize', 'exportCodeBg', 'exportCodeCustomBg'], (prefs) => {
        const doc = document.getElementById('export-document');
        if (!doc) return;
        const theme = prefs.exportCodeTheme || 'default';
        const size = prefs.exportCodeSize || 'medium';
        const bg = prefs.exportCodeCustomBg || prefs.exportCodeBg || '#1e1e2e';

        doc.dataset.codeTheme = theme;
        doc.dataset.codeSize = size;
        doc.style.setProperty('--code-bg', bg);
    });
}

function parseThinking(text) {
    let formattedText = text;
    if (formattedText.includes('&lt;think&gt;')) {
        formattedText = formattedText.replace(/&lt;think&gt;/g, '<div class="vibe-think-block" style="border-left: 3px solid var(--border-color); padding-left: 12px; margin-bottom: 12px; color: var(--text-muted); font-style: italic;"><div style="font-weight: 600; font-size: 12px; text-transform: uppercase; margin-bottom: 4px;">Thinking Process</div>');
        formattedText = formattedText.replace(/&lt;\/think&gt;/g, '</div>');
    }
    return `<pre style="white-space: pre-wrap; font-family: inherit; margin: 0; padding: 0; border: none; background: transparent;">${formattedText}</pre>`;
}

function updateCounter() {
    const total = document.querySelectorAll('.vibe-checkbox').length;
    const checked = document.querySelectorAll('.vibe-checkbox:checked').length;
    document.getElementById('dock-counter').textContent = `${checked}/${total} items`;
}

function checkAllStatus() {
    const total = document.querySelectorAll('.vibe-checkbox').length;
    const checked = document.querySelectorAll('.vibe-checkbox:checked').length;
    document.getElementById('select-all').checked = total === checked;
}

function setupToolbar() {
    // Width
    document.querySelectorAll('[data-width]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-width]').forEach(b => b.classList.remove('active'));
            const target = e.currentTarget;
            target.classList.add('active');

            document.body.classList.remove('width-narrow', 'width-medium', 'width-full');
            document.body.classList.add(`width-${target.dataset.width}`);
        });
    });

    // Theme
    document.querySelectorAll('[data-theme]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-theme]').forEach(b => b.classList.remove('active'));
            const target = e.currentTarget;
            target.classList.add('active');

            const docWrapper = document.getElementById('export-document');
            const dock = document.getElementById('floating-dock');
            const themeClass = `theme-${target.dataset.theme}`;

            docWrapper.classList.remove('theme-light', 'theme-dark', 'theme-note');
            docWrapper.classList.add(themeClass);

            // Also apply theme to the dock so it inherits the theme variables
            dock.classList.remove('theme-light', 'theme-dark', 'theme-note');
            dock.classList.add(themeClass);
        });
    });

    // Submenu Toggles (More, Images, Code)
    const btnMore = document.getElementById('btn-more-theme');
    const btnImages = document.getElementById('btn-images');
    const btnCode = document.getElementById('btn-code');
    const header = document.querySelector('.export-header');
    const subMore = document.getElementById('toolbar-submenu');
    const subImages = document.getElementById('toolbar-submenu-images');
    const subCode = document.getElementById('toolbar-submenu-code');
    const allSubs = [subMore, subImages, subCode];

    function toggleSubmenu(target) {
        const isVisible = target.style.display !== 'none';
        allSubs.forEach(s => s.style.display = 'none');
        header.classList.remove('submenu-open');
        if (!isVisible) {
            target.style.display = '';
            header.classList.add('submenu-open');
        }
    }

    btnMore.addEventListener('click', () => toggleSubmenu(subMore));
    btnImages.addEventListener('click', () => toggleSubmenu(subImages));
    btnCode.addEventListener('click', () => toggleSubmenu(subCode));

    // ── Image Submenu Handlers ──
    const doc = document.getElementById('export-document');

    // Show/Hide images
    document.querySelectorAll('[data-img-enabled]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-img-enabled]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const enabled = btn.dataset.imgEnabled === 'true';
            if (enabled) { doc.classList.remove('hide-images'); } else { doc.classList.add('hide-images'); }
            chrome.storage.local.set({ exportImgEnabled: enabled });
        });
    });

    // Image Size 
    document.querySelectorAll('[data-img-size]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-img-size]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            doc.dataset.imgSize = btn.dataset.imgSize;
            chrome.storage.local.set({ exportImgSize: btn.dataset.imgSize });
        });
    });

    // Image Position
    document.querySelectorAll('[data-img-pos]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-img-pos]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            doc.dataset.imgPosition = btn.dataset.imgPos;
            chrome.storage.local.set({ exportImgPosition: btn.dataset.imgPos });
        });
    });

    // Image Border toggle
    document.querySelectorAll('[data-img-border]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-img-border]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            doc.dataset.imgBorder = btn.dataset.imgBorder;
            chrome.storage.local.set({ exportImgBorder: btn.dataset.imgBorder === 'on' });
        });
    });

    // Image Border Color
    const imgBorderColor = document.getElementById('img-border-color');
    if (imgBorderColor) {
        imgBorderColor.addEventListener('input', () => {
            doc.style.setProperty('--img-border-color', imgBorderColor.value);
            chrome.storage.local.set({ exportImgBorderColor: imgBorderColor.value });
        });
    }

    // ── Code Submenu Handlers ──

    // Syntax Theme
    document.querySelectorAll('[data-code-theme]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-code-theme]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            doc.dataset.codeTheme = btn.dataset.codeTheme;
            chrome.storage.local.set({ exportCodeTheme: btn.dataset.codeTheme });
        });
    });

    // Code Size
    document.querySelectorAll('[data-code-size]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-code-size]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            doc.dataset.codeSize = btn.dataset.codeSize;
            chrome.storage.local.set({ exportCodeSize: btn.dataset.codeSize });
        });
    });

    // Code Background Presets
    document.querySelectorAll('[data-code-bg]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-code-bg]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            doc.style.setProperty('--code-bg', btn.dataset.codeBg);
            chrome.storage.local.set({ exportCodeBg: btn.dataset.codeBg, exportCodeCustomBg: '' });
        });
    });

    // Code Custom Background Color
    const codeCustomBg = document.getElementById('code-custom-bg');
    if (codeCustomBg) {
        codeCustomBg.addEventListener('input', () => {
            document.querySelectorAll('[data-code-bg]').forEach(b => b.classList.remove('active'));
            doc.style.setProperty('--code-bg', codeCustomBg.value);
            chrome.storage.local.set({ exportCodeCustomBg: codeCustomBg.value });
        });
    }

    // ── Load saved Image/Code toolbar states ──
    chrome.storage.local.get([
        'exportImgEnabled', 'exportImgSize', 'exportImgPosition', 'exportImgBorder', 'exportImgBorderColor',
        'exportCodeTheme', 'exportCodeSize', 'exportCodeBg', 'exportCodeCustomBg'
    ], (prefs) => {
        // Image states
        if (prefs.exportImgEnabled === false) {
            document.querySelectorAll('[data-img-enabled]').forEach(b => {
                b.classList.toggle('active', b.dataset.imgEnabled === 'false');
            });
        }
        if (prefs.exportImgSize) {
            document.querySelectorAll('[data-img-size]').forEach(b => {
                b.classList.toggle('active', b.dataset.imgSize === prefs.exportImgSize);
            });
        }
        if (prefs.exportImgPosition) {
            document.querySelectorAll('[data-img-pos]').forEach(b => {
                b.classList.toggle('active', b.dataset.imgPos === prefs.exportImgPosition);
            });
        }
        if (prefs.exportImgBorder !== undefined) {
            const val = prefs.exportImgBorder ? 'on' : 'off';
            document.querySelectorAll('[data-img-border]').forEach(b => {
                b.classList.toggle('active', b.dataset.imgBorder === val);
            });
        }
        if (prefs.exportImgBorderColor && imgBorderColor) {
            imgBorderColor.value = prefs.exportImgBorderColor;
        }
        // Code states
        if (prefs.exportCodeTheme) {
            document.querySelectorAll('[data-code-theme]').forEach(b => {
                b.classList.toggle('active', b.dataset.codeTheme === prefs.exportCodeTheme);
            });
        }
        if (prefs.exportCodeSize) {
            document.querySelectorAll('[data-code-size]').forEach(b => {
                b.classList.toggle('active', b.dataset.codeSize === prefs.exportCodeSize);
            });
        }
        if (prefs.exportCodeBg) {
            document.querySelectorAll('[data-code-bg]').forEach(b => {
                b.classList.toggle('active', b.dataset.codeBg === prefs.exportCodeBg);
            });
        }
        if (prefs.exportCodeCustomBg && codeCustomBg) {
            codeCustomBg.value = prefs.exportCodeCustomBg;
        }
    });

    // Setup initial defaults for submenu options
    const docWrapper = document.getElementById('export-document');
    docWrapper.classList.add('fz-medium', 'table-solid', 'font-roboto');
    docWrapper.classList.add('hide-time'); // Default "No" selected in setup

    // Font Size
    document.querySelectorAll('[data-fz]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-fz]').forEach(b => b.classList.remove('active'));
            const target = e.currentTarget;
            target.classList.add('active');
            docWrapper.classList.remove('fz-small', 'fz-medium', 'fz-large');
            docWrapper.classList.add(`fz-${target.dataset.fz}`);
        });
    });

    // Table Style
    document.querySelectorAll('[data-table]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-table]').forEach(b => b.classList.remove('active'));
            const target = e.currentTarget;
            target.classList.add('active');
            docWrapper.classList.remove('table-solid', 'table-dashed', 'table-none');
            docWrapper.classList.add(`table-${target.dataset.table}`);
        });
    });

    // Show Chat Time
    document.querySelectorAll('[data-time]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('[data-time]').forEach(b => b.classList.remove('active'));
            const target = e.currentTarget;
            target.classList.add('active');
            if (target.dataset.time === 'yes') {
                docWrapper.classList.remove('hide-time');
            } else {
                docWrapper.classList.add('hide-time');
            }
        });
    });

    // Font Family
    const fontSelect = document.getElementById('font-select');
    if (fontSelect) {
        fontSelect.addEventListener('change', (e) => {
            docWrapper.classList.remove('font-roboto', 'font-inter', 'font-merriweather', 'font-system');
            docWrapper.classList.add(`font-${e.target.value.toLowerCase()}`);
        });
    }
}

function setupDockInteractions(data) {
    // Select All
    document.getElementById('select-all').addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        document.querySelectorAll('.vibe-checkbox').forEach(cb => {
            cb.checked = isChecked;
            const blockId = cb.dataset.id === 'prompt' ? 'block-prompt' : `block-${cb.dataset.id}`;
            const block = document.getElementById(blockId);
            if (isChecked) block.classList.add('selected');
            else block.classList.remove('selected');
        });
        updateCounter();
    });

    // Exports
    document.querySelectorAll('.export-chip').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const format = e.currentTarget.dataset.format;
            // Use prompt text for a content-related filename
            const promptText = data.prompt ? data.prompt.substring(0, 50).trim() : 'LLM_Council_Export';
            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const safeTitle = `${promptText.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase()}_${dateStr}`;

            if (format === 'pdf') {
                window.print();
            } else if (format === 'png') {
                if (typeof html2canvas === 'undefined') {
                    alert('PNG export library not found yet. Please check back later.');
                    return;
                }

                const dock = document.getElementById('floating-dock');
                dock.style.display = 'none'; // hide dock temporarily
                window.__exportInProgress = true; // Block checkbox repositioning

                // Pre-convert cross-origin images to data URLs via service worker (bypasses CORS)
                const exportDoc = document.getElementById('export-document');
                const imgs = exportDoc.querySelectorAll('img');
                const originalSrcs = [];

                await Promise.all(Array.from(imgs).map(async (img, idx) => {
                    originalSrcs[idx] = img.src;
                    if (!img.src || img.src.startsWith('data:') || img.src.startsWith('chrome-extension://')) return;
                    try {
                        const result = await chrome.runtime.sendMessage({ action: 'fetch_image', url: img.src });
                        if (result && result.success && result.dataUrl) {
                            img.src = result.dataUrl;
                        }
                    } catch (e) {
                        console.warn('Failed to convert image:', img.src, e);
                    }
                }));

                try {
                    const exportDocStyle = getComputedStyle(exportDoc);
                    const bgColor = exportDocStyle.getPropertyValue('--bg-main').trim() || exportDocStyle.getPropertyValue('--bg-card').trim() || '#ffffff';
                    const canvas = await html2canvas(exportDoc, {
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        logging: false,
                        backgroundColor: bgColor
                    });

                    const link = document.createElement('a');
                    link.download = `${safeTitle}.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                } catch (err) {
                    console.error('Failed to generate PNG:', err);
                    alert('Failed to generate PNG export.');
                } finally {
                    // Restore original image sources
                    imgs.forEach((img, idx) => {
                        if (originalSrcs[idx]) img.src = originalSrcs[idx];
                    });
                    window.__exportInProgress = false;
                    dock.style.display = 'flex'; // restore dock
                }

            } else if (format === 'md' || format === 'txt' || format === 'html') {
                const text = generateTextExport(data, format);
                downloadBlob(text, `${safeTitle}.${format}`, format === 'html' ? 'text/html' : 'text/plain');
            } else if (format === 'json') {
                const jsonStr = JSON.stringify(data, null, 2);
                downloadBlob(jsonStr, `${safeTitle}.json`, 'application/json');
            } else if (format === 'notion') {
                alert('Notion export is coming soon!');
            }
        });
    });

    // Copy to Clipboard handlers
    document.querySelectorAll('.copy-chip').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const copyType = e.currentTarget.dataset.copy;
            const originalText = e.currentTarget.textContent;

            try {
                if (copyType === 'image') {
                    if (typeof html2canvas === 'undefined') {
                        return;
                    }
                    const dock = document.getElementById('floating-dock');
                    dock.style.display = 'none';
                    window.__exportInProgress = true; // Block checkbox repositioning

                    // Pre-convert images to data URLs via service worker
                    const exportDoc = document.getElementById('export-document');
                    const imgs = exportDoc.querySelectorAll('img');
                    const originalSrcs = [];
                    await Promise.all(Array.from(imgs).map(async (img, idx) => {
                        originalSrcs[idx] = img.src;
                        if (!img.src || img.src.startsWith('data:') || img.src.startsWith('chrome-extension://')) return;
                        try {
                            const result = await chrome.runtime.sendMessage({ action: 'fetch_image', url: img.src });
                            if (result && result.success && result.dataUrl) {
                                img.src = result.dataUrl;
                            }
                        } catch (e) {
                            console.warn('Failed to convert image:', img.src, e);
                        }
                    }));

                    const exportDocStyle = getComputedStyle(exportDoc);
                    const bgColor = exportDocStyle.getPropertyValue('--bg-main').trim() || exportDocStyle.getPropertyValue('--bg-card').trim() || '#ffffff';
                    const canvas = await html2canvas(exportDoc, {
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        logging: false,
                        backgroundColor: bgColor
                    });

                    // Restore original sources
                    imgs.forEach((img, idx) => {
                        if (originalSrcs[idx]) img.src = originalSrcs[idx];
                    });
                    window.__exportInProgress = false;
                    dock.style.display = 'flex';

                    canvas.toBlob(async (blob) => {
                        try {
                            await navigator.clipboard.write([
                                new ClipboardItem({ 'image/png': blob })
                            ]);
                            showCopyFeedback(e.currentTarget, originalText);
                        } catch { /* clipboard not available */ }
                    }, 'image/png');
                } else if (copyType === 'md') {
                    const text = generateTextExport(data, 'md');
                    await navigator.clipboard.writeText(text);
                    showCopyFeedback(e.currentTarget, originalText);
                } else if (copyType === 'json') {
                    const jsonStr = JSON.stringify(data, null, 2);
                    await navigator.clipboard.writeText(jsonStr);
                    showCopyFeedback(e.currentTarget, originalText);
                } else if (copyType === 'txt') {
                    const text = generateTextExport(data, 'txt');
                    await navigator.clipboard.writeText(text);
                    showCopyFeedback(e.currentTarget, originalText);
                }
            } catch { /* silent fail */ }
        });
    });
}

function showCopyFeedback(btn, originalText) {
    btn.textContent = '✓';
    btn.style.background = '#22c55e';
    setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
    }, 1500);
}

function generateTextExport(data, format) {
    let output = '';
    const msgList = data.messages || [];

    // Build messages from legacy format if needed
    if (!data.messages && data.prompt) {
        msgList.push({ role: 'user', text: data.prompt });
        if (data.responses) {
            data.responses.forEach(res => {
                msgList.push({ role: 'assistant', text: res.text, id: res.id, modelId: res.id });
            });
        }
    }

    if (format === 'html') {
        const docEl = document.getElementById('export-document');
        const computedStyle = getComputedStyle(docEl);
        const fontSize = computedStyle.fontSize || '15px';
        const fontFamily = computedStyle.fontFamily || 'Roboto, sans-serif';
        const maxWidth = computedStyle.maxWidth || '850px';
        const bgColor = computedStyle.getPropertyValue('--bg-main').trim() || computedStyle.backgroundColor || '#ffffff';
        const textColor = computedStyle.getPropertyValue('--text-primary').trim() || computedStyle.color || '#1a1a1a';
        const imagesHidden = docEl.classList.contains('hide-images');
        output += `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"><title>Export</title><style>body { font-size: ${fontSize}; font-family: ${fontFamily}; line-height: 1.7; max-width: ${maxWidth}; margin: 0 auto; padding: 40px; background-color: ${bgColor}; color: ${textColor}; } img { max-width: 31%; height: auto; border-radius: 8px; vertical-align: top; margin: 4px; } pre { background: #1e1e2e; color: #cdd6f4; padding: 16px; border-radius: 8px; overflow-x: auto; } code { font-family: 'Fira Code', 'Consolas', monospace; }</style></head>\n<body>\n`;
    } else if (format === 'md') {
        output += `# ${data.chatTitle || 'LLM Council Export'}\n\n`;
    }

    // Check if images are hidden in the preview
    const imagesHidden = document.getElementById('export-document')?.classList.contains('hide-images');

    msgList.forEach((msg, index) => {
        const cb = document.querySelector(`.vibe-checkbox[data-id="${index}"]`);
        if (cb && !cb.checked) return;

        if (msg.role === 'user') {
            if (format === 'html') {
                output += `<h3>You Asked:</h3>\n<pre style="white-space: pre-wrap; font-size: inherit; font-family: inherit;">${escapeHTML(msg.text)}</pre>\n<hr>\n\n`;
            } else if (format === 'md') {
                output += `**You Asked:**\n> ${msg.text.replace(/\n/g, '\n> ')}\n\n---\n\n`;
            } else {
                output += `YOU ASKED:\n${msg.text}\n==============================\n\n`;
            }
        } else {
            // Resolve per-message model name
            const msgModelId = msg.modelId || data.source || '';
            const cleanId = msgModelId.replace('judge-', '');
            const mInfo = MODELS[cleanId];
            const isJudge = msgModelId.startsWith('judge-');
            const displayName = mInfo ? (isJudge ? `Judge: ${mInfo.name}` : mInfo.name)
                : (data.source ? (data.source.charAt(0).toUpperCase() + data.source.slice(1)) : 'AI');
            if (format === 'html') {
                let content = '';
                if (msg.html) {
                    content = msg.html;
                    // Strip images if "Show Images" is turned off
                    if (imagesHidden) {
                        const temp = document.createElement('div');
                        temp.innerHTML = content;
                        temp.querySelectorAll('img').forEach(img => img.remove());
                        // Also remove empty image containers
                        temp.querySelectorAll('[data-img-container]').forEach(c => {
                            if (c.querySelectorAll('img').length === 0) c.remove();
                        });
                        content = temp.innerHTML;
                    }
                } else {
                    content = `<pre style="white-space: pre-wrap;">${escapeHTML(msg.text)}</pre>`;
                }
                output += `<h3>${displayName}</h3>\n${content}\n<hr>\n\n`;
            } else if (format === 'md') {
                output += `## ${displayName}\n\n${msg.text}\n\n---\n\n`;
            } else {
                output += `${displayName.toUpperCase()}:\n${msg.text}\n------------------------------\n\n`;
            }
        }
    });

    if (format === 'html') output += `</body></html>`;
    return output;
}

function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function formatTimestamp(ts) {
    if (!ts) return 'Date unavailable';
    try {
        const d = new Date(ts);
        if (isNaN(d.getTime())) return 'Date unavailable';
        return d.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch {
        return 'Date unavailable';
    }
}

function setupContentListPopup(data) {
    const btnToggle = document.getElementById('btn-content-list');
    const popup = document.getElementById('content-list-popup');
    if (!btnToggle || !popup) return;

    // Build popup content
    function buildPopup() {
        let html = '';
        const msgList = data.messages || [];

        // If legacy format, build from prompt + responses
        if (!data.messages && data.prompt) {
            // Legacy prompt item
            const promptCb = document.querySelector('.vibe-checkbox[data-id="prompt"]');
            const promptChecked = promptCb?.checked ? 'checked' : '';
            const promptText = data.prompt.substring(0, 40);
            html += `<div class="content-list-item" data-target="prompt">
                <input type="checkbox" class="popup-cb" data-id="prompt" ${promptChecked}>
                <span class="item-icon">👤</span>
                <span class="item-label">${escapeHTML(promptText)}</span>
            </div>`;

            if (data.responses) {
                data.responses.forEach((res, index) => {
                    const modelInfo = MODELS[res.id.replace('judge-', '')] || { name: res.id, icon: '🤖' };
                    const isJudge = res.id.startsWith('judge-');
                    const displayName = isJudge ? `Judge: ${modelInfo.name}` : modelInfo.name;
                    const resCb = document.querySelector(`.vibe-checkbox[data-id="${index}"]`);
                    const resChecked = resCb?.checked ? 'checked' : '';

                    html += `<div class="content-list-item" data-target="${index}">
                        <input type="checkbox" class="popup-cb" data-id="${index}" ${resChecked}>
                        <span class="item-icon">${modelInfo.icon}</span>
                        <span class="item-label">${escapeHTML(displayName)}</span>
                    </div>`;
                });
            }
        } else {
            // Interleaved messages format
            msgList.forEach((msg, index) => {
                const cb = document.querySelector(`.vibe-checkbox[data-id="${index}"]`);
                const isChecked = cb?.checked ? 'checked' : '';

                let icon, label;
                if (msg.role === 'user') {
                    icon = '👤';
                    label = (msg.text || '').substring(0, 40);
                } else {
                    const mId = (msg.modelId || data.source || '').replace('judge-', '');
                    const mData = MODELS[mId];
                    const isJudge = (msg.modelId || '').startsWith('judge-');
                    icon = mData ? mData.icon : '🤖';
                    label = mData ? (isJudge ? `Judge: ${mData.name}` : mData.name)
                        : (data.source ? data.source.charAt(0).toUpperCase() + data.source.slice(1) : 'AI');
                }

                html += `<div class="content-list-item" data-target="${index}">
                    <input type="checkbox" class="popup-cb" data-id="${index}" ${isChecked}>
                    <span class="item-icon">${icon}</span>
                    <span class="item-label">${escapeHTML(label)}</span>
                </div>`;
            });
        }

        // Action buttons
        html += `<div class="content-list-actions">
            <button data-action="all">All</button>
            <button data-action="clear">Clear</button>
            <button data-action="prompts">Only Prompts</button>
            <button data-action="responses">Only Responses</button>
        </div>`;

        popup.innerHTML = html;

        // Attach checkbox sync listeners
        popup.querySelectorAll('.popup-cb').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = e.target.dataset.id;
                const mainCb = document.querySelector(`.vibe-checkbox[data-id="${id}"]`);
                if (mainCb) {
                    mainCb.checked = e.target.checked;
                    mainCb.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        });

        // Attach action button listeners
        popup.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                const allCbs = document.querySelectorAll('.vibe-checkbox');
                allCbs.forEach(cb => {
                    const parentBlock = cb.closest('.vibe-user-req, .vibe-block');
                    const isPrompt = parentBlock && parentBlock.classList.contains('vibe-user-req');
                    if (action === 'all') {
                        cb.checked = true;
                    } else if (action === 'clear') {
                        cb.checked = false;
                    } else if (action === 'prompts') {
                        cb.checked = isPrompt;
                    } else if (action === 'responses') {
                        cb.checked = !isPrompt;
                    }
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                });
                // Refresh popup checkboxes
                popup.querySelectorAll('.popup-cb').forEach(pcb => {
                    const mainCb = document.querySelector(`.vibe-checkbox[data-id="${pcb.dataset.id}"]`);
                    if (mainCb) pcb.checked = mainCb.checked;
                });
            });
        });
    }

    // Toggle popup
    btnToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popup.classList.contains('open')) {
            popup.classList.remove('open');
        } else {
            buildPopup();
            popup.classList.add('open');
        }
    });

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && e.target !== btnToggle && !btnToggle.contains(e.target)) {
            popup.classList.remove('open');
        }
    });
}
