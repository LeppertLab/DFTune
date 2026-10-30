import { hubbardChanges, readHubbard, type HubbardRow, type TagChanges, type TagReader } from '../../core';

interface Props {
  reader: TagReader;
  species?: string[];
  onApply(changes: TagChanges): void;
}

const L_OPTIONS = [
  { value: -1, label: 'none' },
  { value: 1, label: 'p' },
  { value: 2, label: 'd' },
  { value: 3, label: 'f' },
];

export function HubbardCard({ reader, species, onApply }: Props) {
  const enabled = reader.bool('LDAU') === true;

  if (!species) {
    return (
      <div className="card">
        <div className="card-head">
          <span className="label">DFT+U</span>
          <span className="muted">{enabled ? 'on' : 'off'}</span>
        </div>
        <p className="muted">Needs a POSCAR with element names (VASP 5 format) next to the INCAR to set U per species.</p>
      </div>
    );
  }

  const setup = readHubbard(reader, species);
  const update = (patch: Partial<typeof setup>) => onApply(hubbardChanges({ ...setup, ...patch }, reader));
  const updateRow = (i: number, patch: Partial<HubbardRow>) => update({ rows: setup.rows.map((r, j) => (i === j ? { ...r, ...patch } : r)) });

  return (
    <div className="card">
      <div className="card-head">
        <label htmlFor="ldau-on">DFT+U</label>
        <select id="ldau-on" value={enabled ? String(setup.type) : 'off'} onChange={(e) => update(e.target.value === 'off' ? { enabled: false } : { enabled: true, type: Number(e.target.value) })}>
          <option value="off">Off</option>
          <option value="2">Dudarev (U_eff = U − J)</option>
          <option value="1">Liechtenstein</option>
        </select>
      </div>
      {enabled && (
        <table className="hubbard">
          <thead>
            <tr>
              <th>Species</th>
              <th>Orbital</th>
              <th>U (eV)</th>
              <th>J (eV)</th>
            </tr>
          </thead>
          <tbody>
            {setup.rows.map((row, i) => (
              <tr key={row.species + i}>
                <td>{row.species}</td>
                <td>
                  <select value={row.l} onChange={(e) => updateRow(i, { l: Number(e.target.value) })} aria-label={`${row.species} orbital`}>
                    {L_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <NumberCell value={row.u} disabled={row.l < 0} label={`${row.species} U`} onChange={(u) => updateRow(i, { u })} />
                </td>
                <td>
                  <NumberCell value={row.j} disabled={row.l < 0} label={`${row.species} J`} onChange={(j) => updateRow(i, { j })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NumberCell({ value, disabled, label, onChange }: { value: number; disabled: boolean; label: string; onChange(v: number): void }) {
  return (
    <input
      type="number"
      step="0.1"
      defaultValue={value}
      key={value}
      disabled={disabled}
      aria-label={label}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v !== value) onChange(v);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
