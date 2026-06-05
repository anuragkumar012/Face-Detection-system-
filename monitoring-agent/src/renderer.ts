interface Window {
  api: {
    getAgentConfig: () => Promise<{ deviceId: string; deviceToken: string; backendUrl: string }>;
    logEvent: (event: string, details: any) => void;
    cacheOfflineFrame: (buffer: ArrayBuffer) => void;
    onConfigUpdated: (callback: (config: any) => void) => void;
  };
}

let deviceId = '';
let deviceToken = '';
let backendUrl = '';
let captureInterval: NodeJS.Timeout | null = null;
let isUploading = false;
let lastUploadStatus = true; // Track last upload to only log on transitions

let ws: WebSocket | null = null;
let reconnectWsTimeout: NodeJS.Timeout | null = null;

function connectWebSocket() {
  if (!backendUrl) return;

  const wsProtocol = backendUrl.startsWith("https") ? "wss" : "ws";
  const wsUrl = `${backendUrl.replace(/^https?:\/\//, `${wsProtocol}://`)}/ws?device_id=${deviceId}&token=${deviceToken}`;

  console.log("[WebSocket] Connecting to", wsUrl);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[WebSocket] Connected successfully");
    window.api.logEvent('WebSocket Connected', { deviceId });
  };

  ws.onmessage = (event) => {
    // Handle incoming frames/commands if needed
  };

  ws.onerror = (err) => {
    console.error("[WebSocket] Error:", err);
  };

  ws.onclose = () => {
    console.log("[WebSocket] Connection closed. Reconnecting in 3s...");
    if (reconnectWsTimeout) clearTimeout(reconnectWsTimeout);
    reconnectWsTimeout = setTimeout(connectWebSocket, 3000);
  };
}

const video = document.getElementById('webcam') as HTMLVideoElement;
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

async function init() {
  try {
    const config = await window.api.getAgentConfig();
    deviceId = config.deviceId;
    deviceToken = config.deviceToken;
    backendUrl = config.backendUrl;

    statusDiv.innerText = 'Connecting to camera...';
    window.api.logEvent('Camera Started', { deviceId });

    // Connect to WebSocket
    connectWebSocket();

    // Initialize Camera
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 10 }
      },
      audio: false
    });

    video.srcObject = stream;

    video.onloadedmetadata = () => {
      statusDiv.innerText = 'Camera streaming active. Uploading...';
      startCapture();
    };
  } catch (err: any) {
    statusDiv.innerText = `Camera error: ${err.message}`;
    window.api.logEvent('Camera Failed', { error: err.message });
  }
}

// Receive updated credentials/url dynamically if they change
window.api.onConfigUpdated((config) => {
  deviceId = config.deviceId;
  deviceToken = config.deviceToken;
  backendUrl = config.backendUrl;

  if (ws) {
    ws.close();
  } else {
    connectWebSocket();
  }
});

function startCapture() {
  if (captureInterval) clearInterval(captureInterval);

  captureInterval = setInterval(async () => {
    if (isUploading) return;
    isUploading = true;

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        isUploading = false;
        return;
      }

      // Resize to max width 640px preserving aspect ratio
      const maxW = 640;
      let w = video.videoWidth || 640;
      let h = video.videoHeight || 480;
      if (w > maxW) {
        h = Math.round(h * (maxW / w));
        w = maxW;
      }
      canvas.width = w;
      canvas.height = h;

      // Draw the video frame to the canvas
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
            statusDiv.innerText = 'Streaming live to company server.';
            if (!lastUploadStatus) {
              window.api.logEvent('Backend Reconnected', { deviceId });
              lastUploadStatus = true;
            }
          } else {
            throw new Error(`Server returned ${response.status}`);
          }
        } catch (uploadErr: any) {
          statusDiv.innerText = 'Backend unavailable. Saving to local cache...';
          
          if (lastUploadStatus) {
            window.api.logEvent('Backend Connection Lost', { error: uploadErr.message });
            lastUploadStatus = false;
          }

          // Convert blob to ArrayBuffer and cache offline
          const reader = new FileReader();
          reader.onloadend = () => {
            if (reader.result instanceof ArrayBuffer) {
              window.api.cacheOfflineFrame(reader.result);
            }
          };
          reader.readAsArrayBuffer(blob);
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

// Start
init();
