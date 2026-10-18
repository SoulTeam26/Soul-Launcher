const axios = require('axios');
const fs = require('fs');
const gracefulFs = require('graceful-fs');
gracefulFs.gracefulify(fs);
const path = require('path');
const githubAuth = require('./github-auth');

// Prefer IPv4 and fail fast — avoids the multi-second IPv6 black-hole delay
// that otherwise stalls every Modrinth/Mojang request on affected networks.
axios.defaults.family = 4;
axios.defaults.timeout = 15000;

const MODRINTH_SORTS = new Set(['relevance', 'downloads', 'follows', 'newest', 'updated']);

async function searchModrinth(query, type = 'mod', version = '', categories = [], offset = 0, limit = 20, sort = '') {
    try {
        const facets = [[`project_type:${type}`]];
        if (version) facets.push([`versions:${version}`]);

        if (Array.isArray(categories) && categories.length > 0) {
            categories.forEach(cat => {
                if (cat) facets.push([`categories:${cat}`]);
            });
        }

        // Empty query = browse mode → most downloaded first.
        // Typed query = search mode → relevance first (unless caller overrides).
        const trimmed = String(query || '').trim();
        const index = MODRINTH_SORTS.has(sort) ? sort : (trimmed ? 'relevance' : 'downloads');

        const params = {
            query: trimmed,
            facets: JSON.stringify(facets),
            offset,
            limit,
            index
        };
        
        const response = await axios.get('https://api.modrinth.com/v2/search', { params, timeout: 15000 });
        return { hits: response.data.hits, totalHits: response.data.total_hits };
    } catch (error) {
        console.error('Modrinth Search Error:', error);
        return { hits: [], totalHits: 0 };
    }
}

async function getProjectVersions(projectId, loader = '', gameVersion = '') {
    try {
        const params = {
            loaders: loader ? JSON.stringify([loader]) : undefined,
            game_versions: gameVersion ? JSON.stringify([gameVersion]) : undefined
        };
        const response = await axios.get(`https://api.modrinth.com/v2/project/${projectId}/version`, { params, timeout: 15000 });
        return response.data;
    } catch (error) {
        console.error('Modrinth Version Error:', error);
        return [];
    }
}

async function getProjectDependencies(projectId) {
    try {
        const response = await axios.get(`https://api.modrinth.com/v2/project/${projectId}/dependencies`);
        return response.data;
    } catch (error) {
        console.error('Modrinth Dependencies Error:', error);
        return { projects: [], versions: [] };
    }
}

async function getProject(projectId) {
    try {
        const response = await axios.get(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`, { timeout: 15000 });
        return response.data;
    } catch (error) {
        throw new Error(`Could not load Modrinth project ${projectId}: ${error.message}`);
    }
}

async function getVersion(versionId) {
    try {
        const response = await axios.get(`https://api.modrinth.com/v2/version/${versionId}`, { timeout: 15000 });
        return response.data;
    } catch (error) {
        throw new Error(`Could not load Modrinth version ${versionId}: ${error.message}`);
    }
}

function isValidZip(p) {
    let fd;
    try {
        fd = fs.openSync(p, 'r');
        const stat = fs.fstatSync(fd);
        if (stat.size < 22) return false;
        const header = Buffer.alloc(4);
        fs.readSync(fd, header, 0, 4, 0);
        if (header.readUInt32LE(0) !== 0x04034b50) return false;
        const scanSize = Math.min(65558, stat.size);
        const tail = Buffer.alloc(scanSize);
        fs.readSync(fd, tail, 0, scanSize, stat.size - scanSize);
        const eocdMagic = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
        return tail.includes(eocdMagic);
    } catch (_) {
        return false;
    } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    }
}

async function streamDownload(url, destPath) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        maxRedirects: 5,
        timeout: 30000,
        validateStatus: status => status === 200,
        headers: {
            'User-Agent': 'SoulLauncher/1.0',
            ...githubAuth.authHeadersFor(url)
        }
    });

    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
}

