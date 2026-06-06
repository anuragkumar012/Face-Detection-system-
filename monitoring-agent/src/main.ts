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
const TRAY_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAACXBIWXMAAAsTAAALEwEAmpwYAAACjElEQVRYR+2WT0sVURjGfd9rzp2pMykUoigkItuIFhZRtGgR+QG6K1rURtCqTdBG0CoIiigigkLchFCEG0HchJtA3AS56e95n3Fm7p3LuefeC8EDD/PMmTPn/M477znvqyRJDGOMMcb8h4S9u5e9j4/b/yS/fM4lD/r9/T/94V/Z/8c8qH1y3/E56x407hE3mQfVvW3cpL0njpvMg+oeNy5n3EPGPeIms3v8z3/B2P9L/L0w9v1L4lFqXy78fXwWfP3t2wO//tbtsW9//e3bfb9+27u+P3z97Zvv62/fHvn1t2/3ff3t2z2/ftu7vj98/e2b7+tv3x759bdv93397ds9v37bu74/fP3tm+/rb98e+fW3b/d9/e3bPb9+27u+P3z97Zvv62/fHvn1t2/3ff3t2z2/ftu7vj98/e2b7+tv3x759bdv93397ds9v37bu74/fP3tm+/rb98e+fW3b/d9/e3bPb9+27u+P3z97Zvv62/fHvn1t2/3ff3/DHzf5/v7w9ffvj32/Uviev3/N/i5v134+vv7jnv+JvGodc+fNq5q3HPG3W/czvP8nL3jHjXuKeNeNeuKo1477oXjXjSu53le2XvOuBeN6znv79h70bhXjHvdudeNe8O4ns/zMbsvGfc1570tB1/Zfc24141737h3jXvPuJ7P83X2fM35nK8Hn3f0qX1l97Jxbxj3rnFvG/eOcT2fZ7z9529Z5/uYrzv/2Z/aV3Y/O5+z98K4l417ybgXjHvdOM/nGZ/mX+z/Jd6P/b/EqR/7R4kbzYPq3jRu1N4Tx03mQXVvGpez7iHjHnGT2T3+579g7P8l/l4Y+/4l8Si1Lxc+x4wxxhhj/C8xAP4Ac6uYdI021p0AAAAASUVORK5CYII=';
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

let permissionGranted = false;
let serviceStarted = false;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

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

