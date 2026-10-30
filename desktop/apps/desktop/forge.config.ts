import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPackagingEnv } from "./src/load-packaging-env";
import { ignorePackagedAppPath } from "./src/packager-ignore";

const packagingEnv = loadPackagingEnv({ cwd: __dirname });
if (packagingEnv.loaded) {
  const notarizeReady = Boolean(
    process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID,
  );
  console.log(
    `[desktop-electron] loaded packaging env from ${packagingEnv.path} (osxSign=${
      process.env.MACOS_SIGN_IDENTITY ? "yes" : "no"
    }, osxNotarize=${notarizeReady ? "yes" : "no"})`,
  );
}

const stagedResourcesRoot = join(__dirname, ".forge-resources");
const stagedSidecarRoot = join(stagedResourcesRoot, "local-sidecar");
const stagedRendererRoot = join(stagedResourcesRoot, "desktop-renderer");
const macosLocalizationsRoot = join(__dirname, "assets/macos-localizations");
const desktopVersion = JSON.parse(
  readFileSync(join(__dirname, "package.json"), "utf8"),
).version as string;
const stageElectronResources = async () =>
  // Shared ESM staging CLI; Forge's CommonJS config loads it lazily.
  // @ts-expect-error JavaScript build utility intentionally has no declaration package.
  (await import("./scripts/stage-resources.mjs")).stageElectronResources();
const prepareDmgMaker = async () =>
  // @ts-expect-error JavaScript build utility intentionally has no declaration package.
  (await import("./scripts/prepare-dmg-maker.mjs")).prepareDmgMaker();

const config = {
  packagerConfig: {
    name: "XueLearn",
    executableName: "XueLearn",
    icon: "assets/icon-local",
    asar: true,
    // Main/preload are bundled and sidecar native modules are explicit resources.
    // Pack only package.json + compiled dist/; keep local data, source, and
    // Forge scripts out of the asar. Avoid Electron Packager's pnpm-incompatible
    // dependency walker entirely.
    prune: false,
    ignore: ignorePackagedAppPath,
    extraResource: [
      stagedSidecarRoot,
      stagedRendererRoot,
      ...(process.platform === "darwin"
        ? [
            join(macosLocalizationsRoot, "en.lproj"),
            join(macosLocalizationsRoot, "zh-Hans.lproj"),
            join(macosLocalizationsRoot, "zh-Hant.lproj"),
          ]
        : []),
    ],
    extendInfo: {
      CFBundleDevelopmentRegion: "en",
      CFBundleDisplayName: "好会学",
      CFBundleLocalizations: ["en", "zh-Hans", "zh-Hant"],
      CFBundleName: "好会学",
      LSHasLocalizedDisplayName: true,
    },
    osxSign: process.env.MACOS_SIGN_IDENTITY
      ? {
          identity: process.env.MACOS_SIGN_IDENTITY,
          hardenedRuntime: true,
          // Current osx-sign takes per-file options. The legacy inherit key
          // leaves Helper (Plugin) without allow-jit on Apple silicon.
          optionsForFile: () => ({
            entitlements: join(__dirname, "entitlements.plist"),
          }),
        }
      : undefined,
    osxNotarize:
      process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID
        ? {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          }
        : undefined,
  },
  makers:
    process.platform === "darwin"
      ? [
          new MakerDMG({
            // appdmg's legacy background alias cannot resolve non-ASCII volume names.
            // Keep the technical volume name ASCII; all installer copy/items stay Chinese.
            title: "HaoHuiXue",
            format: "ULFO",
            name: `好会学-${desktopVersion}-${process.arch}`,
            icon: join(__dirname, "assets/icon-local.icns"),
            background: join(__dirname, "assets/dmg-background-zh-Hans.png"),
            iconSize: 104,
            contents: (options) => [
              {
                x: 464,
                y: 206,
                type: "link" as const,
                path: "/Applications",
                name: "应用程序",
              },
              {
                x: 196,
                y: 206,
                type: "file" as const,
                path: options.appPath,
                name: "好会学.app",
              },
            ],
            additionalDMGOptions: {
              "background-color": "#fffaf3",
              window: {
                size: { width: 660, height: 430 },
              },
            },
          }),
        ]
      : process.platform === "win32"
        ? [
            new MakerSquirrel({
              name: "XueLearn",
              setupExe: `XueLearn-${desktopVersion}-${process.arch}-Setup.exe`,
              noMsi: true,
            }),
          ]
        : [
            new MakerDeb({
              options: {
                name: "xuelearn",
                productName: "XueLearn",
                genericName: "AI learning assistant",
                description: "Private AI-guided learning assistant",
                maintainer: "XueLearn",
                homepage: "https://xuelearn.app",
                icon: join(__dirname, "assets/icon-local.png"),
              },
            }),
          ],
  plugins: [new AutoUnpackNativesPlugin({})],
  hooks: {
    preStart: stageElectronResources,
    prePackage: stageElectronResources,
    preMake:
      process.platform === "darwin" ? prepareDmgMaker : async () => undefined,
  },
};

export default config;
