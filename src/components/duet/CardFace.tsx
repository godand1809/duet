import { isRed, rankLabel, SUIT_LABEL } from "@/lib/duet/cards";
import type { Card } from "@/lib/duet/types";

export function CardFace({
  card,
  mini,
  lift,
  win,
  faceDown,
}: {
  card?: Card | null;
  mini?: boolean;
  lift?: boolean;
  win?: boolean;
  faceDown?: boolean;
}) {
  const hidden = !card || faceDown;
  const cls = [
    "card-face",
    mini ? "mini" : "",
    lift ? "lift" : "",
    win ? "win" : "",
    hidden ? "back" : isRed(card) ? "red" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (hidden) return <div className={cls} aria-hidden="true" />;
  return (
    <div className={cls}>
      <small>
        {rankLabel(card.r)}
        {SUIT_LABEL[card.s]}
      </small>
      <strong>{SUIT_LABEL[card.s]}</strong>
      <em>{SUIT_LABEL[card.s]}</em>
    </div>
  );
}
