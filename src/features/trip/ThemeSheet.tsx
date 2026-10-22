"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import type { ThemeId } from "@/domain/themes";
import { ThemePicker } from "@/features/trips/ThemePicker";

export interface ThemeSheetProps {
  current: ThemeId;
  saving: boolean;
  /** The last save did not go through. The sheet stays open, and Save tries again. */
  failed?: boolean;
  onClose: () => void;
  onSave: (theme: ThemeId) => void;
}

// Change a trip's picture (#48). Cancel discards. The header art changes only after the source confirms, so a failed
// save leaves this sheet open and the old picture in place. Later (#49) this sheet gains Themes and Search tabs.
export function ThemeSheet({ current, saving, failed = false, onClose, onSave }: ThemeSheetProps) {
  const [choice, setChoice] = useState<ThemeId>(current);
  return (
    <ModalSheet
      open
      title="Change theme"
      description="This changes the picture on the trip's card and header."
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() => (choice === current ? onClose() : onSave(choice))}
          >
            Save theme
          </Button>
        </>
      }
    >
      <ThemePicker value={choice} onChange={setChoice} help="Pick a picture for this trip." />
      {failed ? (
        <p className="field-error" role="alert">
          Couldn’t save the theme. Nothing changed. Press Save theme to try again.
        </p>
      ) : null}
    </ModalSheet>
  );
}
