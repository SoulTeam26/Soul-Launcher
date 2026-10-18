const Store = require('electron-store');

const store = new Store({
  name: 'soul-settings',
  defaults: {
    windowBounds: { width: 1280, height: 850 },
    lastVersion: null,
    autoLaunch: false,
    theme: 'blue',
    language: 'en',
    accounts: [],
    currentAccount: null,
    ram: 4, // 4GB default
    debugMode: false,
    termsAccepted: false,
    snowParticles: true,
    animations: true
  }
});

module.exports = store;
