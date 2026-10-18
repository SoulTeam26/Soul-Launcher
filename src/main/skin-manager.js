const fs = require('fs');
const path = require('path');
const axios = require('axios');
const modrinth = require('./modrinth');

const SOUL_PATH = path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share"), 'Soul');
const SKINS_PATH = path.join(SOUL_PATH, 'skins');
const CAPES_PATH = path.join(SOUL_PATH, 'capes');
const ELYTRAS_PATH = path.join(SOUL_PATH, 'elytras');

if (!fs.existsSync(SKINS_PATH)) fs.mkdirSync(SKINS_PATH, { recursive: true });
if (!fs.existsSync(CAPES_PATH)) fs.mkdirSync(CAPES_PATH, { recursive: true });
if (!fs.existsSync(ELYTRAS_PATH)) fs.mkdirSync(ELYTRAS_PATH, { recursive: true });

/**
 * Download a player's skin PNG server-side (renderer fetch() is subject to
 * CORS and fails on responses without ACAO headers — Node has no such limit).
 * Saves into the skins library and returns the file name.
 */
async function downloadSkinByName(playerName) {
    const clean = String(playerName || '').trim();
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(clean)) {
        throw new Error('Enter a valid Minecraft player name (3-16 letters, numbers, underscores).');
    }
    const url = `https://minotar.net/skin/${encodeURIComponent(clean)}`;
    const resp = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 20000,
        maxRedirects: 5,
        headers: { 'User-Agent': 'SoulLauncher/1.0 (skin-downloader)' }
    });
    const buf = Buffer.from(resp.data);
    if (!buf || buf.length < 100) throw new Error('Skin download was empty.');
    if (buf.length > 2 * 1024 * 1024) throw new Error('Skin file is unexpectedly large.');
    const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    if (!buf.subarray(0, 4).equals(pngMagic)) throw new Error('The server did not return a PNG skin.');
    const fileName = `${clean}.png`;
    fs.writeFileSync(path.join(SKINS_PATH, fileName), buf);
    return fileName;
}
/**
 * Upload a skin PNG to the official Mojang profile (Microsoft accounts only).
 * Uses the minecraft profile skins endpoint with the account access token.
 * @param {{accessToken:string, skinPath:string, variant:'classic'|'slim'}} args
 */
async function uploadSkinToMojang({ accessToken, skinPath, variant = 'classic' }) {
    if (!accessToken) throw new Error('A Microsoft account access token is required.');
    if (!skinPath || !fs.existsSync(skinPath)) throw new Error('Skin file not found.');
    const variantNorm = variant === 'slim' ? 'slim' : 'classic';
    const buf = fs.readFileSync(skinPath);
    const form = new FormData();
    form.append('variant', variantNorm);
    form.append('file', new Blob([buf], { type: 'image/png' }), path.basename(skinPath));
    const resp = await axios.post(
        'https://api.minecraftservices.com/minecraft/profile/skins',
        form,
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30000 }
    );
    return resp.data;
}

async function installCustomSkinLoader(instancePath, gameVersion, loader = 'fabric') {
    const modsDir = path.join(instancePath, 'mods');
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

    const existing = fs.readdirSync(modsDir).find(f => f.toLowerCase().includes('customskinloader') && f.endsWith('.jar'));
    if (existing) {
        console.log(`[SKIN] CustomSkinLoader already installed: ${existing}`);
        return existing;
    }

    console.log(`[SKIN] Installing CustomSkinLoader for ${gameVersion} (${loader})...`);

    try {
        const searchResults = await modrinth.searchModrinth('CustomSkinLoader', 'mod', gameVersion, [loader]);
        const csl = (searchResults.hits || []).find(r => r.title.toLowerCase().includes('customskinloader') || r.slug === 'customskinloader');

        if (!csl) throw new Error('CustomSkinLoader not found on Modrinth.');

        const versions = await modrinth.getProjectVersions(csl.project_id, loader, gameVersion);
        if (versions.length === 0) throw new Error('No compatible versions found.');

        const latestVersion = versions[0];
        const file = latestVersion.files.find(f => f.primary) || latestVersion.files[0];
        const destPath = path.join(modsDir, file.filename);

        console.log(`[SKIN] Downloading from: ${file.url}`);
        await modrinth.downloadMod(file.url, destPath);
        return file.filename;
    } catch (err) {
        console.error('[SKIN] Mod Installation Failed:', err);
        throw err;
    }
}

/**
 * Write CustomSkinLoader config + LocalSkin assets.
 * @param {string} model 'default' (classic/4px) or 'slim' (3px)
 * @param {string|null} elytraFile absolute path to an elytra PNG (optional)
 */
