import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

interface Props {
  searchParams: Promise<{ shop?: string; host?: string }>;
}

export default async function AdminPage({ searchParams }: Props) {
  const { shop } = await searchParams;

  if (!shop) redirect("/");

  const [installed] = await db
    .select({ id: schema.shops.id, domain: schema.shops.domain })
    .from(schema.shops)
    .where(eq(schema.shops.domain, shop))
    .limit(1);

  return (
    <main className="mx-auto max-w-xl p-10">
      <h1 className="text-2xl font-bold">Icy Customizer — Admin</h1>
      {installed ? (
        <p className="mt-4 text-green-600 font-medium">
          ✓ App installed for {installed.domain}
        </p>
      ) : (
        <p className="mt-4 text-red-500">Shop not found in database.</p>
      )}
      <p className="mt-4 text-sm text-muted">
        The customer-facing customizer is available at the storefront via the App Proxy.
      </p>
    </main>
  );
}
