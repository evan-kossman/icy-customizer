#!/usr/bin/env tsx
/** Second pass: type shapes + reference data needed to attach artwork. No secrets printed. */
import { config } from "dotenv";
config({ path: ".env.local" });
const KEY = process.env.RIVERR_API_KEY!;
async function gql(query: string) {
  const r = await fetch("https://api.riverr.app/graphql", {
    method: "POST", headers: { "x-uid": KEY, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
  return r.json();
}
const T = `name kind ofType { name kind ofType { name kind ofType { name kind } } }`;
const show = (t: any): string => !t ? "?" : t.kind === "NON_NULL" ? `${show(t.ofType)}!` : t.kind === "LIST" ? `[${show(t.ofType)}]` : t.name;

(async () => {
  const seen = new Set<string>();
  const queue = ["OrderUpdateInput", "Order", "Placements", "DecorationMethod", "Shop"];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue; seen.add(name);
    const r = await gql(`{ __type(name: "${name}") { kind fields { name type { ${T} } } inputFields { name type { ${T} } } enumValues { name } } }`);
    const t = r.data?.__type; if (!t) continue;
    console.log(`\n=== ${name} (${t.kind}) ===`);
    for (const f of [...(t.fields ?? []), ...(t.inputFields ?? [])]) {
      console.log(`  ${f.name}: ${show(f.type)}`);
      let b = f.type; while (b?.ofType) b = b.ofType;
      if (b && ["OBJECT", "INPUT_OBJECT", "ENUM"].includes(b.kind) && /Order|Item|Image|Placement|Decoration|Update/i.test(b.name)) queue.push(b.name);
    }
    for (const e of t.enumValues ?? []) console.log(`  = ${e.name}`);
  }
  const run = async (label: string, q: string) => { console.log(`\n=== ${label} ===`); console.log(JSON.stringify(await gql(q), null, 1).slice(0, 4000)); };
  await run("shops", `{ getAllShops { id name } }`);
  await run("placements", `{ getPlacements { __typename } }`);
  await run("decoration methods", `{ getDecorationMethods { __typename } }`);
})();
