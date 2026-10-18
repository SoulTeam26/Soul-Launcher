/**
 * Soul LAUNCHER – BEDROCK EDITION MANAGER
 *
 * Bedrock Edition on Windows ships as a UWP/Store app
 * (`Microsoft.MinecraftUWP`). There is no public download / version
 * API like Java has – the user installs/updates it through the
 * Microsoft Store. We can:
 *   • detect whether it's installed (PowerShell Get-AppxPackage)
 *   • launch it via the AppsFolder shell handle (release OR preview)
 *   • open the Store page if it isn't installed
 *
 * Bedrock is Windows-only. On other platforms every call resolves
 * with `{ supported: false }` and `launch()` throws a friendly error.
 */

const { shell } = require('electron');
const { exec, spawn } = require('child_process');

const APPS = {
    release: {
        id: 'Microsoft.MinecraftUWP',
        appsFolder: 'Microsoft.MinecraftUWP_8wekyb3d8bbcw!App',
        label: 'Minecraft Bedrock Edition',
        storeId: '9NBLGGH2JHXJ'
    },
    preview: {
        id: 'Microsoft.MinecraftWindowsBeta',
        appsFolder: 'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbcw!App',
        label: 'Minecraft Preview',
        storeId: '9P5X4QVLC2XR'
    }
};

const isWindows = process.platform === 'win32';

function psQuery(cmd) {
    return new Promise(resolve => {
        exec(
            `powershell.exe -NoProfile -NonInteractive -Command "${cmd}"`,
            { windowsHide: true, timeout: 8000 },
            (err, stdout) => resolve(err ? '' : String(stdout || '').trim())
        );
    });
}

async function getEditionInfo(edition) {
    const meta = APPS[edition];
    if (!meta) return null;
    if (!isWindows) {
        return { edition, label: meta.label, installed: false, version: null, supported: false };
    }
    const out = await psQuery(
        `try { (Get-AppxPackage -Name ${meta.id} -ErrorAction Stop).Version } catch { '' }`
    );
    const version = out && /^\d/.test(out) ? out : null;
    return {
        edition,
        label: meta.label,
        installed: !!version,
        version,
        supported: true
    };
}

async function getInfo() {
    return {
        platform: process.platform,
        supported: isWindows,
        release: await getEditionInfo('release'),
        preview: await getEditionInfo('preview')
    };
}

async function launch(edition = 'release') {
    const meta = APPS[edition] || APPS.release;
    if (!isWindows) {
        throw new Error('Minecraft Bedrock Edition can only be launched on Windows.');
    }
    const info = await getEditionInfo(edition);
    if (!info.installed) {
        // Open the Store page so the user can install it.
        await openStore(edition);
        throw new Error(`${meta.label} is not installed. Opened the Microsoft Store.`);
    }
    return new Promise((resolve, reject) => {
        const child = spawn(
            'explorer.exe',
            [`shell:AppsFolder\\${meta.appsFolder}`],
            { detached: true, stdio: 'ignore', windowsHide: true }
        );
        child.on('error', reject);
        child.unref();
        // explorer returns immediately; give it a beat and resolve.
        setTimeout(() => resolve({ launched: true, edition, version: info.version }), 400);
    });
}

async function openStore(edition = 'release') {
    const meta = APPS[edition] || APPS.release;
    await shell.openExternal(`ms-windows-store://pdp/?productid=${meta.storeId}`);
    return { opened: true };
}

module.exports = { getInfo, launch, openStore, APPS };
