import { describe, expect, it } from "vitest";
import { parseNumberInput } from "./NumberField";

describe("parseNumberInput", () => {
  const size = { min: 16, max: 8192, integer: true };

  it("ignores half-typed or non-numeric text", () => {
    for (const t of ["", " ", "-", "abc", "1e"]) expect(parseNumberInput(t, size)).toBeNull();
  });

  it("fits values into the range and rounds integers", () => {
    expect(parseNumberInput("1", size)).toBe(16);
    expect(parseNumberInput("99999", size)).toBe(8192);
    expect(parseNumberInput("1280.6", size)).toBe(1281);
    expect(parseNumberInput("-6", { min: -60, max: 12 })).toBe(-6);
    expect(parseNumberInput("2.5", { min: 0.5, max: 20 })).toBe(2.5);
  });
});
