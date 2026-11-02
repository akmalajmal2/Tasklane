import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MembersView } from "@/components/project/MembersView";
import { canManageProject } from "@/lib/workflow";

export default async function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: m }, { data: p }] = await Promise.all([
    supabase.from("project_members").select("role").eq("project_id", id).eq("user_id", user!.id).maybeSingle(),
    supabase.from("profiles").select("is_admin").eq("id", user!.id).single(),
  ]);
  // The workload view is for managers (and workspace admins) only.
  if (!canManageProject(!!p?.is_admin, m?.role ?? null)) redirect(`/projects/${id}`);
  return <MembersView />;
}
