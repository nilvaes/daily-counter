type Item = "water" | "poop" | "farts";

type Props = {
  active: Item;
  onSelect: (item: Item) => void;
};

const labels: Record<Item, string> = {
  water: "Water",
  poop: "Poop",
  farts: "Farts",
};

export default function Header({ active, onSelect }: Props) {
  return (
    <div className="header-bar card">
      <div className="title">Daily Counter</div>
      <div className="subtitle">Water · Poop · Farts</div>
      <div className="nav">
        {Object.entries(labels).map(([key, label]) => {
          const item = key as Item;
          const selected = active === item;
          return (
            <button
              key={item}
              className={`nav__item${selected ? " nav__item--active" : ""}`}
              onClick={() => onSelect(item)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
