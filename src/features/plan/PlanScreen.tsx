"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { LAPTOP_QUERY, useMediaQuery } from "@/components/ui/useMediaQuery";
import { buttonClassName } from "@/components/ui/Button";
import { curatedLocationProvider } from "@/domain/location-provider";
import type { TripOrigin } from "@/domain/trip-route";
import {
  classifyTrip,
  draftStops,
  type LifecycleTrip,
  type TripDraft,
} from "@/domain/trip-lifecycle";
import { copyDraft, newDraft } from "@/features/trips/draft";
import { useLocationProvider } from "@/features/trips/LocationProviderContext";
import { useTripsSource } from "@/features/trips/TripsSourceProvider";
import type { SavedListDetail, SavedListSummary } from "@/server/data/service";
import type { Staple } from "@/domain/trip";
import { localToday } from "@/lib/today";
import {
  confirmedStops,
  howSummary,
  laundryEffect,
  laundryLine,
  nightsOf,
  planWeatherRows,
  previewTrip,
  STEP_IDS,
  STEP_TITLES,
  stepBlocker,
  weatherAdds,
  whenSummary,
  whereBlocker,
  whenBlocker,
  whereSummary,
  withChoices,
  type StepId,
} from "./plan-model";
import { PlanPreview, type RenderMap } from "./PlanPreview";
import { renderRouteMapAction } from "./route-map-action";
import { StartList } from "./StartList";
import { HowStep, ReviewStep, WhenStep, WhereStep } from "./steps";
import { usePlanWeather } from "./use-plan-weather";
import styles from "./plan.module.css";

export interface PlanScreenProps {
  /** `?copy=<trip id>`: the same flow, seeded with that trip's route and preferences. */
  copyId?: string;
  allowCustom?: boolean;
  getToday?: () => string;
  /** Draws the live map on the server. Tests inject a stand-in. */
  renderMap?: RenderMap;
}

type Loaded =
  | { phase: "loading" }
  | { phase: "missing" }
  | {
      phase: "ready";
      trips: LifecycleTrip[];
      staples: Staple[];
      home: TripOrigin | null | undefined;
      lists: SavedListSummary[];
    };

// Plan a trip (#390, spec #376 section 1.7). It replaces the old create page: the same drafts, the same server actions and
// the same validation, in five steps (Where, When, How, Starting list, Review) with a live preview. A laptop shows the steps
// as an accordion beside the preview; a phone shows one step per screen. Nothing is saved until "Create trip".
export function PlanScreen({
  copyId,
  allowCustom,
  getToday = localToday,
  renderMap = renderRouteMapAction as unknown as RenderMap,
}: PlanScreenProps) {
  const source = useTripsSource();
  const [loaded, setLoaded] = useState<Loaded>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    // Everything the steps read, once. A read that fails leaves its part out (no home pin, no past trips) rather than
    // blocking the plan; only a copy of a trip that cannot be found stops here.
    Promise.all([
      source.load().catch(() => null),
      source.listStaples().catch(() => [] as Staple[]),
      source.homeCity ? source.homeCity().catch(() => undefined) : Promise.resolve(null),
      source.savedLists ? source.savedLists.list().catch(() => [] as SavedListSummary[]) : [],
    ]).then(([state, staples, home, lists]) => {
      if (cancelled) return;
      const trips = state?.trips ?? [];
      if (copyId && !trips.some((trip) => trip.id === copyId)) {
        setLoaded({ phase: "missing" });
        return;
      }
      setLoaded({ phase: "ready", trips, staples, home, lists });
    });
    return () => {
      cancelled = true;
    };
  }, [source, copyId]);

  if (loaded.phase === "loading") {
    return (
      <section className={styles.screen} aria-busy="true" aria-label="Loading">
        <h1 className={styles.title}>Plan a trip</h1>
      </section>
    );
  }
  if (loaded.phase === "missing") {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>That trip isn’t available</h1>
        <p className={styles.hint}>It may have been removed. You can plan a new trip instead.</p>
        <Link className={buttonClassName()} href="/">
          Back to trips
        </Link>
      </section>
    );
  }
  const from = copyId ? (loaded.trips.find((trip) => trip.id === copyId) ?? null) : null;
  return (
    <PlanBody
      from={from}
      trips={loaded.trips}
      staples={loaded.staples}
      home={loaded.home}
      lists={loaded.lists}
      allowCustom={allowCustom}
      today={getToday()}
      renderMap={renderMap}
    />
  );
}

