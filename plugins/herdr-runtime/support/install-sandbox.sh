#!/usr/bin/env bash
# Explicit administrator setup only; never invoked by DevLab or its build.
set -euo pipefail
if [[ ${1:-} != --install || $EUID != 0 ]]; then
  echo 'Usage: sudo bash plugins/herdr-runtime/support/install-sandbox.sh --install' >&2
  exit 2
fi
support_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
launcher=/usr/local/libexec/devlab-herdr-bwrap
profile=/etc/apparmor.d/devlab-herdr-bwrap
source_profile="$support_dir/devlab-herdr-bwrap.apparmor"
test -f /usr/bin/bwrap
test "$(stat -c %u /usr/bin/bwrap)" = 0
/usr/sbin/apparmor_parser -Q -K "$source_profile"
for target in "$launcher" "$profile"; do
  if [[ -L $target ]]; then echo "Refusing symlink: $target" >&2; exit 1; fi
done
if [[ -e $launcher ]] && ! cmp -s /usr/bin/bwrap "$launcher"; then
  echo "Existing dedicated launcher differs; review it before replacing: $launcher" >&2; exit 1
fi
if [[ -e $profile ]] && ! cmp -s "$source_profile" "$profile"; then
  echo "Existing dedicated policy differs; review it before replacing: $profile" >&2; exit 1
fi
install -d -m 0755 /usr/local/libexec
install -o root -g root -m 0755 /usr/bin/bwrap "$launcher"
install -o root -g root -m 0644 "$source_profile" "$profile"
/usr/sbin/apparmor_parser -r "$profile"
echo 'Dedicated Herdr sandbox launcher installed. Run the unprivileged Herdr tests next.'
