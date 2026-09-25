import { expect, test } from "bun:test";
import { detectByRules } from "./rules";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

test("rules recognise exact formats", () => {
  expect(detectByRules(JWT)).toBe("jwt");
  expect(detectByRules('{"a": [1, 2]}')).toBe("json");
  expect(detectByRules("https://example.com/a?b=1")).toBe("url");
  expect(detectByRules("1727000000")).toBe("timestamp");
  expect(detectByRules("2026-09-23T10:00:00Z")).toBe("timestamp");
  expect(detectByRules("#ff6b35")).toBe("color");
  expect(detectByRules("rgb(10, 20, 30)")).toBe("color");
  expect(detectByRules("*/5 * * * 1-5")).toBe("cron");
  expect(detectByRules("aGVsbG8gd29ybGQsIGhvdyBhcmUgeW91Pw==")).toBe("base64");
  expect(detectByRules("SELECT id FROM users WHERE active = 1")).toBe("sql");
});

test("rules leave fuzzy text alone", () => {
  expect(detectByRules("{ not json")).toBeNull();
  expect(detectByRules("select a movie for tonight")).toBeNull();
  expect(detectByRules("hello there, how are you doing today")).toBeNull();
  expect(detectByRules("one two three four five")).toBeNull();
});
