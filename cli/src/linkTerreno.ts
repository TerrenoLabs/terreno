import {existsSync, statSync} from "node:fs";
import {mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import {basename, join} from "node:path";

interface PackageManifest {
  dependencies?: Record<string, string>;
  name?: string;
  optionalDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface CheckoutPackage {
  directory: string;
  manifest: PackageManifest;
}

interface PackOptions {
  destination: string;
  packageDir: string;
}

interface ManifestSource {
  content: string;
  path: string;
}

export interface PrepareLinkTerrenoOptions {
  checkout: string;
  files: ManifestSource[];
}

export interface LinkTerrenoPlan {
  manifests: {manifest: PackageManifest; path: string}[];
  packagesToPack: {directory: string; name: string}[];
}

export interface LinkTerrenoOptions {
  appRoot: string;
  pack?: (options: PackOptions) => Promise<string>;
  plan: LinkTerrenoPlan;
}

const dependencyFields = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

const terrenoDependencies = (manifest: PackageManifest): string[] => {
  return dependencyFields.flatMap((field): string[] =>
    Object.keys(manifest[field] ?? {}).filter((name): boolean => name.startsWith("@terreno/"))
  );
};

const readManifest = async (path: string): Promise<PackageManifest> => {
  return JSON.parse(await readFile(path, "utf8")) as PackageManifest;
};

const packTerreno = async ({destination, packageDir}: PackOptions): Promise<string> => {
  const process = Bun.spawn(["bun", "pm", "pack", "--destination", destination, "--quiet"], {
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0 || !stdout.trim()) {
    throw new Error(`Failed to pack ${packageDir}: ${stderr.trim() || "No tarball produced"}`);
  }
  return basename(stdout.trim());
};

export const prepareLinkTerreno = async ({
  checkout,
  files,
}: PrepareLinkTerrenoOptions): Promise<LinkTerrenoPlan> => {
  if (!existsSync(checkout)) {
    throw new Error(`Terreno checkout path does not exist: ${checkout}`);
  }
  if (!statSync(checkout).isDirectory()) {
    throw new Error(`Terreno checkout path is not a directory: ${checkout}`);
  }
  const packages = new Map<string, CheckoutPackage>();
  for (const entry of await readdir(checkout, {withFileTypes: true})) {
    const directory = join(checkout, entry.name);
    const manifestPath = join(directory, "package.json");
    if (!entry.isDirectory() || !existsSync(manifestPath)) {
      continue;
    }
    const manifest = await readManifest(manifestPath);
    if (manifest.name?.startsWith("@terreno/")) {
      packages.set(manifest.name, {directory, manifest});
    }
  }
  if (packages.size === 0) {
    throw new Error("The Terreno checkout contains no top-level @terreno/* packages.");
  }

  const manifests: {manifest: PackageManifest; path: string}[] = [];
  for (const directory of ["backend", "frontend"]) {
    const path = `${directory}/package.json`;
    const file = files.find((candidate): boolean => candidate.path === path);
    if (!file) {
      throw new Error(`Generated app is missing ${path}.`);
    }
    manifests.push({manifest: JSON.parse(file.content) as PackageManifest, path});
  }
  const closure = new Set(
    manifests.flatMap(({manifest}): string[] => terrenoDependencies(manifest))
  );
  const packagesToPack: {directory: string; name: string}[] = [];
  for (const name of closure) {
    const pkg = packages.get(name);
    if (!pkg) {
      throw new Error(`The Terreno checkout is missing package ${name}.`);
    }
    for (const dependency of terrenoDependencies(pkg.manifest)) {
      closure.add(dependency);
    }
    const dist = join(pkg.directory, "dist");
    if (!existsSync(dist) || !statSync(dist).isDirectory()) {
      throw new Error(
        `${name} has no dist directory. Run bun run compile in the Terreno checkout.`
      );
    }
    packagesToPack.push({directory: pkg.directory, name});
  }

  packagesToPack.sort((left, right): number => left.name.localeCompare(right.name));
  return {manifests, packagesToPack};
};

export const linkTerreno = async ({
  appRoot,
  pack = packTerreno,
  plan,
}: LinkTerrenoOptions): Promise<string[]> => {
  const destination = join(appRoot, "vendor", "terreno");
  await mkdir(destination, {recursive: true});
  const linkedPackages = plan.packagesToPack.map(({name}): string => name);
  const overrides: Record<string, string> = {};
  for (const {directory, name} of plan.packagesToPack) {
    const tarball = await pack({destination, packageDir: directory});
    overrides[name] = `file:../vendor/terreno/${basename(tarball)}`;
  }
  for (const source of plan.manifests) {
    const path = join(appRoot, source.path);
    const manifest = await readManifest(path);
    for (const field of dependencyFields) {
      const dependencies = manifest[field];
      for (const name of Object.keys(dependencies ?? {})) {
        if (dependencies && overrides[name]) {
          dependencies[name] = overrides[name];
        }
      }
    }
    manifest.overrides = {...manifest.overrides, ...overrides};
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return linkedPackages;
};
