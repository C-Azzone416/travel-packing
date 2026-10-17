"use client";

import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import type { WeatherState } from "@/domain/trip";

// Weather is simulated until real forecasts ship (#50): every state says so, and nothing changes the list
// without the person accepting.
export const SIMULATED_COPY = "This is a simulated suggestion, not a real forecast.";

export interface WeatherCardProps {
  weather: WeatherState;
  onReview: () => void;
  onReviewAgain: () => void;
}

export function WeatherCard({ weather, onReview, onReviewAgain }: WeatherCardProps) {
  if (weather.status === "accepted") {
    return (
      <div className="weather-card">
        <span className="tag">Simulated · accepted</span>
        <h3>Weather suggestion added</h3>
        <p className="tiny muted">{weather.suggestion} was added after review.</p>
      </div>
    );
  }
  if (weather.status === "skipped") {
    return (
      <div className="weather-card">
        <span className="tag">Simulated · skipped</span>
        <h3>No weather changes applied</h3>
        <Button variant="ghost" small onClick={onReviewAgain}>
          Review again
        </Button>
      </div>
    );
  }
  return (
    <div className="weather-card">
      <span className="tag">Simulated · {weather.label}</span>
      <h3>Rain looks more likely</h3>
      <p className="tiny muted">
        {SIMULATED_COPY} Review it first: your list will not change unless you accept.
      </p>
      <Button variant="secondary" small onClick={onReview}>
        Review suggestion
      </Button>
    </div>
  );
}

export interface WeatherDialogProps {
  suggestion: string;
  /** The trip is Ready right now, so accepting will turn Ready off. */
  ready: boolean;
  saving: boolean;
  onClose: () => void;
  onAccept: () => void;
  onSkip: () => void;
}

export function WeatherDialog({
  suggestion,
  ready,
  saving,
  onClose,
  onAccept,
  onSkip,
}: WeatherDialogProps) {
  return (
    <ModalSheet
      open
      title={`Add a ${suggestion.toLowerCase()}?`}
      description={SIMULATED_COPY}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" disabled={saving} onClick={onSkip}>
            Skip
          </Button>
          <Button disabled={saving} onClick={onAccept}>
            Accept umbrella
          </Button>
        </>
      }
    >
      <p>Your list will not change unless you accept.</p>
      {ready ? (
        <p className="callout">Accepting changes your list, so Ready will turn off.</p>
      ) : null}
    </ModalSheet>
  );
}
