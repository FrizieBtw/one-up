import { schema, t, type SchemaType } from "@colyseus/schema";
import type { ClockTimer, Delayed } from "@colyseus/timer";
import {
  POINTS,
  createDeck,
  dealerShouldHit,
  handValue,
  isNatural,
  resolveHand,
  shuffle,
  type Card as RuleCard,
  type HandResult,
  type Rank,
} from "@stepup/blackjack";
import {
  BLACKJACK_BET_SECONDS,
  BLACKJACK_CHIPS,
  BLACKJACK_MAX_BET,
  BLACKJACK_MIN_BET,
  BLACKJACK_NEXT_ROUND_SECONDS,
} from "@stepup/shared";

export const Card = schema({ rank: t.string(), suit: t.string() }, "Card");
export type Card = SchemaType<typeof Card>;

export const BlackjackPlayer = schema(
  {
    name: t.string(),
    cards: t.array(Card),
    status: t.string().default("playing"),
    result: t.string().default(""),
    // Seconde main (après une séparation) : ses cartes, son statut et son résultat ; `hand` : main jouée en ce moment.
    cards2: t.array(Card),
    status2: t.string().default(""),
    result2: t.string().default(""),
    hand: t.uint8().default(0),
    canSplit: t.boolean().default(false),
    canDouble: t.boolean().default(false),
    // Mises (jetons du portefeuille) : mise de la manche et de la seconde main, jetons rendus en fin de manche, solde connu (-1 : jeu sans mise).
    bet: t.uint32().default(0),
    bet2: t.uint32().default(0),
    // Jetons posés pour chaque main (valeurs séparées par des virgules) : tous les joueurs voient les jetons exacts misés.
    chips: t.string().default(""),
    chips2: t.string().default(""),
    payout: t.uint32().default(0),
    // Gain net de la dernière manche (jetons rendus moins mises) : reste affiché pendant la phase de mise suivante.
    net: t.int32().default(0),
    staked: t.boolean().default(false),
    balance: t.int32().default(-1),
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
    // Numéro de distribution : les cartes de la table repartent du sabot quand il change (pas à l'ouverture des mises).
    dealNo: t.uint16().default(0),
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

/** Remet la table à zéro (nouvelle partie) : plus de mains, de cartes du croupier ni de manche en cours. */
export function resetBlackjackState(state: BlackjackState) {
  state.players.clear();
  state.dealer.clear();
  state.dealerHidden = false;
  state.round = 0;
  state.stage = "finished";
  state.turn = "";
  state.seconds = 0;
}

/** Portefeuille des joueurs : le serveur de salon branche ici la base de données. Sans `bank`, la partie se joue sans mise. */
export interface Bank {
  /** Solde connu d'un joueur, ou null s'il n'a pas de portefeuille (invité, base indisponible) : il joue sans mise. */
  balance(sessionId: string): number | null;
  /** Débite la mise ; faux si refusée (solde insuffisant, erreur). */
  debit(sessionId: string, amount: number, ref: string): Promise<boolean>;
  /** Verse des jetons (gain, mise rendue). */
  credit(sessionId: string, amount: number, ref: string): void;
}

/** Points de réglage, surchargés par les tests (paquet truqué, temps accéléré). */
export const tuning = {
  deck: (): RuleCard[] => shuffle(createDeck()),
  tickMs: 1000,
  dealerStepMs: 700,
  /** Délai avant la première manche : le temps que la table descende dans la chambre. */
  introMs: 7000,
};

const ranks = (cards: Iterable<Card>) =>
  [...cards].map((card) => ({ rank: card.rank as Rank }));

/**
 * Partie de Blackjack, autoritaire. Les joueurs jouent l'un après l'autre contre le croupier.
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
    private options: {
      decisionSeconds: number;
      onFinished: () => void;
      seatOf: (sessionId: string) => number;
      /** Mises : portefeuille des joueurs, et préfixe des références des mouvements (idempotence). */
      bank?: Bank;
      ref?: string;
    },
  ) {}

  /** Joueurs en train de miser (débit en cours) : un joueur ne peut miser qu'une fois par manche. */
  private betting = new Set<string>();

  private ref(sessionId: string, kind: string) {
    return `${this.options.ref ?? "table"}:${this.state.round}:${sessionId}:${kind}`;
  }

  /** `players` : session → nom, dans l'ordre de jeu. */
  start(players: Map<string, string>) {
    this.state.players.clear();
    for (const [sessionId, name] of players)
      this.state.players.set(sessionId, new BlackjackPlayer({ name }));
    this.state.round = 0;
    this.ticker = this.clock.setInterval(() => this.tick(), tuning.tickMs);
    this.startRound();
  }

  action(
    sessionId: string,
    action: "hit" | "stand" | "split" | "double",
  ): boolean {
    const player = this.state.players.get(sessionId);
    if (
      this.state.stage !== "playing" ||
      this.state.turn !== sessionId ||
      !player
    )
      return false;
    if (action === "split") {
      if (!player.canSplit) return false;
      const bank = this.options.bank;
      if (!bank || player.balance < 0 || player.bet === 0) {
        this.split(player);
        return true;
      }
      // Séparer exige une seconde mise égale à la première, débitée avant de séparer.
      if (player.balance < player.bet) return false;
      player.canSplit = false;
      player.canDouble = false;
      const epoch = this.epoch;
      void bank
        .debit(sessionId, player.bet, this.ref(sessionId, "split"))
        .then((ok) => {
          if (!ok || epoch !== this.epoch || this.state.turn !== sessionId) {
            if (ok)
              bank.credit(
                sessionId,
                player.bet,
                this.ref(sessionId, "split-refund"),
              );
            else {
              player.canSplit = this.canSplit(player);
              player.canDouble = this.canDouble(player);
            }
            return;
          }
          player.balance -= player.bet;
          player.bet2 = player.bet;
          player.chips2 = player.chips;
          this.split(player);
        });
      return true;
    }
    if (action === "double") {
      if (!player.canDouble) return false;
      const hand = player.hand;
      const stake = hand === 1 ? player.bet2 : player.bet;
      const bank = this.options.bank;
      if (!bank || player.balance < 0 || stake === 0) {
        this.doubleDown(player);
        return true;
      }
      // Doubler : la mise de la main est doublée (débit de la même somme) avant de tirer une seule carte.
      if (player.balance < stake) return false;
      player.canSplit = false;
      player.canDouble = false;
      const epoch = this.epoch;
      void bank
        .debit(sessionId, stake, this.ref(sessionId, `double${hand}`))
        .then((ok) => {
          if (
            !ok ||
            epoch !== this.epoch ||
            this.state.turn !== sessionId ||
            player.hand !== hand
          ) {
            if (ok)
              bank.credit(
                sessionId,
                stake,
                this.ref(sessionId, `double${hand}-refund`),
              );
            else player.canDouble = this.canDouble(player);
            return;
          }
          player.balance -= stake;
          // Mise doublée : les mêmes jetons sont posés une seconde fois.
          if (hand === 1) {
            player.bet2 += stake;
            player.chips2 = [player.chips2, player.chips2]
              .filter(Boolean)
              .join(",");
          } else {
            player.bet += stake;
            player.chips = [player.chips, player.chips]
              .filter(Boolean)
              .join(",");
          }
          this.doubleDown(player);
        });
      return true;
    }
    player.canSplit = false;
    player.canDouble = false;
    const second = player.hand === 1;
    if (action === "stand") {
      if (second) player.status2 = "stood";
      else player.status = "stood";
    } else {
      const cards = second ? player.cards2 : player.cards;
      cards.push(this.draw());
      const { total } = handValue(ranks(cards));
      const status = total > 21 ? "bust" : total === 21 ? "stood" : "playing";
      if (second) player.status2 = status;
      else player.status = status;
    }
    this.continueTurn(player);
    return true;
  }

  /** Doubler : une seule carte pour la main jouée, puis le joueur reste (ou dépasse 21). */
  private doubleDown(player: BlackjackPlayer) {
    const second = player.hand === 1;
    const cards = second ? player.cards2 : player.cards;
    cards.push(this.draw());
    const status = handValue(ranks(cards)).total > 21 ? "bust" : "stood";
    if (second) player.status2 = status;
    else player.status = status;
    player.canSplit = false;
    player.canDouble = false;
    this.continueTurn(player);
  }

  /** Doubler est possible sur une main de deux cartes, si le solde couvre la mise de cette main. */
  private canDouble(player: BlackjackPlayer): boolean {
    const hand = this.activeHand(player);
    if (hand < 0) return false;
    const cards = hand === 1 ? player.cards2 : player.cards;
    if (cards.length !== 2) return false;
    const stake = hand === 1 ? player.bet2 : player.bet;
    return stake === 0 || player.balance >= stake;
  }

  /** Sépare une paire : chaque carte forme sa main, qui reçoit aussitôt une seconde carte ; la première main se joue d'abord. */
  private split(player: BlackjackPlayer) {
    const moved = player.cards.pop()!;
    player.cards2.push(new Card({ rank: moved.rank, suit: moved.suit }));
    player.cards.push(this.draw());
    player.cards2.push(this.draw());
    // Un 21 après séparation n'est pas un blackjack : la main s'arrête simplement.
    const settle = (cards: Iterable<Card>) =>
      handValue(ranks(cards)).total === 21 ? "stood" : "playing";
    player.status = settle(player.cards);
    player.status2 = settle(player.cards2);
    player.canSplit = false;
    this.continueTurn(player);
  }

  /** Main du joueur qui doit encore jouer (0 ou 1), ou -1 s'il a fini. */
  private activeHand(player: BlackjackPlayer): number {
    if (player.status === "playing") return 0;
    if (player.cards2.length > 0 && player.status2 === "playing") return 1;
    return -1;
  }

  /** Après une action : le joueur continue avec sa main, passe à sa seconde main, ou son tour est fini. */
  private continueTurn(player: BlackjackPlayer) {
    const hand = this.activeHand(player);
    if (hand < 0) return this.advance();
    player.hand = hand;
    player.canDouble = this.canDouble(player);
    this.state.seconds = this.options.decisionSeconds;
  }

  /** Une paire (même valeur) sur la première main, pas encore séparée. */
  private canSplit(player: BlackjackPlayer): boolean {
    if (
      player.status !== "playing" ||
      player.cards2.length > 0 ||
      player.cards.length !== 2
    )
      return false;
    // Avec une mise, la seconde main doit pouvoir être payée.
    if (player.bet > 0 && player.balance < player.bet) return false;
    // Deux cartes de même valeur (règle de casino courante) : un 10 et un valet se séparent, comme deux rois.
    const value = (card: Card) =>
      handValue([{ rank: card.rank as Rank }]).total;
    return value(player.cards[0]!) === value(player.cards[1]!);
  }

  /** Mise d'un joueur pour la manche (étape de mise) : débite son portefeuille ; la distribution part dès que tous ont misé. */
  async bet(
    sessionId: string,
    amount: number,
    chips?: readonly number[],
  ): Promise<boolean> {
    const { state } = this;
    const player = state.players.get(sessionId);
    const bank = this.options.bank;
    if (
      state.stage !== "betting" ||
      !player ||
      !bank ||
      player.balance < 0 ||
      player.bet > 0 ||
      this.betting.has(sessionId) ||
      !Number.isInteger(amount) ||
      amount < BLACKJACK_MIN_BET ||
      amount > Math.min(BLACKJACK_MAX_BET, player.balance)
    )
      return false;
    this.betting.add(sessionId);
    const epoch = this.epoch;
    const ok = await bank.debit(sessionId, amount, this.ref(sessionId, "bet"));
    this.betting.delete(sessionId);
    if (!ok) return false;
    if (epoch !== this.epoch || state.stage !== "betting") {
      // L'étape de mise s'est terminée pendant le débit : mise rendue.
      bank.credit(sessionId, amount, this.ref(sessionId, "bet-refund"));
      return false;
    }
    player.bet = amount;
    player.chips = this.chipsFor(amount, chips).join(",");
    player.balance -= amount;
    if (this.everyoneBet()) this.deal();
    return true;
  }

  /** Jetons d'une mise : ceux choisis par le joueur s'ils sont valides et font bien la mise, sinon une découpe automatique. */
  private chipsFor(amount: number, chosen?: readonly number[]): number[] {
    const allowed: readonly number[] = BLACKJACK_CHIPS;
    if (
      chosen?.length &&
      chosen.every((c) => allowed.includes(c)) &&
      chosen.reduce((sum, c) => sum + c, 0) === amount
    )
      return [...chosen];
    const out: number[] = [];
    let rest = amount;
    for (const value of [...allowed].sort((a, b) => b - a)) {
      for (; rest >= value; rest -= value) out.push(value);
    }
    return out;
  }

  /** Tous les joueurs qui peuvent miser ont misé. */
  private everyoneBet(): boolean {
    return [...this.state.players.values()].every(
      (p) => p.balance < BLACKJACK_MIN_BET || p.bet > 0,
    );
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
  /** Un joueur s'assoit entre deux manches : il est servi à la manche suivante. */
  addPlayer(sessionId: string, name: string) {
    if (
      (this.state.stage !== "roundEnd" && this.state.stage !== "betting") ||
      this.state.players.has(sessionId)
    )
      return;
    this.state.players.set(
      sessionId,
      new BlackjackPlayer({
        name,
        status: "stood",
        balance: this.options.bank?.balance(sessionId) ?? -1,
      }),
    );
  }

  /** Joueurs dans l'ordre des places de la table (c'est l'ordre de jeu). */
  private ordered(): [string, BlackjackPlayer][] {
    // Comme à une vraie table : on sert et on joue en partant du joueur à la gauche du croupier (la place la plus haute), puis vers sa droite.
    return [...this.state.players].sort(
      ([a], [b]) => this.options.seatOf(b) - this.options.seatOf(a),
    );
  }

  removePlayer(sessionId: string) {
    if (!this.state.players.has(sessionId)) return;
    const hadTurn =
      this.state.stage === "playing" && this.state.turn === sessionId;
    const successor = hadTurn ? this.nextPlaying(sessionId) : undefined;
    const leaving = this.state.players.get(sessionId);
    // Parti avant la distribution : sa mise lui est rendue.
    if (leaving && this.state.stage === "betting" && leaving.bet > 0)
      this.options.bank?.credit(
        sessionId,
        leaving.bet,
        this.ref(sessionId, "bet-refund"),
      );
    this.state.players.delete(sessionId);
    // Plus personne à la table : la partie s'arrête en plein tour ; entre deux manches elle attend simplement qu'un joueur s'asseye.
    if (this.state.players.size === 0 && this.state.stage !== "roundEnd")
      return this.dispose();
    if (hadTurn) this.giveTurn(successor);
    // Parti pendant la phase de mise : si tous les joueurs restants ont misé, la distribution part.
    else if (this.state.stage === "betting" && this.everyoneBet()) this.deal();
  }

  /** Arrêt de la partie par l'hôte : les mises de la manche en cours sont rendues, puis la table s'arrête. */
  abort() {
    if (this.state.stage !== "roundEnd" && this.state.stage !== "finished")
      for (const [sessionId, player] of this.state.players)
        if (player.bet + player.bet2 > 0)
          this.options.bank?.credit(
            sessionId,
            player.bet + player.bet2,
            this.ref(sessionId, "abort-refund"),
          );
    this.dispose();
  }

  /** Remet la table à zéro (plus de manche, de mains ni de cartes du croupier) : la partie attend de nouveaux joueurs. */
  reset() {
    this.dispose();
    resetBlackjackState(this.state);
  }

  dispose() {
    this.epoch++;
    this.ticker?.clear();
    this.ticker = null;
  }

  /** Tire une carte ; avec beaucoup de joueurs le sabot peut s'épuiser, on le remplace alors par un sabot neuf. */
  private pullCard(): RuleCard {
    if (this.deck.length === 0) this.deck = tuning.deck();
    return this.deck.shift()!;
  }

  private draw(): Card {
    return new Card(this.pullCard());
  }

  /** `keepTable` : on enchaîne sur la phase de mise sans effacer les cartes ni le résultat de la manche qui vient de finir. */
  private startRound(keepTable = false) {
    const { state } = this;
    // Personne d'assis : pas de manche, on attend (le compte à rebours repart).
    if (state.players.size === 0) {
      state.stage = "roundEnd";
      state.seconds = BLACKJACK_NEXT_ROUND_SECONDS;
      return;
    }
    this.epoch++;
    state.round++;
    // Paquet neuf à chaque manche : pas de comptage de cartes possible.
    this.deck = tuning.deck();
    if (!keepTable) this.clearTable();
    const bank = this.options.bank;
    for (const [sessionId, player] of state.players) {
      player.bet = 0;
      player.bet2 = 0;
      player.chips = "";
      player.chips2 = "";
      // Le solde suivi ici fait foi (le versement des gains n'est pas encore revenu de la base) ; la base ne sert que pour un nouveau joueur.
      if (player.balance < 0) player.balance = bank?.balance(sessionId) ?? -1;
    }
    // Des mises sont possibles : étape de mise avant la distribution (sans portefeuille, on distribue tout de suite).
    const canBet = [...state.players.values()].some(
      (p) => p.balance >= BLACKJACK_MIN_BET,
    );
    if (bank && canBet) {
      state.stage = "betting";
      state.turn = "";
      state.seconds = BLACKJACK_BET_SECONDS;
      return;
    }
    this.deal();
  }

  /** Efface la table : cartes du croupier et des joueurs, résultats et gains de la manche précédente. */
  private clearTable() {
    const { state } = this;
    state.dealer.clear();
    state.dealerHidden = false;
    for (const player of state.players.values()) {
      player.cards.clear();
      player.cards2.clear();
      player.result = "";
      player.status2 = "";
      player.result2 = "";
      player.hand = 0;
      player.canSplit = false;
      player.canDouble = false;
      player.payout = 0;
      player.net = 0;
      player.staked = false;
    }
  }

  /** Distribue la manche (après les mises). Qui n'a pas misé alors qu'il le pouvait passe son tour. */
  private deal() {
    const { state } = this;
    this.epoch++;
    this.clearTable();
    state.dealNo++;
    for (const player of state.players.values()) {
      if (player.balance >= 0 && player.bet === 0) player.status = "out";
    }
    const playing = [...state.players.values()].some((p) => p.status !== "out");
    if (!playing) {
      // Personne n'a misé : on laisse encore le temps de miser.
      state.stage = "betting";
      state.seconds = BLACKJACK_BET_SECONDS;
      for (const player of state.players.values()) player.status = "playing";
      return;
    }
    // Distribution réglementaire : une carte à chaque joueur (dans l'ordre des places), une au croupier (visible), puis une seconde
    // carte à chaque joueur et la seconde du croupier (cachée).
    const order = this.ordered().filter(([, p]) => p.status !== "out");
    for (const [, player] of order) player.cards.push(this.draw());
    state.dealer.push(this.draw());
    for (const [, player] of order) player.cards.push(this.draw());
    this.hidden = this.pullCard();
    for (const [, player] of order)
      player.status = isNatural(ranks(player.cards)) ? "blackjack" : "playing";
    state.dealerHidden = true;
    state.stage = "playing";
    this.giveTurn(this.nextPlaying());
  }

  /** Premier joueur devant encore jouer, après `afterSessionId` dans l'ordre de la table. */
  private nextPlaying(afterSessionId?: string): string | undefined {
    let passed = afterSessionId === undefined;
    for (const [sessionId, player] of this.ordered()) {
      if (passed && this.activeHand(player) >= 0) return sessionId;
      if (sessionId === afterSessionId) passed = true;
    }
    return undefined;
  }

  private giveTurn(sessionId: string | undefined) {
    if (sessionId === undefined) return this.dealerPlay();
    this.state.turn = sessionId;
    this.state.seconds = this.options.decisionSeconds;
    const player = this.state.players.get(sessionId);
    if (player) {
      player.hand = Math.max(0, this.activeHand(player));
      player.canSplit = this.canSplit(player);
      player.canDouble = this.canDouble(player);
    }
  }

  private advance() {
    this.giveTurn(this.nextPlaying(this.state.turn));
  }

  private tick() {
    const { state } = this;
    if (
      state.stage !== "playing" &&
      state.stage !== "roundEnd" &&
      state.stage !== "betting"
    )
      return;
    if (state.seconds > 1) {
      state.seconds--;
      return;
    }
    if (state.stage === "roundEnd") return this.startRound();
    if (state.stage === "betting") return this.deal();
    // Temps de décision écoulé : action de repli sûre, le joueur reste.
    const player = state.players.get(state.turn);
    if (!player) return this.advance();
    player.canSplit = false;
    if (player.hand === 1) player.status2 = "stood";
    else player.status = "stood";
    this.continueTurn(player);
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
        const someoneStanding = [...state.players.values()].some(
          (player) =>
            player.status !== "out" &&
            (player.status !== "bust" ||
              (player.cards2.length > 0 && player.status2 !== "bust")),
        );
        if (!someoneStanding || !dealerShouldHit(ranks(state.dealer)))
          return this.resolve();
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
    for (const [sessionId, player] of state.players) {
      if (player.status === "out") continue; // n'a pas misé : ne joue pas cette manche
      let payout = 0;
      const tally = (result: HandResult, bet: number, natural: boolean) => {
        player.score += POINTS[result];
        if (result === "win") player.wins++;
        else if (result === "push") player.pushes++;
        else player.losses++;
        // Gain : la mise est rendue avec le gain (1 pour 1, 3 pour 2 sur un blackjack naturel) ; mise rendue seule en cas d'égalité.
        if (result === "win")
          payout += natural ? Math.floor(bet * 2.5) : bet * 2;
        else if (result === "push") payout += bet;
      };
      const split = player.cards2.length > 0;
      player.result = resolveHand(ranks(player.cards), dealer, split);
      tally(
        player.result as HandResult,
        player.bet,
        !split && isNatural(ranks(player.cards)),
      );
      if (split) {
        player.result2 = resolveHand(ranks(player.cards2), dealer, true);
        tally(player.result2 as HandResult, player.bet2, false);
      }
      player.staked = player.bet + player.bet2 > 0;
      player.net = payout - player.bet - player.bet2;
      if (payout > 0 && player.bet > 0) {
        player.payout = payout;
        player.balance += payout;
        this.options.bank?.credit(
          sessionId,
          payout,
          this.ref(sessionId, "payout"),
        );
      }
    }
    // Avec des mises : on passe directement à la mise suivante (les cartes et le résultat restent affichés) ; sans portefeuille, courte pause.
    if (this.options.bank && !this.noBettor()) return this.startRound(true);
    state.stage = "roundEnd";
    state.seconds = BLACKJACK_NEXT_ROUND_SECONDS;
  }

  /** Aucun joueur n'a de quoi miser (invités, solde insuffisant) : la manche suivante se joue sans mise. */
  private noBettor(): boolean {
    return ![...this.state.players.values()].some(
      (p) => p.balance >= BLACKJACK_MIN_BET,
    );
  }

  private finish() {
    this.dispose();
    this.state.stage = "finished";
    this.state.turn = "";
    this.state.seconds = 0;
    this.options.onFinished();
  }
}
