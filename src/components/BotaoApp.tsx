"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { computeOdds, formatBRL, resultOf, type Pick } from "@/lib/odds";
import { getTeam, TEAMS, type Team } from "@/lib/teams";
import type { ActiveBet } from "./GameView";

const GameView = dynamic(() => import("./GameView"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 grid place-items-center bg-slate-950 text-white">
      <p className="animate-pulse text-lg font-semibold">Abrindo o estádio…</p>
    </div>
  ),
});

interface BetRow {
  id: number;
  homeId: string;
  awayId: string;
  pick: string;
  stake: number;
  odds: number;
  status: string;
  homeGoals: number | null;
  awayGoals: number | null;
  payout: number;
}

interface Running {
  localPlayers?: boolean;
  spectator?: boolean;
  betId: number;
  home: Team;
  away: Team;
  bet: ActiveBet;
}

interface Result {
  spectator?: boolean;
  won: boolean;
  homeGoals: number;
  awayGoals: number;
  payout: number;
  stake: number;
  home: Team;
  away: Team;
  error?: string;
}

const STORAGE_KEY = "botao-brasileirao-player";
const QUICK = [10, 50, 100, 250, 500];
const START_BALANCE = 100000;

interface LocalWallet {
  balance: number;
  history: BetRow[];
  nextId: number;
}

function readWallet(): LocalWallet {
  const fallback = { balance: START_BALANCE, history: [], nextId: 1 };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved) as Partial<LocalWallet>;
    return {
      balance: Number.isFinite(parsed.balance) ? Number(parsed.balance) : START_BALANCE,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      nextId: Number.isInteger(parsed.nextId) ? Number(parsed.nextId) : 1,
    };
  } catch {
    return fallback;
  }
}

function saveWallet(wallet: LocalWallet) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
}

function Badge({ team, size = 44 }: { team: Team; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-white font-black shadow-md"
      style={{
        width: size,
        height: size,
        background: team.primary,
        color: team.text,
        boxShadow: `0 0 0 3px ${team.secondary}, 0 4px 10px rgba(0,0,0,0.4)`,
        fontSize: size * 0.3,
      }}
    >
      <img src={team.crest} alt={`Bandeira de ${team.name}`} className="h-full w-full object-cover" />
    </span>
  );
}

function pickText(pick: string, home: Team, away: Team) {
  if (pick === "home") return `${home.name} vence`;
  if (pick === "away") return `${away.name} vence`;
  return "Empate";
}

