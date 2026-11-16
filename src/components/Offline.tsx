/** Full-screen offline state, before we know who the user is. */
export function Offline() {
  return (
    <main className="center">
      <p className="logo">🍲 Kuchsistent</p>
      <h1>Bez připojení</h1>
      <p className="muted">Aplikace se načte, jakmile bude signál.</p>
    </main>
  );
}

/** A data screen that can't load offline. */
export function OfflineNotice() {
  return (
    <section className="page">
      <h1>Bez připojení</h1>
      <p className="muted">Data se načtou, jakmile bude signál.</p>
    </section>
  );
}
