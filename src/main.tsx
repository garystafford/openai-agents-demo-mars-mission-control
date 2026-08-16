import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Status = "nominal" | "watch" | "critical";
type Reading = { label: string; value: string; status: Status; detail: string };
type Report = { agent: string; role: string; status: Status; confidence: number; recommendation: string; evidence: string[]; tradeoff: string };
type CouncilEntry = { id: string; speaker: string; message: string; kind: "director" | "evidence" | "assessment" };
type DecisionPlan = { headline: string; actions: string[]; rationale: string; uncertainties: string[]; approvalScope: string };
const actionLabels: Record<string, string> = {
  recall_eva: "Recall EVA crew", shed_nonessential_load: "Shed nonessential load", isolate_scrubber: "Isolate scrubber loop",
  verify_orbital_weather: "Verify orbital weather", deploy_repair_drone: "Deploy repair drone", switch_to_backup_relay: "Switch to backup relay"
};
const missionTeam = [
  { name: "NOVA", role: "Power & thermal", focus: "Protects solar, battery, and habitat heat reserves." },
  { name: "AURA", role: "Life support", focus: "Keeps the cabin air safe and the scrubber loop stable." },
  { name: "KEPLER", role: "Weather & navigation", focus: "Forecasts conditions and brings field crews home." },
  { name: "MERCURY", role: "Red-team risk", focus: "Challenges weak assumptions and unsafe trade-offs." }
];
type Mission = {
  missionId: string; sol: number; minutesToImpact: number; monitoringIntervals: number; phase: string; telemetry: Reading[]; reports: Report[]; councilLog: CouncilEntry[];
  timeline: { time: string; event: string; kind: string }[]; scenario: { title: string; briefing: string; activeRisks: string[] };
  pendingCommand?: { id: string; label: string; consequence: string }; selectedPlan?: DecisionPlan; outcome?: "stabilized" | "degraded"; agentProfiles: Record<string, { model: string; reasoningEffort: string }>;
};

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Mission control link failed.");
  return response.json() as Promise<T>;
}
function Badge({ status }: { status: Status }) { return <span className={"badge " + status}>{status}</span>; }
function AgentMark({ name }: { name: string }) {
  const mark = name === "Mission Director" ? "director" : name.toLowerCase();
  return <i className={"agent-mark mark-" + mark} aria-hidden="true" />;
}

function InteractionMap({ reports, entries, plan, running, onShowTeam }: { reports: Report[]; entries: CouncilEntry[]; plan: DecisionPlan | null; running: boolean; onShowTeam: () => void }) {
  const selected = missionTeam.filter((member) => reports.some((report) => report.agent === member.name));
  const evidenceCount = (agent: string) => entries.filter((entry) => entry.speaker === agent && entry.kind === "evidence").length;
  const state = running ? "Live" : plan ? "Complete" : "Waiting";
  return (
    <section className="panel interaction-map" aria-label="Agent interaction flow">
      <div className="panel-heading"><div><p className="eyebrow">Run map</p><h2>Agent interaction flow</h2></div><div className="map-heading-actions"><button className="info-button" onClick={onShowTeam} aria-label="View mission team and model profiles" title="View mission team and model profiles">i</button><span className={"flow-state " + state.toLowerCase()}>{state}</span></div></div>
      <div className="flow-director"><span><AgentMark name="Mission Director" />MISSION DIRECTOR</span><small>selects specialists and owns the plan</small></div>
      <div className="flow-connector" aria-hidden="true" />
      {selected.length === 0 ? (
        <div className="flow-empty">Run an assessment to see the Director’s actual delegation path.</div>
      ) : (
        <div className="flow-specialists">
          {selected.map((member) => <div className="flow-specialist" key={member.name}><span><AgentMark name={member.name} />{member.name}</span><small>{member.role}</small><em>{evidenceCount(member.name)} evidence {evidenceCount(member.name) === 1 ? "request" : "requests"}</em></div>)}
        </div>
      )}
      {(selected.length > 0 || plan) && <><div className="flow-connector converge" aria-hidden="true" /><div className={"flow-plan " + (plan ? "ready" : "pending")}><span>{plan ? "APPROVAL-READY PLAN" : "SYNTHESIZING EVIDENCE"}</span><small>{plan ? plan.actions.length + " proposed actions" : "awaiting specialist output"}</small></div></>}
    </section>
  );
}

