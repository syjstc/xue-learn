/** Official minimal plugin: uses the same Cordis host as the Video plugin. */
module.exports = {
  name: 'workspace-inspector',
  inject: ['desktop'],
  apply(ctx) {
    ctx.effect(() => ctx.desktop.registerCommand('workspace.inspect', async (_args, invocation) => {
      const connection = await invocation.call('workspace.connection', 'get');
      return {
        workspaceId: invocation.workspaceId,
        connected: connection.workspaceId === invocation.workspaceId && Boolean(connection.brokerPath),
      };
    }));
  },
};
