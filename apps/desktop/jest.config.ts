export default {
  displayName: "desktop-electron",
  preset: "../../jest.preset.js",
  testEnvironment: "node",
  watchman: false,
  transform: {
    "^.+\\.[tj]s$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.spec.json" }],
  },
  moduleNameMapper: {
    "^@cognilearn/runtime-contracts$": "<rootDir>/../../libs/runtime-contracts/src/index.ts",
  },
  coverageDirectory: "../../coverage/apps/desktop",
};
