export interface BoardRow {
  key: string;
  name: string;
  amount: string;
  status: string;
  tone?: 'go' | 'done' | 'off';
}

/** A small departure board: the airport's own language for "where do I stand". */
export function Board({ rows, total, caption }: { rows: BoardRow[]; total?: string; caption: string }) {
  return (
    <table className="board">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Shop</th>
          <th scope="col">VAT</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key} style={{ animationDelay: `${120 + i * 70}ms` }}>
            <td>{r.name}</td>
            <td>{r.amount}</td>
            <td className={`board__status board__status--${r.tone ?? 'go'}`}>{r.status}</td>
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="board__total">{total}</td>
            <td />
          </tr>
        </tfoot>
      )}
    </table>
  );
}
