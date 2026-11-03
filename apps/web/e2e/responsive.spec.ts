import { expect, test } from "@playwright/test";

test("works on a phone: no sideways scrolling, the campaigns are reachable", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("rop.persona", "ana"));
  await page.goto("/shotlog");
  await expect(page.getByRole("link", { name: /PHX-26-I2/ })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
