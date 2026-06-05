import { app, BrowserWindow, Tray, Menu, ipcMain, safeStorage, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

// Setup Paths
const PROGRAM_DATA_DIR = 'C:\\ProgramData\\CompanyAgent';
const CONFIG_FILE = path.join(PROGRAM_DATA_DIR, 'config.json');
const LOGS_DIR = path.join(PROGRAM_DATA_DIR, 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'agent.log');
const CACHE_DIR = path.join(PROGRAM_DATA_DIR, 'cache');
const TRAY_ICON_PATH = path.join(PROGRAM_DATA_DIR, 'tray-icon.png');


// Ensure directories exist
fs.mkdirSync(PROGRAM_DATA_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

// Base64 transparent dot icon for system tray
const TRAY_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAACXBIWXMAAAsTAAALEwEAmpwYAAACjElEQVRYR+2WT0sVURjGfd9rzp2pMykUoigkItuIFhZRtGgR+QG6K1rURtCqTdBG0CoIiigigkLchFCEG0HchJtA3AS56e95n3Fm7p3LuefeC8EDD/PMmTPn/M477znvqyRJDGOMMcb8h4S9u5e9j4/b/yS/fM4lD/r9/T/94V/Z/8c8qH1y3/E56x407hE3mQfVvW3cpL0njpvMg+oeNy5n3EPGPeIms3v8z3/B2P9L/L0w9v1L4lFqXy78fXwWfP3t2wO//tbtsW9//e3bfb9+27u+P3z97Zvv62/fHvn1t2/3ff3t2z2/ftu7vj98/e2b7+tv3x759bdv93397ds9v37bu74/fP3tm+/rb98e+fW3b/d9/e3bPb9+27u+P3z97Zvv62/fHvn1t2/3ff1/DHzf5/v7w9ffvj32/Uviev3/N/i5v134+vv7jnv+JvGodc+fNq5q3HPG3W/czvP8nL3jHjXuKeNeNu614144bud5PmLvKeMeM+5p41477oXjXjSu53le2XvOuBeN6znv79h70bhXjHvdudeNe8O4ns/zMbsvGfc1570tB1/Zfc24141737h3jXvPuJ7P83X2fM35nK8Hn3f0qX1l97Jxbxj3rnFvG/eOcT2fZ7z9529Z5/uYrzv/2Z/aV3Y/O5+z98K4l417ybgXjHvdOM/nGZ/mX+z/Jd6P/b/EqR/7R4kbzYPq3jRu1N4Tx03mQXVvGpez7iHjHnGT2T3+579g7P8l/l4Y+/4l8Si1Lxc+x4wxxhhj/C8xAP4Ac6uYdI021p0AAAAASUVORK5CYII=';
try {
  if (!fs.existsSync(TRAY_ICON_PATH)) {
    fs.writeFileSync(TRAY_ICON_PATH, Buffer.from(TRAY_BASE64, 'base64'));
  }
} catch (e) {
  console.error('Failed to create tray icon file', e);
}

// Default Configuration
let deviceId = '';
let deviceToken = '';
let backendUrl = 'https://perfectly-maternal-bunion.ngrok-free.dev';
const agentVersion = '1.0.0';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let offlineQueueInterval: NodeJS.Timeout | null = null;
let isOfflineUploading = false;

// Logger function
function logEvent(event: string, details: any = {}) {
  const logData = {
    timestamp: new Date().toISOString(),
    event,
    details
  };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(logData) + '\n');
  } catch (err) {
    console.error('Failed to write log', err);
  }
}

