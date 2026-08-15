import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Status = "nominal" | "watch" | "critical";
type Reading = { label: string; value: string; status: Status; detail: string };
type Report = { agent: string; role: string; status: Status; confidence: number; recommendation: string; evidence: string[]; tradeoff: string };
type CouncilEntry = { id: string; speaker: string; message: string; kind: "director" | "evidence" | "assessment" };
const missionTeam = [
  { name: "NOVA", role: "Power & thermal", focus: "Protects solar, battery, and habitat heat reserves." },
  { name: "AURA", role: "Life support", focus: "Keeps the cabin air safe and the scrubber loop stable." },
  { name: "KEPLER", role: "Weather & navigation", focus: "Forecasts the storm and brings the EVA crew home." },
  { name: "MERCURY", role: "Red-team risk", focus: "Challenges weak assumptions and unsafe trade-offs." }
];
type Mission = {
  missionId: string;
  sol: number;
  minutesToStorm: number;
  phase: string;
  telemetry: Reading[];
  reports: Report[];
  councilLog: CouncilEntry[];
  timeline: { time: string; event: string; kind: string }[];
  pendingCommand?: { id: string; label: string; consequence: string };
};

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Mission control link failed.");
  return response.json() as Promise<T>;
}

function Badge({ status }: { status: Status }) {
  return <span className={"badge " + status}>{status}</span>;
}

