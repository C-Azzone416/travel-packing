import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import NewTripPage, { metadata } from "./page";

const render = async (copy?: string | string[]) =>
  (await NewTripPage({
    searchParams: Promise.resolve(copy === undefined ? {} : { copy }),
  })) as ReactElement<{ copyId?: string }>;

describe("/trips/new", () => {
  it("is titled 'New trip'", () => {
    expect(metadata.title).toBe("New trip");
  });

  it("starts a brand-new trip without ?copy", async () => {
    expect((await render()).props.copyId).toBeUndefined();
  });

  it("seeds a copy from ?copy=<id>", async () => {
    expect((await render("san-diego")).props.copyId).toBe("san-diego");
  });

  it("ignores an empty value", async () => {
    expect((await render("")).props.copyId).toBeUndefined();
  });

  it("ignores a repeated parameter", async () => {
    expect((await render(["a", "b"])).props.copyId).toBeUndefined();
  });
});