function App() {
  const [mission, setMission] = useState<Mission | null>(null);
  const [plan, setPlan] = useState<DecisionPlan | null>(null);
  const [councilLog, setCouncilLog] = useState<CouncilEntry[]>([]);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewRequest, setReviewRequest] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showOverview, setShowOverview] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const refresh = () => api<Mission>("/api/mission").then(setMission).catch((cause) => setError(cause.message));
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!showOverview && !showTeam) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setShowOverview(false); setShowTeam(false); } };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showOverview, showTeam]);

  async function act(name: string, path: string, body?: unknown) {
    setBusy(name); setError("");
    try {
      const next = await api<Mission>(path, "POST", body);
      setMission(next);
      if (name === "reset" || name === "decline") { setPlan(null); setCouncilLog([]); setReviewMode(false); setReviewRequest(""); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unexpected console fault."); }
    finally { setBusy(null); }
  }

  async function conveneCouncil(request?: string, previousPlan?: DecisionPlan) {
    const isReview = Boolean(request?.trim());
    setBusy("council"); setError(""); if (!isReview) setPlan(null); setCouncilLog([]);
    try {
      const response = await fetch("/api/mission/convene", { method: "POST", headers: isReview ? { Accept: "text/event-stream", "Content-Type": "application/json" } : { Accept: "text/event-stream" }, body: isReview ? JSON.stringify({ reviewRequest: request, previousPlan }) : undefined });
      if (!response.ok || !response.body) throw new Error("The mission team link could not be opened.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      const receive = (packet: string) => {
        const line = packet.split("\n").find((item) => item.startsWith("data: "));
        if (!line) return;
        const event = JSON.parse(line.slice(6)) as { type: string; entry?: CouncilEntry; report?: Report; plan?: DecisionPlan; state?: Mission; message?: string };
        if (event.type === "activity" && event.entry) setCouncilLog((entries) => [...entries, event.entry!]);
        else if (event.type === "report" && event.report) setMission((current) => current ? { ...current, reports: [...current.reports.filter((report) => report.agent !== event.report!.agent), event.report!] } : current);
        else if (event.type === "complete" && event.state && event.plan) { setPlan(event.plan); setMission(event.state); setCouncilLog(event.state.councilLog); }
        else if (event.type === "error") throw new Error(event.message ?? "The mission team could not complete its assessment.");
      };
      while (true) {
        const { value, done } = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const packets = buffer.split("\n\n"); buffer = packets.pop() ?? ""; packets.forEach(receive);
        if (done) break;
      }
      if (buffer.trim()) receive(buffer);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The mission team could not complete its assessment."); }
    finally { setBusy(null); }
  }

  if (!mission) return <main className="loading">Booting Ares-7 mission console…</main>;
  const profileLabel = (name: string) => {
    const profile = mission.agentProfiles[name];
    return profile ? profile.model + " · " + profile.reasoningEffort + " reasoning" : "Runtime profile unavailable";
  };
  const pressure = Math.max(0, Math.min(100, (32 - mission.minutesToImpact) * 4));
  const activePlan = plan ?? mission.selectedPlan ?? null;
  const visibleCouncilLog = busy === "council" ? councilLog : mission.councilLog;
  return <main>
    <header className="topbar"><div className="brand-lockup"><img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" /><div><p className="eyebrow">ARES-7 / MISSION CONTROL</p><h1>{mission.scenario.title}</h1><p className="product-intro">You are the commander of Ares-7. Your job is to assess a live incident with specialist support, review the proposed response, and authorize the simulation to act.</p></div></div><div className="header-meta"><span>SOL {mission.sol}</span><button className="info-button" onClick={() => setShowOverview(true)} aria-label="Open technical overview" title="How this mission is built">i</button><button className="quiet" onClick={() => void act("reset", "/api/mission/reset")} disabled={Boolean(busy)}>New incident</button></div></header>
    <section className="hero"><div><p className="eyebrow">Mission clock</p><div className="countdown">{String(mission.minutesToImpact).padStart(2, "0")}:00</div><p className="muted">until impact window</p></div><div className="pressure"><div className="pressure-head"><span>OPERATIONAL PRESSURE</span><strong>{pressure}%</strong></div><div className="meter"><i style={{ width: pressure + "%" }} /></div><p className="scenario-summary">{mission.scenario.briefing}</p><div className="scenario-risks">{mission.scenario.activeRisks.map((risk) => <span key={risk}>{risk}</span>)}</div></div><div className="phase"><p className="eyebrow">Run state</p><strong>{mission.phase.replaceAll("_", " ")}</strong><span>Session: {mission.missionId}</span></div></section>
    <section className="panel telemetry telemetry-wide"><div className="panel-heading"><div><p className="eyebrow">Live input</p><h2>Telemetry</h2></div><span className="dot live">LIVE</span></div><div className="telemetry-grid">{mission.telemetry.map((reading) => <article className="reading" key={reading.label}><div><span>{reading.label}</span><Badge status={reading.status} /></div><strong>{reading.value}</strong><p>{reading.detail}</p></article>)}</div></section>
    {error && <div className="error">{error}</div>}

    {showOverview && <div className="modal-backdrop" onMouseDown={() => setShowOverview(false)}><section className="technical-overview" role="dialog" aria-modal="true" aria-labelledby="technical-overview-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Technical overview</p><h2 id="technical-overview-title">How this mission demonstrates OpenAI Agents SDK</h2></div><button className="modal-close" onClick={() => setShowOverview(false)} aria-label="Close technical overview">×</button></div><p className="overview-intro">This is an adaptive mission simulation. The team investigates a scenario, chooses evidence to gather, and produces a structured proposal; the application retains command execution and safety controls.</p><div className="overview-grid"><article><h3>Director and specialists</h3><p>The Mission Director is the manager. NOVA, AURA, KEPLER, and MERCURY are specialists exposed with <code>Agent.asTool()</code>; the Director can choose a subset instead of automatically consulting all four.</p></article><article><h3>Configurable model profiles</h3><p>Each role reads its model and reasoning effort from environment configuration. The command-structure panel shows the active non-secret profile for this run.</p></article><article><h3>Typed mission tools</h3><p>Specialists use typed tools for telemetry, protocol lookup, and independent orbital, maintenance, or crew verification. The selected evidence can differ by incident.</p></article><article><h3>Structured decision plan</h3><p>The Director returns a typed plan: actions, rationale, unresolved uncertainty, and approval scope. The simulator validates those actions against the incident’s actual critical needs.</p></article><article><h3>Visible run activity</h3><p>The mission channel relays nested-run callbacks over a server-sent event stream. It shows evidence requests and specialist submissions, not hidden model reasoning.</p></article><article><h3>Human authorization</h3><p>The authorization card is an application-level safety checkpoint: the Director may recommend a plan, but only the commander can permit the simulated actions.</p></article><article><h3>Phoenix tracing and evaluation</h3><p>When Phoenix is configured, OpenInference captures the Director, specialists, model calls, and tools as trace spans. Local checks verify scenario, authorization, and outcome behavior.</p></article></div><p className="overview-footnote">For the platform concepts behind this design, see the <a href="https://developers.openai.com/api/docs/guides/agents" target="_blank" rel="noreferrer">OpenAI Agents SDK guide</a>.</p></section></div>}
    {showTeam && <div className="modal-backdrop" onMouseDown={() => setShowTeam(false)}><section className="technical-overview team-overview" role="dialog" aria-modal="true" aria-labelledby="mission-team-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Mission team</p><h2 id="mission-team-title">Command structure</h2></div><button className="modal-close" onClick={() => setShowTeam(false)} aria-label="Close mission team">×</button></div><p className="overview-intro">The Mission Director owns the recommendation and chooses specialists according to the incident. Each specialist independently investigates one domain, then returns evidence and a trade-off for the Director to reconcile.</p><div className="team-structure"><article className="director-card"><div><span className="director-name">MISSION DIRECTOR</span><small>Command coordination · {profileLabel("Mission Director")}</small></div><span className="role-tag">SYNTHESIZES</span><p>Coordinates the specialists, resolves conflicting advice, and prepares one recommendation. The Director cannot execute a command.</p></article><div className="reporting-line"><span>Delegates only the questions that matter</span></div><div className="specialist-grid">{missionTeam.map((member) => <article className="team-member" key={member.name}><span>{member.name}</span><small>{member.role} · {profileLabel(member.name)}</small><p>{member.focus}</p></article>)}</div></div></section></div>}

    <section className="layout"><div className="command-column"><section className="panel next-action">
      {mission.phase === "resolved" ? <><p className="eyebrow">Mission complete</p><h2>{mission.outcome === "stabilized" ? "The incident is contained" : "The habitat remains degraded"}</h2><p className="muted">Review the plan, evidence, and event record to see how the selected actions changed the outcome.</p><button className="secondary" onClick={() => void act("reset", "/api/mission/reset")} disabled={Boolean(busy)}>Start a new incident</button></>
        : mission.pendingCommand ? <><p className="eyebrow">Your decision is required</p><h2>Authorize the proposed actions</h2><p className="muted">The team has completed its work. Your authorization is required before the simulator carries out any action.</p><div className="authorization-details"><strong>{mission.pendingCommand.label}</strong><p>{mission.pendingCommand.consequence}</p></div><div className="button-row"><button onClick={() => void act("approve", "/api/mission/approve", { approved: true })} disabled={Boolean(busy)}>Authorize plan</button><button className="danger" onClick={() => void act("decline", "/api/mission/approve", { approved: false })} disabled={Boolean(busy)}>Decline</button></div></>
        : mission.phase === "executing" ? <><p className="eyebrow">Plan underway · report {Math.min(mission.monitoringIntervals + 1, 3)} of 3</p><h2>Monitor the deployed response</h2><p className="muted">Authorization dispatched the plan, but it takes effect over the simulated mission clock. Advance one four-minute interval for the next changing field report.</p><button onClick={() => void act("advance", "/api/mission/advance")} disabled={Boolean(busy)}>Advance 4-minute interval — receive report {Math.min(mission.monitoringIntervals + 1, 3)}</button></>
        : !activePlan ? <><p className="eyebrow">Recommended action</p><h2>Get an adaptive assessment</h2><p className="muted">The Director will decide which specialists and evidence sources are needed for this incident, then return an approval-ready plan.</p><button onClick={() => void conveneCouncil()} disabled={Boolean(busy)}>{busy === "council" ? "Mission team is assessing…" : "Get mission team assessment"}</button></>
        : reviewMode ? <><p className="eyebrow">Interactive plan review</p><h2>Challenge or refine the proposal</h2><p className="muted">Ask about evidence, trade-offs, or a safer alternative. The Director will continue this mission’s investigation before you choose whether to submit the plan.</p><div className="review-presets"><button className="secondary" onClick={() => setReviewRequest("Challenge the key trade-off and identify the most likely plan failure.")} disabled={Boolean(busy)}>Challenge trade-off</button><button className="secondary" onClick={() => setReviewRequest("What additional verification would most improve confidence before authorization?")} disabled={Boolean(busy)}>Ask for verification</button></div><label className="review-question"><span>Question for the Mission Director</span><textarea value={reviewRequest} onChange={(event) => setReviewRequest(event.target.value)} placeholder="For example: Is there a safer alternative if the orbital forecast is wrong?" disabled={Boolean(busy)} /></label><div className="button-row"><button onClick={() => { if (reviewRequest.trim()) void conveneCouncil(reviewRequest, activePlan); else setError("Enter a question or choose a review prompt first."); }} disabled={Boolean(busy)}>{busy === "council" ? "Director is reassessing…" : "Ask Director to reassess"}</button><button className="secondary" onClick={() => void act("approval", "/api/mission/request-approval", { plan: activePlan })} disabled={Boolean(busy)}>Submit for authorization</button></div></>
        : <><p className="eyebrow">Team assessment ready</p><h2>Review the proposed plan</h2><p className="muted">Inspect the actions, question the evidence, or ask for an alternative before submitting anything for authorization.</p><button onClick={() => setReviewMode(true)} disabled={Boolean(busy)}>Open plan review</button></>}
    </section>
    {activePlan && <section className="panel brief"><p className="eyebrow">Director’s recommendation</p><h2>{activePlan.headline}</h2><div className="plan-actions">{activePlan.actions.map((action) => <span key={action}>{actionLabels[action] ?? action}</span>)}</div><p>{activePlan.rationale}</p>{activePlan.uncertainties.length > 0 && <p className="uncertainties"><strong>Still uncertain:</strong> {activePlan.uncertainties.join(" · ")}</p>}</section>}</div>
      <div className="agent-column"><InteractionMap reports={mission.reports} entries={visibleCouncilLog} plan={busy === "council" ? null : activePlan} running={busy === "council"} onShowTeam={() => setShowTeam(true)} />
      {(busy === "council" || visibleCouncilLog.length > 0) && <section className="panel council-record"><p className="eyebrow">{busy === "council" ? "Team assessment in progress" : "Team assessment complete"}</p><h2>Team activity</h2>{visibleCouncilLog.length === 0 ? <p className="muted">The Director is opening the mission channel…</p> : <ol>{visibleCouncilLog.map((entry) => <li key={entry.id} className={entry.kind}><span className="activity-speaker"><AgentMark name={entry.speaker} />{entry.speaker}</span><p>{entry.message}</p></li>)}</ol>}{busy === "council" && <p className="muted">New entries appear as the Director selects evidence and specialists.</p>}</section>}<section className="panel timeline"><p className="eyebrow">Mission record</p><h2>Mission events</h2><ol>{mission.timeline.slice().reverse().map((event, index) => <li key={event.time + index}><time>{event.time}</time><span className={event.kind} />{event.event}</li>)}</ol></section></div>
      <aside className="operations-column"><section className="panel assessments-panel"><div className="assessment-heading"><div><p className="eyebrow">Team output</p><h3>Specialist assessments</h3></div><span>{mission.reports.length}/4 consulted</span></div>{mission.reports.length === 0 ? <div className="empty-state">The specialists are ready. The Director will bring in only those whose domain can reduce this incident’s uncertainty.</div> : <div className="reports">{mission.reports.map((report) => <article className="report" key={report.agent}><div className="report-title"><div><span className="agent-name"><AgentMark name={report.agent} />{report.agent}</span><small>{report.role} · {profileLabel(report.agent)}</small></div><Badge status={report.status} /></div><p>{report.recommendation}</p><div className="evidence">{report.evidence.map((item) => <span key={item}>{item}</span>)}</div><footer><span>Confidence {Math.round(report.confidence * 100)}%</span><span>Trade-off: {report.tradeoff}</span></footer></article>)}</div>}</section></aside>
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
