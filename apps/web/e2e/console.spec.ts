import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function signIn(page: Page, persona: string, path: string) {
  await page.goto("/");
  await page.evaluate((p) => localStorage.setItem("rop.persona", p), persona);
  await page.goto(path);
}

async function axe(page: Page) {
  // Let the one reveal animation finish so contrast is measured on the final colours.
  await page.waitForTimeout(800);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
    [],
  );
}

test("asks who you are, then shows the campaigns that person may see", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/shotlog");
  await expect(page.getByText("Who are you?")).toBeVisible();
  await page.getByLabel("Signed in as").selectOption("ana");
  await expect(page.getByRole("link", { name: /PHX-26-R1/ })).toBeVisible();
  await axe(page);
});

test("a scientist without clearance never sees restricted campaigns or their notes", async ({ page }) => {
  await signIn(page, "ben", "/shotlog");
  await expect(page.getByRole("link", { name: /PHX-26-I2/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /PHX-26-R1/ })).toHaveCount(0);
  await page.getByLabel("Search shot notes").fill("interlock");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No matching shots")).toBeVisible();
});

test("a cleared scientist finds restricted notes by search", async ({ page }) => {
  await signIn(page, "ana", "/shotlog");
  await page.getByLabel("Search shot notes").fill("interlock");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name: /PHX-26-R1 shot 2/ }).first()).toBeVisible();
  await axe(page);
});

test("an operator logs the next shot and sees it in the campaign", async ({ page }) => {
  await signIn(page, "ana", "/shotlog");
  await page.getByRole("link", { name: /PHX-26-I2/ }).click();
  await expect(page.getByRole("img", { name: /shots:/ })).toBeVisible();
  await page.getByLabel("Fired at (your time)").fill("2026-11-02T10:30");
  await page.getByLabel("Outcome").selectOption("partial");
  await page.getByLabel("Energy (J)").fill("2.75");
  await page.getByLabel("Notes", { exact: true }).fill("End-to-end test shot: mirror mount drift");
  await page.getByRole("button", { name: "Log shot" }).click();
  await expect(page.getByText(/Logged shot \d+\./)).toBeVisible();
  await expect(page.getByRole("cell", { name: /mirror mount drift/ }).first()).toBeVisible();
});

test("records hours and shows them on the day", async ({ page }) => {
  await signIn(page, "hana", "/time");
  await page.getByRole("spinbutton", { name: /^Hours/ }).fill("1.5");
  await page.getByLabel("What you did").fill("Supplier contract review");
  await page.getByRole("button", { name: "Record hours" }).click();
  await expect(page.getByText(/Recorded/)).toBeVisible();
  await expect(page.getByText("Supplier contract review").first()).toBeVisible();
  await axe(page);
});

test("a grant lead decides on submitted hours", async ({ page }) => {
  await signIn(page, "ben", "/approvals");
  const first = page.locator(".queue__item").first();
  await expect(first).toBeVisible();
  await first.getByRole("button", { name: "Return" }).click();
  await first.getByLabel("Why are you returning it?").fill("Please name the work package task");
  await first.getByRole("button", { name: /Return to/ }).click();
  await expect(page.getByText("Returned with your reason; the person is notified.")).toBeVisible();
  await axe(page);
});

test("Finance sees per-person costs; executives see only totals over enough people", async ({ page }) => {
  await signIn(page, "dan", "/costs");
  await page
    .getByLabel("Grant")
    .selectOption({ label: "EU-LPI-26: Laser-plasma interaction for fast ignition" });
  await page.getByLabel("Month", { exact: true }).fill("2026-09");
  await expect(page.getByText("€905.02")).toBeVisible();
  await axe(page);
  await signIn(page, "gus", "/reporting");
  await expect(page.getByText(/Not shown: fewer than 3 people/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Personnel costs" })).toHaveCount(0);
  await axe(page);
});

test("the platform pages show the access proof and the handover gate", async ({ page }) => {
  await signIn(page, "hana", "/access");
  await expect(page.getByText("Disagreements with the model")).toBeVisible();
  await page.getByRole("button", { name: "salary costs" }).click();
  await expect(page.getByText(/salary_costs\.select\[1\]/).first()).toBeVisible();
  await axe(page);
  await signIn(page, "hana", "/handover");
  await expect(page.getByText("ready for handover").first()).toBeVisible();
  await axe(page);
});

test("the target inventory follows targets through their stages", async ({ page }) => {
  await signIn(page, "cleo", "/targets");
  await expect(page.getByRole("heading", { name: /Allocated/ })).toBeVisible();
  await axe(page);
});

test("keyboard users can skip to the content", async ({ page }) => {
  await signIn(page, "ana", "/shotlog");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});
