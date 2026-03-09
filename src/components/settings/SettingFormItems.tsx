import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <Label className="font-medium text-sm">{label}</Label>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

export function SettingInput({
  label,
  desc,
  ...inputProps
}: { label: string; desc?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1">
      <Label className="font-medium text-sm">{label}</Label>
      {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      <Input className="text-sm" {...inputProps} />
    </div>
  );
}

export function SettingNumberInput({
  label,
  desc,
  value,
  onChange,
  min,
  max,
  step,
  className,
}: {
  label: string;
  desc?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="font-medium text-sm">{label}</Label>
      {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      <NumberInput
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        className={className}
      />
    </div>
  );
}

export function SettingSelect({
  label,
  desc,
  value,
  onValueChange,
  children,
}: {
  label: string;
  desc?: string;
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="font-medium text-sm">{label}</Label>
      {desc && <p className="text-xs text-muted-foreground pb-1">{desc}</p>}
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-full text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

export function SettingSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />;
}
