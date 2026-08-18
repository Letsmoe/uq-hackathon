import { networkInterfaces } from "node:os";
import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The native shell loads the Vite dev server over the LAN by default, so a
 * rebuild of the web app reaches the device without reinstalling the APK.
 *
 *   CAP_SERVER_URL=http://192.168.1.20:5173  pin a specific host
 *   CAP_BUNDLE=1                             serve the bundled dist/ instead
 *
 * Release builds must set CAP_BUNDLE=1: a dev-server build depends on a
 * machine that is not on the user's network and enables cleartext HTTP.
 */
const DEV_SERVER_PORT = 5173;

function findLanAddress(): string | null {
  const addresses = Object.values(networkInterfaces()).flat();
  const lan = addresses.find((address) => {
    if (!address) {
      return false;
    }
    return address.family === "IPv4" && !address.internal;
  });
  if (!lan) {
    return null;
  }
  return lan.address;
}

function resolveServerUrl(): string | null {
  if (process.env.CAP_BUNDLE === "1") {
    return null;
  }
  if (process.env.CAP_SERVER_URL) {
    return process.env.CAP_SERVER_URL;
  }
  const lanAddress = findLanAddress();
  if (!lanAddress) {
    return null;
  }
  return `http://${lanAddress}:${DEV_SERVER_PORT}`;
}

const config: CapacitorConfig = {
  appId: "com.letsmoe.synapse",
  appName: "Synapse",
  webDir: "dist",
  backgroundColor: "#04060f",
  android: {
    backgroundColor: "#04060f",
    webContentsDebuggingEnabled: true,
  },
};

const serverUrl = resolveServerUrl();

if (serverUrl) {
  config.server = {
    url: serverUrl,
    cleartext: true,
  };
  console.warn(
    `[capacitor] The app will load ${serverUrl}. Keep \`task dev\` running, or set CAP_BUNDLE=1 for a self-contained build.`,
  );
}

export default config;
