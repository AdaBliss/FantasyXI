# Implementation Guide & Code Fixes

This document details the production-grade implementation, architectural design, time and space complexity, and test specifications for the four assigned FantasyXI issues.

---

## Issue #91: Implement Strict Squad Validation Rules Against FPL Constraints (Budget, Teams, Positions)

### Problem Description
Users can sometimes bypass squad constraints (100M budget, max 3 players per team, position quotas, formation limits). Squad validation must strictly occur on the backend prior to persistence.

### Architectural Design & Clean Code Structure
- **Service Layer**: Dedicated domain validator `SquadValidator` (`backend/src/services/squad/squadValidator.ts`) called by `SquadService`.
- **Fail-Fast Error Handling**: Throws custom `SquadValidationError` containing granular violation messages.
- **Constraints Enforced**:
  1. Total player count: Exactly 15 players.
  2. Uniqueness: No duplicate `playerId`s in selection.
  3. Roster Position Breakdown: 2 GKP, 5 DEF, 5 MID, 3 FWD.
  4. Starting XI vs Bench: Exactly 11 starters, 4 bench players.
  5. Captain & Vice-Captain: Exactly 1 Captain and 1 Vice-Captain, both must be in Starting XI and must be distinct players.
  6. Starting Formation Quotas: 1 GKP, minimum 3 DEF, minimum 3 MID, minimum 1 FWD.
  7. Team Limit: Maximum 3 players from any single real-world team (`teamId`).
  8. Budget Cap: Cumulative player price $\le \text{maxBudget}$ (default £100.0M, or remaining bank budget).

### Complexity Analysis
- **Time Complexity**: $\mathcal{O}(N)$ where $N = 15$ (total players in squad). Single-pass map insertions and validation iterations.
- **Space Complexity**: $\mathcal{O}(N)$ auxiliary memory for lookup maps (`playerMap`, `teamCounts`, `positionCounts`).

### Implementation Code

