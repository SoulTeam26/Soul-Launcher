// ============================================================
// FILE: src/main/java-manager.js
// FULL REPLACEMENT
// ============================================================

const fs = require('fs');
const path = require('path');
const https = require('https');
const AdmZip = require('adm-zip');

const instanceManager = require('./instance-manager');

class JavaManager {

    constructor() {

        this.javaDir = path.join(
            instanceManager.SOUL_PATH,
            'java'
        );

        if (!fs.existsSync(this.javaDir)) {
            fs.mkdirSync(this.javaDir, { recursive: true });
        }
    }

    // ========================================================
    // DETECT REQUIRED JAVA VERSION
    // ========================================================

    getMinJavaVersion(mcVersion) {

        // Supports:
        // 1.21.1
        // 1.26.0
        // 26.1.2
        // snapshots etc

        const clean = String(mcVersion).trim();

        let major;

        // NEW FORMAT: 26.1.2
        if (!clean.startsWith('1.')) {

            major = parseInt(
                clean.split('.')[0]
            );

        } else {

            // OLD FORMAT: 1.21.1
            const parts = clean.split('.');

            major = parseInt(parts[1]);
        }

        console.log(
            '[JAVA DETECT]',
            mcVersion,
            '->',
            major
        );

        // Minecraft 26+
        if (major >= 26) {
            return 25;
        }

        // Minecraft 21 - 25
        if (major >= 21) {
            return 21;
        }

        // Minecraft 18 - 20
        if (major >= 18) {
            return 17;
        }

        // Minecraft 17
        if (major >= 17) {
            return 16;
        }

        // Older versions
        return 8;
    }

    // ========================================================
    // JAVA EXECUTABLE PATH
    // ========================================================

    getJavaPath(version) {

        return path.join(
            this.javaDir,
            `java-${version}`,
            'bin',
            process.platform === 'win32'
                ? 'java.exe'
                : 'java'
        );
    }

    // ========================================================
    // CHECK JAVA EXISTS
    // ========================================================

    javaExists(version) {

        return fs.existsSync(
            this.getJavaPath(version)
        );
    }

    // ========================================================
    // ENSURE JAVA FOR MC VERSION
    // ========================================================

    async ensureJavaForVersion(mcVersion, log = console.log, onProgress = null) {

        const requiredVersion =
            this.getMinJavaVersion(mcVersion);

        log(
            `[JAVA] Minecraft ${mcVersion} requires Java ${requiredVersion}`
        );

        if (!this.javaExists(requiredVersion)) {

            log(
                `[JAVA] Java ${requiredVersion} missing`
            );

            if (onProgress) {
                onProgress({
                    version: requiredVersion,
                    pct: 0,
                    msg: `[JAVA] Installing Java ${requiredVersion}...`
                });
            }

            await this.downloadJava(
                requiredVersion,
                (pct) => {
                    if (onProgress) {
                        onProgress({
                            version: requiredVersion,
                            pct,
                            msg: `[JAVA] Installing Java ${requiredVersion}... ${pct}%`
                        });
                    }
                },
                log
            );

            log(
                `[JAVA] Java ${requiredVersion} installed successfully`
            );
        }

        const javaPath =
            this.getJavaPath(requiredVersion);

        log(
            `[JAVA] Using Java: ${javaPath}`
        );

        return javaPath;
    }

    // ========================================================
    // DOWNLOAD JAVA
    // ========================================================

    async downloadJava(version = 21, onProgress, log) {

    const safeVersion = Math.min(
        Math.max(version, 8),
        25
    );

    // Serialize concurrent downloads of the same version. On Windows two
    // write streams on the same file fail with EPERM (share violation),
    // e.g. double-clicking download or Refresh + Download All at once.
    if (!this._inflight) this._inflight = new Map();
    if (this._inflight.has(safeVersion)) {
        return this._inflight.get(safeVersion);
    }

    const task = this._downloadJavaInner(safeVersion, onProgress, log)
        .finally(() => { this._inflight.delete(safeVersion); });
    this._inflight.set(safeVersion, task);
    return task;
    }

