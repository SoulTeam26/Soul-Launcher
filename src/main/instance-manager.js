const fs = require('fs');
const gracefulFs = require('graceful-fs');
gracefulFs.gracefulify(fs);
const path = require('path');
const { app, dialog } = require('electron');
const axios = require('axios');
// Prefer IPv4 (many ISPs/routers black-hole IPv6) and bound every request so
// a dead endpoint fails fast instead of hanging the UI for tens of seconds.
axios.defaults.family = 4;
axios.defaults.timeout = 15000;
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const SOUL_PATH = path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share"), 'Soul');
const INSTANCES_PATH = path.join(SOUL_PATH, 'instances');
const VERSIONS_PATH = path.join(SOUL_PATH, 'versions');
const TEMP_PATH = path.join(SOUL_PATH, 'temp');
const CACHE_PATH = path.join(SOUL_PATH, 'cache');
const INSTANCE_ICON_PREFIX = '.soul-instance-icon';
const INSTANCE_ICON_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const INSTANCE_ICON_MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
};

// Ensure base directories exist
if (!fs.existsSync(SOUL_PATH)) fs.mkdirSync(SOUL_PATH, { recursive: true });
if (!fs.existsSync(INSTANCES_PATH)) fs.mkdirSync(INSTANCES_PATH, { recursive: true });
if (!fs.existsSync(VERSIONS_PATH)) fs.mkdirSync(VERSIONS_PATH, { recursive: true });
if (!fs.existsSync(TEMP_PATH)) fs.mkdirSync(TEMP_PATH, { recursive: true });
if (!fs.existsSync(CACHE_PATH)) fs.mkdirSync(CACHE_PATH, { recursive: true });

function findInstanceIconFile(instanceDir) {
    if (!fs.existsSync(instanceDir)) return null;

    const exactMatch = Array.from(INSTANCE_ICON_EXTENSIONS).find(ext => {
        return fs.existsSync(path.join(instanceDir, `${INSTANCE_ICON_PREFIX}${ext}`));
    });
    if (exactMatch) return `${INSTANCE_ICON_PREFIX}${exactMatch}`;

    const files = fs.readdirSync(instanceDir);
    return files.find(file => file.startsWith(INSTANCE_ICON_PREFIX)) || null;
}

function resolveInstanceIconPath(instanceDir, config = {}) {
    const configured = typeof config.iconFile === 'string' ? config.iconFile.trim() : '';
    if (configured) {
        const candidate = path.join(instanceDir, configured);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    const fallback = findInstanceIconFile(instanceDir);
    return fallback ? path.join(instanceDir, fallback) : null;
}

function readInstanceIconDataUrl(instanceDir, config = {}) {
    try {
        const iconPath = resolveInstanceIconPath(instanceDir, config);
        if (!iconPath || !fs.existsSync(iconPath)) return null;

        const ext = path.extname(iconPath).toLowerCase();
        const mimeType = INSTANCE_ICON_MIME[ext] || 'image/png';
        const iconBuffer = fs.readFileSync(iconPath);
        return `data:${mimeType};base64,${iconBuffer.toString('base64')}`;
    } catch (e) {
        return null;
    }
}

function removeInstanceIconFiles(instanceDir) {
    if (!fs.existsSync(instanceDir)) return;

    const files = fs.readdirSync(instanceDir);
    files.forEach(file => {
        if (!file.startsWith(INSTANCE_ICON_PREFIX)) return;
        try {
            fs.rmSync(path.join(instanceDir, file), { force: true });
        } catch (e) {}
    });
}

function persistInstanceIcon(instanceDir, sourcePath) {
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) return null;

    const trimmedSource = sourcePath.trim();
    if (!fs.existsSync(trimmedSource)) {
        throw new Error('Selected icon file does not exist.');
    }

    const stat = fs.statSync(trimmedSource);
    if (!stat.isFile()) {
        throw new Error('Selected icon must be a file.');
    }

    const ext = path.extname(trimmedSource).toLowerCase();
    if (!INSTANCE_ICON_EXTENSIONS.has(ext)) {
        throw new Error('Icon must be a PNG, JPG, WEBP, or GIF image.');
    }

    removeInstanceIconFiles(instanceDir);

    const targetFile = `${INSTANCE_ICON_PREFIX}${ext}`;
    const targetPath = path.join(instanceDir, targetFile);
    fs.copyFileSync(trimmedSource, targetPath);
    return targetFile;
}

function hydrateInstanceConfig(instanceDir, config = {}) {
    const hydrated = { ...config };

    if (!hydrated.mcversion && hydrated.version) {
        hydrated.mcversion = hydrated.version;
    }

    const iconPath = resolveInstanceIconPath(instanceDir, hydrated);
    if (iconPath) {
        hydrated.iconFile = path.basename(iconPath);
        hydrated.iconDataUrl = readInstanceIconDataUrl(instanceDir, hydrated);
    } else {
        delete hydrated.iconFile;
        delete hydrated.iconDataUrl;
    }

    return hydrated;
}

async function listInstances() {
    if (!fs.existsSync(INSTANCES_PATH)) return [];
    const folders = fs.readdirSync(INSTANCES_PATH);
    const instances = [];
    
    for (const folder of folders) {
        const configPath = path.join(INSTANCES_PATH, folder, 'instance.json');
        if (fs.existsSync(configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                instances.push(hydrateInstanceConfig(path.join(INSTANCES_PATH, folder), config));
            } catch (e) {
                console.error(`Failed to read instance config for ${folder}:`, e);
            }
        }
    }
    return instances;
}

async function createInstance(config, overwrite = false) {
    if (!config || typeof config !== 'object') {
        throw new Error('Invalid instance configuration.');
    }

    const cleanConfig = { ...config };
    const iconSourcePath = typeof cleanConfig.iconSourcePath === 'string'
        ? cleanConfig.iconSourcePath.trim()
        : '';

    delete cleanConfig.iconSourcePath;
    delete cleanConfig.iconDataUrl;

    cleanConfig.name = String(cleanConfig.name || '').trim();
    cleanConfig.version = String(cleanConfig.version || '').trim();
    cleanConfig.mcversion = String(cleanConfig.mcversion || cleanConfig.version || '').trim();
    cleanConfig.loader = ['vanilla', 'fabric', 'forge'].includes(cleanConfig.loader)
        ? cleanConfig.loader
        : 'vanilla';
    if (!cleanConfig.id) cleanConfig.id = `inst-${Date.now()}`;

    if (!cleanConfig.name) throw new Error('Instance name is required.');
    if (!cleanConfig.version) throw new Error('Minecraft version is required.');

    const instanceDir = path.join(INSTANCES_PATH, cleanConfig.name);
    if (fs.existsSync(instanceDir) && !overwrite) throw new Error('Instance with this name already exists.');
    
    if (!fs.existsSync(instanceDir)) {
        fs.mkdirSync(instanceDir, { recursive: true });
        fs.mkdirSync(path.join(instanceDir, 'mods'), { recursive: true });
        fs.mkdirSync(path.join(instanceDir, 'resourcepacks'), { recursive: true });
        fs.mkdirSync(path.join(instanceDir, 'shaderpacks'), { recursive: true });
        fs.mkdirSync(path.join(instanceDir, 'saves'), { recursive: true });
    }
    // versions/, libraries/, natives/ — isolated per instance so different
    // MC versions/loaders never read or write each other's jars.
    ensureInstanceRuntimeFolders(cleanConfig.name);
    
    if (iconSourcePath) {
        cleanConfig.iconFile = persistInstanceIcon(instanceDir, iconSourcePath);
    }

    const configPath = path.join(instanceDir, 'instance.json');
    fs.writeFileSync(configPath, JSON.stringify(cleanConfig, null, 2));
    return hydrateInstanceConfig(instanceDir, cleanConfig);
}

async function getFabricLoader(gameVersion) {
    try {
        const response = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`, { timeout: 8000 });
        const loaders = response.data;
        if (loaders.length === 0) return null;
        // Return the latest stable loader
        return loaders[0].loader.version;
    } catch (e) {
        console.error('Failed to fetch Fabric loader:', e.message || e);
        return null;
    }
}

async function getFabricProfile(gameVersion, loaderVersion) {
    try {
        const response = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loaderVersion}/profile/json`, { timeout: 8000 });
        return response.data;
    } catch (e) {
        console.error('Failed to fetch Fabric profile:', e.message || e);
        return null;
    }
}

/**
 * Offline-first Fabric fallback: find a Fabric profile already cached in the
 * versions folder from an earlier successful launch, so Fabric launching still
 * works when meta.fabricmc.net is unreachable (blocked / timing out) instead of
 * silently launching Vanilla and losing the Soul Client mods.
 * Returns the profile id (e.g. "fabric-loader-0.20.0-1.21.11") only when the
 * folder, its profile json (id + inheritsFrom verified) and its client jar all
 * exist, or null when nothing valid is cached.
 */
