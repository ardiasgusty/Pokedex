/**
 * PokeBinder Tracker - Interactive 9-Pocket Online Binder with Encrypted GitHub Sync
 */

const STORAGE_KEY = 'pokebinder_user_cards_v1';
const GITHUB_SETTINGS_KEY = 'pokebinder_gh_encrypted_config_v1';
const TOTAL_POKEMON = 1025;
const CARDS_PER_PAGE = 9;
const TOTAL_PAGES = Math.ceil(TOTAL_POKEMON / CARDS_PER_PAGE); // 114 pages

// Generations metadata for easy filtering during hunting/shopping
const GENERATIONS = [
  { gen: 1, start: 1, end: 151, name: 'Gen 1 (Kanto)' },
  { gen: 2, start: 152, end: 251, name: 'Gen 2 (Johto)' },
  { gen: 3, start: 252, end: 386, name: 'Gen 3 (Hoenn)' },
  { gen: 4, start: 387, end: 493, name: 'Gen 4 (Sinnoh)' },
  { gen: 5, start: 494, end: 649, name: 'Gen 5 (Unova)' },
  { gen: 6, start: 650, end: 721, name: 'Gen 6 (Kalos)' },
  { gen: 7, start: 722, end: 809, name: 'Gen 7 (Alola)' },
  { gen: 8, start: 810, end: 905, name: 'Gen 8 (Galar/Hisui)' },
  { gen: 9, start: 906, end: 1025, name: 'Gen 9 (Paldea)' }
];

// App State
let appState = {
  currentPage: 1,
  filterMode: 'all', // 'all', 'missing', 'owned'
  ownedCards: {}, // Map: { [pokedexId]: { id, name, sprite, types, dateAdded } }
  cachePokeInfo: {}, // In-memory cache for fast slot previews
  missingGenFilter: 'all',
  missingSearchQuery: '',
  githubConfig: {
    username: '',
    repo: 'Pokedex',
    branch: 'main',
    filepath: 'pokebinder_cards.json',
    token: ''
  },
  encryptionPass: 'pokebinder-vault-key-2026',
  currentFileSha: null, // GitHub API requires sha when updating existing file
  isGitHubConnected: false
};