interface BodyProps {
  from: LifecycleTrip | null;
  trips: LifecycleTrip[];
  staples: Staple[];
  home: TripOrigin | null | undefined;
  lists: SavedListSummary[];
  allowCustom?: boolean;
  today: string;
  renderMap: RenderMap;
}

function PlanBody({ from, trips, staples, home, lists, allowCustom, today, renderMap }: BodyProps) {
  const router = useRouter();
  const source = useTripsSource();
  const provider = useLocationProvider();
  const { track } = useSaveStatus();
  const toast = useToast();
  const laptop = useMediaQuery(LAPTOP_QUERY);
  const reasonId = useId();

  const [draft, setDraft] = useState<TripDraft>(() => ({
    ...(from ? copyDraft(from) : newDraft()),
    // undefined = the account's home city, filled in by the server when the home city could not be read.
    origin: home === undefined ? undefined : (home?.location ?? null),
    travelMode: null,
    name: null,
  }));
  const [step, setStep] = useState<StepId>("where");
  const [completed, setCompleted] = useState<ReadonlySet<StepId>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [saving, setSaving] = useState(false);
  const [laundry, setLaundry] = useState(from?.config.laundry ?? false);
  const [copySource, setCopySource] = useState<LifecycleTrip | null>(from);
  const [listId, setListId] = useState<string | null>(null);
  const [listDetail, setListDetail] = useState<SavedListDetail | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState(false);
  const [useWeather, setUseWeather] = useState(true);
  const headings = useRef<Partial<Record<StepId, HTMLHeadingElement | null>>>({});
  const focusAfter = useRef<StepId | null>(null);
  const listTicket = useRef(0);
  const [firstQuery] = useState(
    from && draftStops(draft).length === 1 && draft.location ? draft.location.city : "",
  );

  const multi = draftStops(draft).length > 1;
  // A copy of a multi-stop trip starts on the source's dates; the person must move the first arrival (every stop shifts).
  const staleCopy = multi && from !== null && draft.start === from.start;
  const index = STEP_IDS.indexOf(step);
  const blocker = stepBlocker(draft, step, staleCopy);
  const pastTrips = useMemo(
    () =>
      trips
        .filter((trip) => classifyTrip(trip, today) === "past")
        .sort((a, b) => b.end.localeCompare(a.end)),
    [trips, today],
  );
  // A copy started from "Copy trip" may be of a trip that is not past yet: it is still the first choice.
  const copyChoices = useMemo(
    () =>
      from && !pastTrips.some((trip) => trip.id === from.id) ? [from, ...pastTrips] : pastTrips,
    [from, pastTrips],
  );

  const finalDraft = useMemo(
    () => withChoices(draft, { copy: copySource, listId, laundry }),
    [draft, copySource, listId, laundry],
  );
  const baseDraft = useMemo(
    () => withChoices(draft, { copy: null, listId: null, laundry }),
    [draft, laundry],
  );
  const ready = whereBlocker(draft) === null && whenBlocker(draft, staleCopy) === null;
  const route = useMemo(() => confirmedStops(draft), [draft]);
  const { weather, setOptIn, refresh } = usePlanWeather(source, route, ready && listId === null);

  const adds = useMemo(
    () =>
      weather.kind === "ready" && listId === null
        ? weatherAdds(finalDraft, weather.stops, staples, today)
        : null,
    [weather, listId, finalDraft, staples, today],
  );
  const accepted = useMemo(() => (useWeather && adds ? adds.accepted : []), [useWeather, adds]);
  const preview = useMemo(
    () => previewTrip({ draft: finalDraft, staples, list: listDetail, accepted, today }),
    [finalDraft, staples, listDetail, accepted, today],
  );
  const staplesOnly = useMemo(
    () => previewTrip({ draft: baseDraft, staples, today }),
    [baseDraft, staples, today],
  );
  const copyOnly = useMemo(
    () =>
      copySource
        ? previewTrip({
            draft: withChoices(draft, { copy: copySource, listId: null, laundry }),
            staples,
            today,
          })
        : null,
    [draft, copySource, laundry, staples, today],
  );
  const effect = useMemo(
    () => laundryEffect(baseDraft, staples, today),
    [baseDraft, staples, today],
  );
  const unit = "settings" in weather ? weather.settings.temperatureUnit : "F";
  const weatherRows = useMemo(
    () => (weather.kind === "ready" ? planWeatherRows(route, weather.stops, unit, today) : []),
    [weather, route, unit, today],
  );
  const weatherNote =
    adds && adds.accepted.length > 0
      ? `${adds.accepted.length} weather ${adds.accepted.length === 1 ? "item" : "items"} ${useWeather ? "added. You can change them while packing." : "suggested. You’ll review them while packing."}`
      : "";

  // Focus follows the step: the new step's heading takes focus after it renders (Continue, Back and Edit alike).
  useEffect(() => {
    if (focusAfter.current !== step) return;
    focusAfter.current = null;
    headings.current[step]?.focus();
  }, [step]);

  function go(next: StepId) {
    focusAfter.current = next;
    setStep(next);
    setAttempted(false);
    setAnnouncement(
      `${STEP_TITLES[next]}, step ${STEP_IDS.indexOf(next) + 1} of ${STEP_IDS.length}`,
    );
  }

  const stillDone = (id: StepId) => completed.has(id) && stepBlocker(draft, id, staleCopy) === null;

  function advance() {
    if (blocker) {
      // aria-disabled keeps Next focusable so its reason can be reached; a press only emphasizes that reason.
      setAttempted(true);
      return;
    }
    if (step === "review") {
      create();
      return;
    }
    const done = new Set(completed).add(step);
    setCompleted(done);
    const following =
      STEP_IDS.slice(index + 1).find(
        (id) => id !== "review" && !(done.has(id) && stepBlocker(draft, id, staleCopy) === null),
      ) ?? "review";
    go(following);
  }

  function create() {
    setSaving(true);
    track(
      async () => {
        // A list trip is just the list: weather is not mixed in here, it arrives through the packing screen's review.
        if (listId) return source.createTrip(finalDraft);
        if (source.weather && weather.kind === "ready" && useWeather) {
          return source.weather.createTripWithReview(finalDraft, accepted);
        }
        const created = await source.createTrip(finalDraft);
        // "Not now" / weather off: the new trip starts with its weather prompt already answered, so the trip screen
        // shows "Weather is off" instead of asking again.
        if (source.weather && weather.kind === "off") {
          await source.skipWeather(created.id).catch(() => undefined);
        }
        return created;
      },
      () => {
        toast.show("Trip saved");
        router.push("/");
      },
    )
      .catch(() => undefined)
      .finally(() => setSaving(false));
  }

  async function chooseList(id: string | null) {
    const ticket = ++listTicket.current;
    setListId(id);
    setListError(false);
    setListDetail(null);
    if (id === null || !source.savedLists) return;
    setListBusy(true);
    try {
      const detail = await source.savedLists.get(id);
      if (ticket === listTicket.current) setListDetail(detail);
    } catch {
      if (ticket === listTicket.current) setListError(true);
    } finally {
      if (ticket === listTicket.current) setListBusy(false);
    }
  }

  async function changeWeatherOptIn(on: boolean) {
    if (!(await setOptIn(on))) toast.show("Couldn’t update weather. Nothing was changed.");
  }

  const body = (id: StepId): ReactNode => {
    switch (id) {
      case "where":
        return (
          <WhereStep
            draft={draft}
            onDraft={setDraft}
            provider={provider ?? curatedLocationProvider}
            allowCustom={allowCustom}
            homeId={home?.location.id ?? null}
            attempted={attempted}
            firstQuery={firstQuery}
          />
        );
      case "when":
        return (
          <WhenStep draft={draft} onDraft={setDraft} attempted={attempted} staleCopy={staleCopy} />
        );
      case "how":
        return <HowStep draft={draft} onDraft={setDraft} attempted={attempted} />;
      case "list":
        return (
          <StartList
            nights={ready ? nightsOf(draft) : null}
            staplesTotal={staplesOnly?.total ?? null}
            laundry={laundry}
            onLaundry={setLaundry}
            laundryText={laundryLine(effect, laundry)}
            weather={weather}
            weatherAdds={adds}
            useWeather={useWeather}
            onUseWeather={setUseWeather}
            onWeatherOptIn={(on) => void changeWeatherOptIn(on)}
            onWeatherRefresh={refresh}
            pastTrips={copyChoices}
            copyId={copySource?.id ?? null}
            copyDelta={copyOnly && staplesOnly ? copyOnly.total - staplesOnly.total : null}
            onCopy={(id) => {
              setCopySource(copyChoices.find((trip) => trip.id === id) ?? null);
              if (id) void chooseList(null);
            }}
            lists={lists}
            listId={listId}
            listTotal={
              listDetail ? listDetail.items.reduce((sum, item) => sum + item.qty, 0) : null
            }
            listBusy={listBusy}
            listError={listError}
            onList={(id) => void chooseList(id)}
            preview={preview}
          />
        );
      case "review":
        return <ReviewStep draft={draft} onDraft={setDraft} preview={preview} />;
    }
  };

  const summaryOf = (id: StepId): string =>
    id === "where"
      ? whereSummary(draft)
      : id === "when"
        ? whenSummary(draft)
        : id === "how"
          ? howSummary(draft)
          : "";

  const footer = (
    <div className={styles.footer}>
      {blocker ? (
        <p id={reasonId} className={attempted ? styles.error : styles.hint}>
          {blocker}
        </p>
      ) : null}
      <div className={styles.footerButtons}>
        {index > 0 ? (
          <button
            type="button"
            className={styles.back}
            disabled={saving}
            onClick={() => go(STEP_IDS[index - 1])}
          >
            <Icon name="chevronLeft" size={14} />
            Back
          </button>
        ) : null}
        <button
          type="button"
          className={styles.next}
          aria-disabled={blocker !== null || saving}
          aria-describedby={blocker ? reasonId : undefined}
          aria-busy={saving || undefined}
          onClick={() => {
            if (!saving) advance();
          }}
        >
          {step === "review" ? (saving ? "Creating…" : "Create trip") : "Next"}
        </button>
      </div>
    </div>
  );

  const announce = (
    <p className="sr-only" role="status" aria-label="Plan progress">
      {announcement}
    </p>
  );

  if (!laptop) {
    return (
      <div className={styles.phone}>
        <header className={styles.phoneTop}>
          <Link className={styles.close} href="/" aria-label="Close and return to trips">
            <Icon name="close" size={20} />
          </Link>
          <h1 className={styles.phoneTitle}>Plan a trip</h1>
          <p className={styles.phoneStep}>{`Step ${index + 1} of ${STEP_IDS.length}`}</p>
        </header>
        <div className={styles.progress} aria-hidden="true">
          {STEP_IDS.map((id, at) => (
            <span key={id} className={styles.segment} data-done={at <= index ? "" : undefined} />
          ))}
        </div>
        <section aria-labelledby={`plan-${step}`} className={styles.phoneStepBody}>
          <h2
            id={`plan-${step}`}
            ref={(node) => {
              headings.current[step] = node;
            }}
            tabIndex={-1}
            className={styles.phoneStepTitle}
          >
            {STEP_TITLES[step]}
          </h2>
          {step === "review" ? (
            <PlanPreview
              variant="phone"
              draft={finalDraft}
              preview={preview}
              weatherRows={[]}
              weatherNote=""
              renderMap={renderMap}
            />
          ) : null}
          {body(step)}
        </section>
        {footer}
        {announce}
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <Link className={styles.crumb} href="/">
        <Icon name="chevronLeft" size={12} />
        Trips
      </Link>
      <h1 className={styles.title}>Plan a trip</h1>
      <div className={styles.layout}>
        <div className={styles.steps}>
          {STEP_IDS.map((id, at) => {
            const current = id === step;
            const done = !current && id !== "review" && stillDone(id);
            return (
              <section
                key={id}
                aria-labelledby={`plan-${id}`}
                aria-current={current ? "step" : undefined}
                className={styles.row}
                data-state={current ? "current" : done ? "done" : "pending"}
              >
                <div className={styles.rowHead}>
                  <span className={styles.num} aria-hidden="true">
                    {done ? <Icon name="check" size={16} /> : at + 1}
                  </span>
                  <h2
                    id={`plan-${id}`}
                    ref={(node) => {
                      headings.current[id] = node;
                    }}
                    tabIndex={-1}
                    className={styles.rowTitle}
                  >
                    {STEP_TITLES[id]}
                  </h2>
                  {done ? (
                    <span className={styles.rowSummary}>
                      {summaryOf(id)}
                      {summaryOf(id) ? " · " : null}
                      <button
                        type="button"
                        className={styles.edit}
                        aria-label={`Edit ${STEP_TITLES[id]}`}
                        onClick={() => go(id)}
                      >
                        Edit
                      </button>
                    </span>
                  ) : null}
                </div>
                {current ? (
                  <div className={styles.rowBody}>
                    {body(id)}
                    {footer}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
        <PlanPreview
          variant="laptop"
          draft={finalDraft}
          preview={preview}
          weatherRows={weatherRows}
          weatherNote={weatherNote}
          renderMap={renderMap}
        />
      </div>
      {announce}
    </div>
  );
}
