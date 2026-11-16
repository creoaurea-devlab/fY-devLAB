# DevLab-owned Herdr

The Cordis `herdr-runtime` plugin owns a dedicated server for each admitted project.
The Herdr workspace view uses the existing terminal renderer and transport. A project
selects its server; the Herdr selector chooses a workspace inside that server.
The ordinary terminal dock excludes managed Herdr attachments.

## Boundary and policy

Linux Bubblewrap creates private user, PID, mount, IPC, UTS and network namespaces,
drops capabilities and disables further user namespaces. The runtime receives
read-only system tools, private HOME/configuration/state, private `/proc`, `/dev`,
`/tmp` and `/run`, and the selected project at `/workspace`. When DevLab's private
state sits inside that project, its top-level state directory is hidden in the
project mount. Host credentials, display sockets, environment and general desktop
Herdr sessions are not imported. Network is offline. This is process/filesystem
containment using the host kernel, not a virtual machine.

The fixed `contained-project` policy is host-owned. Commands cannot supply mode,
paths, environment, sockets or executable arguments. Changing this policy requires
a reviewed source change; it is not the existing terminal Off/Guided/Strict selector.
WISDOHM 3 policy editing is still separate unfinished work.

The TUI receives the socket directory read-only so it can connect without replacing
the server endpoint. Its PTY is an attachment, not the owner of inner pane processes.
Hide retains the renderer and releases input/resize ownership; detach closes only
the client. Explicit Stop terminates the verified PID-namespace owner and outer
process group; the kernel then ends every process inside that namespace. Backend
disposal retains the server only for the production data root; disposable hosts stop
their servers. Recovery verifies saved project root, policy revision and PID start
identities for both processes. Runtime restart does not promise process survival. Mutations are never
retried after an uncertain timeout or disconnect. Native event subscriptions trigger
full snapshot refreshes; reconnect never replays controls. A 15-second heartbeat
also refreshes metadata for which the pinned release emits no event. Hidden views
release their subscriptions; the TUI and pane processes remain retained.

Pane controls include split, focus, resize, zoom, rename, close, exact text, Enter
and Interrupt. Text is pasted literally; Enter is a separate deliberate action.
The pinned `herdr` CLI is on the inner PATH. Pane/tab and agent status are read from
the owned server, without launching an agent or importing credentials.

## Pinned distribution

- Installed binary: Herdr `0.9.3`; bundled API protocol `22`.
- SHA-256: `ba0e6d2485b0db8f982ae8aa2ace666c084222f90ee1068af6037e26c17d8992`.
- The adapter verifies the binary and schema and copies the reviewed binary into
  its private runtime directory. No binary is committed, downloaded or upgraded.
- [Versioned upstream source](https://github.com/herdrdev/herdr/tree/v0.9.3)
  and [license](https://github.com/herdrdev/herdr/blob/v0.9.3/LICENSE) are the
  provenance for this local integration. A redistribution-specific dependency and
  asset notice inventory remains required before packaging/distribution.

## Ubuntu sandbox setup

On this host, `kernel.apparmor_restrict_unprivileged_userns=1` and the kernel log
identifies `unprivileged_userns` refusals for Bubblewrap's `setpcap` and `net_admin`.
The ordinary launcher fails this restriction. After explicit user approval on
2026-11-16, the dedicated helper/profile below were installed and the real runtime
and browser checks passed. The global restriction remains 1. Other installations
without working containment report unavailable and refuse Start; there is no host-shell fallback.

An administrator can explicitly install the dedicated helper after reviewing
`support/install-sandbox.sh` and `support/devlab-herdr-bwrap.apparmor`:

```sh
sudo bash plugins/herdr-runtime/support/install-sandbox.sh --install
```

This copies the installed Bubblewrap executable (ordinary mode 0755, not setuid)
to `/usr/local/libexec/devlab-herdr-bwrap`, installs its dedicated AppArmor profile
at `/etc/apparmor.d/devlab-herdr-bwrap`, then loads only that profile. Existing
differing files are refused. The global sysctl and other profiles are unchanged.
The adapter prefers this helper when present and otherwise probes `/usr/bin/bwrap`.
This setup is never run by startup, build or tests. It requires explicit approval
and administrator authentication. See Ubuntu's
[application-specific namespace policy](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/).

## Verification

```sh
node --test scripts/herdr.test.ts
node scripts/herdr-browser.mjs
HERDR_REAL=1 node scripts/herdr-browser.mjs
npm run check
npm run build
```

The real runtime integration test skips with a concrete reason when containment
is unavailable. A skipped test does not establish working Herdr or isolation.
The default browser lane uses a real disposable PTY with simulated Herdr responses.
`HERDR_REAL=1` starts the actual contained server and TUI, with no protocol mocks.
Both lanes verify retention, controls and cleanup at 1440/820/390.
Current execution evidence belongs in the integration plan.
