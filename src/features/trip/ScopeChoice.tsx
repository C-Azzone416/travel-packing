"use client";

import { useId } from "react";
import type { Scope } from "@/domain/trip";

export interface ScopeChoiceProps {
  legend: string;
  destination: string;
  value: Scope;
  onChange: (scope: Scope) => void;
}

// A two-option radio group, not a select (design's #16 gap 6): "This trip only" is the default, and
// "Remember for future trips" changes staples, never an existing trip.
export function ScopeChoice({ legend, destination, value, onChange }: ScopeChoiceProps) {
  const name = useId();
  return (
    <fieldset className="scope-choice">
      <legend>{legend}</legend>
      <div className="choice-stack">
        <label className="choice">
          <input
            type="radio"
            name={name}
            value="this-trip"
            checked={value === "this-trip"}
            onChange={() => onChange("this-trip")}
          />
          <span>
            <strong>This trip only</strong>
            <small>Update {destination} only.</small>
          </span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name={name}
            value="remember"
            checked={value === "remember"}
            onChange={() => onChange("remember")}
          />
          <span>
            <strong>Remember for future trips</strong>
            <small>Save to My staples without changing existing trips.</small>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
