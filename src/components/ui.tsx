"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X, Check, Minus } from "lucide-react";
import { cn, hueOf, initials } from "@/lib/utils";

export function Button({
  variant = "default",
  size = "md",
  className,
  busy,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8.5 px-3.5 text-[13px]",
        variant === "default" && "border border-edge bg-elev text-ink hover:bg-elev2",
        variant === "primary" && "bg-accent text-white hover:bg-accent-hover",
        variant === "ghost" && "text-mut hover:bg-elev hover:text-ink",
        variant === "danger" && "border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20",
        className
      )}
    >
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...props}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-7.5 w-7.5 items-center justify-center rounded-md text-mut transition hover:bg-elev2 hover:text-ink",
        active && "text-accent",
        className
      )}
    >
      {children}
    </button>
  );
}

export function Badge({
  color,
  children,
  className,
}: {
  color?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
        className
      )}
      style={
        color
          ? { backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }
          : { backgroundColor: "var(--elev2)", color: "var(--mut)" }
      }
    >
      {children}
    </span>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const hue = hueOf(name.toLowerCase());
  return (
    <div
      className="flex shrink-0 select-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 55% 30%))`,
        color: "white",
      }}
    >
      {initials(name)}
    </div>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
        checked || indeterminate
          ? "border-accent bg-accent text-white"
          : "border-edge bg-elev hover:border-mut",
        className
      )}
    >
      {indeterminate ? <Minus className="h-3 w-3" /> : checked ? <Check className="h-3 w-3" /> : null}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center p-8", className)}>
      <Loader2 className="h-5 w-5 animate-spin text-mut" />
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5 px-6 py-14 text-center", className)}>
      <Icon className="mb-1 h-8 w-8 text-mut2" />
      <p className="text-[13.5px] font-medium text-mut">{title}</p>
      {description && <p className="max-w-72 text-xs text-mut2">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="anim-pop max-h-[80vh] overflow-auto rounded-2xl border border-edge bg-panel shadow-2xl"
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-edge-soft px-5 py-3.5">
            <h2 className="text-sm font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-lg border border-edge bg-elev px-3 py-2 text-[13px] outline-none transition placeholder:text-mut2 focus:border-accent",
        className
      )}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-lg border border-edge bg-elev px-3 py-2 text-[13px] outline-none transition placeholder:text-mut2 focus:border-accent",
        className
      )}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "w-full appearance-none rounded-lg border border-edge bg-elev px-3 py-2 text-[13px] outline-none transition focus:border-accent",
        className
      )}
    >
      {children}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition",
        checked ? "bg-accent" : "bg-elev2"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
          checked ? "left-4.5" : "left-0.5"
        )}
      />
    </button>
  );
}

/** Tiny dropdown menu (no portal — used inside relative containers). */
export function Menu({
  trigger,
  children,
  align = "right",
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            "anim-pop absolute z-40 mt-1 min-w-44 overflow-hidden rounded-xl border border-edge bg-elev py-1 shadow-2xl",
            align === "right" ? "right-0" : "left-0"
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onClick,
  children,
  danger,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-elev2",
        danger ? "text-danger" : "text-ink"
      )}
    >
      {children}
    </button>
  );
}
