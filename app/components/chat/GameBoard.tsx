"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Seat } from "@/lib/chat/game";
import {
  branch,
  ghostChallenge,
  ghostResult,
  ghostSeed,
  parseGhostGraph,
  stepNode,
  type GhostNode,
  type GhostStep,
} from "@/lib/chat/ghost";
import {
  applyGuess,
  emptyBoard,
  hangmanAskGraph,
  hangmanAskWord,
  hangmanResult,
  lost,
  parseHangmanGraph,
  parseHangmanWord,
  pattern,
  walkGraph,
  won,
  type HangmanBoard,
} from "@/lib/chat/hangman";

/** The header game drawer; Ghost and Hangman with the agent. */

export function gameStorageKey(roomKey: string): string {
  return `gantree.game.${roomKey}`;
}

function GameControllerIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
      <rect x="4" y="7" width="12" height="7" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
      <circle cx="12.5" cy="10.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function GameButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label="game"
      title="Game"
      aria-haspopup="dialog"
      aria-expanded={open}
      className={`flex h-8 w-8 items-center justify-center rounded-lg hover:bg-track hover:text-fg ${
        open ? "text-mark" : "text-muted"
      }`}
      onClick={onToggle}
    >
      <GameControllerIcon />
    </button>
  );
}

function ghostProseStatus(reply: string): string {
  const flat = reply.replace(/\r?\n/u, " ").trim();
  if (flat.length <= 140) {
    return flat;
  }
  return flat.slice(0, 140);
}

function ghostPathAdd(path: string, letter: string, who: string): string {
  const seg = `${letter}(${who})`;
  return path ? `${path} ${seg}` : seg;
}

function ghostRoundEnd(step: GhostStep, stem: string, agentName: string): string {
  if (step.kind === "word") {
    return `${agentName} says that's a word: ${step.word}.`;
  }
  if (step.kind === "challenge") {
    const word = step.word;
    const stemUp = stem.toUpperCase();
    const wordUp = word.toUpperCase();
    if (wordUp.startsWith(stemUp) && word.length > stem.length) {
      return `${agentName} has ${word}. You lose the challenge.`;
    }
    return `${word} doesn't start with ${stem}. ${agentName} loses the challenge.`;
  }
  return "Your turn";
}