function parseGitLfsPointer(filePath) {
    try {
        const text = fs.readFileSync(filePath, 'utf8');
        const match = text.match(/^version https:\/\/git-lfs\.github\.com\/spec\/v1\s+oid sha256:([a-f0-9]{64})\s+size (\d+)\s*$/i);
        return match ? { oid: match[1], size: Number(match[2]) } : null;
    } catch (_) {
        return null;
    }
}

async function resolveGitLfsDownload(rawUrl, pointer) {
    const parsed = new URL(rawUrl);
    if (parsed.hostname !== 'raw.githubusercontent.com') {
        throw new Error('The download is a Git LFS pointer, but its host is not supported. Use a GitHub release asset URL.');
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 4) throw new Error('The GitHub LFS download URL is malformed.');
    const [owner, repo] = parts;
    const batchUrl = `https://github.com/${owner}/${repo}.git/info/lfs/objects/batch`;
    const response = await axios.post(batchUrl, {
        operation: 'download',
        transfers: ['basic'],
        objects: [{ oid: pointer.oid, size: pointer.size }]
    }, {
        timeout: 30000,
        headers: {
            Accept: 'application/vnd.git-lfs+json',
            'Content-Type': 'application/vnd.git-lfs+json',
            'User-Agent': 'SoulLauncher/1.0',
            ...githubAuth.authHeadersFor(batchUrl)
        }
    });
    const download = response.data?.objects?.[0]?.actions?.download;
    if (!download?.href) throw new Error('GitHub could not provide the LFS archive download.');
    return { url: download.href, headers: download.header || {} };
}

async function downloadMod(url, destPath) {
    const tempPath = `${destPath}.download-${process.pid}-${Date.now()}`;
    try {
        await streamDownload(url, tempPath);

        if (!isValidZip(tempPath)) {
            const pointer = parseGitLfsPointer(tempPath);
            if (!pointer) throw new Error(`Downloaded file is not a valid archive: ${path.basename(destPath)}`);
            const lfsDownload = await resolveGitLfsDownload(url, pointer);
            fs.rmSync(tempPath, { force: true });
            const response = await axios({
                url: lfsDownload.url,
                method: 'GET',
                responseType: 'stream',
                maxRedirects: 5,
                timeout: 60000,
                validateStatus: status => status === 200,
                headers: { 'User-Agent': 'SoulLauncher/1.0', ...lfsDownload.headers }
            });
            const writer = fs.createWriteStream(tempPath);
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
                response.data.on('error', reject);
            });
        }

        if (!isValidZip(tempPath)) throw new Error(`Downloaded file is not a valid archive: ${path.basename(destPath)}`);
        fs.rmSync(destPath, { force: true });
        fs.renameSync(tempPath, destPath);
    } finally {
        try { fs.rmSync(tempPath, { force: true }); } catch (_) {}
    }
}

/**
 * Resolve the best version id for a project when a dependency only carries
 * a project_id (Modrinth omits version_id unless the exact release is known).
 * Tries instance-exact match first, then progressively looser filters.
 */
