import { RagController } from "@xue-learn/core/source/libs/server/src/learning-host/rag/rag.controller.ts";

describe("desktop-local RAG upload progress", () => {
  it("streams processing updates before the final result", async () => {
    const ingest = jest.fn(
      async (
        _userId: string,
        goalId: string,
        _files: unknown[],
        onProgress: (message: string) => void,
      ) => {
        onProgress("正在解析《notes.pdf》…");
        onProgress("正在生成向量嵌入（1/2 批，共 955 段）…");
        return { goalId, fileCount: 1, chunks: 955, files: [] };
      },
    );
    const writes: string[] = [];
    const response = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((value: string) => writes.push(value)),
      end: jest.fn(),
    };

    await new RagController({ ingest } as never).ingestStream(
      "local-owner-v1",
      { files: [{ originalname: "notes.pdf", buffer: Buffer.from("pdf") }] },
      "goal-1",
      response as never,
    );

    expect(writes.map((line) => JSON.parse(line))).toEqual([
      { type: "progress", message: "正在解析《notes.pdf》…" },
      {
        type: "progress",
        message: "正在生成向量嵌入（1/2 批，共 955 段）…",
      },
      {
        type: "result",
        data: { goalId: "goal-1", fileCount: 1, chunks: 955, files: [] },
      },
    ]);
    expect(response.end).toHaveBeenCalledTimes(1);
  });
});
