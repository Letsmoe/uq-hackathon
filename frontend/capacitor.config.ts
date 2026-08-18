import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Set CAP_SERVER_URL to point the native shell at a running Vite dev server
 * instead of the bundled dist/ build, e.g.
 *
 *   CAP_SERVER_URL=http://192.168.1.20:5173 bunx cap sync android
 *
 * This is a development convenience only: it enables cleartext HTTP and must
 * never be set when producing a release build.
 */
const devServerUrl = process.env.CAP_SERVER_URL;

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

if (devServerUrl) {
  config.server = {
    url: devServerUrl,
    cleartext: true,
  };
}

export default config;
