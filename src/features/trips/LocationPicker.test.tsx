// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { curatedLocationProvider, type LocationProvider } from "@/domain/location-provider";
import { locationById } from "@/domain/locations";
import type { SampleLocation } from "@/domain/trip-lifecycle";
import { SEARCH_ATTRIBUTION } from "./api-location-provider";
import {
  ALLOW_CUSTOM_DESTINATION,
  LocationPicker,
  NO_PLACES_MESSAGE,
  UNAVAILABLE_MESSAGE,
} from "./LocationPicker";

interface HarnessProps {
  provider?: LocationProvider;
  fallbackProvider?: LocationProvider;
  allowCustom?: boolean;
  onSubmit?: () => void;
  onSelectSpy?: (l: SampleLocation) => void;
  onClearSpy?: () => void;
  initial?: SampleLocation | null;
}

function Harness({
  provider = curatedLocationProvider,
  fallbackProvider,
  allowCustom,
  onSubmit = () => {},
  onSelectSpy = () => {},
  onClearSpy = () => {},
  initial = null,
}: HarnessProps) {
  const [query, setQuery] = useState(initial ? initial.label : "");
  const [selected, setSelected] = useState<SampleLocation | null>(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <LocationPicker
        provider={provider}
        fallbackProvider={fallbackProvider}
        query={query}
        onQueryChange={setQuery}
        selected={selected}
        onSelect={(location) => {
          onSelectSpy(location);
          setSelected(location);
        }}
        onClear={() => {
          onClearSpy();
          setSelected(null);
        }}
        allowCustom={allowCustom}
      />
    </form>
  );
}

const box = () => screen.getByRole("combobox", { name: "Destination search" });
const list = () => screen.getByRole("listbox", { hidden: true });
const announce = () => screen.getByRole("status", { name: "Destination results" });
const options = () => within(list()).findAllByRole("option");
const announced = (text: string) => waitFor(() => expect(announce().textContent).toBe(text));

// A provider whose answers the test settles by hand.
function manualProvider(overrides: Partial<LocationProvider> = {}) {
  const pending: {
    query: string;
    signal: AbortSignal;
    resolve: (items: SampleLocation[]) => void;
    reject: (error: Error) => void;
  }[] = [];
  const provider: LocationProvider = {
    minQueryLength: 2,
    debounceMs: 0,
    search: (query, { signal }) =>
      new Promise((resolve, reject) => pending.push({ query, signal, resolve, reject })),
    ...overrides,
  };
  return { provider, pending };
}

