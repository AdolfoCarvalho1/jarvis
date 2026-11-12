"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    // O HUD é uma janela Electron de 340px: service worker ali só serve o shell
    // errado (já abriu o app inteiro no lugar da esfera).
    if (window.location.pathname === "/hud") return;
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* sem PWA: o app continua funcionando no navegador */
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
