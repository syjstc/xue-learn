/** @jest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  I18nProvider,
  getCurrentUiLocale,
  useI18n,
  type UiLocalePreference,
} from "./index.js";
import {
  readLocalAppearancePreferences,
  writeLocalAppearancePreferences,
} from "../runtime/local-preferences.js";

jest.mock("../runtime/client-runtime.js", () => ({
  isDesktopLocalRuntime: () => true,
}));
jest.mock("../runtime/local-preferences.js", () => ({
  readLocalAppearancePreferences: jest.fn(),
  writeLocalAppearancePreferences: jest.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof useI18n>;
function Probe() {
  current = useI18n();
  return <p>{current.t("i18n.uiLanguage")}</p>;
}
async function mount(preference?: UiLocalePreference) {
  await act(async () =>
    root.render(
      <I18nProvider initialLocalePreference={preference}>
        <Probe />
      </I18nProvider>,
    ),
  );
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: ["en-US"],
  });
  jest
    .mocked(readLocalAppearancePreferences)
    .mockReset()
    .mockResolvedValue(null);
  jest.mocked(writeLocalAppearancePreferences).mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("fresh English systems use English before the first learning request", async () => {
  await mount("system");
  expect(container.textContent).toBe("Interface language");
  expect(getCurrentUiLocale()).toBe("en");
  expect(document.documentElement.lang).toBe("en");
});

test("a user selection immediately changes the non-React request locale and is saved", async () => {
  await mount("zh-Hans");
  expect(getCurrentUiLocale()).toBe("zh-Hans");
  await act(async () => current.setLocale("en"));
  expect(getCurrentUiLocale()).toBe("en");
  expect(container.textContent).toBe("Interface language");
  expect(writeLocalAppearancePreferences).toHaveBeenCalledWith({
    uiLocale: "en",
  });
});

test("a late preference read cannot overwrite a language chosen during startup", async () => {
  let resolve!: (value: { theme: "system"; uiLocale: "zh-Hans" }) => void;
  jest.mocked(readLocalAppearancePreferences).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await mount();
  await act(async () => current.setLocale("en"));
  await act(async () => resolve({ theme: "system", uiLocale: "zh-Hans" }));
  expect(current.locale).toBe("en");
  expect(getCurrentUiLocale()).toBe("en");
});

test("saved language preferences take priority over the current system language", async () => {
  await mount("zh-Hant");
  expect(current.localePreference).toBe("zh-Hant");
  expect(getCurrentUiLocale()).toBe("zh-Hant");
  expect(container.textContent).toBe("介面語言");
  expect(readLocalAppearancePreferences).not.toHaveBeenCalled();
});

test("system changes update automatic language but preserve an explicit language", async () => {
  await mount("system");
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: ["zh-TW"],
  });
  await act(async () => window.dispatchEvent(new Event("languagechange")));
  expect(current.locale).toBe("zh-Hant");
  await act(async () => current.setLocale("en"));
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: ["zh-CN"],
  });
  await act(async () => window.dispatchEvent(new Event("languagechange")));
  expect(current.locale).toBe("en");
});
