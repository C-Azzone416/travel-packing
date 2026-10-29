import { test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

const OLD = process.env.OLD_MARKUP === "1";
for (const width of [1280, 390]) {
  test(`measure weather ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date("2026-10-16T12:00:00"));
    await signInAsOwner(page);
    await page.locator(".ledger-hero").waitFor();
    await page.evaluate((old) => {
      const strip = document.createElement("ul");
      strip.className = "weather-strip";
      const inner = (n: number) =>
        `<span class="weather-glyph">☀</span><span class="weather-city">Stop ${n}</span>` +
        `<span class="weather-dates">Oct 2${n} – Oct 2${n + 1}</span>` +
        `<span class="weather-range">61–72°F <small>typical</small></span>`;
      strip.innerHTML = [1, 2]
        .map(
          (n) =>
            `<li>${old ? inner(n) : `<div class="weather-cell-top">${inner(n)}</div>`}<span class="weather-note">Mild and dry</span></li>`,
        )
        .join("");
      document.querySelector(".ledger-hero-top")!.after(strip);
    }, OLD);
    const out = await page.evaluate(() => {
      const li = document.querySelector(".weather-strip li")!;
      const top = li.getBoundingClientRect().top;
      return [".weather-glyph", ".weather-city", ".weather-dates", ".weather-range", ".weather-note"].map(
        (s) => `${s} ${(li.querySelector(s)!.getBoundingClientRect().top - top).toFixed(1)}`,
      );
    });
    console.log(`RESULT ${OLD ? "old" : "new"} ${width}: ${out.join(" | ")}`);
  });
}
