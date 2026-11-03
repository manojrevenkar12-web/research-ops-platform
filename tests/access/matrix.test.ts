import { createTestDb, loadFixture, mismatches, runMatrix, type TestDb } from "@rop/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("access matrix", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    const c = await db.admin.connect();
    await loadFixture(c).finally(() => c.release());
  });
  afterAll(async () => db.drop());

  it("the database allows exactly what the access model says, for every principal, table and operation", async () => {
    const attempts = await runMatrix(db.admin, db.app);
    const wrong = mismatches(attempts);
    const inconclusive = attempts.filter((a) => a.actual === "inconclusive");
    console.log(
      `${attempts.length} attempts, ${wrong.length} mismatches, ${inconclusive.length} inconclusive`,
    );
    expect(wrong.slice(0, 15)).toEqual([]);
    expect(inconclusive.length / attempts.length).toBeLessThan(0.1);
  });
});