function findLocalFabricProfile(versionsPath, gameVersion) {
    if (!gameVersion || !versionsPath) return null;
    try {
        if (!fs.existsSync(versionsPath)) return null;
        const dirs = fs.readdirSync(versionsPath, { withFileTypes: true })
            .filter(d => d.isDirectory()
                && d.name.startsWith('fabric-loader-')
                && d.name.endsWith('-' + gameVersion))
            .map(d => d.name)
            .sort();
        // scan newest-first so the latest cached loader wins if several exist
        for (const id of dirs.reverse()) {
            const jsonPath = path.join(versionsPath, id, `${id}.json`);
            const jarPath = path.join(versionsPath, id, `${id}.jar`);
            if (!fs.existsSync(jsonPath) || !fs.existsSync(jarPath)) continue;
            let profile = null;
            try { profile = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (_) {}
            if (!profile || profile.id !== id) continue;
            if (profile.inheritsFrom !== gameVersion) continue;
            if (!profile.mainClass) continue;
            return id;
        }
    } catch (e) {
        console.error('findLocalFabricProfile failed:', e.message || e);
    }
    return null;
}

async function deleteInstance(name) {
    const instanceDir = path.join(INSTANCES_PATH, name);
    if (fs.existsSync(instanceDir)) {
        fs.rmSync(instanceDir, { recursive: true, force: true });
    }
    return true;
}

// GENERIC FILE MANAGER (for mods and resource packs)
async function listFiles(instanceName, subfolder, extensions = []) {
    const dirPath = path.join(INSTANCES_PATH, instanceName, subfolder);
    const disabledPath = subfolder === 'resourcepacks'
        ? path.join(INSTANCES_PATH, instanceName, '.soul-disabled', subfolder)
        : path.join(dirPath, 'disabled');
    
    if (!fs.existsSync(dirPath)) return [];
    if (!fs.existsSync(disabledPath)) fs.mkdirSync(disabledPath, { recursive: true });
    
    const files = [];
    
    const getEntries = (p) => {
        if (!fs.existsSync(p)) return [];
        return fs.readdirSync(p).filter(f => {
            if (extensions.length === 0) return true;
            const isDir = fs.statSync(path.join(p, f)).isDirectory();
            // Resource packs can be folders
            if (subfolder === 'resourcepacks' && isDir) return true;
            return extensions.some(ext => f.toLowerCase().endsWith(ext.toLowerCase()));
        });
    };

    getEntries(dirPath).forEach(file => {
        files.push({ name: file, enabled: true });
    });
    
    getEntries(disabledPath).forEach(file => {
        files.push({ name: file, enabled: false });
    });
    
    return files;
}

async function toggleFile(instanceName, subfolder, fileName, state) {
    const dirPath = path.join(INSTANCES_PATH, instanceName, subfolder);
    const disabledPath = subfolder === 'resourcepacks'
        ? path.join(INSTANCES_PATH, instanceName, '.soul-disabled', subfolder)
        : path.join(dirPath, 'disabled');
    
    const source = state ? path.join(disabledPath, fileName) : path.join(dirPath, fileName);
    const dest = state ? path.join(dirPath, fileName) : path.join(disabledPath, fileName);
    
    if (fs.existsSync(source)) {
        fs.renameSync(source, dest);
    }
    return true;
}

async function addFile(instanceName, subfolder, filters) {
    const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: filters
    });
    
    if (result.canceled) return [];
    
    const addedFiles = [];
    for (const filePath of result.filePaths) {
        const fileName = await copyFileToInstance(instanceName, filePath, subfolder);
        if (fileName) addedFiles.push(fileName);
    }
    return addedFiles;
}

async function copyFileToInstance(instanceName, sourcePath, subfolder = null) {
    if (!fs.existsSync(sourcePath)) return null;

    // Auto-detect subfolder if not provided
    if (!subfolder) {
        const ext = path.extname(sourcePath).toLowerCase();
        if (ext === '.jar') subfolder = 'mods';
        else if (ext === '.zip') subfolder = 'mods'; // or resourcepacks, but mods is safer default
        else return null;
    }

    const dirPath = path.join(INSTANCES_PATH, instanceName, subfolder);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    const fileName = path.basename(sourcePath);
    const destPath = path.join(dirPath, fileName);

    if (fs.statSync(sourcePath).isDirectory()) {
        if (fs.cpSync) {
            fs.cpSync(sourcePath, destPath, { recursive: true });
        }
    } else {
        fs.copyFileSync(sourcePath, destPath);
    }
    return fileName;
}

function extractNameVersion(fileName) {
    const clean = fileName.replace(/\.(jar|zip)$/i, '');
    const parts = clean.split(/[-_]/);
    if (parts.length < 2) {
        return { displayName: clean, version: '' }; // Changed 'unknown' to empty for cleaner UI
    }
    const last = parts[parts.length - 1];
    const versionLooksValid = /^\d+(\.\d+)*([a-zA-Z0-9._-]*)?$/.test(last) || /^(beta|alpha|rc)/i.test(last);
    if (!versionLooksValid) {
        return { displayName: clean, version: '' };
    }
    return {
        displayName: parts.slice(0, -1).join(' ').replace(/\s+/g, ' ').trim(),
        version: last
    };
}

function getFileSha1(filePath) {
    if (fs.statSync(filePath).isDirectory()) return null; // Cannot sha1 a directory easily
    const hash = crypto.createHash('sha1');
    const content = fs.readFileSync(filePath);
    hash.update(content);
    return hash.digest('hex');
}

// MODS
async function listMods(instanceName) {
    const files = await listFiles(instanceName, 'mods', ['.jar', '.zip']);
    const dirPath = path.join(INSTANCES_PATH, instanceName, 'mods');
    const disabledPath = path.join(dirPath, 'disabled');

    return files.map(file => {
        const filePath = file.enabled ? path.join(dirPath, file.name) : path.join(disabledPath, file.name);
        const meta = extractNameVersion(file.name);
        const base = {
            ...file,
            displayName: meta.displayName || file.name.replace(/\.(jar|zip)$/i, ''),
            version: meta.version,
            description: '',
            author: '',
            iconDataUrl: null
        };

        try {
            const zip = new AdmZip(filePath);
            
            // Try Fabric (fabric.mod.json)
            const fabricJson = zip.getEntry('fabric.mod.json');
            if (fabricJson) {
                const data = JSON.parse(zip.readAsText(fabricJson));
                base.displayName = data.name || base.displayName;
                base.version = data.version || base.version;
                base.description = data.description || '';
                if (data.authors) {
                    base.author = Array.isArray(data.authors) 
                        ? data.authors.map(a => typeof a === 'string' ? a : a.name).join(', ')
                        : (typeof data.authors === 'string' ? data.authors : '');
                }
                if (data.icon) {
                    const iconEntry = zip.getEntry(data.icon);
                    if (iconEntry) {
                        base.iconDataUrl = `data:image/png;base64,${iconEntry.getData().toString('base64')}`;
                    }
                }
            } else {
                // Try Forge (mcmod.info)
                const forgeJson = zip.getEntry('mcmod.info');
                if (forgeJson) {
                    const data = JSON.parse(zip.readAsText(forgeJson));
                    const mod = Array.isArray(data) ? data[0] : (data.modList ? data.modList[0] : null);
                    if (mod) {
                        base.displayName = mod.name || base.displayName;
                        base.version = mod.version || base.version;
                        base.description = mod.description || '';
                        base.author = Array.isArray(mod.authorList) ? mod.authorList.join(', ') : (mod.authors || '');
                    }
                }
            }
        } catch (e) {
            // Non-fatal metadata extraction failure
        }

        return base;
    });
}
async function toggleMod(instanceName, modName, state) {
    return toggleFile(instanceName, 'mods', modName, state);
}
async function addMod(instanceName) {
    return addFile(instanceName, 'mods', [{ name: 'Minecraft Mods', extensions: ['jar', 'zip'] }]);
}

// RESOURCE PACKS
async function listResourcePacks(instanceName) {
    const files = await listFiles(instanceName, 'resourcepacks', ['.zip']);
    const dirPath = path.join(INSTANCES_PATH, instanceName, 'resourcepacks');
    const disabledPath = path.join(INSTANCES_PATH, instanceName, '.soul-disabled', 'resourcepacks');
    const legacyDisabledPath = path.join(dirPath, 'disabled');

    // Migrate old disabled folder out of resourcepacks so Minecraft won't read it as a pack entry.
    if (fs.existsSync(legacyDisabledPath)) {
        if (!fs.existsSync(disabledPath)) fs.mkdirSync(disabledPath, { recursive: true });
        const legacyFiles = fs.readdirSync(legacyDisabledPath);
        for (const file of legacyFiles) {
            const src = path.join(legacyDisabledPath, file);
            const dst = path.join(disabledPath, file);
            if (!fs.existsSync(dst)) fs.renameSync(src, dst);
        }
        try { fs.rmSync(legacyDisabledPath, { recursive: true, force: true }); } catch (e) {}
    }
    return files.map(file => {
        const filePath = file.enabled ? path.join(dirPath, file.name) : path.join(disabledPath, file.name);
        const isDir = fs.statSync(filePath).isDirectory();
        const base = {
            ...file,
            displayName: file.name.replace(/\.zip$/i, ''),
            description: '',
            iconDataUrl: null
        };
        try {
            if (isDir) {
                const mcmetaPath = path.join(filePath, 'pack.mcmeta');
                if (fs.existsSync(mcmetaPath)) {
                    const data = JSON.parse(fs.readFileSync(mcmetaPath, 'utf8'));
                    const desc = data?.pack?.description;
                    base.description = typeof desc === 'string' ? desc : JSON.stringify(desc || '');
                }
                const iconPath = path.join(filePath, 'pack.png');
                if (fs.existsSync(iconPath)) {
                    const iconBuffer = fs.readFileSync(iconPath);
                    base.iconDataUrl = `data:image/png;base64,${iconBuffer.toString('base64')}`;
                }
            } else {
                const zip = new AdmZip(filePath);
                const mcmeta = zip.getEntry('pack.mcmeta');
                if (mcmeta) {
                    const data = JSON.parse(zip.readAsText(mcmeta));
                    const desc = data?.pack?.description;
                    base.description = typeof desc === 'string' ? desc : JSON.stringify(desc || '');
                }
                const icon = zip.getEntry('pack.png');
                if (icon) {
                    const iconBuffer = icon.getData();
                    base.iconDataUrl = `data:image/png;base64,${iconBuffer.toString('base64')}`;
                }
            }
        } catch (e) {
            // Invalid zip or malformed metadata should not break listing.
        }
        return base;
    });
}
async function toggleResourcePack(instanceName, packName, state) {
    await toggleFile(instanceName, 'resourcepacks', packName, state);
    const packs = await listResourcePacks(instanceName);
    const enabled = packs.filter(p => p.enabled).map(p => p.name);
    await writeResourcePackOrder(instanceName, enabled);
    return true;
}
async function addResourcePack(instanceName) {
    return addFile(instanceName, 'resourcepacks', [{ name: 'Resource Packs', extensions: ['zip'] }]);
}

async function checkModUpdate(instanceName, modName, loader, gameVersion) {
    const modPath = path.join(INSTANCES_PATH, instanceName, 'mods', modName);
    if (!fs.existsSync(modPath)) return null;
    try {
        const sha1 = getFileSha1(modPath);
        const fileInfoResp = await axios.get(`https://api.modrinth.com/v2/version_file/${sha1}`, {
            params: { algorithm: 'sha1' }
        });
        const fileInfo = fileInfoResp.data;
        const projectId = fileInfo.project_id;
        const currentVersion = fileInfo.version_number;
        const versionsResp = await axios.get(`https://api.modrinth.com/v2/project/${projectId}/version`, {
            params: {
                loaders: JSON.stringify([loader || 'fabric']),
                game_versions: JSON.stringify([gameVersion])
            }
        });
        const versions = versionsResp.data || [];
        if (versions.length === 0) {
            return { hasUpdate: false, currentVersion, latestVersion: currentVersion, projectId };
        }
        const latest = versions[0];
        return {
            hasUpdate: latest.version_number !== currentVersion,
            currentVersion,
            latestVersion: latest.version_number,
            latestVersionId: latest.id,
            projectId,
            latestFile: (latest.files || []).find(f => f.primary) || (latest.files || [])[0]
        };
    } catch (e) {
        return { hasUpdate: false, error: e.message };
    }
}

