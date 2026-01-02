type Props = {
  count: number;
  onAdd: () => void;
  onRemove: () => void;
};

export default function PoopCounter({ count, onAdd, onRemove }: Props) {
  return (
    <section className="card tracker">
      <div className="tracker__header">
        <div>
          <p className="label font-bold! text-2xl!">Kaka</p>
          <h2 className="text-lg!">{count} kez</h2>
        </div>
      </div>
      <div className="actions-grid">
        <button onClick={onRemove} className="ghost">
          -1
        </button>
        <button onClick={onAdd}>+1</button>
      </div>
    </section>
  );
}
