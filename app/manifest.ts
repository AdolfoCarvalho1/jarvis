import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "J.A.R.V.I.S.",
    short_name: "JARVIS",
    description: "Just A Rather Very Intelligent System — assistente pessoal.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#03060a",
    theme_color: "#03060a",
    lang: "pt-BR",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