async function getModUpdates(instanceName, loader, gameVersion) {
    const mods = await listMods(instanceName);
    const results = [];
    for (const mod of mods.filter(entry => entry.enabled)) {
        const update = await checkModUpdate(instanceName, mod.name, loader, gameVersion);
        if (update?.hasUpdate && update.latestFile?.url) {
            results.push({ ...update, name: mod.name, displayName: mod.displayName || mod.name });
        }
    }
    return results;
}

function getModProfiles(instanceName) {
    const config = getInstanceConfig(instanceName);
    return config.modProfiles && typeof config.modProfiles === 'object' ? config.modProfiles : {};
}

async function saveModProfile(instanceName, profileName) {
    const name = String(profileName || '').trim().slice(0, 64);
    if (!name) throw new Error('Enter a profile name.');
    const config = getInstanceConfig(instanceName);
    const mods = await listMods(instanceName);
    config.modProfiles = getModProfiles(instanceName);
    config.modProfiles[name] = {
        enabled: mods.filter(mod => mod.enabled).map(mod => mod.name),
        updatedAt: Date.now()
    };
    fs.writeFileSync(path.join(getInstancePath(instanceName), 'instance.json'), JSON.stringify(config, null, 2));
    return getModProfiles(instanceName);
}

async function applyModProfile(instanceName, profileName) {
    const profile = getModProfiles(instanceName)[profileName];
    if (!profile) throw new Error('Mod profile not found.');
    const enabled = new Set(profile.enabled || []);
    const mods = await listMods(instanceName);
    for (const mod of mods) {
        if (mod.enabled !== enabled.has(mod.name)) {
            await toggleMod(instanceName, mod.name, enabled.has(mod.name));
        }
    }
    return true;
}

async function analyzeModCrash(instanceName, rawLog) {
    const log = String(rawLog || '').toLowerCase();
    const mods = await listMods(instanceName);
    const suspects = mods.filter(mod => {
        const name = String(mod.name || '').toLowerCase();
        const display = String(mod.displayName || '').toLowerCase();
        const compactName = name.replace(/[^a-z0-9]/g, '');
        const compactDisplay = display.replace(/[^a-z0-9]/g, '');
        return (name && log.includes(name)) || (display.length > 3 && log.includes(display)) ||
            (compactName.length > 5 && log.includes(compactName)) || (compactDisplay.length > 5 && log.includes(compactDisplay));
    }).map(mod => ({ name: mod.name, displayName: mod.displayName || mod.name, enabled: mod.enabled }));

    return {
        suspects: suspects.slice(0, 8),
        hasModError: /mod resolution|mixin|mod loading|failed to load mod|incompatible mod|requires .* version/.test(log)
    };
}

function classifyCrashText(text) {
    const t = String(text || '').toLowerCase();
    let culprit = null;
    let target = null;
    const mixinCulprit = String(text || '').match(/Mixin\s+\[[^\]]*?\s+from\s+mod\s+([^\]]*?)\s*\]/);
    const mixinTarget = String(text || '').match(/could not find any targets matching\s+'Lnet\/minecraft\/([^;]+);([A-Za-z]+)/);
    if (mixinCulprit) culprit = mixinCulprit[1].trim();
    if (mixinTarget) target = `${mixinTarget[2]}() in ${mixinTarget[1]} (Screen code)`;
    if (/critical injection failure|could not find any targets|mixinapplyerror|mixin transformation .* failed/.test(t)) {
        const name = culprit || 'a mod';
        const steps = [
            `Update ${name} to the version that matches this instance's Minecraft version and loader.`,
            'Check Mixin-related configs; this usually clears when the mod and its dependencies share the same Minecraft version.',
            'If updating does not help, remove or replace the mod in Mod Manager (or downgrade it to a known-good build).'
        ];
        if (target) steps.unshift(`${name} could not patch ${target}; it was built for an older/different Minecraft map.`);
        return { code: 'mixin', title: `${name} is out of date for this Minecraft version`, summary: `${name} tried to patch Minecraft's Screen code but the expected hook no longer exists in this Minecraft version.`, steps, culprit };
    }
    if (/java not found|java\.exe|could not find java|no java executable|unsupported java|class file version/.test(t)) {
        return { code: 'java', title: 'Java needs attention', summary: 'Soul could not use a compatible Java installation for this instance.', steps: ['Open Settings and choose Auto Java, or select a valid Java executable.', 'Use the built-in Java download option if Java is not installed.', 'If the log mentions a class file version, the Java is too old for this Minecraft version.'] };
    }
    if (/outofmemory|out of memory|could not reserve enough space|java heap space|gc overhead limit|allocation failure/.test(t)) {
        return { code: 'oom', title: 'Not enough memory', summary: 'Minecraft ran out of memory or could not reserve the amount assigned to it.', steps: ['Lower the RAM value in Settings and close memory-heavy programs.', 'For large modpacks, ensure your computer has enough free system memory.'] };
    }
    if (/mixin|mod resolution|failed to load mod|incompatible mod|requires .*minecraft|requires .*fabric|requires .*forge|fabric loader.*version|missing dependency|required mod|conflict on mod/.test(t)) {
        return { code: 'mods', title: 'A mod is incompatible', summary: 'The game reported a mod-loading or dependency conflict.', steps: ['Use Mod Manager to update the listed mod and its dependencies.', 'If the issue began after an install, disable the newest mod and try again.', 'Check that every mod matches this instance’s Minecraft version and loader.'] };
    }
    if (/invalid or corrupt jar|corrupt client jar|zip|central directory|unexpected end of archive|gzip|not in gzip format|classpath/.test(t)) {
        return { code: 'corrupt', title: 'A downloaded file is damaged', summary: 'One of the game or mod archives could not be read correctly.', steps: ['Launch again so Soul can re-download it.', 'If it repeats, remove the newest mod or use the repair action from the instance.'] };
    }
    if (/native|opengl|glfw|dxgi|pixel format|gpu|graphics driver|createcontext|#a problem occurred|exception in thread/.test(t)) {
        return { code: 'gpu', title: 'Display or graphics issue', summary: 'Minecraft could not set up the graphics context, usually a driver/GPU problem.', steps: ['Update your graphics drivers and restart the computer.', 'Open the instance settings and try a lower rendering distance or force the software renderer.'] };
    }
    return { code: 'unknown', title: 'Minecraft crashed', summary: 'No obvious cause was found in the crash report.', steps: ['Try launching once more after checking your Java and selected instance.', 'If it still fails, use Copy Diagnostic Report and include it with a support request.'] };
}