    // Remove a file if present, retrying transient Windows locks
    // (antivirus scan / Explorer / stale handle hold EPERM|EBUSY briefly).
    async _removeIfExists(target) {
        for (let attempt = 1; attempt <= 5; attempt++) {
            let exists = false;
            try {
                exists = fs.existsSync(target);
            } catch (_) {
                exists = true; // existsSync swallows EACCES -> assume present
            }
            if (!exists) return;
            try {
                fs.unlinkSync(target);
                return;
            } catch (err) {
                if ((err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') && attempt < 5) {
                    await new Promise(r => setTimeout(r, 500 * attempt));
                    continue;
                }
                throw new Error(
                    `Cannot remove locked file ${target} (${err.code || err.message}). ` +
                    `Close any program using it, check antivirus quarantine, then retry.`
                );
            }
        }
    }

    async _downloadJavaInner(safeVersion, onProgress, log) {

    const _log = (msg) => { console.log(msg); if (log) log(msg); };
    _log(`[JAVA] Starting Java ${safeVersion} download`);

    const platform = process.platform;
    const arch = process.arch;

    let osName = 'windows';

    if (platform === 'darwin') {
        osName = 'mac';
    }

    if (platform === 'linux') {
        osName = 'linux';
    }

    let downloadArch = 'x64';

    if (arch === 'arm64') {
        downloadArch = 'aarch64';
    }

    const url =
        `https://api.adoptium.net/v3/binary/latest/${safeVersion}/ga/${osName}/${downloadArch}/jdk/hotspot/normal/eclipse?project=jdk`;

    _log(`[JAVA] Download URL ready for Java ${safeVersion}`);

    // Windows = .zip, Linux/Mac = .tar.gz (much smaller, faster download)
    const archiveExt  = platform === 'win32' ? 'zip' : 'tar.gz';
    const archiveType = platform === 'win32' ? 'zip' : 'tar';

    const zipPath = path.join(
        this.javaDir,
        `java-${safeVersion}.${archiveExt}`
    );

    const extractPath = path.join(
        this.javaDir,
        `java-${safeVersion}`
    );

    _log(`[JAVA] Archive path: ${zipPath}`);
    _log(`[JAVA] Extract path: ${extractPath}`);

    if (!fs.existsSync(extractPath)) {

        fs.mkdirSync(
            extractPath,
            { recursive: true }
        );
    }

    // ============================
    // DOWNLOAD
    // ============================

    _log('[JAVA] Downloading Java package...');
    // Download to a temp name and rename on success, so a stale/locked
    // final-path zip (or antivirus scan lock) never blocks the open.
    const tmpPath = `${zipPath}.download`;
    await this._removeIfExists(zipPath);
    await this._removeIfExists(tmpPath);
    try {
        await this.downloadFile(url, tmpPath, onProgress, _log);
    } catch (err) {
        await this._removeIfExists(tmpPath).catch(() => {});
        if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
            throw new Error(
                `Download Failed: cannot write to ${this.javaDir} (${err.code}). ` +
                `A previous partial download may be locked by antivirus — delete java-${safeVersion}.zip(.download) ` +
                `in that folder (close the launcher first), add the Soul folder to your antivirus exclusions, then retry.`
            );
        }
        throw err;
    }
    try {
        fs.renameSync(tmpPath, zipPath);
    } catch (err) {
        throw new Error(
            `Download Failed: cannot finalize ${zipPath} (${err.code || err.message}). ` +
            `Delete java-${safeVersion}.zip(.download) in ${this.javaDir} (close the launcher first) and retry.`
        );
    }

    _log('[JAVA] Download complete');

    // ============================
    // VALIDATE ZIP
    // ============================

    if (!fs.existsSync(zipPath)) {

        throw new Error(
            'Java ZIP was not downloaded'
        );
    }

    const stats = fs.statSync(zipPath);

    _log(`[JAVA] Archive size: ${stats.size} bytes`);

    if (stats.size < 1000000) {

        throw new Error(
            'Downloaded Java archive is invalid'
        );
    }

    // ============================
    // EXTRACT
    // ============================

    _log('[JAVA] Extracting Java package...');

    await this.extractZip(
        zipPath,
        extractPath
    );

    _log('[JAVA] Extraction complete');

    // ============================
    // DELETE ZIP
    // ============================

    fs.unlinkSync(zipPath);

    _log(
        `[JAVA] Java ${safeVersion} installed`
    );

    return this.getJavaPath(safeVersion);
}

