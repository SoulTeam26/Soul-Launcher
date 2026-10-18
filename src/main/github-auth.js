/**
 * GitHub auth for private Soul repos (launcher updates, cape/mod downloads).
 * Token source (first non-empty wins):
 *   1. electron-store key "githubPat" (paste once in launcher settings)
 *   2. env GH_TOKEN / SOUL_GITHUB_TOKEN
 * Read-only use: listing + downloading. Never logged, never sent off-GitHub.
 */
const store = require('./store');

const GITHUB_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'api.github.com',
  'objects.githubusercontent.com'
]);

function getToken() {
  try {
    const fromStore = store.get('githubPat');
    if (fromStore && String(fromStore).trim()) return String(fromStore).trim();
  } catch (_) {}
  const env = process.env.SOUL_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (env && String(env).trim()) return String(env).trim();
  return '';
}

function isGitHubUrl(url) {
  try {
    return GITHUB_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch (_) {
    return false;
  }
}

/** Extra axios headers for a URL ({} when no token or non-GitHub host). */
function authHeadersFor(url) {
  if (!isGitHubUrl(url)) return {};
  const token = getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * electron-updater reads GH_TOKEN automatically for private release repos.
 * Call once at startup before any update check.
 */
function applyUpdaterToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const token = getToken();
  if (token) process.env.GH_TOKEN = token;
  return token || '';
}

module.exports = { getToken, isGitHubUrl, authHeadersFor, applyUpdaterToken };