async function scanInstanceCrashes(instanceName) {
    const root = getInstancePath(instanceName);
    const reports = [];
    const crashReportsDir = path.join(root, 'crash-reports');
    if (fs.existsSync(crashReportsDir)) {
        let files = [];
        try { files = fs.readdirSync(crashReportsDir).filter(f => /\.txt$/i.test(f)); } catch (e) {}
        for (const file of files) {
            const full = path.join(crashReportsDir, file);
            try {
                const stat = fs.statSync(full);
                let content = '';
                try { content = fs.readFileSync(full, 'utf8').slice(0, 20000); } catch (e) {}
                const header = content.split('\n').slice(0, 6).filter(Boolean);
                reports.push({ file, time: stat.mtimeMs, size: stat.size, header, content });
            } catch (e) {}
        }
        reports.sort((a, b) => b.time - a.time);
    }

    const logsDir = path.join(root, 'logs');
    const logCandidates = [];
    if (fs.existsSync(logsDir)) {
        try {
            const files = fs.readdirSync(logsDir).filter(f => /\.log$/i.test(f));
            for (const file of files) {
                const full = path.join(logsDir, file);
                try { logCandidates.push({ file, stat: fs.statSync(full) }); } catch (e) {}
            }
            logCandidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
        } catch (e) {}
    }
    let latestLog = '';
    let latestLogFile = null;
    for (const cand of logCandidates) {
        try {
            const buf = fs.readFileSync(path.join(logsDir, cand.file), 'utf8');
            if (buf && buf.trim()) { latestLog = buf; latestLogFile = cand.file; break; }
        } catch (e) {}
    }

    const contentToScan = reports.length ? reports[0].content : latestLog;
    const classification = classifyCrashText(contentToScan);
    const analysis = await analyzeModCrash(instanceName, contentToScan);

    let suspects = analysis.suspects || [];
    const culprit = classification.culprit;
    if (culprit) {
        const mods = await listMods(instanceName);
        const matchKey = culprit.toLowerCase().replace(/[^a-z0-9]/g, '');
        const matched = mods.filter(mod => {
            const name = String(mod.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const display = String(mod.displayName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return (name && (name.includes(matchKey) || matchKey.includes(name))) ||
                (display.length > 3 && (display.includes(matchKey) || matchKey.includes(display)));
        }).map(mod => ({ name: mod.name, displayName: mod.displayName || mod.name, enabled: mod.enabled }));
        if (matched.length) {
            const known = new Set(suspects.map(s => s.name));
            suspects = [...matched.filter(m => !known.has(m.name)), ...suspects];
        }
    }
    if (suspects.length > 8) suspects = suspects.slice(0, 8);

    return {
        instanceName,
        classification,
        latestCrashReport: reports[0] ? { file: reports[0].file, header: reports[0].header } : null,
        crashReportCount: reports.length,
        hasLogs: !!latestLog,
        latestLogFile,
        latestLogTail: latestLog.slice(-6000),
        suspects,
        culprit,
        hasModError: analysis.hasModError
    };
}

function cleanupTempTrash(maxAgeMs = 24 * 60 * 60 * 1000) {
    if (!fs.existsSync(TEMP_PATH)) return 0;
    let removed = 0;
    const now = Date.now();
    const entries = fs.readdirSync(TEMP_PATH, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const trashEntryPath = path.join(TEMP_PATH, entry.name);
        const metaPath = path.join(trashEntryPath, 'meta.json');
        let createdAt = 0;
        try {
            if (fs.existsSync(metaPath)) {
                createdAt = JSON.parse(fs.readFileSync(metaPath, 'utf8')).createdAt || 0;
            }
        } catch (e) {}
        if (!createdAt) {
            createdAt = fs.statSync(trashEntryPath).mtimeMs;
        }
        if (now - createdAt > maxAgeMs) {
            fs.rmSync(trashEntryPath, { recursive: true, force: true });
            removed += 1;
        }
    }
    return removed;
}

function moveToTempTrash(instanceName, subfolder, fileName) {
    cleanupTempTrash();
    const sourcePath = path.join(INSTANCES_PATH, instanceName, subfolder, fileName);
    const disabledSourcePath = path.join(INSTANCES_PATH, instanceName, subfolder, 'disabled', fileName);
    const actualSource = fs.existsSync(sourcePath) ? sourcePath : disabledSourcePath;
    if (!fs.existsSync(actualSource)) {
        throw new Error(`File not found: ${fileName}`);
    }
    const trashId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const trashEntryPath = path.join(TEMP_PATH, trashId);
    fs.mkdirSync(trashEntryPath, { recursive: true });
    const destPath = path.join(trashEntryPath, fileName);
    fs.renameSync(actualSource, destPath);
    fs.writeFileSync(path.join(trashEntryPath, 'meta.json'), JSON.stringify({
        createdAt: Date.now(),
        instanceName,
        subfolder,
        fileName,
        sourcePath: actualSource
    }, null, 2));
    return true;
}

async function deleteMod(instanceName, modName) {
    return moveToTempTrash(instanceName, 'mods', modName);
}

async function deleteResourcePack(instanceName, packName) {
    return moveToTempTrash(instanceName, 'resourcepacks', packName);
}

function isOldVersion(versionId) {
    const parts = versionId.split('.').map(Number);
    if (parts[0] < 1) return true;
    if (parts[0] > 1) return false;
    return parts[1] < 8;
}

// In-memory + disk cache for the version manifests so the home page, version
// grid, and switch modal load instantly instead of hitting the network every
// time they are opened. TTL is generous because releases change rarely.
const VERSION_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const mcVersionCache = { data: null, at: 0 };
const fabricVersionCache = { data: null, at: 0 };
const forgeVersionCache = { data: null, at: 0 };

function loadCachedManifest(cacheKey) {
    try {
        const file = path.join(CACHE_PATH, `${cacheKey}.json`);
        if (!fs.existsSync(file)) return null;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed || !parsed.at || Date.now() - parsed.at > VERSION_CACHE_TTL) return null;
        return parsed.data;
    } catch (_) {
        return null;
    }
}

function saveCachedManifest(cacheKey, data) {
    try {
        const file = path.join(CACHE_PATH, `${cacheKey}.json`);
        fs.writeFileSync(file, JSON.stringify({ at: Date.now(), data }));
    } catch (_) { /* non-fatal */ }
}

async function getMinecraftVersions({ force = false } = {}) {
    try {
        if (!force && mcVersionCache.data && Date.now() - mcVersionCache.at < VERSION_CACHE_TTL) {
            return mcVersionCache.data;
        }
        const cached = loadCachedManifest('mc-versions');
        if (!force && cached) {
            mcVersionCache.data = cached;
            mcVersionCache.at = Date.now();
            return cached;
        }
        const response = await axios.get('https://launchermeta.mojang.com/mc/game/version_manifest.json?noCache=' + Date.now());
        const allVersions = response.data.versions.filter(v =>
            ['release', 'snapshot', 'old_beta', 'old_alpha'].includes(v.type) && !isOldVersion(v.id)
        );
        const result = { versions: allVersions };
        mcVersionCache.data = result;
        mcVersionCache.at = Date.now();
        saveCachedManifest('mc-versions', result);
        return result;
    } catch (e) {
        console.error('Failed to fetch Minecraft versions:', e);
        return { versions: [] };
    }
}

async function getFabricVersions({ force = false } = {}) {
    try {
        if (!force && fabricVersionCache.data && Date.now() - fabricVersionCache.at < VERSION_CACHE_TTL) {
            return fabricVersionCache.data;
        }
        const cached = loadCachedManifest('fabric-versions');
        if (!force && cached) {
            fabricVersionCache.data = cached;
            fabricVersionCache.at = Date.now();
            return cached;
        }
        // Fetch Minecraft versions that support Fabric
        const response = await axios.get('https://meta.fabricmc.net/v2/versions/game?noCache=' + Date.now(), { timeout: 10000 });
        // Return all stable versions
        const releases = response.data.filter(v => v.stable);
        fabricVersionCache.data = releases;
        fabricVersionCache.at = Date.now();
        saveCachedManifest('fabric-versions', releases);
        return releases;
    } catch (e) {
        console.error('Failed to fetch Fabric versions:', e);
        return [];
    }
}

function buildForgeVersionList(data) {
    const releases = data.versions.filter(v => v.type === 'release' && !isOldVersion(v.id));

    // Load legacy mapping file if present
    let legacyMap = {};
    try {
        const mapPath = path.join(__dirname, 'legacy-forge-mapping.json');
        if (fs.existsSync(mapPath)) {
            legacyMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to read legacy-forge-mapping.json:', e);
        legacyMap = {};
    }

    const versions = releases.map(v => {
        const mc = v.id;
        let forge = null;
        if (legacyMap[mc]) forge = legacyMap[mc];
        else {
            const mm = mc.split('.').slice(0,2).join('.');
            if (legacyMap[mm]) forge = legacyMap[mm];
        }
        return { id: v.id, mcversion: mc, forge };
    });

    // Also include any explicit legacy mapping entries that aren't in the official release list
    for (const key of Object.keys(legacyMap)) {
        if (isOldVersion(key)) continue;
        if (!versions.find(v => v.mcversion === key)) {
            versions.push({ id: `mapped-${key}`, mcversion: key, forge: legacyMap[key], mapped: true });
        }
    }

    return versions;
}

async function getForgeVersions({ force = false } = {}) {
    try {
        if (!force && forgeVersionCache.data && Date.now() - forgeVersionCache.at < VERSION_CACHE_TTL) {
            return forgeVersionCache.data;
        }
        const cached = loadCachedManifest('forge-versions');
        if (!force && cached) {
            forgeVersionCache.data = cached;
            forgeVersionCache.at = Date.now();
            return cached;
        }
        // Return Minecraft release versions annotated with any known Forge mappings.
        const response = await axios.get('https://launchermeta.mojang.com/mc/game/version_manifest.json?noCache=' + Date.now());
        const versions = buildForgeVersionList(response.data);
        forgeVersionCache.data = versions;
        forgeVersionCache.at = Date.now();
        saveCachedManifest('forge-versions', versions);
        return versions;
    } catch (e) {
        console.error('Failed to fetch Forge versions:', e);
        return [];
    }
}

function getInstancePath(instanceName) {
    return path.join(INSTANCES_PATH, instanceName);
}

// Per-instance version/library/native storage.
// Each instance gets its own isolated copies so launching two different
// versions/loaders (e.g. 1.8.9 then 1.8) can never mix jars, Forge profiles,
// or extracted natives between them. Assets stay shared globally since
// Mojang's asset index is content-addressed and safe to reuse across versions.
function getInstanceVersionsPath(instanceName) {
    return path.join(getInstancePath(instanceName), 'versions');
}

function getInstanceLibrariesPath(instanceName) {
    return path.join(getInstancePath(instanceName), 'libraries');
}

function getInstanceNativesPath(instanceName) {
    return path.join(getInstancePath(instanceName), 'natives');
}

function ensureInstanceRuntimeFolders(instanceName) {
    const dirs = [
        getInstanceVersionsPath(instanceName),
        getInstanceLibrariesPath(instanceName),
        getInstanceNativesPath(instanceName)
    ];
    dirs.forEach((dir) => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
}

function getInstanceConfig(instanceName) {
    const instanceDir = getInstancePath(instanceName);
    const configPath = path.join(instanceDir, 'instance.json');
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function setInstanceConfigField(instanceName, field, value) {
    const instanceDir = getInstancePath(instanceName);
    const configPath = path.join(instanceDir, 'instance.json');
    if (!fs.existsSync(configPath)) throw new Error('Instance config not found.');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config[field] = value;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
}

function getInstanceJavaChoice(instanceName) {
    const cfg = getInstanceConfig(instanceName);
    // { mode: 'auto'|'managed'|'custom', version?: '8'|'17'|'21'|'25', path?: string }
    // Backward compatible: if instance.json had older fields, handle lightly.
    if (cfg.javaChoice && typeof cfg.javaChoice === 'object') return cfg.javaChoice;
    if (cfg.javaMode && cfg.javaMode !== 'auto') {
        // legacy-ish support if someone stored it in older keys
        const mode = String(cfg.javaMode || 'auto');
        if (mode === 'managed' && cfg.javaVersion) {
            return { mode: 'managed', version: String(cfg.javaVersion) };
        }
        if (mode === 'custom' && cfg.javaCustomPath) {
            return { mode: 'custom', path: String(cfg.javaCustomPath) };
        }
    }
    return { mode: 'auto' };
}

async function setInstanceJavaChoice(instanceName, javaChoice) {
    if (!instanceName) throw new Error('Instance name is required.');

    const instanceDir = getInstancePath(instanceName);
    const configPath = path.join(instanceDir, 'instance.json');
    if (!fs.existsSync(configPath)) throw new Error('Instance config not found.');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const choice = javaChoice || { mode: 'auto' };

    const mode = String(choice.mode || 'auto');
    let normalized;
    if (mode === 'auto') {
        normalized = { mode: 'auto' };
    } else if (mode === 'managed') {
        const ver = String(choice.version || '');
        const allowed = new Set(['8', '17', '21', '25']);
        normalized = allowed.has(ver)
            ? { mode: 'managed', version: ver }
            : { mode: 'auto' };
    } else if (mode === 'custom') {
        const p = typeof choice.path === 'string' ? choice.path.trim() : '';
        normalized = p ? { mode: 'custom', path: p } : { mode: 'auto' };
    } else {
        normalized = { mode: 'auto' };
    }

    config.javaChoice = normalized;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return getInstanceJavaChoice(instanceName);
}


async function setInstanceIcon(instanceName, sourcePath) {
    const instanceDir = path.join(INSTANCES_PATH, instanceName);
    if (!fs.existsSync(instanceDir)) throw new Error('Instance not found.');

    const configPath = path.join(instanceDir, 'instance.json');
    if (!fs.existsSync(configPath)) throw new Error('Instance config not found.');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const trimmedSource = typeof sourcePath === 'string' ? sourcePath.trim() : '';

    if (!trimmedSource) {
        removeInstanceIconFiles(instanceDir);
        delete config.iconFile;
    } else {
        config.iconFile = persistInstanceIcon(instanceDir, trimmedSource);
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return hydrateInstanceConfig(instanceDir, config);
}

async function renameInstance(oldName, newName) {
    const oldPath = path.join(INSTANCES_PATH, oldName);
    const newPath = path.join(INSTANCES_PATH, newName);
    
    if (!fs.existsSync(oldPath)) throw new Error('Source instance does not exist.');
    if (fs.existsSync(newPath)) throw new Error('Target instance name already exists.');
    
    fs.renameSync(oldPath, newPath);
    
    // Update the instance.json inside
    const configPath = path.join(newPath, 'instance.json');
    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config.name = newName;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        } catch (e) {
            console.error('Failed to update instance.json during rename:', e);
        }
    }
    return true;
}

function writeResourcePackOrder(instanceName, enabledPackNamesInPriorityOrder) {
    const instanceDir = path.join(INSTANCES_PATH, instanceName);
    if (!fs.existsSync(instanceDir)) throw new Error('Instance not found.');
    const optionsPath = path.join(instanceDir, 'options.txt');
    const current = fs.existsSync(optionsPath) ? fs.readFileSync(optionsPath, 'utf8').split(/\r?\n/) : [];
    const filtered = current.filter(line => line && !line.startsWith('resourcePacks:') && !line.startsWith('incompatibleResourcePacks:'));
    const escaped = enabledPackNamesInPriorityOrder.map(n => n.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
    filtered.push(`resourcePacks:["vanilla"${escaped.map(n => `,"file/${n}"`).join('')}]`);
    filtered.push('incompatibleResourcePacks:[]');
    fs.writeFileSync(optionsPath, filtered.join('\n') + '\n', 'utf8');
    return true;
}

async function setResourcePackOrder(instanceName, orderedNames) {
    const enabledNames = (orderedNames || []).filter(Boolean);
    return writeResourcePackOrder(instanceName, enabledNames);
}

async function installModpack(mrpackUrl, packName, log, versionLabel) {
    const tempMrpackPath = path.join(TEMP_PATH, `temp-${Date.now()}.mrpack`);
    const extractPath = path.join(TEMP_PATH, `extract-${Date.now()}`);

    try {
        log(`[SYSTEM] Downloading modpack: ${packName}${versionLabel ? ' ' + versionLabel : ''}...`);
        const response = await axios.get(mrpackUrl, { responseType: 'stream' });
        const writer = fs.createWriteStream(tempMrpackPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        log(`[SYSTEM] Extracting modpack data...`);
        const zip = new AdmZip(tempMrpackPath);
        zip.extractAllTo(extractPath, true);

        const indexPath = path.join(extractPath, 'modrinth.index.json');
        if (!fs.existsSync(indexPath)) throw new Error('Invalid modpack: modrinth.index.json missing.');

        const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        const gameVersion = index.dependencies.minecraft;
        const loader = index.dependencies['fabric-loader'] ? 'fabric' : 'vanilla';

        // Build a UNIQUE instance name per version so installing a different
        // version of the same modpack does NOT overwrite the existing one.
        const baseName = (packName || index.name || `Modpack-${Date.now()}`).trim();
        const verSuffix = (versionLabel || index.versionId || '').toString().trim();
        const sanitize = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
        let instanceName = sanitize(verSuffix ? `${baseName} (${verSuffix})` : baseName);
        // If a folder with that name already exists, append #2, #3, ...
        let counter = 2;
        while (fs.existsSync(path.join(INSTANCES_PATH, instanceName))) {
            instanceName = sanitize(`${verSuffix ? `${baseName} (${verSuffix})` : baseName} #${counter}`);
            counter++;
        }

        log(`[SYSTEM] Creating instance "${instanceName}"...`);
        const config = {
            id: `modpack-${Date.now()}`,
            name: instanceName,
            version: gameVersion,
            mcversion: gameVersion,
            loader: loader,
            isModpack: true,
            modpackVersion: verSuffix || null
        };
        await createInstance(config, false);

        const instanceDir = getInstancePath(instanceName);

        // Wipe content folders that the modpack will repopulate so leftovers
        // from any prior install never mix with the selected version's files.
        const wipeFolder = (dir) => {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir)) {
                fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
            }
        };
        wipeFolder(path.join(instanceDir, 'mods'));
        wipeFolder(path.join(instanceDir, 'resourcepacks'));
        wipeFolder(path.join(instanceDir, 'shaderpacks'));
        wipeFolder(path.join(instanceDir, 'config'));

        // Download all files in parallel batches
        log(`[SYSTEM] Downloading ${index.files.length} modpack files...`);
        const CONCURRENT = 8;
        let completed = 0;

        const downloadOne = async (file) => {
            const destPath = path.join(instanceDir, file.path);
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

            // Try each mirror URL
            for (const dlUrl of file.downloads) {
                try {
                    const fileResp = await axios.get(dlUrl, {
                        responseType: 'stream',
                        timeout: 30000,
                        maxRedirects: 5
                    });
                    const fileWriter = fs.createWriteStream(destPath, { highWaterMark: 512 * 1024 });
                    fileResp.data.pipe(fileWriter);
                    await new Promise((r, j) => { fileWriter.on('finish', r); fileWriter.on('error', j); });
                    completed++;
                    log(`[FILE] (${completed}/${index.files.length}) ${path.basename(file.path)}`);
                    return;
                } catch (e) {
                    // try next mirror
                }
            }
            log(`[WARNING] Failed to download ${path.basename(file.path)} — skipping`);
        };

        // Run in batches of CONCURRENT
        for (let i = 0; i < index.files.length; i += CONCURRENT) {
            await Promise.all(index.files.slice(i, i + CONCURRENT).map(downloadOne));
        }

        // Handle overrides
        const overridesPath = path.join(extractPath, 'overrides');
        if (fs.existsSync(overridesPath)) {
            log(`[SYSTEM] Applying overrides...`);
            // Recursive copy
            const copyRecursive = (src, dest) => {
                if (fs.statSync(src).isDirectory()) {
                    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
                    fs.readdirSync(src).forEach(child => copyRecursive(path.join(src, child), path.join(dest, child)));
                } else {
                    fs.copyFileSync(src, dest);
                }
            };
            copyRecursive(overridesPath, instanceDir);
        }

        log(`[SYSTEM] Modpack installation complete!`);
        return config;

    } catch (e) {
        console.error('[MODPACK ERROR]', e);
        throw e;
    } finally {
        if (fs.existsSync(tempMrpackPath)) fs.unlinkSync(tempMrpackPath);
        if (fs.existsSync(extractPath)) fs.rmSync(extractPath, { recursive: true, force: true });
    }
}

function isVersionInstalled(versionId) {
    const versionPath = path.join(VERSIONS_PATH, versionId);
    return fs.existsSync(versionPath);
}

function isInstanceVersionInstalled(instanceName, versionId) {
    const versionPath = path.join(getInstanceVersionsPath(instanceName), versionId);
    return fs.existsSync(versionPath);
}

// Call before every launch. Instances created before this fix shipped won't
// have versions/libraries/natives folders yet — this backfills them so old
// instances get isolated automatically the next time they're launched.
function prepareInstanceForLaunch(instanceName) {
    if (!fs.existsSync(getInstancePath(instanceName))) {
        throw new Error('Instance not found.');
    }
    ensureInstanceRuntimeFolders(instanceName);
}

async function clearCache() {
    const assetsPath = path.join(SOUL_PATH, 'assets');
    const librariesPath = path.join(SOUL_PATH, 'libraries');
    if (fs.existsSync(assetsPath)) fs.rmSync(assetsPath, { recursive: true, force: true });
    if (fs.existsSync(librariesPath)) fs.rmSync(librariesPath, { recursive: true, force: true });
    if (fs.existsSync(CACHE_PATH)) fs.rmSync(CACHE_PATH, { recursive: true, force: true });
    return true;
}

async function clearData() {
    if (fs.existsSync(SOUL_PATH)) {
        fs.rmSync(SOUL_PATH, { recursive: true, force: true });
    }
    // Re-create basic folders after deletion
    if (!fs.existsSync(SOUL_PATH)) fs.mkdirSync(SOUL_PATH, { recursive: true });
    if (!fs.existsSync(INSTANCES_PATH)) fs.mkdirSync(INSTANCES_PATH, { recursive: true });
    return true;
}

// =====================================================================
// INSTANCE FILE MANAGER (Modrinth-style file browser)
// All paths are resolved + sandboxed under the instance directory.
// =====================================================================

function safeResolveInstancePath(instanceName, relPath = '') {
    const root = getInstancePath(instanceName);
    if (!fs.existsSync(root)) throw new Error('Instance not found.');
    const cleaned = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const target = path.resolve(root, cleaned);
    const rootResolved = path.resolve(root);
    if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
        throw new Error('Path escapes instance directory.');
    }
    return { root: rootResolved, target };
}

function listInstanceFiles(instanceName, relPath = '') {
    const { root, target } = safeResolveInstancePath(instanceName, relPath);
    if (!fs.existsSync(target)) return { path: '', entries: [] };
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) throw new Error('Path is not a directory.');

    const names = fs.readdirSync(target);
    const entries = names.map(name => {
        const full = path.join(target, name);
        let s;
        try { s = fs.statSync(full); } catch (_) { return null; }
        const isDir = s.isDirectory();
        let size = 0;
        let itemCount = 0;
        if (isDir) {
            try { itemCount = fs.readdirSync(full).length; } catch (_) {}
        } else {
            size = s.size;
        }
        return {
            name,
            isDir,
            size,
            itemCount,
            created: s.birthtimeMs || s.ctimeMs,
            modified: s.mtimeMs,
            relPath: path.relative(root, full).split(path.sep).join('/')
        };
    }).filter(Boolean);

    entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    return { path: path.relative(root, target).split(path.sep).join('/'), entries };
}

function readInstanceFile(instanceName, relPath = '') {
    const { target } = safeResolveInstancePath(instanceName, relPath);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
    const ext = path.extname(target).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const base64 = fs.readFileSync(target).toString('base64');
    return `data:${mime};base64,${base64}`;
}

function openInstancePath(instanceName, relPath = '') {
    const { target } = safeResolveInstancePath(instanceName, relPath);
    if (!fs.existsSync(target)) throw new Error('Path does not exist.');
    require('electron').shell.openPath(target);
    return true;
}

function showInstancePathInFolder(instanceName, relPath = '') {
    const { target } = safeResolveInstancePath(instanceName, relPath);
    if (!fs.existsSync(target)) throw new Error('Path does not exist.');
    require('electron').shell.showItemInFolder(target);
    return true;
}

function deleteInstancePath(instanceName, relPath = '') {
    const { root, target } = safeResolveInstancePath(instanceName, relPath);
    if (target === root) throw new Error('Refusing to delete instance root.');
    if (!fs.existsSync(target)) return true;
    fs.rmSync(target, { recursive: true, force: true });
    return true;
}

function createInstanceFolder(instanceName, relPath, name) {
    const cleanName = String(name || '').trim();
    if (!cleanName || /[\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..') {
        throw new Error('Invalid folder name.');
    }
    const { target } = safeResolveInstancePath(instanceName, path.posix.join(String(relPath || ''), cleanName));
    if (fs.existsSync(target)) throw new Error('A file or folder with that name already exists.');
    fs.mkdirSync(target, { recursive: true });
    return true;
}

function createInstanceFile(instanceName, relPath, name) {
    const cleanName = String(name || '').trim();
    if (!cleanName || /[\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..') {
        throw new Error('Invalid file name.');
    }
    const { target } = safeResolveInstancePath(instanceName, path.posix.join(String(relPath || ''), cleanName));
    if (fs.existsSync(target)) throw new Error('A file or folder with that name already exists.');
    const parent = path.dirname(target);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(target, '');
    return true;
}

function renameInstancePath(instanceName, relPath, newName) {
    const cleanName = String(newName || '').trim();
    if (!cleanName || /[\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..') {
        throw new Error('Invalid name.');
    }
    const { root, target } = safeResolveInstancePath(instanceName, relPath);
    if (target === root) throw new Error('Cannot rename instance root.');
    if (!fs.existsSync(target)) throw new Error('Source does not exist.');
    const dest = path.join(path.dirname(target), cleanName);
    if (fs.existsSync(dest)) throw new Error('Target name already exists.');
    fs.renameSync(target, dest);
    return true;
}

async function importFilesToInstance(instanceName, relPath, sourcePaths = []) {
    const { target } = safeResolveInstancePath(instanceName, relPath);
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
    const results = [];
    for (const src of sourcePaths) {
        if (!src || !fs.existsSync(src)) continue;
        const base = path.basename(src);
        const dest = path.join(target, base);
        fs.copyFileSync(src, dest);
        results.push(base);
    }
    return results;
}

// =====================================================================
// CONTENT TYPES: shaderpacks / worlds / datapacks
// Generic list/toggle/add/delete reuse listFiles/toggleFile/addFile and the
// temp-trash flow so behavior matches mods & resource packs.
// =====================================================================

async function listShaderpacks(instanceName) {
    const files = await listFiles(instanceName, 'shaderpacks', ['.zip']);
    return files.map(file => {
        const meta = extractNameVersion(file.name);
        return {
            ...file,
            displayName: meta.displayName || file.name.replace(/\.zip$/i, ''),
            version: meta.version,
            description: '',
            author: '',
            iconDataUrl: null
        };
    });
}

async function toggleShaderpack(instanceName, packName, state) {
    return toggleFile(instanceName, 'shaderpacks', packName, state);
}

async function addShaderpack(instanceName) {
    return addFile(instanceName, 'shaderpacks', [{ name: 'Shader Packs', extensions: ['zip'] }]);
}

async function deleteShaderpack(instanceName, packName) {
    return moveToTempTrash(instanceName, 'shaderpacks', packName);
}

function getInstanceSavesPath(instanceName) {
    return path.join(getInstancePath(instanceName), 'saves');
}

function getDirSizeRecursive(dir) {
    let total = 0;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return 0; }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        try {
            if (entry.isDirectory()) total += getDirSizeRecursive(full);
            else total += fs.statSync(full).size;
        } catch (_) {}
    }
    return total;
}

function sanitizeWorldName(worldName) {
    const clean = String(worldName || '').trim();
    if (!clean || clean === '.' || clean === '..' || /[\\/]/.test(clean)) {
        throw new Error('Invalid world name.');
    }
    return clean;
}

async function listWorlds(instanceName) {
    const saves = getInstanceSavesPath(instanceName);
    if (!fs.existsSync(saves)) return [];
    const out = [];
    let entries = [];
    try { entries = fs.readdirSync(saves, { withFileTypes: true }); } catch (_) { return []; }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const full = path.join(saves, entry.name);
        let modified = 0;
        try { modified = fs.statSync(full).mtimeMs; } catch (_) {}
        let datapackCount = 0;
        const dp = path.join(full, 'datapacks');
        if (fs.existsSync(dp)) {
            try { datapackCount = fs.readdirSync(dp).length; } catch (_) {}
        }
        out.push({
            name: entry.name,
            modified,
            size: getDirSizeRecursive(full),
            datapackCount,
            hasLevelDat: fs.existsSync(path.join(full, 'level.dat'))
        });
    }
    out.sort((a, b) => b.modified - a.modified);
    return out;
}

async function deleteWorld(instanceName, worldName) {
    const clean = sanitizeWorldName(worldName);
    const saves = getInstanceSavesPath(instanceName);
    const target = path.join(saves, clean);
    const resolved = path.resolve(target);
    if (resolved !== target || path.relative(path.resolve(saves), resolved).startsWith('..')) {
        throw new Error('Path escapes saves directory.');
    }
    if (!fs.existsSync(target)) return true;
    fs.rmSync(target, { recursive: true, force: true });
    return true;
}

function getWorldDatapacksPaths(instanceName, worldName) {
    const clean = sanitizeWorldName(worldName);
    const worldDir = path.join(getInstanceSavesPath(instanceName), clean);
    if (!fs.existsSync(worldDir)) throw new Error('World not found.');
    return {
        enabled: path.join(worldDir, 'datapacks'),
        disabled: path.join(worldDir, 'datapacks_disabled')
    };
}

async function listDatapacks(instanceName, worldName) {
    const { enabled, disabled } = getWorldDatapacksPaths(instanceName, worldName);
    if (!fs.existsSync(enabled)) fs.mkdirSync(enabled, { recursive: true });
    if (!fs.existsSync(disabled)) fs.mkdirSync(disabled, { recursive: true });
    const read = (dir, isEnabled) => {
        let names = [];
        try { names = fs.readdirSync(dir); } catch (_) { return []; }
        return names
            .filter(n => n !== '.DS_Store')
            .map(n => {
                const full = path.join(dir, n);
                let stat = null;
                try { stat = fs.statSync(full); } catch (_) { return null; }
                if (!stat.isDirectory() && !/\.zip$/i.test(n)) return null;
                const meta = extractNameVersion(n);
                return {
                    name: n,
                    enabled: isEnabled,
                    displayName: meta.displayName || n.replace(/\.zip$/i, ''),
                    version: meta.version,
                    size: stat.isDirectory() ? getDirSizeRecursive(full) : stat.size,
                    modified: stat.mtimeMs
                };
            })
            .filter(Boolean);
    };
    return [...read(enabled, true), ...read(disabled, false)];
}

async function toggleDatapack(instanceName, worldName, packName, state) {
    const { enabled, disabled } = getWorldDatapacksPaths(instanceName, worldName);
    const clean = String(packName || '').trim();
    if (!clean || clean === '.' || clean === '..' || /[\\/]/.test(clean)) throw new Error('Invalid datapack name.');
    const source = state ? path.join(disabled, clean) : path.join(enabled, clean);
    const dest = state ? path.join(enabled, clean) : path.join(disabled, clean);
    if (!fs.existsSync(source)) throw new Error('Datapack not found.');
    fs.renameSync(source, dest);
    return true;
}

async function addDatapack(instanceName, worldName) {
    const { enabled } = getWorldDatapacksPaths(instanceName, worldName);
    const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Datapacks', extensions: ['zip'] }]
    });
    if (result.canceled) return [];
    const added = [];
    for (const src of result.filePaths) {
        const base = path.basename(src);
        fs.copyFileSync(src, path.join(enabled, base));
        added.push(base);
    }
    return added;
}

