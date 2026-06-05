import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getAgentConfig: () => ipcRenderer.invoke('get-agent-config'),
  logEvent: (event: string, details: any) => ipcRenderer.send('log-event', event, details),
  cacheOfflineFrame: (buffer: ArrayBuffer) => ipcRenderer.send('cache-offline-frame', buffer),
  onConfigUpdated: (callback: (config: any) => void) => {
    ipcRenderer.on('config-updated', (_, config) => callback(config));
  }
});