    // ========================================================
    // DOWNLOAD FILE  (axios-based, handles redirects + timeout)
    // ========================================================

    async downloadFile(url, destination, onProgress, log) {

        const axios = require('axios');

        let lastErr;

        for (const tryUrl of [url]) {
            try {
                const response = await axios({
                    url: tryUrl,
                    method: 'GET',
                    responseType: 'stream',
                    timeout: 120000,
                    maxRedirects: 10,
                    headers: {
                        'User-Agent':      'SoulLauncher/1.0 (java-downloader)',
                        'Accept-Encoding': 'identity'   // don't double-compress
                    },
                    // Large read buffer = fewer chunks = faster throughput
                    httpsAgent: new (require('https').Agent)({
                        keepAlive: true
                    })
                });

                const totalSize = parseInt(
                    response.headers['content-length'] || '0'
                );
                let downloaded = 0;
                let lastReport = 0;
                let lastTime   = Date.now();
                let lastBytes  = 0;

                // Increase stream high-water mark to 1 MB so Node buffers more per tick
                response.data.setMaxListeners(20);

                const file = fs.createWriteStream(destination, {
                    highWaterMark: 1024 * 1024   // 1 MB write buffer
                });

                response.data.on('data', chunk => {
                    downloaded += chunk.length;

                    const now = Date.now();
                    if (now - lastTime >= 500) {           // report every 500 ms
                        const speed = ((downloaded - lastBytes) / (now - lastTime) * 1000 / 1024 / 1024).toFixed(1);
                        const pct   = totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : 0;
                        const mb    = (downloaded / 1024 / 1024).toFixed(1);
                        const total = totalSize > 0 ? `/ ${(totalSize / 1024 / 1024).toFixed(1)} MB` : '';
                        const speedMsg = `[JAVA] ${mb} MB ${total}  ${pct}%  @ ${speed} MB/s`;
                        console.log(speedMsg);
                        if (log) log(speedMsg);

                        if (onProgress && totalSize > 0 && pct !== lastReport) {
                            onProgress(pct);
                            lastReport = pct;
                        }
                        lastTime  = now;
                        lastBytes = downloaded;
                    }
                });

                response.data.pipe(file);

                await new Promise((resolve, reject) => {
                    file.on('finish', () => file.close(resolve));
                    file.on('error', err => {
                        try { response.data.destroy(); } catch (_) {}
                        fs.unlink(destination, () => {});
                        reject(err);
                    });
                    response.data.on('error', err => {
                        try { file.destroy(); } catch (_) {}
                        fs.unlink(destination, () => {});
                        reject(err);
                    });
                });

                if (onProgress) onProgress(100);
                const doneMsg = `[JAVA] Download complete: ${(downloaded / 1024 / 1024).toFixed(1)} MB`;
                console.log(doneMsg);
                if (log) log(doneMsg);
                return;
            } catch (err) {
                const failMsg = `[JAVA] Download attempt failed: ${tryUrl} (${err.message})`;
                console.error(failMsg);
                if (log) log(failMsg);
                lastErr = err;
            }
        }

        throw lastErr || new Error('All download attempts failed');
    }

    // ========================================================
    // DOWNLOAD ALL MANAGED JAVA VERSIONS
    // ========================================================

