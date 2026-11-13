import { test } from "@playwright/test";

// Avatars KayKit animés (outil interne /dev/avatar-anim) : capture gardée dans test-results/ pour la relecture visuelle.
test("avatars animés", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto("/dev/avatar-anim");
  await page.waitForFunction(() => ((window as unknown as { __kaykitLoaded?: number }).__kaykitLoaded ?? 0) >= 8, null, { timeout: 120_000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "test-results/avatar-anim.png" });
  if (errors.length) throw new Error(errors.join("\n"));
});
