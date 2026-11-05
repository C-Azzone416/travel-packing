// Rendered proof for the Suitcase primitives (#381). NOT part of the app: nothing under src/ imports this, no route serves
// it, and the build ignores it. tools/suitcase-gallery/shots.ts bundles it with Vite, opens it in Chromium and takes the
// screenshots. Every primitive and state is drawn once; the scheme comes from data-scheme on <html>, the layout from the
// viewport width.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import "@/app/scheme-tokens.css";
import "@/app/type-scale.css";
import "@/app/globals.css";
import "./gallery.css";
import {
  Chip,
  CountdownBadge,
  CubeChip,
  CubeRailItem,
  CubeTile,
  LaundryMarker,
  LuggageTag,
  MorningOfMarker,
  NavPill,
  Pill,
  PillGroup,
  PillTabs,
  Stepper,
  Suitcase,
  WeatherDayTile,
} from "@/components/suitcase";

const HOME_TABS = [
  { id: "pack", label: "Pack", sub: "41/60" },
  { id: "weather", label: "Weather", sub: "ALERT", alert: true },
  { id: "future", label: "Future", sub: "2 trips" },
  { id: "stamps", label: "Stamps", sub: "6" },
];

const DAYS = [
  { day: "Thu", date: "19", icon: "rain", high: 63, low: 48, p: 0.8 },
  { day: "Fri", date: "20", icon: "rain", high: 61, low: 47, p: 0.9 },
  { day: "Sat", date: "21", icon: "rain", high: 60, low: 46, p: 0.7 },
  { day: "Sun", date: "22", icon: "cloud", high: 68, low: 55, p: 0.3 },
  { day: "Mon", date: "23", icon: "sun", high: 70, low: 54, p: 0.1 },
] as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section data-section={id} className="g-section">
      <p className="g-eyebrow">{title}</p>
      {children}
    </section>
  );
}

