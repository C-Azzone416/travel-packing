"use client";

import Link from "next/link";
import type { Ref } from "react";
import { buttonClassName } from "@/components/ui/Button";
import { LuggageTag, Suitcase } from "@/components/suitcase";
import { StickerTeaser } from "@/features/stamps/StampsScreen";
import type { PastTripView } from "@/features/stamps/stamps-view";
import type { NoTripModel } from "./home-view";
import styles from "./HomeEmpty.module.css";

export interface HomeEmptyProps {
  model: NoTripModel;
  /** Laptop (>= 1024px) or phone: the two layouts differ in structure, not just size. */
  laptop: boolean;
  /** True once the account is known to have no home city; unknown (still loading, or a source without one) shows no nudge. */
  homeCityUnset: boolean;
  /** First run only: archived or removed trips exist, so Past & archive (restore, undo remove) stays reachable. Returning always has it. */
  hasHistory: boolean;
  onOpenArchive: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}

/** The five cubes of a new account's bag, drawn empty: dashed, no count, no bar (spec #393 part 1 section 2.1 A). */
const EMPTY_CUBES = ["Clothing", "Toiletries", "Tech", "Documents", "Misc"] as const;

function HeroCard({ model }: { model: NoTripModel }) {
  return (
    <section className={styles.hero} aria-labelledby="home-empty-title">
      <p className={styles.eyebrow}>{model.eyebrow}</p>
      <h2 id="home-empty-title" className={styles.title}>
        {model.title}
      </h2>
      <p className={styles.lede}>{model.lede}</p>
      <div className={styles.buttons}>
        <Link className={`${buttonClassName()} ${styles.plan}`} href="/trips/new">
          + Plan a trip
        </Link>
        <Link className={styles.staples} href="/staples">
          Set up your Staples
        </Link>
      </div>
    </section>
  );
}

function Nudge() {
  return (
    <Link className={styles.dashed} href="/settings" data-nudge>
      Set your home city so trips know where you&rsquo;re leaving from ›
    </Link>
  );
}

function EmptySuitcase() {
  return (
    <Suitcase aria-hidden="true" data-empty-suitcase>
      <div className={styles.bagHead}>
        <p className={styles.eyebrow}>YOUR SUITCASE</p>
        <p className={styles.bagCount}>0 of 0</p>
      </div>
      <ul className={styles.cubes}>
        {EMPTY_CUBES.map((name) => (
          <li key={name} className={styles.cube}>
            <span className={styles.cubeName}>{name}</span>
            <span className={styles.cubeCount}>-</span>
          </li>
        ))}
      </ul>
    </Suitcase>
  );
}

function RecentRow({ trip }: { trip: PastTripView }) {
  return (
    <li>
      <Link className={styles.recent} href={`/stamps?trip=${encodeURIComponent(trip.id)}`}>
        <LuggageTag variant="mini">
          <span className={styles.recentRow}>
            <span
              className={styles.code}
              data-colour={trip.stickerColour ?? undefined}
              aria-hidden="true"
            >
              {trip.code || "—"}
            </span>
            <span className={styles.recentCopy}>
              <strong>{trip.name}</strong>
              <span>{trip.facts}</span>
            </span>
            <span className={styles.recentPacked}>
              {trip.packed}/{trip.total} packed
            </span>
          </span>
        </LuggageTag>
      </Link>
    </li>
  );
}

/**
 * The Home when no trip is coming up (#409; spec on #393 part 1 section 2.1): a first-run welcome with an empty dashed
 * suitcase, or a returning welcome with the Stamps teaser and the latest trips. It replaces the #387 placeholder.
 */
export function HomeEmpty({
  model,
  laptop,
  homeCityUnset,
  hasHistory,
  onOpenArchive,
  headingRef,
}: HomeEmptyProps) {
  const heading = (
    <h1 ref={headingRef} tabIndex={-1} className="sr-only">
      Trips
    </h1>
  );
  const archive = hasHistory ? (
    <button type="button" className={styles.archive} onClick={onOpenArchive}>
      Past &amp; archive
    </button>
  ) : null;

  if (model.kind === "first") {
    return (
      <div className={styles.page} data-layout={laptop ? "laptop" : "phone"} data-kind="first">
        {heading}
        <div className={styles.column}>
          <HeroCard model={model} />
          {archive}
          {homeCityUnset ? <Nudge /> : null}
          <EmptySuitcase />
          {laptop ? null : (
            <Link className={styles.dashed} href="/stamps">
              Your stamps will collect here ›
            </Link>
          )}
        </div>
      </div>
    );
  }

  const recent = (
    <section aria-labelledby="home-recent-title">
      <div className={styles.recentHead}>
        <h2 id="home-recent-title" className={styles.recentTitle}>
          Recent trips
        </h2>
        {/* Up here, not at the foot of the page: the archive is reachable without scrolling past the toasts and the nav. */}
        <button type="button" className={styles.archive} onClick={onOpenArchive}>
          Past &amp; archive
        </button>
      </div>
      <ul className={styles.recentList}>
        {model.recent.map((trip) => (
          <RecentRow key={trip.id} trip={trip} />
        ))}
      </ul>
      {laptop ? null : (
        <Link className={styles.dashed} href="/stamps">
          All stamps ›
        </Link>
      )}
    </section>
  );

  return (
    <div className={styles.page} data-layout={laptop ? "laptop" : "phone"} data-kind="returning">
      {heading}
      {laptop ? (
        <div className={styles.grid}>
          <div className={styles.left}>
            <HeroCard model={model} />
            {homeCityUnset ? <Nudge /> : null}
            <StickerTeaser
              stickers={model.stickers}
              inked={model.inked}
              filterLabel={model.filterLabel}
              totals={model.totals}
            />
          </div>
          <div className={styles.right}>{recent}</div>
        </div>
      ) : (
        <div className={styles.column}>
          <HeroCard model={model} />
          {homeCityUnset ? <Nudge /> : null}
          {recent}
        </div>
      )}
    </div>
  );
}
