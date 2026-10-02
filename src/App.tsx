import { useEffect, useState } from "react";
import { api, type SessionSummary } from "./api/client";
import { Layers, Plus, Settings } from "lucide-react";
import { SettingsDialog } from "./components/Settings/SettingsDialog";
import { BranchActions, ImportBranch } from "./components/Branches/Branches";
import { DeckHub } from "./components/Decks/DeckHub";
import { deckFromUrl } from "./hooks/urlSync";
import { Menu } from "./components/Menu/Menu";
import { LiveTable } from "./components/Live/LiveTable";
import { NewGameDialog } from "./components/Game/NewGameDialog";
import {
  ScenarioErrors,
  EmptyState,
} from "./components/ScenarioErrors/ScenarioErrors";
import { Home } from "./components/Home/Home";
import { ChatPage } from "./components/Home/HomeChat";
import { Logo } from "./components/Logo/Logo";
import { scenarioTitle, tableName } from "./components/Home/names";
import { Table } from "./components/Table/Table";
import { TopBar } from "./components/TopBar/TopBar";
import { useTutorChat } from "./components/Tutor/useTutorChat";
import { branchFrom } from "./branches/branches";
import { resultId, useScenarios } from "./scenarios/useScenarios";
import { useBranchStore } from "./store/branchStore";
import { usePlayerStore } from "./store/playerStore";

export default function App() {
  const { scenarioId, sessionId, chatId, open, openSession, goHome } = usePlayerStore();
  const [liveSessions, setLiveSessions] = useState<SessionSummary[]>();
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [newGameDeck, setNewGameDeck] = useState<string>();
  const [newLesson, setNewLesson] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Whether there's a Claude login, rechecked when you come home.
  const [claudeOn, setClaudeOn] = useState(false);
  // Reopens after a deck save reloads the page.
  const [deckHubOpen, setDeckHubOpen] = useState(() => deckFromUrl() !== undefined);
  const { scenarios, branches, branchIds } = useScenarios();
  const { add, appendStep, undo } = useBranchStore();
  const all = [...scenarios, ...branches];
  const result = all.find((r) => resultId(r) === scenarioId);
  const currentId = result && resultId(result);
  // Nothing open (a fresh start, or what was open is gone).
  const home = !sessionId && !result;
  useEffect(() => void (home && api.claude().then((s) => setClaudeOn(s.available))), [home]);
  const isBranch = !!currentId && branchIds.has(currentId);
  // Branches live in this browser, so only the repo's lessons get a tutor.
  const tutor = useTutorChat(
    liveSessions && !sessionId && !isBranch ? currentId : undefined,
  );

  // The API is optional; undefined sessions means it isn't running.
  const refreshTables = () => void api.listSessions().then(setLiveSessions);
  useEffect(refreshTables, [sessionId, home]);
  const table = liveSessions?.find((t) => t.id === sessionId);

  // Starts a review, or opens the one the game has, at the start.
  const review = (id: string) =>
    (liveSessions?.find((t) => t.id === id)?.reviewed ? Promise.resolve() : api.startReview(id)).then(() => openSession(id, 0));

  const rematch = (t: SessionSummary) =>
    api
      .createGame({
        deck: t.players.p1.deck!,
        opponentDeck: t.players.p2.deck!,
        ...(t.opponent === "claude" && { claude: "p2" as const }),
        ...(t.opponent === "trained" && { bot: "agent" as const }),
      })
      .then((s) => openSession(s.id, Infinity));

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
      <Logo onClick={goHome} current={home} />
      {/* What's open, in the middle of the header. */}
      {!home && (
        <span className="absolute left-1/2 top-1/2 max-w-[26rem] -translate-x-1/2 -translate-y-1/2 truncate text-sm text-muted max-xl:hidden">
          {table ? tableName(table) : result ? scenarioTitle(result) : sessionId}
        </span>
      )}
      {liveSessions && !home && (
        <button type="button" className="btn flex shrink-0 items-center gap-1" title="New game" onClick={() => setNewGameOpen(true)}>
          <Plus size={14} aria-hidden />
          <span className="max-sm:sr-only">New game</span>
        </button>
      )}
      {liveSessions && (
        <button type="button" className="btn flex shrink-0 items-center gap-1" title="Decks" onClick={() => setDeckHubOpen(true)}>
          <Layers size={14} aria-hidden />
          <span className="max-sm:sr-only">Decks</span>
        </button>
      )}
      <button type="button" className="btn order-last shrink-0 max-sm:ml-auto" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
        <Settings size={14} aria-hidden />
      </button>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <ImportBranch takenIds={all.map(resultId)} onImported={() => setSettingsOpen(false)} />
      </SettingsDialog>
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
      <NewGameDialog
        key={`${newGameDeck}${newLesson}`}
        open={newGameOpen || newLesson}
        deck={newGameDeck}
        lesson={newLesson}
        onClose={() => {
          setNewGameOpen(false);
          setNewLesson(false);
          setNewGameDeck(undefined);
        }}
        onStarted={(id) => openSession(id, Infinity)}
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
          {!result && chatId ? (
            <ChatPage key={chatId} id={chatId} />
          ) : !result ? (
            all.length ? (
              <Home
                tables={liveSessions}
                scenarios={scenarios}
                branches={branches}
                claudeOn={claudeOn}
                onOpenTable={(id) => openSession(id, Infinity)}
                onOpenScenario={open}
                onNewGame={() => setNewGameOpen(true)}
                onNewLesson={() => setNewLesson(true)}
                onReview={review}
                onRematch={rematch}
                onChanged={refreshTables}
              />
            ) : (
              <EmptyState />
            )
          ) : (
            <div className="overflow-y-auto">
              <ScenarioErrors id={result.id} errors={result.errors}>
                {isBranch && (
                  <Menu label="Branch">
                    <BranchActions id={result.id} />
                  </Menu>
                )}
              </ScenarioErrors>
            </div>
          )}
        </>
      )}
    </div>
  );
}