async function deleteDatapack(instanceName, worldName, packName) {
    const { enabled, disabled } = getWorldDatapacksPaths(instanceName, worldName);
    const clean = String(packName || '').trim();
    if (!clean || clean === '.' || clean === '..' || /[\\/]/.test(clean)) throw new Error('Invalid datapack name.');
    const primary = path.join(enabled, clean);
    const secondary = path.join(disabled, clean);
    const target = fs.existsSync(primary) ? primary : secondary;
    if (!fs.existsSync(target)) throw new Error('Datapack not found.');
    fs.rmSync(target, { recursive: true, force: true });
    return true;
}

// =====================================================================
// INSTANCE OPS: duplicate / backup / restore / tags / groups
// =====================================================================

async function duplicateInstance(sourceName, newName) {
    const clean = String(newName || '').trim();
    if (!clean) throw new Error('New instance name is required.');
    if (/[\\/]/.test(clean) || clean === '.' || clean === '..') throw new Error('Invalid instance name.');
    const src = getInstancePath(sourceName);
    const dest = getInstancePath(clean);
    if (!fs.existsSync(src)) throw new Error('Source instance not found.');
    if (fs.existsSync(dest)) throw new Error('An instance with that name already exists.');
    fs.cpSync(src, dest, { recursive: true });
    const cfgPath = path.join(dest, 'instance.json');
    if (fs.existsSync(cfgPath)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            cfg.name = clean;
            cfg.id = `inst-${Date.now()}`;
            delete cfg.lastPlayed;
            fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
        } catch (e) {
            console.error('Failed to rewrite duplicated instance.json:', e);
        }
    }
    return hydrateInstanceConfig(dest, getInstanceConfig(clean));
}

