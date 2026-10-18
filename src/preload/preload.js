/**
 * SOUL LAUNCHER - PRELOAD SCRIPT
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soul', {
  // WINDOW CONTROLS
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),

  // SETTINGS MANAGEMENT
  getSetting:    (key)        => ipcRenderer.invoke('get-setting', key),
  setSetting:    (key, value) => ipcRenderer.invoke('set-setting', key, value),
  getAllSettings: ()           => ipcRenderer.invoke('get-all-settings'),
  msLogin:        ()           => ipcRenderer.invoke('ms-login'),

  // INSTANCE MANAGEMENT
  getInstances:  ()        => ipcRenderer.invoke('get-instances'),
  createInstance: (config)  => ipcRenderer.invoke('create-instance', config),
  setInstanceIcon: (name, sourcePath) => ipcRenderer.invoke('set-instance-icon', name, sourcePath),
  renameInstance: (oldName, newName) => ipcRenderer.invoke('rename-instance', oldName, newName),
  deleteInstance: (name)    => ipcRenderer.invoke('delete-instance', name),
  getInstanceJavaChoice: (name) => ipcRenderer.invoke('get-instance-java-choice', name),
  setInstanceJavaChoice: (name, choice) => ipcRenderer.invoke('set-instance-java-choice', name, choice),
  setInstanceConfigField: (name, field, value) => ipcRenderer.invoke('set-instance-config-field', name, field, value),

  // INSTANCE FILE MANAGER
  listInstanceFiles:        (name, relPath)            => ipcRenderer.invoke('list-instance-files', name, relPath || ''),
  readInstanceFile:         (name, relPath)            => ipcRenderer.invoke('read-instance-file', name, relPath || ''),
  openInstancePath:         (name, relPath)            => ipcRenderer.invoke('open-instance-path', name, relPath || ''),
  showInstancePathInFolder: (name, relPath)            => ipcRenderer.invoke('show-instance-path-in-folder', name, relPath || ''),
  deleteInstancePath:       (name, relPath)            => ipcRenderer.invoke('delete-instance-path', name, relPath || ''),
  createInstanceFolder:     (name, relPath, folder)    => ipcRenderer.invoke('create-instance-folder', name, relPath || '', folder),
  createInstanceFile:       (name, relPath, file)      => ipcRenderer.invoke('create-instance-file', name, relPath || '', file),
  renameInstancePath:       (name, relPath, newName)   => ipcRenderer.invoke('rename-instance-path', name, relPath || '', newName),
  importFilesToInstance:    (name, relPath)            => ipcRenderer.invoke('import-files-to-instance', name, relPath || ''),

  openInstanceFolder: (name) => ipcRenderer.invoke('open-instance-folder', name),
  duplicateInstance: (src, dest) => ipcRenderer.invoke('duplicate-instance', src, dest),
  backupInstance: (name) => ipcRenderer.invoke('backup-instance', name),
  listBackups: () => ipcRenderer.invoke('list-backups'),
  deleteBackup: (file) => ipcRenderer.invoke('delete-backup', file),
  restoreBackup: (file, targetName) => ipcRenderer.invoke('restore-backup', file, targetName),
  restoreBackupFile: (targetName) => ipcRenderer.invoke('restore-backup-file', targetName),
  setInstanceTags: (name, tags) => ipcRenderer.invoke('set-instance-tags', name, tags),
  setInstanceGroup: (name, group) => ipcRenderer.invoke('set-instance-group', name, group),
  getInstanceGroups: () => ipcRenderer.invoke('get-instance-groups'),
  exportMrpack: (name) => ipcRenderer.invoke('export-mrpack', name),
  exportInstanceZip: (name) => ipcRenderer.invoke('export-instance-zip', name),
  importInstancePack: () => ipcRenderer.invoke('import-instance-pack'),
  getMcVersions:  ()        => ipcRenderer.invoke('get-mc-versions'),
  getFabricVersions: ()     => ipcRenderer.invoke('get-fabric-versions'),
  getForgeVersions: ()      => ipcRenderer.invoke('get-forge-versions'),
  setupFolders:   ()        => ipcRenderer.invoke('setup-folders'),

  // MOD MANAGEMENT
  getMods:   (instanceName) => ipcRenderer.invoke('get-mods', instanceName),
  toggleMod: (instanceName, modName, state) => ipcRenderer.invoke('toggle-mod', instanceName, modName, state),
  addMod:    (instanceName) => ipcRenderer.invoke('add-mod', instanceName),
  checkModUpdate: (instanceName, modName, loader, gameVersion) => ipcRenderer.invoke('check-mod-update', instanceName, modName, loader, gameVersion),
  getModUpdates: (instanceName, loader, gameVersion) => ipcRenderer.invoke('get-mod-updates', instanceName, loader, gameVersion),
  getModProfiles: (instanceName) => ipcRenderer.invoke('get-mod-profiles', instanceName),
  saveModProfile: (instanceName, profileName) => ipcRenderer.invoke('save-mod-profile', instanceName, profileName),
  applyModProfile: (instanceName, profileName) => ipcRenderer.invoke('apply-mod-profile', instanceName, profileName),
  analyzeModCrash: (instanceName, log) => ipcRenderer.invoke('analyze-mod-crash', instanceName, log),
  scanInstanceCrashes: (instanceName) => ipcRenderer.invoke('scan-instance-crashes', instanceName),
  deleteMod: (instanceName, modName) => ipcRenderer.invoke('delete-mod', instanceName, modName),
  copyFileToInstance: (instanceName, sourcePath, subfolder) => ipcRenderer.invoke('copy-file-to-instance', instanceName, sourcePath, subfolder),
  downloadUrlToInstance: (url, instanceName, subfolder, filename) => ipcRenderer.invoke('download-url-to-instance', url, instanceName, subfolder, filename),
  soulclientDownloadDeps: (instanceName, gameVersion) => ipcRenderer.invoke('soulclient-download-deps', instanceName, gameVersion),

  // RESOURCE PACK MANAGEMENT
  getResourcePacks:   (instanceName) => ipcRenderer.invoke('get-resourcepacks', instanceName),
  toggleResourcePack: (instanceName, packName, state) => ipcRenderer.invoke('toggle-resourcepack', instanceName, packName, state),
  addResourcePack:    (instanceName) => ipcRenderer.invoke('add-resourcepack', instanceName),
  deleteResourcePack: (instanceName, packName) => ipcRenderer.invoke('delete-resourcepack', instanceName, packName),
  setResourcePackOrder: (instanceName, orderedNames) => ipcRenderer.invoke('set-resourcepack-order', instanceName, orderedNames),

  // SHADERPACK MANAGEMENT
  getShaderpacks:   (instanceName) => ipcRenderer.invoke('get-shaderpacks', instanceName),
  toggleShaderpack: (instanceName, packName, state) => ipcRenderer.invoke('toggle-shaderpack', instanceName, packName, state),
  addShaderpack:    (instanceName) => ipcRenderer.invoke('add-shaderpack', instanceName),
  deleteShaderpack: (instanceName, packName) => ipcRenderer.invoke('delete-shaderpack', instanceName, packName),

  // WORLD + DATAPACK MANAGEMENT
  getWorlds:      (instanceName) => ipcRenderer.invoke('get-worlds', instanceName),
  deleteWorld:    (instanceName, worldName) => ipcRenderer.invoke('delete-world', instanceName, worldName),
  getDatapacks:   (instanceName, worldName) => ipcRenderer.invoke('get-datapacks', instanceName, worldName),
  toggleDatapack: (instanceName, worldName, packName, state) => ipcRenderer.invoke('toggle-datapack', instanceName, worldName, packName, state),
  addDatapack:    (instanceName, worldName) => ipcRenderer.invoke('add-datapack', instanceName, worldName),
  deleteDatapack: (instanceName, worldName, packName) => ipcRenderer.invoke('delete-datapack', instanceName, worldName, packName),

  // PER-INSTANCE LAUNCH SETTINGS
  getInstanceLaunchSettings: (name) => ipcRenderer.invoke('get-instance-launch-settings', name),
  setInstanceLaunchSettings: (name, patch) => ipcRenderer.invoke('set-instance-launch-settings', name, patch),
  getJvmPresets: () => ipcRenderer.invoke('get-jvm-presets'),
  previewLaunchCommand: (options) => ipcRenderer.invoke('preview-launch-command', options),

  // MODRINTH API
  searchModrinth: (query, type, version, loader, offset, limit, sort) => ipcRenderer.invoke('search-modrinth', query, type, version, loader, offset, limit, sort),
  getModrinthVersions: (projectId, loader, gameVersion) => ipcRenderer.invoke('get-modrinth-versions', projectId, loader, gameVersion),
  getModrinthProject: (projectId) => ipcRenderer.invoke('get-modrinth-project', projectId),
  getModrinthDependencies: (projectId) => ipcRenderer.invoke('get-modrinth-dependencies', projectId),
  installModrinthWithDependencies: (instanceName, versionId, type, force) => ipcRenderer.invoke('install-modrinth-with-dependencies', instanceName, versionId, type, force),
  downloadModrinth: (url, instanceName, type, filename) => ipcRenderer.invoke('download-modrinth', url, instanceName, type, filename),

  // JAVA MANAGEMENT
  detectJava: () => ipcRenderer.invoke('detect-java'),
  downloadJava:    (version) => ipcRenderer.invoke('download-java', version),
  downloadAllJava: ()        => ipcRenderer.invoke('download-all-java'),
  getJavaStatus:   ()        => ipcRenderer.invoke('get-java-status'),
  onJavaAllProgress: (cb)    => ipcRenderer.on('java-all-progress', (_, data) => cb(data)),
  onJavaLog:         (cb)    => ipcRenderer.on('java-log', (_, data) => cb(data)),
  installModpack: (url, packName, versionLabel) => ipcRenderer.invoke('install-modpack', url, packName, versionLabel),
  onModpackLog: (cb) => ipcRenderer.on('modpack-log', (_, msg) => cb(msg)),

  selectFile:     (filters) => ipcRenderer.invoke('select-file', filters),

  // DISCORD RPC
  setRPC: (details, state) => ipcRenderer.invoke('set-rpc', details, state),

  // SYSTEM INFO
  getSysInfo: () => ipcRenderer.invoke('get-sys-info'),

  // LAUNCH LIFECYCLE
  startLaunch:      ()        => ipcRenderer.invoke('start-launch'),
  launchGame:       (options) => ipcRenderer.invoke('launch-game', options),
  stopGame:         ()        => ipcRenderer.invoke('stop-game'),
  onLaunchProgress: (cb)      => ipcRenderer.on('launch-progress', (_, data) => cb(data)),
  onLaunchLog:      (cb)      => ipcRenderer.on('launch-log', (_, data) => cb(data)),
  onLaunchError:    (cb)      => ipcRenderer.on('launch-error', (_, data) => cb(data)),
  onLaunchFinished: (cb)      => ipcRenderer.on('launch-finished', () => cb()),
  removeLaunchListeners: ()   => {
    ipcRenderer.removeAllListeners('launch-progress');
    ipcRenderer.removeAllListeners('launch-log');
    ipcRenderer.removeAllListeners('launch-error');
    ipcRenderer.removeAllListeners('launch-finished');
  },
  
  // EXTERNAL UTILITIES
  openExternal:   (url) => ipcRenderer.invoke('open-external', url),
  hideWindow:     ()    => ipcRenderer.invoke('hide-window'),
  showWindow:     ()    => ipcRenderer.invoke('show-window'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  clearData: () => ipcRenderer.invoke('clear-data'),

  // AUTO-UPDATER
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_, data) => cb(data)),
  openChangelog: () => ipcRenderer.invoke('open-changelog'),
  readUpdateNotes: () => ipcRenderer.invoke('read-update-notes'),

  // SKIN MANAGEMENT
  saveSkin: (buffer, name) => ipcRenderer.invoke('save-skin', buffer, name),
  saveCape: (buffer, name) => ipcRenderer.invoke('save-cape', buffer, name),
  getSkins: () => ipcRenderer.invoke('get-skins'),
  getCapes: () => ipcRenderer.invoke('get-capes'),
  getSkinPath: (name) => ipcRenderer.invoke('get-skin-path', name),
  getCapePath: (name) => ipcRenderer.invoke('get-cape-path', name),
  deleteSkin: (name) => ipcRenderer.invoke('delete-skin', name),
  deleteCape: (name) => ipcRenderer.invoke('delete-cape', name),
  deleteAllSkins: () => ipcRenderer.invoke('delete-all-skins'),
  deleteAllCapes: () => ipcRenderer.invoke('delete-all-capes'),
  applySkin: (instanceName, username, skinName, capeName, model, elytraName) => ipcRenderer.invoke('apply-skin', instanceName, username, skinName, capeName, model, elytraName),
  saveElytra: (buffer, name) => ipcRenderer.invoke('save-elytra', buffer, name),
  downloadSkinName: (playerName) => ipcRenderer.invoke('download-skin-name', playerName),
  getElytras: () => ipcRenderer.invoke('get-elytras'),
  getElytraPath: (name) => ipcRenderer.invoke('get-elytra-path', name),
  deleteElytra: (name) => ipcRenderer.invoke('delete-elytra', name),
  deleteAllElytras: () => ipcRenderer.invoke('delete-all-elytras'),
  uploadSkinMojang: (skinName, variant) => ipcRenderer.invoke('upload-skin-mojang', skinName, variant),

  // BACKGROUND MANAGEMENT
  getCustomBackgrounds: () => ipcRenderer.invoke('get-custom-backgrounds'),
  getBackgroundPath: (name) => ipcRenderer.invoke('get-background-path', name),
  uploadBackground: (sourcePath) => ipcRenderer.invoke('upload-background', sourcePath),
  deleteBackground: (name) => ipcRenderer.invoke('delete-background', name),
  });
