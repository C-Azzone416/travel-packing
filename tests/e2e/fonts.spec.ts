import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./helpers/auth";

// Self-hosted ledger fonts (#182): a city name with diacritics renders in the ledger font, and the latin-ext faces are
// only fetched when a page needs them. The font actually used is read from Chromium's own record of platform fonts.
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "reads Chromium's platform font record (CDP)",
);

test("Gdańsk Łódź Plzeň İzmir resolve to the ledger font, and latin-ext loads only when needed", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  const faces = () =>
    page.evaluate(() =>
      [...document.fonts].map((face) => ({
        family: face.family,
        weight: face.weight,
        status: face.status,
      })),
    );
  const ext = async (status: string) =>
    (await faces()).filter((face) => /Ext$/.test(face.family) && face.status === status);

  // A page of plain Latin text: the latin-ext faces were never needed, so they were never downloaded.
  expect(await ext("loaded")).toEqual([]);
  expect((await faces()).some((face) => /Ext$/.test(face.family))).toBe(true);

  await page.evaluate(() => {
    for (const [id, family, weight] of [
      ["body", "var(--font-body)", "600"],
      ["display", "var(--font-display)", "800"],
    ]) {
      const element = document.createElement("p");
      element.id = `diacritics-${id}`;
      element.style.fontFamily = family;
      element.style.fontWeight = weight;
      element.textContent = "Gdańsk Łódź Plzeň İzmir";
      document.body.append(element);
    }
  });
  await expect.poll(async () => (await ext("loaded")).length).toBeGreaterThanOrEqual(2);

  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("CSS.enable");
  const { root } = await client.send("DOM.getDocument", { depth: -1 });
  for (const [id, name] of [
    ["body", "Barlow"],
    ["display", "Bricolage"],
  ]) {
    const { nodeId } = await client.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: `#diacritics-${id}`,
    });
    const { fonts } = await client.send("CSS.getPlatformFontsForNode", { nodeId });
    expect(fonts.length, `${id} used some font`).toBeGreaterThan(0);
    // Every glyph, the latin ones and the Ł ń ń İ ones, was drawn by the bundled font, never a system fallback.
    for (const font of fonts) {
      expect(font.isCustomFont, `${id}: ${font.familyName}`).toBe(true);
      expect(font.familyName).toContain(name);
    }
  }
});
