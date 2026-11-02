import { NavLink } from "@/components/NavLink";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { FlashToast } from "@/components/FlashToast";
import { NewProject } from "@/components/NewProject";
import { InviteList } from "@/components/InviteActions";
import type { ProjectRole } from "@/lib/types";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ pw?: string }> }) {
  const { pw } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: projects }, { data: mine }] = await Promise.all([
    supabase.from("projects").select("id,key,name,description,project_members(count)").order("name"),
    supabase.from("project_members").select("project_id,role").eq("user_id", user!.id),
  ]);
  const roles = new Map((mine ?? []).map((m) => [m.project_id as string, m.role as ProjectRole]));

  return (
    <main className="page">
      <div className="page-head">
        <h1>Projects</h1>
        <NewProject />
      </div>

      {pw && <FlashToast text="Password updated" />}
      <InviteList />

      {!projects?.length ? (
        <p className="empty" style={{ background: "var(--surface)", border: "1px dashed var(--line-strong)", borderRadius: 10 }}>
          No projects yet. Create one (you become its manager), or accept an invitation when a manager sends one.
        </p>
      ) : (
        <div className="cards">
          {projects.map((p) => {
            const count = (p.project_members as unknown as { count: number }[])[0]?.count ?? 0;
            const role = roles.get(p.id);
            return (
              <NavLink key={p.id} href={`/projects/${p.id}`} className="proj-card">
                <span className="key">{p.key}</span>
                <h2 style={{ fontSize: 16, fontWeight: 650 }}>{p.name}</h2>
                <p>{p.description || "No description yet."}</p>
                <div className="card-meta">
                  <span>{count} {count === 1 ? "member" : "members"}</span>
                  <span className="chip grow" data-tone={role === "manager" ? "brand" : undefined}>
                    {role ?? "admin"}
                  </span>
                </div>
              </NavLink>
            );
          })}
        </div>
      )}
    </main>
  );
}
