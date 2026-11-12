const { app, BrowserWindow, Tray, Menu, nativeImage, shell, screen, globalShortcut, session, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const HUD_URL = "http://127.0.0.1:3300/hud";
const APP_URL = "http://127.0.0.1:3300/";
const OPEN = { width: 380, height: 462 };
const REST = { width: 330, height: 312 };
const HARNESS = { width: 1040, height: 760 };

let win = null;
let tray = null;
let clickThrough = false;
let quitting = false;
let hudMode = "assistant";

function log(...args) {
  try {
    const dir = app.getPath("userData");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "hud.log"), `${new Date().toISOString()} ${args.join(" ")}\n`);
  } catch {
    /* log é opcional */
  }
}

function positionFile() {
  return path.join(app.getPath("userData"), "hud-position.json");
}

function readPosition() {
  try {
    const value = JSON.parse(fs.readFileSync(positionFile(), "utf8"));
    if (Number.isFinite(value.x) && Number.isFinite(value.y)) return value;
  } catch {
    /* primeira execução */
  }
  return null;
}

function savePosition() {
  if (!win) return;
  try {
    const [x, y] = win.getPosition();
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(positionFile(), JSON.stringify({ x, y }), "utf8");
  } catch {
    /* posição é opcional */
  }
}

function showWindow() {
  if (!win) {
    createWindow();
    return;
  }
  win.show();
  win.setAlwaysOnTop(true, "screen-saver");
}

function hideWindow() {
  if (win) win.hide();
}

function toggleWindow() {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isVisible()) hideWindow();
  else showWindow();
}

function buildMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Mostrar HUD", click: showWindow },
      { label: "Ocultar HUD", click: hideWindow },
      { type: "separator" },
      {
        label: "Atravessar cliques",
        type: "checkbox",
        checked: clickThrough,
        click: (item) => applyClickThrough(item.checked),
      },
      { label: "Abrir J.A.R.V.I.S.", click: () => shell.openExternal("http://127.0.0.1:3300/") },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function applyClickThrough(value) {
  clickThrough = value;
  if (win) win.setIgnoreMouseEvents(value, { forward: true });
  buildMenu();
}

function clampBounds(target) {
  if (!win) return;
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  let x = Math.round(bounds.x + (bounds.width - target.width) / 2);
  let y = bounds.y;
  x = Math.min(Math.max(x, area.x), area.x + area.width - target.width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - target.height);
  win.setBounds({ x, y, width: target.width, height: target.height });
}

function setOpen(open) {
  if (!win) return;
  if (hudMode === "harness") {
    clampBounds(HARNESS);
    return;
  }
  clampBounds(open ? OPEN : REST);
}

function setMode(mode) {
  hudMode = mode === "harness" ? "harness" : "assistant";
  clampBounds(hudMode === "harness" ? HARNESS : REST);
  log("modo", hudMode);
}

function recenter() {
  if (!win) return;
  const area = screen.getPrimaryDisplay().workArea;
  const bounds = win.getBounds();
  win.setBounds({
    x: Math.round(area.x + area.width - bounds.width - 28),
    y: Math.round(area.y + area.height - bounds.height - 24),
    width: bounds.width,
    height: bounds.height,
  });
  savePosition();
}

function fromHud(event) {
  return event.sender === win?.webContents &&
    event.senderFrame === win.webContents.mainFrame && isHudPage(event.senderFrame?.url);
}

function isHudPage(url) {
  return url?.split("?")[0] === HUD_URL;
}

ipcMain.on("hud:mode", (event, mode) => { if (fromHud(event)) setMode(mode); });
ipcMain.on("hud:recenter", (event) => { if (fromHud(event)) recenter(); });
ipcMain.on("hud:open", (event, open) => { if (fromHud(event)) setOpen(Boolean(open)); });
ipcMain.on("hud:hide", (event) => { if (fromHud(event)) hideWindow(); });


function createWindow() {
  const saved = readPosition();
  const area = (saved ? screen.getDisplayNearestPoint(saved) : screen.getPrimaryDisplay()).workArea;
  const x = saved
    ? Math.min(Math.max(saved.x, area.x), area.x + area.width - REST.width)
    : area.x + area.width - REST.width - 28;
  const y = saved
    ? Math.max(area.y, Math.min(saved.y, area.y + area.height - OPEN.height))
    : Math.max(area.y, area.y + area.height - OPEN.height - 24);

  win = new BrowserWindow({
    width: REST.width,
    height: REST.height,
    x,
    y,
    minWidth: REST.width,
    minHeight: REST.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    thickFrame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setSkipTaskbar(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setMenuBarVisibility(false);

  const origin = new URL(APP_URL).origin;
  const localPage = (url) => {
    const target = new URL(url);
    return target.origin === origin && ["/hud", "/login"].includes(target.pathname);
  };
  win.webContents.on("will-navigate", (event, url) => { if (!localPage(url)) event.preventDefault(); });
  win.webContents.on("will-redirect", (event, url) => { if (!localPage(url)) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === win?.webContents && details.isMainFrame && isHudPage(details.requestingUrl) &&
      (details.securityOrigin === origin || details.securityOrigin === APP_URL) &&
      permission === "media" && details.mediaTypes?.length === 1 && details.mediaTypes[0] === "audio");
  });
  win.webContents.session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    contents === win?.webContents && details.isMainFrame && isHudPage(details.requestingUrl) &&
    (requestingOrigin === origin || requestingOrigin === APP_URL) && permission === "media" && details.mediaType === "audio");
  win.loadURL(HUD_URL).catch((error) => log("load", error.message));

  // Clique em link ou no botão "abrir app" sai para o navegador padrão.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  win.once("ready-to-show", () => {
    win.showInactive();
    log("pronto");
  });

  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    log("falha", code, description, url);
    setTimeout(() => {
      if (win) win.loadURL(HUD_URL).catch(() => {});
    }, 2000);
  });

  win.on("moved", savePosition);
  win.on("resized", savePosition);
  win.on("hide", () => win?.webContents.send("hud:hidden"));
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    win = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "tray.png"));
  tray = new Tray(icon);
  tray.setToolTip("J.A.R.V.I.S. — HUD");
  tray.on("click", toggleWindow);
  buildMenu();
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    app.setAppUserModelId("com.adolfo.jarvis.hud");
    // Service worker antigo do PWA (jarvis-v1) serviu o shell do app dentro do HUD.
    // Limpa o registro nesta sessão do Electron; o /hud atual não registra mais SW.
    session.defaultSession
      .clearStorageData({ storages: ["serviceworkers", "cachestorage"] })
      .catch((error) => log("sw-limpo-erro", error.message))
      .then(() => log("sw-limpo"));
    createWindow();
    createTray();
    globalShortcut.register("Control+Alt+J", toggleWindow);
    globalShortcut.register("Control+Alt+K", () => applyClickThrough(!clickThrough));
    // Falar de qualquer tela: F9 (tecla única, sem combinação de três).
    const talk = globalShortcut.register("F9", () => {
      showWindow();
      if (win) {
        win.showInactive();
        win.focus();
        win.webContents.send("hud:talk");
      }
    });
    log("atalho-talk", talk ? "ok" : "falhou");
    log("iniciado");
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("will-quit", () => globalShortcut.unregisterAll());

  app.on("window-all-closed", () => {
    // Mantém o processo vivo no tray; o HUD é reaberto pelo ícone ou pelo atalho.
  });

  app.on("activate", () => showWindow());
}