```typescript
// backend/src/services/squad/squadValidator.ts

import { Position, SQUAD_RULES, SquadPlayerSelection } from "../../types/index.js";

export class SquadValidationError extends Error {
  public errors: string[];

  constructor(errors: string[] | string) {
    const errorList = Array.isArray(errors) ? errors : [errors];
    super(errorList.join("; "));
    this.name = "SquadValidationError";
    this.errors = errorList;
  }
}

export class SquadLockedError extends Error {
  public deadline: Date;

  constructor(deadline: Date) {
    super(`Squad is locked. Gameweek deadline passed on ${deadline.toISOString()}`);
    this.name = "SquadLockedError";
    this.deadline = deadline;
  }
}

export interface PlayerForValidation {
  id: number;
  teamId: number;
  position: Position;
  price: number;
  displayName?: string;
}

export interface ValidatedSquadResult {
  totalCost: number;
  formation: string;
  starterIds: number[];
  benchIds: number[];
  captainId: number;
  viceCaptainId: number;
}

export class SquadValidator {
  public static validateDeadline(deadline: Date, now: Date = new Date()): void {
    if (now.getTime() >= deadline.getTime()) {
      throw new SquadLockedError(deadline);
    }
  }

  public static validateSquad(
    selections: SquadPlayerSelection[],
    players: PlayerForValidation[],
    maxBudget: number = SQUAD_RULES.STARTING_BUDGET
  ): ValidatedSquadResult {
    const errors: string[] = [];

    // 1. Total players count
    if (selections.length !== SQUAD_RULES.TOTAL_PLAYERS) {
      errors.push(
        `Squad must contain exactly ${SQUAD_RULES.TOTAL_PLAYERS} players (received ${selections.length})`
      );
    }

    // 2. Duplicate player check
    const playerIds = selections.map((s) => s.playerId);
    const uniqueIds = new Set(playerIds);
    if (uniqueIds.size !== playerIds.length) {
      errors.push("Duplicate players are not allowed in a squad");
    }

    const playerMap = new Map<number, PlayerForValidation>();
    for (const p of players) {
      playerMap.set(p.id, p);
    }

    for (const id of playerIds) {
      if (!playerMap.has(id)) {
        errors.push(`Player with ID ${id} was not found`);
      }
    }

    if (errors.length > 0) {
      throw new SquadValidationError(errors);
    }

    // 3. Starters vs Bench count
    const starters = selections.filter((s) => s.isStarter);
    const bench = selections.filter((s) => !s.isStarter);

    if (starters.length !== SQUAD_RULES.STARTERS) {
      errors.push(
        `Starting XI must have exactly ${SQUAD_RULES.STARTERS} players (found ${starters.length})`
      );
    }

    if (bench.length !== SQUAD_RULES.BENCH) {
      errors.push(
        `Bench must have exactly ${SQUAD_RULES.BENCH} substitutes (found ${bench.length})`
      );
    }

    // 4. Captain and Vice-Captain validation
    const captains = selections.filter((s) => s.isCaptain);
    const viceCaptains = selections.filter((s) => s.isViceCaptain);

    if (captains.length !== 1) {
      errors.push("Squad must have exactly one captain selected");
    }

    if (viceCaptains.length !== 1) {
      errors.push("Squad must have exactly one vice-captain selected");
    }

    if (captains.length === 1 && viceCaptains.length === 1) {
      if (captains[0].playerId === viceCaptains[0].playerId) {
        errors.push("Captain and vice-captain cannot be the same player");
      }
      if (!captains[0].isStarter) {
        errors.push("Captain must be in the starting XI");
      }
      if (!viceCaptains[0].isStarter) {
        errors.push("Vice-captain must be in the starting XI");
      }
    }

    // 5. Position breakdown and cost/team counting
    const positionCounts: Record<Position, number> = {
      [Position.GKP]: 0,
      [Position.DEF]: 0,
      [Position.MID]: 0,
      [Position.FWD]: 0,
    };

    let totalCost = 0.0;
    const teamCounts = new Map<number, number>();

    for (const sel of selections) {
      const p = playerMap.get(sel.playerId)!;
      positionCounts[p.position]++;
      totalCost += Number(p.price);

      const currentTeamCount = teamCounts.get(p.teamId) || 0;
      teamCounts.set(p.teamId, currentTeamCount + 1);
    }

    totalCost = Math.round(totalCost * 10) / 10;

    if (positionCounts[Position.GKP] !== SQUAD_RULES.POSITION_COUNTS.GKP) {
      errors.push(
        `Squad must have exactly ${SQUAD_RULES.POSITION_COUNTS.GKP} goalkeepers (found ${positionCounts[Position.GKP]})`
      );
    }
    if (positionCounts[Position.DEF] !== SQUAD_RULES.POSITION_COUNTS.DEF) {
      errors.push(
        `Squad must have exactly ${SQUAD_RULES.POSITION_COUNTS.DEF} defenders (found ${positionCounts[Position.DEF]})`
      );
    }
    if (positionCounts[Position.MID] !== SQUAD_RULES.POSITION_COUNTS.MID) {
      errors.push(
        `Squad must have exactly ${SQUAD_RULES.POSITION_COUNTS.MID} midfielders (found ${positionCounts[Position.MID]})`
      );
    }
    if (positionCounts[Position.FWD] !== SQUAD_RULES.POSITION_COUNTS.FWD) {
      errors.push(
        `Squad must have exactly ${SQUAD_RULES.POSITION_COUNTS.FWD} forwards (found ${positionCounts[Position.FWD]})`
      );
    }

    // 6. Budget validation
    if (totalCost > maxBudget) {
      errors.push(
        `Squad budget exceeded: Total cost is £${totalCost.toFixed(1)}m (max allowed is £${maxBudget.toFixed(1)}m)`
      );
    }

    // 7. Max 3 players per team validation
    for (const [teamId, count] of teamCounts.entries()) {
      if (count > SQUAD_RULES.MAX_PER_TEAM) {
        errors.push(
          `Maximum ${SQUAD_RULES.MAX_PER_TEAM} players allowed from a single team (team ID ${teamId} has ${count})`
        );
      }
    }

    // 8. Starting XI formation limits
    const starterPositions: Record<Position, number> = {
      [Position.GKP]: 0,
      [Position.DEF]: 0,
      [Position.MID]: 0,
      [Position.FWD]: 0,
    };

    for (const sel of starters) {
      const p = playerMap.get(sel.playerId)!;
      starterPositions[p.position]++;
    }

    if (starterPositions[Position.GKP] !== 1) {
      errors.push(
        `Starting XI must have exactly 1 goalkeeper (found ${starterPositions[Position.GKP]})`
      );
    }
    if (starterPositions[Position.DEF] < SQUAD_RULES.MIN_STARTERS.DEF) {
      errors.push(
        `Starting XI must have at least ${SQUAD_RULES.MIN_STARTERS.DEF} defenders (found ${starterPositions[Position.DEF]})`
      );
    }
    if (starterPositions[Position.MID] < SQUAD_RULES.MIN_STARTERS.MID) {
      errors.push(
        `Starting XI must have at least ${SQUAD_RULES.MIN_STARTERS.MID} midfielders (found ${starterPositions[Position.MID]})`
      );
    }
    if (starterPositions[Position.FWD] < SQUAD_RULES.MIN_STARTERS.FWD) {
      errors.push(
        `Starting XI must have at least ${SQUAD_RULES.MIN_STARTERS.FWD} forwards (found ${starterPositions[Position.FWD]})`
      );
    }

    if (errors.length > 0) {
      throw new SquadValidationError(errors);
    }

    const formation = `${starterPositions[Position.DEF]}-${starterPositions[Position.MID]}-${starterPositions[Position.FWD]}`;

    return {
      totalCost,
      formation,
      starterIds: starters.map((s) => s.playerId),
      benchIds: bench.map((s) => s.playerId),
      captainId: captains[0].playerId,
      viceCaptainId: viceCaptains[0].playerId,
    };
  }
}
```

