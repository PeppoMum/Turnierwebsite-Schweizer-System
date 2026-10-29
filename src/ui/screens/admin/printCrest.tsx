// Kleines Vereinswappen in der Druckansicht; ohne Wappen bleibt nur der Name stehen.
import type { TournamentData } from '../../data/types';

export function teamCrest(data: TournamentData, id: string | null | undefined): string | undefined {
  const assetId = id ? data.teams.find((x) => x.id === id)?.logoAssetId : undefined;
  return assetId ? data.assets[assetId] : undefined;
}

export function PrintCrest({ logo }: { logo?: string }) {
  return logo ? <img className="print-crest" src={logo} alt="" /> : null;
}