    async downloadAllJava(progressCb) {

        // The four versions Soul manages
        const versions = [8, 17, 21, 25];

        const report = (msg, pct) => {
            console.log('[JAVA ALL]', msg);
            if (progressCb) progressCb({ msg, pct });
        };

        for (let i = 0; i < versions.length; i++) {
            const ver = versions[i];
            const basePct = Math.round((i / versions.length) * 100);
            const slicePct = Math.round(100 / versions.length);

            if (this.javaExists(ver)) {
                report(`Java ${ver} already installed — skipping`, basePct + slicePct);
                continue;
            }

            report(`Downloading Java ${ver}...`, basePct);

            await this.downloadJava(ver, (filePct) => {
                const combined = basePct + Math.round((filePct / 100) * slicePct);
                report(`Java ${ver}: ${filePct}%`, combined);
            }, (msg) => { if (progressCb) progressCb({ msg, pct: basePct + Math.round((parseInt(msg.match(/(\d+)%/) || [0,0])[1] / 100) * slicePct) }); });

            report(`Java ${ver} installed!`, basePct + slicePct);
        }

        report('All Java versions ready!', 100);
    }

    // ========================================================
    // EXTRACT ARCHIVE  (native tar/zip first, AdmZip fallback)
    // ========================================================

    async extractZip(zipPath, extractTo) {

        const { execFile } = require('child_process');
        const { promisify } = require('util');
        const execFileAsync = promisify(execFile);

        const isTarGz = zipPath.endsWith('.tar.gz') || zipPath.endsWith('.tgz');

        let nativeOk = false;

        if (isTarGz) {
            // ---- tar.gz: use native tar (Linux / Mac / Windows 10+) ----
            try {
                console.log('[JAVA] Extracting with native tar...');
                // -x extract, -z gzip, -f file, -C destination
                await execFileAsync('tar', ['-xzf', zipPath, '-C', extractTo]);
                nativeOk = true;
                console.log('[JAVA] Native tar extraction complete');
            } catch (err) {
                console.warn('[JAVA] Native tar failed, falling back to AdmZip:', err.message);
            }
        } else {
            // ---- .zip: try Windows built-in tar.exe (ships with Win10+) ----
            try {
                console.log('[JAVA] Extracting with native tar (Windows)...');
                await execFileAsync('tar', ['-xf', zipPath, '-C', extractTo]);
                nativeOk = true;
                console.log('[JAVA] Native tar extraction complete');
            } catch (err) {
                console.warn('[JAVA] Native tar failed, falling back to AdmZip:', err.message);
            }
        }

        if (!nativeOk) {
            // ---- AdmZip fallback ----
            try {
                console.log('[JAVA] Extracting with AdmZip (fallback)...');
                const zip = new AdmZip(zipPath);
                zip.extractAllTo(extractTo, true);
                console.log('[JAVA] AdmZip extraction complete');
            } catch (err) {
                console.error('[JAVA] ZIP EXTRACTION FAILED', err);
                throw err;
            }
        }

        // Move inner folder contents up one level
        // (JDK archives always have a single root dir like jdk-21.0.3+9)
        const items = fs.readdirSync(extractTo);

        if (items.length === 1) {
            const innerFolder = path.join(extractTo, items[0]);

            if (fs.statSync(innerFolder).isDirectory()) {
                const innerItems = fs.readdirSync(innerFolder);

                for (const item of innerItems) {
                    fs.renameSync(
                        path.join(innerFolder, item),
                        path.join(extractTo, item)
                    );
                }

                fs.rmdirSync(innerFolder);
            }
        }
    }

    // ========================================================
    // DETECT JAVA INSTALLATIONS
    // ========================================================

    // ========================================================
    // GET JAVA VERSION FROM EXECUTABLE
    // ========================================================

