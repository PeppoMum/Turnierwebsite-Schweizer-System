import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';
import { createFixtures } from './data/fixtures';
import { MockTournamentStore } from './data/mockStore';

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
});
