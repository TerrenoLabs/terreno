import {describe, expect, it} from "bun:test";
import type {FC} from "react";

import {AttachmentPreview, type AttachmentPreviewProps} from "../../src/AttachmentPreview";
import type {SelectedFile} from "../../src/FilePickerButton";
import {auditComponent} from "./auditComponent";
import {componentStat} from "./renderAudit";

const makeAttachments = (count: number): SelectedFile[] =>
  Array.from({length: count}, (_, index) => ({
    mimeType: index % 2 === 0 ? "image/png" : "application/pdf",
    name: `file-${index}.${index % 2 === 0 ? "png" : "pdf"}`,
    uri: `file:///tmp/file-${index}`,
  }));
const attachments = makeAttachments(8);
const handleRemove = (): void => {};
const baseline: AttachmentPreviewProps = {attachments, onRemove: handleRemove};

describe("AttachmentPreview renders", () => {
  it("re-renders no attachment when the list or handler is replaced by an equal one", async () => {
    const report = await auditComponent({
      baseline,
      Component: AttachmentPreview as FC<AttachmentPreviewProps>,
      changes: {
        "new equal attachments": {...baseline, attachments: makeAttachments(8)},
        "new onRemove identity": {...baseline, onRemove: (): void => {}},
        "one attachment added": {...baseline, attachments: [...attachments, makeAttachments(9)[8]]},
        "one attachment removed": {...baseline, attachments: attachments.slice(0, 7)},
      },
      name: "AttachmentPreview",
    });
    expect(componentStat(report, "mount", "AttachmentItem")?.mounts).toBe(8);
    expect(componentStat(report, "same props", "AttachmentItem")).toBeUndefined();
    expect(componentStat(report, "new equal attachments", "AttachmentItem")).toBeUndefined();
    expect(componentStat(report, "new onRemove identity", "AttachmentItem")).toBeUndefined();
    expect(componentStat(report, "one attachment added", "AttachmentItem")?.mounts).toBe(1);
    expect(componentStat(report, "one attachment added", "AttachmentItem")?.updates).toBe(0);
    expect(componentStat(report, "one attachment removed", "AttachmentItem")).toBeUndefined();
  });
});