// DOM Elements
const el = {
  pocketGrid: document.getElementById('pocket-grid'),
  currentPageDisplay: document.getElementById('current-page-display'),
  totalPagesDisplay: document.getElementById('total-pages-display'),
  pagePokedexRange: document.getElementById('page-pokedex-range'),
  sheetHeaderRange: document.getElementById('sheet-header-range'),
  
  // Stats
  statOwnedCount: document.getElementById('stat-owned-count'),
  statMissingCount: document.getElementById('stat-missing-count'),
  statHoloCount: document.getElementById('stat-holo-count'),
  statPercent: document.getElementById('stat-percent'),

  // Form
  addForm: document.getElementById('add-pokemon-form'),
  pokeIdInput: document.getElementById('poke-id-input'),
  pokeRaritySelect: document.getElementById('poke-rarity-select'),
  btnPreview: document.getElementById('btn-preview'),
  quickPreview: document.getElementById('quick-preview'),
  previewImg: document.getElementById('preview-img'),
  previewName: document.getElementById('preview-name'),
  previewTypes: document.getElementById('preview-types'),

  // Pagination buttons
  btnFirstPage: document.getElementById('btn-first-page'),
  btnPrevPage: document.getElementById('btn-prev-page'),
  btnNextPage: document.getElementById('btn-next-page'),
  btnLastPage: document.getElementById('btn-last-page'),
  jumpPageInput: document.getElementById('jump-page-input'),
  btnJump: document.getElementById('btn-jump'),

  // Filters
  filterButtons: document.querySelectorAll('.toggle-btn'),

  // JSON Export / Import
  btnExportJson: document.getElementById('btn-export-json'),
  btnImportJsonTrigger: document.getElementById('btn-import-json-trigger'),
  jsonFileInput: document.getElementById('json-file-input'),
  btnResetData: document.getElementById('btn-reset-data'),

  // Missing Modal
  missingModal: document.getElementById('missing-modal'),
  btnOpenMissingModal: document.getElementById('btn-open-missing-modal'),
  btnCloseMissingModal: document.getElementById('btn-close-missing-modal'),
  missingListContainer: document.getElementById('missing-list-container'),
  missingShownCount: document.getElementById('missing-shown-count'),
  genTabs: document.getElementById('gen-tabs'),
  searchMissingInput: document.getElementById('search-missing-input'),

  // Batch Modal
  batchModal: document.getElementById('batch-modal'),
  btnOpenBatchModal: document.getElementById('btn-open-batch-modal'),
  btnCloseBatchModal: document.getElementById('btn-close-batch-modal'),
  batchInputArea: document.getElementById('batch-input-area'),
  btnProcessBatch: document.getElementById('btn-process-batch'),
  batchStatusMsg: document.getElementById('batch-status-msg'),

  // GitHub Settings & Sync Modal
  settingsModal: document.getElementById('settings-modal'),
  btnOpenSettings: document.getElementById('btn-open-settings'),
  btnCloseSettingsModal: document.getElementById('btn-close-settings-modal'),
  githubSettingsForm: document.getElementById('github-settings-form'),
  ghUsername: document.getElementById('gh-username'),
  ghRepo: document.getElementById('gh-repo'),
  ghBranch: document.getElementById('gh-branch'),
  ghFilepath: document.getElementById('gh-filepath'),
  ghToken: document.getElementById('gh-token'),
  toggleTokenVisibility: document.getElementById('toggle-token-visibility'),
  ghEncryptionPass: document.getElementById('gh-encryption-pass'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  btnTestConnection: document.getElementById('btn-test-connection'),
  btnPullGithub: document.getElementById('btn-pull-github'),
  btnPushGithub: document.getElementById('btn-push-github'),
  btnExportSettingsJson: document.getElementById('btn-export-settings-json'),
  githubSyncIndicator: document.getElementById('github-sync-indicator'),
  githubStatusText: document.getElementById('github-status-text'),

  // Toast
  toast: document.getElementById('toast')
};

// ==========================================
// 🔒 Web Crypto API - Enkripsi & Dekripsi AES-GCM
// ==========================================
async function getKeyFromPassphrase(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(plainText, passphrase) {
  try {
    const enc = new TextEncoder();
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await getKeyFromPassphrase(passphrase, salt);

    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      enc.encode(plainText)
    );

    const packageData = {
      version: 1,
      salt: Array.from(salt),
      iv: Array.from(iv),
      cipher: Array.from(new Uint8Array(encrypted))
    };
    return JSON.stringify(packageData);
  } catch (err) {
    console.error('Enkripsi gagal:', err);
    throw err;
  }
}

async function decryptData(cipherPackageJson, passphrase) {
  try {
    const pkg = JSON.parse(cipherPackageJson);
    if (!pkg.salt || !pkg.iv || !pkg.cipher) {
      throw new Error('Format cipher tidak valid');
    }
    const salt = new Uint8Array(pkg.salt);
    const iv = new Uint8Array(pkg.iv);
    const cipherData = new Uint8Array(pkg.cipher);
    const key = await getKeyFromPassphrase(passphrase, salt);

    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      cipherData
    );

    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (err) {
    console.error('Dekripsi gagal (mungkin kunci salah):', err);
    throw err;
  }
}

// ==========================================
// 🐙 GitHub REST API Operations
// ==========================================
function updateGitHubSyncIndicator(status) {
  el.githubSyncIndicator.className = 'sync-dot ' + status;
  if (status === 'connected') {
    el.githubSyncIndicator.title = 'Terhubung ke GitHub (' + appState.githubConfig.repo + ')';
    el.githubStatusText.innerHTML = `<span style="color:#10b981;">✓ Terhubung ke ${appState.githubConfig.username}/${appState.githubConfig.repo} (${appState.githubConfig.branch})</span>`;
    appState.isGitHubConnected = true;
  } else if (status === 'syncing') {
    el.githubSyncIndicator.title = 'Sedang sinkronisasi...';
    el.githubStatusText.innerHTML = `<span style="color:#f59e0b;">⏳ Sedang memproses ke GitHub...</span>`;
  } else {
    el.githubSyncIndicator.title = 'Belum terhubung ke GitHub';
    el.githubStatusText.innerHTML = `<span style="color:#ef4444;">✕ Belum terhubung</span>`;
    appState.isGitHubConnected = false;
  }
}

async function testGitHubConnection() {
  const token = el.ghToken.value.trim() || appState.githubConfig.token;
  const username = el.ghUsername.value.trim() || appState.githubConfig.username;
  const repo = el.ghRepo.value.trim() || appState.githubConfig.repo;

  if (!token || !username || !repo) {
    alert('Harap isi Username (' + (username || 'kosong') + '), Nama Repo (' + (repo || 'kosong') + '), dan Token terlebih dahulu!');
    return false;
  }

  // Update in appState for immediate testing
  appState.githubConfig.username = username;
  appState.githubConfig.repo = repo;
  appState.githubConfig.token = token;

  updateGitHubSyncIndicator('syncing');
  el.githubStatusText.innerHTML = `<span style="color:#f59e0b;">⏳ Sedang menguji koneksi ke ${username}/${repo}...</span>`;

  try {
    const res = await fetch(`https://api.github.com/repos/${username}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (res.ok) {
      const repoData = await res.json();
      updateGitHubSyncIndicator('connected');
      el.githubStatusText.innerHTML = `<span style="color:#10b981;">✓ Terhubung ke ${repoData.full_name} (${repoData.default_branch || 'main'})!</span>`;
      showToast('✅ Berhasil terhubung ke repositori GitHub!');
      return true;
    } else {
      const err = await res.json().catch(() => ({}));
      updateGitHubSyncIndicator('not-connected');
      
      let diagMsg = `Gagal terhubung (HTTP ${res.status}): ${err.message || 'Unknown error'}\n\n`;
      if (res.status === 401) {
        diagMsg += '👉 Kemungkinan Token Expired atau salah copy. Pastikan token diawali "github_pat_" atau "ghp_".';
      } else if (res.status === 404) {
        diagMsg += `👉 Repositori "${username}/${repo}" tidak ditemukan atau token tidak memiliki izin ke repositori ini.\nPastikan nama repository dan username persis (case-sensitive) serta token memiliki akses "Repository access: All repositories" atau spesifik ke "${repo}".`;
      } else if (res.status === 403) {
        diagMsg += '👉 Token tidak memiliki permission yang cukup. Pastikan permissions "Contents: Read and write" sudah aktif.';
      }

      el.githubStatusText.innerHTML = `<span style="color:#ef4444;">✕ ${err.message || 'Gagal terhubung'} (HTTP ${res.status})</span>`;
      alert(diagMsg);
      return false;
    }
  } catch (e) {
    updateGitHubSyncIndicator('not-connected');
    el.githubStatusText.innerHTML = `<span style="color:#ef4444;">✕ Gagal koneksi: ${e.message}</span>`;
    alert('Koneksi ke GitHub API gagal (cek koneksi internet): ' + e.message);
    return false;
  }
}

// Pull data from GitHub file (pokebinder_cards.json)
async function pullDataFromGitHub(silent = false) {
  const { username, repo, branch, filepath, token } = appState.githubConfig;
  if (!token || !username || !repo) {
    if (!silent) alert('Silakan lengkapi pengaturan GitHub terlebih dahulu!');
    return false;
  }

  updateGitHubSyncIndicator('syncing');
  if (!silent) showToast('Sedang menarik data dari GitHub...');

  try {
    const url = `https://api.github.com/repos/${username}/${repo}/contents/${filepath}?ref=${branch}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (res.status === 404) {
      // File belum ada di repo, nanti bisa dibuat saat push
      appState.currentFileSha = null;
      updateGitHubSyncIndicator('connected');
      if (!silent) showToast('File belum ada di repo. Anda bisa Push untuk membuatnya.');
      return false;
    }

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    appState.currentFileSha = data.sha;

    // GitHub returns content in base64 UTF-8
    const decodedRaw = decodeURIComponent(escape(atob(data.content.replace(/\s/g, ''))));
    const jsonParsed = JSON.parse(decodedRaw);

    // Ambil object kartu (bisa berformat { owned: {...} } atau langsung map)
    const cards = jsonParsed.owned ? jsonParsed.owned : jsonParsed;
    if (typeof cards === 'object' && cards !== null) {
      appState.ownedCards = cards;
      saveDataToLocalStorage();
      updateStats();
      renderBinderPage();
      updateGitHubSyncIndicator('connected');
      if (!silent) showToast('✅ Berhasil menarik data terbaru dari GitHub!');
      return true;
    }
  } catch (err) {
    console.error('Error saat Pull dari GitHub:', err);
    updateGitHubSyncIndicator('not-connected');
    if (!silent) alert('Gagal menarik data dari GitHub: ' + err.message);
    return false;
  }
}

// Push data to GitHub file (pokebinder_cards.json)
async function pushDataToGitHub(silent = false) {
  const { username, repo, branch, filepath, token } = appState.githubConfig;
  if (!token || !username || !repo) {
    if (!silent) alert('Silakan lengkapi pengaturan GitHub terlebih dahulu!');
    return false;
  }

  updateGitHubSyncIndicator('syncing');
  if (!silent) showToast('Sedang menyimpan data ke GitHub...');

  try {
    // Pastikan SHA terbaru didapat terlebih dahulu
    const checkUrl = `https://api.github.com/repos/${username}/${repo}/contents/${filepath}?ref=${branch}`;
    const checkRes = await fetch(checkUrl, {
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (checkRes.ok) {
      const checkData = await checkRes.json();
      appState.currentFileSha = checkData.sha;
    } else {
      appState.currentFileSha = null;
    }

    // Format data JSON terstruktur
    const payloadObject = {
      lastUpdated: new Date().toISOString(),
      totalOwned: Object.keys(appState.ownedCards).length,
      owned: appState.ownedCards
    };

    const jsonString = JSON.stringify(payloadObject, null, 2);
    // Convert string to base64 properly with UTF-8
    const base64Content = btoa(unescape(encodeURIComponent(jsonString)));

    const bodyPayload = {
      message: `Update PokéBinder collection (${Object.keys(appState.ownedCards).length} cards)`,
      content: base64Content,
      branch: branch
    };

    if (appState.currentFileSha) {
      bodyPayload.sha = appState.currentFileSha;
    }

    const saveRes = await fetch(checkUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyPayload)
    });

    if (!saveRes.ok) {
      const errData = await saveRes.json();
      throw new Error(errData.message || `HTTP ${saveRes.status}`);
    }

    const result = await saveRes.json();
    appState.currentFileSha = result.content?.sha || null;
    updateGitHubSyncIndicator('connected');
    if (!silent) showToast('✅ Data Pokédex berhasil di-push ke GitHub!');
    return true;
  } catch (err) {
    console.error('Error saat Push ke GitHub:', err);
    updateGitHubSyncIndicator('not-connected');
    if (!silent) alert('Gagal menyimpan ke GitHub: ' + err.message);
    return false;
  }
}

// Simpan config GitHub dengan Enkripsi ke LocalStorage
async function saveEncryptedGitHubSettings() {
  const username = el.ghUsername.value.trim();
  const repo = el.ghRepo.value.trim();
  const branch = el.ghBranch.value.trim() || 'main';
  const filepath = el.ghFilepath.value.trim() || 'pokebinder_cards.json';
  const token = el.ghToken.value.trim();
  const pass = el.ghEncryptionPass.value;

  if (!username || !repo || !token) {
    alert('Username, Nama Repo, dan Token GitHub wajib diisi!');
    return false;
  }

  appState.githubConfig = { username, repo, branch, filepath, token };
  appState.encryptionPass = pass;

  const rawConfigString = JSON.stringify(appState.githubConfig);
  const cipherPackage = await encryptData(rawConfigString, pass);

  localStorage.setItem(GITHUB_SETTINGS_KEY, cipherPackage);
  showToast('🔒 Pengaturan & Token GitHub berhasil dienkripsi dan disimpan!');
  
  // Test connection directly
  await testGitHubConnection();
  return true;
}

// Muat config GitHub dari LocalStorage (Dekripsi)
async function loadEncryptedGitHubSettings() {
  const cipherPackage = localStorage.getItem(GITHUB_SETTINGS_KEY);
  if (!cipherPackage) {
    // Prefill default info from workspace git if possible
    el.ghUsername.value = 'ardiasgusty';
    el.ghRepo.value = 'Pokedex';
    el.ghBranch.value = 'main';
    el.ghFilepath.value = 'pokebinder_cards.json';
    return;
  }

  try {
    const plainJson = await decryptData(cipherPackage, appState.encryptionPass);
    const parsed = JSON.parse(plainJson);
    appState.githubConfig = parsed;

    el.ghUsername.value = parsed.username || '';
    el.ghRepo.value = parsed.repo || '';
    el.ghBranch.value = parsed.branch || 'main';
    el.ghFilepath.value = parsed.filepath || 'pokebinder_cards.json';
    el.ghToken.value = parsed.token || '';
    el.ghEncryptionPass.value = appState.encryptionPass;

    // Silent pull on boot if token is present
    if (parsed.token && parsed.username && parsed.repo) {
      testGitHubConnection().then(ok => {
        if (ok) pullDataFromGitHub(true);
      });
    }
  } catch (e) {
    console.warn('Gagal mendekripsi pengaturan (kunci sandi mungkin berbeda). User bisa input manual.');
  }
}

// --- PokeAPI & Artwork Helpers ---
function getArtworkUrl(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

function getPixelSpriteUrl(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

async function fetchPokemonData(id) {
  if (appState.cachePokeInfo[id]) {
    return appState.cachePokeInfo[id];
  }
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
    if (!res.ok) throw new Error('Pokemon tidak ditemukan');
    const data = await res.json();
    const pokemon = {
      id: data.id,
      name: data.name,
      sprite: data.sprites.other?.['official-artwork']?.front_default || data.sprites.front_default || getArtworkUrl(data.id),
      thumbnail: data.sprites.front_default || getPixelSpriteUrl(data.id),
      types: data.types.map(t => t.type.name)
    };
    appState.cachePokeInfo[id] = pokemon;
    return pokemon;
  } catch (err) {
    const fallback = {
      id: parseInt(id, 10),
      name: `Pokémon #${id}`,
      sprite: getArtworkUrl(id),
      thumbnail: getPixelSpriteUrl(id),
      types: ['normal']
    };
    appState.cachePokeInfo[id] = fallback;
    return fallback;
  }
}

// --- Persistence with JSON & LocalStorage ---
function loadDataFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        appState.ownedCards = parsed;
      }
    }
  } catch (e) {
    console.error('Gagal membaca data dari LocalStorage:', e);
    appState.ownedCards = {};
  }
}

function saveDataToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.ownedCards));
  } catch (e) {
    console.error('Gagal menyimpan data ke LocalStorage:', e);
  }
}

function exportDataAsJSON() {
  const payload = {
    lastUpdated: new Date().toISOString(),
    totalOwned: Object.keys(appState.ownedCards).length,
    owned: appState.ownedCards
  };
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  const now = new Date().toISOString().slice(0, 10);
  downloadAnchor.setAttribute("download", `pokebinder_cards_${now}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast("File pokebinder_cards.json berhasil diunduh!");
}

function importDataFromJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const importedData = JSON.parse(e.target.result);
      const cards = importedData.owned ? importedData.owned : importedData;
      if (typeof cards === 'object' && cards !== null) {
        appState.ownedCards = cards;
        saveDataToLocalStorage();
        updateStats();
        renderBinderPage();
        showToast("Data kartu dari JSON berhasil diimpor!");
        // Auto push jika terhubung ke GitHub
        if (appState.isGitHubConnected) {
          pushDataToGitHub(true);
        }
      } else {
        alert("Format JSON tidak valid!");
      }
    } catch (err) {
      alert("Gagal membaca file JSON: " + err.message);
    }
  };
  reader.readAsText(file);
}

// Export Encrypted Settings Config
function exportEncryptedConfig() {
  const cipherPackage = localStorage.getItem(GITHUB_SETTINGS_KEY);
  if (!cipherPackage) {
    alert('Simpan pengaturan terlebih dahulu sebelum mengekspor!');
    return;
  }
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(cipherPackage);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `pokebinder_github_settings_encrypted.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast("File konfigurasi terenkripsi berhasil diunduh!");
}

// --- UI Stats & Helpers ---
function updateStats() {
  const cards = Object.values(appState.ownedCards);
  const ownedCount = cards.length;
  const missingCount = TOTAL_POKEMON - ownedCount;
  const percentage = ((ownedCount / TOTAL_POKEMON) * 100).toFixed(1);
  const holoCount = cards.filter(c => (c.cardRarity || 'holo') === 'holo' || c.cardRarity === 'reverse-holo' || c.cardRarity === 'secret-rare').length;

  el.statOwnedCount.textContent = ownedCount;
  el.statMissingCount.textContent = missingCount;
  if (el.statHoloCount) el.statHoloCount.textContent = holoCount;
  el.statPercent.textContent = `${percentage}%`;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(el.toastTimeout);
  el.toastTimeout = setTimeout(() => {
    el.toast.classList.add('hidden');
  }, 3500);
}

// Helper: ambil list item yang sesuai dengan filter aktif saat ini
function getFilteredCardItems() {
  const mode = appState.filterMode; // 'all', 'owned', 'missing', 'holo', 'normal'
  const items = [];

  for (let id = 1; id <= TOTAL_POKEMON; id++) {
    const isOwned = !!appState.ownedCards[id];
    const card = appState.ownedCards[id];
    const rarity = (card?.cardRarity || 'holo');

    if (mode === 'all') {
      items.push({ id, isOwned, card });
    } else if (mode === 'owned') {
      if (isOwned) items.push({ id, isOwned, card });
    } else if (mode === 'missing') {
      if (!isOwned) items.push({ id, isOwned: false, card: null });
    } else if (mode === 'holo') {
      if (isOwned && (rarity === 'holo' || rarity === 'reverse-holo' || rarity === 'secret-rare')) {
        items.push({ id, isOwned, card });
      }
    } else if (mode === 'normal') {
      if (isOwned && rarity === 'normal') {
        items.push({ id, isOwned, card });
      }
    }
  }
  return items;
}

// --- Binder Grid Rendering (9-Pocket Layout) ---
async function renderBinderPage() {
  const filteredItems = getFilteredCardItems();
  const totalFiltered = filteredItems.length;
  const maxPages = Math.max(1, Math.ceil(totalFiltered / CARDS_PER_PAGE));

  // Pastikan current page tidak melebihi max pages untuk filter ini
  if (appState.currentPage > maxPages) {
    appState.currentPage = maxPages;
  }
  const page = appState.currentPage;

  const startIndex = (page - 1) * CARDS_PER_PAGE;
  const pageItems = filteredItems.slice(startIndex, startIndex + CARDS_PER_PAGE);

  // Update header pagination text
  el.currentPageDisplay.textContent = page;
  el.totalPagesDisplay.textContent = `/ ${maxPages}`;
  
  if (appState.filterMode === 'all') {
    const startId = (page - 1) * CARDS_PER_PAGE + 1;
    const endId = Math.min(page * CARDS_PER_PAGE, TOTAL_POKEMON);
    el.pagePokedexRange.textContent = `(#${startId} - #${endId})`;
    el.sheetHeaderRange.textContent = `Pockets #${startId} - #${endId}`;
  } else {
    el.pagePokedexRange.textContent = `(${totalFiltered} kartu cocok)`;
    el.sheetHeaderRange.textContent = `Filter: ${appState.filterMode.toUpperCase()} (${startIndex + 1} - ${startIndex + pageItems.length} dari ${totalFiltered})`;
  }

  // Update nav buttons disabled state
  el.btnFirstPage.disabled = (page === 1);
  el.btnPrevPage.disabled = (page === 1);
  el.btnNextPage.disabled = (page === maxPages);
  el.btnLastPage.disabled = (page === maxPages);

  // Clear pocket grid
  el.pocketGrid.innerHTML = '';

  if (pageItems.length === 0) {
    el.pocketGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px; color: var(--text-muted);">
        <h3>Tidak ada kartu yang cocok dengan filter "${appState.filterMode}".</h3>
        <p style="margin-top: 8px;">Pilih filter lain atau tambahkan kartu baru.</p>
      </div>
    `;
    return;
  }

  for (const item of pageItems) {
    const pokeId = item.id;
    const isOwned = item.isOwned;
    const card = item.card;

    const slotEl = document.createElement('div');
    const rarityClass = isOwned ? `is-${card.cardRarity || 'holo'}` : '';
    slotEl.className = `pocket-slot ${isOwned ? 'owned' : 'empty'} ${rarityClass}`;
    slotEl.dataset.id = pokeId;

    if (isOwned) {
      const rarity = card.cardRarity || 'holo';
      let rarityLabel = '✨ Holo';
      let rarityBadgeClass = 'rarity-holo';

      if (rarity === 'reverse-holo') {
        rarityLabel = '🌈 Rev Holo';
        rarityBadgeClass = 'rarity-reverse-holo';
      } else if (rarity === 'normal') {
        rarityLabel = '⚪ Non-Holo';
        rarityBadgeClass = 'rarity-normal';
      } else if (rarity === 'secret-rare') {
        rarityLabel = '🌟 Secret Rare';
        rarityBadgeClass = 'rarity-secret-rare';
      }

      const typeBadges = (card.types || ['normal']).map(t => 
        `<span class="type-pill type-${t.toLowerCase()}">${t}</span>`
      ).join('');

      slotEl.innerHTML = `
        <div class="card-shine-effect"></div>
        <span class="slot-badge-num">#${pokeId}</span>
        <button class="slot-action-btn" title="Hapus kartu ini dari binder" data-action="remove" data-id="${pokeId}">✕</button>
        <div class="card-content">
          <div class="card-top">
            <span class="pokemon-name">${card.name}</span>
            <span class="card-rarity-badge ${rarityBadgeClass}" title="Klik untuk ubah jenis kartu (Holo/Biasa)" data-action="toggle-rarity" data-id="${pokeId}">${rarityLabel}</span>
          </div>
          <div class="pokemon-artwork-box">
            <img class="pokemon-artwork" src="${card.sprite}" alt="${card.name}" loading="lazy">
          </div>
          <div class="card-bottom">
            <div class="card-types">${typeBadges}</div>
            <span class="owned-badge">✓ Tersimpan</span>
          </div>
        </div>
      `;
    } else {
      // Empty Pocket - Click to add or quickly view
      slotEl.innerHTML = `
        <span class="slot-badge-num">#${pokeId}</span>
        <div class="empty-content" data-action="quick-add" data-id="${pokeId}">
          <div class="empty-icon">🎴</div>
          <p class="empty-pokename" id="empty-name-${pokeId}">Memuat...</p>
          <span class="empty-status-tag">BELUM ADA</span>
          <span class="empty-hint">+ Klik untuk Tambah</span>
        </div>
      `;
      // Asynchronously fetch pokemon name to make hunting informative
      fetchPokemonData(pokeId).then(data => {
        const nameEl = document.getElementById(`empty-name-${pokeId}`);
        if (nameEl) nameEl.textContent = data.name;
      });
    }

    el.pocketGrid.appendChild(slotEl);
  }

  // Jika halaman terakhir kurang dari 9 kartu pada mode filter, isi slot kosong sisa untuk kerapian 3x3 layout
  const remainder = CARDS_PER_PAGE - pageItems.length;
  if (remainder > 0 && pageItems.length > 0) {
    for (let r = 0; r < remainder; r++) {
      const placeholder = document.createElement('div');
      placeholder.className = 'pocket-slot inactive';
      placeholder.style.opacity = '0.15';
      placeholder.innerHTML = `<div class="empty-content"><span class="empty-hint">-</span></div>`;
      el.pocketGrid.appendChild(placeholder);
    }
  }
}

// --- Card Operations ---
async function addCardToBinder(pokeId, autoJump = true, specifiedRarity = null) {
  const idNum = parseInt(pokeId, 10);
  if (isNaN(idNum) || idNum < 1 || idNum > TOTAL_POKEMON) {
    alert(`Nomor Pokédex tidak valid! Masukkan antara 1 sampai ${TOTAL_POKEMON}.`);
    return;
  }

  showToast(`Mengambil info Pokémon #${idNum}...`);
  const data = await fetchPokemonData(idNum);
  const rarity = specifiedRarity || (el.pokeRaritySelect ? el.pokeRaritySelect.value : 'holo');

  appState.ownedCards[idNum] = {
    id: idNum,
    name: data.name,
    sprite: data.sprite,
    types: data.types,
    cardRarity: rarity,
    dateAdded: new Date().toISOString()
  };

  saveDataToLocalStorage();
  updateStats();

  if (autoJump && appState.filterMode === 'all') {
    // Jump to the binder page where this card is placed
    const targetPage = Math.ceil(idNum / CARDS_PER_PAGE);
    appState.currentPage = targetPage;
  }

  renderBinderPage();
  showToast(`✅ Pokémon #${idNum} (${data.name}) [${rarity.toUpperCase()}] berhasil disimpan!`);

  // Auto-sync ke GitHub jika token terpasang
  if (appState.isGitHubConnected) {
    pushDataToGitHub(true);
  }
}

// Fitur ubah tipe kartu (Holo -> Normal -> Reverse Holo -> Secret Rare) secara cepat
function toggleCardRarity(pokeId) {
  const idNum = parseInt(pokeId, 10);
  const card = appState.ownedCards[idNum];
  if (!card) return;

  const cycle = ['holo', 'normal', 'reverse-holo', 'secret-rare'];
  const currentIndex = cycle.indexOf(card.cardRarity || 'holo');
  const nextRarity = cycle[(currentIndex + 1) % cycle.length];

  card.cardRarity = nextRarity;
  saveDataToLocalStorage();
  updateStats();
  renderBinderPage();

  let label = '✨ Holo';
  if (nextRarity === 'normal') label = '⚪ Non-Holo (Biasa)';
  else if (nextRarity === 'reverse-holo') label = '🌈 Reverse Holo';
  else if (nextRarity === 'secret-rare') label = '🌟 Secret Rare';

  showToast(`Kartu #${idNum} diubah menjadi: ${label}`);

  if (appState.isGitHubConnected) {
    pushDataToGitHub(true);
  }
}

function removeCardFromBinder(pokeId) {
  const idNum = parseInt(pokeId, 10);
  if (appState.ownedCards[idNum]) {
    const cardName = appState.ownedCards[idNum].name;
    if (confirm(`Hapus kartu Pokémon #${idNum} (${cardName}) dari binder?`)) {
      delete appState.ownedCards[idNum];
      saveDataToLocalStorage();
      updateStats();
      renderBinderPage();
      showToast(`Kartu #${idNum} (${cardName}) telah dihapus.`);
      if (appState.isGitHubConnected) {
        pushDataToGitHub(true);
      }
    }
  }
}

// --- Missing / Shopping List Modal Rendering ---
async function renderMissingList() {
  const currentGen = appState.missingGenFilter;
  const search = appState.missingSearchQuery.toLowerCase().trim();

  let minId = 1;
  let maxId = TOTAL_POKEMON;

  if (currentGen !== 'all') {
    const genObj = GENERATIONS.find(g => g.gen === parseInt(currentGen, 10));
    if (genObj) {
      minId = genObj.start;
      maxId = genObj.end;
    }
  }

  const missingIds = [];
  for (let id = minId; id <= maxId; id++) {
    if (!appState.ownedCards[id]) {
      missingIds.push(id);
    }
  }

  el.missingShownCount.textContent = missingIds.length;
  el.missingListContainer.innerHTML = '';

  if (missingIds.length === 0) {
    el.missingListContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--accent-teal);">
        <h3>🎉 Selamat! Semua kartu pada kategori ini sudah kamu miliki!</h3>
      </div>
    `;
    return;
  }

  const displaySlice = missingIds.slice(0, 150);

  for (const id of displaySlice) {
    const cardEl = document.createElement('div');
    cardEl.className = 'missing-item-card';
    cardEl.innerHTML = `
      <span class="missing-item-id">#${id}</span>
      <img class="missing-item-img" src="${getArtworkUrl(id)}" alt="Poke #${id}" loading="lazy" onerror="this.src='${getPixelSpriteUrl(id)}'">
      <span class="missing-item-name" id="missing-name-${id}">#${id}</span>
      <button class="btn-quick-add" data-id="${id}">+ Punya Kartu Ini</button>
    `;
    el.missingListContainer.appendChild(cardEl);

    // Load pokemon name in background
    fetchPokemonData(id).then(poke => {
      const nameEl = document.getElementById(`missing-name-${id}`);
      if (nameEl) nameEl.textContent = poke.name;
    });
  }

  if (missingIds.length > 150) {
    const moreNotice = document.createElement('div');
    moreNotice.style.gridColumn = '1 / -1';
    moreNotice.style.textAlign = 'center';
    moreNotice.style.padding = '12px';
    moreNotice.style.color = 'var(--text-muted)';
    moreNotice.innerHTML = `<em>...dan masih ada ${missingIds.length - 150} nomor kosong lainnya. Gunakan filter Gen untuk memfokuskan daftar belanja.</em>`;
    el.missingListContainer.appendChild(moreNotice);
  }
}

// --- Batch Process Helper ---
async function processBatchInput(text) {
  if (!text.trim()) return;

  const parts = text.split(/[\s,]+/);
  const idsToAdd = [];

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const s = parseInt(startStr, 10);
      const e = parseInt(endStr, 10);
      if (!isNaN(s) && !isNaN(e) && s <= e) {
        for (let i = s; i <= e && i <= TOTAL_POKEMON; i++) {
          if (i >= 1) idsToAdd.push(i);
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= TOTAL_POKEMON) {
        idsToAdd.push(num);
      }
    }
  }

  const uniqueIds = [...new Set(idsToAdd)];
  if (uniqueIds.length === 0) {
    el.batchStatusMsg.textContent = 'Tidak ada nomor valid yang ditemukan.';
    return;
  }

  el.batchStatusMsg.textContent = `Menyimpan ${uniqueIds.length} nomor...`;
  
  for (const id of uniqueIds) {
    const data = await fetchPokemonData(id);
    appState.ownedCards[id] = {
      id: id,
      name: data.name,
      sprite: data.sprite,
      types: data.types,
      dateAdded: new Date().toISOString()
    };
  }

  saveDataToLocalStorage();
  updateStats();
  renderBinderPage();
  el.batchStatusMsg.textContent = `✅ Berhasil menambahkan ${uniqueIds.length} kartu ke binder!`;
  showToast(`Berhasil menyimpan ${uniqueIds.length} kartu!`);

  if (appState.isGitHubConnected) {
    pushDataToGitHub(true);
  }
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Add form submit
  el.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const idVal = el.pokeIdInput.value.trim();
    if (idVal) {
      addCardToBinder(idVal, true);
      el.pokeIdInput.value = '';
      el.quickPreview.classList.add('hidden');
    }
  });

  // Quick preview button
  el.btnPreview.addEventListener('click', async () => {
    const id = parseInt(el.pokeIdInput.value.trim(), 10);
    if (!id || id < 1 || id > TOTAL_POKEMON) {
      alert(`Masukkan nomor Pokédex valid (1 - ${TOTAL_POKEMON})`);
      return;
    }
    const poke = await fetchPokemonData(id);
    el.previewImg.src = poke.sprite;
    el.previewName.textContent = `#${poke.id} ${poke.name}`;
    el.previewTypes.innerHTML = poke.types.map(t => `<span class="type-pill type-${t}">${t}</span>`).join('');
    el.quickPreview.classList.remove('hidden');
  });

  // Pagination
  el.btnFirstPage.addEventListener('click', () => {
    appState.currentPage = 1;
    renderBinderPage();
  });
  el.btnPrevPage.addEventListener('click', () => {
    if (appState.currentPage > 1) {
      appState.currentPage--;
      renderBinderPage();
    }
  });
  el.btnNextPage.addEventListener('click', () => {
    if (appState.currentPage < TOTAL_PAGES) {
      appState.currentPage++;
      renderBinderPage();
    }
  });
  el.btnLastPage.addEventListener('click', () => {
    appState.currentPage = TOTAL_PAGES;
    renderBinderPage();
  });

  // Jump page
  el.btnJump.addEventListener('click', () => {
    const val = parseInt(el.jumpPageInput.value, 10);
    if (!isNaN(val)) {
      let targetPage = val;
      if (val > TOTAL_PAGES) {
        targetPage = Math.ceil(val / CARDS_PER_PAGE);
      }
      if (targetPage >= 1 && targetPage <= TOTAL_PAGES) {
        appState.currentPage = targetPage;
        renderBinderPage();
      } else {
        alert(`Halaman tidak valid (1 - ${TOTAL_PAGES})`);
      }
    }
  });

  // Filter toggles
  el.filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      el.filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appState.filterMode = btn.dataset.filter;
      appState.currentPage = 1; // Reset ke halaman pertama saat filter berubah
      renderBinderPage();
    });
  });

  // Delegated clicks on Pocket Grid (Add / Remove / Toggle Rarity)
  el.pocketGrid.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-action="remove"]');
    if (removeBtn) {
      const id = removeBtn.dataset.id;
      removeCardFromBinder(id);
      return;
    }

    const toggleRarityBtn = e.target.closest('[data-action="toggle-rarity"]');
    if (toggleRarityBtn) {
      const id = toggleRarityBtn.dataset.id;
      toggleCardRarity(id);
      return;
    }

    const quickAddArea = e.target.closest('[data-action="quick-add"]');
    if (quickAddArea) {
      const id = quickAddArea.dataset.id;
      addCardToBinder(id, false);
      return;
    }
  });

  // JSON Export / Import
  el.btnExportJson.addEventListener('click', exportDataAsJSON);
  el.btnImportJsonTrigger.addEventListener('click', () => el.jsonFileInput.click());
  el.jsonFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      importDataFromJSON(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Reset
  el.btnResetData.addEventListener('click', () => {
    if (confirm("Apakah kamu yakin ingin menghapus semua kartu yang tersimpan di binder ini? Tindakan ini tidak dapat dibatalkan (pastikan sudah backup ke JSON atau GitHub)!")) {
      appState.ownedCards = {};
      saveDataToLocalStorage();
      updateStats();
      renderBinderPage();
      showToast("Data binder berhasil di-reset.");
      if (appState.isGitHubConnected) {
        pushDataToGitHub(true);
      }
    }
  });

  // Missing Modal Controls
  el.btnOpenMissingModal.addEventListener('click', () => {
    el.missingModal.classList.remove('hidden');
    renderMissingList();
  });
  el.btnCloseMissingModal.addEventListener('click', () => {
    el.missingModal.classList.add('hidden');
  });
  el.missingModal.addEventListener('click', (e) => {
    if (e.target === el.missingModal) el.missingModal.classList.add('hidden');
  });

  // Gen tabs in missing modal
  el.genTabs.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.tab-btn');
    if (tabBtn) {
      el.genTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
      appState.missingGenFilter = tabBtn.dataset.gen;
      renderMissingList();
    }
  });

  // Quick add inside missing modal
  el.missingListContainer.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.btn-quick-add');
    if (addBtn) {
      const id = addBtn.dataset.id;
      addCardToBinder(id, false).then(() => {
        renderMissingList();
      });
    }
  });

  // Batch Modal Controls
  el.btnOpenBatchModal.addEventListener('click', () => {
    el.batchModal.classList.remove('hidden');
    el.batchStatusMsg.textContent = '';
  });
  el.btnCloseBatchModal.addEventListener('click', () => {
    el.batchModal.classList.add('hidden');
  });
  el.batchModal.addEventListener('click', (e) => {
    if (e.target === el.batchModal) el.batchModal.classList.add('hidden');
  });
  el.btnProcessBatch.addEventListener('click', () => {
    const text = el.batchInputArea.value;
    processBatchInput(text);
  });

  // GitHub Settings Modal Controls
  el.btnOpenSettings.addEventListener('click', () => {
    el.settingsModal.classList.remove('hidden');
  });
  el.btnCloseSettingsModal.addEventListener('click', () => {
    el.settingsModal.classList.add('hidden');
  });
  el.settingsModal.addEventListener('click', (e) => {
    if (e.target === el.settingsModal) el.settingsModal.classList.add('hidden');
  });

  // Toggle token input visibility
  el.toggleTokenVisibility.addEventListener('click', () => {
    if (el.ghToken.type === 'password') {
      el.ghToken.type = 'text';
      el.toggleTokenVisibility.textContent = '🔒';
    } else {
      el.ghToken.type = 'password';
      el.toggleTokenVisibility.textContent = '👁️';
    }
  });

  // Save Settings Form
  el.githubSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveEncryptedGitHubSettings();
  });

  // Test Connection
  el.btnTestConnection.addEventListener('click', async () => {
    appState.githubConfig.username = el.ghUsername.value.trim();
    appState.githubConfig.repo = el.ghRepo.value.trim();
    appState.githubConfig.branch = el.ghBranch.value.trim() || 'main';
    appState.githubConfig.filepath = el.ghFilepath.value.trim() || 'pokebinder_cards.json';
    appState.githubConfig.token = el.ghToken.value.trim();
    await testGitHubConnection();
  });

  // Pull / Push Buttons
  el.btnPullGithub.addEventListener('click', () => pullDataFromGitHub(false));
  el.btnPushGithub.addEventListener('click', () => pushDataToGitHub(false));
  el.btnExportSettingsJson.addEventListener('click', exportEncryptedConfig);

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' && appState.currentPage < TOTAL_PAGES) {
      appState.currentPage++;
      renderBinderPage();
    } else if (e.key === 'ArrowLeft' && appState.currentPage > 1) {
      appState.currentPage--;
      renderBinderPage();
    }
  });
}

// Initial Starter Sample (if clean install)
function setupSampleCardsIfEmpty() {
  if (Object.keys(appState.ownedCards).length === 0) {
    // Muat data awal dari file lokal pokebinder_cards.json
    fetch('pokebinder_cards.json')
      .then(res => res.json())
      .then(data => {
        const cards = data.owned ? data.owned : data;
        if (cards && Object.keys(cards).length > 0) {
          appState.ownedCards = cards;
          saveDataToLocalStorage();
          updateStats();
          renderBinderPage();
        }
      })
      .catch(() => {
        // Fallback starters
        const sampleIds = [1, 4, 7, 25];
        Promise.all(sampleIds.map(id => fetchPokemonData(id))).then(results => {
          results.forEach(poke => {
            appState.ownedCards[poke.id] = {
              id: poke.id,
              name: poke.name,
              sprite: poke.sprite,
              types: poke.types,
              dateAdded: new Date().toISOString()
            };
          });
          saveDataToLocalStorage();
          updateStats();
          renderBinderPage();
        });
      });
  }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadDataFromLocalStorage();
  setupEventListeners();
  updateStats();
  renderBinderPage();
  setupSampleCardsIfEmpty();
  loadEncryptedGitHubSettings();
});
