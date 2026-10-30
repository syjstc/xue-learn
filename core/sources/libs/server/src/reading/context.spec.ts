import {configureReadingContext, readyReadingContext} from "./context.js";
afterEach(() => configureReadingContext(undefined));
it("supplies optional ready text but never fails Display when reading storage is unavailable", async () => {
  const read = jest.fn(async () => "accepted content");
  configureReadingContext(read);
  expect(await readyReadingContext("owner", "unit", "section")).toBe("accepted content");
  expect(read).toHaveBeenCalledWith("owner", "unit", "section");
  configureReadingContext(async () => {throw Error("Storage temporarily unavailable");});
  expect(await readyReadingContext("owner", "unit", "section")).toBeNull();
});
