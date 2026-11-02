"use client";

import { createContext, useContext } from "react";
import type { Task } from "@/lib/types";
import type { Move, MoveCtx } from "@/lib/workflow";

export interface BoardActions {
  ctx: MoveCtx;
  canCreate: boolean;
  open: (id: string) => void;
  requestMove: (task: Task, move: Move, pos?: number) => void;
  edit: (task: Task) => void;
  review: (task: Task) => void;
  remove: (task: Task) => void;
}

export const BoardCtx = createContext<BoardActions | null>(null);

export function useBoard() {
  const c = useContext(BoardCtx);
  if (!c) throw new Error("useBoard must be used inside Board");
  return c;
}
