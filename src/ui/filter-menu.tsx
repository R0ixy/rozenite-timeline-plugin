import { ChevronDown, Menu, Toolbar } from '@rozenite/ui';

export type FilterMenuProps<T extends string> = {
  label: string;
  /** Shown in the menu when there is nothing to pick from. */
  emptyLabel?: string;
  options: readonly T[];
  /** Empty means "everything". */
  selected: readonly T[];
  onChange: (selected: T[]) => void;
};

/** A multi-select dropdown where an empty selection means "all". */
export function FilterMenu<T extends string>({
  label,
  emptyLabel = 'Nothing to filter yet',
  options,
  selected,
  onChange,
}: FilterMenuProps<T>) {
  const summary =
    selected.length === 0
      ? 'All'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  const toggle = (option: T, checked: boolean) => {
    onChange(
      checked ? [...selected, option] : selected.filter((candidate) => candidate !== option),
    );
  };

  return (
    <Menu>
      <Menu.Trigger
        render={
          <Toolbar.Button
            aria-label={`${label} filter: ${summary}`}
            className={selected.length > 0 ? 'bg-accent text-accent-foreground' : undefined}
          />
        }
      >
        <span className="text-muted-foreground">{label}:</span>
        <span className="max-w-32 truncate">{summary}</span>
        <ChevronDown />
      </Menu.Trigger>
      <Menu.Content>
        {options.length === 0 ? (
          <Menu.Item disabled>{emptyLabel}</Menu.Item>
        ) : (
          <>
            {options.map((option) => (
              <Menu.CheckboxItem
                key={option}
                checked={selected.includes(option)}
                onCheckedChange={(checked) => toggle(option, checked)}
                closeOnClick={false}
              >
                {option}
              </Menu.CheckboxItem>
            ))}
            <Menu.Separator />
            <Menu.Item disabled={selected.length === 0} onClick={() => onChange([])}>
              Show all
            </Menu.Item>
          </>
        )}
      </Menu.Content>
    </Menu>
  );
}
