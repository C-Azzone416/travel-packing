"use client";

import { useState } from "react";
import type { Cube } from "@/domain/cubes";
import type { CubeFilter } from "./packing-model";

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
  // The cubes with a quick add or Edit list add still being saved (one entry per write). Edit list / Done stays locked for a
  // cube until its adds settle, so the add row is never remounted (which would reset its pending guard) mid-write (#496).
  const [addPending, setAddPending] = useState<readonly Cube[]>([]);
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
