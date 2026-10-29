// Der echte Ablauf aus „Turnier anlegen“ gegen den Emulator: jede Vorlage, Zufall und Lostöpfe,
// gleich veröffentlichen oder nur speichern. Läuft über createFormatTournament wie im Assistenten.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor, ActorSource } from "../../src/data";
import { FORMAT_TEMPLATES } from "../../src/domain/format";
import { FirestoreTournamentStore } from "../../src/ui/data/firestoreStore";
import { fromFormat, prelimSizes } from "../../src/ui/screens/wizard/builder";
import { createFormatTournament } from "../../src/ui/screens/wizard/create";
import {
  currentGroups,
  type DrawState,
} from "../../src/ui/screens/wizard/draw";
import type { TournamentService } from "../../src/ui/data/service";
import type { WizardDraft } from "../../src/ui/data/types";
import { OWNER, createEnv, dbFor } from "./setup";

async function waitFor<T>(
  fn: () => T | undefined | false,
  ms = 8000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until)
      throw new Error("Zeitüberschreitung beim Warten auf Daten");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const fixed = (actor: Actor | null): ActorSource => ({
  current: () => actor,
  onChange: () => () => undefined,
});

// Wie emptyDraft() im Assistenten, mit n Mannschaften.
let seq = 0;
function wizardDraft(n: number): WizardDraft {
  const id = `wz${++seq}`;
  return {
    id,
    title: "Testturnier",
    organizerName: "Testveranstalter",
    venue: "",
    localDate: "2026-11-07",
    timeZone: "Europe/Berlin",
    sponsors: [],
    teams: Array.from({ length: n }, (_, i) => ({
      id: `${id}-tm${i}`,
      name: `Team ${i + 1}`,
      active: true,
    })),
    roundsTotal: 5,
    preDrawRounds: 1,
    pairingMode: "balanced",
    tieBreakers: ["head_to_head", "goal_diff", "goals_for"],
    buchholzEnabled: false,
    fields: [
      { id: `${id}-f1`, name: "Platz 1" },
      { id: `${id}-f2`, name: "Platz 2" },
    ],
    startTime: "10:00",
    matchMinutes: 12,
    turnoverMinutes: 3,
    roundBreakMinutes: 5,
    restOptimization: true,
    hardRestMinutes: null,
    allocation: "max_capacity",
    visibility: "full",
  };
}

function inputs(tplId: string, mode: DrawState["mode"] = "random") {
  const tpl = FORMAT_TEMPLATES.find((t) => t.id === tplId)!;
  const builder = fromFormat(tpl.build(), tpl.id);
  const draft = wizardDraft(tpl.teamCount);
  const teamIds = draft.teams.map((t) => t.id);
  const draw: DrawState = {
    mode,
    seed: 42,
    pots:
      mode === "pots"
        ? Object.fromEntries(teamIds.map((id, i) => [id, (i % 2) + 1]))
        : {},
    manual: null,
  };
  const groups = currentGroups(draw, teamIds, {
    groupCount: builder.groupCount,
    groupSizes: prelimSizes(builder, tpl.teamCount),
  });
  return { draft, builder, draw, groups };
}

let env: RulesTestEnvironment;
let owner: FirestoreTournamentStore;

beforeAll(async () => {
  env = await createEnv("demo-wizard");
  await env.clearFirestore();
  owner = new FirestoreTournamentStore(dbFor(env, OWNER), fixed(OWNER));
});

afterAll(async () => {
  owner.dispose();
  await env.cleanup();
});

describe("Turnier anlegen mit dem Baukasten", () => {
  for (const tpl of FORMAT_TEMPLATES) {
    for (const mode of ["random", "pots"] as const) {
      for (const publish of [true, false]) {
        it(`${tpl.id}, ${mode}, ${publish ? "veröffentlicht" : "als Entwurf"}`, async () => {
          const { draft, builder, draw, groups } = inputs(tpl.id, mode);
          const id = await createFormatTournament(
            owner,
            draft,
            builder,
            draw,
            groups,
            publish,
          );
          expect(id).toBe(draft.id);
          const d = await waitFor(
            () => (owner.get(id)?.matches.length ?? 0) > 0 && owner.get(id),
          );
          expect(d.tournament.status).toBe(publish ? "published" : "draft");
          const saved = d.groupDraws![0]!.groups.flat();
          const groupMatches = d.matches.filter(
            (m) => m.stageId === format(tpl.id).stages[0]!.id,
          );
          for (const m of groupMatches)
            expect(saved).toEqual(
              expect.arrayContaining([m.teamAId, m.teamBId]),
            );
        });
      }
    }
  }

  it("ein zweiter Versuch nach einem Fehler legt das Turnier nicht noch einmal an", async () => {
    const { draft, builder, draw, groups } = inputs("t8");
    let fail = true;
    const flaky = new Proxy(owner, {
      get(target, prop, receiver) {
        if (prop === "saveStagePlan" && fail) {
          return async () => {
            fail = false;
            throw new Error("Netz weg");
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as TournamentService;
    let created: string | null = null;
    const resume = () => ({
      created,
      onCreated: (id: string) => (created = id),
    });
    await expect(
      createFormatTournament(
        flaky,
        draft,
        builder,
        draw,
        groups,
        true,
        resume(),
      ),
    ).rejects.toThrow("Netz weg");
    expect(created).toBe(draft.id);
    expect(
      await createFormatTournament(
        flaky,
        draft,
        builder,
        draw,
        groups,
        true,
        resume(),
      ),
    ).toBe(draft.id);
    const d = await waitFor(
      () =>
        owner.get(draft.id)?.tournament.status === "published" &&
        owner.get(draft.id),
    );
    const again = inputs("t8");
    const plain = await createFormatTournament(
      owner,
      again.draft,
      again.builder,
      again.draw,
      again.groups,
      true,
    );
    const once = await waitFor(
      () => (owner.get(plain)?.matches.length ?? 0) > 0 && owner.get(plain),
    );
    expect(d.matches.length).toBe(once.matches.length);
  });
});

const format = (tplId: string) =>
  FORMAT_TEMPLATES.find((t) => t.id === tplId)!.build();
