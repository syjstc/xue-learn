import { pathsToModuleNameMapper } from "ts-jest";
import { compilerOptions } from "../../tsconfig.base.json";
export default {
  displayName: "local-runtime",
  preset: "../../jest.preset.js",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.v2.spec.ts"],
  transform: {
    "^.+\\.[tj]s$": [
      "ts-jest",
      { tsconfig: "<rootDir>/tsconfig.app.json" },
    ],
  },
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: "<rootDir>/../../" }),
  moduleFileExtensions: ["ts", "js"],
  coverageDirectory: "../../coverage/apps/local-runtime",
};
