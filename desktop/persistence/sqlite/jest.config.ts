import { pathsToModuleNameMapper } from "ts-jest";
import { compilerOptions } from "../../tsconfig.base.json";
export default {
 displayName: "electron-persistence", preset: "../../jest.preset.js", testEnvironment: "node",
 transform: { "^.+\\.[tj]s$": ["ts-jest", { tsconfig: "<rootDir>/../../libs/server/tsconfig.lib.json", diagnostics: false }] },
 moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: "<rootDir>/../../" }),
 moduleFileExtensions: ["ts", "js"],
};