function getBackupsDir() {
    const dir = path.join(SOUL_PATH, 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Runtime folders are re-downloadable and often gigabytes — never baked into backups.
const BACKUP_EXCLUDE_TOP = new Set(['versions', 'libraries', 'natives', '.soul-disabled']);

function addDirToZip(zip, dir, basePrefix) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
        if (!basePrefix && BACKUP_EXCLUDE_TOP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = basePrefix ? `${basePrefix}/${entry.name}` : entry.name;
        try {
            if (entry.isDirectory()) addDirToZip(zip, full, rel);
            else zip.addFile(rel, fs.readFileSync(full));
        } catch (_) {}
    }
}

async function backupInstance(instanceName) {
    const src = getInstancePath(instanceName);
    if (!fs.existsSync(src)) throw new Error('Instance not found.');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safe = String(instanceName).replace(/[\\/:*?"<>|]/g, '_');
    const file = `${safe}-${stamp}.soulbackup.zip`;
    const dest = path.join(getBackupsDir(), file);
    const zip = new AdmZip();
    addDirToZip(zip, src, '');
    zip.writeZip(dest);
    return { file, path: dest, size: fs.statSync(dest).size };
}

function listBackups() {
    const dir = getBackupsDir();
    let names = [];
    try { names = fs.readdirSync(dir).filter(f => /\.zip$/i.test(f)); } catch (_) { return []; }
    return names
        .map(f => {
            const full = path.join(dir, f);
            try {
                const stat = fs.statSync(full);
                return { file: f, path: full, size: stat.size, modified: stat.mtimeMs };
            } catch (_) { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.modified - a.modified);
}

async function deleteBackup(backupFile) {
    const full = path.join(getBackupsDir(), path.basename(String(backupFile || '')));
    if (!fs.existsSync(full)) return true;
    fs.rmSync(full, { force: true });
    return true;
}

async function restoreBackupFromPath(sourcePath, targetName) {
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Backup file not found.');
    const zip = new AdmZip(sourcePath);
    const rootConfig = zip.getEntry('instance.json');
    let name = String(targetName || '').trim();
    if (!name && rootConfig) {
        try { name = String(JSON.parse(zip.readAsText(rootConfig)).name || '').trim(); } catch (_) {}
    }
    if (!name) {
        name = path.basename(sourcePath).replace(/\.soulbackup\.zip$/i, '').replace(/\.zip$/i, '').split('-20')[0] || `Restored-${Date.now()}`;
    }
    if (/[\\/]/.test(name) || name === '.' || name === '..') throw new Error('Invalid target instance name.');
    const dest = getInstancePath(name);
    if (fs.existsSync(dest)) throw new Error('An instance with that name already exists. Delete or rename it first.');
    fs.mkdirSync(dest, { recursive: true });
    zip.extractAllTo(dest, true);
    const cfgPath = path.join(dest, 'instance.json');
    if (fs.existsSync(cfgPath)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            cfg.name = name;
            if (!cfg.id) cfg.id = `inst-${Date.now()}`;
            fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
        } catch (e) {
            console.error('Failed to rewrite restored instance.json:', e);
        }
    } else {
        fs.writeFileSync(cfgPath, JSON.stringify({ id: `inst-${Date.now()}`, name, version: '', mcversion: '', loader: 'vanilla' }, null, 2));
    }
    ensureInstanceRuntimeFolders(name);
    return hydrateInstanceConfig(dest, getInstanceConfig(name));
}

async function restoreBackup(backupFile, targetName) {
    return restoreBackupFromPath(path.join(getBackupsDir(), path.basename(String(backupFile || ''))), targetName);
}

async function setInstanceTags(instanceName, tags) {
    const arr = Array.isArray(tags) ? tags : String(tags || '').split(',');
    const clean = [...new Set(arr.map(t => String(t || '').trim().slice(0, 24)).filter(Boolean))].slice(0, 10);
    setInstanceConfigField(instanceName, 'tags', clean);
    return clean;
}

async function setInstanceGroup(instanceName, group) {
    const clean = String(group || '').trim().slice(0, 32);
    setInstanceConfigField(instanceName, 'group', clean);
    return clean;
}

function getInstanceGroups() {
    const dir = INSTANCES_PATH;
    if (!fs.existsSync(dir)) return [];
    const groups = new Set();
    let folders = [];
    try { folders = fs.readdirSync(dir); } catch (_) { return []; }
    for (const folder of folders) {
        const cfgPath = path.join(dir, folder, 'instance.json');
        if (!fs.existsSync(cfgPath)) continue;
        try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            const g = String(cfg.group || '').trim();
            if (g) groups.add(g);
        } catch (_) {}
    }
    return [...groups].sort((a, b) => a.localeCompare(b));
}

// =====================================================================
// PACK IMPORT / EXPORT (.mrpack round-trip, CurseForge manifest, backup zip)
// =====================================================================

function sha512File(filePath) {
    const hash = crypto.createHash('sha512');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

function collectPackContentFiles(instanceDir) {
    // Returns [{ abs, rel }] for portable content folders.
    const out = [];
    const roots = ['mods', 'resourcepacks', 'shaderpacks', 'config', 'datapacks'];
    for (const root of roots) {
        const absRoot = path.join(instanceDir, root);
        if (!fs.existsSync(absRoot)) continue;
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (entry.name.startsWith('.soul-instance-icon')) continue;
                out.push({ abs: full, rel: `${root}/${path.relative(absRoot, full).split(path.sep).join('/')}` });
            }
        };
        walk(absRoot);
    }
    return out;
}

async function downloadUrlToFile(dlUrl, destPath) {
    const resp = await axios.get(dlUrl, { responseType: 'stream', timeout: 60000, maxRedirects: 5 });
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const writer = fs.createWriteStream(destPath);
    resp.data.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        resp.data.on('error', reject);
    });
}

