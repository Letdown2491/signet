#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${HOME}/.signet-config"
CONFIG_FILE="${CONFIG_DIR}/signet.json"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
ENV_EXAMPLE="$(cd "$(dirname "$0")/.." && pwd)/.env.example"

echo "==> Ensuring config directory exists at ${CONFIG_DIR}"
mkdir -p "${CONFIG_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${ENV_EXAMPLE}" ]]; then
    echo "==> Creating .env from .env.example"
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  else
    echo "!! No .env file found and .env.example is missing. Create ${ENV_FILE} manually."
  fi
fi

cat <<'INFO'

==================== Configuration ====================

Signet provides two ways to manage it:
  1. Web UI (localhost:4174) - View keys, approve requests, manage access
  2. Admin RPC (optional) - Remote management via Nostr DMs

Most users only need the Web UI. Admin RPC is useful if you want to:
  • Manage Signet remotely from another device
  • Automate Signet operations programmatically
  • Control it without server access

INFO

read -rp "Enable remote admin management via Nostr DMs? (y/N): " ENABLE_ADMIN
ADMIN_NPUBS_INPUT=""
ADMIN_RELAYS_INPUT=""

if [[ "${ENABLE_ADMIN}" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Admin RPC allows you to send commands to Signet via encrypted Nostr DMs."
  read -rp "Your admin npub (comma separated if multiple): " ADMIN_NPUBS_INPUT

  DEFAULT_RELAY="wss://relay.nsec.app"
  echo "Admin commands will be sent/received on these relays."
  read -rp "Admin relays (comma separated, default ${DEFAULT_RELAY}): " ADMIN_RELAYS_INPUT
else
  echo "==> Skipping admin RPC setup. You can manage Signet via the web UI."
fi

NOS_RELAYS_DEFAULT="wss://relay.damus.io,wss://relay.primal.net,wss://nos.lol"
echo ""
echo "NIP-46 signing requests from clients will use these relays."
read -rp "NIP-46 relays (comma separated, default ${NOS_RELAYS_DEFAULT}): " NOSTR_RELAYS_INPUT
ADMIN_SECRET_INPUT=""

python3 - "${CONFIG_FILE}" "${ADMIN_NPUBS_INPUT}" "${ADMIN_RELAYS_INPUT}" "${NOSTR_RELAYS_INPUT}" "${ADMIN_SECRET_INPUT}" <<'PY'
import json
import os
import secrets
import sys
import string

config_path = sys.argv[1]
admin_input = sys.argv[2]
admin_relays_input = sys.argv[3]
nostr_relays_input = sys.argv[4]
admin_secret_input = sys.argv[5]

default = {
    "nostr": {"relays": ["wss://relay.damus.io", "wss://relay.primal.net", "wss://nos.lol"]},
    "admin": {
        "npubs": [],
        "adminRelays": ["wss://relay.nsec.app"],
        "key": "",
        "notifyAdminsOnBoot": False
    },
    "authPort": 3000,
    "authHost": "0.0.0.0",
    "baseUrl": "http://localhost:3000",
    "database": "sqlite://signet.db",
    "logs": "./signet.log",
    "keys": {},
    "verbose": False
}

if os.path.exists(config_path):
    with open(config_path, "r", encoding="utf8") as fh:
        data = json.load(fh)
else:
    data = default

# Ensure web server config fields exist
data.setdefault("authPort", 3000)
data.setdefault("authHost", "0.0.0.0")
data.setdefault("baseUrl", "http://localhost:3000")

admin = data.setdefault("admin", {})
admin_rels = admin.setdefault("adminRelays", ["wss://relay.nsec.app"])
# ensure list of relays
if not isinstance(admin_rels, list):
    admin["adminRelays"] = ["wss://relay.nsec.app"]

npubs = [npub.strip() for npub in admin_input.split(',') if npub.strip()]
admin["npubs"] = npubs

if not admin.get("key"):
    admin["key"] = secrets.token_hex(32)

def parse_relays(value, default):
    relays = [item.strip() for item in value.split(',') if item.strip()]
    if not relays:
        relays = default
    for relay in relays:
        if not relay.startswith("wss://"):
            raise SystemExit(f"Relay '{relay}' must start with wss://")
    return relays

admin_relays = parse_relays(admin_relays_input, ["wss://relay.nsec.app"])
nostr_relays = parse_relays(nostr_relays_input, default["nostr"]["relays"])

admin["adminRelays"] = admin_relays
data.setdefault("nostr", {})["relays"] = nostr_relays

alphabet = string.ascii_lowercase + string.digits

secret_value = ''.join(secrets.choice(alphabet) for _ in range(8))

if secret_value:
    admin["secret"] = secret_value
else:
    admin.pop("secret", None)

with open(config_path, "w", encoding="utf8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
PY

echo "==> Config saved to ${CONFIG_FILE}"
echo ""

cat <<'MSG'
Key storage options:
  • Encrypted (recommended): nsec stored encrypted on disk; you supply a passphrase during setup.
  • Plain: nsec stored in clear text (auto-unlocks). Only use this on secure machines.

MSG

while true; do
  read -rp "Add a key now? (y/N): " ADD_KEY
  if [[ ! "${ADD_KEY}" =~ ^[Yy]$ ]]; then
    break
  fi

  read -rp "Key label: " KEY_LABEL
  if [[ -z "${KEY_LABEL}" ]]; then
    echo "!! Key label cannot be empty. Skipping."
    continue
  fi

  read -rp "Store encrypted? (y/N): " ENCRYPT_KEY
  if [[ "${ENCRYPT_KEY}" =~ ^[Yy]$ ]]; then
    if ! command -v docker &> /dev/null; then
      echo "!! docker is required to add encrypted keys via the container. Skipping."
    else
      echo "==> Launching Signet CLI to add encrypted key '${KEY_LABEL}'"
      docker compose run --rm \
        signet \
        add --config /app/config/signet.json --name "${KEY_LABEL}"
    fi
  else
    read -rsp "Paste nsec (will not echo): " NSEC_VALUE
    echo ""
    if [[ -z "${NSEC_VALUE}" ]]; then
      echo "!! nsec cannot be empty. Skipping."
      continue
    fi

    python3 - "${CONFIG_FILE}" "${KEY_LABEL}" "${NSEC_VALUE}" <<'PY'
import json
import sys

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
CHARSET_REV = {c: i for i, c in enumerate(CHARSET)}
GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

def bech32_polymod(values):
    chk = 1
    for v in values:
        b = chk >> 25
        chk = ((chk & 0x1ffffff) << 5) ^ v
        for i in range(5):
            chk ^= GEN[i] if ((b >> i) & 1) else 0
    return chk

def bech32_hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]

def bech32_verify_checksum(hrp, data):
    return bech32_polymod(bech32_hrp_expand(hrp) + data) == 1

def bech32_decode(bech):
    if any(ord(x) < 33 or ord(x) > 126 for x in bech):
        raise ValueError("Invalid characters in bech32 string")
    bech = bech.strip()
    bech_lower = bech.lower()
    pos = bech_lower.rfind('1')
    if pos < 1 or pos + 7 > len(bech_lower) or len(bech_lower) > 90:
        raise ValueError("Invalid bech32 length")
    hrp = bech_lower[:pos]
    data = []
    for char in bech_lower[pos + 1:]:
        if char not in CHARSET_REV:
            raise ValueError("Invalid character in data part")
        data.append(CHARSET_REV[char])
    if not bech32_verify_checksum(hrp, data):
        raise ValueError("Checksum failed")
    return hrp, data[:-6]

def convertbits(data, frombits, tobits, pad=True):
    acc = 0
    bits = 0
    ret = []
    maxv = (1 << tobits) - 1
    for value in data:
        if value < 0 or (value >> frombits):
            raise ValueError("Invalid value while converting bits")
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    elif bits >= frombits or ((acc << (tobits - bits)) & maxv):
        raise ValueError("Invalid padding while converting bits")
    return ret

config_path = sys.argv[1]
label = sys.argv[2]
user_input = sys.argv[3].strip()

if not user_input:
    raise SystemExit("Plain key input cannot be empty.")

secret = user_input

if user_input.startswith("nsec1"):
    hrp, data = bech32_decode(user_input)
    if hrp != "nsec":
        raise SystemExit("Provided bech32 string is not an nsec.")
    bytes_data = convertbits(data, 5, 8, False)
    secret = ''.join(f"{b:02x}" for b in bytes_data)

with open(config_path, "r", encoding="utf8") as fh:
    data = json.load(fh)

data.setdefault("keys", {})[label] = {"key": secret}

with open(config_path, "w", encoding="utf8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
PY
    echo "==> Stored plain key '${KEY_LABEL}'"
  fi
done

START_CMD=""
if command -v docker &> /dev/null; then
  read -rp "Start Docker Compose now? (y/N): " START_STACK
  if [[ "${START_STACK}" =~ ^[Yy]$ ]]; then
    read -rp "Run in background (detached)? (y/N): " DETACH
    if [[ "${DETACH}" =~ ^[Yy]$ ]]; then
      START_CMD="docker compose up --build -d"
    else
      START_CMD="docker compose up --build"
    fi
    echo "==> ${START_CMD}"
    ${START_CMD}
  fi
else
  echo "!! docker command not found; skipping compose start."
fi

echo ""
echo "=========================================="
echo "Setup complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Start Signet: docker compose up -d"
echo "  2. Visit the web UI: http://localhost:4174"
echo "  3. Click the 'Keys' tab to view your signing keys and bunker URIs"
echo "  4. Copy the bunker URI and paste it into your Nostr client (Coracle, Damus, etc.)"
echo ""
if [[ "${ENABLE_ADMIN}" =~ ^[Yy]$ ]]; then
  echo "Admin RPC is enabled. You can send commands via Nostr DMs to Signet."
else
  echo "Use the web UI to approve requests and manage Signet."
fi
echo "" 
