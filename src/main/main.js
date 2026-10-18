/**
 * SOUL LAUNCHER - MAIN PROCESS (main.js)
 */
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
autoUpdater.autoDownload = true;
autoUpdater.logger = console;
// Private release repos (SoulTeam26/Soul-Launcher) need a token: stored
// githubPat, or GH_TOKEN/SOUL_GITHUB_TOKEN env. electron-updater reads GH_TOKEN.
try { require('./github-auth').applyUpdaterToken(); } catch (_) {}
if (app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
}
const path = require('path');
const os = require('os');
const fs = require('fs');
const gracefulFs = require('graceful-fs');
gracefulFs.gracefulify(fs);
const axios = require('axios');
// Prefer IPv4 and fail fast on dead endpoints (same as instance-manager/modrinth)
axios.defaults.family = 4;
axios.defaults.timeout = 15000;
const AdmZip = require('adm-zip');
const store = require('./store');
const { microsoftLogin, refreshMicrosoftToken } = require('./auth');
const instanceManager = require('./instance-manager');
const modrinth = require('./modrinth');
const skinManager = require('./skin-manager');
const javaManager = require('./java-manager');
const { launchForge: launchForgeCore } = require('./forge-core');
const { Client, Authenticator } = require('minecraft-launcher-core');
const APP_ICON_PATH = path.join(
  __dirname,
  process.platform === 'win32' ? '../assets/icons/icon.ico' : '../assets/icons/icon.png'
);
const BACKGROUND_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const BACKGROUNDS_PATH = path.join(instanceManager.SOUL_PATH, 'backgrounds');

function ensureBackgroundsPath() {
    if (!fs.existsSync(BACKGROUNDS_PATH)) {
        fs.mkdirSync(BACKGROUNDS_PATH, { recursive: true });
    }
}

ensureBackgroundsPath();

/**
 * Returns true only if the file at `p` is a structurally valid ZIP:
 *   1. Starts with the local-file-header magic  PK\x03\x04
 *   2. Contains the end-of-central-directory    PK\x05\x06  somewhere
 *      in the last 65 KB (the maximum allowed by the ZIP spec).
 * A partial/corrupt download passes a size check but fails test 2 (or test 1).
 * Hoisted to module scope so both downloadForgeJar() (top-level) and the
 * per-launch library/client-jar scanner can share one implementation.
 */
function isValidZip(p) {
    let fd;
    try {
        fd = fs.openSync(p, 'r');
        const stat = fs.fstatSync(fd);

        if (stat.size < 22) return false; // smaller than minimum valid ZIP

        const header = Buffer.alloc(4);
        fs.readSync(fd, header, 0, 4, 0);
        if (header.readUInt32LE(0) !== 0x04034b50) return false;

        const scanSize = Math.min(65558, stat.size);
        const tail = Buffer.alloc(scanSize);
        fs.readSync(fd, tail, 0, scanSize, stat.size - scanSize);
        const eocdMagic = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
        return tail.includes(eocdMagic);
    } catch (_) {
        return false; // unreadable file → treat as corrupt
    } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    }
}

/**
 * isValidZip() only checks the zip's outer structure: the local-file-header
 * magic at byte 0 and the end-of-central-directory magic somewhere in the
 * last 64KB. A download that was cut short mid-stream can still satisfy
 * both of those checks (the central directory can be fully written while
 * the entry *data* it points to is truncated), which is exactly the case
 * that produces MCLC's "Unexpected end of JSON input" — it unzips this jar
 * fine, but install_profile.json/version.json inside it is incomplete.
 * This does the one check that actually matters for a Forge *installer*
 * jar: open it with the same zip reader MCLC effectively does, and confirm
 * the install-profile entry it depends on is present and parses as JSON.
 */
function isValidForgeInstallerJar(p) {
    try {
        const zip = new AdmZip(p);
        const entry = zip.getEntry('install_profile.json') || zip.getEntry('version.json');
        if (!entry) return false;
        JSON.parse(zip.readAsText(entry));
        return true;
    } catch (_) {
        return false; // truncated entry data, bad central directory, unreadable, etc.
    }
}

