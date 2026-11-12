import { schema, t, type SchemaType } from "@colyseus/schema";
import type { ClockTimer, Delayed } from "@colyseus/timer";
import { POINTS, createDeck, dealerShouldHit, handValue, isNatural, resolveHand, shuffle, type Card as RuleCard, type Rank } from "@stepup/blackjack";
import { BLACKJACK_NEXT_ROUND_SECONDS } from "@stepup/shared";

export const Card = schema({ rank: t.string(), suit: t.string() }, "Card");
export type Card = SchemaType<typeof Card>;

export const BlackjackPlayer = schema(
  {
    name: t.string(),
    cards: t.array(Card),
    status: t.string().default("playing"),
    result: t.string().default(""),
    score: t.uint16().default(0),
    wins: t.uint16().default(0),
    pushes: t.uint16().default(0),
    losses: t.uint16().default(0),
  },
  "BlackjackPlayer",
);
export type BlackjackPlayer = SchemaType<typeof BlackjackPlayer>;

export const BlackjackState = schema(
  {
    round: t.uint16().default(0),
    stage: t.string().default("finished"),
    turn: t.string().default(""),
    seconds: t.uint8().default(0),
    dealer: t.array(Card),
    dealerHidden: t.boolean().default(false),
    players: t.map(BlackjackPlayer),
  },
  "BlackjackState",
);
export type BlackjackState = SchemaType<typeof BlackjackState>;

/** Points de réglage, surchargés par les tests (paquet truqué, temps accéléré). */
export const tuning = {
  deck: (): RuleCard[] => shuffle(createDeck()),
  tickMs: 1000,
  dealerStepMs: 700,
};

const ranks = (cards: Iterable<Card>) => [...cards].map((card) => ({ rank: card.rank as Rank }));

/**
 * Partie de Blackjack Battle, autoritaire. Les joueurs jouent l'un après l'autre contre le croupier.
 * - Temps de décision écoulé (ou joueur déconnecté) : le joueur reste automatiquement, la table n'est jamais bloquée.
 * - Entre deux manches, l'hôte enchaîne ou termine ; sans décision, la manche suivante démarre seule.
 * - La carte cachée du croupier n'est jamais envoyée aux clients avant sa révélation.
 */
export class BlackjackGame {
  private deck: RuleCard[] = [];
  private hidden: RuleCard | null = null;
  /** Invalide les étapes différées (croupier) quand la partie a changé d'étape entre-temps. */
  private epoch = 0;
  private ticker: Delayed | null = null;

  constructor(
    private state: BlackjackState,
    private clock: ClockTimer,
    private options: { decisionSeconds: number; onFinished: () => void },
  ) {}

  /** `players` : session → nom, dans l'ordre de jeu. */
  start(players: Map<string, string>) {
    this.state.players.clear();
    for (const [sessionId, name] of players) this.state.players.set(sessionId, new BlackjackPlayer({ name }));
    this.state.round = 0;
    this.ticker = this.clock.setInterval(() => this.tick(), tuning.tickMs);
    this.startRound();
  }

  action(sessionId: string, action: "hit" | "stand"): boolean {
    const player = this.state.players.get(sessionId);
    if (this.state.stage !== "playing" || this.state.turn !== sessionId || !player) return false;
    if (action === "stand") {
      player.status = "stood";
      this.advance();
      return true;
    }
    player.cards.push(this.draw());
    const { total } = handValue(ranks(player.cards));
    if (total > 21) player.status = "bust";
    else if (total === 21) player.status = "stood";
    if (player.status === "playing") this.state.seconds = this.options.decisionSeconds;
    else this.advance();
    return true;
  }

  next(): boolean {
    if (this.state.stage !== "roundEnd") return false;
    this.startRound();
    return true;
  }

  end(): boolean {
    if (this.state.stage !== "roundEnd") return false;
    this.finish();
    return true;
  }

  /** Départ définitif d'un joueur : il quitte la table, son tour passe au suivant. */
  removePlayer(sessionId: string) {
    if (!this.state.players.has(sessionId)) return;
    const hadTurn = this.state.stage === "playing" && this.state.turn === sessionId;
    const successor = hadTurn ? this.nextPlaying(sessionId) : undefined;
    this.state.players.delete(sessionId);
    if (this.state.players.size === 0) return this.dispose();
    if (hadTurn) this.giveTurn(successor);
  }

  dispose() {
    this.epoch++;
    this.ticker?.clear();
    this.ticker = null;
  }

  private draw(): Card {
    return new Card(this.deck.shift()!);
  }

  private startRound() {
    this.epoch++;
    const { state } = this;
    state.round++;
    this.deck = tuning.deck();
    state.dealer.clear();
    for (const player of state.players.values()) {
      player.cards.clear();
      player.cards.push(this.draw(), this.draw());
      player.result = "";
      player.status = isNatural(ranks(player.cards)) ? "blackjack" : "playing";
    }
    state.dealer.push(this.draw());
    this.hidden = this.deck.shift()!;
    state.dealerHidden = true;
    state.stage = "playing";
    this.giveTurn(this.nextPlaying());
  }

  /** Premier joueur devant encore jouer, après `afterSessionId` dans l'ordre de la table. */
  private nextPlaying(afterSessionId?: string): string | undefined {
    let passed = afterSessionId === undefined;
    for (const [sessionId, player] of this.state.players) {
      if (passed && player.status === "playing") return sessionId;
      if (sessionId === afterSessionId) passed = true;
    }
    return undefined;
  }

  private giveTurn(sessionId: string | undefined) {
    if (sessionId === undefined) return this.dealerPlay();
    this.state.turn = sessionId;
    this.state.seconds = this.options.decisionSeconds;
  }

  private advance() {
    this.giveTurn(this.nextPlaying(this.state.turn));
  }

  private tick() {
    const { state } = this;
    if (state.stage !== "playing" && state.stage !== "roundEnd") return;
    if (state.seconds > 1) {
      state.seconds--;
      return;
    }
    if (state.stage === "roundEnd") return this.startRound();
    // Temps de décision écoulé : action de repli sûre, le joueur reste.
    const player = state.players.get(state.turn);
    if (player) player.status = "stood";
    this.advance();
  }

  private dealerPlay() {
    const { state } = this;
    const epoch = ++this.epoch;
    state.stage = "dealer";
    state.turn = "";
    state.seconds = 0;
    const step = () => {
      if (epoch !== this.epoch) return;
      if (state.dealerHidden) {
        state.dealer.push(new Card(this.hidden!));
        state.dealerHidden = false;
      } else {
        // Si tous les joueurs ont dépassé 21, le croupier ne tire pas.
        const someoneStanding = [...state.players.values()].some((player) => player.status !== "bust");
        if (!someoneStanding || !dealerShouldHit(ranks(state.dealer))) return this.resolve();
        state.dealer.push(this.draw());
      }
      this.clock.setTimeout(step, tuning.dealerStepMs);
    };
    this.clock.setTimeout(step, tuning.dealerStepMs);
  }

  private resolve() {
    const { state } = this;
    this.epoch++;
    const dealer = ranks(state.dealer);
    for (const player of state.players.values()) {
      const result = resolveHand(ranks(player.cards), dealer);
      player.result = result;
      player.score += POINTS[result];
      if (result === "win") player.wins++;
      else if (result === "push") player.pushes++;
      else player.losses++;
    }
    state.stage = "roundEnd";
    state.seconds = BLACKJACK_NEXT_ROUND_SECONDS;
  }

  private finish() {
    this.dispose();
    this.state.stage = "finished";
    this.state.turn = "";
    this.state.seconds = 0;
    this.options.onFinished();
  }
}
