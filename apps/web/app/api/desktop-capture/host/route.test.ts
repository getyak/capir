import { expect, it } from "vitest";
import { GET } from "./route";

it("offers a content-free same-origin host for native-initiated capture requests", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toContain("text/html");
  const body = await response.text();
  expect(body).toContain("<!doctype html>");
  expect(body).not.toContain("<script");
  expect(body).not.toContain("<form");
});
