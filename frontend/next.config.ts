import type { NextConfig } from "next";
import os from "os";

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (iface) {
      for (const entry of iface) {
        if (entry.family === "IPv4") {
          addresses.push(entry.address);
        }
      }
    }
  }
  return addresses;
}

function resolveAllowedOrigin(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

const frontendHost =
  resolveAllowedOrigin(process.env.NEXT_PUBLIC_FRONTEND_URL) ||
  resolveAllowedOrigin(process.env.NEXT_PUBLIC_FRONTEND_HOST);

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    frontendHost,
    ".ngrok-free.dev",
    "localhost",
    "127.0.0.1",
    ...getLocalIpAddresses(),
  ].filter((value): value is string => Boolean(value)),
};

export default nextConfig;