describe("LocationPicker", () => {
  it("is a labelled combobox, collapsed and invalid until something is confirmed", () => {
    render(<Harness />);
    expect(box().getAttribute("aria-autocomplete")).toBe("list");
    expect(box().getAttribute("aria-expanded")).toBe("false");
    expect(box().getAttribute("aria-invalid")).toBe("true");
    expect(box().getAttribute("aria-controls")).toBe(list().id);
    expect(list().hidden).toBe(true);
    expect(screen.getByText(/Free text alone is never a confirmed location/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sample/i);
    expect(announce().textContent).toBe("");
    expect(ALLOW_CUSTOM_DESTINATION).toBe(false);
  });

  it("lists matches with city, region and country, so the two Londons are told apart", async () => {
    render(<Harness />);
    await userEvent.type(box(), "london");
    expect((await options()).map((option) => option.textContent)).toEqual([
      "LondonEngland, United Kingdom",
      "LondonOntario, Canada",
    ]);
    expect(box().getAttribute("aria-expanded")).toBe("true");
    await announced("2 places found");
  });

  it("announces a single result in the singular, and no matches plainly", async () => {
    render(<Harness />);
    await userEvent.type(box(), "lisbon");
    await announced("1 place found");
    await userEvent.clear(box());
    await userEvent.type(box(), "zzzz");
    await announced("No places found");
    expect(screen.getByText("No places found. Check the spelling.")).toBeTruthy();
    expect(list().hidden).toBe(true);
    expect(screen.queryByText(/as typed/)).toBeNull();
  });

  it("moves through options with the arrow keys (wrapping) and exposes the active one", async () => {
    render(<Harness />);
    await userEvent.type(box(), "london");
    const [first, second] = await options();
    await userEvent.keyboard("{ArrowDown}");
    expect(box().getAttribute("aria-activedescendant")).toBe(first.id);
    expect(first.getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{ArrowDown}");
    expect(box().getAttribute("aria-activedescendant")).toBe(second.id);
    await userEvent.keyboard("{ArrowDown}");
    expect(box().getAttribute("aria-activedescendant")).toBe(first.id);
    await userEvent.keyboard("{ArrowUp}");
    expect(box().getAttribute("aria-activedescendant")).toBe(second.id);
  });

  it("Enter picks the highlighted option; with nothing highlighted it picks nothing and never submits the form", async () => {
    const onSubmit = vi.fn();
    const onSelectSpy = vi.fn();
    render(<Harness onSubmit={onSubmit} onSelectSpy={onSelectSpy} />);
    await userEvent.type(box(), "london");
    await options();
    await userEvent.keyboard("{Enter}");
    expect(onSelectSpy).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelectSpy).toHaveBeenCalledWith(locationById("ca-on-london"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Destination confirmed")).toBeTruthy();
  });

  it("Escape closes the list, and typing opens it again", async () => {
    render(<Harness />);
    await userEvent.type(box(), "london");
    await options();
    await userEvent.keyboard("{ArrowDown}{Escape}");
    expect(box().getAttribute("aria-expanded")).toBe("false");
    expect(box().getAttribute("aria-activedescendant")).toBeNull();
    expect(list().hidden).toBe(true);
    await userEvent.type(box(), "{Backspace}n");
    await options();
    expect(box().getAttribute("aria-expanded")).toBe("true");
  });

  it("arrow keys reopen a closed list; unrelated keys and a second Escape change nothing", async () => {
    render(<Harness />);
    await userEvent.keyboard("{Tab}{ArrowDown}");
    expect(box().getAttribute("aria-activedescendant")).toBeNull();
    await userEvent.type(box(), "london");
    await options();
    await userEvent.keyboard("{Escape}{ArrowDown}");
    expect(box().getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{Escape}{Escape}{Home}");
    expect(box().getAttribute("aria-expanded")).toBe("false");
  });

  it("picking with the mouse confirms the destination", async () => {
    const onSelectSpy = vi.fn();
    render(<Harness onSelectSpy={onSelectSpy} />);
    await userEvent.type(box(), "lisbon");
    await userEvent.click((await options())[0]);
    expect(onSelectSpy).toHaveBeenCalledWith(locationById("pt-lisbon"));
    const confirmed = screen.getByRole("status", { name: "" });
    expect(confirmed.textContent).toContain("Destination confirmed");
    expect(confirmed.textContent).toContain("Lisbon · Lisbon District · Portugal");
    expect(box().getAttribute("aria-invalid")).toBe("false");
    expect(list().hidden).toBe(true);
  });

  it("Change clears the confirmation and returns focus to the search box", async () => {
    const onClearSpy = vi.fn();
    render(<Harness initial={locationById("pt-lisbon")} onClearSpy={onClearSpy} />);
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onClearSpy).toHaveBeenCalledOnce();
    expect(screen.queryByText("Destination confirmed")).toBeNull();
    expect(document.activeElement).toBe(box());
  });

  it("editing the text after confirming clears the confirmation", async () => {
    const onClearSpy = vi.fn();
    render(<Harness initial={locationById("pt-lisbon")} onClearSpy={onClearSpy} />);
    await userEvent.type(box(), "x");
    expect(onClearSpy).toHaveBeenCalledOnce();
    expect(screen.queryByText("Destination confirmed")).toBeNull();
  });

  it("ignores navigation keys while a destination is confirmed", async () => {
    const onSubmit = vi.fn();
    render(<Harness initial={locationById("pt-lisbon")} onSubmit={onSubmit} />);
    box().focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByText("Destination confirmed")).toBeTruthy();
    expect(announce().textContent).toBe("");
  });

  describe("provider behavior", () => {
    it("shows Searching… (and announces it) until the provider answers, then lists the answer", async () => {
      const { provider, pending } = manualProvider();
      render(<Harness provider={provider} />);
      await userEvent.type(box(), "lon");
      await waitFor(() => expect(pending.length).toBeGreaterThan(0));
      expect(screen.getByText("Searching…")).toBeTruthy();
      expect(announce().textContent).toBe("Searching");
      expect(screen.queryByText("No places found. Check the spelling.")).toBeNull();
      await act(async () => pending[pending.length - 1].resolve([locationById("gb-eng-london")!]));
      expect((await options()).map((option) => option.textContent)).toEqual([
        "LondonEngland, United Kingdom",
      ]);
      expect(screen.queryByText("Searching…")).toBeNull();
      await announced("1 place found");
    });

    it("never searches below the provider's minimum length, and says nothing while the text is too short", async () => {
      const { provider, pending } = manualProvider({ minQueryLength: 3 });
      render(<Harness provider={provider} />);
      await userEvent.type(box(), "lo");
      expect(pending).toHaveLength(0);
      expect(announce().textContent).toBe("");
      expect(screen.queryByText("Searching…")).toBeNull();
      await userEvent.type(box(), "n");
      await waitFor(() => expect(pending).toHaveLength(1));
      expect(pending[0].query).toBe("lon");
    });

    it("sends only the trimmed query (plus an abort signal) to the provider", async () => {
      const search = vi.fn().mockResolvedValue([]);
      render(<Harness provider={{ minQueryLength: 1, debounceMs: 0, search }} />);
      await userEvent.type(box(), "  paris ");
      await waitFor(() => expect(search).toHaveBeenCalled());
      const [query, options] = search.mock.calls[search.mock.calls.length - 1];
      expect(query).toBe("paris");
      expect(Object.keys(options)).toEqual(["signal"]);
    });

    it("debounces: nothing is sent until typing pauses for the provider's delay", () => {
      // Testing Library's async wrapper waits on a real setTimeout, which a faked one never fires,
      // so this test types with synchronous change events and drives the clock itself.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const search = vi.fn().mockResolvedValue([]);
        render(<Harness provider={{ minQueryLength: 2, debounceMs: 300, search }} />);
        for (const value of ["l", "lo", "lon", "lond"]) {
          fireEvent.change(box(), { target: { value } });
          act(() => vi.advanceTimersByTime(100));
        }
        expect(search).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(199));
        expect(search).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
        expect(search).toHaveBeenCalledTimes(1);
        expect(search.mock.calls[0][0]).toBe("lond");
      } finally {
        vi.useRealTimers();
      }
    });

    it("aborts the search it no longer needs, and ignores an answer that arrives late for old text", async () => {
      const { provider, pending } = manualProvider({ minQueryLength: 1 });
      render(<Harness provider={provider} />);
      await userEvent.type(box(), "l");
      await waitFor(() => expect(pending).toHaveLength(1));
      await userEvent.type(box(), "o");
      await waitFor(() => expect(pending).toHaveLength(2));
      expect(pending[0].signal.aborted).toBe(true);
      expect(pending[1].signal.aborted).toBe(false);
      await act(async () => pending[0].resolve([locationById("pt-lisbon")!]));
      expect(screen.queryByRole("option")).toBeNull();
      expect(screen.getByText("Searching…")).toBeTruthy();
      await act(async () => pending[1].resolve([locationById("gb-eng-london")!]));
      expect((await options()).map((option) => option.textContent)).toEqual([
        "LondonEngland, United Kingdom",
      ]);
    });

    it("ignores a failure that arrives for text the user has already changed", async () => {
      const { provider, pending } = manualProvider({ minQueryLength: 1 });
      render(<Harness provider={provider} />);
      await userEvent.type(box(), "l");
      await waitFor(() => expect(pending).toHaveLength(1));
      await userEvent.type(box(), "o");
      await act(async () => pending[0].reject(new Error("late")));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("shows an error with Retry when the provider is unavailable, never falling back to free text", async () => {
      let down = true;
      const search = vi.fn(async () => {
        if (down) throw new Error("down");
        return [locationById("pt-lisbon")!];
      });
      render(<Harness provider={{ minQueryLength: 1, debounceMs: 0, search }} allowCustom />);
      await userEvent.type(box(), "lisbon");
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(UNAVAILABLE_MESSAGE);
      expect(UNAVAILABLE_MESSAGE).toBe("Location search is unavailable right now. Try again.");
      expect(announce().textContent).toBe(UNAVAILABLE_MESSAGE);
      expect(screen.queryByText(/as typed/)).toBeNull();
      expect(screen.queryByRole("option")).toBeNull();
      expect(screen.queryByText("No places found. Check the spelling.")).toBeNull();
      down = false;
      await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
      expect((await options()).map((option) => option.textContent)).toEqual([
        "LisbonLisbon District, Portugal",
      ]);
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("states from design's #47 review", () => {
    it("asks for more letters while the text is shorter than the provider's minimum, and not for the curated list", async () => {
      const { provider } = manualProvider({ minQueryLength: 2 });
      render(<Harness provider={provider} />);
      expect(screen.queryByText(/Type at least/)).toBeNull();
      await userEvent.type(box(), "l");
      expect(screen.getByText("Type at least 2 letters.")).toBeTruthy();
      await userEvent.type(box(), "o");
      expect(screen.queryByText(/Type at least/)).toBeNull();
      await userEvent.clear(box());
      render(<Harness />);
      await userEvent.type(screen.getAllByRole("combobox")[1], "l");
      expect(screen.queryByText(/Type at least/)).toBeNull();
    });

    it("credits the provider as the last sentence of the helper line, with real links", () => {
      const { provider } = manualProvider({ attribution: SEARCH_ATTRIBUTION });
      render(<Harness provider={provider} />);
      const helper = screen.getByText(/Choose the city, region and country you mean\./);
      expect(helper.textContent).toMatch(
        /Free text alone is never a confirmed location\. Place search by Open-Meteo\.com, location data from GeoNames\.$/,
      );
      const open = within(helper).getByRole("link", { name: "Open-Meteo.com" });
      expect(open.getAttribute("href")).toBe("https://open-meteo.com/");
      expect(open.getAttribute("target")).toBe("_blank");
      expect(open.getAttribute("rel")).toBe("noopener noreferrer");
      expect(within(helper).getByRole("link", { name: "GeoNames" }).getAttribute("href")).toBe(
        "https://www.geonames.org/",
      );
    });

    it("keeps the credit visible when there are no results", async () => {
      const { provider } = manualProvider({ attribution: SEARCH_ATTRIBUTION });
      render(<Harness provider={provider} />);
      expect(screen.getAllByRole("link")).toHaveLength(2);
    });

    it("shows no credit for a provider that has none", () => {
      render(<Harness />);
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByText(/Place search by/)).toBeNull();
    });

    it("tells apart results that share a city with the finer detail, and tolerates a missing region", async () => {
      const twins: SampleLocation[] = [
        {
          id: "a",
          city: "Springfield",
          region: "Illinois",
          country: "United States",
          countryCode: "US",
          label: "x",
          detail: "Sangamon County",
        },
        {
          id: "b",
          city: "Springfield",
          region: "Illinois",
          country: "United States",
          countryCode: "US",
          label: "x",
          detail: "Cook County",
        },
        {
          id: "c",
          city: "Monaco",
          region: "",
          country: "Monaco",
          countryCode: "MC",
          label: "Monaco, Monaco",
        },
      ];
      render(
        <Harness provider={{ minQueryLength: 1, debounceMs: 0, search: async () => twins }} />,
      );
      await userEvent.type(box(), "s");
      expect((await options()).map((option) => option.textContent)).toEqual([
        "SpringfieldIllinois, United States · Sangamon County",
        "SpringfieldIllinois, United States · Cook County",
        "MonacoMonaco",
      ]);
    });

    it("shows a confirmed place without a region cleanly", () => {
      const monaco: SampleLocation = {
        id: "c",
        city: "Monaco",
        region: "",
        country: "Monaco",
        countryCode: "MC",
        label: "Monaco, Monaco",
      };
      render(<Harness initial={monaco} />);
      expect(screen.getByText("Monaco · Monaco")).toBeTruthy();
    });

    it("on an unavailable provider, offers the curated list as an explicit alternative (never free text)", async () => {
      const failing: LocationProvider = {
        minQueryLength: 2,
        debounceMs: 0,
        search: async () => Promise.reject(new Error("down")),
      };
      const onSelectSpy = vi.fn();
      render(
        <Harness
          provider={failing}
          fallbackProvider={curatedLocationProvider}
          onSelectSpy={onSelectSpy}
        />,
      );
      await userEvent.type(box(), "lisbon");
      const alert = await screen.findByRole("alert");
      expect(within(alert).getByRole("button", { name: "Retry" })).toBeTruthy();
      await userEvent.click(
        within(alert).getByRole("button", { name: "Choose from popular destinations" }),
      );
      expect(screen.getByText(/Showing popular destinations/)).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      const [lisbon] = await options();
      expect(lisbon.textContent).toBe("LisbonLisbon District, Portugal");
      await userEvent.click(lisbon);
      expect(onSelectSpy).toHaveBeenCalledWith(locationById("pt-lisbon"));
      expect(screen.queryByText(/Showing popular destinations/)).toBeNull();
    });

    it("does not offer the curated list when none was supplied, and 'Search all places' goes back to the provider", async () => {
      let down = true;
      const flaky: LocationProvider = {
        minQueryLength: 2,
        debounceMs: 0,
        search: async () => {
          if (down) throw new Error("down");
          return [locationById("gb-eng-london")!];
        },
      };
      const first = render(<Harness provider={flaky} />);
      await userEvent.type(box(), "lon");
      await screen.findByRole("alert");
      expect(screen.queryByRole("button", { name: "Choose from popular destinations" })).toBeNull();
      first.unmount();

      render(<Harness provider={flaky} fallbackProvider={curatedLocationProvider} />);
      await userEvent.type(box(), "lon");
      await userEvent.click(
        await screen.findByRole("button", { name: "Choose from popular destinations" }),
      );
      await options();
      down = false;
      await userEvent.click(screen.getByRole("button", { name: "Search all places" }));
      expect(screen.queryByText(/Showing popular destinations/)).toBeNull();
      expect((await options()).map((option) => option.textContent)).toEqual([
        "LondonEngland, United Kingdom",
      ]);
    });

    it("uses the documented wording for no results", () => {
      expect(NO_PLACES_MESSAGE).toBe("No places found. Check the spelling.");
    });
  });

  describe("Custom destination row (flag, off by default)", () => {
    it("is not offered by default", async () => {
      render(<Harness />);
      await userEvent.type(box(), "Grandma's cabin");
      await announced("No places found");
      expect(screen.queryByText(/as typed/)).toBeNull();
    });

    it("when enabled, appears only when nothing matches, tagged Custom, and must be picked explicitly", async () => {
      const onSelectSpy = vi.fn();
      render(<Harness allowCustom onSelectSpy={onSelectSpy} />);
      await userEvent.type(box(), "Grandma's cabin");
      const row = (await options())[0];
      expect(row.textContent).toContain("Use “Grandma's cabin” as typed");
      expect(row.textContent).toContain("Custom");
      expect(onSelectSpy).not.toHaveBeenCalled();
      await userEvent.keyboard("{ArrowDown}{Enter}");
      expect(onSelectSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "custom", city: "Grandma's cabin" }),
      );
      expect(screen.getByRole("status", { name: "" }).textContent).toContain(
        "Grandma's cabin · Custom",
      );
    });

    it("is not offered when the list has matches", async () => {
      render(<Harness allowCustom />);
      await userEvent.type(box(), "paris");
      await options();
      expect(screen.queryByText(/as typed/)).toBeNull();
    });
  });
});
