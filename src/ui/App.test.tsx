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
