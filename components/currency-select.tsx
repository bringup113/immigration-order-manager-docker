"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type CurrencyOption = { currency: string; name?: string; rate_per_usd?: number; rate_per_usd_scaled?: number };

type Props = {
  value: string;
  onChange: (value: string) => void;
  currencies: CurrencyOption[];
  compact?: boolean;
  disabled?: boolean;
};

export function CurrencySelect({ value, onChange, currencies, compact = false, disabled = false }: Props) {
  const options = currencies.some((item) => item.currency === value)
    ? currencies
    : value ? [{ currency: value, name: "已停用" }, ...currencies] : currencies;
  return <Select value={value} onValueChange={onChange} disabled={disabled || options.length === 0}>
    <SelectTrigger className={compact ? "w-full" : "mt-2 w-full"}><SelectValue placeholder="选择币种"/></SelectTrigger>
    <SelectContent>{options.map((item) => <SelectItem key={item.currency} value={item.currency}>{item.currency}{item.name ? ` · ${item.name}` : ""}</SelectItem>)}</SelectContent>
  </Select>;
}
