export const PLUGIN_IPC = {
  list: 'desktop:plugins:v1:list',
  install: 'desktop:plugins:v1:install',
  enable: 'desktop:plugins:v1:enable',
  disable: 'desktop:plugins:v1:disable',
  remove: 'desktop:plugins:v1:remove',
  execute: 'desktop:plugins:v1:execute',
  openView: 'desktop:plugins:v1:open-view',
  callView: 'desktop:plugins:v1:call-view',
  executeView: 'desktop:plugins:v1:execute-view',
  closeView: 'desktop:plugins:v1:close-view',
  changed: 'desktop:plugins:v1:changed',
} as const;
