import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getServiceState: () => ipcRenderer.invoke('get-service-state'),
  updateServiceState: (state: any) => ipcRenderer.invoke('update-service-state', state),
  quitApp: () => ipcRenderer.send('quit-app'),
  logEvent: (event: string, details?: any) => ipcRenderer.send('log-event', event, details),
  cacheOfflineFrame: (buffer: ArrayBuffer) => ipcRenderer.send('cache-offline-frame', buffer),
  onStateChanged: (callback: (state: any) => void) => {
    ipcRenderer.on('state-updated', (_, state) => callback(state));
  }
});
