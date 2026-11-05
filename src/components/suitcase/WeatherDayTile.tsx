import { Icon } from "@/components/ui/Icon";
import { WEATHER_RULES } from "@/domain/weather/recommend";
import { cx } from "./cx";
import styles from "./WeatherDayTile.module.css";

export type WeatherIconName = "sun" | "cloud" | "rain";

export interface WeatherDayTileProps {
  /** "forecast" is the Packing tile with an icon; "compact" is the Home tile with no icon. */
  variant?: "forecast" | "compact";
  /** Short day name ("Sun") and day of the month ("15"). */
  day: string;
  date: string;
  /** Which icon the forecast tile draws (the compact tile has none). */
  icon?: WeatherIconName;
  /** Whole degrees; the unit sign is the screen's choice of units, so only the degree mark is drawn. */
  high: number;
  low: number;
  /** Chance of rain, 0 to 1. */
  precipProbability: number;
  /** A rain day. Defaults to a probability at or above the packing rule (WEATHER_RULES.rainProbability). */
  alert?: boolean;
  className?: string;
}

/** Whole percent for a 0..1 probability, clamped (a bad value never prints "NaN%"). */
export function precipPercent(probability: number): number {
  if (!Number.isFinite(probability)) return 0;
  return Math.round(Math.min(1, Math.max(0, probability)) * 100);
}

// A day of weather (spec part 2 section 6). A rain day is outlined and filled (forecast) or tinted (compact), and it
// also says so in words: the rain icon and "rain" in the compact label, plus a spoken "rain day", so colour is never the
// only signal.
export function WeatherDayTile({
  variant = "forecast",
  day,
  date,
  icon = "sun",
  high,
  low,
  precipProbability,
  alert,
  className,
}: WeatherDayTileProps) {
  const rainy = alert ?? precipProbability >= WEATHER_RULES.rainProbability;
  const percent = precipPercent(precipProbability);
  const spoken = `${day} ${date}, high ${high}, low ${low}, ${percent}% chance of rain${rainy ? ", rain day" : ""}`;
  const compact = variant === "compact";
  return (
    <div
      role="group"
      aria-label={spoken}
      className={cx(
        styles.tile,
        compact ? styles.compact : styles.forecast,
        rainy && styles.alert,
        className,
      )}
      data-weather-variant={variant}
      data-weather-state={rainy ? "alert" : "normal"}
    >
      <span className={styles.day} aria-hidden="true">
        <span className={styles.dayName}>{day}</span> <span className={styles.dayDate}>{date}</span>
      </span>
      {compact ? null : (
        <Icon
          name={icon}
          size={22}
          className={cx(styles.icon, icon === "sun" && styles.sun, icon === "rain" && styles.rain)}
        />
      )}
      <span className={styles.temps} aria-hidden="true">
        <span className={styles.high}>{high}°</span>
        <span className={styles.slash}>/</span>
        <span className={styles.gap}> </span>
        <span className={styles.low}>{low}°</span>
      </span>
      <span className={styles.precip} aria-hidden="true">
        {compact ? null : <Icon name="umbrella" size={12} />}
        <span>{percent}%</span>
        {compact ? <span className={styles.rainWord}> rain</span> : null}
      </span>
    </div>
  );
}
