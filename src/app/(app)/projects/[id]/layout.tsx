import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectProvider } from "@/store/project-store";
import { ProjectHeader } from "@/components/ProjectHeader";
import { InviteDialog } from "@/components/InviteDialog";
import type { Invite, Member, Project, Task } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Project" };
}

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: project }, membersRes, { data: tasks }, { data: me }] = await Promise.all([
    supabase.from("projects").select("id,key,name,description,created_by").eq("id", id).maybeSingle(),
    supabase.from("project_members").select("*, profile:profiles(id,email,full_name,avatar_url)").eq("project_id", id).order("joined_at"),
    supabase.from("tasks").select("*").eq("project_id", id),
    supabase.from("profiles").select("is_admin").eq("id", user!.id).single(),
  ]);
  let members = membersRes.data;
  if (membersRes.error) {
    // Database not upgraded to v12 yet (no avatar_url column).
    const r = await supabase.from("project_members").select("*, profile:profiles(id,email,full_name)").eq("project_id", id).order("joined_at");
    members = r.data;
  }
  // RLS hides projects you don't belong to, so outsiders get a plain 404.
  if (!project) notFound();

  const list = (members ?? []) as unknown as Member[];
  const role = list.find((m) => m.user_id === user!.id)?.role ?? null;
  const isAdmin = !!me?.is_admin;

  let invites: Invite[] = [];
  if (isAdmin || role === "manager") {
    const { data } = await supabase
      .from("project_invites")
      .select("*")
      .eq("project_id", id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    invites = (data ?? []) as Invite[];
  }

  return (
    <ProjectProvider
      key={id}
      init={{
        project: project as Project,
        me: { id: user!.id, isAdmin, role },
        members: list,
        tasks: (tasks ?? []) as Task[],
        invites,
      }}
    >
      <ProjectHeader />
      <div className="subroute">{children}</div>
      <InviteDialog />
    </ProjectProvider>
  );
}
