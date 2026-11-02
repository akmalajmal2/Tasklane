import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Escape hatch for a signed-in session that has no usable profile: clear it so /login can show. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${request.nextUrl.origin}/login?error=profile`);
}
