import {describe, expect, it} from "bun:test";
import {strToU8, zipSync} from "fflate";

import {parseSkillPackage} from "./skillPackage";

const SKILL_MD = "---\nname: poster-style\ndescription: Poster look\n---\n# Steps";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const zipOf = (entries: Record<string, Uint8Array | string>): Buffer =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(entries).map(([path, data]) => [
          path,
          typeof data === "string" ? strToU8(data) : data,
        ])
      )
    )
  );

const parseError = async (params: {
  buffer: Buffer;
  filename: string;
}): Promise<{status?: number; title?: string}> => {
  try {
    await parseSkillPackage(params);
  } catch (error) {
    return error as {status?: number; title?: string};
  }
  return expect.unreachable("parseSkillPackage did not throw");
};

describe("parseSkillPackage", () => {
  it("parses a SKILL.md with frontmatter", async () => {
    const result = await parseSkillPackage({buffer: Buffer.from(SKILL_MD), filename: "SKILL.md"});
    expect(result.name).toBe("poster-style");
    expect(result.description).toBe("Poster look");
    expect(result.instructions).toBe("# Steps");
    expect(result.files).toEqual([]);
  });

  it("parses a zip with SKILL.md and a png inside a folder", async () => {
    const buffer = zipOf({"poster-style/ref.png": PNG, "poster-style/SKILL.md": SKILL_MD});
    const result = await parseSkillPackage({buffer, filename: "poster-style.zip"});
    expect(result.name).toBe("poster-style");
    expect(result.instructions).toBe("# Steps");
    expect(result.files).toHaveLength(1);
    expect(result.files[0].filename).toBe("ref.png");
    expect(result.files[0].mimeType).toBe("image/png");
    expect(Array.from(result.files[0].data)).toEqual(Array.from(PNG));
  });

  it("parses a zip with SKILL.md at the root the same way", async () => {
    const buffer = zipOf({"ref.png": PNG, "SKILL.md": SKILL_MD});
    const result = await parseSkillPackage({buffer, filename: "poster-style.zip"});
    expect(result.name).toBe("poster-style");
    expect(result.files).toHaveLength(1);
    expect(result.files[0].filename).toBe("ref.png");
    expect(result.files[0].mimeType).toBe("image/png");
  });

  it("rejects frontmatter without a name", async () => {
    const error = await parseError({
      buffer: Buffer.from("---\ndescription: only a description\n---\nbody"),
      filename: "SKILL.md",
    });
    expect(error.status).toBe(400);
    expect(error.title).toBe("SKILL.md frontmatter needs name and description");
  });

  it("rejects frontmatter without a description", async () => {
    const error = await parseError({
      buffer: Buffer.from("---\nname: poster-style\n---\nbody"),
      filename: "SKILL.md",
    });
    expect(error.status).toBe(400);
    expect(error.title).toBe("SKILL.md frontmatter needs name and description");
  });

  it("rejects a markdown file with no frontmatter", async () => {
    const error = await parseError({buffer: Buffer.from("# Just a doc"), filename: "SKILL.md"});
    expect(error.status).toBe(400);
    expect(error.title).toBe("SKILL.md frontmatter needs name and description");
  });

  it("rejects a zip without SKILL.md", async () => {
    const error = await parseError({
      buffer: zipOf({"ref.png": PNG}),
      filename: "poster-style.zip",
    });
    expect(error.status).toBe(400);
    expect(error.title).toBe("No SKILL.md found in the package");
  });

  it("accepts 20 files and rejects 21", async () => {
    const files = (count: number): Record<string, string> => {
      const entries: Record<string, string> = {"SKILL.md": SKILL_MD};
      for (let i = 0; i < count; i++) {
        entries[`f${i}.txt`] = "x";
      }
      return entries;
    };
    const ok = await parseSkillPackage({buffer: zipOf(files(20)), filename: "s.zip"});
    expect(ok.files).toHaveLength(20);
    const error = await parseError({buffer: zipOf(files(21)), filename: "s.zip"});
    expect(error.status).toBe(400);
    expect(error.title).toBe("A skill can hold at most 20 files");
  });

  it("rejects files totaling more than 10 MB", async () => {
    const buffer = zipOf({
      "big.txt": new Uint8Array(10 * 1024 * 1024 + 1).fill(97),
      "SKILL.md": SKILL_MD,
    });
    const error = await parseError({buffer, filename: "s.zip"});
    expect(error.status).toBe(400);
    expect(error.title).toBe("A skill's files may total at most 10 MB");
  });

  it("rejects a file entry whose header claims more than the limit before inflating it", async () => {
    const bytes = zipOf({"ref.png": PNG, "SKILL.md": SKILL_MD});
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pngName = new TextEncoder().encode("ref.png");
    const isPngEntry = (nameOffset: number): boolean =>
      pngName.every((byte, index) => bytes[nameOffset + index] === byte);
    // Rewrite only ref.png's uncompressed size, in the local header and central directory.
    for (let i = 0; i + 46 <= bytes.length; i++) {
      const signature = view.getUint32(i, true);
      if (signature === 0x04034b50 && isPngEntry(i + 30)) {
        view.setUint32(i + 22, 0x7ffffff0, true);
      }
      if (signature === 0x02014b50 && isPngEntry(i + 46)) {
        view.setUint32(i + 24, 0x7ffffff0, true);
      }
    }
    const error = await parseError({buffer: bytes, filename: "s.zip"});
    expect(error.status).toBe(400);
    expect(error.title).toBe("A skill's files may total at most 10 MB");
  });

  it("rejects an unsupported file type", async () => {
    const error = await parseError({
      buffer: zipOf({"SKILL.md": SKILL_MD, "x.exe": new Uint8Array([1, 2, 3])}),
      filename: "s.zip",
    });
    expect(error.status).toBe(400);
    expect(error.title).toBe("Unsupported file type: x.exe");
  });

  it("rejects a path-traversal entry", async () => {
    const error = await parseError({
      buffer: zipOf({"../evil.png": PNG, "SKILL.md": SKILL_MD}),
      filename: "s.zip",
    });
    expect(error.status).toBe(400);
    expect(error.title).toBe("Invalid file path: ../evil.png");
  });

  it("rejects a SKILL.md entry whose header claims a huge size before inflating it", async () => {
    const bytes = zipOf({"a/SKILL.md": SKILL_MD});
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Rewrite the uncompressed size in the local header (offset 22) and central directory (24).
    for (let i = 0; i + 4 <= bytes.length; i++) {
      const signature = view.getUint32(i, true);
      if (signature === 0x04034b50) {
        view.setUint32(i + 22, 0x7ffffff0, true);
      }
      if (signature === 0x02014b50) {
        view.setUint32(i + 24, 0x7ffffff0, true);
      }
    }
    const error = await parseError({buffer: bytes, filename: "s.zip"});
    expect(error.status).toBe(400);
    expect(error.title).toBe("SKILL.md may be at most 1 MB");
  });

  it("rejects a file outside the SKILL.md folder", async () => {
    const error = await parseError({
      buffer: zipOf({"poster-style/SKILL.md": SKILL_MD, "README.txt": "x"}),
      filename: "s.zip",
    });
    expect(error.status).toBe(400);
    expect(error.title).toBe("Files must sit in the SKILL.md folder: README.txt");
  });

  it("rejects bytes that are not a zip with 400", async () => {
    const error = await parseError({buffer: Buffer.from("not a zip"), filename: "s.zip"});
    expect(error.status).toBe(400);
  });
});
