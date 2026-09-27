import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import type {ChoiceAskInput} from "../asks/schema";
import type {SimpleCard} from "../asks/simpleCard";

const FIXTURES_DIR = join(import.meta.dir, "..", "asks", "fixtures");

export interface ValidAskFixture {
  input: ChoiceAskInput;
  kind: "choice";
  name: string;
  simple: SimpleCard;
}

export interface InvalidAskFixture {
  errors: {code: string; path: string}[];
  input: unknown;
  kind: "choice";
  name: string;
}

const readFixtures = <T>(folder: "invalid" | "valid"): T[] =>
  readdirSync(join(FIXTURES_DIR, folder))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({
      ...JSON.parse(readFileSync(join(FIXTURES_DIR, folder, file), "utf8")),
      name: file.replace(/\.json$/, ""),
    }));

export const validAskFixtures = (): ValidAskFixture[] => readFixtures<ValidAskFixture>("valid");

export const invalidAskFixtures = (): InvalidAskFixture[] =>
  readFixtures<InvalidAskFixture>("invalid");
