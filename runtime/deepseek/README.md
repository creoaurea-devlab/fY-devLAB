# DeepSeek Harness adapter

This host uses upstream packages at revision
`39163dd30f703a79079e2d2446545cff3c453738` (CLI 0.2.2-rc.3), isolated from the
installed DevLab kernel. `catalogue.ts` accounts for 403 workspace packages:
397 public and six private. Four public packages require another platform. The
393 host-compatible public packages include 384 registry installations and nine
builds from unchanged upstream source. A workspace package is not necessarily a
mountable runtime plugin.

Use the parent runtime launcher for integrated operation. To install explicitly
in a candidate (network access and disk use required):

```sh
node runtime/deepseek/host.ts --root /absolute/devlab --install
node runtime/deepseek/host.ts --root /absolute/devlab --port 4340
```

`--source`, `--release` and `--directory` override the reference clone, dependency
prefix and private instance state. Install uses exact upstream versions, omits
optional packages and install scripts, and builds unpublished source into the
release prefix. `_LAB` remains unchanged. Dependencies/state live under `.data`,
not in application source. Never run the upstream CLI against a default personal
DSH_HOME just to inspect help; its preparation can write profile files.

The host starts eight native core services. It forwards no provider keys into
worker environments and makes no model request merely by starting. Configure
actual required providers/fixtures before claiming end-to-end feature support.

- `/api/inventory`: package metadata, actual native state and probe outcomes.
- `/api/registry`: namespaced public registry snapshot.
- `/api/selection`: revision, package ID, enabled flag and JSON config.
- `/api/rewind`: revision-guarded previous native selection.
- `/api/probe`: one isolated package lifecycle probe.
- `/api/test-all`: bounded concurrent audit, progress in inventory.

The control panel provides these actions. Requests require the host's own loopback
origin; settings are serialized, probes are bounded and children are disposed.
Executable JSON expressions and unknown modules are refused. Native bundles use
upstream shipped patches. Native package dependencies and Cordis service injection
remain upstream responsibilities, so pending/configuration errors are visible.

## Verification limits

Probes test mounting/disposal with core dependencies and default configuration.
They do not prove every tool, model/provider, browser component or platform
integration works. The current recorded matrix contains unresolved failures and
pending fixtures/services. Read the plan evidence for the exact tested edition.
The source build of `@deepseek-ai/dsh-client-ui-session-status` omits its generated
`typert.host` and `typert.remote-client` exports; that package's complete API is
not delivered yet. Optional platform binaries are not all installed.

An owned Node process and allowlisted environment are not OS confinement. Native
plugins can access the user's OS as ordinary local code. DevLab terminal Strict
policy does not automatically govern this process; use and verify the upstream
sandbox policy before configuring action tools for untrusted projects.

The upstream MIT notice and third-party/brand notices are retained in the release
licenses directory. Individual dependencies retain their terms, including MPL
and separately licensed SDKs. The dependency inventory is not legal clearance
for redistribution of the complete bundle. Keep DevLab branding and describe
its relationship to DeepSeek Harness accurately.
