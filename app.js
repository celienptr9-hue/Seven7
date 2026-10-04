(() => {
  "use strict";

  const STORAGE_KEY = "seven-footballers-v1";
  const THEME_KEY = "seven-theme";
  const THEME_CHOICES = [
    { id: "dark", label: "Sombre" },
    { id: "light", label: "Clair" }
  ];
  const THEME_META_COLORS = { dark: "#173d30", light: "#ffffff" };
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
  const POSITION_ICONS = { Gardien: "🧤", Défenseur: "🛡️", Milieu: "↔", Attaquant: "⚽" };
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

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", themeChoice);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_META_COLORS[themeChoice]);
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

  function money(value) {
    return `${Number(value).toLocaleString("fr-FR")} crédit${Number(value) === 1 ? "" : "s"}`;
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
  }

  function positionIcon(position) {
    return `<span class="position-icon" role="img" aria-label="${escapeHtml(position)}" title="${escapeHtml(position)}">${POSITION_ICONS[position]}</span>`;
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
    return `<div class="inventory-bar${inventory.ready ? " ready" : ""}" role="status"><span class="inventory-label">${label}</span><div class="inventory-chips">${chips}</div>${withLink && !inventory.ready ? `<button class="button quiet" data-action="settings">Compléter →</button>` : ""}</div>`;
  }

  function renderMenu() {
    screen = "menu";
    const inventory = inventoryShortages();
    shell(`<section class="menu-layout">
      <div class="menu-copy">
        <div class="eyebrow">Menu principal</div>
        <h1 class="page-title">Seven</h1>
        <div class="mode-grid" aria-label="Menu principal">
          <button class="mode-card primary-mode" data-action="setup"><span class="mode-number">01</span><strong>Jouer</strong><span>Seven · ${players.length} joueurs en base</span></button>
          <button class="mode-card" data-action="take-setup"><span class="mode-number">02</span><strong>Prendre ou laisser</strong><span>Choisir une équipe</span></button>
          <button class="mode-card settings-mode" data-action="settings"><span class="mode-number">03</span><strong>Paramètres</strong><span>Gérer les joueurs</span></button>
        </div>
        ${inventory.ready ? "" : `<p class="inventory-summary warning-text">Il manque ${inventory.missingTotal} joueur${inventory.missingTotal > 1 ? "s" : ""} · compléter la base dans Paramètres</p>`}
      </div>
      <div class="menu-panel" aria-hidden="true"><div class="pitch-box"></div><div class="pitch-box right"></div><div class="panel-content"><span class="panel-label">Mode 01</span><span class="panel-number">7</span><span class="panel-caption">Deux équipes, sept joueurs chacune.</span></div></div>
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
    shell(`<section class="setup-layout account-layout"><div class="section-head"><div><div class="eyebrow">Sauvegarde en ligne</div><h1 class="page-title">Mon compte</h1></div></div>${content}</section>`);
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
    shell(`<section class="section-head"><div><div class="eyebrow">Paramètres</div><h1 class="page-title">Joueurs</h1></div><div class="head-actions">${themeSwitchHtml()}<button class="button secondary" data-action="home">← Menu</button></div></section>
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
    shell(`<section class="setup-layout"><div class="section-head"><div><div class="eyebrow">Nouvelle partie</div><h1 class="page-title">Joueurs & budgets</h1></div><button class="button secondary" data-action="home">← Menu</button></div>
      ${noticeHtml()}${inventoryBarHtml(false, true)}
      <form class="setup-panel" id="setup-form"><h2>Pseudos</h2>
        <div class="budget-grid">
          <div class="field"><label for="name-left">Joueur de gauche</label><input id="name-left" name="leftName" maxlength="24" value="${escapeHtml(setupNames[0])}" required></div>
          <div class="field"><label for="name-right">Joueur de droite</label><input id="name-right" name="rightName" maxlength="24" value="${escapeHtml(setupNames[1])}" required></div>
        </div>
        <h2>Budget de départ</h2>
        <div class="budget-grid">
          <div class="field budget-field"><label for="budget-left">Joueur de gauche</label><input id="budget-left" name="leftBudget" type="number" min="0" max="1000000" step="1" value="25" required><span class="currency">cr.</span></div>
          <div class="field budget-field"><label for="budget-right">Joueur de droite</label><input id="budget-right" name="rightBudget" type="number" min="0" max="1000000" step="1" value="25" required><span class="currency">cr.</span></div>
        </div>
        <div class="mystery-settings">
          <label class="mystery-toggle" for="mystery-mode"><input id="mystery-mode" name="mystery" type="checkbox" ${setupMystery ? "checked" : ""}><span>Joueur mystère</span></label>
          <div class="field mystery-clue-field"><label for="mystery-clue">Caractéristiques à montrer</label><select id="mystery-clue" name="mysteryClue" ${setupMystery ? "" : "disabled"}><option value="club" ${setupMysteryClue === "club" ? "selected" : ""}>Club</option><option value="nationality" ${setupMysteryClue === "nationality" ? "selected" : ""}>Nationalité</option><option value="position" ${setupMysteryClue === "position" ? "selected" : ""}>Poste</option><option value="chaos" ${setupMysteryClue === "chaos" ? "selected" : ""}>Chaos · un indice aléatoire</option><option value="chaos-plus" ${setupMysteryClue === "chaos-plus" ? "selected" : ""}>Chaos+ · zéro à plusieurs indices</option></select></div>
        </div>
        <button class="button" type="submit" ${inventoryShortages().ready ? "" : "disabled"}>Lancer la partie →</button>
      </form></section>`);
  }

  function renderTakeSetup() {
    screen = "take-setup";
    shell(`<section class="setup-layout"><div class="section-head"><div><div class="eyebrow">Nouvelle partie</div><h1 class="page-title">Prendre ou laisser</h1></div><button class="button secondary" data-action="home">← Menu</button></div>
      ${noticeHtml()}${inventoryBarHtml(false, true)}
      <form class="setup-panel" id="take-setup-form"><h2>Pseudos</h2>
        <div class="budget-grid">
          <div class="field"><label for="take-name-left">Joueur de gauche</label><input id="take-name-left" name="leftName" maxlength="24" value="${escapeHtml(setupNames[0])}" required></div>
          <div class="field"><label for="take-name-right">Joueur de droite</label><input id="take-name-right" name="rightName" maxlength="24" value="${escapeHtml(setupNames[1])}" required></div>
        </div>
        <button class="button" type="submit" ${inventoryShortages().ready ? "" : "disabled"}>Commencer →</button>
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
    return `<section class="${classes}" ${game.turnIndex === index ? 'aria-current="step"' : ""}><div class="team-heading"><div><h2>${escapeHtml(game.names[index])}</h2><div class="team-status">${acquired} / 7</div>${game.turnIndex === index ? `<span class="turn-badge">À toi</span>` : ""}</div>${showBudget ? `<div class="budget">${money(game.budgets[index])}</div>` : ""}</div>
      ${showBudget ? `<div class="spending-line"><span>Dépensé</span><strong>${money(game.spent[index])}</strong></div>` : ""}
      <div class="progress-track"><div class="progress-fill" style="width:${Math.round(acquired / 7 * 100)}%"></div></div>
      <div class="position-list">${POSITIONS.map(position => {
        const entries = team.filter(player => player.position === position);
        const slots = Array.from({ length: COUNTS[position] }, (_, i) => entries[i]
          ? `<div class="roster-player"><span class="roster-dot"></span><span>${escapeHtml(entries[i].name)}</span></div>`
          : `<div class="roster-empty">Emplacement libre</div>`).join("");
        return `<div class="position-group"><div class="position-label"><span>${positionIcon(position)}</span><span>${entries.length} / ${COUNTS[position]}</span></div><div class="position-items">${slots}</div></div>`;
      }).join("")}</div></section>`;
  }

  function candidateMarkup() {
    const player = game.candidate;
    if (game.mystery) {
      const clueText = game.currentClues.length
        ? game.currentClues.map(clue => `${clue.label} · ${clue.value}`).join(" · ")
        : "Aucun indice";
      return `<div class="mystery-mark" aria-hidden="true">?</div><h2 class="candidate-name">Joueur mystère</h2><div class="candidate-detail">${escapeHtml(clueText)}</div>`;
    }
    return `<div class="candidate-photo"${clubStyle(player)}>${photoMarkup(player.photo, player.name)}</div><h2 class="candidate-name">${escapeHtml(player.name)}</h2><div class="candidate-detail">${positionIcon(player.position)} ${escapeHtml([player.nationality, player.club].filter(Boolean).join(" · "))} ${rarityBadgeHtml(player)}</div>`;
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
    const bidControls = bidderCanRaise
      ? `<div class="bid-controls"><input id="bid-amount" aria-label="Montant de la surenchère" type="number" min="${game.highBid + 1}" max="${game.budgets[bidder]}" step="1" value="${Math.min(game.highBid + 1, game.budgets[bidder])}"><button class="button warning" data-action="raise">Enchérir</button><button class="button secondary" data-action="pass">Laisser à ${escapeHtml(leaderName)}</button></div>`
      : `<div class="bid-controls forced"><button class="button warning" data-action="finish-auction">Laisser à ${escapeHtml(leaderName)}</button></div>`;
    const completed = game.teams[0].length + game.teams[1].length;
    shell(`<section class="game-top"><div><div class="eyebrow">Enchère ${Math.floor(completed / 2) + 1}</div><h1 class="page-title">${escapeHtml(bidderName)} joue</h1><p class="subtle">${completed} / 14 attribués</p></div><button class="button danger" data-action="cancel-game">Quitter</button></section>
      <div class="game-layout">${teamPanel(0)}
        <section class="center-stage"><div class="center-label">Aux enchères</div>${candidateMarkup()}
          <div class="bid-box"><div class="bid-line"><span>Offre de ${escapeHtml(leaderName)}</span><span>+1 minimum</span></div><div class="bid-value">${money(game.highBid)}</div><div class="turn-note" aria-live="polite">${escapeHtml(turnText)}</div>${bidControls}</div>
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
    return `<div class="formation-player ${side}-formation ${role}" style="left:${x}%;top:${y}%" title="${escapeHtml(player.name)} · ${escapeHtml(player.position)}" aria-label="${escapeHtml(player.name)}, ${escapeHtml(player.position)}"><span class="formation-avatar"${clubStyle(player)}>${photoMarkup(player.photo, player.name)}</span><span class="formation-name">${escapeHtml(player.name)}</span></div>`;
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
    return `<section class="formation-section"><div class="formation-heading"><h2>Composition sur le terrain</h2><div class="formation-teams"><span class="left-team-label">${escapeHtml(game.names[0])}</span><span class="right-team-label">${escapeHtml(game.names[1])}</span></div></div><div class="tactical-pitch" aria-label="Schéma tactique des deux équipes"><div class="pitch-lines" aria-hidden="true"><span class="pitch-center-line"></span><span class="pitch-center-circle"></span><span class="pitch-box left-box"></span><span class="pitch-box right-box"></span></div>${markers}</div></section>`;
  }

  function renderResults() {
    screen = "results";
    const resultTeam = index => `<section class="result-panel"><h2>${escapeHtml(game.names[index])}</h2>${game.mode === "take-leave" ? "" : `<div class="result-total"><span>Budget restant</span><strong>${money(game.budgets[index])}</strong></div><div class="result-total"><span>Dépensé</span><strong>${money(game.spent[index])}</strong></div>`}<div class="result-roster">${POSITIONS.map(position => game.teams[index].filter(player => player.position === position).map(player => `<div class="result-player"><span>${positionIcon(position)} ${escapeHtml(player.name)} ${rarityBadgeHtml(player)}</span><small>${hasRating(player) ? `${formatRating(player.rating)}/10` : "—"}</small></div>`).join("")).join("")}</div>${teamAverageHtml(game.teams[index])}</section>`;
    shell(`<section class="section-head"><div><div class="eyebrow">${game.mode === "take-leave" ? "Prendre ou laisser" : "Seven"} · Partie terminée</div><h1 class="page-title">Équipes au complet.</h1></div><button class="button secondary" data-action="home">Menu principal</button></section>
      ${noticeHtml()}<div class="results-layout">${resultTeam(0)}${resultTeam(1)}</div>${tacticalFormation()}
      <div class="game-actions"><button class="button" data-action="restart-game">Rejouer</button><button class="button secondary" data-action="${game.mode === "take-leave" ? "take-setup" : "setup"}">Nouvelle partie</button></div>`);
  }

  function renderBlocked() {
    screen = "blocked";
    shell(`<section class="section-head"><div><div class="eyebrow">${game.mode === "take-leave" ? "Prendre ou laisser" : "Seven"} · Partie interrompue</div><h1 class="page-title">Composition incomplète.</h1><p class="subtle">${escapeHtml(game.blockedReason || "La partie ne peut pas continuer avec les joueurs disponibles.")}</p></div><button class="button secondary" data-action="home">Menu principal</button></section>
      <div class="results-layout">${[0, 1].map(index => `<section class="result-panel"><h2>${escapeHtml(game.names[index])}</h2><div class="result-total"><span>Effectif</span><strong>${game.teams[index].length} / 7</strong></div>${game.mode === "take-leave" ? "" : `<div class="result-total"><span>Budget restant</span><strong>${money(game.budgets[index])}</strong></div><div class="result-total"><span>Dépensé</span><strong>${money(game.spent[index])}</strong></div>`}<div class="result-roster">${POSITIONS.map(position => game.teams[index].filter(player => player.position === position).map(player => `<div class="result-player"><span>${positionIcon(position)} ${escapeHtml(player.name)}</span></div>`).join("")).join("")}</div></section>`).join("")}</div>
      <div class="game-actions"><button class="button" data-action="restart-game">Recommencer</button><button class="button secondary" data-action="settings">Vérifier la base</button></div>`);
  }

  function render() {
    if (screen === "account") renderAccount();
    else if (screen === "settings") renderSettings();
    else if (screen === "setup") renderSetup();
    else if (screen === "take-setup") renderTakeSetup();
    else if (screen === "game") renderGame();
    else if (screen === "results") renderResults();
    else if (screen === "blocked") renderBlocked();
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
      game.currentClues = mysteryClues(candidate, game.mysteryClue);
      if (eligible.length === 1) {
        game.leaderIndex = eligible[0];
        game.highBid = 0;
        game.turnIndex = 1 - eligible[0];
        awardPlayer();
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
      if (eligible.length === 1) {
        game.teams[eligible[0]].push(candidate);
        continue;
      }
      game.candidate = candidate;
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

  function beginGame(leftBudget, rightBudget, names = setupNames, mystery = setupMystery, mysteryClue = setupMysteryClue) {
    const inventory = inventoryShortages();
    if (!inventory.ready) {
      screen = "setup";
      setNotice(`Partie non lancée : il manque ${inventory.missingTotal} joueur${inventory.missingTotal === 1 ? "" : "s"} dans la base.`, "error");
      return;
    }
    const pool = [...players].sort(() => Math.random() - .5);
    game = { teams: [[], []], names: [...names], budgets: [leftBudget, rightBudget], spent: [0, 0], pool, candidate: null, currentClues: [], leaderIndex: 0, turnIndex: 1, highBid: 0, firstBidder: 0, initialBudgets: [leftBudget, rightBudget], mystery, mysteryClue };
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
    const pool = [...players].sort(() => Math.random() - .5);
    game = { mode: "take-leave", teams: [[], []], names: [...names], pool, candidate: null, turnIndex: 0 };
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
      beginGame(left, right, setupNames, setupMystery, setupMysteryClue);
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
    if (action === "set-theme") {
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
      screen = "setup"; notice = ""; render();
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
      else beginGame(game.initialBudgets[0], game.initialBudgets[1], game.names, game.mystery, game.mysteryClue);
    } else if (action === "cancel-game") {
      if (!window.confirm("Annuler cette partie et revenir au menu ? La progression de la partie sera perdue.")) return;
      game = null; screen = "menu"; notice = "Partie annulée."; noticeType = ""; render();
    }
  });

  window.addEventListener("online", scheduleCloudSync);
  applyTheme();
  void startApplication();
})();
