import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the app name as the main heading", () => {
    expect(renderToStaticMarkup(<HomePage />)).toContain("<h1>Travel Packing</h1>");
  });
});
