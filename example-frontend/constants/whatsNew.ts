import type {WhatsNewRelease} from "@terreno/ui";

import releases from "./whatsNew.generated.json";

/** Recent Terreno releases, generated from CHANGELOG.md by `bun run whats-new:generate`. */
export const WHATS_NEW_RELEASES: WhatsNewRelease[] = releases;
