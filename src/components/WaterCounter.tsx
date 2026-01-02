type Props = {
  waterMl: number;
  displayLiters: string;
  onAdd: (amount: number) => void;
  onRemove: (amount: number) => void;
};

export default function WaterCounter({ waterMl, displayLiters, onAdd, onRemove }: Props) {
  return (
    <section className="card tracker">
      <div className="tracker__header">
        <div>
          <p className="label">Water</p>
          <h2>{displayLiters} L</h2>
          <p className="muted">{waterMl} ml today</p>
        </div>
      </div>
      <div className="actions-grid">
        <button onClick={() => onAdd(250)}>+250 ml</button>
        <button onClick={() => onAdd(500)}>+500 ml</button>
        <button onClick={() => onRemove(250)} className="ghost">
          -250 ml
        </button>
      </div>
    </section>
  );
}
