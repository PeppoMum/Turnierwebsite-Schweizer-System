import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../App';
import { createFixtures } from '../../data/fixtures';
import { MockTournamentStore } from '../../data/mockStore';

function renderWizard() {
  window.location.hash = '#/neu';
  const service = new MockTournamentStore(createFixtures(), false);
  render(<App service={service} />);
  return service;
}

function next(label: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function fillBasics() {
  fireEvent.change(screen.getByLabelText('Turniername'), {
    target: { value: 'Baukasten-Cup' },
  });
  fireEvent.change(screen.getByLabelText('Veranstalter'), {
    target: { value: 'SV Test' },
  });
}

beforeAll(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe('Assistent mit Baukasten', () => {
  it('legt ein Turnier aus der Vorlage mit 16 Teams an: Gruppen, Spielplan, Endrunde mit Platzhaltern', async () => {
    const service = renderWizard();
    fillBasics();
    next(/Weiter zu Turnierform/);
    fireEvent.change(screen.getByLabelText('Vorlage'), {
      target: { value: 't16' },
    });
    expect(screen.getByLabelText('Mannschaften')).toHaveValue(16);
    expect(screen.getAllByText('So läuft das Turnier').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Goldrunde · 8 Teams/).length).toBeGreaterThan(0);
    next(/Weiter zu Mannschaften/);
    next(/Weiter zu Gruppen auslosen/);
    expect(screen.getByRole('region', { name: 'Gruppe D' })).toBeInTheDocument();
    next(/Weiter zu Felder und Zeiten/);
    next(/Weiter zu Vorschau/);
    fireEvent.click(screen.getByRole('button', { name: 'Als Entwurf speichern' }));

    await waitFor(() => expect(service.getAll().some((d) => d.tournament.title === 'Baukasten-Cup')).toBe(true));
    const data = service.getAll().find((d) => d.tournament.title === 'Baukasten-Cup')!;
    expect(data.tournament.status).toBe('draft');
    expect(data.tournament.format?.stages.map((s) => s.id)).toEqual(['vorrunde', 'gold', 'silber']);
    expect(data.groupDraws?.[0]?.groups.map((g) => g.length)).toEqual([4, 4, 4, 4]);
    const group = data.matches.filter((m) => m.stageId === 'vorrunde');
    expect(group).toHaveLength(24);
    expect(group.every((m) => m.teamAId && m.teamBId && m.startISO && m.fieldId)).toBe(true);
    const gold = data.matches.filter((m) => m.stageId === 'gold');
    expect(gold.some((m) => m.matchKey === 'F')).toBe(true);
    expect(gold.filter((m) => m.matchKey?.startsWith('QF')).every((m) => m.slotA?.kind === 'group_place')).toBe(true);
  });

  it('veröffentlicht direkt und behält eine von Hand getauschte Einteilung', async () => {
    const service = renderWizard();
    fillBasics();
    next(/Weiter zu Turnierform/);
    next(/Weiter zu Mannschaften/);
    next(/Weiter zu Gruppen auslosen/);
    fireEvent.click(screen.getByRole('button', { name: 'Von Hand' }));
    const a = screen.getByRole('region', { name: 'Gruppe A' });
    const b = screen.getByRole('region', { name: 'Gruppe B' });
    const first = within(a).getAllByRole('button')[0]!;
    const other = within(b).getAllByRole('button')[0]!;
    const firstName = first.querySelector('.name')!.textContent!;
    fireEvent.click(first);
    fireEvent.click(other);
    expect(within(screen.getByRole('region', { name: 'Gruppe B' })).getByText(firstName)).toBeInTheDocument();
    next(/Weiter zu Felder und Zeiten/);
    next(/Weiter zu Vorschau/);
    fireEvent.click(screen.getByRole('button', { name: 'Turnier veröffentlichen' }));
    await waitFor(() => expect(service.getAll().some((d) => d.tournament.title === 'Baukasten-Cup')).toBe(true));
    const data = service.getAll().find((d) => d.tournament.title === 'Baukasten-Cup')!;
    expect(data.tournament.status).toBe('published');
    expect(data.groupDraws?.[0]?.mode).toBe('manual');
    // Vorlage 8 Teams: 2 Gruppen, Halbfinale, Platz 3, Platzierungsspiele.
    expect(data.matches.filter((m) => m.stageId === 'platzierung').map((m) => m.matchKey)).toEqual(['P5', 'P7']);
  });

  it('lässt bei einem K.-o.-Baum, der nicht aufgeht, nicht weiter', () => {
    renderWizard();
    fillBasics();
    next(/Weiter zu Turnierform/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Platz 3' })[0]!);
    next(/Weiter zu Mannschaften/);
    expect(screen.getByRole('heading', { level: 2, name: 'Turnierform' })).toBeInTheDocument();
    expect(screen.getAllByText(/Für K.-o. braucht es 2, 4, 8, 16 oder 32/).length).toBeGreaterThan(0);
  });

  it('Schweizer System läuft wie bisher ohne Baukasten', async () => {
    const service = renderWizard();
    fillBasics();
    next(/Weiter zu Turnierform/);
    fireEvent.click(screen.getByRole('button', { name: 'Schweizer System' }));
    expect(screen.getByLabelText('Runden')).toBeInTheDocument();
    next(/Weiter zu Mannschaften/);
    next(/Weiter zu Felder und Zeiten/);
    expect(screen.queryByText('Gruppen auslosen')).not.toBeInTheDocument();
    next(/Weiter zu Vorschau/);
    fireEvent.click(screen.getByRole('button', { name: 'Turnier veröffentlichen' }));
    await waitFor(() => expect(service.getAll().some((d) => d.tournament.title === 'Baukasten-Cup')).toBe(true));
    const data = service.getAll().find((d) => d.tournament.title === 'Baukasten-Cup')!;
    expect(data.tournament.format).toBeUndefined();
    expect(data.rounds).toHaveLength(1);
  });
});