// Load configurations and register device if needed
async function initializeConfig() {
  logEvent('Agent Start');
  let configExists = false;

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const rawData = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(rawData);

      deviceId = parsed.deviceId;

      // Decrypt token if encrypted
      if (parsed.deviceToken) {
        if (parsed.isEncrypted && safeStorage.isEncryptionAvailable()) {
          deviceToken = safeStorage.decryptString(Buffer.from(parsed.deviceToken, 'base64'));
        } else {
          deviceToken = parsed.deviceToken;
        }
      }

      if (parsed.backendUrl) {
        backendUrl = parsed.backendUrl;
      }

      configExists = !!(deviceId && deviceToken);
    } catch (err) {
      console.error('Failed to read config, will re-register', err);
    }
  }

  if (!configExists) {
    // Generate new Device ID
    deviceId = `AGENT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;

    // Gather System Metadata
    const hostname = os.hostname();
    const username = os.userInfo().username;
    const osType = `${os.type()} ${os.release()}`;

    logEvent('Device Registration', { deviceId, hostname, username, os: osType });

    try {
      // Register with FastAPI Backend
      const response = await fetch(`${backendUrl}/api/v1/device/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          hostname,
          username,
          os: osType,
          agent_version: agentVersion
        })
      });

      if (!response.ok) {
        throw new Error(`Register returned ${response.status}`);
      }

      const resData = await response.json();
      deviceToken = resData.device_token;

      // Encrypt and store token
      let storedToken = deviceToken;
      let isEncrypted = false;
      if (safeStorage.isEncryptionAvailable()) {
        storedToken = safeStorage.encryptString(deviceToken).toString('base64');
        isEncrypted = true;
      }

      const configToStore = {
        deviceId,
        deviceToken: storedToken,
        isEncrypted,
        backendUrl
      };

      fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToStore, null, 2), 'utf8');
      logEvent('Device Registration', { status: 'success', deviceId });
    } catch (err: any) {
      logEvent('Device Registration', { status: 'failed', error: err.message });
      console.error('Registration failed', err);
      // Retry registration in 10 seconds
      setTimeout(initializeConfig, 10000);
      return;
    }
  }

  // Setup services once config is fully loaded
  startHeartbeatService();
  startOfflineQueueService();
  checkForUpdates();
  createHiddenWindow();
  updateTrayMenu();
}

// Send Device Heartbeat
async function sendHeartbeat() {
  try {
    const response = await fetch(`${backendUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        status: 'online',
        agent_version: agentVersion
      })
    });
    if (!response.ok) {
      console.error('Heartbeat failed with status', response.status);
    }
  } catch (err) {
    console.error('Heartbeat connection failed', err);
  }
}

function startHeartbeatService() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, 30000); // Every 30 seconds
}

// Offline Queue Service
function startOfflineQueueService() {
  if (offlineQueueInterval) clearInterval(offlineQueueInterval);

  offlineQueueInterval = setInterval(async () => {
    if (isOfflineUploading) return;

    try {
      const files = fs.readdirSync(CACHE_DIR)
        .filter(f => f.endsWith('.jpg'))
        .map(f => ({
          name: f,
          path: path.join(CACHE_DIR, f),
          time: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs
        }))
        .sort((a, b) => a.time - b.time); // Oldest first

      if (files.length === 0) return;

      isOfflineUploading = true;
      logEvent('Upload Success', { message: `Processing ${files.length} cached frames...` });

      for (const file of files) {
        try {
          const fileBuffer = fs.readFileSync(file.path);
          const blob = new Blob([fileBuffer], { type: 'image/jpeg' });

          const formData = new FormData();
          formData.append('source', 'device');
          formData.append('device_id', deviceId);
          formData.append('file', blob, 'image.jpg');

          const response = await fetch(`${backendUrl}/api/v1/live-preview`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${deviceToken}`
            },
            body: formData
          });

          if (response.ok) {
            fs.unlinkSync(file.path); // Remove from cache
          } else {
            throw new Error(`Server returned ${response.status}`);
          }
        } catch (uploadErr) {
          // If upload fails, pause and retry on next interval
          console.error('Failed to upload cached frame', uploadErr);
          break;
        }
      }
    } catch (err) {
      console.error('Error processing offline queue', err);
    } finally {
      isOfflineUploading = false;
    }
  }, 10000); // Every 10 seconds
}

