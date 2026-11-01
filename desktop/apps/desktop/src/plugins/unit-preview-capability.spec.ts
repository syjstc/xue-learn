import { readCompletedUnitPreview } from "./unit-preview-capability";

test.each([
  ["en", "Could not prepare the lesson preview"],
  ["zh-Hans", "预习准备请求失败"],
  ["zh-Hant", "預習準備請求失敗"],
])(
  "preview failures use the requested %s language",
  async (locale, message) => {
    await expect(
      readCompletedUnitPreview(
        new Response("", { status: 503 }),
        new AbortController().signal,
        locale,
      ),
    ).rejects.toThrow(message);
  },
);

test("an incomplete English preview stream remains an error with English feedback", async () => {
  const response = new Response(
    'data: {"type":"status","message":"Preparing"}\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  await expect(
    readCompletedUnitPreview(response, new AbortController().signal, "en"),
  ).rejects.toThrow("interrupted");
});
