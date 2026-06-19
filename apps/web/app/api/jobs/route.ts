import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const querySchema = z.object({
  q: z.string().optional(),
  location: z.string().optional(),
  remoteType: z.enum(["remote", "hybrid", "onsite"]).optional(),
  jobType: z.string().optional(),
  minSalary: z.coerce.number().int().nonnegative().optional(),
  maxSalary: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdminClient();
  const { q, location, remoteType, jobType, minSalary, maxSalary, limit, offset } = parsed.data;

  let query = supabase
    .from("jobs")
    .select(
      "id,title,company_name,location,remote_type,employment_type,salary_min,salary_max,currency,source,source_url,tags,posted_at",
      {
        count: "exact",
      },
    )
    .eq("is_active", true)
    .order("posted_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    query = query.or(`title.ilike.%${q}%,company_name.ilike.%${q}%,description.ilike.%${q}%`);
  }

  if (location) {
    query = query.ilike("location", `%${location}%`);
  }

  if (remoteType) {
    query = query.eq("remote_type", remoteType);
  }

  if (jobType) {
    query = query.eq("employment_type", jobType);
  }

  if (minSalary) {
    query = query.gte("salary_max", minSalary);
  }

  if (maxSalary) {
    query = query.lte("salary_min", maxSalary);
  }

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    jobs: data ?? [],
    pagination: {
      count: count ?? 0,
      limit,
      offset,
    },
  });
}