export function GameSheet({
  open = true,
  agentName,
  roomKey: _roomKey,
  onClose,
  agentReply = "",
  onSend,
}: {
  open?: boolean;
  agentName: string;
  roomKey: string;
  onClose: () => void;
  agentReply?: string;
  onSend?: (text: string) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [starter, setStarter] = useState<Seat>("human");

  const [playingGhost, setPlayingGhost] = useState(false);
  const [ghostStem, setGhostStem] = useState("");
  const [ghostWaiting, setGhostWaiting] = useState(false);
  const [ghostOver, setGhostOver] = useState(false);
  const [ghostStatus, setGhostStatus] = useState("");
  const [ghostLetter, setGhostLetter] = useState("");
  const [ghostHeldNode, setGhostHeldNode] = useState<GhostNode | null>(null);
  const [ghostPath, setGhostPath] = useState("");
  const ghostWaitBaselineRef = useRef("");
  const ghostProcessedReplyRef = useRef("");

  const [playingHangman, setPlayingHangman] = useState(false);
  const [hangmanBoard, setHangmanBoard] = useState<HangmanBoard | null>(null);
  const [hangmanKitHides, setHangmanKitHides] = useState(false);
  const [hangmanWaiting, setHangmanWaiting] = useState(false);
  const [hangmanOver, setHangmanOver] = useState(false);
  const [hangmanStatus, setHangmanStatus] = useState("");
  const [hangmanGuess, setHangmanGuess] = useState("");
  const [hangmanWord, setHangmanWord] = useState("");
  const [hangmanSteps, setHangmanSteps] = useState<{ letter: string; hit: boolean }[]>([]);
  const [hangmanAskAgain, setHangmanAskAgain] = useState(false);
  const hangmanWaitBaselineRef = useRef("");
  const hangmanProcessedReplyRef = useRef("");

  useEffect(() => {
    if (!open) {
      return;
    }
    panel.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const resetGhost = () => {
    setPlayingGhost(false);
    setGhostStem("");
    setGhostWaiting(false);
    setGhostOver(false);
    setGhostStatus("");
    setGhostLetter("");
    setGhostHeldNode(null);
    setGhostPath("");
    ghostWaitBaselineRef.current = "";
    ghostProcessedReplyRef.current = "";
  };

  const resetHangman = () => {
    setPlayingHangman(false);
    setHangmanBoard(null);
    setHangmanKitHides(false);
    setHangmanWaiting(false);
    setHangmanOver(false);
    setHangmanStatus("");
    setHangmanGuess("");
    setHangmanWord("");
    setHangmanSteps([]);
    setHangmanAskAgain(false);
    hangmanWaitBaselineRef.current = "";
    hangmanProcessedReplyRef.current = "";
  };

  const beginGhost = () => {
    resetGhost();
    setPlayingGhost(true);
    if (starter === "agent") {
      onSend?.(ghostSeed(agentName, "", "You start. "));
      ghostWaitBaselineRef.current = agentReply;
      setGhostWaiting(true);
      setGhostStatus(`Waiting for ${agentName}`);
    } else {
      setGhostStatus("Your turn");
    }
  };

  const beginHangman = () => {
    resetHangman();
    setPlayingHangman(true);
    const kitHides = starter === "agent";
    setHangmanKitHides(kitHides);
    if (kitHides) {
      onSend?.(hangmanAskWord(agentName));
      hangmanWaitBaselineRef.current = agentReply;
      hangmanProcessedReplyRef.current = agentReply;
      setHangmanWaiting(true);
      setHangmanStatus(`Waiting for ${agentName}`);
    } else {
      setHangmanStatus("Hide your word");
    }
  };

  const resetToPicker = () => {
    resetGhost();
    resetHangman();
  };

  useEffect(() => {
    if (!playingGhost || !ghostWaiting || ghostOver) {
      return;
    }
    if (!agentReply) {
      return;
    }
    if (agentReply === ghostWaitBaselineRef.current) {
      return;
    }
    if (agentReply === ghostProcessedReplyRef.current) {
      return;
    }
    ghostProcessedReplyRef.current = agentReply;
    const graph = parseGhostGraph(agentReply);
    const step = graph ? stepNode(graph) : null;
    if (!graph || !step) {
      setGhostWaiting(false);
      setGhostStatus(ghostProseStatus(agentReply));
      setGhostHeldNode(null);
      return;
    }
    if (step.kind === "letter") {
      setGhostStem((prev) => prev + step.letter);
      setGhostPath((prev) => ghostPathAdd(prev, step.letter, agentName));
      setGhostHeldNode(graph);
      setGhostWaiting(false);
      setGhostStatus("Your turn");
      return;
    }
    const endStatus = ghostRoundEnd(step, ghostStem, agentName);
    setGhostOver(true);
    setGhostWaiting(false);
    setGhostHeldNode(null);
    setGhostStatus(endStatus);
    onSend?.(ghostResult(agentName, ghostStem, ghostPath, endStatus));
  }, [agentName, agentReply, ghostOver, ghostPath, ghostStem, ghostWaiting, onSend, playingGhost]);

  useEffect(() => {
    if (!playingHangman || hangmanOver || !hangmanWaiting) {
      return;
    }
    if (!agentReply) {
      return;
    }
    if (agentReply === hangmanWaitBaselineRef.current) {
      return;
    }
    if (agentReply === hangmanProcessedReplyRef.current) {
      return;
    }
    hangmanProcessedReplyRef.current = agentReply;

    if (hangmanKitHides && !hangmanBoard && hangmanWaiting) {
      const word = parseHangmanWord(agentReply);
      if (!word) {
        setHangmanWaiting(false);
        setHangmanStatus(ghostProseStatus(agentReply));
        return;
      }
      const board = emptyBoard(word);
      setHangmanBoard(board);
      setHangmanWaiting(false);
      setHangmanStatus(`${board.lives} wrong guesses left`);
      return;
    }

    if (!hangmanKitHides && hangmanBoard && hangmanWaiting) {
      const graph = parseHangmanGraph(agentReply);
      if (!graph) {
        setHangmanWaiting(false);
        setHangmanAskAgain(true);
        setHangmanStatus(ghostProseStatus(agentReply));
        return;
      }
      const { board: next, steps } = walkGraph(hangmanBoard, graph);
      setHangmanBoard(next);
      setHangmanSteps(steps);
      setHangmanAskAgain(false);
      hangmanWaitBaselineRef.current = agentReply;
      if (won(next) || lost(next)) {
        setHangmanWaiting(false);
        setHangmanOver(true);
        if (won(next)) {
          setHangmanStatus(`${agentName} got it.`);
        } else {
          setHangmanStatus(`You win. ${next.secret}`);
        }
        onSend?.(hangmanResult(agentName, next, "agent"));
        return;
      }
      onSend?.(hangmanAskGraph(agentName, next));
      hangmanWaitBaselineRef.current = agentReply;
      hangmanProcessedReplyRef.current = agentReply;
      setHangmanWaiting(true);
      setHangmanStatus(`Waiting for ${agentName}`);
    }
  }, [
    agentName,
    agentReply,
    hangmanBoard,
    hangmanKitHides,
    hangmanOver,
    hangmanWaiting,
    onSend,
    playingHangman,
  ]);

  const playHangmanGuess = () => {
    if (!playingHangman || !hangmanBoard || !hangmanKitHides) {
      return;
    }
    if (hangmanWaiting || hangmanOver) {
      return;
    }
    const letter = hangmanGuess.trim().toUpperCase();
    if (!/^[A-Z]$/.test(letter)) {
      return;
    }
    const { board: next, repeat } = applyGuess(hangmanBoard, letter);
    setHangmanGuess("");
    if (repeat) {
      setHangmanStatus("Already guessed");
      return;
    }
    setHangmanBoard(next);
    if (won(next)) {
      setHangmanOver(true);
      setHangmanStatus("You got it.");
      onSend?.(hangmanResult(agentName, next, "you"));
      return;
    }
    if (lost(next)) {
      setHangmanOver(true);
      setHangmanStatus(`${agentName}'s word was ${next.secret}.`);
      onSend?.(hangmanResult(agentName, next, "you"));
      return;
    }
    setHangmanStatus(`${next.lives} wrong guesses left`);
  };

  const hideHangmanWord = () => {
    if (!playingHangman || hangmanKitHides || hangmanWaiting || hangmanOver) {
      return;
    }
    const word = hangmanWord.trim();
    const parsed = parseHangmanWord(JSON.stringify({ word }));
    if (!parsed) {
      return;
    }
    const board = emptyBoard(parsed);
    setHangmanBoard(board);
    setHangmanWord("");
    onSend?.(hangmanAskGraph(agentName, board));
    hangmanWaitBaselineRef.current = agentReply;
    hangmanProcessedReplyRef.current = agentReply;
    setHangmanWaiting(true);
    setHangmanStatus(`Waiting for ${agentName}`);
  };

  const sendHangmanAskAgain = () => {
    if (!playingHangman || !hangmanBoard || hangmanKitHides || hangmanWaiting || hangmanOver) {
      return;
    }
    onSend?.(hangmanAskGraph(agentName, hangmanBoard));
    hangmanWaitBaselineRef.current = agentReply;
    hangmanProcessedReplyRef.current = agentReply;
    setHangmanAskAgain(false);
    setHangmanWaiting(true);
    setHangmanStatus(`Waiting for ${agentName}`);
  };

  const playGhostLetter = () => {
    if (!playingGhost || ghostWaiting || ghostOver) {
      return;
    }
    const letter = ghostLetter.trim().toUpperCase();
    if (!/^[A-Z]$/.test(letter)) {
      return;
    }
    const openingLetter = ghostStem === "";
    let nextStem = ghostStem + letter;
    let nextPath = ghostPathAdd(ghostPath, letter, "you");
    setGhostLetter("");

    if (ghostHeldNode) {
      const child = branch(ghostHeldNode, letter);
      if (child) {
        const childStep = stepNode(child);
        if (childStep?.kind === "letter") {
          nextStem += childStep.letter;
          nextPath = ghostPathAdd(nextPath, childStep.letter, agentName);
          setGhostStem(nextStem);
          setGhostPath(nextPath);
          setGhostHeldNode(child);
          setGhostStatus("Your turn");
          return;
        }
        if (childStep) {
          const endStatus = ghostRoundEnd(childStep, nextStem, agentName);
          setGhostStem(nextStem);
          setGhostPath(nextPath);
          setGhostHeldNode(null);
          setGhostOver(true);
          setGhostStatus(endStatus);
          onSend?.(ghostResult(agentName, nextStem, nextPath, endStatus));
          return;
        }
      }
      setGhostStem(nextStem);
      setGhostPath(nextPath);
      setGhostHeldNode(null);
      onSend?.(ghostSeed(agentName, nextStem, `Path: ${nextPath}. This letter was not in your graph. `));
      ghostWaitBaselineRef.current = agentReply;
      ghostProcessedReplyRef.current = agentReply;
      setGhostWaiting(true);
      setGhostStatus(`Waiting for ${agentName}`);
      return;
    }

    setGhostStem(nextStem);
    setGhostPath(nextPath);
    const seedPath = openingLetter
      ? `I add ${letter}. `
      : `Path: ${nextPath}. This letter was not in your graph. `;
    onSend?.(ghostSeed(agentName, nextStem, seedPath));
    ghostWaitBaselineRef.current = agentReply;
    ghostProcessedReplyRef.current = agentReply;
    setGhostWaiting(true);
    setGhostStatus(`Waiting for ${agentName}`);
  };

  const sendGhostChallenge = () => {
    if (!playingGhost || ghostWaiting || ghostOver || !ghostStem) {
      return;
    }
    setGhostHeldNode(null);
    onSend?.(ghostChallenge(agentName, ghostStem));
    ghostWaitBaselineRef.current = agentReply;
    ghostProcessedReplyRef.current = agentReply;
    setGhostWaiting(true);
    setGhostStatus(`Waiting for ${agentName}`);
  };

  if (!open) {
    return null;
  }

  return (
    <>
      <div data-testid="game-scrim" aria-hidden className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <div
        id={id}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Game"
        tabIndex={-1}
        className="fixed inset-y-0 right-0 z-30 flex w-80 max-w-[92vw] flex-col border-l border-line bg-panel pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none animate-drawer motion-reduce:animate-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
          <p className="text-sm font-medium text-fg">Game</p>
          <button
            type="button"
            aria-label="Close game"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-track hover:text-fg"
            onClick={onClose}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
              <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {playingHangman
            ? (
                <div className="flex flex-col gap-4">
                  <p aria-live="polite" className="text-sm font-medium text-fg">
                    {hangmanStatus}
                  </p>
                  {hangmanBoard
                    ? (
                        <>
                          <p aria-label="Pattern" className="text-sm font-mono tracking-wide text-fg">
                            {pattern(hangmanBoard)}
                          </p>
                          {hangmanSteps.length > 0
                            ? (
                                <p aria-label="Guesses" className="text-xs text-muted">
                                  {hangmanSteps.map((s) => `${s.letter} ${s.hit ? "hit" : "miss"}`).join(", ")}
                                </p>
                              )
                            : null}
                        </>
                      )
                    : null}
                  {hangmanKitHides && hangmanBoard
                    ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="flex flex-col gap-1 text-xs text-muted">
                            Guess
                            <input
                              type="text"
                              inputMode="text"
                              autoComplete="off"
                              maxLength={1}
                              aria-label="Your guess"
                              disabled={hangmanOver || hangmanWaiting}
                              value={hangmanGuess}
                              className="w-12 rounded-lg border border-edge bg-track px-2 py-1 text-center text-sm uppercase text-fg disabled:opacity-60"
                              onChange={(e) => setHangmanGuess(e.target.value)}
                            />
                          </label>
                          <button
                            type="button"
                            disabled={hangmanOver || hangmanWaiting || !/^[A-Za-z]$/.test(hangmanGuess.trim())}
                            className="rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track disabled:opacity-60"
                            onClick={playHangmanGuess}
                          >
                            Guess
                          </button>
                        </div>
                      )
                    : null}
                  {!hangmanKitHides && !hangmanBoard
                    ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="flex flex-col gap-1 text-xs text-muted">
                            Word
                            <input
                              type="text"
                              inputMode="text"
                              autoComplete="off"
                              aria-label="Your word"
                              disabled={hangmanWaiting}
                              value={hangmanWord}
                              className="w-full rounded-lg border border-edge bg-track px-2 py-1 text-sm uppercase text-fg disabled:opacity-60"
                              onChange={(e) => setHangmanWord(e.target.value)}
                            />
                          </label>
                          <button
                            type="button"
                            disabled={
                              hangmanWaiting
                              || !parseHangmanWord(JSON.stringify({ word: hangmanWord.trim() }))
                            }
                            className="rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track disabled:opacity-60"
                            onClick={hideHangmanWord}
                          >
                            Hide word
                          </button>
                        </div>
                      )
                    : null}
                  {hangmanAskAgain
                    ? (
                        <button
                          type="button"
                          disabled={hangmanWaiting}
                          className="rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track disabled:opacity-60"
                          onClick={sendHangmanAskAgain}
                        >
                          Ask again
                        </button>
                      )
                    : null}
                  <button
                    type="button"
                    className="rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track"
                    onClick={resetToPicker}
                  >
                    New game
                  </button>
                </div>
              )
            : playingGhost
              ? (
                  <div className="flex flex-col gap-4">
                    <p aria-live="polite" className="text-sm font-medium text-fg">
                      {ghostStatus}
                    </p>
                    <p aria-label="Stem" className="text-sm font-mono tracking-wide text-fg">
                      {ghostStem || <span className="text-muted">—</span>}
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1 text-xs text-muted">
                        Letter
                        <input
                          type="text"
                          inputMode="text"
                          autoComplete="off"
                          maxLength={1}
                          aria-label="Your letter"
                          disabled={ghostOver || ghostWaiting}
                          value={ghostLetter}
                          className="w-12 rounded-lg border border-edge bg-track px-2 py-1 text-center text-sm uppercase text-fg disabled:opacity-60"
                          onChange={(e) => setGhostLetter(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={ghostOver || ghostWaiting || !/^[A-Za-z]$/.test(ghostLetter.trim())}
                        className="rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track disabled:opacity-60"
                        onClick={playGhostLetter}
                      >
                        Play letter
                      </button>
                      <button
                        type="button"
                        disabled={ghostOver || ghostWaiting || !ghostStem}
                        className="rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track disabled:opacity-60"
                        onClick={sendGhostChallenge}
                      >
                        Challenge
                      </button>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track"
                      onClick={resetToPicker}
                    >
                      New game
                    </button>
                  </div>
                )
              : (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-fg">{`Play ${agentName}.`}</p>
                    <div role="group" aria-label="Who starts" className="flex gap-2">
                      <button
                        type="button"
                        aria-pressed={starter === "human"}
                        className={`rounded-lg border px-2 py-1 text-xs ${starter === "human" ? "border-mark text-mark" : "border-edge text-fg hover:bg-track"}`}
                        onClick={() => setStarter("human")}
                      >
                        You
                      </button>
                      <button
                        type="button"
                        aria-pressed={starter === "agent"}
                        aria-label={agentName}
                        className={`rounded-lg border px-2 py-1 text-xs ${starter === "agent" ? "border-mark text-mark" : "border-edge text-fg hover:bg-track"}`}
                        onClick={() => setStarter("agent")}
                      >
                        {agentName}
                      </button>
                    </div>
                    <div className="flex flex-col gap-3">
                      <div>
                        <button
                          type="button"
                          aria-label="Ghost"
                          className="w-full rounded-lg border border-edge px-3 py-2 text-left text-sm text-fg hover:bg-track"
                          onClick={beginGhost}
                        >
                          Ghost
                        </button>
                        <p className="mt-1 text-xs text-mark">With the agent</p>
                        <p className="mt-1 text-[11px] text-muted">{`${agentName} sends the next few replies at once.`}</p>
                      </div>
                      <div>
                        <button
                          type="button"
                          aria-label="Hangman"
                          className="w-full rounded-lg border border-edge px-3 py-2 text-left text-sm text-fg hover:bg-track"
                          onClick={beginHangman}
                        >
                          Hangman
                        </button>
                        <p className="mt-1 text-xs text-mark">With the agent</p>
                        <p className="mt-1 text-[11px] text-muted">{`You hide a word, or ${agentName} does.`}</p>
                      </div>
                    </div>
                  </div>
                )}
        </div>
      </div>
    </>
  );
}