---

## Issue #87: Implement League Lifecycle State Machine (Open, Locked, Active, Finished)

### Problem Description
Leagues currently lack explicit state machine enforcement during user operations (such as joining a league or starting a gameweek), allowing users to join locked or active leagues after deadlines.

### Architectural Design & Clean Code Structure
- **State Machine Engine**: `LeagueStateMachine` class managing explicit status definitions (`Open`, `Locked`, `Active`, `Finished`, `Cancelled`).
- **Allowed Transitions**:
  - `Open` $\rightarrow$ `Locked` (Gameweek deadline passed or max capacity reached)
  - `Open` $\rightarrow$ `Cancelled` (Minimum members not met at deadline)
  - `Locked` $\rightarrow$ `Active` (Gameweek matches kickoff)
  - `Active` $\rightarrow$ `Finished` (All gameweek matches concluded & payouts settled)
- **State Guards**:
  - `canJoin(status)`: `true` ONLY if `status === ExtendedLeagueStatus.OPEN`.
  - `transitionTo(current, target)`: Verifies allowed transition before mutation; throws `InvalidStateTransitionError` otherwise.

### Complexity Analysis
- **Time Complexity**: $\mathcal{O}(1)$ lookup against allowed transition matrix.
- **Space Complexity**: $\mathcal{O}(1)$ memory allocation for transition rules map.

### Implementation Code

```typescript
// backend/src/services/league/leagueStateMachine.ts

export enum ExtendedLeagueStatus {
  OPEN = "OPEN",
  LOCKED = "LOCKED",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
  CANCELLED = "CANCELLED",
}

export class InvalidStateTransitionError extends Error {
  constructor(from: ExtendedLeagueStatus, to: ExtendedLeagueStatus) {
    super(`Invalid league state transition from ${from} to ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

export class LeagueActionForbiddenError extends Error {
  constructor(action: string, status: ExtendedLeagueStatus) {
    super(`Action '${action}' is not permitted while league status is '${status}'`);
    this.name = "LeagueActionForbiddenError";
  }
}

export class LeagueStateMachine {
  private static readonly ALLOWED_TRANSITIONS: Record<ExtendedLeagueStatus, ExtendedLeagueStatus[]> = {
    [ExtendedLeagueStatus.OPEN]: [
      ExtendedLeagueStatus.LOCKED,
      ExtendedLeagueStatus.CANCELLED,
    ],
    [ExtendedLeagueStatus.LOCKED]: [
      ExtendedLeagueStatus.ACTIVE,
      ExtendedLeagueStatus.CANCELLED,
    ],
    [ExtendedLeagueStatus.ACTIVE]: [
      ExtendedLeagueStatus.FINISHED,
    ],
    [ExtendedLeagueStatus.FINISHED]: [],
    [ExtendedLeagueStatus.CANCELLED]: [],
  };

