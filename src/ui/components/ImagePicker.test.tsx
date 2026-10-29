import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { crestChoices, ImagePicker } from './ImagePicker';

const RED = 'data:image/png;base64,AAA';
const BLUE = 'data:image/png;base64,BBB';

describe('crestChoices', () => {
  it('nimmt jedes Wappen nur einmal und überspringt Mannschaften ohne Wappen', () => {
    expect(
      crestChoices([
        { name: 'TSV 1', logo: RED },
        { name: 'TSV 2', logo: RED },
        { name: 'FC Nord' },
        { name: 'SV Süd', logo: BLUE },
      ]),
    ).toEqual([
      { logo: RED, name: 'TSV 1' },
      { logo: BLUE, name: 'SV Süd' },
    ]);
  });
});

describe('ImagePicker', () => {
  it('übernimmt ein schon hochgeladenes Wappen', () => {
    const onChange = vi.fn();
    render(<ImagePicker label="Vereinswappen" name="TSV 2" onChange={onChange} choices={[{ logo: RED, name: 'TSV 1' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wappen von TSV 1 nehmen' }));
    expect(onChange).toHaveBeenCalledWith(RED);
  });

  it('bietet das eigene Wappen nicht noch einmal an', () => {
    render(<ImagePicker label="Vereinswappen" name="TSV 1" value={RED} onChange={() => {}} choices={[{ logo: RED, name: 'TSV 1' }]} />);
    expect(screen.queryByText(/schon hochgeladenes Wappen/)).toBeNull();
  });
});