async function exportMrpack(instanceName, destPath) {
    const instanceDir = getInstancePath(instanceName);
    if (!fs.existsSync(instanceDir)) throw new Error('Instance not found.');
    if (!destPath) throw new Error('Destination path is required.');
    const config = getInstanceConfig(instanceName);
    const mcversion = config.mcversion || config.version;
    if (!mcversion) throw new Error('Instance has no Minecraft version set.');
    const loader = String(config.loader || 'vanilla').toLowerCase();

    const dependencies = { minecraft: mcversion };
    if (loader === 'fabric' || config.type === 'soulclient' || config.type === 'kruthclient') {
        try {
            const lv = await getFabricLoader(mcversion);
            if (lv) dependencies['fabric-loader'] = lv;
        } catch (_) {}
    }

    const contentFiles = collectPackContentFiles(instanceDir);
    const indexFiles = contentFiles.map(({ abs, rel }) => {
        const stat = fs.statSync(abs);
        let hashes = {};
        try { hashes = { sha1: getFileSha1(abs), sha512: sha512File(abs) }; } catch (_) {}
        return {
            path: rel,
            hashes,
            fileSize: stat.size,
            downloads: [],
            env: { client: 'required', server: 'optional' }
        };
    });

    const zip = new AdmZip();
    zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({
        formatVersion: 1,
        game: 'minecraft',
        versionId: '1.0.0',
        name: config.name || instanceName,
        summary: `Exported from Soul Launcher (${instanceName})`,
        dependencies,
        files: indexFiles
    }, null, 2)));

    // Overrides: everything portable that is NOT already a listed content file.
    const listed = new Set(contentFiles.map(f => f.rel.split('/')[0]));
    const overrideRoots = ['config', 'options.txt', 'servers.dat'];
    if (fs.existsSync(path.join(instanceDir, 'options.txt'))) {
        try { zip.addFile('overrides/options.txt', fs.readFileSync(path.join(instanceDir, 'options.txt'))); } catch (_) {}
    }
    if (fs.existsSync(path.join(instanceDir, 'servers.dat'))) {
        try { zip.addFile('overrides/servers.dat', fs.readFileSync(path.join(instanceDir, 'servers.dat'))); } catch (_) {}
    }
    const configDir = path.join(instanceDir, 'config');
    if (fs.existsSync(configDir) && !listed.has('config')) {
        const walk = (dir, prefix) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                const rel = `${prefix}/${entry.name}`;
                if (entry.isDirectory()) walk(full, rel);
                else { try { zip.addFile(`overrides/${rel}`, fs.readFileSync(full)); } catch (_) {} }
            }
        };
        walk(configDir, 'config');
    }
    void overrideRoots;

    // Bundle the content files themselves so Soul can re-import offline.
    for (const { abs, rel } of contentFiles) {
        try { zip.addFile(`overrides_pack/${rel}`, fs.readFileSync(abs)); } catch (_) {}
    }

    zip.writeZip(destPath);
    return { path: destPath, files: indexFiles.length, mcversion, loader };
}

async function exportInstanceZip(instanceName, destPath) {
    const src = getInstancePath(instanceName);
    if (!fs.existsSync(src)) throw new Error('Instance not found.');
    if (!destPath) throw new Error('Destination path is required.');
    const result = await backupInstance(instanceName);
    fs.copyFileSync(result.path, destPath);
    return { path: destPath, size: fs.statSync(destPath).size };
}