function Gallery() {
  const [tab, setTab] = useState("pack");
  const [filter, setFilter] = useState("all");
  const [cube, setCube] = useState("clothing");
  const [qty, setQty] = useState(5);
  return (
    <main className="g-page">
      <h1 className="g-eyebrow">Suitcase primitives (#381)</h1>
      <Section id="suitcase-home" title="Suitcase (paper) with cube tiles, tag, tabs">
        <Suitcase interior="paper">
          <PillTabs
            label="Home sections"
            items={HOME_TABS}
            value={tab}
            onChange={setTab}
            idBase="g"
          />
          {HOME_TABS.map((item) => (
            <div
              key={item.id}
              role="tabpanel"
              id={`g-panel-${item.id}`}
              aria-labelledby={`g-tab-${item.id}`}
              hidden={item.id !== tab}
              className="g-eyebrow"
            >
              {item.label} panel
            </div>
          ))}
          <div className="g-gap" />
          <LuggageTag>
            <p className="g-eyebrow g-chip-eyebrow">NEXT TRIP · Sat 14 – Tue 24 Mar</p>
            <div className="g-hero">
              <span className="g-hero-name">Lisbon</span>
              <span className="g-hero-sub">&amp; Porto</span>
            </div>
            <div className="g-row">
              <CountdownBadge days={12} />
              <span className="g-lede">flight · 10 nights · 2 cities</span>
            </div>
          </LuggageTag>
          <div className="g-gap" />
          <div className="g-cubes">
            <CubeTile name="Clothing" packed={9} total={14} />
            <CubeTile name="Toiletries" packed={2} total={6} note="under 3.4 oz" morningOf />
            <CubeTile name="Tech" packed={3} total={5} note="passport ✓" />
            <CubeTile name="Rain gear" packed={1} total={4} note="Rain · 2 added" alert />
            <CubeTile name="Misc" packed={5} total={5} />
            <CubeTile name="Documents" packed={0} total={3} href="/x" />
          </div>
          <div className="g-gap" />
          <div className="g-days">
            {DAYS.map((d) => (
              <WeatherDayTile
                key={d.day}
                variant="compact"
                day={d.day}
                date={d.date}
                high={d.high}
                low={d.low}
                precipProbability={d.p}
              />
            ))}
          </div>
          <div className="g-gap" />
          <LuggageTag variant="mini">
            <span className="g-mini-date">02 APR</span>
            <span className="g-mini-name">Denver</span>
          </LuggageTag>
        </Suitcase>
      </Section>

      <Section id="suitcase-dark" title="Suitcase (dark): rail, chips, filter pills">
        <Suitcase interior="dark">
          <div className="g-dark">
            <div className="g-rail">
              <CubeRailItem
                name="Clothing"
                packed={9}
                total={14}
                selected={cube === "clothing"}
                onSelect={() => setCube("clothing")}
              />
              <CubeRailItem
                name="Toiletries"
                packed={2}
                total={6}
                note="under 3.4 oz"
                morningOf
                selected={cube === "toiletries"}
                onSelect={() => setCube("toiletries")}
              />
              <CubeRailItem
                name="Rain gear"
                packed={1}
                total={4}
                note="added for Porto rain"
                alert
                selected={cube === "rain"}
                onSelect={() => setCube("rain")}
              />
              <CubeRailItem name="Tech" packed={3} total={3} />
            </div>
            <div className="g-panel">
              <PillGroup label="Filter">
                <Pill active={filter === "all"} count={14} onClick={() => setFilter("all")}>
                  All
                </Pill>
                <Pill active={filter === "to"} count={5} onClick={() => setFilter("to")}>
                  To pack
                </Pill>
                <Pill active={filter === "packed"} count={9} onClick={() => setFilter("packed")}>
                  Packed
                </Pill>
                <Pill icon="pencil" iconOnlyOnPhone>
                  Edit list
                </Pill>
              </PillGroup>
            </div>
          </div>
        </Suitcase>
      </Section>

      <Section id="cube-chips" title="Cube chips (phone Packing bar)">
        <div className="g-scroll" data-scroll-container>
          <CubeChip name="Clothing" packed={9} total={14} selected />
          <CubeChip name="Toiletries" packed={6} total={9} morningOf />
          <CubeChip name="Tech" packed={3} total={5} />
        </div>
      </Section>

      <Section id="pills" title="Pills: filter, stamps, nav, Home tabs">
        <PillGroup label="Stamps filter">
          <Pill size="stamps" active>
            Last 12 months
          </Pill>
          <Pill size="stamps">2026</Pill>
          <Pill size="stamps">All time</Pill>
        </PillGroup>
        <div className="g-gap" />
        <div className="g-nav">
          <NavPill href="/" active>
            Trips
          </NavPill>
          <NavPill href="/staples">Staples</NavPill>
          <NavPill href="/stamps">Stamps</NavPill>
          <NavPill href="/settings">Settings</NavPill>
        </div>
        <div className="g-gap" />
        <PillTabs
          label="Home sections (second tab active)"
          items={HOME_TABS}
          value="weather"
          onChange={() => undefined}
          idBase="g2"
        />
        {HOME_TABS.map((item) => (
          <div
            key={item.id}
            role="tabpanel"
            id={`g2-panel-${item.id}`}
            aria-labelledby={`g2-tab-${item.id}`}
            hidden={item.id !== "weather"}
            className="g-eyebrow"
          >
            {item.label} panel
          </div>
        ))}
      </Section>

      <Section id="staples" title="Chip, stepper, markers">
        <div className="g-row g-wrap">
          <Chip>per trip</Chip>
          <Chip tone="scaled">per day</Chip>
          <Chip tone="scaled">per night</Chip>
          <LaundryMarker variant="staples" />
        </div>
        <div className="g-gap" />
        <PillGroup label="Cadence">
          <Chip size="editor">per trip</Chip>
          <Chip size="editor" selected>
            per day
          </Chip>
          <Chip size="editor">per night</Chip>
        </PillGroup>
        <div className="g-gap" />
        <div className="g-row g-wrap">
          <Stepper value={qty} onChange={setQty} />
          <Stepper value={qty} onChange={setQty} size="sheet" />
          <Stepper value={1} onChange={() => undefined} size="sheet" />
        </div>
        <div className="g-gap" />
        <p className="g-item">
          Tees × 6 <LaundryMarker /> <MorningOfMarker />
        </p>
        <p className="g-item g-on-dark">
          Socks × 3 <LaundryMarker onDark /> <MorningOfMarker />
        </p>
      </Section>

      <Section id="weather" title="Weather day tiles: forecast and compact, normal and alert">
        <div className="g-days g-days-forecast">
          {DAYS.map((d) => (
            <WeatherDayTile
              key={d.day}
              day={d.day}
              date={d.date}
              icon={d.icon}
              high={d.high}
              low={d.low}
              precipProbability={d.p}
            />
          ))}
        </div>
        <div className="g-gap" />
        <div className="g-days">
          {DAYS.map((d) => (
            <WeatherDayTile
              key={d.day}
              variant="compact"
              day={d.day}
              date={d.date}
              high={d.high}
              low={d.low}
              precipProbability={d.p}
            />
          ))}
        </div>
      </Section>
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Gallery />);