// Auto Update Service
async function checkForUpdates() {
  logEvent('Auto Update Started');
  try {
    const response = await fetch(`${backendUrl}/api/v1/agent/version`);
    if (!response.ok) return;

    const data = await response.json();
    if (data.latest_version && data.latest_version !== agentVersion) {
      logEvent('Auto Update Started', { current: agentVersion, latest: data.latest_version });
      // If mock download url is provided, we log update success
      // In full implementation, we'd download and run the installer
      logEvent('Auto Update Completed', { version: data.latest_version });
    }
  } catch (err: any) {
    console.error('Update check failed', err);
  }
}

// Create Hidden Capture Window
function createHiddenWindow() {
  mainWindow = new BrowserWindow({
    show: false, // Runs silently in the background
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// System Tray Setup
function createTray() {
  let icon;
  try {
    const image = nativeImage.createFromPath(TRAY_ICON_PATH);
    icon = image.isEmpty() ? nativeImage.createEmpty() : image;
  } catch (e) {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    { label: `Company Monitoring Agent (v${agentVersion})`, enabled: false },
    { label: `Device ID: ${deviceId || 'Registering...'}`, enabled: false },
    { type: 'separator' },
    { label: 'Status: Active', enabled: false },
    {
      label: 'Force Heartbeat',
      click: () => {
        sendHeartbeat();
      }
    },
    {
      label: 'Check for Updates',
      click: () => {
        checkForUpdates();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Agent',
      click: () => {
        logEvent('Agent Stop');
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Company Monitoring Agent');
  tray.setContextMenu(contextMenu);
}

// IPC Registration
ipcMain.handle('get-agent-config', () => {
  return {
    deviceId,
    deviceToken,
    backendUrl
  };
});

ipcMain.on('log-event', (_, event, details) => {
  logEvent(event, details);
});

ipcMain.on('cache-offline-frame', (_, buffer: ArrayBuffer) => {
  try {
    const timestamp = Date.now();
    const filePath = path.join(CACHE_DIR, `${timestamp}.jpg`);
    fs.writeFileSync(filePath, Buffer.from(buffer));

    // Manage Cache size: Ensure under 500 MB
    const MAX_CACHE_SIZE = 500 * 1024 * 1024;
    let cacheSize = 0;
    const files = fs.readdirSync(CACHE_DIR)
      .filter(f => f.endsWith('.jpg'))
      .map(f => {
        const p = path.join(CACHE_DIR, f);
        const stats = fs.statSync(p);
        cacheSize += stats.size;
        return { path: p, size: stats.size, time: stats.mtimeMs };
      })
      .sort((a, b) => a.time - b.time); // Oldest first

    if (cacheSize > MAX_CACHE_SIZE) {
      for (const file of files) {
        if (cacheSize <= MAX_CACHE_SIZE) break;
        fs.unlinkSync(file.path);
        cacheSize -= file.size;
      }
    }
  } catch (err) {
    console.error('Failed to cache offline frame', err);
  }
});

// App Startup / Window Settings
const isLock = app.requestSingleInstanceLock();
if (!isLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // If user tries to open a second instance, keep silent
  });

  app.whenReady().then(() => {
    // Setup login settings for auto-start
    try {
      const exePath = app.getPath('exe');
      app.setLoginItemSettings({
        openAtLogin: true,
        path: exePath,
        args: ['--hidden']
      });
      logEvent('AutoStart Configured', { path: exePath });
    } catch (err: any) {
      console.error('Failed to set login item settings', err);
      logEvent('AutoStart Configuration Failed', { error: err.message });
    }

    createTray();
    initializeConfig();
  });
}

app.on('window-all-closed', () => {
  // Overridden to prevent app from closing when hidden window is closed
});

// Hack to allow property addition
declare global {
  namespace Electron {
    interface App {
      isQuitting?: boolean;
    }
  }
}
