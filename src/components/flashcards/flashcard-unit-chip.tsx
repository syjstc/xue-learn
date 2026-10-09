type FlashcardUnitChipProps = {
  goalTitle: string;
  unitTitle: string;
};

export function FlashcardUnitChip({ goalTitle, unitTitle }: FlashcardUnitChipProps) {
  return (
    <p className="text-xs text-muted-foreground">
      <span>{goalTitle}</span>
      <span className="mx-1">·</span>
      <span className="font-medium text-foreground">{unitTitle}</span>
    </p>
  );
}
