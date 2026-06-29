# Signet Android App

Native Android app for managing Signet on mobile. Communicates with the daemon over your local network (Tailscale, Wireguard, LAN).

## Requirements

- Android Studio Hedgehog (2023.1.1) or later
- Android SDK 34+
- JDK 17+ (JDK 21+ preferred)
- Kotlin 2.0+

## Building

1. Open `apps/signet-android` in Android Studio
2. Sync Gradle files
3. Build and run on device/emulator

```bash
# Or build from command line
cd apps/signet-android
./gradlew assembleDebug
```

The APK will be at `app/build/outputs/apk/debug/signet-<version>-debug.apk`.

### Release Build

For a signed release build:

1. Generate a keystore:
   ```bash
   keytool -genkey -v -keystore signet-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias signet
   ```

2. Create `keystore.properties` in `apps/signet-android/`:
   ```properties
   storeFile=signet-release.jks
   storePassword=your-password
   keyAlias=signet
   keyPassword=your-password
   ```

3. Build:
   ```bash
   ./gradlew assembleRelease
   ```

The signed APK will be at `app/build/outputs/apk/release/signet-<version>-release.apk`.

## Setup

1. Ensure your Signet daemon is running and accessible from your device
2. Launch the app - on first launch you'll see the Setup screen
3. Enter your daemon URL (for example, `http://100.x.x.x:3000` for Tailscale) or tap **Scan QR** to use the camera
4. The app will test the connection and then display your keys and pending requests

**Tip:** The daemon displays its local network IP and a QR code on startup. Point your phone's camera at the QR code for instant setup.

## Features

- **QR code scanner**: Scan the QR code from daemon startup to quickly configure the server URL
- **Bunker URI QR codes**: Generate one-time connection tokens and display as scannable QR codes with countdown timer
- **Deep link support**: Tap `nostrconnect://` links to open directly in Signet
- **Share target**: Share text containing `nostrconnect://` URIs from other apps to Signet
- **Real-time notifications**: Get notified immediately when apps request approval
- **Background service**: Maintains connection to daemon even when app is closed
- **Auto-start on boot**: Service starts automatically when your device boots
- **Encrypted key support**: Enter passphrases to approve requests for encrypted keys
- **Password manager autofill**: All passphrase fields support Android Autofill for password managers (Proton Pass, 1Password, etc.)
- **App lock**: Require fingerprint, face, or device PIN to open the app
- **Timed app suspension**: Suspend apps until a specific date/time with auto-resume
- **Full request management**: Approve, deny, and review request history
- **Connection insight on approval**: shows the connecting app's URL and the permissions it requests, plus a warning when an app asks to sign a sensitive event (profile, contacts, DMs, deletion, relay list, auth, wallet)
- **App avatars**: a deterministic pubkey identicon (anti-impersonation), upgraded to the app's image when available — served via the daemon's SSRF-guarded proxy, framed by a status ring
- **Relay reputation badges**: relay trust scores from [trustedrelays.xyz](https://trustedrelays.xyz) shown in the system-status and connect screens

## Architecture

```
┌─────────────────────────────────────────┐
│  Signet Android                         │
├─────────────────────────────────────────┤
│  UI: Jetpack Compose + Material 3       │
│    └─ Home (stats, pending requests)    │
│    └─ Activity (request history)        │
│    └─ Apps (connected apps)             │
│    └─ Keys (view keys, bunker URIs)     │
│    └─ Settings (daemon URL)             │
├─────────────────────────────────────────┤
│  Network: Ktor Client                   │
│    └─ REST API calls                    │
│    └─ SSE streaming for real-time       │
├─────────────────────────────────────────┤
│  Storage: DataStore                     │
│    └─ Daemon URL persistence            │
│    └─ User preferences                  │
└─────────────────────────────────────────┘
                    │
                    │ Tailscale / LAN
                    ▼
          ┌───────────────┐
          │ Signet Daemon │
          └───────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| UI | Jetpack Compose |
| Navigation | Bottom navigation bar |
| HTTP Client | Ktor |
| JSON | kotlinx.serialization |
| State | ViewModel + StateFlow |
| Storage | DataStore |
| QR Codes | qrose (display), CameraX + ML Kit (scanning) |
| Theme | Material 3 (purple accent) |
| Min SDK | API 26 (Android 8.0) |

## Network Requirements

The app requires network access to your Signet daemon. Recommended setups:

- **Tailscale**: Install Tailscale on both your server and phone. Use the Tailscale IP (e.g., `http://100.x.x.x:3000`)
- **Wireguard**: Similar to Tailscale, use the VPN IP
- **Local LAN**: Use your server's local IP if on the same network

No authentication is required - network-level security (Tailscale/Wireguard) handles access control. The daemon speaks **HTTP** (it has no TLS of its own); cleartext to a private IP / Tailnet is permitted by the app.

### HTTPS via a self-hosted server (StartOS/Start9, Umbrel, reverse proxy)

If you run Signet behind something that terminates TLS with its **own** Certificate Authority — e.g. StartOS exposes each service at `https://<name>.local:<port>` (or a LAN IP) signed by the server's root CA — the app supports it, but you must trust that CA on the device:

1. **Download the server's root CA** (StartOS: dashboard → System → "Download Root CA"; Umbrel/reverse proxies have an equivalent).
2. **Install it on the phone:** Android Settings → Security → Encryption & credentials → Install a certificate → **CA certificate** → select the file. (Android warns that a third party can monitor traffic — expected for installing your own server's CA.)
3. Enter the **full HTTPS URL with the correct port** in the app (e.g. `https://10.0.0.118:59336`). Use the exact address the server lists for the service — the cert is issued for that hostname/IP.

The app trusts user-installed CAs (its network-security config opts in), so once the CA is installed the HTTPS endpoint validates. Without this opt-in Android ignores user CAs entirely, so the connection would fail at the TLS handshake even with the CA installed.

## Troubleshooting

### "Connection Error" / "won't connect"

1. Verify the daemon is running (`pnpm run signet start`)
2. **Check the URL — scheme and port.** Use `http://` for a plain daemon (default port `3000`); use `https://` only behind a TLS terminator, with that service's exact port. A wrong port fails as "connection refused" / nothing happens.
3. **Open the exact URL in the phone's browser.** If the browser loads it but the app doesn't, it's almost always TLS trust — see "HTTPS via a self-hosted server" above and install the server's root CA. (The browser may let you click through a cert warning; the app cannot.)
4. If using Tailscale, ensure both devices are connected.

### App shows stale data

Pull down on any screen to refresh. The app uses SSE for real-time updates, but if the connection drops, a manual refresh may be needed.

### Keys not showing

Keys are managed by the daemon. Use the web UI or CLI to add keys, then they'll appear in the Android app.

### Not receiving notifications

1. **Battery optimization**: The app will prompt you to disable battery optimization on first launch. If you skipped this, go to Android Settings → Apps → Signet → Battery → Unrestricted
2. **Notification permission**: On Android 13+, ensure notification permission is granted
3. **Check connection**: Open the app and verify it shows "Connected" status

### Encrypted key approvals fail

If you have encrypted keys and approval fails, ensure you're entering the correct passphrase. The passphrase field appears automatically when approving requests for encrypted keys.
