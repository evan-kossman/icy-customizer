#!/usr/bin/env tsx
/**
 * Prints what the Riverr API offers for our account (no secrets printed):
 * every query/mutation with its arguments, plus the input types we need.
 *   npx tsx scripts/riverr-discover.ts > riverr-schema.txt
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const KEY = process.env.RIVERR_API_KEY;
if (!KEY) { console.error("Add RIVERR_API_KEY to .env.local first."); process.exit(1); }

async function gql(query: string, variables?: object) {
  const res = await fetch("https://api.riverr.app/graphql", {
    method: "POST",
    headers: { "x-uid": KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const TYPE = `name kind ofType { name kind ofType { name kind ofType { name kind } } }`;
const show = (t: any): string =>
  !t ? "?" : t.kind === "NON_NULL" ? `${show(t.ofType)}!` : t.kind === "LIST" ? `[${show(t.ofType)}]` : t.name;

(async () => {
  const intro = await gql(`{ __schema {
    queryType { fields { name args { name type { ${TYPE} } } type { ${TYPE} } } }
    mutationType { fields { name args { name type { ${TYPE} } } type { ${TYPE} } } }
  } }`);
  if (intro.errors) { console.log("Introspection error:", JSON.stringify(intro.errors)); }
  const s = intro.data?.__schema;
  for (const [label, t] of [["QUERIES", s?.queryType], ["MUTATIONS", s?.mutationType]] as const) {
    console.log(`\n=== ${label} ===`);
    for (const f of t?.fields ?? [])
      console.log(`${f.name}(${f.args.map((a: any) => `${a.name}: ${show(a.type)}`).join(", ")}): ${show(f.type)}`);
  }
  for (const name of ["OrderCreateFromGtinInput", "GtinOrderItemInput", "AddressInput", "OrderImageInput", "ShippingOptionsInput"]) {
    const t = await gql(`{ __type(name: "${name}") { inputFields { name type { ${TYPE} } } } }`);
    console.log(`\n=== ${name} ===`);
    for (const f of t.data?.__type?.inputFields ?? []) console.log(`  ${f.name}: ${show(f.type)}`);
  }
})();
