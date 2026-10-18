'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { Client } = require('minecraft-launcher-core');

function sha1File(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        return crypto.createHash('sha1').update(buf).digest('hex');
    } catch (_) {
        return '';
    }
}

const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const FORGE_METADATA_URL = `${FORGE_MAVEN.replace('maven.minecraftforge.net', 'files.minecraftforge.net/maven')}/maven-metadata.xml`;
const LIBRARIES_NET = 'https://libraries.minecraft.net';
const VERSION_MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';

// FALLBACK ONLY. Forge's own install_profile.json is always the authoritative
// source for exactly which launchwrapper/jopt-simple/asm/etc. build a given
// Forge release needs - those coordinates differ across legacy eras (e.g.
// 1.6.x used launchwrapper 1.3 + asm-all 4.1 + jopt-simple 4.5, 1.7.x used
// launchwrapper 1.9 + asm-all 4.1, 1.8.x-1.12.x used launchwrapper 1.12 +
// asm-all 5.0.3 + jopt-simple 4.6). A single fixed version list can never be
// correct for every legacy Forge build, so this table is split by the
// minecraft version ranges that historically shipped each combination, and
// is only consulted as a last resort when fetchForgeOwnLibraries() did not
// already supply a coordinate for that artifact (see resolveLegacyFallbackLibraries).
function legacyLibSpec(name, relSuffix, baseUrl = LIBRARIES_NET) {
    return {
        name,
        relPath: path.join(...relSuffix),
        url: `${baseUrl}/${relSuffix.join('/')}`
    };
}

// files.minecraftforge.net is DEAD (DNS no longer resolves - Forge migrated
// this content to maven.minecraftforge.net years ago). These deferred-load
// libraries (Scala/Akka/maven-artifact/etc, see DEFERRED_LIBRARY_SUPPLEMENTS)
// were historically served from the old files.minecraftforge.net/maven host
// in installer logs, but that host is gone, so we point at the live
// maven.minecraftforge.net mirror instead, which carries the same artifacts
// under the same path layout.
const FORGE_FILES_MAVEN = FORGE_MAVEN.replace(/\/net\/minecraftforge\/forge$/, '');

const LEGACY_FALLBACK_TABLE = [
    {
        // Forge for MC 1.3 - 1.6.4 (cpw.mods.fml era)
        maxVersion: [1, 6, 4],
        libs: [
            legacyLibSpec('net.minecraft:launchwrapper:1.3', ['net', 'minecraft', 'launchwrapper', '1.3', 'launchwrapper-1.3.jar']),
            legacyLibSpec('net.sf.jopt-simple:jopt-simple:4.5', ['net', 'sf', 'jopt-simple', 'jopt-simple', '4.5', 'jopt-simple-4.5.jar']),
            legacyLibSpec('org.ow2.asm:asm-all:4.1', ['org', 'ow2', 'asm', 'asm-all', '4.1', 'asm-all-4.1.jar']),
            legacyLibSpec('lzma:lzma:0.0.1', ['lzma', 'lzma', '0.0.1', 'lzma-0.0.1.jar'])
        ]
    },
    {
        // Forge for MC 1.7.x (net.minecraftforge.fml era begins, launchwrapper 1.9)
        maxVersion: [1, 7, 10],
        libs: [
            legacyLibSpec('net.minecraft:launchwrapper:1.9', ['net', 'minecraft', 'launchwrapper', '1.9', 'launchwrapper-1.9.jar']),
            legacyLibSpec('net.sf.jopt-simple:jopt-simple:4.6', ['net', 'sf', 'jopt-simple', 'jopt-simple', '4.6', 'jopt-simple-4.6.jar']),
            legacyLibSpec('org.ow2.asm:asm-all:4.1', ['org', 'ow2', 'asm', 'asm-all', '4.1', 'asm-all-4.1.jar']),
            legacyLibSpec('lzma:lzma:0.0.1', ['lzma', 'lzma', '0.0.1', 'lzma-0.0.1.jar']),
            legacyLibSpec('net.sf.trove4j:trove4j:3.0.3', ['net', 'sf', 'trove4j', 'trove4j', '3.0.3', 'trove4j-3.0.3.jar']),
            legacyLibSpec('java3d:vecmath:1.3.1', ['java3d', 'vecmath', '1.3.1', 'vecmath-1.3.1.jar'])
        ]
    },
    {
        // Forge for MC 1.8.x - 1.12.x (launchwrapper 1.12, asm-all 5.0.3)
        maxVersion: [1, 12, 99],
        libs: [
            legacyLibSpec('net.minecraft:launchwrapper:1.12', ['net', 'minecraft', 'launchwrapper', '1.12', 'launchwrapper-1.12.jar']),
            legacyLibSpec('net.sf.jopt-simple:jopt-simple:4.6', ['net', 'sf', 'jopt-simple', 'jopt-simple', '4.6', 'jopt-simple-4.6.jar']),
            legacyLibSpec('org.ow2.asm:asm-all:5.2', ['org', 'ow2', 'asm', 'asm-all', '5.2', 'asm-all-5.2.jar']),
            legacyLibSpec('lzma:lzma:0.0.1', ['lzma', 'lzma', '0.0.1', 'lzma-0.0.1.jar']),
            legacyLibSpec('net.sf.trove4j:trove4j:3.0.3', ['net', 'sf', 'trove4j', 'trove4j', '3.0.3', 'trove4j-3.0.3.jar']),
            legacyLibSpec('java3d:vecmath:1.5.2', ['java3d', 'vecmath', '1.5.2', 'vecmath-1.5.2.jar'])
        ]
    }
];

