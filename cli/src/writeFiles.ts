import {mkdir, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

export interface FileToWrite {
  content: string;
  path: string;
}

export const writeFiles = async (rootDir: string, files: FileToWrite[]): Promise<string[]> => {
  const written: string[] = [];
  for (const file of files) {
    const absolute = join(rootDir, file.path);
    await mkdir(dirname(absolute), {recursive: true});
    await writeFile(absolute, file.content, "utf8");
    written.push(absolute);
  }
  return written;
};
