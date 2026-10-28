import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
jest.mock("../dev.js", () => ({isDev: () => false}));

it("shares provider identity when public renderer and host load separate module copies", () => {
 // A separately bundled renderer must use the host's provider, while retaining
 // the same external React singleton as production package entries do.
 jest.doMock("react", () => React);
 let host!: typeof import("./index.js");
 let plugin!: typeof import("./index.js");
 jest.isolateModules(() => {host = require("./index.js");});
 jest.isolateModules(() => {plugin = require("./index.js");});
 expect(host.I18nProvider).not.toBe(plugin.I18nProvider);
 const Plugin = () => <span>{plugin.useI18n().locale}</span>;
 expect(renderToStaticMarkup(<host.I18nProvider><Plugin/></host.I18nProvider>)).toBe("<span>zh-Hans</span>");
 jest.dontMock("react");
});
