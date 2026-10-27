import type { WizardDraft } from '../../data/types';

export type StepErrors = Partial<Record<string, string>>;

export function validateStep(step: number, d: WizardDraft): StepErrors {
  const e: StepErrors = {};
  if (step === 0) {
    if (!d.title.trim()) e.title = 'Gib dem Turnier einen Namen.';
    if (!d.organizerName.trim()) e.organizerName = 'Trag den Veranstalter ein.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.localDate)) e.localDate = 'Wähl ein Datum.';
    d.sponsors.forEach((s, i) => {
      if (s.url.trim() && !/^https:\/\//i.test(s.url.trim())) e[`sponsor-${i}`] = `Der Link von Sponsor ${i + 1} muss mit https:// beginnen.`;
    });
  }
  if (step === 1) {
    const active = d.teams.filter((t) => t.active && t.name.trim());
    if (active.length < 2) e.teams = 'Ein Turnier braucht mindestens zwei aktive Teams.';
    const names = d.teams.map((t) => t.name.trim().toLowerCase()).filter(Boolean);
    if (new Set(names).size !== names.length) e.teamNames = 'Zwei Teams haben denselben Namen. Gib jedem Team einen eigenen.';
  }
  if (step === 2) {
    if (!Number.isInteger(d.roundsTotal) || d.roundsTotal < 1 || d.roundsTotal > 20) e.roundsTotal = 'Die Rundenzahl muss zwischen 1 und 20 liegen.';
    if (d.preDrawRounds < 0 || d.preDrawRounds > d.roundsTotal) e.preDrawRounds = 'Es können nicht mehr Runden ausgelost werden, als es Runden gibt.';
  }
  if (step === 3) {
    if (d.fields.length < 1) e.fields = 'Leg mindestens ein Spielfeld an.';
    if (d.fields.some((f) => !f.name.trim())) e.fieldNames = 'Jedes Spielfeld braucht einen Namen.';
    if (!/^\d{2}:\d{2}$/.test(d.startTime)) e.startTime = 'Trag eine Startzeit ein.';
    if (d.matchMinutes < 1) e.matchMinutes = 'Ein Spiel dauert mindestens eine Minute.';
    if (d.turnoverMinutes < 0) e.turnoverMinutes = 'Die Wechselpause kann nicht negativ sein.';
  }
  return e;
}