function App() {
  const [mission, setMission] = useState<Mission | null>(null);
  const [brief, setBrief] = useState("");
  const [councilLog, setCouncilLog] = useState<CouncilEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showOverview, setShowOverview] = useState(false);
  const [showTeam, setShowTeam] = useState(false);

  const refresh = () => api<Mission>("/api/mission").then(setMission).catch((cause) => setError(cause.message));
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!showOverview && !showTeam) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowOverview(false);
        setShowTeam(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showOverview, showTeam]);

  async function act(name: string, path: string, body?: unknown) {
    setBusy(name);
    setError("");
    try {
      const next = await api<Mission>(path, "POST", body);
      setMission(next);
      if (name === "reset") {
        setBrief("");
        setCouncilLog([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected console fault.");
    } finally {
      setBusy(null);
    }
  }

  async function conveneCouncil() {
    setBusy("council");
    setError("");
    setBrief("");
    setCouncilLog([]);
    try {
      const response = await fetch("/api/mission/convene", { method: "POST", headers: { Accept: "text/event-stream" } });
      if (!response.ok || !response.body) throw new Error("The mission team link could not be opened.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const receive = (packet: string) => {
        const line = packet.split("\n").find((item) => item.startsWith("data: "));
        if (!line) return;
        const event = JSON.parse(line.slice(6)) as { type: string; entry?: CouncilEntry; brief?: string; state?: Mission; message?: string };
        if (event.type === "activity" && event.entry) {
          setCouncilLog((entries) => [...entries, event.entry!]);
        } else if (event.type === "complete" && event.state && typeof event.brief === "string") {
          setBrief(event.brief);
          setMission(event.state);
          setCouncilLog(event.state.councilLog);
        } else if (event.type === "error") {
          throw new Error(event.message ?? "The mission team could not complete its assessment.");
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const packets = buffer.split("\n\n");
        buffer = packets.pop() ?? "";
        packets.forEach(receive);
        if (done) break;
      }
      if (buffer.trim()) receive(buffer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The mission team could not complete its assessment.");
    } finally {
      setBusy(null);
    }
  }

  if (!mission) return <main className="loading">Booting Ares-7 mission console…</main>;
  const pressure = Math.max(0, Math.min(100, (20 - mission.minutesToStorm) * 5));
  const hasCouncilBrief = Boolean(brief);
  const visibleCouncilLog = busy === "council" ? councilLog : mission.councilLog;

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">ARES-7 / MISSION CONTROL</p>
          <h1>APPROACHING MARTIAN DUST STORM</h1>
        </div>
        <div className="header-meta">
          <span>SOL {mission.sol}</span>
          <button className="info-button" onClick={() => setShowOverview(true)} aria-label="Open technical overview" title="How this mission is built">i</button>
          <button className="quiet" onClick={() => void act("reset", "/api/mission/reset")} disabled={Boolean(busy)}>Reset mission</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Mission clock</p>
          <div className="countdown">{String(mission.minutesToStorm).padStart(2, "0")}:00</div>
          <p className="muted">until storm impact</p>
        </div>
        <div className="pressure">
          <div className="pressure-head"><span>OPERATIONAL PRESSURE</span><strong>{pressure}%</strong></div>
          <div className="meter"><i style={{ width: pressure + "%" }} /></div>
          <p className="scenario-summary">A Martian dust storm will reach the habitat in {mission.minutesToStorm} minutes. One crew member is outside while life support and solar power are degraded.</p>
        </div>
        <div className="phase">
          <p className="eyebrow">Run state</p>
          <strong>{mission.phase.replaceAll("_", " ")}</strong>
          <span>Session: {mission.missionId}</span>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      {showOverview && (
        <div className="modal-backdrop" onMouseDown={() => setShowOverview(false)}>
          <section className="technical-overview" role="dialog" aria-modal="true" aria-labelledby="technical-overview-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">Technical overview</p><h2 id="technical-overview-title">How this mission demonstrates OpenAI Agents SDK</h2></div>
              <button className="modal-close" onClick={() => setShowOverview(false)} aria-label="Close technical overview">×</button>
            </div>
            <p className="overview-intro">This screen is a mission simulation. The team’s evidence collection and recommendation are performed by an OpenAI Agents SDK run; mission state and command execution remain application-controlled.</p>
            <div className="overview-grid">
              <article><h3>Manager and specialists</h3><p>The Mission Director is the manager. NOVA, AURA, KEPLER, and MERCURY are specialists exposed with <code>Agent.asTool()</code>, so the Director retains ownership of the final recommendation.</p></article>
              <article><h3>Typed mission tools</h3><p>Each specialist can retrieve telemetry and consult a safety protocol through typed local tools. Those tool calls provide evidence rather than a prewritten answer.</p></article>
              <article><h3>Session memory</h3><p><code>MemorySession</code> carries command context across the team assessment and the follow-up approval step, rather than treating each decision as isolated.</p></article>
              <article><h3>Visible run activity</h3><p>The Mission channel relays nested-run callbacks over a server-sent event stream. It is a curated operational view of evidence requests and specialist submissions, not hidden model reasoning.</p></article>
              <article><h3>Human authorization</h3><p>The authorization card is an application-level safety checkpoint: the Director may recommend a plan, but only the commander can permit the simulated command.</p></article>
              <article><h3>Phoenix tracing and evaluation</h3><p>When Phoenix is configured, OpenInference captures the Director, specialists, model calls, and tools as trace spans. This project also includes focused local checks for assessment, authorization, and safe mission progression.</p></article>
            </div>
            <p className="overview-footnote">For the platform concepts behind this design, see the <a href="https://developers.openai.com/api/docs/guides/agents" target="_blank" rel="noreferrer">OpenAI Agents SDK guide</a>.</p>
          </section>
        </div>
      )}

      {showTeam && (
        <div className="modal-backdrop" onMouseDown={() => setShowTeam(false)}>
          <section className="technical-overview team-overview" role="dialog" aria-modal="true" aria-labelledby="mission-team-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">Mission team</p><h2 id="mission-team-title">Command structure</h2></div>
              <button className="modal-close" onClick={() => setShowTeam(false)} aria-label="Close mission team">×</button>
            </div>
            <p className="overview-intro">The Mission Director owns the recommendation. Each specialist independently investigates one domain, then returns evidence and a trade-off for the Director to reconcile.</p>
            <div className="team-structure">
              <article className="director-card">
                <div><span className="director-name">MISSION DIRECTOR</span><small>Command coordination</small></div>
                <span className="role-tag">SYNTHESIZES</span>
                <p>Coordinates the specialists, resolves conflicting advice, and prepares one recommendation. The Director cannot execute a command.</p>
              </article>
              <div className="reporting-line"><span>Delegates distinct mission questions</span></div>
              <div className="specialist-grid">
                {missionTeam.map((member) => (
                  <article className="team-member" key={member.name}>
                    <span>{member.name}</span><small>{member.role}</small><p>{member.focus}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      <section className="layout">
        <div className="left-column">
          <section className="panel next-action">
            {mission.phase === "resolved" ? (
              <>
                <p className="eyebrow">Mission complete</p>
                <h2>The habitat is secure</h2>
                <p className="muted">The EVA crew is inside, life support is stable, and the Martian dust storm has arrived. Review the team record for the outcome.</p>
                <button className="secondary" onClick={() => void act("reset", "/api/mission/reset")} disabled={Boolean(busy)}>Start a new mission</button>
              </>
            ) : mission.pendingCommand ? (
              <>
                <p className="eyebrow">Your decision is required</p>
                <h2>Authorize the survival plan</h2>
                <p className="muted">The mission team has completed its work. Your authorization is required before any command is carried out.</p>
                <div className="authorization-details">
                  <strong>{mission.pendingCommand.label}</strong>
                  <p>{mission.pendingCommand.consequence}</p>
                </div>
                <div className="button-row">
                  <button onClick={() => void act("approve", "/api/mission/approve", { approved: true })} disabled={Boolean(busy)}>Authorize plan</button>
                  <button className="danger" onClick={() => void act("decline", "/api/mission/approve", { approved: false })} disabled={Boolean(busy)}>Decline</button>
                </div>
              </>
            ) : mission.phase === "executing" ? (
              <>
                <p className="eyebrow">Plan underway</p>
                <h2>Confirm the mission outcome</h2>
                <p className="muted">The crew is returning and essential systems are protected. Advance the clock to receive the next situation report.</p>
                <button onClick={() => void act("advance", "/api/mission/advance")} disabled={Boolean(busy)}>Receive situation report</button>
              </>
            ) : !hasCouncilBrief ? (
              <>
                <p className="eyebrow">Recommended action</p>
                <h2>Get mission team assessment</h2>
                <p className="muted">The Director will ask four specialists to examine mission data, challenge conflicting evidence, and bring you one survival plan.</p>
                <button onClick={() => void conveneCouncil()} disabled={Boolean(busy)}>{busy === "council" ? "Mission team is assessing…" : "Get mission team assessment"}</button>
              </>
            ) : (
              <>
                <p className="eyebrow">Team assessment ready</p>
                <h2>Request command authorization</h2>
                <p className="muted">You have the decision brief. Request the proposed command for your final review and decision.</p>
                <button onClick={() => void act("approval", "/api/mission/request-approval", { plan: "combined survival plan" })} disabled={Boolean(busy)}>Review proposed command</button>
              </>
            )}
          </section>

          {(busy === "council" || visibleCouncilLog.length > 0) && (
            <section className="panel council-record">
              <p className="eyebrow">{busy === "council" ? "Team assessment in progress" : "Team assessment complete"}</p>
              <h2>Team activity</h2>
              {visibleCouncilLog.length === 0 ? (
                <p className="muted">The Director is opening the emergency channel…</p>
              ) : (
                <ol>{visibleCouncilLog.map((entry) => <li key={entry.id} className={entry.kind}><span>{entry.speaker}</span><p>{entry.message}</p></li>)}</ol>
              )}
              {busy === "council" && <p className="muted">New entries appear as specialists examine evidence and submit their advice.</p>}
            </section>
          )}

          {brief && <section className="panel brief"><p className="eyebrow">Director’s recommendation</p><h2>Decision brief</h2><p>{brief}</p></section>}

          <section className="panel assessments-panel">
            <div className="assessment-heading"><div><p className="eyebrow">Team output</p><h3>Specialist assessments</h3></div><span>{mission.reports.length}/4 ready</span></div>
            {mission.reports.length === 0 ? (
              <div className="empty-state">The specialists are briefed and ready. Request a mission team assessment to receive their independent advice.</div>
            ) : (
              <div className="reports">
                {mission.reports.map((report) => (
                  <article className="report" key={report.agent}>
                    <div className="report-title"><div><span className="agent-name">{report.agent}</span><small>{report.role}</small></div><Badge status={report.status} /></div>
                    <p>{report.recommendation}</p>
                    <div className="evidence">{report.evidence.map((item) => <span key={item}>{item}</span>)}</div>
                    <footer><span>Confidence {Math.round(report.confidence * 100)}%</span><span>Trade-off: {report.tradeoff}</span></footer>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="right-column">
          <section className="panel telemetry">
            <div className="panel-heading"><div><p className="eyebrow">Live input</p><h2>Telemetry</h2></div><span className="dot live">LIVE</span></div>
            <div className="telemetry-grid">
              {mission.telemetry.map((reading) => (
                <article className="reading" key={reading.label}>
                  <div><span>{reading.label}</span><Badge status={reading.status} /></div>
                  <strong>{reading.value}</strong>
                  <p>{reading.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel team-summary">
            <div><p className="eyebrow">Mission team</p><h2>One Director · four specialists</h2><p className="muted">See who owns each question before requesting an assessment.</p></div>
            <button className="secondary" onClick={() => setShowTeam(true)}>View command structure</button>
          </section>

          <section className="panel timeline">
            <p className="eyebrow">Mission record</p>
            <h2>Mission events</h2>
            <ol>{mission.timeline.slice().reverse().map((event, index) => <li key={event.time + index}><time>{event.time}</time><span className={event.kind} />{event.event}</li>)}</ol>
          </section>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
