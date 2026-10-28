module.exports={
  "rootDir": __dirname,
  "testEnvironment": "node",
  "watchman": false,
  "testMatch": [
    "<rootDir>/sources/**/*.spec.ts",
    "<rootDir>/sources/**/*.spec.tsx"
  ],
  "transform": {
    "^.+\\.[tj]sx?$": [
      "ts-jest",
      {
        "tsconfig": {
          "target": "ES2022",
          "module": "CommonJS",
          "jsx": "react-jsx",
          "esModuleInterop": true,
          "experimentalDecorators": true,
          "emitDecoratorMetadata": true,
          "isolatedModules": true
        },
        "diagnostics": false
      }
    ]
  },
  "moduleNameMapper": {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@cognilearn/([^/]+)/(.*)$": "<rootDir>/sources/libs/$1/src/$2",
    "^@cognilearn/([^/]+)$": "<rootDir>/sources/libs/$1/src/index.ts",
    "^@/(.*)$": "<rootDir>/sources/src/$1"
  }
};
