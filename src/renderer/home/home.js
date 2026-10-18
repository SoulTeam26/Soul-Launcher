/**
 * SOUL LAUNCHER - PREMIUM HOME PAGE LOGIC (SPLIT VIEW)
 */

(async () => {
    const { soul } = window;

    // --- ELEMENTS ---
    const btnMin = document.getElementById('btn-min');
    const btnMax = document.getElementById('btn-max');
    const btnClose = document.getElementById('btn-close');

    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');

    const userTrigger = document.getElementById('user-trigger');
    const accDropdown = document.getElementById('acc-dropdown');
    const curUserImg = document.getElementById('cur-user-img');
    const curUserName = document.getElementById('cur-user-name');
    const curUserType = document.getElementById('cur-user-type');
    const accountList = document.getElementById('account-list');

    const btnPlay = document.getElementById('btn-play');
    const launchStatus = document.getElementById('launch-status');
    const heroName = document.getElementById('hero-name');

    const btnJavaSelect = document.getElementById('btn-java-select');
    const btnJavaSelectText = document.getElementById('btn-java-select-text');


    const overlays = {
        create: document.getElementById('overlay-create')
    };

    // --- STATE ---
    let currentAccount = null;
    let allAccounts = [];
    let instances = [];
    let selectedInstance = null;
    let soulVersionsCache = [];
    let kruthVersionsCache = [];

    // --- STAFF RANKS (mirrors Soul Web: Firebase `staff` + `role_badges`) ---
    const ROLE_BADGE_DEFAULTS = {
        'Owner': '#ef4444', 'Admin': '#3b82f6', 'Manager': '#a855f7', 'Moderator': '#22c55e',
        'Developer': '#f59e0b', 'Support': '#06b6d4', 'Staff': '#8C8680', 'Helper': '#84cc16', 'Trial Staff': '#71717a'
    };
    let _staffRoleByName = {};
    let _roleBadgeCustom = {};
    let _teamBase = [];
    let _staffExtra = {};
    function staffRoleFor(name) {
        const n = String(name || '').trim().toLowerCase();
        return (n && _staffRoleByName[n]) || '';
    }
    function roleBadgeBg(role) {
        const r = String(role || '').trim();
        if (!r) return null;
        if (_roleBadgeCustom[r] && _roleBadgeCustom[r].bg) return _roleBadgeCustom[r].bg;
        if (ROLE_BADGE_DEFAULTS[r]) return ROLE_BADGE_DEFAULTS[r];
        let h = 0;
        for (let i = 0; i < r.length; i++) h = (Math.imul(h, 31) + r.charCodeAt(i)) >>> 0;
        return 'hsl(' + (h % 360) + ',65%,42%)';
    }
    function roleBadgeFg(bg) {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(bg || '').trim());
        if (!m) return '#ffffff';
        const r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16);
        return ((r * 299 + g * 587 + b * 114) / 1000) > 150 ? '#121113' : '#ffffff';
    }
    function refreshHeroRank() {
        const el = document.getElementById('hero-char-rank');
        if (!el) return;
        const name = (currentAccount && currentAccount.name) ? currentAccount.name : '';
        const role = staffRoleFor(name);
        if (!role) {
            el.classList.add('hidden');
            el.textContent = '';
            return;
        }
        const bg = roleBadgeBg(role);
        el.style.background = bg;
        el.style.color = roleBadgeFg(bg);
        el.textContent = role;
        el.classList.remove('hidden');
    }
    let activeAddonType = 'mods'; // 'mods' | 'packs' | 'shaders' | 'worlds' | 'modpacks'
    // Maps the addon tab to the content type loadFiles() renders.
    // ('packs' -> 'resourcepacks', 'shaders' -> 'shaderpacks', 'worlds' -> 'worlds')
    let activeFilesType = 'mods';
    function syncActiveFilesType() {
        activeFilesType = activeAddonType === 'packs' ? 'resourcepacks'
            : activeAddonType === 'shaders' ? 'shaderpacks'
            : activeAddonType === 'worlds' ? 'worlds'
            : activeAddonType === 'modpacks' ? 'modpacks' : 'mods';
    }
    let activeVersionType = 'release';    // release | snapshot | beta | alpha
    let selectedNewInstLoader = 'vanilla';
    const FORGE_LOGO_DATA_URI = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="Forge">
            <rect x="7" y="8" width="18" height="10" rx="2" fill="#fb923c"/>
            <rect x="18" y="12" width="8" height="28" rx="3" fill="#f59e0b" transform="rotate(32 22 26)"/>
            <rect x="19" y="22" width="20" height="5" rx="2" fill="#7c2d12" transform="rotate(32 29 24.5)"/>
        </svg>
    `.trim())}`;

    const JAVA_MODES = [
        { key: 'auto', label: 'Auto' },
        { key: '8', label: 'Java 8' },
        { key: '17', label: 'Java 17' },
        { key: '21', label: 'Java 21' },
        { key: '25', label: 'Java 25' },
        { key: 'custom', label: 'Custom path...' }
    ];

    let selectedNewInstVersion = '';
    let selectedNewInstIconPath = '';
    let jarFilesToAdd = [];

    let skinViewer = null;
    let selectedSkin = null;
    let selectedCape = null;
    let selectedElytra = null;
    let selectedSkinModel = 'default'; // 'default' (classic) or 'slim'
    let currentSkinSource = 'https://minotar.net/skin/Steve';
    let nextUpdateTargetAt = null;
    let nextUpdateCountdownTimer = null;

    const LOADER_META = {
        vanilla: {
            label: 'Vanilla',
            icon: 'fa-cube',
            logo: 'https://img.icons8.com/color/48/minecraft-grass-cube.png',
            color: 'var(--accent)',
            subtitle: 'Clean Mojang release with a polished Soul setup.'
        },
        fabric: {
            label: 'Fabric',
            icon: 'fa-scroll',
            logo: 'https://raw.githubusercontent.com/fabricmc/fabricmc.net/master/assets/logo.png',
            color: '#fde047',
            subtitle: 'Modern Fabric instance with mod-ready support.'
        },
        forge: {
            label: 'Forge',
            icon: 'fa-hammer',
            logo: FORGE_LOGO_DATA_URI,
            color: '#fb923c',
            subtitle: 'Legacy Forge profile.'
        },
        soulclient: {
            label: 'Soul Client',
            icon: 'fa-crown',
            logo: '',
            color: '#fbbf24',
            subtitle: 'Soul Client Fabric instance.'
        },
        kruthclient: {
            label: 'Kruth Client',
            icon: 'fa-bolt',
            logo: 'https://kruthclient.github.io/resources/logo.png',
            color: '#a855f7',
            subtitle: 'Kruth Client Fabric instance.'
        }
    };
    const CREATABLE_LOADERS = new Set(['vanilla', 'fabric', 'forge', 'soulclient', 'kruthclient']);

    async function checkNewPosts() {
        const badge = document.getElementById('new-post-badge');
        if (!badge) return;
        badge.style.display = 'block';
    }

    function getLoaderMeta(loader) {
        return LOADER_META[loader] || LOADER_META.vanilla;
    }

    /* ── SKELETON HELPERS ────────────────────────── */
    const SKELETON_HTML = {
        versions: (n=8) => `<div class="skeleton-grid versions">${Array.from({length:n}).map(()=>`
            <div class="skeleton-card">
                <div class="skeleton skeleton-icon" style="width:44px;height:44px;"></div>
                <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
                    <div class="skeleton-text long" style="height:15px;"></div>
                    <div class="skeleton-text short" style="height:10px;"></div>
                </div>
                <div class="skeleton" style="width:18px;height:18px;"></div>
            </div>`).join('')}</div>`,
        instances: (n=6) => `<div class="skeleton-grid instances">${Array.from({length:n}).map(()=>`
            <div class="skeleton-card inst">
                <div class="skeleton sk-img"></div>
                <div class="skeleton-text long sk-line"></div>
                <div style="display:flex;gap:8px;"><div class="skeleton-text short" style="height:18px;flex:1;"></div><div class="skeleton-text short" style="height:18px;flex:1;"></div></div>
                <div style="display:flex;gap:8px;"><div class="skeleton" style="flex:1;height:42px;"></div><div class="skeleton" style="width:42px;height:42px;"></div><div class="skeleton" style="width:42px;height:42px;"></div></div>
            </div>`).join('')}</div>`,
        addons: (n=6) => `<div class="skeleton-mods-list">${Array.from({length:n}).map(()=>`
            <div class="skeleton-mods-row">
                <div class="skeleton" style="width:18px;height:18px;"></div>
                <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1;">
                    <div class="skeleton" style="width:46px;height:46px;flex-shrink:0;"></div>
                    <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
                        <div class="skeleton-text long" style="height:13px;"></div>
                        <div class="skeleton-text mid" style="height:11px;"></div>
                        <div class="skeleton-text short" style="height:10px;width:22%;"></div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;"><div class="skeleton" style="width:38px;height:38px;"></div><div class="skeleton" style="width:38px;height:38px;"></div></div>
            </div>`).join('')}</div>`,
        files: (n=8) => `<div style="border:2px solid var(--line-dim);background:var(--paper-2);box-shadow:5px 5px 0 var(--paper-dim);overflow:hidden;">
            ${Array.from({length:n}).map(()=>`
            <div class="skeleton-fm-row">
                <div style="display:flex;align-items:center;gap:10px;"><div class="skeleton" style="width:28px;height:28px;"></div><div class="skeleton-text long" style="height:12px;flex:1;"></div></div>
                <div class="skeleton-text short" style="height:10px;"></div>
                <div class="skeleton-text mid" style="height:10px;"></div>
                <div class="skeleton-text mid" style="height:10px;"></div>
                <div style="display:flex;gap:6px;"><div class="skeleton" style="width:34px;height:34px;"></div><div class="skeleton" style="width:34px;height:34px;"></div></div>
            </div>`).join('')}
        </div>`,
        skinHistory: (n=8) => `<div class="skeleton-history">${Array.from({length:n}).map(()=>`<div class="skeleton sk-tile"></div>`).join('')}</div>`,
        skinSearch: () => `<div class="skeleton-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">${Array.from({length:3}).map(()=>`
            <div class="skeleton-card" style="flex-direction:column;align-items:stretch;min-height:320px;padding:16px;">
                <div class="skeleton" style="height:180px;"></div>
                <div class="skeleton-text long" style="height:14px;"></div>
                <div class="skeleton-text mid" style="height:10px;"></div>
                <div class="skeleton" style="height:36px;"></div>
            </div>`).join('')}</div>`,
        modrinth: (n=5) => `<div class="skeleton-modrinth">${Array.from({length:n}).map(()=>` 
            <div class="skeleton-modrinth-row">
                <div class="skeleton" style="width:56px;height:56px;flex-shrink:0;"></div>
                <div style="flex:1;display:flex;flex-direction:column;gap:8px;justify-content:center;">
                    <div class="skeleton-text long" style="height:14px;width:58%;"></div>
                    <div class="skeleton-text long" style="height:11px;"></div>
                    <div style="display:flex;gap:6px;"><div class="skeleton-text short" style="height:10px;width:52px;"></div><div class="skeleton-text short" style="height:10px;width:52px;"></div></div>
                </div>
                <div class="skeleton" style="width:92px;height:36px;align-self:center;"></div>
            </div>`).join('')}</div>`, 
    };
    function showSkeleton(container, type, count) {
        if (!container) return;
        const fn = SKELETON_HTML[type];
        if (!fn) { container.innerHTML = '<div class="skeleton" style="height:120px;"></div>'; return; }
        container.innerHTML = fn(count);
    }

    function parseVersionParts(versionId) {
        const match = String(versionId || '').match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
        if (!match) return null;
        return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
    }

    function compareVersionIdsDesc(left, right) {
        const leftParts = parseVersionParts(left);
        const rightParts = parseVersionParts(right);

        if (leftParts && rightParts) {
            for (let i = 0; i < 3; i += 1) {
                if (leftParts[i] !== rightParts[i]) {
                    return rightParts[i] - leftParts[i];
                }
            }
            return 0;
        }

        if (leftParts) return -1;
        if (rightParts) return 1;

        return String(right).localeCompare(String(left), undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    }

    function buildReleaseChoices(versionIds) {
        return [...new Set((versionIds || []).filter(Boolean))]
            .sort(compareVersionIdsDesc)
            .map(version => ({ id: version, label: version }));
    }

    function getVanillaReleaseChoices(data) {
        return buildReleaseChoices(
            (data?.versions || [])
                .filter(v => v.type === 'release')
                .map(v => v.id)
        );
    }

    function isSupportedFabricGameVersion(versionId) {
        const parts = parseVersionParts(versionId);
        if (!parts) return false;
        // Accept all 1.x where x >= 14, plus future major versions
        if (parts[0] > 1) return true;
        return parts[0] === 1 && parts[1] >= 14;
    }

    function getFabricReleaseChoices(data) {
        return buildReleaseChoices(
            (data || [])
                .map(v => v?.version)
                .filter(isSupportedFabricGameVersion)
        );
    }

    function isSupportedForgeGameVersion(versionId) {
        const parts = parseVersionParts(versionId);
        if (!parts) return false;
        if (parts[0] > 1) return true;
        if (parts[0] < 1) return false;
        return parts[1] >= 8;
    }

    function getForgeReleaseChoices(data) {
        return buildReleaseChoices(
            (data || [])
                .map(v => v?.mcversion)
                .filter(isSupportedForgeGameVersion)
        );
    }

    function renderMemoryStat(ramValue) {
        const statMemory = document.getElementById('stat-memory');
        if (!statMemory) return;

        if (ramValue === null || ramValue === undefined || ramValue === '') {
            statMemory.innerHTML = `<i class="fa-solid fa-memory"></i> - RAM`;
            return;
        }

        const num = Number(ramValue);
        const formatted = Number.isFinite(num)
            ? (Number.isInteger(num) ? String(num) : num.toFixed(1).replace(/\.0$/, ''))
            : String(ramValue);

        statMemory.innerHTML = `<i class="fa-solid fa-memory"></i> ${formatted}G RAM`;
    }

    function renderModsStat(enabledCount) {
        const statMods = document.getElementById('hero-mod-count');
        if (!statMods) return;

        const count = Number(enabledCount) || 0;
        statMods.innerHTML = `<i class="fa-solid fa-puzzle-piece"></i> ${count} Mod${count !== 1 ? 's' : ''}`;
    }

    function formatCountdownUnit(value) {
        return String(Math.max(0, Number(value) || 0)).padStart(2, '0');
    }

    function getCountdownParts(targetAt) {
        const totalMs = Math.max(0, (Number(targetAt) || 0) - Date.now());
        const totalSeconds = Math.floor(totalMs / 1000);

        return {
            totalMs,
            days: Math.floor(totalSeconds / 86400),
            hours: Math.floor((totalSeconds % 86400) / 3600),
            minutes: Math.floor((totalSeconds % 3600) / 60),
            seconds: totalSeconds % 60
        };
    }

    function formatScheduledDate(targetAt) {
        if (!targetAt) return 'No update scheduled yet.';

        return new Date(targetAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        });
    }

    function buildCountdownMarkup(targetAt) {
        if (!targetAt) {
            return '<div class="update-countdown-empty">No update scheduled yet.</div>';
        }

        const parts = getCountdownParts(targetAt);
        const units = [
            ['days', parts.days],
            ['hours', parts.hours],
            ['min', parts.minutes],
            ['sec', parts.seconds]
        ];

        return units.map(([label, value]) => `
            <div class="update-countdown-cell">
                <span class="update-countdown-value">${formatCountdownUnit(value)}</span>
                <span class="update-countdown-label">${label}</span>
            </div>
        `).join('');
    }

    function setNextUpdateText(targetAt) {
        const settingsText = document.getElementById('settings-next-update-text');
        const postsText = document.getElementById('posts-next-update-text');
        const textNodes = [settingsText, postsText].filter(Boolean);

        if (!textNodes.length) return;

        if (!targetAt) {
            textNodes.forEach(node => {
                node.textContent = 'Waiting for an admin to schedule the next launcher update.';
            });
            return;
        }

        const isLive = targetAt <= Date.now();
        const scheduledText = formatScheduledDate(targetAt);
        const message = isLive
            ? `The scheduled update window is live now. Planned time: ${scheduledText}.`
            : `Scheduled for ${scheduledText}.`;

        textNodes.forEach(node => {
            node.textContent = message;
        });
    }

    function renderNextUpdateCountdown() {
        const grids = [
            document.getElementById('settings-update-countdown'),
            document.getElementById('posts-update-countdown')
        ].filter(Boolean);

        setNextUpdateText(nextUpdateTargetAt);

        if (!grids.length) return;

        const markup = buildCountdownMarkup(nextUpdateTargetAt);
        grids.forEach(grid => {
            grid.innerHTML = markup;
        });

        if (nextUpdateTargetAt && getCountdownParts(nextUpdateTargetAt).totalMs <= 0 && nextUpdateCountdownTimer) {
            clearInterval(nextUpdateCountdownTimer);
            nextUpdateCountdownTimer = null;
        }
    }

    function startNextUpdateCountdown(targetAt) {
        nextUpdateTargetAt = Number.isFinite(Number(targetAt)) && Number(targetAt) > 0
            ? Number(targetAt)
            : null;

        if (nextUpdateCountdownTimer) {
            clearInterval(nextUpdateCountdownTimer);
            nextUpdateCountdownTimer = null;
        }

        renderNextUpdateCountdown();

        if (nextUpdateTargetAt) {
            nextUpdateCountdownTimer = setInterval(renderNextUpdateCountdown, 1000);
        }
    }

    async function refreshSelectedModCount(changedInstance = selectedInstance) {
        if (!selectedInstance) return;
        if (changedInstance?.id && selectedInstance?.id && changedInstance.id !== selectedInstance.id) return;

        try {
            const mods = await soul.getMods(selectedInstance.name);
            const enabledCount = Array.isArray(mods)
                ? mods.filter(m => m.enabled !== false).length
                : 0;
            renderModsStat(enabledCount);
        } catch (_) {
            renderModsStat(0);
        }
    }

    function updateCreateLoaderVisual(loader = selectedNewInstLoader) {
        const safeLoader = CREATABLE_LOADERS.has(loader) ? loader : 'vanilla';
        const meta = getLoaderMeta(safeLoader);
        const iconEl = document.getElementById('create-inst-icon');
        const glyphEl = document.getElementById('create-inst-loader-glyph');
        const subEl = document.getElementById('create-inst-sub');

        if (iconEl) {
            iconEl.dataset.loader = safeLoader;
            // Use logo if available
            if (meta.logo) {
                iconEl.innerHTML = `<img src="${meta.logo}" class="create-inst-icon-img">`;
            } else {
                iconEl.innerHTML = `<i class="fa-solid ${meta.icon}"></i>`;
            }
        }

        if (glyphEl) {
            if (meta.logo) {
                glyphEl.innerHTML = `<img src="${meta.logo}" style="width:16px;height:16px;object-fit:contain;">`;
            } else {
                glyphEl.innerHTML = `<i class="fa-solid ${meta.icon}"></i>`;
            }
        }
        
        if (subEl) subEl.textContent = meta.subtitle;
        updateCreateIconPreview();
    }

    function compareVersions(a, b) {
        const pa = String(a).split('.').map(Number);
        const pb = String(b).split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const da = pa[i] || 0, db = pb[i] || 0;
            if (da !== db) return da - db;
        }
        return 0;
    }

    function toFileSrc(filePath) {
        if (!filePath) return '';
        const normalized = String(filePath).replace(/\\/g, '/');
        return encodeURI(normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`);
    }

    function getDefaultInstancePreviewSrc() {
        return '../../assets/icons/icon.png';
    }

    function updateCreateIconPreview() {
        const previewImg = document.querySelector('#new-inst-icon-preview img');
        const previewBadge = document.getElementById('new-inst-icon-badge');
        const previewLabel = document.getElementById('new-inst-icon-label');
        const meta = getLoaderMeta(selectedNewInstLoader);

        if (previewImg) {
            previewImg.src = selectedNewInstIconPath ? toFileSrc(selectedNewInstIconPath) : getDefaultInstancePreviewSrc();
        }

        if (previewBadge) {
            if (meta.logo) {
                previewBadge.innerHTML = `<img src="${meta.logo}" style="width:100%;height:100%;object-fit:contain;padding:2px;">`;
                previewBadge.style.background = 'transparent'; 
                previewBadge.style.padding = '0';
            } else {
                previewBadge.innerHTML = `<i class="fa-solid ${meta.icon}"></i>`;
                previewBadge.style.background = '';
                previewBadge.style.padding = '';
            }
        }

        if (previewLabel) {
            previewLabel.textContent = selectedNewInstIconPath
                ? `Selected ${String(selectedNewInstIconPath).split(/[\\/]/).pop()}`
                : 'Using the default Soul icon.';
        }
    }

    function getInstanceCardIconMarkup(inst, loaderMeta) {
        if (inst.iconDataUrl) {
            return `<img src="${inst.iconDataUrl}" alt="${inst.name} icon">`;
        }

        if (loaderMeta.logo) {
            return `
                <span class="inst-product-glyph">
                    <img src="${loaderMeta.logo}" alt="${loaderMeta.label}" onerror="this.style.display='none';var f=this.parentElement.querySelector('[data-glyph-fallback]');if(f)f.style.display='';">
                    <i class="fa-solid ${loaderMeta.icon}" data-glyph-fallback style="display:none;font-size:40px;color:${loaderMeta.color};"></i>
                </span>
            `;
        }

        return `
            <span class="inst-product-glyph">
                <i class="fa-solid ${loaderMeta.icon}" style="font-size: 32px; color: ${loaderMeta.color};"></i>
            </span>
        `;
    }

    // Global broken-image safety net: any <img> that fails to load falls back
    // to the bundled Soul icon once, then hides itself. Covers avatars, mod /
    // pack icons, skin tiles and remote loader logos (offline or dead URL).
    document.addEventListener('error', (e) => {
        const t = e.target;
        if (!t || t.tagName !== 'IMG') return;
        if (!t.dataset.imgFb) {
            t.dataset.imgFb = '1';
            t.src = '../../assets/icons/icon.png';
        } else {
            t.style.visibility = 'hidden';
        }
    }, true);

    // --- CONSOLE LOGGING ---
    const consoleLogQueue = [];
    let consoleFlushScheduled = false;
    let consoleHasRealOutput = false;
    const MAX_CONSOLE_LINES = 50000;
    let consoleScrollLocked = false;

    function flushConsoleQueue() {
        consoleFlushScheduled = false;
        const consoleBox = document.getElementById('console-output');
        if (!consoleBox || consoleLogQueue.length === 0) return;

        if (!consoleBox.dataset.hasOutput) {
            consoleBox.innerHTML = '';
            consoleBox.dataset.hasOutput = '1';
        }

        const fragment = document.createDocumentFragment();
        while (consoleLogQueue.length > 0) {
            const { msg, type } = consoleLogQueue.shift();
            const span = document.createElement('span');
            span.className = `log-${type}`;
            span.textContent = msg;
            fragment.appendChild(span);
        }

        consoleBox.appendChild(fragment);

        while (consoleBox.children.length > MAX_CONSOLE_LINES) {
            consoleBox.removeChild(consoleBox.firstChild);
        }

        if (!consoleScrollLocked) {
            consoleBox.scrollTop = consoleBox.scrollHeight;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const consoleBox = document.getElementById('console-output');
        if (!consoleBox) return;
        consoleBox.addEventListener('scroll', () => {
            const atBottom = consoleBox.scrollHeight - consoleBox.scrollTop - consoleBox.clientHeight < 50;
            consoleScrollLocked = !atBottom;
        });
    });

    function logToConsole(msg, type = 'info') {
        const consoleBox = document.getElementById('console-output');
        if (!consoleBox) return;

        const span = document.createElement('span');
        span.className = `log-${type}`;
        
        // Auto-detect type if not specified by prefix
        let finalType = type;
        if (msg.includes('[SUCCESS]') || msg.includes('complete') || msg.includes('Installed')) finalType = 'success';
        if (msg.includes('[ERROR]') || msg.includes('failed')) finalType = 'error';
        if (msg.includes('[WARNING]') || msg.includes('Repairing')) finalType = 'warning';
        if (msg.includes('[DEBUG]')) finalType = 'debug';
        if (msg.includes('[SYSTEM]')) finalType = 'system';
        if (msg.includes('[SOUL CLIENT]')) finalType = 'soulclient';
        if (msg.includes('[DOWNLOAD]')) finalType = 'download';
        if (msg.includes('[JAVA]')) finalType = 'java';
        if (msg.includes('[MCLC]')) finalType = 'mclc';
        
        consoleLogQueue.push({ msg, type: finalType });
        if (!consoleFlushScheduled) {
            consoleFlushScheduled = true;
            requestAnimationFrame(flushConsoleQueue);
        }
    }

    // Call this whenever a fresh launch begins, so the NEXT batch of logs
    // is allowed to clear the "Ready..." placeholder again.
    function resetConsoleForNewLaunch() {
        const consoleBox = document.getElementById('console-output');
        if (consoleBox) delete consoleBox.dataset.hasOutput;
        consoleLogQueue.length = 0;
        hideLaunchDiagnosis();
    }


    // --- CONSOLE UTILS ---
    function initConsoleUtils() {
        const btnCopyLogs     = document.getElementById('btn-copy-logs');
        const btnCopyErrors   = document.getElementById('btn-copy-errors');
        const btnCopyWarnings = document.getElementById('btn-copy-warnings');

        if (btnCopyLogs)     btnCopyLogs.onclick     = () => copyLogsToClipboard();
        if (btnCopyErrors)   btnCopyErrors.onclick   = () => copyLogsToClipboard('error');
        if (btnCopyWarnings) btnCopyWarnings.onclick = () => copyLogsToClipboard('warning');
        const btnDiagnostic = document.getElementById('btn-copy-diagnostic');
        if (btnDiagnostic) btnDiagnostic.onclick = copyDiagnosticReport;
        const btnCrashDoctor = document.getElementById('btn-crash-doctor');
        if (btnCrashDoctor) btnCrashDoctor.onclick = runCrashDoctor;
        const btnCdClose = document.getElementById('btn-cd-close');
        if (btnCdClose) btnCdClose.onclick = () => document.getElementById('crash-doctor-panel')?.classList.add('hidden');
    }

    function runCrashDoctor() {
        const panel = document.getElementById('crash-doctor-panel');
        if (!panel) return;
        panel.classList.add('hidden');
        if (!selectedInstance) {
            window.notifications.show('info', 'No selection', 'Select an instance to scan for crash reports.');
            switchView('instances');
            return;
        }
        window.notifications.show('info', 'Crash Doctor', `Scanning crash files for "${selectedInstance.name}"…`);
        document.getElementById('cd-title').textContent = 'Crash Doctor';
        document.getElementById('cd-summary').textContent = 'Looking through crash reports and the latest log…';
        document.getElementById('cd-steps').replaceChildren();
        document.getElementById('cd-suspects').classList.add('hidden');
        document.getElementById('cd-meta').textContent = '';
        panel.classList.remove('hidden');
        switchView('console');
        soul.scanInstanceCrashes(selectedInstance.name).then(renderCrashDoctor).catch(error => {
            window.notifications.show('error', 'Scan failed', error.message);
            document.getElementById('cd-summary').textContent = `Scan failed: ${error.message}`;
        });
    }

    function renderCrashDoctor(result) {
        const panel = document.getElementById('crash-doctor-panel');
        if (!panel) return;
        const diagnosis = result.classification || classifyLaunchFailure('');
        document.getElementById('cd-title').textContent = diagnosis.title;
        document.getElementById('cd-summary').textContent = diagnosis.summary;
        document.getElementById('cd-steps').replaceChildren(...(diagnosis.steps || []).map(step => {
            const item = document.createElement('li'); item.textContent = step; return item;
        }));

        const metaBits = [];
        if (result.crashReportCount > 0) {
            metaBits.push(`${result.crashReportCount} crash report${result.crashReportCount > 1 ? 's' : ''}${result.latestCrashReport ? ` (newest: ${result.latestCrashReport.file})` : ''}`);
        } else if (!result.hasLogs) {
            metaBits.push('No crash reports or logs found yet');
        }
        if (result.latestLogFile) metaBits.push(`log: ${result.latestLogFile}`);
        document.getElementById('cd-meta').textContent = metaBits.join(' • ') || 'No Minecraft logs recorded yet.';

        const suspectBox = document.getElementById('cd-suspects');
        const suspects = result.suspects || [];
        const culprit = result.culprit;
        const compact = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const culpritCompact = compact(culprit);
        const isCulprit = m => (culpritCompact && (compact(m.displayName).includes(culpritCompact) || compact(m.name).includes(culpritCompact)));
        const culpritTarget = suspects.find(isCulprit);
        if (culprit && (culpritTarget || !suspects.length)) {
            suspectBox.classList.remove('hidden');
            suspectBox.replaceChildren();
            const w = document.createElement('div');
            const lead = document.createElement('span');
            const culpritLabel = culprit.charAt(0).toUpperCase() + culprit.slice(1);
            lead.innerHTML = `<strong style="color:#fbbf24;">Likely culprit: ${culpritLabel}</strong> — replace it with the version matching this Minecraft version, or remove it.`;
            w.append(lead);
            const other = suspects.filter(m => !isCulprit(m));
            const line = document.createElement('div');
            line.style.marginTop = '6px';
            line.style.fontSize = '12px';
            line.textContent = other.length ? `Also checked against: ${other.map(mod => mod.displayName).join(', ')}.` : '';
            const disable = document.createElement('button');
            disable.className = 'console-action-btn';
            disable.textContent = 'Disable this mod';
            disable.style.marginTop = '8px';
            disable.onclick = async () => {
                try {
                    const target = culpritTarget || suspects.find(isCulprit);
                    if (target && target.enabled) await soul.toggleMod(selectedInstance.name, target.name, false);
                    window.notifications.show('success', 'Mod disabled', `${culpritLabel} was disabled. Relaunch to test.`);
                    loadFiles('mods', 'addon-list');
                } catch (error) {
                    window.notifications.show('error', 'Could not disable mod', error.message);
                }
            };
            w.append(line, disable);
            suspectBox.append(w);
        } else if (suspects.length) {
            suspectBox.classList.remove('hidden');
            suspectBox.replaceChildren();
            const text = document.createElement('span');
            text.textContent = `Possible mod${suspects.length > 1 ? 's' : ''} involved: ${suspects.map(mod => mod.displayName).join(', ')}. `;
            const disable = document.createElement('button');
            disable.className = 'console-action-btn';
            disable.textContent = 'Disable suggested mods';
            disable.onclick = async () => {
                try {
                    for (const mod of suspects.filter(mod => mod.enabled)) await soul.toggleMod(selectedInstance.name, mod.name, false);
                    window.notifications.show('success', 'Recovery profile applied', 'Suggested mods were disabled. Try launching again.');
                    loadFiles('mods', 'addon-list');
                } catch (error) {
                    window.notifications.show('error', 'Could not disable mods', error.message);
                }
            };
            suspectBox.append(text, disable);
        } else if (result.hasModError) {
            suspectBox.classList.remove('hidden');
            suspectBox.replaceChildren();
            const text = document.createElement('span');
            text.textContent = 'A mod-related error was detected but no specific mod matched. Temporarily disable recently added mods to isolate it.';
            suspectBox.append(text);
        } else {
            suspectBox.classList.add('hidden');
            suspectBox.textContent = '';
        }

        document.getElementById('btn-cd-copy').onclick = () => copyCrashDoctorReport(result);
        panel.classList.remove('hidden');
    }

    function copyCrashDoctorReport(result) {
        const diagnosis = result.classification || {};
        const lines = [
            'Soul Launcher Crash Doctor Report',
            `Instance: ${result.instanceName}`,
            `Diagnosis: ${diagnosis.title || 'Minecraft crashed'}`,
            '',
            (diagnosis.summary || '').split('\n').join('\n'),
            '',
            ...(diagnosis.steps || []).map(s => `- ${s}`),
            ''
        ];
        if (result.crashReportCount > 0) lines.push(`Crash reports: ${result.crashReportCount}${result.latestCrashReport ? ` (newest: ${result.latestCrashReport.file})` : ''}`);
        if (result.culprit) lines.push(`Likely culprit: ${result.culprit}`);
        if (result.latestLogFile) lines.push(`Latest log: ${result.latestLogFile}`);
        if (result.latestLogTail) {
            lines.push('', '--- Latest log (tail) ---', result.latestLogTail);
        }
        navigator.clipboard.writeText(lines.join('\n'));
        window.notifications.show('success', 'Copied', 'Crash Doctor report copied to clipboard.');
    }

    function copyLogsToClipboard(filter = null) {
        const consoleBox = document.getElementById('console-output');
        if (!consoleBox) return;
        const logs = Array.from(consoleBox.querySelectorAll('span'));
        let text = '';
        logs.forEach(span => {
            if (!filter || span.className.includes(filter)) {
                text += span.textContent + '\n';
            }
        });
        if (text.trim()) {
            navigator.clipboard.writeText(text);
            const label = filter ? filter.charAt(0).toUpperCase() + filter.slice(1) : 'All logs';
            window.notifications.show('success', 'Copied', `${label} copied to clipboard.`);
        } else {
            window.notifications.show('info', 'No Content', `No ${filter || 'logs'} found to copy.`);
        }
    }

    let lastLaunchDiagnosis = null;

    function classifyLaunchFailure(message, rawLogs = '') {
        const text = `${message || ''}\n${rawLogs || ''}`.toLowerCase();
        if (/java not found|java\.exe|could not find java|no java executable/.test(text)) {
            return { title: 'Java needs attention', summary: 'Soul could not find a usable Java installation for this Minecraft version.', steps: ['Open Settings and choose Auto Java, or select a valid Java executable.', 'Use the built-in Java download option if Java is not installed.'] };
        }
        if (/outofmemory|out of memory|could not reserve enough space|java heap space/.test(text)) {
            return { title: 'Not enough memory', summary: 'Minecraft ran out of memory or could not reserve the amount assigned to it.', steps: ['Lower the RAM value in Settings and close memory-heavy programs.', 'For large modpacks, ensure your computer has enough free system memory.'] };
        }
        if (/mixin|mod resolution|failed to load mod|incompatible mod|requires .*minecraft|requires .*fabric|requires .*forge/.test(text)) {
            return { title: 'A mod is incompatible', summary: 'The game reported a mod-loading or dependency conflict.', steps: ['Use Mod Manager to update the listed mod and its dependencies.', 'If the issue began after an install, disable the newest mod and try again.', 'Check that every mod matches this instance’s Minecraft version and loader.'] };
        }
        if (/invalid or corrupt jar|corrupt client jar|zip|central directory/.test(text)) {
            return { title: 'A downloaded file is damaged', summary: 'One of the game or mod archives could not be read correctly.', steps: ['Launch again so Soul can re-download it.', 'If it repeats, remove the newest mod or use the repair action from the instance.'] };
        }
        if (/authentication|token|login|xbox/.test(text)) {
            return { title: 'Sign-in needs refreshing', summary: 'Your Microsoft authentication session could not be used.', steps: ['Sign out and sign in again from the account menu.', 'Confirm that the account owns Minecraft: Java Edition.'] };
        }
        return { title: 'Minecraft could not start', summary: 'Soul saved the relevant logs below. The diagnostic report can be shared for support.', steps: ['Try launching once more after checking your Java and selected instance.', 'If it still fails, use Copy Diagnostic Report and include it with a support request.'] };
    }

    async function showLaunchDiagnosis(message, instance) {
        const consoleBox = document.getElementById('console-output');
        const rawLogs = Array.from(consoleBox?.querySelectorAll('span') || []).map(span => span.textContent).join('\n');
        const diagnosis = classifyLaunchFailure(message, rawLogs);
        let suspects = [];
        if (instance?.name && soul.analyzeModCrash) {
            try {
                const analysis = await soul.analyzeModCrash(instance.name, rawLogs);
                suspects = analysis.suspects || [];
                if (analysis.hasModError && suspects.length === 0) diagnosis.steps.unshift('A mod-related error was detected; temporarily disable recently added mods to isolate it.');
            } catch (_) {}
        }
        lastLaunchDiagnosis = { ...diagnosis, message, instance, rawLogs, suspects };
        const panel = document.getElementById('launch-diagnosis');
        if (!panel) return;
        document.getElementById('diagnosis-title').textContent = diagnosis.title;
        document.getElementById('diagnosis-summary').textContent = diagnosis.summary;
        document.getElementById('diagnosis-steps').replaceChildren(...diagnosis.steps.map(step => {
            const item = document.createElement('li'); item.textContent = step; return item;
        }));
        const suspectBox = document.getElementById('diagnosis-suspects');
        if (suspects.length) {
            suspectBox.classList.remove('hidden');
            suspectBox.replaceChildren();
            const text = document.createElement('span');
            text.textContent = `Possible mod${suspects.length > 1 ? 's' : ''} involved: ${suspects.map(mod => mod.displayName).join(', ')}. `;
            const disable = document.createElement('button');
            disable.className = 'console-action-btn';
            disable.textContent = 'Disable suggested mods';
            disable.onclick = async () => {
                try {
                    for (const mod of suspects.filter(mod => mod.enabled)) await soul.toggleMod(instance.name, mod.name, false);
                    window.notifications.show('success', 'Recovery profile applied', 'Suggested mods were disabled. Try launching again.');
                    loadFiles('mods', 'addon-list');
                } catch (error) {
                    window.notifications.show('error', 'Could not disable mods', error.message);
                }
            };
            suspectBox.append(text, disable);
        } else {
            suspectBox.classList.add('hidden');
            suspectBox.textContent = '';
        }
        panel.classList.remove('hidden');
        switchView('console');
    }

    function hideLaunchDiagnosis() {
        document.getElementById('launch-diagnosis')?.classList.add('hidden');
        lastLaunchDiagnosis = null;
    }

    function copyDiagnosticReport() {
        if (!lastLaunchDiagnosis) return copyLogsToClipboard();
        const d = lastLaunchDiagnosis;
        const report = [
            'Soul Launcher Diagnostic Report',
            `Issue: ${d.title}`,
            `Instance: ${d.instance?.name || 'Unknown'} (${d.instance?.mcversion || d.instance?.version || 'Unknown'} / ${d.instance?.loader || 'vanilla'})`,
            `Error: ${d.message || 'Unknown'}`,
            d.suspects.length ? `Possible mod suspects: ${d.suspects.map(mod => mod.name).join(', ')}` : '',
            '', 'Raw logs:', d.rawLogs
        ].filter(Boolean).join('\n');
        navigator.clipboard.writeText(report);
        window.notifications.show('success', 'Diagnostic copied', 'A support-ready diagnostic report is on your clipboard.');
    }

    // --- FIREBASE (POSTS) ---
    // Isolated so any Firebase SDK load failure can't crash the rest of the app.
    function initFirebase() {
        if (typeof firebase === 'undefined') return; // SDK didn't load — skip silently
        const firebaseConfig = {
            apiKey: "AIzaSyCAalZXTgdIg58oip1Ang5CJVPRdp9YzzQ",
            authDomain: "soul-backend.firebaseapp.com",
            databaseURL: "https://soul-backend-default-rtdb.firebaseio.com",
            projectId: "soul-backend",
            storageBucket: "soul-backend.firebasestorage.app",
            messagingSenderId: "553383169433",
            appId: "1:553383169433:web:03aa34c90ebda216169708"
        };
        try {
            if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
            logToConsole('[FIREBASE] Connected to Realtime Database.');

            // --- PRESENCE SYSTEM ---
            const db = firebase.database();
            const presenceRef = db.ref('presence').push();
            // Remove user when they disconnect (close app)
            presenceRef.onDisconnect().remove();
            // Set user as online
            presenceRef.set(true);

            // Sync current user to Firebase for Admin Panel
            if (currentAccount) {
                db.ref(`users/${currentAccount.id}`).update({
                    id: currentAccount.id,
                    name: currentAccount.name,
                    type: currentAccount.type,
                    os: typeof process !== 'undefined' ? process.platform : 'unknown',
                    version: "1.0.7",
                    lastSeen: Date.now()
                });
            }

            // --- GLOBAL ALERTS ---
            db.ref('alerts').on('value', snapshot => {
                const data = snapshot.val();
                if (data && data.timestamp > (Date.now() - 60000)) { // Only show if alert is newer than 1 min
                    if (window.notifications) {
                        window.notifications.show(data.type, data.title, data.message);
                    }
                }
            });

            db.ref('launcher_meta/nextUpdate').on('value', snapshot => {
                const data = snapshot.val();
                const targetAt = Number(data?.targetAt);
                startNextUpdateCountdown(Number.isFinite(targetAt) ? targetAt : null);
            });

            // --- STAFF RANKS (same admin database as Soul Web) ---
            try {
                const combineRanks = () => {
                    _staffRoleByName = {};
                    (_teamBase || []).forEach(m => {
                        if (m && m.name) _staffRoleByName[String(m.name).toLowerCase()] = m.role || 'Staff';
                        if (m && m.mcname) _staffRoleByName[String(m.mcname).toLowerCase()] = m.role || 'Staff';
                    });
                    Object.values(_staffExtra || {}).forEach(s => {
                        if (!s || s.approved === false) return;
                        if (s.username) _staffRoleByName[String(s.username).toLowerCase()] = s.role || 'Staff';
                        if (s.mcname) _staffRoleByName[String(s.mcname).toLowerCase()] = s.role || 'Staff';
                    });
                    refreshHeroRank();
                };
                db.ref('team').on('value', snapshot => {
                    const data = snapshot.val() || {};
                    _teamBase = Object.entries(data).map(([k, m]) => ({ _teamKey: k, ...(m || {}) }));
                    combineRanks();
                });
                db.ref('staff').on('value', snapshot => {
                    _staffExtra = snapshot.val() || {};
                    combineRanks();
                });
                db.ref('role_badges').on('value', snapshot => {                    _roleBadgeCustom = snapshot.val() || {};
                    refreshHeroRank();
                });
            } catch (e) { console.warn('[RANKS] web db sync failed:', e); }

            // --- SIDEBAR ADS ---
            db.ref('ads').on('value', snapshot => {
                const data = snapshot.val();
                const now = Date.now();
                const slots = ['ad-slot-0', 'ad-slot-1', 'ad-slot-2'];
                let ads = data ? Object.values(data) : [];
                // Filter non-expired, sort newest first
                ads = ads.filter(ad => {
                    if (!ad.durationDays || ad.durationDays <= 0) return true;
                    const expiresAt = (ad.createdAt || now) + ad.durationDays * 86400000;
                    return now < expiresAt;
                }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

                slots.forEach((id, i) => {
                    const slot = document.getElementById(id);
                    if (!slot) return;
                    const ad = ads[i];
                    if (ad) {
                        slot.style.display = 'block';
                        slot.innerHTML = `<img src="${ad.image}" alt="Ad" onerror="this.closest('.ad-slot').style.display='none'">`;
                        slot.onclick = () => { if (ad.redirect) soul.openExternal(ad.redirect); };
                    } else {
                        slot.style.display = 'none';
                        slot.onclick = null;
                    }
                });
            });

            // --- SOUL CLIENT VERSIONS ---
            db.ref('soul_versions').on('value', snapshot => {
                const data = snapshot.val();
                soulVersionsCache = data ? Object.entries(data).map(([key, v]) => ({ key, ...v })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) : [];
                checkSoulClientUpdates();
            });

            // --- KRUTH CLIENT VERSIONS ---
            db.ref('kruth_versions').on('value', snapshot => {
                const data = snapshot.val();
                kruthVersionsCache = data ? Object.entries(data).map(([key, v]) => ({ key, ...v })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) : [];
                checkKruthClientUpdates();
            });

            // --- PARTNERED SERVERS ---
            loadPartneredServers(db);
        } catch (e) {
            console.warn('[Firebase] Init failed (non-fatal):', e);
        }
    }

    async function loadPartneredServers(db) {
        const container = document.getElementById('partnered-servers-list');
        const totalEl = document.getElementById('ps-total-online');
        if (!container) return;
        try {
            const snapshot = await db.ref('partneredServers').once('value');
            const data = snapshot.val();
            if (!data) {
                container.classList.remove('has-servers');
                container.innerHTML = 'No partnered servers available';
                if (totalEl) totalEl.textContent = '';
                return;
            }
            const servers = Object.values(data).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            if (servers.length === 0) {
                container.classList.remove('has-servers');
                container.innerHTML = 'No partnered servers available';
                if (totalEl) totalEl.textContent = '';
                return;
            }
            container.classList.add('has-servers');
            container.innerHTML = servers.map(s => `
                <div class="ps-card-home" data-ip="${s.ip}">
                    <img src="${s.icon || `https://api.mcsrvstat.us/icon/${encodeURIComponent(s.ip)}`}" alt="" onerror="this.src='../../assets/icons/icon.png'">
                    <div class="ps-card-info">
                        <div class="ps-card-name">${s.name}</div>
                        <div class="ps-card-ip">${s.desc || s.ip}</div>
                    </div>
                    <div class="ps-card-players" id="ps-players-${s.ip.replace(/[^a-zA-Z0-9]/g, '-')}">...</div>
                    <button class="ps-card-join" onclick="launchAndJoin('${s.ip}')">Join</button>
                </div>
            `).join('');

            // Fetch live player counts
            let totalOnline = 0;
            await Promise.all(servers.map(async s => {
                const elId = `ps-players-${s.ip.replace(/[^a-zA-Z0-9]/g, '-')}`;
                const el = document.getElementById(elId);
                try {
                    const res = await fetch(`https://api.mcsrvstat.us/2/${encodeURIComponent(s.ip)}`);
                    const json = await res.json();
                    if (json.online) {
                        const online = json.players?.online ?? '?';
                        const max = json.players?.max ?? '?';
                        if (el) el.textContent = `${online}/${max}`;
                        if (typeof online === 'number') totalOnline += online;
                    } else {
                        if (el) el.textContent = 'Offline';
                    }
                } catch {
                    if (el) el.textContent = 'Error';
                }
            }));
            if (totalEl) totalEl.textContent = totalOnline > 0 ? `${totalOnline} online` : '';
        } catch (e) {
            console.warn('[Partnered Servers] Failed to load:', e);
        }
    }

    async function checkSoulClientUpdates() {
        if (!Array.isArray(soulVersionsCache) || soulVersionsCache.length === 0) return;
        if (!instances || instances.length === 0) {
            try { instances = await soul.getInstances(); } catch (_) { return; }
        }
        const soulInstances = instances.filter(i => i.type === 'soulclient');
        if (soulInstances.length === 0) return;
        for (const inst of soulInstances) {
            const mcVer = inst.mcversion || inst.version;
            if (!mcVer) continue;
            const latestVer = soulVersionsCache.filter(sv => sv.mcVersion === mcVer).sort((a, b) => (b.versionCode || 0) - (a.versionCode || 0))[0];
            if (!latestVer || !latestVer.downloadUrl) continue;
            const currentCode = inst.soulVersionCode || 0;
            if ((latestVer.versionCode || 0) > currentCode) {
                logToConsole(`[SOUL CLIENT] Update found for "${inst.name}": ${latestVer.name} (v${latestVer.versionCode || '?'})`);
                const filename = latestVer.downloadUrl.split('/').pop().split('?')[0] || 'soulclient-mod.jar';
                try {
                    // Keep the known-good mod until the replacement is fully downloaded and validated.
                    const oldFilename = inst.soulModFilename;
                    await soul.downloadUrlToInstance(latestVer.downloadUrl, inst.name, 'mods', filename);
                    if (oldFilename && oldFilename !== filename) {
                        try { await soul.deleteMod(inst.name, oldFilename); } catch (_) {}
                    }
                    await soul.soulclientDownloadDeps(inst.name, mcVer);
                    await soul.setInstanceConfigField(inst.name, 'soulVersionCode', latestVer.versionCode || 0);
                    await soul.setInstanceConfigField(inst.name, 'soulModFilename', filename);
                    logToConsole(`[SOUL CLIENT] Updated "${inst.name}" to ${latestVer.name}`);
                    window.notifications.show('success', 'Soul Client Updated', `"${inst.name}" updated to ${latestVer.name}`);
                } catch (e) {
                    console.warn('[SOUL CLIENT] Auto-update failed:', e);
                    logToConsole(`[SOUL CLIENT] Auto-update failed: ${e.message}`);
                    window.notifications.show('error', 'Soul Client Update Failed', e.message || 'The existing client mod was kept unchanged.');
                }
            }
        }
    }

    // Modpack install picker: version select + "Install with Soul Client"
    // option in one popup (Create-Instance style). A new instance is created.
    let mpPicker = null; // { projectId, title, versions, selectedId }

    function mpSelectedVersion() {
        if (!mpPicker) return null;
        return (mpPicker.versions || []).find(v => v.id === mpPicker.selectedId) || null;
    }

    function mpSoulSupportFor(version) {
        // { supported, label, reason } — Soul Client mod is Fabric-only.
        if (!version) return { supported: false, label: '', reason: 'Select a version first.' };
        const loaders = (version.loaders || []).map(l => String(l).toLowerCase());
        if (loaders.length && !loaders.includes('fabric')) {
            return { supported: false, label: '', reason: `This release is ${loaders.join('/')} — Soul Client needs a Fabric pack.` };
        }
        const gv = version.game_versions || [];
        if (!Array.isArray(soulVersionsCache) || !soulVersionsCache.length) {
            return { supported: false, label: '', reason: 'Soul version list not loaded yet.' };
        }
        const hit = soulVersionsCache
            .filter(sv => sv.downloadUrl && gv.includes(sv.mcVersion))
            .sort((a, b) => (b.versionCode || 0) - (a.versionCode || 0))[0];
        if (!hit) return { supported: false, label: '', reason: `Soul Client doesn't support ${gv.slice(0, 3).join(', ') || 'this version'} yet.` };
        return { supported: true, label: hit.name || `v${hit.versionCode || '?'}`, reason: `Soul Client ${hit.name || `v${hit.versionCode || '?'}`} supports this release.`, soul: hit };
    }

    function mpRefreshSoulRow() {
        const check = document.getElementById('mp-soul-check');
        const status = document.getElementById('mp-soul-status');
        if (!check || !status) return;
        const sup = mpSoulSupportFor(mpSelectedVersion());
        check.disabled = !sup.supported;
        if (!sup.supported && check.checked) check.checked = false;
        status.textContent = sup.reason;
    }

    function mpRenderRows(filter = '') {
        const list = document.getElementById('mp-version-list');
        if (!list || !mpPicker) return;
        const q = String(filter || '').toLowerCase().trim();
        const rows = (mpPicker.versions || []).filter(v => !q ||
            String(v.version_number || '').toLowerCase().includes(q) ||
            (v.game_versions || []).some(g => String(g).toLowerCase().includes(q)));
        list.innerHTML = '';
        if (!rows.length) {
            list.innerHTML = '<div style="padding:16px;text-align:center;opacity:0.5;font-size:12px;">No versions match.</div>';
            return;
        }
        rows.slice(0, 40).forEach(v => {
            const row = document.createElement('div');
            row.className = 'mods-row';
            row.style.cssText += 'cursor:pointer;' + (v.id === mpPicker.selectedId ? 'border-color:var(--accent);' : '');
            const games = (v.game_versions || []).slice(0, 3).join(', ');
            const loaders = (v.loaders || []).slice(0, 3).join(', ');
            row.innerHTML = `<div><input type="radio" ${v.id === mpPicker.selectedId ? 'checked' : ''} style="accent-color:var(--accent);" tabindex="-1"></div>` +
                `<div class="addon-card-info"><div class="addon-card-title">${_escHtml(v.version_number || v.id)}</div>` +
                `<div class="addon-card-meta">${_escHtml(games)}${loaders ? ` · ${_escHtml(loaders)}` : ''} · ${_escHtml(_timeAgo(v.date_published))}</div></div>`;
            row.onclick = () => {
                mpPicker.selectedId = v.id;
                mpRenderRows(document.getElementById('mp-version-search')?.value || '');
                mpRefreshSoulRow();
            };
            list.appendChild(row);
        });
    }

    async function openModpackPicker(projectId, title, preselectedId = null) {
        const overlay = document.getElementById('overlay-modpack-picker');
        const list = document.getElementById('mp-version-list');
        if (!overlay || !list) return;
        mpPicker = { projectId, title, versions: [], selectedId: preselectedId };
        document.getElementById('mp-picker-sub').textContent = `${title} — a brand-new instance will be created.`;
        document.getElementById('mp-version-search').value = '';
        document.getElementById('mp-soul-check').checked = false;
        list.innerHTML = '<div style="padding:16px;text-align:center;opacity:0.5;font-size:12px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading versions...</div>';
        overlay.classList.add('active');
        try {
            const versions = await soul.getModrinthVersions(projectId, '', '');
            if (!versions.length) throw new Error('This pack has no published versions.');
            mpPicker.versions = versions;
            if (!mpPicker.selectedId || !versions.some(v => v.id === mpPicker.selectedId)) {
                mpPicker.selectedId = versions[0].id;
            }
            mpRenderRows('');
            mpRefreshSoulRow();
        } catch (e) {
            list.innerHTML = `<div style="padding:16px;text-align:center;color:#ef4444;font-size:12px;">${_escHtml(e.message)}</div>`;
        }
    }

    function closeModpackPicker() {
        document.getElementById('overlay-modpack-picker')?.classList.remove('active');
        mpPicker = null;
    }

    // Adds the Soul Client mod (+ Fabric API) to an existing instance.
    async function addSoulClientToInstance(instanceName, mcVersion) {
        const supported = (soulVersionsCache || [])
            .filter(sv => sv.mcVersion === mcVersion && sv.downloadUrl)
            .sort((a, b) => (b.versionCode || 0) - (a.versionCode || 0))[0];
        if (!supported) throw new Error(`Soul Client doesn't support Minecraft ${mcVersion} yet.`);
        const label = supported.name || `v${supported.versionCode || '?'}`;
        const filename = String(supported.downloadUrl).split('/').pop().split('?')[0] || 'soulclient-mod.jar';
        await soul.downloadUrlToInstance(supported.downloadUrl, instanceName, 'mods', filename);
        await soul.soulclientDownloadDeps(instanceName, mcVersion);
        await soul.setInstanceConfigField(instanceName, 'soulVersionCode', supported.versionCode || 0);
        await soul.setInstanceConfigField(instanceName, 'soulModFilename', filename);
        await soul.setInstanceConfigField(instanceName, 'type', 'soulclient');
        return label;
    }

    async function doModpackPickerInstall() {
        const version = mpSelectedVersion();
        if (!version || !mpPicker) return;
        const btn = document.getElementById('btn-mp-picker-install');
        const soulBox = document.getElementById('mp-soul-check');
        const withSoul = !!(soulBox?.checked && !soulBox?.disabled);
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Installing...';
        try {
            const file = (version.files || []).find(f => f.primary) || (version.files || [])[0];
            if (!file) throw new Error('This release has no downloadable file.');
            logToConsole(`[MODPACK] Installing ${mpPicker.title} ${version.version_number}...`);
            const created = await soul.installModpack(file.url, mpPicker.title, version.version_number);
            if (withSoul) {
                try {
                    const label = await addSoulClientToInstance(created.name, created.mcversion || created.version);
                    window.notifications.show('success', 'Soul Client Added', `"${created.name}" will launch with Soul Client ${label}.`);
                } catch (e) {
                    window.notifications.show('warning', 'Soul Client Skipped', e.message);
                }
            }
            window.notifications.show('success', 'Installed', `"${created.name}" is ready to play!`);
            instances = await soul.getInstances();
            renderInstanceGrid();
            populateInstanceSelectors();
            if (typeof populateGroupFilter === 'function') populateGroupFilter();
            closeModpackPicker();
            switchView('instances');
        } catch (e) {
            window.notifications.show('error', 'Install Failed', e.message);
            btn.disabled = false;
            btn.innerHTML = orig;
        }
    }

    document.getElementById('btn-close-mp-picker')?.addEventListener('click', closeModpackPicker);
    document.getElementById('btn-mp-picker-cancel')?.addEventListener('click', closeModpackPicker);
    document.getElementById('btn-mp-picker-install')?.addEventListener('click', doModpackPickerInstall);
    document.getElementById('mp-version-search')?.addEventListener('input', (e) => mpRenderRows(e.target.value));

    async function checkKruthClientUpdates() {        if (!Array.isArray(kruthVersionsCache) || kruthVersionsCache.length === 0) return;
        if (!instances || instances.length === 0) {
            try { instances = await soul.getInstances(); } catch (_) { return; }
        }
        const kruthInstances = instances.filter(i => i.type === 'kruthclient');
        if (kruthInstances.length === 0) return;
        for (const inst of kruthInstances) {
            const mcVer = inst.mcversion || inst.version;
            if (!mcVer) continue;
            const latestVer = kruthVersionsCache.filter(sv => sv.mcVersion === mcVer).sort((a, b) => (b.versionCode || 0) - (a.versionCode || 0))[0];
            if (!latestVer || !latestVer.downloadUrl) continue;
            const currentCode = inst.kruthVersionCode || 0;
            if ((latestVer.versionCode || 0) > currentCode) {
                logToConsole(`[KRUTH CLIENT] Update found for "${inst.name}": ${latestVer.name} (v${latestVer.versionCode || '?'})`);
                const filename = latestVer.downloadUrl.split('/').pop().split('?')[0] || 'kruthclient-mod.jar';
                try {
                    const oldFilename = inst.kruthModFilename;
                    if (oldFilename && oldFilename !== filename) {
                        try { await soul.deleteMod(inst.name, oldFilename); } catch (_) {}
                    }
                    await soul.downloadUrlToInstance(latestVer.downloadUrl, inst.name, 'mods', filename);
                    await soul.soulclientDownloadDeps(inst.name, mcVer);
                    await soul.setInstanceConfigField(inst.name, 'kruthVersionCode', latestVer.versionCode || 0);
                    await soul.setInstanceConfigField(inst.name, 'kruthModFilename', filename);
                    logToConsole(`[KRUTH CLIENT] Updated "${inst.name}" to ${latestVer.name}`);
                    window.notifications.show('success', 'Kruth Client Updated', `"${inst.name}" updated to ${latestVer.name}`);
                } catch (e) {
                    console.warn('[KRUTH CLIENT] Auto-update failed:', e);
                }
            }
        }
    }

    window.launchAndJoin = async function launchAndJoin(ip) {
        if (typeof launchGame !== 'function') return;
        if (!selectedInstance) {
            const list = Array.isArray(instances) ? instances : [];
            const recent = list.filter(i => i.lastPlayed).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
            if (recent.length > 0) {
                selectedInstance = recent[0];
            } else if (list.length > 0) {
                selectedInstance = list[0];
            }
            if (selectedInstance) {
                await soul.setSetting('lastInstance', selectedInstance.id || selectedInstance.name);
                updateSelectedUI();
            }
        }
        launchGame(ip);
    };

    function timeAgo(timestamp) {
        if (!timestamp) return '';
        const diff = Date.now() - timestamp;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d ago`;
        return new Date(timestamp).toLocaleDateString();
    }

    function getInstanceIconHtml(inst) {
        if (inst.iconDataUrl) {
            return `<img src="${inst.iconDataUrl}" alt="${inst.name}" onerror="this.src='../../assets/icons/icon.png'">`;
        }
        const meta = getLoaderMeta(inst.loader);
        if (meta.logo) {
            return `<span class="rp-card-glyph"><img src="${meta.logo}" alt="" style="width:36px;height:36px;object-fit:contain"></span>`;
        }
        return `<span class="rp-card-glyph"><i class="fa-solid ${meta.icon}" style="font-size:18px;color:${meta.color}"></i></span>`;
    }

    function findInstanceByKey(key) {
        const list = Array.isArray(instances) ? instances : [];
        return list.find(i => i.id === key || i.name === key) || null;
    }

    async function selectInstanceById(id) {
        let inst = findInstanceByKey(id);
        if (!inst) {
            try {
                const all = await soul.getInstances();
                inst = all.find(i => i.id === id || i.name === id);
                if (inst) {
                    instances = all;
                    return inst;
                }
            } catch (_) {}
            return null;
        }
        return inst;
    }

    function openSoulBlogPosts() {
        const url = 'https://soullauncher.vercel.app/#posts';
        try {
            if (window.soul && typeof soul.openExternal === 'function') return soul.openExternal(url);
        } catch (_) {}
        try { if (window.require) return window.require('electron').shell.openExternal(url); } catch (_) {}
        window.open(url, '_blank', 'noopener');
    }
    let _blogPostsCache = [];
    let _blogIdx = 0;
    let _blogTimer = null;
    async function loadSoulBlog() {
        // Single full-bleed image, auto-rotates through posts every 4s (no text)
        const container = document.getElementById('soul-blog-list');
        if (!container) return;
        const ensureFull = () => {
            container.classList.remove('has-servers');
            container.classList.add('hbb-blog-grid', 'hbb-blog-full-grid');
            const col = document.getElementById('hbb-blog-col');
            if (col) col.classList.add('hbb-blog-full');
        };
        const renderEmpty = () => {
            ensureFull();
            if (_blogTimer) { clearInterval(_blogTimer); _blogTimer = null; }
            container.innerHTML = `<div class="hbb-blog-card hbb-blog-single" title="Open Posts" style="cursor:pointer"><img src="https://raw.githubusercontent.com/SoulTeams/soulmc/refs/heads/main/banner.png" alt="" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display='none'"></div>`;
            const card = container.querySelector('.hbb-blog-card');
            if (card) card.addEventListener('click', openSoulBlogPosts);
        };
        const renderImages = (posts) => {
            ensureFull();
            const filtered = (posts || []).filter(p => p && p.image && String(p.image).trim());
            if (!filtered.length) { renderEmpty(); return; }
            _blogPostsCache = filtered.sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
            if (_blogTimer) { clearInterval(_blogTimer); _blogTimer = null; }
            _blogIdx = 0;
            const show = (idx) => {
                const p = _blogPostsCache[idx % _blogPostsCache.length];
                const img = String(p.image).trim();
                const safeId = String(p.id || '').replace(/"/g, '&quot;');
                container.innerHTML = `<div class="hbb-blog-card hbb-blog-single" data-post-id="${safeId}" title="Open Posts"><img src="${img}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`;
                container.querySelectorAll('.hbb-blog-card').forEach(el => el.addEventListener('click', openSoulBlogPosts));
            };
            show(0);
            if (_blogPostsCache.length > 1) {
                _blogTimer = setInterval(() => {
                    _blogIdx = (_blogIdx + 1) % _blogPostsCache.length;
                    show(_blogIdx);
                }, 4000);
            }
        };
        const fetchViaREST = async () => {
            try {
                const r = await fetch('https://soul-backend-default-rtdb.firebaseio.com/blog_posts.json');
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const data = await r.json() || {};
                const posts = Object.keys(data).map(k => ({ id: k, ...data[k] }))
                    .filter(p => p && p.image)
                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                renderImages(posts);
                return true;
            } catch (e) {
                console.warn('[Blog grid] REST fallback failed:', e);
                return false;
            }
        };
        try {
            if (typeof firebase !== 'undefined' && firebase.database && firebase.apps && firebase.apps.length) {
                try {
                    const ref = firebase.database().ref('blog_posts');
                    ref.on('value', snap => {
                        const data = snap.val() || {};
                        const posts = Object.keys(data).map(k => ({ id: k, ...data[k] }))
                            .filter(p => p && p.image)
                            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                        if (!posts.length) {
                            fetchViaREST().then(ok => { if (!ok) renderEmpty(); });
                        } else {
                            renderImages(posts);
                        }
                    }, async err => {
                        console.warn('[Blog grid] Firebase error:', err);
                        const ok = await fetchViaREST();
                        if (!ok) renderEmpty();
                    });
                    return;
                } catch (e) {
                    console.warn('[Blog grid] Firebase on error:', e);
                }
            }
            const ok = await fetchViaREST();
            if (!ok) renderEmpty();
        } catch (e) {
            console.warn('[Blog grid] Failed to load:', e);
            renderEmpty();
        }
    }

    

    // --- OFFICIAL: Recent Played (worlds + servers) + Posts (restored merge) ---
    async function loadRecentPlayed() {
        const container = document.getElementById('recent-played-list');
        if (!container) return;
        try {
            const recentServers = (await soul.getSetting('recentServers')) || [];

            const serverItems = recentServers.map(s => ({
                type: 'server',
                id: s.ip,
                name: s.name || s.ip,
                meta: s.ip,
                iconHtml: `<img src="https://api.mcsrvstat.us/icon/${encodeURIComponent(s.ip)}" alt="" onerror="this.src='../../assets/icons/icon.png'">`,
                timestamp: s.timestamp || 0,
                ip: s.ip
            }));

            const worldItems = [];
            for (const inst of (Array.isArray(instances) ? instances : [])) {
                try {
                    const result = await soul.listInstanceFiles(inst.name, 'saves');
                    if (result && Array.isArray(result.entries)) {
                        for (const entry of result.entries) {
                            if (entry.isDir) {
                                let iconHtml = getInstanceIconHtml(inst);
                                try {
                                    const iconData = await soul.readInstanceFile(inst.name, `saves/${entry.name}/icon.png`);
                                    if (iconData) {
                                        iconHtml = `<img src="${iconData}" alt="" style="width:32px;height:32px;border-radius:4px;object-fit:cover">`;
                                    }
                                } catch (_) {}
                                worldItems.push({
                                    type: 'world',
                                    id: entry.name,
                                    name: entry.name,
                                    meta: `${inst.name} · World`,
                                    iconHtml: iconHtml,
                                    timestamp: entry.modified,
                                    ip: null,
                                    instanceName: inst.name,
                                    worldFolder: entry.name
                                });
                            }
                        }
                    }
                } catch (_) {}
            }

            const all = [...worldItems, ...serverItems]
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                .slice(0, 30);

            if (all.length === 0) {
                container.classList.remove('has-servers');
                container.innerHTML = 'No recently played worlds';
                return;
            }
            container.classList.add('has-servers');
            container.innerHTML = all.map(item => `
                <div class="rp-card-home" data-type="${item.type}" data-name="${item.name.replace(/"/g, '&quot;')}" data-ip="${item.ip || ''}" data-instance-name="${(item.instanceName || '').replace(/"/g, '&quot;')}" data-world-folder="${(item.worldFolder || '').replace(/"/g, '&quot;')}">
                    ${item.iconHtml}
                    <div class="rp-card-info">
                        <div class="rp-card-name">${item.name}</div>
                        <div class="rp-card-meta">${item.meta}</div>
                    </div>
                    <div class="rp-card-time">${timeAgo(item.timestamp)}</div>
                    <button class="rp-card-play" data-type="${item.type}" data-name="${item.name.replace(/"/g, '&quot;')}" data-ip="${item.ip || ''}" data-instance-name="${(item.instanceName || '').replace(/"/g, '&quot;')}" data-world-folder="${(item.worldFolder || '').replace(/"/g, '&quot;')}">${item.type === 'server' ? 'Join' : 'Play'}</button>
                </div>
            `).join('');

            function findInstance(nameOrId) {
                const list = Array.isArray(instances) ? instances : [];
                return list.find(i => i.name === nameOrId || i.id === nameOrId) || null;
            }

            container.querySelectorAll('.rp-card-play').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    const type = btn.dataset.type;
                    const name = btn.dataset.name;
                    const ip = btn.dataset.ip;
                    const instName = btn.dataset.instanceName;
                    const worldFolder = btn.dataset.worldFolder;
                    if (type === 'server' && ip) {
                        launchAndJoin(ip);
                    } else if (type === 'world' && instName && worldFolder) {
                        const inst = findInstance(instName);
                        if (inst && typeof launchGame === 'function') {
                            selectedInstance = inst;
                            soul.setSetting('lastInstance', inst.id || inst.name);
                            updateSelectedUI();
                            launchGame(null, worldFolder);
                        }
                    } else if (type === 'instance') {
                        const inst = findInstance(name);
                        if (inst && typeof launchGame === 'function') {
                            selectedInstance = inst;
                            soul.setSetting('lastInstance', inst.id || inst.name);
                            updateSelectedUI();
                            launchGame();
                        }
                    }
                });
            });
            container.querySelectorAll('.rp-card-home').forEach(card => {
                card.addEventListener('click', () => {
                    const type = card.dataset.type;
                    const name = card.dataset.name;
                    const ip = card.dataset.ip;
                    const instName = card.dataset.instanceName;
                    const worldFolder = card.dataset.worldFolder;
                    if (type === 'server' && ip) {
                        launchAndJoin(ip);
                    } else if (type === 'world' && instName && worldFolder) {
                        const inst = findInstance(instName);
                        if (inst) {
                            selectedInstance = inst;
                            soul.setSetting('lastInstance', inst.id || inst.name);
                            updateSelectedUI();
                            switchView('instances');
                            document.querySelectorAll('.inst-product-card').forEach(c => c.classList.remove('active'));
                            const gridCard = document.querySelector(`.inst-product-card[data-inst-id="${inst.id}"]`);
                            if (gridCard) gridCard.classList.add('active');
                        }
                    } else if (type === 'instance') {
                        const inst = findInstance(name);
                        if (inst) {
                            selectedInstance = inst;
                            soul.setSetting('lastInstance', inst.id || inst.name);
                            updateSelectedUI();
                            switchView('instances');
                            document.querySelectorAll('.inst-product-card').forEach(c => c.classList.remove('active'));
                            const gridCard = document.querySelector(`.inst-product-card[data-inst-id="${inst.id}"]`);
                            if (gridCard) gridCard.classList.add('active');
                        }
                    }
                });
            });
        } catch (e) {
            console.warn('[Recent Played] Failed to load:', e);
        }
    }

    async function loadPosts() {
        const container = document.getElementById('posts-container');
        if (!container) return;

        if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
            container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;opacity:0.5;">News unavailable — Soul account not connected.</div>';
            return;
        }

        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:100px;opacity:0.5;"><i class="fa-solid fa-spinner fa-spin" style="font-size:32px;margin-bottom:20px;display:block;"></i><p>Loading news...</p></div>';

        try {
            const db = firebase.database();
            const snapshot = await db.ref('posts').once('value');
            const data = snapshot.val();

            if (!data) {
                container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:100px;opacity:0.5;">No news posts yet.</div>';
                return;
            }

            // Convert object to array and sort by timestamp desc
            const posts = Object.keys(data).map(key => ({ id: key, ...data[key] }));
            posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            container.innerHTML = '';
            posts.forEach(post => {
                const card = document.createElement('div');
                card.className = 'inst-product-card';
                card.style.flexDirection = 'column';
                card.style.alignItems = 'stretch';
                card.style.padding = '0';
                card.style.overflow = 'hidden';
                card.style.height = 'auto';

                const date = post.timestamp ? new Date(post.timestamp).toLocaleDateString() : 'Recent';
                const desc = typeof marked !== 'undefined' ? marked.parse(post.description || '') : (post.description || '');

                const mediaHtml = post.image
                    ? `<img src="${post.image}" style="width:100%;height:160px;object-fit:cover;">`
                    : `<div style="width:100%;height:160px;background:var(--gray2);border-bottom:1px solid var(--glass-border);display:flex;align-items:center;justify-content:center;padding:25px;text-align:center;">
                    <span style="font-family:'Inter',sans-serif;font-weight:800;font-size:22px;color:var(--accent);text-transform:uppercase;line-height:1.1;letter-spacing:0.05em;">${post.title}</span>
                       </div>`;

                const buttonHtml = (post.buttonText && post.buttonLink)
                    ? `<div onclick="soul.openExternal('${post.buttonLink}')" style="display:inline-block; margin-top:10px; background:var(--accent); color:white; padding:10px 20px; border-radius:12px; font-size:12px; font-weight:800; text-transform:uppercase; text-align:center; cursor:pointer; transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">${post.buttonText}</div>`
                    : '';

                card.innerHTML = `
                    ${mediaHtml}
                    <div style="padding:20px;display:flex;flex-direction:column;gap:10px;flex:1;">
                        <div style="font-size:10px;color:var(--accent);font-weight:800;text-transform:uppercase;letter-spacing:0.1em;">${date}</div>
                        <h3 style="font-family:'Inter',sans-serif;font-size:20px;font-weight:800;color:white;margin:0;">${post.title}</h3>
                        <div style="font-size:13px;opacity:0.7;line-height:1.5;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;flex:1;">${desc}</div>
                        ${buttonHtml}
                    </div>
                `;
                container.appendChild(card);
            });
        } catch (err) {
            console.warn('[Posts] Load failed:', err);
            container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;opacity:0.5;">Could not load news: ${err.message}</div>`;
        }
    }

    // --- UPDATER ---
    function initUpdater() {
        const btnCheckUpdates = document.getElementById('btn-check-updates');
        if (!btnCheckUpdates) return;

        btnCheckUpdates.onclick = async () => {
            btnCheckUpdates.disabled = true;
            btnCheckUpdates.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking...';
            
            // Set up a one-time listener for the result
            const statusListener = (data) => {
                console.log('[HOME UPDATER]', data);
                
                if (data.status === 'not-available') {
                    window.notifications.show('info', 'Up to Date', 'You are running the latest version of Soul Launcher.');
                    cleanup();
                } else if (data.status === 'available') {
                    window.notifications.show('success', 'Update Found', `Version v${data.version} is available and downloading!`);
                    if (window.soul && typeof soul.openChangelog === 'function') {
                        soul.openChangelog().catch(err => console.warn('[HOME UPDATER] Failed to open changelog:', err));
                    }
                    cleanup();
                } else if (data.status === 'error') {
                    window.notifications.show('error', 'Update Error', data.error || 'Failed to check for updates.');
                    cleanup();
                } else if (data.status === 'downloaded') {
                    window.notifications.show('success', 'Update Ready', 'The launcher will restart to apply the update.');
                    cleanup();
                }
            };

            const cleanup = () => {
                btnCheckUpdates.disabled = false;
                btnCheckUpdates.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Check for Updates';
                // Note: We don't have a direct 'off' in our preload for this specific listener 
                // but since it's an IPC event it's generally fine, or we'd need a more robust event system.
            };

            soul.onUpdateStatus(statusListener);
            await soul.checkForUpdates();
        };

        const btnTestChangelog = document.getElementById('btn-test-changelog');
        if (btnTestChangelog) {
            btnTestChangelog.onclick = () => soul.openChangelog();
        }
    }

    // --- INITIALIZATION ---
    async function init() {
        // --- Firebase Auth Guard ---
        // Ensure only authenticated Firebase users (or existing launcher accounts)
        // can access the home dashboard. Redirect to login otherwise.
        try {
            if (typeof firebase !== 'undefined' && firebase.auth) {
                await new Promise((resolve) => {
                    const unsub = firebase.auth().onAuthStateChanged((user) => {
                        unsub();
                        resolve(user);
                    });
                }).then((user) => {
                    if (user && !user.emailVerified) {
                        try { window.location.href = '../login/verify-email.html'; } catch (_) {}
                    }
                });
            }
        } catch (e) {
            console.warn('[Auth Guard] Firebase check failed:', e);
        }

        // Init nav FIRST so tabs are immediately clickable, even if async ops hang
        try { initNav(); } catch (e) { console.warn('Nav init failed:', e); }
        try { initSwitchVI(); } catch (e) { console.warn('Switch VI failed:', e); }

        try {
            const savedTheme = (await soul.getSetting('theme')) || 'red';
            applyTheme(savedTheme);
        } catch (e) { console.warn('Theme load failed:', e); }

        try { await initBackgrounds(); } catch (e) { console.warn('Backgrounds init failed:', e); }

        // BUGFIX: Run independent network/disk loads in parallel to cut home init time.
        const [accRes, instRes, verRes] = await Promise.allSettled([
            loadAccounts(),
            loadInstances(),
            loadAllVersionsGrid()
        ]);
        if (accRes.status === 'rejected') console.warn('Accounts load failed:', accRes.reason);
        if (instRes.status === 'rejected') console.warn('Instances load failed:', instRes.reason);
        if (verRes.status === 'rejected') console.warn('Versions load failed:', verRes.reason);
        
        try { loadSettingsUI(); } catch (e) { console.warn('Settings UI load failed:', e); }
        try { initAddonToggles(); } catch (e) { console.warn('Addon toggles failed:', e); }
        try { await renderModProfiles(); } catch (e) { console.warn('Mod profiles failed:', e); }
        try { initVersionTypeFilter(); } catch (e) { console.warn('Version filter failed:', e); }
        try { initCreateModal(); } catch (e) { console.warn('Create modal failed:', e); }
        try { initUpdater(); } catch (e) { console.warn('Updater init failed:', e); }
        try { initSkinEvents(); } catch (e) { console.warn('Skin events failed:', e); }
        try { await initBackgroundSelector(); } catch (e) { console.warn('Background selector failed:', e); }

        // Apply saved animations preference before spawning ghosts
        try {
            const animPref = await soul.getSetting('animations');
            applyAnimations(animPref !== false);
        } catch (e) { console.warn('Animations pref load failed:', e); }

        // Initial view
        try { switchView('home'); } catch (e) { console.warn('Initial switchView failed:', e); }

        initConsoleUtils();
        initFirebase();
        try { checkNewPosts(); } catch (_) {}
        try { if (typeof spawnGhosts === 'function') spawnGhosts(8); } catch (e) { console.warn('Ghosts init failed:', e); }
        
        // --- POST-UPDATE NOTIFICATION ---
        const updateData = await soul.getSetting('showUpdateNotify');
        if (updateData) {
            setTimeout(() => {
                soul.openChangelog();
                soul.setSetting('showUpdateNotify', null); // Clear it
            }, 1500);
        }

        logToConsole('[SYSTEM] Soul Launcher v1 initialized.');
        logToConsole('[SYSTEM] Ready for launch sequence.');
    }

    // --- VERSION TYPE FILTER (Release / Snapshot / Beta / Alpha) ---
    function initVersionTypeFilter() {
        const pills = document.querySelectorAll('#v-type-pills .v-type-pill');
        pills.forEach(pill => {
            pill.onclick = () => {
                activeVersionType = pill.dataset.vtype;
                pills.forEach(p => p.classList.toggle('active', p === pill));
                loadAllVersionsGrid();
            };
        });
    }

    // --- CREATE INSTANCE MODAL ---
    function initCreateModal() {
        const loaderPills = document.querySelectorAll('.create-loader-pill');
        const verSearch   = document.getElementById('new-inst-ver-search');
        const btnAddJar   = document.getElementById('btn-add-jar');
        const btnPickIcon = document.getElementById('btn-pick-inst-icon');
        const btnClearIcon = document.getElementById('btn-clear-inst-icon');
        const jarList     = document.getElementById('jar-file-list');

        loaderPills.forEach(pill => {
            pill.onclick = () => {
                const nextLoader = pill.dataset.loader;
                if (!CREATABLE_LOADERS.has(nextLoader)) return;

                selectedNewInstLoader = nextLoader;
                loaderPills.forEach(p => p.classList.toggle('active', p === pill));
                updateCreateLoaderVisual(selectedNewInstLoader);
                selectedNewInstVersion = '';
                _loadCreateVersionList(verSearch ? verSearch.value : '');
            };
        });

        if (verSearch) {
            verSearch.oninput = () => _loadCreateVersionList(verSearch.value);
        }

        if (btnAddJar) {
            btnAddJar.onclick = async () => {
                try {
                    const files = await soul.selectFile([{ name: 'Mod / Plugin Files', extensions: ['jar', 'zip'] }]);
                    if (files) {
                        const arr = Array.isArray(files) ? files : [files];
                        jarFilesToAdd.push(...arr.filter(Boolean));
                        _renderJarList(jarList);
                    }
                } catch (err) {
                    window.notifications.show('error', 'File Dialog Error', err.message || 'Could not open file picker.');
                }
            };
        }

        if (btnPickIcon) {
            btnPickIcon.onclick = async () => {
                try {
                    const files = await soul.selectFile([{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]);
                    const picked = Array.isArray(files) ? files[0] : files;
                    if (!picked) return;
                    selectedNewInstIconPath = picked;
                    updateCreateIconPreview();
                } catch (err) {
                    window.notifications.show('error', 'Icon Error', err.message || 'Could not open icon picker.');
                }
            };
        }

        if (btnClearIcon) {
            btnClearIcon.onclick = () => {
                selectedNewInstIconPath = '';
                updateCreateIconPreview();
            };
        }

        updateCreateLoaderVisual(selectedNewInstLoader);
        _loadCreateVersionList('');
    }

    async function _loadCreateVersionList(query) {
        const list = document.getElementById('new-inst-version-list');
        if (!list) return;

        list.innerHTML = '<div style="padding:16px;text-align:center;opacity:0.5;font-size:12px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';

        try {
            let versions = [];
            if (selectedNewInstLoader === 'fabric') {
                const data = await soul.getFabricVersions();
                versions = getFabricReleaseChoices(data);
            } else if (selectedNewInstLoader === 'forge') {
                const data = await soul.getForgeVersions();
                versions = getForgeReleaseChoices(data);
            } else if (selectedNewInstLoader === 'soulclient') {
                versions = soulVersionsCache.length > 0
                    ? soulVersionsCache.map(v => ({ id: v.mcVersion, label: `${v.name} (MC ${v.mcVersion})` }))
                    : [];
            } else if (selectedNewInstLoader === 'kruthclient') {
                versions = kruthVersionsCache.length > 0
                    ? kruthVersionsCache.map(v => ({ id: v.mcVersion, label: `${v.name} (MC ${v.mcVersion})` }))
                    : [];
            } else {
                const data = await soul.getMcVersions();
                versions = getVanillaReleaseChoices(data);
            }

            const q = (query || '').toLowerCase();
            const filtered = q ? versions.filter(v => v.label.toLowerCase().includes(q)) : versions;

            list.innerHTML = '';
            if (filtered.length === 0) {
                list.innerHTML = '<div style="padding:14px;text-align:center;opacity:0.5;font-size:12px;">No versions found</div>';
                return;
            }

            if (!selectedNewInstVersion || !filtered.some(v => v.id === selectedNewInstVersion)) {
                selectedNewInstVersion = filtered[0].id;
            }

            filtered.forEach((v, idx) => {
                const btn = document.createElement('button');
                btn.className = 'create-ver-item' + (selectedNewInstVersion === v.id ? ' selected' : '');
                btn.innerHTML = `<span>${v.label}</span>${idx === 0 ? '<span style="font-size:9px;padding:2px 6px;background:var(--accent);color:white;border-radius:4px;font-weight:800;">LATEST</span>' : ''}`;
                btn.onclick = () => {
                    selectedNewInstVersion = v.id;
                    list.querySelectorAll('.create-ver-item').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                };
                list.appendChild(btn);
            });
        } catch (err) {
            list.innerHTML = `<div style="padding:14px;text-align:center;color:#ef4444;font-size:12px;">Failed to load: ${err.message}</div>`;
        }
    }

    function _renderJarList(container) {
        if (!container) return;
        container.innerHTML = '';
        jarFilesToAdd.forEach((filePath, idx) => {
            const fileName = String(filePath).split(/[\\/]/).pop();
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--gray1);border-radius:10px;border:1px solid var(--glass-border);font-size:12px;';
            row.innerHTML = `<i class="fa-solid fa-file-archive" style="color:var(--accent);flex-shrink:0;"></i><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${filePath}">${fileName}</span>`;
            const delBtn = document.createElement('button');
            delBtn.style.cssText = 'background:none;border:none;color:#ef4444;cursor:pointer;padding:2px 5px;flex-shrink:0;';
            delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            delBtn.onclick = () => { jarFilesToAdd.splice(idx, 1); _renderJarList(container); };
            row.appendChild(delBtn);
            container.appendChild(row);
        });
    }


    // --- NAVIGATION ---
    // Soul Store: pinned corner button, opens the website store (not an in-app view).
    const SOUL_STORE_URL = 'https://soullauncher.vercel.app/#coins';
    function openSoulStore() {
        try {
            if (window.soul && typeof soul.openExternal === 'function') {
                soul.openExternal(SOUL_STORE_URL);
            } else if (window.require) {
                window.require('electron').shell.openExternal(SOUL_STORE_URL);
            } else {
                window.open(SOUL_STORE_URL, '_blank', 'noopener');
            }
        } catch (e) { console.warn('Store open failed:', e); }
    }
    function initNav() {
        navItems.forEach(item => {
            item.onclick = () => {
                const targetView = item.dataset.view;
                switchView(targetView);
            };
        });
        const storeBtn = document.getElementById('nav-store');
        if (storeBtn) storeBtn.onclick = openSoulStore;
    }

    function switchView(viewId) {
        navItems.forEach(nav => nav.classList.toggle('active', nav.dataset.view === viewId));
        views.forEach(view => {
            view.classList.toggle('active', view.id === `view-${viewId}`);
        });

        // Ghosts keep animating on every view (background layer stays alive).

        // Discord RPC Update
        const viewLabels = {
            'home': 'Dashboard',
            'versions': 'Browsing Versions',
            'instances': 'Managing Instances',
            'files': 'Managing Files',
            'skins': 'Customizing Skin',
            'addons': 'Managing Addons',
            'settings': 'Settings',
            'console': 'Viewing Console',
            'posts': 'Reading Posts',
        };
        soul.setRPC('In Launcher', viewLabels[viewId] || 'Idle');

        // Hero content only visible on home

        const heroMain = document.getElementById('hero-main');
        if (heroMain) heroMain.classList.toggle('hidden', viewId !== 'home');
        const watermark = document.querySelector('.hero-watermark');
        if (watermark) watermark.classList.toggle('hidden', viewId !== 'home');

        // Pre-render skeletons so transition looks clean (no empty flash)
        try {
            if (viewId === 'versions') {
                const g = document.getElementById('version-grid');
                if (g) showSkeleton(g, 'versions', 8);
            } else if (viewId === 'instances') {
                const g = document.getElementById('instance-list');
                if (g && !g.querySelector('.inst-product-card')) showSkeleton(g, 'instances', 6);
            } else if (viewId === 'addons') {
                const c = document.getElementById('addon-list');
                if (c) showSkeleton(c, 'addons', 5);
            } else if (viewId === 'files') {
                const tb = document.getElementById('fm-tbody');
                const empty = document.getElementById('fm-empty');
                if (tb && !tb.querySelector('tr')) {
                    if (empty) empty.classList.add('hidden');
                    tb.innerHTML = Array.from({length:6}).map(()=>`
                        <tr class="fm-row"><td><div class="fm-name-cell"><span class="skeleton" style="width:28px;height:28px;display:inline-block;"></span><span class="skeleton-text long" style="height:12px;flex:1;margin-left:10px;"></span></div></td><td><span class="skeleton-text short" style="height:10px;width:52px;display:inline-block;"></span></td><td><span class="skeleton-text mid" style="height:10px;width:82px;display:inline-block;"></span></td><td><span class="skeleton-text mid" style="height:10px;width:82px;display:inline-block;"></span></td><td><div style="display:flex;gap:6px;"><span class="skeleton" style="width:34px;height:34px;"></span><span class="skeleton" style="width:34px;height:34px;"></span></div></td></tr>
                    `).join('');
                }
            } else if (viewId === 'skins') {
                const sg = document.getElementById('skin-history-grid');
                const cg = document.getElementById('cape-history-grid');
                if (sg && !sg.children.length) showSkeleton(sg, 'skinHistory', 8);
                if (cg && !cg.children.length) showSkeleton(cg, 'skinHistory', 4);
            }
        } catch(_) {}

        // Load specific view data (deferred one frame so skeleton paints first)
        requestAnimationFrame(() => {
            if (viewId === 'addons') loadFiles(activeFilesType, 'addon-list');
            if (viewId === 'instances') renderInstanceGrid();
            if (viewId === 'versions') loadAllVersionsGrid();
            if (viewId === 'skins') initSkinView();
            if (viewId === 'files') initFilesView();
            if (viewId === 'posts') loadPosts();
        });
    }

    // --- SWITCH VERSION / INSTANCE ---
    function initSwitchVI() {
        const btnSwitch = document.getElementById('btn-switch-vi');
        const overlay = document.getElementById('overlay-switch-vi');
        const btnClose = document.getElementById('btn-close-switch-vi');
        const tabs = document.querySelectorAll('.switch-vi-tab');
        const panels = {
            version: document.getElementById('svi-version'),
            instance: document.getElementById('svi-instance')
        };
        const loaderPills = document.querySelectorAll('.svi-loader-pill');
        const versionSearch = document.getElementById('svi-version-search');
        const versionList = document.getElementById('svi-version-list');
        const instanceSearch = document.getElementById('svi-instance-search');
        const instanceList = document.getElementById('svi-instance-list');

        if (!btnSwitch || !overlay) return;

        let allVersionsCache = [];
        let currentLoaderFilter = 'all';

        // Open
        btnSwitch.onclick = () => {
            overlay.classList.add('active');
            populateVersionList('all', '');
            populateInstanceList('');
            if (versionSearch) versionSearch.value = '';
            if (instanceSearch) instanceSearch.value = '';
        };

        // Close
        const closeModal = () => overlay.classList.remove('active');
        if (btnClose) btnClose.onclick = closeModal;
        overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

        // Tab switching
        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                Object.values(panels).forEach(p => p.classList.remove('active'));
                const target = panels[tab.dataset.svi];
                if (target) target.classList.add('active');
                if (tab.dataset.svi === 'instance') populateInstanceList(instanceSearch ? instanceSearch.value : '');
                else populateVersionList(currentLoaderFilter, versionSearch ? versionSearch.value : '');
            };
        });

        // Loader filter pills
        loaderPills.forEach(pill => {
            pill.onclick = () => {
                loaderPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                currentLoaderFilter = pill.dataset.loader;
                populateVersionList(currentLoaderFilter, versionSearch ? versionSearch.value : '');
            };
        });

        // Search
        if (versionSearch) {
            versionSearch.oninput = () => populateVersionList(currentLoaderFilter, versionSearch.value);
        }
        if (instanceSearch) {
            instanceSearch.oninput = () => populateInstanceList(instanceSearch.value);
        }

        // Populate version list
        async function populateVersionList(loader, query) {
            if (!versionList) return;
            if (allVersionsCache.length === 0) {
                try { allVersionsCache = await loadAllVersionsForSwitch(); } catch (e) {
                    versionList.innerHTML = '<div style="padding:20px;text-align:center;opacity:0.5;color:#ef4444;">Failed to load versions</div>';
                    return;
                }
            }

            let items = allVersionsCache;
            if (loader !== 'all') items = items.filter(v => v.loader === loader);
            if (query) {
                const q = query.toLowerCase();
                items = items.filter(v => v.id.toLowerCase().includes(q) || v.displayId.toLowerCase().includes(q));
            }

            if (items.length === 0) {
                versionList.innerHTML = '<div style="padding:20px;text-align:center;opacity:0.5;">No versions found</div>';
                return;
            }

            versionList.innerHTML = '';
            items.forEach(v => {
                const isActive = selectedInstance && selectedInstance.version === v.id &&
                    (selectedInstance.loader === v.loader || selectedInstance.type === v.loader);
                const item = document.createElement('div');
                item.className = `svi-item ${isActive ? 'active' : ''}`;
                item.innerHTML = `
                    <img class="svi-item-icon" src="${v.icon}">
                    <div class="svi-item-info">
                        <div class="svi-item-name">${v.displayId}</div>
                        <div class="svi-item-meta">${v.loaderLabel}</div>
                    </div>
                `;
                item.onclick = async () => {
                    closeModal();
                    try {
                        await selectAndCreateInstance({ id: v.id, displayId: v.displayId }, v.loader);
                    } catch (err) {
                        window.notifications.show('error', 'Selection Failed', err.message);
                    }
                };
                versionList.appendChild(item);
            });
        }

        // Populate instance list
        function populateInstanceList(query) {
            if (!instanceList) return;
            const items = query
                ? instances.filter(inst => inst.name.toLowerCase().includes(query.toLowerCase()))
                : instances;

            if (items.length === 0) {
                instanceList.innerHTML = '<div style="padding:20px;text-align:center;opacity:0.5;">No instances found</div>';
                return;
            }

            instanceList.innerHTML = '';
            items.forEach(inst => {
                const isActive = selectedInstance && selectedInstance.name === inst.name;
                const loaderMeta = getLoaderMeta(inst.loader);
                const item = document.createElement('div');
                item.className = `svi-item ${isActive ? 'active' : ''}`;
                item.innerHTML = `
                    <img class="svi-item-icon" src="${inst.iconDataUrl || loaderMeta.logo || '../../assets/icons/icon.png'}">
                    <div class="svi-item-info">
                        <div class="svi-item-name">${inst.name}</div>
                        <div class="svi-item-meta">${loaderMeta.label} ${inst.mcversion || inst.version}</div>
                    </div>
                `;
                item.onclick = async () => {
                    if (btnPlay && btnPlay.classList.contains('hidden')) {
                        window.notifications.show('warning', 'Game Running', 'Cannot switch instance while game is launched.');
                        return;
                    }
                    closeModal();
                    selectedInstance = inst;
                    soul.setSetting('lastInstance', inst.id);
                    document.querySelectorAll('.quick-inst-card').forEach(c => c.classList.remove('active'));
                    document.querySelectorAll('.inst-product-card').forEach(c => c.classList.remove('active'));
                    await updateSelectedUI();
                };
                instanceList.appendChild(item);
            });
        }
    }

    // --- ADDON TOGGLES ---
    function initAddonToggles() {
        const pills = document.querySelectorAll('.addon-pill');
        const searchInput = document.getElementById('addon-search');
        const btnAddLocal = document.getElementById('btn-add-addon-local');
        const btnBrowse = document.getElementById('btn-browse-modrinth');

        pills.forEach(pill => {
            pill.onclick = () => {
                activeAddonType = pill.dataset.type;
                syncActiveFilesType();
                pills.forEach(p => p.classList.toggle('active', p === pill));
                
                // Update dynamic title
                const titleEl = document.querySelector('#view-addons .view-title');
                if (titleEl) {
                    const titles = { 'mods': 'Mod Manager', 'packs': 'Resource Pack Manager', 'shaders': 'Shader Manager', 'worlds': 'World Manager', 'modpacks': 'Modpack Browser' };
                    titleEl.textContent = titles[activeAddonType] || 'Addon Manager';
                }

                // Update UI based on type
                if (activeAddonType === 'mods') {
                    if (searchInput) searchInput.placeholder = "Search installed mods...";
                    if (btnAddLocal) {
                        btnAddLocal.style.display = 'flex';
                        btnAddLocal.innerHTML = '<i class="fa-solid fa-plus"></i> Add Mod';
                    }
                    if (btnBrowse) { btnBrowse.style.display = 'flex'; btnBrowse.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Browse Mods'; }
                    document.getElementById('btn-check-mod-updates')?.classList.remove('hidden');
                    document.getElementById('btn-save-mod-profile')?.classList.remove('hidden');
                    renderModProfiles();
                } else if (activeAddonType === 'packs') {
                    if (searchInput) searchInput.placeholder = "Search resource packs...";
                    if (btnAddLocal) {
                        btnAddLocal.style.display = 'flex';
                        btnAddLocal.innerHTML = '<i class="fa-solid fa-plus"></i> Add Pack';
                    }
                    if (btnBrowse) { btnBrowse.style.display = 'flex'; btnBrowse.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Browse Packs'; }
                    document.getElementById('btn-check-mod-updates')?.classList.add('hidden');
                    document.getElementById('btn-save-mod-profile')?.classList.add('hidden');
                    document.getElementById('mod-profile-select')?.classList.add('hidden');
                } else if (activeAddonType === 'shaders') {
                    if (searchInput) searchInput.placeholder = "Search shader packs...";
                    if (btnAddLocal) {
                        btnAddLocal.style.display = 'flex';
                        btnAddLocal.innerHTML = '<i class="fa-solid fa-plus"></i> Add Shader';
                    }
                    if (btnBrowse) { btnBrowse.style.display = 'flex'; btnBrowse.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Browse Shaders'; }
                    document.getElementById('btn-check-mod-updates')?.classList.add('hidden');
                    document.getElementById('btn-save-mod-profile')?.classList.add('hidden');
                    document.getElementById('mod-profile-select')?.classList.add('hidden');
                } else if (activeAddonType === 'worlds') {
                    if (searchInput) searchInput.placeholder = "Search worlds...";
                    if (btnAddLocal) btnAddLocal.style.display = 'none';
                    if (btnBrowse) btnBrowse.style.display = 'none';
                    document.getElementById('btn-check-mod-updates')?.classList.add('hidden');
                    document.getElementById('btn-save-mod-profile')?.classList.add('hidden');
                    document.getElementById('mod-profile-select')?.classList.add('hidden');
                } else {
                    if (searchInput) searchInput.placeholder = "Search modpacks (Modrinth)...";
                    if (btnAddLocal) btnAddLocal.style.display = 'none';
                    if (btnBrowse) { btnBrowse.style.display = 'flex'; btnBrowse.innerHTML = '<i class="fa-solid fa-rocket"></i> Find Modpacks'; }
                    document.getElementById('btn-check-mod-updates')?.classList.add('hidden');
                    document.getElementById('btn-save-mod-profile')?.classList.add('hidden');
                    document.getElementById('mod-profile-select')?.classList.add('hidden');
                }

                // Modpacks install as brand-new instances — the instance picker
                // does not apply, so hide it to avoid confusion.
                const addonInstSel = document.getElementById('addon-instance-select');
                const addonInstLabel = addonInstSel?.previousElementSibling;
                const hideInstPicker = activeAddonType === 'modpacks';
                if (addonInstSel) addonInstSel.style.display = hideInstPicker ? 'none' : '';
                if (addonInstLabel && addonInstLabel.tagName === 'LABEL') addonInstLabel.style.display = hideInstPicker ? 'none' : '';

                loadFiles(activeFilesType, 'addon-list');
            };
        });
    }

    // --- FILE MANAGEMENT (MODS / PACKS) ---
    function getActiveInstanceFromSelect() {
        const select = document.getElementById('addon-instance-select');
        if (select && select.value) {
            const match = instances.find(i => i.id === select.value);
            if (match) return match;
        }
        return selectedInstance;
    }

    async function loadWorlds(activeInstance, container) {
        if (!activeInstance) {
            container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; opacity: 0.5;">Please select or create an instance first.</div>';
            return;
        }
        if (!soul.getWorlds) {
            container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; opacity: 0.5;">World management needs a launcher update. Restart Soul to pick up the new preload bridge.</div>';
            return;
        }
        showSkeleton(container, 'addons', 4);
        let worlds = [];
        try {
            worlds = await soul.getWorlds(activeInstance.name);
        } catch (e) {
            container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #ef4444;">Failed to list worlds: ${e.message}</div>`;
            return;
        }
        const queryInput = document.getElementById('addon-search');
        const query = (queryInput?.value || '').toLowerCase().trim();
        const filtered = query ? worlds.filter(w => (w.name || '').toLowerCase().includes(query)) : worlds;
        container.innerHTML = '';
        if (filtered.length === 0) {
            container.innerHTML = '<div style="grid-column: 1/-1; opacity:0.5; padding: 40px; text-align:center;">No worlds in this instance yet. Play the game and create one.</div>';
            return;
        }
        const fmtSize = (b) => !b ? '0 KB' : b > 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
        filtered.forEach((world) => {
            const item = document.createElement('div');
            item.className = 'mods-row';
            const date = world.modified ? new Date(world.modified).toLocaleDateString() : '';
            item.innerHTML = `
                <div><i class="fa-solid fa-earth-americas" style="color: var(--accent);"></i></div>
                <div class="mods-name">
                    <div class="addon-card-info" style="flex: 1;">
                        <div class="addon-card-title" title="${world.name}">${world.name}</div>
                        <div class="addon-card-meta">${world.datapackCount || 0} datapacks · ${fmtSize(world.size || 0)}${date ? ` · ${date}` : ''}${world.hasLevelDat ? '' : ' · missing level.dat'}</div>
                        <div class="datapack-list hidden" style="margin-top: 8px; padding: 8px 10px; background: rgba(0,0,0,0.25); border-radius: 8px;"></div>
                    </div>
                </div>
                <div class="mods-actions">
                    <button class="mods-action-btn btn-play-world" title="Play this world"><i class="fa-solid fa-play"></i></button>
                    <button class="mods-action-btn btn-packs" title="Manage datapacks"><i class="fa-solid fa-box-open"></i></button>
                    <button class="mods-action-btn btn-delete" title="Delete world"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            item.querySelector('.btn-play-world').onclick = () => {
                if (typeof launchGame === 'function') launchGame(null, world.name);
                else window.notifications.show('warning', 'Not Ready', 'Launch is still initializing.');
            };
            item.querySelector('.btn-delete').onclick = async () => {
                if (confirm(`Delete world "${world.name}"? This cannot be undone — back up the instance first.`)) {
                    try {
                        await soul.deleteWorld(activeInstance.name, world.name);
                        window.notifications.show('warning', 'World Deleted', `Removed "${world.name}".`);
                        loadFiles('worlds', container.id);
                    } catch (e) {
                        window.notifications.show('error', 'Delete Failed', e.message);
                    }
                }
            };
            const dpBox = item.querySelector('.datapack-list');
            let dpLoaded = false;
            item.querySelector('.btn-packs').onclick = async () => {
                dpBox.classList.toggle('hidden');
                if (dpBox.classList.contains('hidden') || dpLoaded) return;
                dpLoaded = true;
                await renderDatapacks(activeInstance.name, world.name, dpBox, () => { dpLoaded = false; });
            };
            container.appendChild(item);
        });
    }

    async function renderDatapacks(instanceName, worldName, box, onChanged) {
        box.innerHTML = '<div style="opacity:0.5;font-size:12px;">Loading datapacks...</div>';
        let packs = [];
        try {
            packs = await soul.getDatapacks(instanceName, worldName);
        } catch (e) {
            box.innerHTML = `<div style="color:#ef4444;font-size:12px;">${e.message}</div>`;
            return;
        }
        box.innerHTML = '';
        const addBtn = document.createElement('button');
        addBtn.className = 'launch-btn';
        addBtn.style.cssText = 'font-size: 12px; padding: 6px 14px; margin-bottom: 6px;';
        addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Datapack';
        addBtn.onclick = async () => {
            try {
                const added = await soul.addDatapack(instanceName, worldName);
                if (added && added.length) window.notifications.show('success', 'Datapack Added', added.join(', '));
                if (onChanged) onChanged();
                await renderDatapacks(instanceName, worldName, box, onChanged);
            } catch (e) {
                window.notifications.show('error', 'Add Failed', e.message);
            }
        };
        box.appendChild(addBtn);
        if (!packs.length) {
            box.insertAdjacentHTML('beforeend', '<div style="opacity:0.5;font-size:12px;">No datapacks in this world.</div>');
            return;
        }
        packs.forEach(p => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 0;';
            const safeName = String(p.name).replace(/</g, '&lt;').replace(/>/g, '&gt;');
            row.innerHTML = `<input type="checkbox" ${p.enabled ? 'checked' : ''} style="accent-color: var(--accent);"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${safeName}">${safeName}</span>`;
            const del = document.createElement('button');
            del.className = 'mods-action-btn btn-delete';
            del.title = 'Delete datapack';
            del.innerHTML = '<i class="fa-solid fa-trash"></i>';
            row.querySelector('input').onchange = async (e) => {
                try { await soul.toggleDatapack(instanceName, worldName, p.name, e.target.checked); }
                catch (err) { window.notifications.show('error', 'Toggle Failed', err.message); e.target.checked = !e.target.checked; }
            };
            del.onclick = async () => {
                if (confirm(`Delete datapack "${p.name}"?`)) {
                    try { await soul.deleteDatapack(instanceName, worldName, p.name); await renderDatapacks(instanceName, worldName, box, onChanged); }
                    catch (err) { window.notifications.show('error', 'Delete Failed', err.message); }
                }
            };
            row.appendChild(del);
            box.appendChild(row);
        });
    }

    async function loadFiles(type, containerId) {
        const container = document.getElementById(containerId);
        const activeInstance = getActiveInstanceFromSelect();
        if (!container) return;

        // Normalize addon-tab values to content types.
        if (type === 'packs') type = 'resourcepacks';
        if (type === 'shaders') type = 'shaderpacks';

        // Modpacks install as brand-new instances — no instance needed here.
        if (type === 'modpacks') {
            container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 60px; opacity: 0.5;">
                    <i class="fa-solid fa-rocket" style="font-size: 48px; margin-bottom: 20px; display: block; color: var(--accent);"></i>
                    <p style="font-family: 'Inter', sans-serif; font-weight: 700; font-size: 18px; color: white;">Ready to Explore?</p>
                    <p style="font-size: 13px; margin-top: 5px;">Use the "Find Modpacks" button to install complete game experiences from Modrinth.<br>Installing a pack creates a brand-new instance — pick the game version in the browser.</p>
                </div>
            `;
            return;
        }

        // Worlds tab: list saves, expandable per-world datapacks.
        if (type === 'worlds') {
            await loadWorlds(activeInstance, container);
            return;
        }

        if (!activeInstance) {
            container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; opacity: 0.5;">Please select or create an instance first.</div>';
            return;
        }

        const typeLabel = type === 'mods' ? 'mods' : type === 'shaderpacks' ? 'shader packs' : 'resource packs';
        showSkeleton(container, 'addons', 6);

        const listFn = type === 'mods'
            ? soul.getMods.bind(soul)
            : type === 'shaderpacks'
                ? (soul.getShaderpacks || (() => Promise.resolve([]))).bind(soul)
                : soul.getResourcePacks.bind(soul);
        const files = await listFn(activeInstance.name);

        const queryInput = document.getElementById('addon-search');
        const query = (queryInput?.value || '').toLowerCase().trim();
        const filteredFiles = query
            ? files.filter(f => (f.name || '').toLowerCase().includes(query) || (f.displayName || '').toLowerCase().includes(query))
            : files;

        container.innerHTML = '';
        if (filteredFiles.length === 0) {
            container.innerHTML += `<div style="grid-column: 1/-1; opacity:0.5; padding: 40px; text-align:center;">No ${typeLabel} found in this instance.</div>`;
            return;
        }

        filteredFiles.forEach((file, idx) => {
            const item = document.createElement('div');
            item.className = 'mods-row';
            item.draggable = type === 'resourcepacks' && file.enabled;
            if (type === 'resourcepacks') item.dataset.packName = file.name;
            
            const icon = file.iconDataUrl || '../../assets/icons/icon.png';
            
            item.innerHTML = `
                <div>
                    <input type="checkbox" class="toggle-checkbox" ${file.enabled ? 'checked' : ''}>
                </div>
                <div class="mods-name">
                    <img class="${type === 'mods' ? 'mod-icon' : 'pack-icon'}" src="${icon}" />
                    <div class="addon-card-info">
                        <div class="addon-card-title" title="${file.displayName || file.name}">${file.displayName || file.name}</div>
                        <div class="addon-card-meta">${file.description || (file.author ? `By ${file.author}` : `No description available for this ${type === 'mods' ? 'mod' : 'pack'}.`)}</div>
                        ${file.version ? `<div class="addon-card-version">${file.version}</div>` : ''}
                    </div>
                </div>
                <div class="mods-actions">
                    ${type === 'mods' ? '<button class="mods-action-btn btn-update" title="Check updates"><i class="fa-solid fa-arrow-up"></i></button>' : type === 'resourcepacks' ? `<button class="mods-action-btn btn-up" title="Move up" ${idx === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>` : ''}
                    <button class="mods-action-btn btn-delete" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            
            const checkbox = item.querySelector('.toggle-checkbox');
            checkbox.onchange = async () => {
                if (type === 'mods') await soul.toggleMod(activeInstance.name, file.name, checkbox.checked);
                else if (type === 'shaderpacks' && soul.toggleShaderpack) await soul.toggleShaderpack(activeInstance.name, file.name, checkbox.checked);
                else await soul.toggleResourcePack(activeInstance.name, file.name, checkbox.checked);
                if (type === 'mods') await refreshSelectedModCount(activeInstance);
                loadFiles(type, containerId);
            };

            const btnDelete = item.querySelector('.btn-delete');
            btnDelete.onclick = async () => {
                if (confirm(`Delete "${file.displayName || file.name}"?`)) {
                    if (type === 'mods') await soul.deleteMod(activeInstance.name, file.name);
                    else if (type === 'shaderpacks' && soul.deleteShaderpack) await soul.deleteShaderpack(activeInstance.name, file.name);
                    else await soul.deleteResourcePack(activeInstance.name, file.name);
                    if (type === 'mods') await refreshSelectedModCount(activeInstance);
                    window.notifications.show('warning', 'Deleted', `${file.name} removed.`);
                    loadFiles(type, containerId);
                }
            };

            if (type === 'mods') {
                const btnUpdate = item.querySelector('.btn-update');
                btnUpdate.onclick = async () => {
                    btnUpdate.disabled = true;
                    btnUpdate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                    const result = await soul.checkModUpdate(activeInstance.name, file.name, activeInstance.loader, activeInstance.mcversion || activeInstance.version);
                    if (!result || result.error) {
                        window.notifications.show('error', 'Update Check Failed', result?.error || 'This mod may not be on Modrinth.');
                        btnUpdate.disabled = false;
                        btnUpdate.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
                    } else if (!result.hasUpdate) {
                        window.notifications.show('info', 'Up to Date', `${file.displayName || file.name} is already on the latest version.`);
                        btnUpdate.disabled = false;
                        btnUpdate.innerHTML = '<i class="fa-solid fa-check"></i>';
                    } else {
                        // Update available — download new file then delete old one
                        window.notifications.show('info', 'Updating', `${result.currentVersion} → ${result.latestVersion}`);
                        try {
                            if (!result.latestVersionId) {
                                throw new Error('No compatible Modrinth release was found for this update.');
                            }
                            await soul.installModrinthWithDependencies(activeInstance.name, result.latestVersionId, 'mod');
                            if (result.latestFile?.filename !== file.name) await soul.deleteMod(activeInstance.name, file.name);
                            await refreshSelectedModCount(activeInstance);
                            window.notifications.show('success', 'Updated!', `Now on ${result.latestVersion}.`);
                            btnUpdate.innerHTML = '<i class="fa-solid fa-check"></i>';
                            loadFiles('mods', containerId);
                        } catch (err) {
                            window.notifications.show('error', 'Update Failed', err.message);
                            btnUpdate.disabled = false;
                            btnUpdate.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
                        }
                    }
                };
            } else if (type === 'resourcepacks') {
                const btnUp = item.querySelector('.btn-up');
                if (btnUp) {
                    btnUp.onclick = async () => {
                        const enabled = filteredFiles.filter(p => p.enabled).map(p => p.name);
                        const i = enabled.indexOf(file.name);
                        if (i > 0) {
                            [enabled[i - 1], enabled[i]] = [enabled[i], enabled[i - 1]];
                            await soul.setResourcePackOrder(activeInstance.name, enabled);
                            loadFiles(type, containerId);
                        }
                    };
                }
                item.addEventListener('dragstart', (ev) => {
                    if (!file.enabled) return;
                    ev.dataTransfer.setData('text/plain', file.name);
                });
                item.addEventListener('dragover', (ev) => {
                    if (!file.enabled) return;
                    ev.preventDefault();
                });
                item.addEventListener('drop', async (ev) => {
                    ev.preventDefault();
                    const draggedName = ev.dataTransfer.getData('text/plain');
                    if (!draggedName || draggedName === file.name) return;
                    const enabled = filteredFiles.filter(p => p.enabled).map(p => p.name);
                    const from = enabled.indexOf(draggedName);
                    const to = enabled.indexOf(file.name);
                    if (from === -1 || to === -1) return;
                    enabled.splice(to, 0, enabled.splice(from, 1)[0]);
                    await soul.setResourcePackOrder(activeInstance.name, enabled);
                    loadFiles(type, containerId);
                });
            }
            
            container.appendChild(item);
        });
    }

    const btnAddAddonLocal = document.getElementById('btn-add-addon-local');
    if (btnAddAddonLocal) btnAddAddonLocal.onclick = async () => {
        const activeInstance = getActiveInstanceFromSelect();
        if (!activeInstance) {
            window.notifications.show('warning', 'No Instance', 'Please select an instance first.');
            return;
        }

        btnAddAddonLocal.disabled = true;
        const origHTML = btnAddAddonLocal.innerHTML;
        btnAddAddonLocal.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Opening...';

        try {
            if (activeAddonType === 'mods') {
                // Try native soul.addMod first; fall back to explicit file picker
                let added = false;
                try {
                    await soul.addMod(activeInstance.name);
                    added = true;
                } catch {
                    // Fallback: use selectFile with jar filter
                    const files = await soul.selectFile([{ name: 'Mod Files (.jar, .zip)', extensions: ['jar', 'zip'] }]);
                    if (files) {
                        const arr = Array.isArray(files) ? files : [files];
                        for (const f of arr.filter(Boolean)) {
                            await soul.copyFileToInstance(activeInstance.name, f);
                        }
                        added = arr.filter(Boolean).length > 0;
                    }
                }
                if (added) window.notifications.show('success', 'Mod Added', 'File(s) added to instance mods folder.');
            } else if (activeAddonType === 'packs') {
                let added = false;
                try {
                    await soul.addResourcePack(activeInstance.name);
                    added = true;
                } catch {
                    const files = await soul.selectFile([{ name: 'Resource Pack (.zip)', extensions: ['zip'] }]);
                    if (files) {
                        const arr = Array.isArray(files) ? files : [files];
                        for (const f of arr.filter(Boolean)) {
                            await soul.copyFileToInstance(activeInstance.name, f);
                        }
                        added = arr.filter(Boolean).length > 0;
                    }
                }
                if (added) window.notifications.show('success', 'Pack Added', 'Resource pack added to instance.');
            } else if (activeAddonType === 'shaders') {
                let added = false;
                try {
                    if (soul.addShaderpack) await soul.addShaderpack(activeInstance.name);
                    else throw new Error('no-bridge');
                    added = true;
                } catch {
                    try {
                        const files = await soul.selectFile([{ name: 'Shader Pack (.zip)', extensions: ['zip'] }]);
                        if (files) {
                            const arr = Array.isArray(files) ? files : [files];
                            for (const f of arr.filter(Boolean)) {
                                await soul.copyFileToInstance(activeInstance.name, f, 'shaderpacks');
                            }
                            added = arr.filter(Boolean).length > 0;
                        }
                    } catch (_) {}
                }
                if (added) window.notifications.show('success', 'Shader Added', 'Shader pack added to instance.');
            }
            if (activeAddonType === 'mods') await refreshSelectedModCount(activeInstance);
            loadFiles(activeFilesType, 'addon-list');
        } catch (err) {
            window.notifications.show('error', 'Add Failed', err.message || 'Could not add file. Check the console for details.');
            logToConsole(`[ERROR] Add local file failed: ${err.message}`, 'error');
        } finally {
            btnAddAddonLocal.disabled = false;
            btnAddAddonLocal.innerHTML = origHTML;
        }
    };


    const addonSearch = document.getElementById('addon-search');
    if (addonSearch) {
        addonSearch.oninput = () => loadFiles(activeFilesType, 'addon-list');
        const icon = addonSearch.parentElement.querySelector('i');
        if (icon) icon.onclick = () => addonSearch.oninput();
    }

    async function renderModProfiles() {
        const select = document.getElementById('mod-profile-select');
        const instance = getActiveInstanceFromSelect();
        if (!select || !instance || !soul.getModProfiles) return;
        const profiles = await soul.getModProfiles(instance.name);
        const names = Object.keys(profiles);
        select.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Apply profile…';
        select.appendChild(placeholder);
        names.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });
        select.classList.toggle('hidden', activeAddonType !== 'mods' || names.length === 0);
    }

    const btnCheckModUpdates = document.getElementById('btn-check-mod-updates');
    if (btnCheckModUpdates) btnCheckModUpdates.onclick = async () => {
        const instance = getActiveInstanceFromSelect();
        if (!instance || activeAddonType !== 'mods') return;
        const original = btnCheckModUpdates.innerHTML;
        btnCheckModUpdates.disabled = true;
        btnCheckModUpdates.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking…';
        try {
            const updates = await soul.getModUpdates(instance.name, instance.loader, instance.mcversion || instance.version);
            if (!updates.length) {
                window.notifications.show('success', 'All checked', 'No compatible Modrinth updates were found.');
                return;
            }
            if (!confirm(`${updates.length} compatible mod update${updates.length === 1 ? '' : 's'} found. Install all now?`)) return;
            let complete = 0;
            for (const update of updates) {
                await soul.installModrinthWithDependencies(instance.name, update.latestVersionId, 'mod');
                if (update.latestFile?.filename !== update.name) await soul.deleteMod(instance.name, update.name);
                complete += 1;
            }
            await refreshSelectedModCount(instance);
            window.notifications.show('success', 'Mods updated', `${complete} compatible update${complete === 1 ? '' : 's'} installed.`);
            loadFiles('mods', 'addon-list');
        } catch (error) {
            window.notifications.show('error', 'Bulk update failed', error.message || 'No changes were made to the remaining mods.');
        } finally {
            btnCheckModUpdates.disabled = false;
            btnCheckModUpdates.innerHTML = original;
        }
    };

    const btnSaveModProfile = document.getElementById('btn-save-mod-profile');
    if (btnSaveModProfile) btnSaveModProfile.onclick = async () => {
        const instance = getActiveInstanceFromSelect();
        if (!instance || activeAddonType !== 'mods') return;
        const name = await showPrompt('Save Mod Profile', 'Name this enabled-mod selection:');
        if (!name) return;
        try {
            await soul.saveModProfile(instance.name, name);
            await renderModProfiles();
            window.notifications.show('success', 'Profile saved', `“${name.trim()}” is ready to apply later.`);
        } catch (error) {
            window.notifications.show('error', 'Could not save profile', error.message);
        }
    };

    const modProfileSelect = document.getElementById('mod-profile-select');
    if (modProfileSelect) modProfileSelect.onchange = async () => {
        const instance = getActiveInstanceFromSelect();
        const name = modProfileSelect.value;
        if (!instance || !name) return;
        try {
            await soul.applyModProfile(instance.name, name);
            await refreshSelectedModCount(instance);
            window.notifications.show('success', 'Profile applied', `“${name}” is now active.`);
            loadFiles('mods', 'addon-list');
        } catch (error) {
            window.notifications.show('error', 'Could not apply profile', error.message);
        } finally {
            modProfileSelect.value = '';
        }
    };

    // --- MODRINTH BROWSER ---
    const modrinthResults = document.getElementById('modrinth-results');
    const modrinthSearch = document.getElementById('modrinth-search');
    let modrinthType = 'mod';
    // 'downloads' = Popular by default (browse mode). Typing auto-switches
    // to 'relevance' (search mode); clearing the box switches back.
    let modrinthSort = 'downloads';

    function syncSortPills() {
        document.querySelectorAll('#filter-sort-list .filter-pill').forEach(p => {
            p.classList.toggle('active', p.dataset.val === modrinthSort);
        });
    }

    function autoSortForQuery() {
        const q = (modrinthSearch?.value || '').trim();
        const want = q ? 'relevance' : 'downloads';
        if (modrinthSort === 'downloads' || modrinthSort === 'relevance') {
            if (modrinthSort !== want) {
                modrinthSort = want;
                syncSortPills();
            }
        }
    }

    if (modrinthSearch) {
        modrinthSearch.oninput = () => {
            clearTimeout(window.modrinthTimer);
            window.modrinthTimer = setTimeout(() => { autoSortForQuery(); searchModrinth(modrinthSearch.value); }, 500);
        };
        const icon = modrinthSearch.parentElement.querySelector('i');
        if (icon) icon.onclick = () => { autoSortForQuery(); searchModrinth(modrinthSearch.value); };
    }

    const instSearch = document.getElementById('instance-search');
    if (instSearch) instSearch.oninput = () => renderInstanceGrid();

    // --- INSTANCE GROUPS / IMPORT / BACKUPS ---
    async function populateGroupFilter() {
        const select = document.getElementById('instance-group-filter');
        if (!select || !soul.getInstanceGroups) return;
        const current = select.value || '';
        let groups = [];
        try { groups = await soul.getInstanceGroups(); } catch (_) {}
        select.replaceChildren();
        const all = document.createElement('option');
        all.value = '';
        all.textContent = 'All groups';
        select.appendChild(all);
        groups.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            select.appendChild(opt);
        });
        if (groups.includes(current)) select.value = current;
    }

    const groupFilterSelect = document.getElementById('instance-group-filter');
    if (groupFilterSelect) groupFilterSelect.onchange = () => renderInstanceGrid();

    const btnImportPack = document.getElementById('btn-import-pack');
    if (btnImportPack) btnImportPack.onclick = async () => {
        btnImportPack.disabled = true;
        try {
            const result = await soul.importInstancePack();
            if (!result) return;
            instances = await soul.getInstances();
            renderInstanceGrid();
            populateInstanceSelectors();
            populateGroupFilter();
            if (result.kind === 'curseforge') {
                window.notifications.show('warning', 'CurseForge Imported (Partial)', `${result.instanceName}: ${result.note}`);
            } else if (result.skipped && result.skipped.length) {
                window.notifications.show('warning', 'Pack Imported', `${result.instanceName}: ${result.downloaded} files, ${result.skipped.length} skipped (offline).`);
            } else {
                window.notifications.show('success', 'Pack Imported', `"${result.instanceName}" is ready.`);
            }
            logToConsole(`[PACK] Imported ${result.kind} as "${result.instanceName}".`);
        } catch (e) {
            window.notifications.show('error', 'Import Failed', e.message);
        } finally {
            btnImportPack.disabled = false;
        }
    };

    const btnBackups = document.getElementById('btn-backups');
    if (btnBackups) btnBackups.onclick = () => openBackupsModal();

    async function openBackupsModal() {
        const overlay = document.getElementById('overlay-backups');
        if (!overlay) return;
        overlay.classList.add('active');
        await renderBackupsList();
    }

    async function renderBackupsList() {
        const list = document.getElementById('backups-list');
        if (!list) return;
        list.innerHTML = '<div style="opacity:0.5;font-size:13px;">Loading backups...</div>';
        let backups = [];
        try { backups = await soul.listBackups(); } catch (e) {
            list.innerHTML = `<div style="color:#ef4444;font-size:13px;">${e.message}</div>`;
            return;
        }
        list.innerHTML = '';
        if (!backups.length) {
            list.innerHTML = '<div style="opacity:0.5;font-size:13px;">No backups yet. Use the archive button on an instance card.</div>';
            return;
        }
        const fmtSize = (b) => b > 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
        backups.forEach(b => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(0,0,0,0.25);border-radius:10px;';
            const date = b.modified ? new Date(b.modified).toLocaleString() : '';
            row.innerHTML = `<i class="fa-solid fa-box-archive" style="color:var(--accent);"></i>
                <div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.file}</div>
                <div style="font-size:11px;opacity:0.6;">${fmtSize(b.size)}${date ? ` · ${date}` : ''}</div></div>`;
            const restoreBtn = document.createElement('button');
            restoreBtn.className = 'fm-btn fm-btn-primary';
            restoreBtn.textContent = 'Restore';
            restoreBtn.onclick = async () => {
                const target = await showPrompt('Restore Backup', 'Restore as instance named:', b.file.replace(/\.soulbackup\.zip$/i, '').replace(/\.zip$/i, ''));
                if (!target || !target.trim()) return;
                try {
                    const created = await soul.restoreBackup(b.file, target.trim());
                    instances = await soul.getInstances();
                    renderInstanceGrid();
                    populateInstanceSelectors();
                    populateGroupFilter();
                    window.notifications.show('success', 'Restored', `"${created.name}" is ready.`);
                    document.getElementById('overlay-backups')?.classList.remove('active');
                } catch (e) {
                    window.notifications.show('error', 'Restore Failed', e.message);
                }
            };
            const delBtn = document.createElement('button');
            delBtn.className = 'fm-btn';
            delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            delBtn.title = 'Delete backup';
            delBtn.onclick = async () => {
                if (!confirm(`Delete backup "${b.file}"?`)) return;
                await soul.deleteBackup(b.file);
                renderBackupsList();
            };
            row.appendChild(restoreBtn);
            row.appendChild(delBtn);
            list.appendChild(row);
        });
    }

    document.getElementById('btn-close-backups')?.addEventListener('click', () => {
        document.getElementById('overlay-backups')?.classList.remove('active');
    });
    document.getElementById('btn-restore-backup-file')?.addEventListener('click', async () => {
        const target = await showPrompt('Restore From File', 'Restore as instance named (blank = auto):', '');
        try {
            const created = await soul.restoreBackupFile(target && target.trim() ? target.trim() : undefined);
            if (!created) return;
            instances = await soul.getInstances();
            renderInstanceGrid();
            populateInstanceSelectors();
            populateGroupFilter();
            window.notifications.show('success', 'Restored', `"${created.name}" is ready.`);
            document.getElementById('overlay-backups')?.classList.remove('active');
        } catch (e) {
            window.notifications.show('error', 'Restore Failed', e.message);
        }
    });

    // --- PER-INSTANCE SETTINGS MODAL ---
    let instSettingsTarget = null;

    async function openInstanceSettings(instanceName) {
        const overlay = document.getElementById('overlay-instance-settings');
        if (!overlay) return;
        instSettingsTarget = instanceName;
        document.getElementById('inst-settings-sub').textContent = `${instanceName} — blank means use global Settings.`;
        document.getElementById('inst-cmd-preview').style.display = 'none';
        let s = {};
        try { s = await soul.getInstanceLaunchSettings(instanceName); } catch (_) {}
        const inst = instances.find(i => i.name === instanceName);
        document.getElementById('is-ram').value = s.ram ?? '';
        document.getElementById('is-resw').value = s.resW ?? '';
        document.getElementById('is-resh').value = s.resH ?? '';
        document.getElementById('is-fullscreen').value = s.fullscreen === true ? 'on' : s.fullscreen === false ? 'off' : '';
        const presetSelect = document.getElementById('is-jvm-preset');
        presetSelect.replaceChildren();
        let presets = { default: 'Default (launcher)' };
        try { presets = await soul.getJvmPresets(); } catch (_) {}
        Object.entries(presets).forEach(([key, label]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = label;
            presetSelect.appendChild(opt);
        });
        presetSelect.value = s.jvmPreset || 'default';
        document.getElementById('is-jvm-args').value = s.jvmArgs || '';
        const envObj = s.env || {};
        document.getElementById('is-env').value = Object.entries(envObj).map(([k, v]) => `${k}=${v}`).join('\n');
        document.getElementById('is-prehook').value = s.preHook || '';
        document.getElementById('is-posthook').value = s.postHook || '';
        document.getElementById('is-tags').value = (inst?.tags || []).join(', ');
        document.getElementById('is-group').value = inst?.group || '';
        overlay.classList.add('active');
    }

    document.getElementById('btn-close-inst-settings')?.addEventListener('click', () => {
        document.getElementById('overlay-instance-settings')?.classList.remove('active');
        instSettingsTarget = null;
    });

    document.getElementById('btn-save-inst-settings')?.addEventListener('click', async () => {
        if (!instSettingsTarget) return;
        const fsVal = document.getElementById('is-fullscreen').value;
        const patch = {
            ram: document.getElementById('is-ram').value === '' ? null : Number(document.getElementById('is-ram').value),
            resW: document.getElementById('is-resw').value === '' ? null : Number(document.getElementById('is-resw').value),
            resH: document.getElementById('is-resh').value === '' ? null : Number(document.getElementById('is-resh').value),
            fullscreen: fsVal === '' ? null : fsVal === 'on',
            jvmPreset: document.getElementById('is-jvm-preset').value,
            jvmArgs: document.getElementById('is-jvm-args').value,
            env: document.getElementById('is-env').value,
            preHook: document.getElementById('is-prehook').value,
            postHook: document.getElementById('is-posthook').value
        };
        try {
            await soul.setInstanceLaunchSettings(instSettingsTarget, patch);
            await soul.setInstanceTags(instSettingsTarget, document.getElementById('is-tags').value);
            await soul.setInstanceGroup(instSettingsTarget, document.getElementById('is-group').value);
            instances = await soul.getInstances();
            renderInstanceGrid();
            populateGroupFilter();
            window.notifications.show('success', 'Saved', `Settings for "${instSettingsTarget}" updated.`);
            document.getElementById('overlay-instance-settings')?.classList.remove('active');
            instSettingsTarget = null;
        } catch (e) {
            window.notifications.show('error', 'Save Failed', e.message);
        }
    });

    document.getElementById('btn-preview-cmd')?.addEventListener('click', async () => {
        if (!instSettingsTarget) return;
        const pre = document.getElementById('inst-cmd-preview');
        try {
            const settings = await soul.getAllSettings();
            const preview = await soul.previewLaunchCommand({
                name: instSettingsTarget,
                memory: settings.ram || settings.memory || 4,
                resW: settings.resW || 1280,
                resH: settings.resH || 720,
                fullscreen: !!settings.fullscreen,
                jvmArgs: settings.jvmArgs || '',
                javaPath: settings.javaPath || null,
                mcversion: selectedInstance?.mcversion || selectedInstance?.version,
                loader: selectedInstance?.loader
            });
            pre.textContent = `${preview.command}\n\nRAM: ${preview.memoryGb}G · ${preview.resW}x${preview.resH}${preview.fullscreen ? ' fullscreen' : ''} · preset: ${preview.jvmPreset}`
                + (preview.preHook ? `\npre-hook: ${preview.preHook}` : '')
                + (preview.postHook ? `\npost-hook: ${preview.postHook}` : '')
                + (Object.keys(preview.env || {}).length ? `\nenv: ${Object.keys(preview.env).join(', ')}` : '');
            pre.style.display = 'block';
        } catch (e) {
            pre.textContent = `Preview failed: ${e.message}`;
            pre.style.display = 'block';
        }
    });

    document.getElementById('btn-export-mrpack')?.addEventListener('click', async () => {
        if (!instSettingsTarget) return;
        try {
            const result = await soul.exportMrpack(instSettingsTarget);
            if (result) window.notifications.show('success', 'Exported', `${result.files} files packed for MC ${result.mcversion}.`);
        } catch (e) {
            window.notifications.show('error', 'Export Failed', e.message);
        }
    });

    // Active filter state
    let modrinthFilterVersion = '';
    let modrinthFilterLoader = '';
    let modrinthFilterCategory = '';

    // Pagination state
    let modrinthOffset = 0;
    let modrinthTotalHits = 0;
    let modrinthCurrentQuery = '';
    let modrinthAppending = false;
    const MODRINTH_PAGE_SIZE = 20;

    const btnBrowseModrinth = document.getElementById('btn-browse-modrinth');
    if (btnBrowseModrinth) btnBrowseModrinth.onclick = () => {
        if (activeAddonType === 'worlds') return;
        const typeMap = { 'mods': 'mod', 'packs': 'resourcepack', 'shaders': 'shader', 'modpacks': 'modpack' };
        openModrinth(typeMap[activeAddonType] || 'mod');
    };

    function openModrinth(type) {
        modrinthType = type;
        const titleMap = { 'mod': 'Browse Mods', 'resourcepack': 'Browse Resource Packs', 'shader': 'Browse Shaders', 'modpack': 'Browse Modpacks' };
        document.getElementById('modrinth-title').textContent = titleMap[type] || 'Browse Modrinth';

        // Pre-fill filters from the active instance — except modpacks, which
        // are version-picked in the browser and install as new instances.
        const activeInstance = getActiveInstanceFromSelect();
        if (activeInstance && type !== 'modpack') {
            modrinthFilterVersion = activeInstance.version || '';
            modrinthFilterLoader  = (type === 'resourcepack') ? '' : (activeInstance.loader === 'vanilla' ? '' : activeInstance.loader);
        } else {
            modrinthFilterVersion = '';
            modrinthFilterLoader  = '';
        }
        modrinthFilterCategory = '';
        // Fresh browse = most downloaded. Clear any stale search text.
        if (modrinthSearch) modrinthSearch.value = '';
        modrinthSort = 'downloads';
        syncSortPills();

        // Populate the version filter list
        _populateModrinthVersionList();

        // Sync loader pills UI
        document.querySelectorAll('#filter-loader-list .filter-pill').forEach(p => {
            p.classList.toggle('active', p.dataset.val === modrinthFilterLoader);
        });
        // Sync category UI
        document.querySelectorAll('#filter-category-list .filter-list-item').forEach(p => {
            p.classList.remove('active');
        });

        // Fresh browse always starts on the results grid, never a stale detail.
        mrdHistory = [];
        mrdCurrent = null;
        mrdShowDetailInline(false);

        switchView('modrinth');
        searchModrinth(modrinthSearch?.value || '');
    }

    // --- MODRINTH PROJECT DETAIL (Modrinth-style project page) ---
    const _escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const _fmtCount = (n) => {
        n = Number(n) || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return String(n);
    };
    function _renderMarkdownSafe(md) {
        const box = document.createElement('div');
        try {
            box.innerHTML = (typeof marked !== 'undefined' ? marked.parse(String(md || '')) : _escHtml(md));
        } catch (_) {
            box.textContent = String(md || '');
        }
        box.querySelectorAll('script, iframe, object, embed').forEach(el => el.remove());
        box.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href') || '';
            if (/^\s*javascript:/i.test(href)) a.removeAttribute('href');
            else a.setAttribute('target', '_blank');
        });
        box.querySelectorAll('img').forEach(img => { img.style.maxWidth = '100%'; img.loading = 'lazy'; });
        return box;
    }

    // Compatibility helpers shared by the detail header + version rows.
    // Judged against the selected instance (mods only); null = unknown.
    function getCompatContext() {
        const inst = (typeof getActiveInstanceFromSelect === 'function') ? getActiveInstanceFromSelect() : null;
        const game = inst ? (inst.mcversion || inst.version || '') : '';
        let loader = inst ? String(inst.loader || '').toLowerCase() : '';
        if (loader === 'soulclient' || loader === 'kruthclient') loader = 'fabric';
        return { inst, game, loader };
    }
    function isVersionCompatWithInstance(v, type) {
        const { inst, game, loader } = getCompatContext();
        if (!inst || type === 'modpack' || !v) return null;
        const g = !game || (v.game_versions || []).includes(game);
        const l = type === 'resourcepack' || type === 'shader' || !loader || loader === 'vanilla' ||
            (v.loaders || []).map(x => String(x).toLowerCase()).includes(loader);
        return g && l;
    }
    // Project-page navigation stack (dependency drill-in → back).
    let mrdHistory = [];
    let mrdCurrent = null;
    let mrdTab = 'description';
    let mrdFeatured = null;

    const _timeAgo = (iso) => {
        const t = new Date(iso).getTime();
        if (isNaN(t)) return '—';
        const s = Math.floor((Date.now() - t) / 1000);
        if (s < 60) return 'just now';
        const m = Math.floor(s / 60);
        if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
        const d = Math.floor(h / 24);
        if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
        const mo = Math.floor(d / 30);
        if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
        const y = Math.floor(mo / 12);
        return `${y} year${y === 1 ? '' : 's'} ago`;
    };

    // Detail renders INLINE in the browse pane (right side converts into the
    // project page). Results + filters stay untouched behind it.
    function mrdShowDetailInline(show) {
        const sidebar = document.getElementById('modrinth-sidebar');
        const results = document.getElementById('modrinth-results');
        const detail = document.getElementById('modrinth-detail');
        if (!sidebar || !results || !detail) return;
        const on = !!show;
        sidebar.style.display = on ? 'none' : '';
        results.style.display = on ? 'none' : '';
        detail.style.display = on ? 'block' : 'none';
        if (on) detail.scrollTop = 0;
    }

    function mrdBackToResults() {
        mrdHistory = [];
        mrdCurrent = null;
        mrdShowDetailInline(false);
    }

    async function openModrinthDetail(projectId, type, push = true) {
        const detail = document.getElementById('modrinth-detail');
        if (!detail || !projectId) return;
        if (push && mrdCurrent && mrdCurrent.id !== projectId) mrdHistory.push(mrdCurrent);
        mrdCurrent = { id: projectId, type: type || 'mod' };
        mrdShowDetailInline(true);
        detail.innerHTML = '<div style="opacity:0.5;text-align:center;padding:30px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading project...</div>';
        try {
            const [project, versions, deps] = await Promise.all([
                soul.getModrinthProject(projectId),
                soul.getModrinthVersions(projectId, '', '').catch(() => []),
                soul.getModrinthDependencies(projectId).catch(() => ({ projects: [], versions: [] }))
            ]);
            // User may have navigated away mid-load — only paint if still on it.
            if (mrdCurrent && mrdCurrent.id === projectId) {
                renderModrinthDetail(project, versions || [], deps || {}, type || project.project_type || 'mod');
            }
        } catch (e) {
            detail.innerHTML = `<div style="color:#ef4444;text-align:center;padding:30px;">Failed to load project: ${_escHtml(e.message)}</div>`;
        }
    }

    // Modrinth project-page layout: main column (description + versions)
    // + right info sidebar (featured download, categories, loaders, game
    // versions, environment, details, links) — same groups as modrinth.com.
    function renderModrinthDetail(project, versions, deps, type) {
        mrdTab = 'description';
        mrdFeatured = null;

        const detail = document.getElementById('modrinth-detail');
        detail.innerHTML = '';

        // ── HEADER (back + icon + title + stats + download) ──
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;gap:14px;align-items:center;margin-bottom:14px;flex-wrap:wrap;';
        const backBtn = document.createElement('button');
        backBtn.className = 'tb-btn';
        backBtn.title = mrdHistory.length ? 'Back to previous project' : 'Back to results';
        backBtn.style.cssText = 'height:36px;width:36px;border-radius:10px;background:rgba(255,255,255,0.05);flex-shrink:0;';
        backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
        backBtn.onclick = () => {
            const prev = mrdHistory.pop();
            if (prev) openModrinthDetail(prev.id, prev.type, false);
            else mrdBackToResults();
        };
        head.appendChild(backBtn);
        const iconWrap = document.createElement('div');
        iconWrap.style.cssText = 'width:64px;height:64px;border-radius:14px;overflow:hidden;flex-shrink:0;border:2px solid var(--line-dim);background:var(--paper-2);';
        const iconImg = document.createElement('img');
        iconImg.src = project.icon_url || '../../assets/icons/icon.png';
        iconImg.alt = '';
        iconImg.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        iconWrap.appendChild(iconImg);
        head.appendChild(iconWrap);
        const titleWrap = document.createElement('div');
        titleWrap.style.cssText = 'flex:1;min-width:200px;';
        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-family:Inter,sans-serif;font-weight:900;font-size:22px;';
        titleEl.textContent = project.title || 'Project';
        const subEl = document.createElement('div');
        subEl.style.cssText = 'opacity:0.65;font-size:13px;margin-top:2px;';
        subEl.textContent = `by ${project.author || 'unknown'}`;
        const statsEl = document.createElement('div');
        statsEl.style.cssText = 'display:flex;gap:14px;margin-top:6px;font-size:13px;font-weight:700;align-items:center;flex-wrap:wrap;';
        statsEl.innerHTML =
            `<span title="Downloads"><i class="fa-solid fa-download" style="color:var(--accent);"></i> ${_fmtCount(project.downloads)}</span>` +
            `<span title="Followers"><i class="fa-solid fa-heart" style="color:var(--accent);"></i> ${_fmtCount(project.followers)}</span>` +
            `<span class="inst-product-pill">${_escHtml(type)}</span>` +
            (project.categories || []).slice(0, 2).map(c => `<span class="inst-product-pill muted">${_escHtml(c)}</span>`).join('');
        titleWrap.append(titleEl, subEl, statsEl);
        head.appendChild(titleWrap);
        const dlBtn = document.createElement('button');
        dlBtn.className = 'launch-btn btn-large btn-accent';
        dlBtn.style.cssText = 'font-size:15px;padding:12px 26px;';
        dlBtn.innerHTML = '<i class="fa-solid fa-download"></i> Download';
        head.appendChild(dlBtn);
        detail.appendChild(head);

        const featuredTop = versions[0] || null;
        if (featuredTop) mrdFeatured = { project, version: featuredTop, type };
        dlBtn.style.display = featuredTop ? '' : 'none';
        dlBtn.onclick = async () => {
            if (!mrdFeatured) return;
            // Header Download installs the newest release COMPATIBLE with the
            // selected instance — not blindly the newest overall (it may
            // target a different MC version, e.g. 26.x snapshots).
            let pick = mrdFeatured.version;
            let force = false;
            if (type !== 'modpack') {
                const { inst, game, loader } = getCompatContext();
                if (inst) {
                    const compatible = versions.find(v => isVersionCompatWithInstance(v, type) === true);
                    if (compatible) {
                        pick = compatible;
                        if (compatible.id !== mrdFeatured.version.id) {
                            window.notifications.show('info', 'Matching Release', `Newest release targets other versions — installing ${compatible.version_number} for ${game}.`);
                        }
                    } else {
                        const g = (pick.game_versions || []).slice(0, 3).join(', ') || 'other versions';
                        const go = await soulConfirm('Install Anyway?', `Newest release (${pick.version_number}) targets ${g} — not your ${game || 'instance version'}${loader && loader !== 'vanilla' ? ` (${loader})` : ''}.\n\nIt may crash or refuse to load.`, 'Install Anyway', 'Go Back');
                        if (!go) return;
                        force = true;
                    }
                }
            }
            installDetailVersion(mrdFeatured.project, pick, dlBtn, mrdFeatured.type, force);
        };

        const license = typeof project.license === 'object' ? (project.license?.name || project.license?.id || '—') : (project.license || '—');
        const envBadge = (v) => ({ required: 'Required', optional: 'Optional', unsupported: 'Unsupported' }[String(v || '').toLowerCase()] || 'Unknown');

        const body = detail;
        const typeSlug = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader', modpack: 'modpack' }[type] || 'mod';

        const layout = document.createElement('div');
        layout.style.cssText = 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;';
        body.appendChild(layout);

        // ── MAIN COLUMN: tabbed like modrinth.com ──
        const main = document.createElement('div');
        main.style.cssText = 'flex:1;min-width:min(100%,420px);display:flex;flex-direction:column;gap:12px;';
        layout.appendChild(main);

        const gallery = Array.isArray(project.gallery) ? project.gallery : [];
        const withChangelog = (versions || []).filter(v => v.changelog && String(v.changelog).trim());
        const tabBar = document.createElement('div');
        tabBar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;border-bottom:2px solid var(--line-dim);padding-bottom:10px;';
        main.appendChild(tabBar);
        const mkPanel = () => {
            const p = document.createElement('div');
            p.style.cssText = 'display:flex;flex-direction:column;gap:14px;';
            main.appendChild(p);
            return p;
        };
        const descPanel = mkPanel();
        const galleryPanel = mkPanel();
        const changelogPanel = mkPanel();
        const versionsPanel = mkPanel();
        const paintMrdTab = () => {
            tabBar.querySelectorAll('.filter-pill').forEach(p => p.classList.toggle('active', p.dataset.tab === mrdTab));
            descPanel.style.display = mrdTab === 'description' ? 'flex' : 'none';
            galleryPanel.style.display = mrdTab === 'gallery' ? 'flex' : 'none';
            changelogPanel.style.display = mrdTab === 'changelog' ? 'flex' : 'none';
            versionsPanel.style.display = mrdTab === 'versions' ? 'flex' : 'none';
        };
        [
            ['description', 'Description'],
            ['gallery', `Gallery${gallery.length ? ` (${gallery.length})` : ''}`],
            ['changelog', 'Changelog'],
            ['versions', `Versions (${(versions || []).length})`]
        ].forEach(([key, label]) => {
            const b = document.createElement('button');
            b.className = 'filter-pill' + (key === mrdTab ? ' active' : '');
            b.dataset.tab = key;
            b.textContent = label;
            b.onclick = () => { mrdTab = key; paintMrdTab(); };
            tabBar.appendChild(b);
        });

        if (project.description) {
            const desc = document.createElement('p');
            desc.style.cssText = 'font-size:14px;opacity:0.85;margin:0;';
            desc.textContent = project.description;
            descPanel.appendChild(desc);
        }

        const aboutBox = document.createElement('div');
        aboutBox.style.cssText = 'font-size:13px;line-height:1.55;border:2px solid var(--line-dim);background:var(--paper-2);box-shadow:5px 5px 0 var(--paper-dim);padding:14px 16px;max-height:300px;overflow-y:auto;';
        if (project.body) aboutBox.appendChild(_renderMarkdownSafe(project.body));
        else aboutBox.textContent = 'No description provided.';
        aboutBox.classList.add('mrd-scroll');
        descPanel.appendChild(aboutBox);

        // Dependencies (required) — click drills into that project (back supported).
        const depProjects = (deps.projects || []).filter(p => p && p.id);
        if (depProjects.length) {
            const depTitle = document.createElement('div');
            depTitle.className = 'filter-label';
            depTitle.textContent = `Dependencies (${depProjects.length})`;
            descPanel.appendChild(depTitle);
            const depList = document.createElement('div');
            depList.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
            depProjects.slice(0, 12).forEach(dep => {
                const row = document.createElement('button');
                row.className = 'fm-btn';
                row.style.cssText = 'display:flex;align-items:center;gap:10px;text-align:left;';
                row.innerHTML = `<img src="${dep.icon_url || '../../assets/icons/icon.png'}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escHtml(dep.title || dep.slug || dep.id)}</span><i class="fa-solid fa-chevron-right" style="opacity:0.5;"></i>`;
                row.onclick = () => openModrinthDetail(dep.id, dep.project_type || 'mod', true);
                depList.appendChild(row);
            });
            descPanel.appendChild(depList);
        }

        const verTitle = document.createElement('div');
        verTitle.className = 'filter-label';
        verTitle.textContent = `Versions (${versions.length})`;
        versionsPanel.appendChild(verTitle);
        // Version search: filter by number, game version or loader.
        const verSearch = document.createElement('input');
        verSearch.type = 'text';
        verSearch.placeholder = 'Search versions... (e.g. 1.21, fabric)';
        verSearch.style.cssText = 'width:100%;padding:10px 14px;background:rgba(0,0,0,0.3);border:1px solid var(--glass-border);border-radius:10px;color:white;outline:none;font-family:inherit;font-size:13px;';
        versionsPanel.appendChild(verSearch);
        const verList = document.createElement('div');
        verList.className = 'mrd-scroll';
        verList.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto;padding-right:4px;';
        versionsPanel.appendChild(verList);

        // Compatibility is judged against the selected instance (mods only).
        const { game: compatGame, loader: compatLoader } = getCompatContext();
        const isCompat = (v) => isVersionCompatWithInstance(v, type);

        const renderVerRows = (query) => {
            const q = String(query || '').toLowerCase().trim();
            const matches = !q ? versions.slice() : versions.filter(v =>
                String(v.version_number || '').toLowerCase().includes(q) ||
                (v.game_versions || []).some(g => String(g).toLowerCase().includes(q)) ||
                (v.loaders || []).some(l => String(l).toLowerCase().includes(q)));
            // Compatible releases first (stable sort keeps newest-first within groups).
            matches.sort((a, b) => (isCompat(b) === true ? 1 : 0) - (isCompat(a) === true ? 1 : 0));
            verList.innerHTML = '';
            if (!versions.length) {
                verList.innerHTML = '<div style="opacity:0.5;font-size:12px;">No versions published.</div>';
                return;
            }
            if (!matches.length) {
                verList.innerHTML = '<div style="opacity:0.5;font-size:12px;">No versions match your search.</div>';
                return;
            }
            matches.slice(0, 30).forEach(v => {
                const row = document.createElement('div');
                row.className = 'mods-row';
                row.style.gridTemplateColumns = 'minmax(0,1fr) auto';
                const games = (v.game_versions || []).slice(0, 3).join(', ') + ((v.game_versions || []).length > 3 ? ', …' : '');
                const loaders = (v.loaders || []).slice(0, 3).join(', ');
                const compat = isCompat(v);
                const badge = compat === null ? '' : compat
                    ? ' <span style="color:#4ade80;font-weight:800;" title="Matches your instance">✓</span>'
                    : ' <span style="color:#fbbf24;font-weight:800;" title="Targets a different game version or loader">⚠</span>';
                row.innerHTML = `<div class="addon-card-info"><div class="addon-card-title">${_escHtml(v.version_number || v.id)}${badge}</div>` +
                    `<div class="addon-card-meta">${_escHtml(games)}${loaders ? ` · ${_escHtml(loaders)}` : ''} · ${_escHtml(_timeAgo(v.date_published))}</div></div>`;
                const installBtn = document.createElement('button');
                installBtn.className = 'fm-btn fm-btn-primary';
                installBtn.innerHTML = type === 'modpack' ? '<i class="fa-solid fa-rocket"></i> Install' : '<i class="fa-solid fa-download"></i> Install';
                installBtn.onclick = async () => {
                    if (compat === false) {
                        const go = await soulConfirm('Install Anyway?', `"${v.version_number}" targets ${games || 'other versions'}${loaders ? ` (${loaders})` : ''} — not your ${compatGame || 'instance version'}${compatLoader && compatLoader !== 'vanilla' ? ` (${compatLoader})` : ''}.\n\nIt may crash or refuse to load.`, 'Install Anyway', 'Pick Another');
                        if (!go) return;
                    }
                    await installDetailVersion(project, v, installBtn, type, compat === false);
                };
                row.appendChild(installBtn);
                verList.appendChild(row);
            });
            if (matches.length > 30) {
                verList.insertAdjacentHTML('beforeend', `<div style="opacity:0.5;font-size:11px;text-align:center;">Showing 30 of ${matches.length} — refine your search.</div>`);
            }
        };
        verSearch.oninput = () => renderVerRows(verSearch.value);
        renderVerRows('');

        // Gallery tab content
        if (!gallery.length) {
            galleryPanel.innerHTML = '<div style="opacity:0.5;font-size:13px;text-align:center;padding:30px;">No gallery images.</div>';
        } else {
            const galGrid = document.createElement('div');
            galGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;';
            gallery.forEach(g => {
                const img = document.createElement('img');
                img.src = g.url;
                img.alt = g.title || '';
                img.loading = 'lazy';
                img.title = (g.title || 'Gallery image') + ' — click to preview';
                img.style.cssText = 'width:100%;height:140px;object-fit:cover;border:2px solid var(--line-dim);background:var(--paper-2);cursor:zoom-in;';
                img.onclick = () => openImagePreview(gallery.map(x => ({ url: x.url, title: x.title })), gallery.indexOf(g));
                galGrid.appendChild(img);
            });
            galleryPanel.appendChild(galGrid);
        }

        // Changelog tab content (latest version notes first)
        if (!withChangelog.length) {
            changelogPanel.innerHTML = '<div style="opacity:0.5;font-size:13px;text-align:center;padding:30px;">No changelogs published.</div>';
        } else {
            withChangelog.slice(0, 10).forEach(v => {
                const card = document.createElement('div');
                card.style.cssText = 'border:2px solid var(--line-dim);background:var(--paper-2);box-shadow:5px 5px 0 var(--paper-dim);padding:12px 14px;';
                const head = document.createElement('div');
                head.style.cssText = 'font-weight:800;font-size:13px;margin-bottom:6px;display:flex;gap:8px;align-items:baseline;';
                head.innerHTML = `<span>${_escHtml(v.version_number || v.id)}</span><span style="font-weight:400;opacity:0.55;font-size:11px;">${_escHtml(_timeAgo(v.date_published))}</span>`;
                card.appendChild(head);
                const md = document.createElement('div');
                md.style.cssText = 'font-size:12.5px;line-height:1.55;opacity:0.92;max-height:220px;overflow-y:auto;';
                md.classList.add('mrd-scroll');
                md.appendChild(_renderMarkdownSafe(v.changelog));
                card.appendChild(md);
                changelogPanel.appendChild(card);
            });
        }
        paintMrdTab();

        // ── LEFT INFO SIDEBAR (same groups/order as modrinth.com) ──
        const side = document.createElement('aside');
        side.style.cssText = 'width:250px;flex-shrink:0;display:flex;flex-direction:column;gap:12px;order:-1;';
        layout.appendChild(side);

        const sideCard = (label) => {
            const g = document.createElement('div');
            g.className = 'filter-group';
            g.style.marginBottom = '0';
            const l = document.createElement('label');
            l.className = 'filter-label';
            l.textContent = label;
            g.appendChild(l);
            side.appendChild(g);
            return g;
        };

        // (Download lives in the header now.)

        if ((project.game_versions || []).length) {
            const g = sideCard('Compatibility');
            g.insertAdjacentHTML('beforeend', '<div style="font-size:11px;opacity:0.6;margin-bottom:6px;">Minecraft: Java Edition</div>');
            const list = document.createElement('div');
            list.className = 'filter-scroll-list';
            list.style.maxHeight = '150px';
            list.innerHTML = project.game_versions.map(v => `<span class="filter-list-item" style="cursor:default;">${_escHtml(v)}</span>`).join('');
            g.appendChild(list);
        }

        if ((project.loaders || []).length) {
            const g = sideCard('Platforms');
            const wrap = document.createElement('div');
            wrap.className = 'filter-pill-grid';
            wrap.innerHTML = project.loaders.map(l => `<span class="filter-pill" style="cursor:default;">${_escHtml(l)}</span>`).join('');
            g.appendChild(wrap);
        }

        const env = sideCard('Supported environments');
        env.insertAdjacentHTML('beforeend',
            `<div style="font-size:12px;display:flex;flex-direction:column;gap:4px;">` +
            `<div>Client-side: <b>${_escHtml(envBadge(project.client_side))}</b></div>` +
            `<div>Server-side: <b>${_escHtml(envBadge(project.server_side))}</b></div></div>`);

        const links = [
            ['Report issues', project.issues_url, 'fa-circle-exclamation'],
            ['View source', project.source_url, 'fa-code'],
            ['Visit wiki', project.wiki_url, 'fa-book'],
            ['Join Discord server', project.discord_url, 'fa-brands fa-discord']
        ].filter(([, url]) => url);
        if (links.length) {
            const g = sideCard('Links');
            links.forEach(([label, url, icon]) => {
                const b = document.createElement('button');
                b.className = 'fm-btn';
                b.style.cssText = 'width:100%;margin-bottom:6px;';
                b.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
                b.onclick = () => soul.openExternal(url);
                g.appendChild(b);
            });
        }

        if ((project.categories || []).length) {
            const g = sideCard('Tags');
            const wrap = document.createElement('div');
            wrap.className = 'filter-pill-grid';
            wrap.innerHTML = project.categories.map(c => `<span class="filter-pill" style="cursor:default;">${_escHtml(c)}</span>`).join('');
            g.appendChild(wrap);
        }

        const det = sideCard('Details');
        det.insertAdjacentHTML('beforeend',
            `<div style="font-size:12px;display:flex;flex-direction:column;gap:4px;opacity:0.9;">` +
            `<div>Licensed <b>${_escHtml(license)}</b></div>` +
            `<div>Published <b>${_escHtml(_timeAgo(project.published))}</b></div>` +
            `<div>Updated <b>${_escHtml(_timeAgo(project.updated))}</b></div>` +
            `<div style="overflow:hidden;text-overflow:ellipsis;">ID: <b>${_escHtml(project.id || '')}</b></div></div>`);

        const webBtn = document.createElement('button');
        webBtn.className = 'fm-btn';
        webBtn.style.cssText = 'width:100%;justify-content:center;';
        webBtn.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i> Open Modrinth Page';
        webBtn.onclick = () => soul.openExternal(`https://modrinth.com/${typeSlug}/${project.slug || project.id}`);
        side.appendChild(webBtn);
    }

    // Summarizes an install result: main file + auto-installed required
    // dependencies, plus anything that could not be resolved.
    function reportInstallResult(project, version, instName, res) {
        const installed = (res && res.installed) || [];
        const unresolved = (res && res.unresolved) || [];
        const depCount = Math.max(0, installed.length - 1);
        let msg = `${project.title} ${version.version_number} added to ${instName}.`;
        if (depCount) msg += ` ${depCount} required dependenc${depCount === 1 ? 'y' : 'ies'} installed automatically.`;
        window.notifications.show('success', 'Installed', msg);
        if (unresolved.length) {
            const names = unresolved.map(u => u.title || u.projectId || 'unknown').slice(0, 4).join(', ');
            window.notifications.show('warning', 'Dependencies Missing', `Could not auto-resolve: ${names}${unresolved.length > 4 ? ` (+${unresolved.length - 4} more)` : ''}. Add them manually.`);
            logToConsole(`[MODRINTH] Unresolved dependencies for ${project.title}: ${names}`, 'warn');
        }
    }

    async function installDetailVersion(project, version, btn, type, force = false) {
        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        try {
            if (type === 'modpack') {
                // Version + Soul Client choice happens in the picker popup.
                openModpackPicker(project.id, project.title, version.id);
            } else {
                const inst = getActiveInstanceFromSelect();
                if (!inst) {
                    window.notifications.show('warning', 'No Instance', 'Select or create an instance first (Addons tab).');
                    return;
                }
                window.notifications.show('info', 'Installing', `Installing ${project.title} + required dependencies...`);
                const res = await soul.installModrinthWithDependencies(inst.name, version.id, type, force);
                reportInstallResult(project, version, inst.name, res);
                if (typeof refreshSelectedModCount === 'function') { try { await refreshSelectedModCount(inst); } catch (_) {} }
                loadFiles(activeFilesType, 'addon-list');
            }
        } catch (e) {
            window.notifications.show('error', 'Install Failed', e.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = orig;
        }
    }

    // (Detail back-button wiring lives in the dynamic detail header.)

    // --- IMAGE LIGHTBOX (in-launcher gallery preview) ---
    let imgPreviewList = [];
    let imgPreviewIdx = 0;
    let imgZoom = 1;
    let imgPanX = 0;
    let imgPanY = 0;

    function applyImgTransform() {
        const el = document.getElementById('img-preview-el');
        if (!el) return;
        el.style.transform = `translate(${imgPanX}px, ${imgPanY}px) scale(${imgZoom})`;
        el.style.cursor = imgZoom > 1 ? 'grab' : 'zoom-in';
        const label = document.getElementById('img-preview-zoom');
        if (label) label.textContent = `${Math.round(imgZoom * 100)}%`;
    }

    function resetImgZoom() {
        imgZoom = 1;
        imgPanX = 0;
        imgPanY = 0;
        applyImgTransform();
    }

    function zoomImgAt(factor) {
        imgZoom = Math.min(6, Math.max(1, imgZoom * factor));
        if (imgZoom === 1) { imgPanX = 0; imgPanY = 0; }
        applyImgTransform();
    }

    function openImagePreview(images, index = 0) {
        imgPreviewList = (images || []).filter(g => g && g.url);
        if (!imgPreviewList.length) return;
        imgPreviewIdx = Math.min(Math.max(index, 0), imgPreviewList.length - 1);
        paintImagePreview();
        document.getElementById('overlay-image-preview')?.classList.add('active');
    }

    function paintImagePreview() {
        const item = imgPreviewList[imgPreviewIdx];
        if (!item) return;
        const el = document.getElementById('img-preview-el');
        el.src = item.url;
        el.alt = item.title || '';
        resetImgZoom();
        document.getElementById('img-preview-title').textContent = item.title || '';
        document.getElementById('img-preview-count').textContent = imgPreviewList.length > 1 ? `${imgPreviewIdx + 1} / ${imgPreviewList.length}` : '';
        document.getElementById('btn-img-prev').style.display = imgPreviewList.length > 1 ? '' : 'none';
        document.getElementById('btn-img-next').style.display = imgPreviewList.length > 1 ? '' : 'none';
    }

    function stepImagePreview(dir) {
        if (imgPreviewList.length < 2) return;
        imgPreviewIdx = (imgPreviewIdx + dir + imgPreviewList.length) % imgPreviewList.length;
        paintImagePreview();
    }

    function closeImagePreview() {
        document.getElementById('overlay-image-preview')?.classList.remove('active');
    }

    document.getElementById('btn-img-close')?.addEventListener('click', closeImagePreview);
    document.getElementById('btn-img-open')?.addEventListener('click', () => {
        const item = imgPreviewList[imgPreviewIdx];
        if (item) soul.openExternal(item.url);
    });
    document.getElementById('btn-img-prev')?.addEventListener('click', (e) => { e.stopPropagation(); stepImagePreview(-1); });
    document.getElementById('btn-img-next')?.addEventListener('click', (e) => { e.stopPropagation(); stepImagePreview(1); });
    document.getElementById('btn-img-zoom-in')?.addEventListener('click', (e) => { e.stopPropagation(); zoomImgAt(1.25); });
    document.getElementById('btn-img-zoom-out')?.addEventListener('click', (e) => { e.stopPropagation(); zoomImgAt(1 / 1.25); });
    document.getElementById('btn-img-zoom-reset')?.addEventListener('click', (e) => { e.stopPropagation(); resetImgZoom(); });
    document.getElementById('img-preview-el')?.addEventListener('dblclick', (e) => { e.stopPropagation(); if (imgZoom > 1) resetImgZoom(); else zoomImgAt(2); });
    document.getElementById('img-preview-el')?.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zoomImgAt(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    // Drag to pan while zoomed in.
    (() => {
        const el = document.getElementById('img-preview-el');
        if (!el) return;
        let dragging = false;
        let sx = 0, sy = 0, ox = 0, oy = 0;
        el.addEventListener('pointerdown', (e) => {
            if (imgZoom <= 1) return;
            dragging = true;
            sx = e.clientX; sy = e.clientY; ox = imgPanX; oy = imgPanY;
            el.setPointerCapture(e.pointerId);
            el.style.cursor = 'grabbing';
        });
        el.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            imgPanX = ox + (e.clientX - sx);
            imgPanY = oy + (e.clientY - sy);
            applyImgTransform();
        });
        const stop = () => { dragging = false; applyImgTransform(); };
        el.addEventListener('pointerup', stop);
        el.addEventListener('pointercancel', stop);
    })();
    document.getElementById('overlay-image-preview')?.addEventListener('click', (e) => {
        if (e.target.id === 'overlay-image-preview') closeImagePreview();
    });
    document.addEventListener('keydown', (e) => {
        if (!document.getElementById('overlay-image-preview')?.classList.contains('active')) return;
        if (e.key === 'Escape') closeImagePreview();
        else if (e.key === 'ArrowLeft') stepImagePreview(-1);
        else if (e.key === 'ArrowRight') stepImagePreview(1);
    });

    // Fresh open from a browse card — clears any drill-in history.
    function openModrinthDetailFresh(projectId, type) {
        mrdHistory = [];
        mrdCurrent = null;
        openModrinthDetail(projectId, type, false);
    }

    // Populate the version filter scroll list
    async function _populateModrinthVersionList() {
        const list = document.getElementById('filter-version-list');
        if (!list) return;
        list.innerHTML = '<div style="padding:8px 12px; font-size:12px; opacity:0.5;">Loading...</div>';
        try {
            const data = await soul.getMcVersions();
            const versions = (data.versions || []).map(v => v.id);
            list.innerHTML = '';

            // "Any" option
            const anyBtn = document.createElement('button');
            anyBtn.className = 'filter-list-item' + (modrinthFilterVersion === '' ? ' active' : '');
            anyBtn.textContent = 'Any';
            anyBtn.dataset.val = '';
            anyBtn.onclick = () => { modrinthFilterVersion = ''; _syncVersionList(); searchModrinth(modrinthSearch?.value || ''); };
            list.appendChild(anyBtn);

            versions.forEach(ver => {
                const btn = document.createElement('button');
                btn.className = 'filter-list-item' + (modrinthFilterVersion === ver ? ' active' : '');
                btn.textContent = ver;
                btn.dataset.val = ver;
                btn.onclick = () => { modrinthFilterVersion = ver; _syncVersionList(); searchModrinth(modrinthSearch?.value || ''); };
                list.appendChild(btn);
            });
        } catch (e) {
            list.innerHTML = '<div style="padding:8px 12px; font-size:12px; color:#ef4444;">Failed to load</div>';
        }
    }

    function _syncVersionList() {
        document.querySelectorAll('#filter-version-list .filter-list-item').forEach(p => {
            p.classList.toggle('active', p.dataset.val === modrinthFilterVersion);
        });
    }

    // Version filter search input
    const filterVersionSearch = document.getElementById('filter-version-search');
    if (filterVersionSearch) {
        filterVersionSearch.oninput = () => {
            const q = filterVersionSearch.value.toLowerCase();
            document.querySelectorAll('#filter-version-list .filter-list-item').forEach(p => {
                p.style.display = p.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
        };
    }

    // Loader pills
    document.querySelectorAll('#filter-loader-list .filter-pill').forEach(pill => {
        pill.onclick = () => {
            const val = pill.dataset.val;
            if (modrinthFilterLoader === val) {
                modrinthFilterLoader = '';   // toggle off
            } else {
                modrinthFilterLoader = val;
            }
            document.querySelectorAll('#filter-loader-list .filter-pill').forEach(p => {
                p.classList.toggle('active', p.dataset.val === modrinthFilterLoader);
            });
            searchModrinth(modrinthSearch?.value || '');
        };
    });

    // Sort pills — explicit choice wins over the auto browse/search rule.
    document.querySelectorAll('#filter-sort-list .filter-pill').forEach(pill => {
        pill.onclick = () => {
            modrinthSort = pill.dataset.val;
            syncSortPills();
            searchModrinth(modrinthSearch?.value || '');
        };
    });

    // Category list
    document.querySelectorAll('#filter-category-list .filter-list-item').forEach(item => {
        item.onclick = () => {
            const val = item.dataset.val;
            if (modrinthFilterCategory === val) {
                modrinthFilterCategory = '';  // toggle off
            } else {
                modrinthFilterCategory = val;
            }
            document.querySelectorAll('#filter-category-list .filter-list-item').forEach(p => {
                p.classList.toggle('active', p.dataset.val === modrinthFilterCategory);
            });
            searchModrinth(modrinthSearch?.value || '');
        };
    });

    // Clear all filters button
    const btnClearFilters = document.getElementById('btn-clear-filters');
    if (btnClearFilters) btnClearFilters.onclick = () => {
        modrinthFilterVersion = '';
        modrinthFilterLoader  = '';
        modrinthFilterCategory = '';
        modrinthSort = 'downloads';
        syncSortPills();
        if (modrinthSearch) modrinthSearch.value = '';
        document.querySelectorAll('#filter-loader-list .filter-pill, #filter-category-list .filter-list-item').forEach(p => p.classList.remove('active'));
        _syncVersionList();
        searchModrinth('');
    };

    if (modrinthSearch) {
        modrinthSearch.oninput = () => {
            clearTimeout(window.modrinthTimer);
            window.modrinthTimer = setTimeout(() => { autoSortForQuery(); searchModrinth(modrinthSearch.value); }, 500);
        };
    }

    async function searchModrinth(query, append = false) {
        const activeInstance = getActiveInstanceFromSelect();
        // Modpacks create a brand-new instance on install — browsing them
        // never needs a selected instance.
        const needsInstance = modrinthType !== 'modpack';
        if (!activeInstance && needsInstance) {
            modrinthResults.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; opacity: 0.5;">No instance selected.</div>';
            return;
        }

        if (!append) {
            modrinthOffset = 0;
            modrinthTotalHits = 0;
            modrinthCurrentQuery = query || '';
            modrinthAppending = false;
            showSkeleton(modrinthResults, 'modrinth', 5);
        }

        const searchVersion  = modrinthFilterVersion  || (activeInstance ? activeInstance.version : '')  || '';
        const searchLoader   = (modrinthType === 'resourcepack' || modrinthType === 'modpack') ? '' : (modrinthFilterLoader || ((activeInstance && activeInstance.loader === 'vanilla') || !activeInstance ? '' : activeInstance.loader));
        const searchCategory = modrinthFilterCategory || '';

        // Empty query = browse top downloads; typed query = relevance search.
        const effectiveQuery = (query || '').trim();

        let searchResult, results, totalHits;
        try {
            console.log('[Modrinth] Searching:', { q: effectiveQuery, type: modrinthType, ver: searchVersion, loader: searchLoader, offset: modrinthOffset, limit: MODRINTH_PAGE_SIZE, sort: modrinthSort });
            searchResult = await soul.searchModrinth(effectiveQuery, modrinthType, searchVersion, searchLoader, modrinthOffset, MODRINTH_PAGE_SIZE, modrinthSort);
            console.log('[Modrinth] First result:', searchResult);
            results = searchResult.hits || [];
            totalHits = searchResult.totalHits || 0;

            if (results.length === 0 && (searchVersion || searchLoader)) {
                console.log('[Modrinth] No results with filters, retrying without...');
                searchResult = await soul.searchModrinth(effectiveQuery, modrinthType, '', '', modrinthOffset, MODRINTH_PAGE_SIZE, modrinthSort);
                console.log('[Modrinth] Retry result:', searchResult);
                results = searchResult.hits || [];
                totalHits = searchResult.totalHits || 0;
            }
        } catch (err) {
            console.error('[Modrinth] Search error:', err);
            modrinthResults.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px;"><span style="color:#ef4444;font-size:14px;">Error: ' + err.message + '</span></div>';
            return;
        }

        console.log('[Modrinth] Rendering', results.length, 'cards');

        if (!append) {
            modrinthResults.innerHTML = '';
            modrinthTotalHits = totalHits;
        }

        if (results.length === 0 && !append) {
            modrinthResults.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; opacity: 0.5;">No results found. Try different filters or search term.</div>';
            return;
        }

        if (results.length === 0 && append) {
            modrinthAppending = true;
            return;
        }

        results.forEach(item => {
            const card = document.createElement('div');
            card.className = 'modrinth-card';
            card.style.cursor = 'pointer';
            card.innerHTML = `
                <div class="modrinth-card-main">
                    <img src="${item.icon_url || '../../assets/icons/icon.png'}" alt="">
                    <div style="flex: 1; min-width: 0;">
                        <h4 style="font-size: 15px; margin: 0 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink);">${item.title}</h4>
                        <p style="font-size: 12px; opacity: 0.6; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 0;">${item.description}</p>
                        <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;">
                            <span class="modrinth-card-author">${item.author}</span>
                            ${item.categories ? item.categories.slice(0, 3).map(c => `<span class="modrinth-card-cat">${c}</span>`).join('') : ''}
                        </div>
                    </div>
                    <div class="modrinth-btn-group">
                        <button class="modrinth-dl-btn btn-download" title="Download latest compatible version">
                            <i class="fa-solid fa-download"></i>
                        </button>
                        <button class="modrinth-dl-btn btn-secondary btn-versions" title="Choose a specific version">
                            <i class="fa-solid fa-chevron-down"></i>
                        </button>
                        <button class="modrinth-dl-btn btn-secondary btn-deps" title="View dependencies">
                            <i class="fa-solid fa-link"></i>
                        </button>
                        <button class="modrinth-dl-btn btn-secondary btn-changelog" title="View latest changelog">
                            <i class="fa-solid fa-note-sticky"></i>
                        </button>
                    </div>
                </div>
                <div class="modrinth-version-panel"></div>
                <div class="modrinth-deps-panel"></div>
                <div class="modrinth-changelog-panel"></div>
            `;

            modrinthResults.appendChild(card);
            // Click anywhere except the action buttons opens the project page.
            card.querySelector('.modrinth-card-main').addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                openModrinthDetailFresh(item.project_id, item.project_type || modrinthType);
            });
            card.querySelector('.btn-download').addEventListener('click', async (e) => {
                e.stopPropagation();
                const downloadBtn = e.currentTarget;
                downloadBtn.disabled = true;
                downloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

                try {
                    if (modrinthType === 'modpack') {
                        // Version + Soul Client choice happens in the picker popup.
                        openModpackPicker(item.project_id, item.title);
                        downloadBtn.disabled = false;
                        downloadBtn.innerHTML = '<i class="fa-solid fa-rocket"></i>';
                    } else {
                        window.notifications.show('info', 'Fetching Versions', `Finding compatible ${modrinthType}...`);
                        const downloadVersion = modrinthFilterVersion || activeInstance.mcversion || activeInstance.version || '';
                        let versions = await soul.getModrinthVersions(item.project_id, activeInstance.loader, downloadVersion);
                        if (versions.length === 0 && activeInstance.loader !== 'vanilla') {
                            versions = await soul.getModrinthVersions(item.project_id, '', downloadVersion);
                        }
                        if (versions.length === 0 && !modrinthFilterVersion) {
                            versions = await soul.getModrinthVersions(item.project_id, '', '');
                        }
                        if (versions.length === 0) {
                            const versionLabel = modrinthFilterVersion || activeInstance.version;
                            throw new Error(`No release of "${item.title}" found for Minecraft ${versionLabel}. Try a different game version filter.`);
                        }
                        const latest = versions[0];
                        const file = latest.files.find(f => f.primary) || latest.files[0];
                        window.notifications.show('info', 'Downloading', `Downloading ${file.filename}...`);
                        const installed = await soul.installModrinthWithDependencies(activeInstance.name, latest.id, modrinthType);
                        reportInstallResult(item, latest, activeInstance.name, installed);
                        downloadBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                        loadFiles(activeFilesType, 'addon-list');
                    }
                } catch (err) {
                    console.error('[MODRINTH DOWNLOAD ERROR]', err);
                    window.notifications.show('error', 'Action Failed', err.message);
                    downloadBtn.disabled = false;
                    downloadBtn.innerHTML = `<i class="fa-solid ${modrinthType === 'modpack' ? 'fa-rocket' : 'fa-download'}"></i>`;
                }
            });

            const verBtnEl = card.querySelector('.btn-versions');
            if (verBtnEl) {
                verBtnEl.addEventListener('click', async (e) => {
                e.stopPropagation();
                const verBtn = e.currentTarget;
                const panel = card.querySelector('.modrinth-version-panel');
                const chevron = verBtn.querySelector('i');
                if (panel.classList.contains('open')) {
                    panel.classList.remove('open');
                    panel.innerHTML = '';
                    chevron.className = 'fa-solid fa-chevron-down';
                    return;
                }
                chevron.className = 'fa-solid fa-spinner fa-spin';
                verBtn.disabled = true;
                panel.classList.add('open');
                panel.innerHTML = '<div style="padding:10px;font-size:12px;opacity:0.5;text-align:center"><i class="fa-solid fa-spinner fa-spin"></i> Loading versions...</div>';
                try {
                    const downloadVersion = modrinthFilterVersion || activeInstance.mcversion || activeInstance.version || '';
                    let allVersions = await soul.getModrinthVersions(item.project_id, activeInstance.loader, downloadVersion);
                    if (allVersions.length === 0) allVersions = await soul.getModrinthVersions(item.project_id, '', downloadVersion);
                    if (allVersions.length === 0) allVersions = await soul.getModrinthVersions(item.project_id, '', '');
                    if (allVersions.length === 0) {
                        panel.innerHTML = '<div style="padding:10px;font-size:12px;opacity:0.5;text-align:center">No versions found.</div>';
                    } else {
                        panel.innerHTML = '';
                        allVersions.forEach((ver, idx) => {
                            const file = ver.files.find(f => f.primary) || ver.files[0];
                            if (!file) return;
                            const instanceVersion = activeInstance.mcversion || activeInstance.version;
                            const instanceLoader = String(activeInstance.loader || '').toLowerCase();
                            const compatibleGame = !instanceVersion || (ver.game_versions || []).includes(instanceVersion);
                            const compatibleLoader = modrinthType === 'resourcepack' || !instanceLoader || instanceLoader === 'vanilla' ||
                                (ver.loaders || []).map(loader => String(loader).toLowerCase()).includes(instanceLoader);
                            const isCompatible = compatibleGame && compatibleLoader;
                            const row = document.createElement('div');
                            row.className = 'modrinth-version-row';
                            const gameVersions = (ver.game_versions || []).slice(0, 3).join(', ');
                            const extraVersions = ver.game_versions.length > 3 ? ` +${ver.game_versions.length - 3}` : '';
                            const loaders = (ver.loaders || []).map(l => `<span style="font-size:9px;padding:1px 5px;background:var(--black2);color:var(--gray4);border-radius:3px;text-transform:uppercase;">${l}</span>`).join('');
                            row.innerHTML = `
                                <div style="flex:1;min-width:0;">
                                    <div style="font-size:12px;font-weight:700;color:white;margin-bottom:2px;">${ver.version_number}${idx === 0 ? '<span style="font-size:9px;padding:1px 6px;background:var(--accent);color:white;border-radius:4px;margin-left:4px;">LATEST</span>' : ''}</div>
                                    <div style="font-size:10px;opacity:0.5;display:flex;gap:4px;align-items:center;flex-wrap:wrap;"><span>${ver.name || ''}</span><span>· MC ${gameVersions}${extraVersions}</span>${loaders}</div>
                                </div>
                                <button class="modrinth-dl-btn ver-dl-btn" title="${isCompatible ? `Download ${ver.version_number}` : 'Not compatible with this instance'}" ${isCompatible ? '' : 'disabled'} style="width:30px;height:30px;font-size:12px;flex-shrink:0;"><i class="fa-solid fa-download"></i></button>`;
                            row.querySelector('.ver-dl-btn').onclick = async (e2) => {
                                e2.stopPropagation();
                                const dlBtn = e2.currentTarget;
                                dlBtn.disabled = true;
                                dlBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                                try {
                                    if (modrinthType === 'modpack') {
                                        // Version + Soul Client choice happens in the picker popup.
                                        openModpackPicker(item.project_id, item.title, ver.id);
                                        dlBtn.disabled = false;
                                        dlBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
                                    } else {
                                        window.notifications.show('info', 'Downloading', `Downloading ${file.filename}...`);
                                        const installed = await soul.installModrinthWithDependencies(activeInstance.name, ver.id, modrinthType);
                                        reportInstallResult({ title: ver.version_number }, ver, activeInstance.name, installed);
                                        dlBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                                        loadFiles(activeFilesType, 'addon-list');
                                    }
                                } catch (err) {
                                    window.notifications.show('error', 'Download Failed', err.message);
                                    dlBtn.disabled = false;
                                    dlBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
                                }
                            };
                            panel.appendChild(row);
                        });
                    }
                } catch (err) {
                    panel.innerHTML = `<div style="padding:10px;font-size:12px;color:#ef4444;text-align:center">${err.message}</div>`;
                } finally {
                    chevron.className = 'fa-solid fa-chevron-up';
                    verBtn.disabled = false;
                }
            });
            }

            const changelogBtn = card.querySelector('.btn-changelog');
            if (changelogBtn) changelogBtn.onclick = async (event) => {
                event.stopPropagation();
                const panel = card.querySelector('.modrinth-changelog-panel');
                if (panel.classList.contains('open')) {
                    panel.classList.remove('open');
                    panel.replaceChildren();
                    return;
                }
                changelogBtn.disabled = true;
                panel.classList.add('open');
                panel.textContent = 'Loading changelog…';
                try {
                    const gameVersion = modrinthFilterVersion || activeInstance.mcversion || activeInstance.version || '';
                    let versions = await soul.getModrinthVersions(item.project_id, activeInstance.loader, gameVersion);
                    if (!versions.length && activeInstance.loader !== 'vanilla') versions = await soul.getModrinthVersions(item.project_id, '', gameVersion);
                    const latest = versions[0];
                    if (!latest) throw new Error('No compatible release has a changelog.');
                    panel.replaceChildren();
                    const heading = document.createElement('strong');
                    heading.textContent = `${latest.version_number} — latest compatible release`;
                    const content = document.createElement('pre');
                    content.textContent = latest.changelog || 'The author did not publish a changelog for this release.';
                    panel.append(heading, content);
                } catch (error) {
                    panel.textContent = error.message || 'Could not load the changelog.';
                } finally {
                    changelogBtn.disabled = false;
                }
            };

            const depsBtnEl = card.querySelector('.btn-deps');
            if (depsBtnEl) depsBtnEl.addEventListener('click', async (e) => {
                e.stopPropagation();
                const depsBtn = e.currentTarget;
                const panel = card.querySelector('.modrinth-deps-panel');
                const icon = depsBtn.querySelector('i');
                if (panel.classList.contains('open')) {
                    panel.classList.remove('open');
                    panel.innerHTML = '';
                    icon.className = 'fa-solid fa-link';
                    return;
                }
                icon.className = 'fa-solid fa-spinner fa-spin';
                depsBtn.disabled = true;
                panel.classList.add('open');
                panel.innerHTML = '<div style="padding:10px;font-size:12px;opacity:0.5;text-align:center"><i class="fa-solid fa-spinner fa-spin"></i> Loading dependencies...</div>';
                try {
                    const deps = await soul.getModrinthDependencies(item.project_id);
                    const depProjects = deps.projects || [];
                    const depVersions = deps.versions || [];
                    if (depProjects.length === 0) {
                        panel.innerHTML = '<div style="padding:10px;font-size:12px;opacity:0.5;text-align:center">No dependencies.</div>';
                    } else {
                        panel.innerHTML = '';
                        const installableDeps = depProjects.filter((proj, idx) => {
                            const depVer = depVersions[idx] || {};
                            const depType = (depVer.dependencies || []).find(d => d.project_id === proj.project_id)?.dependency_type || 'required';
                            return depType !== 'incompatible';
                        });
                        if (modrinthType !== 'modpack' && installableDeps.length > 0) {
                            const header = document.createElement('div');
                            header.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';
                            header.innerHTML = `<button class="modrinth-dl-btn btn-dl-all" title="Download this mod + all dependencies" style="flex:1;width:auto;padding:0 12px;font-size:11px;font-weight:700;text-transform:uppercase;gap:6px;background:var(--accent);border:none;color:white;border-radius:10px;height:32px;"><i class="fa-solid fa-download"></i> Download All (${installableDeps.length + 1})</button>`;
                            panel.appendChild(header);
                            header.querySelector('.btn-dl-all').onclick = async (e2) => {
                                e2.stopPropagation();
                                const dlAllBtn = e2.currentTarget;
                                dlAllBtn.disabled = true;
                                dlAllBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Installing...';
                                const curInstance = getActiveInstanceFromSelect();
                                if (!curInstance) { window.notifications.show('error', 'Failed', 'No instance selected.'); dlAllBtn.disabled = false; dlAllBtn.innerHTML = '<i class="fa-solid fa-download"></i> Download All (' + (installableDeps.length + 1) + ')'; return; }
                                try {
                                    window.notifications.show('info', 'Downloading', `Downloading ${item.title}...`);
                                    const dlVer = modrinthFilterVersion || curInstance.mcversion || curInstance.version || '';
                                    let mains = await soul.getModrinthVersions(item.project_id, curInstance.loader, dlVer);
                                    if (mains.length === 0 && curInstance.loader !== 'vanilla') mains = await soul.getModrinthVersions(item.project_id, '', dlVer);
                                    if (mains.length === 0 && !modrinthFilterVersion) mains = await soul.getModrinthVersions(item.project_id, '', '');
                                    if (mains.length === 0) throw new Error(`No release of "${item.title}" found.`);
                                    const mainLatest = mains[0];
                                    const mainFile = mainLatest.files.find(f => f.primary) || mainLatest.files[0];
                                    await soul.downloadModrinth(mainFile.url, curInstance.name, modrinthType, mainFile.filename);
                                    for (const proj of installableDeps) {
                                        window.notifications.show('info', 'Downloading Dependency', `Downloading ${proj.title}...`);
                                        const depVer = modrinthFilterVersion || curInstance.mcversion || curInstance.version || '';
                                        let verList = await soul.getModrinthVersions(proj.project_id, curInstance.loader, depVer);
                                        if (verList.length === 0 && curInstance.loader !== 'vanilla') verList = await soul.getModrinthVersions(proj.project_id, '', depVer);
                                        if (verList.length === 0 && !modrinthFilterVersion) verList = await soul.getModrinthVersions(proj.project_id, '', '');
                                        if (verList.length === 0) { window.notifications.show('warning', 'Skipped', `No compatible version found for ${proj.title}, skipping.`); continue; }
                                        const v = verList[0];
                                        const f = v.files.find(f2 => f2.primary) || v.files[0];
                                        await soul.downloadModrinth(f.url, curInstance.name, proj.project_type === 'resourcepack' ? 'resourcepack' : proj.project_type === 'shader' ? 'shader' : 'mod', f.filename);
                                    }
                                    window.notifications.show('success', 'Installed', `${item.title} + ${installableDeps.length} dependenc${installableDeps.length === 1 ? 'y' : 'ies'} added to ${curInstance.name}.`);
                                    dlAllBtn.innerHTML = '<i class="fa-solid fa-check"></i> Done';
                                    loadFiles(activeFilesType, 'addon-list');
                                    depProjects.forEach((proj2, idx2) => {
                                        const depVer2 = depVersions[idx2] || {};
                                        const depType2 = (depVer2.dependencies || []).find(d => d.project_id === proj2.project_id)?.dependency_type || 'required';
                                        if (depType2 !== 'incompatible') { const ib = panel.querySelector(`.dep-install-btn-${idx2}`); if (ib) { ib.innerHTML = '<i class="fa-solid fa-check"></i>'; ib.disabled = true; } }
                                    });
                                } catch (err) {
                                    window.notifications.show('error', 'Download All Failed', err.message);
                                    dlAllBtn.disabled = false;
                                    dlAllBtn.innerHTML = '<i class="fa-solid fa-download"></i> Download All (' + (installableDeps.length + 1) + ')';
                                }
                            };
                        }
                        depProjects.forEach((proj, idx) => {
                            const depVer = depVersions[idx] || {};
                            const depType = (depVer.dependencies || []).find(d => d.project_id === proj.project_id)?.dependency_type || 'required';
                            const row = document.createElement('div');
                            row.className = 'modrinth-dep-row';
                            const typeColors = { required: '#4ade80', optional: '#fde047', incompatible: '#ef4444', embedded: '#60a5fa' };
                            const typeLabels = { required: 'Required', optional: 'Optional', incompatible: 'Incompatible', embedded: 'Embedded' };
                            row.innerHTML = `
                                <img src="${proj.icon_url || '../../assets/icons/icon.png'}" style="width: 32px; height: 32px; border-radius: 8px; object-fit: cover; flex-shrink: 0;">
                                <div style="flex:1;min-width:0;">
                                    <div style="font-size:12px;font-weight:700;color:white;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${proj.title}</div>
                                    <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
                                        <span style="font-size:9px;padding:1px 6px;background:${typeColors[depType] || '#808090'};color:white;border-radius:4px;text-transform:uppercase;font-weight:700;">${typeLabels[depType] || depType}</span>
                                        <span style="font-size:10px;opacity:0.5;">${proj.project_type || ''}</span>
                                    </div>
                                </div>
                                ${depType !== 'incompatible' ? `<button class="modrinth-dl-btn dep-install-btn-${idx}" title="Install ${proj.title}" style="width:30px;height:30px;font-size:12px;flex-shrink:0;background:var(--accent);border:none;color:white;"><i class="fa-solid fa-plus"></i></button>` : ''}`;
                            if (depType !== 'incompatible') {
                                row.querySelector(`.dep-install-btn-${idx}`).onclick = async (e2) => {
                                    e2.stopPropagation();
                                    const dlBtn = e2.currentTarget;
                                    dlBtn.disabled = true;
                                    dlBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                                    try {
                                        const curInst = getActiveInstanceFromSelect();
                                        if (!curInst) throw new Error('No instance selected.');
                                        const dlV = modrinthFilterVersion || curInst.mcversion || curInst.version || '';
                                        let vl = await soul.getModrinthVersions(proj.project_id, curInst.loader, dlV);
                                        if (vl.length === 0 && curInst.loader !== 'vanilla') vl = await soul.getModrinthVersions(proj.project_id, '', dlV);
                                        if (vl.length === 0 && !modrinthFilterVersion) vl = await soul.getModrinthVersions(proj.project_id, '', '');
                                        if (vl.length === 0) throw new Error(`No compatible version found for ${proj.title}.`);
                                        const lv = vl[0];
                                        const lf = lv.files.find(f2 => f2.primary) || lv.files[0];
                                        const sub = proj.project_type === 'resourcepack' ? 'resourcepack' : proj.project_type === 'shader' ? 'shader' : 'mod';
                                        window.notifications.show('info', 'Downloading Dependency', `Downloading ${lf.filename}...`);
                                        await soul.downloadModrinth(lf.url, curInst.name, sub, lf.filename);
                                        window.notifications.show('success', 'Installed', `${proj.title} added to ${curInst.name}.`);
                                        dlBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                                        loadFiles(activeFilesType, 'addon-list');
                                    } catch (err) {
                                        window.notifications.show('error', 'Download Failed', err.message);
                                        dlBtn.disabled = false;
                                        dlBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
                                    }
                                };
                            }
                            panel.appendChild(row);
                        });
                    }
                } catch (err) {
                    panel.innerHTML = `<div style="padding:10px;font-size:12px;color:#ef4444;text-align:center">${err.message}</div>`;
                } finally {
                    icon.className = 'fa-solid fa-link';
                    depsBtn.disabled = false;
                }
            });

        });

        modrinthOffset += results.length;
        if (modrinthOffset < modrinthTotalHits) {
            const loadMore = document.createElement('div');
            loadMore.className = 'modrinth-load-more';
            loadMore.innerHTML = `<button><i class="fa-solid fa-plus"></i> Load More (${modrinthOffset}/${modrinthTotalHits})</button>`;
            loadMore.querySelector('button').onclick = () => {
                modrinthAppending = true;
                searchModrinth(modrinthCurrentQuery, true);
                loadMore.remove();
            };
            modrinthResults.appendChild(loadMore);
        }
    }

    const btnBackModrinth = document.getElementById('btn-back-modrinth');
    if (btnBackModrinth) btnBackModrinth.onclick = () => switchView('addons');

    // --- JAVA DETECTION ---
    const btnSelectJava = document.getElementById('btn-select-java');
    if (btnSelectJava) {
        btnSelectJava.onclick = async () => {
            const path = await soul.selectFile([{ name: 'Java Executable', extensions: ['exe'] }]);
            if (path) {
                document.getElementById('java-path').value = path;
                await soul.setSetting('javaPath', path);
                window.notifications.show('success', 'Java Set', 'Custom Java path saved.');
            }
        };
    }

    const btnRemoveJava = document.getElementById('btn-remove-java-path');
    if (btnRemoveJava) {
        btnRemoveJava.onclick = async () => {
            document.getElementById('java-path').value = '';
            await soul.setSetting('javaPath', '');
            window.notifications.show('success', 'Java Path Cleared', 'Auto-detect will be used on next launch.');
        };
    }

    const javaInput = document.getElementById('java-path');
    if (javaInput) {
        javaInput.placeholder = "Auto-detecting...";
        soul.detectJava().then(paths => {
            if (paths && paths.length > 0) {
                javaInput.placeholder = `Detected: Java ${paths[0].version}`;
            } else {
                javaInput.placeholder = "No Java detected — will auto-download when needed";
            }
        }).catch(() => {
            javaInput.placeholder = "Detection unavailable — leave blank to auto-manage";
        });
    }

    // --- JAVA STATUS CARDS ---

    function renderJavaCard(container, s) {
        // Find existing card for this version or create new one
        let card = container.querySelector(`[data-java-version="${s.version}"]`);
        if (!card) {
            card = document.createElement('div');
            card.dataset.javaVersion = s.version;
            card.style.cssText = [
                'display:flex', 'align-items:center', 'gap:8px',
                'background:var(--black2,#111)', 'border:1px solid var(--glass-border,#ffffff18)',
                'border-radius:8px', 'padding:8px 14px', 'font-size:13px', 'min-width:160px',
                'transition: border-color 0.3s'
            ].join(';');
            container.appendChild(card);
        }

        if (s.downloading) {
            card.style.borderColor = 'var(--accent, #6c63ff)';
            card.innerHTML = `
                <span style="color:var(--accent,#6c63ff);font-size:16px;">●</span>
                <div style="flex:1;">
                    <div style="font-weight:700;">Java ${s.version}</div>
                    <div style="opacity:0.5;font-size:11px;">Downloading...</div>
                </div>
                <i class="fa-solid fa-spinner fa-spin" style="opacity:0.6;"></i>`;
            return;
        }

        card.style.borderColor = s.installed ? '#22c55e44' : 'var(--glass-border,#ffffff18)';
        const dot   = s.installed ? '<span style="color:#22c55e;font-size:16px;">●</span>' : '<span style="color:#ef4444;font-size:16px;">●</span>';
        const label = s.installed ? 'Installed' : 'Missing';
        card.innerHTML = `${dot}<div style="flex:1;"><div style="font-weight:700;">Java ${s.version}</div><div style="opacity:0.5;font-size:11px;">${label}</div></div>`;

        if (!s.installed) {
            const dlBtn = document.createElement('button');
            dlBtn.className = 'tb-btn mini';
            dlBtn.style.cssText = 'margin-left:auto; font-size:11px; padding:3px 8px;';
            dlBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
            dlBtn.title = `Download Java ${s.version}`;
            dlBtn.onclick = async () => {
                // Show downloading state in-place — no full re-render
                renderJavaCard(container, { version: s.version, downloading: true });
                logToConsole(`[JAVA] Starting download of Java ${s.version}...`);
                switchView('console');
                try {
                    await soul.downloadJava(s.version);
                    // Re-fetch real status from main process
                    const updated = await soul.getJavaStatus();
                    updated.forEach(u => renderJavaCard(container, u));
                    logToConsole(`[JAVA] Java ${s.version} installed successfully!`);
                    window.notifications.show('success', 'Java Installed', `Java ${s.version} is ready.`);
                } catch (err) {
                    window.notifications.show('error', 'Download Failed', err.message);
                    logToConsole(`[ERROR] Java ${s.version} download failed: ${err.message}`);
                    // Revert card to missing state
                    renderJavaCard(container, { version: s.version, installed: false });
                }
            };
            card.appendChild(dlBtn);
        }
    }

    async function refreshJavaStatus() {
        const container = document.getElementById('java-status-cards');
        if (!container) return;
        // Only show "Checking..." when container is completely empty
        if (!container.querySelector('[data-java-version]')) {
            container.innerHTML = '<div style="opacity:0.4;font-size:13px;">Checking...</div>';
        }
        try {
            const statuses = await soul.getJavaStatus();
            // Remove placeholder text if present
            const placeholder = container.querySelector('div:not([data-java-version])');
            if (placeholder) placeholder.remove();
            statuses.forEach(s => renderJavaCard(container, s));
        } catch (err) {
            container.innerHTML = `<div style="opacity:0.5;font-size:13px;">Could not load status: ${err.message}</div>`;
        }
    }

    const btnRefreshJava = document.getElementById('btn-refresh-java-status');
    if (btnRefreshJava) btnRefreshJava.onclick = refreshJavaStatus;

    // --- DOWNLOAD ALL JAVA ---
    const btnDownloadAllJava = document.getElementById('btn-download-all-java');
    if (btnDownloadAllJava) {
        btnDownloadAllJava.onclick = async () => {
            btnDownloadAllJava.disabled = true;
            btnDownloadAllJava.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Downloading...';

            const wrap = document.getElementById('java-dl-progress-wrap');
            const msgEl = document.getElementById('java-dl-msg');
            const pctEl = document.getElementById('java-dl-pct');
            const bar   = document.getElementById('java-dl-bar');
            if (wrap) wrap.style.display = 'block';

            logToConsole('[JAVA] Starting download of all Java versions (8, 17, 21, 25)...');
            switchView('console');

            // Register java-log listener once globally (first click only)
            if (!window._javaLogListenerRegistered) {
                window._javaLogListenerRegistered = true;
                soul.onJavaLog(({ msg }) => {
                    logToConsole(`[JAVA] ${msg}`);
                });
                soul.onJavaAllProgress(({ msg, pct }) => {
                    if (msgEl) msgEl.textContent = msg;
                    if (pctEl) pctEl.textContent = pct + '%';
                    if (bar)   bar.style.width = pct + '%';
                    // Update cards live
                    const container = document.getElementById('java-status-cards');
                    if (container) {
                        const match = msg.match(/Java (\d+)/);
                        if (match && pct < 100) {
                            const ver = parseInt(match[1]);
                            const existing = container.querySelector(`[data-java-version="${ver}"]`);
                            if (existing && !existing.querySelector('.fa-check')) {
                                renderJavaCard(container, { version: ver, downloading: true });
                            }
                        }
                    }
                });
            }
            // Refresh bar/msg refs in case DOM was re-rendered
            const _wrap = document.getElementById('java-dl-progress-wrap');
            const _msgEl = document.getElementById('java-dl-msg');
            const _pctEl = document.getElementById('java-dl-pct');
            const _bar   = document.getElementById('java-dl-bar');

            try {
                await soul.downloadAllJava();
                // Re-fetch definitive state from main process
                const statuses = await soul.getJavaStatus();
                const container = document.getElementById('java-status-cards');
                if (container) statuses.forEach(s => renderJavaCard(container, s));
                window.notifications.show('success', 'Java Ready', 'Java 8, 17 and 21 are all installed.');
            } catch (err) {
                window.notifications.show('error', 'Java Download Failed', err.message);
                refreshJavaStatus(); // revert cards to real state
            } finally {
                btnDownloadAllJava.disabled = false;
                btnDownloadAllJava.innerHTML = '<i class="fa-solid fa-download"></i> Download All';
                if (wrap) setTimeout(() => { wrap.style.display = 'none'; }, 3000);
            }
        };
    }

    // Auto-refresh when settings view opens
    const settingsNavItem = document.querySelector('[data-view="settings"]');
    if (settingsNavItem) {
        settingsNavItem.addEventListener('click', () => refreshJavaStatus());
    }
    refreshJavaStatus();

    // --- SKIN MANAGEMENT ---
    // Random skin pose — picks one of the bundled skinview3d animations
    // every time the skins tab is opened.
    function setRandomSkinPose() {
        if (!skinViewer || typeof skinview3d === 'undefined') return;
        try {
            const pool = [
                ['idle', skinview3d.IdleAnimation, 1],
                ['walk', skinview3d.WalkingAnimation, 0.5],
                ['run', skinview3d.RunningAnimation, 0.7],
                ['crouch', skinview3d.CrouchAnimation, 0.6],
                ['hit', skinview3d.HitAnimation, 1],
                ['fly', skinview3d.FlyingAnimation, 0.8],
                ['swim', skinview3d.SwimAnimation, 0.8],
                ['wave', skinview3d.WaveAnimation, 1]
            ].filter(([, Cls]) => !!Cls);
            if (!pool.length) return;
            const [name, AnimClass, speed] = pool[Math.floor(Math.random() * pool.length)];
            if (skinViewer.animations && typeof skinViewer.animations.add === 'function') {
                // Legacy composite manager — clear previous pose first
                try {
                    if (Array.isArray(skinViewer.animations.animations)) skinViewer.animations.animations = [];
                } catch (_) {}
                const a = skinViewer.animations.add(AnimClass);
                if (a && 'speed' in a) { try { a.speed = speed; } catch (_) {} }
            } else {
                // v3.x single-animation API
                try {
                    const inst = new AnimClass();
                    if ('speed' in inst) inst.speed = speed;
                    skinViewer.animation = inst;
                } catch (_) {
                    // Some builds export functions/instances directly
                    skinViewer.animation = AnimClass;
                }
            }
            console.log('[SKIN] Random pose:', name);
        } catch (animErr) {
            console.warn('[SKIN] Animation setup skipped:', animErr);
        }
    }
    async function initSkinView() {
        console.log('[SKIN] Initializing Skin View...');
        const container = document.getElementById('skin-viewer-container');
        
        // 1. ALWAYS load history first, regardless of renderer state
        loadSkinHistory();
        loadCapeHistory();
        populateInstanceSelectors();

        if (!container) return;

        // 2. Check if library is loaded
        if (typeof skinview3d === 'undefined') {
            console.error('[SKIN] skinview3d library not found!');
            container.innerHTML = `<div class="skin-error">
                <i class="fa-solid fa-triangle-exclamation"></i> 
                Renderer Library Missing<br>
                <small>The 3D engine could not be loaded. Please check your internet connection.</small>
            </div>`;
            return;
        }

        if (!skinViewer) {
            console.log('[SKIN] Creating new SkinViewer instance...');
            // Show loading state
            container.innerHTML = '<div class="skin-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Initializing 3D Renderer...</div>';
            
            try {
                const canvas = document.createElement('canvas');
                canvas.style.opacity = '0';
                canvas.style.transition = 'opacity 0.5s ease';
                
                // Use safe defaults for dimensions
                const w = container.clientWidth || 300;
                const h = container.clientHeight || 400;

                skinViewer = new skinview3d.SkinViewer({
                    canvas: canvas,
                    width: w,
                    height: h,
                    skin: 'https://minotar.net/skin/Steve'
                });
                
                container.innerHTML = '';
                container.appendChild(skinViewer.canvas);
                
                // Camera Position
                skinViewer.camera.position.set(0, 10, 30);
                skinViewer.zoom = 0.8;

                const T = window.THREE || (typeof skinview3d !== 'undefined' ? skinview3d.THREE : null);
                if (T && skinViewer.scene && typeof skinViewer.scene.add === 'function') {
                    try {
                        console.log('[SKIN] THREE.js detected, setting up lighting...');
                        const ambient = new T.AmbientLight(0xffffff, 0.35);
                        skinViewer.scene.add(ambient);

                        const sun = new T.DirectionalLight(0xffffff, 0.45);
                        sun.position.set(10, 20, 10);
                        skinViewer.scene.add(sun);

                        const rimColor = varColorToHex('--accent') || 0x3b82f6;
                        const rim = new T.PointLight(rimColor, 0.8, 50);
                        rim.position.set(-15, 15, -15);
                        skinViewer.scene.add(rim);

                        const backLight = new T.DirectionalLight(0xffffff, 0.15);
                        backLight.position.set(0, -10, -20);
                        skinViewer.scene.add(backLight);
                    } catch (lightErr) {
                        console.warn('[SKIN] Lighting setup skipped:', lightErr);
                    }
                }

                // Controls
                try {
                    if (skinview3d.createOrbitControls) {
                        skinview3d.createOrbitControls(skinViewer);
                    }
                } catch (ctrlErr) {
                    console.warn('[SKIN] Orbit controls skipped:', ctrlErr);
                }

                // Random pose on every visit — supports both old (v2.x:
                // viewer.animations.add(Class)) and new (v3.x:
                // viewer.animation = new Class()) APIs.
                setRandomSkinPose();
                
                // Fade in
                setTimeout(() => { canvas.style.opacity = '1'; }, 100);
                console.log('[SKIN] SkinViewer successfully initialized.');

                // Load last selected skin
                try {
                    const lastSkin = await soul.getSetting('lastSkin');
                    const lastSkinIsBuiltin = await soul.getSetting('lastSkinIsBuiltin');
                    if (lastSkin) {
                        selectedSkin = lastSkin;
                        if (lastSkinIsBuiltin) {
                            currentSkinSource = `https://minotar.net/skin/${lastSkin}`;
                        } else {
                            const fullPath = await soul.getSkinPath(lastSkin);
                            if (fullPath) currentSkinSource = `file://${fullPath}`;
                        }
                        if (skinViewer) skinViewer.loadSkin(currentSkinSource, { model: selectedSkinModel });
                        // Highlight in grid
                        const grid = document.getElementById('skin-history-grid');
                        if (grid) {
                            grid.querySelectorAll('.skin-item').forEach(i => i.classList.remove('active'));
                            const items = grid.querySelectorAll('.skin-item');
                            for (const item of items) {
                                if (item.title === lastSkin) {
                                    item.classList.add('active');
                                    break;
                                }
                            }
                        }
                    }
                } catch (_) {}

                // Load last selected cape
                try {
                    const lastCape = await soul.getSetting('lastCape');
                    if (lastCape && skinViewer) {
                        selectedCape = lastCape;
                        const fullCapePath = await soul.getCapePath(lastCape);
                        if (fullCapePath) {
                            skinViewer.loadCape(toFileSrc(fullCapePath), { makeVisible: true, backEquipment: 'cape' });
                            const cGrid = document.getElementById('cape-history-grid');
                            if (cGrid) {
                                cGrid.querySelectorAll('.skin-item').forEach(i => i.classList.remove('active'));
                                const cItems = cGrid.querySelectorAll('.skin-item');
                                for (const item of cItems) {
                                    if (item.title === lastCape) {
                                        item.classList.add('active');
                                        break;
                                    }
                                }
                            }
                        }
                    } else if (skinViewer) {
                        skinViewer.loadCape(null);
                    }
                } catch (_) {}

            } catch (err) {
                console.error('[SKIN] Renderer Init Failed:', err);
                container.innerHTML = `<div class="skin-error"><i class="fa-solid fa-triangle-exclamation"></i> Renderer Failed<br><small>${err.message}</small></div>`;
            }
        } else {
            console.log('[SKIN] SkinViewer already exists, refreshing state.');
            setRandomSkinPose();
        }

        // Zoom Controls
        const zIn = document.getElementById('skin-zoom-in');
        const zOut = document.getElementById('skin-zoom-out');
        const zRes = document.getElementById('skin-zoom-reset');
        if (zIn) zIn.onclick = () => { if (skinViewer) skinViewer.zoom = Math.min(skinViewer.zoom + 0.1, 2); };
        if (zOut) zOut.onclick = () => { if (skinViewer) skinViewer.zoom = Math.max(skinViewer.zoom - 0.1, 0.2); };
        if (zRes) zRes.onclick = () => { 
            if (skinViewer) {
                skinViewer.zoom = 0.8; 
                if (skinViewer.controls) skinViewer.controls.reset(); 
            }
        };

        // Screenshot — capture skin + cape on transparent background
        const zShot = document.getElementById('btn-skin-screenshot')
            || document.getElementById('skin-screenshot');
        if (zShot) zShot.onclick = () => {
            if (!skinViewer || !skinViewer.canvas) return;
            try {
                const canvas = skinViewer.canvas;

                // Preserve current state
                const prevBg = skinViewer.background;
                const prevAutoRotate = skinViewer.autoRotate;
                const prevAnimation = skinViewer.animation;
                const prevPaused = skinViewer.renderPaused;
                const prevAnimationsRoot = skinViewer.animations;
                const prevAnimList = prevAnimationsRoot && Array.isArray(prevAnimationsRoot.animations)
                    ? prevAnimationsRoot.animations.slice()
                    : null;

                // Freeze pose and clear background so PNG is transparent
                try { skinViewer.background = null; } catch {}
                try { if (skinViewer.scene) skinViewer.scene.background = null; } catch {}
                try { skinViewer.autoRotate = false; } catch {}
                try { if (skinViewer.animation) skinViewer.animation = null; } catch {}
                try {
                    if (prevAnimationsRoot && Array.isArray(prevAnimationsRoot.animations)) {
                        prevAnimationsRoot.animations = [];
                    }
                } catch {}

                // Ensure renderer clears with alpha = 0
                try {
                    if (skinViewer.renderer && skinViewer.renderer.setClearColor) {
                        skinViewer.renderer.setClearColor(0x000000, 0);
                    }
                } catch {}

                // Force a fresh render in the current pose
                try { skinViewer.render(); } catch {}

                const dataUrl = canvas.toDataURL('image/png');

                // Restore
                try { skinViewer.background = prevBg; } catch {}
                try { skinViewer.autoRotate = prevAutoRotate; } catch {}
                try { skinViewer.animation = prevAnimation; } catch {}
                try { skinViewer.renderPaused = prevPaused; } catch {}
                try {
                    if (prevAnimationsRoot && prevAnimList) {
                        prevAnimationsRoot.animations = prevAnimList;
                    }
                } catch {}
                try { skinViewer.render(); } catch {}

                // Trigger download
                const a = document.createElement('a');
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                a.href = dataUrl;
                a.download = `skin-${stamp}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();

                if (window.notifications && window.notifications.show) {
                    window.notifications.show('success', 'Screenshot Saved', 'Transparent PNG downloaded.');
                }
            } catch (err) {
                console.error('[SKIN] Screenshot failed:', err);
                if (window.notifications && window.notifications.show) {
                    window.notifications.show('error', 'Screenshot Failed', err && err.message ? err.message : 'Unknown error');
                }
            }
        };

        // Force resize update
        setTimeout(() => {
            if (skinViewer && container.clientWidth > 0) {
                skinViewer.width = container.clientWidth;
                skinViewer.height = container.clientHeight;
            }
        }, 200);

        // History/instances are already loaded at the top of initSkinView.
        // Do NOT reload here — concurrent reloads race and produce duplicate tiles.

        initSkinSearch();
    }

    function varColorToHex(varName) {
        const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        if (!color) return null;
        if (color.startsWith('#')) return parseInt(color.replace('#', '0x'));
        if (color.startsWith('rgb')) {
            const matches = color.match(/\d+/g);
            if (matches && matches.length >= 3) {
                return (parseInt(matches[0]) << 16) + (parseInt(matches[1]) << 8) + parseInt(matches[2]);
            }
        }
        return null;
    }

    let _loadingSkinHistory = false;
    async function loadSkinHistory() {
        if (_loadingSkinHistory) return;
        _loadingSkinHistory = true;
        const gridSkin = document.getElementById('skin-history-grid');
        if (gridSkin) showSkeleton(gridSkin, 'skinHistory', 8);
        try {
            const grid = document.getElementById('skin-history-grid');
            if (!grid) return;
            const filter = (document.getElementById('skin-filter')?.value || '').toLowerCase().trim();
            const skinsRaw = await soul.getSkins() || [];
            const skins = Array.from(new Set(skinsRaw)).filter(s => !filter || s.toLowerCase().includes(filter));
            grid.innerHTML = '';
            renderSkinItem(grid, 'Steve', 'https://minotar.net/skin/Steve', true);
            renderSkinItem(grid, 'Alex',  'https://minotar.net/skin/Alex',  true);
            for (const s of skins) {
                const fullPath = await soul.getSkinPath(s);
                renderSkinItem(grid, s, fullPath);
            }
            const countEl = document.getElementById('skin-count');
            if (countEl) countEl.textContent = String(skins.length + 2);
        } catch (err) {
            console.error('Skin Load Error:', err);
        } finally {
            _loadingSkinHistory = false;
        }
    }

    async function applySearchedSkin(name) {
        if (!skinViewer) return;
        try {
            // Downloaded in the main process: renderer fetch() is blocked by
            // CORS on responses without ACAO headers, Node is not.
            const fileName = await soul.downloadSkinName(name);
            selectedSkin = fileName;
            soul.setSetting('lastSkin', fileName);
            soul.setSetting('lastSkinIsBuiltin', false);
            const fullPath = await soul.getSkinPath(fileName);
            if (fullPath) {
                currentSkinSource = toFileSrc(fullPath);
                skinViewer.loadSkin(currentSkinSource, { model: selectedSkinModel });
            }
            loadSkinHistory();
            window.notifications.show('success', 'Skin Saved', `${name} skin downloaded and added to My Skins.`);
        } catch (err) {
            window.notifications.show('error', 'Skin Error', err.message || 'Failed to load skin.');
        }
    }

    // Player-name skin search: downloads the skin straight into the
    // library and previews it — no extra tabs or cards.
    async function runSkinSearch(query) {
        const cleanQuery = String(query || '').trim();
        if (!cleanQuery) {
            window.notifications.show('info', 'Enter a Name', 'Type a Minecraft player name to download their skin.');
            return;
        }
        await applySearchedSkin(cleanQuery);
    }

    function initSkinSearch() {
        const searchInput = document.getElementById('skin-search-input');
        const searchButton = document.getElementById('btn-skin-search');
        const filterInput = document.getElementById('skin-filter');

        if (searchButton) searchButton.onclick = () => runSkinSearch(searchInput?.value || '');
        if (searchInput) {
            searchInput.onkeypress = (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    runSkinSearch(searchInput.value);
                }
            };
        }
        if (filterInput && !filterInput.dataset.wired) {
            filterInput.dataset.wired = '1';
            filterInput.addEventListener('input', () => loadSkinHistory());
        }
    }

    function renderSkinItem(grid, name, path, isBuiltin = false) {
        const item = document.createElement('div');
        item.className = 'skin-item' + (selectedSkin === name ? ' active' : '');
        item.title = name;
        
        const img = document.createElement('img');
        img.src = isBuiltin ? path : `file://${path}`;
        item.appendChild(img);

        if (!isBuiltin) {
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-remove';
            delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            delBtn.title = 'Delete Skin';
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`Delete skin "${name}"?`)) {
                    await soul.deleteSkin(name);
                    if (selectedSkin === name) {
                        selectedSkin = 'Steve';
                        currentSkinSource = 'https://minotar.net/skin/Steve';
                        if (skinViewer) skinViewer.loadSkin(currentSkinSource, { model: selectedSkinModel });
                    }
                    loadSkinHistory();
                }
            };
            item.appendChild(delBtn);
        }
        
        item.onclick = () => {
            selectedSkin = name;
            grid.querySelectorAll('.skin-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            if (skinViewer) {
                currentSkinSource = isBuiltin ? path : `file://${path}`;
                skinViewer.loadSkin(currentSkinSource, { model: selectedSkinModel });
            }
            soul.setSetting('lastSkin', name);
            soul.setSetting('lastSkinIsBuiltin', isBuiltin);
        };

        grid.appendChild(item);
    }

    let _loadingCapeHistory = false;
    let _capesCache = [];
    let _capeFilter = '';
    async function loadCapeHistory() {
        if (_loadingCapeHistory) return;
        _loadingCapeHistory = true;
        const gridEarly = document.getElementById('cape-history-grid');
        if (gridEarly) showSkeleton(gridEarly, 'skinHistory', 4);
        const grid = document.getElementById('cape-history-grid');
        if (!grid) { _loadingCapeHistory = false; return; }
        try {
            const capesRaw = await soul.getCapes() || [];
            _capesCache = Array.from(new Set(capesRaw));
            await renderCapeGrid();
        } catch (err) {
            console.error('Cape Load Error:', err);
        } finally {
            _loadingCapeHistory = false;
        }
    }
    async function renderCapeGrid() {
        const grid = document.getElementById('cape-history-grid');
        const countEl = document.getElementById('cape-count');
        const activeBadge = document.getElementById('cape-active-badge');
        const emptyEl = document.getElementById('cape-empty');
        const searchEl = document.getElementById('cape-search');
        if (!grid) return;
        // filter
        const q = (_capeFilter || '').toLowerCase().trim();
        const filtered = q ? _capesCache.filter(n => n.toLowerCase().includes(q)) : _capesCache.slice();
        // header badges
        if (countEl) countEl.textContent = String(_capesCache.length);
        if (activeBadge) activeBadge.classList.toggle('hidden', selectedCape === null);
        // empty state
        const hasAny = _capesCache.length > 0;
        const hasFiltered = filtered.length > 0;
        if (emptyEl) {
            const showEmpty = !hasAny;
            emptyEl.classList.toggle('hidden', !showEmpty);
            if (showEmpty) {
                grid.innerHTML = '';
                grid.style.display = 'none';
                return;
            }
            grid.style.display = '';
        }
        if (!hasFiltered && hasAny) {
            grid.innerHTML = `<div style="grid-column:1/-1;padding:18px;text-align:center;border:2px dashed var(--line-dim);background:rgba(255,255,255,.02);font-family:'JetBrains Mono',monospace;font-size:11px;opacity:.6;">No capes match "${q}"</div>`;
            return;
        }
        grid.innerHTML = '';
        // None card
        const noneCard = document.createElement('div');
        noneCard.className = 'cape-card' + (selectedCape === null ? ' active' : '');
        noneCard.title = 'No cape';
        noneCard.innerHTML = `
            <div class="cape-card-media"><span class="cape-none-icon"><i class="fa-solid fa-ban"></i></span><span class="cape-card-badge">None</span></div>
            <div class="cape-card-info"><div class="cape-card-name">No Cape</div><div class="cape-card-meta"><span class="cape-card-pill ${selectedCape===null?'on':''}">${selectedCape===null?'Selected':'Select'}</span></div></div>`;
        noneCard.onclick = () => {
            selectedCape = null;
            grid.querySelectorAll('.cape-card').forEach(c => c.classList.remove('active'));
            noneCard.classList.add('active');
            if (skinViewer) { try { skinViewer.loadCape(null); } catch(_){} }
            soul.setSetting('lastCape', '');
            const ab = document.getElementById('cape-active-badge'); if (ab) ab.classList.add('hidden');
            // update none pill
            renderCapeGrid();
        };
        grid.appendChild(noneCard);
        for (const c of filtered) {
            const fullPath = await soul.getCapePath(c);
            const ext = (c.split('.').pop()||'').toLowerCase();
            const isGif = ext === 'gif';
            const card = document.createElement('div');
            card.className = 'cape-card' + (selectedCape === c ? ' active' : '');
            card.title = c;
            card.innerHTML = `
                <div class="cape-card-media">
                    <img src="${toFileSrc(fullPath)}" alt="${c}" loading="lazy" onerror="this.style.opacity=.25">
                    <span class="cape-card-badge">${isGif?'GIF':'PNG'}</span>
                    <button class="cape-card-delete" title="Delete Cape"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="cape-card-info">
                    <div class="cape-card-name" title="${c}">${c}</div>
                    <div class="cape-card-meta">
                        <span class="cape-card-pill ${selectedCape===c?'on':''}">${selectedCape===c?'Active':'Ready'}</span>
                        <span class="cape-card-pill">${ext.toUpperCase()}</span>
                    </div>
                </div>`;
            const delBtn = card.querySelector('.cape-card-delete');
            if (delBtn) delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`Delete cape "${c}"?`)) {
                    await soul.deleteCape(c);
                    if (selectedCape === c) { selectedCape = null; if (skinViewer) try{skinViewer.loadCape(null);}catch(_){} soul.setSetting('lastCape',''); }
                    _capesCache = _capesCache.filter(x=>x!==c);
                    await loadCapeHistory();
                }
            };
            card.onclick = (e) => {
                if (e.target.closest('.cape-card-delete')) return;
                selectedCape = c;
                grid.querySelectorAll('.cape-card').forEach(el => el.classList.remove('active'));
                card.classList.add('active');
                if (skinViewer) skinViewer.loadCape(toFileSrc(fullPath), { makeVisible:true, backEquipment:'cape' });
                soul.setSetting('lastCape', c);
                renderCapeGrid();
            };
            // quick hover preview (debounced)
            let hoverTimer=null;
            card.onmouseenter = () => {
                if (selectedCape === c) return;
                hoverTimer = setTimeout(()=>{ if(skinViewer) try{skinViewer.loadCape(toFileSrc(fullPath), { makeVisible:true, backEquipment:'cape' }); card.classList.add('previewing');}catch(_){} }, 280);
            };
            card.onmouseleave = () => {
                clearTimeout(hoverTimer);
                card.classList.remove('previewing');
                if (selectedCape && selectedCape !== c) {
                    soul.getCapePath(selectedCape).then(p=>{ if(p && skinViewer) try{skinViewer.loadCape(toFileSrc(p), {makeVisible:true, backEquipment:'cape'});}catch(_){}}).catch(()=>{});
                } else if (!selectedCape) {
                    if(skinViewer) try{skinViewer.loadCape(null);}catch(_){}
                }
            };
            grid.appendChild(card);
        }
    }
    // cape search wiring (idempotent)
    (function initCapeSearch(){
        const inp = document.getElementById('cape-search');
        const section = document.getElementById('cape-section');
        if (inp && !inp.dataset.wired) {
            inp.dataset.wired='1';
            inp.addEventListener('input', () => { _capeFilter = inp.value; renderCapeGrid(); });
        }
        const emptyBtn = document.getElementById('btn-cape-empty-upload');
        if (emptyBtn && !emptyBtn.dataset.wired) {
            emptyBtn.dataset.wired='1';
            emptyBtn.onclick = () => document.getElementById('btn-upload-cape')?.click();
        }
        if (section && !section.dataset.dropWired) {
            section.dataset.dropWired='1';
            const hint = document.getElementById('cape-drop-hint');
            let dragDepth=0;
            section.addEventListener('dragenter', (e)=>{ e.preventDefault(); dragDepth++; section.classList.add('drag-over'); });
            section.addEventListener('dragover', (e)=>{ e.preventDefault(); section.classList.add('drag-over'); });
            section.addEventListener('dragleave', (e)=>{ e.preventDefault(); dragDepth=Math.max(0,dragDepth-1); if(dragDepth===0) section.classList.remove('drag-over'); });
            section.addEventListener('drop', async (e)=>{
                e.preventDefault(); section.classList.remove('drag-over'); dragDepth=0;
                const files = [...(e.dataTransfer?.files||[])].filter(f=> /\.(png|gif)$/i.test(f.name));
                if(!files.length) return;
                for(const f of files){
                    try{
                        const buf = await f.arrayBuffer();
                        await soul.saveCape(buf, f.name);
                    }catch(err){ console.warn('Cape drop save failed', err); }
                }
                const last = files[files.length-1]?.name;
                if(last){ selectedCape=last; soul.setSetting('lastCape', last); const p=await soul.getCapePath(last); if(p && skinViewer) skinViewer.loadCape(toFileSrc(p),{makeVisible:true,backEquipment:'cape'}); }
                loadCapeHistory();
                window.notifications.show('success','Cape Uploaded', files.length===1? `${files[0].name} added.` : `${files.length} capes added.`);
            });
        }
    })();
    // Elytra upload UI removed — CustomSkinLoader backend support kept in main process.

    async function loadSkinTargetInstances() {
        const select = document.getElementById('skin-target-instance');
        if (!select) return;
        
        const insts = await soul.getInstances();
        select.innerHTML = '<option value="">Select Instance...</option>';
        
        insts.forEach(inst => {
            if (inst.loader === 'fabric' || inst.loader === 'forge') {
                const opt = document.createElement('option');
                opt.value = inst.name;
                opt.textContent = `${inst.name} (${inst.mcversion || inst.version})`;
                select.appendChild(opt);
            }
        });

        if (selectedInstance && (selectedInstance.loader === 'fabric' || selectedInstance.loader === 'forge')) {
            select.value = selectedInstance.name;
        }
    }

    function initSkinEvents() {
        const btnUploadSkin = document.getElementById('btn-upload-skin');
        const btnUploadCape = document.getElementById('btn-upload-cape');
        const btnApplyAll = document.getElementById('btn-apply-skin-all');
        const btnRefreshInsts = document.getElementById('btn-refresh-skin-instances');
        const btnClearSkins = document.getElementById('btn-clear-skin-history');
        const btnClearCapes = document.getElementById('btn-clear-cape-history');
        const btnClassic = document.getElementById('btn-model-classic');
        const btnSlim = document.getElementById('btn-model-slim');
        const statusEl = document.getElementById('skin-apply-status');
        const statusText = document.getElementById('skin-apply-status-text');

        if (btnClearSkins) {
            btnClearSkins.onclick = async () => {
                if (confirm('Are you sure you want to clear ALL uploaded skins?')) {
                    await soul.deleteAllSkins();
                    loadSkinHistory();
                    window.notifications.show('success', 'History Cleared', 'All uploaded skins have been removed.');
                }
            };
        }

        if (btnClearCapes) {
            btnClearCapes.onclick = async () => {
                if (confirm('Are you sure you want to clear ALL uploaded capes?')) {
                    await soul.deleteAllCapes();
                    loadCapeHistory();
                    window.notifications.show('success', 'History Cleared', 'All uploaded capes have been removed.');
                }
            };
        }

        if (btnRefreshInsts) {
            btnRefreshInsts.onclick = async () => {
                const icon = btnRefreshInsts.querySelector('i');
                if (icon) icon.classList.add('fa-spin');
                await loadInstances();
                populateInstanceSelectors();
                setTimeout(() => {
                    if (icon) icon.classList.remove('fa-spin');
                    window.notifications.show('info', 'Instances Updated', 'Fabric instance list refreshed.');
                }, 500);
            };
        }

        const setApplyStatus = (msg, loading = true, error = false) => {
            if (statusEl) {
                statusEl.classList.add('active');
                if (error) {
                    statusEl.style.color = '#ef4444';
                    statusEl.querySelector('i').className = 'fa-solid fa-circle-exclamation';
                } else if (!loading) {
                    statusEl.style.color = '#4ade80';
                    statusEl.querySelector('i').className = 'fa-solid fa-circle-check';
                } else {
                    statusEl.style.color = 'var(--accent)';
                    statusEl.querySelector('i').className = 'fa-solid fa-circle-notch fa-spin';
                }
            }
            if (statusText) statusText.textContent = msg;
        };

        const applyModel = async (model) => {
            selectedSkinModel = model;
            if (skinViewer) {
                try {
                    if (skinViewer.playerObject && skinViewer.playerObject.skin) {
                        skinViewer.playerObject.skin.modelType = model;
                    }
                } catch (_) {}

                if (currentSkinSource) {
                    try { await skinViewer.loadSkin(null); } catch (_) {}
                    try {
                        await skinViewer.loadSkin(currentSkinSource, { model });
                        if (skinViewer.playerObject && skinViewer.playerObject.skin) {
                            skinViewer.playerObject.skin.visible = true;
                        }
                    } catch (err) {
                        console.warn('[SKIN] model reload failed:', err);
                    }
                }
            }
            if (btnClassic) btnClassic.classList.toggle('btn-secondary', model !== 'default');
            if (btnSlim) btnSlim.classList.toggle('btn-secondary', model !== 'slim');
        };
        if (btnClassic) btnClassic.onclick = async () => await applyModel('default');
        if (btnSlim) btnSlim.onclick = async () => await applyModel('slim');
        applyModel(selectedSkinModel);

        // Drag & Drop
        const container = document.getElementById('skin-viewer-container');
        if (container) {
            container.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); container.style.background = 'rgba(var(--accent-rgb), 0.2)'; };
            container.ondragleave = (e) => { e.preventDefault(); e.stopPropagation(); container.style.background = ''; };
            container.ondrop = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                container.style.background = '';
                
                const files = e.dataTransfer.files;
                if (files && files.length > 0) {
                    const file = files[0];
                    const isPng = file.type === 'image/png';
                    const isGif = file.type === 'image/gif';
                    if (!isPng && !isGif) {
                        window.notifications.show('error', 'Invalid File', 'Please drop a PNG or GIF image.');
                        return;
                    }

                    const buffer = await file.arrayBuffer();
                    
                    const imgTest = new Image();
                    imgTest.src = URL.createObjectURL(new Blob([buffer]));
                    imgTest.onload = async () => {
                        const isSkin = imgTest.width === imgTest.height;
                        if (isSkin) {
                            await soul.saveSkin(buffer, file.name);
                            loadSkinHistory();
                            selectedSkin = file.name;
                            soul.setSetting('lastSkin', file.name);
                            soul.setSetting('lastSkinIsBuiltin', false);
                            const fullPath = await soul.getSkinPath(file.name);
                            if (skinViewer && fullPath) {
                                currentSkinSource = `file://${fullPath}`;
                                skinViewer.loadSkin(currentSkinSource, { model: selectedSkinModel });
                            }
                            window.notifications.show('success', 'Skin Uploaded', 'Skin added via drag & drop.');
                        } else {
                            await soul.saveCape(buffer, file.name);
                            loadCapeHistory();
                            selectedCape = file.name;
                            soul.setSetting('lastCape', file.name);
                            const fullCapePath = await soul.getCapePath(file.name);
                            if (skinViewer && fullCapePath) {
                                skinViewer.loadCape(toFileSrc(fullCapePath), { makeVisible: true, backEquipment: 'cape' });
                            }
                            window.notifications.show('success', 'Cape Uploaded', 'Cape added via drag & drop.');
                        }
                    };
                    imgTest.onerror = () => {
                        window.notifications.show('error', 'Invalid Image', 'The dropped file is not a valid PNG.');
                    };
                }
            };
        }

        // Upload guard to prevent double-fire (double-click opens 2 dialogs ->
        // 2 saves -> 2 history entries).
        let _uploadingSkin = false;
        let _uploadingCape = false;

        if (btnUploadSkin) {
            btnUploadSkin.onclick = async () => {
                if (_uploadingSkin) return;
                _uploadingSkin = true;
                btnUploadSkin.disabled = true;
                try {
                    const files = await soul.selectFile([{ name: 'Images', extensions: ['png'] }]);
                    if (files && files.length > 0) {
                        // Dedup paths in case the dialog returns the same file twice
                        const unique = Array.from(new Set(Array.isArray(files) ? files : [files]));
                        for (const filePath of unique) {
                            try {
                                const blob = await fetch(`file://${filePath}`).then(r => r.blob());
                                const buffer = await blob.arrayBuffer();
                                const name = filePath.split(/[\\/]/).pop();
                                await soul.saveSkin(buffer, name);
                                selectedSkin = name;
                                soul.setSetting('lastSkin', name);
                                soul.setSetting('lastSkinIsBuiltin', false);
                                const fullPath = await soul.getSkinPath(name);
                                if (skinViewer && fullPath) {
                                    currentSkinSource = `file://${fullPath}`;
                                    skinViewer.loadSkin(currentSkinSource, { model: selectedSkinModel });
                                }
                            } catch (err) {
                                window.notifications.show('error', 'Upload Failed', err.message);
                            }
                        }
                        loadSkinHistory();
                        window.notifications.show('success', 'Skin Uploaded', 'Your skin has been added to history.');
                    }
                } finally {
                    _uploadingSkin = false;
                    btnUploadSkin.disabled = false;
                }
            };
        }

        if (btnUploadCape) {
            btnUploadCape.onclick = async () => {
                if (_uploadingCape) return;
                _uploadingCape = true;
                btnUploadCape.disabled = true;
                try {
                    const files = await soul.selectFile([{ name: 'Images', extensions: ['png', 'gif'] }]);
                    if (files && files.length > 0) {
                        const unique = Array.from(new Set(Array.isArray(files) ? files : [files]));
                        let lastName = '';
                        for (const filePath of unique) {
                            try {
                                const blob = await fetch(`file://${filePath}`).then(r => r.blob());
                                const buffer = await blob.arrayBuffer();
                                const name = filePath.split(/[\\/]/).pop();
                                await soul.saveCape(buffer, name);
                                lastName = name;
                            } catch (err) {
                                window.notifications.show('error', 'Upload Failed', err.message);
                            }
                        }
                        loadCapeHistory();
                        if (lastName) {
                            selectedCape = lastName;
                            soul.setSetting('lastCape', lastName);
                            const fullCapePath = await soul.getCapePath(lastName);
                            if (skinViewer && fullCapePath) {
                                skinViewer.loadCape(toFileSrc(fullCapePath), { makeVisible: true, backEquipment: 'cape' });
                            }
                        }
                        window.notifications.show('success', 'Cape Uploaded', 'Your cape has been added to history.');
                    }
                } finally {
                    _uploadingCape = false;
                    btnUploadCape.disabled = false;
                }
            };
        }

        if (btnApplyAll) {
            btnApplyAll.onclick = async () => {
                const targetInst = document.getElementById('skin-target-instance').value;
                if (!targetInst) {
                    window.notifications.show('error', 'Selection Required', 'Please select a Fabric or Forge instance.');
                    setApplyStatus('Select a Fabric or Forge instance.', false, true);
                    return;
                }

                if (!currentAccount) {
                    window.notifications.show('error', 'Login Required', 'Please login to apply skins.');
                    return;
                }

                // Steve / Alex are built-in preview URLs, not files on disk.
                // Sending them to the main process used to silently no-op.
                const isBuiltin = !selectedSkin || selectedSkin === 'Steve' || selectedSkin === 'Alex';
                if (isBuiltin && !selectedCape) {
                    window.notifications.show('error', 'No Custom Skin', 'Upload a skin (or pick one from History) before applying. Built-in Steve/Alex cannot be applied.');
                    setApplyStatus('Pick or upload a custom skin first.', false, true);
                    return;
                }
                const skinToSend = isBuiltin ? null : selectedSkin;

                btnApplyAll.disabled = true;
                setApplyStatus('Installing CustomSkinLoader...');

                try {
                    const result = await soul.applySkin(targetInst, currentAccount.name, skinToSend, selectedCape, selectedSkinModel, selectedElytra || null);
                    const parts = [];
                    if (result && result.appliedSkin) parts.push('Skin');
                    if (result && result.appliedCape) parts.push('Cape');
                    if (result && result.appliedElytra) parts.push('Elytra');
                    const what = parts.length ? parts.join(' & ') : 'Config';
                    setApplyStatus(`${what} Applied!`, false);
                    window.notifications.show('success', 'Success', `${what} applied! Restart Minecraft to see changes.`);

                    setTimeout(() => {
                        if (statusEl) statusEl.classList.remove('active');
                    }, 5000);
                } catch (err) {
                    setApplyStatus(`Error: ${err.message}`, false, true);
                    window.notifications.show('error', 'Application Failed', err.message);
                } finally {
                    btnApplyAll.disabled = false;
                }
            };
        }

        const btnMojang = document.getElementById('btn-upload-mojang');
        if (btnMojang) {
            btnMojang.onclick = async () => {
                const isBuiltin = !selectedSkin || selectedSkin === 'Steve' || selectedSkin === 'Alex';
                if (isBuiltin) {
                    window.notifications.show('error', 'No Custom Skin', 'Upload or pick a custom skin from History first.');
                    return;
                }
                if (!currentAccount || currentAccount.type !== 'microsoft') {
                    window.notifications.show('error', 'Microsoft Required', 'Log in with a Microsoft account to upload to Mojang.');
                    return;
                }
                btnMojang.disabled = true;
                setApplyStatus('Uploading skin to Mojang...');
                try {
                    await soul.uploadSkinMojang(selectedSkin, selectedSkinModel === 'slim' ? 'slim' : 'classic');
                    setApplyStatus('Mojang Skin Updated!', false);
                    window.notifications.show('success', 'Mojang Updated', 'Your official Minecraft skin was updated. It can take a minute to appear everywhere.');
                } catch (err) {
                    setApplyStatus(`Error: ${err.message}`, false, true);
                    window.notifications.show('error', 'Mojang Upload Failed', err.message);
                } finally {
                    btnMojang.disabled = false;
                }
            };
        }
    }

    // --- ACCOUNTS ---
    async function loadAccounts() {
        allAccounts = await soul.getSetting('accounts') || [];
        currentAccount = await soul.getSetting('currentAccount');

        if (currentAccount && !allAccounts.find(a => a.id === currentAccount.id)) {
            currentAccount = allAccounts[0] || null;
            await soul.setSetting('currentAccount', currentAccount);
        }

        updateAccountUI();

        if (currentAccount && btnPlay) {
            const isStale = currentAccount.type === 'microsoft' && !currentAccount.msmcSave;
            if (isStale) {
                btnPlay.classList.remove('btn-ready');
                window.notifications.show('warning', 'Session Stale', 'Microsoft data missing. Please re-login.');
            } else {
                btnPlay.classList.add('btn-ready');
            }
        }
    }
    // --- HERO CHARACTER (2D skinrender.dev full-body API, random pose) ---
    // Pose is picked once per launch, so every reload shows a new one.
    // Falls back to default Steve if the name has no profile.
    const HERO_POSES = ['default', 'walk', 'run', 'wave', 'sit', 'sneak', 'point', 'dab', 'zombie', 'tpose', 'cheer', 'think', 'flex', 'salute', 'dance', 'punch', 'shrug', 'jump'];
    const heroPose = HERO_POSES[Math.floor(Math.random() * HERO_POSES.length)];
    function updateHeroCharacter() {
        const img = document.getElementById('hero-char-img');
        const tag = document.getElementById('hero-char-name');
        if (!img || !tag) return;
        const name = (currentAccount && currentAccount.name) ? currentAccount.name : 'steve';
        tag.textContent = (currentAccount && currentAccount.name) ? currentAccount.name : 'Steve';
        refreshHeroRank();
        if (!img.dataset.errBound) {
            img.dataset.errBound = '1';
            img.addEventListener('error', () => {
                if (img.dataset.stage !== 'steve') {
                    img.dataset.stage = 'steve';
                    img.src = `https://skinrender.dev/render/steve/body?pose=${heroPose}&size=256`;
                }
            });
        }
        img.dataset.stage = 'name';
        img.src = `https://skinrender.dev/render/${encodeURIComponent(name)}/body?pose=${heroPose}&size=256`;
    }
    function updateAccountUI() {
        updateHeroCharacter();
        if (!currentAccount) {
            curUserName.textContent = "Guest";
            curUserImg.src = "../../assets/icons/icon.png";
            curUserType.textContent = "Offline";
            curUserType.style.color = "";
            if (btnPlay) btnPlay.classList.remove('btn-ready');
        } else {
            const isStale = currentAccount.type === 'microsoft' && !currentAccount.msmcSave;
            curUserName.textContent = currentAccount.name;
            curUserImg.src = currentAccount.type === 'microsoft' 
                ? (currentAccount.skin || `https://minotar.net/helm/${currentAccount.name}/64.png`)
                : 'https://minotar.net/helm/Steve/64.png';
            
            if (isStale) {
                curUserType.textContent = "Re-login required";
                curUserType.style.color = "#ff4444";
            } else {
                curUserType.textContent = currentAccount.type;
                curUserType.style.color = "";
            }
        }

        accountList.innerHTML = '';
        allAccounts.forEach(acc => {
            const item = document.createElement('div');
            item.className = `acc-item ${currentAccount && currentAccount.id === acc.id ? 'active' : ''}`;
            const skin = acc.type === 'microsoft' 
                ? (acc.skin || `https://minotar.net/helm/${acc.name}/64.png`)
                : 'https://minotar.net/helm/Steve/64.png';
            
            item.innerHTML = `
                <img src="${skin}">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 700; font-size: 13px;">${acc.name}</span>
                    <span style="font-size: 10px; opacity: 0.5;">${acc.type}</span>
                </div>
            `;
            item.onclick = () => selectAccount(acc);
            accountList.appendChild(item);
        });
    }

    async function selectAccount(acc) {
        currentAccount = acc;
        await soul.setSetting('currentAccount', acc);
        updateAccountUI();
        accDropdown.classList.remove('active');
        if (btnPlay) btnPlay.classList.add('btn-ready');
        window.notifications.show('success', 'Profile Switched', `Logged in as ${acc.name}`);

        // Sync new user to Firebase
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
            try {
                firebase.database().ref(`users/${acc.id}`).update({
                    id: acc.id,
                    name: acc.name,
                    type: acc.type,
                    os: typeof process !== 'undefined' ? process.platform : 'unknown',
                    version: "1.0.7",
                    lastSeen: Date.now()
                });
            } catch (_) {}
        }
    }

    // --- VERSIONS ---
    let lastConnectivityCheck = 0;
    let isOnline = true;

    async function checkConnectivity() {
        const now = Date.now();
        if (now - lastConnectivityCheck < 30000) return isOnline;
        lastConnectivityCheck = now;
        try {
            const ctrl = new AbortController();
            setTimeout(() => ctrl.abort(), 5000);
            await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json', {
                method: 'HEAD', signal: ctrl.signal
            });
            isOnline = true;
        } catch {
            isOnline = false;
        }
        return isOnline;
    }

    function getActiveLoaderPill() {
        const pills = document.getElementById('sc-loader-pills-launcher');
        if (!pills) return 'vanilla';
        const active = pills.querySelector('.v-type-pill.active');
        return active ? active.getAttribute('data-loader') : 'vanilla';
    }

    async function loadAllVersionsGrid() {
        const grid = document.getElementById('version-grid');
        const searchInput = document.getElementById('version-search');
        if (!grid) return;

        const rawFilter = getActiveLoaderPill();
        const filter = CREATABLE_LOADERS.has(rawFilter) ? rawFilter : 'vanilla';
        const query = searchInput ? searchInput.value.toLowerCase() : '';

        // Show/hide type pills: only meaningful for vanilla
        const typePillsWrap = document.getElementById('v-type-pills');
        if (typePillsWrap) {
            const isVanilla = filter === 'vanilla';
            typePillsWrap.querySelectorAll('.v-type-pill').forEach(p => {
                p.disabled = !isVanilla;
                p.style.opacity = isVanilla ? '' : '0.3';
                p.style.cursor = isVanilla ? '' : 'not-allowed';
            });
        }

        // Check connectivity for non-soulclient/non-kruthclient loaders
        if (filter !== 'soulclient' && filter !== 'kruthclient') {
            const online = await checkConnectivity();
            if (!online) {
                grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px;"><div style="color: #ef4444; font-size: 14px; margin-bottom: 8px;"><i class="fa-solid fa-wifi"></i> No internet connection</div><div style="font-size: 12px; opacity: 0.6; margin-bottom: 16px;">Cannot fetch the latest versions. Check your connection and try again.</div><button class="v-type-pill active" onclick="loadAllVersionsGrid()" style="cursor:pointer;"><i class="fa-solid fa-rotate"></i> Retry</button></div>';
                return;
            }
        }

        showSkeleton(grid, 'versions', 8);

        let versions = [];
        const loaderMeta = getLoaderMeta(filter);
        let loaderIcon = loaderMeta.icon;
        let iconColor = loaderMeta.color;

        try {
            if (filter === 'vanilla') {
                const data = await soul.getMcVersions();
                versions = (data.versions || []).map(v => ({
                    id: v.id,
                    type: v.type || 'release',
                    displayId: v.id
                }));
            } else if (filter === 'fabric') {
                const data = await soul.getFabricVersions();
                versions = getFabricReleaseChoices(data).map(v => ({
                    id: v.id,
                    type: 'release',
                    displayId: v.label
                }));
            } else if (filter === 'forge') {
                const data = await soul.getForgeVersions();
                versions = getForgeReleaseChoices(data).map(v => ({
                    id: v.id,
                    type: 'release',
                    displayId: v.label
                }));
            } else if (filter === 'soulclient') {
                if (soulVersionsCache.length > 0) {
                    versions = soulVersionsCache.map(v => ({
                        id: v.mcVersion,
                        type: 'release',
                        displayId: `${v.name} (MC ${v.mcVersion})`
                    }));
                }
            } else if (filter === 'kruthclient') {
                if (kruthVersionsCache.length > 0) {
                    versions = kruthVersionsCache.map(v => ({
                        id: v.mcVersion,
                        type: 'release',
                        displayId: `${v.name} (MC ${v.mcVersion})`
                    }));
                }
            }
        } catch (err) {
            console.error('Failed to load versions:', err);
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px;"><div style="color: #ef4444; font-size: 14px; margin-bottom: 8px;"><i class="fa-solid fa-triangle-exclamation"></i> Failed to load ${filter} versions</div><div style="font-size: 12px; opacity: 0.6; margin-bottom: 16px;">${err.message || 'Check your connection and try again.'}</div><button class="v-type-pill active" onclick="loadAllVersionsGrid()" style="cursor:pointer;"><i class="fa-solid fa-rotate"></i> Retry</button></div>`;
            return;
        }

        // Apply version type filter (only relevant for vanilla)
        if (filter === 'vanilla') {
            const typeMap = {
                release:  ['release'],
                snapshot: ['snapshot'],
                beta:     ['old_beta'],
                alpha:    ['old_alpha']
            };
            const allowed = typeMap[activeVersionType] || ['release'];
            versions = versions.filter(v => allowed.includes(v.type));
        }

        // Apply search query
        const filtered = versions.filter(v =>
            v.id.toLowerCase().includes(query) ||
            (v.displayId && v.displayId.toLowerCase().includes(query))
        );

        grid.innerHTML = '';
        if (filtered.length === 0) {
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; opacity: 0.5;">No ${filter} ${activeVersionType} versions found.</div>`;
            return;
        }

        // Type → label mapping
        const typeLabels = { release: loaderMeta.label.toUpperCase(), snapshot: 'SNAPSHOT', old_beta: 'BETA', old_alpha: 'ALPHA' };
        const typeColors  = { snapshot: '#a78bfa', old_beta: '#fb923c', old_alpha: '#f87171', release: iconColor };

        const fragment = document.createDocumentFragment();

        filtered.forEach((v, i) => {
            const card = document.createElement('div');
            const isActive = selectedInstance && selectedInstance.version === v.id && selectedInstance.loader === filter;
            card.className = `version-card ${isActive ? 'active' : ''}`;

            const labelColor = typeColors[v.type] || iconColor;
            const typeLabel  = typeLabels[v.type] || filter.toUpperCase();
            const isLatest = i === 0;

            const loaderImg = filter === 'vanilla' ? '../../assets/icon-ints/vannila.jpg' : filter === 'fabric' ? '../../assets/icon-ints/fabric.png' : filter === 'kruthclient' ? 'https://kruthclient.github.io/resources/logo.png' : filter === 'soulclient' ? '../../assets/icons/icon.png' : '../../assets/icon-ints/forge.png';

            card.innerHTML = `
                <div style="display: flex; align-items: center; min-width: 0; flex: 1;">
                    <div class="v-icon-wrap">
                        <img src="${loaderImg}" style="width: 24px; height: 24px; object-fit: contain;">
                    </div>
                    <div class="v-info">
                        <span class="v-id">${v.displayId}${isLatest ? ' <span style="font-size:9px;background:#22c55e;color:#000;padding:2px 6px;border-radius:4px;font-weight:800;margin-left:6px;">LATEST</span>' : ''}</span>
                        <span class="v-type" style="color: ${labelColor};">${typeLabel}</span>
                    </div>
                </div>
                <i class="fa-solid fa-play v-play-icon" style="flex-shrink: 0;"></i>
            `;
            card.onclick = async () => {
                console.log('[CARD] Clicked version:', v.displayId, 'filter:', filter);
                try {
                    await selectAndCreateInstance(v, filter);
                } catch (err) {
                    window.notifications.show('error', 'Selection Failed', err.message);
                }
            };
            fragment.appendChild(card);
        });
        grid.appendChild(fragment);
    }

    async function loadAllVersionsForSwitch() {
        const loaders = ['vanilla', 'fabric', 'forge', 'soulclient', 'kruthclient'];

        // BUGFIX: Fetch all loaders concurrently instead of one-by-one.
        const results = await Promise.allSettled(loaders.map(async (loader) => {
            try {
                const loaderMeta = getLoaderMeta(loader);
                const icon = loader === 'vanilla' ? '../../assets/icon-ints/vannila.jpg' : loader === 'fabric' ? '../../assets/icon-ints/fabric.png' : loader === 'kruthclient' ? 'https://kruthclient.github.io/resources/logo.png' : loader === 'soulclient' ? '../../assets/icons/icon.png' : '../../assets/icon-ints/forge.png';
                let versions = [];
                if (loader === 'vanilla') {
                    const data = await soul.getMcVersions();
                    versions = (data.versions || []).map(v => ({
                        id: v.id, displayId: v.id, type: v.type || 'release', loader, loaderLabel: loaderMeta.label, icon
                    }));
                } else if (loader === 'fabric') {
                    const data = await soul.getFabricVersions();
                    versions = getFabricReleaseChoices(data).map(v => ({
                        id: v.id, displayId: v.label, type: 'release', loader, loaderLabel: loaderMeta.label, icon
                    }));
                } else if (loader === 'forge') {
                    const data = await soul.getForgeVersions();
                    versions = getForgeReleaseChoices(data).map(v => ({
                        id: v.id, displayId: v.label, type: 'release', loader, loaderLabel: loaderMeta.label, icon
                    }));
                } else if (loader === 'soulclient') {
                    versions = soulVersionsCache.map(v => ({
                        id: v.mcVersion, displayId: `${v.name} (MC ${v.mcVersion})`, type: 'release', loader, loaderLabel: loaderMeta.label,
                        icon: '../../assets/icon-ints/fabric.png'
                    }));
                } else if (loader === 'kruthclient') {
                    versions = kruthVersionsCache.map(v => ({
                        id: v.mcVersion, displayId: `${v.name} (MC ${v.mcVersion})`, type: 'release', loader, loaderLabel: loaderMeta.label,
                        icon: 'https://kruthclient.github.io/resources/logo.png'
                    }));
                }
                return versions;
            } catch (e) {
                console.warn(`Failed to load ${loader} versions for switch:`, e);
                return [];
            }
        }));

        return results.reduce((acc, r) => {
            if (r.status === 'fulfilled') acc.push(...r.value);
            return acc;
        }, []);
    }

    async function selectAndCreateInstance(v, loader) {
        console.log('[SELECT] Called with loader:', loader, 'v:', v);
        if (!CREATABLE_LOADERS.has(loader)) {
            throw new Error('Only Vanilla, Fabric, Forge, Soul Client, and Kruth Client instance creation is available right now.');
        }

        // Soul Client and Kruth Client instances use Fabric under the hood
        const actualLoader = (loader === 'soulclient' || loader === 'kruthclient') ? 'fabric' : loader;

        const displayId = v.displayId || v.id;
        const instName = (loader === 'soulclient' || loader === 'kruthclient') ? displayId : `${getLoaderMeta(loader).label} ${displayId}`;

        // BUGFIX: Always refresh instances from disk before searching,
        // so we never work off a stale in-memory array.
        instances = await soul.getInstances();
        let existing = instances.find(i => i.version === v.id && (i.loader === loader || i.type === loader));
        
        if (!existing) {
            try {
                const newId = loader + '-' + v.id.replace(/[^a-zA-Z0-9]/g, '-') + '-' + Date.now();
                const newInst = { 
                    id: newId,
                    name: instName, 
                    version: v.id, 
                    mcversion: v.id,
                    loader: actualLoader,
                    type: loader === 'soulclient' ? 'soulclient' : loader === 'kruthclient' ? 'kruthclient' : undefined
                };
                await soul.createInstance(newInst);
                // BUGFIX: Re-fetch from disk after creation so we have the canonical saved object.
                instances = await soul.getInstances();
                existing = instances.find(i => i.id === newId)
                        || instances.find(i => i.name === instName)
                        || newInst;
            } catch (e) {
                // Instance may already exist under that name — find it
                instances = await soul.getInstances();
                existing = instances.find(i => i.name === instName)
                        || instances.find(i => i.version === v.id && i.loader === loader)
                        || { id: 'tmp-' + Date.now(), version: v.id, mcversion: v.id, loader: loader, name: instName };
            }
        }

        // Guarantee mcversion is always set (old instances may lack it)
        if (!existing.mcversion) existing.mcversion = existing.version;

        selectedInstance = existing;
        console.log('[SELECT] Instance selected:', selectedInstance.name, 'id:', selectedInstance.id, 'type:', selectedInstance.type);

        // BUGFIX: Only persist lastInstance when we have a real id.
        if (selectedInstance.id) {
            await soul.setSetting('lastInstance', selectedInstance.id);
        }

        // BUGFIX: Switch UI immediately so selection feels instant; downloads run in background.
        updateSelectedUI();
        loadAllVersionsGrid();
        switchView('home');
        const readyLabel = (loader === 'soulclient' || loader === 'kruthclient') ? displayId : `${getLoaderMeta(loader).label} ${displayId}`;
        window.notifications.show('success', 'Version Ready', `Selected ${readyLabel}`);
        console.log('[SELECT] Done - notification should have shown');

        // Background downloads for Soul/Kruth Client (mod + Fabric API + Mod Menu)
        if (loader === 'soulclient') {
            (async () => {
                const soulVersion = soulVersionsCache.find(sv => sv.mcVersion === v.id);
                if (soulVersion && soulVersion.downloadUrl) {
                    const filename = soulVersion.downloadUrl.split('/').pop().split('?')[0] || 'soulclient-mod.jar';
                    try {
                        const oldFilename = existing.soulModFilename;
                        if (oldFilename && oldFilename !== filename) {
                            try { await soul.deleteMod(existing.name, oldFilename); } catch (_) {}
                        }
                        await soul.downloadUrlToInstance(soulVersion.downloadUrl, existing.name, 'mods', filename);
                        await soul.setInstanceConfigField(existing.name, 'soulVersionCode', soulVersion.versionCode || 0);
                        await soul.setInstanceConfigField(existing.name, 'soulModFilename', filename);
                    } catch (e) {
                        console.warn('[SOUL CLIENT] Failed to download mod:', e);
                    }
                }
                try {
                    await soul.soulclientDownloadDeps(existing.name, v.id);
                } catch (e) {
                    console.warn('[SOUL CLIENT] Failed to download deps:', e);
                }
            })();
        }

        if (loader === 'kruthclient') {
            (async () => {
                const kruthVersion = kruthVersionsCache.find(sv => sv.mcVersion === v.id);
                if (kruthVersion && kruthVersion.downloadUrl) {
                    const filename = kruthVersion.downloadUrl.split('/').pop().split('?')[0] || 'kruthclient-mod.jar';
                    try {
                        const oldFilename = existing.kruthModFilename;
                        if (oldFilename && oldFilename !== filename) {
                            try { await soul.deleteMod(existing.name, oldFilename); } catch (_) {}
                        }
                        await soul.downloadUrlToInstance(kruthVersion.downloadUrl, existing.name, 'mods', filename);
                        await soul.setInstanceConfigField(existing.name, 'kruthVersionCode', kruthVersion.versionCode || 0);
                        await soul.setInstanceConfigField(existing.name, 'kruthModFilename', filename);
                    } catch (e) {
                        console.warn('[KRUTH CLIENT] Failed to download mod:', e);
                    }
                }
                try {
                    await soul.soulclientDownloadDeps(existing.name, v.id);
                } catch (e) {
                    console.warn('[KRUTH CLIENT] Failed to download deps:', e);
                }
            })();
        }
    }

    const versionSearch = document.getElementById('version-search');
    if (versionSearch) versionSearch.oninput = () => loadAllVersionsGrid();

    const btnSearchVersions = document.getElementById('btn-search-versions');
    if (btnSearchVersions) btnSearchVersions.onclick = () => loadAllVersionsGrid();

    // Loader pills for version grid
    document.querySelectorAll('#sc-loader-pills-launcher .v-type-pill').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#sc-loader-pills-launcher .v-type-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadAllVersionsGrid();
        };
    });

    // --- INSTANCES ---
    async function loadInstances() {
        instances = await soul.getInstances();
        try { loadRecentPlayed(); } catch (_) {}
        try { loadSoulBlog(); } catch (_) {}

        if (instances.length === 0) {
            instances = [
                { id: 'forge-default', name: 'Forge 1.8.9', version: '1.8.9', mcversion: '1.8.9', loader: 'forge' }
            ];
            await soul.createInstance(instances[0]);
        }

        // BUGFIX: Guarantee every instance has mcversion (old saves may lack it)
        instances.forEach(i => { if (!i.mcversion) i.mcversion = i.version; });

        const lastId = await soul.getSetting('lastInstance');
        const findById = () => instances.find(i => i.id === lastId || i.name === lastId);
        const findLatestVanilla = () => instances
            .filter(i => !i.loader || i.loader === 'vanilla')
            .sort((a, b) => compareVersions((b.mcversion || b.version), (a.mcversion || a.version)))[0];
        const findLatestAny = () => instances
            .sort((a, b) => compareVersions((b.mcversion || b.version), (a.mcversion || a.version)))[0];
        selectedInstance = findById() || findLatestVanilla() || findLatestAny() || instances[0];
        
        updateSelectedUI();
        populateInstanceSelectors();
        renderInstanceGrid();
        populateGroupFilter();
    }

    function populateInstanceSelectors() {
        // Addon Manager Select
        const addonSelect = document.getElementById('addon-instance-select');
        if (addonSelect) {
            const prevValue = addonSelect.value;
            addonSelect.innerHTML = '';
            instances.forEach(inst => {
                const option = document.createElement('option');
                option.value = inst.id;
                option.textContent = inst.name;
                addonSelect.appendChild(option);
            });
            addonSelect.value = prevValue && instances.some(i => i.id === prevValue) ? prevValue : (selectedInstance?.id || '');
        }

        // Skin Manager Select (Fabric & Forge)
        const skinSelect = document.getElementById('skin-target-instance');
        if (skinSelect) {
            const prevValue = skinSelect.value;
            skinSelect.innerHTML = '<option value="">Select Instance...</option>';
            const moddedInsts = instances.filter(i => i.loader === 'fabric' || i.loader === 'forge');
            
            if (moddedInsts.length === 0) {
                skinSelect.innerHTML = '<option value="">No Fabric/Forge Instances Found</option>';
            } else {
                moddedInsts.forEach(inst => {
                    const option = document.createElement('option');
                    option.value = inst.name;
                    option.textContent = `${inst.name} (${inst.mcversion || inst.version}) [${inst.loader}]`;
                    skinSelect.appendChild(option);
                });
                
                if (prevValue && moddedInsts.some(i => i.name === prevValue)) {
                    skinSelect.value = prevValue;
                } else if (selectedInstance && (selectedInstance.loader === 'fabric' || selectedInstance.loader === 'forge')) {
                    skinSelect.value = selectedInstance.name;
                }
            }
        }
    }

    const addonInstanceSelect = document.getElementById('addon-instance-select');
    if (addonInstanceSelect) {
        addonInstanceSelect.onchange = () => {
            loadFiles(activeFilesType, 'addon-list');
            if (activeAddonType === 'mods') renderModProfiles();
        };
    }

    async function updateSelectedUI() {
        const heroIcon = document.getElementById('hero-inst-icon');
        const heroIconWrap = document.getElementById('hero-inst-icon-wrap');
        const heroLoaderBadge = document.getElementById('hero-inst-loader-badge');
        const heroVerText = document.getElementById('hero-version-text');
        const launchBtn = document.getElementById('btn-play');


        if (!selectedInstance) {
            if (heroIcon) heroIcon.src = '../../assets/icons/icon.png';
            if (heroVerText) heroVerText.textContent = 'No Instance Selected';
            if (heroName) heroName.textContent = 'Minecraft';
            if (launchBtn) launchBtn.disabled = true;
            launchStatus.textContent = 'Create an instance to start';
            launchStatus.style.color = 'var(--gray4)';
            return;
        }

        if (launchBtn) launchBtn.disabled = false;
        launchStatus.textContent = 'Ready to Play';
        launchStatus.style.color = 'var(--gray4)';

        const loaderMeta = getLoaderMeta(selectedInstance.loader);
        const versionLabel = selectedInstance.mcversion || selectedInstance.version;

        if (heroIcon) {
            heroIcon.src = selectedInstance.iconDataUrl || loaderMeta.logo || '../../assets/icons/icon.png';
        }

        if (heroLoaderBadge) {
            const badgeImg = heroLoaderBadge.querySelector('img');
            if (badgeImg) {
                badgeImg.src = loaderMeta.logo || 'https://img.icons8.com/color/48/minecraft-grass-cube.png';
            }
        }

        const displayLabel = selectedInstance.type === 'soulclient' ? 'Soul Client' : loaderMeta.label;
        if (heroVerText) heroVerText.textContent = `${displayLabel} ${versionLabel}`;
        if (heroName) heroName.textContent = selectedInstance.name;

        // Pop animation on icon
        if (heroIconWrap) {
            heroIconWrap.classList.remove('pop');
            void heroIconWrap.offsetWidth;
            heroIconWrap.classList.add('pop');
        }

        // Refresh mod count for selected instance
        try { await refreshSelectedModCount(); } catch (_) {}

        // Update hero Java choice button
        try {
            if (btnJavaSelect && selectedInstance) {
                const choice = await soul.getInstanceJavaChoice(selectedInstance.name);
                const pretty = choice && choice.mode
                    ? (choice.mode === 'auto' ? 'Auto'
                        : (choice.mode === 'managed' ? `Java ${choice.version}` : 'Custom'))
                    : 'Auto';
                if (btnJavaSelectText) btnJavaSelectText.textContent = pretty;
                btnJavaSelect.dataset.javaChoiceMode = choice?.mode || 'auto';
            }
        } catch (e) {
            if (btnJavaSelectText) btnJavaSelectText.textContent = 'Auto';
        }

    }


    // ── Java selector (hero button → proper dropdown menu) ─────
    let javaMenuEl = null;
    function closeJavaMenu() {
        if (javaMenuEl) { javaMenuEl.remove(); javaMenuEl = null; }
        document.removeEventListener('mousedown', javaMenuOutside, true);
    }
    function javaMenuOutside(e) {
        if (javaMenuEl && !javaMenuEl.contains(e.target) && e.target !== btnJavaSelect) closeJavaMenu();
    }

    async function applyJavaChoice(choicePayload) {
        try {
            await soul.setInstanceJavaChoice(selectedInstance.name, choicePayload);
            await updateSelectedUI();
            window.notifications.show('success', 'Java Updated', 'Java choice saved for this instance.');
        } catch (e) {
            window.notifications.show('error', 'Java Error', e.message || 'Failed to save.');
        }
    }

    if (btnJavaSelect) {
        btnJavaSelect.onclick = async (ev) => {
            ev.stopPropagation();
            if (!selectedInstance) {
                window.notifications.show('warning', 'No Instance', 'Select an instance first.');
                return;
            }
            if (javaMenuEl) { closeJavaMenu(); return; }

            const currentChoice = await soul.getInstanceJavaChoice(selectedInstance.name);
            const currentMode = currentChoice?.mode || 'auto';
            const currentVer = currentChoice?.version || '';

            const items = [
                { key: 'auto',   label: 'Auto (matches MC version)', mode: 'auto' },
                { sep: true },
                { key: '8',  label: 'Java 8',  mode: 'managed', version: '8' },
                { key: '17', label: 'Java 17', mode: 'managed', version: '17' },
                { key: '21', label: 'Java 21', mode: 'managed', version: '21' },
                { key: '25', label: 'Java 25', mode: 'managed', version: '25' },
                { sep: true },
                { key: 'custom', label: 'Custom path...', mode: 'custom' }
            ];

            javaMenuEl = document.createElement('div');
            javaMenuEl.className = 'java-menu';
            items.forEach(it => {
                if (it.sep) {
                    const s = document.createElement('div'); s.className = 'jm-sep'; javaMenuEl.appendChild(s); return;
                }
                const row = document.createElement('div');
                row.className = 'jm-item';
                const isActive = (it.mode === 'auto' && currentMode === 'auto')
                    || (it.mode === 'managed' && currentMode === 'managed' && currentVer === it.version)
                    || (it.mode === 'custom' && currentMode === 'custom');
                if (isActive) row.classList.add('active');
                row.innerHTML = `<span>${it.label}</span>${isActive ? '<i class="fa-solid fa-check"></i>' : ''}`;
                row.onclick = async () => {
                    closeJavaMenu();
                    if (it.mode === 'auto') return applyJavaChoice({ mode: 'auto' });
                    if (it.mode === 'managed') return applyJavaChoice({ mode: 'managed', version: it.version });
                    if (it.mode === 'custom') {
                        const picked = await soul.selectFile([
                            { name: 'Java Executable', extensions: ['exe', ''] },
                            { name: 'All Files', extensions: ['*'] }
                        ]);
                        const p = Array.isArray(picked) ? picked[0] : picked;
                        if (!p) return;
                        return applyJavaChoice({ mode: 'custom', path: p });
                    }
                };
                javaMenuEl.appendChild(row);
            });

            document.body.appendChild(javaMenuEl);
            const r = btnJavaSelect.getBoundingClientRect();
            const mw = javaMenuEl.offsetWidth || 240;
            javaMenuEl.style.top  = `${r.bottom + 6}px`;
            javaMenuEl.style.left = `${Math.max(8, Math.min(window.innerWidth - mw - 8, r.left))}px`;
            setTimeout(() => document.addEventListener('mousedown', javaMenuOutside, true), 0);
        };
    }



    // Click hero icon to cycle to next instance
    document.getElementById('hero-inst-icon-wrap')?.addEventListener('click', () => {

        if (instances.length < 2) return;
        if (btnPlay.classList.contains('hidden')) {
            window.notifications.show('warning', 'Game Running', 'Cannot switch instance while game is launched.');
            return;
        }
        const idx = instances.findIndex(i => i.id === selectedInstance?.id);
        const next = instances[(idx + 1) % instances.length];
        selectedInstance = next;
        soul.setSetting('lastInstance', next.id);
        updateSelectedUI();
        document.querySelectorAll('.inst-product-card').forEach(c => c.classList.remove('active'));
        const gridCard = document.querySelector(`.inst-product-card[data-inst-id="${next.id}"]`);
        if (gridCard) gridCard.classList.add('active');
    });

    function renderInstanceGrid() {
        const grid = document.getElementById('instance-list');
        const searchInput = document.getElementById('instance-search');
        if (!grid) return;
        
        const query = searchInput ? searchInput.value.toLowerCase() : '';
        const groupFilter = document.getElementById('instance-group-filter')?.value || '';
        const filtered = instances.filter(i =>
            (!groupFilter || (i.group || '') === groupFilter) &&
            (i.name.toLowerCase().includes(query) ||
            i.version.toLowerCase().includes(query) ||
            i.loader.toLowerCase().includes(query) ||
            (i.type && i.type.toLowerCase().includes(query)) ||
            ((i.tags || []).join(' ').toLowerCase().includes(query)) ||
            ((i.group || '').toLowerCase().includes(query)))
        );

        grid.innerHTML = '';
        if (filtered.length === 0) {
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 100px; opacity: 0.5;">No instances found.</div>`;
            return;
        }

        filtered.forEach(inst => {
            const card = document.createElement('div');
            card.className = `inst-product-card ${selectedInstance && selectedInstance.id === inst.id ? 'active' : ''}`;
            card.setAttribute('data-inst-id', inst.id);
            
            const loaderMeta = getLoaderMeta(inst.loader);
            const hasCustomIcon = !!inst.iconDataUrl;

            card.innerHTML = `
                <div class="inst-product-icon ${hasCustomIcon ? 'has-custom-icon' : ''}" style="display: flex; align-items: center; justify-content: center; background: var(--black2); border-radius: 15px; border: 1px solid var(--glass-border);">
                    ${getInstanceCardIconMarkup(inst, loaderMeta)}
                    <button class="inst-icon-edit-btn" title="Change instance icon">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                </div>
                <input type="text" class="inst-product-name" value="${inst.name}" spellcheck="false">
                <div class="inst-product-version">
                    <span class="inst-product-pill" ${inst.type === 'soulclient' ? 'style="background:rgba(251,191,36,0.15);color:#fbbf24;"' : ''}>${inst.type === 'soulclient' ? 'Soul Client' : loaderMeta.label}</span>
                    <span class="inst-product-pill muted">${inst.mcversion || inst.version}</span>
                    ${inst.group ? `<span class="inst-product-pill" style="background:rgba(168,85,247,0.15);color:#c084fc;" title="Group">${inst.group}</span>` : ''}
                </div>
                ${(inst.tags && inst.tags.length) ? `<div class="inst-product-tags" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">${inst.tags.map(t => `<span class="inst-product-pill muted" style="font-size:10px;">#${String(t).replace(/</g, '&lt;')}</span>`).join('')}</div>` : ''}
                
                <div class="inst-product-actions">
                    <button class="inst-play-btn">
                        <i class="fa-solid fa-play"></i> PLAY
                    </button>
                    <button class="inst-folder-btn" title="Open Instance Folder">
                        <i class="fa-solid fa-folder-open"></i>
                    </button>
                    <button class="inst-settings-btn inst-folder-btn" title="Instance Settings (RAM, JVM, hooks, tags)">
                        <i class="fa-solid fa-gear"></i>
                    </button>
                    <button class="inst-duplicate-btn inst-folder-btn" title="Duplicate instance">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                    <button class="inst-backup-btn inst-folder-btn" title="Back up instance">
                        <i class="fa-solid fa-box-archive"></i>
                    </button>
                    <button class="inst-delete-btn">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `;
            
            card.onclick = () => {
                if (btnPlay.classList.contains('hidden')) {
                    window.notifications.show('warning', 'Game Running', 'Cannot switch instance while game is launched.');
                    return;
                }
                if (selectedInstance && selectedInstance.id === inst.id) return;
                selectedInstance = inst;
                soul.setSetting('lastInstance', inst.id);
                updateSelectedUI();
                populateInstanceSelectors();
                renderInstanceGrid();
                loadFiles(activeFilesType, 'addon-list');
            };

            const editIconBtn = card.querySelector('.inst-icon-edit-btn');
            if (editIconBtn) {
                editIconBtn.onclick = async (e) => {
                    e.stopPropagation();
                    try {
                        const files = await soul.selectFile([{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]);
                        const picked = Array.isArray(files) ? files[0] : files;
                        if (!picked) return;

                        const updated = await soul.setInstanceIcon(inst.name, picked);
                        instances = await soul.getInstances();
                        const refreshed = instances.find(i => i.id === inst.id) || updated || inst;
                        if (selectedInstance && selectedInstance.id === inst.id) {
                            selectedInstance = refreshed;
                            await updateSelectedUI();
                        }
                        renderInstanceGrid();
                        populateInstanceSelectors();
                        window.notifications.show('success', 'Icon Updated', `Updated icon for "${inst.name}".`);
                    } catch (err) {
                        window.notifications.show('error', 'Icon Failed', err.message || 'Could not update the instance icon.');
                    }
                };
            }

            const nameInput = card.querySelector('.inst-product-name');
            nameInput.onchange = async () => {
                const newName = nameInput.value.trim();
                if (!newName || newName === inst.name) return;
                
                try {
                    window.notifications.show('info', 'Renaming...', 'Moving instance folder');
                    const oldName = inst.name;
                    await soul.renameInstance(oldName, newName);
                    inst.name = newName;
                    
                    // If this was the selected instance, update the hero section
                    if (selectedInstance && selectedInstance.id === inst.id) {
                        updateSelectedUI();
                    }
                    renderInstanceGrid();
                    populateInstanceSelectors();
                    window.notifications.show('success', 'Renamed', `Instance is now "${newName}"`);
                } catch (err) {
                    console.error("Rename Error:", err);
                    window.notifications.show('error', 'Rename Failed', err.message);
                    nameInput.value = inst.name; // Reset
                }
            };

            card.querySelector('.inst-play-btn').onclick = (e) => {
                e.stopPropagation();
                selectedInstance = inst;
                soul.setSetting('lastInstance', inst.id);
                updateSelectedUI();
                switchView('home');
                btnPlay.click();
            };

            card.querySelector('.inst-folder-btn').onclick = (e) => {
                e.stopPropagation();
                soul.openInstanceFolder(inst.name);
            };

            const settingsBtn = card.querySelector('.inst-settings-btn');
            if (settingsBtn) settingsBtn.onclick = (e) => {
                e.stopPropagation();
                openInstanceSettings(inst.name);
            };

            const dupBtn = card.querySelector('.inst-duplicate-btn');
            if (dupBtn) dupBtn.onclick = async (e) => {
                e.stopPropagation();
                const newName = await showPrompt('Duplicate Instance', `Copy "${inst.name}" to:`, `${inst.name} Copy`);
                if (!newName || !newName.trim()) return;
                try {
                    window.notifications.show('info', 'Duplicating...', 'Copying instance files.');
                    await soul.duplicateInstance(inst.name, newName.trim());
                    instances = await soul.getInstances();
                    renderInstanceGrid();
                    populateInstanceSelectors();
                    populateGroupFilter();
                    window.notifications.show('success', 'Duplicated', `"${newName.trim()}" created.`);
                } catch (err) {
                    window.notifications.show('error', 'Duplicate Failed', err.message);
                }
            };

            const backupBtn = card.querySelector('.inst-backup-btn');
            if (backupBtn) backupBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    window.notifications.show('info', 'Backing Up...', `Archiving "${inst.name}".`);
                    const result = await soul.backupInstance(inst.name);
                    window.notifications.show('success', 'Backed Up', result.file);
                } catch (err) {
                    window.notifications.show('error', 'Backup Failed', err.message);
                }
            };

            card.querySelector('.inst-delete-btn').onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete "${inst.name}"?`)) {
                    await soul.deleteInstance(inst.name);
                    instances = await soul.getInstances();
                    if (selectedInstance && selectedInstance.id === inst.id) {
                        selectedInstance = instances[0] || null;
                        if (selectedInstance) soul.setSetting('lastInstance', selectedInstance.id);
                    }
                    renderInstanceGrid();
                    populateInstanceSelectors();
                    updateSelectedUI();
                    window.notifications.show('warning', 'Instance Deleted', `Removed "${inst.name}"`);
                }
            };

            grid.appendChild(card);
        });
        renderBottomInstances();
    }

    // --- BOTTOM STRIP: quick instance picker (dashboard) ---
    function renderBottomInstances() {
        const box = document.getElementById('bottom-instance-list');
        if (!box) return;
        if (!Array.isArray(instances) || instances.length === 0) {
            box.innerHTML = 'No instances yet';
            return;
        }
        box.innerHTML = '';
        instances.forEach(inst => {
            const b = document.createElement('button');
            const isActive = selectedInstance && (selectedInstance.id === inst.id || selectedInstance.name === inst.name);
            b.className = 'hbb-inst-pick' + (isActive ? ' active' : '');
            const safeName = String(inst.name || 'Unnamed').replace(/</g, '&lt;');
            const safeVer = String(inst.mcversion || inst.version || '').replace(/</g, '&lt;');
            const loaderMeta = getLoaderMeta(inst.loader);
            const loaderLabel = String(inst.type === 'soulclient' ? 'Soul Client' : loaderMeta.label).replace(/</g, '&lt;');
            b.innerHTML = `${getInstanceIconHtml(inst)}<span class="hbb-inst-meta"><span class="hbb-inst-name">${safeName}</span><span class="hbb-inst-sub"><span class="hbb-inst-pill hot">${loaderLabel}</span><span class="hbb-inst-pill">${safeVer}</span></span></span><span class="hbb-inst-go">${isActive ? '● ACTIVE' : 'PLAY ▸'}</span>`;
            b.title = `Switch to ${safeName}`;
            b.onclick = () => {
                selectedInstance = inst;
                soul.setSetting('lastInstance', inst.id || inst.name);
                updateSelectedUI();
                renderBottomInstances();
            };
            box.appendChild(b);
        });
    }

    // --- SETTINGS ---
    async function loadSettingsUI() {
        const settings = await soul.getAllSettings();

        // ── System memory info ──────────────────────────────────────
        const sysMemInfo = document.getElementById('sys-mem-info');
        if (sysMemInfo) {
            const sysInfo = await soul.getSysInfo();
            const totalGB = (sysInfo.totalMem / (1024 ** 3)).toFixed(1);
            const freeGB = (sysInfo.freeMem / (1024 ** 3)).toFixed(1);
            const appGB = (sysInfo.allocMem / (1024 ** 3)).toFixed(2);
            sysMemInfo.textContent = `${totalGB}G total, ${freeGB}G free — launcher process using ${appGB}G`;
        }

        // ── Memory slider ───────────────────────────────────────────
        const memSlider = document.getElementById('mem-slider');
        const memVal    = document.getElementById('mem-val');
        const memNote   = document.getElementById('mem-note');
        if (memSlider) {
            const sysInfo = await soul.getSysInfo();
            const maxSysMemGB = Math.floor(sysInfo.totalMem / (1024**3));
            const selectedRam = Math.min(settings.ram || settings.memory || 4, maxSysMemGB);
            memSlider.max = maxSysMemGB;
            memSlider.value = selectedRam;
            memVal.textContent = `${selectedRam}G Minecraft RAM cap (max: ${maxSysMemGB}G)`;
            if (memNote) {
                memNote.textContent = `Minecraft will launch with up to ${selectedRam}G. Launcher memory usage is separate.`;
            }
            let saveTimer;
            memSlider.oninput = () => {
                memVal.textContent = `${memSlider.value}G Minecraft RAM cap (max: ${maxSysMemGB}G)`;
                if (memNote) {
                    memNote.textContent = `Minecraft will launch with up to ${memSlider.value}G. Launcher memory usage is separate.`;
                }
                clearTimeout(saveTimer);
                saveTimer = setTimeout(() => soul.setSetting('ram', parseFloat(memSlider.value)), 200);
            };
        }

        // ── Java path ───────────────────────────────────────────────
        const javaPath = document.getElementById('java-path');
        if (javaPath) {
            javaPath.value = settings.javaPath || '';
            javaPath.onchange = () => soul.setSetting('javaPath', javaPath.value.trim());
        }

        // ── JVM arguments ───────────────────────────────────────────
        const jvmArgs = document.getElementById('jvm-args');
        if (jvmArgs) {
            jvmArgs.value = settings.jvmArgs || '';
            jvmArgs.onchange = () => soul.setSetting('jvmArgs', jvmArgs.value.trim());
        }

        // ── Resolution ──────────────────────────────────────────────
        const resW = document.getElementById('res-w');
        const resH = document.getElementById('res-h');
        if (resW) {
            resW.value = settings.resW || 1280;
            resW.onchange = () => soul.setSetting('resW', parseInt(resW.value) || 1280);
        }
        if (resH) {
            resH.value = settings.resH || 720;
            resH.onchange = () => soul.setSetting('resH', parseInt(resH.value) || 720);
        }

        // ── Toggles helper ──────────────────────────────────────────
        function wireToggle(id, key, defaultVal) {
            const el = document.getElementById(id);
            if (!el) return;
            el.checked = settings[key] !== undefined ? !!settings[key] : defaultVal;
            el.onchange = () => soul.setSetting(key, el.checked);
        }
        wireToggle('toggle-fullscreen',      'fullscreen',      false);
        wireToggle('toggle-close-on-launch', 'closeOnLaunch',   false);
        wireToggle('toggle-reopen-on-close', 'reopenOnClose',   true);
        wireToggle('toggle-show-console',    'showConsole',     false);
        wireToggle('toggle-snow-particles',  'snowParticles',   true);

        // ── Launcher animations toggle ───────────────────────────────
        const animToggle = document.getElementById('toggle-animations');
        if (animToggle) {
            animToggle.checked = settings.animations !== undefined ? !!settings.animations : true;
            applyAnimations(animToggle.checked);
            animToggle.onchange = () => {
                soul.setSetting('animations', animToggle.checked);
                applyAnimations(animToggle.checked);
            };
        }

        // ── Concurrent downloads ────────────────────────────────────
        const concDl = document.getElementById('concurrent-downloads');
        if (concDl) {
            concDl.value = settings.concurrentDownloads || 4;
            concDl.onchange = () => soul.setSetting('concurrentDownloads', parseInt(concDl.value));
        }

        // ── Open data folder ────────────────────────────────────────
        const btnDataFolder = document.getElementById('btn-open-data-folder');
        if (btnDataFolder) {
            btnDataFolder.onclick = () => soul.openDataFolder();
        }

        // ── Clear Cache ──────────────────────────────────────────────
        const btnClearCache = document.getElementById('btn-clear-cache');
        if (btnClearCache) {
            btnClearCache.onclick = async () => {
                if (!confirm('Clear the asset cache? Assets will re-download on next launch (game files are kept).')) return;
                try {
                    if (soul.clearCache) await soul.clearCache();
                    window.notifications.show('success', 'Cache Cleared', 'Asset cache has been removed.');
                    logToConsole('[SYSTEM] Asset cache cleared by user.');
                } catch (err) {
                    window.notifications.show('error', 'Clear Failed', err.message || 'Could not clear cache.');
                }
            };
        }

        // ── Clear All Data ───────────────────────────────────────────
        const btnClearData = document.getElementById('btn-clear-data');
        if (btnClearData) {
            btnClearData.onclick = async () => {
                if (!confirm('⚠️ PERMANENT: Delete ALL instances and launcher data? This cannot be undone.')) return;
                if (!confirm('Are you absolutely sure? All your instances will be gone.')) return;
                try {
                    if (soul.clearData) await soul.clearData();
                    instances = [];
                    selectedInstance = null;
                    renderInstanceGrid();
                    updateSelectedUI();
                    window.notifications.show('warning', 'Data Cleared', 'All launcher data has been reset.');
                    logToConsole('[SYSTEM] All launcher data cleared by user.', 'warning');
                } catch (err) {
                    window.notifications.show('error', 'Clear Failed', err.message || 'Could not clear data.');
                }
            };
        }

        // ── Theme Cards ──────────────────────────────────────────────
        const themeCards = document.querySelectorAll('.theme-card[data-theme]');
        themeCards.forEach(card => {
            card.onclick = async () => {
                const theme = card.dataset.theme || 'red';
                await soul.setSetting('theme', theme);
                applyTheme(theme);
                themeCards.forEach(c => c.classList.toggle('active', c === card));
                window.notifications.show('success', 'Theme Applied', `${theme.charAt(0).toUpperCase() + theme.slice(1)} theme active.`);
            };
        });
        try {
            const savedTheme = (await soul.getSetting('theme')) || 'red';
            applyTheme(savedTheme);
            const savedCard = document.querySelector(`.theme-card[data-theme="${savedTheme}"]`);
            themeCards.forEach(c => c.classList.toggle('active', c === savedCard || (!savedCard && c.dataset.theme === 'red')));
        } catch (e) {}
    }

    // --- THEMES & BACKGROUNDS ---
    function applyTheme(theme) {
        const clean = String(theme || 'red').toLowerCase();
        // remove previous theme-* classes
        Array.from(document.body.classList).forEach(c => { if (c.startsWith('theme-')) document.body.classList.remove(c); });
        document.body.classList.add(`theme-${clean}`);
        // drop any leftover app-* mode class (Paper only now)
        document.body.classList.remove('app-paper', 'app-modern');
    }

    function applyAnimations(enabled) {
        document.body.classList.toggle('no-anim', !enabled);
        document.querySelectorAll('.ghost-layer').forEach(layer => {
            layer.classList.toggle('paused', !enabled);
        });
    }

    async function loadBgImageUrl(fullPath) {
        // Load a local file as an object URL (avoids Windows file:// quirks)
        try {
            const res = await fetch('file:///' + String(fullPath).replace(/\\/g, '/'));
            if (!res.ok) return null;
            const blob = await res.blob();
            return blob.type && blob.type.includes('image') ? URL.createObjectURL(blob) : null;
        } catch (e) {
            try {
                const res2 = await fetch('file://' + String(fullPath).replace(/\\/g, '/'));
                if (!res2.ok) return null;
                const blob = await res2.blob();
                return blob.type && blob.type.includes('image') ? URL.createObjectURL(blob) : null;
            } catch (_) { return null; }
        }
    }

    async function initBackgrounds() {
        const bgLayer = document.getElementById('bg-layer');
        const heroBg = document.getElementById('hero-mc-bg');
        if (!bgLayer) return;

        let bgName = 'snow-scene.png';
        try { bgName = (await soul.getSetting('homeBg')) || 'snow-scene.png'; } catch (e) {}

        if (bgName === 'snow-scene.png') {
            const snowUrl = `url('../../assets/backgrounds/snow-scene.png')`;
            bgLayer.style.backgroundImage = snowUrl;
            if (heroBg) heroBg.style.backgroundImage = snowUrl;
        } else {
            let fullPath = window.__soulBgPaths && window.__soulBgPaths[bgName];
            if (!fullPath) {
                try { fullPath = await soul.getBackgroundPath(bgName); } catch (e) {}
            }
            const objUrl = fullPath ? await loadBgImageUrl(fullPath) : null;
            const finalUrl = objUrl ? `url('${objUrl}')` : `url('../../assets/backgrounds/snow-scene.png')`;
            bgLayer.style.backgroundImage = finalUrl;
            if (heroBg) heroBg.style.backgroundImage = finalUrl;
        }

        // Parallax effect (only add once, throttled with rAF)
        if (!window._bgParallaxApplied) {
            window._bgParallaxApplied = true;
            let ticking = false;
            window.addEventListener('mousemove', (e) => {
                if (!ticking) {
                    ticking = true;
                    requestAnimationFrame(() => {
                        const x = (e.clientX / window.innerWidth - 0.5) * 20;
                        const y = (e.clientY / window.innerHeight - 0.5) * 20;
                        bgLayer.style.transform = `scale(1.05) translate(${x}px, ${y}px)`;
                        ticking = false;
                    });
                }
            });
        }
    }

    async function applyHomeBackground(name) {
        await soul.setSetting('homeBg', name);
        const heroBg = document.getElementById('hero-mc-bg');
        const bgLayer = document.getElementById('bg-layer');
        if (name === 'snow-scene.png') {
            const snowUrl = `url('../../assets/backgrounds/snow-scene.png')`;
            if (bgLayer) bgLayer.style.backgroundImage = snowUrl;
            if (heroBg) heroBg.style.backgroundImage = snowUrl;
            return;
        }
        let fullPath = window.__soulBgPaths && window.__soulBgPaths[name];
        if (!fullPath) {
            try { fullPath = await soul.getBackgroundPath(name); } catch (e) {}
        }
        const objUrl = fullPath ? await loadBgImageUrl(fullPath) : null;
        const finalUrl = objUrl ? `url('${objUrl}')` : `url('../../assets/backgrounds/snow-scene.png')`;
        if (bgLayer) bgLayer.style.backgroundImage = finalUrl;
        if (heroBg) heroBg.style.backgroundImage = finalUrl;
    }

    async function initBackgroundSelector() {
        const grid = document.getElementById('bg-selector-grid');
        if (!grid) return;

        const btnUpload = document.getElementById('btn-upload-bg');

        // Show the previously selected background
        let savedBg = 'snow-scene.png';
        try { savedBg = (await soul.getSetting('homeBg')) || 'snow-scene.png'; } catch (e) {}
        grid.querySelectorAll('.bg-card').forEach(c => c.classList.toggle('active', c.dataset.bg === savedBg));

        // Click any card to apply
        grid.addEventListener('click', async (e) => {
            const card = e.target.closest('.bg-card');
            if (!card || card.dataset.bg === undefined) return;
            if (e.target.closest('.bg-delete-btn')) return;
            grid.querySelectorAll('.bg-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            try { await applyHomeBackground(card.dataset.bg); } catch (err) { console.warn('[BG] apply failed:', err); }
        });

        // Upload custom background
        if (btnUpload) {
            btnUpload.onclick = async () => {
                const files = await soul.selectFile([{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }]);
                if (!files || !files.length) return;
                try {
                    const name = await soul.uploadBackground(files[0]);
                    await renderBgCards();
                    const cardToActivate = grid.querySelector(`.bg-card[data-bg="${name}"]`);
                    if (cardToActivate) {
                        grid.querySelectorAll('.bg-card').forEach(c => c.classList.remove('active'));
                        cardToActivate.classList.add('active');
                    }
                    await applyHomeBackground(name);
                    window.notifications.show('success', 'Background Set', `Home background "${name}" applied.`);
                } catch (err) {
                    window.notifications.show('error', 'Background Failed', err.message || 'Could not upload background.');
                }
            };
        }

        async function renderBgCards() {
            let customs = [];
            try { customs = await soul.getCustomBackgrounds(); } catch (e) {}
            grid.querySelectorAll('.bg-card.custom-bg').forEach(c => c.remove());
            window.__soulBgPaths = window.__soulBgPaths || {};
            for (const name of customs) {
                const fullPath = await soul.getBackgroundPath(name);
                if (fullPath) window.__soulBgPaths[name] = fullPath;
                const card = document.createElement('div');
                card.className = 'theme-card bg-card custom-bg';
                card.dataset.bg = name;
                card.style.padding = '0';
                card.style.overflow = 'hidden';
                card.innerHTML = `
                    <span style="position: absolute; bottom: 8px; font-size: 11px; font-weight: 800; z-index:2;">${name}</span>
                    <span class="bg-thumb-host" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;opacity:0.7;"><i class="fa-solid fa-spinner fa-spin"></i></span>
                    <button class="bg-delete-btn" title="Delete custom background" style="display:block; position:absolute; top:6px; right:6px; width:22px; height:22px; background:rgba(239,68,68,0.85); color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:11px; z-index:2;">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                `;
                const thumbHost = card.querySelector('.bg-thumb-host');
                if (fullPath) {
                    const objUrl = await loadBgImageUrl(fullPath);
                    if (objUrl) {
                        const img = document.createElement('img');
                        img.src = objUrl;
                        img.loading = 'lazy';
                        img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0.6;';
                        card.insertBefore(img, thumbHost);
                        if (thumbHost) thumbHost.remove();
                    }
                }
                card.querySelector('.bg-delete-btn').onclick = async (ev) => {
                    ev.stopPropagation();
                    if (!confirm(`Delete custom background "${name}"?`)) return;
                    try {
                        await soul.deleteBackground(name);
                        card.remove();
                        if (savedBg === name) {
                            savedBg = 'snow-scene.png';
                            await applyHomeBackground('snow-scene.png');
                            grid.querySelectorAll('.bg-card').forEach(c => c.classList.toggle('active', c.dataset.bg === 'snow-scene.png'));
                        }
                    } catch (err) {
                        window.notifications.show('error', 'Delete Failed', err.message || 'Could not delete background.');
                    }
                };
                grid.appendChild(card);
            }
        }

        await renderBgCards();
    }

    // --- ACTIONS ---
    if (btnMin) btnMin.onclick = () => soul.minimize();
    if (btnMax) btnMax.onclick = () => soul.maximize();
    if (btnClose) btnClose.onclick = () => soul.close();

    if (userTrigger) {
        userTrigger.onclick = (e) => { e.stopPropagation(); accDropdown.classList.toggle('active'); };
        document.addEventListener('click', () => accDropdown.classList.remove('active'));
    }

    const btnAddAcc = document.getElementById('btn-add-acc');
    if (btnAddAcc) btnAddAcc.onclick = () => window.location.href = '../login/login.html';
    
    function openCreateModal() {
        selectedNewInstLoader = 'vanilla';
        selectedNewInstVersion = '';
        selectedNewInstIconPath = '';
        jarFilesToAdd = [];

        const nameInput = document.getElementById('new-inst-name');
        if (nameInput) nameInput.value = '';

        const verSearch = document.getElementById('new-inst-ver-search');
        if (verSearch) verSearch.value = '';

        const jarList = document.getElementById('jar-file-list');
        if (jarList) jarList.innerHTML = '';

        document.querySelectorAll('.create-loader-pill').forEach(p => {
            p.classList.toggle('active', p.dataset.loader === 'vanilla');
        });

        updateCreateLoaderVisual('vanilla');
        updateCreateIconPreview();
        _loadCreateVersionList('');
        overlays.create.classList.add('active');
    }

    const btnNewInst = document.getElementById('btn-new-inst');
    if (btnNewInst) btnNewInst.onclick = openCreateModal;
    
    const btnCancelCreate = document.getElementById('btn-cancel-create');
    if (btnCancelCreate) btnCancelCreate.onclick = () => overlays.create.classList.remove('active');

    const btnConfirmCreate = document.getElementById('btn-confirm-create');
    if (btnConfirmCreate) {
        btnConfirmCreate.onclick = async () => {
            const name = document.getElementById('new-inst-name').value.trim();
            if (!name) {
                window.notifications.show('warning', 'Name Required', 'Please enter an instance name.');
                document.getElementById('new-inst-name').focus();
                return;
            }
            if (!selectedNewInstVersion) {
                window.notifications.show('warning', 'Version Required', 'Please select a Minecraft version from the list.');
                return;
            }

            btnConfirmCreate.disabled = true;
            btnConfirmCreate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';

            try {
                const loader = CREATABLE_LOADERS.has(selectedNewInstLoader) ? selectedNewInstLoader : 'vanilla';
                // Soul Client instances use Fabric under the hood
                const actualLoader = (loader === 'soulclient' || loader === 'kruthclient') ? 'fabric' : loader;
                const newInst = {
                    id: 'inst-' + Date.now(),
                    name,
                    version: selectedNewInstVersion,
                    mcversion: selectedNewInstVersion,
                    loader: actualLoader,
                    type: loader === 'soulclient' ? 'soulclient' : loader === 'kruthclient' ? 'kruthclient' : undefined,
                    iconSourcePath: selectedNewInstIconPath || undefined
                };
                await soul.createInstance(newInst);

                // Copy any jar files added
                if (jarFilesToAdd.length > 0) {
                    for (const jarPath of jarFilesToAdd) {
                        try { await soul.copyFileToInstance(name, jarPath); } catch (e) { console.warn('Jar copy failed:', e); }
                    }
                    jarFilesToAdd = [];
                }

                // For Soul Client, download the mod + Fabric API + Mod Menu
                if (loader === 'soulclient') {
                    const soulVersion = soulVersionsCache.find(sv => sv.mcVersion === selectedNewInstVersion);
                    if (soulVersion && soulVersion.downloadUrl) {
                        const filename = soulVersion.downloadUrl.split('/').pop().split('?')[0] || 'soulclient-mod.jar';
                        try {
                            await soul.downloadUrlToInstance(soulVersion.downloadUrl, name, 'mods', filename);
                            await soul.setInstanceConfigField(name, 'soulVersionCode', soulVersion.versionCode || 0);
                            await soul.setInstanceConfigField(name, 'soulModFilename', filename);
                        } catch (e) {
                            console.warn('[SOUL CLIENT] Failed to download mod:', e);
                        }
                    }
                    try {
                        await soul.soulclientDownloadDeps(name, selectedNewInstVersion);
                    } catch (e) {
                        console.warn('[SOUL CLIENT] Failed to download deps:', e);
                    }
                }

                // For Kruth Client, download the mod + Fabric API + Mod Menu
                if (loader === 'kruthclient') {
                    const kruthVersion = kruthVersionsCache.find(sv => sv.mcVersion === selectedNewInstVersion);
                    if (kruthVersion && kruthVersion.downloadUrl) {
                        const filename = kruthVersion.downloadUrl.split('/').pop().split('?')[0] || 'kruthclient-mod.jar';
                        try {
                            await soul.downloadUrlToInstance(kruthVersion.downloadUrl, name, 'mods', filename);
                            await soul.setInstanceConfigField(name, 'kruthVersionCode', kruthVersion.versionCode || 0);
                            await soul.setInstanceConfigField(name, 'kruthModFilename', filename);
                        } catch (e) {
                            console.warn('[KRUTH CLIENT] Failed to download mod:', e);
                        }
                    }
                    try {
                        await soul.soulclientDownloadDeps(name, selectedNewInstVersion);
                    } catch (e) {
                        console.warn('[KRUTH CLIENT] Failed to download deps:', e);
                    }
                }

                instances = await soul.getInstances();
                selectedInstance = instances.find(i => i.id === newInst.id) || newInst;
                if (!selectedInstance.mcversion) selectedInstance.mcversion = selectedInstance.version;
                await soul.setSetting('lastInstance', selectedInstance.id);

                updateSelectedUI();
                renderInstanceGrid();
                populateInstanceSelectors();
                overlays.create.classList.remove('active');

                // Reset modal fields
                selectedNewInstVersion = '';
                selectedNewInstLoader = 'vanilla';
                selectedNewInstIconPath = '';
                updateCreateLoaderVisual('vanilla');
                updateCreateIconPreview();

                window.notifications.show('success', 'Instance Created', `"${name}" is ready to play!`);
            } catch (err) {
                console.error('Create Instance Error:', err);
                window.notifications.show('error', 'Creation Failed', err.message);
            } finally {
                btnConfirmCreate.disabled = false;
                btnConfirmCreate.innerHTML = '<i class="fa-solid fa-plus"></i> Create Instance';
            }
        };
    }

    let launchGame = null;

    if (btnPlay) {
        btnPlay.onclick = () => launchGame();

        launchGame = async function(serverIp = null, world = null) {
            if (!currentAccount) {
                window.notifications.show('warning', 'Login Required', 'Please select a profile.');
                return;
            }

            if (!selectedInstance) {
                window.notifications.show('warning', 'No Instance', 'Create an instance first.');
                return;
            }
            btnPlay.disabled = true;
            btnPlay.classList.remove('btn-ready');
            btnPlay.classList.add('hidden');
            const btnStop = document.getElementById('btn-stop');
            if (btnStop) btnStop.classList.remove('hidden');
            
            launchStatus.textContent = "Initializing...";
            launchStatus.style.color = "var(--accent)";

            // For Soul Client instances, ensure mod + Fabric API + Mod Menu are downloaded
            if (selectedInstance.type === 'soulclient') {
                const soulVersion = soulVersionsCache.find(sv => sv.mcVersion === (selectedInstance.mcversion || selectedInstance.version));
                if (soulVersion && soulVersion.downloadUrl) {
                    const currentCode = selectedInstance.soulVersionCode || 0;
                    const latestCode = soulVersion.versionCode || 0;
                    const filename = soulVersion.downloadUrl.split('/').pop().split('?')[0] || 'soulclient-mod.jar';
                    if (latestCode > currentCode || !selectedInstance.soulModFilename) {
                        try {
                            launchStatus.textContent = "Downloading mods...";
                            logToConsole(`[SOUL CLIENT] Downloading mod from: ${soulVersion.downloadUrl}`);
                            const oldFilename = selectedInstance.soulModFilename;
                            await soul.downloadUrlToInstance(soulVersion.downloadUrl, selectedInstance.name, 'mods', filename);
                            if (oldFilename && oldFilename !== filename) {
                                try { await soul.deleteMod(selectedInstance.name, oldFilename); } catch (_) {}
                            }
                            await soul.setInstanceConfigField(selectedInstance.name, 'soulVersionCode', latestCode);
                            await soul.setInstanceConfigField(selectedInstance.name, 'soulModFilename', filename);
                            logToConsole(`[SOUL CLIENT] Mod downloaded: ${filename}`);
                        } catch (e) {
                            logToConsole(`[SOUL CLIENT] Mod download failed: ${e.message}`);
                            window.notifications.show('error', 'Soul Client Update Failed', 'The previous client mod was kept. See the console for details.');
                            resetLaunchUI();
                            launchStatus.textContent = 'Update Failed';
                            launchStatus.style.color = '#ef4444';
                            return;
                        }
                    } else {
                        logToConsole(`[SOUL CLIENT] Mod is up to date (v${currentCode})`);
                    }
                }
            }
            if (selectedInstance.type === 'soulclient') {
                try {
                    await soul.soulclientDownloadDeps(selectedInstance.name, selectedInstance.mcversion || selectedInstance.version);
                    logToConsole(`[SOUL CLIENT] Fabric API & Mod Menu ready.`);
                } catch (e) {
                    logToConsole(`[SOUL CLIENT] Dep download failed: ${e.message}`);
                }
            }

            // For Kruth Client instances, ensure mod + Fabric API + Mod Menu are downloaded
            if (selectedInstance.type === 'kruthclient') {
                const kruthVersion = kruthVersionsCache.find(sv => sv.mcVersion === (selectedInstance.mcversion || selectedInstance.version));
                if (kruthVersion && kruthVersion.downloadUrl) {
                    const currentCode = selectedInstance.kruthVersionCode || 0;
                    const latestCode = kruthVersion.versionCode || 0;
                    const filename = kruthVersion.downloadUrl.split('/').pop().split('?')[0] || 'kruthclient-mod.jar';
                    if (latestCode > currentCode || !selectedInstance.kruthModFilename) {
                        try {
                            launchStatus.textContent = "Downloading mods...";
                            logToConsole(`[KRUTH CLIENT] Downloading mod from: ${kruthVersion.downloadUrl}`);
                            const oldFilename = selectedInstance.kruthModFilename;
                            if (oldFilename && oldFilename !== filename) {
                                try { await soul.deleteMod(selectedInstance.name, oldFilename); } catch (_) {}
                            }
                            await soul.downloadUrlToInstance(kruthVersion.downloadUrl, selectedInstance.name, 'mods', filename);
                            await soul.setInstanceConfigField(selectedInstance.name, 'kruthVersionCode', latestCode);
                            await soul.setInstanceConfigField(selectedInstance.name, 'kruthModFilename', filename);
                            logToConsole(`[KRUTH CLIENT] Mod downloaded: ${filename}`);
                        } catch (e) {
                            logToConsole(`[KRUTH CLIENT] Mod download failed: ${e.message}`);
                        }
                    } else {
                        logToConsole(`[KRUTH CLIENT] Mod is up to date (v${currentCode})`);
                    }
                }
            }
            if (selectedInstance.type === 'kruthclient') {
                try {
                    await soul.soulclientDownloadDeps(selectedInstance.name, selectedInstance.mcversion || selectedInstance.version);
                    logToConsole(`[KRUTH CLIENT] Fabric API & Mod Menu ready.`);
                } catch (e) {
                    logToConsole(`[KRUTH CLIENT] Dep download failed: ${e.message}`);
                }
            }
            const settings = await soul.getAllSettings();
            // Per-instance overrides (ram/resW/resH/fullscreen) win over global Settings.
            let instLaunch = null;
            try {
                if (soul.getInstanceLaunchSettings) instLaunch = await soul.getInstanceLaunchSettings(selectedInstance.name);
            } catch (_) {}
            const options = {
                version: selectedInstance.version,
                mcversion: selectedInstance.mcversion,
                loader: selectedInstance.loader,
                name: selectedInstance.name,
                memory: (instLaunch && instLaunch.ram) || settings.ram || settings.memory || 4,
                resW: (instLaunch && instLaunch.resW) || settings.resW || 1280,
                resH: (instLaunch && instLaunch.resH) || settings.resH || 720,
                javaPath: settings.javaPath || null,
                instanceName: selectedInstance.name,

                jvmArgs: settings.jvmArgs || '',
                fullscreen: instLaunch && instLaunch.fullscreen !== null && instLaunch.fullscreen !== undefined
                    ? instLaunch.fullscreen
                    : !!settings.fullscreen,
                closeOnLaunch: !!settings.closeOnLaunch,
                reopenOnClose: settings.reopenOnClose !== false,
                showConsole: !!settings.showConsole,
                concurrentDownloads: settings.concurrentDownloads || 4,
                account: currentAccount,
                server: serverIp,
                world: world
            };

            resetConsoleForNewLaunch();
            if (serverIp) {
                logToConsole(`[SYSTEM] Auto-joining server: ${serverIp}`);
                try {
                    const servers = (await soul.getSetting('recentServers')) || [];
                    const existing = servers.find(s => s.ip === serverIp);
                    if (existing) {
                        existing.timestamp = Date.now();
                    } else {
                        servers.unshift({ ip: serverIp, name: serverIp, timestamp: Date.now() });
                    }
                    await soul.setSetting('recentServers', servers.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 50));
                } catch (_) {}
            }
            logToConsole(`[SYSTEM] Allocated Memory: ${options.memory}G`);

            // Auto-switch to console tab if enabled
            if (options.showConsole) switchView('console');

            const consoleBox = document.getElementById('console-output');
            if (consoleBox) {
                logToConsole(`[SYSTEM] Preparing to launch ${selectedInstance.name}...`);
                logToConsole(`[SYSTEM] Loader: ${String(selectedInstance.loader || 'vanilla').toUpperCase()}`);
                logToConsole(`[SYSTEM] Account: ${currentAccount.name} (${currentAccount.type})`);
                logToConsole(`[SYSTEM] Minecraft Base Version: ${selectedInstance.mcversion || selectedInstance.version}`);
            }

            soul.removeLaunchListeners();

            soul.onLaunchProgress(d => {
                launchStatus.textContent = d.msg;
                if (consoleBox && !String(d.msg || '').startsWith('[JAVA]')) {
                    logToConsole(`[DOWNLOAD] ${d.msg}`);
                }
            });

            soul.onLaunchLog(d => {
                if (consoleBox) {
                    logToConsole(d);
                }
                if (d.toLowerCase().includes('sound engine started') || d.toLowerCase().includes('created:')) {
                    launchStatus.textContent = "Game Running";
                    launchStatus.style.color = "#4ade80";
                }
            });

            soul.onLaunchError(e => {
                window.notifications.show('error', 'Launch Error', e);
                resetLaunchUI();
                launchStatus.textContent = "Launch Failed";
                launchStatus.style.color = "#ef4444";
                if (consoleBox) {
                    logToConsole(`[ERROR] ${e}`, 'error');
                }
                showLaunchDiagnosis(e, selectedInstance);
            });

            soul.onLaunchFinished(async () => {
                launchStatus.textContent = "Ready";
                launchStatus.style.color = "white";
                resetLaunchUI();
                window.notifications.show('success', 'Closed', 'Minecraft has been closed.');
                const s = await soul.getAllSettings();
                if (s.reopenOnClose !== false) soul.showWindow();
                try { instances = await soul.getInstances(); } catch (_) {}
                try { loadRecentPlayed(); } catch (_) {}
                try { loadSoulBlog(); } catch (_) {}
            });

            // Record last played timestamp
            try {
                await soul.setInstanceConfigField(selectedInstance.name, 'lastPlayed', Date.now());
            } catch (_) {}
            try {
                await soul.launchGame(options);
                if (options.closeOnLaunch) soul.hideWindow();
            } catch (err) {
                console.error("Launch Bridge Error:", err);
                window.notifications.show('error', 'Critical Error', err.message);
                resetLaunchUI();
            }
        };
    }

    const btnStop = document.getElementById('btn-stop');
    if (btnStop) {
        btnStop.onclick = async () => {
            await soul.stopGame();
            resetLaunchUI();
            launchStatus.textContent = "Stopping...";
        };
    }

    function resetLaunchUI() {
        btnPlay.disabled = false;
        btnPlay.classList.add('btn-ready');
        btnPlay.classList.remove('hidden');
        if (btnStop) btnStop.classList.add('hidden');
    }

    // =====================================================================
    // INSTANCE FILE MANAGER (Modrinth-style)
    // =====================================================================
    const FM = {
        instanceName: null,
        path: '',
        sort: { key: 'name', dir: 'asc' },
        entries: [],
        initialized: false,
        search: ''
    };

    function showPrompt(title, message, defaultValue = '') {
        return new Promise((resolve) => {
            const modal = document.getElementById('prompt-modal');
            const titleEl = document.getElementById('prompt-title');
            const msgEl = document.getElementById('prompt-message');
            const input = document.getElementById('prompt-input');
            const btnOk = document.getElementById('btn-prompt-ok');
            const btnCancel = document.getElementById('btn-prompt-cancel');
            if (!modal || !input || !btnOk || !btnCancel) return resolve(null);

            titleEl.textContent = title;
            msgEl.textContent = message;
            input.value = defaultValue;
            modal.classList.add('active');
            
            setTimeout(() => {
                input.focus();
                input.select();
            }, 50);

            const close = (val) => {
                modal.classList.remove('active');
                btnOk.onclick = null;
                btnCancel.onclick = null;
                input.onkeydown = null;
                resolve(val);
            };

            btnOk.onclick = () => close(input.value);
            btnCancel.onclick = () => close(null);
            input.onkeydown = (e) => {
                if (e.key === 'Enter') close(input.value);
                if (e.key === 'Escape') close(null);
            };
        });
    }

    // Themed yes/no dialog — replaces native confirm().
    function soulConfirm(title, message, okLabel = 'OK', cancelLabel = 'Cancel') {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirm-modal');
            const titleEl = document.getElementById('confirm-title');
            const msgEl = document.getElementById('confirm-message');
            const btnOk = document.getElementById('btn-confirm-ok');
            const btnCancel = document.getElementById('btn-confirm-cancel');
            if (!modal || !btnOk || !btnCancel) return resolve(confirm(message));
            titleEl.textContent = title;
            msgEl.textContent = message;
            btnOk.textContent = okLabel;
            btnCancel.textContent = cancelLabel;
            modal.classList.add('active');
            const close = (val) => {
                modal.classList.remove('active');
                btnOk.onclick = null;
                btnCancel.onclick = null;
                resolve(val);
            };
            btnOk.onclick = () => close(true);
            btnCancel.onclick = () => close(false);
        });
    }

    function fmFormatSize(bytes) {
        if (!bytes) return '0 B';
        const u = ['B','KB','MB','GB','TB'];
        let i = 0; let n = bytes;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
    }
    function fmFormatDate(ms) {
        if (!ms) return '—';
        const d = new Date(ms);
        const pad = n => String(n).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        let h = d.getHours();
        const ap = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${pad(d.getMonth()+1)}/${pad(d.getDate())}/${yy}, ${h}:${pad(d.getMinutes())} ${ap}`;
    }
    function fmIcon(entry) {
        if (entry.isDir) {
            const n = entry.name.toLowerCase();
            if (n === 'mods') return 'fa-cube';
            if (n === 'resourcepacks' || n === 'shaderpacks') return 'fa-palette';
            if (n === 'saves') return 'fa-earth-americas';
            if (n === 'crash-reports' || n === 'logs') return 'fa-triangle-exclamation';
            if (n === 'datapacks') return 'fa-code';
            return 'fa-folder';
        }
        const ext = entry.name.split('.').pop().toLowerCase();
        if (['jar','zip'].includes(ext)) return 'fa-box';
        if (['png','jpg','jpeg','webp','gif'].includes(ext)) return 'fa-image';
        if (['txt','log','json','toml','yml','yaml','cfg','properties','md'].includes(ext)) return 'fa-file-lines';
        return 'fa-file';
    }

    async function fmLoad() {
        const tbody = document.getElementById('fm-tbody');
        const empty = document.getElementById('fm-empty');
        const wrap = document.querySelector('.fm-table-wrap');
        if (!tbody || !FM.instanceName) return;
        // skeleton so transition looks clean
        if (empty) empty.classList.add('hidden');
        tbody.innerHTML = Array.from({length:7}).map(()=>`
            <tr class="fm-row"><td><div class="fm-name-cell"><span class="skeleton" style="width:28px;height:28px;display:inline-block;"></span><span class="skeleton-text long" style="height:12px;flex:1;margin-left:10px;"></span></div></td><td><span class="skeleton-text short" style="height:10px;width:52px;display:inline-block;"></span></td><td><span class="skeleton-text mid" style="height:10px;width:82px;display:inline-block;"></span></td><td><span class="skeleton-text mid" style="height:10px;width:82px;display:inline-block;"></span></td><td><div style="display:flex;gap:6px;"><span class="skeleton" style="width:34px;height:34px;"></span><span class="skeleton" style="width:34px;height:34px;"></span></div></td></tr>
        `).join('');
        if (wrap) wrap.style.opacity = '1';
        try {
            const res = await soul.listInstanceFiles(FM.instanceName, FM.path);
            FM.path = res.path || '';
            FM.entries = res.entries || [];
        } catch (e) {
            window.notifications.show('error', 'File Manager', e.message || 'Failed to load files.');
            FM.entries = [];
        }
        fmRender();
    }

    function fmRender() {
        const tbody = document.getElementById('fm-tbody');
        const empty = document.getElementById('fm-empty');
        if (!tbody) return;

        // Breadcrumb
        const crumb = document.getElementById('fm-breadcrumb');
        if (crumb) {
            const parts = FM.path ? FM.path.split('/') : [];
            const items = [`<span class="crumb" data-path="">${FM.instanceName || 'Instance'}</span>`];
            let acc = '';
            parts.forEach(p => {
                acc = acc ? `${acc}/${p}` : p;
                items.push('<span class="sep">/</span>');
                items.push(`<span class="crumb" data-path="${acc.replace(/"/g, '&quot;')}">${p}</span>`);
            });
            crumb.innerHTML = items.join('');
            crumb.querySelectorAll('.crumb').forEach(el => {
                el.onclick = () => { FM.path = el.dataset.path || ''; fmLoad(); };
            });
        }

        // Sort + filter
        const term = (FM.search || '').toLowerCase().trim();
        let list = FM.entries.slice();
        if (term) list = list.filter(e => e.name.toLowerCase().includes(term));
        const { key, dir } = FM.sort;
        const mul = dir === 'asc' ? 1 : -1;
        list.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            let va = a[key], vb = b[key];
            if (key === 'name') return mul * String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
            return mul * ((va || 0) - (vb || 0));
        });

        if (!list.length) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        tbody.innerHTML = list.map(e => {
            const sizeCell = e.isDir
                ? `<span class="fm-muted">${e.itemCount} item${e.itemCount === 1 ? '' : 's'}</span>`
                : fmFormatSize(e.size);
            return `
              <tr class="fm-row ${e.isDir ? 'fm-row-dir' : ''}" data-rel="${e.relPath.replace(/"/g, '&quot;')}" data-isdir="${e.isDir ? 1 : 0}">
                <td>
                  <div class="fm-name-cell">
                    <span class="fm-ico"><i class="fa-solid ${fmIcon(e)}"></i></span>
                    <span class="fm-name-text">${e.name}</span>
                  </div>
                </td>
                <td>${sizeCell}</td>
                <td class="fm-muted">${fmFormatDate(e.created)}</td>
                <td class="fm-muted">${fmFormatDate(e.modified)}</td>
                <td>
                  <div class="fm-actions">
                    <button class="fm-iconbtn" data-act="open" title="Open in system"><i class="fa-solid fa-up-right-from-square"></i></button>
                    <button class="fm-iconbtn" data-act="rename" title="Rename"><i class="fa-solid fa-pen"></i></button>
                    <button class="fm-iconbtn fm-danger" data-act="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>
                  </div>
                </td>
              </tr>`;
        }).join('');

        tbody.querySelectorAll('.fm-row').forEach(row => {
            const rel = row.dataset.rel;
            const isDir = row.dataset.isdir === '1';
            row.querySelector('.fm-name-text').onclick = async () => {
                if (isDir) { FM.path = rel; await fmLoad(); }
                else { await soul.openInstancePath(FM.instanceName, rel); }
            };
            row.querySelectorAll('button[data-act]').forEach(btn => {
                btn.onclick = async (ev) => {
                    ev.stopPropagation();
                    const act = btn.dataset.act;
                    if (act === 'open') {
                        try { await soul.showInstancePathInFolder(FM.instanceName, rel); }
                        catch (e) { window.notifications.show('error', 'File Manager', e.message); }
                    } else if (act === 'rename') {
                        const cur = rel.split('/').pop();
                        const next = await showPrompt('Rename', 'Enter a new name:', cur);
                        if (!next || next === cur) return;
                        try { await soul.renameInstancePath(FM.instanceName, rel, next.trim()); await fmLoad(); }
                        catch (e) { window.notifications.show('error', 'Rename Failed', e.message); }
                    } else if (act === 'delete') {
                        if (!confirm(`Delete "${rel.split('/').pop()}"? This cannot be undone.`)) return;
                        try { await soul.deleteInstancePath(FM.instanceName, rel); await fmLoad(); window.notifications.show('success', 'Deleted', rel); }
                        catch (e) { window.notifications.show('error', 'Delete Failed', e.message); }
                    }
                };
            });
        });
    }

    async function initFilesView() {
        const select = document.getElementById('files-instance-select');
        if (!select) return;

        // Refresh instance list
        try { instances = await soul.getInstances(); } catch (_) {}
        const prev = FM.instanceName;
        select.innerHTML = (instances || []).map(i =>
            `<option value="${i.name.replace(/"/g, '&quot;')}">${i.name}</option>`
        ).join('') || `<option value="">(no instances)</option>`;

        if (!instances || !instances.length) {
            FM.instanceName = null;
            document.getElementById('fm-tbody').innerHTML = '';
            document.getElementById('fm-empty')?.classList.remove('hidden');
            return;
        }

        if (!prev || !instances.find(i => i.name === prev)) {
            FM.instanceName = (selectedInstance && instances.find(i => i.name === selectedInstance.name))
                ? selectedInstance.name : instances[0].name;
            FM.path = '';
        }
        select.value = FM.instanceName;

        if (!FM.initialized) {
            FM.initialized = true;

            select.onchange = () => { FM.instanceName = select.value; FM.path = ''; fmLoad(); };
            document.getElementById('fm-refresh').onclick = () => fmLoad();
            document.getElementById('fm-home').onclick = () => { FM.path = ''; fmLoad(); };
            document.getElementById('fm-up').onclick = () => {
                if (!FM.path) return;
                FM.path = FM.path.split('/').slice(0, -1).join('/');
                fmLoad();
            };
            document.getElementById('fm-open-os').onclick = async () => {
                try { await soul.openInstancePath(FM.instanceName, FM.path); }
                catch (e) { window.notifications.show('error', 'File Manager', e.message); }
            };
            const searchInput = document.getElementById('files-search');
            searchInput.oninput = () => { FM.search = searchInput.value; fmRender(); };

            // Sort headers
            document.querySelectorAll('.fm-table thead th[data-sort]').forEach(th => {
                th.onclick = () => {
                    const k = th.dataset.sort;
                    if (FM.sort.key === k) FM.sort.dir = FM.sort.dir === 'asc' ? 'desc' : 'asc';
                    else { FM.sort.key = k; FM.sort.dir = 'asc'; }
                    fmRender();
                };
            });

            // Add menu
            const addBtn = document.getElementById('fm-add');
            const addMenu = document.getElementById('fm-add-menu');
            const closeAddMenu = () => addMenu.classList.add('hidden');
            addBtn.onclick = (e) => { e.stopPropagation(); addMenu.classList.toggle('hidden'); };
            document.addEventListener('mousedown', (e) => {
                if (!addMenu.contains(e.target) && e.target !== addBtn) closeAddMenu();
            });
            addMenu.querySelectorAll('.fm-add-item').forEach(it => {
                it.onclick = async () => {
                    closeAddMenu();
                    const act = it.dataset.act;
                    if (act === 'folder') {
                        const name = await showPrompt('New Folder', 'Enter folder name:');
                        if (!name) return;
                        try { await soul.createInstanceFolder(FM.instanceName, FM.path, name.trim()); await fmLoad(); }
                        catch (e) { window.notifications.show('error', 'Create Folder', e.message); }
                    } else if (act === 'file') {
                        const name = await showPrompt('New File', 'Enter file name (with extension):');
                        if (!name) return;
                        try { await soul.createInstanceFile(FM.instanceName, FM.path, name.trim()); await fmLoad(); }
                        catch (e) { window.notifications.show('error', 'Create File', e.message); }
                    } else if (act === 'import') {
                        try {
                            const added = await soul.importFilesToInstance(FM.instanceName, FM.path);
                            if (added && added.length) {
                                window.notifications.show('success', 'Imported', `${added.length} file(s) added.`);
                                await fmLoad();
                            }
                        } catch (e) { window.notifications.show('error', 'Import', e.message); }
                    }
                };
            });
        }

        await fmLoad();
    }

    init();
})();

// ============================================================
// LINK TO WEBSITE — signs the launcher's VERIFIED Microsoft
// identity into Soul Web with a one-time pairing code.
// The launcher publishes the verified profile (uuid + name only,
// never any token) to mc_link/<code> for 15 minutes; the website
// claims it and builds the "ms_<uuid>" wallet identity — exactly
// the same secure key family the launcher uses in game.
// ============================================================
(async () => {
    const btn = document.getElementById('btn-link-website');
    const modal = document.getElementById('link-web-modal');
    if (!btn || !modal) return;

    const codeEl = document.getElementById('link-web-code');
    const statusEl = document.getElementById('link-web-status');
    const originEl = document.getElementById('link-web-origin');
    const copyBtn = document.getElementById('btn-link-copy');
    const closeBtn = document.getElementById('btn-link-close');
    if (!codeEl || !statusEl || !copyBtn || !closeBtn) return;

    const DB = 'https://soul-backend-default-rtdb.firebaseio.com';
    const LINK_TTL = 15 * 60 * 1000;
    let closeTimer = null;
    let expireTimer = null;

    function fbReady() {
        if (typeof firebase === 'undefined') return null;
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp({
                    apiKey: 'AIzaSyCAalZXTgdIg58oip1Ang5CJVPRdp9YzzQ',
                    authDomain: 'soul-backend.firebaseapp.com',
                    databaseURL: DB,
                    projectId: 'soul-backend',
                    storageBucket: 'soul-backend.firebasestorage.app',
                    messagingSenderId: '553383169433',
                    appId: '1:553383169433:web:03aa34c90ebda216169708'
                });
            }
            return firebase.database();
        } catch (e) { console.warn('[LINK] firebase init failed', e); return null; }
    }

    function close() {
        modal.classList.remove('active');
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        if (expireTimer) { clearTimeout(expireTimer); expireTimer = null; }
    }

    copyBtn.onclick = async () => {
        const raw = (codeEl.textContent || '').trim().replace(/\s/g, '');
        try { await navigator.clipboard.writeText(raw); copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy code'; }, 1200); }
        catch (e) { window.notifications && window.notifications.show('error', 'Copy Failed', 'Select the code and copy it manually.'); }
    };
    closeBtn.onclick = close;
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    btn.onclick = async () => {
        try {
            if (modal.classList.contains('active')) return; // prevent stacking duplicate codes
            const acc = await window.soul.getSetting('currentAccount');
            if (!acc || acc.type !== 'microsoft') {
                window.notifications && window.notifications.show('warning', 'Microsoft Required', 'Select (or add) a Microsoft account, then link the website.');
                return;
            }
            const uuid = String(acc.uuid || acc.id || '').trim().toLowerCase().replace(/-/g, '').replace(/[.$#\[\]/]/g, '_');
            if (!/^[0-9a-f]{32}$/.test(uuid)) {
                window.notifications && window.notifications.show('warning', 'Not Verified', 'This session has no verified Minecraft identity. Log in with Microsoft again.');
                return;
            }
            const db = fbReady();
            if (!db) {
                window.notifications && window.notifications.show('error', 'Sign-in Services Offline', 'Firebase failed to load - try restarting the launcher.');
                return;
            }
            // 6-char code out of unambiguous characters only (no 0/O, 1/I/L)
            const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];

            navigator.clipboard && navigator.clipboard.writeText(code).catch(() => {});
            await db.ref('mc_link/' + code).set({
                status: 'pending',
                createdAt: Date.now(),
                expiresAt: Date.now() + LINK_TTL,
                accountType: 'microsoft',
                uuid: uuid,
                name: acc.name || '',
                launcherVersion: '1.0.8'
            });

            codeEl.textContent = code;
            statusEl.textContent = 'Waiting for the website\u2026 (code expires in 15 minutes)';
            try {
                originEl.textContent = 'soullauncher.vercel.app';
            } catch (_) {}
            modal.classList.add('active');

            // Auto-close a few seconds after the code is claimed or expires.
            const deadline = Date.now() + LINK_TTL;
            const watch = setInterval(async () => {
                if (!modal.classList.contains('active')) { clearInterval(watch); return; }
                try {
                    const snap = await db.ref('mc_link/' + code).once('value');
                    const val = snap && snap.val && snap.val();
                    if (!val) { statusEl.textContent = 'Code claimed by the website \u2714 You can close this window.'; clearInterval(watch); }
                    else if (Date.now() > deadline) { statusEl.textContent = 'Code expired \u2014 click "Link to Website" again to get a new one.'; clearInterval(watch); }
                } catch (_) { /* network flake - keep waiting */ }
            }, 2000);
        } catch (e) {
            console.warn('[LINK] failed', e);
            window.notifications && window.notifications.show('error', 'Link Failed', e && e.message ? e.message : String(e));
        }
    };
})();
