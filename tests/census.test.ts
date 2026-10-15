import { describe, expect, it } from "vitest";
import { buildCbpUrl, parseCbpResponse } from "@/lib/sources/census";

const cfg = { year: 2023, naicsVar: "NAICS2017", cbsa: "19100", naics: ["561720"] };

describe("Census CBP client", () => {
  it("builds the documented query shape (MSA geography, NAICS, LFO and EMPSZES totals)", () => {
    const u = new URL(buildCbpUrl(cfg, "561720", "KEY"));
    expect(u.pathname).toBe("/data/2023/cbp");
    expect(u.searchParams.get("get")).toBe("NAME,NAICS2017_LABEL,ESTAB,EMP,PAYANN");
    expect(u.searchParams.get("for")).toBe("metropolitan statistical area/micropolitan statistical area:19100");
    expect(u.searchParams.get("NAICS2017")).toBe("561720");
    expect(u.searchParams.get("LFO")).toBe("001");
    expect(u.searchParams.get("EMPSZES")).toBe("001");
    expect(u.searchParams.get("key")).toBe("KEY");
  });
  it("parses the API's array-of-arrays response (columns in any order)", () => {
    const json = [
      ["NAME", "NAICS2017_LABEL", "ESTAB", "EMP", "PAYANN", "NAICS2017", "LFO", "EMPSZES", "metropolitan statistical area/micropolitan statistical area"],
      ["Dallas-Fort Worth-Arlington, TX Metro Area", "Janitorial services", "1234", "45678", "1500000", "561720", "001", "001", "19100"],
    ];
    expect(parseCbpResponse(json, cfg, "561720")).toEqual({
      geography: "CBSA:19100", geoLabel: "Dallas-Fort Worth-Arlington, TX Metro Area", naics: "561720", naicsLabel: "Janitorial services",
      year: 2023, establishments: 1234, employees: 45678, annualPayrollThousands: 1500000,
    });
  });
  it("rejects malformed or ambiguous responses instead of guessing", () => {
    expect(parseCbpResponse({ error: "bad" }, cfg, "561720")).toBeNull();
    expect(parseCbpResponse([["NAME"]], cfg, "561720")).toBeNull();
    expect(parseCbpResponse([["NAME", "ESTAB"], ["a", "1"], ["b", "2"]], cfg, "561720")).toBeNull();
  });
  it("treats suppressed values as null, not zero", () => {
    const r = parseCbpResponse([["NAME", "ESTAB", "EMP", "PAYANN"], ["X", "12", null, ""]], cfg, "561720")!;
    expect(r.employees).toBeNull();
  });
});
