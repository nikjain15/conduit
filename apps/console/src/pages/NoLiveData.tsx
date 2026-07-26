/**
 * The honest empty state.
 *
 * Shown wherever a view reads live telemetry (usage, SUQS) and the gateway has
 * no records yet. It never stands in for numbers: it says plainly that there is
 * no measured data and what it takes to populate the view. The offline console
 * (backed by an empty in-memory store) renders this by default rather than
 * inventing spend or latency figures.
 */
export function NoLiveData({ what }: { what: string }) {
  return (
    <div className="card empty-state">
      <h3>No live data yet</h3>
      <p className="sub">
        {what} appears here once a gateway is running with an API key and real traffic has been metered.
        Connect a running conduit-gateway (set VITE_CONDUIT_BASE_URL and VITE_CONDUIT_API_KEY at build
        time) and report decisions to populate this view.
      </p>
    </div>
  );
}
