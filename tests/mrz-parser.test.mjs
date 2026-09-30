import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "mrz";
import { mrzDateToIso } from "../lib/mrz-date.ts";

const specimen = [
  "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
  "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
];

test("server parser keeps all TD3 fields and verifies the official specimen", () => {
  const result = parse(specimen, { autocorrect: true });
  assert.equal(result.format, "TD3");
  const checksumDetails = result.details.filter((item) => String(item.field).toLowerCase().includes("checkdigit"));
  assert.equal(checksumDetails.every((item) => item.valid), true);
  assert.equal(result.documentNumber, "L898902C3");
  assert.equal(result.fields.lastName, "ERIKSSON");
  assert.equal(result.fields.firstName, "ANNA MARIA");
  assert.equal(result.details.find((item) => item.field === "nationality").ranges[0].raw, "UTO");
});

test("server parser preserves a parse result when a checksum is invalid", () => {
  const invalid = [...specimen];
  invalid[1] = `${invalid[1].slice(0, 9)}0${invalid[1].slice(10)}`;
  const result = parse(invalid);
  assert.equal(result.valid, false);
  assert.equal(result.details.some((item) => item.valid === false), true);
});

test("MRZ birth and expiry dates use field-specific century rules", () => {
  const today = new Date("2026-09-30T00:00:00Z");
  assert.equal(mrzDateToIso("300101", "birth", today), "1930-01-01");
  assert.equal(mrzDateToIso("250101", "birth", today), "2025-01-01");
  assert.equal(mrzDateToIso("390101", "expiry", today), "2039-01-01");
  assert.equal(mrzDateToIso("120415", "expiry", today), "2012-04-15");
  assert.equal(mrzDateToIso("260230", "expiry", today), "");
});