// ADDITIVE supplements, layered ON TOP of the bracket above for specific
// mcVersions. Late Forge 1.10.2-1.12.2 builds (14.x, using
// net.minecraftforge.fml.relauncher.libraries.LibraryManager) defer-download
// a second, much larger set of libraries (Scala, Akka, a Maven artifact-
// version helper, jline, a newer asm-debug-all) at FML boot time, BEFORE any
// mod loads. That set isn't part of install_profile.json's declared
// libraries the way classic Forge libs are, and isn't downloaded by MCLC at
// all, so without it FML's own LibraryManager.findLibraryFolder() throws
// NoClassDefFoundError: org/apache/maven/artifact/versioning/ArtifactVersion
// before the game even gets to FMLTweaker's normal startup path. Coordinates
// verified against real Forge 1.12.2 installer logs (MultiMC issue #4171,
// "scala-compiler library won't download" thread on minecraftforum.net).
const DEFERRED_LIBRARY_SUPPLEMENTS = {
    '1.12.2': [
        legacyLibSpec('org.apache.maven:maven-artifact:3.5.3', ['org', 'apache', 'maven', 'maven-artifact', '3.5.3', 'maven-artifact-3.5.3.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('org.ow2.asm:asm-debug-all:5.2', ['org', 'ow2', 'asm', 'asm-debug-all', '5.2', 'asm-debug-all-5.2.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('org.jline:jline:3.5.1', ['org', 'jline', 'jline', '3.5.1', 'jline-3.5.1.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('com.typesafe.akka:akka-actor_2.11:2.3.3', ['com', 'typesafe', 'akka', 'akka-actor_2.11', '2.3.3', 'akka-actor_2.11-2.3.3.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('com.typesafe:config:1.2.1', ['com', 'typesafe', 'config', '1.2.1', 'config-1.2.1.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('org.scala-lang:scala-actors-migration_2.11:1.1.0', ['org', 'scala-lang', 'scala-actors-migration_2.11', '1.1.0', 'scala-actors-migration_2.11-1.1.0.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('org.scala-lang:scala-compiler:2.11.1', ['org', 'scala-lang', 'scala-compiler', '2.11.1', 'scala-compiler-2.11.1.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('org.scala-lang:scala-library:2.11.1', ['org', 'scala-lang', 'scala-library', '2.11.1', 'scala-library-2.11.1.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('org.scala-lang:scala-parser-combinators_2.11:1.0.1', ['org', 'scala-lang', 'scala-parser-combinators_2.11', '1.0.1', 'scala-parser-combinators_2.11-1.0.1.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('org.scala-lang:scala-reflect:2.11.1', ['org', 'scala-lang', 'scala-reflect', '2.11.1', 'scala-reflect-2.11.1.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('org.scala-lang:scala-swing_2.11:1.0.1', ['org', 'scala-lang', 'scala-swing_2.11', '1.0.1', 'scala-swing_2.11-1.0.1.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('org.scala-lang:scala-xml_2.11:1.0.2', ['org', 'scala-lang', 'scala-xml_2.11', '1.0.2', 'scala-xml_2.11-1.0.2.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('org.scala-lang.plugins:scala-continuations-library_2.11:1.0.2_mc', ['org', 'scala-lang', 'plugins', 'scala-continuations-library_2.11', '1.0.2_mc', 'scala-continuations-library_2.11-1.0.2_mc.jar'], FORGE_FILES_MAVEN),
        legacyLibSpec('org.scala-lang.plugins:scala-continuations-plugin_2.11.1:1.0.2_mc', ['org', 'scala-lang', 'plugins', 'scala-continuations-plugin_2.11.1', '1.0.2_mc', 'scala-continuations-plugin_2.11.1-1.0.2_mc.jar'], FORGE_FILES_MAVEN)
    ]
};

function parseMcVersion(mcVersion) {
    return String(mcVersion).split('.').map((n) => parseInt(n, 10) || 0);
}

function compareVersionTuples(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const av = a[i] || 0;
        const bv = b[i] || 0;
        if (av !== bv) return av - bv;
    }
    return 0;
}

// Returns the fallback lib spec list for the given mcVersion: the bracket
// libs (first bracket whose maxVersion is >= mcVersion) PLUS any exact-
// mcVersion additive supplement (e.g. 1.12.2's deferred LibraryManager set).
function legacyFallbackLibsFor(mcVersion) {
    const v = parseMcVersion(mcVersion);
    let bracketLibs = [];
    for (const bracket of LEGACY_FALLBACK_TABLE) {
        if (compareVersionTuples(v, bracket.maxVersion) <= 0) {
            bracketLibs = bracket.libs;
            break;
        }
    }
    let supplement = DEFERRED_LIBRARY_SUPPLEMENTS[String(mcVersion)];
    if (!supplement) {
        // Fallback for any 1.10.x, 1.11.x, or 1.12.x version since they share the same FML LibraryManager requirements
        if (mcVersion.startsWith('1.12.') || mcVersion === '1.12' ||
            mcVersion.startsWith('1.11.') || mcVersion === '1.11' ||
            mcVersion.startsWith('1.10.') || mcVersion === '1.10') {
            supplement = DEFERRED_LIBRARY_SUPPLEMENTS['1.12.2'];
        }
    }
    supplement = supplement || [];
    return bracketLibs.concat(supplement);
}

function noop() {}

function isModernMc(mcVersion) {
    const parts = String(mcVersion).split('.').map((n) => parseInt(n, 10) || 0);
    return parts[0] > 1 || (parts[0] === 1 && parts[1] >= 13);
}

// Full Maven coordinate (group:artifact:version[:classifier]) so that two
// DIFFERENT versions of the same library are never treated as duplicates.
// Using only "group:artifact" here was the root cause of legacy Forge
// launches silently dropping jopt-simple/launchwrapper/etc: vanilla 1.12's
// library list already references older/incompatible builds of those same
// artifacts, so the real (pinned) versions got skipped by mergeLibraries()
// even though "group:artifact" matched - the file that "won" had a broken/
// empty/wrong-version artifact url, so it never actually landed on disk or
// on the classpath, producing NoClassDefFoundError at runtime.
function libKey(name) {
    if (!name) return null;
    const parts = name.split(':');
    if (parts.length < 2) return null;
    return parts.slice(0, 4).join(':');
}

// Coarser key (group:artifact only) used ONLY to detect same-artifact
// version collisions so we can log them and let the authoritative source win.
function libGroupArtifact(name) {
    if (!name) return null;
    const parts = name.split(':');
    if (parts.length < 2) return null;
    return `${parts[0]}:${parts[1]}`;
}

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function downloadFile(url, destPath, { timeoutMs = 120000 } = {}) {
    ensureDir(path.dirname(destPath));
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: timeoutMs,
        maxRedirects: 10,
        headers: { 'User-Agent': 'SoulLauncher/1.0 (forge-core)' }
    });
    if (response.status !== 200) {
        throw new Error(`Download failed (${response.status} ${response.statusText}): ${url}`);
    }
    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
    return destPath;
}

// Mirror-aware alternates for hosts that have gone offline historically.
// files.minecraftforge.net is a confirmed dead host (DNS no longer
// resolves) but some library coordinates were only ever documented against
// it, so if a primary URL fails for one of these dead hosts, retry against
// the listed live mirror before giving up.
const DEAD_HOST_MIRRORS = [
    { deadHost: 'files.minecraftforge.net/maven', liveHost: 'maven.minecraftforge.net' }
];

function mirrorUrlsFor(url) {
    const alts = [];
    
    // 1. Dead host replacements
    for (const { deadHost, liveHost } of DEAD_HOST_MIRRORS) {
        if (url.includes(deadHost)) {
            alts.push(url.replace(deadHost, liveHost));
        }
    }

    // 2. Extract relative path and cross-mirror across standard repositories.
    // This allows downloading from repo1.maven.org (Maven Central), BMCLAPI, or libraries.minecraft.net
    // if the primary Forge Maven server is experiencing issues or has different library versions.
    try {
        const pathMatch = url.match(/(?:libraries\.minecraft\.net|maven\.minecraftforge\.net|files\.minecraftforge\.net\/maven|repo1\.maven\.org\/maven2|bmclapi2\.bangbang93\.com\/libraries|bmclapi2\.bangbang93\.com\/maven)\/(.+)$/);
        if (pathMatch && pathMatch[1]) {
            const relPath = pathMatch[1];
            const hosts = [
                'https://repo1.maven.org/maven2',
                'https://maven.minecraftforge.net',
                'https://libraries.minecraft.net',
                'https://bmclapi2.bangbang93.com/libraries',
                'https://bmclapi2.bangbang93.com/maven'
            ];
            for (const host of hosts) {
                const candidate = `${host}/${relPath}`;
                if (candidate !== url && !alts.includes(candidate)) {
                    alts.push(candidate);
                }
            }
        }
    } catch (e) {
        // ignore parsing errors
    }

    return alts;
}

// Downloads to destPath, retrying against known-good mirrors if the primary
// URL's host is a dead/unreachable domain. Always verifies the file exists
// and is non-empty afterward; throws with a clear message listing every URL
// attempted if all of them fail, instead of leaving a half-written/missing
// file that only surfaces as a cryptic Java NoClassDefFoundError later.
async function downloadFileWithFallback(url, destPath, log = noop) {
    const candidates = [url, ...mirrorUrlsFor(url)];
    const errors = [];
    for (const candidate of candidates) {
        try {
            await downloadFile(candidate, destPath);
            const ok = fs.existsSync(destPath) && fs.statSync(destPath).size > 0;
            if (!ok) throw new Error('downloaded file is missing or empty');
            if (candidate !== url) {
                log(`[FORGE] Primary URL failed, succeeded via mirror: ${candidate}`);
            }
            return destPath;
        } catch (e) {
            errors.push(`${candidate} -> ${e.message}`);
        }
    }
    throw new Error(`All download attempts failed:\n  ${errors.join('\n  ')}`);
}

async function fetchAllForgeBuildStrings() {
    const resp = await axios.get(FORGE_METADATA_URL, {
        headers: { 'User-Agent': 'SoulLauncher/1.0 (forge-core)' }
    });
    const xml = resp.data;
    return Array.from(xml.matchAll(/<version>([^<]+)<\/version>/g), (m) => m[1]);
}

async function resolveForgeBuild(mcVersion, preferredBuild, log = noop) {
    let versions;
    try {
        versions = await fetchAllForgeBuildStrings();
    } catch (e) {
        log(`[WARNING] Could not reach Forge maven-metadata.xml: ${e.message}`);
        return preferredBuild || null;
    }

    if (preferredBuild) {
        if (versions.includes(preferredBuild)) return preferredBuild;
        const matches = versions.filter((v) => v.startsWith(`${preferredBuild}-`));
        if (matches.length) return matches[matches.length - 1];
    }

    const prefix = `${mcVersion}-`;
    const matches = versions.filter((v) => v.startsWith(prefix));
    return matches.length ? matches[matches.length - 1] : null;
}

async function downloadForgeJar(soulPath, forgeBuild, suffix, log = noop) {
    const jarName = `forge-${forgeBuild}-${suffix}.jar`;
    const destPath = path.join(soulPath, 'forge', jarName);

    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
        return destPath;
    }

    const url = `${FORGE_MAVEN}/${forgeBuild}/${jarName}`;
    log(`[FORGE] Downloading ${suffix} jar: ${url}`);
    await downloadFileWithFallback(url, destPath, log);
    return destPath;
}

async function fetchVanillaLibraries(mcVersion, log = noop) {
    try {
        const manifestResp = await axios.get(VERSION_MANIFEST_URL);
        const entry = (manifestResp.data.versions || []).find((v) => v.id === mcVersion);
        if (!entry) {
            log(`[WARNING] ${mcVersion} not found in Mojang's version manifest.`);
            return [];
        }
        const verResp = await axios.get(entry.url);
        const libs = Array.isArray(verResp.data.libraries) ? verResp.data.libraries : [];
        log(`[FORGE] Fetched ${libs.length} vanilla ${mcVersion} libraries.`);
        return libs;
    } catch (e) {
        log(`[WARNING] Failed to fetch vanilla libraries: ${e.message}`);
        return [];
    }
}

async function fetchVanillaVersionJson(versionsPath, mcVersion, log = noop) {
    const localVersionPath = path.join(versionsPath, mcVersion, `${mcVersion}.json`);
    if (fs.existsSync(localVersionPath)) {
        try {
            return JSON.parse(fs.readFileSync(localVersionPath, 'utf8'));
        } catch (e) {
            log(`[WARNING] Failed to read local vanilla version JSON: ${e.message}`);
        }
    }

    try {
        const manifestResp = await axios.get(VERSION_MANIFEST_URL);
        const entry = (manifestResp.data.versions || []).find((v) => v.id === mcVersion);
        if (!entry) {
            log(`[WARNING] ${mcVersion} not found in Mojang's version manifest.`);
            return null;
        }

        const verResp = await axios.get(entry.url);
        return verResp.data || null;
    } catch (e) {
        log(`[WARNING] Failed to fetch vanilla version JSON: ${e.message}`);
        return null;
    }
}

async function ensureVanillaClientJar(versionsPath, mcVersion, vanillaVersionJson, log = noop) {
    const versionDir = path.join(versionsPath, mcVersion);
    ensureDir(versionDir);

    const jarPath = path.join(versionDir, `${mcVersion}.jar`);
    if (fs.existsSync(jarPath) && fs.statSync(jarPath).size > 0) {
        return jarPath;
    }

    const clientUrl = vanillaVersionJson && vanillaVersionJson.downloads && vanillaVersionJson.downloads.client && vanillaVersionJson.downloads.client.url;
    if (!clientUrl) {
        throw new Error(`Missing vanilla client download URL for ${mcVersion}.`);
    }

    log(`[FORGE] Downloading vanilla ${mcVersion} client jar...`);
    await downloadFile(clientUrl, jarPath);
    return jarPath;
}

async function fetchForgeOwnLibraries(soulPath, forgeBuild, log = noop) {
    try {
        const installerPath = await downloadForgeJar(soulPath, forgeBuild, 'installer', log);
        const zip = new AdmZip(installerPath);
        const entry = zip.getEntry('install_profile.json');
        if (!entry) {
            log('[WARNING] install_profile.json missing from Forge installer.');
            return [];
        }

        const profile = JSON.parse(zip.readAsText(entry));
        const rawLibs = Array.isArray(profile.versionInfo && profile.versionInfo.libraries)
            ? profile.versionInfo.libraries
            : (Array.isArray(profile.libraries) ? profile.libraries : []);

        const out = [];
        for (const lib of rawLibs) {
            if (!lib || !lib.name) continue;
            if (lib.clientreq === false) continue;

            if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) {
                out.push(lib);
                continue;
            }

            const parts = lib.name.split(':');
            if (parts.length < 3) continue;
            const [group, artifact, version] = parts;
            const classifier = parts[3];
            const fileName = classifier ? `${artifact}-${version}-${classifier}.jar` : `${artifact}-${version}.jar`;
            const relPath = `${group.replace(/\./g, '/')}/${artifact}/${version}/${fileName}`;
            const baseUrl = (lib.url || `${LIBRARIES_NET}/`).replace(/\/?$/, '/');

            out.push({
                name: lib.name,
                downloads: {
                    artifact: { path: relPath, url: baseUrl + relPath, sha1: '', size: 0 }
                }
            });
        }

        log(`[FORGE] Parsed ${out.length} Forge-specific libraries from install_profile.json`);
        return out;
    } catch (e) {
        log(`[WARNING] Failed to read Forge installer libraries: ${e.message}`);
        return [];
    }
}

// authoritative=true means `incoming` is a trusted/required source (Forge's
// own install_profile.json libraries, or our hand-pinned legacy jars) and
// should REPLACE any existing entry for the same group:artifact rather than
// be skipped by it. This matters because vanilla version manifests for old
// MC versions (e.g. 1.12) can list older/incompatible builds of libraries
// that Forge's legacy launchwrapper actually needs (jopt-simple,
// launchwrapper, lzma, asm-all, trove4j, vecmath); silently keeping the
// vanilla entry left those jars undownloadable or absent from the classpath,
// causing NoClassDefFoundError/ClassNotFoundException at runtime even though
// the logs claimed they were "pinned".
function hasUsableArtifact(lib) {
    const artifact = lib && lib.downloads && lib.downloads.artifact;
    return !!(artifact && artifact.path && artifact.url);
}

// mode: 'add' (default) - only add brand-new group:artifact entries, never
//   touch an existing one (used for the vanilla base layer).
// mode: 'authoritative' - `incoming` is a trusted/required source (Forge's
//   own install_profile.json libraries) and REPLACES any existing entry for
//   the same group:artifact, even a usable one, because install_profile.json
//   is more correct than anything else we have for that exact Forge build.
// mode: 'fill-gaps' - `incoming` is our static legacy fallback table, which
//   is only a best-guess for older Forge eras. It may replace an existing
//   entry ONLY if that entry is unusable (missing url/path); it must never
//   overwrite a usable entry that install_profile.json already supplied,
//   since our static guess could be the wrong sub-version for that build.
function mergeLibraries(base, incoming, log = noop, label = 'libraries', mode = 'add') {
    const byGroupArtifact = new Map();
    base.forEach((l, idx) => {
        const ga = libGroupArtifact(l.name);
        if (ga) byGroupArtifact.set(ga, idx);
    });
    const byKey = new Map();
    base.forEach((l, idx) => {
        const key = libKey(l.name);
        if (key) byKey.set(key, idx);
    });

    const result = base.slice();
    let added = 0;
    let replaced = 0;

    for (const lib of incoming) {
        const key = libKey(lib.name);
        if (!key) continue;
        const ga = libGroupArtifact(lib.name);

        if (byKey.has(key)) {
            // Exact same coordinate already present. Normally nothing to do,
            // but if the existing entry has no real download path/url, it's
            // unusable - replace it (any mode except plain 'add' may do this)
            // instead of keeping a jar that can never actually be fetched.
            const idx = byKey.get(key);
            if (mode !== 'add' && hasUsableArtifact(lib) && !hasUsableArtifact(result[idx])) {
                result[idx] = lib;
                replaced += 1;
                log(`[FORGE] Replaced unusable entry for ${lib.name} (${label})`);
            }
            continue;
        }

        if (mode === 'authoritative' && ga && byGroupArtifact.has(ga)) {
            const idx = byGroupArtifact.get(ga);
            const oldName = result[idx].name;
            result[idx] = lib;
            byKey.delete(libKey(oldName));
            byKey.set(key, idx);
            replaced += 1;
            log(`[FORGE] Replaced ${oldName} -> ${lib.name} (authoritative ${label})`);
            continue;
        }

        if (mode === 'fill-gaps' && ga && byGroupArtifact.has(ga)) {
            const idx = byGroupArtifact.get(ga);
            if (!hasUsableArtifact(result[idx])) {
                const oldName = result[idx].name;
                result[idx] = lib;
                byKey.delete(libKey(oldName));
                byKey.set(key, idx);
                replaced += 1;
                log(`[FORGE] Replaced unusable ${oldName} -> ${lib.name} (fallback ${label})`);
            }
            // If the existing entry IS usable, it came from a more
            // authoritative source (install_profile.json) - leave it alone
            // even though our static fallback table also has a guess for
            // this group:artifact.
            continue;
        }

        result.push(lib);
        byKey.set(key, result.length - 1);
        if (ga) byGroupArtifact.set(ga, result.length - 1);
        added += 1;
    }

    log(`[FORGE] Merged ${added} ${label}${replaced ? ` (replaced ${replaced} stale)` : ''} (total: ${result.length})`);
    return result;
}

// FORGE LIBRARY VERIFIER. Goes through every entry in `libraries` that has a
// real downloads.artifact.{path,url} and guarantees it ends up present and
// non-empty on disk at <librariesPath>/<artifact.path>, downloading it (with
// dead-host mirror fallback) if missing. This is the single choke point that
// both buildLegacyForgeProfile() and launchForge() use, so "the libraries we
// said we'd use" and "the jars actually sitting on disk for Java's -cp" can
// never silently drift apart. Returns { ok, failed, verified } - failed is a
// list of { name, attempts } so a caller can decide whether to hard-fail or
// just warn. This directly targets the failure mode behind BOTH crashes seen
// so far (jopt-simple/launchwrapper, then maven-artifact/Scala/Akka): a
// library was declared in the version JSON but the actual jar wasn't
// reliably on disk, and nothing checked before Java itself tried to load it.
async function verifyLibrariesOnDisk(libraries, librariesPath, log = noop) {
    const failed = [];
    const verified = [];

    for (const lib of libraries) {
        const artifact = lib.downloads && lib.downloads.artifact;
        if (!artifact || !artifact.path || !artifact.url) continue;

        const libPath = path.join(librariesPath, artifact.path.split('/').join(path.sep));

        if (fs.existsSync(libPath) && fs.statSync(libPath).size > 0) {
            verified.push(lib.name);
            continue;
        }

        try {
            await downloadFileWithFallback(artifact.url, libPath, log);
            verified.push(lib.name);
            log(`[FORGE VERIFY] OK: ${lib.name}`);
        } catch (e) {
            log(`[FORGE VERIFY] MISSING: ${lib.name} - ${e.message}`);
            failed.push({ name: lib.name, path: libPath, url: artifact.url, reason: e.message });
        }
    }

    const ok = failed.length === 0;
    if (!ok) {
        log(`[FORGE VERIFY] ${failed.length} of ${verified.length + failed.length} libraries could not be verified on disk: ${failed.map((f) => f.name).join(', ')}`);
    } else {
        log(`[FORGE VERIFY] All ${verified.length} required libraries present on disk.`);
    }

    return { ok, failed, verified };
}

async function buildLegacyForgeProfile({ soulPath, versionsPath, librariesPath, mcVersion, forgeBuild, forgeJarPath, log }) {
    const profileId = `forge-${forgeBuild}`;
    const versionDir = path.join(versionsPath, profileId);
    ensureDir(versionDir);

    const [vanillaVersionJson, vanillaLibraries, forgeLibraries] = await Promise.all([
        fetchVanillaVersionJson(versionsPath, mcVersion, log),
        fetchVanillaLibraries(mcVersion, log),
        fetchForgeOwnLibraries(soulPath, forgeBuild, log)
    ]);

    const vanillaJarPath = await ensureVanillaClientJar(versionsPath, mcVersion, vanillaVersionJson, log);
    const jarDest = path.join(versionDir, `${profileId}.jar`);
    fs.copyFileSync(vanillaJarPath, jarDest);

    let versionJson = null;
    try {
        const zip = new AdmZip(forgeJarPath);
        const entry = zip.getEntry('version.json');
        if (entry) {
            versionJson = JSON.parse(zip.readAsText(entry));
            log('[FORGE] Extracted version.json from the universal jar.');
        }
    } catch (e) {
        log(`[WARNING] Could not read version.json from universal jar: ${e.message}`);
    }

    if (!versionJson) {
        const now = new Date().toISOString();
        versionJson = {
            id: profileId,
            time: now,
            releaseTime: now,
            type: 'release',
            mainClass: 'net.minecraft.launchwrapper.Launch',
            libraries: [],
            minecraftArguments:
                '--username ${auth_player_name} --version ${version_name} ' +
                '--gameDir ${game_directory} --assetsDir ${assets_root} ' +
                '--assetIndex ${assets_index_name} --uuid ${auth_uuid} ' +
                '--accessToken ${auth_access_token} --userType ${user_type} ' +
                '--tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker ' +
                '--versionType Forge'
        };
        log('[FORGE] No version.json in universal jar - built one from scratch.');
    }

    delete versionJson.inheritsFrom;
    versionJson.id = profileId;
    if (vanillaVersionJson) {
        if (!versionJson.assetIndex && vanillaVersionJson.assetIndex) {
            versionJson.assetIndex = vanillaVersionJson.assetIndex;
        }
        if (!versionJson.assets && vanillaVersionJson.assets) {
            versionJson.assets = vanillaVersionJson.assets;
        }
    }

    const forgeLibRelPath = path
        .join('net', 'minecraftforge', 'forge', forgeBuild, `forge-${forgeBuild}-universal.jar`)
        .split(path.sep).join('/');
    const forgeLibAbsPath = path.join(librariesPath, forgeLibRelPath);
    ensureDir(path.dirname(forgeLibAbsPath));
    fs.copyFileSync(forgeJarPath, forgeLibAbsPath);

    // Local file already exists on disk (copied above). Give MCLC a real
    // URL, real sha1, and non-zero size so it does NOT treat this as an
    // invalid library and silently drop it from the classpath -- a dropped
    // forge jar is the direct cause of "ClassNotFoundException:
    // net.minecraftforge.fml.common.launcher.FMLTweaker" at launch, because
    // FMLTweaker lives inside this jar. Legacy Forge on maven uses the
    // `-universal` classifier, NOT a plain forge-<build>.jar -- the plain
    // URL 404s and MCLC's hash/size validator then drops the entry from
    // the classpath.
    let forgeJarSize = 0;
    try { forgeJarSize = fs.statSync(forgeLibAbsPath).size; } catch (_) {}
    const forgeJarSha1 = sha1File(forgeLibAbsPath);
    const forgeJarLibrary = {
        name: `net.minecraftforge:forge:${forgeBuild}:universal`,
        downloads: {
            artifact: {
                path: forgeLibRelPath,
                url: `${FORGE_MAVEN}/${forgeBuild}/forge-${forgeBuild}-universal.jar`,
                sha1: forgeJarSha1,
                size: forgeJarSize
            }
        }
    };

    let libraries = versionJson.libraries || [];
    // Strip any pre-existing forge self-reference so our concrete on-disk
    // entry below is the single source of truth (avoids MCLC picking the
    // stub one with an empty url from the universal jar's version.json).
    libraries = libraries.filter((lib) => {
        const n = String(lib?.name || '');
        return !n.startsWith('net.minecraftforge:forge:');
    });
    libraries = mergeLibraries(libraries, vanillaLibraries, log, `vanilla ${mcVersion} libraries`);
    libraries = mergeLibraries(libraries, forgeLibraries, log, 'Forge-specific libraries', 'authoritative');
    // Re-strip after merges in case an authoritative source re-introduced
    // a urlless forge self-reference.
    libraries = libraries.filter((lib) => {
        const n = String(lib?.name || '');
        return !n.startsWith('net.minecraftforge:forge:');
    });

    // Fallback libraries (launchwrapper, jopt-simple, asm-all, lzma, trove4j,
    // vecmath, etc.) for the specific legacy era this mcVersion belongs to.
    // These are version-aware (see LEGACY_FALLBACK_TABLE) instead of one
    // fixed list, since different legacy Forge releases need different
    // builds of the same artifacts. They are only a fallback: if
    // install_profile.json (forgeLibraries, merged above) already supplied
    // a given group:artifact, mergeLibraries() leaves that entry alone and
    // this fallback list is skipped for it - install_profile.json is always
    // the authoritative source for the exact build a given Forge release
    // actually wants.
    const fallbackLibs = legacyFallbackLibsFor(mcVersion);
    const fallbackAsLibraries = fallbackLibs.map((lib) => ({
        name: lib.name,
        downloads: {
            artifact: {
                path: lib.relPath.split(path.sep).join('/'),
                url: lib.url,
                sha1: '',
                size: 0
            }
        }
    }));
    libraries = mergeLibraries(libraries, fallbackAsLibraries, log, 'legacy fallback libraries', 'fill-gaps');

    libraries = libraries.concat([forgeJarLibrary]);
    versionJson.libraries = libraries;

    // Write BOTH filenames: <profileId>.json (for getClasses) AND
    // <version.number>.json (for getVersion which reads version.number.json)
    const jsonPath = path.join(versionDir, `${profileId}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(versionJson, null, 2));
    // CRITICAL DUPLICATE: MCLC's getVersion() reads ${version.number}.json
    const versionNumberJsonPath = path.join(versionDir, `${mcVersion}.json`);
    fs.writeFileSync(versionNumberJsonPath, JSON.stringify(versionJson, null, 2));
    log(`[FORGE] Legacy profile ready: ${profileId} (${libraries.length} libraries total)`);

    // Run every library through the shared verifier: downloads anything
    // missing (with dead-host mirror fallback) and confirms a real,
    // non-empty file lands at the path MCLC's classpath will expect.
    const { ok, failed } = await verifyLibrariesOnDisk(libraries, librariesPath, log);
    const failedLibs = failed.map((f) => f.name);

    if (!ok) {
        log(`[FORGE] WARNING: ${failedLibs.length} legacy/Forge libraries could not be verified and WILL likely cause a NoClassDefFoundError/ClassNotFoundException at launch: ${failedLibs.join(', ')}`);
    }

    return { profileId, versionDir, versionJson, failedLibs };
}

async function runForgeClientPatcher({ javaPath, librariesPath, forgeInstallerPath, vanillaJarPath, patchedJarPath, log }) {
    const tempDir = path.join(path.dirname(forgeInstallerPath), '.forge_patch');
    ensureDir(tempDir);

    const zip = new AdmZip(forgeInstallerPath);
    const lzmaEntry = zip.getEntry('data/client.lzma');
    if (!lzmaEntry) throw new Error('data/client.lzma not found in Forge installer.');
    const lzmaPath = path.join(tempDir, 'client.lzma');
    fs.writeFileSync(lzmaPath, zip.readFile(lzmaEntry));

    const deps = [
        'net/minecraftforge/binarypatcher/1.3.4/binarypatcher-1.3.4.jar',
        'net/minecraftforge/hash-utils/0.2.3/hash-utils-0.2.3.jar',
        'net/minecraftforge/srgutils/0.6.6/srgutils-0.6.6.jar',
        'net/sf/jopt-simple/jopt-simple/6.0-alpha-3/jopt-simple-6.0-alpha-3.jar',
        'com/github/jponge/lzma-java/1.3/lzma-java-1.3.jar',
        'com/nothome/javaxdelta/2.0.1/javaxdelta-2.0.1.jar',
        'trove/trove/1.0.2/trove-1.0.2.jar'
    ];
    const cp = deps.map(d => path.join(librariesPath, d.split('/').join(path.sep))).join(';');

    const args = [
        '-cp', cp,
        'net.minecraftforge.binarypatcher.ConsoleTool',
        '--clean', vanillaJarPath,
        '--output', patchedJarPath,
        '--apply', lzmaPath,
        '--data',
        '--unpatched',
        '--store',
        '--marker', '.forge_patched_minecraft'
    ];

    log(`[FORGE PATCH] Patching client jar with binarypatcher...`);
    await new Promise((resolve, reject) => {
        const proc = require('child_process').spawn(javaPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
            if (code === 0) {
                log(`[FORGE PATCH] OK: patched jar created (${(fs.statSync(patchedJarPath).size / 1024 / 1024).toFixed(1)} MB)`);
                resolve();
            } else {
                log(`[FORGE PATCH] FAILED (code ${code})`);
                if (stdout) log(`[FORGE PATCH] stdout: ${stdout}`);
                if (stderr) log(`[FORGE PATCH] stderr: ${stderr}`);
                reject(new Error(`binarypatcher exited with code ${code}`));
            }
        });
        proc.on('error', reject);
    });

    try { fs.unlinkSync(lzmaPath); } catch (_) {}
    try { fs.rmdirSync(tempDir); } catch (_) {}
}

async function buildModernForgeProfile({ soulPath, versionsPath, librariesPath, mcVersion, forgeBuild, forgeInstallerPath, patchedJarPath, log }) {
    const profileId = `forge-${forgeBuild}`;
    const versionDir = path.join(versionsPath, profileId);
    ensureDir(versionDir);

    const internalMcVersion = forgeBuild.split('-')[0];

    const [vanillaVersionJson, vanillaLibraries, forgeLibraries] = await Promise.all([
        fetchVanillaVersionJson(versionsPath, mcVersion, log),
        fetchVanillaLibraries(mcVersion, log),
        fetchForgeOwnLibraries(soulPath, forgeBuild, log)
    ]);

    const installerZip = new AdmZip(forgeInstallerPath);
    let versionJson = JSON.parse(installerZip.readAsText('version.json'));

    delete versionJson.inheritsFrom;
    versionJson.id = profileId;

    if (vanillaVersionJson) {
        if (!versionJson.assetIndex && vanillaVersionJson.assetIndex) {
            versionJson.assetIndex = vanillaVersionJson.assetIndex;
        }
        if (!versionJson.assets && vanillaVersionJson.assets) {
            versionJson.assets = vanillaVersionJson.assets;
        }
    }

    // Copy the patched client jar to its Maven path in libraries
    const clientLibRelPath = `net/minecraftforge/forge/${forgeBuild}/forge-${forgeBuild}-client.jar`;
    const clientLibAbsPath = path.join(librariesPath, clientLibRelPath.split('/').join(path.sep));
    ensureDir(path.dirname(clientLibAbsPath));
    fs.copyFileSync(patchedJarPath, clientLibAbsPath);
    const clientJarSize = fs.statSync(clientLibAbsPath).size;
    const clientJarSha1 = sha1File(clientLibAbsPath);

    // Copy the universal jar from installer to its library path
    const univEntry = installerZip.getEntry(`maven/net/minecraftforge/forge/${forgeBuild}/forge-${forgeBuild}-universal.jar`);
    const univLibRelPath = `net/minecraftforge/forge/${forgeBuild}/forge-${forgeBuild}-universal.jar`;
    const univLibAbsPath = path.join(librariesPath, univLibRelPath.split('/').join(path.sep));
    ensureDir(path.dirname(univLibAbsPath));
    if (univEntry) {
        fs.writeFileSync(univLibAbsPath, installerZip.readFile(univEntry));
    } else {
        // Try downloading from maven
        const mavenUrl = `${FORGE_MAVEN}/${forgeBuild}/forge-${forgeBuild}-universal.jar`;
        await downloadFileWithFallback(mavenUrl, univLibAbsPath, log);
    }
    const univJarSize = fs.statSync(univLibAbsPath).size;
    const univJarSha1 = sha1File(univLibAbsPath);

    let libraries = versionJson.libraries || [];

    // Fix forge client jar entry: fill in real path/size/sha1 since we just created it
    libraries = libraries.map(lib => {
        const n = String(lib?.name || '');
        if (n === `net.minecraftforge:forge:${forgeBuild}:client`) {
            return {
                ...lib,
                downloads: {
                    artifact: {
                        path: clientLibRelPath,
                        url: `${FORGE_MAVEN}/${forgeBuild}/forge-${forgeBuild}-client.jar`,
                        sha1: clientJarSha1,
                        size: clientJarSize
                    }
                }
            };
        }
        if (n === `net.minecraftforge:forge:${forgeBuild}:universal`) {
            return {
                ...lib,
                downloads: {
                    artifact: {
                        path: univLibRelPath,
                        url: `${FORGE_MAVEN}/${forgeBuild}/forge-${forgeBuild}-universal.jar`,
                        sha1: univJarSha1,
                        size: univJarSize
                    }
                }
            };
        }
        return lib;
    });

    // Merge vanilla libraries
    libraries = mergeLibraries(libraries, vanillaLibraries, log, `vanilla ${mcVersion} libraries`);

    // Merge forge installer libraries (includes forge:shim, forge:universal, installer tools, etc.)
    // Authoritative mode: forge entries replace any previous entries with the same group:artifact
    libraries = mergeLibraries(libraries, forgeLibraries, log, 'Forge-specific libraries', 'authoritative');

    // Parse the shim jar's bootstrap-shim.list to discover forge runtime modules
    const shimListPath = path.join(librariesPath, 'net', 'minecraftforge', 'forge', forgeBuild, `forge-${forgeBuild}-shim.jar`);
    if (fs.existsSync(shimListPath)) {
        try {
            const shimZip = new AdmZip(shimListPath);
            const listContent = shimZip.readAsText('bootstrap-shim.list');
            const shimLibraries = listContent.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const parts = line.split('\t');
                    if (parts.length < 3) return null;
                    const [, coord, relPath] = parts;
                    const coordParts = coord.split(':');
                    if (coordParts.length < 3) return null;
                    const [group, artifact, version] = coordParts;
                    const classifier = coordParts[3];
                    const name = classifier ? `${group}:${artifact}:${version}:${classifier}` : `${group}:${artifact}:${version}`;
                    const urlHost = group === 'net.minecraftforge' ? FORGE_MAVEN : LIBRARIES_NET;
                    return {
                        name,
                        downloads: {
                            artifact: {
                                path: relPath,
                                url: `${urlHost}/${relPath}`,
                                sha1: '',
                                size: 0
                            }
                        }
                    };
                })
                .filter(l => l && l.name !== `net.minecraftforge:forge:${forgeBuild}:client` && l.name !== `net.minecraftforge:forge:${forgeBuild}:universal`);
            libraries = mergeLibraries(libraries, shimLibraries, log, 'forge bootstrap-shim libraries', 'fill-gaps');
            log(`[FORGE] Added ${shimLibraries.length} forge module libraries from bootstrap-shim.list`);
        } catch (e) {
            log(`[WARNING] Could not parse bootstrap-shim.list: ${e.message}`);
        }
    } else {
        log(`[FORGE] Shim jar not found at ${shimListPath} — forge module libraries may be incomplete`);
    }

    // Ensure forge:shim, forge:client, forge:universal are all present with valid URLs
    const forgeEntries = [
        { classifier: 'client', path: clientLibRelPath, size: clientJarSize, sha1: clientJarSha1 },
        { classifier: 'shim', path: `net/minecraftforge/forge/${forgeBuild}/forge-${forgeBuild}-shim.jar`, size: 0, sha1: '' },
        { classifier: 'universal', path: univLibRelPath, size: univJarSize, sha1: univJarSha1 }
    ];
    for (const fe of forgeEntries) {
        const existing = libraries.some(l => String(l?.name || '') === `net.minecraftforge:forge:${forgeBuild}:${fe.classifier}`);
        if (!existing) {
            libraries.push({
                name: `net.minecraftforge:forge:${forgeBuild}:${fe.classifier}`,
                downloads: {
                    artifact: {
                        path: fe.path,
                        url: `${FORGE_MAVEN}/${forgeBuild}/forge-${forgeBuild}-${fe.classifier}.jar`,
                        sha1: fe.sha1,
                        size: fe.size
                    }
                }
            });
        }
    }

    versionJson.libraries = libraries;

    // MCLC's getModifyJson() reads <root>/versions/<custom>/<custom>.json
    const jsonPath = path.join(versionDir, `${profileId}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(versionJson, null, 2));
    // MCLC's getVersion() reads <directory>/<version.number>.json (mcVersion)
    const versionNumberJsonPath = path.join(versionDir, `${mcVersion}.json`);
    fs.writeFileSync(versionNumberJsonPath, JSON.stringify(versionJson, null, 2));
    // Also write <internalMcVersion>.json for downstream tools that expect it
    const internalVersionJsonPath = path.join(versionDir, `${internalMcVersion}.json`);
    fs.writeFileSync(internalVersionJsonPath, JSON.stringify(versionJson, null, 2));
    log(`[FORGE] Modern profile ready: ${profileId} (${libraries.length} libraries total)`);

    const { ok, failed } = await verifyLibrariesOnDisk(libraries, librariesPath, log);
    const failedLibs = failed.map(f => f.name);

    if (!ok) {
        log(`[FORGE] WARNING: ${failedLibs.length} modern forge libraries could not be verified: ${failedLibs.join(', ')}`);
    }

    return { profileId, versionDir, versionJson, failedLibs };
}

async function launchForge(opts, log = noop, onProgress = noop) {
    const {
        soulPath,
        instanceRoot,
        versionsPath,
        librariesPath,
        nativesPath,
        gameDirectory,
        mcVersion,
        forgeBuild: requestedBuild = null,
        auth,
        javaPath,
        memoryGb = 4,
        resolution = {},
        extraJvmArgs = []
    } = opts;

    if (!soulPath) throw new Error('forge-core: soulPath is required.');
    if (!mcVersion) throw new Error('forge-core: mcVersion is required.');
    if (!javaPath) throw new Error('forge-core: javaPath is required.');
    if (!fs.existsSync(javaPath)) throw new Error(`forge-core: Java not found at ${javaPath}`);

    // Per-instance isolation: each instance gets its own versions/libraries/
    // natives so two different MC versions/Forge builds never collide.
    // Falls back to the old shared global paths if a caller doesn't pass them.
    const resolvedVersionsPath = versionsPath || path.join(soulPath, 'versions');
    const resolvedLibrariesPath = librariesPath || path.join(soulPath, 'libraries');
    const resolvedNativesPath = nativesPath || path.join(soulPath, 'natives');
    ensureDir(resolvedVersionsPath);
    ensureDir(resolvedLibrariesPath);
    ensureDir(resolvedNativesPath);

    // MCLC's getClasses() resolves custom-profile JSON and ALL library jars
    // as <root>/versions/<custom>/<custom>.json and <root>/libraries/... —
    // it does NOT consult overrides.versionRoot/libraryRoot for those lookups.
    // So "root" must BE the per-instance folder when one is provided, or the
    // profile/libraries we just wrote into the per-instance folders above
    // will be invisible to MCLC and launch() will fail.
    const mclcRoot = instanceRoot || soulPath;

    ensureDir(gameDirectory || path.join(resolvedVersionsPath, mcVersion));

    log(`[FORGE] Resolving Forge build for Minecraft ${mcVersion}...`);
    const forgeBuild = await resolveForgeBuild(mcVersion, requestedBuild, log);
    if (!forgeBuild) {
        throw new Error(`No Forge build found for Minecraft ${mcVersion}.`);
    }
    log(`[FORGE] Using Forge build: ${forgeBuild}`);

    const legacy = !isModernMc(mcVersion);
    let versionObj = { number: mcVersion, type: 'release' };
    let overridesDirectory = null;
    let forgeInstallerPath = null;
    let patchedClientOverridePath = null;

    if (legacy) {
        const universalJarPath = await downloadForgeJar(soulPath, forgeBuild, 'universal', log);
        const { profileId, versionDir, failedLibs } = await buildLegacyForgeProfile({
            soulPath,
            versionsPath: resolvedVersionsPath,
            librariesPath: resolvedLibrariesPath,
            mcVersion, forgeBuild, forgeJarPath: universalJarPath, log
        });

        // HARD GATE: do not spawn Java with a classpath we already know is
        // incomplete. This is what turns "game launches, then dies 2 seconds
        // later inside FML with a cryptic NoClassDefFoundError" into an
        // immediate, actionable failure naming the exact missing jar(s) and
        // where forge-core tried (and failed) to fetch them from - instead
        // of a stack trace from deep inside someone else's Java code.
        if (failedLibs && failedLibs.length) {
            const detail = failedLibs.join(', ');
            log(`[FORGE] ABORTING LAUNCH: ${failedLibs.length} required librar${failedLibs.length === 1 ? 'y' : 'ies'} could not be verified on disk: ${detail}`);
            throw new Error(
                `forge-core: refusing to launch with missing libraries (${detail}). ` +
                'These could not be downloaded - check network/firewall settings or see the [FORGE VERIFY] log lines above for the URLs that were tried.'
            );
        }

        versionObj.custom = profileId;
        // THE FIX: point MCLC's getVersion() at the folder with our Forge profile
        overridesDirectory = versionDir;
    } else {
        forgeInstallerPath = await downloadForgeJar(soulPath, forgeBuild, 'installer', log);
        log(`[FORGE] Modern Forge installer ready: ${forgeInstallerPath}`);

        // Check if Forge uses its own bootstrap (mainClass includes net.minecraftforge.bootstrap)
        // If so, MCLC's ForgeWrapper path is skipped, and the patched client jar (with
        // .forge_patched_minecraft) is never created. We must run the binary patcher ourselves.
        let needsClientPatching = false;
        try {
            const zip = new AdmZip(forgeInstallerPath);
            const vj = JSON.parse(zip.readAsText('version.json'));
            if (String(vj.mainClass || '').includes('net.minecraftforge.bootstrap')) {
                needsClientPatching = true;
                log(`[FORGE] Forge uses own bootstrap (${vj.mainClass}) — will patch client jar manually.`);
            }
        } catch (_) {}

        if (needsClientPatching) {
            log(`[FORGE] Entering client patching block for ${forgeBuild}...`);
            const internalMcVersion = forgeBuild.split('-')[0];

            // Ensure vanilla jar exists at the Maven path the patcher expects
            const vanillaMavenPath = path.join(resolvedLibrariesPath, 'net', 'minecraft', 'client', internalMcVersion, `client-${internalMcVersion}.jar`);
            log(`[FORGE] Checking vanilla jar at Maven path: ${vanillaMavenPath}`);
            if (!fs.existsSync(vanillaMavenPath) || fs.statSync(vanillaMavenPath).size === 0) {
                const versionsJarPath = path.join(resolvedVersionsPath, mcVersion, `${mcVersion}.jar`);
                log(`[FORGE] Versions jar path: ${versionsJarPath}, exists: ${fs.existsSync(versionsJarPath)}`);
                if (fs.existsSync(versionsJarPath) && fs.statSync(versionsJarPath).size > 0) {
                    ensureDir(path.dirname(vanillaMavenPath));
                    fs.copyFileSync(versionsJarPath, vanillaMavenPath);
                    log(`[FORGE] Copied vanilla jar from versions to Maven path: ${vanillaMavenPath}`);
                } else {
                    const vanillaVersionJson = await fetchVanillaVersionJson(versionsPath || soulPath, mcVersion, log);
                    const vanillaJarUrl = vanillaVersionJson?.downloads?.client?.url;
                    if (vanillaJarUrl) {
                        ensureDir(path.dirname(vanillaMavenPath));
                        await downloadFile(vanillaJarUrl, vanillaMavenPath);
                        log(`[FORGE] Downloaded vanilla jar to Maven path: ${vanillaMavenPath}`);
                    } else {
                        log(`[FORGE WARN] Cannot find vanilla client jar for ${mcVersion}. Skipping patching.`);
                        needsClientPatching = false;
                    }
                }
            } else {
                log(`[FORGE] Vanilla jar already at Maven path.`);
            }

            if (needsClientPatching) {
                const patchedClientPath = path.join(resolvedLibrariesPath, 'net', 'minecraftforge', 'forge', forgeBuild, `forge-${forgeBuild}-client.jar`);
                patchedClientOverridePath = patchedClientPath;
                log(`[FORGE] Patched client jar path: ${patchedClientPath}, java exists: ${fs.existsSync(javaPath)}`);

                if (!fs.existsSync(patchedClientPath) || fs.statSync(patchedClientPath).size === 0) {
                    if (fs.existsSync(javaPath)) {
                        await runForgeClientPatcher({ javaPath, librariesPath: resolvedLibrariesPath, forgeInstallerPath, vanillaJarPath: vanillaMavenPath, patchedJarPath: patchedClientPath, log });
                    } else {
                        log(`[FORGE WARN] Java ${javaPath} not found. Skipping patcher.`);
                        needsClientPatching = false;
                    }
                } else {
                    log(`[FORGE] Patched client jar already exists, skipping patcher.`);
                }
            }

            if (needsClientPatching) {
                const { profileId, versionDir, failedLibs } = await buildModernForgeProfile({
                    soulPath, versionsPath: resolvedVersionsPath, librariesPath: resolvedLibrariesPath,
                    mcVersion, forgeBuild, forgeInstallerPath, patchedJarPath: patchedClientPath, log
                });

                if (failedLibs && failedLibs.length) {
                    const detail = failedLibs.join(', ');
                    log(`[FORGE] ABORTING LAUNCH: ${failedLibs.length} required librar${failedLibs.length === 1 ? 'y' : 'ies'} could not be verified on disk: ${detail}`);
                    throw new Error(`forge-core: refusing to launch with missing libraries (${detail}).`);
                }

                versionObj.custom = profileId;
                overridesDirectory = versionDir;
                forgeInstallerPath = null;
            }
        }

        log(`[FORGE] Modern Forge setup complete.`);
    }

    const memVal = parseFloat(memoryGb) || 4;
    const launchOpts = {
        authorization: auth,
        root: mclcRoot,
        version: versionObj,
        forge: forgeInstallerPath || undefined,
        memory: {
            max: `${memVal}G`,
            min: `${Math.min(memVal, 2)}G`
        },
        overrides: {
            assetRoot: path.join(soulPath, 'assets'),
            natives: resolvedNativesPath,
            gameDirectory: gameDirectory || mclcRoot,
            ...(patchedClientOverridePath ? { minecraftJar: patchedClientOverridePath } : {}),
            ...(overridesDirectory ? { directory: overridesDirectory } : {})
        },
        window: resolution.fullscreen
            ? { fullscreen: true }
            : { width: resolution.width || 1280, height: resolution.height || 720 },
        javaPath,
        concurrentFileWrites: 8,
        downloadFileMultiple: 8,
        checkHash: true,
        customArgs: extraJvmArgs.length > 0 ? extraJvmArgs : undefined
    };

    const launcher = new Client();
    launcher.on('debug', (e) => log(`[DEBUG] ${e}`));
    launcher.on('data', (e) => log(String(e)));
    launcher.on('progress', (e) => {
        const pct = e.total > 0 ? Math.round((e.task / e.total) * 100) : 0;
        const labels = {
            assets: 'Checking assets',
            classes: 'Checking libraries',
            'classes-custom': 'Checking loader files',
            natives: 'Preparing natives',
            forge: 'Preparing Forge'
        };
        onProgress({ pct, msg: `${labels[e.type] || `Processing ${e.type}`}: ${e.task} / ${e.total} files (${pct}%)` });
    });

    log('[FORGE] Executing launcher.launch()...');
    const proc = await launcher.launch(launchOpts);

    if (!proc) {
        throw new Error(
            'launcher.launch() returned no process. ' +
            `Profile: ${versionObj.custom || versionObj.number}, ` +
            `directory override: ${overridesDirectory || '(default)'}, ` +
            'check the [DEBUG]/[MCLC] log lines above for the actual cause.'
        );
    }

    log(`[FORGE] Game process started (PID: ${proc.pid})`);
    return proc;
}

module.exports = {
    launchForge,
    resolveForgeBuild,
    downloadForgeJar,
    isModernMc,
    verifyLibrariesOnDisk
};