    async getJavaVersion(javaExe) {

        if (!javaExe || !fs.existsSync(javaExe)) return null;

        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        try {
            const result = await execAsync(
                `"${path.normalize(javaExe)}" -version`
            ).catch(e => e);

            const output = result.stderr || result.stdout || '';
            const match  = output.match(/version "([^"]+)"/);

            return match ? match[1] : null;

        } catch (_) {
            return null;
        }
    }

    // ========================================================
    // PARSE MAJOR VERSION FROM JAVA VERSION STRING
    // ========================================================

    parseJavaMajor(versionStr) {

        if (!versionStr) return 0;

        // Format examples:
        //   "21.0.1"  → 21
        //   "1.8.0_202" → 8
        //   "25-ea"   → 25

        if (versionStr.startsWith('1.')) {
            const parts = versionStr.split('.');
            return parseInt(parts[1]) || 0;
        }

        return parseInt(versionStr) ||
               parseInt(versionStr.split('.')[0]) ||
               0;
    }

    async detectJava() {

        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        const results = [];
        const tested = new Set();

        const javawName = process.platform === 'win32' ? 'javaw.exe' : 'java';

        const testJava = async (javaExe) => {
            const normalized = path.normalize(javaExe);
            if (tested.has(normalized)) return;
            tested.add(normalized);
            if (!fs.existsSync(normalized)) return;
            try {
                // java -version always prints to stderr
                const result = await execAsync(
                    `"${normalized}" -version`
                ).catch(e => e);

                const output = result.stderr || result.stdout || '';
                const match  = output.match(/version "([^"]+)"/);

                if (match) {
                    results.push({
                        path:    normalized,
                        version: match[1]
                    });
                    console.log(
                        '[JAVA DETECT] Found:',
                        match[1],
                        'at',
                        normalized
                    );
                }
            } catch (_) { /* not a valid java */ }
        };

        // 1. Our managed Java installations
        if (fs.existsSync(this.javaDir)) {
            for (const dir of fs.readdirSync(this.javaDir)) {
                const p = path.join(this.javaDir, dir, 'bin', javawName);
                await testJava(p);
            }
        }

        // 2. System / platform Java
        if (process.platform === 'win32') {

            const programDirs = [
                process.env['ProgramFiles'],
                process.env['ProgramFiles(x86)'],
                process.env['ProgramW6432']
            ].filter(Boolean);

            const vendors = [
                'Java',
                'Eclipse Adoptium',
                'Microsoft',
                'BellSoft',
                'Amazon Corretto',
                'Azul',
                'OpenJDK'
            ];

            for (const pf of programDirs) {
                for (const vendor of vendors) {
                    const vendorDir = path.join(pf, vendor);
                    if (!fs.existsSync(vendorDir)) continue;
                    for (const dir of fs.readdirSync(vendorDir)) {
                        await testJava(
                            path.join(vendorDir, dir, 'bin', 'javaw.exe')
                        );
                    }
                }
            }

            // JAVA_HOME env
            if (process.env.JAVA_HOME) {
                await testJava(
                    path.join(process.env.JAVA_HOME, 'bin', 'javaw.exe')
                );
            }

        } else {

            // Common Unix paths
            const unixPaths = [
                '/usr/bin/java',
                '/usr/local/bin/java',
                '/opt/homebrew/bin/java',
                '/opt/homebrew/opt/openjdk/bin/java'
            ];

            for (const p of unixPaths) {
                await testJava(p);
            }

            // macOS JDK utility
            if (process.platform === 'darwin') {
                try {
                    const { stdout } = await execAsync(
                        '/usr/libexec/java_home -V 2>&1 || true'
                    );
                    const matches = [
                        ...stdout.matchAll(/\/Library\/Java\/JavaVirtualMachines\/[^\s]+/g)
                    ];
                    for (const m of matches) {
                        await testJava(
                            path.join(m[0].trim(), 'Contents', 'Home', 'bin', 'java')
                        );
                    }
                } catch (_) {}
            }

            // JAVA_HOME env
            if (process.env.JAVA_HOME) {
                await testJava(
                    path.join(process.env.JAVA_HOME, 'bin', 'java')
                );
            }
        }

        console.log(
            '[JAVA DETECT] Total found:',
            results.length
        );

        return results;
    }
}

module.exports = new JavaManager();
