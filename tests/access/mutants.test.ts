import { createTestDb, equivalentMutants, loadFixture, runMutants, type TestDb } from "@rop/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("policy mutants", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    const c = await db.admin.connect();
    await loadFixture(c).finally(() => c.release());
  });
  afterAll(async () => db.drop());

  it("every weakened or missing rule is noticed by the matrix, or is listed as equivalent with a reason", async () => {
    const results = await runMutants(db.admin, db.app);
    expect(results.length).toBeGreaterThan(80);
    expect(results.filter((r) => r.verdict === "survived").map((r) => r.id)).toEqual([]);
    expect(results.filter((r) => r.verdict === "stale").map((r) => r.id)).toEqual([]);
    const listed = Object.keys(equivalentMutants()).sort();
    expect(
      results
        .filter((r) => r.verdict === "equivalent")
        .map((r) => r.id)
        .sort(),
    ).toEqual(listed);
  }, 300_000);
});
