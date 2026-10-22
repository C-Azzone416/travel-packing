"use client";

import { useId } from "react";
import {
  isValidChoice,
  resolverOptions,
  resolverStatus,
  type DuplicateChoice,
  type DuplicateChoices,
  type DuplicateGroupInput,
} from "./duplicates";

export interface DuplicateResolverProps {
  groups: readonly DuplicateGroupInput[];
  choices: DuplicateChoices;
  onChoose: (key: string, choice: DuplicateChoice) => void;
  /**
   * The id of the polite status line ("Choose one for each duplicate (2 left)"). The dialog's primary button points its
   * aria-describedby here while it is disabled. Leave unset to have one generated.
   */
  statusId?: string;
}

const sameChoice = (a: DuplicateChoice | undefined, b: DuplicateChoice): boolean =>
  a !== undefined &&
  (a.kind === "all" ? b.kind === "all" : b.kind === "only" && a.rowId === b.rowId);

/**
 * One fieldset per duplicate group, three or more native radios each, and nothing preselected (#140 spec §0, #168).
 * The person picks which row to keep, or keeps all; quantities are never combined. Native radios give the arrow keys,
 * Space and focus for free, each option is a 56px card, and a polite status line counts the groups still open.
 */
export function DuplicateResolver({ groups, choices, onChoose, statusId }: DuplicateResolverProps) {
  const generated = useId();
  const status = statusId ?? `${generated}-status`;
  return (
    <div className="duplicate-resolver">
      {groups.map((group, index) => {
        const first = group.rows[0];
        const options = resolverOptions(group);
        const chosen = isValidChoice(group, choices[group.key]) ? choices[group.key] : undefined;
        return (
          <fieldset key={group.key} className="resolver-group">
            <legend>
              <strong>{first.name}</strong> · {first.category}
            </legend>
            {options.map((option) => {
              const key = option.choice.kind === "all" ? "all" : option.choice.rowId;
              const checked = sameChoice(chosen, option.choice);
              return (
                <label key={key} className="resolver-option">
                  <input
                    type="radio"
                    name={`${status}-group-${index}`}
                    checked={checked}
                    onChange={() => onChoose(group.key, option.choice)}
                  />
                  <span className="resolver-copy">
                    <strong>{option.title}</strong>
                    {option.detail ? <> {option.detail}</> : null}
                  </span>
                  <span className="resolver-check" aria-hidden="true">
                    ✓
                  </span>
                </label>
              );
            })}
          </fieldset>
        );
      })}
      <p id={status} className="resolver-status" role="status" aria-live="polite">
        {resolverStatus(groups, choices)}
      </p>
    </div>
  );
}
