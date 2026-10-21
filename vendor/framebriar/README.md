# Vendored Framebriar SDK

This directory contains the private npm distributable for `@masra91/framebriar@0.4.1` as a temporary CI workaround. It is
the package archive only, not the Framebriar service, admin tooling, infrastructure, credentials, invitations, or backend
configuration.

- Package: `@masra91/framebriar@0.4.1`
- Source repository: `masra91/framebriar` (private)
- Source tag: `v0.4.1`
- Source commit: `4bd23032b840368c77cd50bf96bc484517d81143`
- Archive: `framebriar-0.4.1.tgz`
- Archive size: `60815` bytes
- SHA-256: `5927caede34f717edb6356f1b8c72871f63d9030a336fa21c5e1c85472c06011`
- npm SHA-512 integrity: `sha512-JxyDmwlo1I8IHqCigKH/rKwOXFSI2mimzc36u+n5l5UHkSnN5U/XCwfyy/+jU8oJs/G1DsDbl+Rztm2GZjQ1kg==`
- License declaration: `UNLICENSED` (preserved in the package manifest; this copy is not open-source)
- Runtime dependencies: none

The archive is the exact artifact previously downloaded from GitHub Packages. Its 32 files match a fresh
`scripts/build-sdk.mjs` build from the source tag byte-for-byte after extraction. `package.json` and `package-lock.json`
install this relative archive, so clean installs require no package-registry credentials.

To update it, obtain the new published artifact through an authorized source route, verify its extracted files against the
matching private source tag, replace the archive, and update every version, commit, size, SHA-256 and npm integrity value in
this file together with both package manifests. Keep the package license `UNLICENSED`; do not copy the private repository or
any service, admin, infrastructure, credential, invitation, or backend configuration files.
