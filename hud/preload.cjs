const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, handler) {
  const listener = () => handler();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("jarvisHud", {
  setOpen: (open) => ipcRenderer.send("hud:open", Boolean(open)),
  setMode: (mode) => ipcRenderer.send("hud:mode", String(mode)),
  recenter: () => ipcRenderer.send("hud:recenter"),
  hide: () => ipcRenderer.send("hud:hide"),
  onTalk: (handler) => subscribe("hud:talk", handler),
  onHidden: (handler) => subscribe("hud:hidden", handler),
});

