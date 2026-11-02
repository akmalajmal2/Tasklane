import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deliver } from "@/lib/email";
import type { Notified } from "@/lib/types";

/** Hourly sweep: notifies assignees and managers about in-progress tasks past their due date. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc("flag_overdue");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.rpc("sweep_stale_timers"); // stops clocks whose browser disappeared
  const list = (data ?? []) as Notified[];
  await deliver(list);
  return NextResponse.json({ notified: list.length });
}
