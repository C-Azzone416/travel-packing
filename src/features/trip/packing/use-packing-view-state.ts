"use client";

import { useState } from "react";
import type { Cube } from "@/domain/cubes";
import type { CubeFilter } from "./packing-model";

/** One add attempt in flight: its own id, the cube, and the cube plus normalised name it is saving. */
export interface PendingAdd {
  id: number;
  cube: Cube;
  key: string;
}

/**
 * What the Packing screen remembers about how it is being looked at: the open cube, each cube's filter, Edit list, and an All in
 * that is still saving. It lives in the screen, not in a layout, so crossing 768px (a rotation, a split view) swaps the layout
 * without losing the cube, and an All in that is still saving cannot be sent again from the other layout (#414).
 */
export function usePackingViewState(openCube: Cube | undefined) {
  // Until the person picks a cube the screen's own choice (?cube=, the first unpacked item) stands, even if it arrives late.
  const [picked, setChosen] = useState<Cube | undefined>(undefined);
  const chosen = picked ?? openCube;
  const [filters, setFilters] = useState<Partial<Record<Cube, CubeFilter>>>({});
  const [editing, setEditing] = useState(false);
  const [packing, setPacking] = useState(false);
  // The adds still being saved, one entry per send ATTEMPT (a Retry is its own attempt), kept at the send layer so they survive
  // the add row and its panel remounting. Edit list / Done is locked for a cube until its attempts settle (#496).
  const [addPending, setAddPending] = useState<readonly PendingAdd[]>([]);
  return {
    chosen,
    setChosen,
    filters,
    setFilters,
    editing,
    setEditing,
    packing,
    setPacking,
    addPending,
    setAddPending,
  };
}

export type PackingViewState = ReturnType<typeof usePackingViewState>;
