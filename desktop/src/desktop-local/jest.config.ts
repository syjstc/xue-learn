export default {
  displayName: "desktop-local-renderer",
  preset: "../../jest.preset.js",
  testEnvironment: "node",
  transform: {
    "^.+\\.[tj]sx?$": [
      "ts-jest",
      { tsconfig: "<rootDir>/tsconfig.json", isolatedModules: true },
    ],
  },
  moduleNameMapper: {
    "^@cognilearn/runtime-contracts$":
      "<rootDir>/../../libs/runtime-contracts/src/index.ts",
    "^@cognilearn/domain$": "<rootDir>/../../libs/domain/src/index.ts",
    "^@cognilearn/domain/(.*)$": "<rootDir>/../../libs/domain/src/$1",
    "^@/shared/api-client$": "<rootDir>/api-client.test-mock.ts",
    "^@/shared/dev$": "<rootDir>/dev.test-mock.ts",
    "^@/(.*)$": "<rootDir>/../$1",
  },
  moduleFileExtensions: ["ts", "tsx", "js"],
  coverageDirectory: "../../coverage/desktop-local-renderer",
  watchman: false,
};
