// The desktop app: runs the app's server (the Next.js standalone build) with
// Electron's own Node, then opens the app in the user's browser. A small
// window shows it's running; closing it stops the server.
//
// The app opens in the browser rather than an Electron window because
// Spotify's player needs Widevine DRM, which stock Electron doesn't have.

import { app, BrowserWindow, dialog, shell, utilityProcess } from "electron";
import { createWriteStream, mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
// Fixed: the Spotify Redirect URI users register names this port.
const PORT = 3000;
const APP_URL = `http://${HOST}:${PORT}`;

const here = path.dirname(fileURLToPath(import.meta.url));
// Installed: copied in by electron-builder (electron-builder.yml). From a
// checkout (npm run desktop): the build output itself.
const serverDir = app.isPackaged
  ? path.join(process.resourcesPath, "server", "standalone")
  : path.join(here, "..", ".next", "standalone");
// Kept apart from Electron's own files in userData.
const dataDir = path.join(app.getPath("userData"), "data");
const logPath = path.join(dataDir, "server.log");

let server = null;
let statusWindow = null;
let quitting = false;

function portFree() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(PORT, HOST);
  });
}

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!server) return false;
    try {
      const res = await fetch(`${APP_URL}/api/auth/status`);
      if (res.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function startServer() {
  mkdirSync(dataDir, { recursive: true });
  const log = createWriteStream(logPath, { flags: "a" });
  log.write(`\n--- ${new Date().toISOString()} starting ---\n`);
  server = utilityProcess.fork(path.join(serverDir, "server.js"), [], {
    cwd: serverDir,
    stdio: "pipe",
    serviceName: "Subgenre Assistant server",
    env: { ...process.env, NODE_ENV: "production", HOSTNAME: HOST, PORT: String(PORT), SGH_DATA_DIR: dataDir },
  });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  server.once("exit", (code) => {
    server = null;
    if (quitting) return;
    dialog.showErrorBox(
      "Subgenre Assistant stopped",
      `The app's server quit unexpectedly (code ${code}). Details are in:\n${logPath}`
    );
    app.quit();
  });
}

function openInBrowser() {
  shell.openExternal(APP_URL);
}

function showStatusWindow() {
  if (statusWindow) {
    statusWindow.show();
    return;
  }
  statusWindow = new BrowserWindow({
    width: 440,
    height: 300,
    resizable: false,
    title: "Spotify Subgenre Assistant",
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // Links in the page open in the user's browser, never in this window.
  statusWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("file:")) shell.showItemInFolder(fileURLToPath(url));
    else if (url.startsWith("http:") || url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });
  statusWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  statusWindow.loadFile(path.join(here, "status.html"), {
    query: { url: APP_URL, data: dataDir, log: logPath },
  });
  statusWindow.on("closed", () => {
    statusWindow = null;
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  // Already running: that copy opens the browser again (second-instance).
  app.quit();
} else {
  app.on("second-instance", () => {
    showStatusWindow();
    openInBrowser();
  });

  app.whenReady().then(async () => {
    if (!(await portFree())) {
      dialog.showErrorBox(
        "Port 3000 is in use",
        `Another program is using ${APP_URL}, which this app needs (Spotify only accepts that address). ` +
          "Close it, for example a copy of the app started with npm run dev, and open this app again."
      );
      app.quit();
      return;
    }
    startServer();
    showStatusWindow();
    if (await waitForServer()) openInBrowser();
    else if (server) {
      dialog.showErrorBox("Subgenre Assistant didn't start", `The server didn't respond. Details are in:\n${logPath}`);
      app.quit();
    }
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    server?.kill();
  });
}
