import { detectUiLocale, supportedUiLocale } from "./locale.js";
import { en } from "./locales/en.js";
import { zhHans } from "./locales/zh-Hans.js";
import { zhHant } from "./locales/zh-Hant.js";

describe("interface locale negotiation", () => {
  it.each([
    ["en-US", "en"],
    ["en_GB", "en"],
    ["ZH-hk", "zh-Hant"],
    ["zh-MO", "zh-Hant"],
    ["zh-SG", "zh-Hans"],
    ["zh-Hans-HK", "zh-Hans"],
    ["zh-Hant-CN", "zh-Hant"],
    ["zh", "zh-Hans"],
    ["fr-FR", null],
    ["", null],
  ])("negotiates %s as %s", (input, expected) => {
    expect(supportedUiLocale(input)).toBe(expected);
  });
  it("uses the first supported system language and English for unsupported languages", () => {
    expect(detectUiLocale(["fr-FR", "zh-TW", "en-US"])).toBe("zh-Hant");
    expect(detectUiLocale(["en-US", "zh-CN"])).toBe("en");
    expect(detectUiLocale(["de-DE"])).toBe("en");
    expect(detectUiLocale([])).toBe("en");
  });
  it("keeps translated keys and interpolation parameters consistent", () => {
    const parameters = (value: string) =>
      [
        ...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1])),
      ].sort();
    for (const dictionary of [zhHans, zhHant]) {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect({ key, parameters: parameters(dictionary[key]) }).toEqual({
          key,
          parameters: parameters(en[key]),
        });
      }
    }
  });
});
