import { test, expect } from "bun:test";
import { createServer, createAsyncServer } from "@coderbuzz/kvs-server";

test("exports exist", () => {
  expect(typeof createServer).toBe("function");
  expect(typeof createAsyncServer).toBe("function");
});