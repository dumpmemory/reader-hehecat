import { Button } from "@/components/ui";

interface SearchMatchModeProps {
  exact: boolean;
  onChange: (exact: boolean) => void;
  disabled?: boolean;
}

export function SearchMatchMode({ exact, onChange, disabled }: SearchMatchModeProps) {
  return (
    <div role="group" aria-label="搜索匹配方式" className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">匹配方式</span>
      {[{ exact: false, label: "模糊" }, { exact: true, label: "精确" }].map((mode) => (
        <Button
          key={mode.label}
          size="sm"
          variant={exact === mode.exact ? "primary" : "secondary"}
          aria-pressed={exact === mode.exact}
          disabled={disabled}
          onClick={() => onChange(mode.exact)}
        >
          {mode.label}
        </Button>
      ))}
    </div>
  );
}
