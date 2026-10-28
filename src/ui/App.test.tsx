import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './App';
import { createFixtures } from './data/fixtures';
import { MockTournamentStore } from './data/mockStore';
import { FakeAuth } from './data/fakeAuth';

function renderAt(hash: string) {
  window.location.hash = hash;
  const service = new MockTournamentStore(createFixtures(), false);
  render(<App service={service} />);
  return service;
}

beforeAll(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe('App', () => {
  it('zeigt die Turnierübersicht', () => {
    renderAt('#/');
    expect(screen.getByRole('heading', { level: 1, name: 'Turniere' })).toBeInTheDocument();
    expect(screen.getByText('Herbstcup 2026')).toBeInTheDocument();
  });

  it('zeigt das Cockpit mit der laufenden Runde', () => {
    renderAt('#/turnier/herbstcup');
    expect(screen.getByRole('heading', { level: 1, name: 'Live' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Runde 2/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Spiel beenden' }).length).toBeGreaterThan(0);
  });

  it('Druckansicht: Spielplan und Tabelle, für Aushang auch ohne Ergebnisse', () => {
    renderAt('#/turnier/herbstcup/druck');
    expect(screen.getByRole('heading', { level: 1, name: 'Herbstcup 2026' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Runde 1/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Tabelle/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ergebnisse'), { target: { value: 'blank' } });
    expect(screen.getAllByText('___ : ___').length).toBeGreaterThan(0);
  });

  it('Mannschaft umbenennen und im Verlauf wiederfinden', async () => {
    renderAt('#/turnier/herbstcup/teams');
    fireEvent.click(screen.getByRole('button', { name: 'TSG Waldrand ändern' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'TSG Waldrand 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByText('TSG Waldrand 2');
    window.location.hash = '#/turnier/herbstcup/verlauf';
    await screen.findByText('Mannschaft umbenannt: „TSG Waldrand“ → „TSG Waldrand 2“');
  });

  it('speichert ein Tor sofort', () => {
    const service = renderAt('#/turnier/herbstcup');
    const live = service.get('herbstcup')!.matches.find((m) => m.status === 'live')!;
    const before = live.goalsA ?? 0;
    const card = screen.getAllByRole('article').find((a) => within(a).queryByRole('button', { name: 'Spiel beenden' }))!;
    fireEvent.click(within(card).getAllByRole('button', { name: /ein Tor mehr/ })[0]!);
    expect(service.get('herbstcup')!.matches.find((m) => m.id === live.id)!.goalsA).toBe(before + 1);
  });

  it('zeigt im Kinderfußballmodus keine Tabelle im Menü', () => {
    renderAt('#/t/minicup');
    const nav = screen.getAllByRole('navigation', { name: 'Hauptmenü' })[0]!;
    expect(within(nav).queryByText('Tabelle')).not.toBeInTheDocument();
    expect(within(nav).getByText('Spielplan')).toBeInTheDocument();
  });

  it('lässt im Assistenten nicht ohne Turniernamen weiter', () => {
    renderAt('#/neu');
    fireEvent.click(screen.getByRole('button', { name: /Weiter zu Teilnehmer/ }));
    expect(screen.getByText(/Gib dem Turnier einen Namen/, { selector: '.notice span' })).toBeInTheDocument();
  });

  it('pfeift alle Spiele einer Anstoßzeit mit einem Klick an', async () => {
    const service = renderAt('#/turnier/minicup');
    const button = screen.getAllByRole('button', { name: /^Alle \d\d:\d\d-Spiele anpfeifen$/ })[0]!;
    const first = service.get('minicup')!.matches.filter((m) => m.waveIndex === 0);
    expect(first.length).toBeGreaterThan(1);
    fireEvent.click(button);
    await waitFor(() => expect(service.get('minicup')!.matches.filter((m) => m.waveIndex === 0).every((m) => m.status === 'live')).toBe(true));
    expect(service.get('minicup')!.matches.filter((m) => m.waveIndex !== 0).every((m) => m.status === 'scheduled')).toBe(true);
  });

  it('filtert den öffentlichen Spielplan nach Mannschaft und Runde', () => {
    const service = renderAt('#/t/herbstcup/spielplan');
    const team = service.get('herbstcup')!.teams[0]!;
    const input = screen.getByRole('combobox', { name: 'Mannschaft' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: team.name.slice(0, 4) } });
    fireEvent.click(screen.getByRole('option', { name: team.name }));
    const cards = screen.getAllByRole('article');
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((c) => expect(within(c).getByText(team.name)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Runde'), { target: { value: '1' } });
    expect(screen.queryByRole('heading', { name: 'Runde 2' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('article').length).toBe(1);
  });

  it('zeigt die öffentliche Tabelle schon vor dem ersten Ergebnis', async () => {
    window.location.hash = '#/t/minicup/tabelle';
    const service = new MockTournamentStore(createFixtures(), false);
    await service.setVisibility('minicup', 'full');
    render(<App service={service} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tabelle' })).toBeInTheDocument();
    expect(screen.getByText(service.get('minicup')!.teams[0]!.name)).toBeInTheDocument();
  });

  it('öffnet die Helferansicht über den Helferlink nur mit gültigem Link', async () => {
    const service = new MockTournamentStore(createFixtures(), false);
    await service.setOpenHelperLink('herbstcup', 'on');
    const linkId = service.get('herbstcup')!.tournament.openHelperLinkId!;
    window.location.hash = `#/helfer/herbstcup/${linkId}`;
    const { unmount } = render(<App service={service} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Runde 2 von 8' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Runde abschließen|Neue Runde/ })).not.toBeInTheDocument();
    unmount();

    await service.setOpenHelperLink('herbstcup', 'renew');
    render(<App service={service} />);
    expect(screen.getByText(/Dieser Helferlink gilt nicht mehr/)).toBeInTheDocument();
  });

  describe('mit Anmeldung', () => {
    function renderWithAuth(hash: string, auth: FakeAuth) {
      window.location.hash = hash;
      render(<App service={new MockTournamentStore(createFixtures(), false)} auth={auth} />);
    }

    const submitButton = () => screen.getAllByRole('button', { name: 'Anmelden' }).find((b) => b.getAttribute('type') === 'submit')!;

    it('zeigt ohne Anmeldung die Anmeldeseite statt der Turniere', async () => {
      const auth = new FakeAuth();
      renderWithAuth('#/', auth);
      expect(screen.getByRole('heading', { level: 1, name: 'Anmelden' })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'a@b.de' } });
      fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'falsch' } });
      fireEvent.click(submitButton());
      expect(await screen.findByText('E-Mail oder Passwort stimmen nicht.')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'geheim' } });
      fireEvent.click(submitButton());
      expect(await screen.findByRole('heading', { level: 1, name: 'Turniere' })).toBeInTheDocument();
    });

    it('nimmt eine Helfer-Einladung an und öffnet das Cockpit', async () => {
      const auth = new FakeAuth({ uid: 'u1', email: 'helfer@example.com' });
      renderWithAuth('#/einladung/herbstcup/abc', auth);
      expect(await screen.findByText('Herbstcup 2026')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Einladung annehmen' }));
      await waitFor(() => expect(window.location.hash).toBe('#/turnier/herbstcup'));
      expect(auth.redeemed).toEqual(['herbstcup/abc']);
    });

    it('zeigt, wenn eine Einladung abgelaufen ist', async () => {
      const auth = new FakeAuth(null, { tournamentTitle: 'Herbstcup 2026', role: 'results_helper', problem: 'Diese Einladung ist abgelaufen.' });
      renderWithAuth('#/einladung/herbstcup/abc', auth);
      expect(await screen.findByText('Diese Einladung ist abgelaufen.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Einladung annehmen' })).not.toBeInTheDocument();
    });
  });
});
