import { Suspense } from "react";
import { Board } from "@/components/board/Board";

export default function BoardPage() {
  return (
    <Suspense>
      <Board />
    </Suspense>
  );
}
