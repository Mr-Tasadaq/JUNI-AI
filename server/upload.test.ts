import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./storage", () => ({ storagePut: vi.fn() }));
vi.mock("./db", () => ({ registerStoredFile: vi.fn() }));

import { registerStoredFile } from "./db";
import { storagePut } from "./storage";
import { uploadUserFile } from "./upload";

const mockedStoragePut = vi.mocked(storagePut);
const mockedRegisterStoredFile = vi.mocked(registerStoredFile);

const contentBase64 = Buffer.from("hello JUNI").toString("base64");

describe("uploadUserFile", () => {
  beforeEach(() => {
    mockedStoragePut.mockReset();
    mockedRegisterStoredFile.mockReset();
    mockedStoragePut.mockResolvedValue({
      key: "42/files/object.txt",
      url: "/manus-storage/42/files/object.txt",
    });
    mockedRegisterStoredFile.mockResolvedValue({ id: 7 } as Awaited<
      ReturnType<typeof registerStoredFile>
    >);
  });

  it("rejects unsupported MIME types before storage is contacted", async () => {
    await expect(
      uploadUserFile({
        userId: 42,
        originalName: "secret.exe",
        mimeType: "application/x-msdownload",
        contentBase64,
      })
    ).rejects.toThrow("not supported");
    expect(mockedStoragePut).not.toHaveBeenCalled();
    expect(mockedRegisterStoredFile).not.toHaveBeenCalled();
  });

  it("generates a user-scoped storage key and persists metadata after upload", async () => {
    await uploadUserFile({
      userId: 42,
      originalName: "notes.txt",
      mimeType: "text/plain",
      contentBase64,
    });
    expect(mockedStoragePut).toHaveBeenCalledWith(
      expect.stringMatching(/^42\/files\//),
      expect.any(Buffer),
      "text/plain"
    );
    expect(mockedRegisterStoredFile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        storageKey: "42/files/object.txt",
        sizeBytes: 10,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
  });
});
