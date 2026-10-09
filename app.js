(() => {
  "use strict";

  const STORAGE_KEY = "seven-footballers-v1";
  const THEME_KEY = "seven-theme";
  const THEME_CHOICES = [
    { id: "dark", label: "Sombre" },
    { id: "light", label: "Clair" }
  ];
  const THEME_META_COLORS = { final: { dark: "#0b1712", light: "#f1f2ea" }, proto: { dark: "#173d30", light: "#ffffff" } };
  const DESIGN_KEY = "seven-design";
  const DESIGN_CHOICES = [
    { id: "proto", label: "Prototype" },
    { id: "final", label: "Fini" }
  ];
  const DESIGN_FILES = {
    final: { style: "./style.css", theme: "./theme.css" },
    proto: { style: "./style-proto.css", theme: "./theme-proto.css" }
  };
  const RARITIES = [
    { id: "normal", label: "Normale" },
    { id: "legend", label: "Légende" },
    { id: "mythic", label: "Mythique" }
  ];
  const SORT_OPTIONS = [
    { id: "name", label: "Nom" },
    { id: "club", label: "Club" },
    { id: "position", label: "Poste" },
    { id: "nationality", label: "Nationalité" },
    { id: "rarity", label: "Rareté" },
    { id: "rating", label: "Note" }
  ];
  const NO_VALUE_FILTER = "__none";
  const PHOTO_MAX_SIDE = 400;
  const MAX_PHOTO_FILE_BYTES = 20 * 1024 * 1024;
  const FIREBASE_CONFIG = window.SEVEN_FIREBASE_CONFIG || {};
  const FIREBASE_SDK_VERSION = "11.10.0";
  const POSITIONS = ["Gardien", "Défenseur", "Milieu", "Attaquant"];
  const POSITION_ICONS = { Gardien: "G", Défenseur: "D", Milieu: "M", Attaquant: "A" };
  const POSITION_ICONS_PROTO = { Gardien: "🧤", Défenseur: "🛡️", Milieu: "↔", Attaquant: "⚽" };
  const MYSTERY_FIELDS = [
    { key: "club", label: "Club" },
    { key: "nationality", label: "Nationalité" },
    { key: "position", label: "Poste" }
  ];
  const COUNTS = { Gardien: 1, Défenseur: 3, Milieu: 1, Attaquant: 2 };
  const POSITION_TOTALS = Object.fromEntries(POSITIONS.map(position => [position, COUNTS[position] * 2]));
  const root = document.getElementById("app");
  let players = readPlayers();
  let themeChoice = readThemeChoice();
  let designChoice = readDesignChoice();
  let listFilters = { position: "", rarity: "", club: "", nationality: "" };
  let listSort = { key: "name", dir: "asc" };
  let screen = "menu";
  let editingId = null;
  let formPhoto = "";
  let game = null;
  let currentAccount = null;
  let currentAccountName = "";
  let firebaseServices = null;
  let firebaseServicesPromise = null;
  let accountBusy = false;
  let cloudSyncPromise = Promise.resolve();
  let sharedPlayersUnsubscribe = null;
  let setupNames = ["Joueur 1", "Joueur 2"];
  let setupMystery = false;
  let setupSealed = false;
  let setupMysteryClue = "club";
  let notice = "";
  let noticeType = "";

  function readThemeChoice() {
    try {
      const value = localStorage.getItem(THEME_KEY);
      return THEME_CHOICES.some(item => item.id === value) ? value : "dark";
    } catch {
      return "dark";
    }
  }

  function readDesignChoice() {
    try {
      const value = localStorage.getItem(DESIGN_KEY);
      return DESIGN_CHOICES.some(item => item.id === value) ? value : "final";
    } catch {
      return "final";
    }
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", themeChoice);
    document.documentElement.setAttribute("data-design", designChoice);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_META_COLORS[designChoice][themeChoice]);
  }

  // Remplace une feuille de style sans « flash » : l'ancienne reste en place jusqu'au chargement de la nouvelle.
  function swapStylesheet(id, href) {
    return new Promise(resolve => {
      try {
        const current = document.getElementById(id);
        if (!current || current.getAttribute("href") === href) { resolve(); return; }
        const next = document.createElement("link");
        next.rel = "stylesheet";
        next.href = href;
        next.addEventListener("load", () => { current.remove(); next.id = id; resolve(); }, { once: true });
        next.addEventListener("error", () => { next.remove(); resolve(); }, { once: true });
        current.after(next);
      } catch {
        resolve();
      }
    });
  }

  async function setDesign(choice) {
    if (!DESIGN_CHOICES.some(item => item.id === choice) || choice === designChoice) return;
    designChoice = choice;
    try { localStorage.setItem(DESIGN_KEY, choice); } catch { /* stockage indisponible : le design reste actif pour la session */ }
    applyTheme();
    await Promise.all([swapStylesheet("design-css", DESIGN_FILES[choice].style), swapStylesheet("theme-css", DESIGN_FILES[choice].theme)]);
    render();
  }

  function isProto() {
    return designChoice === "proto";
  }

  function eyebrowHtml(text) {
    return isProto() ? `<div class="eyebrow">${text}</div>` : "";
  }

  function setTheme(choice) {
    if (!THEME_CHOICES.some(item => item.id === choice)) return;
    themeChoice = choice;
    try { localStorage.setItem(THEME_KEY, choice); } catch { /* stockage indisponible : le thème reste actif pour la session */ }
    applyTheme();
    root.querySelectorAll("[data-theme-choice]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === themeChoice));
    });
  }

  function themeSwitchHtml() {
    return `<div class="theme-switch" role="group" aria-label="Thème">${THEME_CHOICES.map(item => `<button type="button" data-action="set-theme" data-theme-choice="${item.id}" aria-pressed="${item.id === themeChoice}">${item.label}</button>`).join("")}</div>`;
  }

  function designSwitchHtml() {
    return `<div class="theme-switch" role="group" aria-label="Design">${DESIGN_CHOICES.map(item => `<button type="button" data-action="set-design" data-design-choice="${item.id}" aria-pressed="${item.id === designChoice}">${item.label}</button>`).join("")}</div>`;
  }

  function normalizePlayer(player) {
    const rawRating = player.rating === null || player.rating === undefined || player.rating === "" ? NaN : Number(player.rating);
    return {
      ...player,
      rarity: RARITIES.some(item => item.id === player.rarity) ? player.rarity : "normal",
      rating: Number.isFinite(rawRating) && rawRating >= 1 && rawRating <= 10 ? rawRating : null
    };
  }

  function rarityLabel(rarity) {
    return RARITIES.find(item => item.id === rarity)?.label || "Normale";
  }

  function rarityBadgeHtml(player) {
    return player.rarity === "legend" || player.rarity === "mythic"
      ? `<span class="rarity-badge ${player.rarity}">${rarityLabel(player.rarity)}</span>`
      : "";
  }

  function hasRating(player) {
    return typeof player.rating === "number" && Number.isFinite(player.rating);
  }

  function formatRating(value) {
    return Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  }

  function teamAverage(team) {
    if (team.length !== 7 || !team.every(hasRating)) return null;
    return team.reduce((sum, player) => sum + player.rating, 0) / team.length;
  }

  function teamAverageHtml(team) {
    const average = teamAverage(team);
    const rated = team.filter(hasRating).length;
    return `<div class="result-average${average === null ? " unavailable" : ""}"><span>Moyenne de l’équipe</span>${average === null ? `<strong>—</strong><small>Notes manquantes · ${rated} / ${team.length} joueurs notés</small>` : `<strong>${formatRating(average)} / 10</strong>`}</div>`;
  }

  function readPlayers(storageKey = STORAGE_KEY) {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter(player => player && player.id && player.name && POSITIONS.includes(player.position)).map(normalizePlayer) : [];
    } catch {
      return [];
    }
  }

  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  // Copie locale de secours. Si le navigateur manque de place et que le cloud
  // prend le relais, on garde au moins les fiches (sans les photos) plutôt que de tout bloquer.
  function cachePlayers(list, allowPartial = true) {
    if (safeSetItem(STORAGE_KEY, JSON.stringify(list))) return true;
    if (allowPartial) safeSetItem(STORAGE_KEY, JSON.stringify(list.map(player => ({ ...player, photo: "" }))));
    return false;
  }

  function persistPlayers() {
    const cloudReady = Boolean(currentAccount && firebaseServices);
    const cachedFully = cachePlayers(players, cloudReady);
    if (!cachedFully && !cloudReady) {
      setNotice("Enregistrement impossible : la mémoire de cet appareil est pleine. Supprime d’anciennes photos ou connecte-toi en admin pour utiliser la base partagée.", "error");
      return false;
    }
    scheduleCloudSync();
    return true;
  }

  function activeStorageKey() {
    return STORAGE_KEY;
  }

  function isFirebaseConfigured() {
    return Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.authDomain && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.storageBucket && FIREBASE_CONFIG.appId);
  }

  function accountEmail() {
    return String(FIREBASE_CONFIG.adminEmail || `seven-admin@${FIREBASE_CONFIG.projectId}.firebaseapp.com`).toLowerCase();
  }

  function accountPassword(pin) {
    return `Seven-${pin}!`;
  }

  function resizePhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Impossible de lire cette image."));
      };
      image.onload = () => {
        try {
          const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext("2d");
          const keepsAlpha = /^image\/(png|webp|gif)$/.test(file.type);
          if (!keepsAlpha) {
            context.fillStyle = "#fff";
            context.fillRect(0, 0, canvas.width, canvas.height);
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(keepsAlpha ? canvas.toDataURL("image/webp", .85) : canvas.toDataURL("image/jpeg", .82));
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.src = url;
    });
  }

  function compressPhotoForFirestore(dataUrl) {
    if (!dataUrl?.startsWith("data:image/")) return Promise.resolve("");
    const base64 = dataUrl.split(",", 2)[1] || "";
    if (base64.length * .75 < 350 * 1024) return Promise.resolve(dataUrl);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onerror = () => reject(new Error("Impossible de lire une photo."));
      image.onload = async () => {
        let scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
        try {
          for (let attempt = 0; attempt < 5; attempt++, scale *= .75) {
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = canvas.getContext("2d");
            context.fillStyle = "#fff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const compressed = canvas.toDataURL("image/jpeg", .72);
            if (compressed.length < 650 * 1024) {
              resolve(compressed);
              return;
            }
          }
          reject(new Error("Cette photo ne peut pas être assez compressée pour Firestore."));
        } catch (error) {
          reject(error);
        }
      };
      image.src = dataUrl;
    });
  }

  async function loadFirebaseServices() {
    if (firebaseServices) return firebaseServices;
    if (firebaseServicesPromise) return firebaseServicesPromise;
    firebaseServicesPromise = (async () => {
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
      const [appSdk, authSdk, firestoreSdk] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-firestore.js`)
      ]);
      const { functionsRegion: _unusedRegion, ...webConfig } = FIREBASE_CONFIG;
      const app = appSdk.initializeApp(webConfig, "seven-game");
      const auth = authSdk.getAuth(app);
      const db = firestoreSdk.getFirestore(app);
      firebaseServices = { appSdk, authSdk, firestoreSdk, auth, db };
      return firebaseServices;
    })();
    return firebaseServicesPromise;
  }

  async function readSharedPlayers() {
    const { db, firestoreSdk } = firebaseServices;
    const collectionRef = firestoreSdk.collection(db, "footballers");
    const snapshot = await firestoreSdk.getDocs(collectionRef);
    return snapshot.docs.map(playerDoc => normalizePlayer({ ...playerDoc.data(), id: playerDoc.data().id || playerDoc.id }));
  }

  async function syncPlayersToCloud() {
    if (!currentAccount || !firebaseServices) return;
    const { db, firestoreSdk } = firebaseServices;
    const collectionRef = firestoreSdk.collection(db, "footballers");
    const existing = await firestoreSdk.getDocs(collectionRef);
    const ids = new Set(players.map(player => player.id));

    const stored = new Map(existing.docs.map(playerDoc => [playerDoc.id, playerDoc.data()]));
    for (const player of players) {
      if (player.photo?.startsWith("data:image/") && player.photo.length > 450 * 1024) player.photo = await compressPhotoForFirestore(player.photo);
      const payload = {
        id: player.id,
        name: player.name,
        position: player.position,
        nationality: player.nationality || "",
        club: player.club || "",
        photo: player.photo || "",
        rarity: player.rarity || "normal",
        rating: hasRating(player) ? player.rating : null
      };
      const previous = stored.get(player.id);
      if (previous && Object.keys(payload).every(key => previous[key] === payload[key])) continue;
      await firestoreSdk.setDoc(firestoreSdk.doc(collectionRef, player.id), payload);
    }

    for (const playerDoc of existing.docs) {
      if (ids.has(playerDoc.id)) continue;
      await firestoreSdk.deleteDoc(playerDoc.ref);
    }
    cachePlayers(players);
  }

  function scheduleCloudSync() {
    if (!currentAccount || !firebaseServices) return;
    cloudSyncPromise = cloudSyncPromise.catch(() => {}).then(syncPlayersToCloud).catch(error => {
      notice = "Joueurs enregistrés sur cet appareil, mais la synchronisation a échoué. Vérifie la connexion.";
      noticeType = "error";
      if (screen === "settings") renderSettings();
      console.error("Seven cloud sync failed", error);
    });
  }

  async function loadSharedPlayers(isAdmin = false) {
    const legacyPlayers = readPlayers(STORAGE_KEY);
    const backupKey = `${STORAGE_KEY}:legacy-backup`;
    const importedKey = `${STORAGE_KEY}:shared-imported`;
    if (legacyPlayers.length && !localStorage.getItem(backupKey)) {
      safeSetItem(backupKey, JSON.stringify(legacyPlayers));
    }
    const cloudPlayers = await readSharedPlayers();
    let nextPlayers = cloudPlayers;
    let shouldUpload = false;

    if (isAdmin && legacyPlayers.length > 0 && localStorage.getItem(importedKey) !== "true") {
      const importMessage = cloudPlayers.length === 0
        ? `Importer les ${legacyPlayers.length} joueurs de cet appareil dans la base partagée ? La copie locale restera conservée.`
        : `Fusionner les ${legacyPlayers.length} joueurs de cet appareil avec la base partagée ?`;
      if (window.confirm(importMessage)) {
        const merged = new Map(cloudPlayers.map(player => [player.id, player]));
        for (const player of legacyPlayers) if (!merged.has(player.id)) merged.set(player.id, player);
        nextPlayers = [...merged.values()];
        shouldUpload = true;
      }
      safeSetItem(importedKey, "true");
    }

    players = cloudPlayers.length || isAdmin ? nextPlayers : legacyPlayers;
    if (cloudPlayers.length || isAdmin) cachePlayers(players);
    if (shouldUpload) {
      players = nextPlayers;
      await syncPlayersToCloud();
    }
  }

  function listenToSharedPlayers() {
    if (!firebaseServices) return;
    sharedPlayersUnsubscribe?.();
    const collectionRef = firebaseServices.firestoreSdk.collection(firebaseServices.db, "footballers");
    sharedPlayersUnsubscribe = firebaseServices.firestoreSdk.onSnapshot(collectionRef, snapshot => {
      players = snapshot.docs.map(playerDoc => normalizePlayer({ ...playerDoc.data(), id: playerDoc.data().id || playerDoc.id }));
      cachePlayers(players);
      if (screen === "settings" && root.querySelector("#player-panel")?.open) refreshPlayerList();
      else if (screen === "menu" || screen === "settings") render();
    }, error => {
      console.error("Seven shared player listener failed", error);
    });
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function moneyHtml(value) {
    return `<span class="amount">${Number(value).toLocaleString("fr-FR")}</span> <span class="unit">crédit${Number(value) === 1 ? "" : "s"}</span>`;
  }

  function money(value) {
    return `${Number(value).toLocaleString("fr-FR")} crédit${Number(value) === 1 ? "" : "s"}`;
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
  }

  function positionIcon(position) {
    return `<span class="position-icon" role="img" aria-label="${escapeHtml(position)}" title="${escapeHtml(position)}">${(isProto() ? POSITION_ICONS_PROTO : POSITION_ICONS)[position]}</span>`;
  }

  function mysteryClues(player, mode) {
    if (!mode) return [];
    if (mode === "chaos" || mode === "chaos-plus") {
      const available = MYSTERY_FIELDS.filter(field => field.key === "position" || Boolean(String(player[field.key] || "").trim()));
      const selected = mode === "chaos"
        ? [available[Math.floor(Math.random() * available.length)]]
        : available.filter(() => Math.random() < .5);
      return selected.map(field => ({ label: field.label, value: player[field.key] }));
    }
    const field = MYSTERY_FIELDS.find(item => item.key === mode) || MYSTERY_FIELDS[0];
    return [{ label: field.label, value: String(player[field.key] || "").trim() || "Non renseigné" }];
  }

  function setNotice(message, type = "") {
    notice = message;
    noticeType = type;
    render();
  }

  function noticeHtml() {
    return notice ? `<div class="notice ${noticeType}" role="status">${escapeHtml(notice)}</div>` : "";
  }

  function header(actions = "") {
    return `<header class="topbar">
      <a class="brand" href="#" data-action="home" aria-label="Seven, menu principal">
        <span class="brand-mark">7</span><span class="brand-name">SEVEN</span>
      </a>
      <div class="top-actions">${actions}${accountButtonHtml()}</div>
    </header>`;
  }

  function accountButtonHtml() {
    const label = currentAccount ? `Admin · ${escapeHtml(currentAccountName || "Célien")}` : "Accès admin";
    return `<button class="button secondary account-header-button" data-action="account">${label}</button>`;
  }

  function shell(content, actions = "") {
    stopModeTimer();
    root.innerHTML = `<main class="shell">${header(actions)}${content}</main>`;
  }

  function inventoryShortages() {
    const counts = Object.fromEntries(POSITIONS.map(position => [position, players.filter(player => player.position === position).length]));
    const missingByPosition = Object.fromEntries(POSITIONS.map(position => [position, Math.max(0, POSITION_TOTALS[position] - counts[position])]));
    const missingTotal = POSITIONS.reduce((total, position) => total + missingByPosition[position], 0);
    return { counts, missingByPosition, missingTotal, ready: missingTotal === 0 && POSITIONS.every(position => missingByPosition[position] === 0) };
  }

  function inventoryBarHtml(showWhenReady = true, withLink = false) {
    const inventory = inventoryShortages();
    if (inventory.ready && !showWhenReady) return "";
    const chips = POSITIONS.map(position => {
      const count = inventory.counts[position];
      const required = POSITION_TOTALS[position];
      return `<span class="inventory-chip${count < required ? " short" : ""}" title="${escapeHtml(position)} · ${required} requis">${positionIcon(position)}<strong>${count}</strong><small>/ ${required}</small></span>`;
    }).join("");
    const label = inventory.ready ? "Base prête" : `Il manque ${inventory.missingTotal} joueur${inventory.missingTotal > 1 ? "s" : ""}`;
    return `<div class="inventory-bar${inventory.ready ? " ready" : ""}" role="status"><span class="inventory-label">${label}</span><div class="inventory-chips">${chips}</div>${withLink && !inventory.ready ? `<button class="button quiet" data-action="settings">Compléter</button>` : ""}</div>`;
  }

  function renderMenu() {
    screen = "menu";
    const inventory = inventoryShortages();
    const proto = isProto();
    shell(`<section class="menu-layout">
      <div class="menu-copy">
        ${proto ? `<div class="eyebrow">Menu principal</div><h1 class="page-title">Seven</h1>` : `<h1 class="page-title">Compose ton Seven.</h1>
        <p class="subtle">Deux équipes, sept joueurs chacune. Enchéris pour les meilleurs ou laisse le hasard décider.</p>`}
        <div class="mode-grid" aria-label="Menu principal">
          <button class="mode-card primary-mode" data-action="setup">${proto ? `<span class="mode-number">01</span>` : ""}<strong>Jouer</strong><span>${proto ? `Seven · ${players.length} joueurs en base` : "Enchères avec un budget"}</span></button>
          <button class="mode-card" data-action="take-setup">${proto ? `<span class="mode-number">02</span>` : ""}<strong>Prendre ou laisser</strong><span>${proto ? "Choisir une équipe" : "Une carte, un choix"}</span></button>
          ${modeMenuItems().map((item, i) => `<button class="mode-card" data-action="${item.action}">${proto ? `<span class="mode-number">0${i + 3}</span>` : ""}<strong>${item.title}</strong><span>${proto ? item.subProto : item.sub}</span></button>`).join("")}
          <button class="mode-card settings-mode" data-action="settings">${proto ? `<span class="mode-number">06</span>` : ""}<strong>Paramètres</strong><span>${proto ? "Gérer les joueurs" : `${players.length} joueur${players.length > 1 ? "s" : ""} en base`}</span></button>
        </div>
        ${inventory.ready ? "" : `<p class="inventory-summary warning-text">Il manque ${inventory.missingTotal} joueur${inventory.missingTotal > 1 ? "s" : ""} · compléter la base dans Paramètres</p>`}
      </div>
      <div class="menu-panel" aria-hidden="true"><div class="pitch-box"></div><div class="pitch-box right"></div><div class="panel-content">${proto ? `<span class="panel-label">Mode 01</span>` : ""}<span class="panel-number">7</span><span class="panel-caption">${proto ? "Deux équipes, sept joueurs chacune." : "Un côté chacun. Une seule équipe de sept."}</span></div></div>
    </section>${noticeHtml()}`);
  }

  function renderAccount() {
    screen = "account";
    let content;
    if (currentAccount) {
      content = `<section class="setup-panel account-panel"><h2>Administration</h2><p class="account-name">${escapeHtml(currentAccountName || "Célien")}</p><p class="subtle">Tu peux modifier la base partagée visible par tous.</p><div class="form-actions"><button class="button secondary" data-action="home">Retour au jeu</button><button class="button danger" data-action="account-signout">Verrouiller</button></div></section>`;
    } else if (!isFirebaseConfigured() || location.protocol === "file:") {
      const unavailableMessage = location.protocol === "file:"
        ? "La connexion cloud est disponible depuis le site publié en HTTPS, pas depuis un fichier local."
        : "Renseigne les paramètres publics de ton projet dans firebase-config.js.";
      content = `<section class="setup-panel account-panel"><h2>Compte cloud</h2><div class="notice">${escapeHtml(unavailableMessage)}</div><p class="subtle">Les fiches locales restent enregistrées sur cet appareil.</p><button class="button secondary" data-action="home">Retour au jeu</button></section>`;
    } else {
      content = `<section class="setup-panel account-panel"><h2>Accès administrateur</h2>
        ${noticeHtml()}
        <form id="account-form"><div class="account-identifier"><span>Identifiant</span><strong>${escapeHtml(FIREBASE_CONFIG.adminDisplayName || "Célien")}</strong></div><div class="field"><label for="account-pin">Mot de passe · 4 chiffres</label><input id="account-pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="current-password" required></div>
          <button class="button" type="submit" ${accountBusy ? "disabled" : ""}>${accountBusy ? "Vérification…" : "Déverrouiller"}</button>
        </form>
        <p class="account-footnote">La base est partagée. Seul l’administrateur peut ajouter, modifier ou supprimer des joueurs.</p>
        <button class="button quiet" data-action="home">Retour au jeu local</button>
      </section>`;
    }
    shell(`<section class="setup-layout account-layout"><div class="section-head"><div>${eyebrowHtml("Sauvegarde en ligne")}<h1 class="page-title">Mon compte</h1></div></div>${content}</section>`);
  }

  // ---------------------------------------------------------------------------
  // Couleurs des clubs (fond derrière la photo des joueurs).
  // Format : [noms possibles séparés par |, couleurs (1 = uni, 2+ = dégradé), true si fond clair, (facultatif) fond CSS personnalisé].
  // Pour ajouter ou modifier un club, il suffit d'éditer cette liste. Les accents, majuscules,
  // « FC » et la ponctuation sont ignorés. Un club absent de la liste (ex. MLS) n'a pas de fond.
  // ---------------------------------------------------------------------------
  const CLUB_COLORS = [
    // Espagne
    ["real madrid|real", ["#ffffff", "#d9b45a"], true,
      "linear-gradient(to top, rgba(30, 60, 150, .28), rgba(30, 60, 150, 0) 44%), radial-gradient(circle at 28% 18%, #ffffff 0%, #fffaf0 34%, rgba(255, 250, 240, 0) 68%), linear-gradient(155deg, #ffffff 0%, #efe2b4 58%, #cfa84c 100%)"],
    ["barcelone|barcelona|barca|barça", ["#004d98", "#a50044"]],
    ["atletico madrid|atletico de madrid|atletico|atlético madrid", ["#cb3524", "#272e61"], false,
      "linear-gradient(to top, rgba(39, 46, 97, .92) 0%, rgba(39, 46, 97, .55) 34%, rgba(39, 46, 97, 0) 68%), repeating-linear-gradient(135deg, #cb3524 0 9px, #f4f1ec 9px 18px)"],
    ["seville|sevilla", ["#ffffff", "#d4001f"], true],
    ["valence|valencia", ["#ffffff", "#ee7203"], true],
    ["villarreal", ["#fbe14d"], true],
    ["real sociedad", ["#0067b1", "#ffffff"]],
    ["athletic bilbao|athletic club|bilbao", ["#ee2523", "#ffffff"]],
    ["betis|real betis", ["#0bb363", "#ffffff"]],
    ["girona|gérone|gerone", ["#ce1126", "#ffffff"]],
    // Angleterre
    ["manchester city|man city|city", ["#6cabdd"], true],
    ["manchester united|man united|man utd|united", ["#da291c"]],
    ["liverpool", ["#c4122f", "#8c0a1f"], false,
      "linear-gradient(135deg, rgba(255, 255, 255, .16), rgba(255, 255, 255, 0) 42%), repeating-linear-gradient(45deg, rgba(0, 0, 0, .17) 0 2px, transparent 2px 10px), repeating-linear-gradient(-45deg, rgba(255, 255, 255, .11) 0 2px, transparent 2px 10px), linear-gradient(160deg, #c4122f, #86091d)"],
    ["arsenal", ["#ef0107"]],
    ["chelsea", ["#034694"]],
    ["tottenham|spurs", ["#ffffff", "#132257"], true],
    ["newcastle", ["#1b1b1b", "#ffffff"]],
    ["aston villa", ["#670e36", "#95bfe5"]],
    ["west ham", ["#7a263a", "#1bb1e7"]],
    ["everton", ["#003399"]],
    ["leicester|leicester city", ["#003090"]],
    // Allemagne
    ["bayern|bayern munich|bayern munchen|bayern de munich", ["#dc052d"]],
    ["dortmund|borussia dortmund", ["#fde100"], true],
    ["leverkusen|bayer leverkusen", ["#e32221", "#1b1b1b"]],
    ["leipzig|rb leipzig", ["#dd0741", "#ffffff"]],
    ["francfort|eintracht francfort|eintracht frankfurt", ["#e1000f", "#1b1b1b"]],
    ["wolfsburg", ["#65b32e"]],
    ["stuttgart|vfb stuttgart", ["#ffffff", "#e32219"], true],
    ["monchengladbach|mönchengladbach|gladbach", ["#1f8a3b", "#ffffff"]],
    // France
    ["psg|paris saint germain|paris sg|paris", ["#004170"]],
    ["marseille|olympique de marseille|om", ["#2faee0"], true],
    ["lyon|olympique lyonnais|ol", ["#1d3f8f", "#e2001a"]],
    ["monaco|as monaco", ["#e51b24", "#ffffff"]],
    ["lille|losc|losc lille", ["#e01e13", "#1d2c5e"]],
    ["rennes|stade rennais", ["#e13327", "#1b1b1b"]],
    ["lens|rc lens", ["#ffd100", "#e30613"], true],
    ["nice|ogc nice", ["#e2001a", "#1b1b1b"]],
    ["nantes", ["#ffd800", "#1f8a3b"], true],
    ["strasbourg|rc strasbourg", ["#009fe3"]],
    ["toulouse", ["#5e2a84"]],
    ["saint etienne|saint-étienne|st etienne|asse", ["#00a859"]],
    ["bordeaux|girondins de bordeaux", ["#00205b"]],
    // Italie
    ["juventus|juve", ["#ffffff", "#1b1b1b"], true],
    ["inter|inter milan|internazionale", ["#0068a8", "#1b1b1b"]],
    ["milan|ac milan", ["#e0001b", "#1b1b1b"]],
    ["naples|napoli|ssc napoli", ["#12a0d7"]],
    ["roma|as roma|rome", ["#8e1f2f", "#f0bc42"]],
    ["lazio|lazio rome", ["#87d8f7"], true],
    ["atalanta", ["#1e71b8", "#1b1b1b"]],
    ["fiorentina", ["#4b2e83"]],
    // Autres pays
    ["benfica|sl benfica", ["#e30613"]],
    ["porto|fc porto", ["#003893", "#ffffff"]],
    ["sporting|sporting cp|sporting lisbonne", ["#00805a", "#ffffff"]],
    ["ajax|ajax amsterdam", ["#ffffff", "#d2122e"], true],
    ["psv|psv eindhoven", ["#e30613"]],
    ["feyenoord", ["#e30613", "#ffffff"]],
    ["celtic|celtic glasgow", ["#138a3d", "#ffffff"]],
    ["rangers|glasgow rangers", ["#1b458f"]],
    ["galatasaray", ["#ffb300", "#a90432"], true],
    ["fenerbahce|fenerbahçe", ["#ffd400", "#0a2a5e"], true],
    ["besiktas|beşiktaş", ["#1b1b1b", "#ffffff"]],
    ["al nassr|al-nassr", ["#ffd200", "#003d7c"], true],
    ["al hilal|al-hilal", ["#0054a6"]],
    ["al ittihad|al-ittihad", ["#ffd200", "#1b1b1b"], true],
    ["boca juniors|boca", ["#0a3a82", "#f5c400"]],
    ["river plate|river", ["#ffffff", "#e30613"], true]
  ];
  const CLUB_NOISE_WORDS = new Set(["fc", "cf", "sc", "afc"]);

  function clubKey(value) {
    return String(value || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLocaleLowerCase("fr").replace(/[^a-z0-9]+/g, " ").trim()
      .split(" ").filter(word => !CLUB_NOISE_WORDS.has(word)).join(" ");
  }

  const CLUB_LOOKUP = (() => {
    const lookup = new Map();
    for (const [names, colors, light, custom] of CLUB_COLORS) {
      let background = custom || colors[0];
      if (!custom && colors.length > 1) {
        const stops = colors.map((color, index) => `${color} ${Math.round(50 + (index / (colors.length - 1) - .5) * 40)}%`);
        background = `linear-gradient(135deg, ${stops.join(", ")})`;
      }
      for (const name of names.split("|")) lookup.set(clubKey(name), { background, ink: light ? "#14231c" : "#ffffff" });
    }
    return lookup;
  })();

  function clubStyle(player) {
    const entry = CLUB_LOOKUP.get(clubKey(player?.club));
    return entry ? ` style="background:${entry.background};color:${entry.ink}"` : "";
  }

  function photoMarkup(photo, name) {
    return photo ? `<img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(name)}">` : escapeHtml(initials(name));
  }

  function playerRow(player, canManage) {
    const details = [player.nationality, player.club].filter(Boolean).join(" · ");
    const rating = hasRating(player) ? `<span class="rating-chip" title="Note sur 10">${formatRating(player.rating)}/10</span>` : "";
    const actions = canManage ? `<div class="row-actions"><button class="button secondary" data-action="edit-player" data-id="${escapeHtml(player.id)}" aria-label="Modifier ${escapeHtml(player.name)}">✎</button><button class="button danger" data-action="delete-player" data-id="${escapeHtml(player.id)}" aria-label="Supprimer ${escapeHtml(player.name)}">×</button></div>` : "";
    return `<article class="player-row"><div class="avatar"${clubStyle(player)}>${photoMarkup(player.photo, player.name)}</div><div class="player-main"><div class="player-name">${escapeHtml(player.name)}</div><div class="player-meta">${positionIcon(player.position)} ${escapeHtml(details)} ${rarityBadgeHtml(player)}</div></div><div class="row-side">${rating}${actions}</div></article>`;
  }

  function textKey(value) {
    return String(value || "").trim().toLocaleLowerCase("fr");
  }

  function distinctValues(field) {
    const values = new Map();
    for (const player of players) {
      const label = String(player[field] || "").trim();
      if (label && !values.has(textKey(label))) values.set(textKey(label), label);
    }
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr", { sensitivity: "base" }));
  }

  function sanitizeListFilters() {
    for (const field of ["club", "nationality"]) {
      const value = listFilters[field];
      if (value && value !== NO_VALUE_FILTER && !distinctValues(field).some(([key]) => key === value)) listFilters[field] = "";
    }
  }

  function visiblePlayers() {
    const matchesText = (player, field) => {
      const wanted = listFilters[field];
      if (!wanted) return true;
      const key = textKey(player[field]);
      return wanted === NO_VALUE_FILTER ? !key : key === wanted;
    };
    const filtered = players.filter(player =>
      (!listFilters.position || player.position === listFilters.position) &&
      (!listFilters.rarity || player.rarity === listFilters.rarity) &&
      matchesText(player, "club") &&
      matchesText(player, "nationality"));
    const direction = listSort.dir === "desc" ? -1 : 1;
    const compareText = (a, b) => String(a).localeCompare(String(b), "fr", { sensitivity: "base" });
    const sortValue = player => {
      if (listSort.key === "club") return textKey(player.club) ? String(player.club).trim() : null;
      if (listSort.key === "nationality") return textKey(player.nationality) ? String(player.nationality).trim() : null;
      if (listSort.key === "position") return POSITIONS.indexOf(player.position);
      if (listSort.key === "rarity") return RARITIES.findIndex(item => item.id === player.rarity);
      if (listSort.key === "rating") return hasRating(player) ? player.rating : null;
      return player.name;
    };
    return filtered.sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      let result = 0;
      if (left !== null) result = typeof left === "number" ? left - right : compareText(left, right);
      return result * direction || compareText(a.name, b.name);
    });
  }

  function playerListHtml(canManage, list = visiblePlayers()) {
    if (!players.length) return `<div class="empty-state">Aucun joueur dans la base partagée.</div>`;
    if (!list.length) return `<div class="empty-state">Aucun joueur ne correspond aux filtres.</div>`;
    return list.map(player => playerRow(player, canManage)).join("");
  }

  function playerCountText(list = visiblePlayers()) {
    const total = `${players.length} joueur${players.length > 1 ? "s" : ""}`;
    return list.length === players.length ? total : `${list.length} / ${total}`;
  }

  function listIsCustomized() {
    return Object.values(listFilters).some(Boolean) || listSort.key !== "name" || listSort.dir !== "asc";
  }

  function refreshPlayerList() {
    const container = root.querySelector("#player-list");
    if (!container) return;
    const list = visiblePlayers();
    container.innerHTML = playerListHtml(Boolean(currentAccount), list);
    const count = root.querySelector("#player-count");
    if (count) count.textContent = playerCountText(list);
    const reset = root.querySelector("#filters-reset");
    if (reset) reset.hidden = !listIsCustomized();
  }

  function sortDirLabel() {
    return listSort.dir === "asc" ? "↑" : "↓";
  }

  function compactSelectHtml(id, label, options, value) {
    return `<select id="${id}" aria-label="${label}">${options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}</select>`;
  }

  function listToolsHtml() {
    return `<div class="list-tools" role="group" aria-label="Tri et filtres des joueurs">
      ${compactSelectHtml("filter-position", "Poste", [["", "Tous les postes"], ...POSITIONS.map(position => [position, position])], listFilters.position)}
      ${compactSelectHtml("filter-rarity", "Rareté", [["", "Toutes les raretés"], ...RARITIES.map(item => [item.id, item.label])], listFilters.rarity)}
      ${compactSelectHtml("filter-club", "Club", [["", "Tous les clubs"], [NO_VALUE_FILTER, "Sans club"], ...distinctValues("club")], listFilters.club)}
      ${compactSelectHtml("filter-nationality", "Nationalité", [["", "Toutes les nationalités"], [NO_VALUE_FILTER, "Sans nationalité"], ...distinctValues("nationality")], listFilters.nationality)}
      ${compactSelectHtml("sort-key", "Trier par", SORT_OPTIONS.map(item => [item.id, `Tri : ${item.label}`]), listSort.key)}
      <button type="button" class="button secondary icon-button" id="sort-dir" data-action="sort-dir" aria-label="Inverser l’ordre du tri" title="Inverser l’ordre">${sortDirLabel()}</button>
      <button type="button" class="button quiet" id="filters-reset" data-action="filters-reset" ${listIsCustomized() ? "" : "hidden"}>✕ Réinitialiser</button>
    </div>`;
  }

  function renderSettings() {
    screen = "settings";
    const current = players.find(player => player.id === editingId);
    const canManage = Boolean(currentAccount);
    sanitizeListFilters();
    const visible = visiblePlayers();
    const rarityOptions = RARITIES.map(item => `<label class="segment"><input type="radio" name="rarity" value="${item.id}" ${(current?.rarity || "normal") === item.id ? "checked" : ""}><span>${item.label}</span></label>`).join("");
    const playerForm = `<details class="form-panel add-player" id="player-panel" ${current ? "open" : ""}><summary>${current ? "Modifier une fiche" : "Ajouter un joueur"}</summary>
      <form id="player-form">
        <div class="field"><label for="player-name">Nom *</label><input id="player-name" name="name" maxlength="80" required value="${escapeHtml(current?.name || "")}" placeholder="Nom du footballeur"></div>
        <div class="field-row">
          <div class="field"><label for="player-position">Poste *</label><select id="player-position" name="position" required>${POSITIONS.map(position => `<option value="${position}" ${current?.position === position ? "selected" : ""}>${position}</option>`).join("")}</select></div>
          <div class="field"><label for="player-rating">Note /10</label><input id="player-rating" name="rating" type="number" min="1" max="10" step="1" inputmode="numeric" value="${current && hasRating(current) ? current.rating : ""}" placeholder="1 à 10"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="player-nationality">Nationalité</label><input id="player-nationality" name="nationality" maxlength="60" value="${escapeHtml(current?.nationality || "")}" placeholder="Facultatif"></div>
          <div class="field"><label for="player-club">Club</label><input id="player-club" name="club" maxlength="60" value="${escapeHtml(current?.club || "")}" placeholder="Facultatif"></div>
        </div>
        <div class="field"><span class="field-label">Type de carte</span><div class="segmented" role="radiogroup" aria-label="Type de carte">${rarityOptions}</div></div>
        <div class="field"><label for="player-photo">Photo</label><div class="photo-field"><span class="photo-preview" id="photo-preview">${formPhoto || current?.photo ? `<img src="${escapeHtml(formPhoto || current.photo)}" alt="Aperçu de la photo">` : "📷"}</span><div class="photo-input"><input id="player-photo" name="photo" type="file" accept="image/*"><small id="photo-status">${formPhoto ? "Photo prête · elle sera enregistrée avec la fiche." : current?.photo ? "Photo actuelle · choisis un fichier pour la remplacer." : "Facultative · toute image est acceptée."}</small></div></div></div>
        <div class="form-actions"><button class="button" type="submit">${current ? "Enregistrer" : "Ajouter le joueur"}</button>${current ? `<button class="button secondary" type="button" data-action="cancel-edit">Annuler</button>` : ""}</div>
      </form></details>`;
    shell(`<section class="section-head"><div>${eyebrowHtml("Paramètres")}<h1 class="page-title">Joueurs</h1></div><div class="head-actions">${themeSwitchHtml()}${designSwitchHtml()}<button class="button secondary" data-action="home">← Menu</button></div></section>
      ${noticeHtml()}${inventoryBarHtml()}
      <div class="settings-stack">
        ${canManage ? playerForm : ""}
        <section class="list-panel">
          ${listToolsHtml()}
          <p class="list-count" id="player-count">${playerCountText(visible)}</p>
          <div class="player-list" id="player-list">${playerListHtml(canManage, visible)}</div>
        </section>
      </div>`);
  }

  function renderSetup() {
    screen = "setup";
    shell(`<section class="setup-layout"><div class="section-head"><div>${eyebrowHtml(setupSealed ? "Nouvelle partie · Mise cachée" : "Nouvelle partie")}<h1 class="page-title">${setupSealed ? "Mise cachée" : "Joueurs & budgets"}</h1></div><button class="button secondary" data-action="home">← Menu</button></div>
      ${noticeHtml()}${inventoryBarHtml(false, true)}
      <form class="setup-panel" id="setup-form"><h2>Pseudos</h2>
        <div class="budget-grid">
          <div class="field"><label for="name-left">Joueur de gauche</label><input id="name-left" name="leftName" maxlength="24" value="${escapeHtml(setupNames[0])}" required></div>
          <div class="field"><label for="name-right">Joueur de droite</label><input id="name-right" name="rightName" maxlength="24" value="${escapeHtml(setupNames[1])}" required></div>
        </div>
        <h2>Budget de départ</h2>
        <div class="budget-grid">
          <div class="field budget-field"><label for="budget-left">Joueur de gauche</label><input id="budget-left" name="leftBudget" type="number" min="0" max="1000000" step="1" value="20" required><span class="currency">cr.</span></div>
          <div class="field budget-field"><label for="budget-right">Joueur de droite</label><input id="budget-right" name="rightBudget" type="number" min="0" max="1000000" step="1" value="20" required><span class="currency">cr.</span></div>
        </div>
        <div class="mystery-settings">
          <label class="mystery-toggle" for="mystery-mode"><input id="mystery-mode" name="mystery" type="checkbox" ${setupMystery ? "checked" : ""}><span>Joueur mystère</span></label>
          <div class="field mystery-clue-field"><label for="mystery-clue">Caractéristiques à montrer</label><select id="mystery-clue" name="mysteryClue" ${setupMystery ? "" : "disabled"}><option value="club" ${setupMysteryClue === "club" ? "selected" : ""}>Club</option><option value="nationality" ${setupMysteryClue === "nationality" ? "selected" : ""}>Nationalité</option><option value="position" ${setupMysteryClue === "position" ? "selected" : ""}>Poste</option><option value="chaos" ${setupMysteryClue === "chaos" ? "selected" : ""}>Chaos · un indice aléatoire</option><option value="chaos-plus" ${setupMysteryClue === "chaos-plus" ? "selected" : ""}>Chaos+ · zéro à plusieurs indices</option></select></div>
        </div>
        ${setupSealed ? `<p class="subtle sealed-rules">Deux joueurs sur le même appareil. Pour chaque carte, chacun mise une seule fois, en secret et à tour de rôle : la plus haute mise gagne la carte et la paie. En cas d’égalité, la carte revient à celui qui a le moins de cartes, puis à celui qui a misé en second. Les budgets restent cachés pendant la partie.</p>` : ""}
        <button class="button" type="submit" ${inventoryShortages().ready ? "" : "disabled"}>Lancer la partie</button>
      </form></section>`);
  }

  function renderTakeSetup() {
    screen = "take-setup";
    shell(`<section class="setup-layout"><div class="section-head"><div>${eyebrowHtml("Nouvelle partie")}<h1 class="page-title">Prendre ou laisser</h1></div><button class="button secondary" data-action="home">← Menu</button></div>
      ${noticeHtml()}${inventoryBarHtml(false, true)}
      <form class="setup-panel" id="take-setup-form"><h2>Pseudos</h2>
        <div class="budget-grid">
          <div class="field"><label for="take-name-left">Joueur de gauche</label><input id="take-name-left" name="leftName" maxlength="24" value="${escapeHtml(setupNames[0])}" required></div>
          <div class="field"><label for="take-name-right">Joueur de droite</label><input id="take-name-right" name="rightName" maxlength="24" value="${escapeHtml(setupNames[1])}" required></div>
        </div>
        <button class="button" type="submit" ${inventoryShortages().ready ? "" : "disabled"}>Commencer</button>
      </form></section>`);
  }

  function teamCount(index, position) {
    return game.teams[index].filter(player => player.position === position).length;
  }

  function teamCanBuy(index, position) {
    return teamCount(index, position) < COUNTS[position];
  }

  function teamPanel(index, showBudget = true) {
    const team = game.teams[index];
    const active = game.turnIndex === index ? " active" : "";
    const classes = `team-panel ${index === 1 ? "right-team" : ""}${active}`;
    const acquired = team.length;
    return `<section class="${classes}" ${game.turnIndex === index ? 'aria-current="step"' : ""}><div class="team-heading"><div><h2>${escapeHtml(game.names[index])}</h2><div class="team-status">${acquired} / 7</div>${game.turnIndex === index ? `<span class="turn-badge">À toi</span>` : ""}</div>${showBudget ? `<div class="budget">${moneyHtml(game.budgets[index])}</div>` : ""}</div>
      ${showBudget ? `<div class="spending-line"><span>Dépensé</span><strong>${money(game.spent[index])}</strong></div>` : ""}
      <div class="progress-track"><div class="progress-fill" style="width:${Math.round(acquired / 7 * 100)}%"></div></div>
      <div class="position-list">${POSITIONS.map(position => {
        const entries = team.filter(player => player.position === position);
        const slots = Array.from({ length: COUNTS[position] }, (_, i) => entries[i]
          ? `<div class="roster-player"><span class="roster-dot"></span><span class="roster-name">${escapeHtml(entries[i].name)}</span>${rarityBadgeHtml(entries[i])}${hasRating(entries[i]) ? `<span class="rating-chip" title="Note sur 10">${formatRating(entries[i].rating)}/10</span>` : ""}</div>`
          : `<div class="roster-empty">Emplacement libre</div>`).join("");
        return `<div class="position-group"><div class="position-label"><span>${positionIcon(position)}</span><span>${entries.length} / ${COUNTS[position]}</span></div><div class="position-items">${slots}</div></div>`;
      }).join("")}</div></section>`;
  }

  function canDiscardCandidate() {
    if (!game || game.mode === "take-leave" || !game.candidate || game.highBid !== 0) return false;
    if (game.mode === "sealed" && (game.phase !== "bid" || game.placed !== 0)) return false;
    // Après la défausse, la réserve doit encore permettre de compléter les deux équipes.
    return POSITIONS.every(position => game.pool.filter(player => player.position === position).length >= 2 * COUNTS[position] - teamCount(0, position) - teamCount(1, position));
  }

  function candidateMarkup() {
    const player = game.candidate;
    if (game.mode === "take-leave" && !game.revealed) {
      return `<button type="button" class="mystery-mark reveal-button" data-action="reveal-candidate" aria-label="Révéler le joueur">?</button><h2 class="candidate-name">Joueur caché</h2><div class="candidate-detail">${positionIcon(player.position)} ${escapeHtml(player.position)}</div><p class="reveal-hint">Touche le ? pour le révéler</p>`;
    }
    if (game.mystery && !(game.mode === "sealed" && game.phase === "reveal")) {
      const clueText = game.currentClues.length
        ? game.currentClues.map(clue => `${clue.label} · ${clue.value}`).join(" · ")
        : "Aucun indice";
      return `<div class="mystery-mark" aria-hidden="true">?</div><h2 class="candidate-name">Joueur mystère</h2><div class="candidate-detail">${escapeHtml(clueText)}</div>`;
    }
    return `<div class="candidate-photo"${clubStyle(player)}>${photoMarkup(player.photo, player.name)}</div><h2 class="candidate-name">${escapeHtml(player.name)}</h2><div class="candidate-detail">${positionIcon(player.position)} ${escapeHtml([player.nationality, player.club].filter(Boolean).join(" · "))} ${rarityBadgeHtml(player)}</div>`;
  }

  function gameModeLabel() {
    return game.mode === "take-leave" ? "Prendre ou laisser" : game.mode === "sealed" ? "Mise cachée" : "Seven";
  }

  /* Mise cachée : même plateau que « Jouer », seule l'enchère change (une mise secrète chacun). */
  function renderSealedGame() {
    screen = "game";
    const g = game;
    const names = g.names;
    const revealing = g.phase === "reveal";
    const bidder = g.turnIndex;
    const completed = g.teams[0].length + g.teams[1].length - (revealing ? 1 : 0);
    const statusLines = names.map((name, i) => `<span class="${g.done[i] ? "done" : ""}">${escapeHtml(name)} · ${g.done[i] ? "mise posée ✓" : "en attente"}</span>`).join("");
    const discardButton = g.placed === 0
      ? `<button type="button" class="button secondary discard-button" data-action="discard" ${canDiscardCandidate() ? "" : "disabled title=\"Pas assez de joueurs en réserve pour défausser\""}>Défausse</button>`
      : "";
    const box = revealing
      ? `<div class="bid-box"><div class="bid-line"><span>Résultat</span><span>Mises scellées</span></div><div class="bid-value hb-sealed">${g.reveal.tied ? "Égalité" : "Adjugé"}</div><div class="turn-note" aria-live="polite">${escapeHtml(sealedOutcomeText())}</div><div class="bid-controls forced"><button class="button warning" type="button" data-action="hb-next" data-autofocus>${g.teams[0].length === 7 && g.teams[1].length === 7 ? "Voir le résultat" : "Carte suivante"}</button></div></div>`
      : `<div class="bid-box"><div class="bid-line"><span>Mises scellées</span><span>1 mise chacun</span></div><div class="bid-value hb-sealed">Mise secrète</div><div class="hb-status">${statusLines}</div><div class="turn-note" aria-live="polite">Au tour de ${escapeHtml(names[bidder])}. Une seule mise, secrète : la plus haute gagne la carte.</div>
          <form class="bid-controls" id="sealed-bid-form" autocomplete="off" novalidate><input id="bid-amount" name="amount" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-label="Montant de la mise de ${escapeHtml(names[bidder])}" placeholder="0" data-autofocus><button class="button warning" type="submit">Miser</button><button class="button secondary" type="button" data-action="hb-balance" aria-pressed="false">Mon solde</button>${discardButton}</form>
          <div class="hb-feedback" id="hb-balance" aria-live="polite"></div><div class="hb-feedback hb-error" id="hb-error" role="alert"></div></div>`;
    shell(`<section class="game-top"><div><div class="eyebrow">Enchère ${Math.floor(completed / 2) + 1}</div><h1 class="page-title">${revealing ? "Résultat" : `${escapeHtml(names[bidder])} joue`}</h1><p class="subtle">${g.teams[0].length + g.teams[1].length} / 14 attribués${g.discarded ? ` · ${g.discarded} défaussé${g.discarded > 1 ? "s" : ""}` : ""}</p></div><button class="button danger" data-action="cancel-game">Quitter</button></section>
      <div class="game-layout">${teamPanel(0, false)}
        <section class="center-stage"><div class="center-label">Aux enchères</div>${candidateMarkup()}${box}</section>${teamPanel(1, false)}</div>
      <div class="game-actions"><button class="button secondary" data-action="restart-game">Recommencer</button></div>`);
    afterModeRender();
  }

  function sealedOutcomeText() {
    const { winner, tied, reason } = game.reveal;
    const name = game.names[winner];
    if (!tied) return `${name} remporte le footballeur.`;
    return reason === "fewest" ? `Égalité : ${name} remporte le footballeur, car il a le moins de cartes.` : `Égalité : ${name} remporte le footballeur, car il a misé en second.`;
  }

  function sealedError(message) {
    const el = root.querySelector("#hb-error");
    if (el) el.textContent = message;
    const input = root.querySelector("#bid-amount");
    if (input) { input.focus(); input.select(); }
  }

  function sealedToggleBalance(button) {
    const g = game;
    if (!g || g.mode !== "sealed" || g.phase !== "bid") return;
    g.showBalance = !g.showBalance;
    button.setAttribute("aria-pressed", String(g.showBalance));
    const el = root.querySelector("#hb-balance");
    if (el) el.textContent = g.showBalance ? `Ton solde : ${money(g.budgets[g.turnIndex])}` : "";
  }

  function sealedSubmitBid(form) {
    const g = game;
    if (!g || g.mode !== "sealed" || g.phase !== "bid" || !g.candidate) return;
    const bidder = g.turnIndex;
    if (g.done[bidder]) { sealedError("Tu as déjà misé sur cette carte."); return; }
    const raw = String(new FormData(form).get("amount") || "").trim();
    if (raw === "") { sealedError("Saisis un montant."); return; }
    if (!/^\d+$/.test(raw)) { sealedError("Le montant doit être un nombre entier positif ou zéro (sans virgule ni signe)."); return; }
    const amount = Number(raw);
    if (!Number.isSafeInteger(amount)) { sealedError("Ce montant est trop grand."); return; }
    if (amount > g.budgets[bidder]) { sealedError("Mise refusée : elle dépasse ton solde disponible."); return; }
    g.bids[bidder] = amount;
    g.done[bidder] = true;
    g.placed++;
    g.showBalance = false;
    if (g.placed === 2) sealedResolve();
    else g.turnIndex = 1 - bidder;
    renderGame();
  }

  function sealedResolve() {
    const g = game;
    const [a, b] = g.bids;
    let winner = a > b ? 0 : b > a ? 1 : -1;
    const tied = winner < 0;
    let reason = "";
    if (tied) {
      const [x, y] = g.teams.map(team => team.length);
      if (x !== y) { winner = x < y ? 0 : 1; reason = "fewest"; }
      else { winner = 1 - g.opener; reason = "second"; }
    }
    const paid = g.bids[winner];
    g.teams[winner].push(g.candidate);
    g.budgets[winner] -= paid;
    g.spent[winner] += paid;
    g.bids = [null, null]; // les montants ne sont pas conservés : seuls budget et dépense totale le sont
    g.reveal = { winner, tied, reason };
    g.phase = "reveal";
    g.turnIndex = -1;
  }

  function sealedNext() {
    if (!game || game.mode !== "sealed" || game.phase !== "reveal") return;
    game.candidate = null;
    notice = "";
    nextAuction();
  }

  function renderGame() {
    screen = "game";
    if (game.mode === "take-leave") {
      renderPickGame();
      return;
    }
    if (!game.candidate) {
      if (game.teams[0].length === 7 && game.teams[1].length === 7) renderResults();
      else renderBlocked();
      return;
    }
    if (game.mode === "sealed") {
      renderSealedGame();
      return;
    }
    const player = game.candidate;
    const bidder = game.turnIndex;
    const bidderCanRaise = game.budgets[bidder] >= game.highBid + 1 && teamCanBuy(bidder, player.position);
    const bidderName = game.names[bidder];
    const leaderName = game.names[game.leaderIndex];
    const turnText = !teamCanBuy(bidder, player.position)
      ? `${bidderName} a complété ce poste. ${leaderName} remporte le footballeur pour ${money(game.highBid)}.`
      : !bidderCanRaise
      ? `${bidderName} ne peut pas dépasser ${money(game.highBid)}. ${leaderName} remporte le footballeur pour ${money(game.highBid)}.`
      : `Au tour de ${bidderName}. En se retirant, ${bidderName} laisse le footballeur à ${leaderName} pour ${money(game.highBid)}.`;
    const discardButton = game.highBid === 0
      ? `<button class="button secondary discard-button" data-action="discard" ${canDiscardCandidate() ? "" : "disabled title=\"Pas assez de joueurs en réserve pour défausser\""}>Défausse</button>`
      : "";
    const bidControls = bidderCanRaise
      ? `<div class="bid-controls"><input id="bid-amount" aria-label="Montant de la surenchère" type="number" min="${game.highBid + 1}" max="${game.budgets[bidder]}" step="1" value="${Math.min(game.highBid + 1, game.budgets[bidder])}"><button class="button warning" data-action="raise">Enchérir</button><button class="button secondary" data-action="pass">Laisser à ${escapeHtml(leaderName)}</button>${discardButton}</div>`
      : `<div class="bid-controls forced"><button class="button warning" data-action="finish-auction">Laisser à ${escapeHtml(leaderName)}</button></div>`;
    const completed = game.teams[0].length + game.teams[1].length;
    shell(`<section class="game-top"><div><div class="eyebrow">Enchère ${Math.floor(completed / 2) + 1}</div><h1 class="page-title">${escapeHtml(bidderName)} joue</h1><p class="subtle">${completed} / 14 attribués${game.discarded ? ` · ${game.discarded} défaussé${game.discarded > 1 ? "s" : ""}` : ""}</p></div><button class="button danger" data-action="cancel-game">Quitter</button></section>
      <div class="game-layout">${teamPanel(0)}
        <section class="center-stage"><div class="center-label">Aux enchères</div>${candidateMarkup()}
          <div class="bid-box"><div class="bid-line"><span>Offre de ${escapeHtml(leaderName)}</span><span>+1 minimum</span></div><div class="bid-value">${moneyHtml(game.highBid)}</div><div class="turn-note" aria-live="polite">${escapeHtml(turnText)}</div>${bidControls}</div>
        </section>${teamPanel(1)}</div>
      <div class="game-actions"><button class="button secondary" data-action="restart-game">Recommencer</button></div>`);
    if (!bidderCanRaise) window.setTimeout(() => { if (screen === "game" && game && game.candidate === player && game.turnIndex === bidder) awardPlayer(); }, 1800);
  }

  function renderPickGame() {
    if (!game.candidate) {
      if (game.teams[0].length === 7 && game.teams[1].length === 7) renderResults();
      else renderBlocked();
      return;
    }
    const pickerName = game.names[game.turnIndex];
    const completed = game.teams[0].length + game.teams[1].length;
    shell(`<section class="game-top"><div><div class="eyebrow">Prendre ou laisser · ${completed} / 14</div><h1 class="page-title">${escapeHtml(pickerName)} choisit</h1></div><button class="button danger" data-action="cancel-game">Quitter</button></section>
      <div class="game-layout">${teamPanel(0, false)}
        <section class="center-stage"><div class="center-label">À attribuer</div>${candidateMarkup()}
          <div class="pick-controls"><button class="button pick-choice left-choice" data-action="assign-left"><span aria-hidden="true">←</span> Attribuer à ${escapeHtml(game.names[0])}</button><button class="button pick-choice right-choice" data-action="assign-right">Attribuer à ${escapeHtml(game.names[1])} <span aria-hidden="true">→</span></button></div>
        </section>${teamPanel(1, false)}</div>
      <div class="game-actions"><button class="button secondary" data-action="restart-game">Recommencer</button></div>`);
  }

  function formationPlayer(player, side, role, x, y) {
    return `<div class="formation-player ${side}-formation ${role}" style="left:${x}%;top:${y}%" title="${escapeHtml(player.name)} · ${escapeHtml(player.position)}" aria-label="${escapeHtml(player.name)}, ${escapeHtml(player.position)}"><span class="formation-avatar${player.rarity === "legend" || player.rarity === "mythic" ? ` aura-${player.rarity}` : ""}"${clubStyle(player)}>${photoMarkup(player.photo, player.name)}</span><span class="formation-name">${escapeHtml(player.name)}</span></div>`;
  }

  function tacticalFormation() {
    const layouts = [
      { side: "left", positions: { Gardien: [[3, 50]], Defenders: [[22, 23], [22, 50], [22, 77]], Midfielder: [[40, 50]], Attackers: [[44, 38], [44, 62]] } },
      { side: "right", positions: { Gardien: [[97, 50]], Defenders: [[78, 23], [78, 50], [78, 77]], Midfielder: [[60, 50]], Attackers: [[56, 38], [56, 62]] } }
    ];
    const roleMap = { Gardien: "goalkeeper", Defenders: "defender", Midfielder: "midfielder", Attackers: "attacker" };
    const markers = layouts.map((layout, teamIndex) => Object.entries(layout.positions).map(([key, points]) => {
      const position = key === "Defenders" ? "Défenseur" : key === "Midfielder" ? "Milieu" : key === "Attackers" ? "Attaquant" : "Gardien";
      return game.teams[teamIndex].filter(player => player.position === position).map((player, index) => {
        const [x, y] = points[index];
        return formationPlayer(player, layout.side, roleMap[key], x, y);
      }).join("");
    }).join("")).join("");
    return `<section class="formation-section"><div class="formation-heading"><h2>Composition sur le terrain</h2><div class="formation-teams"><span class="left-team-label">${escapeHtml(game.names[0])}</span><span class="right-team-label">${escapeHtml(game.names[1])}</span></div></div><div class="tactical-pitch" aria-label="Schéma tactique des deux équipes"><div class="pitch-lines" aria-hidden="true"><span class="pitch-center-line"></span><span class="pitch-center-circle"></span><span class="pitch-box left-box"></span><span class="pitch-box right right-box"></span></div>${markers}</div></section>`;
  }

  function renderResults() {
    screen = "results";
    const resultTeam = index => `<section class="result-panel"><h2>${escapeHtml(game.names[index])}</h2>${game.mode === "take-leave" ? "" : `<div class="result-total"><span>Budget restant</span><strong>${money(game.budgets[index])}</strong></div><div class="result-total"><span>Dépensé</span><strong>${money(game.spent[index])}</strong></div>`}<div class="result-roster">${POSITIONS.map(position => game.teams[index].filter(player => player.position === position).map(player => `<div class="result-player"><span>${positionIcon(position)} ${escapeHtml(player.name)} ${rarityBadgeHtml(player)}</span><small>${hasRating(player) ? `${formatRating(player.rating)}/10` : "—"}</small></div>`).join("")).join("")}</div>${teamAverageHtml(game.teams[index])}</section>`;
    shell(`<section class="section-head"><div><div class="eyebrow">${gameModeLabel()} · Partie terminée</div><h1 class="page-title">Équipes au complet.</h1></div><button class="button secondary" data-action="home">Menu principal</button></section>
      ${noticeHtml()}<div class="results-layout">${resultTeam(0)}${resultTeam(1)}</div>${tacticalFormation()}
      <div class="game-actions"><button class="button" data-action="restart-game">Rejouer</button><button class="button secondary" data-action="${game.mode === "take-leave" ? "take-setup" : game.mode === "sealed" ? "hb-setup" : "setup"}">Nouvelle partie</button></div>`);
  }

  function renderBlocked() {
    screen = "blocked";
    shell(`<section class="section-head"><div><div class="eyebrow">${gameModeLabel()} · Partie interrompue</div><h1 class="page-title">Composition incomplète.</h1><p class="subtle">${escapeHtml(game.blockedReason || "La partie ne peut pas continuer avec les joueurs disponibles.")}</p></div><button class="button secondary" data-action="home">Menu principal</button></section>
      <div class="results-layout">${[0, 1].map(index => `<section class="result-panel"><h2>${escapeHtml(game.names[index])}</h2><div class="result-total"><span>Effectif</span><strong>${game.teams[index].length} / 7</strong></div>${game.mode === "take-leave" ? "" : `<div class="result-total"><span>Budget restant</span><strong>${money(game.budgets[index])}</strong></div><div class="result-total"><span>Dépensé</span><strong>${money(game.spent[index])}</strong></div>`}<div class="result-roster">${POSITIONS.map(position => game.teams[index].filter(player => player.position === position).map(player => `<div class="result-player"><span>${positionIcon(position)} ${escapeHtml(player.name)}</span></div>`).join("")).join("")}</div></section>`).join("")}</div>
      <div class="game-actions"><button class="button" data-action="restart-game">Recommencer</button><button class="button secondary" data-action="settings">Vérifier la base</button></div>`);
  }

  /* ==========================================================================
     Nouveaux modes : « Qui suis-je ? », « Défi de composition », « Mise cachée ».
     Tout est local à l'appareil : aucune écriture vers Firebase ni vers la base
     partagée. Seuls les préférences et les records sont gardés dans localStorage
     (clés seven-whoami-v1 et seven-compose-v1). « Mise cachée » réutilise le mode Jouer.
     ========================================================================== */
  const WHOAMI_KEY = "seven-whoami-v1";
  const COMPOSE_KEY = "seven-compose-v1";
  let modeTimer = null;
  let whoami = null;
  let whDraft = null;
  let compose = null;
  let cpDraft = null;

  function stopModeTimer() {
    if (modeTimer) { clearInterval(modeTimer); modeTimer = null; }
  }

  function loadLocal(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function saveLocal(key, patch) {
    safeSetItem(key, JSON.stringify({ ...loadLocal(key), ...patch }));
  }

  function intIn(value, min, max, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
  }

  function normText(value) {
    return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function withinOneEdit(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }

  function pluralFr(count, one, many) {
    return `${count} ${count > 1 ? many : one}`;
  }

  function modeHead(eyebrow, title, action = "home", label = "← Menu") {
    return `<div class="section-head"><div>${eyebrowHtml(eyebrow)}<h1 class="page-title">${title}</h1>${isProto() ? "" : `<p class="subtle m-kicker">${eyebrow}</p>`}</div><button class="button secondary" type="button" data-action="${action}">${label}</button></div>`;
  }

  function nameFieldsHtml(prefix, names, count) {
    return `<div class="m-names">${Array.from({ length: count }, (_, i) => `<div class="field"><label for="${prefix}-${i}">Pseudo ${count > 1 ? i + 1 : ""}</label><input id="${prefix}-${i}" name="name${i}" maxlength="24" autocomplete="off" value="${escapeHtml(names[i] || "")}" required></div>`).join("")}</div>`;
  }

  function readNames(form, count, fallback) {
    const data = new FormData(form);
    return Array.from({ length: count }, (_, i) => data.has(`name${i}`) ? String(data.get(`name${i}`)).trim() : (fallback[i] || ""));
  }

  function distinctNames(names) {
    const keys = names.map(name => name.toLocaleLowerCase("fr"));
    return names.every(Boolean) && new Set(keys).size === keys.length;
  }

  function cardMiniHtml(player, extra = "") {
    const details = [player.nationality, player.club].filter(Boolean).join(" · ");
    return `<div class="m-card-mini"><div class="avatar"${clubStyle(player)}>${photoMarkup(player.photo, player.name)}</div><div class="player-main"><div class="player-name">${escapeHtml(player.name)}</div><div class="player-meta">${positionIcon(player.position)} ${escapeHtml(details)} ${rarityBadgeHtml(player)}</div></div>${hasRating(player) ? `<span class="rating-chip" title="Note sur 10">${formatRating(player.rating)}/10</span>` : ""}${extra}</div>`;
  }

  function afterModeRender() {
    const target = root.querySelector("[data-autofocus]");
    if (target && target.focus) target.focus({ preventScroll: true });
  }

  function modeMenuItems() {
    return [
      { action: "wh-setup", title: "Qui suis-je ?", sub: "Devine la carte cachée", subProto: "Indices progressifs" },
      { action: "cp-setup", title: "Défi de composition", sub: "Un objectif, une équipe", subProto: "Respecte l’objectif" },
      { action: "hb-setup", title: "Mise cachée", sub: "Enchères scellées à deux", subProto: "Mises secrètes" }
    ];
  }

  /* ---------------------------------------------------------------- Qui suis-je ? */

  function whPrefs() {
    const saved = loadLocal(WHOAMI_KEY).prefs || {};
    const names = Array.isArray(saved.names) ? saved.names : [];
    return {
      count: intIn(saved.count, 1, 6, 1),
      names: Array.from({ length: 6 }, (_, i) => String(names[i] || `Joueur ${i + 1}`).slice(0, 24)),
      flow: saved.flow === "sim" ? "sim" : "turns",
      rounds: intIn(saved.rounds, 1, 20, 5),
      duration: intIn(saved.duration, 15, 180, 45),
      target: intIn(saved.target, 1, 200, 0)
    };
  }

  function whBestKey(cfg) {
    return `${cfg.flow}-${cfg.rounds}`;
  }

  function whDefaultTarget(rounds) {
    return rounds * 6;
  }

  function readWhForm(form) {
    const data = new FormData(form);
    const draft = { ...whDraft };
    draft.count = intIn(data.get("count"), 1, 6, draft.count);
    draft.flow = data.get("flow") === "sim" ? "sim" : "turns";
    draft.rounds = intIn(data.get("rounds"), 1, 20, draft.rounds);
    draft.duration = intIn(data.get("duration"), 15, 180, draft.duration);
    draft.target = intIn(data.get("target"), 1, 200, 0);
    draft.names = draft.names.map((name, i) => data.has(`name${i}`) ? String(data.get(`name${i}`)).trim() : name);
    return draft;
  }

  function renderWhoamiSetup() {
    screen = "wh-setup";
    stopModeTimer();
    whDraft = whDraft || whPrefs();
    const d = whDraft;
    const eligible = players.filter(player => player.name).length;
    const best = loadLocal(WHOAMI_KEY).best || {};
    const bestValue = best[whBestKey(d)];
    shell(`<section class="setup-layout">${modeHead("Nouveau mode", "Qui suis-je ?")}
      ${noticeHtml()}
      ${eligible ? "" : `<div class="notice error" role="status">La base ne contient aucune carte. Ajoute des joueurs dans Paramètres.</div>`}
      <form class="setup-panel" id="wh-setup-form" novalidate>
        <h2>Participants</h2>
        <div class="field m-narrow"><label for="wh-count">Nombre de participants</label><select id="wh-count" name="count">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === d.count ? "selected" : ""}>${n === 1 ? "1 · solo" : n}</option>`).join("")}</select></div>
        ${nameFieldsHtml("wh-name", d.names, d.count)}
        <h2>Déroulement</h2>
        <div class="m-choice" role="radiogroup" aria-label="Déroulement">
          <label class="m-choice-item"><input type="radio" name="flow" value="turns" ${d.flow === "turns" ? "checked" : ""}><span><strong>Tour par tour</strong><small>À ton tour : propose un nom ou demande l’indice suivant.</small></span></label>
          <label class="m-choice-item"><input type="radio" name="flow" value="sim" ${d.flow === "sim" ? "checked" : ""}><span><strong>Simultané · chrono</strong><small>Réponses cachées avant la fin du compte à rebours, révélées ensemble.</small></span></label>
        </div>
        <div class="budget-grid">
          <div class="field"><label for="wh-rounds">Nombre de manches</label><input id="wh-rounds" name="rounds" type="number" min="1" max="20" step="1" value="${d.rounds}"></div>
          <div class="field"><label for="wh-duration">Durée d’une manche (chrono, en secondes)</label><input id="wh-duration" name="duration" type="number" min="15" max="180" step="5" value="${d.duration}"></div>
        </div>
        ${d.count === 1 ? `<div class="field m-narrow"><label for="wh-target">Objectif de score (solo)</label><input id="wh-target" name="target" type="number" min="1" max="${d.rounds * 10}" step="1" placeholder="${whDefaultTarget(d.rounds)}" value="${d.target || ""}"><small>${bestValue !== undefined ? `Meilleur score local avec ces réglages : ${bestValue} pts.` : "Laisse vide pour l’objectif proposé. Ton meilleur score est gardé sur cet appareil."}</small></div>` : ""}
        <div class="m-rules"><strong>Règles</strong><ul>
          <li>Une carte de la base reste cachée. Les indices apparaissent un par un : poste, nationalité, club, note, type de carte, initiales, puis photo floutée (seulement ceux que la carte possède).</li>
          <li>Bonne réponse : 10 points avec un seul indice, de moins en moins à chaque indice supplémentaire (1 point minimum). Mauvaise réponse : 0 point et sortie de la manche.</li>
          <li>Une carte ne revient pas tant que toutes les cartes de la base n’ont pas été tirées. Les cartes Légende et Mythique peuvent sortir.</li>
        </ul></div>
        <button class="button" type="submit" ${eligible ? "" : "disabled"}>Lancer la partie</button>
      </form></section>`);
  }

  function whDeck(rounds, eligible) {
    const saved = loadLocal(WHOAMI_KEY);
    const seen = new Set(Array.isArray(saved.seen) ? saved.seen : []);
    const take = Math.min(rounds, eligible.length);
    let deck = shuffled(eligible.filter(player => !seen.has(player.id))).slice(0, take);
    let nextSeen;
    if (deck.length < take) {
      const taken = new Set(deck.map(player => player.id));
      const rest = shuffled(eligible.filter(player => !taken.has(player.id))).slice(0, take - deck.length);
      deck = [...deck, ...rest];
      nextSeen = rest.map(player => player.id);
    } else {
      nextSeen = [...seen, ...deck.map(player => player.id)];
    }
    saveLocal(WHOAMI_KEY, { seen: nextSeen });
    return deck;
  }

  function whClues(player) {
    const clues = [{ key: "position", label: "Poste", value: player.position }];
    if (String(player.nationality || "").trim()) clues.push({ key: "nationality", label: "Nationalité", value: String(player.nationality).trim() });
    if (String(player.club || "").trim()) clues.push({ key: "club", label: "Club", value: String(player.club).trim() });
    if (hasRating(player)) clues.push({ key: "rating", label: "Note", value: `${formatRating(player.rating)} / 10` });
    clues.push({ key: "rarity", label: "Type de carte", value: rarityLabel(player.rarity) });
    const letters = String(player.name).trim().split(/\s+/).map(part => `${part[0].toLocaleUpperCase("fr")}.`).join(" ");
    clues.push({ key: "initials", label: "Initiales", value: letters });
    if (player.photo) clues.push({ key: "photo", label: "Photo floutée", value: player.photo });
    return clues;
  }

  function whPoints(shown) {
    const total = whoami.round.clues.length;
    return Math.max(1, Math.round(10 * (total - shown + 1) / total));
  }

  function whMatches(guess, player) {
    const g = normText(guess);
    if (g.length < 2) return false;
    const full = normText(player.name);
    if (g === full) return true;
    if (g.length >= 6 && full.length >= 6 && withinOneEdit(g, full)) return true;
    const parts = full.split(" ");
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (last.length >= 3 && (g === last || (g.length >= 6 && withinOneEdit(g, last)))) return true;
    }
    return false;
  }

  function whCluesHtml(round, revealAll = false) {
    const shown = revealAll ? round.clues.length : round.shown;
    return `<ol class="m-clues">${round.clues.map((clue, i) => {
      if (i >= shown) return `<li class="m-clue locked"><span>Indice ${i + 1}</span><b>Caché</b></li>`;
      const value = clue.key === "photo"
        ? `<span class="m-blur"><img src="${escapeHtml(clue.value)}" alt="Photo floutée du joueur à deviner"></span>`
        : `<b>${escapeHtml(clue.value)}</b>`;
      return `<li class="m-clue"><span>${escapeHtml(clue.label)}</span>${value}</li>`;
    }).join("")}</ol>`;
  }

  function whScoreboardHtml() {
    const cfg = whoami.cfg;
    return `<div class="m-scores" aria-label="Scores">${cfg.names.map((name, i) => `<div class="m-score${whoami.round && whoami.round.phase === "play" && cfg.flow === "turns" && whoami.round.turn === i ? " active" : ""}"><span>${escapeHtml(name)}</span><strong>${whoami.scores[i]}</strong></div>`).join("")}</div>`;
  }

  function whMysteryHtml(round) {
    return `<div class="m-mystery" role="img" aria-label="Carte cachée"><span>?</span></div>`;
  }

  function whAnswerRevealHtml(round) {
    const w = whoami;
    const lines = [];
    if (w.cfg.flow === "sim") {
      for (let i = 0; i < w.cfg.names.length; i++) {
        const a = round.answers[i];
        const status = a ? (a.ok ? `<b class="m-ok">+${a.points} pt${a.points > 1 ? "s" : ""}</b>` : `<b class="m-ko">0 pt</b>`) : `<b class="m-ko">Pas de réponse</b>`;
        lines.push(`<li><span>${escapeHtml(w.cfg.names[i])}</span><em>${a ? `« ${escapeHtml(a.text)} »` : "—"}</em>${status}</li>`);
      }
    }
    const headline = round.winner >= 0 ? `${escapeHtml(w.cfg.names[round.winner])} trouve la carte${w.cfg.flow === "turns" ? ` et marque ${round.points} point${round.points > 1 ? "s" : ""}` : ""}.` : "Personne n’a trouvé la carte.";
    return `<div class="m-reveal"><p class="m-reveal-line">${headline}</p>${cardMiniHtml(round.card)}${lines.length ? `<ul class="m-answers">${lines.join("")}</ul>` : ""}</div>`;
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  function renderWhoamiPlay() {
    screen = "wh-play";
    const w = whoami;
    const r = w.round;
    const names = w.cfg.names;
    const done = r.phase === "done";
    let body;
    if (done) {
      const last = w.index + 1 >= w.cfg.rounds;
      body = `<div class="m-stage">${whAnswerRevealHtml(r)}<div id="wh-clues">${whCluesHtml(r, true)}</div></div>
        <div class="game-actions"><button class="button" type="button" data-action="wh-next" data-autofocus>${last ? "Voir le résultat" : "Manche suivante"}</button></div>`;
    } else if (w.cfg.flow === "turns") {
      const turnName = names[r.turn];
      const canClue = r.shown < r.clues.length;
      body = `<div class="m-stage">${whMysteryHtml(r)}
        <p class="m-turn"><span>Au tour de</span> <strong>${escapeHtml(turnName)}</strong></p>
        ${r.log ? `<p class="m-log" role="status">${escapeHtml(r.log)}</p>` : ""}
        <div id="wh-clues">${whCluesHtml(r)}</div>
        <p class="m-points-hint">Une bonne réponse maintenant vaut <strong>${whPoints(r.shown)} pt${whPoints(r.shown) > 1 ? "s" : ""}</strong>.</p>
        <form class="m-guess" id="wh-guess-form" autocomplete="off"><label class="visually-hidden" for="wh-guess">Nom du joueur</label><input id="wh-guess" name="guess" maxlength="60" placeholder="Nom du joueur…" autocomplete="off" data-autofocus><button class="button" type="submit">Proposer</button></form>
        <div class="m-actions"><button class="button secondary" type="button" data-action="wh-clue" ${canClue ? "" : "disabled"}>Indice suivant</button><button class="button quiet" type="button" data-action="wh-pass">Passer la manche</button></div>
      </div>`;
    } else {
      body = `<div class="m-stage">${whMysteryHtml(r)}
        <div class="m-timer" aria-hidden="true"><div class="m-timer-bar"><i id="wh-bar"></i></div><strong id="wh-clock">${formatClock(r.endsAt - Date.now())}</strong></div>
        <p class="m-points-hint" id="wh-hint">Réponse maintenant : <strong>${whPoints(r.shown)} pt${whPoints(r.shown) > 1 ? "s" : ""}</strong> · réponses cachées, révélées ensemble.</p>
        <div id="wh-clues">${whCluesHtml(r)}</div>
        <div class="m-sim-answers">${names.map((name, i) => {
          const a = r.answers[i];
          return `<form class="m-sim-form${a ? " locked" : ""}" data-wh-sim="${i}" autocomplete="off"><label for="wh-sim-${i}">${escapeHtml(name)}</label>${a ? `<p class="m-locked">Réponse enregistrée ✓</p>` : `<div class="m-sim-row"><input id="wh-sim-${i}" type="password" maxlength="60" autocomplete="off" placeholder="Ta réponse (masquée)" ${i === 0 && names.length === 1 ? "data-autofocus" : ""}><button class="button" type="submit">Valider</button></div>`}</form>`;
        }).join("")}</div>
      </div>`;
    }
    shell(`<section class="setup-layout m-wide">${modeHead(`Qui suis-je ? · Manche ${w.index + 1} / ${w.cfg.rounds}`, "Qui suis-je ?", "m-quit", "Quitter")}${noticeHtml()}${whScoreboardHtml()}${body}</section>`);
    afterModeRender();
    if (!done && w.cfg.flow === "sim") startWhoamiTimer();
  }

  function startWhoamiTimer() {
    stopModeTimer();
    const tick = () => {
      const w = whoami;
      if (!w || screen !== "wh-play" || !w.round || w.round.phase !== "play" || w.cfg.flow !== "sim") { stopModeTimer(); return; }
      const r = w.round;
      const left = r.endsAt - Date.now();
      if (left <= 0) { finishWhoamiSim(); return; }
      const clock = root.querySelector("#wh-clock");
      if (clock) clock.textContent = formatClock(left);
      const bar = root.querySelector("#wh-bar");
      if (bar) bar.style.width = `${Math.max(0, left / (w.cfg.duration * 1000)) * 100}%`;
      const interval = (w.cfg.duration * 1000) / r.clues.length;
      const shown = Math.min(r.clues.length, 1 + Math.floor((Date.now() - r.startedAt) / interval));
      if (shown !== r.shown) {
        r.shown = shown;
        const box = root.querySelector("#wh-clues");
        if (box) box.innerHTML = whCluesHtml(r);
        const hint = root.querySelector("#wh-hint");
        if (hint) hint.innerHTML = `Réponse maintenant : <strong>${whPoints(r.shown)} pt${whPoints(r.shown) > 1 ? "s" : ""}</strong> · réponses cachées, révélées ensemble.`;
      }
    };
    modeTimer = setInterval(tick, 250);
    tick();
  }

  function whNextRound() {
    const w = whoami;
    if (w.index >= w.cfg.rounds) { renderWhoamiEnd(); return; }
    const card = w.deck[w.index];
    const clues = whClues(card);
    w.round = { card, clues, shown: 1, phase: "play", turn: w.index % w.cfg.names.length, eliminated: [], winner: -1, points: 0, log: "", answers: [], startedAt: Date.now(), endsAt: Date.now() + w.cfg.duration * 1000 };
    if (w.index > 0) notice = "";
    renderWhoamiPlay();
  }

  function whFinishRound(winner, points) {
    const w = whoami;
    stopModeTimer();
    w.round.phase = "done";
    w.round.winner = winner;
    w.round.points = points;
    if (winner >= 0 && w.cfg.flow === "turns") w.scores[winner] += points;
    renderWhoamiPlay();
  }

  function finishWhoamiSim() {
    const w = whoami;
    const r = w.round;
    if (!r || r.phase !== "play") return;
    for (let i = 0; i < w.cfg.names.length; i++) {
      if (r.answers[i]) continue;
      const text = String(root.querySelector(`#wh-sim-${i}`)?.value || "").trim();
      if (text) r.answers[i] = { text, k: r.shown };
    }
    let best = -1;
    for (let i = 0; i < w.cfg.names.length; i++) {
      const a = r.answers[i];
      if (!a) continue;
      a.ok = whMatches(a.text, r.card);
      a.points = a.ok ? whPoints(a.k) : 0;
      if (a.ok) {
        w.scores[i] += a.points;
        if (best < 0 || a.points > r.answers[best].points) best = i;
      }
    }
    whFinishRound(best, best >= 0 ? r.answers[best].points : 0);
  }

  function submitWhoamiSim(form) {
    const w = whoami;
    const r = w?.round;
    if (!r || r.phase !== "play") return;
    const i = Number(form.dataset.whSim);
    if (r.answers[i]) return;
    const input = form.querySelector("input");
    const text = String(input?.value || "").trim();
    if (!text) { input?.focus(); input?.setCustomValidity?.(""); return; }
    r.answers[i] = { text, k: r.shown };
    form.classList.add("locked");
    form.querySelector(".m-sim-row")?.replaceWith(Object.assign(document.createElement("p"), { className: "m-locked", textContent: "Réponse enregistrée ✓" }));
    if (w.cfg.names.every((_, index) => r.answers[index])) finishWhoamiSim();
  }

  function advanceWhoamiTurn() {
    const r = whoami.round;
    const count = whoami.cfg.names.length;
    for (let step = 1; step <= count; step++) {
      const next = (r.turn + step) % count;
      if (!r.eliminated.includes(next)) { r.turn = next; return; }
    }
  }

  function submitWhoamiGuess(form) {
    const w = whoami;
    const r = w?.round;
    if (!r || r.phase !== "play" || w.cfg.flow !== "turns") return;
    const guess = String(new FormData(form).get("guess") || "").trim();
    if (!guess) { setNotice("Écris un nom avant de proposer.", "error"); return; }
    notice = "";
    const who = r.turn;
    if (whMatches(guess, r.card)) { whFinishRound(who, whPoints(r.shown)); return; }
    r.eliminated.push(who);
    r.log = `${w.cfg.names[who]} s’est trompé·e et sort de la manche.`;
    if (r.eliminated.length >= w.cfg.names.length) { whFinishRound(-1, 0); return; }
    advanceWhoamiTurn();
    renderWhoamiPlay();
  }

  function startWhoami(draft) {
    const eligible = players.filter(player => player.name);
    if (!eligible.length) { setNotice("La base ne contient aucune carte.", "error"); return; }
    const count = draft.count;
    const names = draft.names.slice(0, count).map((name, i) => name || (count === 1 ? "Toi" : `Joueur ${i + 1}`));
    if (count > 1 && !distinctNames(names)) { setNotice("Saisis des pseudos différents.", "error"); return; }
    const rounds = Math.min(draft.rounds, eligible.length);
    const cfg = { names, count, flow: draft.flow, rounds, duration: draft.duration, target: count === 1 ? (draft.target || whDefaultTarget(rounds)) : 0, requested: draft.rounds };
    saveLocal(WHOAMI_KEY, { prefs: { count, names: draft.names, flow: draft.flow, rounds: draft.rounds, duration: draft.duration, target: draft.target } });
    whoami = { cfg, deck: whDeck(rounds, eligible), index: 0, scores: names.map(() => 0), round: null };
    notice = rounds < draft.rounds ? `La base ne compte que ${eligible.length} carte${eligible.length > 1 ? "s" : ""} : la partie est limitée à ${rounds} manche${rounds > 1 ? "s" : ""}.` : "";
    noticeType = "";
    whNextRound();
  }

  function renderWhoamiEnd() {
    screen = "wh-end";
    stopModeTimer();
    const w = whoami;
    const cfg = w.cfg;
    const ranking = cfg.names.map((name, i) => ({ name, score: w.scores[i] })).sort((a, b) => b.score - a.score);
    const top = ranking[0].score;
    const winners = ranking.filter(item => item.score === top);
    let extra = "";
    let headline;
    if (cfg.count === 1) {
      const key = whBestKey(cfg);
      const bests = loadLocal(WHOAMI_KEY).best || {};
      const previous = bests[key];
      const record = previous === undefined || top > previous;
      if (record) saveLocal(WHOAMI_KEY, { best: { ...bests, [key]: top } });
      const reached = top >= cfg.target;
      headline = reached ? "Objectif atteint !" : "Objectif manqué.";
      extra = `<div class="m-goal ${reached ? "ok" : "ko"}"><span>Objectif</span><strong>${top} / ${cfg.target} pts</strong></div><p class="subtle">${record ? (previous === undefined ? "Premier score enregistré sur cet appareil." : `Nouveau record local ! (ancien : ${previous} pts)`) : `Meilleur score local : ${previous} pts.`}</p>`;
    } else {
      headline = winners.length > 1 ? `Égalité entre ${winners.map(item => escapeHtml(item.name)).join(" et ")}` : `${escapeHtml(winners[0].name)} gagne !`;
    }
    shell(`<section class="setup-layout m-wide">${modeHead("Qui suis-je ? · Terminé", escapeHtml(headline), "home", "← Menu")}
      <div class="setup-panel m-end"><ol class="m-ranking">${ranking.map((item, i) => `<li${item.score === top && cfg.count > 1 ? ` class="top"` : ""}><span>${i + 1}</span><em>${escapeHtml(item.name)}</em><strong>${item.score} pts</strong></li>`).join("")}</ol>${extra}</div>
      <div class="game-actions"><button class="button secondary" type="button" data-action="wh-setup">Modifier les réglages</button><button class="button" type="button" data-action="wh-replay" data-autofocus>Rejouer</button></div></section>`);
    afterModeRender();
  }

  /* ---------------------------------------------------------------- Défi de composition */

  const CP_DIFFICULTIES = [
    { id: "easy", label: "Facile", hint: "2 contraintes, marge large" },
    { id: "normal", label: "Normal", hint: "3 contraintes" },
    { id: "hard", label: "Difficile", hint: "4 contraintes, seuils serrés" }
  ];

  function cpPrefs() {
    const saved = loadLocal(COMPOSE_KEY).prefs || {};
    const names = Array.isArray(saved.names) ? saved.names : [];
    return {
      mode: saved.mode === "duo" ? "duo" : "solo",
      difficulty: CP_DIFFICULTIES.some(item => item.id === saved.difficulty) ? saved.difficulty : "normal",
      names: [String(names[0] || "Joueur 1").slice(0, 24), String(names[1] || "Joueur 2").slice(0, 24)]
    };
  }

  function cpShortages(factor) {
    const counts = Object.fromEntries(POSITIONS.map(position => [position, players.filter(player => player.position === position).length]));
    const missing = POSITIONS.map(position => ({ position, count: Math.max(0, COUNTS[position] * factor - counts[position]), need: COUNTS[position] * factor })).filter(item => item.count > 0);
    return { counts, missing, ready: missing.length === 0 };
  }

  function renderComposeSetup() {
    screen = "cp-setup";
    stopModeTimer();
    cpDraft = cpDraft || cpPrefs();
    const d = cpDraft;
    const short = cpShortages(d.mode === "duo" ? 2 : 1);
    const best = loadLocal(COMPOSE_KEY).best || {};
    shell(`<section class="setup-layout">${modeHead("Nouveau mode", "Défi de composition")}
      ${noticeHtml()}
      ${short.ready ? "" : `<div class="notice error" role="status">Base trop petite pour ce mode : ${short.missing.map(item => `${pluralFr(item.count, "carte", "cartes")} ${item.position.toLowerCase()} en moins (${item.need} requis)`).join(", ")}. Complète la base dans Paramètres.</div>`}
      <form class="setup-panel" id="cp-setup-form" novalidate>
        <h2>Partie</h2>
        <div class="m-choice" role="radiogroup" aria-label="Nombre de joueurs">
          <label class="m-choice-item"><input type="radio" name="mode" value="solo" ${d.mode === "solo" ? "checked" : ""}><span><strong>Solo</strong><small>Relève l’objectif seul. Record gardé sur cet appareil.</small></span></label>
          <label class="m-choice-item"><input type="radio" name="mode" value="duo" ${d.mode === "duo" ? "checked" : ""}><span><strong>Deux joueurs · même appareil</strong><small>Même objectif, chacun son tour, équipes distinctes. Pas de jeu en ligne.</small></span></label>
        </div>
        ${d.mode === "duo" ? nameFieldsHtml("cp-name", d.names, 2) : ""}
        <div class="field m-narrow"><label for="cp-difficulty">Difficulté de l’objectif</label><select id="cp-difficulty" name="difficulty">${CP_DIFFICULTIES.map(item => `<option value="${item.id}" ${item.id === d.difficulty ? "selected" : ""}>${item.label} · ${item.hint}</option>`).join("")}</select>${d.mode === "solo" && best[d.difficulty] !== undefined ? `<small>Meilleur score ${CP_DIFFICULTIES.find(item => item.id === d.difficulty).label.toLowerCase()} : ${best[d.difficulty]} pts.</small>` : ""}</div>
        <div class="m-rules"><strong>Règles</strong><ul>
          <li>Compose une équipe de 7 cartes : 1 gardien, 3 défenseurs, 1 milieu, 2 attaquants.</li>
          <li>L’objectif est tiré au hasard à partir des données réellement présentes sur les cartes (nationalités, clubs, notes, type de carte) et peut toujours être atteint avec la base actuelle.</li>
          <li>Score : 10 pts par carte posée, 30 pts par contrainte respectée, plus 3 × la note moyenne si les 7 cartes sont notées. Une contrainte ne peut pas être vérifiée si une donnée manque sur une carte.</li>
        </ul></div>
        <button class="button" type="submit" ${short.ready ? "" : "disabled"}>Voir l’objectif</button>
      </form></section>`);
  }

  function cpStats(team) {
    const nats = new Set();
    const clubs = new Set();
    let natCount = 0, clubCount = 0, rated = 0, sum = 0, legend = 0, mythic = 0;
    for (const player of team) {
      const nat = textKey(player.nationality);
      if (nat) { nats.add(nat); natCount++; }
      const club = clubKey(player.club);
      if (club) { clubs.add(club); clubCount++; }
      if (hasRating(player)) { rated++; sum += player.rating; }
      if (player.rarity === "legend") legend++;
      if (player.rarity === "mythic") mythic++;
    }
    return { size: team.length, nats: nats.size, natAll: natCount === team.length, clubs: clubs.size, clubAll: clubCount === team.length, ratedAll: team.length > 0 && rated === team.length, rated, avg: rated ? sum / rated : null, legend, mythic };
  }

  function cpWitness(excluded) {
    const team = [];
    for (const position of POSITIONS) {
      const pool = shuffled(players.filter(player => player.position === position && !excluded.has(player.id)));
      if (pool.length < COUNTS[position]) return null;
      team.push(...pool.slice(0, COUNTS[position]));
    }
    return team;
  }

  function cpCandidates(stats, level) {
    const slack = [2, 1, 0][level];
    const list = [];
    const nat = Math.min(...stats.map(s => s.natAll ? s.nats : 0));
    if (nat >= 3) list.push({ kind: "nat-min", value: Math.max(2, nat - slack) });
    const club = Math.max(...stats.map(s => s.clubs));
    if (stats.every(s => s.clubAll) && club + slack <= 6) list.push({ kind: "club-max", value: Math.max(1, club + slack) });
    if (stats.every(s => s.ratedAll)) {
      const avg = Math.min(...stats.map(s => s.avg));
      const value = Math.floor((avg - [1, .5, 0][level]) * 2) / 2;
      if (value >= 1) list.push({ kind: "avg-min", value });
    }
    if (stats.every(s => s.legend >= 1)) list.push({ kind: "legend-min", value: 1 });
    if (stats.every(s => s.mythic >= 1)) list.push({ kind: "mythic-min", value: 1 });
    return list;
  }

  function cpLabel(constraint) {
    const v = constraint.value;
    if (constraint.kind === "nat-min") return `Au moins ${v} nationalités différentes`;
    if (constraint.kind === "club-max") return `Au plus ${pluralFr(v, "club différent", "clubs différents")}`;
    if (constraint.kind === "avg-min") return `Note moyenne d’au moins ${formatRating(v)} / 10`;
    if (constraint.kind === "legend-min") return "Inclure au moins une carte Légende";
    return "Inclure au moins une carte Mythique";
  }

  function cpObjective(mode, level) {
    const idx = CP_DIFFICULTIES.findIndex(item => item.id === level);
    let best = null;
    for (let attempt = 0; attempt < 120; attempt++) {
      const first = cpWitness(new Set());
      if (!first) return null;
      const group = [first];
      if (mode === "duo") {
        const second = cpWitness(new Set(first.map(player => player.id)));
        if (!second) return null;
        group.push(second);
      }
      const candidates = cpCandidates(group.map(cpStats), idx);
      if (!best || candidates.length > best.length) best = candidates;
      if (candidates.length >= 4) break;
    }
    const wanted = [2, 3, 4][idx];
    const chosen = shuffled(best || []).slice(0, wanted).map((item, i) => ({ ...item, id: `c${i}`, label: cpLabel(item) }));
    return { constraints: chosen, basic: chosen.length === 0 };
  }

  function cpEval(team, constraints) {
    const s = cpStats(team);
    const final = team.length === 7;
    return constraints.map(c => {
      let state = "pending", detail = "";
      if (c.kind === "nat-min") {
        detail = `${s.nats} / ${c.value}`;
        state = s.nats >= c.value ? "ok" : final ? "ko" : "pending";
      } else if (c.kind === "club-max") {
        detail = `${s.clubs} club${s.clubs > 1 ? "s" : ""}`;
        if (s.clubs > c.value) state = "ko";
        else if (final) { state = s.clubAll ? "ok" : "ko"; if (!s.clubAll) detail = "club manquant sur une carte"; }
      } else if (c.kind === "avg-min") {
        if (final) { state = s.ratedAll && s.avg >= c.value ? "ok" : "ko"; detail = s.ratedAll ? `moyenne ${formatRating(s.avg)}` : "note manquante sur une carte"; }
        else detail = s.rated ? `moyenne actuelle ${formatRating(s.avg)}` : "—";
      } else {
        const have = c.kind === "legend-min" ? s.legend : s.mythic;
        detail = `${have} / ${c.value}`;
        state = have >= c.value ? "ok" : final ? "ko" : "pending";
      }
      return { ...c, state, detail };
    });
  }

  function cpBalanceOk(team) {
    return POSITIONS.every(position => team.filter(player => player.position === position).length === COUNTS[position]);
  }

  function cpScore(team, evals) {
    const s = cpStats(team);
    const cards = team.length * 10;
    const objectives = evals.filter(item => item.state === "ok").length * 30;
    const rating = team.length === 7 && s.ratedAll ? Math.round(s.avg * 3) : 0;
    return { cards, objectives, rating, total: cards + objectives + rating };
  }

  function startCompose(draft) {
    const names = draft.mode === "duo" ? draft.names : [draft.names[0] || "Toi"];
    if (draft.mode === "duo" && !distinctNames(names)) { setNotice("Saisis deux pseudos différents.", "error"); return; }
    if (!cpShortages(draft.mode === "duo" ? 2 : 1).ready) { setNotice("La base est trop petite pour ce mode.", "error"); return; }
    saveLocal(COMPOSE_KEY, { prefs: { mode: draft.mode, difficulty: draft.difficulty, names: draft.names } });
    cpNewObjective({ mode: draft.mode, difficulty: draft.difficulty, names });
  }

  function cpNewObjective(base) {
    const objective = cpObjective(base.mode, base.difficulty);
    if (!objective) { setNotice("Impossible de construire un objectif avec cette base.", "error"); return; }
    compose = { ...base, objective, teams: [[], []], turn: 0, filter: { pos: "", q: "" }, results: null, objectiveNote: objective.basic ? "Les cartes ne portent pas assez de données (nationalité, club, note…) pour des contraintes avancées : objectif simple, compose une équipe complète." : "" };
    notice = "";
    renderComposePlay();
  }

  function cpAvailable() {
    const c = compose;
    const used = new Set(c.teams.flat().map(player => player.id));
    const q = normText(c.filter.q);
    return players.filter(player => !used.has(player.id)
      && (!c.filter.pos || player.position === c.filter.pos)
      && (!q || normText(`${player.name} ${player.club || ""} ${player.nationality || ""}`).includes(q)));
  }

  function cpListHtml() {
    const c = compose;
    const team = c.teams[c.turn];
    const usedKinds = new Set(c.objective.constraints.map(item => item.kind));
    const list = cpAvailable();
    if (!list.length) return `<div class="empty-state">Aucune carte disponible avec ces filtres.</div>`;
    return list.slice(0, 80).map(player => {
      const full = team.filter(item => item.position === player.position).length >= COUNTS[player.position];
      const tags = [];
      if (usedKinds.has("nat-min") && !String(player.nationality || "").trim()) tags.push("sans nationalité");
      if (usedKinds.has("club-max") && !String(player.club || "").trim()) tags.push("sans club");
      if (usedKinds.has("avg-min") && !hasRating(player)) tags.push("sans note");
      const extra = `<button class="button secondary m-add" type="button" data-action="cp-add" data-id="${escapeHtml(player.id)}" ${full ? "disabled" : ""} aria-label="Ajouter ${escapeHtml(player.name)}">${full ? "Poste complet" : "Ajouter"}</button>`;
      return `<div class="m-pick">${cardMiniHtml(player, extra)}${tags.length ? `<small class="m-missing">${tags.join(" · ")}</small>` : ""}</div>`;
    }).join("") + (list.length > 80 ? `<p class="subtle">${list.length - 80} autres cartes : affine la recherche.</p>` : "");
  }

  function cpTeamHtml(team, removable) {
    return POSITIONS.map(position => {
      const members = team.filter(player => player.position === position);
      const slots = Array.from({ length: COUNTS[position] }, (_, i) => {
        const player = members[i];
        return player
          ? `<div class="m-slot filled">${cardMiniHtml(player, removable ? `<button class="button danger m-remove" type="button" data-action="cp-remove" data-id="${escapeHtml(player.id)}" aria-label="Retirer ${escapeHtml(player.name)}">×</button>` : "")}</div>`
          : `<div class="m-slot empty">${positionIcon(position)} <span>${escapeHtml(position)} à choisir</span></div>`;
      }).join("");
      return `<div class="m-pos"><h3>${escapeHtml({ Gardien: "Gardien", Défenseur: "Défenseurs", Milieu: "Milieu", Attaquant: "Attaquants" }[position])} <small>${members.length} / ${COUNTS[position]}</small></h3>${slots}</div>`;
    }).join("");
  }

  function cpObjectiveHtml(evals) {
    if (!evals.length) return `<p class="subtle">Objectif simple : compose une équipe complète de 7 cartes.</p>`;
    const icon = { ok: "✓", ko: "✗", pending: "…" };
    return `<ul class="m-objectives">${evals.map(item => `<li class="${item.state}"><span class="m-state" aria-hidden="true">${icon[item.state]}</span><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}${item.state === "ok" ? " · respecté" : item.state === "ko" ? " · manqué" : ""}</small></span></li>`).join("")}</ul>`;
  }

  function cpProgressHtml() {
    const c = compose;
    const team = c.teams[c.turn];
    const evals = cpEval(team, c.objective.constraints);
    const score = cpScore(team, evals);
    return { evals, score, html: `<div class="m-progress"><div class="m-progress-head"><span>Équipe</span><strong>${team.length} / 7</strong></div><div class="progress-track m-track"><i style="width:${team.length / 7 * 100}%"></i></div><div class="m-score-live"><span>Score actuel</span><strong>${score.total}</strong></div></div>` };
  }

  function renderComposePlay() {
    screen = "cp-play";
    stopModeTimer();
    const c = compose;
    const team = c.teams[c.turn];
    const progress = cpProgressHtml();
    const who = c.mode === "duo" ? c.names[c.turn] : "";
    shell(`<section class="setup-layout m-wide">${modeHead(`Défi de composition${c.mode === "duo" ? ` · ${escapeHtml(who)}` : ""}`, "Défi de composition", "m-quit", "Quitter")}
      ${noticeHtml()}${c.objectiveNote ? `<div class="notice" role="status">${escapeHtml(c.objectiveNote)}</div>` : ""}
      <div class="m-compose">
        <aside class="setup-panel m-side"><h2>Objectif</h2>${cpObjectiveHtml(progress.evals)}${progress.html}
          <div class="m-actions"><button class="button" type="button" data-action="cp-validate">${c.mode === "duo" && c.turn === 0 ? "Valider mon équipe" : "Valider l’équipe"}</button><button class="button secondary" type="button" data-action="cp-reset">Recommencer</button></div>
        </aside>
        <div class="m-main">
          <section class="setup-panel"><h2>Mon équipe</h2><div class="m-team">${cpTeamHtml(team, true)}</div></section>
          <section class="setup-panel"><h2>Cartes disponibles</h2>
            <div class="m-filters"><div class="field"><label for="cp-pos">Poste</label><select id="cp-pos"><option value="">Tous</option>${POSITIONS.map(position => `<option value="${position}" ${c.filter.pos === position ? "selected" : ""}>${position}</option>`).join("")}</select></div><div class="field"><label for="cp-search">Recherche</label><input id="cp-search" type="search" autocomplete="off" placeholder="Nom, club, nationalité…" value="${escapeHtml(c.filter.q)}"></div></div>
            <div class="m-list" id="cp-list">${cpListHtml()}</div>
          </section>
        </div>
      </div></section>`);
  }

  function cpRerender() {
    const y = window.scrollY;
    renderComposePlay();
    window.scrollTo(0, y);
  }

  function cpValidate() {
    const c = compose;
    const team = c.teams[c.turn];
    if (team.length < 7) { setNotice(`Il manque ${pluralFr(7 - team.length, "carte", "cartes")} pour valider l’équipe.`, "error"); window.scrollTo(0, 0); return; }
    notice = "";
    if (c.mode === "duo" && c.turn === 0) { renderComposeHandoff(); return; }
    renderComposeEnd();
  }

  function renderComposeHandoff() {
    screen = "cp-handoff";
    const c = compose;
    shell(`<section class="setup-layout m-wide">${modeHead("Défi de composition", "Au suivant", "m-quit", "Quitter")}
      <div class="setup-panel m-handoff"><p><strong>${escapeHtml(c.names[0])}</strong> a validé son équipe.</p><p class="subtle">Passe l’appareil à <strong>${escapeHtml(c.names[1])}</strong>. Il ou elle relève le même objectif avec des cartes différentes.</p>
      <div class="m-actions"><button class="button" type="button" data-action="cp-next-player" data-autofocus>Je suis ${escapeHtml(c.names[1])}</button></div></div></section>`);
    afterModeRender();
  }

  function renderComposeEnd() {
    screen = "cp-end";
    const c = compose;
    const results = c.teams.slice(0, c.mode === "duo" ? 2 : 1).map(team => {
      const evals = cpEval(team, c.objective.constraints);
      return { team, evals, score: cpScore(team, evals), balance: cpBalanceOk(team), stats: cpStats(team) };
    });
    c.results = results;
    const metCount = result => result.evals.filter(item => item.state === "ok").length;
    let body;
    if (c.mode === "solo") {
      const r = results[0];
      const best = loadLocal(COMPOSE_KEY).best || {};
      const previous = best[c.difficulty];
      const record = previous === undefined || r.score.total > previous;
      if (record) saveLocal(COMPOSE_KEY, { best: { ...best, [c.difficulty]: r.score.total } });
      const allMet = r.evals.length > 0 && metCount(r) === r.evals.length;
      body = `<div class="setup-panel m-end"><h2>${r.evals.length === 0 ? "Équipe complète" : allMet ? "Objectif réussi !" : `${metCount(r)} / ${r.evals.length} contraintes respectées`}</h2>${cpObjectiveHtml(r.evals)}${cpBreakdownHtml(r)}<p class="subtle">${record ? (previous === undefined ? "Premier score enregistré sur cet appareil." : `Nouveau record local ! (ancien : ${previous} pts)`) : `Meilleur score local : ${previous} pts.`}</p></div>
        <section class="setup-panel"><h2>Mon équipe</h2><div class="m-team">${cpTeamHtml(r.team, false)}</div></section>`;
    } else {
      const [a, b] = results;
      const order = (x, y) => x > y ? 0 : x < y ? 1 : -1;
      let winner = order(a.score.total, b.score.total);
      let reason = "au score";
      if (winner < 0) { winner = order(metCount(a), metCount(b)); reason = "aux contraintes respectées"; }
      const rating = result => result.stats.ratedAll ? `${formatRating(result.stats.avg)} / 10` : `${result.stats.rated} / 7 notées`;
      const rows = [
        ["Contraintes respectées", ...results.map(r => `${metCount(r)} / ${r.evals.length}`)],
        ["Équilibre des postes", ...results.map(r => r.balance ? "1-3-1-2 ✓" : "incomplet")],
        ["Notes disponibles", ...results.map(rating)],
        ["Score", ...results.map(r => `<strong>${r.score.total}</strong>`)]
      ];
      body = `<div class="setup-panel m-end"><h2>${winner < 0 ? "Égalité parfaite" : `${escapeHtml(c.names[winner])} l’emporte ${reason}`}</h2>
        <table class="m-compare"><thead><tr><th></th><th scope="col">${escapeHtml(c.names[0])}</th><th scope="col">${escapeHtml(c.names[1])}</th></tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${row[0]}</th><td>${row[1]}</td><td>${row[2]}</td></tr>`).join("")}</tbody></table>
        <h3 class="m-sub">Objectif</h3>${c.objective.constraints.length ? `<ul class="m-objectives">${c.objective.constraints.map((constraint, i) => `<li><span class="m-state ${results[0].evals[i].state}">${results[0].evals[i].state === "ok" ? "✓" : "✗"}</span><span class="m-state ${results[1].evals[i].state}">${results[1].evals[i].state === "ok" ? "✓" : "✗"}</span><span><strong>${escapeHtml(constraint.label)}</strong></span></li>`).join("")}</ul>` : `<p class="subtle">Objectif simple : équipe complète.</p>`}</div>
        <div class="m-duo-teams">${results.map((r, i) => `<section class="setup-panel"><h2>${escapeHtml(c.names[i])}</h2><div class="m-team">${cpTeamHtml(r.team, false)}</div></section>`).join("")}</div>`;
    }
    shell(`<section class="setup-layout m-wide">${modeHead("Défi de composition · Terminé", "Résultat", "home", "← Menu")}${body}
      <div class="game-actions"><button class="button secondary" type="button" data-action="cp-setup">Réglages</button><button class="button secondary" type="button" data-action="cp-same">Même objectif</button><button class="button" type="button" data-action="cp-new" data-autofocus>Nouvel objectif</button></div></section>`);
    afterModeRender();
  }

  function cpBreakdownHtml(result) {
    const s = result.score;
    return `<table class="m-compare m-breakdown"><tbody><tr><th scope="row">Cartes posées</th><td>${s.cards}</td></tr><tr><th scope="row">Contraintes respectées</th><td>${s.objectives}</td></tr><tr><th scope="row">Note moyenne ${result.stats.ratedAll ? "" : "(non disponible)"}</th><td>${s.rating}</td></tr><tr><th scope="row">Score total</th><td><strong>${s.total}</strong></td></tr></tbody></table>`;
  }

  /* ---------------------------------------------------------------- Dispatch commun */

  function renderModeScreen() {
    if (screen === "wh-setup") renderWhoamiSetup();
    else if (screen === "wh-play") renderWhoamiPlay();
    else if (screen === "wh-end") renderWhoamiEnd();
    else if (screen === "cp-setup") renderComposeSetup();
    else if (screen === "cp-play") renderComposePlay();
    else if (screen === "cp-handoff") renderComposeHandoff();
    else if (screen === "cp-end") renderComposeEnd();
    else renderMenu();
  }

  function handleModeClick(action, button) {
    if (action === "home") { stopModeTimer(); whoami = compose = null; whDraft = cpDraft = null; return false; }
    if (!/^(wh|cp|hb|m)-/.test(action)) return false;
    if (action === "m-quit") {
      if (!window.confirm("Quitter cette partie ? La progression sera perdue.")) return true;
      stopModeTimer(); whoami = compose = null; whDraft = cpDraft = null;
      screen = "menu"; notice = ""; render();
    } else if (action === "wh-setup") { whDraft = null; notice = ""; renderWhoamiSetup(); }
    else if (action === "wh-clue") {
      const r = whoami?.round;
      if (!r || r.phase !== "play" || r.shown >= r.clues.length) return true;
      r.shown++; r.log = ""; advanceWhoamiTurn(); notice = ""; renderWhoamiPlay();
    } else if (action === "wh-pass") {
      const r = whoami?.round;
      if (!r || r.phase !== "play") return true;
      r.eliminated.push(r.turn);
      r.log = `${whoami.cfg.names[r.turn]} passe la manche.`;
      if (r.eliminated.length >= whoami.cfg.names.length) whFinishRound(-1, 0);
      else { advanceWhoamiTurn(); renderWhoamiPlay(); }
    } else if (action === "wh-next") { whoami.index++; whNextRound(); }
    else if (action === "wh-replay") {
      const cfg = whoami.cfg;
      startWhoami({ count: cfg.count, names: [...cfg.names, ...whPrefs().names.slice(cfg.names.length)], flow: cfg.flow, rounds: cfg.requested, duration: cfg.duration, target: cfg.count === 1 && cfg.target !== whDefaultTarget(cfg.rounds) ? cfg.target : 0 });
    }
    else if (action === "cp-setup") { cpDraft = null; compose = null; notice = ""; renderComposeSetup(); }
    else if (action === "cp-add") {
      const c = compose;
      const player = players.find(item => item.id === button.dataset.id);
      const team = c?.teams[c.turn];
      if (!player || !team || team.length >= 7 || team.some(item => item.id === player.id) || c.teams.flat().some(item => item.id === player.id)) return true;
      if (team.filter(item => item.position === player.position).length >= COUNTS[player.position]) return true;
      team.push(player); notice = ""; cpRerender();
    } else if (action === "cp-remove") {
      const c = compose;
      c.teams[c.turn] = c.teams[c.turn].filter(item => item.id !== button.dataset.id);
      notice = ""; cpRerender();
    } else if (action === "cp-reset") { compose.teams[compose.turn] = []; notice = ""; cpRerender(); }
    else if (action === "cp-validate") cpValidate();
    else if (action === "cp-next-player") { compose.turn = 1; compose.filter = { pos: "", q: "" }; notice = ""; renderComposePlay(); window.scrollTo(0, 0); }
    else if (action === "cp-same") { compose.teams = [[], []]; compose.turn = 0; compose.filter = { pos: "", q: "" }; compose.results = null; notice = ""; renderComposePlay(); }
    else if (action === "cp-new") cpNewObjective({ mode: compose.mode, difficulty: compose.difficulty, names: compose.names });
    else if (action === "hb-setup") { setupSealed = true; screen = "setup"; notice = ""; render(); }
    else if (action === "hb-balance") sealedToggleBalance(button);
    else if (action === "hb-next") sealedNext();
    return true;
  }

  function handleModeSubmit(form) {
    if (form.id === "wh-setup-form") { whDraft = readWhForm(form); startWhoami(whDraft); return true; }
    if (form.id === "wh-guess-form") { submitWhoamiGuess(form); return true; }
    if (form.dataset && form.dataset.whSim !== undefined) { submitWhoamiSim(form); return true; }
    if (form.id === "cp-setup-form") {
      const data = new FormData(form);
      cpDraft = { ...cpDraft, mode: data.get("mode") === "duo" ? "duo" : "solo", difficulty: CP_DIFFICULTIES.some(item => item.id === data.get("difficulty")) ? data.get("difficulty") : "normal", names: [String(data.get("name0") ?? cpDraft.names[0]).trim(), String(data.get("name1") ?? cpDraft.names[1]).trim()] };
      startCompose(cpDraft);
      return true;
    }
    if (form.id === "sealed-bid-form") { sealedSubmitBid(form); return true; }
    return false;
  }

  function handleModeChange(target) {
    if (target.id === "wh-count" && screen === "wh-setup") { whDraft = readWhForm(target.form); renderWhoamiSetup(); return true; }
    if (target.id === "wh-rounds" && screen === "wh-setup") {
      whDraft = readWhForm(target.form);
      const goal = root.querySelector("#wh-target");
      if (goal) { goal.max = String(whDraft.rounds * 10); goal.placeholder = String(whDefaultTarget(whDraft.rounds)); }
      return true;
    }
    if (target.name === "flow" && screen === "wh-setup") { whDraft = readWhForm(target.form); return true; }
    if (target.name === "mode" && screen === "cp-setup") {
      const data = new FormData(target.form);
      cpDraft = { ...cpDraft, mode: data.get("mode") === "duo" ? "duo" : "solo", difficulty: String(data.get("difficulty") || cpDraft.difficulty), names: [String(data.get("name0") ?? cpDraft.names[0]), String(data.get("name1") ?? cpDraft.names[1])] };
      renderComposeSetup();
      return true;
    }
    if (target.id === "cp-difficulty" && screen === "cp-setup") { cpDraft = { ...cpDraft, difficulty: target.value }; renderComposeSetup(); return true; }
    if (target.id === "cp-pos" && screen === "cp-play") { compose.filter.pos = target.value; const list = root.querySelector("#cp-list"); if (list) list.innerHTML = cpListHtml(); return true; }
    return false;
  }

  root.addEventListener("input", event => {
    if (event.target.id === "cp-search" && screen === "cp-play" && compose) {
      compose.filter.q = event.target.value;
      const list = root.querySelector("#cp-list");
      if (list) list.innerHTML = cpListHtml();
    }
  });

  function render() {
    if (screen === "account") renderAccount();
    else if (screen === "settings") renderSettings();
    else if (screen === "setup") renderSetup();
    else if (screen === "take-setup") renderTakeSetup();
    else if (screen === "game") renderGame();
    else if (screen === "results") renderResults();
    else if (screen === "blocked") renderBlocked();
    else if (/^(wh|cp|hb)-/.test(screen)) renderModeScreen();
    else renderMenu();
  }

  function nextAuction() {
    if (game.teams[0].length === 7 && game.teams[1].length === 7) {
      game.candidate = null;
      screen = "results";
      notice = "";
      render();
      return;
    }
    while (game.pool.length) {
      const candidate = game.pool.shift();
      const eligible = [0, 1].filter(index => teamCanBuy(index, candidate.position));
      if (!eligible.length) continue;
      game.candidate = candidate;
      rememberDrawn(candidate);
      game.currentClues = mysteryClues(candidate, game.mysteryClue);
      if (eligible.length === 1) {
        game.leaderIndex = eligible[0];
        game.highBid = 0;
        game.turnIndex = 1 - eligible[0];
        awardPlayer();
        return;
      }
      if (game.mode === "sealed") {
        Object.assign(game, { leaderIndex: game.firstBidder, highBid: 0, turnIndex: game.firstBidder, opener: game.firstBidder, bids: [null, null], done: [false, false], placed: 0, phase: "bid", showBalance: false, reveal: null });
        game.firstBidder = 1 - game.firstBidder;
        screen = "game";
        render();
        return;
      }
      game.leaderIndex = game.firstBidder;
      game.highBid = 0;
      game.turnIndex = 1 - game.firstBidder;
      game.firstBidder = 1 - game.firstBidder;
      screen = "game";
      render();
      return;
    }
    game.candidate = null;
    game.blockedReason = "La réserve de joueurs ne permet pas de compléter les deux équipes. Vérifiez les postes manquants, puis recommencez avec une base complète.";
    screen = "blocked";
    render();
  }

  function nextPickPlayer() {
    if (game.teams[0].length === 7 && game.teams[1].length === 7) {
      game.candidate = null;
      screen = "results";
      render();
      return;
    }
    while (game.pool.length) {
      const candidate = game.pool.shift();
      const eligible = [0, 1].filter(index => teamCanBuy(index, candidate.position));
      if (!eligible.length) continue;
      rememberDrawn(candidate);
      if (eligible.length === 1) {
        game.teams[eligible[0]].push(candidate);
        continue;
      }
      game.candidate = candidate;
      game.revealed = false;
      screen = "game";
      render();
      return;
    }
    game.candidate = null;
    if (game.teams[0].length === 7 && game.teams[1].length === 7) {
      screen = "results";
    } else {
      game.blockedReason = "La base de joueurs a été épuisée avant que les deux équipes soient complètes.";
      screen = "blocked";
    }
    render();
  }

  function assignPick(teamIndex) {
    if (!game?.candidate || !teamCanBuy(teamIndex, game.candidate.position)) return;
    const candidate = game.candidate;
    const partnerIndex = 1 - teamIndex;
    const needsPair = teamCanBuy(partnerIndex, candidate.position);
    const partnerPoolIndex = needsPair ? game.pool.findIndex(player => player.position === candidate.position) : -1;
    if (needsPair && partnerPoolIndex < 0) {
      game.blockedReason = `Il ne reste aucun autre ${candidate.position.toLowerCase()} pour maintenir les équipes à égalité.`;
      game.candidate = null;
      screen = "blocked";
      render();
      return;
    }
    game.teams[teamIndex].push(candidate);
    if (needsPair) game.teams[partnerIndex].push(game.pool.splice(partnerPoolIndex, 1)[0]);
    game.candidate = null;
    game.turnIndex = partnerIndex;
    nextPickPlayer();
  }

  function awardPlayer() {
    if (!game || !game.candidate) return;
    const winner = game.leaderIndex;
    if (!teamCanBuy(winner, game.candidate.position) || game.budgets[winner] < game.highBid) {
      game.blockedReason = "Cette attribution est impossible avec l’effectif ou le budget actuel. Recommencez avec des budgets suffisants ou complétez la base de joueurs.";
      game.candidate = null;
      screen = "blocked";
      render();
      return;
    }
    game.teams[winner].push(game.candidate);
    game.budgets[winner] -= game.highBid;
    game.spent[winner] += game.highBid;
    game.candidate = null;
    notice = "";
    nextAuction();
  }

  // Tirage : vrai mélange (Fisher-Yates) + les joueurs vus récemment passent en dernier,
  // pour que deux parties de suite ne ressemblent pas à la même.
  const RECENT_KEY = "seven-recent-players-v1";
  const RECENT_LIMIT = 28;

  function randomInt(max) {
    if (window.crypto?.getRandomValues) {
      const buffer = new Uint32Array(1);
      const limit = Math.floor(0x100000000 / max) * max;
      do crypto.getRandomValues(buffer); while (buffer[0] >= limit);
      return buffer[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function shuffled(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function recentPlayerIds() {
    try {
      const ids = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(ids) ? ids.filter(id => typeof id === "string") : [];
    } catch {
      return [];
    }
  }

  function rememberDrawn(player) {
    safeSetItem(RECENT_KEY, JSON.stringify([player.id, ...recentPlayerIds().filter(id => id !== player.id)].slice(0, RECENT_LIMIT)));
  }

  function drawPool() {
    const recent = new Set(recentPlayerIds());
    return [...shuffled(players.filter(player => !recent.has(player.id))), ...shuffled(players.filter(player => recent.has(player.id)))];
  }

  function beginGame(leftBudget, rightBudget, names = setupNames, mystery = setupMystery, mysteryClue = setupMysteryClue, sealed = false) {
    const inventory = inventoryShortages();
    if (!inventory.ready) {
      screen = "setup";
      setNotice(`Partie non lancée : il manque ${inventory.missingTotal} joueur${inventory.missingTotal === 1 ? "" : "s"} dans la base.`, "error");
      return;
    }
    const pool = drawPool();
    game = { ...(sealed ? { mode: "sealed" } : {}), teams: [[], []], names: [...names], budgets: [leftBudget, rightBudget], spent: [0, 0], pool, candidate: null, currentClues: [], leaderIndex: 0, turnIndex: 1, highBid: 0, firstBidder: 0, initialBudgets: [leftBudget, rightBudget], mystery, mysteryClue };
    notice = "";
    screen = "game";
    nextAuction();
  }

  function beginTakeGame(names = setupNames) {
    const inventory = inventoryShortages();
    if (!inventory.ready) {
      screen = "take-setup";
      setNotice(`Partie non lancée : il manque ${inventory.missingTotal} joueur${inventory.missingTotal === 1 ? "" : "s"} dans la base.`, "error");
      return;
    }
    const pool = drawPool();
    game = { mode: "take-leave", teams: [[], []], names: [...names], pool, candidate: null, turnIndex: 0, revealed: false };
    notice = "";
    nextPickPlayer();
  }

  function savePlayer(form) {
    if (!currentAccount || currentAccount.email?.toLowerCase() !== accountEmail()) {
      notice = "Seul l’administrateur peut modifier la base partagée.";
      noticeType = "error";
      renderSettings();
      return;
    }
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const position = String(data.get("position") || "");
    if (!name || !POSITIONS.includes(position)) return;
    const rarity = String(data.get("rarity") || "normal");
    const ratingText = String(data.get("rating") || "").trim();
    const rating = ratingText === "" ? null : Number(ratingText);
    if (!RARITIES.some(item => item.id === rarity) || (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 10))) {
      notice = "Vérifie le type de carte et la note (entier de 1 à 10).";
      noticeType = "error";
      renderSettings();
      return;
    }
    const existing = players.find(player => player.id === editingId);
    const player = {
      id: existing?.id || (window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      name,
      position,
      nationality: String(data.get("nationality") || "").trim(),
      club: String(data.get("club") || "").trim(),
      rarity,
      rating,
      photo: formPhoto || existing?.photo || ""
    };
    const updated = existing ? players.map(item => item.id === existing.id ? player : item) : [...players, player];
    const previous = players;
    players = updated;
    if (!persistPlayers()) {
      players = previous;
      renderSettings();
      return;
    }
    editingId = null;
    formPhoto = "";
    const hiddenByFilters = !visiblePlayers().some(item => item.id === player.id);
    notice = `${existing ? "Fiche modifiée." : "Joueur ajouté à la base."}${hiddenByFilters ? " Ce joueur est masqué par les filtres actuels." : ""}`;
    noticeType = "success";
    renderSettings();
  }

  function deletePlayer(id) {
    if (!currentAccount || currentAccount.email?.toLowerCase() !== accountEmail()) return;
    const player = players.find(item => item.id === id);
    if (!player || !window.confirm(`Supprimer la fiche de ${player.name} ? Cette action est définitive.`)) return;
    const previous = players;
    players = players.filter(item => item.id !== id);
    if (!persistPlayers()) players = previous;
    else {
      notice = `${player.name} a été supprimé de la base.`;
      noticeType = "success";
    }
    renderSettings();
  }

  async function submitAccount(form) {
    const data = new FormData(form);
    const pin = String(data.get("pin") || "");
    if (!/^\d{4}$/.test(pin)) {
      notice = "Saisis le code administrateur à 4 chiffres.";
      noticeType = "error";
      renderAccount();
      return;
    }

    accountBusy = true;
    notice = "Connexion au compte…";
    noticeType = "";
    renderAccount();
    try {
      const services = await loadFirebaseServices();
      const credential = await services.authSdk.signInWithEmailAndPassword(services.auth, accountEmail(), accountPassword(pin));
      if (credential.user.email?.toLowerCase() !== accountEmail()) {
        await services.authSdk.signOut(services.auth);
        throw new Error("Ce compte n’est pas administrateur.");
      }
      currentAccount = credential.user;
      currentAccountName = FIREBASE_CONFIG.adminDisplayName || "Célien";
      await loadSharedPlayers(true);
      listenToSharedPlayers();
      screen = "menu";
      notice = `Base synchronisée · ${players.length} joueurs.`;
      noticeType = "success";
      renderMenu();
    } catch (error) {
      const errorCode = String(error?.code || "");
      if (currentAccount && firebaseServices) await firebaseServices.authSdk.signOut(firebaseServices.auth).catch(() => {});
      currentAccount = null;
      currentAccountName = "";
      players = readPlayers(STORAGE_KEY);
      notice = errorCode.includes("user-not-found")
        ? "Le compte admin doit d’abord être créé dans Firebase Authentication."
        : errorCode.includes("too-many-requests")
          ? "Trop d’essais; réessaie plus tard."
          : errorCode.includes("invalid-credential") || errorCode.includes("wrong-password") || errorCode.includes("invalid-login-credentials")
            ? "Code administrateur incorrect."
            : errorCode.includes("operation-not-allowed")
              ? "Active E-mail/Mot de passe dans Firebase Authentication."
              : "Connexion impossible. Vérifie la configuration Firebase et ta connexion.";
      noticeType = "error";
      screen = "account";
      renderAccount();
    } finally {
      accountBusy = false;
      if (screen === "account") renderAccount();
    }
  }

  async function signOutAccount() {
    if (firebaseServices && currentAccount) await firebaseServices.authSdk.signOut(firebaseServices.auth);
    sharedPlayersUnsubscribe?.();
    sharedPlayersUnsubscribe = null;
    currentAccount = null;
    currentAccountName = "";
    try {
      await loadSharedPlayers(false);
      listenToSharedPlayers();
      notice = "Administration verrouillée. Le catalogue partagé reste consultable.";
      noticeType = "success";
    } catch {
      players = readPlayers(STORAGE_KEY);
      notice = "Administration verrouillée. Affichage de la dernière copie locale.";
      noticeType = "success";
    }
    screen = "menu";
    renderMenu();
  }

  async function startApplication() {
    if (!isFirebaseConfigured() || location.protocol === "file:") {
      renderMenu();
      return;
    }
    screen = "menu";
    renderMenu();
    try {
      const services = await loadFirebaseServices();
      const user = await new Promise(resolve => {
        let unsubscribe = () => {};
        unsubscribe = services.authSdk.onAuthStateChanged(services.auth, account => {
          unsubscribe();
          resolve(account);
        });
      });
      if (user?.email?.toLowerCase() === accountEmail()) {
        currentAccount = user;
        currentAccountName = FIREBASE_CONFIG.adminDisplayName || "Célien";
        await loadSharedPlayers(true);
      } else {
        if (user) await services.authSdk.signOut(services.auth);
        currentAccount = null;
        currentAccountName = "";
        await loadSharedPlayers(false);
      }
      listenToSharedPlayers();
      screen = "menu";
      notice = "";
      renderMenu();
    } catch {
      if (currentAccount && firebaseServices) await firebaseServices.authSdk.signOut(firebaseServices.auth).catch(() => {});
      currentAccount = null;
      currentAccountName = "";
      players = readPlayers(STORAGE_KEY);
      notice = "La base partagée est indisponible; affichage de la copie locale.";
      noticeType = "error";
      screen = "menu";
      renderMenu();
    }
  }

  root.addEventListener("submit", event => {
    event.preventDefault();
    if (handleModeSubmit(event.target)) return;
    if (event.target.id === "player-form") {
      savePlayer(event.target);
    } else if (event.target.id === "account-form") {
      void submitAccount(event.target);
    } else if (event.target.id === "setup-form") {
      const data = new FormData(event.target);
      const left = Number(data.get("leftBudget"));
      const right = Number(data.get("rightBudget"));
      if (![left, right].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000)) {
        setNotice("Les budgets doivent être des nombres entiers entre 0 et 1 000 000.", "error");
        return;
      }
      const leftName = String(data.get("leftName") || "").trim();
      const rightName = String(data.get("rightName") || "").trim();
      if (!leftName || !rightName || leftName.toLocaleLowerCase("fr") === rightName.toLocaleLowerCase("fr")) {
        setNotice("Saisis deux pseudos différents.", "error");
        return;
      }
      setupMystery = data.get("mystery") === "on";
      setupMysteryClue = String(data.get("mysteryClue") || "club");
      setupNames = [leftName, rightName];
      beginGame(left, right, setupNames, setupMystery, setupMysteryClue, setupSealed);
    } else if (event.target.id === "take-setup-form") {
      const data = new FormData(event.target);
      const leftName = String(data.get("leftName") || "").trim();
      const rightName = String(data.get("rightName") || "").trim();
      if (!leftName || !rightName || leftName.toLocaleLowerCase("fr") === rightName.toLocaleLowerCase("fr")) {
        setNotice("Saisis deux pseudos différents.", "error");
        return;
      }
      setupNames = [leftName, rightName];
      beginTakeGame(setupNames);
    }
  });

  root.addEventListener("change", async event => {
    if (handleModeChange(event.target)) return;
    if (event.target.id === "mystery-mode") {
      root.querySelector("#mystery-clue").disabled = !event.target.checked;
      return;
    }
    const filterField = { "filter-position": "position", "filter-rarity": "rarity", "filter-club": "club", "filter-nationality": "nationality" }[event.target.id];
    if (filterField) {
      listFilters[filterField] = event.target.value;
      refreshPlayerList();
      return;
    }
    if (event.target.id === "sort-key") {
      listSort.key = event.target.value;
      refreshPlayerList();
      return;
    }
    if (event.target.id !== "player-photo") return;
    const file = event.target.files?.[0];
    if (!file) return;
    const photoStatus = (message, isError = false) => {
      const status = root.querySelector("#photo-status");
      if (!status) return;
      status.textContent = message;
      status.classList.toggle("error", isError);
    };
    if (!file.type.startsWith("image/")) {
      event.target.value = "";
      photoStatus("Ce fichier n’est pas une image.", true);
      return;
    }
    if (file.size > MAX_PHOTO_FILE_BYTES) {
      event.target.value = "";
      photoStatus("Image trop lourde (20 Mo maximum).", true);
      return;
    }
    photoStatus("Préparation de la photo…");
    try {
      formPhoto = await resizePhoto(file);
      const preview = root.querySelector("#photo-preview");
      if (preview) preview.innerHTML = `<img src="${escapeHtml(formPhoto)}" alt="Aperçu de la photo">`;
      photoStatus("Photo prête · elle sera enregistrée avec la fiche.");
    } catch {
      event.target.value = "";
      photoStatus("Impossible de lire cette image. Essaie un fichier JPG ou PNG.", true);
    }
  });

  root.addEventListener("click", event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (handleModeClick(action, button)) return;
    if (action === "set-design") {
      setDesign(button.dataset.designChoice);
    } else if (action === "set-theme") {
      setTheme(button.dataset.themeChoice);
    } else if (action === "sort-dir") {
      listSort.dir = listSort.dir === "asc" ? "desc" : "asc";
      button.textContent = sortDirLabel();
      refreshPlayerList();
    } else if (action === "filters-reset") {
      listFilters = { position: "", rarity: "", club: "", nationality: "" };
      listSort = { key: "name", dir: "asc" };
      for (const [id, value] of [["filter-position", ""], ["filter-rarity", ""], ["filter-club", ""], ["filter-nationality", ""], ["sort-key", "name"]]) {
        const control = root.querySelector(`#${id}`);
        if (control) control.value = value;
      }
      const directionButton = root.querySelector("#sort-dir");
      if (directionButton) directionButton.textContent = sortDirLabel();
      refreshPlayerList();
    } else if (action === "account") {
      notice = ""; screen = "account"; renderAccount();
    } else if (action === "account-signout") {
      void signOutAccount();
    } else if (action === "home") {
      screen = "menu"; notice = ""; editingId = null; formPhoto = ""; render();
    } else if (action === "settings") {
      screen = "settings"; notice = ""; editingId = null; formPhoto = ""; render();
    } else if (action === "setup") {
      setupSealed = false; screen = "setup"; notice = ""; render();
    } else if (action === "take-setup") {
      screen = "take-setup"; notice = ""; render();
    } else if (action === "edit-player") {
      editingId = button.dataset.id; formPhoto = ""; notice = ""; renderSettings();
      root.querySelector("#player-panel")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    } else if (action === "cancel-edit") {
      editingId = null; formPhoto = ""; notice = ""; renderSettings();
    } else if (action === "delete-player") {
      deletePlayer(button.dataset.id);
    } else if (action === "raise") {
      const amount = Number(root.querySelector("#bid-amount")?.value);
      const bidder = game?.turnIndex;
      if (!game || !Number.isSafeInteger(amount) || amount < game.highBid + 1 || amount > game.budgets[bidder]) {
        setNotice("L’offre doit dépasser le montant actuel d’au moins 1 et ne pas dépasser le budget restant.", "error");
        return;
      }
      game.leaderIndex = bidder;
      game.highBid = amount;
      game.turnIndex = 1 - bidder;
      notice = "";
      renderGame();
    } else if (action === "pass" || action === "finish-auction") {
      awardPlayer();
    } else if (action === "discard") {
      if (!canDiscardCandidate()) return;
      game.candidate = null;
      game.discarded = (game.discarded || 0) + 1;
      game.firstBidder = 1 - game.firstBidder; // la carte défaussée ne compte pas dans l'alternance
      notice = "";
      nextAuction();
    } else if (action === "reveal-candidate") {
      if (!game || game.mode !== "take-leave" || !game.candidate) return;
      game.revealed = true;
      renderPickGame();
    } else if (action === "assign-left") {
      assignPick(0);
    } else if (action === "assign-right") {
      assignPick(1);
    } else if (action === "restart-game") {
      const restartMessage = game?.mode === "take-leave"
        ? "Recommencer la partie ? Les attributions actuelles seront effacées."
        : "Recommencer la partie ? Les équipes et les enchères en cours seront effacées.";
      if (!game || !window.confirm(restartMessage)) return;
      if (game.mode === "take-leave") beginTakeGame(game.names);
      else beginGame(game.initialBudgets[0], game.initialBudgets[1], game.names, game.mystery, game.mysteryClue, game.mode === "sealed");
    } else if (action === "cancel-game") {
      if (!window.confirm("Annuler cette partie et revenir au menu ? La progression de la partie sera perdue.")) return;
      game = null; screen = "menu"; notice = "Partie annulée."; noticeType = ""; render();
    }
  });

  window.addEventListener("online", scheduleCloudSync);
  applyTheme();
  void startApplication();
})();