async function resolveCompatibleVersionId(projectId, gameVersion, loader) {
    const combos = [];
    if (gameVersion && loader) combos.push([loader, gameVersion]);
    if (gameVersion) combos.push(['', gameVersion]);
    if (loader) combos.push([loader, '']);
    combos.push(['', '']);
    const seen = new Set();
    for (const [l, g] of combos) {
        const key = `${l}|${g}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
            const list = await getProjectVersions(projectId, l, g);
            if (list && list.length) return list[0];
        } catch (_) {}
    }
    return null;
}

async function getProjectTitleBestEffort(projectId) {
    try {
        const p = await getProject(projectId);
        return p && (p.title || p.slug) ? (p.title || p.slug) : projectId;
    } catch (_) {
        return projectId;
    }
}

/**
 * Downloads a selected version and all of its required Modrinth dependencies.
 * Dependencies are resolved by version id, so a compatible release selected by
 * the launcher is retained rather than silently choosing a newer incompatible one.
 * Required deps that only carry a project_id are resolved to the best release
 * matching { gameVersion, loader }; anything unresolvable is reported back in
 * `unresolved` instead of failing the whole install.
 * Returns { installed: [...], unresolved: [{ projectId, title, reason }] }.
 */
async function downloadVersionWithDependencies(versionId, destDir, downloaded = new Set(), compat = {}, unresolved = [], seenProjects = new Set()) {
    const version = await getVersion(versionId);
    if (!version || !version.id) throw new Error('Modrinth returned an invalid version.');
    if (downloaded.has(version.id)) return { installed: [], unresolved };
    downloaded.add(version.id);
    if (version.project_id) seenProjects.add(version.project_id);

    const installed = [];
    const gameVersion = (compat && compat.gameVersion) || (version.game_versions || [])[0] || '';
    const loader = (compat && compat.loader) || (version.loaders || [])[0] || '';
    for (const dependency of version.dependencies || []) {
        if (dependency.dependency_type !== 'required') continue;
        try {
            if (dependency.version_id) {
                const sub = await downloadVersionWithDependencies(dependency.version_id, destDir, downloaded, compat, unresolved, seenProjects);
                installed.push(...sub.installed);
            } else if (dependency.project_id) {
                if (seenProjects.has(dependency.project_id)) continue;
                seenProjects.add(dependency.project_id);
                const resolved = await resolveCompatibleVersionId(dependency.project_id, gameVersion, loader);
                if (resolved) {
                    const sub = await downloadVersionWithDependencies(resolved.id, destDir, downloaded, compat, unresolved, seenProjects);
                    installed.push(...sub.installed);
                } else {
                    unresolved.push({ projectId: dependency.project_id, title: await getProjectTitleBestEffort(dependency.project_id), reason: 'no compatible release found' });
                }
            }
        } catch (e) {
            unresolved.push({
                projectId: dependency.project_id || null,
                title: dependency.project_id ? await getProjectTitleBestEffort(dependency.project_id) : (dependency.version_id || 'unknown'),
                reason: e.message
            });
        }
    }

    const file = (version.files || []).find(entry => entry.primary) || (version.files || [])[0];
    if (!file?.url || !file?.filename) {
        throw new Error(`No downloadable file is available for ${version.name || version.id}.`);
    }
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    await downloadMod(file.url, path.join(destDir, file.filename));
    installed.push({ id: version.id, projectId: version.project_id, filename: file.filename, version: version.version_number });
    return { installed, unresolved };
}

const SOULCLIENT_DEPS = [
  { projectId: 'P7dR8mSH', filename: 'fabric-api.jar' },    // Fabric API
  { projectId: 'mOgUt4GM', filename: 'modmenu.jar' }        // Mod Menu
];

async function downloadSoulClientDeps(gameVersion, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const results = [];
  for (const dep of SOULCLIENT_DEPS) {
    try {
      const versions = await getProjectVersions(dep.projectId, 'fabric', gameVersion);
      if (versions && versions.length > 0) {
        const latest = versions[0];
        const file = latest.files?.[0];
        if (file && file.url) {
          const destPath = path.join(destDir, dep.filename);
          await downloadMod(file.url, destPath);
          results.push({ projectId: dep.projectId, filename: dep.filename, success: true });
          continue;
        }
      }
      results.push({ projectId: dep.projectId, filename: dep.filename, success: false, reason: 'No version found' });
    } catch (e) {
      results.push({ projectId: dep.projectId, filename: dep.filename, success: false, reason: e.message });
    }
  }
  return results;
}

module.exports = { searchModrinth, getProject, getProjectVersions, getProjectDependencies, getVersion, downloadMod, downloadVersionWithDependencies, downloadSoulClientDeps };
