// Node IPC entry. The bundled main exports the same bootstrap used by Electron.
'use strict';
let app;
process.once('message', async (bootstrap) => {
  try {
    const runtime = require("./main.ts");
    const result = await runtime.startLocalRuntime(bootstrap);
    app = result.app;
    process.send({ type: 'ready', port: result.port });
  } catch (error) {
    process.stderr.write(String(error?.stack || error) + "\n");
    process.send?.({ type: 'fatal', message: '本地服务启动失败，请查看专属服务日志。' });
    process.exitCode = 1;
    process.disconnect?.();
  }
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 5000);
  deadline.unref();
  try { await app?.close(); } finally { process.exit(0); }
}
process.on('disconnect', close);
process.on('SIGTERM', close);
process.on('SIGINT', close);