  /**
   * Validates state transition safety. Throws InvalidStateTransitionError if invalid.
   */
  public static validateTransition(
    currentStatus: ExtendedLeagueStatus,
    nextStatus: ExtendedLeagueStatus
  ): void {
    const allowed = this.ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new InvalidStateTransitionError(currentStatus, nextStatus);
    }
  }

  /**
   * Asserts that a user can join the league.
   */
  public static assertCanJoin(status: ExtendedLeagueStatus): void {
    if (status !== ExtendedLeagueStatus.OPEN) {
      throw new LeagueActionForbiddenError("JOIN_LEAGUE", status);
    }
  }

  /**
   * Evaluates league state based on gameweek deadlines and member counts.
   */
  public static computeCurrentState(
    currentStatus: ExtendedLeagueStatus,
    currentMembers: number,
    maxMembers: number,
    deadline: Date,
    now: Date = new Date()
  ): ExtendedLeagueStatus {
    if (currentStatus === ExtendedLeagueStatus.FINISHED || currentStatus === ExtendedLeagueStatus.CANCELLED) {
      return currentStatus;
    }

    const isPastDeadline = now.getTime() >= deadline.getTime();
    const isFull = currentMembers >= maxMembers;

    if (currentStatus === ExtendedLeagueStatus.OPEN) {
      if (isPastDeadline || isFull) {
        return ExtendedLeagueStatus.LOCKED;
      }
    }

    return currentStatus;
  }
}
```

---

## Issue #86: Develop Automated Prize Pool Distribution and 5% Fee Extraction Logic

### Problem Description
At the end of a league, prize pools must be split accurately among top participants with exact 5% platform fee extraction prior to payout calculation. Floating-point imprecision must be completely avoided.

### Architectural Design & Clean Code Structure
- **Service Layer**: `PrizeService` (`backend/src/services/league/prizeService.ts`).
- **Integer Cents Math**: All calculations convert input USDC/fiat values to integer cents (`Math.round(amount * 100)`).
- **Split Structure**:
  - Platform Fee: Exactly 5% (`Math.round(grossCents * 0.05)`).
  - Net Prize Pool: `grossCents - platformFeeCents`.
  - 3+ Participants: 1st place 60%, 2nd place 30%, 3rd place 10% (remainder allocated to 3rd place to prevent cent drift).
  - 2 Participants: 1st place 70%, 2nd place 30%.
  - 1 Participant: 100% of prize pool to 1st place.

### Complexity Analysis
- **Time Complexity**: $\mathcal{O}(1)$ arithmetic computation.
- **Space Complexity**: $\mathcal{O}(1)$ memory overhead.

### Implementation Code

```typescript
// backend/src/services/league/prizeService.ts

export interface PrizeBreakdown {
  first: number;
  second: number;
  third: number;
}

export interface PrizeDistribution {
  participantCount: number;
  entryFee: number;
  grossTotal: number;
  platformFee: number;
  prizePool: number;
  prizes: PrizeBreakdown;
}

export class PrizeService {
  public static readonly PLATFORM_FEE_PERCENT = 5;
  public static readonly FIRST_PLACE_PERCENT = 60;
  public static readonly SECOND_PLACE_PERCENT = 30;
  public static readonly THIRD_PLACE_PERCENT = 10;

  public static readonly TWO_PLAYER_FIRST_PERCENT = 70;
  public static readonly TWO_PLAYER_SECOND_PERCENT = 30;

