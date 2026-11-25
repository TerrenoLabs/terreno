/**
 * Browser entry for `pageAudit.ts`. Bundled into one script and injected before the page's
 * own code, so the devtools hook exists when React starts.
 */
import {createRenderAudit, type RenderAudit} from "./renderAudit";

interface PageAuditOptions {
  ignore?: string;
  loadLabel?: string;
  only?: string;
}

interface AuditWindow {
  __RENDER_AUDIT__?: RenderAudit;
  __RENDER_AUDIT_OPTIONS__?: PageAuditOptions;
}

const auditWindow = globalThis as unknown as AuditWindow;
const options = auditWindow.__RENDER_AUDIT_OPTIONS__ ?? {};
const audit = createRenderAudit({
  ignore: options.ignore ? new RegExp(options.ignore) : undefined,
  only: options.only ? new RegExp(options.only) : undefined,
});
if (options.loadLabel) {
  audit.begin(options.loadLabel);
}
auditWindow.__RENDER_AUDIT__ = audit;