// Save config helper
function saveConfig() {
  try {
    let storedToken = deviceToken;
    let isEncrypted = false;
    if (deviceToken && safeStorage.isEncryptionAvailable()) {
      storedToken = safeStorage.encryptString(deviceToken).toString('base64');
      isEncrypted = true;
    }

    const configToStore = {
      deviceId,
      deviceToken: storedToken,
      isEncrypted,
      backendUrl,
      permissionGranted,
      serviceStarted
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToStore, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save config', err);
  }
}

// Register device helper
async function registerDevice() {
  if (!deviceId) {
    deviceId = `AGENT-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  }

  const hostname = os.hostname();
  const username = os.userInfo().username;
  const osType = `${os.type()} ${os.release()}`;

  logEvent('Device Registration Started', { deviceId, hostname, username, os: osType });

  try {
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

    saveConfig();
    logEvent('Device Registration Success', { deviceId });
  } catch (err: any) {
    logEvent('Device Registration Failed', { error: err.message });
    console.error('Registration failed', err);
    // Retry registration in 10 seconds if permission is still granted
    if (permissionGranted) {
      setTimeout(registerDevice, 10000);
    }
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

      if (parsed.permissionGranted !== undefined) {
        permissionGranted = parsed.permissionGranted;
      }

      if (parsed.serviceStarted !== undefined) {
        serviceStarted = parsed.serviceStarted;
      }

      configExists = !!(deviceId && deviceToken);
    } catch (err) {
      console.error('Failed to read config, will re-register', err);
    }
  }

  createWindow();

  if (!permissionGranted) {
    logEvent('Consent Required - Displaying Consent Screen');
    if (mainWindow) {
      mainWindow.show();
    }
    updateTrayMenu();
    return;
  }

  if (!configExists) {
    await registerDevice();
  }

  if (serviceStarted) {
    startHeartbeatService();
  }
  checkForUpdates();
  updateTrayMenu();
}

// Send Device Heartbeat
async function sendHeartbeat() {
  if (!permissionGranted || !serviceStarted || !deviceId) return;
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
  if (permissionGranted && serviceStarted) {
    sendHeartbeat();
    heartbeatInterval = setInterval(sendHeartbeat, 30000); // Every 30 seconds
  }
}

// Auto Update Service
async function checkForUpdates() {
  if (!permissionGranted) return;
  logEvent('Auto Update Check');
  try {
    const response = await fetch(`${backendUrl}/api/v1/agent/version`);
    if (!response.ok) return;

    const data = await response.json();
    if (data.latest_version && data.latest_version !== agentVersion) {
      logEvent('Auto Update Started', { current: agentVersion, latest: data.latest_version });
      logEvent('Auto Update Completed', { version: data.latest_version });
    }
  } catch (err: any) {
    console.error('Update check failed', err);
  }
}

// Create Main UI Window
function createWindow() {
  mainWindow = new BrowserWindow({
    show: !permissionGranted, // Open visible on first start/if permission not granted
    width: 700,
    height: 600,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

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

  let statusLabel = 'Status: Stopped';
  if (!permissionGranted) {
    statusLabel = 'Status: Consent Required';
  } else if (serviceStarted) {
    statusLabel = 'Status: Running';
  }

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    { label: `Company Monitoring Agent (v${agentVersion})`, enabled: false },
    { label: `Device ID: ${deviceId || 'Not Registered'}`, enabled: false },
    { type: 'separator' },
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Control Panel',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    }
  ];

  if (permissionGranted) {
    if (serviceStarted) {
      menuTemplate.push({
        label: 'Stop Service',
        click: () => {
          serviceStarted = false;
          logEvent('Service Stopped', { audit: true });
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          saveConfig();
          updateTrayMenu();
          if (mainWindow) {
            mainWindow.webContents.send('state-updated', {
              permissionGranted,
              serviceStarted,
              deviceId,
              deviceToken,
              backendUrl
            });
          }
        }
      });
    } else {
      menuTemplate.push({
        label: 'Start Service',
        click: () => {
          serviceStarted = true;
          logEvent('Service Started', { audit: true });
          startHeartbeatService();
          saveConfig();
          updateTrayMenu();
          if (mainWindow) {
            mainWindow.webContents.send('state-updated', {
              permissionGranted,
              serviceStarted,
              deviceId,
              deviceToken,
              backendUrl
            });
          }
        }
      });
    }
  }

  menuTemplate.push(
    { type: 'separator' },
    {
      label: 'Force Heartbeat',
      enabled: permissionGranted && serviceStarted,
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
  );

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setToolTip('Company Monitoring Agent');
  tray.setContextMenu(contextMenu);
}

// IPC Registration
ipcMain.handle('get-service-state', () => {
  return {
    permissionGranted,
    serviceStarted,
    deviceId,
    deviceToken,
    backendUrl
  };
});

ipcMain.handle('update-service-state', async (_, state: { permissionGranted?: boolean; serviceStarted?: boolean }) => {
  let changed = false;

  if (state.permissionGranted !== undefined && state.permissionGranted !== permissionGranted) {
    permissionGranted = state.permissionGranted;
    changed = true;

    if (permissionGranted) {
      logEvent('Consent Granted', { audit: true });
      if (!deviceId || !deviceToken) {
        await registerDevice();
      }
    } else {
      logEvent('Consent Revoked', { audit: true });
      serviceStarted = false;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    }
  }

  if (state.serviceStarted !== undefined && state.serviceStarted !== serviceStarted) {
    if (permissionGranted) {
      serviceStarted = state.serviceStarted;
      changed = true;

      if (serviceStarted) {
        logEvent('Service Started', { audit: true });
        startHeartbeatService();
      } else {
        logEvent('Service Stopped', { audit: true });
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
      }
    }
  }

  if (changed) {
    saveConfig();
    updateTrayMenu();
    if (mainWindow) {
      mainWindow.webContents.send('state-updated', {
        permissionGranted,
        serviceStarted,
        deviceId,
        deviceToken,
        backendUrl
      });
    }
  }

  return {
    permissionGranted,
    serviceStarted,
    deviceId,
    deviceToken,
    backendUrl
  };
});

ipcMain.on('quit-app', () => {
  logEvent('Agent Decline and Exit');
  app.isQuitting = true;
  app.quit();
});

ipcMain.on('log-event', (_, event, details) => {
  logEvent(event, details);
});

// Stub cache-offline-frame IPC handler to do nothing
ipcMain.on('cache-offline-frame', (_, buffer: ArrayBuffer) => {
  console.log('Offline frame cache requested, but disabled per real-time requirement.');
});

// App Startup / Window Settings
const isLock = app.requestSingleInstanceLock();
if (!isLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
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
