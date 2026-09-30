import { useEffect, useState } from "react";
import { api, type SessionSummary } from "./api/client";
import { reviewable } from "./api/review";
import { toast } from "sonner";
import { BranchActions, ImportBranch } from "./components/Branches/Branches";
import { DeckHub } from "./components/Decks/DeckHub";
import { deckFromUrl } from "./hooks/urlSync";
import { Menu, MenuItem } from "./components/Menu/Menu";
import { LiveTable } from "./components/Live/LiveTable";
import { NewGameDialog } from "./components/Game/NewGameDialog";
import {
  ScenarioErrors,
  EmptyState,
} from "./components/ScenarioErrors/ScenarioErrors";
import { TablePicker, TablePickerButton } from "./components/Tables/TablePicker";
import { Table } from "./components/Table/Table";
import { TopBar } from "./components/TopBar/TopBar";
import { useTutorChat } from "./components/Tutor/useTutorChat";
import { branchFrom } from "./branches/branches";
import { resultId, useScenarios } from "./scenarios/useScenarios";
import { useBranchStore } from "./store/branchStore";
import { usePlayerStore } from "./store/playerStore";

export default function App() {
  const { scenarioId, sessionId, open, openSession } = usePlayerStore();
  const [liveSessions, setLiveSessions] = useState<SessionSummary[]>();
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [newGameDeck, setNewGameDeck] = useState<string>();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Whether there's a Claude login, rechecked when the picker opens.
  const [claudeOn, setClaudeOn] = useState(false);
  useEffect(() => void api.claude().then((s) => setClaudeOn(s.available)), [pickerOpen]);
  // Reopens after a deck save reloads the page.
  const [deckHubOpen, setDeckHubOpen] = useState(() => deckFromUrl() !== undefined);
  const { scenarios, branches, branchIds } = useScenarios();
  const { add, appendStep, undo } = useBranchStore();
  const all = [...scenarios, ...branches];
  const result = all.find((r) => resultId(r) === scenarioId);
  const currentId = result && resultId(result);
  // Nothing open (a fresh start, or what was open is gone): the picker is the
  // home screen.
  const home = !sessionId && !result && all.length > 0;
  const isBranch = !!currentId && branchIds.has(currentId);
  // Branches live in this browser, so only the repo's lessons get a tutor.
  const tutor = useTutorChat(
    liveSessions && !sessionId && !isBranch ? currentId : undefined,
  );

  // The API is optional; undefined sessions means it isn't running.
  const refreshTables = () => void api.listSessions().then(setLiveSessions);
  useEffect(refreshTables, [sessionId]);
  const table = liveSessions?.find((t) => t.id === sessionId);

  // From the picker it opens at the start; from the More menu, where you are.
  const review = (id: string) =>
    api.startReview(id).then(() => {
      if (id !== sessionId) openSession(id, 0);
    });

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
      <h1 className="flex shrink-0 items-center gap-2 font-bold tracking-tight">
        <img src="/icon.svg" alt="" className="size-7 rounded-md" />
        <span className="hidden sm:inline">Duel Table</span>
      </h1>
      <TablePickerButton
        tables={liveSessions}
        scenarios={scenarios}
        branches={branches}
        tableId={sessionId}
        scenarioId={currentId}
        onClick={() => setPickerOpen(true)}
      />
      <Menu label="☰" title="More" align="right">
        <ImportBranch takenIds={all.map(resultId)} />
        {liveSessions && <MenuItem onClick={() => setDeckHubOpen(true)}>Decks…</MenuItem>}
        {claudeOn && table && reviewable(table) && (
          <MenuItem onClick={() => void review(table.id).catch((e: Error) => toast.error(e.message))}>Review with Claude</MenuItem>
        )}
      </Menu>
      <DeckHub
        open={deckHubOpen}
        initial={deckFromUrl()}
        onClose={() => setDeckHubOpen(false)}
        onPlay={(deck) => {
          setNewGameDeck(deck);
          setNewGameOpen(true);
        }}
      />
    </>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-ink">
      <TablePicker
        open={pickerOpen || home}
        required={home}
        onClose={() => setPickerOpen(false)}
        tables={liveSessions}
        scenarios={scenarios}
        branches={branches}
        tableId={sessionId}
        scenarioId={currentId}
        onOpenTable={(id) => (id ? openSession(id, Infinity) : openSession(undefined))}
        onOpenScenario={(id) => open(id)}
        onNewGame={() => setNewGameOpen(true)}
        onChanged={refreshTables}
        onReview={claudeOn ? review : undefined}
      />
      <NewGameDialog
        key={newGameDeck}
        open={newGameOpen}
        deck={newGameDeck}
        onClose={() => {
          setNewGameOpen(false);
          setNewGameDeck(undefined);
        }}
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
          chat={tutor}
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
