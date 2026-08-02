import { describe, expect, it } from "vitest";

import {
  isAllowedStudioHost,
  isAllowedStudioOrigin,
  studioRequestRejection,
} from "./studio-server.js";

describe("packaged Studio request origin checks", () => {
  it("allows only the loopback hostnames on the configured port", () => {
    expect(isAllowedStudioHost("127.0.0.1:4173", 4173)).toBe(true);
    expect(isAllowedStudioHost("localhost:4173", 4173)).toBe(true);
    expect(isAllowedStudioHost("LOCALHOST:4173", 4173)).toBe(true);

    expect(isAllowedStudioHost(undefined, 4173)).toBe(false);
    expect(isAllowedStudioHost("localhost:4174", 4173)).toBe(false);
    expect(isAllowedStudioHost("attacker.example:4173", 4173)).toBe(false);
    expect(isAllowedStudioHost("localhost:4173.attacker.example", 4173)).toBe(false);
  });

  it("allows unsafe requests only from the matching Studio origin", () => {
    expect(isAllowedStudioOrigin("http://127.0.0.1:4173", 4173)).toBe(true);
    expect(isAllowedStudioOrigin("http://localhost:4173", 4173)).toBe(true);
    expect(isAllowedStudioOrigin("HTTP://LOCALHOST:4173", 4173)).toBe(true);

    expect(isAllowedStudioOrigin(undefined, 4173)).toBe(false);
    expect(isAllowedStudioOrigin("null", 4173)).toBe(false);
    expect(isAllowedStudioOrigin("https://localhost:4173", 4173)).toBe(false);
    expect(isAllowedStudioOrigin("http://localhost:4174", 4173)).toBe(false);
    expect(isAllowedStudioOrigin("http://attacker.example:4173", 4173)).toBe(false);
  });

  it("applies the host check to every request and the origin check to writes", () => {
    expect(
      studioRequestRejection({ method: "GET", host: "attacker.example:4173" }, 4173),
    ).toEqual({ statusCode: 421, error: "Invalid Studio host." });
    expect(
      studioRequestRejection({ method: "POST", host: "127.0.0.1:4173" }, 4173),
    ).toEqual({ statusCode: 403, error: "Invalid Studio origin." });
    expect(
      studioRequestRejection(
        {
          method: "PUT",
          host: "127.0.0.1:4173",
          origin: "http://attacker.example:4173",
        },
        4173,
      ),
    ).toEqual({ statusCode: 403, error: "Invalid Studio origin." });
    expect(
      studioRequestRejection({ method: "GET", host: "127.0.0.1:4173" }, 4173),
    ).toBeUndefined();
    expect(
      studioRequestRejection(
        {
          method: "POST",
          host: "localhost:4173",
          origin: "http://localhost:4173",
        },
        4173,
      ),
    ).toBeUndefined();
  });
});
