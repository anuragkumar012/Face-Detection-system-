interface Window {
  api: {
    getServiceState: () => Promise<{ permissionGranted: boolean; serviceStarted: boolean; deviceId: string; deviceToken: string; backendUrl: string }>;
    updateServiceState: (state: { permissionGranted?: boolean; serviceStarted?: boolean }) => Promise<{ permissionGranted: boolean; serviceStarted: boolean; deviceId: string; deviceToken: string; backendUrl: string }>;
    quitApp: () => void;
    logEvent: (event: string, details?: any) => void;
    cacheOfflineFrame: (buffer: ArrayBuffer) => void;
    onStateChanged: (callback: (state: any) => void) => void;
  };
}

let permissionGranted = false;
let serviceStarted = false;
let deviceId = '';
let deviceToken = '';
let backendUrl = '';

let stream: MediaStream | null = null;
let captureInterval: NodeJS.Timeout | null = null;
let isUploading = false;

// UI Elements
const consentView = document.getElementById('consent-view') as HTMLDivElement;
const controlView = document.getElementById('control-view') as HTMLDivElement;

const btnDecline = document.getElementById('btn-decline') as HTMLButtonElement;
const btnGrant = document.getElementById('btn-grant') as HTMLButtonElement;
const btnRevoke = document.getElementById('btn-revoke') as HTMLButtonElement;
const btnStartStop = document.getElementById('btn-start-stop') as HTMLButtonElement;

const statusIndicator = document.getElementById('status-indicator') as HTMLDivElement;
const statusText = document.getElementById('status') as HTMLDivElement;
const deviceIdLabel = document.getElementById('device-id-label') as HTMLDivElement;
const backendLabel = document.getElementById('backend-label') as HTMLDivElement;

const video = document.getElementById('webcam') as HTMLVideoElement;
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const cameraPlaceholder = document.getElementById('camera-placeholder') as HTMLDivElement;
const placeholderText = document.getElementById('placeholder-text') as HTMLSpanElement;

const auditLogsContainer = document.getElementById('audit-logs-container') as HTMLDivElement;

// Audit logging helper
function addAuditLog(event: string) {
  const timeStr = new Date().toLocaleTimeString();
  const logLine = document.createElement('div');
  logLine.className = 'audit-log-line';
  logLine.innerHTML = `<span class="audit-time">[${timeStr}]</span><span class="audit-event">${event}</span>`;
  auditLogsContainer.appendChild(logLine);
  auditLogsContainer.scrollTop = auditLogsContainer.scrollHeight;
}

// Camera control helper
async function startCamera() {
  if (stream) return; // Camera already active

  placeholderText.innerText = 'Connecting to camera...';
  addAuditLog('Initializing camera stream...');

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 10 }
      },
      audio: false
    });

    video.srcObject = stream;
    video.classList.remove('hidden');
    cameraPlaceholder.classList.add('hidden');

    startCapture();
    addAuditLog('Webcam stream started successfully.');
    window.api.logEvent('Camera Started', { deviceId });
  } catch (err: any) {
    placeholderText.innerText = `Camera error: ${err.message}`;
    statusText.innerText = `Camera error: ${err.message}`;
    addAuditLog(`Camera activation failed: ${err.message}`);
    window.api.logEvent('Camera Failed', { error: err.message });
  }
}

function stopCamera() {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
    addAuditLog('Webcam stream stopped.');
  }

  video.srcObject = null;
  video.classList.add('hidden');
  cameraPlaceholder.classList.remove('hidden');
  placeholderText.innerText = 'Camera Feed Inactive';
}

// Frame capture & transmission
function startCapture() {
  if (captureInterval) clearInterval(captureInterval);

  captureInterval = setInterval(async () => {
    if (isUploading || !stream || !serviceStarted) return;
    isUploading = true;

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        isUploading = false;
        return;
      }

      // Resize logic
      const maxW = 640;
      let w = video.videoWidth || 640;
      let h = video.videoHeight || 480;
      if (w > maxW) {
        h = Math.round(h * (maxW / w));
        w = maxW;
      }
      canvas.width = w;
      canvas.height = h;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(async (blob) => {
        if (!blob) {
          isUploading = false;
          return;
        }

        try {
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
            statusText.innerText = 'Service Status: Running (Connected)';
          } else {
            throw new Error(`Server returned ${response.status}`);
          }
        } catch (uploadErr: any) {
          statusText.innerText = 'Service Status: Running (Offline - Reconnecting...)';
          // Per requirement 3, do NOT cache the frame offline.
        } finally {
          isUploading = false;
        }
      }, 'image/jpeg', 0.8);

    } catch (err: any) {
      console.error('Capture error:', err);
      isUploading = false;
    }
  }, 500);
}

// UI State Updater
function updateUI(state: { permissionGranted: boolean; serviceStarted: boolean; deviceId: string; deviceToken: string; backendUrl: string }) {
  permissionGranted = state.permissionGranted;
  serviceStarted = state.serviceStarted;
  deviceId = state.deviceId;
  deviceToken = state.deviceToken;
  backendUrl = state.backendUrl;

  if (!permissionGranted) {
    consentView.classList.remove('hidden');
    controlView.classList.add('hidden');
    stopCamera();
    return;
  }

  consentView.classList.add('hidden');
  controlView.classList.remove('hidden');

  deviceIdLabel.innerText = `Device ID: ${deviceId || 'Registering...'}`;
  backendLabel.innerText = `Backend: ${backendUrl}`;

  if (serviceStarted) {
    statusIndicator.className = 'status-dot active';
    statusText.innerText = 'Service Status: Running';
    btnStartStop.innerText = 'Stop Service';
    btnStartStop.className = 'btn btn-secondary';
    startCamera();
  } else {
    statusIndicator.className = 'status-dot stopped';
    statusText.innerText = 'Service Status: Stopped';
    btnStartStop.innerText = 'Start Service';
    btnStartStop.className = 'btn btn-primary';
    stopCamera();
  }
}

// Event Listeners
btnGrant.addEventListener('click', async () => {
  addAuditLog('Granting consent and registering device...');
  const newState = await window.api.updateServiceState({ permissionGranted: true });
  addAuditLog('Consent registered.');
  updateUI(newState);
});

btnDecline.addEventListener('click', () => {
  addAuditLog('Consent declined. Exiting application.');
  // Wait a split second to allow user to see log message
  setTimeout(() => {
    window.api.quitApp();
  }, 300);
});

btnRevoke.addEventListener('click', async () => {
  addAuditLog('Revoking consent...');
  const newState = await window.api.updateServiceState({ permissionGranted: false });
  addAuditLog('Consent revoked. Monitoring stopped.');
  updateUI(newState);
});

btnStartStop.addEventListener('click', async () => {
  const targetStart = !serviceStarted;
  addAuditLog(`Turning service ${targetStart ? 'ON' : 'OFF'}...`);
  const newState = await window.api.updateServiceState({ serviceStarted: targetStart });
  addAuditLog(`Service ${targetStart ? 'started' : 'stopped'}.`);
  updateUI(newState);
});

// Initialization
async function init() {
  addAuditLog('Connecting to monitoring agent service...');
  try {
    const state = await window.api.getServiceState();
    updateUI(state);

    window.api.onStateChanged((newState) => {
      addAuditLog('State synchronization updated.');
      updateUI(newState);
    });
  } catch (err: any) {
    addAuditLog(`Initialization error: ${err.message}`);
  }
}

init();
