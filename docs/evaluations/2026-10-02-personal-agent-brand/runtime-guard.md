# Native runtime package regression evidence

The first new backend image built successfully after pnpm's optional Linux arm64 package download failed (error 23, final 265/266 packages). The actual SDK executable could not be resolved. Deployment failed the synthetic Agent probe before initialization; the previous image was restored and passed API, private Opik write/read/delete, silent-WAV ASR and Agent provider probes. The Infisical recovery pair, current checkout pointer and launchd keeper were restored.

The new build check, mounted read-only into containers with network disabled, passed on the known-working image (Claude Code 2.1.266) and failed with exit 1 / MODULE_NOT_FOUND on the incomplete image. It checks the native package from the SDK's own resolution context and executes only `--version`. No model requests or customer evidence were used in those offline checks.

The installation and native check share a Docker RUN so an incomplete installation cannot become a successful cached build layer. Bookworm requires the Linux glibc package for the container architecture.