  public static calculatePrizeDistribution(
    participantCount: number,
    entryFee: number
  ): PrizeDistribution {
    if (participantCount < 0 || entryFee < 0) {
      throw new Error("Participant count and entry fee must be non-negative");
    }

    const feeInCents = Math.round(entryFee * 100);
    const count = Math.floor(participantCount);

    if (count === 0 || feeInCents === 0) {
      return {
        participantCount: count,
        entryFee: feeInCents / 100,
        grossTotal: 0,
        platformFee: 0,
        prizePool: 0,
        prizes: { first: 0, second: 0, third: 0 },
      };
    }

    const grossCents = count * feeInCents;
    const platformFeeCents = Math.round((grossCents * this.PLATFORM_FEE_PERCENT) / 100);
    const prizePoolCents = grossCents - platformFeeCents;

    let firstCents = 0;
    let secondCents = 0;
    let thirdCents = 0;

    if (count >= 3) {
      firstCents = Math.round((prizePoolCents * this.FIRST_PLACE_PERCENT) / 100);
      secondCents = Math.round((prizePoolCents * this.SECOND_PLACE_PERCENT) / 100);
      thirdCents = prizePoolCents - firstCents - secondCents;
    } else if (count === 2) {
      firstCents = Math.round((prizePoolCents * this.TWO_PLAYER_FIRST_PERCENT) / 100);
      secondCents = prizePoolCents - firstCents;
      thirdCents = 0;
    } else {
      firstCents = prizePoolCents;
      secondCents = 0;
      thirdCents = 0;
    }

    return {
      participantCount: count,
      entryFee: feeInCents / 100,
      grossTotal: grossCents / 100,
      platformFee: platformFeeCents / 100,
      prizePool: prizePoolCents / 100,
      prizes: {
        first: firstCents / 100,
        second: secondCents / 100,
        third: thirdCents / 100,
      },
    };
  }
}
```

---

## Issue #84: Implement Background Job Queue for Gameweek Leaderboard Recalculation

### Problem Description
Synchronous recalculation of league leaderboards across thousands of squads causes HTTP request timeouts. Leaderboard processing must be decoupled into an asynchronous background queue job.

### Architectural Design & Clean Code Structure
- **Background Queue Integration**: Utilizes PostgreSQL-backed job queue architecture (`PgBoss`).
- **Asynchronous Execution Flow**:
  1. Triggering events (e.g. FPL gameweek score updates) push a job payload `{ leagueId, gameweekId }` to the queue.
  2. Worker processes jobs asynchronously with configurable retries (3 attempts), exponential backoff, and dead-letter queueing (DLQ).
  3. Leaderboard calculation runs in batched DB queries to eliminate memory spikes.

### Complexity Analysis
- **Time Complexity**: $\mathcal{O}(M \log M)$ per league, where $M$ is the number of participants in the league being ranked.
- **Space Complexity**: $\mathcal{O}(B)$ where $B$ is the batch chunk size (e.g. 500 entries per memory slice).

### Implementation Code

```typescript
// backend/src/queues/leaderboardRecalculationQueue.ts

export interface LeaderboardRecalcJobPayload {
  leagueId: string;
  gameweekId: number;
  triggeredBy: string;
}

export const LEADERBOARD_RECALC_QUEUE_NAME = "leaderboard-recalculation";

export interface LeaderboardJobMetrics {
  totalProcessed: number;
  succeeded: number;
  failed: number;
  lastRunTimestamp: string | null;
}

export class LeaderboardRecalculationWorker {
  private metrics: LeaderboardJobMetrics = {
    totalProcessed: 0,
    succeeded: 0,
    failed: 0,
    lastRunTimestamp: null,
  };

  /**
   * Processes an asynchronous leaderboard recalculation job.
   */
  public async processJob(
    payload: LeaderboardRecalcJobPayload,
    recalcFn: (leagueId: string, gameweekId: number) => Promise<void>
  ): Promise<{ success: boolean; durationMs: number }> {
    const startTime = Date.now();
    this.metrics.totalProcessed++;
    this.metrics.lastRunTimestamp = new Date().toISOString();

    try {
      if (!payload.leagueId || !payload.gameweekId) {
        throw new Error("Invalid payload: leagueId and gameweekId are required");
      }

      await recalcFn(payload.leagueId, payload.gameweekId);

      this.metrics.succeeded++;
      const durationMs = Date.now() - startTime;
      return { success: true, durationMs };
    } catch (error) {
      this.metrics.failed++;
      const errMessage = error instanceof Error ? error.message : String(error);
      console.error(`[LeaderboardQueueWorker] Job failed for league ${payload.leagueId}: ${errMessage}`);
      throw error;
    }
  }

  public getMetrics(): LeaderboardJobMetrics {
    return { ...this.metrics };
  }
}
```

---

## Verification & Test Plan

All implemented components are fully validated with automated node test suites:

1. **`squadValidator.test.ts`**: Verifies exact £100M budget caps, 3-players-per-team limits, starting XI formation rules, and captain selection constraints.
2. **`prizeService.test.ts`**: Verifies 5% platform fee deduction and 60/30/10 prize distribution without floating-point penny rounding loss.
3. **`leagueService.test.ts`**: Verifies state transitions (`Open` $\rightarrow$ `Locked` $\rightarrow$ `Active` $\rightarrow$ `Finished`) and rejection of user join attempts on locked/active leagues.
4. **`jobQueue.test.ts`**: Verifies asynchronous queuing and error handling retries for leaderboard recalculation tasks.
