import type { MetadataRoute } from "next";

/** Everything except the sign-in page needs an account, so search engines have nothing else to index. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: ["/login"], disallow: ["/projects", "/admin", "/invite", "/api", "/auth"] } };
}
