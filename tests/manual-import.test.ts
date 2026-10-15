import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseListingCsv, ManualListingInput } from "@/lib/manual-import";

describe("CSV listing parser", () => {
  it("parses the published template exactly, keeping blanks as not disclosed", () => {
    const { rows, errors } = parseListingCsv(readFileSync("public/listing-import-template.csv", "utf8"));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].candidate).toMatchObject({ askingPrice: 1_150_000, revenue: 1_900_000, cashFlow: 470_000, ebitda: null, state: "TX", sellerFinancing: true, type: "ACQUISITION", yearEstablished: 2009, employees: 32 });
    expect(rows[0].url).toBe("https://www.example-broker.com/listing/123");
    expect(rows[1].candidate).toMatchObject({ askingPrice: 450_000, cashFlow: null, type: "FRANCHISE", sellerFinancing: null });
    expect(rows[1].url).toBeNull();
  });
  it("accepts common header aliases and a byte-order mark", () => {
    const { rows } = parseListingCsv("﻿Name,Price,SDE,State\nHVAC shop,$900K,260000,tx\n");
    expect(rows[0].candidate).toMatchObject({ title: "HVAC shop", askingPrice: 900_000, cashFlow: 260_000, state: "TX" });
  });
  it("reports bad rows by line number and imports the good ones", () => {
    const { rows, errors } = parseListingCsv("title,asking_price,state,url\nGood,100000,TX,\n,5,TX,\nBad price,lots,TX,\nBad state,1,Texas,\nBad url,1,TX,www.x.com\n");
    expect(rows.map((r) => r.candidate.title)).toEqual(["Good"]);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(errors[1].message).toMatch(/isn't a dollar amount/);
  });
  it("requires a title column and enforces limits", () => {
    expect(parseListingCsv("price\n1").errors[0].message).toMatch(/title/);
    expect(parseListingCsv("title\n" + "x\n".repeat(501)).errors[0].message).toMatch(/Too many rows/);
    expect(parseListingCsv("x".repeat(1_000_001)).errors[0].message).toMatch(/1 MB/);
  });
});

describe("manual entry form validation", () => {
  const base = { title: "Shop", url: "", type: "ACQUISITION", industry: "", city: "", state: "tx", askingPrice: "$1.2M", revenue: "", cashFlow: "300,000", ebitda: "", yearEstablished: "", employees: "", sellerFinancing: "", description: "", verified: false };
  it("normalizes money and blanks", () => {
    const v = ManualListingInput.parse(base);
    expect(v).toMatchObject({ askingPrice: 1_200_000, cashFlow: 300_000, revenue: null, state: "TX", url: null, sellerFinancing: null });
  });
  it("rejects nonsense amounts instead of storing zero", () => {
    expect(ManualListingInput.safeParse({ ...base, askingPrice: "call for price" }).success).toBe(false);
  });
});
