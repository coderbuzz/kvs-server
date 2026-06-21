import { test, expect } from "bun:test";
import { createServer, createAsyncServer } from "../src/index";

test("exports exist", () => {
  expect(typeof createServer).toBe("function");
  expect(typeof createAsyncServer).toBe("function");
});