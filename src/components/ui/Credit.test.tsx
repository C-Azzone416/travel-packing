// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Credit } from "./Credit";

describe("Credit", () => {
  it("reads as one sentence, with each named source as a link that opens in a new tab safely", () => {
    const { container } = render(
      <Credit
        parts={[
          "Data by ",
          { text: "Example.org", href: "https://example.org/" },
          ", places from ",
          { text: "Places", href: "https://places.example/" },
          ".",
        ]}
      />,
    );
    expect(container.textContent).toBe("Data by Example.org, places from Places.");
    const example = screen.getByRole("link", { name: "Example.org" });
    expect(example.getAttribute("href")).toBe("https://example.org/");
    expect(example.getAttribute("target")).toBe("_blank");
    expect(example.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "Places" }).getAttribute("href")).toBe(
      "https://places.example/",
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("renders plain text with no links", () => {
    render(<Credit parts={["Just text."]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Just text.")).toBeTruthy();
  });
});
