#!/bin/sh
# Create (or show what would create) float-2, the CPU box beside float-box.
#
#   sh infra/float-2.sh            dry run: prints the plan and the exact commands, changes nothing
#   sh infra/float-2.sh --create   uploads your SSH key if missing and creates the server (costs money)
#
# The Hetzner token is read from the macOS keychain (service "hcloud-token") at exec time.
set -eu

NAME="${NAME:-float-2}"
TYPE="${TYPE:-cax21}"          # 4 ARM cores, 8 GB, 80 GB · cax31 doubles it
LOCATION="${LOCATION:-fsn1}"   # Falkenstein, same park as float-box
IMAGE="${IMAGE:-ubuntu-24.04}"
KEY_FILE="${KEY_FILE:-$HOME/.ssh/id_ed25519.pub}"
KEY_NAME="${KEY_NAME:-evan-laptop-ed25519}"
HERE="$(cd "$(dirname "$0")" && pwd)"

hc() { HCLOUD_TOKEN="$(security find-generic-password -s hcloud-token -w)" hcloud "$@"; }

[ -f "$KEY_FILE" ] || { echo "no public key at $KEY_FILE" >&2; exit 1; }
USERDATA="$(mktemp)"
trap 'rm -f "$USERDATA"' EXIT
sed "s|__SSH_PUBLIC_KEY__|$(cat "$KEY_FILE")|" "$HERE/cloud-init.yaml" > "$USERDATA"

echo "plan: $NAME · $TYPE · $LOCATION · $IMAGE · key $KEY_NAME ($KEY_FILE)"
hc server-type describe "$TYPE" -o json | jq -r --arg l "$LOCATION" '.prices[] | select(.location==$l) | "price: €\(.price_monthly.gross | .[0:5]) / month gross"'
if hc server describe "$NAME" >/dev/null 2>&1; then echo "$NAME already exists:"; hc server describe "$NAME" -o format='{{.PublicNet.IPv4.IP}} {{.Status}}'; exit 0; fi

if [ "${1:-}" != "--create" ]; then
  echo
  echo "dry run. would run:"
  echo "  hcloud ssh-key create --name $KEY_NAME --public-key-from-file $KEY_FILE   (if missing)"
  echo "  hcloud server create --name $NAME --type $TYPE --location $LOCATION --image $IMAGE --ssh-key $KEY_NAME --user-data-from-file <cloud-init with your key>"
  echo "re-run with --create to do it."
  exit 0
fi

hc ssh-key describe "$KEY_NAME" >/dev/null 2>&1 || hc ssh-key create --name "$KEY_NAME" --public-key-from-file "$KEY_FILE"
hc server create --name "$NAME" --type "$TYPE" --location "$LOCATION" --image "$IMAGE" \
  --ssh-key "$KEY_NAME" --user-data-from-file "$USERDATA" --label role=cpu --label owner=evan
IP="$(hc server describe "$NAME" -o format='{{.PublicNet.IPv4.IP}}')"
echo
echo "created $NAME at $IP. cloud-init takes a few minutes; then:"
echo "  ssh evan@$IP 'test -f /var/lib/cloud/float-2-ready && echo ready'"
echo "  ssh evan@$IP 'sudo tailscale up'      # joins your tailnet (prints a login URL)"