async function downloadForgeJar(forgeVersion, suffix = 'installer', log = console.log) {
    const jarName = `forge-${forgeVersion}-${suffix}.jar`;
    const forgeDir = path.join(instanceManager.SOUL_PATH, 'forge');
    const destPath = path.join(forgeDir, jarName);

    if (!fs.existsSync(forgeDir)) {
        fs.mkdirSync(forgeDir, { recursive: true });
    }
    if (fs.existsSync(destPath)) {
        const cacheOk = fs.statSync(destPath).size > 0 && isValidZip(destPath) &&
            (suffix !== 'installer' || isValidForgeInstallerJar(destPath));
        if (cacheOk) {
            return destPath;
        }
        // Corrupt or partial download from a previous run — delete so we
        // re-download instead of silently handing MCLC a broken installer
        // (this is what causes getForgedWrapped() to throw and launch()
        // to swallow it as a silent null return).
        log(`[WARNING] Cached Forge ${suffix} jar is corrupt/incomplete. Re-downloading...`);
        try { fs.unlinkSync(destPath); } catch (_) {}
    }

    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeVersion}/${jarName}`;
    log(`[SYSTEM] Downloading Forge ${suffix}: ${url}`);

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 120000,
        maxRedirects: 10,
        headers: { 'User-Agent': 'SoulLauncher/1.0 (forge-downloader)' }
    });

    if (response.status !== 200) {
        throw new Error(`Failed to download Forge ${suffix}: ${response.status} ${response.statusText}`);
    }

    const expectedLength = Number(response.headers['content-length']) || 0;

    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });

    // A connection that drops mid-stream can still fire 'finish' on the
    // writer without 'error' on either side — axios doesn't always
    // surface a length mismatch as a rejected promise. Verify against
    // Content-Length when the server provided one, then verify the file
    // is actually a usable Forge installer before declaring success.
    const actualLength = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
    if (expectedLength > 0 && actualLength !== expectedLength) {
        try { fs.unlinkSync(destPath); } catch (_) {}
        throw new Error(`Forge ${suffix} jar download truncated: got ${actualLength} of ${expectedLength} bytes.`);
    }
    if (suffix === 'installer' && !isValidForgeInstallerJar(destPath)) {
        try { fs.unlinkSync(destPath); } catch (_) {}
        throw new Error(`Forge ${suffix} jar download for ${forgeVersion} is corrupt (install profile unreadable).`);
    }

    return destPath;
}

async function resolveForgeArtifactVersion(mcVer, candidate) {
    const metadataUrl = 'https://files.minecraftforge.net/maven/net/minecraftforge/forge/maven-metadata.xml';
    const metadataResp = await axios.get(metadataUrl);
    const xml = metadataResp.data;
    const versions = Array.from(xml.matchAll(/<version>([^<]+)<\/version>/g), m => m[1]);

    if (candidate && versions.includes(candidate)) {
        return candidate;
    }

    if (candidate) {
        const candidateMatches = versions.filter(v => v.startsWith(`${candidate}-`));
        if (candidateMatches.length) {
            return candidateMatches[candidateMatches.length - 1];
        }
    }

    const prefix = `${mcVer}-`;
    const allMatches = versions.filter(v => v.startsWith(prefix));
    return allMatches.length ? allMatches[allMatches.length - 1] : null;
}

function isModernMinecraftVersion(mcVersion) {
    const parts = String(mcVersion).split('.').map(part => parseInt(part, 10) || 0);
    if (parts[0] > 1) return true;
    if (parts[0] < 1) return false;
    return (parts[1] || 0) >= 13;
}

function getFriendlyUpdaterError(err) {
    const rawMessage = err && err.message ? String(err.message) : String(err || 'Unknown update error');
    const lower = rawMessage.toLowerCase();

    if (lower.includes('404') || lower.includes('not found')) {
        return `${rawMessage} - No published release was found in SoulTeam26/Soul-Launcher. Publish a GitHub Release with the installer, blockmap, and latest.yml.`;
    }

    if (lower.includes('latest.yml') || lower.includes('latest-mac.yml') || lower.includes('latest-linux.yml')) {
        return `${rawMessage} - The release assets are missing the update metadata file.`;
    }

    if (lower.includes('network') || lower.includes('timeout') || lower.includes('econnrefused') || lower.includes('enotfound')) {
        return `${rawMessage} - GitHub could not be reached. Check internet access and repo visibility.`;
    }

    if (lower.includes('no published versions')) {
        return 'You are up to date!';
    }

    return rawMessage;
}

function resolveUpdateNotesPath() {
    const appPath = app.getAppPath();
    const candidatePaths = [
        path.join(appPath, 'src', 'renderer', 'changelog', 'Update.txt'),
        path.join(appPath, 'src', 'renderer', 'changelog', 'update.txt'),
        path.join(appPath, 'update.txt'),
        path.join(__dirname, '../renderer/changelog/Update.txt'),
        path.join(__dirname, '../renderer/changelog/update.txt')
    ];

    return candidatePaths.find(candidatePath => fs.existsSync(candidatePath)) || null;
}

// GLOBAL ERROR HANDLING
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const launcher = new Client();
let mainWindow;

// SINGLE INSTANCE LOCK
const gotTheLock = app.requestSingleInstanceLock();
console.log(`[SYSTEM] Single instance lock: ${gotTheLock}`);

if (!gotTheLock) {
  console.log('[SYSTEM] Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 700,
      frame: false,
      transparent: false,
      backgroundColor: '#0c0c0c',
      resizable: true,
      show: false,
      icon: APP_ICON_PATH,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/loading/index.html'));

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });
  }

  // WINDOW CONTROL IPC HANDLERS
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });

  // SETTINGS PERSISTENCE HANDLERS
  ipcMain.handle('get-setting', (_, key) => store.get(key));
  ipcMain.handle('set-setting', (_, key, value) => {
    store.set(key, value);
    return true;
  });
  ipcMain.handle('get-all-settings', () => store.store);

  // SYSTEM INFO HANDLER
  ipcMain.handle('get-sys-info', () => {
    const mem = process.memoryUsage();
    return {
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      platform: os.platform(),
      release: os.release(),
      allocMem: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal
    };
  });

  // MICROSOFT AUTH HANDLER
  ipcMain.handle('ms-login', async () => {
    const account = await microsoftLogin();
    // Branded success page in the system browser (fire-and-forget).
    try { openAuthSuccessPage(account && account.name); } catch (e) {
      console.warn('[AUTH] Success page failed:', e.message);
    }
    return account;
  });

  // Serves the local "Login Successful" page once, opens it in the
  // system browser, then shuts the server down.
  function openAuthSuccessPage(playerName) {
    const http = require('http');
    const safeName = String(playerName || 'Player').replace(/[<>&"]/g, '');
    const filePath = path.join(__dirname, '..', 'renderer', 'login', 'auth-success.html');
    const bgPath = path.join(__dirname, '..', 'assets', 'backgrounds', 'Login.jpg');
    let html = fs.readFileSync(filePath, 'utf8');
    html = html.replace('{{PLAYER}}', safeName);
    let bg = null;
    try { bg = fs.readFileSync(bgPath); } catch (_) { bg = null; }
    const server = http.createServer((req, res) => {
      if (req.url === '/bg' && bg) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
        res.end(bg);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      // One-shot: close shortly after serving.
      setTimeout(() => { try { server.close(); } catch (_) {} }, 3000);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      shell.openExternal(`http://127.0.0.1:${port}/`);
    });
    // Safety: never keep the port open.
    setTimeout(() => { try { server.close(); } catch (_) {} }, 120000);
    server.on('error', (err) => console.warn('[AUTH] Success server error:', err.message));
  }

  // INSTANCE MANAGEMENT HANDLERS
  ipcMain.handle('get-instances', () => instanceManager.listInstances());
  ipcMain.handle('create-instance', (_, config) => instanceManager.createInstance(config));
  ipcMain.handle('set-instance-icon', (_, name, sourcePath) => instanceManager.setInstanceIcon(name, sourcePath));
  ipcMain.handle('rename-instance', (_, oldName, newName) => instanceManager.renameInstance(oldName, newName));
  ipcMain.handle('delete-instance', (_, name) => instanceManager.deleteInstance(name));
  ipcMain.handle('get-instance-java-choice', (_, name) => instanceManager.getInstanceJavaChoice(name));
  ipcMain.handle('set-instance-java-choice', (_, name, choice) => instanceManager.setInstanceJavaChoice(name, choice));
  ipcMain.handle('set-instance-config-field', (_, name, field, value) => instanceManager.setInstanceConfigField(name, field, value));

  // INSTANCE OPS: duplicate / backup / restore / tags / groups
  ipcMain.handle('duplicate-instance', (_, src, dest) => instanceManager.duplicateInstance(src, dest));
  ipcMain.handle('backup-instance', (_, name) => instanceManager.backupInstance(name));
  ipcMain.handle('list-backups', () => instanceManager.listBackups());
  ipcMain.handle('delete-backup', (_, file) => instanceManager.deleteBackup(file));
  ipcMain.handle('restore-backup', (_, file, targetName) => instanceManager.restoreBackup(file, targetName));
  ipcMain.handle('restore-backup-file', async (_, targetName) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Soul Backup (.zip)', extensions: ['zip'] }],
      title: 'Restore instance backup'
    });
    if (result.canceled || !result.filePaths.length) return null;
    return instanceManager.restoreBackupFromPath(result.filePaths[0], targetName);
  });
  ipcMain.handle('set-instance-tags', (_, name, tags) => instanceManager.setInstanceTags(name, tags));
  ipcMain.handle('set-instance-group', (_, name, group) => instanceManager.setInstanceGroup(name, group));
  ipcMain.handle('get-instance-groups', () => instanceManager.getInstanceGroups());

  // PACK IMPORT / EXPORT (.mrpack round-trip, CurseForge manifest, full zip)
  ipcMain.handle('export-mrpack', async (_, name) => {
    const result = await dialog.showSaveDialog({
      title: 'Export instance as .mrpack',
      defaultPath: `${name}.mrpack`,
      filters: [{ name: 'Modrinth Pack (.mrpack)', extensions: ['mrpack'] }]
    });
    if (result.canceled || !result.filePath) return null;
    return instanceManager.exportMrpack(name, result.filePath);
  });
  ipcMain.handle('export-instance-zip', async (_, name) => {
    const result = await dialog.showSaveDialog({
      title: 'Export instance backup (.zip)',
      defaultPath: `${name}-backup.zip`,
      filters: [{ name: 'Instance Backup (.zip)', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePath) return null;
    return instanceManager.exportInstanceZip(name, result.filePath);
  });
  ipcMain.handle('import-instance-pack', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Modpacks & Backups (.mrpack, .zip)', extensions: ['mrpack', 'zip'] }],
      title: 'Import modpack or backup'
    });
    if (result.canceled || !result.filePaths.length) return null;
    return instanceManager.importPackFromFile(result.filePaths[0]);
  });

  // INSTANCE FILE MANAGER (Modrinth-style)
  ipcMain.handle('list-instance-files', (_, name, relPath) => instanceManager.listInstanceFiles(name, relPath));
  ipcMain.handle('read-instance-file', (_, name, relPath) => instanceManager.readInstanceFile(name, relPath));
  ipcMain.handle('open-instance-path', (_, name, relPath) => instanceManager.openInstancePath(name, relPath));
  ipcMain.handle('show-instance-path-in-folder', (_, name, relPath) => instanceManager.showInstancePathInFolder(name, relPath));
  ipcMain.handle('delete-instance-path', (_, name, relPath) => instanceManager.deleteInstancePath(name, relPath));
  ipcMain.handle('create-instance-folder', (_, name, relPath, folderName) => instanceManager.createInstanceFolder(name, relPath, folderName));
  ipcMain.handle('create-instance-file', (_, name, relPath, fileName) => instanceManager.createInstanceFile(name, relPath, fileName));
  ipcMain.handle('rename-instance-path', (_, name, relPath, newName) => instanceManager.renameInstancePath(name, relPath, newName));
  ipcMain.handle('import-files-to-instance', async (_, name, relPath) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Import files into instance'
    });
    if (result.canceled || !result.filePaths.length) return [];
    return instanceManager.importFilesToInstance(name, relPath, result.filePaths);
  });


  ipcMain.handle('get-mc-versions',     () => instanceManager.getMinecraftVersions());
  ipcMain.handle('get-fabric-versions', () => instanceManager.getFabricVersions());
  ipcMain.handle('get-forge-versions',  () => instanceManager.getForgeVersions());
  ipcMain.handle('open-instance-folder', (_, name) => {
    const folderPath = instanceManager.getInstancePath(name);
    if (fs.existsSync(folderPath)) {
        shell.openPath(folderPath);
        return true;
    }
    return false;
  });
  ipcMain.handle('setup-folders', () => {
    if (!fs.existsSync(instanceManager.SOUL_PATH)) fs.mkdirSync(instanceManager.SOUL_PATH, { recursive: true });
    const instPath = path.join(instanceManager.SOUL_PATH, 'instances');
    if (!fs.existsSync(instPath)) fs.mkdirSync(instPath, { recursive: true });
    return true;
  });

  // MODRINTH API HANDLERS
   ipcMain.handle('search-modrinth', (_, query, type, version, loader, offset, limit, sort) => modrinth.searchModrinth(query, type, version, loader, offset, limit, sort));
  ipcMain.handle('get-modrinth-versions', (_, projectId, loader, gameVersion) => modrinth.getProjectVersions(projectId, loader, gameVersion));
  ipcMain.handle('get-modrinth-project', (_, projectId) => modrinth.getProject(projectId));
  ipcMain.handle('get-modrinth-dependencies', (_, projectId) => modrinth.getProjectDependencies(projectId));
  ipcMain.handle('install-modrinth-with-dependencies', async (_, instanceName, versionId, type = 'mod', force = false) => {
    const instance = instanceManager.getInstanceConfig(instanceName);
    const version = await modrinth.getVersion(versionId);
    const gameVersion = instance.mcversion || instance.version;
    let loader = String(instance.loader || '').toLowerCase();
    if (loader === 'soulclient' || loader === 'kruthclient') loader = 'fabric';
    const compatibleGame = !gameVersion || (version.game_versions || []).includes(gameVersion);
    const compatibleLoader = type === 'resourcepack' || type === 'shader' || !loader || loader === 'vanilla' ||
      (version.loaders || []).map(value => String(value).toLowerCase()).includes(loader);
    if ((!compatibleGame || !compatibleLoader) && !force) {
      const targets = (version.game_versions || []).slice(0, 3).join(', ') || 'other versions';
      const loaders = (version.loaders || []).join('/') || 'other loaders';
      throw new Error(`This release (${version.version_number || versionId}) targets ${targets} (${loaders}) — not compatible with ${gameVersion || 'this instance'}${loader && loader !== 'vanilla' ? ` (${loader})` : ''}. Pick a matching release from the Versions tab.`);
    }
    const subfolder = type === 'resourcepack' ? 'resourcepacks' : type === 'shader' ? 'shaderpacks' : 'mods';
    const destination = path.join(instanceManager.getInstancePath(instanceName), subfolder);
    return modrinth.downloadVersionWithDependencies(versionId, destination, new Set(), { gameVersion, loader });
  });
  ipcMain.handle('download-modrinth', (_, url, instanceName, type, filename) => {
    const subfolder = type === 'resourcepack' ? 'resourcepacks' : type === 'shader' ? 'shaderpacks' : 'mods';
    const destPath = path.join(instanceManager.getInstancePath(instanceName), subfolder, filename);
    return modrinth.downloadMod(url, destPath);
  });

  // JAVA MANAGEMENT HANDLERS
  ipcMain.handle('detect-java', () => javaManager.detectJava());
  ipcMain.handle('download-java', async (event, version) => {
    const send = (msg, pct = 0) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('java-log', { msg, pct });
        event.sender.send('java-all-progress', { msg, pct });
      }
    };
    send(`[JAVA] Starting Java ${version} download...`, 0);
    await javaManager.downloadJava(
      version,
      (pct) => send(`[JAVA] Downloading Java ${version}... ${pct}%`, pct),
      (msg) => send(msg, 0)   // speed/log lines from downloadFile
    );
    send(`[JAVA] Java ${version} installed successfully!`, 100);
    return true;
  });

  // DISCORD RPC HANDLER
  ipcMain.handle('set-rpc', (_, details, state) => {
    setActivity(details, state);
  });

  ipcMain.handle('download-all-java', async (event) => {
    const send = (msg, pct) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('java-all-progress', { msg, pct });
        event.sender.send('java-log', { msg, pct });
      }
    };
    await javaManager.downloadAllJava(({ msg, pct }) => send(msg, pct));
    return true;
  });

  ipcMain.handle('get-java-status', async () => {
    const versions = [8, 17, 21, 25];
    return versions.map(v => ({
      version: v,
      installed: javaManager.javaExists(v),
      path: javaManager.getJavaPath(v)
    }));
  });

  ipcMain.handle('install-modpack', async (event, url, packName, versionLabel) => {
    const log = (msg) => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('modpack-log', msg);
        }
    };
    try {
        return await instanceManager.installModpack(url, packName, log, versionLabel);
    } catch (e) {
        log(`[ERROR] Modpack failed: ${e.message}`);
        throw e;
    }
  });

  // LAUNCHER BOOT HANDLER
  ipcMain.handle('start-launch', async (event) => {
    const sendProgress = (pct, msg) => event.sender.send('launch-progress', { pct, msg });
    
    sendProgress(10, "Initializing system...");
    await new Promise(r => setTimeout(r, 150));

    sendProgress(30, "Checking folders...");
    if (!fs.existsSync(instanceManager.SOUL_PATH)) fs.mkdirSync(instanceManager.SOUL_PATH, { recursive: true });
    const instPath = path.join(instanceManager.SOUL_PATH, 'instances');
    if (!fs.existsSync(instPath)) fs.mkdirSync(instPath, { recursive: true });
    await new Promise(r => setTimeout(r, 150));

    sendProgress(60, "Detecting Java environment...");
    try {
        const javaPaths = await javaManager.detectJava();
        if (javaPaths.length === 0) {
            sendProgress(80, "No Java detected. Manual setup may be needed.");
        } else {
            sendProgress(80, `Found Java ${javaPaths[0].version}`);
        }
    } catch (e) {
        sendProgress(80, "Java detection failed. Continuing...");
    }
    await new Promise(r => setTimeout(r, 150));

    sendProgress(100, "System Ready");
    event.sender.send('launch-finished');
    return true;
  });

  // FILE SELECTION UTILITY
  ipcMain.handle('select-file', async (_, filters) => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters });
    return result.canceled ? [] : result.filePaths;
  });

  // MOD MANAGEMENT HANDLERS
  ipcMain.handle('get-mods', (_, instanceName) => instanceManager.listMods(instanceName));
  ipcMain.handle('toggle-mod', (_, instanceName, modName, state) => instanceManager.toggleMod(instanceName, modName, state));
  ipcMain.handle('add-mod', (_, instanceName) => instanceManager.addMod(instanceName));
  ipcMain.handle('check-mod-update', (_, instanceName, modName, loader, gameVersion) =>
    instanceManager.checkModUpdate(instanceName, modName, loader, gameVersion)
  );
  ipcMain.handle('get-mod-updates', (_, instanceName, loader, gameVersion) =>
    instanceManager.getModUpdates(instanceName, loader, gameVersion)
  );
  ipcMain.handle('get-mod-profiles', (_, instanceName) => instanceManager.getModProfiles(instanceName));
  ipcMain.handle('save-mod-profile', (_, instanceName, profileName) => instanceManager.saveModProfile(instanceName, profileName));
  ipcMain.handle('apply-mod-profile', (_, instanceName, profileName) => instanceManager.applyModProfile(instanceName, profileName));
  ipcMain.handle('analyze-mod-crash', (_, instanceName, log) => instanceManager.analyzeModCrash(instanceName, log));
  ipcMain.handle('scan-instance-crashes', (_, instanceName) => instanceManager.scanInstanceCrashes(instanceName));
  ipcMain.handle('delete-mod', (_, instanceName, modName) => instanceManager.deleteMod(instanceName, modName));
  ipcMain.handle('copy-file-to-instance', (_, instanceName, sourcePath, subfolder) =>
    instanceManager.copyFileToInstance(instanceName, sourcePath, subfolder)
  );
  ipcMain.handle('soulclient-download-deps', async (_, instanceName, gameVersion) => {
    const modsDir = path.join(instanceManager.getInstancePath(instanceName), 'mods');
    return await modrinth.downloadSoulClientDeps(gameVersion, modsDir);
  });
  ipcMain.handle('download-url-to-instance', async (_, url, instanceName, subfolder, filename) => {
    // Convert GitHub blob URLs to raw URLs
    let downloadUrl = url;
    const blobMatch = downloadUrl.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/(.+)$/);
    if (blobMatch) {
      downloadUrl = `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
    }
    const destDir = path.join(instanceManager.getInstancePath(instanceName), subfolder || 'mods');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, filename || path.basename(downloadUrl.split('?')[0]));
    await modrinth.downloadMod(downloadUrl, destPath);
    return destPath;
  });

  // RESOURCE PACK MANAGEMENT HANDLERS
  ipcMain.handle('get-resourcepacks', (_, instanceName) => instanceManager.listResourcePacks(instanceName));
  ipcMain.handle('toggle-resourcepack', (_, instanceName, packName, state) => instanceManager.toggleResourcePack(instanceName, packName, state));
  ipcMain.handle('add-resourcepack', (_, instanceName) => instanceManager.addResourcePack(instanceName));
  ipcMain.handle('delete-resourcepack', (_, instanceName, packName) => instanceManager.deleteResourcePack(instanceName, packName));
  ipcMain.handle('set-resourcepack-order', (_, instanceName, orderedNames) => instanceManager.setResourcePackOrder(instanceName, orderedNames));

  // SHADERPACK MANAGEMENT HANDLERS
  ipcMain.handle('get-shaderpacks', (_, instanceName) => instanceManager.listShaderpacks(instanceName));
  ipcMain.handle('toggle-shaderpack', (_, instanceName, packName, state) => instanceManager.toggleShaderpack(instanceName, packName, state));
  ipcMain.handle('add-shaderpack', (_, instanceName) => instanceManager.addShaderpack(instanceName));
  ipcMain.handle('delete-shaderpack', (_, instanceName, packName) => instanceManager.deleteShaderpack(instanceName, packName));

  // WORLD + DATAPACK MANAGEMENT HANDLERS
  ipcMain.handle('get-worlds', (_, instanceName) => instanceManager.listWorlds(instanceName));
  ipcMain.handle('delete-world', (_, instanceName, worldName) => instanceManager.deleteWorld(instanceName, worldName));
  ipcMain.handle('get-datapacks', (_, instanceName, worldName) => instanceManager.listDatapacks(instanceName, worldName));
  ipcMain.handle('toggle-datapack', (_, instanceName, worldName, packName, state) => instanceManager.toggleDatapack(instanceName, worldName, packName, state));
  ipcMain.handle('add-datapack', (_, instanceName, worldName) => instanceManager.addDatapack(instanceName, worldName));
  ipcMain.handle('delete-datapack', (_, instanceName, worldName, packName) => instanceManager.deleteDatapack(instanceName, worldName, packName));

  // PER-INSTANCE LAUNCH SETTINGS (RAM / resolution / JVM / env / hooks)
  ipcMain.handle('get-instance-launch-settings', (_, name) => instanceManager.getInstanceLaunchSettings(name));
  ipcMain.handle('set-instance-launch-settings', (_, name, patch) => instanceManager.setInstanceLaunchSettings(name, patch));
  ipcMain.handle('get-jvm-presets', () => instanceManager.JVM_PRESET_LABELS);
  ipcMain.handle('preview-launch-command', (_, options = {}) => {
    let instLaunch = null;
    try {
      if (options.name) instLaunch = instanceManager.getInstanceLaunchSettings(options.name);
    } catch (_) {}
    const memoryGb = (instLaunch && instLaunch.ram) || parseFloat(options.memory) || 4;
    const jvmArgs = instanceManager.resolveEffectiveJvmArgs(
      options.jvmArgs || '',
      (instLaunch && instLaunch.jvmPreset) || 'default',
      (instLaunch && instLaunch.jvmArgs) || ''
    );
    return {
      command: instanceManager.buildLaunchCommandPreview({
        javaPath: options.javaPath,
        memoryGb,
        jvmArgsArray: jvmArgs,
        mcVersion: options.mcversion || options.version,
        loader: options.loader,
        instanceName: options.name
      }),
      memoryGb,
      jvmArgs,
      jvmPreset: (instLaunch && instLaunch.jvmPreset) || 'default',
      resW: (instLaunch && instLaunch.resW) || options.resW || 1280,
      resH: (instLaunch && instLaunch.resH) || options.resH || 720,
      fullscreen: instLaunch && instLaunch.fullscreen !== null && instLaunch.fullscreen !== undefined
        ? instLaunch.fullscreen
        : !!options.fullscreen,
      env: (instLaunch && instLaunch.env) || {},
      preHook: (instLaunch && instLaunch.preHook) || '',
      postHook: (instLaunch && instLaunch.postHook) || ''
    };
  });

  let mcProcess = null;

  // UPDATED REAL LAUNCH HANDLER
  ipcMain.handle('launch-game', async (event, options) => {
    const log = (msg) => {
      if (!event.sender.isDestroyed()) {
          event.sender.send('launch-log', msg);
      }
      console.log(`[LAUNCH LOG] ${msg}`);
    };
    const sendLaunchProgress = (pct, msg) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('launch-progress', { pct, msg });
      }
    };

    try {
        const currentLauncher = new Client();
        const mclcPkg = require('minecraft-launcher-core/package.json');
        log(`[SYSTEM] MCLC Version: ${mclcPkg.version}`);
        
        // Refresh the Microsoft token before every launch.
        if (options.account.type === 'microsoft') {
            console.log('[SYSTEM] Refreshing Microsoft session...');
            const refreshed = await refreshMicrosoftToken(options.account.msmcSave);
            options.account.token    = refreshed.token;
            options.account.mclc     = refreshed.mclc;
            options.account.msmcSave = refreshed.msmcSave;

            const accounts = store.get('accounts') || [];
            const idx = accounts.findIndex(a => a.id === options.account.id);
            if (idx !== -1) {
                accounts[idx] = { ...accounts[idx], ...options.account };
                store.set('accounts', accounts);
            }
            store.set('currentAccount', options.account);
        }

        const auth = options.account.type === 'microsoft'
            ? options.account.mclc
            : Authenticator.getAuth(options.account.name);
        
        if (auth && typeof auth.user_properties === 'string') {
            try { auth.user_properties = JSON.parse(auth.user_properties); } catch(e) { auth.user_properties = {}; }
        } else if (auth && !auth.user_properties) {
            auth.user_properties = {};
        }

        console.log(`[SYSTEM] Auth prepared for: ${options.account.name} (${options.account.type})`);
        if (options.debugMode) {
            log(`[DEBUG] Auth Keys: ${Object.keys(auth || {}).join(', ')}`);
            log(`[DEBUG] Auth Name: ${auth ? auth.name : 'null'}, UUID: ${auth ? auth.uuid : 'null'}`);
        }

        const rootPath = options.name 
            ? instanceManager.getInstancePath(options.name)
            : path.join(instanceManager.SOUL_PATH, 'versions', options.version);
        
        if (!fs.existsSync(rootPath)) fs.mkdirSync(rootPath, { recursive: true });

        // --- PER-INSTANCE ISOLATION ---
        // Each instance gets its own versions/libraries/natives so launching
        // 1.8.9 then 1.8 (or any two versions/loaders) never touches the
        // other's jars, Forge profiles, or extracted native libraries.
        // Falls back to the old shared global paths only when launching
        // without a named instance (legacy/ad-hoc version launch).
        if (options.name) {
            instanceManager.prepareInstanceForLaunch(options.name);
        }
        const instanceVersionsPath = options.name
            ? instanceManager.getInstanceVersionsPath(options.name)
            : path.join(instanceManager.SOUL_PATH, 'versions');
        const instanceLibrariesPath = options.name
            ? instanceManager.getInstanceLibrariesPath(options.name)
            : path.join(instanceManager.SOUL_PATH, 'libraries');
        const instanceNativesPath = options.name
            ? instanceManager.getInstanceNativesPath(options.name)
            : path.join(instanceManager.SOUL_PATH, 'natives');

        // --- PER-INSTANCE LAUNCH SETTINGS ---
        // instance.json overrides (ram/resW/resH/fullscreen/jvmPreset/jvmArgs/
        // env/preHook/postHook) win over global Settings; null = use global.
        let instLaunch = null;
        try {
            if (options.name) instLaunch = instanceManager.getInstanceLaunchSettings(options.name);
        } catch (_) {}
        const extraJvmArgs = instanceManager.resolveEffectiveJvmArgs(
            options.jvmArgs || '',
            (instLaunch && instLaunch.jvmPreset) || 'default',
            (instLaunch && instLaunch.jvmArgs) || ''
        );
        const memoryGb = (instLaunch && instLaunch.ram) || parseFloat(options.memory) || 4;
        const effResW = (instLaunch && instLaunch.resW) || options.resW || 1280;
        const effResH = (instLaunch && instLaunch.resH) || options.resH || 720;
        const effFullscreen = instLaunch && instLaunch.fullscreen !== null && instLaunch.fullscreen !== undefined
            ? instLaunch.fullscreen
            : !!options.fullscreen;
        const runHook = (cmd, label) => new Promise((resolve) => {
            const trimmed = String(cmd || '').trim();
            if (!trimmed) return resolve();
            log(`[HOOK] Running ${label} hook: ${trimmed}`);
            require('child_process').exec(trimmed, { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
                if (stdout) log(`[HOOK:${label}] ${String(stdout).trim().slice(0, 2000)}`);
                if (err) log(`[HOOK:${label}] exited with error: ${err.message}${stderr ? ` — ${String(stderr).trim().slice(0, 500)}` : ''} (launch continues)`);
                else log(`[HOOK] ${label} hook finished.`);
                resolve();
            });
        });
        // MCLC spawns Java internally without an env passthrough, so custom
        // env vars are applied to process.env for the duration of the spawn
        // call, then restored immediately afterwards.
        const withChildEnv = async (fn) => {
            const custom = (instLaunch && instLaunch.env) || {};
            const keys = Object.keys(custom);
            if (!keys.length) return fn();
            const prev = {};
            for (const k of keys) { prev[k] = process.env[k]; process.env[k] = custom[k]; }
            try { return await fn(); }
            finally { for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
        };
        await runHook(instLaunch && instLaunch.preHook, 'pre-launch');
        const runPostHook = () => { runHook(instLaunch && instLaunch.postHook, 'post-game'); };

        // Ensure correct Java version for this Minecraft version
        let javaPath = options.javaPath;

        // Per-instance Java override: options.instanceName is the instance folder name.
        // If present, it decides what Java binary we use.
        try {
            if (options.instanceName) {
                const choice = await instanceManager.getInstanceJavaChoice(options.instanceName);
                if (choice && typeof choice === 'object') {
                    if (choice.mode === 'managed') {
                        const target = choice.version ? Number(choice.version) : null;
                        if (target) {
                            javaPath = javaManager.getJavaPath(target);
                            if (!fs.existsSync(javaPath)) {
                                javaPath = await javaManager.ensureJavaForVersion(
                                    options.mcversion || options.version,
                                    log,
                                    ({ pct, msg }) => {
                                        const mappedPct = Math.max(3, Math.min(18, 3 + Math.round((pct || 0) * 0.15)));
                                        sendLaunchProgress(mappedPct, msg || `[JAVA] Installing Java ${target}... ${pct || 0}%`);
                                    }
                                );
                                // ensureJavaForVersion might choose a required one based on mcVersion;
                                // but since we're overriding, we want exact managed version.
                                // If it picked a different one, force-download exact version.
                                if (javaManager.javaExists && javaManager.javaExists(target) && fs.existsSync(javaManager.getJavaPath(target))) {
                                    javaPath = javaManager.getJavaPath(target);
                                } else {
                                    // If exact managed version is still missing, download it directly.
                                    if (!javaManager.javaExists || !javaManager.javaExists(target)) {
                                        if (javaManager.downloadJava) {
                                            await javaManager.downloadJava(target, () => {}, log);
                                        }
                                    }
                                    if (fs.existsSync(javaManager.getJavaPath(target))) {
                                        javaPath = javaManager.getJavaPath(target);
                                    }
                                }
                            }
                        }
                    } else if (choice.mode === 'custom') {
                        const p = typeof choice.path === 'string' ? choice.path.trim() : '';
                        if (p) javaPath = p;
                    }
                    // mode === 'auto' does nothing (keeps existing behavior)
                }
            }
        } catch (e) {
            log(`[WARNING] Per-instance Java override failed: ${e.message}`);
        }

        // Verify the resolved javaPath meets the MC version's minimum Java requirement.
        // If the user has a custom/system Java that is too old, auto-download the
        // correct version rather than letting the launch fail with an
        // UnsupportedClassVersionError.
        if (javaPath) {
            const mcVer = options.mcversion || options.version;
            const minRequired = javaManager.getMinJavaVersion(mcVer);
            const currentVersion = await javaManager.getJavaVersion(javaPath);
            const currentMajor = javaManager.parseJavaMajor(currentVersion);
            if (currentMajor > 0 && currentMajor < minRequired) {
                log(`[JAVA] ${javaPath} is Java ${currentMajor}, but ${mcVer} requires Java ${minRequired}. Switching...`);
                javaPath = await javaManager.ensureJavaForVersion(mcVer, log, ({ pct, msg }) => {
                    const mappedPct = Math.max(3, Math.min(18, 3 + Math.round((pct || 0) * 0.15)));
                    sendLaunchProgress(mappedPct, msg || `[JAVA] Installing Java ${minRequired}... ${pct || 0}%`);
                });
            }
        }

        if (!javaPath) {
            javaPath = await javaManager.ensureJavaForVersion(
                options.mcversion || options.version,
                log,
                ({ pct, msg }) => {
                    const mappedPct = Math.max(3, Math.min(18, 3 + Math.round((pct || 0) * 0.15)));
                    sendLaunchProgress(mappedPct, msg || `[JAVA] Installing required Java... ${pct || 0}%`);
                }
            );
        }


        // --- LOADER HANDLING ---
        let versionObj = {
            number: String(options.mcversion || options.version),
            type: "release"
        };
        let detectedForge = null;
        let forgeJarPath = null;

        if (options.debugMode) {
            log(`[DEBUG] Target Version: ${versionObj.number}`);
        }

        // Soul Client uses Fabric under the hood
        if (options.loader === 'soulclient') options.loader = 'fabric';

        if (options.loader === 'fabric') {
            log(`[SYSTEM] Preparing Fabric loader for ${options.version}...`);
            // Offline-first: reuse a Fabric profile already cached in this
            // instance's versions folder (from an earlier launch). meta.fabricmc.net
            // can be unreachable — Fabric must still launch with the Soul Client
            // mods instead of silently falling back to Vanilla.
            const cachedFabric = instanceManager.findLocalFabricProfile(
                instanceVersionsPath, options.mcversion || options.version);
            if (cachedFabric) {
                log(`[SYSTEM] Using cached Fabric loader: ${cachedFabric}`);
                versionObj.custom = cachedFabric;  // ✅ string ID, not the object
                log(`[SYSTEM] Fabric profile prepared: ${cachedFabric}`);
            } else {
                const loaderVersion = await instanceManager.getFabricLoader(options.mcversion || options.version);
                if (loaderVersion) {
                    log(`[SYSTEM] Found Fabric loader: ${loaderVersion}`);
                    const profile = await instanceManager.getFabricProfile(options.mcversion || options.version, loaderVersion);
                    if (profile) {
                        // Write profile JSON to disk so MCLC can definitely find it
                        // (per-instance versions path — keeps Fabric profiles isolated
                        // the same way Forge profiles are isolated below)
                        const vPath = path.join(instanceVersionsPath, profile.id);
                        if (!fs.existsSync(vPath)) fs.mkdirSync(vPath, { recursive: true });
                        fs.writeFileSync(path.join(vPath, `${profile.id}.json`), JSON.stringify(profile, null, 2));

                        versionObj.custom = profile.id;   // ✅ string ID, not the object
                        // ✅ versionObj.number stays as the vanilla version — don't touch it
                        log(`[SYSTEM] Fabric profile prepared: ${profile.id}`);
                    } else {
                        log(`[WARNING] Failed to load Fabric profile. Falling back to Vanilla.`);
                    }
                } else {
                    log(`[WARNING] No Fabric loader found for this version. Falling back to Vanilla.`);
                }
            }
        } else if (options.loader === 'forge') {
            log(`[SYSTEM] Checking for Forge version compatible with ${options.mcversion || options.version}...`);
            try {
                const mcVer = options.mcversion || options.version;

                // Try promotions first
                const forgeResp = await axios.get('https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json');
                const promos = forgeResp.data.promos || {};
                let forgeVer = promos[`${mcVer}-latest`] || promos[`${mcVer}-recommended`];

                if (forgeVer) {
                    if (!forgeVer.includes(mcVer)) {
                        forgeVer = `${mcVer}-${forgeVer}`;
                    }
                    detectedForge = await resolveForgeArtifactVersion(mcVer, forgeVer);
                    if (detectedForge) {
                        log(`[SYSTEM] Forge loader detected: ${detectedForge}`);
                    }
                }

                if (!detectedForge) {
                    log(`[SYSTEM] No promo found for ${mcVer}. Searching Forge manifest...`);
                    const manifestResp = await axios.get('https://files.minecraftforge.net/maven/net/minecraftforge/forge/maven-metadata.xml');
                    const xml = manifestResp.data;
                    const regex = new RegExp(`<version>${mcVer.replace(/\./g, '\\.')}-([^<]+)</version>`, 'g');
                    let match;
                    let latestMatch = null;
                    while ((match = regex.exec(xml)) !== null) {
                        latestMatch = match[1];
                    }
                    if (latestMatch) {
                        const candidate = `${mcVer}-${latestMatch}`;
                        detectedForge = await resolveForgeArtifactVersion(mcVer, candidate);
                        if (detectedForge) {
                            log(`[SYSTEM] Forge version found in manifest: ${detectedForge}`);
                        }
                    }
                    
                    if (!detectedForge) {
                        try {
                            const manifestVersions = Array.from(xml.matchAll(/<version>([^<]+)<\/version>/g), m => m[1]);
                            const looseMatches = manifestVersions.filter(v => (
                                v.startsWith(`${mcVer}-`) || v.startsWith(mcVer) || v.includes(`${mcVer}-`)
                            ));
                            if (looseMatches.length) {
                                detectedForge = looseMatches[looseMatches.length - 1];
                                log(`[SYSTEM] Forge version selected from manifest list: ${detectedForge}`);
                            }
                        } catch (sweepErr) {
                            log(`[WARNING] Manifest sweep failed: ${sweepErr.message}`);
                        }
                    }

                    if (!detectedForge) {
                        try {
                            const mapPath = path.join(__dirname, 'legacy-forge-mapping.json');
                            if (fs.existsSync(mapPath)) {
                                const raw = fs.readFileSync(mapPath, 'utf8');
                                const legacyMap = JSON.parse(raw);
                                if (legacyMap[mcVer]) {
                                    detectedForge = legacyMap[mcVer];
                                    log(`[SYSTEM] Using legacy mapping for ${mcVer} -> ${detectedForge}`);
                                } else {
                                    const mm = mcVer.split('.').slice(0,2).join('.');
                                    if (legacyMap[mm]) {
                                        detectedForge = legacyMap[mm];
                                        log(`[SYSTEM] Using legacy mapping for series ${mm} -> ${detectedForge}`);
                                    }
                                }
                            }
                        } catch (mapErr) {
                            log(`[WARNING] Legacy mapping read failed: ${mapErr.message}`);
                        }
                    }
                }

                if (detectedForge) {
                    log(`[SYSTEM] Using Forge core launcher for ${detectedForge}.`);
                    const forgeLog = (msg) => {
                        if (!options.debugMode && String(msg).startsWith('[DEBUG]')) return;
                        log(msg);
                    };
                    const forgeProc = await withChildEnv(() => launchForgeCore({
                        soulPath: instanceManager.SOUL_PATH,
                        instanceRoot: options.name ? rootPath : undefined,
                        versionsPath: instanceVersionsPath,
                        librariesPath: instanceLibrariesPath,
                        nativesPath: instanceNativesPath,
                        gameDirectory: rootPath,
                        mcVersion: mcVer,
                        forgeBuild: detectedForge,
                        auth,
                        javaPath,
                        memoryGb,
                        resolution: effFullscreen
                            ? { fullscreen: true }
                            : { width: effResW, height: effResH },
                        extraJvmArgs
                    }, forgeLog, ({ pct, msg }) => {
                        if (!event.sender.isDestroyed()) {
                            event.sender.send('launch-progress', { pct, msg });
                        }
                    }));

                    mcProcess = forgeProc;
                    log(`[SYSTEM] Game process started (PID: ${forgeProc.pid})`);

                    forgeProc.on('close', (code) => {
                        log(`[SYSTEM] Game process exited with code ${code}`);
                        if (!event.sender.isDestroyed()) {
                            event.sender.send('launch-finished');
                        }
                        mcProcess = null;
                        runPostHook();
                    });

                    return true;
                }

                if (!detectedForge) {
                    log(`[WARNING] No Forge version found for ${mcVer}. Falling back to Vanilla.`);
                }
            } catch (e) {
                log(`[ERROR] Forge setup failed: ${e.message}`);
            }
        }

        if (options.debugMode) {
            log(`[DEBUG] Auth prepared. UUID: ${auth ? auth.uuid : 'MISSING'}, Name: ${auth ? auth.name : 'MISSING'}`);
        }

        if (javaPath && !fs.existsSync(javaPath)) {
            log(`[ERROR] Java not found at: ${javaPath}`);
            if (!event.sender.isDestroyed()) {
                event.sender.send('launch-error', `Java not found at: ${javaPath}`);
            }
            return false;
        }
        // --- SOUL COINS / COSMETICS: secure account key for the in-game mod ---
        // The mod reads cosmetics ownership from capes/inventory/<key>:
        //   Soul accounts      -> soul_<FirebaseUID>
        //   Microsoft accounts -> ms_<MojangUUID> (no dashes)
        //   Offline accounts   -> no key at all; the mod keeps cosmetics locked.
        // This is what keeps Microsoft and Soul purchases separate even when
        // both point at the same Minecraft username.
        let soulAccountKey = '';
        try {
            if (options.account && options.account.type === 'firebase' && options.account.uid) {
                soulAccountKey = 'soul_' + String(options.account.uid).trim().replace(/[.$#\[\]/]/g, '_');
            } else if (options.account && options.account.type === 'microsoft') {
                let mu = String((auth && auth.uuid) || (options.account.id) || '').trim().toLowerCase().replace(/-/g, '').replace(/[.$#\[\]/]/g, '_');
                if (/^[0-9a-f]{32}$/.test(mu)) soulAccountKey = 'ms_' + mu;
            }
        } catch (_) {}
        if (soulAccountKey) log(`[SYSTEM] Cosmetics account key: ${soulAccountKey}`);
        else log(`[SYSTEM] No cosmetics account key (offline/unknown session) — cosmetics stay locked in game.`);
        const soulJvmArgs = soulAccountKey ? ['-Dsoul.accountKey=' + soulAccountKey] : [];

        const launchOpts = {
            authorization: auth,
            // MCLC's getClasses()/getVersion() resolve <root>/versions and
            // <root>/libraries directly — overrides.versionRoot/libraryRoot
            // are NOT consulted for those lookups in this MCLC version.
            // root must be the per-instance folder itself so the per-instance
            // versions/ and libraries/ subfolders are what actually get read.
            root: options.name ? rootPath : instanceManager.SOUL_PATH,
            version: versionObj,
            forge: (forgeJarPath && forgeJarPath.endsWith('-installer.jar')) ? forgeJarPath : undefined,
            memory: {
                max: `${memoryGb}G`,
                min: `${Math.min(memoryGb, 2)}G`
            },
            overrides: {
                assetRoot:     path.join(instanceManager.SOUL_PATH, 'assets'),
                natives:       instanceNativesPath,
                gameDirectory: rootPath        // ✅ per-instance saves/mods/configs go here
            },
            window: effFullscreen
                ? { fullscreen: true }
                : { width: effResW, height: effResH },
            javaPath: javaPath,
            concurrentFileWrites: options.concurrentDownloads || 8,
            downloadFileMultiple: options.concurrentDownloads || 8,
            checkHash: true,
            customArgs: (extraJvmArgs.length > 0 || soulJvmArgs.length > 0) ? extraJvmArgs.concat(soulJvmArgs) : undefined
        };

        if (options.world) {
            launchOpts.quickPlay = {
                type: 'singleplayer',
                identifier: options.world
            };
            log(`[SYSTEM] Quick-playing world: ${options.world}`);
        } else if (options.server) {
            const host = options.server.replace(/:.*$/, '');
            const port = options.server.includes(':') ? options.server.split(':')[1] : '25565';
            launchOpts.quickPlay = {
                type: 'multiplayer',
                identifier: `${host}:${port}`
            };
            log(`[SYSTEM] Auto-connecting to server: ${host}:${port}`);
        }

        console.log('[SYSTEM] Final Launch Options for ' + versionObj.number);
        if (options.debugMode) {
            console.log('[DEBUG] Full options:', JSON.stringify({ ...launchOpts, authorization: 'REDACTED' }, null, 2));
        }

        currentLauncher.removeAllListeners();
        let mclcLastDebug = null;
        currentLauncher.on('debug', (e) => {
            mclcLastDebug = e;
            // MCLC's launch() swallows internal exceptions (Forge wrapping,
            // class/asset resolution, etc.) and only ever surfaces them as a
            // 'debug' event before silently returning null. We always capture
            // this — not just when debugMode is on — so "launch() returned
            // null" isn't the only thing the user ever sees.
            if (options.debugMode) log(`[DEBUG] ${e}`);
            if (String(e).includes('Failed to start due to')) {
                log(`[MCLC] ${e}`);
            }
        });
        currentLauncher.on('data', (e) => log(e));
        currentLauncher.on('progress', (e) => {
            const pct = e.total > 0 ? Math.round((e.task / e.total) * 100) : 0;
            const phaseLabelMap = {
                'assets': 'Checking assets',
                'classes': 'Checking libraries',
                'classes-custom': 'Checking loader files',
                'natives': 'Preparing natives'
            };
            const phaseLabel = phaseLabelMap[e.type] || `Processing ${e.type}`;
            if (!event.sender.isDestroyed()) {
                event.sender.send('launch-progress', { 
                    msg: `${phaseLabel}: ${e.task} / ${e.total} files (${pct}%)`, 
                    pct 
                });
            }
        });

        // --- JAR INTEGRITY CHECK ---
        // MCLC skips re-downloading a JAR if the file already exists on disk,
        // even if it is a truncated/partial download. This causes:
        const vanillaVersion = versionObj.number;
        const jarPath = path.join(
            instanceVersionsPath,
            vanillaVersion,
            `${vanillaVersion}.jar`
        );

        // --- SCAN CLIENT JAR ---
        if (fs.existsSync(jarPath)) {
            const sizeMB = (fs.statSync(jarPath).size / 1024 / 1024).toFixed(1);
            if (!isValidZip(jarPath)) {
                log(`[WARNING] Client JAR corrupt (${sizeMB} MB). Deleting for re-download...`);
                try {
                    fs.unlinkSync(jarPath);
                    log(`[SYSTEM] Deleted bad client JAR. MCLC will re-download it.`);
                } catch (unlinkErr) {
                    log(`[ERROR] Could not delete bad JAR: ${unlinkErr.message}`);
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('launch-error',
                            `Corrupt client JAR found but could not be removed:\n${jarPath}\nPlease delete it manually and relaunch.`
                        );
                    }
                    return false;
                }
            } else {
                log(`[SYSTEM] Client JAR OK (${sizeMB} MB).`);
            }
        }

        // --- SCAN ALL LIBRARY JARs IN PARALLEL ---
        // MCLC never re-downloads a library that already exists on disk,
        // even if it is empty or truncated. We scan every .jar in the libraries
        // folder concurrently and delete any corrupt ones so MCLC re-fetches them.
        const libraryRoot = instanceLibrariesPath;
        const shouldVerifyLibraries = options.loader === 'forge' && !isModernMinecraftVersion(vanillaVersion);
        if (shouldVerifyLibraries && fs.existsSync(libraryRoot)) {
            log('[SYSTEM] Scanning legacy Forge library JARs for corruption...');
            if (!event.sender.isDestroyed()) {
                event.sender.send('launch-progress', { msg: 'Scanning library files...', pct: 5 });
            }

            function collectJars(dir) {
                let jars = [];
                try {
                    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            jars = jars.concat(collectJars(full));
                        } else if (entry.name.endsWith('.jar')) {
                            jars.push(full);
                        }
                    }
                } catch (_) {}
                return jars;
            }

            const allJars = collectJars(libraryRoot);
            log(`[SYSTEM] Found ${allJars.length} legacy Forge library JARs to verify.`);

            const BATCH = 32;
            let deleted = 0;
            for (let i = 0; i < allJars.length; i += BATCH) {
                const batch = allJars.slice(i, i + BATCH);
                await Promise.all(batch.map(async (jarFile) => {
                    if (!isValidZip(jarFile)) {
                        try {
                            fs.unlinkSync(jarFile);
                            deleted++;
                            log(`[WARNING] Deleted corrupt library: ${path.relative(libraryRoot, jarFile)}`);
                        } catch (_) {}
                    }
                }));
                const pct = Math.round(((i + BATCH) / allJars.length) * 10) + 5;
                if (!event.sender.isDestroyed()) {
                    event.sender.send('launch-progress', {
                        msg: `Verifying libraries: ${Math.min(i + BATCH, allJars.length)} / ${allJars.length}`,
                        pct: Math.min(pct, 15)
                    });
                }
            }

            if (deleted > 0) {
                log(`[SYSTEM] Removed ${deleted} corrupt library JAR(s). MCLC will re-download them.`);
            } else {
                log(`[SYSTEM] All ${allJars.length} legacy Forge library JARs are intact.`);
            }
        } else if (fs.existsSync(libraryRoot)) {
            log('[SYSTEM] Skipping full library scan for modern launch.');
        }
        // --- END LIBRARY INTEGRITY CHECK ---

        // --- ASSET INDEX INTEGRITY CHECK ---
        // MCLC reads <assetRoot>/indexes/<assetId>.json and JSON.parses it.
        // A 0-byte or truncated file from a previous interrupted download
        // causes "SyntaxError: Unexpected end of JSON input" and a null launch.
        const assetIndexPath = path.join(
            instanceManager.SOUL_PATH, 'assets', 'indexes',
            `${versionObj.custom || versionObj.number}.json`
        );
        if (fs.existsSync(assetIndexPath)) {
            const assetIndexSize = fs.statSync(assetIndexPath).size;
            if (assetIndexSize === 0) {
                log(`[WARNING] Asset index is empty (0 bytes). Deleting for re-download...`);
                try {
                    fs.unlinkSync(assetIndexPath);
                    log(`[SYSTEM] Deleted empty asset index. MCLC will re-download it.`);
                } catch (unlinkErr) {
                    log(`[ERROR] Could not delete empty asset index: ${unlinkErr.message}`);
                }
            } else if (assetIndexSize < 16) {
                try {
                    const raw = fs.readFileSync(assetIndexPath, 'utf8');
                    JSON.parse(raw);
                } catch (_) {
                    log(`[WARNING] Asset index is corrupt (${assetIndexSize} bytes). Deleting for re-download...`);
                    try {
                        fs.unlinkSync(assetIndexPath);
                        log(`[SYSTEM] Deleted corrupt asset index. MCLC will re-download it.`);
                    } catch (unlinkErr) {
                        log(`[ERROR] Could not delete corrupt asset index: ${unlinkErr.message}`);
                    }
                }
            }
        }
        // --- END ASSET INDEX INTEGRITY CHECK ---

        log(`[SYSTEM] Final check before launch...`);
        if (options.debugMode) {
            log(`[DEBUG] Launch Options: ${JSON.stringify({ ...launchOpts, authorization: 'REDACTED' }, null, 2)}`);
        }

        log(`[SYSTEM] Executing launcher.launch()...`);
        const proc = await withChildEnv(() => currentLauncher.launch(launchOpts));
        
        if (!proc) {
            const reason = mclcLastDebug && String(mclcLastDebug).includes('Failed to start due to')
                ? String(mclcLastDebug).replace('[MCLC]: ', '')
                : null;
            log(`[ERROR] launcher.launch() returned null${reason ? ` — ${reason}` : ' — check Java and MCLC version.'}`);
            if (!event.sender.isDestroyed()) {
                event.sender.send('launch-error', reason ? `Launch failed: ${reason}` : 'Launch failed: no process returned.');
            }
            return false;
        }
        
        mcProcess = proc;
        log(`[SYSTEM] Game process started (PID: ${proc.pid})`);

        proc.on('close', (code) => {
            log(`[SYSTEM] Game process exited with code ${code}`);
            if (!event.sender.isDestroyed()) {
                event.sender.send('launch-finished');
            }
            mcProcess = null;
            runPostHook();
        });
        
        return true;
    } catch (err) {
      console.error("[CRITICAL] Launch Error Catch:", err);
      if (!event.sender.isDestroyed()) {
          event.sender.send('launch-error', err.message);
      }
      return false;
    }
  });

  ipcMain.handle('stop-game', () => {
    if (mcProcess) {
        mcProcess.kill();
        return true;
    }
    return false;
  });

  ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

  ipcMain.handle('hide-window', () => { if (mainWindow) mainWindow.hide(); return true; });
  ipcMain.handle('show-window', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } return true; });
  ipcMain.handle('open-data-folder', () => {
    shell.openPath(instanceManager.SOUL_PATH);
    return true;
  });

  ipcMain.handle('clear-cache', () => instanceManager.clearCache());
  ipcMain.handle('clear-data', async () => {
    await instanceManager.clearData();
    // Also clear the store (settings)
    store.clear();
    return true;
  });

  // SKIN MANAGEMENT HANDLERS
  ipcMain.handle('save-skin', async (_, buffer, name) => {
    const filePath = path.join(skinManager.SKINS_PATH, name);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return filePath;
  });
  ipcMain.handle('save-cape', async (_, buffer, name) => {
    const filePath = path.join(skinManager.CAPES_PATH, name);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return filePath;
  });
  ipcMain.handle('get-skins', async () => {
    if (!fs.existsSync(skinManager.SKINS_PATH)) return [];
    return fs.readdirSync(skinManager.SKINS_PATH).filter(f => f.endsWith('.png'));
  });
  ipcMain.handle('get-capes', async () => {
    if (!fs.existsSync(skinManager.CAPES_PATH)) return [];
    return fs.readdirSync(skinManager.CAPES_PATH).filter(f => f.endsWith('.png') || f.endsWith('.gif'));
  });
  ipcMain.handle('get-skin-path', (_, name) => path.join(skinManager.SKINS_PATH, name));
  ipcMain.handle('get-cape-path', (_, name) => path.join(skinManager.CAPES_PATH, name));
  ipcMain.handle('delete-skin', async (_, name) => {
    const filePath = path.join(skinManager.SKINS_PATH, name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  });
  ipcMain.handle('delete-cape', async (_, name) => {
    const filePath = path.join(skinManager.CAPES_PATH, name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  });
  ipcMain.handle('delete-all-skins', async () => {
    if (fs.existsSync(skinManager.SKINS_PATH)) {
      const files = fs.readdirSync(skinManager.SKINS_PATH);
      files.forEach(f => fs.unlinkSync(path.join(skinManager.SKINS_PATH, f)));
    }
    return true;
  });
  ipcMain.handle('delete-all-capes', async () => {
    if (fs.existsSync(skinManager.CAPES_PATH)) {
      const files = fs.readdirSync(skinManager.CAPES_PATH);
      files.forEach(f => fs.unlinkSync(path.join(skinManager.CAPES_PATH, f)));
    }
    return true;
  });
  ipcMain.handle('apply-skin', async (_, instanceName, username, skinName, capeName, model, elytraName) => {
    const instPath = instanceManager.getInstancePath(instanceName);
    const config = instanceManager.getInstanceConfig(instanceName);

    if (config.loader !== 'fabric' && config.loader !== 'forge') {
        throw new Error('Skin application is only supported for Fabric and Forge instances.');
    }

    const skinFile = skinName ? path.join(skinManager.SKINS_PATH, skinName) : null;
    const capeFile = capeName ? path.join(skinManager.CAPES_PATH, capeName) : null;
    const elytraFile = elytraName ? path.join(skinManager.ELYTRAS_PATH, elytraName) : null;

    // Install CustomSkinLoader (supports fabric and forge)
    await skinManager.installCustomSkinLoader(instPath, config.mcversion || config.version, config.loader);

    // Setup config (returns {appliedSkin, appliedCape, appliedElytra})
    const result = await skinManager.setupSkinConfig(instPath, username, skinFile, capeFile, model, elytraFile);

    return result || { appliedSkin: false, appliedCape: false, appliedElytra: false };
  });
  ipcMain.handle('save-elytra', async (_, buffer, name) => {
    const filePath = path.join(skinManager.ELYTRAS_PATH, name);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return filePath;
  });
  ipcMain.handle('download-skin-name', (_, playerName) => skinManager.downloadSkinByName(playerName));
  ipcMain.handle('get-elytras', async () => {
    if (!fs.existsSync(skinManager.ELYTRAS_PATH)) return [];
    return fs.readdirSync(skinManager.ELYTRAS_PATH).filter(f => f.endsWith('.png'));
  });
  ipcMain.handle('get-elytra-path', (_, name) => path.join(skinManager.ELYTRAS_PATH, name));
  ipcMain.handle('delete-elytra', async (_, name) => {
    const filePath = path.join(skinManager.ELYTRAS_PATH, name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  });
  ipcMain.handle('delete-all-elytras', async () => {
    if (fs.existsSync(skinManager.ELYTRAS_PATH)) {
      const files = fs.readdirSync(skinManager.ELYTRAS_PATH);
      files.forEach(f => fs.unlinkSync(path.join(skinManager.ELYTRAS_PATH, f)));
    }
    return true;
  });
  ipcMain.handle('upload-skin-mojang', async (_, skinName, variant) => {
    const accounts = store.get('accounts') || [];
    const current = store.get('currentAccount');
    const account = (current && current.type === 'microsoft')
      ? current
      : accounts.find(a => a.type === 'microsoft');
    if (!account) throw new Error('A Microsoft account is required. Log in with Microsoft first.');
    if (!skinName) throw new Error('Choose a skin PNG first.');
    const skinPath = path.join(skinManager.SKINS_PATH, skinName);
    if (!fs.existsSync(skinPath)) throw new Error('Skin file not found.');

    // Stored Minecraft tokens expire (~24h), so always refresh from the
    // long-lived msmcSave first; fall back to the stored token if refresh
    // fails (e.g. offline), and only then ask the user to log in again.
    let token = account.token || null;
    let refreshErr = null;
    if (account.msmcSave) {
      try {
        const refreshed = await refreshMicrosoftToken(account.msmcSave);
        token = refreshed.token;
        const updated = { ...account, token: refreshed.token, mclc: refreshed.mclc, msmcSave: refreshed.msmcSave };
        const idx = accounts.findIndex(a => a.id === account.id);
        if (idx !== -1) { accounts[idx] = { ...accounts[idx], ...updated }; store.set('accounts', accounts); }
        store.set('currentAccount', updated);
      } catch (e) {
        refreshErr = e;
        console.warn('[MOJANG SKIN] Token refresh failed, trying stored token:', e.message);
      }
    }
    if (!token) {
      const cause = refreshErr && refreshErr.message ? ` (${String(refreshErr.message).slice(0, 160)})` : '';
      throw new Error(`Microsoft session expired and could not be refreshed${cause}. Log in with Microsoft again.`);
    }
    return skinManager.uploadSkinToMojang({
      accessToken: token,
      skinPath,
      variant: variant === 'slim' ? 'slim' : 'classic'
    });
  });

  // BACKGROUND MANAGEMENT HANDLERS
  ipcMain.handle('get-custom-backgrounds', async () => {
    ensureBackgroundsPath();
    return fs.readdirSync(BACKGROUNDS_PATH).filter(f => {
      const filePath = path.join(BACKGROUNDS_PATH, f);
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile() && BACKGROUND_EXTENSIONS.has(path.extname(f).toLowerCase());
    });
  });

  ipcMain.handle('get-background-path', (_, name) => {
    ensureBackgroundsPath();
    const filePath = path.join(BACKGROUNDS_PATH, name);
    return fs.existsSync(filePath) ? filePath : null;
  });

  ipcMain.handle('upload-background', async (_, sourcePath) => {
    const trimmedSource = typeof sourcePath === 'string' ? sourcePath.trim() : '';
    if (!trimmedSource) throw new Error('Background file path is required.');
    if (!fs.existsSync(trimmedSource)) throw new Error('Selected background file does not exist.');
    if (!fs.statSync(trimmedSource).isFile()) throw new Error('Selected background must be a file.');

    const ext = path.extname(trimmedSource).toLowerCase();
    if (!BACKGROUND_EXTENSIONS.has(ext)) {
      throw new Error('Background must be a PNG, JPG, JPEG, WEBP, GIF, or SVG image.');
    }

    ensureBackgroundsPath();
    const name = path.basename(trimmedSource);
    const dest = path.join(BACKGROUNDS_PATH, name);
    fs.copyFileSync(trimmedSource, dest);
    return name;
  });

  ipcMain.handle('delete-background', async (_, name) => {
    ensureBackgroundsPath();
    const filePath = path.join(BACKGROUNDS_PATH, name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  });

  // UPDATER IPC EVENTS
  autoUpdater.on('checking-for-update', () => {
    if (mainWindow) mainWindow.webContents.send('update-status', { status: 'checking', msg: 'Checking for updates...' });
  });

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-status', { status: 'available', msg: `Update v${info.version} available!`, version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    if (mainWindow) mainWindow.webContents.send('update-status', { status: 'not-available', msg: 'Launcher is up to date.' });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'downloading',
        msg: `Downloading update... ${Math.round(progressObj.percent)}%`,
        pct: Math.round(progressObj.percent)
      });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('update-status', { status: 'downloaded', msg: 'Update downloaded! Restarting...' });
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 2000);
  });

  autoUpdater.on('error', (err) => {
    const rawMessage = err && err.message ? String(err.message) : '';
    if (mainWindow) {
      console.warn('[UPDATER] Update check failed — treating as up to date:', rawMessage);
      mainWindow.webContents.send('update-status', { status: 'not-available', msg: 'You are up to date.' });
    }
  });

  ipcMain.handle('check-for-updates', () => {
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      if (mainWindow) {
        mainWindow.webContents.send('update-status', {
          status: 'not-available',
          msg: 'Launcher is up to date.'
        });
      }
    }, 15000);

    const cancelTimeout = () => { if (!done) { done = true; clearTimeout(timeout); }};
    autoUpdater.once('update-available', cancelTimeout);
    autoUpdater.once('update-not-available', cancelTimeout);
    autoUpdater.once('error', cancelTimeout);

    autoUpdater.checkForUpdatesAndNotify();
    return true;
   });

  ipcMain.handle('read-update-notes', () => {
    const notesPath = resolveUpdateNotesPath();
    try {
      if (notesPath) {
        const content = fs.readFileSync(notesPath, 'utf-8');
        console.log('[UPDATE NOTES] Found:', notesPath, 'length:', content.length);
        return content;
      }
      console.log('[UPDATE NOTES] File not found in any known location.');
      return 'No update notes available.';
    } catch (e) {
      console.log('[UPDATE NOTES] Error:', e.message);
      return 'Could not read update notes.';
    }
  });

  ipcMain.handle('open-changelog', () => {
    const changelogWin = new BrowserWindow({
      width: 600,
      height: 500,
      frame: false,
      resizable: false,
      icon: APP_ICON_PATH,
      webPreferences: {
        preload: path.join(__dirname, '../preload/changelog-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      }
    });
    changelogWin.loadFile(path.join(__dirname, '../renderer/changelog/index.html'));
    return true;
  });

   app.whenReady().then(() => {

    if (process.platform === 'win32') {
      app.setAppUserModelId('com.soul.launcher');
    }

    createWindow();

    // POST-UPDATE DETECTION
    const currentVersion = app.getVersion();
    const lastVersion = store.get('lastRunVersion');
    if (lastVersion && lastVersion !== currentVersion) {
      store.set('showUpdateNotify', { from: lastVersion, to: currentVersion });
    }
    store.set('lastRunVersion', currentVersion);

    // The update check will now be triggered by the renderer (loading screen)
    // autoUpdater.checkForUpdatesAndNotify();
});

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

const DiscordRPC = require('discord-rpc');

const CLIENT_ID = '1522258708112080917';
const rpc = new DiscordRPC.Client({ transport: 'ipc' });
let startTimestamp = new Date();

// Call this to update what Discord shows
function setActivity(details, state) {
  if (!rpc) return;

  rpc.setActivity({
    details: details || 'Soul Launcher',
    state: state || 'Idle',
    startTimestamp,                  // shows elapsed time
    largeImageKey: 'soul_logo',      // upload this in Discord Dev Portal
    largeImageText: 'Soul Launcher',
    smallImageKey: 'minecraft_icon', // upload this in Discord Dev Portal
    smallImageText: 'Soul Launcher',
    instance: false,
  });
}

// Login and set initial presence
rpc.on('ready', () => {
  console.log('[SoulRPC] Discord RPC connected!');
  setActivity(null, null); // idle state on launch
});

rpc.login({ clientId: CLIENT_ID }).catch(console.error);

// Export so you can call from anywhere in main.js
module.exports = { setActivity, startTimestamp };
