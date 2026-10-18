"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { Switch } from "@/components/ui/Switch";
import type { TripConfig } from "@/domain/trip";
import {
  clampOccasions,
  MAX_OCCASIONS,
  MIN_OCCASIONS,
  returnOutfitHelp,
} from "@/features/trips/draft";

export interface PreferencesFormProps {
  config: TripConfig;
  saving: boolean;
  onClose: () => void;
  onSave: (config: TripConfig) => void;
}

// This trip's planning preferences. Saving recalculates suggestions (edits and packed counts on unchanged items
// survive), always revokes Ready, and revokes bag placement if the Bathroom contents change.
export function PreferencesForm({ config, saving, onClose, onSave }: PreferencesFormProps) {
  const [draft, setDraft] = useState(config);
  const patch = (next: Partial<TripConfig>) => setDraft((current) => ({ ...current, ...next }));

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(draft);
  }

  return (
    <ModalSheet
      open
      showClose
      title="Edit packing preferences"
      description="This trip only."
      onClose={onClose}
    >
      <form className="form-grid" onSubmit={submit}>
        <Switch
          label="Laundry access"
          checked={draft.laundry}
          onChange={(laundry) => patch({ laundry })}
        />
        <Switch
          label="One spare underwear + socks"
          checked={draft.spare}
          onChange={(spare) => patch({ spare })}
        />
        <Switch
          label="Nice outfits"
          description="Includes optional Dress shoes, Makeup, and Dress-specific undergarments."
          checked={draft.niceAttire}
          onChange={(niceAttire) => patch({ niceAttire })}
        />
        <div className="two-col occasion-row">
          <label className="field">
            Occasions
            <input
              type="number"
              min={MIN_OCCASIONS}
              max={MAX_OCCASIONS}
              value={draft.occasionCount}
              disabled={!draft.niceAttire}
              onChange={(event) =>
                patch({ occasionCount: clampOccasions(event.target.valueAsNumber) })
              }
            />
          </label>
          <Switch
            label="Reuse one nice look"
            checked={draft.reuseNice}
            disabled={!draft.niceAttire}
            onChange={(reuseNice) => patch({ reuseNice })}
          />
        </div>
        <Switch
          label="Dedicated return travel outfit"
          description={returnOutfitHelp(draft.returnOutfit)}
          checked={draft.returnOutfit}
          onChange={(returnOutfit) => patch({ returnOutfit })}
        />
        <div className="callout">
          Updating recalculates suggestions while keeping your edits and packed counts for items
          that stay. Changing Bathroom contents resets the bag placement. Ready always turns off.
        </div>
        <Button type="submit" disabled={saving}>
          Update this trip
        </Button>
      </form>
    </ModalSheet>
  );
}
