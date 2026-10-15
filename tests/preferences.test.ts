import { describe, expect, it } from "vitest";
import { calculatorInputsFor, DEFAULT_FINANCING_DEFAULTS } from "@/lib/preferences";
import type { Preference } from "@/db/schema";

const pref = { targetOwnerIncome: 150_000, minOwnerIncome: 100_000, stretchOwnerIncome: 250_000, financingDefaults: DEFAULT_FINANCING_DEFAULTS } as unknown as Preference;

describe("calculatorInputsFor", () => {
  it("uses SDE when disclosed", () => {
    expect(calculatorInputsFor(pref, { askingPrice: 1e6, cashFlow: 400_000, ebitda: 300_000, revenue: 2e6 })!.deal).toMatchObject({ sde: 400_000, earningsBasis: "SDE" });
  });
  it("falls back to EBITDA when SDE isn't disclosed", () => {
    expect(calculatorInputsFor(pref, { askingPrice: 1e6, cashFlow: null, ebitda: 300_000, revenue: 2e6 })!.deal).toMatchObject({ sde: 300_000, earningsBasis: "EBITDA" });
  });
  it("never uses revenue as earnings, and needs a price", () => {
    expect(calculatorInputsFor(pref, { askingPrice: 1e6, cashFlow: null, ebitda: null, revenue: 2e6 })).toBeNull();
    expect(calculatorInputsFor(pref, { askingPrice: null, cashFlow: 400_000, revenue: 2e6 })).toBeNull();
  });
});
