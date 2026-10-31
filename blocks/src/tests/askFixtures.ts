import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import type {AskErrorCode} from "../asks/errors";
import type {Ask, AskKind} from "../asks/schema";
import type {SimpleCard} from "../asks/simpleCard";

const FIXTURES_DIR = join(__dirname, "..", "asks", "fixtures");

export type ValidAskFixture = Ask & {
  name: string;
  simple: SimpleCard;
};

export interface InvalidAskFixture {
  errors: {code: AskErrorCode; path: string}[];
  input: unknown;
  kind: AskKind;
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

/** The valid fixtures of one kind, typed as that kind. */
export const validAskFixturesOf = <Kind extends AskKind>(
  kind: Kind
): Extract<ValidAskFixture, {kind: Kind}>[] =>
  validAskFixtures().filter(
    (fixture): fixture is Extract<ValidAskFixture, {kind: Kind}> => fixture.kind === kind
  );

export const invalidAskFixtures = (): InvalidAskFixture[] =>
  readFixtures<InvalidAskFixture>("invalid");

/**
 * The ask a fixture describes. The fixture spreads `Ask`, but TypeScript cannot keep `input` and
 * `kind` correlated once they are read separately, so this restates the pairing.
 */
export const fixtureAsk = (fixture: ValidAskFixture): Ask =>
  ({input: fixture.input, kind: fixture.kind}) as Ask;
