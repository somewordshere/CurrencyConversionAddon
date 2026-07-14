import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supportedBrowsers = new Set(["chrome", "firefox"]);
const requestedBrowser = process.argv[2] ?? "all";
const prepareOnly = process.argv.includes("--prepare-only");
const browsers = requestedBrowser === "all" ? [...supportedBrowsers] : [requestedBrowser];

if (browsers.some((browser) => !supportedBrowsers.has(browser))) {
  throw new Error(`Unknown browser target: ${requestedBrowser}`);
}

const packageJson = readJson(join(root, "package.json"));
const baseManifest = readJson(join(root, "manifests", "base.json"));

if (baseManifest.version !== packageJson.version) {
  throw new Error("The package and base manifest versions must match.");
}

for (const browser of browsers) {
  const destination = join(root, "dist", browser);
  assertInsideRoot(destination);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  for (const directory of ["background", "content", "icons", "popup", "shared"]) {
    cpSync(join(root, "src", directory), join(destination, directory), { recursive: true });
  }
  if (browser === "firefox") {
    rmSync(join(destination, "background", "chrome-worker.js"));
  }

  const override = readJson(join(root, "manifests", `${browser}.json`));
  const manifest = { ...baseManifest, ...override };
  writeFileSync(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Prepared ${browser}: ${destination}`);

  if (!prepareOnly) buildArchive(browser, destination, packageJson.version);
}

function buildArchive(browser, sourceDirectory, version) {
  const webExtCli = join(root, "node_modules", "web-ext", "bin", "web-ext.js");
  if (!existsSync(webExtCli)) {
    throw new Error("web-ext is not installed. Run npm install first.");
  }

  const artifactsDirectory = join(root, "release", version);
  mkdirSync(artifactsDirectory, { recursive: true });
  const filename = `currency-converter-pro-${version}-${browser}.zip`;
  const result = spawnSync(process.execPath, [
    webExtCli,
    "build",
    "--source-dir", sourceDirectory,
    "--artifacts-dir", artifactsDirectory,
    "--filename", filename,
    "--overwrite-dest"
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_UPDATE_NOTIFIER: "1" }
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`Failed to package ${browser}.`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function assertInsideRoot(target) {
  const normalizedRoot = `${root.toLowerCase()}${root.endsWith(sep) ? "" : sep}`;
  const normalizedTarget = resolve(target).toLowerCase();
  if (!normalizedTarget.startsWith(normalizedRoot)) {
    throw new Error(`Refusing to modify a path outside the project: ${target}`);
  }
}
