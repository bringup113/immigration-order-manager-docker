import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "mrz";

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
