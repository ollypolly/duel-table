import { useEffect, useState } from "react";
import { api, type SessionSummary } from "./api/client";
import { BranchActions, ImportBranch } from "./components/Branches/Branches";
import { CosmeticsDialog } from "./components/Cosmetics/Cosmetics";
import { Menu, MenuItem, MenuLabel } from "./components/Menu/Menu";
import { LiveTable } from "./components/Live/LiveTable";
import { NewGameDialog } from "./components/Game/NewGameDialog";
import {
  ScenarioErrors,
  EmptyState,
} from "./components/ScenarioErrors/ScenarioErrors";
import { ScenarioPicker } from "./components/ScenarioPicker/ScenarioPicker";
import { Table } from "./components/Table/Table";
import { TopBar } from "./components/TopBar/TopBar";
import { branchFrom } from "./branches/branches";
import { resultId, useScenarios } from "./scenarios/useScenarios";
import { useBranchStore } from "./store/branchStore";
import { usePlayerStore } from "./store/playerStore";

export default function App() {
  const { scenarioId, sessionId, open, openSession } = usePlayerStore();
  const [liveSessions, setLiveSessions] = useState<SessionSummary[]>();
  const [cosmeticsOpen, setCosmeticsOpen] = useState(false);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const { scenarios, branches, branchIds } = useScenarios();
  const { add, appendStep, undo } = useBranchStore();
  const all = [...scenarios, ...branches];
  const result =
    all.find((r) => resultId(r) === scenarioId) ??
    all.find((r) => r.ok) ??
    all[0];
  const currentId = result && resultId(result);
  const isBranch = !!currentId && branchIds.has(currentId);

  useEffect(() => {
    if (currentId && currentId !== scenarioId) open(currentId);
  }, [currentId, scenarioId, open]);

  // The API is optional; undefined sessions means it isn't running.
  useEffect(() => {
    void api.listSessions().then(setLiveSessions);
  }, [sessionId]);

  const goLive = async (position: number) => {
    const s = await api.createSession({
      scenario: currentId!,
      atStep: position,
    });
    openSession(s.id, position);
  };

  const startBranch = (position: number) => {
    if (!result?.ok) return;
    const branch = branchFrom(result.scenario, position, all.map(resultId));
    add(branch);
    open(branch.id, position);
  };

  const nav = (
    <>
      <h1 className="shrink-0 font-bold tracking-tight">Duel Table</h1>
      {all.length > 0 && (
        <ScenarioPicker
          scenarios={scenarios}
          branches={branches}
          value={currentId}
          onChange={(id) => open(id)}
        />
      )}
      {liveSessions && (
        <Menu label={sessionId ? `Live: ${sessionId}` : "Live"} title="Sessions on the local API">
          <MenuItem onClick={() => setNewGameOpen(true)}>New game against the bot…</MenuItem>
          <MenuLabel>Open a session</MenuLabel>
          {liveSessions.length === 0 && <MenuItem disabled>No sessions yet</MenuItem>}
          {liveSessions.map((s) => (
            <MenuItem key={s.id} onClick={() => openSession(s.id, Infinity)} aria-current={s.id === sessionId}>
              {s.id}: {s.title}
            </MenuItem>
          ))}
          {sessionId && <MenuItem onClick={() => openSession(undefined)}>Leave live mode</MenuItem>}
        </Menu>
      )}
      <Menu label="☰" title="More">
        <ImportBranch takenIds={all.map(resultId)} />
        <MenuItem onClick={() => setCosmeticsOpen(true)}>Sleeves, deck boxes & playmats…</MenuItem>
      </Menu>
      <CosmeticsDialog open={cosmeticsOpen} onClose={() => setCosmeticsOpen(false)} />
    </>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-ink">
      <NewGameDialog
        open={newGameOpen}
        onClose={() => setNewGameOpen(false)}
        onStarted={(id) => {
          setNewGameOpen(false);
          openSession(id, Infinity);
        }}
      />
      {sessionId ? (
        <LiveTable key={sessionId} id={sessionId} nav={nav} />
      ) : result?.ok ? (
        <Table
          key={result.scenario.id}
          scenario={result.scenario}
          nav={nav}
          onBranch={startBranch}
          {...(liveSessions &&
            !isBranch && {
              onGoLive: (position: number) => void goLive(position),
            })}
          {...(isBranch && {
            onStep: (step) => appendStep(result.scenario.id, step),
            onUndo: () => undo(result.scenario.id),
            menuItems: <BranchActions id={result.scenario.id} />,
          })}
        />
      ) : (
        <>
          <TopBar nav={nav} />
          <div className="overflow-y-auto">
            {!result ? (
              <EmptyState />
            ) : (
              <ScenarioErrors id={result.id} errors={result.errors}>
                {isBranch && (
                  <Menu label="Branch">
                    <BranchActions id={result.id} />
                  </Menu>
                )}
              </ScenarioErrors>
            )}
          </div>
        </>
      )}
    </div>
  );
}