export default function BotaoApp() {
  const [balance, setBalance] = useState(0);
  const [history, setHistory] = useState<BetRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [homeId, setHomeId] = useState("bra");
  const [awayId, setAwayId] = useState("arg");
  const [pick, setPick] = useState<Pick>("home");
  const [stakeText, setStakeText] = useState("50");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [running, setRunning] = useState<Running | null>(null);
  const [spectator, setSpectator] = useState(false);
  const [localPlayers, setLocalPlayers] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const home = getTeam(homeId)!;
  const away = getTeam(awayId)!;
  const odds = useMemo(() => computeOdds(home, away), [home, away]);

  useEffect(() => {
    const wallet = readWallet();
    // Uma partida abandonada conta como derrota, como no comportamento original.
    wallet.history = wallet.history.map((b) => b.status === "open" ? { ...b, status: "lost" } : b);
    saveWallet(wallet);
    const timer = window.setTimeout(() => {
      setBalance(wallet.balance);
      setHistory(wallet.history);
      setLoading(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function refillWallet() {
    const wallet = readWallet();
    wallet.balance = START_BALANCE;
    saveWallet(wallet);
    setBalance(wallet.balance);
    setHistory(wallet.history);
  }

  const stakeCents = Math.round((parseFloat(stakeText.replace(",", ".")) || 0) * 100);
  const chosenOdds = odds[pick];
  const potential = Math.round(stakeCents * chosenOdds);

  function selectTeam(side: "home" | "away", id: string) {
    if (side === "home") {
      if (id === awayId) setAwayId(homeId);
      setHomeId(id);
    } else {
      if (id === homeId) setHomeId(awayId);
      setAwayId(id);
    }
  }

  function randomMatch() {
    const a = Math.floor(Math.random() * TEAMS.length);
    let b = Math.floor(Math.random() * TEAMS.length);
    while (b === a) b = Math.floor(Math.random() * TEAMS.length);
    setHomeId(TEAMS[a].id);
    setAwayId(TEAMS[b].id);
  }

  function startMatch() {
    setError(null);
    if (!spectator) {
      setResult(null);
      setRunning({ betId: 0, home, away, spectator: false, localPlayers, bet: { pick: "home", stake: 0, odds: 0 } });
      return;
    }
    if (stakeCents < 100) return setError("Aposta mínima: R$ 1,00.");
    if (stakeCents > balance) return setError("Saldo insuficiente.");
    setBusy(true);
    try {
      const wallet = readWallet();
      wallet.history = wallet.history.map((b) => b.status === "open" ? { ...b, status: "lost" } : b);
      if (stakeCents > wallet.balance) throw new Error("Saldo insuficiente.");
      const betRow: BetRow = {
        id: wallet.nextId++, homeId, awayId, pick, stake: stakeCents,
        odds: chosenOdds, status: "open", homeGoals: null, awayGoals: null, payout: 0,
      };
      wallet.balance -= stakeCents;
      wallet.history = [betRow, ...wallet.history].slice(0, 50);
      saveWallet(wallet);
      setBalance(wallet.balance);
      setHistory(wallet.history);
      setResult(null);
      setRunning({
        betId: betRow.id,
        spectator: true,
        home,
        away,
        bet: { pick, stake: betRow.stake, odds: betRow.odds },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao apostar.");
    } finally {
      setBusy(false);
    }
  }

  function finishMatch(hg: number, ag: number) {
    const r = running;
    if (!r) return;
    setRunning(null);
    if (r.bet.stake === 0) {
      setResult({ spectator: true, won: false, homeGoals: hg, awayGoals: ag, payout: 0, stake: 0, home: r.home, away: r.away });
      return;
    }
    try {
      const wallet = readWallet();
      const bet = wallet.history.find((b) => b.id === r.betId);
      if (!bet || bet.status !== "open") throw new Error("Aposta não encontrada.");
      const won = resultOf(hg, ag) === bet.pick;
      const payout = won ? Math.round(bet.stake * bet.odds) : 0;
      bet.status = won ? "won" : "lost";
      bet.homeGoals = hg;
      bet.awayGoals = ag;
      bet.payout = payout;
      wallet.balance += payout;
      saveWallet(wallet);
      setBalance(wallet.balance);
      setHistory([...wallet.history]);
      setResult({
        won,
        homeGoals: hg,
        awayGoals: ag,
        payout,
        stake: r.bet.stake,
        home: r.home,
        away: r.away,
      });
    } catch (e) {
      setResult({
        won: false,
        homeGoals: hg,
        awayGoals: ag,
        payout: 0,
        stake: r.bet.stake,
        home: r.home,
        away: r.away,
        error: e instanceof Error ? e.message : "Erro.",
      });
    }
  }

  function exitMatch() {
    if (running) {
      const wallet = readWallet();
      const bet = wallet.history.find((b) => b.id === running.betId);
      if (bet?.status === "open") bet.status = "lost";
      saveWallet(wallet);
      setHistory([...wallet.history]);
      setBalance(wallet.balance);
    }
    setRunning(null);
  }

  if (running) {
    return (
      <GameView
        key={running.betId}
        home={running.home}
        away={running.away}
        bet={running.bet}
        spectator={running.spectator}
        localPlayers={running.localPlayers}
        onFinish={finishMatch}
        onExit={exitMatch}
      />
    );
  }

  const canBet = !busy && !loading && stakeCents >= 100 && stakeCents <= balance;

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,#0f3d24_0%,#07130d_55%,#030806_100%)] text-white">
      {/* linhas de campo decorativas */}
      <div className="pointer-events-none fixed inset-0 opacity-[0.05]">
        <div className="absolute left-1/2 top-1/2 h-[80vmin] w-[80vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border-[6px] border-white" />
        <div className="absolute inset-y-0 left-1/2 w-[6px] -translate-x-1/2 bg-white" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white text-2xl shadow-lg ring-4 ring-emerald-500/60">
              ⚽
            </span>
            <div>
              <h1 className="text-2xl font-black leading-none tracking-tight sm:text-3xl">
                Copa <span className="text-emerald-400">Botão 2026</span>
              </h1>
              <p className="text-xs text-white/60 sm:text-sm">Futebol de botão · jogar ou assistir · 48 seleções</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white/10 px-4 py-2 ring-1 ring-white/15 backdrop-blur">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Saldo</p>
              <p className="text-xl font-black tabular-nums text-amber-300">{loading ? "…" : formatBRL(balance)}</p>
            </div>
            {!loading && balance < 1000 && (
              <button
                onClick={refillWallet}
                className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold shadow-lg hover:bg-emerald-400"
              >
                Recarregar R$ 1.000
              </button>
            )}
          </div>
        </header>

        <div className="mt-6 flex flex-wrap gap-3" aria-label="Modo de partida">
          <button onClick={() => { setSpectator(false); setLocalPlayers(false); }} aria-pressed={!spectator && !localPlayers} className={`rounded-xl px-5 py-3 font-bold ${!spectator && !localPlayers ? "bg-emerald-500 text-slate-950" : "bg-white/10"}`}>Jogar — você x CPU</button>
          <button onClick={() => { setSpectator(false); setLocalPlayers(true); }} aria-pressed={localPlayers} className={`rounded-xl px-5 py-3 font-bold ${localPlayers ? "bg-emerald-500 text-slate-950" : "bg-white/10"}`}>2 jogadores — local</button>
          <button onClick={() => { setSpectator(true); setLocalPlayers(false); }} aria-pressed={spectator} className={`rounded-xl px-5 py-3 font-bold ${spectator ? "bg-emerald-500 text-slate-950" : "bg-white/10"}`}>Assistir — CPU x CPU</button>
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          {/* Confronto */}
          <section className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{spectator ? "1. Escolha as duas seleções" : "1. Escolha sua seleção e o adversário"}</h2>
              <button
                onClick={randomMatch}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20"
              >
                🎲 Sortear
              </button>
            </div>

            <div className="mt-5 flex items-center justify-around gap-2 rounded-2xl bg-black/30 p-4">
              <div className="flex flex-col items-center gap-2 text-center">
                <Badge team={home} size={72} />
                <p className="font-bold">{home.name}</p>
                <StrengthBar value={home.strength} />
              </div>
              <span className="text-2xl font-black text-white/50">x</span>
              <div className="flex flex-col items-center gap-2 text-center">
                <Badge team={away} size={72} />
                <p className="font-bold">{away.name}</p>
                <StrengthBar value={away.strength} />
              </div>
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <TeamPicker title={localPlayers ? "Jogador 1" : spectator ? "Mandante (CPU)" : "Você controla"} value={homeId} other={awayId} onPick={(id) => selectTeam("home", id)} />
              <TeamPicker title={localPlayers ? "Jogador 2" : "Adversário (CPU)"} value={awayId} other={homeId} onPick={(id) => selectTeam("away", id)} />
            </div>
          </section>

          {/* Aposta */}
          <section className="space-y-6">
            {!spectator ? <div className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur">
              <h2 className="text-lg font-bold">2. Jogue a partida</h2>
              <p className="mt-3 text-white/70">{localPlayers ? "Dois jogadores no mesmo aparelho, alternando as jogadas. Na sua vez, toque em um botão da sua seleção, puxe para trás e solte." : "Você controla sua seleção: toque em um botão, puxe para trás e solte para chutar."}</p>
              <button onClick={startMatch} className="mt-5 w-full rounded-2xl bg-emerald-500 py-4 text-lg font-black text-slate-950 hover:bg-emerald-400">Jogar no estádio ⚽</button>
              <p className="mt-2 text-center text-xs text-white/50">Sem aposta e sem gastar saldo.</p>
            </div> : <div className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur">
              <h2 className="text-lg font-bold">2. Faça sua aposta</h2>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {(
                  [
                    ["home", home.short, "Casa"],
                    ["draw", "EMP", "Empate"],
                    ["away", away.short, "Fora"],
                  ] as const
                ).map(([key, label, sub]) => (
                  <button
                    key={key}
                    onClick={() => setPick(key)}
                    className={`rounded-2xl p-3 text-center ring-2 transition ${
                      pick === key
                        ? "bg-emerald-500/25 ring-emerald-400"
                        : "bg-black/30 ring-transparent hover:bg-white/10"
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-widest text-white/60">{sub}</p>
                    <p className="text-lg font-black">{label}</p>
                    <p className="text-xl font-black text-amber-300">{odds[key].toFixed(2)}</p>
                  </button>
                ))}
              </div>

              <label className="mt-5 block text-sm font-semibold text-white/80">Valor da aposta (R$)</label>
              <div className="mt-1.5 flex items-center rounded-xl bg-black/40 ring-1 ring-white/15 focus-within:ring-emerald-400">
                <span className="pl-4 text-lg font-bold text-white/60">R$</span>
                <input
                  inputMode="decimal"
                  value={stakeText}
                  onChange={(e) => setStakeText(e.target.value.replace(/[^0-9.,]/g, ""))}
                  className="w-full bg-transparent px-3 py-3 text-xl font-bold outline-none"
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    onClick={() => setStakeText(String(q))}
                    className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20"
                  >
                    {q}
                  </button>
                ))}
                <button
                  onClick={() => setStakeText(String(Math.floor(balance / 100)))}
                  className="rounded-lg bg-amber-400/90 px-3 py-1.5 text-sm font-bold text-slate-900 hover:bg-amber-300"
                >
                  Tudo
                </button>
              </div>

              <div className="mt-5 rounded-2xl bg-black/30 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/60">Palpite</span>
                  <span className="font-semibold">{pickText(pick, home, away)}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-white/60">Cotação</span>
                  <span className="font-semibold">{chosenOdds.toFixed(2)}x</span>
                </div>
                <div className="mt-1 flex justify-between text-base">
                  <span className="text-white/60">Retorno possível</span>
                  <span className="font-black text-amber-300">{formatBRL(potential)}</span>
                </div>
              </div>

              {error && <p className="mt-3 rounded-lg bg-rose-500/20 px-3 py-2 text-sm text-rose-200">{error}</p>}

              <button
                disabled={!canBet}
                onClick={startMatch}
                className="mt-5 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-green-400 py-4 text-lg font-black text-slate-950 shadow-xl transition enabled:hover:scale-[1.01] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Apostando…" : "Apostar e assistir — CPU x CPU ⚽"}
              </button>
              <p className="mt-2 text-center text-xs text-white/40">
                Dinheiro fictício. Se sair da partida antes do fim, a aposta é perdida.
              </p>
            </div>

            }
            <div className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur">
              <h2 className="text-lg font-bold">Últimas apostas</h2>
              {history.length === 0 ? (
                <p className="mt-3 text-sm text-white/50">Nenhuma aposta ainda.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {history.slice(0, 6).map((b) => {
                    const h = getTeam(b.homeId);
                    const a = getTeam(b.awayId);
                    if (!h || !a) return null;
                    return (
                      <li key={b.id} className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2 text-sm">
                        <div>
                          <p className="font-semibold">
                            {h.short} {b.homeGoals ?? "-"} x {b.awayGoals ?? "-"} {a.short}
                          </p>
                          <p className="text-xs text-white/50">
                            {pickText(b.pick, h, a)} · {formatBRL(b.stake)} @ {b.odds.toFixed(2)}
                          </p>
                        </div>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-bold ${
                            b.status === "won"
                              ? "bg-emerald-500/25 text-emerald-300"
                              : b.status === "open"
                                ? "bg-amber-500/25 text-amber-200"
                                : "bg-rose-500/25 text-rose-300"
                          }`}
                        >
                          {b.status === "won" ? `+${formatBRL(b.payout - b.stake)}` : b.status === "open" ? "Aberta" : `-${formatBRL(b.stake)}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      {result && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 p-7 text-center shadow-2xl ring-1 ring-white/15">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/50">Fim de jogo</p>
            <div className="mt-4 flex items-center justify-center gap-4">
              <Badge team={result.home} size={56} />
              <p className="text-4xl font-black tabular-nums">
                {result.homeGoals} <span className="text-white/40">x</span> {result.awayGoals}
              </p>
              <Badge team={result.away} size={56} />
            </div>
            {result.spectator ? <p className="mt-6 text-lg font-bold text-emerald-300">{result.homeGoals === result.awayGoals ? "A partida terminou empatada." : `${result.homeGoals > result.awayGoals ? result.home.name : result.away.name} venceu!`}</p> : result.error ? (
              <p className="mt-6 rounded-lg bg-rose-500/20 px-3 py-2 text-sm text-rose-200">{result.error}</p>
            ) : result.won ? (
              <div className="mt-6">
                <p className="text-3xl font-black text-emerald-400">VOCÊ GANHOU! 🎉</p>
                <p className="mt-2 text-white/70">Lucro de</p>
                <p className="text-4xl font-black text-amber-300">{formatBRL(result.payout - result.stake)}</p>
              </div>
            ) : (
              <div className="mt-6">
                <p className="text-3xl font-black text-rose-400">Não foi dessa vez</p>
                <p className="mt-2 text-white/70">Você perdeu</p>
                <p className="text-4xl font-black text-rose-300">{formatBRL(result.stake)}</p>
              </div>
            )}
            <p className="mt-5 text-sm text-white/60">
              Saldo atual: <span className="font-bold text-white">{formatBRL(balance)}</span>
            </p>
            <button
              onClick={() => setResult(null)}
              className="mt-6 w-full rounded-2xl bg-emerald-500 py-3 text-lg font-black text-slate-950 hover:bg-emerald-400"
            >
              {result.stake === 0 ? "Jogar outra partida" : "Nova aposta"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function StrengthBar({ value }: { value: number }) {
  return (
    <div className="w-28">
      <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400"
          style={{ width: `${((value - 50) / 45) * 100}%` }}
        />
      </div>
      <p className="mt-0.5 text-[10px] uppercase tracking-widest text-white/50">Força {value}</p>
    </div>
  );
}

function TeamPicker({
  title,
  value,
  other,
  onPick,
}: {
  title: string;
  value: string;
  other: string;
  onPick: (id: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/50">{title}</p>
      <div className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
        {TEAMS.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t.id)}
            className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm font-semibold ring-2 transition ${
              value === t.id
                ? "bg-emerald-500/25 ring-emerald-400"
                : t.id === other
                  ? "bg-black/20 opacity-50 ring-transparent"
                  : "bg-black/30 ring-transparent hover:bg-white/10"
            }`}
          >
            <Badge team={t} size={26} />
            <span className="truncate">{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