async function setupSkinConfig(instancePath, username, skinFile, capeFile, model = 'default', elytraFile = null) {
    console.log(`[SKIN] Setting up config for ${username} at ${instancePath} (model=${model})`);
    const cslDir = path.join(instancePath, 'CustomSkinLoader');
    if (!fs.existsSync(cslDir)) fs.mkdirSync(cslDir, { recursive: true });

    const skinsDir = path.join(cslDir, 'LocalSkin', 'skins');
    const capesDir = path.join(cslDir, 'LocalSkin', 'capes');
    const elytrasDir = path.join(cslDir, 'LocalSkin', 'elytras');
    if (!fs.existsSync(skinsDir)) fs.mkdirSync(skinsDir, { recursive: true });
    if (!fs.existsSync(capesDir)) fs.mkdirSync(capesDir, { recursive: true });
    if (!fs.existsSync(elytrasDir)) fs.mkdirSync(elytrasDir, { recursive: true });

    const isSlim = model === 'slim';

    const configPath = path.join(cslDir, 'CustomSkinLoader.json');
    const config = {
        "enable": true,
        "enableSkull": true,
        "enableTransparentSkin": true,
        "enableUpdateSkull": true,
        "enableLocalProfileCache": true,
        "enableCacheAutoClean": true,
        "enableDynamicSkin": true,
        "enableCape": true,
        "enableDefaultSlim": isSlim,
        "cacheExpiry": 0,
        "ignoreHttpsCertificate": false,
        "forceIgnoreHttpsCertificate": false,
        "loadlist": [
            {
                "name": "LocalSkin",
                "type": "Legacy",
                "checkPNG": false,
                "skin": "LocalSkin/skins/{USERNAME}.png",
                "model": isSlim ? 'slim' : 'default',
                "cape": "LocalSkin/capes/{USERNAME}.{EXT}",
                "elytra": "LocalSkin/elytras/{USERNAME}.png"
            },
            { "name": "Mojang", "type": "MojangAPI" }
        ]
    };
    
    // Replace placeholder with dynamic extension for cape matching
    config.loadlist[0].cape = capeFile 
        ? `LocalSkin/capes/${username}${path.extname(capeFile)}`
        : `LocalSkin/capes/${username}.png`;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

    let appliedSkin = false;
    let appliedCape = false;
    let appliedElytra = false;

    if (skinFile && fs.existsSync(skinFile)) {
        const dest = path.join(skinsDir, `${username}.png`);
        const metaPath = path.join(skinsDir, `${username}.png.json`);
        const modelsDir = path.join(cslDir, 'LocalSkin', 'models');
        const modelPath = path.join(modelsDir, username);

        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
        if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath);

        fs.copyFileSync(skinFile, dest);

        // Sidecar metadata so CSL renders with the correct arm width in-game.
        // Without this, slim skins fall back to classic (4px arms) regardless
        // of preview selection.
        fs.writeFileSync(metaPath, JSON.stringify({ model: isSlim ? 'slim' : 'default' }, null, 2));

        // CSL also reads a per-user model file from LocalSkin/models when present.
        if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
        fs.writeFileSync(modelPath, isSlim ? 'slim' : 'default');

        console.log(`[SKIN] Copied skin to: ${dest} (model=${isSlim ? 'slim' : 'default'})`);
        appliedSkin = true;
    } else if (skinFile) {
        console.warn(`[SKIN] Skin file missing: ${skinFile}`);
    }

    if (capeFile && fs.existsSync(capeFile)) {
        const capeDest = path.join(capesDir, `${username}${path.extname(capeFile) || '.png'}`);
        // Remove old cape if exists with different extension
        const oldPng = path.join(capesDir, `${username}.png`);
        const oldGif = path.join(capesDir, `${username}.gif`);
        if (fs.existsSync(oldPng) && oldPng !== capeDest) fs.unlinkSync(oldPng);
        if (fs.existsSync(oldGif) && oldGif !== capeDest) fs.unlinkSync(oldGif);
        fs.copyFileSync(capeFile, capeDest);
        console.log(`[SKIN] Copied cape to: ${capeDest}`);
        appliedCape = true;
    } else if (capeFile) {
        console.warn(`[SKIN] Cape file missing: ${capeFile}`);
    } else if (fs.existsSync(path.join(capesDir, `${username}.png`)) || fs.existsSync(path.join(capesDir, `${username}.gif`))) {
        // Remove old cape when none selected
        const oldPng = path.join(capesDir, `${username}.png`);
        const oldGif = path.join(capesDir, `${username}.gif`);
        if (fs.existsSync(oldPng)) fs.unlinkSync(oldPng);
        if (fs.existsSync(oldGif)) fs.unlinkSync(oldGif);
        console.log(`[SKIN] Removed old cape for ${username}`);
    }

    if (elytraFile && fs.existsSync(elytraFile)) {
        const elytraDest = path.join(elytrasDir, `${username}.png`);
        fs.copyFileSync(elytraFile, elytraDest);
        console.log(`[SKIN] Copied elytra to: ${elytraDest}`);
        appliedElytra = true;
    } else if (elytraFile) {
        console.warn(`[SKIN] Elytra file missing: ${elytraFile}`);
    } else {
        const elytraDest = path.join(elytrasDir, `${username}.png`);
        if (fs.existsSync(elytraDest)) {
            fs.unlinkSync(elytraDest);
            console.log(`[SKIN] Removed old elytra for ${username}`);
        }
    }

    return { appliedSkin, appliedCape, appliedElytra, model: isSlim ? 'slim' : 'default' };
}

module.exports = {
    SKINS_PATH,
    CAPES_PATH,
    ELYTRAS_PATH,
    installCustomSkinLoader,
    setupSkinConfig,
    uploadSkinToMojang,
    downloadSkinByName
};
