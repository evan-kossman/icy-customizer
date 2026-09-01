export default function Home() {
  return (
    <main className="mx-auto max-w-xl p-10">
      <h1 className="text-2xl font-bold">Icy Customizer</h1>
      <p className="mt-2 text-muted">
        This service is reached through the Shopify Admin (<code>/admin</code>)
        and the storefront App Proxy (<code>/proxy</code>).
      </p>
    </main>
  );
}
