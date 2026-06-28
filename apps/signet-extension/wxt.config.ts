import { defineConfig } from 'wxt';

// One config, two build targets (`wxt build` / `wxt build -b firefox`).
// WXT generates the per-browser manifest from this object, so we never
// maintain parallel Chrome/Firefox trees.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Don't auto-launch a browser: on Flatpak/immutable setups there's no Chrome
  // binary on PATH for chrome-launcher to find. Load `.output/chrome-mv3-dev`
  // manually via chrome://extensions — HMR still works over the dev server.
  webExt: { disabled: true },
  dev: {
    server: {
      // Daemon defaults to port 3000; keep the HMR server clear of it.
      port: 3030,
      origin: 'http://localhost:3030',
    },
  },
  // Function form so the CSP can be shaped per manifest version (MV3 wants an
  // object, MV2/Firefox a string). We allow 'wasm-unsafe-eval' on extension pages
  // so the Argon2id WASM (hash-wasm) used by the PIN vault can compile/run.
  manifest: ({ manifestVersion }) => ({
    name: 'Signet',
    description:
      'Approve Signet NIP-46 signing requests and connections from your browser.',
    permissions: ['storage', 'alarms'],
    // The daemon URL is user-supplied, so we don't hard-code a host. We request
    // the specific origin the user types at runtime (browser.permissions.request).
    // MV3 grants extensions CORS-free fetch to granted hosts — that's how we
    // reach the daemon despite it not allowlisting the extension origin.
    optional_host_permissions: ['*://*/*'],
    // Required by Firefox for signing/publishing (ignored by Chrome). The
    // extension collects no user data — it's a local client that talks only to
    // the user's own Signet server — so we declare "none".
    browser_specific_settings: {
      gecko: {
        id: 'signet@signet.app',
        data_collection_permissions: { required: ['none'] },
      },
    },
    ...(manifestVersion === 3
      ? {
          content_security_policy: {
            extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
          },
        }
      : {
          content_security_policy: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
        }),
  }),
});
