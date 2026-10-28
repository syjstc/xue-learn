// Use the same profile and Electron singleton as the host, before starting any
// build/watch processes. A second-instance event makes the existing host focus
// its window; a successful lock means there is no host to focus.
const { app } = require("electron");
const { resolve } = require("node:path");

app.setName("XueLearn");
if (process.env.XUELEARN_DESKTOP_DATA_PATH?.trim()) {
  app.setPath("userData", resolve(process.env.XUELEARN_DESKTOP_DATA_PATH));
}
if (app.requestSingleInstanceLock()) {
  app.releaseSingleInstanceLock();
  app.exit(2);
} else {
  app.exit(0);
}