async function importPackFromFile(sourcePath) {
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Pack file not found.');
    const lower = String(sourcePath).toLowerCase();
    if (!lower.endsWith('.mrpack') && !lower.endsWith('.zip')) {
        throw new Error('Unsupported file. Choose a .mrpack or CurseForge .zip.');
    }
    const workDir = path.join(TEMP_PATH, `pack-${Date.now()}`);
    fs.mkdirSync(workDir, { recursive: true });
    try {
        const zip = new AdmZip(sourcePath);
        zip.extractAllTo(workDir, true);

        // --- Case 1: Modrinth .mrpack ---
        const mrIndexPath = path.join(workDir, 'modrinth.index.json');
        if (fs.existsSync(mrIndexPath)) {
            const index = JSON.parse(fs.readFileSync(mrIndexPath, 'utf8'));
            const gameVersion = index.dependencies?.minecraft;
            if (!gameVersion) throw new Error('Invalid modpack: no Minecraft version declared.');
            const deps = index.dependencies || {};
            const loader = deps['fabric-loader'] ? 'fabric' : deps['forge'] ? 'forge' : 'vanilla';
            const baseName = (index.name || path.basename(sourcePath, path.extname(sourcePath))).trim();
            const sanitize = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
            let instanceName = sanitize(baseName);
            let counter = 2;
            while (fs.existsSync(path.join(INSTANCES_PATH, instanceName))) {
                instanceName = sanitize(`${baseName} #${counter}`);
                counter++;
            }
            await createInstance({
                id: `modpack-${Date.now()}`,
                name: instanceName,
                version: gameVersion,
                mcversion: gameVersion,
                loader,
                isModpack: true
            }, false);
            const instanceDir = getInstancePath(instanceName);

            // Prefer bundled files (Soul exports) so import works offline.
            const bundledRoot = path.join(workDir, 'overrides_pack');
            const bundled = fs.existsSync(bundledRoot);
            let downloaded = 0;
            const skipped = [];
            for (const file of index.files || []) {
                const rel = String(file.path || '').replace(/^\/+/, '');
                if (!rel) continue;
                const destPath = path.join(instanceDir, rel);
                const bundledSrc = path.join(bundledRoot, rel);
                try {
                    if (bundled && fs.existsSync(bundledSrc)) {
                        const destDir = path.dirname(destPath);
                        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                        fs.copyFileSync(bundledSrc, destPath);
                        downloaded++;
                        continue;
                    }
                    const dlUrl = (file.downloads || [])[0];
                    if (!dlUrl) { skipped.push(rel); continue; }
                    await downloadUrlToFile(dlUrl, destPath);
                    downloaded++;
                } catch (_) {
                    skipped.push(rel);
                }
            }

            const overridesPath = path.join(workDir, 'overrides');
            if (fs.existsSync(overridesPath)) {
                const copyRecursive = (srcDir, destDir) => {
                    if (fs.statSync(srcDir).isDirectory()) {
                        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                        fs.readdirSync(srcDir).forEach(child => copyRecursive(path.join(srcDir, child), path.join(destDir, child)));
                    } else {
                        fs.copyFileSync(srcDir, destDir);
                    }
                };
                copyRecursive(overridesPath, instanceDir);
            }
            return { kind: 'mrpack', instanceName, downloaded, skipped };
        }

        // --- Case 2: CurseForge pack (manifest.json + overrides/) ---
        const manifestPath = path.join(workDir, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const gameVersion = manifest?.minecraft?.version;
            if (!gameVersion) throw new Error('Invalid CurseForge pack: no Minecraft version declared.');
            const loaders = (manifest?.minecraft?.modLoaders || []).map(l => String(l.id || '').toLowerCase());
            const loader = loaders.some(id => id.startsWith('fabric')) ? 'fabric'
                : loaders.some(id => id.startsWith('forge')) ? 'forge' : 'vanilla';
            const baseName = (manifest?.name || path.basename(sourcePath, '.zip')).trim();
            const sanitize = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
            let instanceName = sanitize(baseName);
            let counter = 2;
            while (fs.existsSync(path.join(INSTANCES_PATH, instanceName))) {
                instanceName = sanitize(`${baseName} #${counter}`);
                counter++;
            }
            await createInstance({
                id: `curse-${Date.now()}`,
                name: instanceName,
                version: gameVersion,
                mcversion: gameVersion,
                loader,
                isModpack: true,
                curseManifest: { files: manifest.files || [] }
            }, false);
            const instanceDir = getInstancePath(instanceName);
            const overridesDir = path.join(workDir, manifest.overrides || 'overrides');
            if (fs.existsSync(overridesDir)) {
                const copyRecursive = (srcDir, destDir) => {
                    if (fs.statSync(srcDir).isDirectory()) {
                        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                        fs.readdirSync(srcDir).forEach(child => copyRecursive(path.join(srcDir, child), path.join(destDir, child)));
                    } else {
                        fs.copyFileSync(srcDir, destDir);
                    }
                };
                copyRecursive(overridesDir, instanceDir);
            }
            return {
                kind: 'curseforge',
                instanceName,
                note: 'CurseForge file downloads need a CurseForge API key, so mods were not auto-downloaded. Overrides were copied; add the mods manually.',
                files: manifest.files || []
            };
        }

        // --- Case 3: Soul backup zip (instance.json at root) ---
        if (fs.existsSync(path.join(workDir, 'instance.json'))) {
            const cfg = JSON.parse(fs.readFileSync(path.join(workDir, 'instance.json'), 'utf8'));
            const target = String(cfg.name || path.basename(sourcePath, '.zip')).trim();
            const created = await restoreBackupFromPath(sourcePath, target);
            return { kind: 'soul-backup', instanceName: created.name };
        }

        throw new Error('Unrecognized pack: no modrinth.index.json, manifest.json, or instance.json found.');
    } finally {
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// =====================================================================
// PER-INSTANCE LAUNCH SETTINGS (RAM / resolution / JVM / env / hooks)
// null/empty means "use global Settings value".
// =====================================================================

const JVM_PRESETS = {
    default: [],
    g1gc: [
        '-XX:+UseG1GC',
        '-XX:+ParallelRefProcEnabled',
        '-XX:MaxGCPauseMillis=200',
        '-XX:+UnlockExperimentalVMOptions',
        '-XX:+DisableExplicitGC'
    ],
    zgc: ['-XX:+UnlockExperimentalVMOptions', '-XX:+UseZGC'],
    lowmem: ['-XX:+UseG1GC', '-Xss1M', '-XX:MaxGCPauseMillis=50', '-XX:+DisableExplicitGC']
};

const JVM_PRESET_LABELS = {
    default: 'Default (launcher)',
    g1gc: 'G1GC balanced',
    zgc: 'ZGC low-latency (Java 17+)',
    lowmem: 'Low memory'
};

function parseEnvValue(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const out = {};
        for (const [k, v] of Object.entries(raw)) {
            const key = String(k || '').trim();
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
            out[key] = String(v ?? '');
        }
        return out;
    }
    const out = {};
    for (const line of String(raw || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
        out[key] = trimmed.slice(eq + 1);
    }
    return out;
}

function getInstanceLaunchSettings(instanceName) {
    const cfg = getInstanceConfig(instanceName);
    const numOrNull = (v, min, max) => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < min || n > max) return null;
        return n;
    };
    const preset = String(cfg.jvmPreset || 'default');
    return {
        ram: numOrNull(cfg.ram, 0.5, 64),
        resW: numOrNull(cfg.resW, 640, 7680) ? Math.round(numOrNull(cfg.resW, 640, 7680)) : null,
        resH: numOrNull(cfg.resH, 360, 4320) ? Math.round(numOrNull(cfg.resH, 360, 4320)) : null,
        fullscreen: cfg.fullscreen === true ? true : cfg.fullscreen === false ? false : null,
        jvmPreset: JVM_PRESETS[preset] ? preset : 'default',
        jvmArgs: String(cfg.jvmArgs || '').slice(0, 2000),
        env: parseEnvValue(cfg.env),
        preHook: String(cfg.preHook || '').slice(0, 2000),
        postHook: String(cfg.postHook || '').slice(0, 2000)
    };
}

async function setInstanceLaunchSettings(instanceName, patch = {}) {
    const instanceDir = getInstancePath(instanceName);
    const configPath = path.join(instanceDir, 'instance.json');
    if (!fs.existsSync(configPath)) throw new Error('Instance config not found.');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const p = patch || {};

    if ('ram' in p) {
        config.ram = (p.ram === null || p.ram === '' || p.ram === undefined)
            ? undefined
            : Math.min(64, Math.max(0.5, Number(p.ram) || 0)) || undefined;
        if (config.ram === undefined) delete config.ram;
    }
    if ('resW' in p) {
        config.resW = (p.resW === null || p.resW === '' || p.resW === undefined) ? undefined : Math.round(Number(p.resW)) || undefined;
        if (config.resW === undefined) delete config.resW;
    }
    if ('resH' in p) {
        config.resH = (p.resH === null || p.resH === '' || p.resH === undefined) ? undefined : Math.round(Number(p.resH)) || undefined;
        if (config.resH === undefined) delete config.resH;
    }
    if ('fullscreen' in p) {
        if (p.fullscreen === null || p.fullscreen === undefined || p.fullscreen === '') delete config.fullscreen;
        else config.fullscreen = !!p.fullscreen;
    }
    if ('jvmPreset' in p) {
        const preset = String(p.jvmPreset || 'default');
        config.jvmPreset = JVM_PRESETS[preset] ? preset : 'default';
    }
    if ('jvmArgs' in p) config.jvmArgs = String(p.jvmArgs || '').slice(0, 2000);
    if ('env' in p) config.env = parseEnvValue(p.env);
    if ('preHook' in p) config.preHook = String(p.preHook || '').slice(0, 2000);
    if ('postHook' in p) config.postHook = String(p.postHook || '').slice(0, 2000);

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return getInstanceLaunchSettings(instanceName);
}

function splitJvmArgs(raw) {
    return String(raw || '').split(/\s+/).map(s => s.trim()).filter(Boolean);
}

function resolveEffectiveJvmArgs(globalArgs, preset, customArgs) {
    const out = [];
    const seen = new Set();
    const push = (a) => { if (a && !seen.has(a)) { seen.add(a); out.push(a); } };
    splitJvmArgs(globalArgs).forEach(push);
    (JVM_PRESETS[preset] || []).forEach(push);
    splitJvmArgs(customArgs).forEach(push);
    return out;
}

function buildLaunchCommandPreview({ javaPath, memoryGb, jvmArgsArray, mcVersion, loader, instanceName }) {
    const q = (s) => (/\s/.test(s) ? `"${s}"` : s);
    const parts = [q(javaPath || '<auto-java>')];
    const mem = parseFloat(memoryGb) || 4;
    parts.push(`-Xmx${mem}G`, `-Xms${Math.min(mem, 2)}G`);
    (jvmArgsArray || []).forEach(a => parts.push(q(a)));
    parts.push(`-Dminecraft.client.jar=.minecraft/versions/${mcVersion || '<version>'}/${mcVersion || '<version>'}.jar`);
    parts.push(`# loader=${loader || 'vanilla'} instance=${instanceName || '<none>'}`);
    return parts.join(' ');
}

module.exports = {
    listInstances,
    createInstance,
    renameInstance,
    deleteInstance,
    listMods,
    toggleMod,
    addMod,
    listResourcePacks,
    toggleResourcePack,
    addResourcePack,
    getMinecraftVersions,
    getFabricVersions,
    getForgeVersions,
    getFabricLoader,
    getFabricProfile,
    findLocalFabricProfile,
    isVersionInstalled,
    isInstanceVersionInstalled,
    checkModUpdate,
    getModUpdates,
    getModProfiles,
    saveModProfile,
    applyModProfile,
    analyzeModCrash,
    scanInstanceCrashes,
    deleteMod,
    deleteResourcePack,
    cleanupTempTrash,
    setResourcePackOrder,
    getInstancePath,
    getInstanceVersionsPath,
    getInstanceLibrariesPath,
    getInstanceNativesPath,
    prepareInstanceForLaunch,
    getInstanceConfig,
    setInstanceConfigField,
    getInstanceJavaChoice,
    setInstanceJavaChoice,
    setInstanceIcon,
    installModpack,
    copyFileToInstance,
    clearCache,
    clearData,
    listInstanceFiles,
    readInstanceFile,
    openInstancePath,
    showInstancePathInFolder,
    deleteInstancePath,
    createInstanceFolder,
    createInstanceFile,
    renameInstancePath,
    importFilesToInstance,
    // Content types: shaders / worlds / datapacks
    listShaderpacks,
    toggleShaderpack,
    addShaderpack,
    deleteShaderpack,
    listWorlds,
    deleteWorld,
    listDatapacks,
    toggleDatapack,
    addDatapack,
    deleteDatapack,
    // Instance ops
    duplicateInstance,
    getBackupsDir,
    backupInstance,
    listBackups,
    deleteBackup,
    restoreBackup,
    restoreBackupFromPath,
    setInstanceTags,
    setInstanceGroup,
    getInstanceGroups,
    // Pack import/export
    exportMrpack,
    exportInstanceZip,
    importPackFromFile,
    // Per-instance launch settings
    JVM_PRESETS,
    JVM_PRESET_LABELS,
    getInstanceLaunchSettings,
    setInstanceLaunchSettings,
    resolveEffectiveJvmArgs,
    buildLaunchCommandPreview,
    SOUL_PATH
};
