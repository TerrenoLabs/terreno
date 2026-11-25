// Installs the devtools hook before any React renderer loads. Pass this file as the first
// `--preload` to `bun test`; without it React never reports commits to the audit.
import "bippy";
